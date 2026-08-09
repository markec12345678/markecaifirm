// v7.97: AI Market Timing Profit Optimizer — AI določi OPTIMAL TIMING za
// nakup in prodajo da MAXIMIZIRA profit — kdaj kupiti (najnižje cene), kdaj
// prodati (najvišje cene), in kateri dan/teden/mesec produkuje best results.
// The "ultimate timing guide for maximum profit."
//
// Razlika od seasonal-timing-optimizer (ki optimizira seasonal timing) — ta
// KOMBINIRA day-of-week + month + hold-period timing za maximum profit.
// Razlika od auction-timing (ki optimizira auction bid timing) — ta optimira
// BUY+SELL timing za flipping trades. Razlika od optimal-time (ki daje best
// time to list) — ta daje best time to BUY in SELL za profit maximization.
// Razlika od seasonal-planner (ki planira seasonal inventory) — ta fokusira
// na TIMING profitability (kdaj kupiti/prodati za max profit). Razlika od
// seasonal-calendar (ki je calendar) — ta je ANALYSIS z profit uplift
// projection. Razlika od inventory-purchase-timing (v starem ki daje purchase
// timing) — ta KOMBINIRA buy + sell timing z hold period optimization.
// Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira per-source)
// — ta maksimizira PER-TIME-WINDOW profit (kdaj kupiti/prodati).
//
// "Best buy day: Torek (avg 245€, 18% pod avg). Best sell day: Petek (avg
// 420€, 12% nad avg). Best buy month: December (deals -22%). Best sell month:
// November (prices +18%). Optimal hold: 8-14 days (ROI 145%). Timing score:
// 62/100. Uplift: +1,800€ if perfectly timed. Urgency: HIGH."
//
// GET+POST /api/ai/market-timing-profit-optimizer
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

type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
  } | null;
}

interface TimingPatterns {
  bestBuyDay: string;
  bestSellDay: string;
  bestBuyMonth: string;
  bestSellMonth: string;
  optimalHoldPeriod: number; // days
  avgProfitByDayOfWeek: Array<{ day: string; avgProfit: number }>;
  avgProfitByMonth: Array<{ month: string; avgProfit: number }>;
}

interface TimingOptimizationAction {
  action: string;
  priority: ActionPriority;
  expectedProfitImpact: number; // €
}

interface TimingOptimization {
  optimalBuyWindow: string;
  optimalSellWindow: string;
  timingProfitScore: number; // 0-100
  timingOptimizationActions: TimingOptimizationAction[];
  projectedProfitWithOptimalTiming: number; // €
  profitUpliftFromTiming: number; // €
  seasonalAdvice: string;
  urgencyLevel: UrgencyLevel;
}

interface MarketTimingResponse {
  ok: true;
  patterns: TimingPatterns;
  optimization: TimingOptimization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  optimization?: {
    optimalBuyWindow?: string;
    optimalSellWindow?: string;
    timingProfitScore?: number;
    timingOptimizationActions?: Array<{
      action?: string;
      priority?: ActionPriority;
      expectedProfitImpact?: number;
    }>;
    projectedProfitWithOptimalTiming?: number;
    profitUpliftFromTiming?: number;
    seasonalAdvice?: string;
    urgencyLevel?: UrgencyLevel;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 50_000;
const IMPACT_MIN = 0;
const IMPACT_MAX = 50_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50_000;
const HOLD_MIN = 1;
const HOLD_MAX = 365;

const DAYS_SLO = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];
const DAYS_SLO_SHORT = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];
const MONTHS_SLO = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];

const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_URGENCY: readonly UrgencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

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

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

// --- Deterministic computation ------------------------------------------

interface TradeTiming {
  buyDayIdx: number; // 0-6 (0=Sunday)
  sellDayIdx: number;
  buyMonthIdx: number; // 0-11
  sellMonthIdx: number;
  holdDays: number;
  profit: number;
  cost: number;
  buyPrice: number;
  sellPrice: number;
  buyEstRatio: number | null; // buyPrice / aiEstimatedValue (null if no estValue)
}

