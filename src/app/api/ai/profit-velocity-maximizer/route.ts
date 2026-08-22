// v7.98 / v8.96.7-batch2: AI Profit Velocity Maximizer — AI maksimizira VELOCITY of profit
// generation — kako hitro profit accumulira over time. Identificira bottlenecks
// v profit flow in actions da pospeši profit generation. The "ultimate profit
// velocity maximizer."
//
// Razlika od profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers)
// — ta maksimizira VELOCITY (€/day, acceleration, time-to-double). Razlika od
// deal-source-profit-maximizer (v7.97 ki maksimizira per-source) — ta maksimizira
// per-VELOCITY (kako hitro profit accumulira). Razlika od market-timing-profit-
// optimizer (v7.97 ki optimira timing) — ta optimira VELOCITY (rate of profit
// accumulation). Razlika od inventory-value-maximizer (v7.97 ki maksimizira
// value) — ta maksimizira cash velocity (kako hitro capital cikla). Razlika od
// cash-recovery-accelerator (v7.96 ki accelerira cash recovery) — ta maksimizira
// VELOCITY of profit generation (€/day rate + acceleration). Razlika od
// profit-accelerator (v7.96 ki accelera profit) — ta KOMBINIRA velocity +
// acceleration + bottleneck analysis + time-to-double forecast. Razlika od
// profit-margin-acceleration-tracker (ki track-a margin accel) — ta fokusira na
// profit velocity (€/day, ne margin %). Razlika od profit-momentum-tracker (ki
// track-a momentum) — ta maksimizira velocity z actionable bottleneck removal.
// Razlika od profit-trajectory-forecaster (ki napove trajectory) — ta daje
// velocity-maximization actions + time-to-double projection.
//
// "Your profit velocity is 45€/day, but could be 72€/day if you reduce hold
// time by 5 days. Hold bottleneck: 12€/day lost (avg 28d hold, target 14d).
// Pricing bottleneck: 8€/day lost (12% below estValue). Volume bottleneck:
// 5€/day lost (2.1 trades/wk, target 3.5). Projected monthly: 2,160€ (grade
// B). Time to double profit: 47 days at maximized velocity."
//
// GET+POST /api/ai/profit-velocity-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitVelocityMaximizerInput {}

// --- Types ---------------------------------------------------------------

type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type VelocityGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
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

interface VelocityCurrent {
  currentDailyProfitRate: number; // €/day (last 30d)
  avgDailyProfitRate90d: number; // €/day (last 90d)
  profitVelocity: number; // trend slope (€/day change per day)
  profitAcceleration: number; // 2nd derivative
  profitVelocityScore: number; // 0-100
}

interface HoldTimeBottleneck {
  profitLost: number; // €/day lost due to slow turnover
  avgHoldDays: number;
  potentialGain: number; // €/day if hold time reduced
}

interface PricingBottleneck {
  profitLost: number; // €/day lost due to suboptimal pricing
  priceGap: number; // % below estValue (avg)
  potentialGain: number; // €/day if pricing optimized
}

interface VolumeBottleneck {
  profitLost: number; // €/day lost due to low trade count
  tradeCountGap: number; // trades/week below target
  potentialGain: number; // €/day if volume increased
}

interface CategoryBottleneckEntry {
  category: string;
  velocityImpact: number; // €/day impact (positive = slows velocity)
  action: string;
}

interface VelocityBottlenecks {
  holdTimeBottleneck: HoldTimeBottleneck;
  pricingBottleneck: PricingBottleneck;
  volumeBottleneck: VolumeBottleneck;
  categoryBottleneck: CategoryBottleneckEntry[];
}

interface VelocityMaximizationAction {
  action: string;
  priority: ActionPriority;
  expectedVelocityGain: number; // €/day gain
}

interface VelocityMaximization {
  maximizedDailyProfitRate: number; // €/day
  profitVelocityUplift: number; // €/day additional
  velocityMaximizationActions: VelocityMaximizationAction[];
  projectedMonthlyProfit: number; // €
  velocityGrade: VelocityGrade;
  timeToDoubleProfit: number; // days
  capitalVelocityOptimization: string;
}

