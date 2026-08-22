// v8.13 / v8.96.6-batch1: AI Inventory Turnover Profit Growth Maximizer — AI MAKSIMIZIRA
// GROWTH profit-a iz TURNOVER — ne trenutni turnover profit, ampak kako hitro
// profit iz turnover raste month-over-month. Kombinira turnover rate growth z
// profit per cycle growth. "Tvoj turnover profit raste +4%/mo, ampak bi lahko
// rasel +10%/mo." Razlika od inventory-turnover-profit-maximizer (v8.00 ki
// maksimizira profit preko optimal inventory turnover — najde popolno
// ravnovesje med turnover speed in profit per cycle) — ta MAKSIMIZIRA GROWTH
// turnover profit-a (%/mo kako hitro profit iz turnover raste, ne optimal
// turnover-profit curve). Razlika od profit-growth-rate-maximizer (v8.11 ki
// maksimizira growth rate skupnega profit-a v %/mo) — ta MAKSIMIZIRA GROWTH
// TURNOVER PROFIT (koliko hitro profit iz monthlyTrades × avgProfitPerTrade
// raste, ne skupni profit € growth). Razlika od inventory-capital-efficiency-
// growth-maximizer (v8.12 ki maksimizira capital efficiency growth %/mo) —
// ta MAKSIMIZIRA TURNOVER PROFIT GROWTH (€/mo growth od turnover × profit/cycle,
// ne capital efficiency %/mo growth). Razlika od profit-per-cycle-maximizer
// (v8.12 ki maksimizira profit per cycle €/cycle) — ta MAKSIMIZIRA GROWTH
// turnover profit-a (%/mo growth, ne €/cycle profit). Razlika od deal-source-
// profit-margin-growth-maximizer (v8.12 ki maksimizira margin growth per source
// v %/mo) — ta MAKSIMIZIRA TURNOVER PROFIT GROWTH čez inventory (€/mo turnover
// profit growth, ne per-source margin growth). Razlika od profit-per-trade-
// scaling-maximizer (v8.13 ki skalira profit per trade z 4-phase progression)
// — ta MAKSIMIZIRA GROWTH turnover profit-a (%/mo kako hitro profit raste, ne
// €/trade scaling). Razlika od deal-source-volume-growth-maximizer (v8.13 ki
// maksimizira volume growth rate per source v %/mo) — ta MAKSIMIZIRA TURNOVER
// PROFIT GROWTH (€/mo growth od turnover × profit/cycle, ne %/mo source volume
// growth). Razlika od inventory-capital-velocity-maximizer (v8.10 ki
// maksimizira velocity kapitala — koliko cycle-ov/leto) — ta MAKSIMIZIRA GROWTH
// turnover profit-a (%/mo growth, ne cycle count velocity). Razlika od
// inventory-annual-yield-maximizer (v8.11 ki maksimizira annual yield %) — ta
// MAKSIMIZIRA GROWTH turnover profit-a (%/mo growth, ne letni yield %). Razlika
// od profit-per-day-scaling-maximizer (v8.08 ki skalira daily profit z
// requiredTradesPerDay in requiredCapital) — ta MAKSIMIZIRA GROWTH turnover
// profit-a (%/mo growth, ne €/dan scaling). Razlika od profit-per-trade-growth-
// maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo) — ta
// MAKSIMIZIRA GROWTH TURNOVER PROFIT (%/mo kako hitro monthlyTrades ×
// avgProfitPerTrade raste, ne per-trade €/mo growth). Razlika od inventory-
// profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate daily
// profit-a iz inventory-ja v %/teden) — ta MAKSIMIZIRA GROWTH TURNOVER PROFIT
// (%/mo turnover profit growth, ne %/teden daily profit growth). Razlika od
// profit-multiplier-maximizer (v8.09 ki maksimizira max profit multiplier z 6
// dimensions) — ta MAKSIMIZIRA GROWTH TURNOVER PROFIT z growthLevers
// (INCREASE_TRADE_FREQUENCY/INCREASE_PROFIT_PER_TRADE/REDUCE_HOLD_TIME/
// OPTIMIZE_PRICING) in doublingTime (rule of 72). Razlika od profit-scale-
// engine (v7.96 ki skalira profit z growth engine) — ta MAKSIMIZIRA GROWTH
// TURNOVER PROFIT z growthTrajectory in growthBottlenecks. Razlika od inventory-
// turnover-accelerator (v7.96 ki accelera turnover hitrost) — ta MAKSIMIZIRA
// GROWTH TURNOVER PROFIT (%/mo growth, ne turnover hitrost acceleration).
// Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z
// yieldCurve) — ta MAKSIMIZIRA GROWTH TURNOVER PROFIT z doublingTime in
// growthLevers. Razlika od inventory-turnover-optimizer (ki optimira turnover
// rate) — ta MAKSIMIZIRA GROWTH TURNOVER PROFIT (%/mo kako hitro profit raste,
// ne optimal turnover rate).
//
// GET+POST /api/ai/inventory-turnover-profit-growth-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryTurnoverProfitGrowthInput {}

// --- Types ---------------------------------------------------------------