function computeTradeTiming(t: SoldTradeRow): TradeTiming | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;

  const buyMs = toMs(t.buyDate);
  const sellMs = toMs(t.sellDate);
  if (buyMs <= 0 || sellMs <= 0) return null;

  const buyDate = new Date(buyMs);
  const sellDate = new Date(sellMs);
  const cost = buyPrice + buyFees;
  const profit = (sellPrice - sellFees) - cost;
  const holdDays = Math.round((sellMs - buyMs) / DAY_MS);

  const estValue = t.listing?.aiEstimatedValue ?? null;
  const buyEstRatio = estValue && estValue > 0 ? buyPrice / estValue : null;

  return {
    buyDayIdx: buyDate.getDay(),
    sellDayIdx: sellDate.getDay(),
    buyMonthIdx: buyDate.getMonth(),
    sellMonthIdx: sellDate.getMonth(),
    holdDays: Math.max(0, holdDays),
    profit,
    cost,
    buyPrice,
    sellPrice,
    buyEstRatio,
  };
}

interface DayBucket {
  sumProfit: number;
  count: number;
  sumBuyPrice: number;
  sumSellPrice: number;
  buyCount: number;
  sellCount: number;
  sumBuyEstRatio: number;
  buyEstRatioCount: number;
}

function emptyDayBucket(): DayBucket {
  return {
    sumProfit: 0, count: 0,
    sumBuyPrice: 0, sumSellPrice: 0,
    buyCount: 0, sellCount: 0,
    sumBuyEstRatio: 0, buyEstRatioCount: 0,
  };
}

interface MonthBucket {
  sumProfit: number;
  count: number;
  sumBuyPrice: number;
  sumSellPrice: number;
  buyCount: number;
  sellCount: number;
  sumBuyEstRatio: number;
  buyEstRatioCount: number;
}

function emptyMonthBucket(): MonthBucket {
  return {
    sumProfit: 0, count: 0,
    sumBuyPrice: 0, sumSellPrice: 0,
    buyCount: 0, sellCount: 0,
    sumBuyEstRatio: 0, buyEstRatioCount: 0,
  };
}

interface HoldBucket {
  label: string;
  sumProfit: number;
  count: number;
  midPoint: number; // midpoint in days (for sorting)
}

function bucketHoldDays(days: number): { label: string; midPoint: number } {
  if (days <= 7) return { label: '0-7', midPoint: 4 };
  if (days <= 14) return { label: '8-14', midPoint: 11 };
  if (days <= 30) return { label: '15-30', midPoint: 22 };
  if (days <= 60) return { label: '31-60', midPoint: 45 };
  if (days <= 90) return { label: '61-90', midPoint: 75 };
  return { label: '91+', midPoint: 120 };
}

interface TimingAnalysis {
  dayBuckets: DayBucket[]; // 7 entries (0=Sun ... 6=Sat)
  monthBuckets: MonthBucket[]; // 12 entries (0=Jan ... 11=Dec)
  holdBuckets: Map<string, HoldBucket>;
  totalProfit: number;
  tradeCount: number;
  timingAlignmentCount: number; // count of trades aligned with best timing
}

