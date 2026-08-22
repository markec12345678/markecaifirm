// v8.11: AI Profit Growth Rate Maximizer — AI MAKSIMIZIRA PROFIT GROWTH RATE
// — koliko hitro skupni profit raste month-over-month (holistično business
// growth rate, ne per-trade ali per-day). "Tvoj profit raste +5%/mesec, ampak
// bi lahko rasel +12%/mesec z temi 4 vzvodi." Razlika od profit-per-trade-
// growth-maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v
// €/mo) — ta MAKSIMIZIRA GROWTH RATE TOTAL profit-a v %/mo (holistično
// business growth, ne per-trade €/mo growth). Razlika od profit-acceleration-
// maximizer (v8.05 ki maksimizira growth rate acceleration) — ta MAKSIMIZIRA
// PROFIT GROWTH RATE (%/mo MoM, ne acceleration €/mo²). Razlika od
// inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate
// daily profit-a iz inventory-ja v %/teden) — ta MAKSIMIZIRA GROWTH RATE
// skupnega profit-a v %/mesec (holistično business growth, ne %/teden
// inventory). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira
// in skalira daily profit z scalingPath) — ta MAKSIMIZIRA GROWTH RATE profit-a
// (%/mo MoM compounding, ne €/dan scaling). Razlika od profit-multiplier-
// maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) —
// ta MAKSIMIZIRA GROWTH RATE profit-a (%/mo how fast profit is growing, ne ×
// koliko-krat). Razlika od profit-scale-engine (v7.96 ki skalira profit z
// growth engine) — ta MAKSIMIZIRA GROWTH RATE profit-a z growthLever
// (VOLUME_GROWTH/MARGIN_GROWTH/VELOCITY_GROWTH/CAPITAL_GROWTH/EFFICIENCY_GROWTH)
// in doublingTime (rule of 72). Razlika od profit-velocity-maximizer (v7.98
// ki maksimizira €/day velocity) — ta MAKSIMIZIRA GROWTH RATE profit-a (%/mo
// MoM, ne €/dan velocity). Razlika od profit-growth-predictor (v7.81 ki
// napoveduje profit growth) — ta MAKSIMIZIRA GROWTH RATE z exponentialVsLinear
// compounding advantage. Razlika od profit-horizon-maximizer (v8.03 ki
// maksimizira profit horizon) — ta MAKSIMIZIRA GROWTH RATE z 12-month
// growthTrajectory in growthGrade.

// GET+POST /api/ai/profit-growth-rate-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.9) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type GrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type GrowthLeverType =
  | 'VOLUME_GROWTH'
  | 'MARGIN_GROWTH'
  | 'VELOCITY_GROWTH'
  | 'CAPITAL_GROWTH'
  | 'EFFICIENCY_GROWTH';
type GrowthTrend =
  | 'GROWING'
  | 'STABLE'
  | 'DECLINING'
  | 'VOLATILE';

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
  monthlyProfit: number; // €/mo (= totalProfit12m / 12)
  currentMonthProfit: number; // € (last month with data)
  monthlyProfits: number[]; // 12 entries (€/mo each, oldest → newest)
  profitGrowthRate: number; // % MoM (linear regression slope / mean × 100)
  profitGrowthTrend: GrowthTrend;
  profitGrowthAcceleration: number; // %/mo² (slope of last half vs first half)
  profitGrowthVolatility: number; // % (std dev / mean × 100)
  totalProfit12m: number; // €
  soldCount12m: number;
  monthsWithData: number;
  bestMonthProfit: number; // €
  worstMonthProfit: number; // €
}

interface GrowthLeverEntry {
  lever: GrowthLeverType;
  currentContribution: number; // % [0, 100]
  potentialContribution: number; // % [0, 100]
  action: string; // slovenski, max 200
}

interface GrowthTrajectoryEntry {
  month: number; // 1-12
  currentProjectedProfit: number; // € [0, 200000]
  maximizedProjectedProfit: number; // € [0, 200000]
}

interface ExponentialVsLinear {
  linearProjected12m: number; // € (current × (1 + 12 × growthRate/100))
  exponentialProjected12m: number; // € (current × (1 + growthRate/100)^12)
  compoundingAdvantage: number; // € (exponential − linear)
  compoundingAdvantagePct: number; // % (advantage / linear × 100)
}

interface ProfitGrowthMaximization {
  currentGrowthRate: number; // % [-50, 200]
  maximizedGrowthRate: number; // % [-50, 200] (≥ current, ≤ current + 100pp absolute uplift — anti-hallucination)
  growthUplift: number; // pp [0, 200]
  growthLever: GrowthLeverEntry[]; // 5 entries
  growthTrajectory: GrowthTrajectoryEntry[]; // 12 entries
  growthBottlenecks: string[]; // 3-5 slovenian max 200
  growthGrade: GrowthGrade;
  doublingTime: number; // months [1, 120]
  exponentialVsLinear: ExponentialVsLinear;
}

