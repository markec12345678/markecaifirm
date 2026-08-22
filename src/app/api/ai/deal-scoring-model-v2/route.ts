// v7.69 / v8.96.4-batch4: AI Deal Scoring Model v2 — advanced ML-style deal scoring ki primerja
// več faktorjev (price, demand, risk, market depth, seller reliability,
// category performance, time) in producira 0-100 score. Razlika od obstoječega
// basic dealScore-a — ta uporablja weighted multi-factor model.
//
// "PS5 350€ (estValue 500€) → score 87 (A grade, STRONG_BUY). Strengths:
//  price (30% below), demand (HIGH)."
//
// Razlika od deal-score-calibrator (ki preverja ali AI deal score-i dejansko
// točni — kalibracija obstoječega dealScore) — ta GENERIRA NOVE weighted
// score iz več faktorjev. Razlika od batch-deal-evaluator (ki evaluira
// listing-e z AI) — ta uporablja MULTI-FACTOR model s 7 faktorji in weighted
// contributions. Razlika od deal-quality-forecaster (ki napoveduje po
// dnevih v tednu) — ta ocenjuje KVALITETO DEAL-A danes. Razlika od
// risk-reward-calculator (ki gleda potentialReward/loss) — ta gleda 7
// različnih faktorjev in weighted contributions.
//
// GET+POST /api/ai/deal-scoring-model-v2
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

interface DealScoringModelV2Input {
  listingId?: string;
}

// --- Types ---------------------------------------------------------------

type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
type Recommendation = 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'PASS';

interface FactorSet {
  priceFactor: number; // 0-1 (discount depth)
  demandFactor: number; // 0-1 (sell-through rate)
  riskFactor: number; // 0-1 (1 - aiRisk/10)
  marketDepthFactor: number; // 0-1 (category listings count / 100, capped)
  sellerReliabilityFactor: number; // 0-1 (based on seller history)
  categoryPerformanceFactor: number; // 0-1 (historical ROI for category)
  timeFactor: number; // 0-1 (sweet spot 3-14 days)
}

interface ScoreBreakdownRow {
  factor: string;
  weight: number; // %
  contribution: number; // 0-100 contribution to final score
}

interface ScoredListing {
  listingId: string;
  title: string;
  price: number;
  aiEstimatedValue: number;
  factors: FactorSet;
  weightedScore: number; // 0-100
  scoreBreakdown: ScoreBreakdownRow[];
  confidenceLevel: number; // 0-100
  grade: Grade;
  recommendation: Recommendation;
  keyStrengths: string[];
  keyWeaknesses: string[];
}

interface FactorWeight {
  factor: string;
  weight: number; // %
}

interface ModelInfo {
  factorWeights: FactorWeight[];
  totalListingsScored: number;
  avgScore: number;
  topGrade: string;
  strongBuyCount: number;
}

interface AiDealScoringResponse {
  factorWeights?: unknown;
  listings?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

const FACTOR_NAMES = [
  'priceFactor',
  'demandFactor',
  'riskFactor',
  'marketDepthFactor',
  'sellerReliabilityFactor',
  'categoryPerformanceFactor',
  'timeFactor',
] as const;

const EQUAL_WEIGHTS: FactorWeight[] = FACTOR_NAMES.map(name => ({
  factor: name,
  weight: Math.round((100 / FACTOR_NAMES.length) * 10) / 10,
}));

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function sanitizeStringArray(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s.length === 0) continue;
    out.push(s.slice(0, 200));
    if (out.length >= maxItems) break;
  }
  return out;
}

function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

// Compute grade from weighted score: S (90+), A (80-89), B (70-79), C (60-69), D (50-59), F (<50)
function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function recFromGrade(grade: Grade): Recommendation {
  if (grade === 'S' || grade === 'A') return 'STRONG_BUY';
  if (grade === 'B' || grade === 'C') return 'BUY';
  if (grade === 'D') return 'CONSIDER';
  return 'PASS';
}

// --- Factor computation --------------------------------------------------

// timeFactor: sweet spot 3-14 days = 1.0; degrade outside
function computeTimeFactor(daysListed: number): number {
  if (daysListed < 0) return 0;
  if (daysListed >= 3 && daysListed <= 14) return 1;
  if (daysListed < 3) return daysListed / 3; // ramp up
  if (daysListed <= 30) return 1 - (daysListed - 14) / 32; // gradual decline
  if (daysListed <= 60) return 0.5;
  return 0.2; // stale
}

