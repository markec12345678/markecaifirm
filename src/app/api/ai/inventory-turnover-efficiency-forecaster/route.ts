// v7.93: AI Inventory Turnover Efficiency Forecaster — AI napove
// TURNOVER EFFICIENCY — kako učinkovito bo kapital krozen skozi inventar v
// naslednjih 30/60/90 dneh. Kombinira turnover rate z capital efficiency
// metrikami (profit per turnover cycle, ROI per cycle). Razlika od inventory-
// turnover-forecast (v7.78 ki napove turnover rate) — ta gleda EFFICIENCY
// (profit na turnover cycle). "Turnover efficiency: 85/100 (A grade).
// Profit per cycle: 45€. 30d forecast: 90/100, 50€/cycle. Bottleneck: aging
// items. Action: liquidate >60d → +10% efficiency."
//
// Razlika od inventory-turnover-forecast (v7.78 ki forecast-a turnover rate)
// — ta gleda EFFICIENCY (profit per cycle + capital efficiency per cycle).
// Razlika od inventory-turnover-accelerator-pro (v7.85 ki da acceleration
// actions) — ta forecast-a FUTURE efficiency z grade. Razlika od inventory-
// turnover-optimizer (ki optimizira turnover) — ta gleda efficiency z
// bottlenecks in drivers. Razlika od inventory-turnover-predictor (ki
// napove turnover) — ta gleda EFFICIENCY composite (turnover × capital
// efficiency × profit per cycle). Razlika od inventory-turnover-momentum-
// tracker (v7.92 ki track-a turnover momentum) — ta forecast-a future
// efficiency z bottlenecks. Razlika od inventory-roi-trend-tracker (v7.87
// ki track-a ROI trends) — ta gleda TURNOVER-specifično efficiency (per
// cycle). Razlika od capital-efficiency-forecaster (v7.84 ki forecast-a
// capital efficiency) — ta gleda TURNOVER efficiency (profit per cycle +
// cycles per month). Razlika od profit-efficiency-analyzer (ki analizira
// profit efficiency) — ta gleda INVENTORY turnover efficiency z cycle forecast.
//
// GET+POST /api/ai/inventory-turnover-efficiency-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryTurnoverEfficiencyForecasterInput {}

// --- Types ---------------------------------------------------------------

type EfficiencyDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';
type EfficiencyGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CurrentEfficiency {
  turnoverRate: number; // items sold / avg inventory held
  capitalEfficiency: number; // profit / capital deployed × 100 (%)
  profitPerTurnover: number; // EUR per turnover cycle
  capitalCycleTime: number; // avg days from buy to sell
  roiPerCycle: number; // avg ROI per turnover cycle (%)
  efficiencyGrade: EfficiencyGrade;
}

interface EfficiencyTrends {
  turnoverEfficiencyTrend: number; // slope per month (1st derivative of profitPerTurnover)
  capitalEfficiencyTrend: number; // slope per month (1st derivative of capitalEfficiency)
  efficiencyDirection: EfficiencyDirection;
  efficiencyMomentum: number; // 2nd derivative (acceleration)
}

interface MonthlyDataPoint {
  month: string; // ISO date (month start)
  turnoverRate: number;
  capitalEfficiency: number;
  profitPerTurnover: number;
  capitalCycleTime: number;
  roiPerCycle: number;
}

interface EfficiencyForecast {
  projectedEfficiency30d: number; // 0-100
  projectedEfficiency60d: number;
  projectedEfficiency90d: number;
  projectedProfitPerCycle30d: number; // EUR
  projectedCapitalEfficiency30d: number; // %
  projectedCyclesPerMonth30d: number;
  confidenceLevel: number;
}

interface EfficiencyDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface EfficiencyBottleneck {
  bottleneck: string;
  impact: string;
  mitigation: string;
}

interface EfficiencyOptimizationAction {
  action: string;
  priority: ActionPriority;
  expectedEfficiencyGain: number; // percentage points
}

interface EfficiencyAnalysis {
  efficiencyDrivers: EfficiencyDriver[];
  efficiencyBottlenecks: EfficiencyBottleneck[];
  efficiencyOptimizationActions: EfficiencyOptimizationAction[];
}

