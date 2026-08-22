// v8.12 / v8.96.7-batch3: AI Inventory Capital Efficiency Growth Maximizer — AI MAKSIMIZIRA
// GROWTH capital efficiency — ne trenutno efficiency, ampak kako hitro se
// efficiency izboljšuje month-over-month. "Tvoja capital efficiency se
// izboljšuje +2%/mo, ampak bi se lahko izboljševala +5%/mo z temi akcijami."
// Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira
// capital efficiency per item z reallocation) — ta MAKSIMIZIRA GROWTH
// capital efficiency čez celoten inventory (%/mo kako hitro efficiency raste,
// ne efficiency snapshot per item). Razlika od inventory-capital-velocity-
// maximizer (v8.10 ki maksimizira velocity kapitala — koliko cycle-ov/leto)
// — ta MAKSIMIZIRA GROWTH capital efficiency (%/mo, ne cycle count). Razlika
// od inventory-annual-yield-maximizer (v8.11 ki maksimizira annual yield
// inventory-ja) — ta MAKSIMIZIRA GROWTH capital efficiency (%/mo growth, ne
// letni yield %). Razlika od profit-growth-rate-maximizer (v8.11 ki
// maksimizira growth rate skupnega profit-a v %/mo) — ta MAKSIMIZIRA GROWTH
// CAPITAL EFFICIENCY (koliko hitro profit/capital ratio raste, ne profit €
// growth). Razlika od deal-source-profit-margin-growth-maximizer (v8.12 ki
// maksimizira margin growth per source) — ta MAKSIMIZIRA CAPITAL EFFICIENCY
// GROWTH čez inventory (capital efficiency %/mo growth, ne per-source margin
// growth). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira profit
// per cycle €/cycle) — ta MAKSIMIZIRA GROWTH capital efficiency (%/mo, ne
// €/cycle). Razlika od inventory-annualized-return-maximizer (v8.06 ki
// maksimizira annualized return per item) — ta MAKSIMIZIRA GROWTH capital
// efficiency čez inventory (%/mo, ne per-item annualized %). Razlika od
// inventory-cash-yield-maximizer (v8.04 ki maksimizira cash yield) — ta
// MAKSIMIZIRA GROWTH capital efficiency (%/mo, ne cash yield %). Razlika od
// inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve)
// — ta MAKSIMIZIRA GROWTH capital efficiency z efficiencyGrowthActions in
// doublingTime (rule of 72). Razlika od inventory-profit-per-day-growth-
// maximizer (v8.09 ki maksimizira growth rate daily profit-a iz inventory-ja
// v %/teden) — ta MAKSIMIZIRA GROWTH CAPITAL EFFICIENCY (%/mo efficiency
// growth, ne %/teden daily profit growth). Razlika od inventory-return-on-
// capital-maximizer (v8.08 ki maksimizira return ON capital za HELD inventory)
// — ta MAKSIMIZIRA GROWTH capital efficiency (%/mo kako hitro efficiency raste,
// ne % return na capital). Razlika od inventory-capital-return-maximizer (v8.07
// ki maksimizira capital return OF inventory) — ta MAKSIMIZIRA GROWTH capital
// efficiency (%/mo growth, ne % capital returned). Razlika od inventory-roi-
// maximizer-pro (v7.99 ki maksimizira ROI per item) — ta MAKSIMIZIRA GROWTH
// capital efficiency čez celoten inventory (%/mo, ne per-item ROI).

// GET+POST /api/ai/inventory-capital-efficiency-growth-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type EfficiencyGrowthActionType =
  | 'REDUCE_IDLE_CAPITAL'
  | 'INCREASE_PROFIT_VELOCITY'
  | 'OPTIMIZE_INVENTORY_MIX'
  | 'FASTER_TURNOVER';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type EfficiencyGrowthTrend =
  | 'ACCELERATING'
  | 'STABLE'
  | 'DECLINING'
  | 'VOLATILE'
  | 'INSUFFICIENT_DATA';
type EfficiencyGrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
  } | null;
}

interface CurrentState {
  monthlyCapitalEfficiency: number[]; // 12 entries (€/month, oldest → newest) — % = monthlyProfit / heldCapital × 100
  currentCapitalEfficiency: number; // % (last month)
  avgCapitalEfficiency: number; // % (avg over 12 months)
  efficiencyGrowthRate: number; // %/mo (linear regression slope / mean × 100)
  efficiencyGrowthTrend: EfficiencyGrowthTrend;
  efficiencyGrowthAcceleration: number; // %/mo² (slope of last half vs first half)
  efficiencyGrowthVolatility: number; // % (std dev / mean × 100)
  heldCapital: number; // € (current held inventory value)
  soldCount12m: number;
  heldCount: number;
  monthsWithData: number;
  bestMonthlyEfficiency: number; // %
  worstMonthlyEfficiency: number; // %
}

interface EfficiencyGrowthAction {
  action: EfficiencyGrowthActionType;
  expectedGrowthLift: number; // pp [0, 50] — expected efficiency growth rate lift
  priority: Priority;
}

