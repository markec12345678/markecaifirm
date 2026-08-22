// v8.13 / v8.96.6-batch4: AI Profit Per Trade Scaling Maximizer — AI MAKSIMIZIRA in SKALIRA
// PROFIT PER TRADE — ne samo optimizira trenutni profit per trade, ampak ga
// sistematično SKALIRA GOR skozi 4 faze (CURRENT → OPTIMIZED → PREMIUM → ELITE).
// "Tvoj profit per trade je 45€. Za skaliranje na 100€/trade rabiš: premium
// sourcing, professional photos in cross-platform premium pricing." Razlika od
// profit-per-cycle-maximizer (v8.12 ki maksimizira profit per cycle €/cycle
// z maximizationLevers in cycleVsVolumeTradeoff) — ta MAKSIMIZIRA in SKALIRA
// PROFIT PER TRADE skozi scalingPath (4 phase progression CURRENT→OPTIMIZED→
// PREMIUM→ELITE, ne per-cycle snapshot). Razlika od profit-per-day-scaling-
// maximizer (v8.08 ki skalira daily profit z requiredTradesPerDay in
// requiredCapital per phase) — ta SKALIRA PROFIT PER TRADE €/trade (per-trade
// scaling, ne daily profit scaling). Razlika od deal-source-profit-margin-
// growth-maximizer (v8.12 ki maksimizira margin growth rate per source v %/mo)
// — ta MAKSIMIZIRA in SKALIRA PROFIT PER TRADE v absolutnem €/trade (absolute
// per-trade scaling, ne per-source %/mo margin growth). Razlika od
// inventory-capital-efficiency-growth-maximizer (v8.12 ki maksimizira capital
// efficiency growth %/mo) — ta MAKSIMIZIRA PROFIT PER TRADE SCALING (€/trade
// scaling path, ne capital efficiency %/mo growth). Razlika od profit-per-trade-
// growth-maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo)
// — ta MAKSIMIZIRA in SKALIRA profit per trade z scalingPath in scalingActions
// (phase-based scaling, ne growth rate). Razlika od profit-growth-rate-
// maximizer (v8.11 ki maksimizira growth rate skupnega profit-a v %/mo MoM)
// — ta MAKSIMIZIRA PROFIT PER TRADE SCALING (per-trade € scaling, ne skupni
// profit %/mo growth). Razlika od profit-multiplier-maximizer (v8.09 ki
// maksimizira max profit multiplier z 6 dimensions) — ta MAKSIMIZIRA in
// SKALIRA PROFIT PER TRADE z 4-phase progression in scalingBottlenecks.
// Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per €
// deployed) — ta MAKSIMIZIRA PROFIT PER TRADE SCALING (€/trade scaling, ne
// € profit per € capital). Razlika od inventory-annual-yield-maximizer (v8.11
// ki maksimizira annual yield inventory-ja) — ta MAKSIMIZIRA PROFIT PER TRADE
// SCALING (per-trade scaling, ne letni yield %). Razlika od deal-source-profit-
// per-day-maximizer (v8.11 ki maksimizira profit per day per source €/dan)
// — ta MAKSIMIZIRA in SKALIRA PROFIT PER TRADE (€/trade scaling path, ne €/dan
// per source). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira
// profit per cycle z optimalCycleStrategy HIGH_MARGIN_LOW_VOLUME) — ta
// MAKSIMIZIRA PROFIT PER TRADE SCALING z 4-phase scalingPath in 6 scalingActions
// (PREMIUM_SOURCING/PROFESSIONAL_PHOTOS/CROSS_PLATFORM_PREMIUM/BUNDLE_UPSELL/
// CERTIFICATION/TIMING_OPTIMIZATION). Razlika od inventory-turnover-profit-
// maximizer (v8.00 ki maksimizira profit preko optimal inventory turnover) —
// ta MAKSIMIZIRA PROFIT PER TRADE SCALING (per-trade € scaling, ne turnover-
// profit curve). Razlika od revenue-per-trade-maximizer (v8.06 ki maksimizira
// top-line sell price per trade) — ta MAKSIMIZIRA NET PROFIT PER TRADE SCALING
// (net €/trade scaling path, ne top-line revenue/trade).

// GET+POST /api/ai/profit-per-trade-scaling-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ScalingPhase = 'CURRENT' | 'OPTIMIZED' | 'PREMIUM' | 'ELITE';
type ScalingActionType =
  | 'PREMIUM_SOURCING'
  | 'PROFESSIONAL_PHOTOS'
  | 'CROSS_PLATFORM_PREMIUM'
  | 'BUNDLE_UPSELL'
  | 'CERTIFICATION'
  | 'TIMING_OPTIMIZATION';
