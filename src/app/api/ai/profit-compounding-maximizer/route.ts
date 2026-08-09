// v8.04: AI Profit Compounding Maximizer — AI MAXIMIZIRA COMPOUNDING EFFECT
// reinvestiranega profita. Prikazuje kako reinvestiranje X% profita pri Y% ROI
// produces EXPONENTIAL growth vs LINEAR. "Če reinvestiraš 80% profita pri 25%
// ROI per cycle, tvojih 1000€ postane 9536€ v 12 ciklih — vs 4000€ z linear
// growth." Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding
// capital growth z growth rate) — ta MAXIMIZIRA COMPOUNDING EFFECT z
// reinvestRate scenarios (50%/60%/70%/80%/90%/100%) in optimalReinvestRate.
// Razlika od profit-scale-engine (v8.02 ki SCALE-A cel business z phased plan)
// — ta maksimizira COMPOUNDING z reinvestRate optimization. Razlika od
// profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ta
// maksimizira COMPOUNDING z linearVsCompounding comparison in breakEvenTime.
// Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers)
// — ta fokusira na COMPOUNDING reinvest rate optimization z month-by-month
// 24m projection. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira
// REVENUE growth) — ta maksimizira COMPOUNDING PROFIT (bottom-line) z
// exponential growth projection. Razlika od profit-velocity-maximizer (v7.98
// ki maksimizira €/day velocity) — ta daje COMPOUNDING view z
// compoundingMultiplier in breakEvenTime. Razlika od inventory-yield-maximizer
// (v8.03 ki maksimizira yield per item) — ta maksimizira COMPOUNDING čez cel
// portfolio z reinvest scenarios.
//
// "Current: 1500€/mo profit, 20% reinvest rate, 35% avg ROI per cycle, 30d
// cycle time. Scenarios: 50% reinvest → 9400€ v 12m, 80% reinvest → 28500€ v
// 12m, 100% reinvest → 56200€ v 12m. Optimal reinvest rate: 80% (max capital
// growth while maintaining 300€/mo cash flow). Compounding projection 24m:
// M1 1500, M2 1800, M3 2160, ..., M24 12400. Linear vs Compounding: 18000€
// (linear) vs 82500€ (compounding at 80% reinvest) — 4.6x advantage.
// Compounding grade: B. Break-even: compounding overtakes linear v M3."

// GET+POST /api/ai/profit-compounding-maximizer
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

type CompoundingGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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
  currentMonthlyProfit: number; // €/mo
  currentReinvestRate: number; // % (0-100) — assumed default 20% if no held growth data
  currentCycleTime: number; // days per cycle (avg hold time)
  avgROI: number; // % per cycle
  startingCapital: number; // € (estimated current deployed capital)
}

interface CompoundingScenario {
  reinvestRate: number; // % 50-100
  monthlyGrowthRate: number; // % per month
  projectedCapital12m: number; // €
  projectedProfit12m: number; // €
  compoundingMultiplier: number; // x (finalCapital / startingCapital)
}

interface MonthlyProjectionPoint {
  month: number; // 1-24
  capitalStart: number;
  profit: number;
  reinvested: number;
  cashFlow: number;
  capitalEnd: number;
}

interface LinearVsCompounding {
  linear12mProfit: number;
  compounding12mProfit: number;
  advantageMultiple: number; // x (compounding / linear)
  breakEvenMonth: number; // month where compounding overtakes linear
}

interface CompoundingMaximization {
  compoundingScenarios: CompoundingScenario[];
  optimalReinvestRate: number; // %
  maximizedCompoundingProjection: MonthlyProjectionPoint[];
  linearVsCompounding: LinearVsCompounding;
  compoundingAccelerationActions: string[];
  compoundingGrade: CompoundingGrade;
  breakEvenTime: number; // months (crossover point)
}