interface AiEfficiencyResponse {
  efficiencyDrivers?: Array<{
    driver?: string;
    impact?: DriverImpact;
    weight?: number;
    detail?: string;
  }>;
  efficiencyBottlenecks?: Array<{
    bottleneck?: string;
    impact?: string;
    mitigation?: string;
  }>;
  efficiencyOptimizationActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    expectedEfficiencyGain?: number;
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const EFF_MIN = 0;
const EFF_MAX = 100;
const PROFIT_PER_CYCLE_MIN = 0;
const PROFIT_PER_CYCLE_MAX = 10000;
const CYCLE_TIME_MIN = 0;
const CYCLE_TIME_MAX = 365;
const ROI_MIN = -100;
const ROI_MAX = 500;
const TURNOVER_MIN = 0;
const TURNOVER_MAX = 50;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;
const GAIN_MIN = -5;
const GAIN_MAX = 30;
const CONF_MIN = 0;
const CONF_MAX = 100;

const VALID_GRADE: readonly EfficiencyGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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
function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Linear regression slope per index
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// 2nd derivative: slope of second half minus slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

// Grade from efficiency score
function gradeFromScore(score: number): EfficiencyGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// Composite efficiency score (0-100) — combines turnover rate + capital efficiency + profit per cycle
function computeEfficiencyScore(
  turnoverRate: number,
  capitalEfficiency: number,
  profitPerTurnover: number,
  capitalCycleTime: number,
): number {
  // Turnover rate score (0-30): max at turnover >= 4
  let turnoverScore: number;
  if (turnoverRate >= 4) turnoverScore = 30;
  else if (turnoverRate >= 2) turnoverScore = 25;
  else if (turnoverRate >= 1) turnoverScore = 20;
  else if (turnoverRate >= 0.5) turnoverScore = 15;
  else if (turnoverRate >= 0.2) turnoverScore = 8;
  else turnoverScore = 5;

  // Capital efficiency score (0-30): max at >= 50% (high ROI vs deployed capital)
  let capEffScore: number;
  if (capitalEfficiency >= 50) capEffScore = 30;
  else if (capitalEfficiency >= 30) capEffScore = 25;
  else if (capitalEfficiency >= 15) capEffScore = 20;
  else if (capitalEfficiency >= 5) capEffScore = 12;
  else if (capitalEfficiency >= 0) capEffScore = 5;
  else capEffScore = 0;

  // Profit per cycle score (0-25): max at >= 100€
  let profitScore: number;
  if (profitPerTurnover >= 100) profitScore = 25;
  else if (profitPerTurnover >= 50) profitScore = 20;
  else if (profitPerTurnover >= 25) profitScore = 15;
  else if (profitPerTurnover >= 10) profitScore = 10;
  else if (profitPerTurnover >= 0) profitScore = 5;
  else profitScore = 0;

  // Capital cycle time score (0-15): max at <= 14 days (faster = more efficient)
  let cycleScore: number;
  if (capitalCycleTime <= 7) cycleScore = 15;
  else if (capitalCycleTime <= 14) cycleScore = 12;
  else if (capitalCycleTime <= 30) cycleScore = 9;
  else if (capitalCycleTime <= 60) cycleScore = 6;
  else if (capitalCycleTime <= 90) cycleScore = 3;
  else cycleScore = 0;

  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, turnoverScore + capEffScore + profitScore + cycleScore));
}

function directionFromTrend(trend: number): EfficiencyDirection {
  if (trend > 0.5) return 'IMPROVING';
  if (trend < -0.5) return 'DECLINING';
  return 'STABLE';
}

// --- Trade row types ---------------------------------------------------

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
}

// --- Monthly aggregation -----------------------------------------------

interface MonthAgg {
  soldCount: number;
  heldAtStartCount: number; // estimated avg inventory held during this month
  totalProfit: number;
  totalCapitalDeployed: number; // total buy price + fees of sold items in month
  totalCycleDays: number; // sum of (sell - buy) per trade
  cycleDayCount: number; // for averaging
}

function newMonthAgg(): MonthAgg {
  return { soldCount: 0, heldAtStartCount: 0, totalProfit: 0, totalCapitalDeployed: 0, totalCycleDays: 0, cycleDayCount: 0 };
}

// --- Deterministic analysis ------------------------------------------