// sellerReliabilityFactor: based on seller listings count (more = reliable)
function computeSellerReliability(sellerListingCount: number): number {
  if (sellerListingCount <= 0) return 0.4; // unknown
  if (sellerListingCount >= 50) return 0.95;
  if (sellerListingCount >= 20) return 0.85;
  if (sellerListingCount >= 10) return 0.7;
  if (sellerListingCount >= 5) return 0.55;
  return 0.45;
}

// categoryPerformanceFactor: historical ROI for category (0-1 normalized)
function computeCategoryPerformance(
  categoryROI: number | null,
  categoryCount: number,
): number {
  if (categoryCount === 0 || categoryROI == null) return 0.5; // neutral
  // Map ROI -50%..+50% to 0..1 (0% ROI = 0.5)
  const clampedROI = Math.max(-50, Math.min(50, categoryROI));
  return clamp01(0.5 + clampedROI / 100);
}

// demandFactor: sell-through rate for category (bookmarked %)
function computeDemand(
  bookmarkCount: number,
  totalCount: number,
): number {
  if (totalCount <= 0) return 0.3;
  const rate = bookmarkCount / totalCount;
  // Map rate 0..0.3 → 0..1
  return clamp01(rate / 0.3);
}

// marketDepthFactor: listings count in category / 100 (capped at 1.0)
function computeMarketDepth(categoryListingCount: number): number {
  return clamp01(categoryListingCount / 100);
}

// priceFactor: (estValue - price) / estValue (discount depth, capped at 1)
function computePriceFactor(price: number, estValue: number): number {
  if (estValue <= 0) return 0;
  return clamp01((estValue - price) / estValue);
}

// riskFactor: 1 - aiRisk/10
function computeRiskFactor(aiRisk: number): number {
  return clamp01(1 - aiRisk / 10);
}

// confidence: based on data completeness (how many non-null factors)
function computeConfidence(
  estValue: number | null,
  aiRisk: number | null,
  sellerName: string | null,
  hasCategoryHistory: boolean,
): number {
  let conf = 30;
  if (estValue != null && estValue > 0) conf += 25;
  if (aiRisk != null) conf += 15;
  if (sellerName) conf += 10;
  if (hasCategoryHistory) conf += 20;
  return Math.max(10, Math.min(100, conf));
}

// --- Deterministic weighted score (fallback) ----------------------------

function computeWeightedScore(
  factors: FactorSet,
  weights: FactorWeight[],
): { score: number; breakdown: ScoreBreakdownRow[] } {
  const wMap = new Map(weights.map(w => [w.factor, w.weight]));
  let score = 0;
  const breakdown: ScoreBreakdownRow[] = [];
  for (const name of FACTOR_NAMES) {
    const w = (wMap.get(name) ?? 0) / 100;
    const f = factors[name] ?? 0;
    const contribution = f * w * 100;
    score += contribution;
    breakdown.push({
      factor: name,
      weight: Math.round((w * 100) * 10) / 10,
      contribution: Math.round(contribution * 10) / 10,
    });
  }
  return { score: Math.round(Math.max(0, Math.min(100, score))), breakdown };
}

// Strengths/weaknesses from breakdown
function deriveStrengthsWeaknesses(
  factors: FactorSet,
  breakdown: ScoreBreakdownRow[],
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const labelMap: Record<string, string> = {
    priceFactor: 'cenovni popust',
    demandFactor: 'povpraševanje',
    riskFactor: 'nizko tveganje',
    marketDepthFactor: 'globina trga',
    sellerReliabilityFactor: 'zanesljivost prodajalca',
    categoryPerformanceFactor: 'ROI kategorije',
    timeFactor: 'optimalen čas oglasa',
  };

  // Sort factors by value desc → top 2 = strengths, bottom 2 = weaknesses
  const sorted = [...FACTOR_NAMES].sort((a, b) => factors[b] - factors[a]);
  const top2 = sorted.slice(0, 2);
  const bottom2 = sorted.slice(-2);

  for (const f of top2) {
    if (factors[f] >= 0.6) {
      const pct = Math.round(factors[f] * 100);
      strengths.push(`${labelMap[f]} (${pct}%)`);
    }
  }
  for (const f of bottom2) {
    if (factors[f] < 0.4) {
      const pct = Math.round(factors[f] * 100);
      weaknesses.push(`${labelMap[f]} (${pct}%)`);
    }
  }
  // Ensure at least 1 entry
  if (strengths.length === 0) strengths.push('ni izrazitih prednosti');
  if (weaknesses.length === 0) weaknesses.push('ni izrazitih slabosti');

  void breakdown; // breakdown used implicitly via factors
  return { strengths: strengths.slice(0, 2), weaknesses: weaknesses.slice(0, 2) };
}

