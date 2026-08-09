// v7.96: AI Market Opportunity Maximizer — AI identifies THE SINGLE BEST
// profit opportunity in the market RIGHT NOW — kombinira VSE market
// signals (gaps, demand, depth, trends, cycle, volatility) da pinpoint-a
// kje je MAXIMUM profit achievable. The "ultimate profit opportunity
// finder."
//
// Razlika od market-opportunity-scanner (basic listing-level scanner)
// — ta je CATEGORY-LEVEL analysis z COMPOSITE SCORE iz 6 dimensions.
// Razlika od market-gap-finder (ki najde supply-demand gaps) — ta
// KOMBINIRA 6 signals (gap + demand + depth + trend + cycle + volatility)
// za ULTIMATE opportunity score. Razlika od market-trend-forecaster-pro
// (ki napove trend) — ta identificira KATERA kategorija je najbolj
// profitabilna ZDAJ. Razlika od market-cycle-detector (ki detektira
// cycle phase) — ta kombinira cycle z 5 drugimi signals. Razlika od
// market-depth-analyzer (ki gleda liquidity) — ta gleda DEPTH + 5 drugih.
// Razlika od price-volatility-analyzer (ki gleda volatilnost) — ta
// gleda volatilnost kot ENO od 6 dimenzij. Razlika od inventory-
// opportunity-scanner (ki scan-a inventory) — ta scan-a MARKET (ne
// inventory).
//
// "Top opportunity: elektronika (score 87/100, expected profit 450€,
// confidence 85%). Why now: demand/supply gap +12%, sell-through 78%,
// bullish trend, mid-cycle. Execute: list 3-5 PS5 units at 380-400€.
// Time window: 14 dni. Risk: Volatility 22% — A/B test prices."
//
// GET+POST /api/ai/market-opportunity-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

interface TopOpportunity {
  category: string;
  opportunityScore: number; // 0-100
  expectedProfit: number; // €
  confidenceLevel: number; // 0-100
  whyNow: string;
  howToExecute: string[];
  timeWindow: string;
  riskFactors: Array<{ risk: string; mitigation: string }>;
}

interface Top5Entry {
  rank: number;
  category: string;
  opportunityScore: number;
  expectedProfit: number;
  keyDriver: string;
}

interface OpportunityComparison {
  category: string;
  gapScore: number;
  demandScore: number;
  depthScore: number;
  trendScore: number;
  cycleScore: number;
  volatilityScore: number;
  compositeScore: number;
}

interface ProfitStrategy {
  profitMaximizationStrategy: string;
  capitalAllocation: { amount: number; category: string; expectedROI: number };
  expectedTimeline: string;
}

interface MarketOpportunityResponse {
  ok: true;
  topOpportunity: TopOpportunity;
  top5Opportunities: Top5Entry[];
  opportunityComparison: OpportunityComparison[];
  profitStrategy: ProfitStrategy;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  topOpportunity?: {
    category?: string;
    opportunityScore?: number;
    expectedProfit?: number;
    confidenceLevel?: number;
    whyNow?: string;
    howToExecute?: string[];
    timeWindow?: string;
    riskFactors?: Array<{ risk?: string; mitigation?: string }>;
  };
  top5Opportunities?: Array<{
    rank?: number;
    category?: string;
    opportunityScore?: number;
    expectedProfit?: number;
    keyDriver?: string;
  }>;
  profitStrategy?: {
    profitMaximizationStrategy?: string;
    capitalAllocation?: { amount?: number; category?: string; expectedROI?: number };
    expectedTimeline?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_30D = 30 * DAY_MS;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 50_000;
const CONF_MIN = 0;
const CONF_MAX = 100;
const ROI_MIN = 0;
const ROI_MAX = 500;
const AMOUNT_MIN = 0;
const AMOUNT_MAX = 100_000;

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function round0(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Linear regression slope
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// Coefficient of variation
function coeffVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  if (m === 0) return 0;
  const variance = values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance) / Math.abs(m);
}

// --- DB row types --------------------------------------------------------

interface ListingRow {
  id: string;
  price: number | null;
  firstSeenAt: Date;
  aiEstimatedValue: number | null;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  dealScore: number | null;
  isBookmarked: boolean;
  priceDroppedAt: Date | null;
  monitor: { tags: string; source: string } | null;
}

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  sellPrice: number | null;
  sellDate: Date | null;
  category: string;
}

// --- Per-category opportunity scoring -----------------------------------