type GrowthLever =
  | 'INCREASE_TRADE_FREQUENCY'
  | 'INCREASE_PROFIT_PER_TRADE'
  | 'REDUCE_HOLD_TIME'
  | 'OPTIMIZE_PRICING';
type GrowthTrend =
  | 'ACCELERATING'
  | 'STABLE'
  | 'DECLINING'
  | 'VOLATILE'
  | 'INSUFFICIENT_DATA';
type GrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface CurrentState {
  monthlyTurnoverProfit: number[]; // 12 entries (€/month, oldest → newest) = monthlyTrades × avgProfitPerTrade
  currentTurnoverProfit: number; // € (last month)
  avgTurnoverProfit: number; // € (avg over 12 months)
  turnoverProfitGrowthRate: number; // %/mo (linear regression slope / mean × 100 over monthlyTurnoverProfit)
  turnoverProfitGrowthTrend: GrowthTrend;
  turnoverProfitGrowthAcceleration: number; // %/mo² (slope of last half vs first half)
  monthsWithData: number;
  bestMonthlyTurnoverProfit: number; // €
  worstMonthlyTurnoverProfit: number; // €
  avgTradeFrequency: number; // trades/month
  avgProfitPerTrade: number; // €
}

interface GrowthLeverEntry {
  lever: GrowthLever;
  currentContribution: number; // % [0, 100] (how much this lever currently contributes to growth)
  potentialContribution: number; // % [0, 100] (how much it could contribute when maximized)
  action: string; // slovenski, max 200
}

interface GrowthTrajectoryEntry {
  month: number; // 1-12
  currentProjectedProfit: number; // € [0, 200000] (linear: base × (1 + m × currentGrowth/100))
  maximizedProjectedProfit: number; // € [0, 200000] (linear: base × (1 + m × maximizedGrowth/100))
}

interface TurnoverProfitGrowthMaximization {
  currentTurnoverProfitGrowth: number; // %/mo [-50, 200] (echoes current)
  maximizedTurnoverProfitGrowth: number; // %/mo [-50, 200] (optimal achievable, ≥ current, ≤ current + 50pp absolute uplift — anti-hallucination)
  growthUplift: number; // pp [0, 100] (improvement = maximized − current)
  growthLevers: GrowthLeverEntry[]; // 4 entries
  growthTrajectory: GrowthTrajectoryEntry[]; // 12 entries
  growthBottlenecks: string[]; // 3-5 slovenian max 200 each
  growthGrade: GrowthGrade;
  doublingTime: number; // months [1, 120] (= 72 / maximizedTurnoverProfitGrowth — rule of 72; če ≤ 0, set 120)
}

interface InventoryTurnoverProfitGrowthResponse {
  ok: true;
  current: CurrentState;
  maximization: TurnoverProfitGrowthMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedTurnoverProfitGrowth?: number;
    growthUplift?: number;
    growthLevers?: Array<{
      lever?: GrowthLever;
      currentContribution?: number;
      potentialContribution?: number;
      action?: string;
    }>;
    growthBottlenecks?: string[];
    growthGrade?: GrowthGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 200_000;
const TOTAL_PROFIT_MIN = -100_000;
const TOTAL_PROFIT_MAX = 1_000_000;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 200;
const ACCELERATION_MIN = -50;
const ACCELERATION_MAX = 200;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100;
const CONTRIBUTION_MIN = 0;
const CONTRIBUTION_MAX = 100;
const TRADE_FREQ_MIN = 0;
const TRADE_FREQ_MAX = 1000;
const PROFIT_PER_TRADE_MIN = 0;
const PROFIT_PER_TRADE_MAX = 10_000;
const TRAJECTORY_PROFIT_MIN = 0;
const TRAJECTORY_PROFIT_MAX = 200_000;
const DOUBLING_MIN = 1;
const DOUBLING_MAX = 120;
const ABSOLUTE_UPLIFT_CAP_PP = 50; // max +50pp absolute uplift — anti-hallucination
const MAX_LEVERS = 4;
const MAX_TRAJECTORY = 12;
const MAX_BOTTLENECKS = 5;
const MAX_TRADES_FOR_AI = 250;

const VALID_LEVER: readonly GrowthLever[] = [
  'INCREASE_TRADE_FREQUENCY',
  'INCREASE_PROFIT_PER_TRADE',
  'REDUCE_HOLD_TIME',
  'OPTIMIZE_PRICING',
];
const VALID_GRADE: readonly GrowthGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

// Per-lever contribution potential (% of total achievable growth)
// Sum = 100% (with realistic allocation across 4 levers)
const LEVER_POTENTIAL_PCT: Record<GrowthLever, number> = {
  INCREASE_TRADE_FREQUENCY: 35, // +35% potential via more trades per month
  INCREASE_PROFIT_PER_TRADE: 30, // +30% potential via higher profit per cycle
  REDUCE_HOLD_TIME: 20, // +20% potential via faster inventory cycling
  OPTIMIZE_PRICING: 15, // +15% potential via AI pricing optimization
};

const LEVER_CURRENT_BASELINE: Record<GrowthLever, number> = {
  INCREASE_TRADE_FREQUENCY: 10, // baseline 10% contribution (underperforming)
  INCREASE_PROFIT_PER_TRADE: 8, // baseline 8% contribution
  REDUCE_HOLD_TIME: 5, // baseline 5% contribution
  OPTIMIZE_PRICING: 4, // baseline 4% contribution
};

const LEVER_ACTION: Record<GrowthLever, string> = {
  INCREASE_TRADE_FREQUENCY: 'Povečaj trade frequency z AI sourcing (deal score > 80 threshold) in cross-border monitoring (Kleinanzeigen, Subito, Willhaben) za +35% potential growth.',
  INCREASE_PROFIT_PER_TRADE: 'Povečaj profit per trade z AI pricing engine, professional photos in bundle upsell za +30% potential growth.',
  REDUCE_HOLD_TIME: 'Zmanjšaj hold time z AI timing engine in seasonal optimization (optimal listing time, demand cycles) za +20% potential growth.',
  OPTIMIZE_PRICING: 'Optimiziraj pricing z A/B test in dynamic pricing strategy za +15% potential growth.',
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
  holdDays: number;
  sellMs: number;
  within12m: boolean;
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
  const buyCost = buyPrice + buyFees;
  if (buyCost <= 0) return null;
  const profit = (sellPrice - sellFees) - buyCost;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  return { profit, holdDays, sellMs, within12m };
}

function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

function computeGrowthRate(monthlyProfits: number[]): number {
  if (monthlyProfits.length < 2) return 0;
  const slope = linearRegressionSlope(monthlyProfits);
  const mean = monthlyProfits.reduce((s, v) => s + v, 0) / monthlyProfits.length;
  if (Math.abs(mean) < 0.01) return 0;
  return (slope / mean) * 100;
}

function computeAcceleration(monthlyProfits: number[]): number {
  const n = monthlyProfits.length;
  if (n < 4) return 0;
  const half = Math.floor(n / 2);
  const firstHalf = monthlyProfits.slice(0, half);
  const secondHalf = monthlyProfits.slice(n - half);
  const slopeFirst = linearRegressionSlope(firstHalf);
  const slopeSecond = linearRegressionSlope(secondHalf);
  const mean = monthlyProfits.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 0.01) return 0;
  return ((slopeSecond - slopeFirst) / mean) * 100;
}

