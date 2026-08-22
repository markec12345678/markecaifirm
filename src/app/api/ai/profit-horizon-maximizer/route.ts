// v8.03 / v8.96.7-batch4: AI Profit Horizon Maximizer — AI identificira MAXIMUM profit
// achievable over different time horizons (7/30/90/365 days) in kaj je
// potrebnega za dosego vsakega. NE scale-a kot profit-scale-engine (v8.02 ki
// načrtuje 12-mesečni phased plan z bottlenecks) — ta daje HORIZON MAXIMIZATION:
// "In 7 days you can make 500€, in 30 days 2000€, in 90 days 8000€ — here's
// what each requires." Fokus na MAX profit PER HORIZON + requirements +
// feasibility + bestHorizon (profit/time ratio) + profitAccelerationActions
// (kako doseči longer horizons FASTER) + horizonBottlenecks (kaj omejuje
// vsak horizon) + cumulativeProjection (month-by-month 12m).
//
// Razlika od profit-scale-engine (v8.02 ki SCALE-A cel business z phased plan)
// — ta MAXIMIZIRA PROFIT PER HORIZON z bestHorizon + acceleration actions.
// Razlika od revenue-growth-maximizer (v8.01 ki maksimizira REVENUE growth)
// — ta maksimizira PROFIT (bottom-line) per horizon z requirements matrix.
// Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily
// profit) — ta daje MULTI-HORIZON view (7d/30d/90d/365d) z bestHorizon
// profit/time ratio. Razlika od profit-multiplier-engine (v8.00 ki multiplicira
// profit z 8 levers) — ta fokusira na HORIZON MAXIMIZATION z feasibility
// (EASY/MODERATE/HARD/AMBITIOUS). Razlika od capital-growth-maximizer (v7.99
// ki maksimizira compounding capital growth) — ta daje HORIZON-BASED profit
// plan z cumulative 12-month projection. Razlika od profit-velocity-maximizer
// (v7.98 ki maksimizira €/day velocity) — ta daje 4 HORIZONS z requirements
// in bottlenecks per horizon.
//
// "Current: 65€/dan profit rate, 8500€ deployed capital, 18 items inventory.
// Horizons: 7d → 500€ max (EASY, requires: inventory 18 items, capital 8500€,
// 3 trades, ROI 35%). 30d → 2000€ max (MODERATE, requires: inventory 25 items,
// capital 11000€, 12 trades, ROI 38%). 90d → 8000€ max (HARD, requires:
// inventory 35 items, capital 18000€, 40 trades, ROI 42%). 365d → 35000€ max
// (AMBITIOUS, requires: inventory 60 items, capital 35000€, 180 trades, ROI
// 45%). Best horizon: 90d (8000€ / 90d = 88.9€/dan ratio — best profit/time).
// Acceleration: 90d achievable in 60d z automation + VA. Bottlenecks: 7d
// (limited inventory), 30d (capital gap), 90d (sourcing capacity), 365d
// (market depth). Cumulative 12m: M1 800, M2 950, M3 1200, ..., M12 4500."

// GET+POST /api/ai/profit-horizon-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type Period = '7d' | '30d' | '90d' | '365d';
type Feasibility = 'EASY' | 'MODERATE' | 'HARD' | 'AMBITIOUS';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string | null;
}

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
}

interface CurrentState {
  currentDailyProfitRate: number; // €/day
  currentMonthlyProfit: number;
  currentInventoryValue: number;
  currentCapitalDeployed: number;
  avgROI: number;
  avgHoldDays: number;
}

interface HorizonRequirements {
  inventoryNeeded: number;
  capitalNeeded: number;
  tradesNeeded: number;
  avgROI: number;
}

interface Horizon {
  period: Period;
  maxAchievableProfit: number;
  requirements: HorizonRequirements;
  actions: string[];
  feasibility: Feasibility;
  confidenceLevel: number; // 0-100
}

interface CumulativePoint {
  month: number; // 1-12
  projectedProfit: number;
  cumulativeProfit: number;
}

interface HorizonMaximization {
  horizons: Horizon[];
  bestHorizon: Period;
  profitAccelerationActions: string[];
  horizonBottlenecks: Array<{
    period: Period;
    bottleneck: string;
    mitigation: string;
  }>;
  cumulativeProjection: CumulativePoint[];
}