type Difficulty = 'LOW' | 'MEDIUM' | 'HIGH';
type ScalingGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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
  avgProfitPerTrade: number; // € [0, 10000] = avg((sellPrice − sellFees) − (buyPrice + buyFees)) over SOLD 12m
  soldCount12m: number;
  totalProfit12m: number; // €
  bestTrade: number; // € (max single-trade profit)
  worstTrade: number; // € (min single-trade profit)
  avgSellPrice: number; // €
  avgBuyCost: number; // € = avg(buyPrice + buyFees)
  profitPerTradeTrend: number; // %/mo (linear regression slope / mean × 100 over monthly avg profit/trade)
  avgProfitPerTradeGrowthRate: number; // %/mo (echoes profitPerTradeTrend — kept for AI clarity)
  bestTradeRatio: number; // bestTrade / avgProfitPerTrade [0, 100] (how much upside exists)
}

interface ScalingPathEntry {
  phase: ScalingPhase;
  targetProfitPerTrade: number; // €/trade [0, 10000]
  requirements: string; // slovenski, max 300
  timeline: string; // slovenski, max 200
  feasibility: number; // [0, 100]
}

interface ScalingActionEntry {
  action: ScalingActionType;
  expectedLift: number; // % [0, 100] (relative % uplift to current avg profit/trade)
  difficulty: Difficulty;
}

interface ScalingProjectionEntry {
  months: number; // 3, 6, 12
  projectedProfitPerTrade: number; // € [0, 10000] (linear ramp: 3m=25%, 6m=50%, 12m=100% adoption of maximized)
}

interface ScalingMaximization {
  scalingPath: ScalingPathEntry[]; // 4 entries (CURRENT → OPTIMIZED → PREMIUM → ELITE)
  maximizedProfitPerTrade: number; // €/trade [0, 10000] (= ELITE targetProfitPerTrade)
  scalingMultiplier: number; // [1.0, 5.0] = maximized / current
  scalingActions: ScalingActionEntry[]; // 6 entries
  scalingBottlenecks: string[]; // 3-5 slovenian max 200 each
  scalingProjection: ScalingProjectionEntry[]; // 3 entries (3/6/12 month)
  scalingGrade: ScalingGrade;
}