interface ProfitVelocityResponse {
  ok: true;
  current: VelocityCurrent;
  bottlenecks: VelocityBottlenecks;
  maximization: VelocityMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedDailyProfitRate?: number;
    profitVelocityUplift?: number;
    velocityMaximizationActions?: Array<{
      action?: string;
      priority?: ActionPriority;
      expectedVelocityGain?: number;
    }>;
    projectedMonthlyProfit?: number;
    velocityGrade?: VelocityGrade;
    timeToDoubleProfit?: number;
    capitalVelocityOptimization?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const RATE_MIN = 0;
const RATE_MAX = 10_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 10_000;
const GAP_PCT_MIN = 0;
const GAP_PCT_MAX = 100;
const DAYS_MIN = 1;
const DAYS_MAX = 3650;
const TARGET_HOLD_DAYS = 14; // optimal hold time target
const TARGET_TRADES_PER_WEEK = 3.5; // optimal trade volume target

const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_GRADE: readonly VelocityGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

// --- Deterministic computation ------------------------------------------

interface TradeVelocity {
  sellMs: number;
  sellDayIdx30: number; // 0..29 (within last 30 days, or -1)
  sellDayIdx90: number; // 0..89 (within last 90 days, or -1)
  profit: number;
  holdDays: number;
  buyEstGapPct: number | null; // % below estValue (positive = bought below value)
  category: string;
}

function computeTradeVelocity(t: SoldTradeRow, now: number): TradeVelocity | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;

  const sellMs = toMs(t.sellDate);
  const buyMs = toMs(t.buyDate);
  if (sellMs <= 0) return null;

  const cost = buyPrice + buyFees;
  const profit = (sellPrice - sellFees) - cost;

  const holdDays = buyMs > 0
    ? Math.max(0, Math.round((sellMs - buyMs) / DAY_MS))
    : 0;

  const daysAgo = Math.max(0, Math.round((now - sellMs) / DAY_MS));
  const sellDayIdx30 = daysAgo < 30 ? daysAgo : -1;
  const sellDayIdx90 = daysAgo < 90 ? daysAgo : -1;

  const estValue = t.listing?.aiEstimatedValue ?? null;
  const buyEstGapPct = estValue && estValue > 0 && buyPrice > 0
    ? Math.round(((estValue - buyPrice) / estValue) * 100)
    : null;

  return {
    sellMs,
    sellDayIdx30,
    sellDayIdx90,
    profit,
    holdDays,
    buyEstGapPct,
    category: (t.category || 'drugo').toLowerCase().slice(0, 50),
  };
}

interface DailyBucket {
  sumProfit: number;
  count: number;
}

interface VelocityAnalysis {
  totalProfit30d: number;
  totalProfit90d: number;
  totalProfit12m: number;
  tradeCount30d: number;
  tradeCount90d: number;
  tradeCount12m: number;
  daily30: DailyBucket[]; // 30 entries (oldest first → newest)
  daily90: DailyBucket[]; // 90 entries
  avgHoldDays: number;
  avgBuyEstGapPct: number; // avg % below estValue
  categoryStats: Map<string, { sumProfit: number; count: number; avgHoldDays: number; totalHoldDays: number }>;
}