interface ProfitGrowthRateMaximizerResponse {
  ok: true;
  current: CurrentState;
  maximization: ProfitGrowthMaximization;
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
    growthLever?: Array<{
      lever?: GrowthLeverType;
      currentContribution?: number;
      potentialContribution?: number;
      action?: string;
    }>;
    growthTrajectory?: Array<{
      month?: number;
      currentProjectedProfit?: number;
      maximizedProjectedProfit?: number;
    }>;
    growthBottlenecks?: string[];
    growthGrade?: GrowthGrade;
    doublingTime?: number;
    exponentialVsLinear?: {
      linearProjected12m?: number;
      exponentialProjected12m?: number;
      compoundingAdvantage?: number;
      compoundingAdvantagePct?: number;
    };
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const MONTHLY_PROFIT_MIN = 0;
const MONTHLY_PROFIT_MAX = 200_000;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 200;
const ACCELERATION_MIN = -50;
const ACCELERATION_MAX = 200;
const VOLATILITY_MIN = 0;
const VOLATILITY_MAX = 500;
const CONTRIBUTION_MIN = 0;
const CONTRIBUTION_MAX = 100;
const TRAJECTORY_PROFIT_MIN = 0;
const TRAJECTORY_PROFIT_MAX = 200_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 200;
const DOUBLING_MIN = 1;
const DOUBLING_MAX = 120;
const COMPOUNDING_PCT_MIN = -500;
const COMPOUNDING_PCT_MAX = 2000;

const MAX_LEVERS = 5;
const MAX_TRAJECTORY = 12;
const MAX_BOTTLENECKS = 5;
const MAX_TRADES_FOR_AI = 250;
const ABSOLUTE_UPLIFT_CAP = 100; // pp — anti-hallucination ceiling

const VALID_GRADE: readonly GrowthGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_LEVER: readonly GrowthLeverType[] = [
  'VOLUME_GROWTH',
  'MARGIN_GROWTH',
  'VELOCITY_GROWTH',
  'CAPITAL_GROWTH',
  'EFFICIENCY_GROWTH',
];

// Per-lever potential contribution gain (pp — anti-hallucination bounds)
const LEVER_POTENTIAL_GAIN: Record<GrowthLeverType, number> = {
  VOLUME_GROWTH: 30, // +30pp by more trades per month
  MARGIN_GROWTH: 25, // +25pp by higher profit per trade
  VELOCITY_GROWTH: 20, // +20pp by faster turnover
  CAPITAL_GROWTH: 15, // +15pp by more capital deployed
  EFFICIENCY_GROWTH: 10, // +10pp by lower fees/costs
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
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const profit = (sellPrice - sellFees) - capital;
  return { profit, sellMs, within12m };
}

// Linear regression slope over monthlyProfit array
// Returns slope (€/mo) — for linear growth trend across months
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

function stdDev(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

// Compute MoM growth rate (%) using linear regression slope / mean × 100
function computeGrowthRate(monthlyProfits: number[]): number {
  if (monthlyProfits.length < 2) return 0;
  const slope = linearRegressionSlope(monthlyProfits);
  const mean = monthlyProfits.reduce((s, v) => s + v, 0) / monthlyProfits.length;
  if (Math.abs(mean) < 0.01) return 0;
  return (slope / mean) * 100;
}

// Acceleration = (slope of last half) − (slope of first half), converted to %/mo²
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
  volatility: number,
  acceleration: number,
): GrowthTrend {
  if (volatility > 100) return 'VOLATILE';
  if (growthRate >= 5 && acceleration >= -2) return 'GROWING';
  if (growthRate <= -3) return 'DECLINING';
  return 'STABLE';
}

function computeVolatility(monthlyProfits: number[]): number {
  const n = monthlyProfits.length;
  if (n === 0) return 0;
  const mean = monthlyProfits.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 0.01) return 0;
  const sd = stdDev(monthlyProfits);
  return (sd / Math.abs(mean)) * 100;
}

// Bucket SOLD trades into 12 monthly buckets (oldest → newest)
// Returns array of 12 numbers — monthly profits
function bucketMonthlyProfits(sold: SoldComputed[], now: number): number[] {
  const buckets: number[] = new Array(12).fill(0);
  for (const s of sold) {
    const monthsAgo = Math.floor((now - s.sellMs) / (30 * DAY_MS));
    // monthsAgo=0 → current month (newest); monthsAgo=11 → oldest
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo; // index 0 = oldest, 11 = newest
      buckets[idx] += s.profit;
    }
  }
  return buckets.map((v) => round0(clampNum(v, PROFIT_MIN, PROFIT_MAX, 0)));
}

