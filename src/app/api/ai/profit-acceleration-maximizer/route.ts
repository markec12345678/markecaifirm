// v8.05: AI Profit Acceleration Maximizer — AI MAXIMIZIRA GROWTH RATE profita
// (ne samo profit ampak kako hitro raste). "Tvoj profit raste 8% na mesec.
// Z 5 acceleration akcijami bi lahko rasel 15% na mesec — do 10000€ v 8 mesecih
// namesto 14." Razlika od profit-compounding-maximizer (v8.04 ki maksimizira
// COMPOUNDING reinvest rate) — ta MAKSIMIZIRA GROWTH RATE (1st + 2nd derivative
// of monthly profit). Razlika od capital-growth-maximizer (v7.99 ki maksimizira
// compounding capital growth) — ta maksimizira ACCELERATION (2nd derivat) z
// accelerationLevers in maximizedGrowthRate. Razlika od profit-scale-engine
// (v8.02 ki scale-a cel business z phased plan) — ta maksimizira RATE OF
// GROWTH (pospešek), ne scale. Razlika od profit-multiplier-engine (v8.00 ki
// multiplicira profit z 8 levers) — ta fokusira na GROWTH ACCELERATION z
// accelerationScenarios (CONSERVATIVE/BALANCED/AGGRESSIVE). Razlika od
// revenue-growth-maximizer (v8.01 ki maksimizira revenue growth) — ta
// maksimizira PROFIT GROWTH RATE (ne revenue), z growthAcceleration (2nd deriv)
// in growthVelocity. Razlika od profit-trajectory-forecaster (v7.72 ki
// FORECAST-a trajectory) — ta MAXIMIZIRA acceleration. Razlika od
// profit-growth-predictor (v7.81 ki PREDICT-a growth stage) — ta MAXIMIZIRA
// growth rate z actions. Razlika od profit-horizon-maximizer (v8.03 ki
// maksimizira profit per horizon) — ta maksimizira RATE OF GROWTH z 3 scenarios
// in timeTo10kProfit. Razlika od profit-momentum-tracker (ki track-a momentum)
// — ta daje ACCELERATION LEVERS z maximizedGrowthRate.
//
// "Current: 1200€/mo profit, growth 8%/mo (1st deriv), acceleration +0.4%/mo
// (2nd deriv), velocity +96€/mo. Scenarios: CONSERVATIVE → 11% growth (10000€
// v 14m), BALANCED → 15% growth (10000€ v 8m), AGGRESSIVE → 22% growth (10000€
// v 5m). Maximized growth: 15%/mo (BALANCED — sustainable). Acceleration
// levers: Sourcing (+3%/mo), Volume (+2%/mo), Pricing (+1.5%/mo), Hold time
// (-1d = +1%/mo), Categories (+1%/mo), Quality (+0.5%/mo). Projected: 6m
// 2850€/mo, 12m 6800€/mo. Time to 10k profit: 8 months. Grade: B. Risks:
// AGGRESSIVE → burnout (75% probability), CONSERVATIVE → slower than optimal."

// GET+POST /api/ai/profit-acceleration-maximizer
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

type AccelerationGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type AccelerationScenarioType = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

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
  currentMonthlyProfit: number; // €/mo (avg last 3 months)
  currentGrowthRate: number; // % per month (1st derivative)
  growthAcceleration: number; // % per month² (2nd derivative)
  growthVelocity: number; // €/mo (absolute € growth per month)
  monthsAnalyzed: number; // how many months of data
  latestMonthProfit: number; // € (most recent month)
  firstMonthProfit: number; // € (12 months ago)
}

interface AccelerationScenario {
  scenario: AccelerationScenarioType;
  projectedGrowthRate: number; // %/mo
  timeToTarget: number; // months to reach 10000€/mo profit
  requirements: string[]; // what's needed to achieve
  projectedProfit6m: number; // €
  projectedProfit12m: number; // €
  finalMonthlyProfit: number; // € at end of 12m
}

interface AccelerationLever {
  lever: string;
  currentState: string;
  potential: string;
  growthUplift: number; // %/mo uplift this lever can add
  action: string;
}

interface AccelerationMaximization {
  accelerationScenarios: AccelerationScenario[];
  accelerationLevers: AccelerationLever[];
  maximizedGrowthRate: number; // %/mo (optimal achievable)
  growthAccelerationActions: string[];
  projectedProfit6m: number; // €
  projectedProfit12m: number; // €
  timeTo10kProfit: number; // months to reach 10000€/mo
  accelerationGrade: AccelerationGrade;
  accelerationRisks: string[];
}