interface EfficiencyTrajectoryEntry {
  month: number; // 1-12
  currentProjectedEfficiency: number; // % [-50, 500] (linear: currentEff × (1 + m × currentGrowth/100))
  maximizedProjectedEfficiency: number; // % [-50, 500] (linear: currentEff × (1 + m × maximizedGrowth/100))
}

interface EfficiencyGrowthMaximization {
  currentEfficiencyGrowthRate: number; // %/mo [-50, 100] (echoes current)
  maximizedEfficiencyGrowthRate: number; // %/mo [-50, 100] (optimal achievable, ≥ current, ≤ current + 30pp absolute uplift — anti-hallucination)
  efficiencyGrowthUplift: number; // pp [0, 50] (improvement = maximized − current)
  efficiencyGrowthActions: EfficiencyGrowthAction[]; // 4 entries
  efficiencyGrowthTrajectory: EfficiencyTrajectoryEntry[]; // 12 entries
  efficiencyGrowthBottlenecks: string[]; // 3-5 slovenian max 200
  efficiencyGrowthGrade: EfficiencyGrowthGrade;
  doublingTime: number; // months [1, 120] (= 72 / maximizedEfficiencyGrowthRate — rule of 72; če ≤ 0, set 120)
}

interface InventoryCapitalEfficiencyGrowthResponse {
  ok: true;
  current: CurrentState;
  maximization: EfficiencyGrowthMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedEfficiencyGrowthRate?: number;
    efficiencyGrowthUplift?: number;
    efficiencyGrowthActions?: Array<{
      action?: EfficiencyGrowthActionType;
      expectedGrowthLift?: number;
      priority?: Priority;
    }>;
    efficiencyGrowthTrajectory?: Array<{
      month?: number;
      currentProjectedEfficiency?: number;
      maximizedProjectedEfficiency?: number;
    }>;
    efficiencyGrowthBottlenecks?: string[];
    efficiencyGrowthGrade?: EfficiencyGrowthGrade;
    doublingTime?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const EFFICIENCY_MIN = -50;
const EFFICIENCY_MAX = 500;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 100;
const ACCELERATION_MIN = -50;
const ACCELERATION_MAX = 100;
const VOLATILITY_MIN = 0;
const VOLATILITY_MAX = 500;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 10_000_000;
const DOUBLING_MIN = 1;
const DOUBLING_MAX = 120;
const TRAJECTORY_EFFICIENCY_MIN = -50;
const TRAJECTORY_EFFICIENCY_MAX = 500;
const MAX_ACTIONS = 4;
const MAX_TRAJECTORY = 12;
const MAX_BOTTLENECKS = 5;
const MAX_TRADES_FOR_AI = 250;
const ABSOLUTE_UPLIFT_CAP_PP = 30; // max +30pp absolute uplift — anti-hallucination

const VALID_GRADE: readonly EfficiencyGrowthGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_ACTION_TYPE: readonly EfficiencyGrowthActionType[] = [
  'REDUCE_IDLE_CAPITAL',
  'INCREASE_PROFIT_VELOCITY',
  'OPTIMIZE_INVENTORY_MIX',
  'FASTER_TURNOVER',
];
const VALID_PRIORITY: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'];

// Per-action expected efficiency growth rate lift (pp — anti-hallucination bounds)
const ACTION_GROWTH_LIFT: Record<EfficiencyGrowthActionType, number> = {
  REDUCE_IDLE_CAPITAL: 8.0, // +8pp by reducing idle capital (selling stale HELD items)
  INCREASE_PROFIT_VELOCITY: 12.0, // +12pp by higher profit per cycle
  OPTIMIZE_INVENTORY_MIX: 6.0, // +6pp by shifting to high-margin categories
  FASTER_TURNOVER: 4.0, // +4pp by faster inventory cycling
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
  capital: number; // € = buyPrice + buyFees
  sellMs: number;
  within12m: boolean;
}

interface HeldComputed {
  capital: number; // € = buyPrice + buyFees (fallback if no estValue)
  estValue: number; // € = listing.aiEstimatedValue ?? listing.price ?? buyPrice + buyFees
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
  return { profit, capital, sellMs, within12m };
}

function computeHeldTrade(t: HeldTradeRow): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const aiVal = t.listing?.aiEstimatedValue ?? null;
  const listPrice = t.listing?.price ?? null;
  const estValue = aiVal && aiVal > 0
    ? aiVal
    : listPrice && listPrice > 0
      ? listPrice
      : capital;
  return { capital, estValue };
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

function stdDev(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

function computeGrowthRate(monthlyEff: number[]): number {
  if (monthlyEff.length < 2) return 0;
  const slope = linearRegressionSlope(monthlyEff);
  const mean = monthlyEff.reduce((s, v) => s + v, 0) / monthlyEff.length;
  if (Math.abs(mean) < 0.01) return 0;
  return (slope / mean) * 100;
}

function computeAcceleration(monthlyEff: number[]): number {
  const n = monthlyEff.length;
  if (n < 4) return 0;
  const half = Math.floor(n / 2);
  const firstHalf = monthlyEff.slice(0, half);
  const secondHalf = monthlyEff.slice(n - half);
  const slopeFirst = linearRegressionSlope(firstHalf);
  const slopeSecond = linearRegressionSlope(secondHalf);
  const mean = monthlyEff.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 0.01) return 0;
  return ((slopeSecond - slopeFirst) / mean) * 100;
}

function computeVolatility(monthlyEff: number[]): number {
  const n = monthlyEff.length;
  if (n === 0) return 0;
  const mean = monthlyEff.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 0.01) return 0;
  const sd = stdDev(monthlyEff);
  return (sd / Math.abs(mean)) * 100;
}

