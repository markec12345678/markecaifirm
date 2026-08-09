// v7.98: AI Deal Quality Profit Optimizer — AI identificira RELATIONSHIP med
// deal quality scores in actual profit — kateri quality range-i produkujejo
// največ profit-a? Priporoči katere quality deals-a追求 za maximum profit.
// The "ultimate deal-quality → profit optimizer."
//
// Razlika od deal-quality-forecaster (v7.96 ki napove deal quality) — ta
// RELATES quality → actual profit in optimira sourcing za max profit. Razlika od
// deal-quality-distribution-analyzer (ki analizira quality distribution) — ta
// MAXIMIZIRA profit iz quality ranges z actionable filtering advice. Razlika od
// deal-quality-trend-analyzer (ki track-a quality trend) — ta daje quality →
// profit correlation + optimal range targeting. Razlika od deal-quality-
// scorecard (ki scor-a deals) — ta optimira KATERI quality range ciljati za
// max profit. Razlika od deal-quality-distribution-forecaster (ki napove
// quality distribution) — ta daje PER-RANGE profit optimization. Razlika od
// profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers) — ta
// fokusira na QUALITY-PROFIT correlation (ne splošen profit maximization).
// Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira per-source) —
// ta maksimizira per-QUALITY-RANGE (ne per-source). Razlika od profit-velocity-
// maximizer (v7.98 ki maksimizira velocity) — ta maksimizira per-quality profit
// (ne velocity). Razlika od inventory-cash-conversion-maximizer (v7.98 ki
// maksimizira cash conversion) — ta maksimizira quality-profit filtering.
//
// "Deals z dealScore 60-80 produce 78% of total profit (avg 145€, ROI 92%,
// winRate 84%). Optimal range: 60-80 → projected 4,800€ (+1,200€ uplift).
// Min dealScore filter: 55. Risk: too-high-only filter → 60% lower volume.
// Diversification: 80% deals v 60-80 range, 20% v 80-100 range."
//
// GET+POST /api/ai/deal-quality-profit-optimizer
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

type QualityProfitCorrelation =
  | 'STRONG_POSITIVE'
  | 'WEAK_POSITIVE'
  | 'NONE'
  | 'NEGATIVE';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  listing: {
    dealScore: number | null;
  } | null;
}

interface QualityBucket {
  range: string; // "0-20", "20-40", ...
  avgProfit: number;
  avgROI: number; // %
  winRate: number; // 0-100 %
  tradeCount: number;
  totalProfit: number;
  profitPerDeal: number;
}

interface QualityAnalysis {
  qualityBuckets: QualityBucket[];
  mostProfitableRange: string; // by totalProfit
  bestROIRange: string;
  bestWinRateRange: string;
  qualityProfitCorrelation: QualityProfitCorrelation;
}

interface QualityFilterRecommendation {
  minDealScore: number; // 0-100
  reasoning: string;
}

interface QualityRiskEntry {
  risk: string;
  mitigation: string;
}

interface QualityOptimization {
  optimalQualityRange: string;
  qualityProfitStrategy: string;
  qualityFilterRecommendation: QualityFilterRecommendation;
  projectedProfitWithOptimalQuality: number;
  profitUpliftFromQualityOptimization: number;
  qualityRiskAssessment: QualityRiskEntry[];
  qualityDiversificationAdvice: string;
}

interface DealQualityProfitResponse {
  ok: true;
  analysis: QualityAnalysis;
  optimization: QualityOptimization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  optimization?: {
    optimalQualityRange?: string;
    qualityProfitStrategy?: string;
    qualityFilterRecommendation?: {
      minDealScore?: number;
      reasoning?: string;
    };
    projectedProfitWithOptimalQuality?: number;
    profitUpliftFromQualityOptimization?: number;
    qualityRiskAssessment?: Array<{ risk?: string; mitigation?: string }>;
    qualityDiversificationAdvice?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const TWELVE_MONTHS_MS = 365 * 86_400_000;

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100_000;
const ROI_MIN = -100;
const ROI_MAX = 500;
const WINRATE_MIN = 0;
const WINRATE_MAX = 100;

const BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: '0-20', lo: 0, hi: 20 },
  { label: '20-40', lo: 20, hi: 40 },
  { label: '40-60', lo: 40, hi: 60 },
  { label: '60-80', lo: 60, hi: 80 },
  { label: '80-100', lo: 80, hi: 101 }, // inclusive of 100
];

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw ?? '').trim().toUpperCase();
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
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

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function bucketForScore(score: number): { label: string; lo: number; hi: number } | null {
  for (const b of BUCKETS) {
    if (score >= b.lo && score < b.hi) return b;
  }
  return null;
}