interface CategoryMetrics {
  category: string;
  listingCount: number;
  avgPrice: number;
  avgEstValue: number;
  bookmarkCount: number;
  priceDropCount: number;
  soldCount: number;
  totalSalesValue: number;
  avgSellPrice: number;
  // Computed scores
  gapScore: number; // 0-100 — demand/supply gap
  demandScore: number; // 0-100 — sell-through rate
  depthScore: number; // 0-100 — market liquidity
  trendScore: number; // 0-100 — price/volume trend
  cycleScore: number; // 0-100 — where in cycle (50 = mid, >50 = expansion)
  volatilityScore: number; // 0-100 — price stability (higher = more volatile)
  compositeScore: number; // 0-100 weighted composite
}

function computeCategoryMetrics(
  category: string,
  listings: ListingRow[],
  soldTrades: SoldTradeRow[],
  now: number,
  firstSeenBuckets: Map<string, number[]>, // weekly buckets of new listing counts per category
): CategoryMetrics {
  const listingCount = listings.length;
  const prices = listings.map((l) => l.price ?? 0).filter((p) => p > 0);
  const estValues = listings.map((l) => l.aiEstimatedValue ?? 0).filter((v) => v > 0);
  const avgPrice = prices.length > 0 ? avg(prices) : 0;
  const avgEstValue = estValues.length > 0 ? avg(estValues) : 0;
  const bookmarkCount = listings.filter((l) => l.isBookmarked).length;
  const priceDropCount = listings.filter((l) => l.priceDroppedAt !== null).length;

  // Sold trades for this category
  const catSold = soldTrades.filter((t) => (t.category || 'drugo').trim().toLowerCase() === category);
  const soldCount = catSold.length;
  const salesValues = catSold.map((t) => t.sellPrice ?? 0).filter((p) => p > 0);
  const totalSalesValue = salesValues.reduce((s, v) => s + v, 0);
  const avgSellPrice = salesValues.length > 0 ? avg(salesValues) : 0;

  // === GAP SCORE: demand/supply ratio ===
  // demand = sold count (recent demand), supply = current listings (available inventory)
  // High ratio = high demand vs supply = opportunity
  const demandSupplyRatio = listingCount > 0 ? soldCount / Math.max(1, listingCount) : 0;
  // If soldCount > 0 but listingCount small → high gap (sellers market)
  // If listingCount big but soldCount = 0 → low gap (buyers market, oversupply)
  let gapScore: number;
  if (soldCount === 0 && listingCount === 0) {
    gapScore = 0;
  } else if (soldCount === 0) {
    // No demand signals — low gap unless extremely low supply
    gapScore = listingCount < 5 ? 30 : 10;
  } else {
    // Higher ratio = higher score, capped at 100
    // ratio of 1+ means sold ≥ listed (sellers market)
    gapScore = round0(clampNum(demandSupplyRatio * 60, SCORE_MIN, SCORE_MAX, 30));
    // Boost if bookmarked (demand signals)
    gapScore = round0(clampNum(gapScore + bookmarkCount * 5, SCORE_MIN, SCORE_MAX, gapScore));
  }

  // === DEMAND SCORE: sell-through rate ===
  // sell-through = sold / (sold + listed) — higher = stronger demand
  const totalPool = soldCount + listingCount;
  const sellThroughRate = totalPool > 0 ? soldCount / totalPool : 0;
  // Map 0-1 sellThrough to 0-100 score (with bookmark as demand indicator)
  let demandScore = round0(clampNum(
    sellThroughRate * 100 + (bookmarkCount > 0 ? Math.min(20, bookmarkCount * 4) : 0),
    SCORE_MIN, SCORE_MAX, 0,
  ));
  if (demandScore === 0 && bookmarkCount > 0) {
    demandScore = round0(clampNum(bookmarkCount * 6, SCORE_MIN, SCORE_MAX, 10));
  }

  // === DEPTH SCORE: market liquidity ===
  // More listings = more liquid = higher depth score
  // Also if multiple price points exist, depth is higher
  const uniquePricePoints = new Set(prices.map((p) => Math.floor(p / 50))).size;
  let depthScore: number;
  if (listingCount >= 50) depthScore = 90;
  else if (listingCount >= 30) depthScore = 75;
  else if (listingCount >= 15) depthScore = 60;
  else if (listingCount >= 8) depthScore = 45;
  else if (listingCount >= 3) depthScore = 30;
  else if (listingCount >= 1) depthScore = 15;
  else depthScore = 0;
  // Bonus for diverse price points
  depthScore = round0(clampNum(depthScore + Math.min(15, uniquePricePoints * 3), SCORE_MIN, SCORE_MAX, depthScore));

  // === TREND SCORE: price/volume trend direction ===
  // Use firstSeenBuckets to detect volume trend (more new listings = activity)
  const buckets = firstSeenBuckets.get(category) ?? [];
  const volumeSlope = trendSlope(buckets);
  // Use avgSellPrice vs avgPrice trend (sellers getting higher prices = bullish)
  const priceTrend = avgSellPrice > 0 && avgPrice > 0
    ? (avgSellPrice - avgPrice) / avgPrice
    : 0;
  // Combined trend: 50% volume trend + 50% price trend
  // Normalize: slope > 0 → bullish (>50); slope < 0 → bearish (<50)
  const volumeTrendNorm = clampNum(50 + volumeSlope * 20, 0, 100, 50);
  const priceTrendNorm = clampNum(50 + priceTrend * 100, 0, 100, 50);
  const trendScore = round0(clampNum(volumeTrendNorm * 0.5 + priceTrendNorm * 0.5, SCORE_MIN, SCORE_MAX, 50));

  // === CYCLE SCORE: where in market cycle ===
  // Use price drop ratio + sell-through as cycle indicator
  // High price drops + low sell-through = late cycle / oversupply
  // Low price drops + high sell-through = early cycle / expansion
  const priceDropRate = listingCount > 0 ? priceDropCount / listingCount : 0;
  const cycleIndicator = sellThroughRate - priceDropRate; // positive = expansion
  // Map to 0-100 where 50 = mid-cycle, >50 = expansion, <50 = contraction
  const cycleScore = round0(clampNum(50 + cycleIndicator * 100, SCORE_MIN, SCORE_MAX, 50));

  // === VOLATILITY SCORE: price stability (higher = more volatile) ===
  // CV of prices → 0 = stable, 1+ = very volatile
  const priceCV = prices.length >= 2 ? coeffVariation(prices) : 0;
  // Map: CV 0 → 0, CV 0.5 → 50, CV 1 → 100
  const volatilityScore = round0(clampNum(priceCV * 100, SCORE_MIN, SCORE_MAX, 0));

  // === COMPOSITE SCORE ===
  // Weighted average: gap 25% + demand 25% + depth 10% + trend 15% + cycle 15% + volatility 10%
  // Note: high volatility is BAD (less predictable), so invert: 100 - volatilityScore
  const volatilityStability = 100 - volatilityScore;
  const compositeScore = round0(clampNum(
    gapScore * 0.25 +
    demandScore * 0.25 +
    depthScore * 0.10 +
    trendScore * 0.15 +
    cycleScore * 0.15 +
    volatilityStability * 0.10,
    SCORE_MIN, SCORE_MAX, 0,
  ));

  return {
    category,
    listingCount,
    avgPrice: round0(avgPrice),
    avgEstValue: round0(avgEstValue),
    bookmarkCount,
    priceDropCount,
    soldCount,
    totalSalesValue: round0(totalSalesValue),
    avgSellPrice: round0(avgSellPrice),
    gapScore,
    demandScore,
    depthScore,
    trendScore,
    cycleScore,
    volatilityScore,
    compositeScore,
  };
}