function computeCurrent(
  sold: SoldComputed[],
  monthlyProfits: number[],
): CurrentState {
  const soldCount = sold.length;
  const totalProfit12m = round0(clampNum(
    sold.reduce((s, t) => s + t.profit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const monthlyProfit = round2(clampNum(
    totalProfit12m / 12,
    MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, 0,
  ));
  const currentMonthProfit = round0(clampNum(
    monthlyProfits[monthlyProfits.length - 1] ?? 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const profitGrowthRate = round2(clampNum(
    computeGrowthRate(monthlyProfits),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const profitGrowthAcceleration = round2(clampNum(
    computeAcceleration(monthlyProfits),
    ACCELERATION_MIN, ACCELERATION_MAX, 0,
  ));
  const profitGrowthVolatility = round2(clampNum(
    computeVolatility(monthlyProfits),
    VOLATILITY_MIN, VOLATILITY_MAX, 0,
  ));
  const profitGrowthTrend = decideTrend(
    profitGrowthRate, profitGrowthVolatility, profitGrowthAcceleration,
  );
  const monthsWithData = monthlyProfits.filter((v) => v > 0).length;
  const bestMonthProfit = round0(clampNum(
    monthlyProfits.length > 0 ? Math.max(...monthlyProfits) : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const worstMonthProfit = round0(clampNum(
    monthlyProfits.length > 0 ? Math.min(...monthlyProfits) : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  return {
    monthlyProfit,
    currentMonthProfit,
    monthlyProfits,
    profitGrowthRate,
    profitGrowthTrend,
    profitGrowthAcceleration,
    profitGrowthVolatility,
    totalProfit12m,
    soldCount12m: soldCount,
    monthsWithData,
    bestMonthProfit,
    worstMonthProfit,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildGrowthLevers(current: CurrentState): GrowthLeverEntry[] {
  // Estimate current contribution per lever — heuristic from current state
  // All 5 levers should sum to ~100% current contribution
  const volumeCurrent = current.soldCount12m > 0 ? Math.min(40, current.soldCount12m / 3) : 5;
  const marginCurrent = current.monthlyProfit > 0 ? Math.min(35, current.monthlyProfit / 100) : 5;
  const velocityCurrent = 15; // baseline
  const capitalCurrent = 10; // baseline
  const efficiencyCurrent = 10; // baseline

  const sumCurrent = volumeCurrent + marginCurrent + velocityCurrent + capitalCurrent + efficiencyCurrent;

  const leverData: Array<{
    lever: GrowthLeverType;
    current: number;
    potential: number;
    action: string;
  }> = [
    {
      lever: 'VOLUME_GROWTH',
      current: volumeCurrent,
      potential: LEVER_POTENTIAL_GAIN.VOLUME_GROWTH,
      action: `Dodaj 3 nove monitorje z keyword expansion in omogoči auto-buy za deal score > 85 — povečaj trade volume z ${current.soldCount12m} na ${Math.round(current.soldCount12m * 1.5)} trades/12m (+50% volume → +30pp growth rate).`,
    },
    {
      lever: 'MARGIN_GROWTH',
      current: marginCurrent,
      potential: LEVER_POTENTIAL_GAIN.MARGIN_GROWTH,
      action: `Vklopi AI pricing engine in dynamic pricing — dvigni profit per trade z ${(current.monthlyProfit / Math.max(1, current.soldCount12m / 12)).toFixed(2)}€ na ${((current.monthlyProfit / Math.max(1, current.soldCount12m / 12)) * 1.4).toFixed(2)}€ (+40% margin → +25pp growth rate).`,
    },
    {
      lever: 'VELOCITY_GROWTH',
      current: velocityCurrent,
      potential: LEVER_POTENTIAL_GAIN.VELOCITY_GROWTH,
      action: `Vklopi listing-refresh-scheduler in auto-relisting za vse stale HELD items — skrajšaj avg hold days za 30% (+20pp growth rate z faster capital recycling).`,
    },
    {
      lever: 'CAPITAL_GROWTH',
      current: capitalCurrent,
      potential: LEVER_POTENTIAL_GAIN.CAPITAL_GROWTH,
      action: `Povečaj deployed capital z reinvestment strategy (reinvest 80% profit) in financing (bank credit line) — +15pp growth rate z večjim capital pool.`,
    },
    {
      lever: 'EFFICIENCY_GROWTH',
      current: efficiencyCurrent,
      potential: LEVER_POTENTIAL_GAIN.EFFICIENCY_GROWTH,
      action: `Optimiziraj fee structure z bundle deals, tax-aware selling in carrying cost reduction — znižaj total fees za 20-30% (+10pp growth rate z višjim net margin).`,
    },
  ];

  return leverData.map((d) => ({
    lever: d.lever,
    currentContribution: round0(clampNum(
      sumCurrent > 0 ? (d.current / sumCurrent) * 100 : 0,
      CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
    )),
    potentialContribution: round0(clampNum(
      d.potential, CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
    )),
    action: clampString(d.action, 200, `Maximiziraj ${d.lever.toLowerCase().replace('_', ' ')} za višji profit growth rate.`),
  })).slice(0, MAX_LEVERS);
}

function buildGrowthTrajectory(
  current: CurrentState,
  maximizedGrowthRate: number,
): GrowthTrajectoryEntry[] {
  const out: GrowthTrajectoryEntry[] = [];
  const base = current.currentMonthProfit > 0
    ? current.currentMonthProfit
    : current.monthlyProfit;
  for (let m = 1; m <= 12; m++) {
    // Linear projection: base × (1 + m × growthRate/100)
    const currentProj = base * (1 + (m * current.profitGrowthRate) / 100);
    const maximizedProj = base * (1 + (m * maximizedGrowthRate) / 100);
    out.push({
      month: m,
      currentProjectedProfit: round0(clampNum(
        currentProj, TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, 0,
      )),
      maximizedProjectedProfit: round0(clampNum(
        maximizedProj, TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, 0,
      )),
    });
  }
  return out.slice(0, MAX_TRAJECTORY);
}

function buildExponentialVsLinear(
  current: CurrentState,
  maximizedGrowthRate: number,
): ExponentialVsLinear {
  const base = current.currentMonthProfit > 0
    ? current.currentMonthProfit
    : current.monthlyProfit;
  const rateFrac = maximizedGrowthRate / 100;
  const linearProjected12m = base * (1 + 12 * rateFrac);
  const exponentialProjected12m = base * Math.pow(1 + rateFrac, 12);
  const compoundingAdvantage = exponentialProjected12m - linearProjected12m;
  const compoundingAdvantagePct = linearProjected12m !== 0
    ? (compoundingAdvantage / Math.abs(linearProjected12m)) * 100
    : 0;

  return {
    linearProjected12m: round0(clampNum(
      linearProjected12m, TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, 0,
    )),
    exponentialProjected12m: round0(clampNum(
      exponentialProjected12m, TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, 0,
    )),
    compoundingAdvantage: round0(clampNum(
      compoundingAdvantage, PROFIT_MIN, PROFIT_MAX, 0,
    )),
    compoundingAdvantagePct: round2(clampNum(
      compoundingAdvantagePct, COMPOUNDING_PCT_MIN, COMPOUNDING_PCT_MAX, 0,
    )),
  };
}

function decideGrowthGrade(maximizedGrowthRate: number): GrowthGrade {
  if (maximizedGrowthRate >= 30) return 'A+';
  if (maximizedGrowthRate >= 20) return 'A';
  if (maximizedGrowthRate >= 12) return 'B';
  if (maximizedGrowthRate >= 7) return 'C';
  if (maximizedGrowthRate >= 3) return 'D';
  return 'F';
}

function computeDoublingTime(maximizedGrowthRate: number): number {
  // Rule of 72: months to double = 72 / growthRate%
  if (maximizedGrowthRate <= 0) return DOUBLING_MAX;
  const months = 72 / maximizedGrowthRate;
  return round0(clampNum(months, DOUBLING_MIN, DOUBLING_MAX, DOUBLING_MAX));
}

function buildBottlenecks(current: CurrentState): string[] {
  const bottlenecks: string[] = [];
  if (current.soldCount12m < 24) {
    bottlenecks.push(`Nizek trade volume (${current.soldCount12m} trades/12m) limitira growth rate — dodaj monitorje in znižaj deal score threshold za več trades/mesec.`);
  }
  if (current.profitGrowthVolatility > 50) {
    bottlenecks.push(`Visoka profit volatility (${current.profitGrowthVolatility.toFixed(0)}%) otežuje predvidljivo growth rate — stabiliziraj z boljšo deal selection in consistent pricing strategy.`);
  }
  if (current.profitGrowthAcceleration < 0) {
    bottlenecks.push(`Negativna growth acceleration (${current.profitGrowthAcceleration.toFixed(2)}%/mo²) kaže da growth rate upada — investiraj v nove niche in cross-border sourcing za turn-around.`);
  }
  if (current.monthsWithData < 6) {
    bottlenecks.push(`Premalo podatkov (${current.monthsWithData} mesecev z data) za robustno growth rate analizo — zberi vsaj 6 mesecev zgodovine za zanesljivo napoved.`);
  }
  if (current.worstMonthProfit < 0) {
    bottlenecks.push(`Negativni mesec (${current.worstMonthProfit}€) kaže na cash flow problem — izboljšaj loss recovery playbook in hedge strategijo za minimalno tveganje.`);
  }
  if (bottlenecks.length === 0) {
    bottlenecks.push(`Capital recycling hitrost limitira growth rate — faster capital cycling z listing-refresh-scheduler omogoča višji compounding.`);
  }
  if (bottlenecks.length < 3) {
    bottlenecks.push(`Skalabilnost sourcing-a je bottleneck — razširi cross-border (Kleinanzeigen, Subito, Willhaben) za višji deal flow in višji growth rate.`);
  }
  if (bottlenecks.length < 3) {
    bottlenecks.push(`Fee structure optimization je needed — bundle deals in tax-aware selling lahko dvigneta net margin za 20-30% in s tem growth rate.`);
  }
  return bottlenecks.slice(0, MAX_BOTTLENECKS).map((b) => clampString(b, 200, 'Growth bottleneck neopisan.'));
}

function buildDeterministicMaximization(
  current: CurrentState,
): ProfitGrowthMaximization {
  // Sum of all 5 lever potentials — capped to ABSOLUTE_UPLIFT_CAP (100pp)
  const upliftRaw = Math.min(
    ABSOLUTE_UPLIFT_CAP,
    Object.values(LEVER_POTENTIAL_GAIN).reduce((s, v) => s + v, 0),
  );

  // Anti-hallucination: maximizedGrowthRate ∈ [current, current + 100pp]
  const minBound = Math.max(GROWTH_RATE_MIN, current.profitGrowthRate);
  const maxBound = Math.min(GROWTH_RATE_MAX, current.profitGrowthRate + ABSOLUTE_UPLIFT_CAP);
  const maximizedGrowthRate = round2(clampNum(
    current.profitGrowthRate + upliftRaw,
    minBound, maxBound,
    current.profitGrowthRate,
  ));
  const growthUplift = round2(clampNum(
    Math.max(0, maximizedGrowthRate - current.profitGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const growthLever = buildGrowthLevers(current);
  const growthTrajectory = buildGrowthTrajectory(current, maximizedGrowthRate);
  const growthBottlenecks = buildBottlenecks(current);
  const growthGrade = decideGrowthGrade(maximizedGrowthRate);
  const doublingTime = computeDoublingTime(maximizedGrowthRate);
  const exponentialVsLinear = buildExponentialVsLinear(current, maximizedGrowthRate);

  return {
    currentGrowthRate: current.profitGrowthRate,
    maximizedGrowthRate,
    growthUplift,
    growthLever,
    growthTrajectory,
    growthBottlenecks,
    growthGrade,
    doublingTime,
    exponentialVsLinear,
  };
}

function buildSummary(
  current: CurrentState,
  max: ProfitGrowthMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.monthlyProfit.toFixed(2)}€/mo (growth ${current.profitGrowthRate.toFixed(2)}%/mo, ${current.profitGrowthTrend}, volatility ${current.profitGrowthVolatility.toFixed(0)}%, ${current.soldCount12m} SOLD 12m).`,
    `Maximized: ${max.maximizedGrowthRate.toFixed(2)}%/mo growth (+${max.growthUplift.toFixed(2)}pp uplift, grade ${max.growthGrade}).`,
    `Doubling time: ${max.doublingTime} mesecev. Exponential vs linear (12m): ${max.exponentialVsLinear.compoundingAdvantage}€ advantage (+${max.exponentialVsLinear.compoundingAdvantagePct.toFixed(2)}% compounding).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitGrowthRateMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitGrowthRateMaximizerHandler = withAiRoute<ProfitGrowthRateMaximizerInput>({
  endpoint: '/api/ai/profit-growth-rate-maximizer',
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
          monthlyProfit: 0,
          currentMonthProfit: 0,
          monthlyProfits: new Array(12).fill(0),
          profitGrowthRate: 0,
          profitGrowthTrend: 'STABLE',
          profitGrowthAcceleration: 0,
          profitGrowthVolatility: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          monthsWithData: 0,
          bestMonthProfit: 0,
          worstMonthProfit: 0,
        },
        maximization: {
          currentGrowthRate: 0,
          maximizedGrowthRate: 0,
          growthUplift: 0,
          growthLever: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthGrade: 'F',
          doublingTime: DOUBLING_MAX,
          exponentialVsLinear: {
            linearProjected12m: 0,
            exponentialProjected12m: 0,
            compoundingAdvantage: 0,
            compoundingAdvantagePct: 0,
          },
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Growth Rate Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Growth Rate Maximizer ni mogoč.',
      } satisfies ProfitGrowthRateMaximizerResponse);
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
          monthlyProfit: 0,
          currentMonthProfit: 0,
          monthlyProfits: new Array(12).fill(0),
          profitGrowthRate: 0,
          profitGrowthTrend: 'STABLE',
          profitGrowthAcceleration: 0,
          profitGrowthVolatility: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          monthsWithData: 0,
          bestMonthProfit: 0,
          worstMonthProfit: 0,
        },
        maximization: {
          currentGrowthRate: 0,
          maximizedGrowthRate: 0,
          growthUplift: 0,
          growthLever: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthGrade: 'F',
          doublingTime: DOUBLING_MAX,
          exponentialVsLinear: {
            linearProjected12m: 0,
            exponentialProjected12m: 0,
            compoundingAdvantage: 0,
            compoundingAdvantagePct: 0,
          },
        },
        summary: 'Ni veljavnih SOLD trgovin — Profit Growth Rate Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Profit Growth Rate Maximizer ni mogoč.',
      } satisfies ProfitGrowthRateMaximizerResponse);
    }

    // 3) Bucket monthly profits
    const monthlyProfits = bucketMonthlyProfits(soldComputed, now);
    const current = computeCurrent(soldComputed, monthlyProfits);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-growth-rate-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ProfitGrowthMaximization;
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
      } satisfies ProfitGrowthRateMaximizerResponse);
    }

    // 5) AI prompt with grounding
    const soldSampleForAI = soldComputed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        profit: t.profit,
        sellMs: t.sellMs,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      current,
      deterministicMaximization: {
        currentGrowthRate: maximization.currentGrowthRate,
        maximizedGrowthRate: maximization.maximizedGrowthRate,
        growthUplift: maximization.growthUplift,
        growthLever: maximization.growthLever,
        growthTrajectory: maximization.growthTrajectory,
        growthBottlenecks: maximization.growthBottlenecks,
        growthGrade: maximization.growthGrade,
        doublingTime: maximization.doublingTime,
        exponentialVsLinear: maximization.exponentialVsLinear,
      },
      soldSample: soldSampleForAI,
      caps: {
        monthlyProfitMin: MONTHLY_PROFIT_MIN, monthlyProfitMax: MONTHLY_PROFIT_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
        volatilityMin: VOLATILITY_MIN, volatilityMax: VOLATILITY_MAX,
        contributionMin: CONTRIBUTION_MIN, contributionMax: CONTRIBUTION_MAX,
        trajectoryProfitMin: TRAJECTORY_PROFIT_MIN, trajectoryProfitMax: TRAJECTORY_PROFIT_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        doublingMin: DOUBLING_MIN, doublingMax: DOUBLING_MAX,
        absoluteUpliftCap: ABSOLUTE_UPLIFT_CAP,
      },
    };

    const prompt = `Si AI "Profit Growth Rate Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT GROWTH RATE MAXIMIZATION — kako maksimizirati GROWTH RATE skupnega profit-a (month-over-month % rast). Tvoj cilj je "Tvoj profit raste +5%/mesec, ampak bi lahko rasel +12%/mesec z temi 4 vzvodi." Razlika od profit-per-trade-growth-maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo) — ti MAKSIMIZIRAŠ GROWTH RATE TOTAL profit-a v %/mo (holistično business growth, ne per-trade €/mo growth). Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) — ti MAKSIMIZIRAŠ PROFIT GROWTH RATE (%/mo MoM, ne acceleration €/mo²). Razlika od inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate daily profit-a iz inventory-ja v %/teden) — ti MAKSIMIZIRAŠ GROWTH RATE skupnega profit-a v %/mesec (holistično business growth, ne %/teden inventory). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a (%/mo MoM compounding, ne €/dan scaling). Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a (%/mo kako hitro profit raste, ne × koliko-krat). Razlika od profit-scale-engine (v7.96 ki skalira profit z growth engine) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a z growthLever (VOLUME_GROWTH/MARGIN_GROWTH/VELOCITY_GROWTH/CAPITAL_GROWTH/EFFICIENCY_GROWTH) in doublingTime (rule of 72). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti MAKSIMIZIRAŠ GROWTH RATE profit-a (%/mo MoM, ne €/dan velocity).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih, bucketed by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.currentGrowthRate % [-50, 200] (echoes current.profitGrowthRate),
2. maximization.maximizedGrowthRate % [-50, 200] (optimal achievable, ≥ current.profitGrowthRate, ≤ current.profitGrowthRate + 100pp absolute uplift — anti-hallucination),
3. maximization.growthUplift pp [0, 200] (improvement = maximized − current),
4. maximization.growthLever: 5 elementov { lever VOLUME_GROWTH/MARGIN_GROWTH/VELOCITY_GROWTH/CAPITAL_GROWTH/EFFICIENCY_GROWTH, currentContribution % [0, 100] (share of current growth), potentialContribution % [0, 100] (pp uplift possible: VOLUME=30, MARGIN=25, VELOCITY=20, CAPITAL=15, EFFICIENCY=10), action (slovenski, max 200 — specifična akcija za ta lever) },
5. maximization.growthTrajectory: 12 elementov { month 1-12, currentProjectedProfit € [0, 200000] (linear: base × (1 + m × currentGrowthRate/100)), maximizedProjectedProfit € [0, 200000] (linear: base × (1 + m × maximizedGrowthRate/100)) },
6. maximization.growthBottlenecks: 3-5 stringov (slovenski, max 200 vsak — kaj limitira profit growth rate),
7. maximization.growthGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 30, A ≥ 20, B ≥ 12, C ≥ 7, D ≥ 3, else F),
8. maximization.doublingTime months [1, 120] (= 72 / maximizedGrowthRate — rule of 72; če ≤ 0, set 120),
9. maximization.exponentialVsLinear: { linearProjected12m € [0, 200000] (base × (1 + 12 × maximizedGrowthRate/100)), exponentialProjected12m € [0, 200000] (base × (1 + maximizedGrowthRate/100)^12), compoundingAdvantage € (exponential − linear), compoundingAdvantagePct % (advantage / |linear| × 100) },
10. summary: slovenski povzetek (max 500 znakov — poudari current growth rate, maximized growth rate, uplift, grade, doubling time, exponential compounding advantage).

VRNI LE JSON:
{
  "maximization": {
    "currentGrowthRate": 5.0,
    "maximizedGrowthRate": 12.0,
    "growthUplift": 7.0,
    "growthLever": [
      { "lever": "VOLUME_GROWTH", "currentContribution": 25, "potentialContribution": 30, "action": "Dodaj 3 nove monitorje z keyword expansion in omogoči auto-buy za deal score > 85." },
      { "lever": "MARGIN_GROWTH", "currentContribution": 20, "potentialContribution": 25, "action": "Vklopi AI pricing engine in dynamic pricing za višji profit per trade." },
      { "lever": "VELOCITY_GROWTH", "currentContribution": 15, "potentialContribution": 20, "action": "Vklopi listing-refresh-scheduler in auto-relisting za faster capital recycling." },
      { "lever": "CAPITAL_GROWTH", "currentContribution": 10, "potentialContribution": 15, "action": "Povečaj deployed capital z reinvestment strategy in financing." },
      { "lever": "EFFICIENCY_GROWTH", "currentContribution": 10, "potentialContribution": 10, "action": "Optimiziraj fee structure z bundle deals in tax-aware selling." }
    ],
    "growthTrajectory": [
      { "month": 1, "currentProjectedProfit": 2100, "maximizedProjectedProfit": 2240 },
      { "month": 6, "currentProjectedProfit": 2600, "maximizedProjectedProfit": 3440 },
      { "month": 12, "currentProjectedProfit": 3200, "maximizedProjectedProfit": 4880 }
    ],
    "growthBottlenecks": [
      "Nizek trade volume limitira growth rate — dodaj monitorje in znižaj deal score threshold.",
      "Visoka profit volatility otežuje predvidljivo growth rate — stabiliziraj z boljšo deal selection.",
      "Capital recycling hitrost limitira growth rate — faster capital cycling z listing-refresh-scheduler."
    ],
    "growthGrade": "B",
    "doublingTime": 6,
    "exponentialVsLinear": {
      "linearProjected12m": 4880,
      "exponentialProjected12m": 6212,
      "compoundingAdvantage": 1332,
      "compoundingAdvantagePct": 27.30
    }
  },
  "summary": "Current: 2000.00€/mo (growth 5.00%/mo, GROWING, volatility 35%, 50 SOLD 12m). Maximized: 12.00%/mo growth (+7.00pp uplift, grade B). Doubling time: 6 mesecev. Exponential vs linear (12m): 1332€ advantage (+27.30% compounding)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Anti-hallucination: maximizedGrowthRate ∈ [current, current + 100pp]
        const minBound = Math.max(GROWTH_RATE_MIN, current.profitGrowthRate);
        const maxBound = Math.min(GROWTH_RATE_MAX, current.profitGrowthRate + ABSOLUTE_UPLIFT_CAP);
        const maximizedGrowthRate = round2(clampNum(
          aiMax.maximizedGrowthRate,
          minBound, maxBound,
          maximization.maximizedGrowthRate,
        ));
        const currentGrowthRate = round2(clampNum(
          aiMax.currentGrowthRate ?? current.profitGrowthRate,
          GROWTH_RATE_MIN, GROWTH_RATE_MAX,
          current.profitGrowthRate,
        ));
        const growthUplift = round2(clampNum(
          Math.max(0, maximizedGrowthRate - currentGrowthRate),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override growthLever — must have 5 entries
        let growthLever = maximization.growthLever;
        if (Array.isArray(aiMax.growthLever) && aiMax.growthLever.length >= 4) {
          const aiLevers: GrowthLeverEntry[] = [];
          for (const l of aiMax.growthLever.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            const lever = clampEnum(l.lever, VALID_LEVER, 'VOLUME_GROWTH');
            aiLevers.push({
              lever,
              currentContribution: round0(clampNum(
                l.currentContribution, CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
              )),
              potentialContribution: round0(clampNum(
                l.potentialContribution ?? LEVER_POTENTIAL_GAIN[lever],
                CONTRIBUTION_MIN, CONTRIBUTION_MAX,
                LEVER_POTENTIAL_GAIN[lever],
              )),
              action: clampString(l.action, 200, `Maximiziraj ${lever.toLowerCase().replace('_', ' ')} za višji profit growth rate.`),
            });
          }
          if (aiLevers.length >= 4) {
            growthLever = aiLevers.slice(0, MAX_LEVERS);
          }
        }

        // Override growthTrajectory — must have 12 entries with months 1-12
        let growthTrajectory = maximization.growthTrajectory;
        if (Array.isArray(aiMax.growthTrajectory) && aiMax.growthTrajectory.length >= 6) {
          const aiTraj: GrowthTrajectoryEntry[] = [];
          for (let m = 1; m <= 12; m++) {
            const ai = aiMax.growthTrajectory.find(
              (t) => t && Number(t.month) === m,
            );
            if (!ai) continue;
            aiTraj.push({
              month: m,
              currentProjectedProfit: round0(clampNum(
                ai.currentProjectedProfit,
                TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, 0,
              )),
              maximizedProjectedProfit: round0(clampNum(
                ai.maximizedProjectedProfit,
                TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX, 0,
              )),
            });
          }
          if (aiTraj.length >= 6) {
            // Fill missing months with deterministic values
            const det = buildGrowthTrajectory(current, maximizedGrowthRate);
            const full: GrowthTrajectoryEntry[] = [];
            for (let m = 1; m <= 12; m++) {
              const ai = aiTraj.find((t) => t.month === m);
              if (ai) full.push(ai);
              else full.push(det[m - 1]);
            }
            growthTrajectory = full.slice(0, MAX_TRAJECTORY);
          }
        }

        // Override growthBottlenecks — must be array of 3-5 strings
        let growthBottlenecks = maximization.growthBottlenecks;
        if (Array.isArray(aiMax.growthBottlenecks) && aiMax.growthBottlenecks.length >= 3) {
          const aiBn: string[] = [];
          for (const b of aiMax.growthBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            aiBn.push(clampString(b, 200, 'Growth bottleneck neopisan.'));
          }
          if (aiBn.length >= 3) {
            growthBottlenecks = aiBn;
          }
        }

        // Override growthGrade
        const growthGrade = aiMax.growthGrade
          ? clampEnum(aiMax.growthGrade, VALID_GRADE, decideGrowthGrade(maximizedGrowthRate))
          : decideGrowthGrade(maximizedGrowthRate);

        // Override doublingTime
        const doublingTime = aiMax.doublingTime !== undefined
          ? round0(clampNum(
              aiMax.doublingTime, DOUBLING_MIN, DOUBLING_MAX,
              computeDoublingTime(maximizedGrowthRate),
            ))
          : computeDoublingTime(maximizedGrowthRate);

        // Override exponentialVsLinear
        let exponentialVsLinear = maximization.exponentialVsLinear;
        if (aiMax.exponentialVsLinear && typeof aiMax.exponentialVsLinear === 'object') {
          const aiExp = aiMax.exponentialVsLinear;
          const linearProjected12m = round0(clampNum(
            aiExp.linearProjected12m,
            TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX,
            maximization.exponentialVsLinear.linearProjected12m,
          ));
          const exponentialProjected12m = round0(clampNum(
            aiExp.exponentialProjected12m,
            TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX,
            maximization.exponentialVsLinear.exponentialProjected12m,
          ));
          const compoundingAdvantage = round0(clampNum(
            aiExp.compoundingAdvantage ?? (exponentialProjected12m - linearProjected12m),
            PROFIT_MIN, PROFIT_MAX, 0,
          ));
          const compoundingAdvantagePct = round2(clampNum(
            aiExp.compoundingAdvantagePct ?? (linearProjected12m !== 0 ? (compoundingAdvantage / Math.abs(linearProjected12m)) * 100 : 0),
            COMPOUNDING_PCT_MIN, COMPOUNDING_PCT_MAX, 0,
          ));
          exponentialVsLinear = {
            linearProjected12m,
            exponentialProjected12m,
            compoundingAdvantage,
            compoundingAdvantagePct,
          };
        } else {
          exponentialVsLinear = buildExponentialVsLinear(current, maximizedGrowthRate);
        }

        maximization = {
          currentGrowthRate,
          maximizedGrowthRate,
          growthUplift,
          growthLever,
          growthTrajectory,
          growthBottlenecks,
          growthGrade,
          doublingTime,
          exponentialVsLinear,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-growth-rate-maximizer',
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
    } satisfies ProfitGrowthRateMaximizerResponse);
  },
});

export const GET = profitGrowthRateMaximizerHandler;
export const POST = profitGrowthRateMaximizerHandler;
