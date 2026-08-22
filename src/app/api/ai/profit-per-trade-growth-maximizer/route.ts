// v8.10 / v8.96.6-batch4: AI Profit Per Trade Growth Maximizer — AI MAKSIMIZIRA GROWTH profit-a
// per trade — ne samo trenutni profit per trade, ampak koliko hitro raste in
// kako pospešiti to rast. "Tvoj profit per trade raste +2€/mesec, ampak bi
// lahko rasel +8€/mesec z temi akcijami." Razlika od profit-multiplier-maximizer
// (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ta
// MAKSIMIZIRA GROWTH RATE profit-a per trade (€/mo kako hitro raste, ne ×
// koliko-krat). Razlika od inventory-profit-per-day-growth-maximizer (v8.09 ki
// maksimizira growth rate daily profit-a iz inventory-ja v %/teden) — ta
// MAKSIMIZIRA GROWTH RATE profit-a PER TRADE v €/mesec (absolutni €/mo per
// trade growth, ne %/teden daily profit). Razlika od profit-per-day-scaling-
// maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ta
// MAKSIMIZIRA GROWTH RATE profit-a per trade (€/mo ramp, ne €/dan scaling).
// Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate
// acceleration) — ta MAKSIMIZIRA GROWTH RATE profit-a per trade z
// growthActions IMPROVE_SOURCING/RAISE_PRICES/REDUCE_FEES/TARGET_PREMIUM/
// TIMING_OPTIMIZATION in doublingTime v mesecih. Razlika od revenue-per-trade-
// maximizer (v8.06 ki maksimizira top-line sell price per trade) — ta
// MAKSIMIZIRA GROWTH RATE profit-a per trade (€/mo growth, ne absolutni sell
// price). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki
// maksimizira profit per trade per source) — ta MAKSIMIZIRA GROWTH RATE
// profit-a per trade čez celoten portfolio z growthTrajectory 12-month
// projection in growthGrade. Razlika od profit-velocity-maximizer (v7.98 ki
// maksimizira €/day velocity) — ta MAKSIMIZIRA GROWTH €/mo per trade, ne
// €/dan velocity. Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira
// profit per euro deployed) — ta MAKSIMIZIRA GROWTH profit-a per trade (€/mo
// growth, ne €/€ ratio). Razlika od inventory-profit-per-day-maximizer (v8.02
// ki maksimizira daily profit per item) — ta MAKSIMIZIRA GROWTH RATE profit-a
// per trade (€/mo ramp, ne €/dan per item).

// GET+POST /api/ai/profit-per-trade-growth-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type GrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type GrowthActionType =
  | 'IMPROVE_SOURCING'
  | 'RAISE_PRICES'
  | 'REDUCE_FEES'
  | 'TARGET_PREMIUM'
  | 'TIMING_OPTIMIZATION';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface MonthBucket {
  monthIndex: number; // 0 = oldest, 11 = newest (last 12 months)
  monthLabel: string; // YYYY-MM
  profitSum: number;
  tradeCount: number;
}

interface CurrentState {
  monthlyAvgProfitPerTrade: number; // € (avg over 12m)
  currentMonthlyProfitPerTrade: number; // € (last month)
  profitPerTradeGrowthRate: number; // €/mo (linear regression slope)
  profitPerTradeTrend: number; // % (current vs 6mo ago)
  profitPerTradeAcceleration: number; // €/mo² (slope of last half vs first half)
  totalProfit12m: number; // €
  soldCount12m: number;
  bestMonthProfit: number; // €
  worstMonthProfit: number; // €
  monthsWithData: number;
}