// --- Deterministic top opportunity --------------------------------------

function buildDeterministicTopOpportunity(m: CategoryMetrics): TopOpportunity {
  // Expected profit: estimated from avg margin per sale × projected sales in next 30d
  const avgMarginPerSale = m.avgSellPrice > 0 && m.avgPrice > 0
    ? Math.max(0, m.avgSellPrice - m.avgPrice)
    : (m.avgEstValue > 0 ? m.avgEstValue * 0.2 : 30);
  // Project 5-10 sales in 30d based on demand score
  const projectedSales = Math.max(1, Math.round((m.demandScore / 100) * 10));
  const expectedProfit = round0(
    clampNum(avgMarginPerSale * projectedSales, PROFIT_MIN, PROFIT_MAX, 100),
  );

  // Confidence: based on data quality (sample size + low volatility)
  const dataQuality = Math.min(100, m.listingCount * 5 + m.soldCount * 10);
  const stability = 100 - m.volatilityScore;
  const confidenceLevel = round0(clampNum(
    dataQuality * 0.5 + stability * 0.3 + m.demandScore * 0.2,
    CONF_MIN, CONF_MAX, 50,
  ));

  // whyNow
  const whyNowParts: string[] = [];
  if (m.gapScore > 60) whyNowParts.push(`demand/supply gap je visok (${m.gapScore}/100)`);
  if (m.demandScore > 60) whyNowParts.push(`sell-through rate ${m.demandScore}/100`);
  if (m.trendScore > 55) whyNowParts.push(`trend je bullish (${m.trendScore}/100)`);
  if (m.cycleScore > 55) whyNowParts.push(`v expansion fazi cycle-a (${m.cycleScore}/100)`);
  if (whyNowParts.length === 0) {
    whyNowParts.push(`composite score ${m.compositeScore}/100 je relativno visok glede na druge kategorije`);
  }
  const whyNow = whyNowParts.join(', ').slice(0, 400);

  // howToExecute
  const howToExecute: string[] = [];
  if (m.avgPrice > 0) {
    howToExecute.push(`Source 3-5 items v ${m.category} pri ~${round0(m.avgPrice * 0.8)}€ (undercut current avg).`);
  } else {
    howToExecute.push(`Source 3-5 items v ${m.category} kategoriji.`);
  }
  if (m.avgSellPrice > 0) {
    howToExecute.push(`List-aj pri ~${round0(m.avgSellPrice * 0.95)}€ (5% pod avg sell price za hitro prodajo).`);
  } else if (m.avgEstValue > 0) {
    howToExecute.push(`List-aj pri ~${round0(m.avgEstValue * 0.95)}€ (5% pod estValue za hitro prodajo).`);
  }
  howToExecute.push(`Cross-postaj na Bolha + Vinted + Facebook za max reach.`);
  howToExecute.push(`A/B test prices v 5% korakih za optimizacijo konverzije.`);

  // timeWindow: based on demand + trend
  const timeWindowDays = m.demandScore > 70 ? 7 : m.demandScore > 50 ? 14 : 21;
  const timeWindow = `${timeWindowDays} dni`;

  // riskFactors
  const riskFactors: Array<{ risk: string; mitigation: string }> = [];
  if (m.volatilityScore > 50) {
    riskFactors.push({
      risk: `Visoka volatilnost cen (${m.volatilityScore}/100) — napake v pricing-u verjetne.`,
      mitigation: 'A/B test prices v 5% korakih, postavi tight stop-loss.',
    });
  }
  if (m.depthScore < 40) {
    riskFactors.push({
      risk: `Plitak market (${m.depthScore}/100) — težje prodati pri target ceni.`,
      mitigation: 'Postavi nižje starting prices in postopno povišuj.',
    });
  }
  if (m.trendScore < 40) {
    riskFactors.push({
      risk: `Bearish trend (${m.trendScore}/100) — cene bodo morda padale.`,
      mitigation: 'Hitra prodaja, ne zadržuj inventorija predolgo.',
    });
  }
  if (m.cycleScore < 40) {
    riskFactors.push({
      risk: `V contraction fazi cycle-a (${m.cycleScore}/100) — povpraševanje se zmanjšuje.`,
      mitigation: 'Zmanjšaj inventory exposure, počakaj na naslednji expansion.',
    });
  }
  if (riskFactors.length === 0) {
    riskFactors.push({
      risk: 'Market lahko reagira na nepričakovane dogodke (sezone, dogodki).',
      mitigation: 'Spremljaj trend weekly in adjust-aj strategijo.',
    });
  }

  return {
    category: m.category,
    opportunityScore: m.compositeScore,
    expectedProfit,
    confidenceLevel,
    whyNow,
    howToExecute: howToExecute.map((s) => s.slice(0, 200)),
    timeWindow,
    riskFactors: riskFactors.slice(0, 3).map((r) => ({
      risk: r.risk.slice(0, 200),
      mitigation: r.mitigation.slice(0, 200),
    })),
  };
}