// --- Deterministic computation ------------------------------------------

interface TradeQuality {
  profit: number;
  cost: number;
  isWin: boolean;
  dealScore: number;
  bucketIdx: number;
}

function computeTradeQuality(t: SoldTradeRow): TradeQuality | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;

  const dealScore = t.listing?.dealScore ?? null;
  if (dealScore === null || dealScore < 0 || dealScore > 100) return null;

  const bucketIdx = BUCKETS.findIndex((b) => dealScore >= b.lo && dealScore < b.hi);
  if (bucketIdx < 0) return null;

  const cost = buyPrice + buyFees;
  const profit = (sellPrice - sellFees) - cost;
  const isWin = profit > 0;

  return { profit, cost, isWin, dealScore, bucketIdx };
}

function buildQualityBuckets(trades: TradeQuality[]): QualityBucket[] {
  const buckets = BUCKETS.map((b) => ({
    label: b.label,
    sumProfit: 0,
    sumCost: 0,
    winCount: 0,
    count: 0,
    sumROI: 0,
    roiCount: 0,
  }));

  for (const t of trades) {
    const b = buckets[t.bucketIdx];
    b.sumProfit += t.profit;
    b.sumCost += t.cost;
    b.count += 1;
    if (t.isWin) b.winCount += 1;
    if (t.cost > 0) {
      b.sumROI += (t.profit / t.cost) * 100;
      b.roiCount += 1;
    }
  }

  return buckets.map((b) => {
    const avgProfit = b.count > 0 ? b.sumProfit / b.count : 0;
    const avgROI = b.roiCount > 0 ? b.sumROI / b.roiCount : 0;
    const winRate = b.count > 0 ? (b.winCount / b.count) * 100 : 0;
    const totalProfit = b.sumProfit;
    const profitPerDeal = avgProfit;
    return {
      range: b.label,
      avgProfit: round2(clampNum(avgProfit, PROFIT_MIN, PROFIT_MAX, 0)),
      avgROI: round2(clampNum(avgROI, ROI_MIN, ROI_MAX, 0)),
      winRate: round0(clampNum(winRate, WINRATE_MIN, WINRATE_MAX, 0)),
      tradeCount: b.count,
      totalProfit: round0(clampNum(totalProfit, PROFIT_MIN, PROFIT_MAX, 0)),
      profitPerDeal: round2(clampNum(profitPerDeal, PROFIT_MIN, PROFIT_MAX, 0)),
    };
  });
}

function computeCorrelation(trades: TradeQuality[]): QualityProfitCorrelation {
  if (trades.length < 3) return 'NONE';
  // Pearson correlation between dealScore and profit
  const n = trades.length;
  const sumX = trades.reduce((s, t) => s + t.dealScore, 0);
  const sumY = trades.reduce((s, t) => s + t.profit, 0);
  const sumXY = trades.reduce((s, t) => s + t.dealScore * t.profit, 0);
  const sumXX = trades.reduce((s, t) => s + t.dealScore * t.dealScore, 0);
  const sumYY = trades.reduce((s, t) => s + t.profit * t.profit, 0);
  const denom = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  if (denom === 0) return 'NONE';
  const r = (n * sumXY - sumX * sumY) / denom;
  if (r >= 0.5) return 'STRONG_POSITIVE';
  if (r >= 0.2) return 'WEAK_POSITIVE';
  if (r <= -0.2) return 'NEGATIVE';
  return 'NONE';
}

function buildAnalysis(trades: TradeQuality[]): QualityAnalysis {
  const qualityBuckets = buildQualityBuckets(trades);

  // Most profitable range (highest totalProfit)
  let mostProfitableRange = '60-80';
  let bestTotal = -Infinity;
  // Best ROI range (highest avgROI)
  let bestROIRange = '60-80';
  let bestROI = -Infinity;
  // Best win rate range (highest winRate)
  let bestWinRateRange = '60-80';
  let bestWin = -Infinity;

  for (const b of qualityBuckets) {
    if (b.tradeCount === 0) continue;
    if (b.totalProfit > bestTotal) {
      bestTotal = b.totalProfit;
      mostProfitableRange = b.range;
    }
    if (b.avgROI > bestROI) {
      bestROI = b.avgROI;
      bestROIRange = b.range;
    }
    if (b.winRate > bestWin) {
      bestWin = b.winRate;
      bestWinRateRange = b.range;
    }
  }

  const qualityProfitCorrelation = computeCorrelation(trades);

  return {
    qualityBuckets,
    mostProfitableRange,
    bestROIRange,
    bestWinRateRange,
    qualityProfitCorrelation,
  };
}

