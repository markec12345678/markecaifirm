// v7.76 / v8.96.4-batch3: AI Market Intelligence Engine — AI-powered celovit "executive
// dashboard" view trga, ki kombinira VSE market signale (sentiment, depth,
// saturation, momentum, gaps, trends) v en sam izvršni povzetek.
// "Market: EXPAND. Opportunities: elektronika (HOT+DEEP+RISING). Threats:
//  avto (saturating). Confidence: 82%."
//
// Razlika od market-sentiment-pulse (v7.75, ki da 0-100 pulse iz 5 signalov)
// — ta je EXECUTIVE SUMMARY z opportunities, threats, per-category scorecard
// in strategic recommendation. Razlika od competitive-landscape-analyzer
// (v7.66, ki gleda konkurente) — ta gleda lasten trg holistično. Razlika od
// market-share-analyzer (v7.67, ki gleda market share) — ta da STRATEGIC
// action EXPAND/MAINTAIN/CONTRACT/EXIT. Razlika od market-gap-finder (v7.56,
// ki gleda trenutne prazne niše) — ta kombinira VSE signale v executive
// view. Razlika od market-trend-momentum (v7.73, ki gleda acceleration per
// kategorija) — ta gleda 6 različnih signalov hkrati in overall strategijo.
// Razlika od market-depth-analyzer (v7.68, ki gleda globino trga) — ta
// integrira globino kot enega od 6 signalov v executive povzetek.
//
// GET+POST /api/ai/market-intelligence-engine
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MarketIntelligenceInput {}

// --- Types ---------------------------------------------------------------

type StrategicAction = 'EXPAND' | 'MAINTAIN' | 'CONTRACT' | 'EXIT';
type CategoryClassification = 'OPPORTUNITY' | 'STABLE' | 'RISK' | 'AVOID';
type Impact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

interface KeyFinding {
  finding: string;
  signal: string;
  category: string;
  impact: Impact;
}

interface Opportunity {
  opportunity: string;
  category: string;
  expectedProfit: number;
  timeFrame: string;
  action: string;
}

interface Threat {
  threat: string;
  category: string;
  severity: Severity;
  mitigation: string;
}

interface CategoryIntelligence {
  category: string;
  sentimentScore: number;
  depthScore: number;
  saturationScore: number;
  momentumScore: number;
  gapScore: number;
  trendScore: number;
  overallScore: number; // 0-100
  classification: CategoryClassification;
}

interface StrategicRecommendation {
  action: StrategicAction;
  reasoning: string;
  confidenceLevel: number; // 0-100
}