function analyzeVelocity(trades: TradeVelocity[]): VelocityAnalysis {
  const daily30: DailyBucket[] = Array.from({ length: 30 }, () => ({ sumProfit: 0, count: 0 }));
  const daily90: DailyBucket[] = Array.from({ length: 90 }, () => ({ sumProfit: 0, count: 0 }));

  let totalProfit30d = 0;
  let totalProfit90d = 0;
  let totalProfit12m = 0;
  let tradeCount30d = 0;
  let tradeCount90d = 0;
  let tradeCount12m = 0;
  let totalHoldDays = 0;
  let holdCount = 0;
  let totalBuyEstGap = 0;
  let buyEstGapCount = 0;
  const categoryStats = new Map<string, { sumProfit: number; count: number; avgHoldDays: number; totalHoldDays: number }>();

  for (const t of trades) {
    totalProfit12m += t.profit;
    tradeCount12m += 1;

    if (t.sellDayIdx30 >= 0) {
      const b = daily30[29 - t.sellDayIdx30]; // index 0 = oldest (29 days ago), 29 = today
      b.sumProfit += t.profit;
      b.count += 1;
      totalProfit30d += t.profit;
      tradeCount30d += 1;
    }

    if (t.sellDayIdx90 >= 0) {
      const b = daily90[89 - t.sellDayIdx90];
      b.sumProfit += t.profit;
      b.count += 1;
      totalProfit90d += t.profit;
      tradeCount90d += 1;
    }

    if (t.holdDays > 0) {
      totalHoldDays += t.holdDays;
      holdCount += 1;
    }

    if (t.buyEstGapPct !== null) {
      totalBuyEstGap += t.buyEstGapPct;
      buyEstGapCount += 1;
    }

    let cs = categoryStats.get(t.category);
    if (!cs) {
      cs = { sumProfit: 0, count: 0, avgHoldDays: 0, totalHoldDays: 0 };
      categoryStats.set(t.category, cs);
    }
    cs.sumProfit += t.profit;
    cs.count += 1;
    if (t.holdDays > 0) cs.totalHoldDays += t.holdDays;
  }

  for (const [, cs] of categoryStats) {
    cs.avgHoldDays = cs.count > 0 ? cs.totalHoldDays / cs.count : 0;
  }

  return {
    totalProfit30d,
    totalProfit90d,
    totalProfit12m,
    tradeCount30d,
    tradeCount90d,
    tradeCount12m,
    daily30,
    daily90,
    avgHoldDays: holdCount > 0 ? totalHoldDays / holdCount : 0,
    avgBuyEstGapPct: buyEstGapCount > 0 ? totalBuyEstGap / buyEstGapCount : 0,
    categoryStats,
  };
}

function linearSlope(arr: DailyBucket[]): number {
  const n = arr.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, nonEmpty = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = arr[i].sumProfit;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    if (arr[i].count > 0) nonEmpty += 1;
  }
  if (nonEmpty < 2) return 0;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function computeVelocityCurrent(analysis: VelocityAnalysis): VelocityCurrent {
  const currentDailyProfitRate = round2(
    clampNum(analysis.totalProfit30d / 30, RATE_MIN, RATE_MAX, 0),
  );
  const avgDailyProfitRate90d = round2(
    clampNum(analysis.totalProfit90d / 90, RATE_MIN, RATE_MAX, 0),
  );

  // Profit velocity = linear regression slope of daily profit over last 30 days
  const slope = linearSlope(analysis.daily30);
  const profitVelocity = round2(clampNum(slope, -RATE_MAX, RATE_MAX, 0));

  // Profit acceleration = 2nd derivative (change in slope between first half and second half of 90 days)
  const firstHalfSlope = linearSlope(analysis.daily90.slice(0, 45));
  const secondHalfSlope = linearSlope(analysis.daily90.slice(45));
  const profitAcceleration = round2(
    clampNum(secondHalfSlope - firstHalfSlope, -RATE_MAX, RATE_MAX, 0),
  );

  // Profit velocity score 0-100:
  // - 30% absolute daily rate (rate vs target 100€/day)
  // - 30% velocity (slope positive & large)
  // - 20% acceleration (positive)
  // - 20% volume (trade count vs target)
  const rateNorm = Math.min(100, (currentDailyProfitRate / 100) * 100);
  const velNorm = Math.max(0, Math.min(100, 50 + profitVelocity * 10));
  const accelNorm = Math.max(0, Math.min(100, 50 + profitAcceleration * 5));
  const volNorm = Math.min(100, (analysis.tradeCount30d / 15) * 100);
  const score = round0(clampNum(
    rateNorm * 0.3 + velNorm * 0.3 + accelNorm * 0.2 + volNorm * 0.2,
    SCORE_MIN, SCORE_MAX, 30,
  ));

  return {
    currentDailyProfitRate,
    avgDailyProfitRate90d,
    profitVelocity,
    profitAcceleration,
    profitVelocityScore: score,
  };
}