function analyzeTiming(trades: TradeTiming[]): TimingAnalysis {
  const dayBuckets: DayBucket[] = Array.from({ length: 7 }, () => emptyDayBucket());
  const monthBuckets: MonthBucket[] = Array.from({ length: 12 }, () => emptyMonthBucket());
  const holdBucketsMap = new Map<string, HoldBucket>();
  let totalProfit = 0;
  let tradeCount = 0;
  let timingAlignmentCount = 0;

  for (const t of trades) {
    totalProfit += t.profit;
    tradeCount += 1;

    // Buy side
    const buyDay = dayBuckets[t.buyDayIdx];
    buyDay.sumBuyPrice += t.buyPrice;
    buyDay.buyCount += 1;
    if (t.buyEstRatio !== null) {
      buyDay.sumBuyEstRatio += t.buyEstRatio;
      buyDay.buyEstRatioCount += 1;
    }

    const buyMonth = monthBuckets[t.buyMonthIdx];
    buyMonth.sumBuyPrice += t.buyPrice;
    buyMonth.buyCount += 1;
    if (t.buyEstRatio !== null) {
      buyMonth.sumBuyEstRatio += t.buyEstRatio;
      buyMonth.buyEstRatioCount += 1;
    }

    // Sell side
    const sellDay = dayBuckets[t.sellDayIdx];
    sellDay.sumSellPrice += t.sellPrice;
    sellDay.sellCount += 1;
    sellDay.sumProfit += t.profit;
    sellDay.count += 1;

    const sellMonth = monthBuckets[t.sellMonthIdx];
    sellMonth.sumSellPrice += t.sellPrice;
    sellMonth.sellCount += 1;
    sellMonth.sumProfit += t.profit;
    sellMonth.count += 1;

    // Hold bucket
    const hb = bucketHoldDays(t.holdDays);
    let holdBucket = holdBucketsMap.get(hb.label);
    if (!holdBucket) {
      holdBucket = { label: hb.label, sumProfit: 0, count: 0, midPoint: hb.midPoint };
      holdBucketsMap.set(hb.label, holdBucket);
    }
    holdBucket.sumProfit += t.profit;
    holdBucket.count += 1;
  }

  return {
    dayBuckets,
    monthBuckets,
    holdBuckets: holdBucketsMap,
    totalProfit,
    tradeCount,
    timingAlignmentCount,
  };
}