interface ProfitCompoundingResponse {
  ok: true;
  current: CurrentState;
  maximization: CompoundingMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  compoundingScenarios?: Array<{
    reinvestRate?: number;
    monthlyGrowthRate?: number;
    projectedCapital12m?: number;
    projectedProfit12m?: number;
    compoundingMultiplier?: number;
  }>;
  optimalReinvestRate?: number;
  maximizedCompoundingProjection?: Array<{
    month?: number;
    capitalStart?: number;
    profit?: number;
    reinvested?: number;
    cashFlow?: number;
    capitalEnd?: number;
  }>;
  linearVsCompounding?: {
    linear12mProfit?: number;
    compounding12mProfit?: number;
    advantageMultiple?: number;
    breakEvenMonth?: number;
  };
  compoundingAccelerationActions?: string[];
  compoundingGrade?: CompoundingGrade;
  breakEvenTime?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 1_000_000;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const RATE_MIN = 0;
const RATE_MAX = 100;
const REINVEST_MIN = 50;
const REINVEST_MAX = 100;
const GROWTH_MIN = 0;
const GROWTH_MAX = 200; // % per month
const MULTIPLIER_MIN = 1.0;
const MULTIPLIER_MAX = 100.0;
const ROI_MIN = -50;
const ROI_MAX = 500;
const CYCLE_MIN = 1;
const CYCLE_MAX = 365;
const MONTH_MIN = 1;
const MONTH_MAX = 24;

const VALID_GRADE: readonly CompoundingGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const REINVEST_RATES: readonly number[] = [50, 60, 70, 80, 90, 100];
const MAX_ACTIONS = 8;

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
  profit: number;
  cost: number;
  roi: number; // %
  holdDays: number;
  sellMs: number;
  within12m: boolean;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(0, Math.round((sellMs - buyMs) / DAY_MS))
    : 0;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { profit, cost, roi, holdDays, sellMs, within12m };
}

interface SoldAgg {
  profit12m: number;
  count12m: number;
  totalROI: number;
  totalHoldDays: number;
}

function aggregateSold(trades: SoldComputed[]): SoldAgg {
  let profit12m = 0;
  let count12m = 0;
  let totalROI = 0;
  let totalHoldDays = 0;
  for (const t of trades) {
    if (t.within12m) {
      profit12m += t.profit;
      count12m += 1;
      totalROI += t.roi;
      totalHoldDays += t.holdDays;
    }
  }
  return { profit12m, count12m, totalROI, totalHoldDays };
}