interface ProfitAccelerationResponse {
  ok: true;
  current: CurrentState;
  maximization: AccelerationMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  accelerationScenarios?: Array<{
    scenario?: AccelerationScenarioType;
    projectedGrowthRate?: number;
    timeToTarget?: number;
    requirements?: string[];
    projectedProfit6m?: number;
    projectedProfit12m?: number;
    finalMonthlyProfit?: number;
  }>;
  accelerationLevers?: Array<{
    lever?: string;
    currentState?: string;
    potential?: string;
    growthUplift?: number;
    action?: string;
  }>;
  maximizedGrowthRate?: number;
  growthAccelerationActions?: string[];
  projectedProfit6m?: number;
  projectedProfit12m?: number;
  timeTo10kProfit?: number;
  accelerationGrade?: AccelerationGrade;
  accelerationRisks?: string[];
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 200_000;
const MONTHLY_PROFIT_MIN = 0;
const MONTHLY_PROFIT_MAX = 100_000;
const GROWTH_RATE_MIN = -50; // %/mo
const GROWTH_RATE_MAX = 200; // %/mo
const ACCELERATION_MIN = -50; // %/mo²
const ACCELERATION_MAX = 200; // %/mo²
const VELOCITY_MIN = -50_000;
const VELOCITY_MAX = 200_000;
const TIME_MIN = 1;
const TIME_MAX = 120; // months
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50; // %/mo uplift max per scenario
const LEVER_UPLIFT_MAX = 20; // %/mo per single lever
const TARGET_PROFIT = 10_000; // €/mo target for timeTo10kProfit

const VALID_GRADE: readonly AccelerationGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_SCENARIO: readonly AccelerationScenarioType[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

const SCENARIO_GROWTH_MULT: Record<AccelerationScenarioType, number> = {
  CONSERVATIVE: 1.4, // 40% increase in growth rate
  BALANCED: 1.9, // 90% increase
  AGGRESSIVE: 2.8, // 180% increase
};

const MAX_LEVERS = 7;
const MAX_ACTIONS = 7;
const MAX_RISKS = 5;
const MAX_REQS_PER_SCENARIO = 4;

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

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// --- Deterministic computation ------------------------------------------

interface SoldComputed {
  profit: number;
  sellMs: number;
  monthKey: string;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  if (now - sellMs > TWELVE_MONTHS_MS) return null;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  return { profit, sellMs, monthKey: monthKey(sellMs) };
}

interface MonthlyProfitPoint {
  monthKey: string;
  profit: number;
  tradeCount: number;
  ms: number;
}

function buildMonthlySeries(trades: SoldComputed[]): MonthlyProfitPoint[] {
  const map = new Map<string, { profit: number; count: number; ms: number }>();
  for (const t of trades) {
    const e = map.get(t.monthKey);
    if (e) {
      e.profit += t.profit;
      e.count += 1;
    } else {
      map.set(t.monthKey, { profit: t.profit, count: 1, ms: t.sellMs });
    }
  }
  const arr = Array.from(map.entries()).map(([monthKey, v]) => ({
    monthKey,
    profit: round0(v.profit),
    tradeCount: v.count,
    ms: v.ms,
  }));
  arr.sort((a, b) => a.ms - b.ms);
  return arr;
}

function linearSlope(points: MonthlyProfitPoint[]): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.profit);
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function computeCurrent(series: MonthlyProfitPoint[]): CurrentState {
  const n = series.length;
  if (n === 0) {
    return {
      currentMonthlyProfit: 0,
      currentGrowthRate: 0,
      growthAcceleration: 0,
      growthVelocity: 0,
      monthsAnalyzed: 0,
      latestMonthProfit: 0,
      firstMonthProfit: 0,
    };
  }

  const latest = series[n - 1];
  const first = series[0];
  const latestMonthProfit = round0(clampNum(latest.profit, MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, 0));
  const firstMonthProfit = round0(clampNum(first.profit, MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, 0));

  // Avg last 3 months (or all if n < 3)
  const recentCount = Math.min(3, n);
  const recentSlice = series.slice(n - recentCount);
  const currentMonthlyProfit = round0(clampNum(
    recentSlice.reduce((s, p) => s + p.profit, 0) / recentCount,
    MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, 0,
  ));

  // Growth rate (1st derivative): % change per month over the full series
  // = (latest / first) ^ (1/(n-1)) - 1, × 100  (CAGR-style monthly)
  let currentGrowthRate = 0;
  if (n >= 2 && firstMonthProfit > 0) {
    const ratio = latestMonthProfit / firstMonthProfit;
    const monthsBetween = Math.max(1, n - 1);
    if (ratio > 0) {
      const cagr = Math.pow(ratio, 1 / monthsBetween) - 1;
      currentGrowthRate = round2(clampNum(cagr * 100, GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0));
    } else if (latestMonthProfit === 0) {
      // Declined to 0
      currentGrowthRate = -50;
    }
  } else if (n === 1) {
    // Single month — assume flat
    currentGrowthRate = 0;
  }

  // Velocity (€/mo) — slope of monthly profit (linear regression)
  let growthVelocity = 0;
  if (n >= 2) {
    const slope = linearSlope(series);
    growthVelocity = round0(clampNum(slope, VELOCITY_MIN, VELOCITY_MAX, 0));
  }

  // Acceleration (2nd derivative): difference between slopes of last half vs first half
  let growthAcceleration = 0;
  if (n >= 4) {
    const mid = Math.floor(n / 2);
    const firstHalf = series.slice(0, mid);
    const secondHalf = series.slice(mid);
    const slopeFirst = linearSlope(firstHalf);
    const slopeSecond = linearSlope(secondHalf);
    // acceleration = Δ(velocity) / Δ(months) → difference in slopes (per month²)
    const accelRaw = slopeSecond - slopeFirst;
    // Normalize by currentMonthlyProfit to get %/mo²
    const ref = Math.max(100, currentMonthlyProfit);
    growthAcceleration = round2(clampNum(
      (accelRaw / ref) * 100,
      ACCELERATION_MIN, ACCELERATION_MAX, 0,
    ));
  }

  return {
    currentMonthlyProfit,
    currentGrowthRate,
    growthAcceleration,
    growthVelocity,
    monthsAnalyzed: n,
    latestMonthProfit,
    firstMonthProfit,
  };
}

// --- Scenario + lever builders ------------------------------------------

function projectedProfitAtGrowth(
  startingMonthlyProfit: number,
  growthRatePerMonth: number,
  months: number,
): number {
  // Final monthly profit at month M = startingMonthly × (1 + g/100)^M
  const g = growthRatePerMonth / 100;
  const factor = Math.pow(1 + g, months);
  return startingMonthlyProfit * factor;
}

function cumulativeProfitAtGrowth(
  startingMonthlyProfit: number,
  growthRatePerMonth: number,
  months: number,
): number {
  // Sum of monthly profits (annuity-style) over `months` months
  const g = growthRatePerMonth / 100;
  if (Math.abs(g) < 1e-6) {
    return startingMonthlyProfit * months;
  }
  return startingMonthlyProfit * (Math.pow(1 + g, months) - 1) / g;
}

function monthsToReachTarget(
  startingMonthlyProfit: number,
  growthRatePerMonth: number,
  target: number,
): number {
  // Solve startingMonthly × (1+g)^M = target → M = ln(target/start) / ln(1+g)
  if (startingMonthlyProfit <= 0) {
    // From 0 base — bootstrap; estimate via target × 0.1 starting
    const bootstrap = Math.max(100, target * 0.1);
    if (growthRatePerMonth <= 0) return TIME_MAX;
    const M = Math.log(target / bootstrap) / Math.log(1 + growthRatePerMonth / 100);
    return round0(clampNum(Math.ceil(M), TIME_MIN, TIME_MAX, 24));
  }
  if (startingMonthlyProfit >= target) return 1;
  const g = growthRatePerMonth / 100;
  if (g <= 0) return TIME_MAX; // never reaches if no growth
  const M = Math.log(target / startingMonthlyProfit) / Math.log(1 + g);
  return round0(clampNum(Math.ceil(M), TIME_MIN, TIME_MAX, 12));
}

function buildRequirements(
  type: AccelerationScenarioType,
  current: CurrentState,
  growth: number,
): string[] {
  const reqs: string[] = [];
  if (type === 'CONSERVATIVE') {
    reqs.push(`Vzdržuj trenutno raven sourcing + povečaj volume za ${round0(growth * 0.4)}%.`);
    reqs.push(`Optimiziraj listing turnaround za ${Math.max(2, Math.round(current.currentGrowthRate > 0 ? 5 : 8))} dni.`);
  } else if (type === 'BALANCED') {
    reqs.push(`Povečaj trade volume za ${round0(growth * 0.6)}% z dodatnimi monitor-ji.`);
    reqs.push(`Dvigni avg ROI za 5pp z boljšim sourcingom (premium items).`);
    reqs.push(`Skrajšaj cycle time za 25% z avtomatiziranim listing refresh.`);
  } else { // AGGRESSIVE
    reqs.push(`Injektiraj +${round0(Math.max(500, current.currentMonthlyProfit * 2))}€ kapitala za takojšnji volume boost.`);
    reqs.push(`Razširi na 3+ platforme hkrati (Bolha + Vinted + Avtonet).`);
    reqs.push(`Onboard VA team za customer service + shipping (sprosti operaterja).`);
    reqs.push(`Vzdržuj ${round0(growth * 0.5)}% monthly volume growth dosledno.`);
  }
  return reqs.slice(0, MAX_REQS_PER_SCENARIO);
}

function buildScenario(
  type: AccelerationScenarioType,
  current: CurrentState,
): AccelerationScenario {
  const multiplier = SCENARIO_GROWTH_MULT[type];
  // Maximized growth = current growth × multiplier, but always ≥ some floor
  const baseGrowth = current.currentGrowthRate > 0
    ? current.currentGrowthRate
    : 5; // baseline 5%/mo if no growth history
  const projectedGrowthRate = round2(clampNum(
    baseGrowth * multiplier,
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 5,
  ));

  const startingProfit = Math.max(100, current.currentMonthlyProfit);
  const finalMonthlyProfit = round0(clampNum(
    projectedProfitAtGrowth(startingProfit, projectedGrowthRate, 12),
    MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, startingProfit,
  ));
  const projectedProfit6m = round0(clampNum(
    cumulativeProfitAtGrowth(startingProfit, projectedGrowthRate, 6),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const projectedProfit12m = round0(clampNum(
    cumulativeProfitAtGrowth(startingProfit, projectedGrowthRate, 12),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const timeToTarget = monthsToReachTarget(startingProfit, projectedGrowthRate, TARGET_PROFIT);

  const requirements = buildRequirements(type, current, projectedGrowthRate);

  return {
    scenario: type,
    projectedGrowthRate,
    timeToTarget,
    requirements,
    projectedProfit6m,
    projectedProfit12m,
    finalMonthlyProfit,
  };
}

function buildAccelerationLevers(current: CurrentState): AccelerationLever[] {
  const levers: AccelerationLever[] = [];
  const baseGrowth = current.currentGrowthRate > 0 ? current.currentGrowthRate : 5;

  // 1) Sourcing lever
  levers.push({
    lever: 'Faster Sourcing',
    currentState: `${current.currentGrowthRate > 0 ? '+' : ''}${round2(current.currentGrowthRate)}% rast/mesec z trenutnim sourcing ritmom.`,
    potential: `Povečan sourcing velocity z 24/7 monitor alert-i in batch evaluation.`,
    growthUplift: round2(clampNum(baseGrowth * 0.4, UPLIFT_MIN, LEVER_UPLIFT_MAX, 2)),
    action: 'Avtomatiziraj sourcing z real-time alert-i in batch deal evaluatorjem (50 oglasov/AI klic).',
  });

  // 2) Volume lever
  levers.push({
    lever: 'Higher Volume',
    currentState: `${current.monthsAnalyzed} mesecev analize, povprečno ${current.currentMonthlyProfit}€/mo.`,
    potential: `Povečan trade volume z dodatnimi monitorji in širšim kategorij pokritjem.`,
    growthUplift: round2(clampNum(baseGrowth * 0.3, UPLIFT_MIN, LEVER_UPLIFT_MAX, 1.5)),
    action: 'Dodaj 5 novih monitor-jev za neeksploatirane kategorije + cross-platform monitoring.',
  });

  // 3) Pricing lever
  levers.push({
    lever: 'Better Pricing',
    currentState: `Trenutna avg profit ${current.currentMonthlyProfit}€/mo.`,
    potential: `Premium pricing z AI-optimiziranimi oglasi in kvalitetnejšimi fotografijami.`,
    growthUplift: round2(clampNum(baseGrowth * 0.25, UPLIFT_MIN, LEVER_UPLIFT_MAX, 1.2)),
    action: 'Implementiraj AI pricing engine z A/B testing in dynamic price optimization.',
  });

  // 4) Hold time lever
  levers.push({
    lever: 'Shorter Hold Time',
    currentState: `Trenutni growth velocity ${current.growthVelocity}€/mo.`,
    potential: `Skrajšan cycle time = več ciklov na mesec = večji monthly profit.`,
    growthUplift: round2(clampNum(baseGrowth * 0.2, UPLIFT_MIN, LEVER_UPLIFT_MAX, 1)),
    action: 'Ciljaj -30% hold time z instant-listing workflow in hitrim buyer matchmakerjem.',
  });

  // 5) Categories lever
  levers.push({
    lever: 'More Categories',
    currentState: `Trenutno ${current.monthsAnalyzed > 0 ? 'fokusiran na ožji kategoriji' : 'ni dovolj podatka'}.`,
    potential: `Diversifikacija v 3+ profitable kategorije zmanjša risk in poveča volume.`,
    growthUplift: round2(clampNum(baseGrowth * 0.15, UPLIFT_MIN, LEVER_UPLIFT_MAX, 0.8)),
    action: 'Identificiraj 3 nove profitable kategorije z market gap finderjem in jih dodaj k monitor-jem.',
  });

  // 6) Quality lever
  levers.push({
    lever: 'Better Quality',
    currentState: `Avg profit ${current.currentMonthlyProfit}€/mo.`,
    potential: `Refurbishment in premium pozicioniranje dvigne profit margin per trade.`,
    growthUplift: round2(clampNum(baseGrowth * 0.1, UPLIFT_MIN, LEVER_UPLIFT_MAX, 0.5)),
    action: 'Vzpostavi refurb workflow za high-margin items (cleaning, repair, photography upgrade).',
  });

  return levers.slice(0, MAX_LEVERS);
}

function decideMaximizedGrowthRate(scenarios: AccelerationScenario[]): number {
  // Pick BALANCED scenario as the maximized sustainable rate
  const balanced = scenarios.find((s) => s.scenario === 'BALANCED');
  if (balanced) return balanced.projectedGrowthRate;
  return scenarios.length > 0 ? scenarios[0].projectedGrowthRate : 8;
}

function buildAccelerationActions(
  scenarios: AccelerationScenario[],
  levers: AccelerationLever[],
  current: CurrentState,
): string[] {
  const actions: string[] = [];
  const balanced = scenarios.find((s) => s.scenario === 'BALANCED');
  const targetGrowth = balanced?.projectedGrowthRate ?? current.currentGrowthRate * 1.9;

  // 1) Top lever
  const topLever = [...levers].sort((a, b) => b.growthUplift - a.growthUplift)[0];
  if (topLever) {
    actions.push(
      `Implementiraj "${topLever.lever}" — največji potencial (+${topLever.growthUplift}%/mo) → ${topLever.action}`,
    );
  }

  // 2) Compound top 3 levers
  const top3 = [...levers].sort((a, b) => b.growthUplift - a.growthUplift).slice(0, 3);
  const combinedUplift = top3.reduce((s, l) => s + l.growthUplift, 0);
  actions.push(
    `Kombiniraj top 3 levers (${top3.map((l) => l.lever).join(' + ')}) za +${round2(combinedUplift)}%/mo growth uplift.`,
  );

  // 3) Reinvest acceleration
  actions.push(
    `Reinvestiraj 80% profita v naslednje 6 mesecev — compounding effect pohitri doseganje ${TARGET_PROFIT}€/mo za ${balanced?.timeToTarget ?? 12} mesecev.`,
  );

  // 4) Volume scaling
  actions.push(
    `Povečaj trade volume za ${round0(targetGrowth * 0.5)}% z dodatnimi monitorji in cross-platform sourcing.`,
  );

  // 5) Capital injection
  actions.push(
    `Injektiraj +${round0(Math.max(500, current.currentMonthlyProfit * 1.5))}€ kapitala za takojšnji acceleration.`,
  );

  // 6) Automation
  actions.push(
    'Avtomatiziraj sourcing-to-sale pipeline z monitor alert-i in auto-listing za 30% krajši cycle time.',
  );

  // 7) Discipline
  actions.push(
    `Vzdržuj ${round2(targetGrowth)}%/mo growth dosledno — prekinevanje za 1 mesec zmanjša 12m projection za ~15%.`,
  );

  return actions.slice(0, MAX_ACTIONS);
}

function decideGrade(
  maximizedGrowthRate: number,
  current: CurrentState,
  balanced: AccelerationScenario | undefined,
): AccelerationGrade {
  // A+ if maximized ≥ 25%/mo or uplift ≥ +10pp above current
  // A if maximized ≥ 18%/mo or uplift ≥ +8pp
  // B if maximized ≥ 12%/mo or uplift ≥ +5pp
  // C if maximized ≥ 8%/mo or uplift ≥ +3pp
  // D if maximized ≥ 4%/mo or uplift ≥ +1pp
  // else F
  void balanced; // signature kept for future use
  const uplift = maximizedGrowthRate - current.currentGrowthRate;
  if (maximizedGrowthRate >= 25 || uplift >= 10) return 'A+';
  if (maximizedGrowthRate >= 18 || uplift >= 8) return 'A';
  if (maximizedGrowthRate >= 12 || uplift >= 5) return 'B';
  if (maximizedGrowthRate >= 8 || uplift >= 3) return 'C';
  if (maximizedGrowthRate >= 4 || uplift >= 1) return 'D';
  return 'F';
}

function buildAccelerationRisks(current: CurrentState, balanced: AccelerationScenario | undefined): string[] {
  const risks: string[] = [];
  // AGGRESSIVE risks
  risks.push(
    'AGGRESSIVE scenario: 75% probability burnout v 4 mesecih pri 22%+ monthly growth — vzdržuj BALANCED.',
  );
  risks.push(
    'Capital injection za AGGRESSIVE zahteva +2000€ upfront — risk če se volume ne povrne v 60 dneh.',
  );
  risks.push(
    `Pri ${current.currentGrowthRate > 15 ? 'trenutni visoki' : 'trenutni nizki'} rasti (${round2(current.currentGrowthRate)}%/mo) je market saturation možen v 8-12 mesecih.`,
  );
  risks.push(
    'Hitra expansion v 3+ kategorije lahko razredči focus — priporočljivo 1 nova kategorija na 60 dni.',
  );
  if (balanced) {
    risks.push(
      `BALANCED (${round2(balanced.projectedGrowthRate)}%/mo) doseže ${TARGET_PROFIT}€/mo v ${balanced.timeToTarget} mesecih — CONSERVATIVE potrebuje ${balanced.timeToTarget + 6} mesecev.`,
    );
  }
  return risks.slice(0, MAX_RISKS);
}

function buildDeterministicMaximization(current: CurrentState): AccelerationMaximization {
  const accelerationScenarios = VALID_SCENARIO.map((t) => buildScenario(t, current));
  const accelerationLevers = buildAccelerationLevers(current);
  const maximizedGrowthRate = round2(clampNum(
    decideMaximizedGrowthRate(accelerationScenarios),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 8,
  ));

  const balanced = accelerationScenarios.find((s) => s.scenario === 'BALANCED');
  const projectedProfit6m = balanced?.projectedProfit6m ?? 0;
  const projectedProfit12m = balanced?.projectedProfit12m ?? 0;
  const timeTo10kProfit = balanced?.timeToTarget ?? 12;

  const growthAccelerationActions = buildAccelerationActions(
    accelerationScenarios,
    accelerationLevers,
    current,
  );
  const accelerationRisks = buildAccelerationRisks(current, balanced);
  const accelerationGrade = decideGrade(maximizedGrowthRate, current, balanced);

  return {
    accelerationScenarios,
    accelerationLevers,
    maximizedGrowthRate,
    growthAccelerationActions,
    projectedProfit6m,
    projectedProfit12m,
    timeTo10kProfit,
    accelerationGrade,
    accelerationRisks,
  };
}

function buildSummary(current: CurrentState, max: AccelerationMaximization): string {
  const parts: string[] = [
    `Current: ${current.currentMonthlyProfit}€/mo, rast ${round2(current.currentGrowthRate)}%/mo, acceleration ${round2(current.growthAcceleration)}%/mo².`,
    `Maximized: ${max.maximizedGrowthRate}%/mo (grade ${max.accelerationGrade}).`,
    `Projected 12m: ${max.projectedProfit12m}€. Time to ${TARGET_PROFIT}€/mo: ${max.timeTo10kProfit} mesecev.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitAccelerationMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleProfitAccelerationMaximizer(req);
}

async function handleProfitAccelerationMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-acceleration-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades from last 12 months for monthly profit trend
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
      return NextResponse.json({
        ok: true,
        current: {
          currentMonthlyProfit: 0,
          currentGrowthRate: 0,
          growthAcceleration: 0,
          growthVelocity: 0,
          monthsAnalyzed: 0,
          latestMonthProfit: 0,
          firstMonthProfit: 0,
        },
        maximization: {
          accelerationScenarios: [],
          accelerationLevers: [],
          maximizedGrowthRate: 0,
          growthAccelerationActions: [],
          projectedProfit6m: 0,
          projectedProfit12m: 0,
          timeTo10kProfit: 0,
          accelerationGrade: 'F',
          accelerationRisks: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Acceleration Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Acceleration Maximizer ni mogoč.',
      } satisfies ProfitAccelerationResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }

    if (soldComputed.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          currentMonthlyProfit: 0,
          currentGrowthRate: 0,
          growthAcceleration: 0,
          growthVelocity: 0,
          monthsAnalyzed: 0,
          latestMonthProfit: 0,
          firstMonthProfit: 0,
        },
        maximization: {
          accelerationScenarios: [],
          accelerationLevers: [],
          maximizedGrowthRate: 0,
          growthAccelerationActions: [],
          projectedProfit6m: 0,
          projectedProfit12m: 0,
          timeTo10kProfit: 0,
          accelerationGrade: 'F',
          accelerationRisks: [],
        },
        summary: 'Ni veljavnih SOLD trgovin — Profit Acceleration Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Profit Acceleration Maximizer ni mogoč.',
      } satisfies ProfitAccelerationResponse);
    }

    const series = buildMonthlySeries(soldComputed);
    const current = computeCurrent(series);

    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-acceleration-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: AccelerationMaximization;
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
      } satisfies ProfitAccelerationResponse);
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
      soldCount12m: soldComputed.length,
      monthsAnalyzed: current.monthsAnalyzed,
      monthlySeries: series.map((s) => ({ month: s.monthKey, profit: s.profit, trades: s.tradeCount })),
      current,
      deterministicMaximization: {
        accelerationScenarios: maximization.accelerationScenarios,
        accelerationLevers: maximization.accelerationLevers,
        maximizedGrowthRate: maximization.maximizedGrowthRate,
        growthAccelerationActions: maximization.growthAccelerationActions,
        projectedProfit6m: maximization.projectedProfit6m,
        projectedProfit12m: maximization.projectedProfit12m,
        timeTo10kProfit: maximization.timeTo10kProfit,
        accelerationGrade: maximization.accelerationGrade,
        accelerationRisks: maximization.accelerationRisks,
      },
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        monthlyProfitMin: MONTHLY_PROFIT_MIN, monthlyProfitMax: MONTHLY_PROFIT_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
        velocityMin: VELOCITY_MIN, velocityMax: VELOCITY_MAX,
        timeMin: TIME_MIN, timeMax: TIME_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        leverUpliftMax: LEVER_UPLIFT_MAX,
        targetProfit: TARGET_PROFIT,
      },
    };

    const prompt = `Si AI "Profit Acceleration Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT GROWTH RATE MAXIMIZATION — kako maksimizirati RATE OF GROWTH profita (pospešek), ne samo profit sam. Tvoj cilj je "tvoj profit raste 8% na mesec, z 5 acceleration akcijami bi lahko rasel 15% na mesec — dosegel 10000€ v 8 mesecih namesto 14". Razlika od profit-compounding-maximizer (v8.04 ki maksimizira COMPOUNDING reinvest rate) — ti MAKSIMIZIRAŠ GROWTH RATE (1st + 2nd derivative of monthly profit). Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding capital growth) — ta maksimizira ACCELERATION (2nd derivat) z accelerationLevers in maximizedGrowthRate. Razlika od profit-scale-engine (v8.02 ki scale-a cel business z phased plan) — ta maksimizira RATE OF GROWTH (pospešek), ne scale. Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ta fokusira na GROWTH ACCELERATION z accelerationScenarios (CONSERVATIVE/BALANCED/AGGRESSIVE). Razlika od revenue-growth-maximizer (v8.01 ki maksimizira revenue growth) — ta maksimizira PROFIT GROWTH RATE (ne revenue), z growthAcceleration (2nd deriv) in growthVelocity. Razlika od profit-trajectory-forecaster (v7.72 ki FORECAST-a trajectory) — ta MAXIMIZIRA acceleration. Razlika od profit-growth-predictor (v7.81 ki PREDICT-a growth stage) — ta MAXIMIZIRA growth rate z actions. Razlika od profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ta maksimizira RATE OF GROWTH z 3 scenarios in timeTo10kProfit. Razlika od profit-momentum-tracker (ki track-a momentum) — ta daje ACCELERATION LEVERS z maximizedGrowthRate.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih, agregiranih po mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. accelerationScenarios: 3 elementi — CONSERVATIVE, BALANCED, AGGRESSIVE — za vsak:
   - scenario (MORA biti ena od 3 vrednosti),
   - projectedGrowthRate %/mo [-50, 200] (CONSERVATIVE ≈ 1.4× current, BALANCED ≈ 1.9×, AGGRESSIVE ≈ 2.8×),
   - timeToTarget mesecev [1, 120] (koliko mesecev da doseže 10000€/mo profit pri tem growth rate),
   - requirements: 2-4 stringi (max 200 vsak, slovenski — kaj je potrebno za dosego),
   - projectedProfit6m € [0, 200000] (kumulativni profit v 6m pri tem growth rate),
   - projectedProfit12m € [0, 200000] (kumulativni profit v 12m),
   - finalMonthlyProfit € [0, 100000] (mesečni profit na koncu 12m = starting × (1+g)^12),
2. accelerationLevers: 5-7 levers { lever (max 50), currentState (max 200, slovenski), potential (max 200, slovenski), growthUplift %/mo [0, 20], action (max 200, slovenski) },
3. maximizedGrowthRate %/mo [-50, 200] (optimal achievable — tipično BALANCED scenario),
4. growthAccelerationActions: 4-7 stringov (max 200 vsak, slovenski — prioritizirane akcije za acceleration),
5. projectedProfit6m € [0, 200000] (kumulativni v 6m pri maximized rate),
6. projectedProfit12m € [0, 200000] (kumulativni v 12m pri maximized rate),
7. timeTo10kProfit mesecev [1, 120] (koliko mesecev da doseže 10000€/mo pri maximized rate),
8. accelerationGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 25%/mo ali uplift ≥ 10pp, A ≥ 18/8, B ≥ 12/5, C ≥ 8/3, D ≥ 4/1, else F),
9. accelerationRisks: 3-5 stringov (max 200 vsak, slovenski — risk-i aggressive growth: burnout, capital injection, market saturation, focus dilution),
10. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "accelerationScenarios": [
    { "scenario": "CONSERVATIVE", "projectedGrowthRate": 11, "timeToTarget": 14, "requirements": ["Vzdržuj trenutno raven sourcing."], "projectedProfit6m": 9200, "projectedProfit12m": 19500, "finalMonthlyProfit": 1450 },
    { "scenario": "BALANCED", "projectedGrowthRate": 15, "timeToTarget": 8, "requirements": ["Povečaj trade volume za 10%.", "Dvigni avg ROI za 5pp.", "Skrajšaj cycle time za 25%."], "projectedProfit6m": 11500, "projectedProfit12m": 26800, "finalMonthlyProfit": 2200 },
    { "scenario": "AGGRESSIVE", "projectedGrowthRate": 22, "timeToTarget": 5, "requirements": ["Injektiraj 3000€ kapitala.", "Razširi na 3 platforme.", "Onboard VA team.", "Vzdržuj 12% monthly volume growth."], "projectedProfit6m": 14200, "projectedProfit12m": 42100, "finalMonthlyProfit": 4800 }
  ],
  "accelerationLevers": [
    { "lever": "Faster Sourcing", "currentState": "8% rast/mesec.", "potential": "Povečan sourcing velocity.", "growthUplift": 2.5, "action": "Avtomatiziraj sourcing z real-time alert-i." }
  ],
  "maximizedGrowthRate": 15,
  "growthAccelerationActions": ["Implementiraj Faster Sourcing — +2.5%/mo.", "Kombiniraj top 3 levers za +6%/mo."],
  "projectedProfit6m": 11500,
  "projectedProfit12m": 26800,
  "timeTo10kProfit": 8,
  "accelerationGrade": "B",
  "accelerationRisks": ["AGGRESSIVE: 75% probability burnout v 4 mesecih."],
  "summary": "Current: 1200€/mo, rast 8%/mo. Maximized: 15%/mo (grade B). Projected 12m: 26800€. Time to 10000€/mo: 8 mesecev."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Override accelerationScenarios if AI provided all 3
        if (Array.isArray(parsed.accelerationScenarios) &&
            parsed.accelerationScenarios.length >= 3) {
          const aiScenarios: AccelerationScenario[] = [];
          const detByType = new Map<AccelerationScenarioType, AccelerationScenario>();
          for (const s of maximization.accelerationScenarios) detByType.set(s.scenario, s);

          for (const ai of parsed.accelerationScenarios.slice(0, VALID_SCENARIO.length)) {
            if (!ai || typeof ai !== 'object') continue;
            const type = clampEnum(ai.scenario, VALID_SCENARIO, 'BALANCED');
            const det = detByType.get(type);
            if (!det) continue;

            const projectedGrowthRate = round2(clampNum(
              ai.projectedGrowthRate,
              GROWTH_RATE_MIN, GROWTH_RATE_MAX, det.projectedGrowthRate,
            ));
            const timeToTarget = round0(clampNum(
              ai.timeToTarget,
              TIME_MIN, TIME_MAX, det.timeToTarget,
            ));
            const requirements = Array.isArray(ai.requirements)
              ? ai.requirements.slice(0, MAX_REQS_PER_SCENARIO).map((r) => clampString(r, 200, 'Vzdržuj trenutno raven.')).filter((s) => s.length > 0)
              : det.requirements;
            const reqs = requirements.length >= 1 ? requirements : det.requirements;

            const projectedProfit6m = round0(clampNum(
              ai.projectedProfit6m,
              PROFIT_MIN, PROFIT_MAX, det.projectedProfit6m,
            ));
            const projectedProfit12m = round0(clampNum(
              ai.projectedProfit12m,
              PROFIT_MIN, PROFIT_MAX, det.projectedProfit12m,
            ));
            const finalMonthlyProfit = round0(clampNum(
              ai.finalMonthlyProfit,
              MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, det.finalMonthlyProfit,
            ));

            aiScenarios.push({
              scenario: type,
              projectedGrowthRate,
              timeToTarget,
              requirements: reqs,
              projectedProfit6m,
              projectedProfit12m,
              finalMonthlyProfit,
            });
          }
          // Ensure all 3 types present
          const coveredTypes = new Set(aiScenarios.map((s) => s.scenario));
          for (const t of VALID_SCENARIO) {
            if (!coveredTypes.has(t)) {
              const det = detByType.get(t);
              if (det) aiScenarios.push(det);
            }
          }
          aiScenarios.sort((a, b) => VALID_SCENARIO.indexOf(a.scenario) - VALID_SCENARIO.indexOf(b.scenario));
          if (aiScenarios.length === VALID_SCENARIO.length) {
            maximization = { ...maximization, accelerationScenarios: aiScenarios };
          }
        }

        // Override accelerationLevers if AI provided 5+
        if (Array.isArray(parsed.accelerationLevers) &&
            parsed.accelerationLevers.length >= 5) {
          const aiLevers: AccelerationLever[] = [];
          for (const l of parsed.accelerationLevers.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            aiLevers.push({
              lever: clampString(l.lever, 50, 'Lever'),
              currentState: clampString(l.currentState, 200, 'Trenutno stanje.'),
              potential: clampString(l.potential, 200, 'Potencial.'),
              growthUplift: round2(clampNum(
                l.growthUplift,
                UPLIFT_MIN, LEVER_UPLIFT_MAX, 1,
              )),
              action: clampString(l.action, 200, 'Akcija.'),
            });
          }
          if (aiLevers.length >= 5) {
            maximization = { ...maximization, accelerationLevers: aiLevers };
          }
        }

        // Override maximizedGrowthRate
        if (parsed.maximizedGrowthRate !== undefined) {
          const aiMaxGrowth = round2(clampNum(
            parsed.maximizedGrowthRate,
            GROWTH_RATE_MIN, GROWTH_RATE_MAX, maximization.maximizedGrowthRate,
          ));
          maximization = { ...maximization, maximizedGrowthRate: aiMaxGrowth };
        }

        // Override growthAccelerationActions
        if (Array.isArray(parsed.growthAccelerationActions) &&
            parsed.growthAccelerationActions.length >= 3) {
          const aiActions = parsed.growthAccelerationActions
            .slice(0, MAX_ACTIONS)
            .map((a) => clampString(a, 200, 'Pospeši rast profita.'))
            .filter((s) => s.length > 0);
          if (aiActions.length >= 3) {
            maximization = { ...maximization, growthAccelerationActions: aiActions };
          }
        }

        // Override projectedProfit6m/12m
        if (parsed.projectedProfit6m !== undefined) {
          const v = round0(clampNum(
            parsed.projectedProfit6m,
            PROFIT_MIN, PROFIT_MAX, maximization.projectedProfit6m,
          ));
          maximization = { ...maximization, projectedProfit6m: v };
        }
        if (parsed.projectedProfit12m !== undefined) {
          const v = round0(clampNum(
            parsed.projectedProfit12m,
            PROFIT_MIN, PROFIT_MAX, maximization.projectedProfit12m,
          ));
          maximization = { ...maximization, projectedProfit12m: v };
        }

        // Override timeTo10kProfit
        if (parsed.timeTo10kProfit !== undefined) {
          const v = round0(clampNum(
            parsed.timeTo10kProfit,
            TIME_MIN, TIME_MAX, maximization.timeTo10kProfit,
          ));
          maximization = { ...maximization, timeTo10kProfit: v };
        }

        // Override accelerationGrade
        if (parsed.accelerationGrade) {
          const grade = clampEnum(parsed.accelerationGrade, VALID_GRADE, maximization.accelerationGrade);
          maximization = { ...maximization, accelerationGrade: grade };
        } else {
          // Recompute grade based on updated maximizedGrowthRate
          const balanced = maximization.accelerationScenarios.find((s) => s.scenario === 'BALANCED');
          maximization = {
            ...maximization,
            accelerationGrade: decideGrade(maximization.maximizedGrowthRate, current, balanced),
          };
        }

        // Override accelerationRisks
        if (Array.isArray(parsed.accelerationRisks) &&
            parsed.accelerationRisks.length >= 2) {
          const aiRisks = parsed.accelerationRisks
            .slice(0, MAX_RISKS)
            .map((r) => clampString(r, 200, 'Risk aggressive growth.'))
            .filter((s) => s.length > 0);
          if (aiRisks.length >= 2) {
            maximization = { ...maximization, accelerationRisks: aiRisks };
          }
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-acceleration-maximizer',
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
    } satisfies ProfitAccelerationResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-acceleration-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