// --- Helper: build deterministic listing --------------------------------

interface BaseListing {
  listingId: string;
  title: string;
  price: number;
  aiEstimatedValue: number;
  category: string;
  factors: FactorSet;
  hasCategoryHistory: boolean;
  sellerName: string | null;
  aiRisk: number | null;
}

function buildDeterministicListing(
  base: BaseListing,
  weights: FactorWeight[],
): ScoredListing {
  const { score, breakdown } = computeWeightedScore(base.factors, weights);
  const grade = gradeFromScore(score);
  const rec = recFromGrade(grade);
  const sw = deriveStrengthsWeaknesses(base.factors, breakdown);
  return {
    listingId: base.listingId,
    title: base.title,
    price: base.price,
    aiEstimatedValue: base.aiEstimatedValue,
    factors: base.factors,
    weightedScore: score,
    scoreBreakdown: breakdown,
    confidenceLevel: computeConfidence(
      base.aiEstimatedValue > 0 ? base.aiEstimatedValue : null,
      base.aiRisk,
      base.sellerName,
      base.hasCategoryHistory,
    ),
    grade,
    recommendation: rec,
    keyStrengths: sw.strengths,
    keyWeaknesses: sw.weaknesses,
  };
}

// --- Helper: build model info --------------------------------------------

function buildModelInfo(
  listings: ScoredListing[],
  factorWeights: FactorWeight[],
): ModelInfo {
  const total = listings.length;
  if (total === 0) {
    return {
      factorWeights,
      totalListingsScored: 0,
      avgScore: 0,
      topGrade: 'N/A',
      strongBuyCount: 0,
    };
  }
  const avgScore = Math.round(
    listings.reduce((s, l) => s + l.weightedScore, 0) / total,
  );
  const top = listings[0];
  const strongBuyCount = listings.filter(
    l => l.recommendation === 'STRONG_BUY',
  ).length;
  return {
    factorWeights,
    totalListingsScored: total,
    avgScore,
    topGrade: top?.grade ?? 'N/A',
    strongBuyCount,
  };
}

// --- Prompt builder -------------------------------------------------------

function buildListingBlock(baseListings: BaseListing[]): string {
  return baseListings
    .slice(0, 30)
    .map(
      (l, i) =>
        `${i + 1}. listingId=${l.listingId}, title="${l.title}", price=${l.price}€, estValue=${l.aiEstimatedValue}€, category="${l.category}", priceFactor=${round1(l.factors.priceFactor)}, demandFactor=${round1(l.factors.demandFactor)}, riskFactor=${round1(l.factors.riskFactor)}, marketDepthFactor=${round1(l.factors.marketDepthFactor)}, sellerReliabilityFactor=${round1(l.factors.sellerReliabilityFactor)}, categoryPerformanceFactor=${round1(l.factors.categoryPerformanceFactor)}, timeFactor=${round1(l.factors.timeFactor)}`,
    )
    .join('\n');
}