function decideTrend(
  growthRate: number,
  acceleration: number,
  monthsWithData: number,
): GrowthTrend {
  if (monthsWithData < 4) return 'INSUFFICIENT_DATA';
  if (growthRate >= 5 && acceleration >= 1) return 'ACCELERATING';
  if (growthRate <= -3 && acceleration <= -1) return 'DECLINING';
  if (Math.abs(acceleration) > 30 || growthRate > 50) return 'VOLATILE';
  return 'STABLE';
}

// Bucket SOLD trades into 12 monthly turnover profit buckets (oldest → newest)
// monthlyTurnoverProfit = monthlyTrades × avgProfitPerTrade (per month)
function bucketMonthlyTurnoverProfit(sold: SoldComputed[], now: number): number[] {
  const profitBuckets: number[] = new Array(12).fill(0);
  for (const s of sold) {
    const monthsAgo = Math.floor((now - s.sellMs) / MONTH_MS);
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo;
      profitBuckets[idx] += s.profit;
    }
  }
  // monthlyTurnoverProfit = sum of profits in that month (= monthlyTrades × avgProfitPerTrade implicitly)
  return profitBuckets.map((p) => round0(clampNum(
    p, TOTAL_PROFIT_MIN, TOTAL_PROFIT_MAX, 0,
  )));
}