function buildDeterministicTop5(metrics: CategoryMetrics[]): Top5Entry[] {
  const sorted = [...metrics].sort((a, b) => b.compositeScore - a.compositeScore);
  return sorted.slice(0, 5).map((m, idx) => {
    const avgMargin = m.avgSellPrice > 0 && m.avgPrice > 0
      ? Math.max(0, m.avgSellPrice - m.avgPrice)
      : (m.avgEstValue > 0 ? m.avgEstValue * 0.2 : 30);
    const projectedSales = Math.max(1, Math.round((m.demandScore / 100) * 8));
    const expectedProfit = round0(clampNum(avgMargin * projectedSales, PROFIT_MIN, PROFIT_MAX, 50));
    let keyDriver: string;
    if (m.gapScore >= m.demandScore && m.gapScore >= m.trendScore) keyDriver = `gap ${m.gapScore}/100 (sellers market)`;
    else if (m.demandScore >= m.trendScore) keyDriver = `demand ${m.demandScore}/100 (high sell-through)`;
    else keyDriver = `trend ${m.trendScore}/100 (bullish)`;
    return {
      rank: idx + 1,
      category: m.category,
      opportunityScore: m.compositeScore,
      expectedProfit,
      keyDriver: keyDriver.slice(0, 80),
    };
  });
}