interface ProfitHorizonResponse {
  ok: true;
  current: CurrentState;
  maximization: HorizonMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  horizons?: Array<{
    period?: Period;
    maxAchievableProfit?: number;
    requirements?: {
      inventoryNeeded?: number;
      capitalNeeded?: number;
      tradesNeeded?: number;
      avgROI?: number;
    };
    actions?: string[];
    feasibility?: Feasibility;
    confidenceLevel?: number;
  }>;
  bestHorizon?: Period;
  profitAccelerationActions?: string[];
  horizonBottlenecks?: Array<{
    period?: Period;
    bottleneck?: string;
    mitigation?: string;
  }>;
  cumulativeProjection?: Array<{
    month?: number;
    projectedProfit?: number;
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 200_000; // ceiling per horizon
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const INVENTORY_MIN = 0;
const INVENTORY_MAX = 10_000;
const TRADES_MIN = 0;
const TRADES_MAX = 5_000;
const ROI_MIN = -50;
const ROI_MAX = 500;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;

const VALID_PERIOD: readonly Period[] = ['7d', '30d', '90d', '365d'];
const VALID_FEASIBILITY: readonly Feasibility[] = [
  'EASY',
  'MODERATE',
  'HARD',
  'AMBITIOUS',
];

const MAX_ACTIONS_PER_HORIZON = 6;
const MAX_BOTTLENECKS = 8;
const MAX_ACCELERATION_ACTIONS = 8;
const MAX_HELD_FOR_CAPACITY = 500;

// Horizon day constants
const DAYS_7 = 7;
const DAYS_30 = 30;
const DAYS_90 = 90;
const DAYS_365 = 365;

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
  roi: number;
  holdDays: number;
  sellMs: number;
  within12m: boolean;
  sellMonth: string;
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
  const sellMonth = new Date(sellMs).toISOString().slice(0, 7);
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { profit, cost, roi, holdDays, sellMs, within12m, sellMonth };
}

interface SoldAgg {
  profit12m: number;
  count12m: number;
  totalCost12m: number;
  totalROI: number;
  totalHoldDays: number;
  perMonth: Map<string, number>;
}

function aggregateSold(trades: SoldComputed[]): SoldAgg {
  let profit12m = 0;
  let count12m = 0;
  let totalCost12m = 0;
  let totalROI = 0;
  let totalHoldDays = 0;
  const perMonth = new Map<string, number>();
  for (const t of trades) {
    if (t.within12m) {
      profit12m += t.profit;
      count12m += 1;
      totalCost12m += t.cost;
      totalROI += t.roi;
      totalHoldDays += t.holdDays;
      perMonth.set(t.sellMonth, (perMonth.get(t.sellMonth) ?? 0) + t.profit);
    }
  }
  return {
    profit12m,
    count12m,
    totalCost12m,
    totalROI,
    totalHoldDays,
    perMonth,
  };
}

function computeCurrent(
  agg: SoldAgg,
  held: HeldTradeRow[],
): CurrentState {
  const avgROI = round2(clampNum(
    agg.count12m > 0 ? agg.totalROI / agg.count12m : 0,
    ROI_MIN, ROI_MAX, 0,
  ));
  const avgHoldDays = round0(clampNum(
    agg.count12m > 0 ? agg.totalHoldDays / agg.count12m : 0,
    0, 730, 0,
  ));
  const currentMonthlyProfit = round0(clampNum(
    agg.count12m > 0 ? agg.profit12m / 12 : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const currentDailyProfitRate = round2(clampNum(
    currentMonthlyProfit / 30,
    0, PROFIT_MAX, 0,
  ));

  // Capital deployed = sum of held item cost (proxy for working capital)
  let heldCapital = 0;
  for (const h of held) {
    heldCapital += (h.buyPrice ?? 0) + (h.buyFees ?? 0);
  }
  const currentCapitalDeployed = round0(clampNum(
    heldCapital,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  // Inventory value proxy = heldCapital × (1 + avgROI/100)
  const currentInventoryValue = round0(clampNum(
    heldCapital * (1 + avgROI / 100),
    0, CAPITAL_MAX, 0,
  ));

  return {
    currentDailyProfitRate,
    currentMonthlyProfit,
    currentInventoryValue,
    currentCapitalDeployed,
    avgROI,
    avgHoldDays,
  };
}

function buildHorizon(
  period: Period,
  days: number,
  current: CurrentState,
): Horizon {
  // Max achievable profit = current daily rate × days × feasibility multiplier
  // Multipliers (anti-hallucination, conservative):
  // 7d → 1.0x (no scaling, current rate)
  // 30d → 1.2x (slight scaling)
  // 90d → 1.6x (scaling + margin optimization)
  // 365d → 2.5x (full scaling + compounding)
  const multByDays: Record<number, number> = {
    7: 1.0,
    30: 1.2,
    90: 1.6,
    365: 2.5,
  };
  const mult = multByDays[days] ?? 1.0;
  const baseProfit = current.currentDailyProfitRate * days;
  const maxAchievableProfit = round0(clampNum(
    Math.max(0, baseProfit * mult),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Feasibility by horizon
  const feasibilityByDays: Record<number, Feasibility> = {
    7: 'EASY',
    30: 'MODERATE',
    90: 'HARD',
    365: 'AMBITIOUS',
  };
  const feasibility = feasibilityByDays[days] ?? 'MODERATE';

  // Requirements scale with horizon
  // Inventory needed: starts at current held-based size, scales with sqrt(days)
  // tradesNeeded = days / avgHoldDays (capital velocity)
  // capitalNeeded = (tradesNeeded × avgProfitPerTrade × cost/profit ratio)
  // avgROI grows slightly with horizon (optimization kicks in)
  const heldCountProxy = current.currentCapitalDeployed > 0
    ? Math.max(1, Math.round(current.currentCapitalDeployed / Math.max(50, current.currentMonthlyProfit / 4 || 50)))
    : 1;
  const inventoryFactor = Math.sqrt(days / 7);
  const inventoryNeeded = round0(clampNum(
    Math.max(1, Math.round(heldCountProxy * inventoryFactor)),
    INVENTORY_MIN, INVENTORY_MAX, 1,
  ));
  const tradesNeeded = round0(clampNum(
    current.avgHoldDays > 0
      ? Math.max(1, Math.round(days / Math.max(1, current.avgHoldDays)))
      : Math.max(1, Math.round(days / 14)),
    TRADES_MIN, TRADES_MAX, 1,
  ));
  const avgProfitPerTrade = tradesNeeded > 0
    ? maxAchievableProfit / tradesNeeded
    : 0;
  // Capital needed: avg cost per trade × tradesNeeded × turnover factor (trades overlap inventory)
  const turnoverFactor = 0.4; // 40% of trades concurrent (typical flipping)
  const costRatio = current.avgROI > 0 ? 100 / current.avgROI : 3;
  const capitalNeeded = round0(clampNum(
    Math.max(
      current.currentCapitalDeployed,
      avgProfitPerTrade * costRatio * tradesNeeded * turnoverFactor,
    ),
    CAPITAL_MIN, CAPITAL_MAX, current.currentCapitalDeployed,
  ));
  const horizonROI = round2(clampNum(
    current.avgROI * (1 + (days - 7) / 365 * 0.2),
    ROI_MIN, ROI_MAX, current.avgROI,
  ));

  // Actions per horizon
  const actions: string[] = [];
  if (days === 7) {
    actions.push(
      `Realiziraj ${tradesNeeded} hitre trade-e (avg ${round0(avgProfitPerTrade)}€/trade) iz obstoječega inventarja.`,
      `Cross-post 5 listing-ov na 3 platforme za hitrejši turnover.`,
      ' Aktivno odgovarjaj na buyer messages v 2h (Bolha/Vinted).',
      `Optimiziraj cene: -5% za items starejše od 30 dni za hitro sprostitev.`,
    );
  } else if (days === 30) {
    actions.push(
      `Povečaj inventory iz ${heldCountProxy} na ${inventoryNeeded} items z dodatnim sourcingom.`,
      `Dosegi ${tradesNeeded} trade-ov z ${round0(avgProfitPerTrade)}€/trade povprečjem.`,
      `Razširi iskalne kriterije na 3 monitors za večji deal pool.`,
      'Reinvestiraj 80% profita za compounding v 30d oknu.',
      'Avtomatiziraj listing creation (batch 5 listing-ov/dan).',
    );
  } else if (days === 90) {
    actions.push(
      `Scale inventar na ${inventoryNeeded} items z ${round0(capitalNeeded - current.currentCapitalDeployed)}€ dodatnega kapitala.`,
      `Dosegi ${tradesNeeded} trade-ov v 90d (avg ${round0(avgProfitPerTrade)}€/trade).`,
      'Razširi na 2 nova source-a (mobile.de + Vinted) za diversifikacijo.',
      'Onboard VA za customer service (sprosti 8h/teden).',
      'Dvigni avg margin za 20% z premium pricing + refurb enhancement.',
      'Avtomatiziraj monitor alert-e za 24/7 deal detection.',
    );
  } else {
    actions.push(
      `Postavi ${inventoryNeeded} items inventory z ${round0(capitalNeeded)}€ capital deployed.`,
      `Dosegi ${tradesNeeded} trade-ov v 365d z avg ROI ${horizonROI}%.`,
      'Setup batch operations: weekly sourcing, daily listing, daily shipping.',
      'Hire part-time logistics assistant za 20h/teden.',
      'Premium pricing strategy z 1.5x margin scaling.',
      'Reinvestiraj 80% profita + injektiraj dodatni kapital po potrebi.',
      'Postavi infrastrukturo: VA team (2 VA) + automation tools.',
    );
  }

  // Confidence: shorter horizons have higher confidence (less uncertainty)
  const confidenceByDays: Record<number, number> = {
    7: 88,
    30: 78,
    90: 68,
    365: 55,
  };
  // Adjust by data availability
  const baseConfidence = confidenceByDays[days] ?? 60;
  const confidenceAdj = current.currentMonthlyProfit > 0 ? 0 : -15;
  const confidenceLevel = round0(clampNum(
    baseConfidence + confidenceAdj,
    CONFIDENCE_MIN, CONFIDENCE_MAX, baseConfidence,
  ));

  return {
    period,
    maxAchievableProfit,
    requirements: {
      inventoryNeeded,
      capitalNeeded,
      tradesNeeded,
      avgROI: horizonROI,
    },
    actions: actions.slice(0, MAX_ACTIONS_PER_HORIZON),
    feasibility,
    confidenceLevel,
  };
}

function buildHorizons(current: CurrentState): Horizon[] {
  return [
    buildHorizon('7d', DAYS_7, current),
    buildHorizon('30d', DAYS_30, current),
    buildHorizon('90d', DAYS_90, current),
    buildHorizon('365d', DAYS_365, current),
  ];
}

function decideBestHorizon(horizons: Horizon[]): Period {
  // bestHorizon = best profit/time ratio (€/day)
  let best: Period = '30d';
  let bestRatio = 0;
  const dayMap: Record<Period, number> = {
    '7d': DAYS_7,
    '30d': DAYS_30,
    '90d': DAYS_90,
    '365d': DAYS_365,
  };
  for (const h of horizons) {
    const days = dayMap[h.period];
    const ratio = h.maxAchievableProfit / days;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = h.period;
    }
  }
  return best;
}

function buildBottlenecks(
  horizons: Horizon[],
  current: CurrentState,
): Array<{ period: Period; bottleneck: string; mitigation: string }> {
  const out: Array<{ period: Period; bottleneck: string; mitigation: string }> = [];
  const dayMap: Record<Period, number> = {
    '7d': DAYS_7,
    '30d': DAYS_30,
    '90d': DAYS_90,
    '365d': DAYS_365,
  };
  for (const h of horizons) {
    const days = dayMap[h.period];
    let bottleneck = '';
    let mitigation = '';
    if (days === 7) {
      bottleneck = 'Omejen inventory — samo obstoječi items so na voljo za prodajo.';
      mitigation = 'Prečisti inventory z avtomatskim -10% discount-om za items >30 dni, cross-post za hitro sprostitev.';
    } else if (days === 30) {
      const capitalGap = Math.max(0, h.requirements.capitalNeeded - current.currentCapitalDeployed);
      bottleneck = `Capital gap — potrebnih +${round0(capitalGap)}€ nad trenutnim ${current.currentCapitalDeployed}€.`;
      mitigation = 'Reinvestiraj 80% profita, razmisli o short-term financing (0% credit card 30d) ali partner capital.';
    } else if (days === 90) {
      bottleneck = `Sourcing capacity — potrebnih ${h.requirements.tradesNeeded} trade-ov z aktivnim sourcingom (need ${Math.round(h.requirements.tradesNeeded / 12)} trades/mo).`;
      mitigation = 'Avtomatiziraj monitor alert-e, dodaj 3 nove monitorje z širšimi kategorijami, batch sourcing ob vikendih.';
    } else {
      bottleneck = `Market depth — premium pricing z ROI ${h.requirements.avgROI}% zahteva dovolj buyer demand in infrastrukturo.`;
      mitigation = 'Razširi na 4+ platforme, hire VA team, postavi batch operations za sustainable scaling.';
    }
    out.push({
      period: h.period,
      bottleneck: clampString(bottleneck, 200, `${h.period} bottleneck.`),
      mitigation: clampString(mitigation, 200, `Mitigacija za ${h.period}.`),
    });
  }
  return out.slice(0, MAX_BOTTLENECKS);
}

function buildAccelerationActions(
  horizons: Horizon[],
  current: CurrentState,
): string[] {
  const actions: string[] = [];
  // 1) Inventory automation
  actions.push(
    'Avtomatiziraj monitor alert-e z real-time deal detection za 24/7 sourcing — zmanjša 90d horizon na 60d.',
  );
  // 2) VA onboarding
  actions.push(
    'Onboard VA za customer service in listing creation — sprosti 20h/teden operaterja za sourcing.',
  );
  // 3) Cross-platform expansion
  actions.push(
    'Razširi na 3+ platforme (Bolha + Vinted + mobile.de) za 2x večji buyer reach in hitrejši turnover.',
  );
  // 4) Capital reinjection
  const ninetyHorizon = horizons.find((h) => h.period === '90d');
  if (ninetyHorizon) {
    const capitalGap = Math.max(0, ninetyHorizon.requirements.capitalNeeded - current.currentCapitalDeployed);
    actions.push(
      `Injektiraj ${round0(capitalGap)}€ kapitala (reinvest + financing) za dosego 90d horizon v 60d.`,
    );
  }
  // 5) Pricing automation
  actions.push(
    'Avtomatiziraj pricing strategy: dynamic pricing glede na buy interest in days listed (auto-discount po 14d/30d).',
  );
  // 6) Batch sourcing
  actions.push(
    'Postavi batch sourcing ob vikendih (4h sourcing → 15-20 novih dealov/teden) za scalable inventory growth.',
  );
  // 7) Refurbishment pipeline
  actions.push(
    'Postavi refurbishment pipeline za high-margin enhancement (cleaning + photos + certifikati) → +20% ROI na premium itemih.',
  );
  // 8) Logistics outsource
  actions.push(
    'Outsource shipping na Packeta/DPD z batch pickup → zmanjša logistics bottleneck za 365d horizon.',
  );
  return actions.slice(0, MAX_ACCELERATION_ACTIONS);
}

function buildCumulativeProjection(
  horizons: Horizon[],
  current: CurrentState,
): CumulativePoint[] {
  // 12-month projection — compound monthly growth based on 365d horizon target
  const horizon365 = horizons.find((h) => h.period === '365d');
  const target365 = horizon365?.maxAchievableProfit ?? current.currentMonthlyProfit * 12 * 2.5;
  // Monthly growth rate needed to reach target365 from currentMonthlyProfit in 12 months
  const startMonthly = Math.max(50, current.currentMonthlyProfit);
  const targetMonthly = Math.max(startMonthly, target365 / 12);
  const monthlyGrowthRate = startMonthly > 0
    ? Math.pow(targetMonthly / startMonthly, 1 / 11) // 11 intervals for 12 months
    : 1.0;

  const out: CumulativePoint[] = [];
  let cumulative = 0;
  let monthProfit = startMonthly;
  for (let m = 1; m <= 12; m++) {
    monthProfit = m === 1 ? startMonthly : monthProfit * monthlyGrowthRate;
    const rounded = round0(clampNum(monthProfit, 0, PROFIT_MAX, 0));
    cumulative += rounded;
    out.push({
      month: m,
      projectedProfit: rounded,
      cumulativeProfit: round0(clampNum(cumulative, 0, PROFIT_MAX * 12, 0)),
    });
  }
  return out;
}

function buildDeterministicMaximization(current: CurrentState): HorizonMaximization {
  const horizons = buildHorizons(current);
  const bestHorizon = decideBestHorizon(horizons);
  const horizonBottlenecks = buildBottlenecks(horizons, current);
  const profitAccelerationActions = buildAccelerationActions(horizons, current);
  const cumulativeProjection = buildCumulativeProjection(horizons, current);

  return {
    horizons,
    bestHorizon,
    profitAccelerationActions,
    horizonBottlenecks,
    cumulativeProjection,
  };
}

function buildSummary(current: CurrentState, max: HorizonMaximization): string {
  const horizonStr = max.horizons
    .map((h) => `${h.period}=${h.maxAchievableProfit}€ (${h.feasibility})`)
    .join(', ');
  const total12m = max.cumulativeProjection[max.cumulativeProjection.length - 1]?.cumulativeProfit ?? 0;
  const parts: string[] = [
    `Current: ${current.currentDailyProfitRate}€/dan (${current.currentMonthlyProfit}€/mo), ${current.currentCapitalDeployed}€ deployed, ROI ${current.avgROI}%.`,
    `Horizons: ${horizonStr}.`,
    `Best horizon: ${max.bestHorizon} (best profit/time ratio).`,
    `12-month cumulative: ${total12m}€.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitHorizonMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitHorizonMaximizerHandler = withAiRoute<ProfitHorizonMaximizerInput>({
  endpoint: '/api/ai/profit-horizon-maximizer',
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

    // 1) Parallel query SOLD trades last 12m + HELD trades for inventory value
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
          category: true,
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
        },
        take: MAX_HELD_FOR_CAPACITY,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentDailyProfitRate: 0,
          currentMonthlyProfit: 0,
          currentInventoryValue: 0,
          currentCapitalDeployed: heldTrades.reduce((s, h) => s + (h.buyPrice ?? 0) + (h.buyFees ?? 0), 0),
          avgROI: 0,
          avgHoldDays: 0,
        },
        maximization: {
          horizons: [],
          bestHorizon: '30d',
          profitAccelerationActions: [],
          horizonBottlenecks: [],
          cumulativeProjection: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Horizon Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Horizon Maximizer ni mogoč.',
      } satisfies ProfitHorizonResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const agg = aggregateSold(soldComputed);
    const current = computeCurrent(agg, heldTrades);

    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-horizon-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: HorizonMaximization;
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
      } satisfies ProfitHorizonResponse);
    }

    // 4) AI prompt with grounding
    const promptData = {
      soldCount12m: agg.count12m,
      profit12m: round0(agg.profit12m),
      heldInventorySize: heldTrades.length,
      current,
      deterministicMaximization: {
        horizons: maximization.horizons.map((h) => ({
          period: h.period,
          maxAchievableProfit: h.maxAchievableProfit,
          requirements: h.requirements,
          feasibility: h.feasibility,
          confidenceLevel: h.confidenceLevel,
        })),
        bestHorizon: maximization.bestHorizon,
      },
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        inventoryMin: INVENTORY_MIN, inventoryMax: INVENTORY_MAX,
        tradesMin: TRADES_MIN, tradesMax: TRADES_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        confidenceMin: CONFIDENCE_MIN, confidenceMax: CONFIDENCE_MAX,
      },
    };

    const prompt = `Si AI "Profit Horizon Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za HORIZON MAXIMIZATION — identificiraš MAXIMUM profit achievable nad različnimi časovnimi horizonti (7/30/90/365 dni) in kaj je potrebnega za dosego vsakega. Tvoj cilj je "v 7 dneh lahko narediš 500€, v 30 dneh 2000€, v 90 dneh 8000€ — tukaj je kaj vsak zahteva". Razlika od profit-scale-engine (v8.02 ki SCALE-A cel business z 12-mesečnim phased plan) — ti MAXIMIZIRAŠ PROFIT PER HORIZON z bestHorizon (profit/time ratio) in acceleration actions (kako doseči longer horizons FASTER). Razlika od revenue-growth-maximizer (v8.01 ki maksimizira REVENUE growth) — ti maksimiziraš PROFIT (bottom-line) per horizon z requirements matrix. Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit) — ti daje MULTI-HORIZON view (7d/30d/90d/365d) z feasibility (EASY/MODERATE/HARD/AMBITIOUS). Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na HORIZON MAXIMIZATION z feasibility in bottlenecks per horizon. Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding capital growth) — ti daje HORIZON-BASED profit plan z cumulative 12-month projection. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti daje 4 HORIZONS z requirements in bottlenecks per horizon.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventarja):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. horizons: 4 elementi za 7d, 30d, 90d, 365d — za vsak:
   - period: '7d' | '30d' | '90d' | '365d' (MORA biti ena od 4 vrednosti),
   - maxAchievableProfit € [0, 200000] (MORA biti ≥ current.dailyRate × days × 1.0 — anti-hallucination, ≤ × 3.0),
   - requirements: { inventoryNeeded [1, 10000], capitalNeeded € [0, 1000000], tradesNeeded [1, 5000], avgROI % [-50, 500] },
   - actions: 3-6 stringov (max 200 vsak, slovenski — specifične akcije za dosego tega horizon-a),
   - feasibility: EASY | MODERATE | HARD | AMBITIOUS,
   - confidenceLevel [0, 100] (kako verjetno je dosego tega horizon-a).
2. bestHorizon: '7d' | '30d' | '90d' | '365d' (period z najboljšim profit/time ratio).
3. profitAccelerationActions: 4-8 stringov (max 200 vsak, slovenski — kako doseči longer horizons FASTER, npr. automation, VA, cross-platform, capital injection).
4. horizonBottlenecks: 4 elementi { period, bottleneck (max 200, slovenski), mitigation (max 200, slovenski) } — za vsak horizon.
5. cumulativeProjection: 12 elementov { month 1-12, projectedProfit € [0, 200000] } — month-by-month 12-month profit projection.
6. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "horizons": [
    { "period": "7d", "maxAchievableProfit": 500, "requirements": { "inventoryNeeded": 5, "capitalNeeded": 8500, "tradesNeeded": 2, "avgROI": 35 }, "actions": ["Realiziraj 2 hitri trade-a.", "Cross-post 5 listing-ov."], "feasibility": "EASY", "confidenceLevel": 88 }
  ],
  "bestHorizon": "90d",
  "profitAccelerationActions": ["Avtomatiziraj monitor alert-e.", "Onboard VA za customer service."],
  "horizonBottlenecks": [
    { "period": "7d", "bottleneck": "Omejen inventory.", "mitigation": "Cross-post in discount." }
  ],
  "cumulativeProjection": [
    { "month": 1, "projectedProfit": 800 }
  ],
  "summary": "Current: 65€/dan. Horizons: 7d=500€, 30d=2000€, 90d=8000€, 365d=35000€. Best: 90d."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const detHorizons = new Map<Period, Horizon>();
        for (const h of maximization.horizons) detHorizons.set(h.period, h);

        // Override horizons if AI provided ≥3
        if (Array.isArray(parsed.horizons) && parsed.horizons.length >= 3) {
          const aiHorizons: Horizon[] = [];
          for (const ah of parsed.horizons.slice(0, 4)) {
            if (!ah || typeof ah !== 'object') continue;
            const period = clampEnum(ah.period, VALID_PERIOD, '30d');
            const det = detHorizons.get(period);
            if (!det) continue;
            const dailyRate = current.currentDailyProfitRate;
            const dayMap: Record<Period, number> = {
              '7d': DAYS_7, '30d': DAYS_30, '90d': DAYS_90, '365d': DAYS_365,
            };
            const days = dayMap[period];
            const minProfit = round0(clampNum(
              dailyRate * days * 1.0,
              PROFIT_MIN, PROFIT_MAX, det.maxAchievableProfit,
            ));
            const maxProfitBound = round0(clampNum(
              Math.max(minProfit + 100, dailyRate * days * 3.0),
              PROFIT_MIN, PROFIT_MAX, det.maxAchievableProfit * 2,
            ));
            const maxAchievableProfit = round0(clampNum(
              ah.maxAchievableProfit,
              minProfit, maxProfitBound, det.maxAchievableProfit,
            ));

            const req = ah.requirements ?? {};
            const inventoryNeeded = round0(clampNum(
              req.inventoryNeeded,
              INVENTORY_MIN, INVENTORY_MAX, det.requirements.inventoryNeeded,
            ));
            const capitalNeeded = round0(clampNum(
              req.capitalNeeded,
              CAPITAL_MIN, CAPITAL_MAX, det.requirements.capitalNeeded,
            ));
            const tradesNeeded = round0(clampNum(
              req.tradesNeeded,
              TRADES_MIN, TRADES_MAX, det.requirements.tradesNeeded,
            ));
            const horizonROI = round2(clampNum(
              req.avgROI,
              ROI_MIN, ROI_MAX, det.requirements.avgROI,
            ));

            const actions = Array.isArray(ah.actions)
              ? ah.actions.slice(0, MAX_ACTIONS_PER_HORIZON).map((a) =>
                  clampString(a, 200, `Akcija za ${period}.`),
                ).filter((s) => s.length > 0)
              : det.actions;
            const finalActions = actions.length >= 3 ? actions : det.actions;

            const feasibility = clampEnum(
              ah.feasibility,
              VALID_FEASIBILITY,
              det.feasibility,
            );
            const confidenceLevel = round0(clampNum(
              ah.confidenceLevel,
              CONFIDENCE_MIN, CONFIDENCE_MAX, det.confidenceLevel,
            ));

            aiHorizons.push({
              period,
              maxAchievableProfit,
              requirements: {
                inventoryNeeded,
                capitalNeeded,
                tradesNeeded,
                avgROI: horizonROI,
              },
              actions: finalActions,
              feasibility,
              confidenceLevel,
            });
          }
          // Ensure all 4 periods present, fill missing with deterministic
          for (const p of VALID_PERIOD) {
            if (!aiHorizons.find((h) => h.period === p)) {
              const det = detHorizons.get(p);
              if (det) aiHorizons.push(det);
            }
          }
          // Sort by period order
          const orderMap: Record<Period, number> = {
            '7d': 0, '30d': 1, '90d': 2, '365d': 3,
          };
          aiHorizons.sort((a, b) => orderMap[a.period] - orderMap[b.period]);
          if (aiHorizons.length === 4) {
            maximization = { ...maximization, horizons: aiHorizons };
          }
        }

        // Override bestHorizon (recompute if AI provides valid)
        if (parsed.bestHorizon) {
          const aiBest = clampEnum(parsed.bestHorizon, VALID_PERIOD, maximization.bestHorizon);
          // Validate: AI's bestHorizon must be in horizons
          if (maximization.horizons.find((h) => h.period === aiBest)) {
            maximization = { ...maximization, bestHorizon: aiBest };
          }
        } else {
          // Recompute bestHorizon based on new horizons
          maximization = {
            ...maximization,
            bestHorizon: decideBestHorizon(maximization.horizons),
          };
        }

        // Override acceleration actions
        if (Array.isArray(parsed.profitAccelerationActions) &&
            parsed.profitAccelerationActions.length >= 3) {
          const aiActions = parsed.profitAccelerationActions
            .slice(0, MAX_ACCELERATION_ACTIONS)
            .map((a) => clampString(a, 200, 'Pospeši horizon.'))
            .filter((s) => s.length > 0);
          if (aiActions.length >= 3) {
            maximization = { ...maximization, profitAccelerationActions: aiActions };
          }
        }

        // Override bottlenecks if AI provided ≥3
        if (Array.isArray(parsed.horizonBottlenecks) &&
            parsed.horizonBottlenecks.length >= 3) {
          const aiBn: Array<{ period: Period; bottleneck: string; mitigation: string }> = [];
          for (const b of parsed.horizonBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            if (!b || typeof b !== 'object') continue;
            const period = clampEnum(b.period, VALID_PERIOD, '30d');
            aiBn.push({
              period,
              bottleneck: clampString(b.bottleneck, 200, `${period} bottleneck.`),
              mitigation: clampString(b.mitigation, 200, `Mitigacija za ${period}.`),
            });
          }
          if (aiBn.length >= 3) {
            maximization = { ...maximization, horizonBottlenecks: aiBn };
          }
        }

        // Override cumulative projection if AI provided 12 entries
        if (Array.isArray(parsed.cumulativeProjection) &&
            parsed.cumulativeProjection.length >= 6) {
          const aiProj: CumulativePoint[] = [];
          let cumulative = 0;
          for (const p of parsed.cumulativeProjection.slice(0, 12)) {
            if (!p || typeof p !== 'object') continue;
            const month = round0(clampNum(p.month, 1, 12, aiProj.length + 1));
            const projectedProfit = round0(clampNum(
              p.projectedProfit, 0, PROFIT_MAX, current.currentMonthlyProfit,
            ));
            cumulative += projectedProfit;
            aiProj.push({
              month,
              projectedProfit,
              cumulativeProfit: round0(clampNum(cumulative, 0, PROFIT_MAX * 12, 0)),
            });
          }
          if (aiProj.length >= 6) {
            // Sort by month, ensure 1-12 sequence
            aiProj.sort((a, b) => a.month - b.month);
            maximization = { ...maximization, cumulativeProjection: aiProj };
          }
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-horizon-maximizer',
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
    } satisfies ProfitHorizonResponse);
  },
});

export const GET = profitHorizonMaximizerHandler;
export const POST = profitHorizonMaximizerHandler;