interface MarketIntelligenceResponse {
  ok: true;
  marketOverview: string;
  keyFindings: KeyFinding[];
  opportunities: Opportunity[];
  threats: Threat[];
  categoryIntelligence: CategoryIntelligence[];
  strategicRecommendation: StrategicRecommendation;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiIntelligenceResponse {
  marketOverview?: unknown;
  keyFindings?: unknown;
  opportunities?: unknown;
  threats?: unknown;
  categoryIntelligence?: unknown;
  strategicRecommendation?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

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

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

const VALID_ACTION: readonly StrategicAction[] = ['EXPAND', 'MAINTAIN', 'CONTRACT', 'EXIT'];
const VALID_CLASSIFICATION: readonly CategoryClassification[] = [
  'OPPORTUNITY',
  'STABLE',
  'RISK',
  'AVOID',
];
const VALID_IMPACT: readonly Impact[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];
const VALID_SEVERITY: readonly Severity[] = ['LOW', 'MEDIUM', 'HIGH'];

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

// Classify overall category intelligence score
function classifyCategory(score: number): CategoryClassification {
  if (score >= 70) return 'OPPORTUNITY';
  if (score >= 50) return 'STABLE';
  if (score >= 30) return 'RISK';
  return 'AVOID';
}

// Compute strategic action from overall scores
function pickStrategicAction(avgOverall: number, opportunityCount: number, riskCount: number): StrategicAction {
  if (avgOverall >= 65 && opportunityCount > riskCount) return 'EXPAND';
  if (avgOverall >= 45) return 'MAINTAIN';
  if (avgOverall >= 25 && riskCount > opportunityCount) return 'CONTRACT';
  if (avgOverall < 25) return 'EXIT';
  return 'MAINTAIN';
}

// Current ISO week for cache key (e.g. "2026-W34")
function currentWeekKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const daysSinceStart = Math.floor((now.getTime() - startOfYear.getTime()) / DAY_MS);
  const weekNum = Math.ceil((daysSinceStart + startOfYear.getUTCDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

// --- Per-category aggregation ------------------------------------------

interface CatAgg {
  category: string;
  currentCount: number;
  previousCount: number;
  currentSumPrice: number;
  currentPricedCount: number;
  previousSumPrice: number;
  previousPricedCount: number;
  currentSumDealScore: number;
  currentDealScoreCount: number;
  currentPrilikaCount: number;
  currentBookmarkedCount: number;
  currentContactedCount: number;
  currentTotal: number;
  previousTotal: number;
}

interface ListingRow {
  id: string;
  price: number | null;
  firstSeenAt: Date | string | null;
  dealScore: number | null;
  aiVerdict: string | null;
  isBookmarked: boolean;
  contactStatus: string | null;
  monitor: { source: string | null } | null;
}

function aggregateListings(
  listings: ListingRow[],
  currentCutoffMs: number,
): Map<string, CatAgg> {
  const catMap = new Map<string, CatAgg>();
  for (const l of listings) {
    const rawSource = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
    const category = rawSource;
    const firstSeenMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
    if (!Number.isFinite(firstSeenMs)) continue;
    const isCurrent = firstSeenMs >= currentCutoffMs;
    let agg = catMap.get(category);
    if (!agg) {
      agg = {
        category,
        currentCount: 0,
        previousCount: 0,
        currentSumPrice: 0,
        currentPricedCount: 0,
        previousSumPrice: 0,
        previousPricedCount: 0,
        currentSumDealScore: 0,
        currentDealScoreCount: 0,
        currentPrilikaCount: 0,
        currentBookmarkedCount: 0,
        currentContactedCount: 0,
        currentTotal: 0,
        previousTotal: 0,
      };
      catMap.set(category, agg);
    }
    if (isCurrent) {
      agg.currentCount += 1;
      agg.currentTotal += 1;
      if (l.price != null && l.price > 0) {
        agg.currentSumPrice += l.price;
        agg.currentPricedCount += 1;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        agg.currentSumDealScore += l.dealScore;
        agg.currentDealScoreCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') agg.currentPrilikaCount += 1;
      if (l.isBookmarked) agg.currentBookmarkedCount += 1;
      if (l.contactStatus && l.contactStatus !== 'none' && l.contactStatus !== '') {
        agg.currentContactedCount += 1;
      }
    } else {
      agg.previousCount += 1;
      agg.previousTotal += 1;
      if (l.price != null && l.price > 0) {
        agg.previousSumPrice += l.price;
        agg.previousPricedCount += 1;
      }
    }
  }
  return catMap;
}

function computeCategoryIntelligence(catMap: Map<string, CatAgg>): CategoryIntelligence[] {
  const baseline: CategoryIntelligence[] = [];

  for (const [cat, agg] of catMap.entries()) {
    const totalCat = agg.currentTotal + agg.previousTotal;
    if (totalCat === 0) continue;

    // Signal 1: SENTIMENT — combination of prilika rate + deal score + sell-through
    const prilikaRate = agg.currentTotal > 0 ? (agg.currentPrilikaCount / agg.currentTotal) * 100 : 0;
    const avgDealScore = agg.currentDealScoreCount > 0
      ? agg.currentSumDealScore / agg.currentDealScoreCount
      : 0;
    const sellThroughRate = agg.currentTotal > 0
      ? ((agg.currentBookmarkedCount + agg.currentContactedCount) / agg.currentTotal) * 100
      : 0;
    const sentimentScore = Math.round(
      Math.max(0, Math.min(100,
        prilikaRate * 2 * 0.4 + avgDealScore * 0.3 + sellThroughRate * 2 * 0.3,
      )),
    );

    // Signal 2: DEPTH — log scale of listing count (5 listings=20, 50=70, 200+=100)
    const depthScore = Math.round(
      Math.max(0, Math.min(100, Math.log10(Math.max(1, agg.currentTotal + agg.previousTotal)) * 40)),
    );

    // Signal 3: SATURATION — based on listing velocity (current vs previous)
    // High growth = saturating (lower score = more saturated)
    const velocityRatio = agg.previousTotal > 0
      ? agg.currentTotal / agg.previousTotal
      : 1;
    // saturationScore: lower = more saturated (high growth = bad)
    // 1.0 ratio = 70, 0.5 ratio = 90, 2.0 ratio = 50, 3.0+ ratio = 20
    let saturationScore = 70;
    if (velocityRatio <= 0.5) saturationScore = 90;
    else if (velocityRatio <= 1.0) saturationScore = 80;
    else if (velocityRatio <= 1.5) saturationScore = 65;
    else if (velocityRatio <= 2.0) saturationScore = 50;
    else if (velocityRatio <= 3.0) saturationScore = 30;
    else saturationScore = 15;

    // Signal 4: MOMENTUM — listing count change rate (positive = rising)
    const momentumScore = Math.round(
      Math.max(0, Math.min(100, 50 + (velocityRatio - 1) * 30)),
    );

    // Signal 5: GAP — demand (bookmarked+contacted) vs supply (listings)
    // High demand + low supply = big gap (high score)
    const demand = agg.currentBookmarkedCount + agg.currentContactedCount;
    const supply = agg.currentTotal;
    const gapScore = supply > 0
      ? Math.round(Math.max(0, Math.min(100, (demand / supply) * 100 * 2)))
      : 0;

    // Signal 6: TREND — avg price change current vs previous
    const currentAvgPrice = agg.currentPricedCount > 0
      ? agg.currentSumPrice / agg.currentPricedCount
      : 0;
    const previousAvgPrice = agg.previousPricedCount > 0
      ? agg.previousSumPrice / agg.previousPricedCount
      : 0;
    let priceTrendPct = 0;
    if (previousAvgPrice > 0) {
      priceTrendPct = ((currentAvgPrice - previousAvgPrice) / previousAvgPrice) * 100;
    }
    const trendScore = Math.round(
      Math.max(0, Math.min(100, 50 + priceTrendPct * 2.5)),
    );

    // Overall score (weighted: sentiment 25%, depth 15%, saturation 15%, momentum 20%, gap 15%, trend 10%)
    const overallScore = Math.round(
      sentimentScore * 0.25 +
      depthScore * 0.15 +
      saturationScore * 0.15 +
      momentumScore * 0.20 +
      gapScore * 0.15 +
      trendScore * 0.10,
    );

    baseline.push({
      category: cat,
      sentimentScore,
      depthScore,
      saturationScore,
      momentumScore,
      gapScore,
      trendScore,
      overallScore,
      classification: classifyCategory(overallScore),
    });
  }

  return baseline;
}

// --- Deterministic findings/opportunities/threats ----------------------

interface DeterministicExtras {
  avgOverall: number;
  opportunityCount: number;
  riskCount: number;
  deterministicAction: StrategicAction;
  confidenceLevel: number;
  deterministicFindings: KeyFinding[];
  deterministicOpportunities: Opportunity[];
  deterministicThreats: Threat[];
  deterministicStrategic: StrategicRecommendation;
  deterministicOverview: string;
}

function buildDeterministicExtras(
  topCategories: CategoryIntelligence[],
  listingsCount: number,
): DeterministicExtras {
  const avgOverall = Math.round(
    topCategories.reduce((s, c) => s + c.overallScore, 0) / topCategories.length,
  );
  const opportunityCount = topCategories.filter((c) => c.classification === 'OPPORTUNITY').length;
  const riskCount = topCategories.filter((c) => c.classification === 'RISK' || c.classification === 'AVOID').length;
  const deterministicAction = pickStrategicAction(avgOverall, opportunityCount, riskCount);

  // Deterministic key findings (top 5)
  const deterministicFindings: KeyFinding[] = topCategories.slice(0, 5).map((c) => {
    const signals: string[] = [];
    if (c.sentimentScore >= 70) signals.push('HOT sentiment');
    if (c.depthScore >= 70) signals.push('DEEP market');
    if (c.saturationScore <= 50) signals.push('SATURATING');
    if (c.momentumScore >= 70) signals.push('RISING');
    if (c.gapScore >= 60) signals.push('HIGH demand gap');
    if (c.trendScore >= 70) signals.push('PRICES UP');
    if (signals.length === 0) signals.push('STABLE');
    const impact: Impact = c.classification === 'OPPORTUNITY'
      ? 'POSITIVE'
      : c.classification === 'RISK' || c.classification === 'AVOID'
        ? 'NEGATIVE'
        : 'NEUTRAL';
    return {
      finding: `${c.category}: ${signals.join(' + ')} (overall ${c.overallScore}/100, ${c.classification})`,
      signal: signals[0] ?? 'STABLE',
      category: c.category,
      impact,
    };
  });

  // Deterministic opportunities (top 3 OPPORTUNITY categories)
  const deterministicOpportunities: Opportunity[] = topCategories
    .filter((c) => c.classification === 'OPPORTUNITY')
    .slice(0, 3)
    .map((c) => {
      const expectedProfit = Math.round(
        Math.max(100, c.overallScore * 8 + c.gapScore * 3 + c.sentimentScore * 2),
      );
      return {
        opportunity: `${c.category}: overall ${c.overallScore}/100 — ${c.classification} z ${c.sentimentScore} sentiment, ${c.momentumScore} momentum, ${c.gapScore} gap score`,
        category: c.category,
        expectedProfit,
        timeFrame: '30 dni',
        action: `Aktivno nabavljaj in prodajaj v ${c.category} — povečaj monitorje za to kategorijo.`,
      };
    });

  // Deterministic threats (top 3 RISK/AVOID categories)
  const deterministicThreats: Threat[] = topCategories
    .filter((c) => c.classification === 'RISK' || c.classification === 'AVOID')
    .slice(0, 3)
    .map((c) => {
      const severity: Severity = c.classification === 'AVOID' ? 'HIGH' : 'MEDIUM';
      let mitigation = 'Zmanjšaj aktivnost v tej kategoriji.';
      if (c.saturationScore <= 30) mitigation = 'Trg nasičen — počakaj na umiritev ali diverzificiraj.';
      else if (c.momentumScore <= 30) mitigation = 'Padajoč trend — prodi hitro in ne nabavljaj.';
      else if (c.trendScore <= 30) mitigation = 'Cene padajo — izogibaj se nabavi, fokus na prodajo.';
      return {
        threat: `${c.category}: overall ${c.overallScore}/100 — ${c.classification} (saturation ${c.saturationScore}, momentum ${c.momentumScore}, trend ${c.trendScore})`,
        category: c.category,
        severity,
        mitigation,
      };
    });

  const confidenceLevel = Math.round(
    Math.max(0, Math.min(100, 40 + topCategories.length * 4 + (listingsCount / 1000) * 20)),
  );
  const deterministicStrategic: StrategicRecommendation = {
    action: deterministicAction,
    reasoning: deterministicAction === 'EXPAND'
      ? `Trg je ugoden (avg ${avgOverall}/100, ${opportunityCount} priložnosti) — povečaj investicije in nabavo v OPPORTUNITY kategorijah.`
      : deterministicAction === 'MAINTAIN'
        ? `Trg je stabilen (avg ${avgOverall}/100) — vzdržuj trenutno strategijo, opazuj trende.`
        : deterministicAction === 'CONTRACT'
          ? `Trg se slabša (avg ${avgOverall}/100, ${riskCount} tveganj) — zmanjšaj nabavo, fokus na likvidacijo.`
          : `Trg je neugoden (avg ${avgOverall}/100) — izstopi iz kategorij z AVOID klasifikacijo, fokus na diversifikacijo.`,
    confidenceLevel,
  };

  const deterministicOverview = `Trg povprečja ${avgOverall}/100, strategija: ${deterministicAction}. ${opportunityCount} priložnosti, ${riskCount} tveganj. Top: ${topCategories[0]?.category ?? 'neznan'} (${topCategories[0]?.overallScore ?? 0}/100).`;

  return {
    avgOverall,
    opportunityCount,
    riskCount,
    deterministicAction,
    confidenceLevel,
    deterministicFindings,
    deterministicOpportunities,
    deterministicThreats,
    deterministicStrategic,
    deterministicOverview,
  };
}

// --- Prompt builder + AI response transform (čisti helperji) ------------

function buildPrompt(
  topCategories: CategoryIntelligence[],
  catMap: Map<string, CatAgg>,
  extras: DeterministicExtras,
): string {
  const categorySignalsForPrompt = topCategories.map((c) => ({
    category: c.category, // platform source (Bolha, Vinted, etc.)
    overallScore: c.overallScore,
    classification: c.classification,
    signals: {
      sentiment: c.sentimentScore,
      depth: c.depthScore,
      saturation: c.saturationScore,
      momentum: c.momentumScore,
      gap: c.gapScore,
      trend: c.trendScore,
    },
    currentListings: catMap.get(c.category)?.currentTotal ?? 0,
    previousListings: catMap.get(c.category)?.previousTotal ?? 0,
  }));

  return `Si AI "Market Intelligence Engine" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Generiraj celovit "executive dashboard" view trga — kombiniraj VSE market signale (sentiment, depth, saturation, momentum, gaps, trends) v en sam izvršni povzetek.

KATEGORIJE (platform viri) Z 6 SIGNALI (deterministično izračunano):
${JSON.stringify(categorySignalsForPrompt, null, 2)}

DETERMINISTIČNI POVZETEK (referenca):
- avgOverall: ${extras.avgOverall}/100
- opportunityCount: ${extras.opportunityCount}
- riskCount: ${extras.riskCount}
- deterministicAction: ${extras.deterministicAction}
- confidenceLevel: ${extras.confidenceLevel}

PRAVILA ZA AI ODGOVOR:
1. marketOverview: 1-2 stavka povzetka trenutnega stanja trga (max 300 znakov, slovensko)
2. keyFindings: top 5 insights (array)
   - finding: slovensko (max 200 znakov)
   - signal: kateri signal dominira (npr. "HOT sentiment", "SATURATING")
   - category: ime kategorije
   - impact: POSITIVE / NEGATIVE / NEUTRAL (validiraj proti enum)
3. opportunities: top 3 priložnosti (array)
   - opportunity: slovensko (max 200 znakov)
   - category: ime kategorije
   - expectedProfit: € (0-50000, anti-hallucination clamp)
   - timeFrame: slovensko (max 30 znakov)
   - action: slovenski concrete action (max 200 znakov)
4. threats: top 3 tveganja (array)
   - threat: slovensko (max 200 znakov)
   - category: ime kategorije
   - severity: LOW / MEDIUM / HIGH (validiraj proti enum)
   - mitigation: slovenski concrete mitigation (max 200 znakov)
5. categoryIntelligence: per-category scorecard (array, max 15)
   - category, sentimentScore, depthScore, saturationScore, momentumScore, gapScore, trendScore (vsi 0-100)
   - overallScore: 0-100 (anti-hallucination clamp)
   - classification: OPPORTUNITY (70+) / STABLE (50-69) / RISK (30-49) / AVOID (<30) — validiraj proti enum
6. strategicRecommendation:
   - action: EXPAND / MAINTAIN / CONTRACT / EXIT (validiraj proti enum)
   - reasoning: slovensko (max 300 znakov)
   - confidenceLevel: 0-100 (anti-hallucination clamp)
7. summary: slovensko (max 500 znakov)

VRNI LE JSON:
{
  "marketOverview": "...",
  "keyFindings": [{ "finding": "...", "signal": "...", "category": "...", "impact": "POSITIVE" }],
  "opportunities": [{ "opportunity": "...", "category": "...", "expectedProfit": 0, "timeFrame": "...", "action": "..." }],
  "threats": [{ "threat": "...", "category": "...", "severity": "MEDIUM", "mitigation": "..." }],
  "categoryIntelligence": [{ "category": "...", "sentimentScore": 0, "depthScore": 0, "saturationScore": 0, "momentumScore": 0, "gapScore": 0, "trendScore": 0, "overallScore": 0, "classification": "STABLE" }],
  "strategicRecommendation": { "action": "MAINTAIN", "reasoning": "...", "confidenceLevel": 0 },
  "summary": "..."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface AiTransformResult {
  marketOverview: string;
  keyFindings: KeyFinding[];
  opportunities: Opportunity[];
  threats: Threat[];
  categoryIntelligence: CategoryIntelligence[];
  strategicRecommendation: StrategicRecommendation;
  summary: string;
}

function transformAiResponse(
  parsed: unknown,
  base: DeterministicExtras,
  topCategories: CategoryIntelligence[],
): AiTransformResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const ai = parsed as AiIntelligenceResponse;

  let marketOverview = base.deterministicOverview;
  let keyFindings = base.deterministicFindings;
  let opportunities = base.deterministicOpportunities;
  let threats = base.deterministicThreats;
  let categoryIntelligence = topCategories;
  let strategicRecommendation = base.deterministicStrategic;
  let summary = base.deterministicOverview;

  // marketOverview
  if (typeof ai.marketOverview === 'string' && ai.marketOverview.trim().length > 0) {
    marketOverview = clampString(ai.marketOverview, 300, base.deterministicOverview);
  }

  // keyFindings (max 5, all clamped)
  if (Array.isArray(ai.keyFindings)) {
    const newFindings: KeyFinding[] = [];
    for (const f of ai.keyFindings.slice(0, 5)) {
      const r = f as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const finding = clampString(r.finding, 200, '');
      if (!finding) continue;
      newFindings.push({
        finding,
        signal: clampString(r.signal, 50, 'STABLE'),
        category: clampString(r.category, 50, 'neznan'),
        impact: clampEnum(r.impact, VALID_IMPACT, 'NEUTRAL'),
      });
    }
    if (newFindings.length > 0) keyFindings = newFindings;
  }

  // opportunities (max 3, all clamped)
  if (Array.isArray(ai.opportunities)) {
    const newOpps: Opportunity[] = [];
    for (const o of ai.opportunities.slice(0, 3)) {
      const r = o as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const opportunity = clampString(r.opportunity, 200, '');
      if (!opportunity) continue;
      newOpps.push({
        opportunity,
        category: clampString(r.category, 50, 'neznan'),
        expectedProfit: clampNumber(r.expectedProfit, 0, 50000, 100),
        timeFrame: clampString(r.timeFrame, 30, '30 dni'),
        action: clampString(r.action, 200, 'Aktivno nabavljaj.'),
      });
    }
    if (newOpps.length > 0) opportunities = newOpps;
  }

  // threats (max 3, all clamped)
  if (Array.isArray(ai.threats)) {
    const newThreats: Threat[] = [];
    for (const t of ai.threats.slice(0, 3)) {
      const r = t as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const threat = clampString(r.threat, 200, '');
      if (!threat) continue;
      newThreats.push({
        threat,
        category: clampString(r.category, 50, 'neznan'),
        severity: clampEnum(r.severity, VALID_SEVERITY, 'MEDIUM'),
        mitigation: clampString(r.mitigation, 200, 'Zmanjšaj aktivnost.'),
      });
    }
    if (newThreats.length > 0) threats = newThreats;
  }

  // categoryIntelligence (anti-hallucination: clamp all scores 0-100)
  if (Array.isArray(ai.categoryIntelligence)) {
    const newCatIntel: CategoryIntelligence[] = [];
    for (const c of ai.categoryIntelligence.slice(0, 15)) {
      const r = c as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const category = String(r.category || '').trim().toLowerCase();
      if (!category) continue;
      const sentimentScore = clampNumber(r.sentimentScore, 0, 100, 50);
      const depthScore = clampNumber(r.depthScore, 0, 100, 50);
      const saturationScore = clampNumber(r.saturationScore, 0, 100, 50);
      const momentumScore = clampNumber(r.momentumScore, 0, 100, 50);
      const gapScore = clampNumber(r.gapScore, 0, 100, 50);
      const trendScore = clampNumber(r.trendScore, 0, 100, 50);
      const overallScore = clampNumber(r.overallScore, 0, 100,
        Math.round((sentimentScore + depthScore + saturationScore + momentumScore + gapScore + trendScore) / 6),
      );
      const classification = clampEnum(
        r.classification,
        VALID_CLASSIFICATION,
        classifyCategory(overallScore),
      );
      newCatIntel.push({
        category,
        sentimentScore: Math.round(sentimentScore),
        depthScore: Math.round(depthScore),
        saturationScore: Math.round(saturationScore),
        momentumScore: Math.round(momentumScore),
        gapScore: Math.round(gapScore),
        trendScore: Math.round(trendScore),
        overallScore: Math.round(overallScore),
        classification,
      });
    }
    if (newCatIntel.length > 0) {
      // Sort by overallScore desc
      newCatIntel.sort((a, b) => b.overallScore - a.overallScore);
      categoryIntelligence = newCatIntel;
    }
  }

  // strategicRecommendation
  if (ai.strategicRecommendation && typeof ai.strategicRecommendation === 'object') {
    const sr = ai.strategicRecommendation as Record<string, unknown>;
    const action = clampEnum(sr.action, VALID_ACTION, base.deterministicAction);
    const reasoning = clampString(sr.reasoning, 300, base.deterministicStrategic.reasoning);
    const confLevel = clampNumber(sr.confidenceLevel, 0, 100, base.confidenceLevel);
    strategicRecommendation = {
      action,
      reasoning,
      confidenceLevel: Math.round(confLevel),
    };
  }

  // summary
  if (typeof ai.summary === 'string' && ai.summary.trim().length > 0) {
    summary = clampString(ai.summary, 500, base.deterministicOverview);
  }

  return {
    marketOverview,
    keyFindings,
    opportunities,
    threats,
    categoryIntelligence,
    strategicRecommendation,
    summary,
  };
}

// --- Handler -------------------------------------------------------------

const marketIntelligenceHandler = withAiRoute<MarketIntelligenceInput>({
  endpoint: '/api/ai/market-intelligence-engine',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const currentCutoff = new Date(now - 7 * DAY_MS); // last 7d
    const previousCutoff = new Date(now - 14 * DAY_MS); // previous 7d (for trend analysis)

    // 1) Query listings for market signals (last 14d for trend, 30d for depth).
    // NOTE: Listing does not have a `category` field (only Trade does).
    // For per-category market intelligence we use monitor.source as the
    // categorization dimension (Bolha / Vinted / Facebook / mobile.de / etc.).
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: previousCutoff },
        isHidden: false,
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        dealScore: true,
        aiVerdict: true,
        isBookmarked: true,
        contactStatus: true,
        monitor: { select: { source: true } },
      },
      take: 50000,
    }) as unknown as ListingRow[];

    // Empty state — no listings
    if (listings.length === 0) {
      return apiOk({
        ok: true,
        marketOverview: 'Ni listing-ov v zadnjih 14 dneh — Market Intelligence Engine ni mogoč.',
        keyFindings: [],
        opportunities: [],
        threats: [],
        categoryIntelligence: [],
        strategicRecommendation: {
          action: 'MAINTAIN',
          reasoning: 'Ni dovolj podatkov za strateško priporočilo — dodaj listing-e za analizo trga.',
          confidenceLevel: 0,
        },
        summary: 'Ni listing-ov v zadnjih 14 dneh — Market Intelligence Engine ni mogoč.',
        aiUsed: false,
        message: 'Ni listing-ov v zadnjih 14 dneh — Market Intelligence Engine ni mogoč.',
      } satisfies MarketIntelligenceResponse);
    }

    // 2) Aggregate per category
    const catMap = aggregateListings(listings, currentCutoff.getTime());

    // 3) Compute 6 signals per category (all 0-100)
    const categoryIntelligenceBaseline = computeCategoryIntelligence(catMap);

    // Sort by overallScore desc, take top 15
    categoryIntelligenceBaseline.sort((a, b) => b.overallScore - a.overallScore);
    const topCategories = categoryIntelligenceBaseline.slice(0, 15);

    if (topCategories.length === 0) {
      return apiOk({
        ok: true,
        marketOverview: 'Ni dovolj kategoriziranih podatkov — Market Intelligence Engine ni mogoč.',
        keyFindings: [],
        opportunities: [],
        threats: [],
        categoryIntelligence: [],
        strategicRecommendation: {
          action: 'MAINTAIN',
          reasoning: 'Ni dovolj podatkov za strateško priporočilo.',
          confidenceLevel: 0,
        },
        summary: 'Ni dovolj kategoriziranih podatkov — Market Intelligence Engine ni mogoč.',
        aiUsed: false,
        message: 'Ni dovolj kategoriziranih podatkov — Market Intelligence Engine ni mogoč.',
      } satisfies MarketIntelligenceResponse);
    }

    // 4) Compute deterministic key findings, opportunities, threats, strategic, overview
    const extras = buildDeterministicExtras(topCategories, listings.length);

    // 5) AI cache check (6h TTL) — key by current week
    const cacheKey = `market-intelligence:${currentWeekKey()}`;
    const cached = getCachedAI<{
      marketOverview: string;
      keyFindings: KeyFinding[];
      opportunities: Opportunity[];
      threats: Threat[];
      categoryIntelligence: CategoryIntelligence[];
      strategicRecommendation: StrategicRecommendation;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        marketOverview: cached.marketOverview,
        keyFindings: cached.keyFindings,
        opportunities: cached.opportunities,
        threats: cached.threats,
        categoryIntelligence: cached.categoryIntelligence,
        strategicRecommendation: cached.strategicRecommendation,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies MarketIntelligenceResponse);
    }

    // 6) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(topCategories, catMap, extras);

    let marketOverview = extras.deterministicOverview;
    let keyFindings = extras.deterministicFindings;
    let opportunities = extras.deterministicOpportunities;
    let threats = extras.deterministicThreats;
    let categoryIntelligence = topCategories;
    let strategicRecommendation = extras.deterministicStrategic;
    let summary = extras.deterministicOverview;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiIntelligenceResponse | null;

      const transformed = transformAiResponse(parsed, extras, topCategories);
      if (transformed) {
        marketOverview = transformed.marketOverview;
        keyFindings = transformed.keyFindings;
        opportunities = transformed.opportunities;
        threats = transformed.threats;
        categoryIntelligence = transformed.categoryIntelligence;
        strategicRecommendation = transformed.strategicRecommendation;
        summary = transformed.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-intelligence-engine',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        marketOverview,
        keyFindings,
        opportunities,
        threats,
        categoryIntelligence,
        strategicRecommendation,
        summary,
      });
    }

    return apiOk({
      ok: true,
      marketOverview,
      keyFindings,
      opportunities,
      threats,
      categoryIntelligence,
      strategicRecommendation,
      summary,
      aiUsed,
    } satisfies MarketIntelligenceResponse);
  },
});

export const GET = marketIntelligenceHandler;
export const POST = marketIntelligenceHandler;