function buildDeterministicProfitStrategy(top: TopOpportunity, metrics: CategoryMetrics[]): ProfitStrategy {
  const topM = metrics.find((m) => m.category === top.category) ?? metrics[0];
  // Capital allocation: 30-50% of expected profit
  const capitalAmount = round0(clampNum(top.expectedProfit * 0.4, AMOUNT_MIN, AMOUNT_MAX, 500));
  const expectedROI = topM && topM.avgPrice > 0 && topM.avgSellPrice > 0
    ? round0(clampNum(
      ((topM.avgSellPrice - topM.avgPrice) / topM.avgPrice) * 100,
      ROI_MIN, ROI_MAX, 50,
    ))
    : round0(clampNum(top.expectedProfit / Math.max(1, capitalAmount) * 100, ROI_MIN, ROI_MAX, 100));

  const profitMaximizationStrategy = `Maximiziraj profit v "${top.category}" kategoriji z ${capitalAmount}€ capital allocation. Source 3-5 items pod avg ceno, list-aj z 5% popustom za hitro prodajo, cross-postaj na 3+ platforme. A/B test prices za optimalno ravnovesje med profitom in sell-through rate. Reinvestiraj profit v top-3 kategorije za compounding growth.`.slice(0, 500);

  return {
    profitMaximizationStrategy,
    capitalAllocation: {
      amount: capitalAmount,
      category: top.category,
      expectedROI,
    },
    expectedTimeline: top.timeWindow,
  };
}