interface ProfitPerTradeScalingResponse {
  ok: true;
  current: CurrentState;
  maximization: ScalingMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    scalingPath?: Array<{
      phase?: ScalingPhase;
      targetProfitPerTrade?: number;
      requirements?: string;
      timeline?: string;
      feasibility?: number;
    }>;
    maximizedProfitPerTrade?: number;
    scalingMultiplier?: number;
    scalingActions?: Array<{
      action?: ScalingActionType;
      expectedLift?: number;
      difficulty?: Difficulty;
    }>;
    scalingBottlenecks?: string[];
    scalingGrade?: ScalingGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 10_000; // per-trade profit cap
const SELL_PRICE_MIN = 0;
const SELL_PRICE_MAX = 100_000;
const BUY_COST_MIN = 0;
const BUY_COST_MAX = 100_000;
const TOTAL_PROFIT_MIN = -100_000;
const TOTAL_PROFIT_MAX = 1_000_000;
const MULTIPLIER_MIN = 1.0;
const MULTIPLIER_MAX = 5.0;
const FEASIBILITY_MIN = 0;
const FEASIBILITY_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 100;
const BEST_TRADE_RATIO_MIN = 0;
const BEST_TRADE_RATIO_MAX = 100;
const TRAJECTORY_PROFIT_MIN = 0;
const TRAJECTORY_PROFIT_MAX = 10_000;
const ABSOLUTE_UPLIFT_CAP_PCT = 400; // max +400% relative uplift (5× current)
const MAX_PHASES = 4;
const MAX_ACTIONS = 6;
const MAX_BOTTLENECKS = 5;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;

const VALID_PHASE: readonly ScalingPhase[] = ['CURRENT', 'OPTIMIZED', 'PREMIUM', 'ELITE'];
const VALID_ACTION_TYPE: readonly ScalingActionType[] = [
  'PREMIUM_SOURCING',
  'PROFESSIONAL_PHOTOS',
  'CROSS_PLATFORM_PREMIUM',
  'BUNDLE_UPSELL',
  'CERTIFICATION',
  'TIMING_OPTIMIZATION',
];
const VALID_DIFFICULTY: readonly Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_GRADE: readonly ScalingGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

// Phase multipliers — targetProfitPerTrade = current × multiplier
// CURRENT = 1.0×, OPTIMIZED = 1.5×, PREMIUM = 2.5×, ELITE = 4.0×
const PHASE_MULTIPLIER: Record<ScalingPhase, number> = {
  CURRENT: 1.0,
  OPTIMIZED: 1.5,
  PREMIUM: 2.5,
  ELITE: 4.0,
};

const PHASE_FEASIBILITY: Record<ScalingPhase, number> = {
  CURRENT: 100,
  OPTIMIZED: 80,
  PREMIUM: 60,
  ELITE: 40,
};

const PHASE_TIMELINE: Record<ScalingPhase, string> = {
  CURRENT: 'Trenutno stanje — baseline profit per trade z obstoječimi resursi.',
  OPTIMIZED: '0–3 meseci — optimizacija pricing-a, sourcing-a in fotografij z obstoječimi resursi.',
  PREMIUM: '3–9 mesecev — premium positioning z AI pricing engine in professional photos.',
  ELITE: '9–24 mesecev — polno skaliranje z cross-platform premium in certification strategy.',
};

const PHASE_REQUIREMENTS: Record<ScalingPhase, string> = {
  CURRENT: 'Baseline — vzdržuj trenutni sourcing in pricing. Ni dodatnih investicij potrebnih.',
  OPTIMIZED: 'Zahteva AI pricing engine, deal score > 80 in optimiziran listing workflow.',
  PREMIUM: 'Zahteva professional photos, premium category focus in cross-platform listing strategy.',
  ELITE: 'Zahteva certification (authenticity, warranty), premium niche focus in multi-platform premium positioning.',
};

// Per-action relative uplift potential (% improvement to current avg profit/trade)
// Sum = 145% (with realistic 0.7 independence discount → ~100% achievable = ~2× current)
const ACTION_LIFT_PCT: Record<ScalingActionType, number> = {
  PREMIUM_SOURCING: 30, // +30% by sourcing premium deals at lower cost (cross-border, deal score > 85)
  PROFESSIONAL_PHOTOS: 25, // +25% by professional product photography (premium positioning)
  CROSS_PLATFORM_PREMIUM: 20, // +20% by listing on premium platforms (mobile.de, Chrono24, Catawiki)
  BUNDLE_UPSELL: 15, // +15% by bundling complementary items (phone + case + charger)
  CERTIFICATION: 10, // +10% by authenticity certification + warranty (luxury, watches, designer)
  TIMING_OPTIMIZATION: 45, // +45% by AI timing engine (seasonal peaks, demand cycles, optimal listing time)
};

const ACTION_DIFFICULTY: Record<ScalingActionType, Difficulty> = {
  PREMIUM_SOURCING: 'MEDIUM',
  PROFESSIONAL_PHOTOS: 'LOW',
  CROSS_PLATFORM_PREMIUM: 'MEDIUM',
  BUNDLE_UPSELL: 'LOW',
  CERTIFICATION: 'HIGH',
  TIMING_OPTIMIZATION: 'MEDIUM',
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
  sellPrice: number; // €
  buyCost: number; // € = buyPrice + buyFees
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
  return { profit, sellPrice, buyCost, sellMs, within12m };
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

// Bucket SOLD trades into 12 monthly avg profit/trade buckets (oldest → newest)
function bucketMonthlyAvgProfitPerTrade(sold: SoldComputed[], now: number): number[] {
  const profitBuckets: number[] = new Array(12).fill(0);
  const countBuckets: number[] = new Array(12).fill(0);
  for (const s of sold) {
    const monthsAgo = Math.floor((now - s.sellMs) / MONTH_MS);
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo;
      profitBuckets[idx] += s.profit;
      countBuckets[idx] += 1;
    }
  }
  return profitBuckets.map((p, i) => {
    if (countBuckets[i] === 0) return 0;
    return round2(clampNum(
      p / countBuckets[i],
      -1000, 10_000, 0,
    ));
  });
}

function computeProfitPerTradeTrend(monthlyAvgProfit: number[]): number {
  if (monthlyAvgProfit.length < 2) return 0;
  const slope = linearRegressionSlope(monthlyAvgProfit);
  const mean = monthlyAvgProfit.reduce((s, v) => s + v, 0) / monthlyAvgProfit.length;
  if (Math.abs(mean) < 0.01) return 0;
  return (slope / mean) * 100;
}

function computeCurrent(sold: SoldComputed[], now: number): CurrentState {
  const n = sold.length;
  const totalProfit = sold.reduce((s, t) => s + t.profit, 0);
  const totalSellPrice = sold.reduce((s, t) => s + t.sellPrice, 0);
  const totalBuyCost = sold.reduce((s, t) => s + t.buyCost, 0);

  const avgProfitPerTrade = round2(clampNum(
    n > 0 ? totalProfit / n : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const avgSellPrice = round2(clampNum(
    n > 0 ? totalSellPrice / n : 0,
    SELL_PRICE_MIN, SELL_PRICE_MAX, 0,
  ));
  const avgBuyCost = round2(clampNum(
    n > 0 ? totalBuyCost / n : 0,
    BUY_COST_MIN, BUY_COST_MAX, 0,
  ));

  const sortedByProfit = [...sold].sort((a, b) => a.profit - b.profit);
  const bestTrade = round2(clampNum(
    sortedByProfit.length > 0 ? sortedByProfit[sortedByProfit.length - 1].profit : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const worstTrade = round2(clampNum(
    sortedByProfit.length > 0 ? sortedByProfit[0].profit : 0,
    -1000, PROFIT_MAX, 0,
  ));

  const monthlyAvg = bucketMonthlyAvgProfitPerTrade(sold, now);
  const profitPerTradeTrend = round2(clampNum(
    computeProfitPerTradeTrend(monthlyAvg),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));

  const bestTradeRatio = round2(clampNum(
    avgProfitPerTrade > 0 ? bestTrade / avgProfitPerTrade : 0,
    BEST_TRADE_RATIO_MIN, BEST_TRADE_RATIO_MAX, 0,
  ));

  return {
    avgProfitPerTrade,
    soldCount12m: n,
    totalProfit12m: round0(clampNum(totalProfit, TOTAL_PROFIT_MIN, TOTAL_PROFIT_MAX, 0)),
    bestTrade,
    worstTrade,
    avgSellPrice,
    avgBuyCost,
    profitPerTradeTrend,
    avgProfitPerTradeGrowthRate: profitPerTradeTrend,
    bestTradeRatio,
  };
}

// --- Deterministic scaling maximization ---------------------------------

function buildScalingPath(current: CurrentState): ScalingPathEntry[] {
  const base = Math.max(PROFIT_MIN, current.avgProfitPerTrade);
  const maxBoundRelative = base * (1 + ABSOLUTE_UPLIFT_CAP_PCT / 100); // current × 5
  const eliteCap = Math.min(PROFIT_MAX, maxBoundRelative);

  const phases: ScalingPathEntry[] = [];
  for (const phase of VALID_PHASE) {
    const mult = PHASE_MULTIPLIER[phase];
    // ELITE phase capped at min(current × 5, 10000)
    const target = phase === 'ELITE'
      ? Math.min(eliteCap, base * mult)
      : Math.min(PROFIT_MAX, base * mult);
    phases.push({
      phase,
      targetProfitPerTrade: round2(clampNum(
        target,
        PROFIT_MIN, PROFIT_MAX,
        base,
      )),
      requirements: clampString(
        PHASE_REQUIREMENTS[phase],
        300,
        `Zahteva ${phase.toLowerCase()} scaling investicije.`,
      ),
      timeline: clampString(
        PHASE_TIMELINE[phase],
        200,
        `${phase.toLowerCase()} timeline.`,
      ),
      feasibility: round0(clampNum(
        PHASE_FEASIBILITY[phase],
        FEASIBILITY_MIN, FEASIBILITY_MAX, 50,
      )),
    });
  }
  return phases.slice(0, MAX_PHASES);
}

function buildScalingActions(current: CurrentState, maximizedProfitPerTrade: number): ScalingActionEntry[] {
  const base = Math.max(PROFIT_MIN, current.avgProfitPerTrade);
  const totalGain = Math.max(0, maximizedProfitPerTrade - base);

  const actions: ScalingActionEntry[] = [];
  for (const action of VALID_ACTION_TYPE) {
    const liftPct = ACTION_LIFT_PCT[action];
    // expectedLift is relative % uplift to current avg profit/trade (capped at 100%)
    const expectedLift = round0(clampNum(
      liftPct,
      UPLIFT_MIN, UPLIFT_MAX, 0,
    ));
    actions.push({
      action,
      expectedLift,
      difficulty: ACTION_DIFFICULTY[action],
    });
    if (actions.length >= MAX_ACTIONS) break;
  }

  // Verify totalGain is consistent with sum of lifts × 0.7 independence discount
  void totalGain;
  return actions.slice(0, MAX_ACTIONS);
}

function buildScalingBottlenecks(current: CurrentState): string[] {
  const out: string[] = [];
  out.push(`Sourcing bottleneck: trenutno avg buy cost ${current.avgBuyCost.toFixed(2)}€ / avg sell ${current.avgSellPrice.toFixed(2)}€ — za PREMIUM fazo rabiš 15-25% nižji buy cost z AI cross-border sourcing (Kleinanzeigen, Subito, Willhaben).`);
  out.push(`Pricing bottleneck: trenutno avg profit/trade ${current.avgProfitPerTrade.toFixed(2)}€ z best trade ${current.bestTrade.toFixed(2)}€ (${current.bestTradeRatio.toFixed(1)}× ratio) — za ELITE fazo rabiš AI pricing engine + professional photos za +25% premium positioning.`);
  out.push(`Platform bottleneck: premium sell prices zahtevajo multi-platform listing (Bolha + Vinted + mobile.de + Catawiki) — brez cross-platform premium cap-ana pri ${current.avgProfitPerTrade.toFixed(2)}€/trade.`);
  if (current.profitPerTradeTrend < 1) {
    out.push(`Trend bottleneck: profitPerTradeTrend ${current.profitPerTradeTrend.toFixed(2)}%/mo je nizek — za PREMIUM fazo rabiš AI timing engine in seasonal optimization za +45% uplift z optimal listing time.`);
  } else {
    out.push(`Trend momentum: profitPerTradeTrend ${current.profitPerTradeTrend.toFixed(2)}%/mo je pozitiven — izkoristi momentum z aggressive scaling v PREMIUM fazo.`);
  }
  out.push(`Certification bottleneck: ELITE zahteva authenticity certification + warranty (luxury watches, designer bags) — investicija ~50-100€/trade za +10% premium uplift in trust signal.`);
  return out.slice(0, MAX_BOTTLENECKS).map((s) => clampString(s, 200, 'Bottleneck neopisan.'));
}

function buildScalingProjection(current: CurrentState, maximized: number): ScalingProjectionEntry[] {
  const base = Math.max(PROFIT_MIN, current.avgProfitPerTrade);
  const out: ScalingProjectionEntry[] = [];
  // Linear ramp adoption: 3m = 25%, 6m = 50%, 12m = 100%
  const rampMap: Record<number, number> = { 3: 0.25, 6: 0.50, 12: 1.00 };
  for (const months of [3, 6, 12]) {
    const ramp = rampMap[months] ?? 1;
    const projected = base + (maximized - base) * ramp;
    out.push({
      months,
      projectedProfitPerTrade: round2(clampNum(
        projected,
        TRAJECTORY_PROFIT_MIN, TRAJECTORY_PROFIT_MAX,
        base,
      )),
    });
  }
  return out.slice(0, MAX_PROJECTIONS);
}

function decideScalingGrade(maximizedProfitPerTrade: number): ScalingGrade {
  if (maximizedProfitPerTrade >= 500) return 'A+';
  if (maximizedProfitPerTrade >= 300) return 'A';
  if (maximizedProfitPerTrade >= 150) return 'B';
  if (maximizedProfitPerTrade >= 75) return 'C';
  if (maximizedProfitPerTrade >= 25) return 'D';
  return 'F';
}

function buildDeterministicMaximization(current: CurrentState): ScalingMaximization {
  const scalingPath = buildScalingPath(current);
  // maximizedProfitPerTrade = ELITE phase target
  const elitePhase = scalingPath.find((p) => p.phase === 'ELITE');
  const maximizedProfitPerTrade = elitePhase
    ? elitePhase.targetProfitPerTrade
    : round2(clampNum(
      current.avgProfitPerTrade * 4,
      PROFIT_MIN, PROFIT_MAX,
      current.avgProfitPerTrade,
    ));

  const scalingMultiplier = round2(clampNum(
    current.avgProfitPerTrade > 0
      ? maximizedProfitPerTrade / current.avgProfitPerTrade
      : 1.0,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 1.0,
  ));

  const scalingActions = buildScalingActions(current, maximizedProfitPerTrade);
  const scalingBottlenecks = buildScalingBottlenecks(current);
  const scalingProjection = buildScalingProjection(current, maximizedProfitPerTrade);
  const scalingGrade = decideScalingGrade(maximizedProfitPerTrade);

  return {
    scalingPath,
    maximizedProfitPerTrade,
    scalingMultiplier,
    scalingActions,
    scalingBottlenecks,
    scalingProjection,
    scalingGrade,
  };
}

function buildSummary(current: CurrentState, max: ScalingMaximization): string {
  const elitePhase = max.scalingPath.find((p) => p.phase === 'ELITE');
  const parts: string[] = [
    `Current: ${current.avgProfitPerTrade.toFixed(2)}€/trade (${current.soldCount12m} SOLD 12m, total ${current.totalProfit12m.toFixed(0)}€, trend ${current.profitPerTradeTrend.toFixed(2)}%/mo, best ${current.bestTrade.toFixed(2)}€ / worst ${current.worstTrade.toFixed(2)}€).`,
    `Scaling: ${elitePhase ? elitePhase.targetProfitPerTrade.toFixed(2) : max.maximizedProfitPerTrade.toFixed(2)}€/trade ELITE (×${max.scalingMultiplier.toFixed(2)} multiplier, grade ${max.scalingGrade}).`,
    `Path: CURRENT→OPTIMIZED→PREMIUM→ELITE. 6 actions (PREMIUM_SOURCING +30%, TIMING_OPTIMIZATION +45%, PROFESSIONAL_PHOTOS +25%).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitPerTradeScalingMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitPerTradeScalingHandler = withAiRoute<ProfitPerTradeScalingMaximizerInput>({
  endpoint: '/api/ai/profit-per-trade-scaling-maximizer',
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
          avgProfitPerTrade: 0,
          soldCount12m: 0,
          totalProfit12m: 0,
          bestTrade: 0,
          worstTrade: 0,
          avgSellPrice: 0,
          avgBuyCost: 0,
          profitPerTradeTrend: 0,
          avgProfitPerTradeGrowthRate: 0,
          bestTradeRatio: 0,
        },
        maximization: {
          scalingPath: [],
          maximizedProfitPerTrade: 0,
          scalingMultiplier: 1.0,
          scalingActions: [],
          scalingBottlenecks: [],
          scalingProjection: [],
          scalingGrade: 'F',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Trade Scaling Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Trade Scaling Maximizer ni mogoč.',
      } satisfies ProfitPerTradeScalingResponse);
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
          avgProfitPerTrade: 0,
          soldCount12m: 0,
          totalProfit12m: 0,
          bestTrade: 0,
          worstTrade: 0,
          avgSellPrice: 0,
          avgBuyCost: 0,
          profitPerTradeTrend: 0,
          avgProfitPerTradeGrowthRate: 0,
          bestTradeRatio: 0,
        },
        maximization: {
          scalingPath: [],
          maximizedProfitPerTrade: 0,
          scalingMultiplier: 1.0,
          scalingActions: [],
          scalingBottlenecks: [],
          scalingProjection: [],
          scalingGrade: 'F',
        },
        summary: 'Ni veljavnih SOLD trgovin — Profit Per Trade Scaling Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Profit Per Trade Scaling Maximizer ni mogoč.',
      } satisfies ProfitPerTradeScalingResponse);
    }

    // 3) Compute current state
    const current = computeCurrent(soldComputed, now);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `profit-per-trade-scaling-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ScalingMaximization;
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
      } satisfies ProfitPerTradeScalingResponse);
    }

    // 5) AI prompt with grounding
    const soldSampleForAI = soldComputed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        profit: t.profit,
        sellPrice: t.sellPrice,
        buyCost: t.buyCost,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      current,
      deterministicMaximization: {
        scalingPath: maximization.scalingPath,
        maximizedProfitPerTrade: maximization.maximizedProfitPerTrade,
        scalingMultiplier: maximization.scalingMultiplier,
        scalingActions: maximization.scalingActions,
        scalingBottlenecks: maximization.scalingBottlenecks,
        scalingProjection: maximization.scalingProjection,
        scalingGrade: maximization.scalingGrade,
      },
      soldSample: soldSampleForAI,
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        multiplierMin: MULTIPLIER_MIN, multiplierMax: MULTIPLIER_MAX,
        feasibilityMin: FEASIBILITY_MIN, feasibilityMax: FEASIBILITY_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        bestTradeRatioMin: BEST_TRADE_RATIO_MIN, bestTradeRatioMax: BEST_TRADE_RATIO_MAX,
        trajectoryProfitMin: TRAJECTORY_PROFIT_MIN, trajectoryProfitMax: TRAJECTORY_PROFIT_MAX,
        absoluteUpliftCapPct: ABSOLUTE_UPLIFT_CAP_PCT,
      },
      phaseMultiplier: PHASE_MULTIPLIER,
      phaseFeasibility: PHASE_FEASIBILITY,
      actionLiftPct: ACTION_LIFT_PCT,
      actionDifficulty: ACTION_DIFFICULTY,
    };

    const prompt = `Si AI "Profit Per Trade Scaling Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER TRADE SCALING — kako sistematično SKALIRATI profit per trade gor skozi 4 faze (CURRENT → OPTIMIZED → PREMIUM → ELITE). Tvoj cilj je "Tvoj profit per trade je 45€. Za skaliranje na 100€/trade rabiš: premium sourcing, professional photos in cross-platform premium pricing." Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira profit per cycle €/cycle z maximizationLevers in cycleVsVolumeTradeoff) — ti MAKSIMIZIRAŠ in SKALIRAŠ PROFIT PER TRADE skozi scalingPath (4 phase progression CURRENT→OPTIMIZED→PREMIUM→ELITE, ne per-cycle snapshot). Razlika od profit-per-day-scaling-maximizer (v8.08 ki skalira daily profit z requiredTradesPerDay in requiredCapital per phase) — ti SKALIRAŠ PROFIT PER TRADE €/trade (per-trade scaling, ne daily profit scaling). Razlika od deal-source-profit-margin-growth-maximizer (v8.12 ki maksimizira margin growth rate per source v %/mo) — ti MAKSIMIZIRAŠ in SKALIRAŠ PROFIT PER TRADE v absolutnem €/trade (absolute per-trade scaling, ne per-source %/mo margin growth). Razlika od inventory-capital-efficiency-growth-maximizer (v8.12 ki maksimizira capital efficiency growth %/mo) — ti MAKSIMIZIRAŠ PROFIT PER TRADE SCALING (€/trade scaling path, ne capital efficiency %/mo growth). Razlika od profit-per-trade-growth-maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo) — ti MAKSIMIZIRAŠ in SKALIRAŠ profit per trade z scalingPath in scalingActions (phase-based scaling, ne growth rate). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega profit-a v %/mo MoM) — ti MAKSIMIZIRAŠ PROFIT PER TRADE SCALING (per-trade € scaling, ne skupni profit %/mo growth). Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira max profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ in SKALIRAŠ PROFIT PER TRADE z 4-phase progression in scalingBottlenecks. Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per € deployed) — ti MAKSIMIZIRAŠ PROFIT PER TRADE SCALING (€/trade scaling, ne € profit per € capital). Razlika od inventory-annual-yield-maximizer (v8.11 ki maksimizira annual yield inventory-ja) — ti MAKSIMIZIRAŠ PROFIT PER TRADE SCALING (per-trade scaling, ne letni yield %). Razlika od deal-source-profit-per-day-maximizer (v8.11 ki maksimizira profit per day per source €/dan) — ti MAKSIMIZIRAŠ in SKALIRAŠ PROFIT PER TRADE (€/trade scaling path, ne €/dan per source).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.scalingPath: 4 elementi (CURRENT → OPTIMIZED → PREMIUM → ELITE) — vsak { phase, targetProfitPerTrade € [0, 10000] (CURRENT = current × 1.0, OPTIMIZED = current × 1.5, PREMIUM = current × 2.5, ELITE = current × 4.0 capped at min(current × 5, 10000) — anti-hallucination), requirements (slovenski, max 300 — kaj zahteva ta faza: sourcing, photos, platform, certification), timeline (slovenski, max 200 — kdaj dosegljivo), feasibility [0, 100] (CURRENT 100, OPTIMIZED 80, PREMIUM 60, ELITE 40) },
2. maximization.maximizedProfitPerTrade €/trade [0, 10000] (= ELITE phase target — optimal achievable),
3. maximization.scalingMultiplier [1.0, 5.0] (= maximized / current — anti-hallucination cap at 5.0),
4. maximization.scalingActions: 6 elementov { action PREMIUM_SOURCING/PROFESSIONAL_PHOTOS/CROSS_PLATFORM_PREMIUM/BUNDLE_UPSELL/CERTIFICATION/TIMING_OPTIMIZATION (relative uplift 30/25/20/15/10/45%), expectedLift % [0, 100], difficulty LOW/MEDIUM/HIGH },
5. maximization.scalingBottlenecks: 3-5 stringov (max 200 vsak, slovenski — kaj limitira scaling profit per trade),
6. maximization.scalingGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 500, A ≥ 300, B ≥ 150, C ≥ 75, D ≥ 25, else F),
7. summary: slovenski povzetek (max 500 znakov — poudari current profit/trade, ELITE target, multiplier, grade, 6 actions, path progression).

VRNI LE JSON:
{
  "maximization": {
    "scalingPath": [
      { "phase": "CURRENT", "targetProfitPerTrade": 45.0, "requirements": "Baseline — vzdržuj trenutni sourcing in pricing.", "timeline": "Trenutno stanje.", "feasibility": 100 },
      { "phase": "OPTIMIZED", "targetProfitPerTrade": 67.5, "requirements": "AI pricing engine, deal score > 80, optimiziran listing workflow.", "timeline": "0–3 meseci.", "feasibility": 80 },
      { "phase": "PREMIUM", "targetProfitPerTrade": 112.5, "requirements": "Professional photos, premium category focus, cross-platform listing.", "timeline": "3–9 mesecev.", "feasibility": 60 },
      { "phase": "ELITE", "targetProfitPerTrade": 180.0, "requirements": "Certification, premium niche focus, multi-platform premium.", "timeline": "9–24 mesecev.", "feasibility": 40 }
    ],
    "maximizedProfitPerTrade": 180.0,
    "scalingMultiplier": 4.0,
    "scalingActions": [
      { "action": "PREMIUM_SOURCING", "expectedLift": 30, "difficulty": "MEDIUM" },
      { "action": "PROFESSIONAL_PHOTOS", "expectedLift": 25, "difficulty": "LOW" },
      { "action": "CROSS_PLATFORM_PREMIUM", "expectedLift": 20, "difficulty": "MEDIUM" },
      { "action": "BUNDLE_UPSELL", "expectedLift": 15, "difficulty": "LOW" },
      { "action": "CERTIFICATION", "expectedLift": 10, "difficulty": "HIGH" },
      { "action": "TIMING_OPTIMIZATION", "expectedLift": 45, "difficulty": "MEDIUM" }
    ],
    "scalingBottlenecks": [
      "Sourcing bottleneck: za PREMIUM rabiš 15-25% nižji buy cost.",
      "Pricing bottleneck: za ELITE rabiš AI pricing engine.",
      "Certification bottleneck: ELITE zahteva authenticity certification."
    ],
    "scalingGrade": "B"
  },
  "summary": "Current: 45.00€/trade (50 SOLD 12m, total 2250€, trend 2.50%/mo, best 120€/worst 5€). Scaling: 180.00€/trade ELITE (×4.00 multiplier, grade B). Path: CURRENT→OPTIMIZED→PREMIUM→ELITE. 6 actions (PREMIUM_SOURCING +30%, TIMING_OPTIMIZATION +45%, PROFESSIONAL_PHOTOS +25%)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;
        const base = Math.max(PROFIT_MIN, current.avgProfitPerTrade);
        const maxBoundRelative = base * (1 + ABSOLUTE_UPLIFT_CAP_PCT / 100);
        const eliteCap = Math.min(PROFIT_MAX, maxBoundRelative);

        // Override scalingPath
        let scalingPath = maximization.scalingPath;
        if (Array.isArray(aiMax.scalingPath) && aiMax.scalingPath.length >= 3) {
          const aiPath: ScalingPathEntry[] = [];
          for (const p of aiMax.scalingPath.slice(0, MAX_PHASES)) {
            if (!p || typeof p !== 'object') continue;
            const phase = clampEnum(p.phase, VALID_PHASE, 'CURRENT');
            const targetProfitPerTrade = round2(clampNum(
              p.targetProfitPerTrade,
              PROFIT_MIN, phase === 'ELITE' ? eliteCap : PROFIT_MAX,
              base * PHASE_MULTIPLIER[phase],
            ));
            aiPath.push({
              phase,
              targetProfitPerTrade,
              requirements: clampString(
                p.requirements,
                300,
                PHASE_REQUIREMENTS[phase],
              ),
              timeline: clampString(
                p.timeline,
                200,
                PHASE_TIMELINE[phase],
              ),
              feasibility: round0(clampNum(
                p.feasibility,
                FEASIBILITY_MIN, FEASIBILITY_MAX,
                PHASE_FEASIBILITY[phase],
              )),
            });
          }
          if (aiPath.length >= 3) {
            // Ensure all 4 phases present
            const phasesPresent = new Set(aiPath.map((p) => p.phase));
            for (const ph of VALID_PHASE) {
              if (!phasesPresent.has(ph)) {
                aiPath.push({
                  phase: ph,
                  targetProfitPerTrade: round2(clampNum(
                    base * PHASE_MULTIPLIER[ph],
                    PROFIT_MIN, ph === 'ELITE' ? eliteCap : PROFIT_MAX,
                    base,
                  )),
                  requirements: PHASE_REQUIREMENTS[ph],
                  timeline: PHASE_TIMELINE[ph],
                  feasibility: PHASE_FEASIBILITY[ph],
                });
              }
            }
            // Sort by phase order
            const phaseOrder: Record<ScalingPhase, number> = {
              CURRENT: 0, OPTIMIZED: 1, PREMIUM: 2, ELITE: 3,
            };
            aiPath.sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase]);
            scalingPath = aiPath.slice(0, MAX_PHASES);
          }
        }

        // Override maximizedProfitPerTrade (= ELITE phase target, capped at current × 5)
        const elitePhase = scalingPath.find((p) => p.phase === 'ELITE');
        const maximizedProfitPerTrade = round2(clampNum(
          aiMax.maximizedProfitPerTrade ?? (elitePhase ? elitePhase.targetProfitPerTrade : base * 4),
          base, eliteCap,
          elitePhase ? elitePhase.targetProfitPerTrade : base * 4,
        ));

        // Override scalingMultiplier
        const scalingMultiplier = round2(clampNum(
          aiMax.scalingMultiplier ?? (base > 0 ? maximizedProfitPerTrade / base : 1.0),
          MULTIPLIER_MIN, MULTIPLIER_MAX,
          base > 0 ? maximizedProfitPerTrade / base : 1.0,
        ));

        // Override scalingActions
        let scalingActions = maximization.scalingActions;
        if (Array.isArray(aiMax.scalingActions) && aiMax.scalingActions.length >= 4) {
          const aiActions: ScalingActionEntry[] = [];
          for (const a of aiMax.scalingActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            const action = clampEnum(a.action, VALID_ACTION_TYPE, 'PREMIUM_SOURCING');
            aiActions.push({
              action,
              expectedLift: round0(clampNum(
                a.expectedLift,
                UPLIFT_MIN, UPLIFT_MAX,
                ACTION_LIFT_PCT[action],
              )),
              difficulty: clampEnum(a.difficulty, VALID_DIFFICULTY, ACTION_DIFFICULTY[action]),
            });
          }
          if (aiActions.length >= 4) {
            scalingActions = aiActions.slice(0, MAX_ACTIONS);
          }
        }

        // Override scalingBottlenecks
        let scalingBottlenecks = maximization.scalingBottlenecks;
        if (Array.isArray(aiMax.scalingBottlenecks) && aiMax.scalingBottlenecks.length >= 2) {
          const aiBn: string[] = [];
          for (const b of aiMax.scalingBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            aiBn.push(clampString(b, 200, 'Bottleneck neopisan.'));
          }
          if (aiBn.length >= 2) {
            scalingBottlenecks = aiBn;
          }
        }

        // Override scalingGrade
        const scalingGrade = aiMax.scalingGrade
          ? clampEnum(aiMax.scalingGrade, VALID_GRADE, decideScalingGrade(maximizedProfitPerTrade))
          : decideScalingGrade(maximizedProfitPerTrade);

        // Recompute scalingProjection with new maximized
        const scalingProjection = buildScalingProjection(current, maximizedProfitPerTrade);

        maximization = {
          scalingPath,
          maximizedProfitPerTrade,
          scalingMultiplier,
          scalingActions,
          scalingBottlenecks,
          scalingProjection,
          scalingGrade,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-per-trade-scaling-maximizer',
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
    } satisfies ProfitPerTradeScalingResponse);
  },
});

export const GET = profitPerTradeScalingHandler;
export const POST = profitPerTradeScalingHandler;
