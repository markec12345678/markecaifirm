// v8.08: AI Profit Per Day Scaling Maximizer — AI MAKSIMIZIRA in SKALIRA
// PROFIT PER DAY — ne samo optimizira trenutni daily profit, ampak ga SKALIRA
// GOR (poveča trade frequency, capital deployment in profit per trade simultano).
// "Tvoj daily profit je 45€. Za 150€/dan rabiš: 2× več trade-ov, 1.3× višji profit
// per trade in 1.5× več kapitala." Razlika od profit-per-euro-maximizer (v8.07 ki
// maksimizira profit per euro deployed — capital efficiency ratio) — ta MAKSIMIZIRA
// in SKALIRA DAILY PROFIT (€/dan absolutno, ne ratio). Razlika od
// revenue-per-trade-maximizer (v8.06 ki maksimizira top-line sell price per trade)
// — ta maksimizira DAILY PROFIT SKALIRAN (frekvencija × profit per trade × capital).
// Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira cash flow per
// source) — ta maksimizira in skalira DAILY PROFIT čez celoten portfolio z
// scalingPath (IMMEDIATE/SHORT_TERM/MEDIUM_TERM/LONG_TERM phases). Razlika od
// inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return
// na held inventory) — ta maksimizira DAILY PROFIT €/dan absolutno, ne % return.
// Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira return OF
// capital) — ta maksimizira in skalira DAILY PROFIT (return ON capital scaled).
// Razlika od profit-scale-engine (v7.96 ki skalira profit z growth engine) — ta
// maksimizira DAILY PROFIT z scalingPath phases in scalingBottlenecks. Razlika od
// profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ta maksimizira
// in SKALIRA daily profit z requiredTradesPerDay, requiredProfitPerTrade,
// requiredCapital, timeline, feasibility per phase. Razlika od
// profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) —
// ta maksimizira DAILY PROFIT z scaling multiplier in capitalScalingRequirement.

// GET+POST /api/ai/profit-per-day-scaling-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.9) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ScalingPhase = 'IMMEDIATE' | 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
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

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
}

interface CurrentState {
  currentDailyProfit: number; // €/day (realized profit 12m / 365)
  currentTradeFrequencyPerWeek: number; // trades/week
  avgProfitPerTrade: number; // €
  capitalDeployed: number; // € (SOLD 12m + HELD)
  totalProfit12m: number; // €
  soldCount12m: number;
  heldCount: number;
  avgHoldDays: number; // days
  annualizedProfit: number; // € = totalProfit12m
}

interface ScalingPathEntry {
  phase: ScalingPhase;
  targetDailyProfit: number; // €/day
  requiredTradesPerDay: number; // trades/day
  requiredProfitPerTrade: number; // €
  requiredCapital: number; // €
  timeline: string; // slovenski
  feasibility: number; // 0-100
}

interface ScalingBottleneck {
  phase: ScalingPhase;
  bottleneck: string; // slovenski
  impact: number; // 0-100
  mitigation: string; // slovenski
}