function buildSummary(top: TopOpportunity, strategy: ProfitStrategy): string {
  const parts: string[] = [
    `Top opportunity: ${top.category} (score ${top.opportunityScore}/100, expected profit ${top.expectedProfit}€, confidence ${top.confidenceLevel}%).`,
    `Capital allocation: ${strategy.capitalAllocation.amount}€ → ${top.category} (ROI ${strategy.capitalAllocation.expectedROI}%).`,
    `Time window: ${top.timeWindow}.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketOpportunityMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleMarketOpportunityMaximizer(req);
}

async function handleMarketOpportunityMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-opportunity-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff30d = new Date(now - HORIZON_30D);
    const cutoff12m = new Date(now - 365 * DAY_MS);

    // 1) Query listings from last 30 days
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff30d },
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        aiEstimatedValue: true,
        aiScore: true,
        aiRisk: true,
        aiVerdict: true,
        dealScore: true,
        isBookmarked: true,
        priceDroppedAt: true,
        monitor: { select: { tags: true, source: true } },
      },
      take: 100000,
    }) as unknown as ListingRow[];

    // 2) Query SOLD trades from last 12 months (for sell-through rate)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        id: true,
        buyPrice: true,
        sellPrice: true,
        sellDate: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no listings + no sold trades
    if (listings.length === 0 && soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        topOpportunity: {
          category: 'drugo',
          opportunityScore: 0,
          expectedProfit: 0,
          confidenceLevel: 0,
          whyNow: 'Ni dovolj podatkov za opportunity analysis.',
          howToExecute: [],
          timeWindow: '—',
          riskFactors: [],
        },
        top5Opportunities: [],
        opportunityComparison: [],
        profitStrategy: {
          profitMaximizationStrategy: 'Ni dovolj podatkov za profit maximization strategijo.',
          capitalAllocation: { amount: 0, category: 'drugo', expectedROI: 0 },
          expectedTimeline: '—',
        },
        summary: 'Ni listingov v zadnjih 30 dneh in SOLD trgovin v 12 mesecih — Market Opportunity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni listingov v zadnjih 30 dneh in SOLD trgovin v 12 mesecih — Market Opportunity Maximizer ni mogoč.',
      } satisfies MarketOpportunityResponse);
    }

    // 3) Group listings by category (derive from monitor.tags or default 'drugo')
    const listingsByCategory = new Map<string, ListingRow[]>();
    const firstSeenBuckets = new Map<string, number[]>(); // weekly buckets per category
    const weekMs = 7 * DAY_MS;
    for (const l of listings) {
      const tags = l.monitor?.tags ?? '';
      const tagList = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      const category = tagList[0] ?? 'drugo';
      const arr = listingsByCategory.get(category) ?? [];
      arr.push(l);
      listingsByCategory.set(category, arr);
      // Weekly bucket for trend analysis (last 4 weeks)
      const weekIdx = Math.floor((now - toMs(l.firstSeenAt)) / weekMs);
      const buckets = firstSeenBuckets.get(category) ?? [0, 0, 0, 0]; // week0=now, week3=oldest
      const idx = 3 - Math.max(0, Math.min(3, weekIdx));
      buckets[idx] = (buckets[idx] ?? 0) + 1;
      firstSeenBuckets.set(category, buckets);
    }

    // 4) Compute per-category metrics
    const allCategories = new Set<string>([
      ...listingsByCategory.keys(),
      ...soldTrades.map((t) => (t.category || 'drugo').trim().toLowerCase() || 'drugo'),
    ]);
    const metrics: CategoryMetrics[] = [];
    for (const cat of allCategories) {
      const catListings = listingsByCategory.get(cat) ?? [];
      const m = computeCategoryMetrics(cat, catListings, soldTrades, now, firstSeenBuckets);
      metrics.push(m);
    }
    // Sort by composite score desc
    metrics.sort((a, b) => b.compositeScore - a.compositeScore);

    // 5) Build deterministic baseline (fallback)
    const topMetric = metrics[0];
    if (!topMetric) {
      // All categories were empty
      return NextResponse.json({
        ok: true,
        topOpportunity: {
          category: 'drugo',
          opportunityScore: 0,
          expectedProfit: 0,
          confidenceLevel: 0,
          whyNow: 'Ni dovolj podatkov.',
          howToExecute: [],
          timeWindow: '—',
          riskFactors: [],
        },
        top5Opportunities: [],
        opportunityComparison: [],
        profitStrategy: {
          profitMaximizationStrategy: 'Ni dovolj podatkov.',
          capitalAllocation: { amount: 0, category: 'drugo', expectedROI: 0 },
          expectedTimeline: '—',
        },
        summary: 'Ni kategorij z dovolj podatki — Market Opportunity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni kategorij z dovolj podatki — Market Opportunity Maximizer ni mogoč.',
      } satisfies MarketOpportunityResponse);
    }

    let topOpportunity = buildDeterministicTopOpportunity(topMetric);
    const detTop5 = buildDeterministicTop5(metrics);
    let top5Opportunities: Top5Entry[] = detTop5;
    const opportunityComparison: OpportunityComparison[] = metrics.map((m) => ({
      category: m.category,
      gapScore: m.gapScore,
      demandScore: m.demandScore,
      depthScore: m.depthScore,
      trendScore: m.trendScore,
      cycleScore: m.cycleScore,
      volatilityScore: m.volatilityScore,
      compositeScore: m.compositeScore,
    }));
    let profitStrategy = buildDeterministicProfitStrategy(topOpportunity, metrics);
    let summary = buildSummary(topOpportunity, profitStrategy);

    // 6) AI cache check (6h TTL) — key by current week
    const currentWeek = new Date(now).toISOString().slice(0, 8) + '-w' + Math.floor((now / weekMs));
    const cacheKey = `market-opportunity-maximizer:${currentWeek}`;
    const cached = getCachedAI<{
      topOpportunity: TopOpportunity;
      top5Opportunities: Top5Entry[];
      profitStrategy: ProfitStrategy;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        topOpportunity: cached.topOpportunity,
        top5Opportunities: cached.top5Opportunities,
        opportunityComparison,
        profitStrategy: cached.profitStrategy,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies MarketOpportunityResponse);
    }

    // 7) AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Compact context for AI (top 15 categories by composite score)
    const topMetricsForAI = metrics.slice(0, 15).map((m) => ({
      category: m.category,
      listingCount: m.listingCount,
      avgPrice: m.avgPrice,
      avgEstValue: m.avgEstValue,
      bookmarkCount: m.bookmarkCount,
      soldCount: m.soldCount,
      avgSellPrice: m.avgSellPrice,
      gapScore: m.gapScore,
      demandScore: m.demandScore,
      depthScore: m.depthScore,
      trendScore: m.trendScore,
      cycleScore: m.cycleScore,
      volatilityScore: m.volatilityScore,
      compositeScore: m.compositeScore,
    }));

    const promptData = {
      topCategories: topMetricsForAI,
      deterministicTopOpportunity: topOpportunity,
      deterministicTop5: detTop5,
      deterministicProfitStrategy: profitStrategy,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        confMin: CONF_MIN, confMax: CONF_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        amountMin: AMOUNT_MIN, amountMax: AMOUNT_MAX,
      },
    };

    const prompt = `Si AI "Market Opportunity Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si "ultimate profit opportunity finder" — identificiraš SINGLE BEST profit opportunity v market RIGHT NOW z kombinacijo VSEH market signals (gaps, demand, depth, trends, cycle, volatility). Razlika od market-opportunity-scanner (basic listing-level scanner) — ti si CATEGORY-LEVEL analysis z COMPOSITE SCORE iz 6 dimensions. Razlika od market-gap-finder (ki najde supply-demand gaps) — ti KOMBINIRAŠ 6 signals za ULTIMATE opportunity score. Razlika od market-trend-forecaster-pro (ki napove trend) — ti identificiraš KATERA kategorija je najbolj profitabilna ZDAJ.

DETERMINISTIČNI PODATKI (izračunano iz DB — listings last 30 days + SOLD 12m grouped by category):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. topOpportunity: SINGLE BEST opportunity right now:
   - category (string, MORA biti ena iz topCategories — anti-hallucination),
   - opportunityScore [0, 100] (±10 od deterministic compositeScore),
   - expectedProfit € [0, 50000] (±20% od deterministic),
   - confidenceLevel [0, 100] (±10 od deterministic),
   - whyNow (max 400, slovenski — zakaj je to najboljši timing),
   - howToExecute: 3-5 specifičnih korakov (max 200 each, slovenski — kako izkoristiti),
   - timeWindow (max 50, slovenski — koliko časa bo trajala opportunity),
   - riskFactors: 2-3 { risk (max 200, slovenski), mitigation (max 200, slovenski) }.
2. top5Opportunities: ranked 5 opportunities { rank 1-5 (MORA match-at vrstni red po compositeScore desc), category, opportunityScore [0, 100], expectedProfit € [0, 50000], keyDriver (max 80, slovenski) }.
3. profitStrategy:
   - profitMaximizationStrategy (max 500, slovenski — kako izvleči max profit iz top opportunity),
   - capitalAllocation: { amount € [0, 100000], category (topOpportunity.category), expectedROI [0, 500] % },
   - expectedTimeline (max 100, slovenski).
4. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "topOpportunity": {
    "category": "elektronika",
    "opportunityScore": 87,
    "expectedProfit": 450,
    "confidenceLevel": 85,
    "whyNow": "Demand/supply gap +12%, sell-through 78%, bullish trend, mid-cycle.",
    "howToExecute": ["Source 3-5 PS5 enot pri ~300€.", "List-aj pri ~380€ (5% pod avg sell).", "Cross-postaj na Bolha+Vinted+FB."],
    "timeWindow": "14 dni",
    "riskFactors": [
      { "risk": "Volatility 22% — A/B test prices.", "mitigation": "5% koraki, tight stop-loss." }
    ]
  },
  "top5Opportunities": [
    { "rank": 1, "category": "elektronika", "opportunityScore": 87, "expectedProfit": 450, "keyDriver": "gap 75/100 (sellers market)" }
  ],
  "profitStrategy": {
    "profitMaximizationStrategy": "Maximiziraj profit z 1500€ capital allocation...",
    "capitalAllocation": { "amount": 1500, "category": "elektronika", "expectedROI": 130 },
    "expectedTimeline": "14 dni do prve prodaje, 30 dni do popolne realizacije"
  },
  "summary": "Top opportunity: elektronika (score 87/100, expected profit 450€, confidence 85%). Capital: 1500€ → elektronika (ROI 130%). Time: 14 dni."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Validate topOpportunity.category against known categories (anti-hallucination)
        const knownCategories = new Set(metrics.map((m) => m.category));
        const aiTop = parsed.topOpportunity ?? {};
        const aiCategory = clampString(aiTop.category, 50, topOpportunity.category).toLowerCase();
        const validCategory = knownCategories.has(aiCategory) ? aiCategory : topOpportunity.category;

        // Find the metric for the chosen category
        const chosenMetric = metrics.find((m) => m.category === validCategory) ?? topMetric;

        // Re-derive deterministic baseline for the chosen category if different
        const detTop = validCategory === topOpportunity.category
          ? topOpportunity
          : buildDeterministicTopOpportunity(chosenMetric);

        const opportunityScore = round0(clampNum(
          aiTop.opportunityScore, SCORE_MIN, SCORE_MAX, detTop.opportunityScore,
        ));
        const expectedProfit = round0(clampNum(
          aiTop.expectedProfit, PROFIT_MIN, PROFIT_MAX, detTop.expectedProfit,
        ));
        const confidenceLevel = round0(clampNum(
          aiTop.confidenceLevel, CONF_MIN, CONF_MAX, detTop.confidenceLevel,
        ));
        const whyNow = clampString(aiTop.whyNow, 400, detTop.whyNow);
        const howToExecute: string[] = Array.isArray(aiTop.howToExecute)
          ? aiTop.howToExecute.slice(0, 5).map((s) => clampString(s, 200, 'Source items pod avg ceno.'))
          : detTop.howToExecute;
        if (howToExecute.length === 0) howToExecute.push(...detTop.howToExecute);
        const timeWindow = clampString(aiTop.timeWindow, 50, detTop.timeWindow);
        const riskFactors: Array<{ risk: string; mitigation: string }> = Array.isArray(aiTop.riskFactors)
          ? aiTop.riskFactors.slice(0, 3).map((r) => ({
              risk: clampString(r?.risk, 200, 'Market tveganje.'),
              mitigation: clampString(r?.mitigation, 200, 'Testiraj postopoma.'),
            }))
          : detTop.riskFactors;
        if (riskFactors.length === 0) riskFactors.push(...detTop.riskFactors);

        topOpportunity = {
          category: validCategory,
          opportunityScore,
          expectedProfit,
          confidenceLevel,
          whyNow,
          howToExecute,
          timeWindow,
          riskFactors,
        };

        // top5Opportunities
        const aiTop5: Top5Entry[] = [];
        if (Array.isArray(parsed.top5Opportunities)) {
          for (const t of parsed.top5Opportunities.slice(0, 5)) {
            if (!t || typeof t !== 'object') continue;
            const cat = clampString(t.category, 50, 'drugo').toLowerCase();
            if (!knownCategories.has(cat)) continue; // skip unknown — anti-hallucination
            aiTop5.push({
              rank: round0(clampNum(t.rank, 1, 5, aiTop5.length + 1)),
              category: cat,
              opportunityScore: round0(clampNum(t.opportunityScore, SCORE_MIN, SCORE_MAX, 0)),
              expectedProfit: round0(clampNum(t.expectedProfit, PROFIT_MIN, PROFIT_MAX, 0)),
              keyDriver: clampString(t.keyDriver, 80, 'composite score visok'),
            });
          }
        }
        if (aiTop5.length === 0) {
          for (const t of detTop5) aiTop5.push(t);
        } else {
          // Sort by rank and ensure ranks are sequential 1..N
          aiTop5.sort((a, b) => a.rank - b.rank);
          aiTop5.forEach((t, i) => { t.rank = i + 1; });
        }
        top5Opportunities = aiTop5;

        // profitStrategy
        const aiPs = parsed.profitStrategy ?? {};
        const capitalAllocation = {
          amount: round0(clampNum(
            aiPs.capitalAllocation?.amount,
            AMOUNT_MIN, AMOUNT_MAX,
            profitStrategy.capitalAllocation.amount,
          )),
          category: topOpportunity.category,
          expectedROI: round0(clampNum(
            aiPs.capitalAllocation?.expectedROI,
            ROI_MIN, ROI_MAX,
            profitStrategy.capitalAllocation.expectedROI,
          )),
        };
        const profitMaximizationStrategy = clampString(
          aiPs.profitMaximizationStrategy, 500, profitStrategy.profitMaximizationStrategy,
        );
        const expectedTimeline = clampString(
          aiPs.expectedTimeline, 100, profitStrategy.expectedTimeline,
        );
        profitStrategy = {
          profitMaximizationStrategy,
          capitalAllocation,
          expectedTimeline,
        };
        summary = clampString(parsed.summary, 400, buildSummary(topOpportunity, profitStrategy));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-opportunity-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { topOpportunity, top5Opportunities, profitStrategy, summary });
    }

    return NextResponse.json({
      ok: true,
      topOpportunity,
      top5Opportunities,
      opportunityComparison,
      profitStrategy,
      summary,
      aiUsed,
    } satisfies MarketOpportunityResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/market-opportunity-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