function computeCurrent(agg: SoldAgg, heldCapital: number): CurrentState {
  const avgROI = round2(clampNum(
    agg.count12m > 0 ? agg.totalROI / agg.count12m : 30,
    ROI_MIN, ROI_MAX, 30,
  ));
  const currentCycleTime = round0(clampNum(
    agg.count12m > 0 ? agg.totalHoldDays / agg.count12m : 30,
    CYCLE_MIN, CYCLE_MAX, 30,
  ));
  const currentMonthlyProfit = round0(clampNum(
    agg.count12m > 0 ? agg.profit12m / 12 : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  // Default reinvest rate: assume 20% if no specific info (typical for flipping)
  const currentReinvestRate = 20;
  // Starting capital = current held capital (or derived from monthly profit × cycle ratio)
  const startingCapital = round0(clampNum(
    heldCapital > 0 ? heldCapital : Math.max(1000, currentMonthlyProfit * 6),
    CAPITAL_MIN, CAPITAL_MAX, 1000,
  ));

  return {
    currentMonthlyProfit,
    currentReinvestRate,
    currentCycleTime,
    avgROI,
    startingCapital,
  };
}

// Monthly growth rate = (reinvestRate/100) × (avgROI/100) × (30/cycleTime)
// → % growth of capital per month from reinvested profit
function computeMonthlyGrowthRate(reinvestRate: number, current: CurrentState): number {
  const cyclesPerMonth = current.currentCycleTime > 0
    ? 30 / current.currentCycleTime
    : 1;
  const growth = (reinvestRate / 100) * (current.avgROI / 100) * cyclesPerMonth;
  // Convert to %
  return round2(clampNum(growth * 100, GROWTH_MIN, GROWTH_MAX, 0));
}

function buildScenario(reinvestRate: number, current: CurrentState): CompoundingScenario {
  const monthlyGrowthRate = computeMonthlyGrowthRate(reinvestRate, current);
  // Compounding formula: capital × (1 + monthlyGrowthRate)^12
  const baseCapital = Math.max(1, current.startingCapital);
  const growthMult = Math.pow(1 + monthlyGrowthRate / 100, 12);
  const projectedCapital12m = round0(clampNum(
    baseCapital * growthMult,
    CAPITAL_MIN, CAPITAL_MAX, baseCapital,
  ));
  // Projected profit = projectedCapital - startingCapital + cashFlow withdrawals
  // Cash flow = (1 - reinvestRate/100) × monthly profit (compounded)
  const cashFlowFactor = (100 - reinvestRate) / 100;
  // Sum of geometric series for cash flow over 12 months
  // Simplification: avg monthly profit × 12 × cashFlowFactor (with growth)
  const avgMonthlyProfitAtMidGrowth = current.currentMonthlyProfit > 0
    ? current.currentMonthlyProfit * (1 + monthlyGrowthRate / 100 * 6)
    : baseCapital * (monthlyGrowthRate / 100) * (1 + monthlyGrowthRate / 100 * 6);
  const projectedProfit12m = round0(clampNum(
    Math.max(0, projectedCapital12m - baseCapital + avgMonthlyProfitAtMidGrowth * 12 * cashFlowFactor),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const compoundingMultiplier = round2(clampNum(
    projectedCapital12m / baseCapital,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 1.0,
  ));

  return {
    reinvestRate,
    monthlyGrowthRate,
    projectedCapital12m,
    projectedProfit12m,
    compoundingMultiplier,
  };
}

function buildScenarios(current: CurrentState): CompoundingScenario[] {
  return REINVEST_RATES.map((rate) => buildScenario(rate, current));
}

function decideOptimalReinvestRate(scenarios: CompoundingScenario[]): number {
  // Optimal = max capital growth while maintaining cash flow
  // Heuristic: pick the rate that maximizes projectedCapital12m × 0.7 + cashFlowProxy × 0.3
  // where cashFlowProxy = (100 - reinvestRate) / 100 × projectedProfit12m
  let best = 80;
  let bestScore = 0;
  for (const s of scenarios) {
    const cashFlowProxy = ((100 - s.reinvestRate) / 100) * s.projectedProfit12m;
    const score = s.projectedCapital12m * 0.7 + cashFlowProxy * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = s.reinvestRate;
    }
  }
  return best;
}

function buildMaximizedProjection(
  optimalRate: number,
  current: CurrentState,
): MonthlyProjectionPoint[] {
  // 24-month projection at optimal reinvest rate
  const monthlyGrowthRate = computeMonthlyGrowthRate(optimalRate, current);
  const cashFlowFactor = (100 - optimalRate) / 100;
  const points: MonthlyProjectionPoint[] = [];
  let capital = Math.max(1, current.startingCapital);
  // Initial monthly profit (if 0, derive from capital × growth rate)
  let monthlyProfit = current.currentMonthlyProfit > 0
    ? current.currentMonthlyProfit
    : capital * (monthlyGrowthRate / 100);

  for (let m = 1; m <= 24; m++) {
    const capitalStart = round0(clampNum(capital, CAPITAL_MIN, CAPITAL_MAX, current.startingCapital));
    // Profit scales with capital (compounding): profit = capitalStart × (monthlyGrowthRate/100) / (reinvestRate/100) if reinvestRate > 0
    // Simpler model: profit = capitalStart × (avgROI/100) × (30/cycleTime)
    const cyclesThisMonth = current.currentCycleTime > 0 ? 30 / current.currentCycleTime : 1;
    const fullProfit = capitalStart * (current.avgROI / 100) * cyclesThisMonth;
    const reinvested = round0(clampNum(
      fullProfit * (optimalRate / 100),
      0, PROFIT_MAX, 0,
    ));
    const cashFlow = round0(clampNum(
      fullProfit * cashFlowFactor,
      0, PROFIT_MAX, 0,
    ));
    const profit = round0(clampNum(
      fullProfit,
      PROFIT_MIN, PROFIT_MAX, 0,
    ));
    capital = capitalStart + reinvested;
    const capitalEnd = round0(clampNum(
      capital,
      CAPITAL_MIN, CAPITAL_MAX, capitalStart,
    ));
    points.push({
      month: m,
      capitalStart,
      profit,
      reinvested,
      cashFlow,
      capitalEnd,
    });
    // Grow monthlyProfit for next iteration
    monthlyProfit = fullProfit;
  }
  return points;
}

function buildLinearVsCompounding(
  scenarios: CompoundingScenario[],
  optimalRate: number,
  current: CurrentState,
): LinearVsCompounding {
  // Linear: profit stays constant = currentMonthlyProfit × 12
  const linear12mProfit = round0(clampNum(
    current.currentMonthlyProfit * 12,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  // Compounding at optimal reinvest rate
  const optimalScenario = scenarios.find((s) => s.reinvestRate === optimalRate);
  const compounding12mProfit = optimalScenario?.projectedProfit12m ?? linear12mProfit;
  const advantageMultiple = round2(clampNum(
    linear12mProfit > 0 ? compounding12mProfit / linear12mProfit : 1.0,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 1.0,
  ));

  // Break-even month: when compounding cumulative profit > linear cumulative profit
  // Compounding grows geometrically; linear is constant
  // Break-even = month where (1 + g)^m × capital - capital > monthlyLinearProfit × m
  // Simplification: if advantage > 1, break-even is roughly 1 + ln(advantageMultiple) / ln(monthlyGrowthRate)
  // For default case, set break-even = 3 if growth is reasonable
  const optimalGrowth = optimalScenario?.monthlyGrowthRate ?? 0;
  let breakEvenMonth = 12; // default: by 12 months compounding always wins
  if (optimalGrowth > 0 && linear12mProfit > 0) {
    // Find month m where compounding profit > linear profit
    let compCum = 0;
    let linCum = 0;
    let cap = current.startingCapital;
    let found = false;
    for (let m = 1; m <= 24; m++) {
      const cyclesThisMonth = current.currentCycleTime > 0 ? 30 / current.currentCycleTime : 1;
      const fullProfitComp = cap * (current.avgROI / 100) * cyclesThisMonth;
      compCum += fullProfitComp;
      linCum += current.currentMonthlyProfit;
      cap += fullProfitComp * (optimalRate / 100);
      if (compCum > linCum && !found) {
        breakEvenMonth = m;
        found = true;
        break;
      }
    }
    if (!found) breakEvenMonth = 12;
  } else if (current.currentMonthlyProfit === 0) {
    breakEvenMonth = 1; // with 0 linear profit, compounding always wins from M1
  }
  breakEvenMonth = round0(clampNum(breakEvenMonth, 1, 24, 12));

  return {
    linear12mProfit,
    compounding12mProfit,
    advantageMultiple,
    breakEvenMonth,
  };
}

function buildAccelerationActions(
  scenarios: CompoundingScenario[],
  optimalRate: number,
  current: CurrentState,
): string[] {
  const actions: string[] = [];
  // 1) Reinvest rate
  const rateGap = Math.max(0, optimalRate - current.currentReinvestRate);
  actions.push(
    `Dvigni reinvest rate iz ${current.currentReinvestRate}% na ${optimalRate}% (+${round0(rateGap)}pp) za max compounding effect.`,
  );
  // 2) Cycle time reduction
  actions.push(
    `Skrajšaj cycle time iz ${current.currentCycleTime} dni na ${Math.max(7, Math.round(current.currentCycleTime * 0.7))} dni z avtomatiziranim sourcing + hitrim listing turnaround.`,
  );
  // 3) ROI improvement
  const targetROI = Math.min(ROI_MAX, current.avgROI * 1.2 + 5);
  actions.push(
    `Dvigni avg ROI iz ${current.avgROI}% na ${round2(targetROI)}% z premium pricing, refurbishment in boljšim sourcingom.`,
  );
  // 4) Capital base
  actions.push(
    `Injektiraj dodatni kapital (+${round0(current.startingCapital * 0.5)}€) za acceleration compounding growth — večji base = večji profit per cycle.`,
  );
  // 5) Automation pipeline
  actions.push(
    'Avtomatiziraj sourcing-to-sale pipeline z monitor alert-e in auto-listing za skrajšanje cycle time za 30%.',
  );
  // 6) Cross-platform compounding
  actions.push(
    'Razširi na 3+ platforme za cross-platform compounding — istočasno več cycle-ov v teku = večji monthly growth rate.',
  );
  // 7) VA team
  actions.push(
    'Onboard VA team za customer service + shipping — sprosti operaterja za sourcing + scaling capital velocity.',
  );
  // 8) Compounding reinvestment discipline
  actions.push(
    `Vzdržuj ${optimalRate}% reinvest rate dosledno — prekinevanje compounding za 1 mesec zmanjša 24m projection za ~${round0((scenarios.find((s) => s.reinvestRate === optimalRate)?.projectedCapital12m ?? 0) * 0.08)}€.`,
  );
  return actions.slice(0, MAX_ACTIONS);
}

function decideGrade(
  optimalScenario: CompoundingScenario | undefined,
  advantageMultiple: number,
): CompoundingGrade {
  // A+ if multiplier ≥ 8x or advantage ≥ 5x
  // A if multiplier ≥ 5x or advantage ≥ 3x
  // B if multiplier ≥ 3x or advantage ≥ 2x
  // C if multiplier ≥ 2x or advantage ≥ 1.5x
  // D if multiplier ≥ 1.5x or advantage ≥ 1.2x
  // else F
  const mult = optimalScenario?.compoundingMultiplier ?? 1.0;
  if (mult >= 8 || advantageMultiple >= 5) return 'A+';
  if (mult >= 5 || advantageMultiple >= 3) return 'A';
  if (mult >= 3 || advantageMultiple >= 2) return 'B';
  if (mult >= 2 || advantageMultiple >= 1.5) return 'C';
  if (mult >= 1.5 || advantageMultiple >= 1.2) return 'D';
  return 'F';
}

function buildDeterministicMaximization(current: CurrentState): CompoundingMaximization {
  const compoundingScenarios = buildScenarios(current);
  const optimalReinvestRate = decideOptimalReinvestRate(compoundingScenarios);
  const maximizedCompoundingProjection = buildMaximizedProjection(optimalReinvestRate, current);
  const linearVsCompounding = buildLinearVsCompounding(
    compoundingScenarios,
    optimalReinvestRate,
    current,
  );
  const compoundingAccelerationActions = buildAccelerationActions(
    compoundingScenarios,
    optimalReinvestRate,
    current,
  );
  const optimalScenario = compoundingScenarios.find((s) => s.reinvestRate === optimalReinvestRate);
  const compoundingGrade = decideGrade(optimalScenario, linearVsCompounding.advantageMultiple);

  return {
    compoundingScenarios,
    optimalReinvestRate,
    maximizedCompoundingProjection,
    linearVsCompounding,
    compoundingAccelerationActions,
    compoundingGrade,
    breakEvenTime: linearVsCompounding.breakEvenMonth,
  };
}

function buildSummary(current: CurrentState, max: CompoundingMaximization): string {
  const optimal = max.compoundingScenarios.find((s) => s.reinvestRate === max.optimalReinvestRate);
  const parts: string[] = [
    `Current: ${current.currentMonthlyProfit}€/mo, ${current.currentReinvestRate}% reinvest, ${current.currentCycleTime}d cycle, ${current.avgROI}% ROI.`,
    `Optimal reinvest: ${max.optimalReinvestRate}% → ${optimal?.projectedCapital12m ?? 0}€ v 12m (${optimal?.compoundingMultiplier ?? 1.0}x).`,
    `Linear vs Compounding: ${max.linearVsCompounding.linear12mProfit}€ vs ${max.linearVsCompounding.compounding12mProfit}€ (${max.linearVsCompounding.advantageMultiple}x advantage).`,
    `Grade: ${max.compoundingGrade}. Break-even: M${max.breakEvenTime}.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitCompoundingMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleProfitCompoundingMaximizer(req);
}

async function handleProfitCompoundingMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-compounding-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query SOLD trades last 12m + HELD trades for starting capital
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
        },
        take: 500,
      }) as unknown as { buyPrice: number; buyFees: number }[],
    ]);

    // Empty-state: no SOLD trades
    const heldCapital = heldTrades.reduce((s, h) => s + (h.buyPrice ?? 0) + (h.buyFees ?? 0), 0);
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          currentMonthlyProfit: 0,
          currentReinvestRate: 20,
          currentCycleTime: 30,
          avgROI: 30,
          startingCapital: heldCapital,
        },
        maximization: {
          compoundingScenarios: [],
          optimalReinvestRate: 80,
          maximizedCompoundingProjection: [],
          linearVsCompounding: {
            linear12mProfit: 0,
            compounding12mProfit: 0,
            advantageMultiple: 1.0,
            breakEvenMonth: 12,
          },
          compoundingAccelerationActions: [],
          compoundingGrade: 'F',
          breakEvenTime: 12,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Compounding Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Compounding Maximizer ni mogoč.',
      } satisfies ProfitCompoundingResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const agg = aggregateSold(soldComputed);
    const current = computeCurrent(agg, heldCapital);

    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-compounding-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: CompoundingMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitCompoundingResponse);
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
      soldCount12m: agg.count12m,
      heldInventoryCapital: heldCapital,
      current,
      deterministicMaximization: {
        compoundingScenarios: maximization.compoundingScenarios,
        optimalReinvestRate: maximization.optimalReinvestRate,
        linearVsCompounding: maximization.linearVsCompounding,
        compoundingGrade: maximization.compoundingGrade,
        breakEvenTime: maximization.breakEvenTime,
      },
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        rateMin: RATE_MIN, rateMax: RATE_MAX,
        reinvestMin: REINVEST_MIN, reinvestMax: REINVEST_MAX,
        growthMin: GROWTH_MIN, growthMax: GROWTH_MAX,
        multiplierMin: MULTIPLIER_MIN, multiplierMax: MULTIPLIER_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        cycleMin: CYCLE_MIN, cycleMax: CYCLE_MAX,
      },
    };

    const prompt = `Si AI "Profit Compounding Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za COMPOUNDING EFFECT MAXIMIZATION — kako maksimizirati COMPOUNDING reinvestiranega profita za EXPONENTIAL growth. Tvoj cilj je "če reinvestiraš 80% profita pri 25% ROI per cycle, tvojih 1000€ postane 9536€ v 12 ciklih — vs 4000€ z linear growth". Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding capital growth z growth rate) — ti MAKSIMIZIRAŠ COMPOUNDING EFFECT z reinvestRate scenarios (50%/60%/70%/80%/90%/100%) in optimalReinvestRate. Razlika od profit-scale-engine (v8.02 ki SCALE-A cel business z phased plan) — ti maksimiziraš COMPOUNDING z reinvestRate optimization. Razlika od profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ti maksimiziraš COMPOUNDING z linearVsCompounding comparison in breakEvenTime. Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na COMPOUNDING reinvest rate optimization z month-by-month 24m projection. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira REVENUE growth) — ti maksimiziraš COMPOUNDING PROFIT (bottom-line) z exponential growth projection. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti daje COMPOUNDING view z compoundingMultiplier in breakEvenTime. Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield per item) — ti maksimiziraš COMPOUNDING čez cel portfolio z reinvest scenarios.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventarja):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. compoundingScenarios: 6 elementi za reinvestRate 50%, 60%, 70%, 80%, 90%, 100% — za vsak:
   - reinvestRate [50, 100] (MORA biti ena od 6 vrednosti),
   - monthlyGrowthRate % [0, 200] (= (reinvestRate/100) × (avgROI/100) × (30/cycleTime) × 100),
   - projectedCapital12m € [0, 1000000] (startingCapital × (1 + monthlyGrowthRate/100)^12 — anti-hallucination, ≤ startingCapital × 100),
   - projectedProfit12m € [0, 1000000] (≥ projectedCapital12m - startingCapital),
   - compoundingMultiplier x [1.0, 100.0] (= projectedCapital12m / startingCapital — anti-hallucination, ≤ 100),
2. optimalReinvestRate % [50, 100] (best reinvest rate za max capital growth while maintaining cash flow),
3. maximizedCompoundingProjection: 24 elementov { month 1-24, capitalStart € [0, 1000000], profit € [0, 1000000], reinvested € [0, 1000000], cashFlow € [0, 1000000], capitalEnd € [0, 1000000] } — month-by-month 24m projection at optimal reinvest rate,
4. linearVsCompounding: { linear12mProfit € [0, 1000000], compounding12mProfit € [0, 1000000], advantageMultiple x [1.0, 100.0], breakEvenMonth [1, 24] (month where compounding overtakes linear) },
5. compoundingAccelerationActions: 4-8 stringov (max 200 vsak, slovenski — kako izboljšati compounding: faster cycles, higher ROI, higher reinvest rate, capital injection, automation, cross-platform, VA team, reinvest discipline),
6. compoundingGrade: A+ | A | B | C | D | F (A+ če multiplier ≥ 8x ali advantage ≥ 5x, A ≥ 5/3, B ≥ 3/2, C ≥ 2/1.5, D ≥ 1.5/1.2, else F),
7. breakEvenTime: month [1, 24] (crossover point — month where compounding overtakes linear),
8. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "compoundingScenarios": [
    { "reinvestRate": 80, "monthlyGrowthRate": 18.5, "projectedCapital12m": 28500, "projectedProfit12m": 27000, "compoundingMultiplier": 9.5 }
  ],
  "optimalReinvestRate": 80,
  "maximizedCompoundingProjection": [
    { "month": 1, "capitalStart": 1000, "profit": 150, "reinvested": 120, "cashFlow": 30, "capitalEnd": 1120 }
  ],
  "linearVsCompounding": {
    "linear12mProfit": 18000, "compounding12mProfit": 82500, "advantageMultiple": 4.6, "breakEvenMonth": 3
  },
  "compoundingAccelerationActions": ["Dvigni reinvest rate iz 20% na 80%.", "Skrajšaj cycle time za 30%."],
  "compoundingGrade": "B",
  "breakEvenTime": 3,
  "summary": "Current: 1500€/mo, 20% reinvest. Optimal: 80% → 28500€ v 12m (9.5x). Linear vs compounding: 18000€ vs 82500€ (4.6x). Grade B. Break-even M3."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Override compoundingScenarios if AI provided all 6
        if (Array.isArray(parsed.compoundingScenarios) &&
            parsed.compoundingScenarios.length >= 5) {
          const aiScenarios: CompoundingScenario[] = [];
          const detByRate = new Map<number, CompoundingScenario>();
          for (const s of maximization.compoundingScenarios) detByRate.set(s.reinvestRate, s);

          for (const ai of parsed.compoundingScenarios.slice(0, REINVEST_RATES.length)) {
            if (!ai || typeof ai !== 'object') continue;
            const reinvestRate = round0(clampNum(
              ai.reinvestRate,
              REINVEST_MIN, REINVEST_MAX, 80,
            ));
            // Snap to nearest valid rate
            const nearest = REINVEST_RATES.reduce((prev, curr) =>
              Math.abs(curr - reinvestRate) < Math.abs(prev - reinvestRate) ? curr : prev,
            );
            const det = detByRate.get(nearest);
            if (!det) continue;

            const monthlyGrowthRate = round2(clampNum(
              ai.monthlyGrowthRate,
              GROWTH_MIN, GROWTH_MAX, det.monthlyGrowthRate,
            ));
            // Anti-hallucination: projectedCapital12m ∈ [startingCapital, startingCapital × 100]
            const minCap = current.startingCapital;
            const maxCap = Math.min(CAPITAL_MAX, current.startingCapital * 100);
            const projectedCapital12m = round0(clampNum(
              ai.projectedCapital12m,
              minCap, maxCap, det.projectedCapital12m,
            ));
            const projectedProfit12m = round0(clampNum(
              ai.projectedProfit12m,
              Math.max(0, projectedCapital12m - current.startingCapital),
              PROFIT_MAX, det.projectedProfit12m,
            ));
            const compoundingMultiplier = round2(clampNum(
              ai.compoundingMultiplier,
              MULTIPLIER_MIN, MULTIPLIER_MAX, det.compoundingMultiplier,
            ));

            aiScenarios.push({
              reinvestRate: nearest,
              monthlyGrowthRate,
              projectedCapital12m,
              projectedProfit12m,
              compoundingMultiplier,
            });
          }
          // Ensure all 6 rates present
          const coveredRates = new Set(aiScenarios.map((s) => s.reinvestRate));
          for (const rate of REINVEST_RATES) {
            if (!coveredRates.has(rate)) {
              const det = detByRate.get(rate);
              if (det) aiScenarios.push(det);
            }
          }
          // Sort by reinvestRate asc
          aiScenarios.sort((a, b) => a.reinvestRate - b.reinvestRate);
          if (aiScenarios.length === REINVEST_RATES.length) {
            maximization = { ...maximization, compoundingScenarios: aiScenarios };
          }
        }

        // Override optimalReinvestRate
        if (parsed.optimalReinvestRate !== undefined) {
          const aiOptimal = round0(clampNum(
            parsed.optimalReinvestRate,
            REINVEST_MIN, REINVEST_MAX, maximization.optimalReinvestRate,
          ));
          // Snap to nearest valid rate
          const nearest = REINVEST_RATES.reduce((prev, curr) =>
            Math.abs(curr - aiOptimal) < Math.abs(prev - aiOptimal) ? curr : prev,
          );
          maximization = { ...maximization, optimalReinvestRate: nearest };
        }

        // Override maximizedCompoundingProjection if AI provided 12+
        if (Array.isArray(parsed.maximizedCompoundingProjection) &&
            parsed.maximizedCompoundingProjection.length >= 12) {
          const aiProj: MonthlyProjectionPoint[] = [];
          let lastCapitalEnd = current.startingCapital;
          for (const p of parsed.maximizedCompoundingProjection.slice(0, 24)) {
            if (!p || typeof p !== 'object') continue;
            const month = round0(clampNum(p.month, MONTH_MIN, MONTH_MAX, aiProj.length + 1));
            const capitalStart = round0(clampNum(
              p.capitalStart ?? lastCapitalEnd,
              CAPITAL_MIN, CAPITAL_MAX, lastCapitalEnd,
            ));
            const profit = round0(clampNum(p.profit, PROFIT_MIN, PROFIT_MAX, 0));
            const reinvested = round0(clampNum(
              p.reinvested,
              0, Math.max(profit, PROFIT_MAX), 0,
            ));
            const cashFlow = round0(clampNum(
              p.cashFlow,
              0, Math.max(profit, PROFIT_MAX), 0,
            ));
            const capitalEnd = round0(clampNum(
              p.capitalEnd ?? (capitalStart + reinvested),
              CAPITAL_MIN, CAPITAL_MAX, capitalStart + reinvested,
            ));
            aiProj.push({
              month,
              capitalStart,
              profit,
              reinvested,
              cashFlow,
              capitalEnd,
            });
            lastCapitalEnd = capitalEnd;
          }
          if (aiProj.length >= 12) {
            aiProj.sort((a, b) => a.month - b.month);
            maximization = { ...maximization, maximizedCompoundingProjection: aiProj };
          }
        }

        // Override linearVsCompounding
        if (parsed.linearVsCompounding && typeof parsed.linearVsCompounding === 'object') {
          const lvc = parsed.linearVsCompounding;
          const detLvc = maximization.linearVsCompounding;
          const linear12mProfit = round0(clampNum(
            lvc.linear12mProfit,
            PROFIT_MIN, PROFIT_MAX, detLvc.linear12mProfit,
          ));
          const compounding12mProfit = round0(clampNum(
            lvc.compounding12mProfit,
            Math.max(0, linear12mProfit), // compounding ≥ linear in 12m
            PROFIT_MAX, detLvc.compounding12mProfit,
          ));
          const advantageMultiple = round2(clampNum(
            lvc.advantageMultiple,
            MULTIPLIER_MIN, MULTIPLIER_MAX, detLvc.advantageMultiple,
          ));
          const breakEvenMonth = round0(clampNum(
            lvc.breakEvenMonth,
            1, 24, detLvc.breakEvenMonth,
          ));
          maximization = {
            ...maximization,
            linearVsCompounding: {
              linear12mProfit,
              compounding12mProfit,
              advantageMultiple,
              breakEvenMonth,
            },
            breakEvenTime: breakEvenMonth,
          };
        }

        // Override compoundingAccelerationActions
        if (Array.isArray(parsed.compoundingAccelerationActions) &&
            parsed.compoundingAccelerationActions.length >= 3) {
          const aiActions = parsed.compoundingAccelerationActions
            .slice(0, MAX_ACTIONS)
            .map((a) => clampString(a, 200, 'Pospeši compounding.'))
            .filter((s) => s.length > 0);
          if (aiActions.length >= 3) {
            maximization = { ...maximization, compoundingAccelerationActions: aiActions };
          }
        }

        // Override compoundingGrade
        if (parsed.compoundingGrade) {
          const grade = clampEnum(parsed.compoundingGrade, VALID_GRADE, maximization.compoundingGrade);
          maximization = { ...maximization, compoundingGrade: grade };
        } else {
          // Recompute grade based on updated scenarios
          const optimalScenario = maximization.compoundingScenarios.find(
            (s) => s.reinvestRate === maximization.optimalReinvestRate,
          );
          maximization = {
            ...maximization,
            compoundingGrade: decideGrade(optimalScenario, maximization.linearVsCompounding.advantageMultiple),
          };
        }

        // Override breakEvenTime
        if (parsed.breakEvenTime !== undefined) {
          const bet = round0(clampNum(parsed.breakEvenTime, 1, 24, maximization.breakEvenTime));
          maximization = { ...maximization, breakEvenTime: bet };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-compounding-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return NextResponse.json({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies ProfitCompoundingResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-compounding-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