function decideTrend(
  growthRate: number,
  volatility: number,
  acceleration: number,
  monthsWithData: number,
): EfficiencyGrowthTrend {
  if (monthsWithData < 4) return 'INSUFFICIENT_DATA';
  if (volatility > 100) return 'VOLATILE';
  if (growthRate >= 3 && acceleration >= -1) return 'ACCELERATING';
  if (growthRate <= -2) return 'DECLINING';
  return 'STABLE';
}

// Bucket SOLD trades into 12 monthly profit buckets (oldest → newest)
function bucketMonthlyProfits(sold: SoldComputed[], now: number): number[] {
  const buckets: number[] = new Array(12).fill(0);
  for (const s of sold) {
    const monthsAgo = Math.floor((now - s.sellMs) / MONTH_MS);
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo;
      buckets[idx] += s.profit;
    }
  }
  return buckets.map((v) => round0(clampNum(v, -100_000, 1_000_000, 0)));
}

// Compute monthly capital efficiency (%) = monthlyProfit / avgHeldCapital × 100
// Approximation: use current heldCapital as proxy for all months (we don't have
// historical snapshots of held inventory per month — this is a reasonable
// approximation since held capital doesn't fluctuate wildly month-to-month)
function computeMonthlyEfficiency(
  monthlyProfits: number[],
  heldCapital: number,
): number[] {
  if (heldCapital <= 0) return monthlyProfits.map(() => 0);
  return monthlyProfits.map((p) => round2(clampNum(
    (p / heldCapital) * 100,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  )));
}