function computeCurrent(sold: SoldComputed[], now: number): CurrentState {
  const n = sold.length;
  const totalProfit = sold.reduce((s, t) => s + t.profit, 0);
  const totalHoldDays = sold.reduce((s, t) => s + t.holdDays, 0);

  const monthlyTurnoverProfit = bucketMonthlyTurnoverProfit(sold, now);
  const monthsWithData = monthlyTurnoverProfit.filter((v) => v !== 0).length;
  const currentTurnoverProfit = round0(clampNum(
    monthlyTurnoverProfit[monthlyTurnoverProfit.length - 1] ?? 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const avgTurnoverProfit = round0(clampNum(
    monthlyTurnoverProfit.length > 0
      ? monthlyTurnoverProfit.reduce((s, v) => s + v, 0) / monthlyTurnoverProfit.length
      : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const turnoverProfitGrowthRate = round2(clampNum(
    computeGrowthRate(monthlyTurnoverProfit),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const turnoverProfitGrowthAcceleration = round2(clampNum(
    computeAcceleration(monthlyTurnoverProfit),
    ACCELERATION_MIN, ACCELERATION_MAX, 0,
  ));
  const turnoverProfitGrowthTrend = decideTrend(
    turnoverProfitGrowthRate,
    turnoverProfitGrowthAcceleration,
    monthsWithData,
  );
  const bestMonthlyTurnoverProfit = round0(clampNum(
    monthlyTurnoverProfit.length > 0 ? Math.max(...monthlyTurnoverProfit) : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const worstMonthlyTurnoverProfit = round0(clampNum(
    monthlyTurnoverProfit.length > 0 ? Math.min(...monthlyTurnoverProfit) : 0,
    -1000, PROFIT_MAX, 0,
  ));

  const avgTradeFrequency = round2(clampNum(
    n > 0 ? n / 12 : 0,
    TRADE_FREQ_MIN, TRADE_FREQ_MAX, 0,
  ));
  const avgProfitPerTrade = round2(clampNum(
    n > 0 ? totalProfit / n : 0,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));
  void totalHoldDays;

  return {
    monthlyTurnoverProfit,
    currentTurnoverProfit,
    avgTurnoverProfit,
    turnoverProfitGrowthRate,
    turnoverProfitGrowthTrend,
    turnoverProfitGrowthAcceleration,
    monthsWithData,
    bestMonthlyTurnoverProfit,
    worstMonthlyTurnoverProfit,
    avgTradeFrequency,
    avgProfitPerTrade,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildGrowthLevers(current: CurrentState): GrowthLeverEntry[] {
  const baseActions: Record<GrowthLever, string> = {
    INCREASE_TRADE_FREQUENCY: `Povečaj trade frequency z ${current.avgTradeFrequency.toFixed(2)} na ${Math.min(1000, current.avgTradeFrequency * 1.5).toFixed(2)} trades/mo z AI sourcing (deal score > 80) in cross-border monitoring za +35% potential growth.`,
    INCREASE_PROFIT_PER_TRADE: `Povečaj profit per trade z ${current.avgProfitPerTrade.toFixed(2)}€ na ${Math.min(10000, current.avgProfitPerTrade * 1.3).toFixed(2)}€ z AI pricing engine in bundle upsell za +30% potential growth.`,
    REDUCE_HOLD_TIME: `Zmanjšaj hold time z AI timing engine in seasonal optimization za +20% potential growth — boljši listing timing pomeni hitrejši sell cycle in več turnover profit-a per month.`,
    OPTIMIZE_PRICING: `Optimiziraj pricing z A/B test in dynamic pricing strategy za +15% potential growth — vsak +5% sell price = +5% turnover profit (če volume ostane konstanten).`,
  };
  const levers: GrowthLeverEntry[] = [];
  for (const lever of VALID_LEVER) {
    const currentContribution = round2(clampNum(
      LEVER_CURRENT_BASELINE[lever],
      CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
    ));
    const potentialContribution = round2(clampNum(
      LEVER_POTENTIAL_PCT[lever],
      CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
    ));
    levers.push({
      lever,
      currentContribution,
      potentialContribution,
      action: clampString(
        baseActions[lever],
        200,
        LEVER_ACTION[lever],
      ),
    });
  }
  return levers.slice(0, MAX_LEVERS);
}

function buildGrowthTrajectory(
  current: CurrentState,
  maximizedGrowthRate: number,
): GrowthTrajectoryEntry[] {
  const base = Math.max(PROFIT_MIN, current.avgTurnoverProfit);
  const out: GrowthTrajectoryEntry[] = [];
  for (let m = 1; m <= 12; m++) {
    const currentProj = base * (1 + (m * current.turnoverProfitGrowthRate) / 100);
    const maximizedProj = base * (1 + (m * maximizedGrowthRate) / 100);
    out.push({
      month: m,
      currentProjectedProfit: round0(clampNum(
        currentProj,
        TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, base,
      )),
      maximizedProjectedProfit: round0(clampNum(
        maximizedProj,
        TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, base,
      )),
    });
  }
  return out.slice(0, MAX_TRAJECTORY);
}

function buildGrowthBottlenecks(current: CurrentState): string[] {
  const out: string[] = [];
  out.push(`Trade frequency bottleneck: trenutno ${current.avgTradeFrequency.toFixed(2)} trades/mo — za +35% growth rabiš 50% več trades/mo z AI cross-border sourcing.`);
  out.push(`Profit per trade bottleneck: trenutno ${current.avgProfitPerTrade.toFixed(2)}€/trade — za +30% growth rabiš AI pricing engine za +25-30% profit/trade.`);
  out.push(`Trend momentum: turnover profit growth ${current.turnoverProfitGrowthRate.toFixed(2)}%/mo z ${current.turnoverProfitGrowthTrend} trend — izkoristi momentum z aggressive levers.`);
  if (current.monthsWithData < 6) {
    out.push(`Data insufficiency: samo ${current.monthsWithData} mesecev z data — rabiš vsaj 6 mesecev za stabilno growth rate analizo in zanesljivo 12-month projection.`);
  } else {
    out.push(`Volatility: best ${current.bestMonthlyTurnoverProfit.toFixed(0)}€/mo vs worst ${current.worstMonthlyTurnoverProfit.toFixed(0)}€/mo — zmanjšaj volatilnost z consistent sourcing in pricing za stabilen growth.`);
  }
  out.push(`Pricing optimization bottleneck: brez A/B testa in dynamic pricing strategije si stuck pri ${current.avgProfitPerTrade.toFixed(2)}€/trade — za +15% growth rabiš AI pricing engine.`);
  return out.slice(0, MAX_BOTTLENECKS).map((s) => clampString(s, 200, 'Bottleneck neopisan.'));
}

function decideGrowthGrade(maximizedTurnoverProfitGrowth: number): GrowthGrade {
  if (maximizedTurnoverProfitGrowth >= 40) return 'A+';
  if (maximizedTurnoverProfitGrowth >= 25) return 'A';
  if (maximizedTurnoverProfitGrowth >= 15) return 'B';
  if (maximizedTurnoverProfitGrowth >= 8) return 'C';
  if (maximizedTurnoverProfitGrowth >= 2) return 'D';
  return 'F';
}

function computeDoublingTime(maximizedGrowthRate: number): number {
  if (maximizedGrowthRate <= 0) return DOUBLING_MAX;
  const dt = 72 / maximizedGrowthRate;
  if (!Number.isFinite(dt) || dt < 1) return DOUBLING_MIN;
  return round0(clampNum(dt, DOUBLING_MIN, DOUBLING_MAX, DOUBLING_MAX));
}

function buildDeterministicMaximization(current: CurrentState): TurnoverProfitGrowthMaximization {
  // Total achievable uplift = sum of LEVER_POTENTIAL_PCT × independence discount
  // 4 levers: 35 + 30 + 20 + 15 = 100% theoretical, × 0.5 independence = 50pp achievable
  const totalAchievableUplift = ABSOLUTE_UPLIFT_CAP_PP; // 50pp

  // Anti-hallucination: maximized ∈ [current, min(current + 50pp, 200%/mo)]
  const minBound = Math.max(GROWTH_RATE_MIN, current.turnoverProfitGrowthRate);
  const maxBound = Math.min(GROWTH_RATE_MAX, current.turnoverProfitGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
  const maximizedTurnoverProfitGrowth = round2(clampNum(
    current.turnoverProfitGrowthRate + totalAchievableUplift,
    minBound, maxBound,
    current.turnoverProfitGrowthRate,
  ));
  const growthUplift = round2(clampNum(
    Math.max(0, maximizedTurnoverProfitGrowth - current.turnoverProfitGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const growthLevers = buildGrowthLevers(current);
  const growthTrajectory = buildGrowthTrajectory(current, maximizedTurnoverProfitGrowth);
  const growthBottlenecks = buildGrowthBottlenecks(current);
  const growthGrade = decideGrowthGrade(maximizedTurnoverProfitGrowth);
  const doublingTime = computeDoublingTime(maximizedTurnoverProfitGrowth);

  return {
    currentTurnoverProfitGrowth: round2(clampNum(
      current.turnoverProfitGrowthRate,
      GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
    )),
    maximizedTurnoverProfitGrowth,
    growthUplift,
    growthLevers,
    growthTrajectory,
    growthBottlenecks,
    growthGrade,
    doublingTime,
  };
}

function buildSummary(current: CurrentState, max: TurnoverProfitGrowthMaximization): string {
  const parts: string[] = [
    `Current: ${current.currentTurnoverProfit.toFixed(0)}€/mo turnover profit (avg ${current.avgTurnoverProfit.toFixed(0)}€/mo, growth ${current.turnoverProfitGrowthRate.toFixed(2)}%/mo, ${current.turnoverProfitGrowthTrend}, ${current.monthsWithData} mesecev data, ${current.avgTradeFrequency.toFixed(2)} trades/mo, ${current.avgProfitPerTrade.toFixed(2)}€/trade).`,
    `Maximized: ${max.maximizedTurnoverProfitGrowth.toFixed(2)}%/mo growth (+${max.growthUplift.toFixed(2)}pp uplift, grade ${max.growthGrade}). Doubling time: ${max.doublingTime} mesecev.`,
    `4 levers: INCREASE_TRADE_FREQUENCY (+35%), INCREASE_PROFIT_PER_TRADE (+30%), REDUCE_HOLD_TIME (+20%), OPTIMIZE_PRICING (+15%).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Prompt builder + AI merge (čisti, testabilni) ----------------------

function buildPromptData(
  soldComputed: SoldComputed[],
  current: CurrentState,
  maximization: TurnoverProfitGrowthMaximization,
): unknown {
  const soldSampleForAI = soldComputed
    .slice(-MAX_TRADES_FOR_AI)
    .map((t) => ({
      profit: t.profit,
      holdDays: t.holdDays,
    }));
  return {
    soldCount12m: soldComputed.length,
    current,
    deterministicMaximization: {
      currentTurnoverProfitGrowth: maximization.currentTurnoverProfitGrowth,
      maximizedTurnoverProfitGrowth: maximization.maximizedTurnoverProfitGrowth,
      growthUplift: maximization.growthUplift,
      growthLevers: maximization.growthLevers,
      growthBottlenecks: maximization.growthBottlenecks,
      growthGrade: maximization.growthGrade,
      doublingTime: maximization.doublingTime,
    },
    soldSample: soldSampleForAI,
    caps: {
      profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
      growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
      accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
      upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      contributionMin: CONTRIBUTION_MIN, contributionMax: CONTRIBUTION_MAX,
      trajectoryProfitMin: TRAJECTORY_PROFIT_MIN, trajectoryProfitMax: TRAJECTORY_PROFIT_MAX,
      doublingMin: DOUBLING_MIN, doublingMax: DOUBLING_MAX,
      absoluteUpliftCapPp: ABSOLUTE_UPLIFT_CAP_PP,
    },
    leverPotentialPct: LEVER_POTENTIAL_PCT,
  };
}

function buildPrompt(promptData: unknown): string {
  return `Si AI "Inventory Turnover Profit Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za TURNOVER PROFIT GROWTH MAXIMIZATION — kako maksimizirati GROWTH profit-a iz TURNOVER (koliko hitro profit iz monthlyTrades × avgProfitPerTrade raste month-over-month). Tvoj cilj je "Tvoj turnover profit raste +4%/mo, ampak bi lahko rasel +10%/mo z temi 4 vzvodi." Razlika od inventory-turnover-profit-maximizer (v8.00 ki maksimizira profit preko optimal inventory turnover — najde popolno ravnovesje med turnover speed in profit per cycle) — ti MAKSIMIZIRAŠ GROWTH turnover profit-a (%/mo kako hitro profit iz turnover raste, ne optimal turnover-profit curve). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega profit-a v %/mo) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT (koliko hitro profit iz monthlyTrades × avgProfitPerTrade raste, ne skupni profit € growth). Razlika od inventory-capital-efficiency-growth-maximizer (v8.12 ki maksimizira capital efficiency growth %/mo) — ti MAKSIMIZIRAŠ TURNOVER PROFIT GROWTH (€/mo growth od turnover × profit/cycle, ne capital efficiency %/mo growth). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira profit per cycle €/cycle) — ti MAKSIMIZIRAŠ GROWTH turnover profit-a (%/mo growth, ne €/cycle profit). Razlika od deal-source-profit-margin-growth-maximizer (v8.12 ki maksimizira margin growth per source v %/mo) — ti MAKSIMIZIRAŠ TURNOVER PROFIT GROWTH čez inventory (€/mo turnover profit growth, ne per-source margin growth). Razlika od profit-per-trade-scaling-maximizer (v8.13 ki skalira profit per trade z 4-phase progression) — ti MAKSIMIZIRAŠ GROWTH turnover profit-a (%/mo kako hitro profit raste, ne €/trade scaling). Razlika od deal-source-volume-growth-maximizer (v8.13 ki maksimizira volume growth rate per source v %/mo) — ti MAKSIMIZIRAŠ TURNOVER PROFIT GROWTH (€/mo growth od turnover × profit/cycle, ne %/mo source volume growth). Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira velocity kapitala — koliko cycle-ov/leto) — ti MAKSIMIZIRAŠ GROWTH turnover profit-a (%/mo growth, ne cycle count velocity). Razlika od inventory-annual-yield-maximizer (v8.11 ki maksimizira annual yield %) — ti MAKSIMIZIRAŠ GROWTH turnover profit-a (%/mo growth, ne letni yield %). Razlika od profit-per-day-scaling-maximizer (v8.08 ki skalira daily profit z requiredTradesPerDay in requiredCapital) — ti MAKSIMIZIRAŠ GROWTH turnover profit-a (%/mo growth, ne €/dan scaling). Razlika od profit-per-trade-growth-maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT (%/mo kako hitro monthlyTrades × avgProfitPerTrade raste, ne per-trade €/mo growth). Razlika od inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate daily profit-a iz inventory-ja v %/teden) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT (%/mo turnover profit growth, ne %/teden daily profit growth). Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira max profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT z growthLevers (INCREASE_TRADE_FREQUENCY/INCREASE_PROFIT_PER_TRADE/REDUCE_HOLD_TIME/OPTIMIZE_PRICING) in doublingTime (rule of 72). Razlika od profit-scale-engine (v7.96 ki skalira profit z growth engine) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT z growthTrajectory in growthBottlenecks. Razlika od inventory-turnover-accelerator (v7.96 ki accelera turnover hitrost) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT (%/mo growth, ne turnover hitrost acceleration). Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT z doublingTime in growthLevers. Razlika od inventory-turnover-optimizer (ki optimira turnover rate) — ti MAKSIMIZIRAŠ GROWTH TURNOVER PROFIT (%/mo kako hitro profit raste, ne optimal turnover rate).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih, grouped by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedTurnoverProfitGrowth %/mo [-50, 200] (optimal achievable, ≥ current turnoverProfitGrowthRate, ≤ current + 50pp absolute uplift — anti-hallucination),
2. maximization.growthUplift pp [0, 100] (improvement = maximized − current),
3. maximization.growthLevers: 4 elementi { lever INCREASE_TRADE_FREQUENCY/INCREASE_PROFIT_PER_TRADE/REDUCE_HOLD_TIME/OPTIMIZE_PRICING (potential 35/30/20/15% contribution), currentContribution % [0, 100] (koliko trenutno prispeva k growth), potentialContribution % [0, 100] (koliko bi lahko prispeval ko max), action (slovenski, max 200 — specifična akcija za ta lever) },
4. maximization.growthBottlenecks: 3-5 stringov (max 200 vsak, slovenski — kaj limitira turnover profit growth),
5. maximization.growthGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 40, A ≥ 25, B ≥ 15, C ≥ 8, D ≥ 2, else F),
6. summary: slovenski povzetek (max 500 znakov — poudari current turnover profit, current growth rate, maximized growth rate, uplift, grade, doubling time, 4 levers).

VRNI LE JSON:
{
  "maximization": {
    "maximizedTurnoverProfitGrowth": 12.0,
    "growthUplift": 8.0,
    "growthLevers": [
      { "lever": "INCREASE_TRADE_FREQUENCY", "currentContribution": 10, "potentialContribution": 35, "action": "Povečaj trade frequency z 5.00 na 7.50 trades/mo z AI sourcing za +35% growth." },
      { "lever": "INCREASE_PROFIT_PER_TRADE", "currentContribution": 8, "potentialContribution": 30, "action": "Povečaj profit per trade z 45€ na 58.50€ z AI pricing za +30% growth." },
      { "lever": "REDUCE_HOLD_TIME", "currentContribution": 5, "potentialContribution": 20, "action": "Zmanjšaj hold time z AI timing engine za +20% growth." },
      { "lever": "OPTIMIZE_PRICING", "currentContribution": 4, "potentialContribution": 15, "action": "Optimiziraj pricing z A/B test za +15% growth." }
    ],
    "growthBottlenecks": [
      "Trade frequency bottleneck: trenutno 5.00 trades/mo.",
      "Profit per trade bottleneck: trenutno 45.00€/trade.",
      "Trend momentum: growth 4.00%/mo z STABLE trend."
    ],
    "growthGrade": "B"
  },
  "summary": "Current: 225€/mo turnover profit (avg 187€/mo, growth 4.00%/mo, STABLE, 8 mesecev data, 5.00 trades/mo, 45.00€/trade). Maximized: 12.00%/mo growth (+8.00pp uplift, grade B). Doubling time: 6 mesecev. 4 levers: INCREASE_TRADE_FREQUENCY (+35%), INCREASE_PROFIT_PER_TRADE (+30%), REDUCE_HOLD_TIME (+20%), OPTIMIZE_PRICING (+15%)."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiIntoMaximization(
  parsed: AiResponse | null,
  current: CurrentState,
  maximizationIn: TurnoverProfitGrowthMaximization,
): { maximization: TurnoverProfitGrowthMaximization; summary: string; aiUsed: boolean } {
  let maximization = maximizationIn;
  let summary = buildSummary(current, maximization);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object' && parsed.maximization) {
    const aiMax = parsed.maximization;

    // Anti-hallucination: maximized ∈ [current, min(current + 50pp, 200%/mo)]
    const minBound = Math.max(GROWTH_RATE_MIN, current.turnoverProfitGrowthRate);
    const maxBound = Math.min(GROWTH_RATE_MAX, current.turnoverProfitGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
    const maximizedTurnoverProfitGrowth = round2(clampNum(
      aiMax.maximizedTurnoverProfitGrowth,
      minBound, maxBound,
      maximization.maximizedTurnoverProfitGrowth,
    ));
    const growthUplift = round2(clampNum(
      Math.max(0, maximizedTurnoverProfitGrowth - current.turnoverProfitGrowthRate),
      UPLIFT_MIN, UPLIFT_MAX, 0,
    ));

    // Override growthLevers — must have 4 entries
    let growthLevers = maximization.growthLevers;
    if (Array.isArray(aiMax.growthLevers) && aiMax.growthLevers.length >= 3) {
      const aiLevers: GrowthLeverEntry[] = [];
      for (const l of aiMax.growthLevers.slice(0, MAX_LEVERS)) {
        if (!l || typeof l !== 'object') continue;
        const lever = clampEnum(l.lever, VALID_LEVER, 'INCREASE_TRADE_FREQUENCY');
        aiLevers.push({
          lever,
          currentContribution: round2(clampNum(
            l.currentContribution,
            CONTRIBUTION_MIN, CONTRIBUTION_MAX,
            LEVER_CURRENT_BASELINE[lever],
          )),
          potentialContribution: round2(clampNum(
            l.potentialContribution,
            CONTRIBUTION_MIN, CONTRIBUTION_MAX,
            LEVER_POTENTIAL_PCT[lever],
          )),
          action: clampString(
            l.action,
            200,
            LEVER_ACTION[lever],
          ),
        });
      }
      if (aiLevers.length >= 3) {
        // Ensure all 4 levers present
        const leversPresent = new Set(aiLevers.map((l) => l.lever));
        for (const lv of VALID_LEVER) {
          if (!leversPresent.has(lv)) {
            aiLevers.push({
              lever: lv,
              currentContribution: LEVER_CURRENT_BASELINE[lv],
              potentialContribution: LEVER_POTENTIAL_PCT[lv],
              action: LEVER_ACTION[lv],
            });
          }
        }
        const leverOrder: Record<GrowthLever, number> = {
          INCREASE_TRADE_FREQUENCY: 0,
          INCREASE_PROFIT_PER_TRADE: 1,
          REDUCE_HOLD_TIME: 2,
          OPTIMIZE_PRICING: 3,
        };
        aiLevers.sort((a, b) => leverOrder[a.lever] - leverOrder[b.lever]);
        growthLevers = aiLevers.slice(0, MAX_LEVERS);
      }
    }

    // Override growthBottlenecks
    let growthBottlenecks = maximization.growthBottlenecks;
    if (Array.isArray(aiMax.growthBottlenecks) && aiMax.growthBottlenecks.length >= 2) {
      const aiBn: string[] = [];
      for (const b of aiMax.growthBottlenecks.slice(0, MAX_BOTTLENECKS)) {
        aiBn.push(clampString(b, 200, 'Bottleneck neopisan.'));
      }
      if (aiBn.length >= 2) {
        growthBottlenecks = aiBn;
      }
    }

    // Override growthGrade
    const growthGrade = aiMax.growthGrade
      ? clampEnum(aiMax.growthGrade, VALID_GRADE, decideGrowthGrade(maximizedTurnoverProfitGrowth))
      : decideGrowthGrade(maximizedTurnoverProfitGrowth);

    // Recompute growthTrajectory with new maximizedTurnoverProfitGrowth
    const growthTrajectory = buildGrowthTrajectory(current, maximizedTurnoverProfitGrowth);

    // Recompute doublingTime
    const doublingTime = computeDoublingTime(maximizedTurnoverProfitGrowth);

    maximization = {
      currentTurnoverProfitGrowth: round2(clampNum(
        current.turnoverProfitGrowthRate,
        GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
      )),
      maximizedTurnoverProfitGrowth,
      growthUplift,
      growthLevers,
      growthTrajectory,
      growthBottlenecks,
      growthGrade,
      doublingTime,
    };

    summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
    aiUsed = true;
  }

  return { maximization, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const inventoryTurnoverProfitGrowthHandler = withAiRoute<InventoryTurnoverProfitGrowthInput>({
  endpoint: '/api/ai/inventory-turnover-profit-growth-maximizer',
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

    // 1) Query SOLD trades last 12 months
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
          monthlyTurnoverProfit: [],
          currentTurnoverProfit: 0,
          avgTurnoverProfit: 0,
          turnoverProfitGrowthRate: 0,
          turnoverProfitGrowthTrend: 'INSUFFICIENT_DATA',
          turnoverProfitGrowthAcceleration: 0,
          monthsWithData: 0,
          bestMonthlyTurnoverProfit: 0,
          worstMonthlyTurnoverProfit: 0,
          avgTradeFrequency: 0,
          avgProfitPerTrade: 0,
        },
        maximization: {
          currentTurnoverProfitGrowth: 0,
          maximizedTurnoverProfitGrowth: 0,
          growthUplift: 0,
          growthLevers: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthGrade: 'F',
          doublingTime: DOUBLING_MAX,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Turnover Profit Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Turnover Profit Growth Maximizer ni mogoč.',
      } satisfies InventoryTurnoverProfitGrowthResponse);
    }

    // 2) Compute SOLD trades within 12m
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    if (soldComputed.length === 0) {
      return apiOk({
        ok: true,
        current: {
          monthlyTurnoverProfit: [],
          currentTurnoverProfit: 0,
          avgTurnoverProfit: 0,
          turnoverProfitGrowthRate: 0,
          turnoverProfitGrowthTrend: 'INSUFFICIENT_DATA',
          turnoverProfitGrowthAcceleration: 0,
          monthsWithData: 0,
          bestMonthlyTurnoverProfit: 0,
          worstMonthlyTurnoverProfit: 0,
          avgTradeFrequency: 0,
          avgProfitPerTrade: 0,
        },
        maximization: {
          currentTurnoverProfitGrowth: 0,
          maximizedTurnoverProfitGrowth: 0,
          growthUplift: 0,
          growthLevers: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthGrade: 'F',
          doublingTime: DOUBLING_MAX,
        },
        summary: 'Ni veljavnih SOLD trgovin — Inventory Turnover Profit Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Inventory Turnover Profit Growth Maximizer ni mogoč.',
      } satisfies InventoryTurnoverProfitGrowthResponse);
    }

    // 3) Compute current state
    const current = computeCurrent(soldComputed, now);
    const deterministicMaximization = buildDeterministicMaximization(current);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `inventory-turnover-profit-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: TurnoverProfitGrowthMaximization;
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
      } satisfies InventoryTurnoverProfitGrowthResponse);
    }

    // 5) AI prompt with grounding (settings loaded by withAiRoute wrapper)
    const promptData = buildPromptData(soldComputed, current, deterministicMaximization);
    const prompt = buildPrompt(promptData);

    // Deterministic baseline (fallback if AI call fails)
    let maximization = deterministicMaximization;
    let summary = buildSummary(current, maximization);
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoMaximization(parsed, current, maximization);
      maximization = merged.maximization;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-profit-growth-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryTurnoverProfitGrowthResponse);
  },
});

export const GET = inventoryTurnoverProfitGrowthHandler;
export const POST = inventoryTurnoverProfitGrowthHandler;