interface ScalingAction {
  phase: ScalingPhase;
  action: string; // slovenski
  expectedDailyProfitUplift: number; // €/day
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface ProfitPerDayScalingMaximization {
  scalingPath: ScalingPathEntry[];
  scalingBottlenecks: ScalingBottleneck[];
  scalingActions: ScalingAction[];
  maximizedDailyProfit: number; // €/day
  scalingMultiplier: number; // ratio maximized / current [1.0, 10.0]
  scalingGrade: ScalingGrade;
  capitalScalingRequirement: number; // € additional capital required for full scaling
  timeToTargetScale: number; // days to reach maximized
}

interface ProfitPerDayScalingResponse {
  ok: true;
  current: CurrentState;
  maximization: ProfitPerDayScalingMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    scalingPath?: Array<{
      phase?: ScalingPhase;
      targetDailyProfit?: number;
      requiredTradesPerDay?: number;
      requiredProfitPerTrade?: number;
      requiredCapital?: number;
      timeline?: string;
      feasibility?: number;
    }>;
    scalingBottlenecks?: Array<{
      phase?: ScalingPhase;
      bottleneck?: string;
      impact?: number;
      mitigation?: string;
    }>;
    scalingActions?: Array<{
      phase?: ScalingPhase;
      action?: string;
      expectedDailyProfitUplift?: number;
      priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    }>;
    maximizedDailyProfit?: number;
    scalingMultiplier?: number;
    scalingGrade?: ScalingGrade;
    capitalScalingRequirement?: number;
    timeToTargetScale?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const DAILY_PROFIT_MIN = 0;
const DAILY_PROFIT_MAX = 10_000;
const TRADES_PER_DAY_MIN = 0;
const TRADES_PER_DAY_MAX = 100;
const TRADES_PER_WEEK_MIN = 0;
const TRADES_PER_WEEK_MAX = 700;
const PROFIT_PER_TRADE_MIN = -5000;
const PROFIT_PER_TRADE_MAX = 50_000;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const MULTIPLIER_MIN = 1.0;
const MULTIPLIER_MAX = 10.0;
const FEASIBILITY_MIN = 0;
const FEASIBILITY_MAX = 100;
const IMPACT_MIN = 0;
const IMPACT_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 10_000;
const TIMELINE_MIN = 1;
const TIMELINE_MAX = 1095; // 3 years
const HOLD_MIN = 1;
const HOLD_MAX = 730;

const VALID_PHASE: readonly ScalingPhase[] = [
  'IMMEDIATE',
  'SHORT_TERM',
  'MEDIUM_TERM',
  'LONG_TERM',
];
const VALID_GRADE: readonly ScalingGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_PRIORITY: readonly ('HIGH' | 'MEDIUM' | 'LOW')[] = ['HIGH', 'MEDIUM', 'LOW'];

const MAX_PHASES = 4;
const MAX_BOTTLENECKS = 6;
const MAX_ACTIONS = 8;
const MAX_TRADES_FOR_AI = 250;

// Phase multipliers — how target daily profit scales by phase
// IMMEDIATE = current × 1.5, SHORT_TERM = current × 3, MEDIUM_TERM = current × 5, LONG_TERM = current × 8
const PHASE_MULTIPLIER: Record<ScalingPhase, number> = {
  IMMEDIATE: 1.5,
  SHORT_TERM: 3.0,
  MEDIUM_TERM: 5.0,
  LONG_TERM: 8.0,
};

// Phase feasibility (IMMEDIATE easier, LONG_TERM harder)
const PHASE_FEASIBILITY: Record<ScalingPhase, number> = {
  IMMEDIATE: 85,
  SHORT_TERM: 70,
  MEDIUM_TERM: 55,
  LONG_TERM: 40,
};

// Phase timeline (slovenian)
const PHASE_TIMELINE: Record<ScalingPhase, string> = {
  IMMEDIATE: '0–30 dni — quick wins z obstoječimi resursi',
  SHORT_TERM: '1–3 meseci — potrebno več capital-a in monitorjev',
  MEDIUM_TERM: '3–9 mesecev — skaliranje ekipe in avtomatizacije',
  LONG_TERM: '9–24 mesecev — polno skaliranje z multi-platform',
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
  capital: number; // buyPrice + buyFees
  profit: number; // € = (sellPrice − sellFees) − capital
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
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const profit = (sellPrice - sellFees) - capital;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  return { capital, profit, holdDays, sellMs, within12m };
}

interface HeldComputed {
  capital: number;
}

function computeHeldTrade(t: HeldTradeRow): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  return { capital };
}

function computeCurrent(
  sold: SoldComputed[],
  held: HeldComputed[],
): CurrentState {
  const soldCount = sold.length;
  const heldCount = held.length;

  const soldCapital = round0(clampNum(
    sold.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const heldCapital = round0(clampNum(
    held.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const capitalDeployed = round0(clampNum(
    soldCapital + heldCapital,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  const totalProfit12m = round0(clampNum(
    sold.reduce((s, t) => s + t.profit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Annualized profit = 12m realized profit
  const annualizedProfit = totalProfit12m;
  // Daily profit = annualized / 365
  const currentDailyProfit = round2(clampNum(
    annualizedProfit / 365,
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, 0,
  ));

  // Trades per week = soldCount × 7 / 365
  const currentTradeFrequencyPerWeek = round2(clampNum(
    soldCount * 7 / 365,
    TRADES_PER_WEEK_MIN, TRADES_PER_WEEK_MAX, 0,
  ));

  const avgProfitPerTrade = round2(clampNum(
    soldCount > 0 ? totalProfit12m / soldCount : 0,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));

  const avgHoldDays = round0(clampNum(
    soldCount > 0
      ? sold.reduce((s, t) => s + t.holdDays, 0) / soldCount
      : 0,
    soldCount > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
  ));

  return {
    currentDailyProfit,
    currentTradeFrequencyPerWeek,
    avgProfitPerTrade,
    capitalDeployed,
    totalProfit12m,
    soldCount12m: soldCount,
    heldCount,
    avgHoldDays,
    annualizedProfit,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildScalingPath(current: CurrentState): ScalingPathEntry[] {
  const phases: ScalingPhase[] = ['IMMEDIATE', 'SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM'];
  const entries: ScalingPathEntry[] = [];

  for (const phase of phases) {
    const mult = PHASE_MULTIPLIER[phase];
    const targetDailyProfit = round2(clampNum(
      current.currentDailyProfit * mult,
      DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, current.currentDailyProfit,
    ));
    // For higher phases, we assume avgProfitPerTrade also improves
    const profitPerTradeFactor = phase === 'IMMEDIATE' ? 1.0
      : phase === 'SHORT_TERM' ? 1.1
      : phase === 'MEDIUM_TERM' ? 1.2
      : 1.3;
    const requiredProfitPerTrade = round2(clampNum(
      current.avgProfitPerTrade > 0
        ? current.avgProfitPerTrade * profitPerTradeFactor
        : Math.max(20, targetDailyProfit * 0.5),
      PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 20,
    ));
    const requiredTradesPerDay = round2(clampNum(
      requiredProfitPerTrade > 0
        ? targetDailyProfit / requiredProfitPerTrade
        : 0,
      TRADES_PER_DAY_MIN, TRADES_PER_DAY_MAX, 0,
    ));
    // Required capital scales with targetDailyProfit × avg hold days
    const requiredCapital = round0(clampNum(
      current.avgHoldDays > 0
        ? targetDailyProfit * current.avgHoldDays * 1.2
        : targetDailyProfit * 30,
      CAPITAL_MIN, CAPITAL_MAX, current.capitalDeployed,
    ));
    const feasibility = round0(clampNum(
      PHASE_FEASIBILITY[phase],
      FEASIBILITY_MIN, FEASIBILITY_MAX, 50,
    ));

    entries.push({
      phase,
      targetDailyProfit,
      requiredTradesPerDay,
      requiredProfitPerTrade,
      requiredCapital,
      timeline: PHASE_TIMELINE[phase],
      feasibility,
    });
  }

  return entries.slice(0, MAX_PHASES);
}

function buildScalingBottlenecks(
  current: CurrentState,
  path: ScalingPathEntry[],
): ScalingBottleneck[] {
  const out: ScalingBottleneck[] = [];

  out.push({
    phase: 'IMMEDIATE',
    bottleneck: current.currentTradeFrequencyPerWeek < 2
      ? 'Nizka trade frekvencna — premalo deal flow-za za immediate scaling'
      : 'Profit per trade suboptimalen — potrebna pricing optimizacija',
    impact: round0(clampNum(
      current.currentTradeFrequencyPerWeek < 2 ? 70 : 45,
      IMPACT_MIN, IMPACT_MAX, 50,
    )),
    mitigation: 'Vklopi več monitorjev (Bolha + Vinted + Subito), znižaj deal score threshold za 10%, omogoči auto-buy pri deal score > 80.',
  });

  const shortTarget = path.find((p) => p.phase === 'SHORT_TERM');
  const capitalGap = shortTarget
    ? Math.max(0, shortTarget.requiredCapital - current.capitalDeployed)
    : 0;
  out.push({
    phase: 'SHORT_TERM',
    bottleneck: capitalGap > 0
      ? `Capital shortfall ${round0(capitalGap)}€ — potreben dodaten kapital za short-term scaling`
      : 'Profit per trade plateau — potrebna kategorija diversifikacija',
    impact: round0(clampNum(
      capitalGap > 0 ? 65 : 40,
      IMPACT_MIN, IMPACT_MAX, 50,
    )),
    mitigation: 'Reinvest 80% realized profit v nov sourcing, razširi kategorije (mobile + electronics + fashion), omogoči cross-border sourcing (Kleinanzeigen/Subito).',
  });

  out.push({
    phase: 'MEDIUM_TERM',
    bottleneck: 'Operativna kapaciteta — premalo časa za upravljanje 5× več trade-ov ročno',
    impact: round0(clampNum(60, IMPACT_MIN, IMPACT_MAX, 50)),
    mitigation: 'Avtomatiziraj listing generation (AI bulk-listing-generator), cross-platform multi-platform-sync, auto-relisting-scheduler. Sprejmi pomočnika ali V.A.',
  });

  out.push({
    phase: 'LONG_TERM',
    bottleneck: 'Market saturation — lokalne platforme dosežejo strop pri 8× scaling',
    impact: round0(clampNum(75, IMPACT_MIN, IMPACT_MAX, 70)),
    mitigation: 'Ekspanzija na 5+ platform (Bolha, Vinted, Avtonet, mobile.de, Kleinanzeigen, Subito, Willhaben), multi-language listings, niche vertical expansion.',
  });

  return out.slice(0, MAX_BOTTLENECKS);
}

function buildScalingActions(
  current: CurrentState,
  path: ScalingPathEntry[],
): ScalingAction[] {
  const out: ScalingAction[] = [];

  out.push({
    phase: 'IMMEDIATE',
    action: `Dvigni deal score alert threshold z 60 na 75 in omogoči auto-buy — +${Math.round(current.currentTradeFrequencyPerWeek * 0.5)} trades/teden.`,
    expectedDailyProfitUplift: round2(clampNum(
      current.avgProfitPerTrade * 0.7,
      UPLIFT_MIN, UPLIFT_MAX, 5,
    )),
    priority: 'HIGH',
  });
  out.push({
    phase: 'IMMEDIATE',
    action: 'Vklopi listing-refresh-scheduler in auto-relisting-scheduler za vse stale HELD items — skrajšaj hold za 25%.',
    expectedDailyProfitUplift: round2(clampNum(
      current.currentDailyProfit * 0.15,
      UPLIFT_MIN, UPLIFT_MAX, 3,
    )),
    priority: 'HIGH',
  });

  const shortTarget = path.find((p) => p.phase === 'SHORT_TERM');
  out.push({
    phase: 'SHORT_TERM',
    action: `Reinvest ${round0(current.totalProfit12m * 0.6)}€ v high-ROI sourcing (Bolha + Vinted premium listings z deal score > 80).`,
    expectedDailyProfitUplift: round2(clampNum(
      shortTarget ? shortTarget.targetDailyProfit * 0.3 : current.currentDailyProfit * 0.5,
      UPLIFT_MIN, UPLIFT_MAX, 10,
    )),
    priority: 'HIGH',
  });
  out.push({
    phase: 'SHORT_TERM',
    action: 'Dodaj 3 nove monitorje (fashion + electronics + sports) z keyword expansion — +30% deal flow.',
    expectedDailyProfitUplift: round2(clampNum(
      current.currentDailyProfit * 0.25,
      UPLIFT_MIN, UPLIFT_MAX, 8,
    )),
    priority: 'MEDIUM',
  });

  out.push({
    phase: 'MEDIUM_TERM',
    action: 'Vklopi multi-platform-listing-generator in cross-platform-listing-generator — vsak listing na 3+ platformah.',
    expectedDailyProfitUplift: round2(clampNum(
      current.currentDailyProfit * 0.5,
      UPLIFT_MIN, UPLIFT_MAX, 15,
    )),
    priority: 'MEDIUM',
  });
  out.push({
    phase: 'MEDIUM_TERM',
    action: 'Avtomatiziraj negotiation z negotiation-auto-responder in realtime-negotiation-bot — +50% close rate.',
    expectedDailyProfitUplift: round2(clampNum(
      current.currentDailyProfit * 0.4,
      UPLIFT_MIN, UPLIFT_MAX, 12,
    )),
    priority: 'MEDIUM',
  });

  out.push({
    phase: 'LONG_TERM',
    action: 'Ekspanzija na 5+ platform (mobile.de, Kleinanzeigen, Subito, Willhaben) z multi-language listings.',
    expectedDailyProfitUplift: round2(clampNum(
      current.currentDailyProfit * 0.8,
      UPLIFT_MIN, UPLIFT_MAX, 20,
    )),
    priority: 'MEDIUM',
  });
  out.push({
    phase: 'LONG_TERM',
    action: 'Niche vertical expansion (auto parts + fashion + electronics + home goods) z 4 specialized pipeline.',
    expectedDailyProfitUplift: round2(clampNum(
      current.currentDailyProfit * 0.6,
      UPLIFT_MIN, UPLIFT_MAX, 18,
    )),
    priority: 'LOW',
  });

  return out.slice(0, MAX_ACTIONS);
}

function decideScalingGrade(multiplier: number): ScalingGrade {
  if (multiplier >= 5.0) return 'A+';
  if (multiplier >= 3.5) return 'A';
  if (multiplier >= 2.5) return 'B';
  if (multiplier >= 1.8) return 'C';
  if (multiplier >= 1.2) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentState,
): ProfitPerDayScalingMaximization {
  const scalingPath = buildScalingPath(current);
  const scalingBottlenecks = buildScalingBottlenecks(current, scalingPath);
  const scalingActions = buildScalingActions(current, scalingPath);

  const longTerm = scalingPath.find((p) => p.phase === 'LONG_TERM');
  const maximizedDailyProfit = round2(clampNum(
    longTerm?.targetDailyProfit ?? current.currentDailyProfit * 8,
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, current.currentDailyProfit,
  ));

  const scalingMultiplier = round2(clampNum(
    current.currentDailyProfit > 0
      ? maximizedDailyProfit / current.currentDailyProfit
      : 1.0,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 1.0,
  ));

  const scalingGrade = decideScalingGrade(scalingMultiplier);

  const capitalScalingRequirement = round0(clampNum(
    Math.max(0, (longTerm?.requiredCapital ?? 0) - current.capitalDeployed),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  const timeToTargetScale = round0(clampNum(
    730,
    TIMELINE_MIN, TIMELINE_MAX, 730,
  ));

  return {
    scalingPath,
    scalingBottlenecks,
    scalingActions,
    maximizedDailyProfit,
    scalingMultiplier,
    scalingGrade,
    capitalScalingRequirement,
    timeToTargetScale,
  };
}

function buildSummary(
  current: CurrentState,
  max: ProfitPerDayScalingMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.currentDailyProfit.toFixed(2)}€/dan (${current.soldCount12m} SOLD 12m, ${current.currentTradeFrequencyPerWeek.toFixed(1)}/teden, ${current.avgProfitPerTrade.toFixed(2)}€/trade, ${current.capitalDeployed}€ deployed).`,
    `Maximized: ${max.maximizedDailyProfit.toFixed(2)}€/dan (multiplier ${max.scalingMultiplier.toFixed(2)}×, grade ${max.scalingGrade}).`,
    `Capital requirement: +${max.capitalScalingRequirement}€, time-to-scale ${max.timeToTargetScale} dni.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitPerDayScalingMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitPerDayScalingMaximizerHandler = withAiRoute<ProfitPerDayScalingMaximizerInput>({
  endpoint: '/api/ai/profit-per-day-scaling-maximizer',
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
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD and no HELD trades
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentDailyProfit: 0,
          currentTradeFrequencyPerWeek: 0,
          avgProfitPerTrade: 0,
          capitalDeployed: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          heldCount: 0,
          avgHoldDays: 0,
          annualizedProfit: 0,
        },
        maximization: {
          scalingPath: [],
          scalingBottlenecks: [],
          scalingActions: [],
          maximizedDailyProfit: 0,
          scalingMultiplier: 1.0,
          scalingGrade: 'F',
          capitalScalingRequirement: 0,
          timeToTargetScale: 0,
        },
        summary: 'Ni SOLD in HELD trgovin — Profit Per Day Scaling Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Profit Per Day Scaling Maximizer ni mogoč.',
      } satisfies ProfitPerDayScalingResponse);
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

    // If no SOLD trades, can't compute daily profit
    if (soldComputed.length === 0) {
      const heldCap = heldComputed.reduce((s, h) => s + h.capital, 0);
      return apiOk({
        ok: true,
        current: {
          currentDailyProfit: 0,
          currentTradeFrequencyPerWeek: 0,
          avgProfitPerTrade: 0,
          capitalDeployed: heldCap,
          totalProfit12m: 0,
          soldCount12m: 0,
          heldCount: heldComputed.length,
          avgHoldDays: 0,
          annualizedProfit: 0,
        },
        maximization: {
          scalingPath: [],
          scalingBottlenecks: [],
          scalingActions: [],
          maximizedDailyProfit: 0,
          scalingMultiplier: 1.0,
          scalingGrade: 'F',
          capitalScalingRequirement: 0,
          timeToTargetScale: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Day Scaling Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Day Scaling Maximizer ni mogoč.',
      } satisfies ProfitPerDayScalingResponse);
    }

    const current = computeCurrent(soldComputed, heldComputed);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-per-day-scaling-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ProfitPerDayScalingMaximization;
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
      } satisfies ProfitPerDayScalingResponse);
    }

    // 5) AI prompt with grounding
    const soldSampleForAI = soldComputed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        cap: t.capital,
        profit: t.profit,
        holdDays: t.holdDays,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      heldCount: heldComputed.length,
      current,
      deterministicMaximization: {
        scalingPath: maximization.scalingPath,
        scalingBottlenecks: maximization.scalingBottlenecks,
        scalingActions: maximization.scalingActions,
        maximizedDailyProfit: maximization.maximizedDailyProfit,
        scalingMultiplier: maximization.scalingMultiplier,
        scalingGrade: maximization.scalingGrade,
        capitalScalingRequirement: maximization.capitalScalingRequirement,
        timeToTargetScale: maximization.timeToTargetScale,
      },
      soldSample: soldSampleForAI,
      caps: {
        dailyProfitMin: DAILY_PROFIT_MIN, dailyProfitMax: DAILY_PROFIT_MAX,
        tradesPerDayMin: TRADES_PER_DAY_MIN, tradesPerDayMax: TRADES_PER_DAY_MAX,
        tradesPerWeekMin: TRADES_PER_WEEK_MIN, tradesPerWeekMax: TRADES_PER_WEEK_MAX,
        profitPerTradeMin: PROFIT_PER_TRADE_MIN, profitPerTradeMax: PROFIT_PER_TRADE_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        multiplierMin: MULTIPLIER_MIN, multiplierMax: MULTIPLIER_MAX,
        feasibilityMin: FEASIBILITY_MIN, feasibilityMax: FEASIBILITY_MAX,
        impactMin: IMPACT_MIN, impactMax: IMPACT_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        timelineMin: TIMELINE_MIN, timelineMax: TIMELINE_MAX,
      },
    };

    const prompt = `Si AI "Profit Per Day Scaling Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za DAILY PROFIT SCALING MAXIMIZATION — kako NE SAMO optimizirati trenutni daily profit ampak ga SKALIRATI GOR z istčasnim povečevanjem trade frequency, capital deployment in profit per trade. Tvoj cilj je "Tvoj daily profit je 45€. Za 150€/dan rabiš: 2× več trade-ov, 1.3× višji profit per trade in 1.5× več kapitala." Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per euro deployed — capital efficiency ratio) — ti MAKSIMIZIRAŠ in SKALIRAŠ DAILY PROFIT (€/dan absolutno, ne ratio). Razlika od revenue-per-trade-maximizer (v8.06 ki maksimizira top-line sell price per trade) — ta maksimizira DAILY PROFIT SKALIRAN (frekvencija × profit per trade × capital). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira cash flow per source) — ta maksimizira in skalira DAILY PROFIT čez celoten portfolio z scalingPath (IMMEDIATE/SHORT_TERM/MEDIUM_TERM/LONG_TERM phases). Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ta maksimizira DAILY PROFIT €/dan absolutno. Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira return OF capital) — ta maksimizira in skalira DAILY PROFIT (return ON capital scaled). Razlika od profit-scale-engine (v7.96 ki skalira profit z growth engine) — ta maksimizira DAILY PROFIT z scalingPath phases in scalingBottlenecks. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ta maksimizira in SKALIRA daily profit z requiredTradesPerDay, requiredProfitPerTrade, requiredCapital, timeline, feasibility per phase.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD trgovine):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.scalingPath: 4 elementi { phase: IMMEDIATE | SHORT_TERM | MEDIUM_TERM | LONG_TERM, targetDailyProfit €/dan [0, 10000] (IMMEDIATE = current × 1.5, SHORT_TERM = current × 3, MEDIUM_TERM = current × 5, LONG_TERM = current × 8 — anti-hallucination), requiredTradesPerDay trades/day [0, 100] (= targetDailyProfit / requiredProfitPerTrade), requiredProfitPerTrade € [-5000, 50000] (IMMEDIATE = current, SHORT_TERM = current × 1.1, MEDIUM_TERM = current × 1.2, LONG_TERM = current × 1.3), requiredCapital € [0, 1000000] (= targetDailyProfit × avgHoldDays × 1.2), timeline (slovenski, max 200 — IMMEDIATE 0-30 dni, SHORT_TERM 1-3 meseci, MEDIUM_TERM 3-9 mesecev, LONG_TERM 9-24 mesecev), feasibility [0, 100] (IMMEDIATE 85, SHORT_TERM 70, MEDIUM_TERM 55, LONG_TERM 40) },
2. maximization.scalingBottlenecks: 4-6 elementov { phase, bottleneck (slovenski, max 200 — kaj limitira scaling at this phase), impact [0, 100], mitigation (slovenski, max 200 — kako razrešiti bottleneck) },
3. maximization.scalingActions: 6-8 elementov { phase, action (slovenski, max 200 — specifična akcija za ta phase), expectedDailyProfitUplift €/dan [0, 10000], priority HIGH/MEDIUM/LOW },
4. maximization.maximizedDailyProfit €/dan [0, 10000] (= LONG_TERM targetDailyProfit, ≥ current.currentDailyProfit),
5. maximization.scalingMultiplier ratio [1.0, 10.0] (= maximizedDailyProfit / current.currentDailyProfit),
6. maximization.scalingGrade: A+ | A | B | C | D | F (A+ če multiplier ≥ 5.0, A ≥ 3.5, B ≥ 2.5, C ≥ 1.8, D ≥ 1.2, else F),
7. maximization.capitalScalingRequirement € [0, 1000000] (= LONG_TERM requiredCapital − current.capitalDeployed),
8. maximization.timeToTargetScale days [1, 1095] (dni do maximized daily profit — 730 default),
9. summary: slovenski povzetek (max 500 znakov — poudari current daily profit, maximized daily profit, multiplier, grade, capital requirement, time-to-scale).

VRNI LE JSON:
{
  "maximization": {
    "scalingPath": [
      { "phase": "IMMEDIATE", "targetDailyProfit": 67.5, "requiredTradesPerDay": 0.5, "requiredProfitPerTrade": 135, "requiredCapital": 2430, "timeline": "0-30 dni — quick wins", "feasibility": 85 },
      { "phase": "SHORT_TERM", "targetDailyProfit": 135, "requiredTradesPerDay": 0.9, "requiredProfitPerTrade": 150, "requiredCapital": 5400, "timeline": "1-3 meseci", "feasibility": 70 },
      { "phase": "MEDIUM_TERM", "targetDailyProfit": 225, "requiredTradesPerDay": 1.4, "requiredProfitPerTrade": 161, "requiredCapital": 9000, "timeline": "3-9 mesecev", "feasibility": 55 },
      { "phase": "LONG_TERM", "targetDailyProfit": 360, "requiredTradesPerDay": 2.1, "requiredProfitPerTrade": 171, "requiredCapital": 14400, "timeline": "9-24 mesecev", "feasibility": 40 }
    ],
    "scalingBottlenecks": [
      { "phase": "IMMEDIATE", "bottleneck": "Nizka trade frekvencna", "impact": 70, "mitigation": "Vklopi več monitorjev." },
      { "phase": "SHORT_TERM", "bottleneck": "Capital shortfall", "impact": 65, "mitigation": "Reinvest 80% profit." },
      { "phase": "MEDIUM_TERM", "bottleneck": "Operativna kapaciteta", "impact": 60, "mitigation": "Avtomatiziraj listings." },
      { "phase": "LONG_TERM", "bottleneck": "Market saturation", "impact": 75, "mitigation": "Ekspanzija 5+ platform." }
    ],
    "scalingActions": [
      { "phase": "IMMEDIATE", "action": "Dvigni deal score alert threshold.", "expectedDailyProfitUplift": 5, "priority": "HIGH" },
      { "phase": "SHORT_TERM", "action": "Reinvest 60% profit v sourcing.", "expectedDailyProfitUplift": 15, "priority": "HIGH" },
      { "phase": "MEDIUM_TERM", "action": "Multi-platform listings.", "expectedDailyProfitUplift": 22, "priority": "MEDIUM" },
      { "phase": "LONG_TERM", "action": "5+ platform ekspanzija.", "expectedDailyProfitUplift": 36, "priority": "MEDIUM" }
    ],
    "maximizedDailyProfit": 360,
    "scalingMultiplier": 8.0,
    "scalingGrade": "A+",
    "capitalScalingRequirement": 12000,
    "timeToTargetScale": 730
  },
  "summary": "Current: 45.00€/dan (50 SOLD 12m, 1.0/teden, 90€/trade, 2400€ deployed). Maximized: 360.00€/dan (multiplier 8.00×, grade A+). Capital requirement: +12000€, time-to-scale 730 dni."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override scalingPath — must be 4 entries with all 4 phases
        if (Array.isArray(aiMax.scalingPath) && aiMax.scalingPath.length >= 4) {
          const aiPath: ScalingPathEntry[] = [];
          const seen = new Set<ScalingPhase>();
          for (const p of aiMax.scalingPath.slice(0, MAX_PHASES)) {
            if (!p || typeof p !== 'object') continue;
            const phase = clampEnum(p.phase, VALID_PHASE, 'IMMEDIATE');
            if (seen.has(phase)) continue;
            seen.add(phase);
            const mult = PHASE_MULTIPLIER[phase];
            const minTarget = current.currentDailyProfit * mult * 0.9;
            const maxTarget = current.currentDailyProfit * mult * 1.1;
            const targetDailyProfit = round2(clampNum(
              p.targetDailyProfit,
              Math.max(DAILY_PROFIT_MIN, minTarget),
              Math.min(DAILY_PROFIT_MAX, Math.max(maxTarget, minTarget + 1)),
              current.currentDailyProfit * mult,
            ));
            const profitPerTradeFactor = phase === 'IMMEDIATE' ? 1.0
              : phase === 'SHORT_TERM' ? 1.1
              : phase === 'MEDIUM_TERM' ? 1.2
              : 1.3;
            const requiredProfitPerTrade = round2(clampNum(
              p.requiredProfitPerTrade,
              PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX,
              current.avgProfitPerTrade * profitPerTradeFactor,
            ));
            const requiredTradesPerDay = round2(clampNum(
              p.requiredTradesPerDay,
              TRADES_PER_DAY_MIN, TRADES_PER_DAY_MAX,
              requiredProfitPerTrade > 0 ? targetDailyProfit / requiredProfitPerTrade : 0,
            ));
            const requiredCapital = round0(clampNum(
              p.requiredCapital,
              CAPITAL_MIN, CAPITAL_MAX,
              current.avgHoldDays > 0 ? targetDailyProfit * current.avgHoldDays * 1.2 : targetDailyProfit * 30,
            ));
            const feasibility = round0(clampNum(
              p.feasibility,
              FEASIBILITY_MIN, FEASIBILITY_MAX,
              PHASE_FEASIBILITY[phase],
            ));
            const timeline = clampString(p.timeline, 200, PHASE_TIMELINE[phase]);
            aiPath.push({
              phase,
              targetDailyProfit,
              requiredTradesPerDay,
              requiredProfitPerTrade,
              requiredCapital,
              timeline,
              feasibility,
            });
          }
          if (aiPath.length === 4) {
            maximization = { ...maximization, scalingPath: aiPath };
          }
        }

        // Override scalingBottlenecks
        if (Array.isArray(aiMax.scalingBottlenecks) &&
            aiMax.scalingBottlenecks.length >= 4) {
          const aiBn: ScalingBottleneck[] = [];
          for (const b of aiMax.scalingBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            if (!b || typeof b !== 'object') continue;
            aiBn.push({
              phase: clampEnum(b.phase, VALID_PHASE, 'IMMEDIATE'),
              bottleneck: clampString(b.bottleneck, 200, 'Scaling bottleneck neidentificiran.'),
              impact: round0(clampNum(b.impact, IMPACT_MIN, IMPACT_MAX, 50)),
              mitigation: clampString(b.mitigation, 200, 'Mitigacija ni na voljo.'),
            });
          }
          if (aiBn.length >= 4) {
            maximization = { ...maximization, scalingBottlenecks: aiBn };
          }
        }

        // Override scalingActions
        if (Array.isArray(aiMax.scalingActions) &&
            aiMax.scalingActions.length >= 4) {
          const aiAct: ScalingAction[] = [];
          for (const a of aiMax.scalingActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            aiAct.push({
              phase: clampEnum(a.phase, VALID_PHASE, 'IMMEDIATE'),
              action: clampString(a.action, 200, 'Akcija za scaling.'),
              expectedDailyProfitUplift: round2(clampNum(
                a.expectedDailyProfitUplift,
                UPLIFT_MIN, UPLIFT_MAX, 5,
              )),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
            });
          }
          if (aiAct.length >= 4) {
            maximization = { ...maximization, scalingActions: aiAct };
          }
        }

        // Override maximizedDailyProfit — anti-hallucination bounds
        if (aiMax.maximizedDailyProfit !== undefined) {
          const minBound = current.currentDailyProfit * 5.0; // LONG_TERM phase minimum
          const maxBound = Math.max(
            minBound + 1,
            Math.min(DAILY_PROFIT_MAX, current.currentDailyProfit * 10.0),
          );
          const maximizedDailyProfit = round2(clampNum(
            aiMax.maximizedDailyProfit,
            Math.max(DAILY_PROFIT_MIN, minBound),
            maxBound,
            maximization.maximizedDailyProfit,
          ));
          maximization = { ...maximization, maximizedDailyProfit };
        }

        // Override scalingMultiplier — recompute from maximized / current
        const scalingMultiplier = round2(clampNum(
          current.currentDailyProfit > 0
            ? maximization.maximizedDailyProfit / current.currentDailyProfit
            : 1.0,
          MULTIPLIER_MIN, MULTIPLIER_MAX, maximization.scalingMultiplier,
        ));
        maximization = { ...maximization, scalingMultiplier };

        // Override scalingGrade
        if (aiMax.scalingGrade) {
          maximization = {
            ...maximization,
            scalingGrade: clampEnum(
              aiMax.scalingGrade,
              VALID_GRADE,
              decideScalingGrade(scalingMultiplier),
            ),
          };
        } else {
          maximization = {
            ...maximization,
            scalingGrade: decideScalingGrade(scalingMultiplier),
          };
        }

        // Override capitalScalingRequirement
        if (aiMax.capitalScalingRequirement !== undefined) {
          const longTermCap = maximization.scalingPath.find(
            (p) => p.phase === 'LONG_TERM',
          )?.requiredCapital ?? 0;
          const capitalScalingRequirement = round0(clampNum(
            aiMax.capitalScalingRequirement,
            CAPITAL_MIN, CAPITAL_MAX,
            Math.max(0, longTermCap - current.capitalDeployed),
          ));
          maximization = { ...maximization, capitalScalingRequirement };
        }

        // Override timeToTargetScale
        if (aiMax.timeToTargetScale !== undefined) {
          maximization = {
            ...maximization,
            timeToTargetScale: round0(clampNum(
              aiMax.timeToTargetScale,
              TIMELINE_MIN, TIMELINE_MAX, 730,
            )),
          };
        }

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-per-day-scaling-maximizer',
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
    } satisfies ProfitPerDayScalingResponse);
  },
});

export const GET = profitPerDayScalingMaximizerHandler;
export const POST = profitPerDayScalingMaximizerHandler;