function buildDeterministicAnalysis(
  monthly: MonthAgg[],
  trends: EfficiencyTrends,
  current: CurrentEfficiency,
): EfficiencyAnalysis {
  const drivers: EfficiencyDriver[] = [];

  // Identify top drivers based on trend components
  const turnoverTrendPos = trends.turnoverEfficiencyTrend > 0;
  const capEffTrendPos = trends.capitalEfficiencyTrend > 0;
  const momentumPos = trends.efficiencyMomentum > 0;

  if (turnoverTrendPos) {
    drivers.push({
      driver: 'Profit per turnover',
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.turnoverEfficiencyTrend) * 20 + 50)),
      detail: `Profit per turnover cycle raste (${round1(trends.turnoverEfficiencyTrend)}/mo).`.slice(0, 200),
    });
  } else if (trends.turnoverEfficiencyTrend < 0) {
    drivers.push({
      driver: 'Profit per turnover',
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.turnoverEfficiencyTrend) * 20 + 50)),
      detail: `Profit per turnover cycle pada (${round1(trends.turnoverEfficiencyTrend)}/mo).`.slice(0, 200),
    });
  }
  if (capEffTrendPos) {
    drivers.push({
      driver: 'Capital efficiency',
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.capitalEfficiencyTrend) * 5 + 40)),
      detail: `Capital efficiency raste (${round1(trends.capitalEfficiencyTrend)}/mo).`.slice(0, 200),
    });
  } else if (trends.capitalEfficiencyTrend < 0) {
    drivers.push({
      driver: 'Capital efficiency',
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.capitalEfficiencyTrend) * 5 + 40)),
      detail: `Capital efficiency pada (${round1(trends.capitalEfficiencyTrend)}/mo).`.slice(0, 200),
    });
  }
  if (current.turnoverRate > 0) {
    drivers.push({
      driver: 'Turnover rate',
      impact: current.turnoverRate >= 1 ? 'POSITIVE' : 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, current.turnoverRate * 25 + 30)),
      detail: `Trenutni turnover rate: ${round1(current.turnoverRate)} (>${round1(current.turnoverRate)} ciklov/mesec).`.slice(0, 200),
    });
  }
  if (current.capitalCycleTime > 0) {
    drivers.push({
      driver: 'Capital cycle time',
      impact: current.capitalCycleTime <= 30 ? 'POSITIVE' : 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(60 - current.capitalCycleTime) + 20)),
      detail: `Povprečni čas cikla: ${round0(current.capitalCycleTime)} dni (${current.capitalCycleTime <= 30 ? 'hitro' : 'poasno'}).`.slice(0, 200),
    });
  }
  if (momentumPos) {
    drivers.push({
      driver: 'Efficiency momentum',
      impact: 'POSITIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.efficiencyMomentum) * 50 + 40)),
      detail: `Pospešek efficiency raste (${round1(trends.efficiencyMomentum)}/mo²).`.slice(0, 200),
    });
  } else if (trends.efficiencyMomentum < -0.2) {
    drivers.push({
      driver: 'Efficiency momentum',
      impact: 'NEGATIVE',
      weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.efficiencyMomentum) * 50 + 40)),
      detail: `Pospešek efficiency pada (${round1(trends.efficiencyMomentum)}/mo²).`.slice(0, 200),
    });
  }
  // Sort by weight desc, take top 3
  drivers.sort((a, b) => b.weight - a.weight);

  // Bottlenecks
  const bottlenecks: EfficiencyBottleneck[] = [];
  if (current.capitalCycleTime > 60) {
    bottlenecks.push({
      bottleneck: `Dolg capital cycle (${round0(current.capitalCycleTime)} dni) omejuje efficiency.`,
      impact: 'Kapital je vezan predolgo — manj ciklov na leto.',
      mitigation: 'Pospeši prodajo s cenovnimi spodbudami ali fokusiraj na hitro prodajne kategorije.',
    });
  }
  if (current.capitalEfficiency < 15) {
    bottlenecks.push({
      bottleneck: `Nizka capital efficiency (${round1(current.capitalEfficiency)}%) — profit je majhen glede na vezani kapital.`,
      impact: 'ROI na vezani kapital je nezadosten.',
      mitigation: 'Povišaj cene ali zmanjšaj nabavne cene za izboljšanje profita per cycle.',
    });
  }
  if (current.turnoverRate < 0.5) {
    bottlenecks.push({
      bottleneck: `Nizek turnover rate (${round1(current.turnoverRate)}) — premalo ciklov na mesec.`,
      impact: 'Kapital se prepoasi krozi — ni dovolj ciklov za profit.',
      mitigation: 'Povečaj obseg prodaje (nižje cene, boljši marketing) ali zmanjšaj inventar.',
    });
  }
  if (trends.efficiencyDirection === 'DECLINING') {
    bottlenecks.push({
      bottleneck: 'Efficiency upada — trend kaže na slabšanje.',
      impact: 'Negativna trajektorija zmanjšuje future profit potential.',
      mitigation: 'Identificiraj vzroke upadanja (kategorije, viri) in ukrepaj.',
    });
  }
  if (current.profitPerTurnover < 10) {
    bottlenecks.push({
      bottleneck: `Majhen profit per cycle (${round0(current.profitPerTurnover)}€) — margin je prenizka.`,
      impact: 'Vsak cikel prinese premalo profita za pokritje režije.',
      mitigation: 'Premakni se v kategorije z višjo maržo ali povišaj cene.',
    });
  }
  // Sample size bottleneck
  const totalTrades = monthly.reduce((s, m) => s + m.soldCount, 0);
  if (totalTrades < 20) {
    bottlenecks.push({
      bottleneck: `Majhna vzorčna osnova (${totalTrades} trgov) — efficiency ocena je negotljiva.`,
      impact: 'Forecast-i so manj zanesljivi z malo podatki.',
      mitigation: 'Počakaj na več trgov (vsaj 20) preden zcela zaupaš forecast-u.',
    });
  }
  if (bottlenecks.length === 0) {
    bottlenecks.push({
      bottleneck: 'Ni specifičnih bottleneck-ov — efficiency je zdrava.',
      impact: 'Vzdržuj trenutno strategijo.',
      mitigation: 'Redno preverjaj trende in ostani alert na spremembe.',
    });
  }

  // Optimization actions
  const actions: EfficiencyOptimizationAction[] = [];
  if (current.capitalCycleTime > 60) {
    actions.push({
      action: `Liquidiraj inventar >60 dni — znižaj cene za 10-15% za pospešitev prodaje.`,
      priority: 'HIGH',
      expectedEfficiencyGain: 10,
    });
  }
  if (current.capitalEfficiency < 15) {
    actions.push({
      action: 'Povišaj cene za 5-10% ali poišči ceneje nabavne vire.',
      priority: 'HIGH',
      expectedEfficiencyGain: 8,
    });
  }
  if (current.turnoverRate < 0.5) {
    actions.push({
      action: 'Povečaj obseg nabave in prodajnih kanalov za povečanje ciklov.',
      priority: 'MEDIUM',
      expectedEfficiencyGain: 6,
    });
  }
  if (trends.efficiencyDirection === 'IMPROVING') {
    actions.push({
      action: 'Povečaj obseg — efficiency se izboljšuje, izkoristi trend.',
      priority: 'MEDIUM',
      expectedEfficiencyGain: 5,
    });
  } else if (trends.efficiencyDirection === 'DECLINING') {
    actions.push({
      action: 'Premakni kapital v kategorije z višjo efficiency.',
      priority: 'HIGH',
      expectedEfficiencyGain: 7,
    });
  }
  if (current.profitPerTurnover < 10) {
    actions.push({
      action: 'Premakni se v kategorije z višjo maržo (npr. premium produkti).',
      priority: 'MEDIUM',
      expectedEfficiencyGain: 4,
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo — efficiency je zdrava.',
      priority: 'LOW',
      expectedEfficiencyGain: 0,
    });
  }

  return {
    efficiencyDrivers: drivers.slice(0, 3),
    efficiencyBottlenecks: bottlenecks.slice(0, 3),
    efficiencyOptimizationActions: actions.slice(0, 3),
  };
}