function buildDeterministicOptimization(
  analysis: QualityAnalysis,
): QualityOptimization {
  // Optimal range = mostProfitableRange (by totalProfit)
  const optimalQualityRange = analysis.mostProfitableRange;

  // Total current profit (sum across all buckets)
  const totalCurrentProfit = analysis.qualityBuckets.reduce(
    (s, b) => s + Math.max(0, b.totalProfit),
    0,
  );

  // Projected profit if only optimal quality range pursued:
  // = optimal bucket's totalProfit × (current total trade count / optimal trade count)
  // i.e. if we shift all trades to optimal range, what would we make?
  const optimalBucket = analysis.qualityBuckets.find(
    (b) => b.range === optimalQualityRange,
  );
  const optimalTradeCount = optimalBucket?.tradeCount ?? 1;
  const allTradeCount = analysis.qualityBuckets.reduce((s, b) => s + b.tradeCount, 0) || 1;
  const optimalAvgProfit = optimalBucket?.avgProfit ?? 0;
  const projectedProfitWithOptimalQuality = round0(clampNum(
    optimalAvgProfit * allTradeCount,
    PROFIT_MIN, PROFIT_MAX, totalCurrentProfit,
  ));
  const profitUpliftFromQualityOptimization = round0(clampNum(
    Math.max(0, projectedProfitWithOptimalQuality - totalCurrentProfit),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Quality filter recommendation: min dealScore = lower bound of optimal range
  const optimalRangeObj = BUCKETS.find((b) => b.label === optimalQualityRange);
  const minDealScore = round0(clampNum(
    optimalRangeObj?.lo ?? 60,
    SCORE_MIN, SCORE_MAX, 60,
  ));

  const reasoning = clampString(
    `Ciljaj deals z dealScore ≥ ${minDealScore} — ta range produkuje ${(optimalBucket?.avgROI ?? 0).toFixed(0)}% ROI in ${(optimalBucket?.winRate ?? 0).toFixed(0)}% win rate. Skupni profit ${optimalBucket?.totalProfit ?? 0}€ iz ${optimalBucket?.tradeCount ?? 0} trgovin.`,
    400,
    `Ciljaj deals z dealScore ≥ ${minDealScore}.`,
  );

  const qualityProfitStrategy = clampString(
    `Premakni sourcing v ${optimalQualityRange} quality range — najvišji total profit (${optimalBucket?.totalProfit ?? 0}€) in win rate (${(optimalBucket?.winRate ?? 0).toFixed(0)}%). Zmanjšaj čas na deals pod ${minDealScore} (low-profit deals). Diverzificiraj med ${optimalQualityRange} in sosednjim range-om za konsistenten volume.`,
    400,
    `Premakni sourcing v ${optimalQualityRange} quality range.`,
  );

  // Risk assessment: targeting only high-quality deals
  const qualityRiskAssessment: QualityRiskEntry[] = [
    {
      risk: clampString(
        'Zmanjšanje trade volume-a (manj deals ustreza višjemu quality thresholdu).',
        200,
        'Zmanjšanje trade volume-a.',
      ),
      mitigation: clampString(
        `Diverzificiraj: 80% deals v ${optimalQualityRange}, 20% v sosednjem range-ih da ohraniš volume.`,
        200,
        'Diverzificiraj med optimal in sosednjim range-om.',
      ),
    },
    {
      risk: clampString(
        'Stroški sourcing-a se povečajo (več časa na search za high-quality deals).',
        200,
        'Stroški sourcing-a se povečajo.',
      ),
      mitigation: clampString(
        'Avtomatiziraj sourcing z AI Hub deal-scorer-jem — postavi dealScore filter ≥ ${minDealScore} v monitorjih.',
        200,
        'Avtomatiziraj sourcing z AI Hub deal-scorer-jem.',
      ).replace('${minDealScore}', String(minDealScore)),
    },
    {
      risk: clampString(
        'Tržna nihanja — visoko-quality deals lahko postanejo redke v seasonal low season.',
        200,
        'Tržna nihanja.',
      ),
      mitigation: clampString(
        'Prilagodi threshold v low season (≥ ${min - 10}), povečaj v high season.',
        200,
        'Prilagodi threshold seasonal.',
      ).replace('${min - 10}', String(Math.max(0, minDealScore - 10))),
    },
  ];

  const qualityDiversificationAdvice = clampString(
    `Diverzifikacija: 70% capital v ${optimalQualityRange} range, 20% v ${analysis.bestROIRange} range (najvišji ROI), 10% v ${analysis.bestWinRateRange} range (konsistenten win rate). Tako maksimiziraš profit ob ohranjanju steady cash flow.`,
    400,
    `Diverzificiraj: 70% v ${optimalQualityRange}, 20% v ${analysis.bestROIRange}, 10% v ${analysis.bestWinRateRange}.`,
  );

  return {
    optimalQualityRange,
    qualityProfitStrategy,
    qualityFilterRecommendation: { minDealScore, reasoning },
    projectedProfitWithOptimalQuality,
    profitUpliftFromQualityOptimization,
    qualityRiskAssessment,
    qualityDiversificationAdvice,
  };
}

function buildSummary(
  analysis: QualityAnalysis,
  optimization: QualityOptimization,
): string {
  const optimalBucket = analysis.qualityBuckets.find(
    (b) => b.range === optimization.optimalQualityRange,
  );
  const parts: string[] = [
    `Most profitable: ${analysis.mostProfitableRange} (${optimalBucket?.totalProfit ?? 0}€).`,
    `Best ROI: ${analysis.bestROIRange}, best win rate: ${analysis.bestWinRateRange}.`,
    `Correlation: ${analysis.qualityProfitCorrelation}.`,
    `Optimal: ${optimization.optimalQualityRange} → projected ${optimization.projectedProfitWithOptimalQuality}€ (+${optimization.profitUpliftFromQualityOptimization}€ uplift).`,
    `Min dealScore filter: ${optimization.qualityFilterRecommendation.minDealScore}.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealQualityProfitOptimizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealQualityProfitOptimizer(req);
}

async function handleDealQualityProfitOptimizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-quality-profit-optimizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for dealScore)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        sellPrice: { gt: 0 },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        listing: {
          select: {
            dealScore: true,
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        analysis: {
          qualityBuckets: BUCKETS.map((b) => ({
            range: b.label,
            avgProfit: 0,
            avgROI: 0,
            winRate: 0,
            tradeCount: 0,
            totalProfit: 0,
            profitPerDeal: 0,
          })),
          mostProfitableRange: '60-80',
          bestROIRange: '60-80',
          bestWinRateRange: '60-80',
          qualityProfitCorrelation: 'NONE',
        },
        optimization: {
          optimalQualityRange: '60-80',
          qualityProfitStrategy: 'Ni SOLD trgovin v zadnjih 12 mesecih — quality-profit optimization ni mogoč.',
          qualityFilterRecommendation: {
            minDealScore: 60,
            reasoning: 'Ni podatkov — priporočilo ni mogoče.',
          },
          projectedProfitWithOptimalQuality: 0,
          profitUpliftFromQualityOptimization: 0,
          qualityRiskAssessment: [],
          qualityDiversificationAdvice: 'Ni SOLD trgovin — diversifikacija ni mogoča.',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Quality Profit Optimizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Quality Profit Optimizer ni mogoč.',
      } satisfies DealQualityProfitResponse);
    }

    // 2) Compute quality-profit analysis
    const tradeQualities: TradeQuality[] = [];
    for (const t of soldTrades) {
      const tq = computeTradeQuality(t);
      if (tq) tradeQualities.push(tq);
    }

    if (tradeQualities.length === 0) {
      return NextResponse.json({
        ok: true,
        analysis: {
          qualityBuckets: BUCKETS.map((b) => ({
            range: b.label,
            avgProfit: 0,
            avgROI: 0,
            winRate: 0,
            tradeCount: 0,
            totalProfit: 0,
            profitPerDeal: 0,
          })),
          mostProfitableRange: '60-80',
          bestROIRange: '60-80',
          bestWinRateRange: '60-80',
          qualityProfitCorrelation: 'NONE',
        },
        optimization: {
          optimalQualityRange: '60-80',
          qualityProfitStrategy: 'Trgovine nimajo veljavnih dealScore — quality-profit optimization ni mogoč.',
          qualityFilterRecommendation: {
            minDealScore: 60,
            reasoning: 'Ni veljavnih dealScore podatkov — priporočilo ni mogoče.',
          },
          projectedProfitWithOptimalQuality: 0,
          profitUpliftFromQualityOptimization: 0,
          qualityRiskAssessment: [],
          qualityDiversificationAdvice: 'Ni veljavnih dealScore podatkov — diversifikacija ni mogoča.',
        },
        summary: 'Ni veljavnih dealScore — Deal Quality Profit Optimizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih dealScore — Deal Quality Profit Optimizer ni mogoč.',
      } satisfies DealQualityProfitResponse);
    }

    const analysis = buildAnalysis(tradeQualities);

    let optimization = buildDeterministicOptimization(analysis);
    let summary = buildSummary(analysis, optimization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-quality-profit-optimizer:${currentMonth}`;
    const cached = getCachedAI<{
      optimization: QualityOptimization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        analysis,
        optimization: cached.optimization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealQualityProfitResponse);
    }

    // 4) AI prompt with grounding
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

    const totalCurrentProfit = analysis.qualityBuckets.reduce(
      (s, b) => s + Math.max(0, b.totalProfit),
      0,
    );

    const promptData = {
      tradeCount12m: tradeQualities.length,
      totalCurrentProfit: round0(totalCurrentProfit),
      analysis,
      deterministicOptimization: optimization,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        winrateMin: WINRATE_MIN, winrateMax: WINRATE_MAX,
      },
    };

    const prompt = `Si AI "Deal Quality Profit Optimizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za QUALITY-PROFIT optimization — identificiraš RELATIONSHIP med deal quality scores in actual profit in priporočaš KATERE quality deals ciljati za maximum profit. Razlika od deal-quality-forecaster (ki napove deal quality) — ti RELATES quality → actual profit in optimiraš sourcing. Razlika od deal-quality-distribution-analyzer (ki analizira quality distribution) — ti MAXIMIZIRAŠ profit iz quality ranges z actionable filtering advice. Razlika od deal-quality-trend-analyzer (ki track-a quality trend) — ti daje quality → profit correlation + optimal range targeting. Razlika od deal-quality-scorecard (ki scor-a deals) — ti optimiraš KATERI quality range ciljati za max profit. Razlika od profit-maximizer-pro (ki maksimizira profit preko 7 levers) — ti fokusiraš na QUALITY-PROFIT correlation. Razlika od deal-source-profit-maximizer (ki maksimizira per-source) — ti maksimiziraš per-QUALITY-RANGE. Razlika od profit-velocity-maximizer (ki maksimizira velocity) — ti maksimiziraš per-quality profit.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing.dealScore):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. optimization.optimalQualityRange (string, format "X-Y" — npr. "60-80"; MORA biti ena iz qualityBuckets ranges anti-hallucination),
2. optimization.qualityProfitStrategy (max 400, slovenski — kako prilagoditi sourcing da ciljaš optimal range),
3. optimization.qualityFilterRecommendation: { minDealScore [0, 100], reasoning (max 400, slovenski) },
4. optimization.projectedProfitWithOptimalQuality € [0, 100000] (≥ totalCurrentProfit, ≤ totalCurrentProfit × 2.5 anti-hallucination),
5. optimization.profitUpliftFromQualityOptimization € [0, 100000] (= projected - totalCurrentProfit anti-hallucination),
6. optimization.qualityRiskAssessment: 2-4 risks { risk (max 200, slovenski), mitigation (max 200, slovenski) },
7. optimization.qualityDiversificationAdvice (max 400, slovenski — kako diverzificirati med quality ranges),
8. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "optimization": {
    "optimalQualityRange": "60-80",
    "qualityProfitStrategy": "Premakni sourcing v 60-80 quality range — najvišji total profit (4,200€) in win rate (84%).",
    "qualityFilterRecommendation": {
      "minDealScore": 55,
      "reasoning": "Ciljaj deals z dealScore ≥ 55 — ta range produkuje 92% ROI in 84% win rate."
    },
    "projectedProfitWithOptimalQuality": 4800,
    "profitUpliftFromQualityOptimization": 1200,
    "qualityRiskAssessment": [
      { "risk": "Zmanjšanje trade volume-a.", "mitigation": "Diverzificiraj med 60-80 in 80-100." }
    ],
    "qualityDiversificationAdvice": "70% capital v 60-80, 20% v 80-100, 10% v 40-60 za steady volume."
  },
  "summary": "Most profitable: 60-80 (4200€). Correlation: STRONG_POSITIVE. Optimal: 60-80 → projected 4800€ (+1200€ uplift). Min filter: 55."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const aiOpt = parsed.optimization ?? {};

        // Anti-hallucination: optimalQualityRange must be one of valid bucket labels
        const validLabels = BUCKETS.map((b) => b.label);
        const optimalQualityRange = validLabels.includes(String(aiOpt.optimalQualityRange ?? '').trim())
          ? String(aiOpt.optimalQualityRange).trim()
          : optimization.optimalQualityRange;

        const qualityProfitStrategy = clampString(
          aiOpt.qualityProfitStrategy,
          400,
          optimization.qualityProfitStrategy,
        );

        // minDealScore clamped to [0, 100]
        const minDealScore = round0(clampNum(
          aiOpt.qualityFilterRecommendation?.minDealScore,
          SCORE_MIN, SCORE_MAX,
          optimization.qualityFilterRecommendation.minDealScore,
        ));
        const reasoning = clampString(
          aiOpt.qualityFilterRecommendation?.reasoning,
          400,
          optimization.qualityFilterRecommendation.reasoning,
        );

        // Anti-hallucination: projected ≥ totalCurrentProfit, ≤ totalCurrentProfit × 2.5
        const projectedLowBound = totalCurrentProfit;
        const projectedHighBound = Math.min(PROFIT_MAX, totalCurrentProfit * 2.5);
        const aiProjected = round0(clampNum(
          aiOpt.projectedProfitWithOptimalQuality,
          PROFIT_MIN, PROFIT_MAX,
          optimization.projectedProfitWithOptimalQuality,
        ));
        const projectedProfitWithOptimalQuality = round0(
          Math.max(projectedLowBound, Math.min(projectedHighBound, aiProjected)),
        );

        // profitUplift = projected - totalCurrentProfit (anti-hallucination within ±10% else recompute)
        const expectedUplift = Math.max(0, projectedProfitWithOptimalQuality - totalCurrentProfit);
        const aiUplift = round0(clampNum(
          aiOpt.profitUpliftFromQualityOptimization,
          UPLIFT_MIN, UPLIFT_MAX,
          expectedUplift,
        ));
        const profitUpliftFromQualityOptimization = Math.abs(aiUplift - expectedUplift) <= Math.max(10, expectedUplift * 0.1)
          ? aiUplift
          : round0(expectedUplift);

        // qualityRiskAssessment
        const qualityRiskAssessment: QualityRiskEntry[] = [];
        if (Array.isArray(aiOpt.qualityRiskAssessment)) {
          for (const r of aiOpt.qualityRiskAssessment.slice(0, 4)) {
            if (!r || typeof r !== 'object') continue;
            qualityRiskAssessment.push({
              risk: clampString(r.risk, 200, 'Risk.'),
              mitigation: clampString(r.mitigation, 200, 'Mitigacija.'),
            });
          }
        }
        if (qualityRiskAssessment.length === 0) {
          for (const r of optimization.qualityRiskAssessment) qualityRiskAssessment.push(r);
        }

        const qualityDiversificationAdvice = clampString(
          aiOpt.qualityDiversificationAdvice,
          400,
          optimization.qualityDiversificationAdvice,
        );

        optimization = {
          optimalQualityRange,
          qualityProfitStrategy,
          qualityFilterRecommendation: { minDealScore, reasoning },
          projectedProfitWithOptimalQuality,
          profitUpliftFromQualityOptimization,
          qualityRiskAssessment,
          qualityDiversificationAdvice,
        };

        summary = clampString(parsed.summary, 400, buildSummary(analysis, optimization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-quality-profit-optimizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { optimization, summary });
    }

    return NextResponse.json({
      ok: true,
      analysis,
      optimization,
      summary,
      aiUsed,
    } satisfies DealQualityProfitResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-quality-profit-optimizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