function computeBottlenecks(
  analysis: VelocityAnalysis,
  current: VelocityCurrent,
): VelocityBottlenecks {
  const avgHoldDays = analysis.avgHoldDays;

  // Hold time bottleneck: profit/day lost due to slow turnover
  // If hold time > TARGET_HOLD_DAYS, trades cycle slower → less daily profit
  const holdMultiplier = avgHoldDays > 0 && TARGET_HOLD_DAYS > 0
    ? Math.min(2.5, avgHoldDays / TARGET_HOLD_DAYS)
    : 1;
  const holdProfitLost = round2(clampNum(
    current.currentDailyProfitRate * (holdMultiplier - 1) / holdMultiplier,
    0, UPLIFT_MAX, 0,
  ));
  const holdPotentialGain = round2(clampNum(
    current.currentDailyProfitRate * (holdMultiplier - 1),
    0, UPLIFT_MAX, 0,
  ));

  // Pricing bottleneck: profit/day lost due to suboptimal pricing
  const avgBuyEstGap = analysis.avgBuyEstGapPct; // % below estValue
  const priceGap = round0(clampNum(
    Math.max(0, 30 - avgBuyEstGap), // if buying at 30% below value is "optimal"
    GAP_PCT_MIN, GAP_PCT_MAX, 0,
  ));
  const avgTradeProfit = analysis.tradeCount12m > 0
    ? Math.max(0, analysis.totalProfit12m) / analysis.tradeCount12m
    : 0;
  const pricingProfitLost = round2(clampNum(
    (priceGap / 100) * avgTradeProfit * (analysis.tradeCount30d / 30),
    0, UPLIFT_MAX, 0,
  ));
  const pricingPotentialGain = round2(clampNum(
    (priceGap / 100) * avgTradeProfit * (analysis.tradeCount30d / 30),
    0, UPLIFT_MAX, 0,
  ));

  // Volume bottleneck: profit/day lost due to low trade count
  const tradesPerWeek = analysis.tradeCount30d / (30 / 7);
  const volumeGap = round0(clampNum(
    Math.max(0, TARGET_TRADES_PER_WEEK - tradesPerWeek),
    0, 100, 0,
  ));
  const avgProfitPerTrade = analysis.tradeCount30d > 0
    ? Math.max(0, analysis.totalProfit30d) / analysis.tradeCount30d
    : 0;
  const volumeProfitLost = round2(clampNum(
    (volumeGap / 7) * avgProfitPerTrade, // per day
    0, UPLIFT_MAX, 0,
  ));
  const volumePotentialGain = round2(clampNum(
    (volumeGap / 7) * avgProfitPerTrade,
    0, UPLIFT_MAX, 0,
  ));

  // Category bottleneck: categories with slowest velocity (longest hold, lowest profit)
  const categoryList: CategoryBottleneckEntry[] = [];
  for (const [cat, cs] of analysis.categoryStats) {
    if (cs.count < 1) continue;
    const catAvgProfit = cs.sumProfit / cs.count;
    const catAvgHold = cs.avgHoldDays;
    // Velocity impact: positive = this category slows velocity
    const holdImpact = (catAvgHold - avgHoldDays) * 0.5;
    const profitImpact = (avgTradeProfit - catAvgProfit) * 0.1;
    const velocityImpact = round2(clampNum(
      holdImpact + profitImpact,
      0, 1000, 0,
    ));
    if (velocityImpact > 0) {
      const action = clampString(
        `Zmanjšaj fokus na "${cat}" (avg hold ${Math.round(catAvgHold)} dni, avg profit ${Math.round(catAvgProfit)}€) — premakni kapital v hitrejše kategorije.`,
        200,
        `Premakni kapital iz "${cat}" v hitrejše kategorije.`,
      );
      categoryList.push({ category: cat, velocityImpact, action });
    }
  }
  categoryList.sort((a, b) => b.velocityImpact - a.velocityImpact);
  const categoryBottleneck = categoryList.slice(0, 5);

  return {
    holdTimeBottleneck: {
      profitLost: holdProfitLost,
      avgHoldDays: round0(avgHoldDays),
      potentialGain: holdPotentialGain,
    },
    pricingBottleneck: {
      profitLost: pricingProfitLost,
      priceGap,
      potentialGain: pricingPotentialGain,
    },
    volumeBottleneck: {
      profitLost: volumeProfitLost,
      tradeCountGap: volumeGap,
      potentialGain: volumePotentialGain,
    },
    categoryBottleneck,
  };
}