function findBestBuyDay(analysis: TimingAnalysis): string {
  // Lowest avg buyPrice (require at least 2 buys that day)
  let bestIdx = -1;
  let bestAvg = Infinity;
  for (let i = 0; i < 7; i++) {
    const b = analysis.dayBuckets[i];
    if (b.buyCount < 2) continue;
    const avgBuy = b.sumBuyPrice / b.buyCount;
    if (avgBuy < bestAvg) {
      bestAvg = avgBuy;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    // Fallback: pick the day with most buys
    let maxCount = 0;
    for (let i = 0; i < 7; i++) {
      if (analysis.dayBuckets[i].buyCount > maxCount) {
        maxCount = analysis.dayBuckets[i].buyCount;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? DAYS_SLO[bestIdx] : 'Ponedeljek';
}

function findBestSellDay(analysis: TimingAnalysis): string {
  let bestIdx = -1;
  let bestAvg = -Infinity;
  for (let i = 0; i < 7; i++) {
    const b = analysis.dayBuckets[i];
    if (b.sellCount < 2) continue;
    const avgSell = b.sumSellPrice / b.sellCount;
    if (avgSell > bestAvg) {
      bestAvg = avgSell;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    let maxCount = 0;
    for (let i = 0; i < 7; i++) {
      if (analysis.dayBuckets[i].sellCount > maxCount) {
        maxCount = analysis.dayBuckets[i].sellCount;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? DAYS_SLO[bestIdx] : 'Petek';
}

function findBestBuyMonth(analysis: TimingAnalysis): string {
  // Best deals = lowest buy/estValue ratio (or lowest avg buyPrice if no ratio)
  let bestIdx = -1;
  let bestScore = Infinity;
  for (let i = 0; i < 12; i++) {
    const b = analysis.monthBuckets[i];
    if (b.buyCount < 2) continue;
    const score = b.buyEstRatioCount > 0
      ? b.sumBuyEstRatio / b.buyEstRatioCount
      : b.sumBuyPrice / b.buyCount;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    // Fallback: pick the month with most buys
    let maxCount = 0;
    for (let i = 0; i < 12; i++) {
      if (analysis.monthBuckets[i].buyCount > maxCount) {
        maxCount = analysis.monthBuckets[i].buyCount;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? MONTHS_SLO[bestIdx] : 'Jan';
}

function findBestSellMonth(analysis: TimingAnalysis): string {
  let bestIdx = -1;
  let bestAvg = -Infinity;
  for (let i = 0; i < 12; i++) {
    const b = analysis.monthBuckets[i];
    if (b.sellCount < 2) continue;
    const avgSell = b.sumSellPrice / b.sellCount;
    if (avgSell > bestAvg) {
      bestAvg = avgSell;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) {
    let maxCount = 0;
    for (let i = 0; i < 12; i++) {
      if (analysis.monthBuckets[i].sellCount > maxCount) {
        maxCount = analysis.monthBuckets[i].sellCount;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? MONTHS_SLO[bestIdx] : 'Nov';
}

function findOptimalHoldPeriod(analysis: TimingAnalysis): number {
  let bestMid = 11; // default 8-14 days
  let bestAvg = -Infinity;
  for (const [, hb] of analysis.holdBuckets) {
    if (hb.count < 2) continue;
    const avgProfit = hb.sumProfit / hb.count;
    if (avgProfit > bestAvg) {
      bestAvg = avgProfit;
      bestMid = hb.midPoint;
    }
  }
  return round0(clampNum(bestMid, HOLD_MIN, HOLD_MAX, 11));
}

function computeAvgProfitByDay(analysis: TimingAnalysis): Array<{ day: string; avgProfit: number }> {
  const out: Array<{ day: string; avgProfit: number }> = [];
  for (let i = 0; i < 7; i++) {
    const b = analysis.dayBuckets[i];
    const avgProfit = b.count > 0 ? b.sumProfit / b.count : 0;
    out.push({ day: DAYS_SLO_SHORT[i], avgProfit: round0(avgProfit) });
  }
  return out;
}

function computeAvgProfitByMonth(analysis: TimingAnalysis): Array<{ month: string; avgProfit: number }> {
  const out: Array<{ month: string; avgProfit: number }> = [];
  for (let i = 0; i < 12; i++) {
    const b = analysis.monthBuckets[i];
    const avgProfit = b.count > 0 ? b.sumProfit / b.count : 0;
    out.push({ month: MONTHS_SLO[i], avgProfit: round0(avgProfit) });
  }
  return out;
}

function computeTimingProfitScore(
  analysis: TimingAnalysis,
  bestBuyDayIdx: number,
  bestSellDayIdx: number,
  bestBuyMonthIdx: number,
  bestSellMonthIdx: number,
): number {
  if (analysis.tradeCount === 0) return 50;
  // Score based on weighted alignment of trades with best timing
  let alignedWeighted = 0;
  let totalWeighted = 0;
  for (let i = 0; i < analysis.dayBuckets.length; i++) {
    const b = analysis.dayBuckets[i];
    if (b.count === 0) continue;
    const weight = Math.max(1, Math.abs(b.sumProfit));
    totalWeighted += weight;
    if (i === bestSellDayIdx) alignedWeighted += weight;
  }
  for (let i = 0; i < analysis.monthBuckets.length; i++) {
    const b = analysis.monthBuckets[i];
    if (b.count === 0) continue;
    const weight = Math.max(1, Math.abs(b.sumProfit));
    totalWeighted += weight;
    if (i === bestBuyMonthIdx || i === bestSellMonthIdx) alignedWeighted += weight;
  }
  if (totalWeighted === 0) return 50;
  // Normalize to 0-100 with a baseline of 30 (since some alignment is luck)
  const rawScore = (alignedWeighted / totalWeighted) * 100;
  const score = 30 + rawScore * 0.7; // 30 baseline + up to 70 from alignment
  return round0(clampNum(score, SCORE_MIN, SCORE_MAX, 50));
}

function decideUrgency(score: number): UrgencyLevel {
  if (score < 25) return 'CRITICAL';
  if (score < 50) return 'HIGH';
  if (score < 75) return 'MEDIUM';
  return 'LOW';
}

function buildDeterministicOptimization(
  analysis: TimingAnalysis,
  patterns: TimingPatterns,
  bestBuyDayIdx: number,
  bestSellDayIdx: number,
  bestBuyMonthIdx: number,
  bestSellMonthIdx: number,
): TimingOptimization {
  const totalProfit = Math.max(0, analysis.totalProfit);
  const timingProfitScore = computeTimingProfitScore(
    analysis, bestBuyDayIdx, bestSellDayIdx, bestBuyMonthIdx, bestSellMonthIdx,
  );
  // Projected profit if perfectly timed: totalProfit × (1 + (100-score)/100 × 0.5)
  // Max uplift = 50% if currently poorly timed
  const upliftFactor = (100 - timingProfitScore) / 100 * 0.5;
  const projectedProfitWithOptimalTiming = round0(
    clampNum(totalProfit * (1 + upliftFactor), PROFIT_MIN, PROFIT_MAX, totalProfit),
  );
  const profitUpliftFromTiming = round0(
    clampNum(projectedProfitWithOptimalTiming - totalProfit, UPLIFT_MIN, UPLIFT_MAX, 0),
  );

  // Optimal buy window
  const optimalBuyWindow = clampString(
    `Naslednji ${patterns.bestBuyDay} v ${patterns.bestBuyMonth} — najnižje povprečne cene.`,
    200,
    `Naslednji ${patterns.bestBuyDay}.`,
  );
  const optimalSellWindow = clampString(
    `Naslednji ${patterns.bestSellDay} v ${patterns.bestSellMonth} — najvišje povprečne cene.`,
    200,
    `Naslednji ${patterns.bestSellDay}.`,
  );

  // Timing optimization actions
  const avgProfit = analysis.tradeCount > 0 ? totalProfit / analysis.tradeCount : 0;
  const actions: TimingOptimizationAction[] = [
    {
      action: clampString(
        `Kupuj na ${patterns.bestBuyDay} (najnižje povprečne cene).`,
        200,
        `Kupuj na ${patterns.bestBuyDay}.`,
      ),
      priority: 'HIGH',
      expectedProfitImpact: round0(clampNum(avgProfit * 0.15, IMPACT_MIN, IMPACT_MAX, 0)),
    },
    {
      action: clampString(
        `Prodajaj na ${patterns.bestSellDay} (najvišje povprečne cene).`,
        200,
        `Prodajaj na ${patterns.bestSellDay}.`,
      ),
      priority: 'HIGH',
      expectedProfitImpact: round0(clampNum(avgProfit * 0.15, IMPACT_MIN, IMPACT_MAX, 0)),
    },
    {
      action: clampString(
        `Čakaj na ${patterns.bestBuyMonth} za nakup (best deals).`,
        200,
        `Čakaj na ${patterns.bestBuyMonth}.`,
      ),
      priority: 'MEDIUM',
      expectedProfitImpact: round0(clampNum(avgProfit * 0.10, IMPACT_MIN, IMPACT_MAX, 0)),
    },
    {
      action: clampString(
        `Čakaj na ${patterns.bestSellMonth} za prodajo (best prices).`,
        200,
        `Čakaj na ${patterns.bestSellMonth}.`,
      ),
      priority: 'MEDIUM',
      expectedProfitImpact: round0(clampNum(avgProfit * 0.10, IMPACT_MIN, IMPACT_MAX, 0)),
    },
    {
      action: clampString(
        `Drži item-e ${patterns.optimalHoldPeriod} dni za max profit (optimal hold period).`,
        200,
        `Drži ${patterns.optimalHoldPeriod} dni.`,
      ),
      priority: 'MEDIUM',
      expectedProfitImpact: round0(clampNum(avgProfit * 0.12, IMPACT_MIN, IMPACT_MAX, 0)),
    },
  ];

  const seasonalAdvice = clampString(
    `V prihodnjih tednih: fokusiraj buys na ${patterns.bestBuyDay}/${patterns.bestBuyMonth} in sells na ${patterns.bestSellDay}/${patterns.bestSellMonth}. Hold period ~${patterns.optimalHoldPeriod} dni.`,
    400,
    `Timing: buy ${patterns.bestBuyDay}/${patterns.bestBuyMonth}, sell ${patterns.bestSellDay}/${patterns.bestSellMonth}.`,
  );

  const urgencyLevel = decideUrgency(timingProfitScore);

  return {
    optimalBuyWindow,
    optimalSellWindow,
    timingProfitScore,
    timingOptimizationActions: actions,
    projectedProfitWithOptimalTiming,
    profitUpliftFromTiming,
    seasonalAdvice,
    urgencyLevel,
  };
}

function buildSummary(patterns: TimingPatterns, optimization: TimingOptimization): string {
  const parts: string[] = [
    `Best buy: ${patterns.bestBuyDay}/${patterns.bestBuyMonth}.`,
    `Best sell: ${patterns.bestSellDay}/${patterns.bestSellMonth}.`,
    `Optimal hold: ${patterns.optimalHoldPeriod} dni.`,
    `Timing score: ${optimization.timingProfitScore}/100.`,
    `Uplift: +${optimization.profitUpliftFromTiming}€ if perfectly timed.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketTimingProfitOptimizer(req);
}
export async function POST(req: NextRequest) {
  return handleMarketTimingProfitOptimizer(req);
}

async function handleMarketTimingProfitOptimizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-timing-profit-optimizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query all SOLD trades from last 12 months
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
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            aiEstimatedValue: true,
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
        patterns: {
          bestBuyDay: 'Ponedeljek',
          bestSellDay: 'Petek',
          bestBuyMonth: 'Jan',
          bestSellMonth: 'Nov',
          optimalHoldPeriod: 11,
          avgProfitByDayOfWeek: [],
          avgProfitByMonth: [],
        },
        optimization: {
          optimalBuyWindow: 'Ni podatkov — priporočilo ni mogoče.',
          optimalSellWindow: 'Ni podatkov — priporočilo ni mogoče.',
          timingProfitScore: 0,
          timingOptimizationActions: [],
          projectedProfitWithOptimalTiming: 0,
          profitUpliftFromTiming: 0,
          seasonalAdvice: 'Ni SOLD trgovin v zadnjih 12 mesecih — timing analysis ni mogoč.',
          urgencyLevel: 'LOW',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Market Timing Profit Optimizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Market Timing Profit Optimizer ni mogoč.',
      } satisfies MarketTimingResponse);
    }

    // 2) Compute timing patterns
    const tradeTimings: TradeTiming[] = [];
    for (const t of soldTrades) {
      const tt = computeTradeTiming(t);
      if (tt) tradeTimings.push(tt);
    }

    if (tradeTimings.length === 0) {
      return NextResponse.json({
        ok: true,
        patterns: {
          bestBuyDay: 'Ponedeljek',
          bestSellDay: 'Petek',
          bestBuyMonth: 'Jan',
          bestSellMonth: 'Nov',
          optimalHoldPeriod: 11,
          avgProfitByDayOfWeek: [],
          avgProfitByMonth: [],
        },
        optimization: {
          optimalBuyWindow: 'Ni podatkov — priporočilo ni mogoče.',
          optimalSellWindow: 'Ni podatkov — priporočilo ni mogoče.',
          timingProfitScore: 0,
          timingOptimizationActions: [],
          projectedProfitWithOptimalTiming: 0,
          profitUpliftFromTiming: 0,
          seasonalAdvice: 'Trgovine nimajo veljavnih buy/sell datumov — timing analysis ni mogoč.',
          urgencyLevel: 'LOW',
        },
        summary: 'Ni veljavnih buy/sell datumov — Market Timing Profit Optimizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih buy/sell datumov — Market Timing Profit Optimizer ni mogoč.',
      } satisfies MarketTimingResponse);
    }

    const analysis = analyzeTiming(tradeTimings);

    const bestBuyDayStr = findBestBuyDay(analysis);
    const bestSellDayStr = findBestSellDay(analysis);
    const bestBuyMonthStr = findBestBuyMonth(analysis);
    const bestSellMonthStr = findBestSellMonth(analysis);
    const optimalHoldPeriod = findOptimalHoldPeriod(analysis);

    const bestBuyDayIdx = Math.max(0, DAYS_SLO.indexOf(bestBuyDayStr));
    const bestSellDayIdx = Math.max(0, DAYS_SLO.indexOf(bestSellDayStr));
    const bestBuyMonthIdx = Math.max(0, MONTHS_SLO.indexOf(bestBuyMonthStr));
    const bestSellMonthIdx = Math.max(0, MONTHS_SLO.indexOf(bestSellMonthStr));

    const patterns: TimingPatterns = {
      bestBuyDay: bestBuyDayStr,
      bestSellDay: bestSellDayStr,
      bestBuyMonth: bestBuyMonthStr,
      bestSellMonth: bestSellMonthStr,
      optimalHoldPeriod,
      avgProfitByDayOfWeek: computeAvgProfitByDay(analysis),
      avgProfitByMonth: computeAvgProfitByMonth(analysis),
    };

    let optimization = buildDeterministicOptimization(
      analysis, patterns,
      bestBuyDayIdx, bestSellDayIdx, bestBuyMonthIdx, bestSellMonthIdx,
    );
    let summary = buildSummary(patterns, optimization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `market-timing-profit-optimizer:${currentMonth}`;
    const cached = getCachedAI<{
      optimization: TimingOptimization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        patterns,
        optimization: cached.optimization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies MarketTimingResponse);
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

    const promptData = {
      tradeCount: analysis.tradeCount,
      totalProfit: Math.max(0, round0(analysis.totalProfit)),
      patterns,
      deterministicOptimization: optimization,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        impactMin: IMPACT_MIN, impactMax: IMPACT_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
      },
    };

    const prompt = `Si AI "Market Timing Profit Optimizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za TIMING optimization — identificiraš OPTIMAL TIMING za nakup (najnižje cene) in prodajo (najvišje cene) da MAXIMIZIRAŠ profit. Razlika od seasonal-timing-optimizer (ki optimizira seasonal timing) — ti KOMBINIRAŠ day-of-week + month + hold-period timing za maximum profit. Razlika od auction-timing (ki optimizira auction bid timing) — ti optimiraš BUY+SELL timing za flipping trades. Razlika od optimal-time (ki daje best time to list) — ti daješ best time to BUY in SELL za profit maximization. Razlika od seasonal-planner (ki planira seasonal inventory) — ti fokusiraš na TIMING profitability (kdaj kupiti/prodati za max profit). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira per-source) — ti maksimiziraš PER-TIME-WINDOW profit (kdaj kupiti/prodati).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z buyDate + sellDate):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. optimization.optimalBuyWindow (max 200, slovenski — kdaj kupiti naslednje, specifičen dan + mesec + razlog),
2. optimization.optimalSellWindow (max 200, slovenski — kdaj prodati current inventory),
3. optimization.timingProfitScore [0, 100] (±15 od deterministic; kako well-timed so current trades),
4. optimization.timingOptimizationActions: 3-5 akcij { action (max 200, slovenski), priority HIGH | MEDIUM | LOW, expectedProfitImpact € [0, 50000] },
5. optimization.projectedProfitWithOptimalTiming € [0, 50000] (≥ totalProfit, ≤ totalProfit × 2 anti-hallucination),
6. optimization.profitUpliftFromTiming € [0, 50000] (= projected - totalProfit anti-hallucination),
7. optimization.seasonalAdvice (max 400, slovenski — kaj storiti v upcoming tednih/mesecih),
8. optimization.urgencyLevel: LOW | MEDIUM | HIGH | CRITICAL (kako time-sensitive so current opportunities),
9. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "optimization": {
    "optimalBuyWindow": "Naslednji Torek v Dec — najnižje cene (18% pod avg).",
    "optimalSellWindow": "Naslednji Petek v Nov — najvišje cene (12% nad avg).",
    "timingProfitScore": 62,
    "timingOptimizationActions": [
      { "action": "Kupuj na Torek.", "priority": "HIGH", "expectedProfitImpact": 380 },
      { "action": "Prodajaj na Petek.", "priority": "HIGH", "expectedProfitImpact": 420 }
    ],
    "projectedProfitWithOptimalTiming": 8200,
    "profitUpliftFromTiming": 1800,
    "seasonalAdvice": "V prihodnjih tednih: fokusiraj buys na Torek/Dec in sells na Petek/Nov.",
    "urgencyLevel": "HIGH"
  },
  "summary": "Best buy: Torek/Dec. Best sell: Petek/Nov. Optimal hold: 11 dni. Timing score: 62/100. Uplift: +1800€ if perfectly timed."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const aiOpt = parsed.optimization ?? {};

        const totalProfit = Math.max(0, round0(analysis.totalProfit));

        const timingProfitScore = round0(clampNum(
          aiOpt.timingProfitScore,
          SCORE_MIN, SCORE_MAX,
          optimization.timingProfitScore,
        ));

        const projectedProfitWithOptimalTiming = round0(clampNum(
          aiOpt.projectedProfitWithOptimalTiming,
          PROFIT_MIN, PROFIT_MAX,
          optimization.projectedProfitWithOptimalTiming,
        ));
        // Anti-hallucination: projected must be ≥ totalProfit and ≤ totalProfit × 2
        const projectedLowBound = totalProfit;
        const projectedHighBound = Math.min(PROFIT_MAX, totalProfit * 2);
        const clampedProjected = round0(
          Math.max(projectedLowBound, Math.min(projectedHighBound, projectedProfitWithOptimalTiming)),
        );

        const profitUpliftFromTiming = round0(clampNum(
          aiOpt.profitUpliftFromTiming,
          UPLIFT_MIN, UPLIFT_MAX,
          Math.max(0, clampedProjected - totalProfit),
        ));
        // Anti-hallucination: uplift must = projected - totalProfit (within ±10% tolerance)
        const expectedUplift = Math.max(0, clampedProjected - totalProfit);
        const finalUplift = Math.abs(profitUpliftFromTiming - expectedUplift) <= Math.max(10, expectedUplift * 0.1)
          ? profitUpliftFromTiming
          : round0(expectedUplift);

        const optimalBuyWindow = clampString(aiOpt.optimalBuyWindow, 200, optimization.optimalBuyWindow);
        const optimalSellWindow = clampString(aiOpt.optimalSellWindow, 200, optimization.optimalSellWindow);

        const timingOptimizationActions: TimingOptimizationAction[] = [];
        if (Array.isArray(aiOpt.timingOptimizationActions)) {
          for (const a of aiOpt.timingOptimizationActions.slice(0, 5)) {
            if (!a || typeof a !== 'object') continue;
            timingOptimizationActions.push({
              action: clampString(a.action, 200, 'Timing akcija.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
              expectedProfitImpact: round0(clampNum(
                a.expectedProfitImpact,
                IMPACT_MIN, IMPACT_MAX, 0,
              )),
            });
          }
        }
        if (timingOptimizationActions.length === 0) {
          for (const a of optimization.timingOptimizationActions) timingOptimizationActions.push(a);
        }

        const seasonalAdvice = clampString(aiOpt.seasonalAdvice, 400, optimization.seasonalAdvice);
        const urgencyLevel = clampEnum(aiOpt.urgencyLevel, VALID_URGENCY, optimization.urgencyLevel);

        optimization = {
          optimalBuyWindow,
          optimalSellWindow,
          timingProfitScore,
          timingOptimizationActions,
          projectedProfitWithOptimalTiming: clampedProjected,
          profitUpliftFromTiming: finalUplift,
          seasonalAdvice,
          urgencyLevel,
        };

        summary = clampString(parsed.summary, 400, buildSummary(patterns, optimization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-timing-profit-optimizer',
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
      patterns,
      optimization,
      summary,
      aiUsed,
    } satisfies MarketTimingResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/market-timing-profit-optimizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