function computeCurrent(
  sold: SoldComputed[],
  held: HeldComputed[],
  monthlyEfficiency: number[],
): CurrentState {
  const heldCapital = round0(clampNum(
    held.reduce((s, h) => s + h.estValue, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const avgCapitalEfficiency = round2(clampNum(
    monthlyEfficiency.length > 0
      ? monthlyEfficiency.reduce((s, v) => s + v, 0) / monthlyEfficiency.length
      : 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));
  const currentCapitalEfficiency = round2(clampNum(
    monthlyEfficiency[monthlyEfficiency.length - 1] ?? 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));
  const efficiencyGrowthRate = round2(clampNum(
    computeGrowthRate(monthlyEfficiency),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const efficiencyGrowthAcceleration = round2(clampNum(
    computeAcceleration(monthlyEfficiency),
    ACCELERATION_MIN, ACCELERATION_MAX, 0,
  ));
  const efficiencyGrowthVolatility = round2(clampNum(
    computeVolatility(monthlyEfficiency),
    VOLATILITY_MIN, VOLATILITY_MAX, 0,
  ));
  const monthsWithData = monthlyEfficiency.filter((v) => v !== 0).length;
  const efficiencyGrowthTrend = decideTrend(
    efficiencyGrowthRate, efficiencyGrowthVolatility,
    efficiencyGrowthAcceleration, monthsWithData,
  );
  const bestMonthlyEfficiency = round2(clampNum(
    monthlyEfficiency.length > 0 ? Math.max(...monthlyEfficiency) : 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));
  const worstMonthlyEfficiency = round2(clampNum(
    monthlyEfficiency.length > 0 ? Math.min(...monthlyEfficiency) : 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));

  return {
    monthlyCapitalEfficiency: monthlyEfficiency,
    currentCapitalEfficiency,
    avgCapitalEfficiency,
    efficiencyGrowthRate,
    efficiencyGrowthTrend,
    efficiencyGrowthAcceleration,
    efficiencyGrowthVolatility,
    heldCapital,
    soldCount12m: sold.length,
    heldCount: held.length,
    monthsWithData,
    bestMonthlyEfficiency,
    worstMonthlyEfficiency,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildEfficiencyGrowthActions(current: CurrentState): EfficiencyGrowthAction[] {
  const out: EfficiencyGrowthAction[] = [];

  const descriptions: Record<EfficiencyGrowthActionType, string> = {
    REDUCE_IDLE_CAPITAL: `Identificiraj in prodaj stale HELD items (>60 dni) z listing-refresh-scheduler in dynamic pricing — sprosti ${Math.round(current.heldCapital * 0.3)}€ idle capital za reinvestment (+${ACTION_GROWTH_LIFT.REDUCE_IDLE_CAPITAL.toFixed(1)}pp efficiency growth).`,
    INCREASE_PROFIT_VELOCITY: `Vklopi AI pricing engine in dynamic pricing za +25-35% višji profit per cycle — vsak mesec višji profit velocity na enakem held capital (+${ACTION_GROWTH_LIFT.INCREASE_PROFIT_VELOCITY.toFixed(1)}pp efficiency growth).`,
    OPTIMIZE_INVENTORY_MIX: `Analiziraj category mix in prestavi capital v top-3 highest-margin kategorije (luxury watches, designer bags, premium electronics) — +${ACTION_GROWTH_LIFT.OPTIMIZE_INVENTORY_MIX.toFixed(1)}pp efficiency growth z višjim inherent margin.`,
    FASTER_TURNOVER: `Skrajšaj avg hold time z listing-refresh-scheduler in auto-relisting-scheduler za 30% — +${ACTION_GROWTH_LIFT.FASTER_TURNOVER.toFixed(1)}pp efficiency growth z faster capital recycling (več profit cycles per year z istim capital base).`,
  };

  const sorted: EfficiencyGrowthActionType[] = [...VALID_ACTION_TYPE].sort(
    (a, b) => ACTION_GROWTH_LIFT[b] - ACTION_GROWTH_LIFT[a],
  );

  const priorityByLift = (lift: number): Priority =>
    lift >= 10 ? 'HIGH' : lift >= 6 ? 'MEDIUM' : 'LOW';

  for (const type of sorted) {
    out.push({
      action: type,
      expectedGrowthLift: round2(clampNum(
        ACTION_GROWTH_LIFT[type], UPLIFT_MIN, UPLIFT_MAX, 1.0,
      )),
      priority: priorityByLift(ACTION_GROWTH_LIFT[type]),
    });
  }

  return out.slice(0, MAX_ACTIONS);
}

function buildTrajectory(
  current: CurrentState,
  maximizedGrowthRate: number,
): EfficiencyTrajectoryEntry[] {
  const out: EfficiencyTrajectoryEntry[] = [];
  const base = current.currentCapitalEfficiency > 0
    ? current.currentCapitalEfficiency
    : current.avgCapitalEfficiency;
  for (let m = 1; m <= 12; m++) {
    const currentProj = base * (1 + (m * current.efficiencyGrowthRate) / 100);
    const maximizedProj = base * (1 + (m * maximizedGrowthRate) / 100);
    out.push({
      month: m,
      currentProjectedEfficiency: round2(clampNum(
        currentProj, TRAJECTORY_EFFICIENCY_MIN, TRAJECTORY_EFFICIENCY_MAX, 0,
      )),
      maximizedProjectedEfficiency: round2(clampNum(
        maximizedProj, TRAJECTORY_EFFICIENCY_MIN, TRAJECTORY_EFFICIENCY_MAX, 0,
      )),
    });
  }
  return out.slice(0, MAX_TRAJECTORY);
}

function decideGrade(maximizedGrowthRate: number): EfficiencyGrowthGrade {
  if (maximizedGrowthRate >= 25) return 'A+';
  if (maximizedGrowthRate >= 15) return 'A';
  if (maximizedGrowthRate >= 8) return 'B';
  if (maximizedGrowthRate >= 4) return 'C';
  if (maximizedGrowthRate >= 1) return 'D';
  return 'F';
}

function computeDoublingTime(maximizedGrowthRate: number): number {
  if (maximizedGrowthRate <= 0) return DOUBLING_MAX;
  const months = 72 / maximizedGrowthRate;
  return round0(clampNum(months, DOUBLING_MIN, DOUBLING_MAX, DOUBLING_MAX));
}

function buildBottlenecks(current: CurrentState): string[] {
  const out: string[] = [];
  if (current.heldCount > 0 && current.soldCount12m < current.heldCount) {
    out.push(`HELD inventory (${current.heldCount}) > SOLD 12m (${current.soldCount12m}) — capital ujeto v počasnem inventory-ju, aktiviraj listing-refresh-scheduler za sprostitev idle capital-a.`);
  }
  if (current.efficiencyGrowthVolatility > 80) {
    out.push(`Visoka efficiency volatility (${current.efficiencyGrowthVolatility.toFixed(0)}%) kaže na nestabilno capital deployment — stabiliziraj z bolj konzistentnim deal flow in pricing strategy.`);
  }
  if (current.efficiencyGrowthAcceleration < 0) {
    out.push(`Negativna growth acceleration (${current.efficiencyGrowthAcceleration.toFixed(2)}%/mo²) kaže da efficiency rast upada — investiraj v nove niche in cross-border sourcing za turn-around.`);
  }
  if (current.monthsWithData < 6) {
    out.push(`Premalo podatkov (${current.monthsWithData} mesecev z data) za robustno efficiency growth analizo — zberi vsaj 6 mesecev zgodovine za zanesljivo napoved.`);
  }
  if (current.worstMonthlyEfficiency < 0) {
    out.push(`Negativen mesec (${current.worstMonthlyEfficiency.toFixed(2)}% efficiency) kaže na loss-making period — izboljšaj loss recovery playbook in hedge strategijo.`);
  }
  if (current.heldCapital > 0 && current.avgCapitalEfficiency < 10) {
    out.push(`Nizka povprečna capital efficiency (${current.avgCapitalEfficiency.toFixed(2)}%) kaže da held capital ni dovolj produktiven — preusmeri capital v high-margin categories.`);
  }
  if (out.length === 0) {
    out.push(`Capital recycling hitrost limitira efficiency growth — faster capital cycling z listing-refresh-scheduler omogoča višji compounding.`);
  }
  if (out.length < 3) {
    out.push(`Skalabilnost sourcing-a je bottleneck — razširi cross-border (Kleinanzeigen, Subito, Willhaben) za višji deal flow in višji efficiency growth.`);
  }
  if (out.length < 3) {
    out.push(`Inventory mix optimization je needed — AI Smart Reorder Advisor za kontinuirano category rebalancing in višji efficiency growth rate.`);
  }
  return out.slice(0, MAX_BOTTLENECKS).map((b) => clampString(b, 200, 'Efficiency growth bottleneck neopisan.'));
}

function buildDeterministicMaximization(
  current: CurrentState,
): EfficiencyGrowthMaximization {
  // Sum of all 4 action growth lifts — capped to ABSOLUTE_UPLIFT_CAP_PP (30pp)
  const upliftRaw = Math.min(
    ABSOLUTE_UPLIFT_CAP_PP,
    Object.values(ACTION_GROWTH_LIFT).reduce((s, v) => s + v, 0),
  );

  // Anti-hallucination: maximizedEfficiencyGrowthRate ∈ [current, current + 30pp]
  const minBound = Math.max(GROWTH_RATE_MIN, current.efficiencyGrowthRate);
  const maxBound = Math.min(GROWTH_RATE_MAX, current.efficiencyGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
  const maximizedEfficiencyGrowthRate = round2(clampNum(
    current.efficiencyGrowthRate + upliftRaw,
    minBound, maxBound,
    current.efficiencyGrowthRate,
  ));
  const efficiencyGrowthUplift = round2(clampNum(
    Math.max(0, maximizedEfficiencyGrowthRate - current.efficiencyGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const efficiencyGrowthActions = buildEfficiencyGrowthActions(current);
  const efficiencyGrowthTrajectory = buildTrajectory(current, maximizedEfficiencyGrowthRate);
  const efficiencyGrowthBottlenecks = buildBottlenecks(current);
  const efficiencyGrowthGrade = decideGrade(maximizedEfficiencyGrowthRate);
  const doublingTime = computeDoublingTime(maximizedEfficiencyGrowthRate);

  return {
    currentEfficiencyGrowthRate: current.efficiencyGrowthRate,
    maximizedEfficiencyGrowthRate,
    efficiencyGrowthUplift,
    efficiencyGrowthActions,
    efficiencyGrowthTrajectory,
    efficiencyGrowthBottlenecks,
    efficiencyGrowthGrade,
    doublingTime,
  };
}

function buildSummary(current: CurrentState, max: EfficiencyGrowthMaximization): string {
  const parts: string[] = [
    `Current: ${current.avgCapitalEfficiency.toFixed(2)}% avg efficiency (growth ${current.efficiencyGrowthRate.toFixed(2)}%/mo, ${current.efficiencyGrowthTrend}, volatility ${current.efficiencyGrowthVolatility.toFixed(0)}%, ${current.heldCount} HELD, ${current.heldCapital}€ held, ${current.soldCount12m} SOLD 12m).`,
    `Maximized: ${max.maximizedEfficiencyGrowthRate.toFixed(2)}%/mo growth (+${max.efficiencyGrowthUplift.toFixed(2)}pp uplift, grade ${max.efficiencyGrowthGrade}).`,
    `Doubling time: ${max.doublingTime} mesecev. 4 actions: ${max.efficiencyGrowthActions.map((a) => `${a.action} (+${a.expectedGrowthLift.toFixed(1)}pp)`).join(', ')}.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryCapitalEfficiencyGrowthInput {}

// --- Handler -------------------------------------------------------------

const inventoryCapitalEfficiencyGrowthHandler = withAiRoute<InventoryCapitalEfficiencyGrowthInput>({
  endpoint: '/api/ai/inventory-capital-efficiency-growth-maximizer',
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

    // 1) Parallel query SOLD trades (last 12m) + HELD trades
    const [soldTrades, heldTrades] = await Promise.all([
      db.trade.findMany({
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
      }) as unknown as SoldTradeRow[],
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
            },
          },
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD and no HELD trades
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          monthlyCapitalEfficiency: new Array(12).fill(0),
          currentCapitalEfficiency: 0,
          avgCapitalEfficiency: 0,
          efficiencyGrowthRate: 0,
          efficiencyGrowthTrend: 'INSUFFICIENT_DATA',
          efficiencyGrowthAcceleration: 0,
          efficiencyGrowthVolatility: 0,
          heldCapital: 0,
          soldCount12m: 0,
          heldCount: 0,
          monthsWithData: 0,
          bestMonthlyEfficiency: 0,
          worstMonthlyEfficiency: 0,
        },
        maximization: {
          currentEfficiencyGrowthRate: 0,
          maximizedEfficiencyGrowthRate: 0,
          efficiencyGrowthUplift: 0,
          efficiencyGrowthActions: [],
          efficiencyGrowthTrajectory: [],
          efficiencyGrowthBottlenecks: [],
          efficiencyGrowthGrade: 'F',
          doublingTime: DOUBLING_MAX,
        },
        summary: 'Ni SOLD in HELD trgovin — Inventory Capital Efficiency Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Inventory Capital Efficiency Growth Maximizer ni mogoč.',
      } satisfies InventoryCapitalEfficiencyGrowthResponse);
    }

    // 2) Compute SOLD trades within 12m
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    // 3) Compute HELD trades
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t);
      if (c) heldComputed.push(c);
    }

    // If no SOLD trades or no HELD trades, can't compute efficiency
    if (soldComputed.length === 0 || heldComputed.length === 0) {
      const heldCap = heldComputed.reduce((s, h) => s + h.estValue, 0);
      return apiOk({
        ok: true,
        current: {
          monthlyCapitalEfficiency: new Array(12).fill(0),
          currentCapitalEfficiency: 0,
          avgCapitalEfficiency: 0,
          efficiencyGrowthRate: 0,
          efficiencyGrowthTrend: 'INSUFFICIENT_DATA',
          efficiencyGrowthAcceleration: 0,
          efficiencyGrowthVolatility: 0,
          heldCapital: heldCap,
          soldCount12m: soldComputed.length,
          heldCount: heldComputed.length,
          monthsWithData: 0,
          bestMonthlyEfficiency: 0,
          worstMonthlyEfficiency: 0,
        },
        maximization: {
          currentEfficiencyGrowthRate: 0,
          maximizedEfficiencyGrowthRate: 0,
          efficiencyGrowthUplift: 0,
          efficiencyGrowthActions: [],
          efficiencyGrowthTrajectory: [],
          efficiencyGrowthBottlenecks: [],
          efficiencyGrowthGrade: 'F',
          doublingTime: DOUBLING_MAX,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih ali ni HELD trgovin — Inventory Capital Efficiency Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih ali ni HELD trgovin — Inventory Capital Efficiency Growth Maximizer ni mogoč.',
      } satisfies InventoryCapitalEfficiencyGrowthResponse);
    }

    // 4) Compute monthly profits, monthly efficiency, current state
    const monthlyProfits = bucketMonthlyProfits(soldComputed, now);
    const heldCapital = heldComputed.reduce((s, h) => s + h.estValue, 0);
    const monthlyEfficiency = computeMonthlyEfficiency(monthlyProfits, heldCapital);
    const current = computeCurrent(soldComputed, heldComputed, monthlyEfficiency);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `inventory-capital-efficiency-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: EfficiencyGrowthMaximization;
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
      } satisfies InventoryCapitalEfficiencyGrowthResponse);
    }

    const soldSampleForAI = soldComputed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        profit: t.profit,
        capital: t.capital,
        sellMs: t.sellMs,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      heldCount: heldComputed.length,
      current,
      deterministicMaximization: {
        currentEfficiencyGrowthRate: maximization.currentEfficiencyGrowthRate,
        maximizedEfficiencyGrowthRate: maximization.maximizedEfficiencyGrowthRate,
        efficiencyGrowthUplift: maximization.efficiencyGrowthUplift,
        efficiencyGrowthActions: maximization.efficiencyGrowthActions,
        efficiencyGrowthTrajectory: maximization.efficiencyGrowthTrajectory,
        efficiencyGrowthBottlenecks: maximization.efficiencyGrowthBottlenecks,
        efficiencyGrowthGrade: maximization.efficiencyGrowthGrade,
        doublingTime: maximization.doublingTime,
      },
      soldSample: soldSampleForAI,
      caps: {
        efficiencyMin: EFFICIENCY_MIN, efficiencyMax: EFFICIENCY_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
        volatilityMin: VOLATILITY_MIN, volatilityMax: VOLATILITY_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        trajectoryEfficiencyMin: TRAJECTORY_EFFICIENCY_MIN, trajectoryEfficiencyMax: TRAJECTORY_EFFICIENCY_MAX,
        doublingMin: DOUBLING_MIN, doublingMax: DOUBLING_MAX,
        absoluteUpliftCapPp: ABSOLUTE_UPLIFT_CAP_PP,
      },
      actionGrowthLift: ACTION_GROWTH_LIFT,
    };

    const prompt = `Si AI "Inventory Capital Efficiency Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL EFFICIENCY GROWTH MAXIMIZATION — kako maksimizirati GROWTH capital efficiency čez inventory (koliko hitro se capital efficiency izboljšuje month-over-month). Tvoj cilj je "Tvoja capital efficiency se izboljšuje +2%/mo, ampak bi se lahko izboljševala +5%/mo z temi akcijami." Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ti MAKSIMIZIRAŠ GROWTH capital efficiency čez celoten inventory (%/mo kako hitro efficiency raste, ne efficiency snapshot per item). Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira velocity kapitala — koliko cycle-ov/leto) — ti MAKSIMIZIRAŠ GROWTH capital efficiency (%/mo, ne cycle count). Razlika od inventory-annual-yield-maximizer (v8.11 ki maksimizira annual yield inventory-ja) — ti MAKSIMIZIRAŠ GROWTH capital efficiency (%/mo growth, ne letni yield %). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega profit-a v %/mo) — ti MAKSIMIZIRAŠ GROWTH CAPITAL EFFICIENCY (koliko hitro profit/capital ratio raste, ne profit € growth). Razlika od deal-source-profit-margin-growth-maximizer (v8.12 ki maksimizira margin growth per source) — ti MAKSIMIZIRAŠ CAPITAL EFFICIENCY GROWTH čez inventory (capital efficiency %/mo growth, ne per-source margin growth). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira profit per cycle €/cycle) — ti MAKSIMIZIRAŠ GROWTH capital efficiency (%/mo, ne €/cycle). Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized return per item) — ti MAKSIMIZIRAŠ GROWTH capital efficiency čez inventory (%/mo, ne per-item annualized %). Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira cash yield) — ti MAKSIMIZIRAŠ GROWTH capital efficiency (%/mo, ne cash yield %). Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ti MAKSIMIZIRAŠ GROWTH capital efficiency z efficiencyGrowthActions in doublingTime (rule of 72). Razlika od inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate daily profit-a iz inventory-ja v %/teden) — ti MAKSIMIZIRAŠ GROWTH CAPITAL EFFICIENCY (%/mo efficiency growth, ne %/teden daily profit growth). Razlika od inventory-return-on-capital-maximizer (v8.08 ki maksimizira return ON capital za HELD inventory) — ti MAKSIMIZIRAŠ GROWTH capital efficiency (%/mo kako hitro efficiency raste, ne % return na capital). Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF inventory) — ti MAKSIMIZIRAŠ GROWTH capital efficiency (%/mo growth, ne % capital returned). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti MAKSIMIZIRAŠ GROWTH capital efficiency čez celoten inventory (%/mo, ne per-item ROI).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih grouped by month + HELD trgovine):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedEfficiencyGrowthRate %/mo [-50, 100] (optimal achievable, ≥ current.efficiencyGrowthRate, ≤ current.efficiencyGrowthRate + 30pp absolute uplift — anti-hallucination),
2. maximization.efficiencyGrowthUplift pp [0, 50] (improvement = maximized − current),
3. maximization.efficiencyGrowthActions: 4 elementov { action REDUCE_IDLE_CAPITAL/INCREASE_PROFIT_VELOCITY/OPTIMIZE_INVENTORY_MIX/FASTER_TURNOVER, expectedGrowthLift pp [0, 50] (koliko pp bo dodano k growth rate), priority HIGH/MEDIUM/LOW } (sortirano po expectedGrowthLift descending),
4. maximization.efficiencyGrowthTrajectory: 12 elementov { month 1-12, currentProjectedEfficiency % [-50, 500] (linear: base × (1 + m × currentGrowth/100)), maximizedProjectedEfficiency % [-50, 500] (linear: base × (1 + m × maximizedGrowth/100)) },
5. maximization.efficiencyGrowthBottlenecks: 3-5 stringov (slovenski, max 200 vsak — kaj limitira capital efficiency growth),
6. maximization.efficiencyGrowthGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 25, A ≥ 15, B ≥ 8, C ≥ 4, D ≥ 1, else F),
7. maximization.doublingTime months [1, 120] (= 72 / maximizedEfficiencyGrowthRate — rule of 72; če ≤ 0, set 120),
8. summary: slovenski povzetek (max 500 znakov — poudari current growth rate, maximized growth rate, uplift, grade, doubling time, 4 actions).

VRNI LE JSON:
{
  "maximization": {
    "maximizedEfficiencyGrowthRate": 5.0,
    "efficiencyGrowthUplift": 3.0,
    "efficiencyGrowthActions": [
      { "action": "INCREASE_PROFIT_VELOCITY", "expectedGrowthLift": 12.0, "priority": "HIGH" },
      { "action": "REDUCE_IDLE_CAPITAL", "expectedGrowthLift": 8.0, "priority": "HIGH" },
      { "action": "OPTIMIZE_INVENTORY_MIX", "expectedGrowthLift": 6.0, "priority": "MEDIUM" },
      { "action": "FASTER_TURNOVER", "expectedGrowthLift": 4.0, "priority": "LOW" }
    ],
    "efficiencyGrowthTrajectory": [
      { "month": 1, "currentProjectedEfficiency": 30.6, "maximizedProjectedEfficiency": 31.5 },
      { "month": 6, "currentProjectedEfficiency": 33.6, "maximizedProjectedEfficiency": 39.0 },
      { "month": 12, "currentProjectedEfficiency": 37.2, "maximizedProjectedEfficiency": 48.0 }
    ],
    "efficiencyGrowthBottlenecks": [
      "HELD inventory > SOLD 12m — capital ujeto v počasnem inventory-ju.",
      "Skalabilnost sourcing-a je bottleneck — razširi cross-border.",
      "Inventory mix optimization je needed — AI Smart Reorder Advisor."
    ],
    "efficiencyGrowthGrade": "C",
    "doublingTime": 14
  },
  "summary": "Current: 30.00% avg efficiency (growth 2.00%/mo, STABLE, volatility 35%, 8 HELD, 5000€ held, 50 SOLD 12m). Maximized: 5.00%/mo growth (+3.00pp uplift, grade C). Doubling time: 14 mesecev. 4 actions: INCREASE_PROFIT_VELOCITY (+12.0pp), REDUCE_IDLE_CAPITAL (+8.0pp), OPTIMIZE_INVENTORY_MIX (+6.0pp), FASTER_TURNOVER (+4.0pp)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Anti-hallucination: maximizedEfficiencyGrowthRate ∈ [current, current + 30pp]
        const minBound = Math.max(GROWTH_RATE_MIN, current.efficiencyGrowthRate);
        const maxBound = Math.min(GROWTH_RATE_MAX, current.efficiencyGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
        const maximizedEfficiencyGrowthRate = round2(clampNum(
          aiMax.maximizedEfficiencyGrowthRate,
          minBound, maxBound,
          maximization.maximizedEfficiencyGrowthRate,
        ));
        const efficiencyGrowthUplift = round2(clampNum(
          Math.max(0, maximizedEfficiencyGrowthRate - current.efficiencyGrowthRate),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override efficiencyGrowthActions
        let efficiencyGrowthActions = maximization.efficiencyGrowthActions;
        if (Array.isArray(aiMax.efficiencyGrowthActions) &&
            aiMax.efficiencyGrowthActions.length >= 3) {
          const aiAct: EfficiencyGrowthAction[] = [];
          for (const a of aiMax.efficiencyGrowthActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            aiAct.push({
              action: clampEnum(a.action, VALID_ACTION_TYPE, 'REDUCE_IDLE_CAPITAL'),
              expectedGrowthLift: round2(clampNum(
                a.expectedGrowthLift, UPLIFT_MIN, UPLIFT_MAX, 1.0,
              )),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
            });
          }
          if (aiAct.length >= 3) {
            efficiencyGrowthActions = aiAct;
          }
        }

        // Override efficiencyGrowthTrajectory
        let efficiencyGrowthTrajectory = maximization.efficiencyGrowthTrajectory;
        if (Array.isArray(aiMax.efficiencyGrowthTrajectory) &&
            aiMax.efficiencyGrowthTrajectory.length >= 6) {
          const aiTraj: EfficiencyTrajectoryEntry[] = [];
          for (let m = 1; m <= 12; m++) {
            const ai = aiMax.efficiencyGrowthTrajectory.find(
              (t) => t && Number(t.month) === m,
            );
            if (!ai) continue;
            aiTraj.push({
              month: m,
              currentProjectedEfficiency: round2(clampNum(
                ai.currentProjectedEfficiency,
                TRAJECTORY_EFFICIENCY_MIN, TRAJECTORY_EFFICIENCY_MAX, 0,
              )),
              maximizedProjectedEfficiency: round2(clampNum(
                ai.maximizedProjectedEfficiency,
                TRAJECTORY_EFFICIENCY_MIN, TRAJECTORY_EFFICIENCY_MAX, 0,
              )),
            });
          }
          if (aiTraj.length >= 6) {
            // Fill missing months with deterministic values
            const det = buildTrajectory(current, maximizedEfficiencyGrowthRate);
            const full: EfficiencyTrajectoryEntry[] = [];
            for (let m = 1; m <= 12; m++) {
              const ai = aiTraj.find((t) => t.month === m);
              if (ai) full.push(ai);
              else full.push(det[m - 1]);
            }
            efficiencyGrowthTrajectory = full.slice(0, MAX_TRAJECTORY);
          }
        }

        // Override efficiencyGrowthBottlenecks
        let efficiencyGrowthBottlenecks = maximization.efficiencyGrowthBottlenecks;
        if (Array.isArray(aiMax.efficiencyGrowthBottlenecks) &&
            aiMax.efficiencyGrowthBottlenecks.length >= 2) {
          const aiBot: string[] = [];
          for (const b of aiMax.efficiencyGrowthBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            aiBot.push(clampString(b, 200, 'Efficiency growth bottleneck neopisan.'));
          }
          if (aiBot.length >= 2) {
            efficiencyGrowthBottlenecks = aiBot;
          }
        }

        // Override efficiencyGrowthGrade
        const efficiencyGrowthGrade = aiMax.efficiencyGrowthGrade
          ? clampEnum(aiMax.efficiencyGrowthGrade, VALID_GRADE, decideGrade(maximizedEfficiencyGrowthRate))
          : decideGrade(maximizedEfficiencyGrowthRate);

        // Override doublingTime
        const doublingTime = aiMax.doublingTime !== undefined
          ? round0(clampNum(
              aiMax.doublingTime, DOUBLING_MIN, DOUBLING_MAX,
              computeDoublingTime(maximizedEfficiencyGrowthRate),
            ))
          : computeDoublingTime(maximizedEfficiencyGrowthRate);

        maximization = {
          currentEfficiencyGrowthRate: current.efficiencyGrowthRate,
          maximizedEfficiencyGrowthRate,
          efficiencyGrowthUplift,
          efficiencyGrowthActions,
          efficiencyGrowthTrajectory,
          efficiencyGrowthBottlenecks,
          efficiencyGrowthGrade,
          doublingTime,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-capital-efficiency-growth-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryCapitalEfficiencyGrowthResponse);
  },
});

export const GET = inventoryCapitalEfficiencyGrowthHandler;
export const POST = inventoryCapitalEfficiencyGrowthHandler;