function decideGrade(score: number): VelocityGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: VelocityCurrent,
  bottlenecks: VelocityBottlenecks,
): VelocityMaximization {
  // Maximized daily rate = current + sum of bottleneck potential gains
  const totalUplift = round2(clampNum(
    bottlenecks.holdTimeBottleneck.potentialGain +
    bottlenecks.pricingBottleneck.potentialGain +
    bottlenecks.volumeBottleneck.potentialGain,
    0, UPLIFT_MAX, 0,
  ));
  const maximizedDailyProfitRate = round2(clampNum(
    current.currentDailyProfitRate + totalUplift,
    RATE_MIN, RATE_MAX, current.currentDailyProfitRate,
  ));
  const profitVelocityUplift = round2(clampNum(
    totalUplift,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const projectedMonthlyProfit = round0(clampNum(
    maximizedDailyProfitRate * 30,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const velocityGrade = decideGrade(current.profitVelocityScore);

  // Time to double current cumulative profit
  // cumulative profit (last 12m) / maximized daily rate
  const cumulativeProfit = Math.max(0, current.avgDailyProfitRate90d * 365);
  const timeToDoubleProfit = maximizedDailyProfitRate > 0
    ? round0(clampNum(
      cumulativeProfit / maximizedDailyProfitRate,
      DAYS_MIN, DAYS_MAX, 365,
    ))
    : 365;

  // Actions: 3-5 prioritized
  const actions: VelocityMaximizationAction[] = [];
  if (bottlenecks.holdTimeBottleneck.potentialGain > 0) {
    actions.push({
      action: clampString(
        `Zmanjšaj hold time z ${Math.round(bottlenecks.holdTimeBottleneck.avgHoldDays)} na ${TARGET_HOLD_DAYS} dni — hitrejši turnover.`,
        200,
        `Zmanjšaj hold time na ${TARGET_HOLD_DAYS} dni.`,
      ),
      priority: 'HIGH',
      expectedVelocityGain: round2(clampNum(
        bottlenecks.holdTimeBottleneck.potentialGain,
        0, UPLIFT_MAX, 0,
      )),
    });
  }
  if (bottlenecks.pricingBottleneck.potentialGain > 0) {
    actions.push({
      action: clampString(
        `Izboljšaj pricing — kupuj ${bottlenecks.pricingBottleneck.priceGap}% ceneje ali prodajaj višje.`,
        200,
        `Izboljšaj pricing gap (${bottlenecks.pricingBottleneck.priceGap}%).`,
      ),
      priority: 'HIGH',
      expectedVelocityGain: round2(clampNum(
        bottlenecks.pricingBottleneck.potentialGain,
        0, UPLIFT_MAX, 0,
      )),
    });
  }
  if (bottlenecks.volumeBottleneck.potentialGain > 0) {
    actions.push({
      action: clampString(
        `Povečaj volume z ${Math.round(bottlenecks.volumeBottleneck.tradeCountGap)} trades/teden — več dealov na teden.`,
        200,
        `Povečaj volume (+${Math.round(bottlenecks.volumeBottleneck.tradeCountGap)} trades/teden).`,
      ),
      priority: 'MEDIUM',
      expectedVelocityGain: round2(clampNum(
        bottlenecks.volumeBottleneck.potentialGain,
        0, UPLIFT_MAX, 0,
      )),
    });
  }
  if (bottlenecks.categoryBottleneck.length > 0) {
    const topCat = bottlenecks.categoryBottleneck[0];
    actions.push({
      action: clampString(
        `Premakni kapital iz "${topCat.category}" (slow velocity) v hitrejše kategorije.`,
        200,
        `Premakni kapital iz "${topCat.category}".`,
      ),
      priority: 'MEDIUM',
      expectedVelocityGain: round2(clampNum(
        topCat.velocityImpact,
        0, UPLIFT_MAX, 0,
      )),
    });
  }
  // Ensure at least 3 actions
  if (actions.length < 3) {
    actions.push({
      action: clampString(
        `Ciklaj kapital hitreje — reinvestiraj profit v nove deals v roku 24h.`,
        200,
        `Ciklaj kapital hitreje.`,
      ),
      priority: 'LOW',
      expectedVelocityGain: round2(clampNum(totalUplift * 0.1, 0, UPLIFT_MAX, 0)),
    });
  }

  const capitalVelocityOptimization = clampString(
    `Ciklaj kapital hitreje: prodaj vsak dan, reinvestiraj profit v nove deals v 24h. Hitrejši turnover = višji dnevni profit rate. Current velocity: ${current.currentDailyProfitRate}€/dan, maximized: ${maximizedDailyProfitRate}€/dan.`,
    400,
    `Ciklaj kapital hitreje za višji dnevni profit rate.`,
  );

  return {
    maximizedDailyProfitRate,
    profitVelocityUplift,
    velocityMaximizationActions: actions.slice(0, 5),
    projectedMonthlyProfit,
    velocityGrade,
    timeToDoubleProfit,
    capitalVelocityOptimization,
  };
}

function buildSummary(
  current: VelocityCurrent,
  maximization: VelocityMaximization,
): string {
  const parts: string[] = [
    `Velocity: ${current.currentDailyProfitRate}€/dan (90d avg ${current.avgDailyProfitRate90d}€/dan).`,
    `Score: ${current.profitVelocityScore}/100 (grade ${maximization.velocityGrade}).`,
    `Maximized: ${maximization.maximizedDailyProfitRate}€/dan (+${maximization.profitVelocityUplift}€/dan uplift).`,
    `Monthly: ${maximization.projectedMonthlyProfit}€. Time to double: ${maximization.timeToDoubleProfit} dni.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

const profitVelocityMaximizerHandler = withAiRoute<ProfitVelocityMaximizerInput>({
  endpoint: '/api/ai/profit-velocity-maximizer',
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
        title: true,
        category: true,
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
      return apiOk({
        ok: true,
        current: {
          currentDailyProfitRate: 0,
          avgDailyProfitRate90d: 0,
          profitVelocity: 0,
          profitAcceleration: 0,
          profitVelocityScore: 0,
        },
        bottlenecks: {
          holdTimeBottleneck: { profitLost: 0, avgHoldDays: 0, potentialGain: 0 },
          pricingBottleneck: { profitLost: 0, priceGap: 0, potentialGain: 0 },
          volumeBottleneck: { profitLost: 0, tradeCountGap: 0, potentialGain: 0 },
          categoryBottleneck: [],
        },
        maximization: {
          maximizedDailyProfitRate: 0,
          profitVelocityUplift: 0,
          velocityMaximizationActions: [],
          projectedMonthlyProfit: 0,
          velocityGrade: 'F',
          timeToDoubleProfit: 365,
          capitalVelocityOptimization: 'Ni SOLD trgovin v zadnjih 12 mesecih — velocity maximization ni mogoč.',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Velocity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Velocity Maximizer ni mogoč.',
      } satisfies ProfitVelocityResponse);
    }

    // 2) Compute velocity metrics
    const tradeVelocities: TradeVelocity[] = [];
    for (const t of soldTrades) {
      const tv = computeTradeVelocity(t, now);
      if (tv) tradeVelocities.push(tv);
    }

    if (tradeVelocities.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentDailyProfitRate: 0,
          avgDailyProfitRate90d: 0,
          profitVelocity: 0,
          profitAcceleration: 0,
          profitVelocityScore: 0,
        },
        bottlenecks: {
          holdTimeBottleneck: { profitLost: 0, avgHoldDays: 0, potentialGain: 0 },
          pricingBottleneck: { profitLost: 0, priceGap: 0, potentialGain: 0 },
          volumeBottleneck: { profitLost: 0, tradeCountGap: 0, potentialGain: 0 },
          categoryBottleneck: [],
        },
        maximization: {
          maximizedDailyProfitRate: 0,
          profitVelocityUplift: 0,
          velocityMaximizationActions: [],
          projectedMonthlyProfit: 0,
          velocityGrade: 'F',
          timeToDoubleProfit: 365,
          capitalVelocityOptimization: 'Ni veljavnih sell datumov — velocity maximization ni mogoč.',
        },
        summary: 'Ni veljavnih sell datumov — Profit Velocity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih sell datumov — Profit Velocity Maximizer ni mogoč.',
      } satisfies ProfitVelocityResponse);
    }

    const analysis = analyzeVelocity(tradeVelocities);
    const current = computeVelocityCurrent(analysis);
    const bottlenecks = computeBottlenecks(analysis, current);

    let maximization = buildDeterministicMaximization(current, bottlenecks);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-velocity-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: VelocityMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        bottlenecks,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitVelocityResponse);
    }

    // 4) AI prompt with grounding
    const promptData = {
      tradeCount12m: analysis.tradeCount12m,
      totalProfit12m: Math.max(0, round0(analysis.totalProfit12m)),
      current,
      bottlenecks,
      deterministicMaximization: maximization,
      caps: {
        rateMin: RATE_MIN, rateMax: RATE_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        daysMin: DAYS_MIN, daysMax: DAYS_MAX,
      },
    };

    const prompt = `Si AI "Profit Velocity Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za VELOCITY maximization — identificiraš kako MAXIMIZIRATI velocity of profit generation (€/day, acceleration, time-to-double). Razlika od profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers) — ti maksimiziraš VELOCITY (€/day, acceleration, time-to-double). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira per-source) — ti maksimiziraš per-VELOCITY (kako hitro profit accumulira). Razlika od market-timing-profit-optimizer (v7.97 ki optimira timing) — ti optimiraš VELOCITY (rate of profit accumulation). Razlika od inventory-value-maximizer (v7.97 ki maksimizira value) — ti maksimiziraš cash velocity (kako hitro capital cikla). Razlika od cash-recovery-accelerator (v7.96 ki accelerira cash recovery) — ti maksimiziraš VELOCITY of profit generation (€/day rate + acceleration). Razlika od profit-accelerator (v7.96 ki accelera profit) — ti KOMBINIRAŠ velocity + acceleration + bottleneck analysis + time-to-double forecast. Razlika od profit-momentum-tracker (ki track-a momentum) — ti maksimiziraš velocity z actionable bottleneck removal.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedDailyProfitRate €/dan [0, 10000] (≥ currentDailyProfitRate, ≤ currentDailyProfitRate × 3 anti-hallucination),
2. maximization.profitVelocityUplift €/dan [0, 10000] (= maximized - current),
3. maximization.velocityMaximizationActions: 3-5 akcij { action (max 200, slovenski), priority HIGH | MEDIUM | LOW, expectedVelocityGain €/dan [0, 10000] },
4. maximization.projectedMonthlyProfit € [0, 100000] (= maximizedDailyProfitRate × 30),
5. maximization.velocityGrade: A+ | A | B | C | D | F (glede na profitVelocityScore: ≥90 A+, ≥80 A, ≥70 B, ≥55 C, ≥40 D, else F),
6. maximization.timeToDoubleProfit dni [1, 3650] (koliko dni da podvojiš current cumulative profit pri maximized velocity),
7. maximization.capitalVelocityOptimization (max 400, slovenski — kako ciklati kapital hitreje za višjo velocity),
8. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "maximization": {
    "maximizedDailyProfitRate": 72,
    "profitVelocityUplift": 27,
    "velocityMaximizationActions": [
      { "action": "Zmanjšaj hold time z 28 na 14 dni.", "priority": "HIGH", "expectedVelocityGain": 12 },
      { "action": "Izboljšaj pricing (12% gap).", "priority": "HIGH", "expectedVelocityGain": 8 },
      { "action": "Povečaj volume (+1.4 trades/teden).", "priority": "MEDIUM", "expectedVelocityGain": 5 }
    ],
    "projectedMonthlyProfit": 2160,
    "velocityGrade": "B",
    "timeToDoubleProfit": 47,
    "capitalVelocityOptimization": "Ciklaj kapital hitreje: prodaj vsak dan, reinvestiraj profit v nove deals v 24h."
  },
  "summary": "Velocity: 45€/dan (90d avg 38€/dan). Score: 62/100 (grade B). Maximized: 72€/dan (+27€/dan uplift). Monthly: 2160€. Time to double: 47 dni."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const aiMax = parsed.maximization ?? {};

        // Anti-hallucination: maximizedDailyProfitRate clamped to [current, current × 3]
        const maxRateLowBound = current.currentDailyProfitRate;
        const maxRateHighBound = Math.min(RATE_MAX, current.currentDailyProfitRate * 3);
        const aiMaxRate = round2(clampNum(
          aiMax.maximizedDailyProfitRate,
          RATE_MIN, RATE_MAX,
          maximization.maximizedDailyProfitRate,
        ));
        const maximizedDailyProfitRate = round2(
          Math.max(maxRateLowBound, Math.min(maxRateHighBound, aiMaxRate)),
        );

        // profitVelocityUplift = maximized - current (anti-hallucination: within ±10% tolerance else recompute)
        const expectedUplift = Math.max(0, maximizedDailyProfitRate - current.currentDailyProfitRate);
        const aiUplift = round2(clampNum(
          aiMax.profitVelocityUplift,
          UPLIFT_MIN, UPLIFT_MAX,
          expectedUplift,
        ));
        const profitVelocityUplift = Math.abs(aiUplift - expectedUplift) <= Math.max(0.5, expectedUplift * 0.1)
          ? aiUplift
          : round2(expectedUplift);

        // velocityMaximizationActions
        const actions: VelocityMaximizationAction[] = [];
        if (Array.isArray(aiMax.velocityMaximizationActions)) {
          for (const a of aiMax.velocityMaximizationActions.slice(0, 5)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, 'Velocity akcija.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
              expectedVelocityGain: round2(clampNum(
                a.expectedVelocityGain,
                0, UPLIFT_MAX, 0,
              )),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of maximization.velocityMaximizationActions) actions.push(a);
        }

        // projectedMonthlyProfit = maximized × 30 (anti-hallucination)
        const expectedMonthly = round0(clampNum(
          maximizedDailyProfitRate * 30,
          PROFIT_MIN, PROFIT_MAX, 0,
        ));
        const projectedMonthlyProfit = round0(clampNum(
          aiMax.projectedMonthlyProfit,
          PROFIT_MIN, PROFIT_MAX,
          expectedMonthly,
        ));

        const velocityGrade = clampEnum(
          aiMax.velocityGrade,
          VALID_GRADE,
          maximization.velocityGrade,
        );

        const timeToDoubleProfit = round0(clampNum(
          aiMax.timeToDoubleProfit,
          DAYS_MIN, DAYS_MAX,
          maximization.timeToDoubleProfit,
        ));

        const capitalVelocityOptimization = clampString(
          aiMax.capitalVelocityOptimization,
          400,
          maximization.capitalVelocityOptimization,
        );

        maximization = {
          maximizedDailyProfitRate,
          profitVelocityUplift,
          velocityMaximizationActions: actions,
          projectedMonthlyProfit,
          velocityGrade,
          timeToDoubleProfit,
          capitalVelocityOptimization,
        };

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-velocity-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      bottlenecks,
      maximization,
      summary,
      aiUsed,
    } satisfies ProfitVelocityResponse);
  },
});

export const GET = profitVelocityMaximizerHandler;
export const POST = profitVelocityMaximizerHandler;