interface GrowthAction {
  action: GrowthActionType;
  description: string; // slovenski, max 200
  expectedGrowthLift: number; // €/mo additional profit per trade
  timeline: string; // slovenski, max 100
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

interface GrowthTrajectoryEntry {
  month: number; // 1-12
  currentProjectedProfitPerTrade: number; // € projected at current growth rate
  maximizedProjectedProfitPerTrade: number; // € projected at maximized growth rate
}

interface ProfitPerTradeGrowthMaximization {
  currentGrowthRate: number; // €/mo (echoes current)
  maximizedGrowthRate: number; // €/mo optimal achievable
  growthUplift: number; // €/mo improvement = maximized − current
  growthActions: GrowthAction[]; // 5 entries
  growthTrajectory: GrowthTrajectoryEntry[]; // 12 entries (months 1-12)
  growthBottlenecks: string[]; // 3-5 slovenian strings
  growthGrade: GrowthGrade;
  doublingTime: number; // months to double profit per trade at maximized growth
}

interface ProfitPerTradeGrowthResponse {
  ok: true;
  current: CurrentState;
  maximization: ProfitPerTradeGrowthMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    currentGrowthRate?: number;
    maximizedGrowthRate?: number;
    growthUplift?: number;
    growthActions?: Array<{
      action?: GrowthActionType;
      description?: string;
      expectedGrowthLift?: number;
      timeline?: string;
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    }>;
    growthTrajectory?: Array<{
      month?: number;
      currentProjectedProfitPerTrade?: number;
      maximizedProjectedProfitPerTrade?: number;
    }>;
    growthBottlenecks?: string[];
    growthGrade?: GrowthGrade;
    doublingTime?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_PER_TRADE_MIN = 0;
const PROFIT_PER_TRADE_MAX = 10_000;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100;
const PROJECTION_MIN = 0;
const PROJECTION_MAX = 10_000;
const MONTHS_MIN = 1;
const MONTHS_MAX = 120;
const TOTAL_PROFIT_MIN = -100_000;
const TOTAL_PROFIT_MAX = 1_000_000;

const VALID_GRADE: readonly GrowthGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_ACTION_TYPE: readonly GrowthActionType[] = [
  'IMPROVE_SOURCING',
  'RAISE_PRICES',
  'REDUCE_FEES',
  'TARGET_PREMIUM',
  'TIMING_OPTIMIZATION',
];
const VALID_DIFFICULTY: readonly ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];

const MAX_ACTIONS = 5;
const MAX_TRAJECTORY = 12;
const MAX_BOTTLENECKS = 5;
const MAX_TRADES_FOR_AI = 250;

// Action uplift per action type (€/mo additional profit per trade)
const ACTION_GROWTH_GAIN: Record<GrowthActionType, number> = {
  IMPROVE_SOURCING: 3.5, // +3.50€/mo from better buy prices
  RAISE_PRICES: 2.8, // +2.80€/mo from optimal sell prices
  REDUCE_FEES: 1.5, // +1.50€/mo from fee reduction
  TARGET_PREMIUM: 4.0, // +4.00€/mo from premium niche targeting
  TIMING_OPTIMIZATION: 2.2, // +2.20€/mo from optimal sale timing
};

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

interface SoldComputed {
  profit: number; // € = (sellPrice − sellFees) − (buyPrice + buyFees)
  sellMs: number;
  monthKey: string; // YYYY-MM
  monthIndex: number; // 0..11 (0 = oldest in 12m window)
}

function monthKey(ms: number, now: number): { key: string; index: number } {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const key = `${yyyy}-${mm}`;
  // index = 0 for oldest month in 12m window, 11 for current
  const monthDelta = Math.floor((now - ms) / (30 * DAY_MS));
  const index = clampNum(11 - monthDelta, 0, 11, 11);
  return { key, index };
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  if (!within12m) return null;
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellFees = t.sellFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const profit = (sellPrice - sellFees) - capital;
  const { key, index } = monthKey(sellMs, now);
  return { profit, sellMs, monthKey: key, monthIndex: index };
}

// Linear regression slope of y values vs x = 0..n-1
function linearRegressionSlope(yValues: number[]): number {
  const n = yValues.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += yValues[i];
    sumXY += i * yValues[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function buildMonthBuckets(computed: SoldComputed[], now: number): MonthBucket[] {
  const map = new Map<number, MonthBucket>();
  for (const c of computed) {
    let bucket = map.get(c.monthIndex);
    if (!bucket) {
      bucket = {
        monthIndex: c.monthIndex,
        monthLabel: c.monthKey,
        profitSum: 0,
        tradeCount: 0,
      };
      map.set(c.monthIndex, bucket);
    }
    bucket.profitSum += c.profit;
    bucket.tradeCount += 1;
  }
  // Sort by monthIndex ascending (oldest first)
  const buckets = Array.from(map.values()).sort((a, b) => a.monthIndex - b.monthIndex);
  // Ensure 12 buckets — fill missing months with 0
  const full: MonthBucket[] = [];
  for (let i = 0; i < 12; i++) {
    const existing = buckets.find((b) => b.monthIndex === i);
    if (existing) {
      full.push(existing);
    } else {
      // Compute month label by going back i months from now
      const ms = now - (11 - i) * 30 * DAY_MS;
      const { key } = monthKey(ms, now);
      full.push({
        monthIndex: i,
        monthLabel: key,
        profitSum: 0,
        tradeCount: 0,
      });
    }
  }
  return full;
}

function computeCurrent(
  computed: SoldComputed[],
  buckets: MonthBucket[],
): CurrentState {
  const soldCount = computed.length;
  const totalProfit12m = round0(clampNum(
    computed.reduce((s, t) => s + t.profit, 0),
    TOTAL_PROFIT_MIN, TOTAL_PROFIT_MAX, 0,
  ));
  const monthlyAvgProfitPerTrade = round2(clampNum(
    soldCount > 0 ? totalProfit12m / soldCount : 0,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));

  // Monthly profit-per-trade series (one value per month with data)
  const monthlySeries: number[] = [];
  for (const b of buckets) {
    if (b.tradeCount > 0) {
      monthlySeries.push(b.profitSum / b.tradeCount);
    }
  }

  // Current month = last bucket with data (or 0 if none)
  const lastWithData = [...buckets].reverse().find((b) => b.tradeCount > 0);
  const currentMonthlyProfitPerTrade = round2(clampNum(
    lastWithData && lastWithData.tradeCount > 0
      ? lastWithData.profitSum / lastWithData.tradeCount
      : monthlyAvgProfitPerTrade,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));

  // Growth rate = linear regression slope of monthly profit-per-trade
  const profitPerTradeGrowthRate = round2(clampNum(
    linearRegressionSlope(monthlySeries),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));

  // Trend = % change: current vs 6 months ago
  const sixMoAgoIdx = Math.max(0, buckets.length - 7);
  const sixMoBucket = buckets[sixMoAgoIdx];
  const sixMoAvg = sixMoBucket && sixMoBucket.tradeCount > 0
    ? sixMoBucket.profitSum / sixMoBucket.tradeCount
    : 0;
  const profitPerTradeTrend = round2(clampNum(
    sixMoAvg > 0
      ? ((currentMonthlyProfitPerTrade - sixMoAvg) / sixMoAvg) * 100
      : (currentMonthlyProfitPerTrade > 0 ? 100 : 0),
    -100, 500, 0,
  ));

  // Acceleration = slope of last half − slope of first half
  const half = Math.floor(monthlySeries.length / 2);
  const firstHalf = monthlySeries.slice(0, half);
  const secondHalf = monthlySeries.slice(half);
  const slopeFirst = linearRegressionSlope(firstHalf);
  const slopeSecond = linearRegressionSlope(secondHalf);
  const profitPerTradeAcceleration = round2(clampNum(
    slopeSecond - slopeFirst,
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));

  const profits = monthlySeries.filter((v) => Number.isFinite(v));
  const bestMonthProfit = round2(clampNum(
    profits.length > 0 ? Math.max(...profits) : 0,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));
  const worstMonthProfit = round2(clampNum(
    profits.length > 0 ? Math.min(...profits) : 0,
    -PROFIT_PER_TRADE_MAX, PROFIT_PER_TRADE_MAX, 0,
  ));
  const monthsWithData = buckets.filter((b) => b.tradeCount > 0).length;

  return {
    monthlyAvgProfitPerTrade,
    currentMonthlyProfitPerTrade,
    profitPerTradeGrowthRate,
    profitPerTradeTrend,
    profitPerTradeAcceleration,
    totalProfit12m,
    soldCount12m: soldCount,
    bestMonthProfit,
    worstMonthProfit,
    monthsWithData,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildGrowthActions(current: CurrentState): GrowthAction[] {
  const out: GrowthAction[] = [];

  const descriptions: Record<GrowthActionType, string> = {
    IMPROVE_SOURCING: `Aktiviraj cross-border sourcing (Kleinanzeigen, Subito, Willhaben) in Bolha/Vinted premium filter (deal score > 80) — znižaj buy price za 15-25% kar dvigne profit per trade za ${ACTION_GROWTH_GAIN.IMPROVE_SOURCING.toFixed(2)}€/mo.`,
    RAISE_PRICES: `Vklopi AI pricing engine in dynamic pricing — dvigni sell price z optimalno strategijo (premium fotografija, AI price recommendations) za +${ACTION_GROWTH_GAIN.RAISE_PRICES.toFixed(2)}€/mo profit per trade growth.`,
    REDUCE_FEES: `Optimiziraj fee structure z bundle deals, tax-aware selling in carrying cost reduction — znižaj total fees za 20-30% kar prinese +${ACTION_GROWTH_GAIN.REDUCE_FEES.toFixed(2)}€/mo profit per trade growth.`,
    TARGET_PREMIUM: `Prestavi se v premium niche kategorije (luxury watches, designer bags, premium electronics) z višjim deal score threshold > 85 — dvigni profit per trade za +${ACTION_GROWTH_GAIN.TARGET_PREMIUM.toFixed(2)}€/mo z višjim absolute margin.`,
    TIMING_OPTIMIZATION: `Vklopi optimal-time AI (petek 18h, nedelja 20h) in listing-refresh-scheduler — +${ACTION_GROWTH_GAIN.TIMING_OPTIMIZATION.toFixed(2)}€/mo profit per trade growth z boljšim sale timing in hitrejšim turnover.`,
  };

  const timelines: Record<GrowthActionType, string> = {
    IMPROVE_SOURCING: '2-4 tedne',
    RAISE_PRICES: '1-2 tedna',
    REDUCE_FEES: '3-6 tednov',
    TARGET_PREMIUM: '1-3 mesece',
    TIMING_OPTIMIZATION: '1 teden',
  };

  const difficulties: Record<GrowthActionType, 'EASY' | 'MEDIUM' | 'HARD'> = {
    IMPROVE_SOURCING: 'MEDIUM',
    RAISE_PRICES: 'EASY',
    REDUCE_FEES: 'MEDIUM',
    TARGET_PREMIUM: 'HARD',
    TIMING_OPTIMIZATION: 'EASY',
  };

  // Sort by gain descending — biggest lift first
  const sorted: GrowthActionType[] = [...VALID_ACTION_TYPE].sort(
    (a, b) => ACTION_GROWTH_GAIN[b] - ACTION_GROWTH_GAIN[a],
  );

  for (const type of sorted) {
    out.push({
      action: type,
      description: clampString(descriptions[type], 200, `Akcija za ${type.toLowerCase()} growth.`),
      expectedGrowthLift: round2(clampNum(
        ACTION_GROWTH_GAIN[type], UPLIFT_MIN, UPLIFT_MAX, 1.0,
      )),
      timeline: clampString(timelines[type], 100, '1-3 mesece'),
      difficulty: difficulties[type],
    });
  }

  return out.slice(0, MAX_ACTIONS);
}

function buildGrowthTrajectory(
  current: CurrentState,
  maximizedGrowthRate: number,
): GrowthTrajectoryEntry[] {
  const out: GrowthTrajectoryEntry[] = [];
  const baseProfit = current.currentMonthlyProfitPerTrade > 0
    ? current.currentMonthlyProfitPerTrade
    : current.monthlyAvgProfitPerTrade;
  for (let month = 1; month <= 12; month++) {
    // Linear projection: base + growth_rate × month
    const currentProjected = baseProfit + current.profitPerTradeGrowthRate * month;
    const maximizedProjected = baseProfit + maximizedGrowthRate * month;
    out.push({
      month,
      currentProjectedProfitPerTrade: round2(clampNum(
        currentProjected,
        PROJECTION_MIN, PROJECTION_MAX, 0,
      )),
      maximizedProjectedProfitPerTrade: round2(clampNum(
        maximizedProjected,
        PROJECTION_MIN, PROJECTION_MAX, 0,
      )),
    });
  }
  return out.slice(0, MAX_TRAJECTORY);
}

function buildGrowthBottlenecks(current: CurrentState): string[] {
  const out: string[] = [];
  if (current.soldCount12m < 30) {
    out.push(`Premalo SOLD trgovin (${current.soldCount12m} v 12m) — growth rate ocena je noisy. Povečaj trade volume z več monitorji za stabilno growth signal.`);
  }
  if (current.profitPerTradeAcceleration < 0) {
    out.push(`Profit per trade raste vendar se DECELERIRA (${current.profitPerTradeAcceleration.toFixed(2)}€/mo²) — growth se upočasnjuje. Poudarek na IMPROVE_SOURCING in TARGET_PREMIUM za reacceleration.`);
  }
  if (current.monthsWithData < 6) {
    out.push(`Samo ${current.monthsWithData} mesecev s SOLD podatki — growth rate ocena nezanesljiva. Zberi vsaj 6 mesecev consistent trade activity za robustno growth signal.`);
  }
  if (current.worstMonthProfit < 0) {
    out.push(`Najslabši mesec ima negativen profit per trade (${current.worstMonthProfit.toFixed(2)}€) — nekateri trades so loss-making. Implementiraj deal score filter > 60 za prekinitev slabih buy-ov.`);
  }
  if (current.profitPerTradeTrend < 0) {
    out.push(`Profit per trade je v NEGATIVNEM trendu (${current.profitPerTradeTrend.toFixed(2)}% v zadnjih 6 mesecih) — market pressure ali increased competition. Poudarek na premium niche in cross-border sourcing za trend reversal.`);
  }
  if (out.length < 3) {
    out.push(`Skupna profit per trade growth ${current.profitPerTradeGrowthRate.toFixed(2)}€/mo je omejena z buy-side sourcing diversification. Razširi monitors z 3+ platformami in keyword expansion.`);
    out.push(`Sale timing ni optimiziran — pogosto prodaje v nizko-demand oknih. Vklopi optimal-time AI za +${ACTION_GROWTH_GAIN.TIMING_OPTIMIZATION.toFixed(2)}€/mo additional growth.`);
  }
  return out.slice(0, MAX_BOTTLENECKS);
}

function decideGrowthGrade(maximizedGrowthRate: number): GrowthGrade {
  // A+ if growth rate ≥ 20€/mo, A ≥ 12, B ≥ 7, C ≥ 4, D ≥ 1.5, else F
  if (maximizedGrowthRate >= 20) return 'A+';
  if (maximizedGrowthRate >= 12) return 'A';
  if (maximizedGrowthRate >= 7) return 'B';
  if (maximizedGrowthRate >= 4) return 'C';
  if (maximizedGrowthRate >= 1.5) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentState,
): ProfitPerTradeGrowthMaximization {
  const currentGrowthRate = current.profitPerTradeGrowthRate;

  // Maximized growth rate = max(current × 2.5, current + sum of all action gains, current + 30€)
  // Anti-hallucination: ≤ current + 50€ absolute uplift
  const sumActionGains = Object.values(ACTION_GROWTH_GAIN).reduce((s, g) => s + g, 0);
  const maximizedGrowthRateRaw = Math.max(
    currentGrowthRate * 2.5,
    currentGrowthRate + sumActionGains,
    currentGrowthRate + 30,
  );
  // Cap at current + 50€ (anti-hallucination absolute uplift)
  const maxBound = Math.min(GROWTH_RATE_MAX, currentGrowthRate + 50);
  const minBound = Math.max(GROWTH_RATE_MIN, currentGrowthRate);
  const maximizedGrowthRate = round2(clampNum(
    maximizedGrowthRateRaw,
    minBound, maxBound,
    Math.max(currentGrowthRate, 10),
  ));
  const growthUplift = round2(clampNum(
    Math.max(0, maximizedGrowthRate - currentGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const growthActions = buildGrowthActions(current);
  const growthTrajectory = buildGrowthTrajectory(current, maximizedGrowthRate);
  const growthBottlenecks = buildGrowthBottlenecks(current);
  const growthGrade = decideGrowthGrade(maximizedGrowthRate);

  // Doubling time = months to double profit per trade at maximized growth rate
  // = baseProfit / maximizedGrowthRate
  const baseProfit = current.currentMonthlyProfitPerTrade > 0
    ? current.currentMonthlyProfitPerTrade
    : current.monthlyAvgProfitPerTrade;
  const doublingTime = maximizedGrowthRate > 0
    ? round0(clampNum(
      baseProfit / maximizedGrowthRate,
      MONTHS_MIN, MONTHS_MAX, 12,
    ))
    : MONTHS_MAX;

  return {
    currentGrowthRate,
    maximizedGrowthRate,
    growthUplift,
    growthActions,
    growthTrajectory,
    growthBottlenecks,
    growthGrade,
    doublingTime,
  };
}

function buildSummary(
  current: CurrentState,
  max: ProfitPerTradeGrowthMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.currentMonthlyProfitPerTrade.toFixed(2)}€/trade (avg ${current.monthlyAvgProfitPerTrade.toFixed(2)}€, growth ${current.profitPerTradeGrowthRate.toFixed(2)}€/mo, trend ${current.profitPerTradeTrend.toFixed(1)}%, ${current.soldCount12m} SOLD 12m, ${current.monthsWithData}mo data).`,
    `Maximized: ${max.maximizedGrowthRate.toFixed(2)}€/mo growth (+${max.growthUplift.toFixed(2)}€/mo uplift, grade ${max.growthGrade}).`,
    `Doubling time: ${max.doublingTime} mesecev. 5 actions: ${max.growthActions.map((a) => `${a.action} (+${a.expectedGrowthLift.toFixed(2)}€)`).join(', ')}.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitPerTradeGrowthMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitPerTradeGrowthHandler = withAiRoute<ProfitPerTradeGrowthMaximizerInput>({
  endpoint: '/api/ai/profit-per-trade-growth-maximizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // GET+POST — body ignored

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades from last 12 months
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
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          monthlyAvgProfitPerTrade: 0,
          currentMonthlyProfitPerTrade: 0,
          profitPerTradeGrowthRate: 0,
          profitPerTradeTrend: 0,
          profitPerTradeAcceleration: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          bestMonthProfit: 0,
          worstMonthProfit: 0,
          monthsWithData: 0,
        },
        maximization: {
          currentGrowthRate: 0,
          maximizedGrowthRate: 0,
          growthUplift: 0,
          growthActions: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthGrade: 'F',
          doublingTime: MONTHS_MAX,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Trade Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Trade Growth Maximizer ni mogoč.',
      } satisfies ProfitPerTradeGrowthResponse);
    }

    // 2) Compute SOLD trades within 12m
    const computed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) computed.push(c);
    }

    if (computed.length === 0) {
      return apiOk({
        ok: true,
        current: {
          monthlyAvgProfitPerTrade: 0,
          currentMonthlyProfitPerTrade: 0,
          profitPerTradeGrowthRate: 0,
          profitPerTradeTrend: 0,
          profitPerTradeAcceleration: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          bestMonthProfit: 0,
          worstMonthProfit: 0,
          monthsWithData: 0,
        },
        maximization: {
          currentGrowthRate: 0,
          maximizedGrowthRate: 0,
          growthUplift: 0,
          growthActions: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthGrade: 'F',
          doublingTime: MONTHS_MAX,
        },
        summary: 'Ni veljavnih SOLD trgovin — Profit Per Trade Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Profit Per Trade Growth Maximizer ni mogoč.',
      } satisfies ProfitPerTradeGrowthResponse);
    }

    const buckets = buildMonthBuckets(computed, now);
    const current = computeCurrent(computed, buckets);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-per-trade-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ProfitPerTradeGrowthMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitPerTradeGrowthResponse);
    }

    // 4) AI prompt with grounding
    const soldSampleForAI = computed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        profit: round2(t.profit),
        monthKey: t.monthKey,
      }));

    const monthlyBucketsForAI = buckets.map((b) => ({
      monthIndex: b.monthIndex,
      monthLabel: b.monthLabel,
      avgProfitPerTrade: b.tradeCount > 0 ? round2(b.profitSum / b.tradeCount) : 0,
      tradeCount: b.tradeCount,
    }));

    const promptData = {
      soldCount12m: computed.length,
      monthsWithData: current.monthsWithData,
      current,
      deterministicMaximization: {
        currentGrowthRate: maximization.currentGrowthRate,
        maximizedGrowthRate: maximization.maximizedGrowthRate,
        growthUplift: maximization.growthUplift,
        growthActions: maximization.growthActions,
        growthTrajectory: maximization.growthTrajectory,
        growthBottlenecks: maximization.growthBottlenecks,
        growthGrade: maximization.growthGrade,
        doublingTime: maximization.doublingTime,
      },
      monthlyBuckets: monthlyBucketsForAI,
      soldSample: soldSampleForAI,
      caps: {
        profitPerTradeMin: PROFIT_PER_TRADE_MIN, profitPerTradeMax: PROFIT_PER_TRADE_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        projectionMin: PROJECTION_MIN, projectionMax: PROJECTION_MAX,
        monthsMin: MONTHS_MIN, monthsMax: MONTHS_MAX,
      },
    };

    const prompt = `Si AI "Profit Per Trade Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER TRADE GROWTH MAXIMIZATION — kako maksimizirati GROWTH RATE profit-a per trade (koliko €/mo profit per trade raste in kako pospešiti to rast). Tvoj cilj je "Tvoj profit per trade raste +2€/mesec, ampak bi lahko rasel +8€/mesec z temi akcijami." Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a per trade (€/mo kako hitro raste, ne × koliko-krat). Razlika od inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate daily profit-a iz inventory-ja v %/teden) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a PER TRADE v €/mesec (absolutni €/mo per trade growth, ne %/teden daily profit). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a per trade (€/mo ramp, ne €/dan scaling). Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a per trade z growthActions IMPROVE_SOURCING/RAISE_PRICES/REDUCE_FEES/TARGET_PREMIUM/TIMING_OPTIMIZATION in doublingTime v mesecih. Razlika od revenue-per-trade-maximizer (v8.06 ki maksimizira top-line sell price per trade) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a per trade (€/mo growth, ne absolutni sell price). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti MAKSIMIZIRAŠ GROWTH €/mo per trade, ne €/dan velocity.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih, group-by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.currentGrowthRate €/mo [-50, 100] (echoes current.profitPerTradeGrowthRate),
2. maximization.maximizedGrowthRate €/mo [-50, 100] (optimal achievable, ≥ current, ≤ current + 50€ absolute uplift — anti-hallucination),
3. maximization.growthUplift €/mo [0, 100] (improvement = maximized − current),
4. maximization.growthActions: 5 elementov { action IMPROVE_SOURCING/RAISE_PRICES/REDUCE_FEES/TARGET_PREMIUM/TIMING_OPTIMIZATION, description (slovenski, max 200 — specifična akcija za pospešitev growth rate), expectedGrowthLift €/mo [0, 100] (koliko €/mo bo dodano k growth rate), timeline (slovenski, max 100 — kdaj implementirati), difficulty EASY/MEDIUM/HARD } (sortirano po expectedGrowthLift descending),
5. maximization.growthTrajectory: 12 elementov { month 1-12, currentProjectedProfitPerTrade € [0, 10000] (profit per trade čez X mesecev pri current growth rate, linear: base + growth × month), maximizedProjectedProfitPerTrade € [0, 10000] (profit per trade pri maximized growth rate) },
6. maximization.growthBottlenecks: 3-5 stringov (slovenski, max 200 vsak — kaj limitira profit per trade growth),
7. maximization.growthGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 20, A ≥ 12, B ≥ 7, C ≥ 4, D ≥ 1.5, else F),
8. maximization.doublingTime months [1, 120] (mesecev do double profit per trade pri maximized growth rate — = baseProfit / maximizedGrowthRate; če maximizedGrowthRate ≤ 0, set 120),
9. summary: slovenski povzetek (max 500 znakov — poudari current profit per trade, current growth rate, maximized growth rate, uplift, grade, doubling time, 5 actions).

VRNI LE JSON:
{
  "maximization": {
    "currentGrowthRate": 2.0,
    "maximizedGrowthRate": 8.0,
    "growthUplift": 6.0,
    "growthActions": [
      { "action": "TARGET_PREMIUM", "description": "Prestavi se v premium niche kategorije.", "expectedGrowthLift": 4.0, "timeline": "1-3 mesece", "difficulty": "HARD" },
      { "action": "IMPROVE_SOURCING", "description": "Aktiviraj cross-border sourcing.", "expectedGrowthLift": 3.5, "timeline": "2-4 tedne", "difficulty": "MEDIUM" },
      { "action": "RAISE_PRICES", "description": "Vklopi AI pricing engine.", "expectedGrowthLift": 2.8, "timeline": "1-2 tedna", "difficulty": "EASY" },
      { "action": "TIMING_OPTIMIZATION", "description": "Vklopi optimal-time AI.", "expectedGrowthLift": 2.2, "timeline": "1 teden", "difficulty": "EASY" },
      { "action": "REDUCE_FEES", "description": "Optimiziraj fee structure z bundle deals.", "expectedGrowthLift": 1.5, "timeline": "3-6 tednov", "difficulty": "MEDIUM" }
    ],
    "growthTrajectory": [
      { "month": 1, "currentProjectedProfitPerTrade": 47.0, "maximizedProjectedProfitPerTrade": 55.0 },
      { "month": 6, "currentProjectedProfitPerTrade": 59.0, "maximizedProjectedProfitPerTrade": 95.0 },
      { "month": 12, "currentProjectedProfitPerTrade": 71.0, "maximizedProjectedProfitPerTrade": 143.0 }
    ],
    "growthBottlenecks": [
      "Premalo SOLD trgovin — growth rate ocena noisy.",
      "Profit per trade raste vendar se decelerira.",
      "Sale timing ni optimiziran."
    ],
    "growthGrade": "B",
    "doublingTime": 6
  },
  "summary": "Current: 45.00€/trade (avg 42.50€, growth 2.00€/mo, trend +5.0%, 50 SOLD 12m, 8mo data). Maximized: 8.00€/mo growth (+6.00€/mo uplift, grade B). Doubling time: 6 mesecev. 5 actions: TARGET_PREMIUM (+4.00€), IMPROVE_SOURCING (+3.50€), RAISE_PRICES (+2.80€), TIMING_OPTIMIZATION (+2.20€), REDUCE_FEES (+1.50€)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        const currentGrowthRate = round2(clampNum(
          aiMax.currentGrowthRate,
          GROWTH_RATE_MIN, GROWTH_RATE_MAX,
          maximization.currentGrowthRate,
        ));

        // Anti-hallucination: maximizedGrowthRate ∈ [current, current + 50]
        const minBound = Math.max(GROWTH_RATE_MIN, currentGrowthRate);
        const maxBound = Math.min(GROWTH_RATE_MAX, currentGrowthRate + 50);
        const maximizedGrowthRate = round2(clampNum(
          aiMax.maximizedGrowthRate,
          minBound, maxBound,
          maximization.maximizedGrowthRate,
        ));
        const growthUplift = round2(clampNum(
          Math.max(0, maximizedGrowthRate - currentGrowthRate),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override growthActions
        let growthActions = maximization.growthActions;
        if (Array.isArray(aiMax.growthActions) &&
            aiMax.growthActions.length >= 3) {
          const aiAct: GrowthAction[] = [];
          for (const a of aiMax.growthActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            aiAct.push({
              action: clampEnum(a.action, VALID_ACTION_TYPE, 'IMPROVE_SOURCING'),
              description: clampString(a.description, 200, 'Akcija za profit per trade growth.'),
              expectedGrowthLift: round2(clampNum(
                a.expectedGrowthLift, UPLIFT_MIN, UPLIFT_MAX, 1.0,
              )),
              timeline: clampString(a.timeline, 100, '1-3 mesece'),
              difficulty: clampEnum(a.difficulty, VALID_DIFFICULTY, 'MEDIUM'),
            });
          }
          if (aiAct.length >= 3) {
            growthActions = aiAct;
          }
        }

        // Override growthTrajectory
        let growthTrajectory = maximization.growthTrajectory;
        if (Array.isArray(aiMax.growthTrajectory) &&
            aiMax.growthTrajectory.length >= 12) {
          const aiTraj: GrowthTrajectoryEntry[] = [];
          for (const e of aiMax.growthTrajectory.slice(0, MAX_TRAJECTORY)) {
            if (!e || typeof e !== 'object') continue;
            const month = round0(clampNum(e.month, 1, 12, 1));
            aiTraj.push({
              month,
              currentProjectedProfitPerTrade: round2(clampNum(
                e.currentProjectedProfitPerTrade,
                PROJECTION_MIN, PROJECTION_MAX, 0,
              )),
              maximizedProjectedProfitPerTrade: round2(clampNum(
                e.maximizedProjectedProfitPerTrade,
                PROJECTION_MIN, PROJECTION_MAX, 0,
              )),
            });
          }
          if (aiTraj.length === 12) {
            growthTrajectory = aiTraj;
          }
        }

        // Override growthBottlenecks
        let growthBottlenecks = maximization.growthBottlenecks;
        if (Array.isArray(aiMax.growthBottlenecks) &&
            aiMax.growthBottlenecks.length >= 2) {
          const aiBot: string[] = [];
          for (const b of aiMax.growthBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            aiBot.push(clampString(b, 200, 'Growth bottleneck neopisan.'));
          }
          if (aiBot.length >= 2) {
            growthBottlenecks = aiBot;
          }
        }

        // Override growthGrade
        const growthGrade = aiMax.growthGrade
          ? clampEnum(aiMax.growthGrade, VALID_GRADE, decideGrowthGrade(maximizedGrowthRate))
          : decideGrowthGrade(maximizedGrowthRate);

        // Override doublingTime
        const baseProfit = current.currentMonthlyProfitPerTrade > 0
          ? current.currentMonthlyProfitPerTrade
          : current.monthlyAvgProfitPerTrade;
        const doublingTime = round0(clampNum(
          aiMax.doublingTime,
          MONTHS_MIN, MONTHS_MAX,
          maximizedGrowthRate > 0 ? baseProfit / maximizedGrowthRate : MONTHS_MAX,
        ));

        maximization = {
          currentGrowthRate,
          maximizedGrowthRate,
          growthUplift,
          growthActions,
          growthTrajectory,
          growthBottlenecks,
          growthGrade,
          doublingTime,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-per-trade-growth-maximizer',
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
      maximization,
      summary,
      aiUsed,
    } satisfies ProfitPerTradeGrowthResponse);
  },
});

export const GET = profitPerTradeGrowthHandler;
export const POST = profitPerTradeGrowthHandler;