function buildSummary(
  current: CurrentEfficiency,
  forecast: EfficiencyForecast,
  trends: EfficiencyTrends,
): string {
  const parts: string[] = [
    `Turnover efficiency: ${current.efficiencyGrade === 'A+' ? 95 : 85}/100 (${current.efficiencyGrade} grade).`,
    `Profit per cycle: ${round0(current.profitPerTurnover)}€.`,
    `30d forecast: ${round0(forecast.projectedEfficiency30d)}/100, ${round0(forecast.projectedProfitPerCycle30d)}€/cycle.`,
  ];
  // bottleneck summary (compressed)
  if (current.capitalCycleTime > 60) {
    parts.push(`Bottleneck: aging items (${round0(current.capitalCycleTime)}d cycle).`);
  } else if (current.capitalEfficiency < 15) {
    parts.push(`Bottleneck: low capital efficiency.`);
  } else if (current.turnoverRate < 0.5) {
    parts.push(`Bottleneck: low turnover rate.`);
  } else {
    parts.push(`No major bottleneck.`);
  }
  parts.push(`Trend: ${trends.efficiencyDirection}.`);
  return parts.join(' ').slice(0, 400);
}

// --- Handler -----------------------------------------------------------

const inventoryTurnoverEfficiencyForecasterHandler = withAiRoute<InventoryTurnoverEfficiencyForecasterInput>({
  endpoint: '/api/ai/inventory-turnover-efficiency-forecaster',
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
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
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

    // 2) Query all HELD trades (current inventory) — for avg inventory held
    const heldTrades = await db.trade.findMany({
      where: {
        status: 'held',
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
      },
      take: 100000,
    }) as unknown as HeldTradeRow[];

    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          turnoverRate: 0,
          capitalEfficiency: 0,
          profitPerTurnover: 0,
          capitalCycleTime: 0,
          roiPerCycle: 0,
          efficiencyGrade: 'F',
        },
        trends: {
          turnoverEfficiencyTrend: 0,
          capitalEfficiencyTrend: 0,
          efficiencyDirection: 'STABLE',
          efficiencyMomentum: 0,
        },
        monthlyData: [],
        forecast: {
          projectedEfficiency30d: 0,
          projectedEfficiency60d: 0,
          projectedEfficiency90d: 0,
          projectedProfitPerCycle30d: 0,
          projectedCapitalEfficiency30d: 0,
          projectedCyclesPerMonth30d: 0,
          confidenceLevel: 0,
        },
        analysis: {
          efficiencyDrivers: [],
          efficiencyBottlenecks: [],
          efficiencyOptimizationActions: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Turnover Efficiency Forecaster ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Turnover Efficiency Forecaster ni mogoč.',
      });
    }

    // 3) Group SOLD trades by month (12 buckets, index 0 = oldest, 11 = newest)
    const monthStartMs = (t: number): number => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    const thisMonthStart = monthStartMs(now);

    const months: MonthAgg[] = Array.from({ length: MONTHS_12 }, () => newMonthAgg());

    // Count active HELD trades at start of each month (approximation: held trades with buyDate <= month start)
    for (let i = 0; i < MONTHS_12; i++) {
      const monthDate = new Date(thisMonthStart);
      monthDate.setMonth(monthDate.getMonth() - (11 - i));
      const monthStart = monthDate.getTime();
      const monthEnd = i === 11 ? now : new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime();
      // Avg inventory held during this month ≈ held trades at start + sold trades during month / 2
      const heldAtStart = heldTrades.filter((t) => {
        const buyMs = toMs(t.buyDate);
        return buyMs > 0 && buyMs <= monthStart;
      }).length;
      const soldDuringMonth = soldTrades.filter((t) => {
        const sellMs = toMs(t.sellDate);
        return sellMs >= monthStart && sellMs < monthEnd;
      }).length;
      months[i]!.heldAtStartCount = heldAtStart + Math.round(soldDuringMonth / 2);
    }

    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const buyMs = toMs(t.buyDate);
      const profit = sellPrice - sellFees - buyPrice - buyFees;
      const capitalDeployed = buyPrice + buyFees;

      const sellMonthStart = monthStartMs(sellMs);
      const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
      const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
      if (bucketIdx >= 0 && bucketIdx <= 11) {
        const m = months[bucketIdx]!;
        m.soldCount += 1;
        m.totalProfit += profit;
        m.totalCapitalDeployed += capitalDeployed;
        if (buyMs > 0) {
          const cycleDays = (sellMs - buyMs) / DAY_MS;
          m.totalCycleDays += cycleDays;
          m.cycleDayCount += 1;
        }
      }
    }

    // 4) Build monthly data array
    const monthlyData: MonthlyDataPoint[] = months.map((m, i) => {
      const monthDate = new Date(thisMonthStart);
      monthDate.setMonth(monthDate.getMonth() - (11 - i));
      const turnoverRate = m.heldAtStartCount > 0 ? m.soldCount / m.heldAtStartCount : 0;
      const capitalEfficiency = m.totalCapitalDeployed > 0 ? (m.totalProfit / m.totalCapitalDeployed) * 100 : 0;
      const profitPerTurnover = turnoverRate > 0 ? m.totalProfit / turnoverRate : 0;
      const capitalCycleTime = m.cycleDayCount > 0 ? m.totalCycleDays / m.cycleDayCount : 0;
      const roiPerCycle = m.totalCapitalDeployed > 0 ? (m.totalProfit / m.totalCapitalDeployed) * 100 : 0;
      return {
        month: monthDate.toISOString().slice(0, 10),
        turnoverRate: round1(Math.max(TURNOVER_MIN, Math.min(TURNOVER_MAX, turnoverRate))),
        capitalEfficiency: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, capitalEfficiency))),
        profitPerTurnover: round0(Math.max(PROFIT_PER_CYCLE_MIN, Math.min(PROFIT_PER_CYCLE_MAX, profitPerTurnover))),
        capitalCycleTime: round0(Math.max(CYCLE_TIME_MIN, Math.min(CYCLE_TIME_MAX, capitalCycleTime))),
        roiPerCycle: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, roiPerCycle))),
      };
    });

    // 5) Compute current efficiency (from last month)
    const lastMonth = months[months.length - 1]!;
    const currentTurnoverRate = lastMonth.heldAtStartCount > 0 ? lastMonth.soldCount / lastMonth.heldAtStartCount : 0;
    const currentCapitalEfficiency = lastMonth.totalCapitalDeployed > 0 ? (lastMonth.totalProfit / lastMonth.totalCapitalDeployed) * 100 : 0;
    const currentProfitPerTurnover = currentTurnoverRate > 0 ? lastMonth.totalProfit / currentTurnoverRate : 0;
    const currentCycleTime = lastMonth.cycleDayCount > 0 ? lastMonth.totalCycleDays / lastMonth.cycleDayCount : 0;
    const currentRoiPerCycle = lastMonth.totalCapitalDeployed > 0 ? (lastMonth.totalProfit / lastMonth.totalCapitalDeployed) * 100 : 0;
    const currentEfficiencyScore = computeEfficiencyScore(
      currentTurnoverRate, currentCapitalEfficiency, currentProfitPerTurnover, currentCycleTime,
    );

    const current: CurrentEfficiency = {
      turnoverRate: round1(Math.max(TURNOVER_MIN, Math.min(TURNOVER_MAX, currentTurnoverRate))),
      capitalEfficiency: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, currentCapitalEfficiency))),
      profitPerTurnover: round0(Math.max(PROFIT_PER_CYCLE_MIN, Math.min(PROFIT_PER_CYCLE_MAX, currentProfitPerTurnover))),
      capitalCycleTime: round0(Math.max(CYCLE_TIME_MIN, Math.min(CYCLE_TIME_MAX, currentCycleTime))),
      roiPerCycle: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, currentRoiPerCycle))),
      efficiencyGrade: gradeFromScore(currentEfficiencyScore),
    };

    // 6) Compute efficiency trends (1st + 2nd derivative)
    const profitPerTurnoverSeries = monthlyData.map((m) => m.profitPerTurnover);
    const capitalEfficiencySeries = monthlyData.map((m) => m.capitalEfficiency);
    const efficiencySeries = monthlyData.map((m) =>
      computeEfficiencyScore(m.turnoverRate, m.capitalEfficiency, m.profitPerTurnover, m.capitalCycleTime),
    );

    const turnoverEfficiencyTrend = trendSlope(profitPerTurnoverSeries);
    const capitalEfficiencyTrend = trendSlope(capitalEfficiencySeries);
    const efficiencyMomentum = computeAcceleration(efficiencySeries);
    const efficiencyDirection = directionFromTrend(trendSlope(efficiencySeries));

    const trends: EfficiencyTrends = {
      turnoverEfficiencyTrend: round1(turnoverEfficiencyTrend),
      capitalEfficiencyTrend: round1(capitalEfficiencyTrend),
      efficiencyDirection,
      efficiencyMomentum: round1(efficiencyMomentum),
    };

    // 7) Build forecast (deterministic baseline)
    const efficiencyTrend = trendSlope(efficiencySeries);
    // Project next month (30d) using trend + 0.5 × momentum (2nd-order extrapolation)
    const proj30 = currentEfficiencyScore + efficiencyTrend + 0.5 * efficiencyMomentum;
    const proj60 = currentEfficiencyScore + 2 * efficiencyTrend + 1.0 * efficiencyMomentum;
    const proj90 = currentEfficiencyScore + 3 * efficiencyTrend + 1.5 * efficiencyMomentum;
    const profitTrend = trendSlope(profitPerTurnoverSeries);
    const projProfit30 = currentProfitPerTurnover + profitTrend;
    const capEffTrend = trendSlope(capitalEfficiencySeries);
    const projCapEff30 = currentCapitalEfficiency + capEffTrend;
    const projCycles30 = currentTurnoverRate + trendSlope(monthlyData.map((m) => m.turnoverRate));

    const forecast: EfficiencyForecast = {
      projectedEfficiency30d: round0(Math.max(EFF_MIN, Math.min(EFF_MAX, proj30))),
      projectedEfficiency60d: round0(Math.max(EFF_MIN, Math.min(EFF_MAX, proj60))),
      projectedEfficiency90d: round0(Math.max(EFF_MIN, Math.min(EFF_MAX, proj90))),
      projectedProfitPerCycle30d: round0(Math.max(PROFIT_PER_CYCLE_MIN, Math.min(PROFIT_PER_CYCLE_MAX, projProfit30))),
      projectedCapitalEfficiency30d: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, projCapEff30))),
      projectedCyclesPerMonth30d: round1(Math.max(TURNOVER_MIN, Math.min(TURNOVER_MAX, projCycles30))),
      confidenceLevel: 50, // will be computed below
    };

    // 8) Build deterministic baseline (fallback)
    const detAnalysis = buildDeterministicAnalysis(months, trends, current);

    // Confidence level
    const totalTrades = months.reduce((s, m) => s + m.soldCount, 0);
    const activeMonths = months.filter((m) => m.soldCount > 0).length;
    let confidence = 30;
    confidence += Math.min(25, activeMonths * 4);
    confidence += Math.min(20, Math.min(50, totalTrades) * 0.4);
    if (Math.abs(efficiencyMomentum) > 1) confidence += 10;
    if (trends.efficiencyDirection !== 'STABLE') confidence += 5;
    confidence = round0(Math.max(CONF_MIN, Math.min(CONF_MAX, confidence)));
    forecast.confidenceLevel = confidence;

    let analysis = detAnalysis;
    let summary = buildSummary(current, forecast, trends);

    // 9) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `inventory-turnover-efficiency-forecaster:${currentMonth}`;
    const cached = getCachedAI<{ analysis: EfficiencyAnalysis; summary: string }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        trends,
        monthlyData,
        forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 10) AI prompt with grounding
    const promptData = {
      current,
      trends,
      monthlyData,
      forecast,
      deterministicBaseline: detAnalysis,
      caps: {
        effMin: EFF_MIN, effMax: EFF_MAX,
        profitPerCycleMin: PROFIT_PER_CYCLE_MIN, profitPerCycleMax: PROFIT_PER_CYCLE_MAX,
        weightMin: WEIGHT_MIN, weightMax: WEIGHT_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        confMin: CONF_MIN, confMax: CONF_MAX,
      },
    };

    const prompt = `Si AI "Inventory Turnover Efficiency Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napoveš TURNOVER EFFICIENCY — kako učinkovito bo kapital krozen skozi inventar v naslednjih 30/60/90 dneh. Kombiniraš turnover rate z capital efficiency (profit per turnover cycle, ROI per cycle). Razlika od inventory-turnover-forecast (ki napove turnover rate) — ti gledaš EFFICIENCY (profit na turnover cycle).

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD + HELD trgovin, grouped by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. efficiencyDrivers: 1-3 driverjev { driver (max 100 chars), impact POSITIVE | NEGATIVE, weight 0-100, detail (max 200 chars) }.
2. efficiencyBottlenecks: 1-3 bottleneck-ov { bottleneck (max 200 chars), impact (max 200 chars), mitigation (max 200 chars) }.
3. efficiencyOptimizationActions: 1-3 akcij { action (max 200 chars), priority HIGH | MEDIUM | LOW, expectedEfficiencyGain v procentnih točkah [-5, 30] }.
4. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "efficiencyDrivers": [
    { "driver": "Profit per turnover", "impact": "POSITIVE", "weight": 75, "detail": "Profit per turnover cycle raste (+2/mo)." }
  ],
  "efficiencyBottlenecks": [
    { "bottleneck": "Dolg capital cycle (45 dni).", "impact": "Manj ciklov na leto.", "mitigation": "Pospeši prodajo s cenovnimi spodbudami." }
  ],
  "efficiencyOptimizationActions": [
    { "action": "Liquidiraj inventar >60 dni.", "priority": "HIGH", "expectedEfficiencyGain": 10 }
  ],
  "summary": "Turnover efficiency: 85/100 (A grade). Profit per cycle: 45€. 30d forecast: 90/100, 50€/cycle. Bottleneck: aging items."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiEfficiencyResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Drivers
        const drivers: EfficiencyDriver[] = [];
        if (Array.isArray(parsed.efficiencyDrivers)) {
          for (const d of parsed.efficiencyDrivers.slice(0, 3)) {
            if (!d || typeof d !== 'object') continue;
            drivers.push({
              driver: clampString(d.driver, 100, detAnalysis.efficiencyDrivers[0]?.driver ?? 'Profit per turnover'),
              impact: clampEnum(d.impact, VALID_IMPACT, detAnalysis.efficiencyDrivers[0]?.impact ?? 'POSITIVE'),
              weight: clampNum(d.weight, WEIGHT_MIN, WEIGHT_MAX, detAnalysis.efficiencyDrivers[0]?.weight ?? 50),
              detail: clampString(d.detail, 200, detAnalysis.efficiencyDrivers[0]?.detail ?? 'Efficiency signal.'),
            });
          }
        }
        if (drivers.length === 0) {
          for (const d of detAnalysis.efficiencyDrivers) drivers.push(d);
        }

        // Bottlenecks
        const bottlenecks: EfficiencyBottleneck[] = [];
        if (Array.isArray(parsed.efficiencyBottlenecks)) {
          for (const b of parsed.efficiencyBottlenecks.slice(0, 3)) {
            if (!b || typeof b !== 'object') continue;
            bottlenecks.push({
              bottleneck: clampString(b.bottleneck, 200, detAnalysis.efficiencyBottlenecks[0]?.bottleneck ?? 'No bottleneck.'),
              impact: clampString(b.impact, 200, detAnalysis.efficiencyBottlenecks[0]?.impact ?? 'No impact.'),
              mitigation: clampString(b.mitigation, 200, detAnalysis.efficiencyBottlenecks[0]?.mitigation ?? 'Maintain strategy.'),
            });
          }
        }
        if (bottlenecks.length === 0) {
          for (const b of detAnalysis.efficiencyBottlenecks) bottlenecks.push(b);
        }

        // Actions
        const actions: EfficiencyOptimizationAction[] = [];
        if (Array.isArray(parsed.efficiencyOptimizationActions)) {
          for (const a of parsed.efficiencyOptimizationActions.slice(0, 3)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, detAnalysis.efficiencyOptimizationActions[0]?.action ?? 'Maintain strategy.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, detAnalysis.efficiencyOptimizationActions[0]?.priority ?? 'MEDIUM'),
              expectedEfficiencyGain: round0(clampNum(a.expectedEfficiencyGain, GAIN_MIN, GAIN_MAX, detAnalysis.efficiencyOptimizationActions[0]?.expectedEfficiencyGain ?? 1)),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of detAnalysis.efficiencyOptimizationActions) actions.push(a);
        }

        analysis = {
          efficiencyDrivers: drivers,
          efficiencyBottlenecks: bottlenecks,
          efficiencyOptimizationActions: actions,
        };
        summary = clampString(parsed.summary, 400, buildSummary(current, forecast, trends));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-efficiency-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 11) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { analysis, summary });
    }

    return apiOk({
      ok: true,
      current,
      trends,
      monthlyData,
      forecast,
      analysis,
      summary,
      aiUsed,
    });
  },
});

export const GET = inventoryTurnoverEfficiencyForecasterHandler;
export const POST = inventoryTurnoverEfficiencyForecasterHandler;