function buildPrompt(baseListings: BaseListing[]): string {
  const listingBlock = buildListingBlock(baseListings);
  return `Si AI deal scoring model za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Iz 7 faktorjev (priceFactor, demandFactor, riskFactor, marketDepthFactor, sellerReliabilityFactor, categoryPerformanceFactor, timeFactor) generiraj WEIGHTED 0-100 score per listing.

PODATKI O LISTING-IH (top ${Math.min(30, baseListings.length)} od ${baseListings.length}):
${listingBlock}

PRAVILA ZA SCORING:
1. factorWeights: določi uteži (% ) za vsak od 7 faktorjev — skupaj morajo znašati 100%. Tipično: priceFactor 25%, demandFactor 20%, riskFactor 15%, marketDepthFactor 10%, sellerReliabilityFactor 10%, categoryPerformanceFactor 10%, timeFactor 10%.
2. listings: za vsak listing napiši weightedScore (0-100) glede na faktorje in uteži, confidenceLevel (0-100 glede na popolnost podatkov), grade (S/A/B/C/D/F), recommendation (STRONG_BUY/BUY/CONSIDER/PASS), keyStrengths (top 2 faktorja z visokimi vrednostmi), keyWeaknesses (top 2 faktorja z nizkimi vrednostmi).

GRADE LOGIKA: S (90+), A (80-89), B (70-79), C (60-69), D (50-59), F (<50).
RECOMMENDATION LOGIKA: STRONG_BUY (S/A), BUY (B/C), CONSIDER (D), PASS (F).

VRNI LE JSON:
{
  "factorWeights": [
    { "factor": "priceFactor", "weight": 25 },
    { "factor": "demandFactor", "weight": 20 },
    { "factor": "riskFactor", "weight": 15 },
    { "factor": "marketDepthFactor", "weight": 10 },
    { "factor": "sellerReliabilityFactor", "weight": 10 },
    { "factor": "categoryPerformanceFactor", "weight": 10 },
    { "factor": "timeFactor", "weight": 10 }
  ],
  "listings": [
    {
      "listingId": "abc",
      "weightedScore": 87,
      "confidenceLevel": 80,
      "grade": "A",
      "recommendation": "STRONG_BUY",
      "keyStrengths": ["cenovni popust (85%)", "povpraševanje (70%)"],
      "keyWeaknesses": ["globina trga (20%)"]
    }
  ]
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI merge ------------------------------------------------------------

interface AiWeightsAndListings {
  factorWeights: FactorWeight[];
  scoredListings: ScoredListing[];
  aiUsed: boolean;
}

function parseAiWeightsAndListings(
  parsed: AiDealScoringResponse | null,
  baseListings: BaseListing[],
  fallbackWeights: FactorWeight[],
): AiWeightsAndListings {
  let factorWeights: FactorWeight[] = fallbackWeights;
  let scoredListings: ScoredListing[] = baseListings.map(b =>
    buildDeterministicListing(b, fallbackWeights),
  );
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Parse factorWeights — normalize to sum 100%
    if (Array.isArray(parsed.factorWeights)) {
      const aiWeights: FactorWeight[] = [];
      for (const w of parsed.factorWeights) {
        const a = w as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;
        const factorName = clampString(a.factor, 50, '');
        if (!FACTOR_NAMES.includes(factorName as typeof FACTOR_NAMES[number])) continue;
        const weight = clampNumber(a.weight, 0, 100, 0);
        aiWeights.push({ factor: factorName, weight });
      }
      if (aiWeights.length === FACTOR_NAMES.length) {
        // Normalize to 100%
        const sum = aiWeights.reduce((s, w) => s + w.weight, 0);
        if (sum > 0) {
          factorWeights = aiWeights.map(w => ({
            factor: w.factor,
            weight: Math.round((w.weight / sum) * 1000) / 10,
          }));
        }
      }
    }

    // Parse listings — preserve DB numbers, override AI fields
    if (Array.isArray(parsed.listings)) {
      const aiMap = new Map<string, Partial<ScoredListing>>();
      for (const l of parsed.listings) {
        const a = l as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;
        const listingId = clampString(a.listingId, 100, '');
        if (!listingId) continue;
        aiMap.set(listingId, {
          listingId,
          keyStrengths: sanitizeStringArray(a.keyStrengths, 2),
          keyWeaknesses: sanitizeStringArray(a.keyWeaknesses, 2),
        });
      }

      // Recompute all listings with new factorWeights + AI-provided strengths/weaknesses
      scoredListings = baseListings.map(base => {
        const { score, breakdown } = computeWeightedScore(base.factors, factorWeights);
        const grade = gradeFromScore(score);
        const rec = recFromGrade(grade);
        const sw = deriveStrengthsWeaknesses(base.factors, breakdown);
        const ai = aiMap.get(base.listingId);
        return {
          listingId: base.listingId,
          title: base.title,
          price: base.price,
          aiEstimatedValue: base.aiEstimatedValue,
          factors: base.factors,
          weightedScore: score,
          scoreBreakdown: breakdown,
          confidenceLevel: computeConfidence(
            base.aiEstimatedValue > 0 ? base.aiEstimatedValue : null,
            base.aiRisk,
            base.sellerName,
            base.hasCategoryHistory,
          ),
          grade,
          recommendation: rec,
          keyStrengths: ai?.keyStrengths?.length ? ai.keyStrengths : sw.strengths,
          keyWeaknesses: ai?.keyWeaknesses?.length ? ai.keyWeaknesses : sw.weaknesses,
        };
      });
      aiUsed = true;
    }
  }

  return { factorWeights, scoredListings, aiUsed };
}

// --- Handler -------------------------------------------------------------

const dealScoringHandler = withAiRoute<DealScoringModelV2Input>({
  endpoint: '/api/ai/deal-scoring-model-v2',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    let listingId: string | undefined;
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object') {
        const body = parsed as { listingId?: string };
        if (typeof body.listingId === 'string' && body.listingId.trim().length > 0) {
          listingId = body.listingId;
        }
      }
    } catch {
      // GET request — no body, score all active PRILIKA listings
    }
    return { listingId };
  },

  // No validateInput — listingId je optional
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;
    const { listingId } = input;

    // 1) Query listings (PRILIKA = active opportunity listings)
    const listingWhere = listingId
      ? {
          id: listingId,
          isHidden: false,
          aiVerdict: 'PRILIKA',
        }
      : {
          isHidden: false,
          aiVerdict: 'PRILIKA',
          price: { gt: 0 },
        };

    const listings = await db.listing.findMany({
      where: listingWhere,
      select: {
        id: true,
        title: true,
        price: true,
        firstSeenAt: true,
        sellerName: true,
        sellerListingCount: true,
        aiRisk: true,
        aiEstimatedValue: true,
        dealScore: true,
        isBookmarked: true,
        contactStatus: true,
        monitor: { select: { tags: true } },
      },
      take: listingId ? 1 : 200,
      orderBy: listingId ? undefined : { dealScore: 'desc' },
    });

    // Empty state
    if (listings.length === 0) {
      return apiOk({
        ok: true,
        listings: [],
        modelInfo: {
          factorWeights: EQUAL_WEIGHTS,
          totalListingsScored: 0,
          avgScore: 0,
          topGrade: 'N/A',
          strongBuyCount: 0,
        },
        aiUsed: false,
        message:
          'Ni aktivnih PRILIKA oglasov za scoring — dodaš oglase ali spremeniš aiVerdict v PRILIKA.',
      });
    }

    // 2) Compute category-level statistics (for demand, marketDepth, categoryPerformance)
    const categories = new Set<string>();
    for (const l of listings) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const cat = (firstTag || 'drugo').trim() || 'drugo';
      categories.add(cat);
    }

    // Count active listings per category
    const categoryListingCounts = new Map<string, number>();
    const allListingsInCats = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { gt: 0 },
      },
      select: { monitor: { select: { tags: true } }, isBookmarked: true },
      take: 20000,
    });
    for (const l of allListingsInCats) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const cat = (firstTag || 'drugo').trim() || 'drugo';
      categoryListingCounts.set(cat, (categoryListingCounts.get(cat) ?? 0) + 1);
    }

    // Per-category demand (bookmarked count from all listings)
    const categoryDemand = new Map<string, { bookmarked: number; total: number }>();
    for (const l of allListingsInCats) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const cat = (firstTag || 'drugo').trim() || 'drugo';
      const cur = categoryDemand.get(cat) || { bookmarked: 0, total: 0 };
      cur.total += 1;
      if (l.isBookmarked) cur.bookmarked += 1;
      categoryDemand.set(cat, cur);
    }

    // Per-category historical ROI from SOLD trades
    const categoryROI = new Map<string, { sum: number; count: number }>();
    const soldByCat = await db.trade.findMany({
      where: {
        status: 'sold',
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: { category: true, buyPrice: true, sellPrice: true, sellFees: true, buyFees: true },
      take: 5000,
    });
    for (const t of soldByCat) {
      const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const roi = buy > 0 ? ((sell - buy) / buy) * 100 : 0;
      const cur = categoryROI.get(cat) || { sum: 0, count: 0 };
      cur.sum += roi;
      cur.count += 1;
      categoryROI.set(cat, cur);
    }

    // 4) Compute factors per listing
    const baseListings: BaseListing[] = [];
    for (const l of listings) {
      const price = l.price ?? 0;
      const estValue = l.aiEstimatedValue ?? price;
      const aiRisk = l.aiRisk;
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const category = (firstTag || 'drugo').trim() || 'drugo';

      // daysListed from firstSeenAt
      const daysListed = l.firstSeenAt
        ? Math.max(0, Math.round((Date.now() - new Date(l.firstSeenAt).getTime()) / DAY_MS))
        : 0;

      const catCount = categoryListingCounts.get(category) ?? 0;
      const demand = categoryDemand.get(category) || { bookmarked: 0, total: 0 };
      const roi = categoryROI.get(category);
      const categoryROIValue = roi && roi.count > 0 ? roi.sum / roi.count : null;

      const factors: FactorSet = {
        priceFactor: computePriceFactor(price, estValue),
        demandFactor: computeDemand(demand.bookmarked, demand.total),
        riskFactor: aiRisk != null ? computeRiskFactor(aiRisk) : 0.5,
        marketDepthFactor: computeMarketDepth(catCount),
        sellerReliabilityFactor: computeSellerReliability(
          l.sellerListingCount ?? 0,
        ),
        categoryPerformanceFactor: computeCategoryPerformance(
          categoryROIValue,
          roi?.count ?? 0,
        ),
        timeFactor: computeTimeFactor(daysListed),
      };

      baseListings.push({
        listingId: l.id,
        title: l.title,
        price,
        aiEstimatedValue: estValue,
        category,
        factors,
        hasCategoryHistory: (roi?.count ?? 0) >= 3,
        sellerName: l.sellerName,
        aiRisk,
      });
    }

    void categories;

    // 5) AI cache check (6h TTL)
    const sortedListingIds = baseListings.map(l => l.listingId).sort();
    const cacheKey = `deal-scoring-model-v2:${JSON.stringify(sortedListingIds)}`;
    const cached = getCachedAI<{
      factorWeights: FactorWeight[];
      listings: ScoredListing[];
    }>(cacheKey);
    if (cached && Array.isArray(cached.listings) && cached.listings.length > 0) {
      // Merge cached AI fields with fresh DB factors (price may have changed)
      const merged: ScoredListing[] = baseListings.map(base => {
        const c = cached.listings.find(x => x.listingId === base.listingId);
        if (!c) {
          return buildDeterministicListing(base, cached.factorWeights);
        }
        // Recompute score with current factors + cached weights (in case price changed)
        const { score, breakdown } = computeWeightedScore(
          base.factors,
          cached.factorWeights,
        );
        const grade = gradeFromScore(score);
        const rec = recFromGrade(grade);
        const sw = deriveStrengthsWeaknesses(base.factors, breakdown);
        return {
          listingId: base.listingId,
          title: base.title,
          price: base.price,
          aiEstimatedValue: base.aiEstimatedValue,
          factors: base.factors,
          weightedScore: score,
          scoreBreakdown: breakdown,
          confidenceLevel: computeConfidence(
            base.aiEstimatedValue > 0 ? base.aiEstimatedValue : null,
            base.aiRisk,
            base.sellerName,
            base.hasCategoryHistory,
          ),
          grade,
          recommendation: rec,
          keyStrengths: c.keyStrengths?.length
            ? c.keyStrengths
            : sw.strengths,
          keyWeaknesses: c.keyWeaknesses?.length
            ? c.keyWeaknesses
            : sw.weaknesses,
        };
      });
      const sortedMerged = merged.sort((a, b) => b.weightedScore - a.weightedScore);
      return apiOk({
        ok: true,
        listings: sortedMerged,
        modelInfo: buildModelInfo(sortedMerged, cached.factorWeights),
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
    const prompt = buildPrompt(baseListings);

    // Start with deterministic baseline (equal weights)
    let factorWeights: FactorWeight[] = EQUAL_WEIGHTS;
    let scoredListingsFinal: ScoredListing[] = baseListings.map(b =>
      buildDeterministicListing(b, EQUAL_WEIGHTS),
    );
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiDealScoringResponse | null;
      const result = parseAiWeightsAndListings(parsed, baseListings, EQUAL_WEIGHTS);
      // factorWeights gets updated whenever AI returned valid weights (even without listings)
      factorWeights = result.factorWeights;
      if (result.aiUsed) {
        scoredListingsFinal = result.scoredListings;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-scoring-model-v2',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Sort by weightedScore desc
    scoredListingsFinal.sort((a, b) => b.weightedScore - a.weightedScore);

    // 8) Cache (6h TTL) — only when AI was used (listings were parsed)
    if (aiUsed) {
      setCachedAI(cacheKey, { factorWeights, listings: scoredListingsFinal });
    }

    return apiOk({
      ok: true,
      listings: scoredListingsFinal,
      modelInfo: buildModelInfo(scoredListingsFinal, factorWeights),
      aiUsed,
    });
  },
});

export const GET = dealScoringHandler;
export const POST = dealScoringHandler;
