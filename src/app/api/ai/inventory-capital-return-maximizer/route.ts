// v8.07 / v8.96.9-final2: AI Inventory Capital Return Maximizer — AI MAKSIMIZIRA CAPITAL RETURN —
// koliko deployed kapitala se VRNE (return OF capital, ne return ON capital).
// "Deployed 5000€ v inventory. 3200€ se je že vrnilo (64%), ampak z optimalnim
// sell order bi se lahko 4800€ (96%) vrnilo v 30 dneh." Razlika od
// inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized %
// return na held inventory) — ta MAKSIMIZIRA CAPITAL RETURN (% deployed capital
// ki se vrne, ne % profit). Razlika od inventory-cash-conversion-maximizer
// (v7.98 ki maksimizira cash conversion cycle) — ta maksimizira CAPITAL RETURN
// z returnMaximizationActions in capitalReturnTimeline. Razlika od
// inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) —
// ta maksimizira CAPITAL RETURN RATE z capitalAtRisk in returnOptimizationGrade.
// Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z
// yieldCurve) — ta maksimizira CAPITAL RETURN z capitalReturnProjection
// (week-by-week). Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield
// % per item) — ta maksimizira PORTFOLIO CAPITAL RETURN z returnMaximizationActions.
// Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital
// efficiency per item z reallocation) — ta maksimizira CAPITAL RETURN z
// capitalReturnTimeline in capitalAtRisk. Razlika od inventory-roi-maximizer-pro
// (v7.99 ki maksimizira ROI per item) — ta maksimizira CAPITAL RETURN OF (ne
// return ON). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira
// daily profit per item) — ta maksimizira CAPITAL RETURN (% capital returned)
// z returnMaximizationActions per item. Razlika od profit-compounding-maximizer
// (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira CAPITAL RETURN
// z maximizedCapitalReturnRate in capitalReturnProjection.

// GET+POST /api/ai/inventory-capital-return-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.9) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ReturnGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

type ReturnAction =
  | 'SELL_NOW'
  | 'REPRICE'
  | 'CROSS_POST'
  | 'BUNDLE'
  | 'LIQUIDATE';

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    dealScore: number | null;
  } | null;
}

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
  totalCapitalDeployed: number; // € = sum(buyPrice + buyFees) over HELD + SOLD (12m)
  totalExpectedReturn: number; // € = SOLD realized revenue (capital already returned from SOLD trades)
  capitalReturnRate: number; // % = totalExpectedReturn / totalCapitalDeployed × 100 (realized return)
  heldInventoryCount: number;
  avgHoldDays: number;
  avgReturnProbability: number; // 0-100 (avg per-item return probability over HELD)
}

interface PerItemReturn {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number; // € = buyPrice + buyFees
  estValue: number; // €
  expectedReturn: number; // € = min(estValue, estValue × 0.9) (conservative)
  returnProbability: number; // 0-100 (based on dealScore/age/demand)
  holdDays: number;
  aiRisk: number; // 0-100
  recommendedAction: ReturnAction;
}

interface CapitalReturnProjectionWeek {
  week: number; // 1-8
  cumulativeCapitalReturned: number; // € cumulative returned by this week
  weeklyCapitalReturned: number; // € returned this week
  cumulativeReturnRate: number; // % cumulative returned
}

interface CapitalReturnMaximization {
  maximizedCapitalReturnRate: number; // % optimal achievable
  returnUplift: number; // pp improvement = maximized − current
  returnMaximizationActions: Array<{
    tradeId: string;
    title: string;
    action: ReturnAction;
    expectedReturnGain: number; // € capital that will return with this action
    actionReason: string;
  }>;
  capitalReturnTimeline: number; // days to return capital (with actions)
  capitalAtRisk: number; // € capital that may not return (items declining in value)
  returnOptimizationGrade: ReturnGrade;
  capitalReturnProjection: CapitalReturnProjectionWeek[]; // week-by-week for 8 weeks
}

interface InventoryCapitalReturnResponse {
  ok: true;
  current: CurrentState;
  perItem: PerItemReturn[];
  maximization: CapitalReturnMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedCapitalReturnRate?: number;
    returnUplift?: number;
    returnMaximizationActions?: Array<{
      tradeId?: string;
      action?: ReturnAction;
      expectedReturnGain?: number;
      actionReason?: string;
    }>;
    capitalReturnTimeline?: number;
    capitalAtRisk?: number;
    returnOptimizationGrade?: ReturnGrade;
    capitalReturnProjection?: Array<{
      week?: number;
      cumulativeCapitalReturned?: number;
      weeklyCapitalReturned?: number;
      cumulativeReturnRate?: number;
    }>;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const WEEK_DAYS = 7;
const CONSERVATIVE_FACTOR = 0.9; // 90% of estValue (conservative)

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 500_000;
const RETURN_RATE_MIN = 0;
const RETURN_RATE_MAX = 200; // 200% capital return (rare, profit included)
const EXPECTED_RETURN_MIN = 0;
const EXPECTED_RETURN_MAX = 500_000;
const PROBABILITY_MIN = 0;
const PROBABILITY_MAX = 100;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const HOLD_MIN = 1;
const HOLD_MAX = 365;
const TIMELINE_MIN = 1;
const TIMELINE_MAX = 180;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 200;
const RETURN_GAIN_MIN = 0;
const RETURN_GAIN_MAX = 100_000;
const CAPITAL_AT_RISK_MIN = 0;
const CAPITAL_AT_RISK_MAX = 500_000;
const CUMULATIVE_RETURNED_MIN = 0;
const CUMULATIVE_RETURNED_MAX = 500_000;
const WEEKLY_RETURNED_MIN = 0;
const WEEKLY_RETURNED_MAX = 100_000;
const CUMULATIVE_RATE_MIN = 0;
const CUMULATIVE_RATE_MAX = 200;
const MAX_WEEKS = 8;
const MAX_ITEMS_PER_AI = 50;

const VALID_GRADE: readonly ReturnGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_ACTION: readonly ReturnAction[] = [
  'SELL_NOW',
  'REPRICE',
  'CROSS_POST',
  'BUNDLE',
  'LIQUIDATE',
];

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

interface HeldComputed {
  id: string;
  title: string;
  category: string;
  capital: number; // buyPrice + buyFees
  estValue: number; // aiEstimatedValue (fallback price/buyPrice)
  expectedReturn: number; // min(estValue, estValue × 0.9) (conservative)
  returnProbability: number; // 0-100
  holdDays: number;
  aiRisk: number;
  dealScore: number;
  aiScore: number;
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const aiEst = t.listing?.aiEstimatedValue ?? null;
  const listPrice = t.listing?.price ?? null;
  const estValue = aiEst && aiEst > 0
    ? aiEst
    : (listPrice && listPrice > 0 ? listPrice : buyPrice);
  // Conservative: take the smaller of estValue and estValue × 0.9
  // (some items may sell below estValue — be conservative)
  const expectedReturn = Math.min(estValue, estValue * CONSERVATIVE_FACTOR);

  const aiRisk = t.listing?.aiRisk ?? 50;
  const dealScore = t.listing?.dealScore ?? 50;
  const aiScore = t.listing?.aiScore ?? 50;

  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((now - buyMs) / DAY_MS))
    : 1;

  // Return probability: based on demand (dealScore/aiScore) + age penalty + risk discount
  // Higher dealScore + aiScore = higher probability
  // Older items (holdDays > 60) = lower probability (stale)
  // Higher aiRisk = lower probability
  const demandFactor = (dealScore + aiScore) / 200; // 0-1
  const agePenalty = holdDays > 60
    ? Math.min(0.4, (holdDays - 60) / 100) // up to 0.4 penalty
    : 0;
  const riskDiscount = (aiRisk / 100) * 0.3; // up to 0.3 discount
  const probabilityRaw = Math.max(0, Math.min(1, demandFactor - agePenalty - riskDiscount));
  const returnProbability = round0(clampNum(
    probabilityRaw * 100,
    PROBABILITY_MIN, PROBABILITY_MAX, 50,
  ));

  const category = clampString(t.category ?? '', 60, 'drugo');
  return {
    id: t.id,
    title: clampString(t.title, 100, 'Brez naslova'),
    category,
    capital,
    estValue,
    expectedReturn: round0(clampNum(
      expectedReturn, EXPECTED_RETURN_MIN, EXPECTED_RETURN_MAX, 0,
    )),
    returnProbability,
    holdDays: round0(clampNum(holdDays, HOLD_MIN, HOLD_MAX, 1)),
    aiRisk: round0(clampNum(aiRisk, SCORE_MIN, SCORE_MAX, 50)),
    dealScore: round0(clampNum(dealScore, SCORE_MIN, SCORE_MAX, 50)),
    aiScore: round0(clampNum(aiScore, SCORE_MIN, SCORE_MAX, 50)),
  };
}

interface SoldComputed {
  capitalReturned: number; // € = sellPrice - sellFees (what came back)
  capitalDeployed: number; // € = buyPrice + buyFees
  holdDays: number;
}

function computeSoldTrade(t: SoldTradeRow): SoldComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellFees = t.sellFees ?? 0;
  const capitalDeployed = buyPrice + buyFees;
  if (capitalDeployed <= 0) return null;
  const capitalReturned = sellPrice - sellFees;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  return { capitalReturned, capitalDeployed, holdDays };
}

function computeCurrent(
  held: HeldComputed[],
  sold: SoldComputed[],
): CurrentState {
  const heldCount = held.length;

  // Capital deployed: SOLD (12m) + HELD
  const soldCapital = round0(clampNum(
    sold.reduce((s, t) => s + t.capitalDeployed, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const heldCapital = round0(clampNum(
    held.reduce((s, h) => s + h.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const totalCapitalDeployed = round0(clampNum(
    soldCapital + heldCapital,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  // Expected return (realized): SOLD revenue (already-returned capital)
  const totalExpectedReturn = round0(clampNum(
    sold.reduce((s, t) => s + t.capitalReturned, 0),
    EXPECTED_RETURN_MIN, EXPECTED_RETURN_MAX, 0,
  ));
  const capitalReturnRate = round2(clampNum(
    totalCapitalDeployed > 0
      ? (totalExpectedReturn / totalCapitalDeployed) * 100
      : 0,
    RETURN_RATE_MIN, RETURN_RATE_MAX, 0,
  ));

  if (heldCount === 0) {
    return {
      totalCapitalDeployed,
      totalExpectedReturn,
      capitalReturnRate,
      heldInventoryCount: 0,
      avgHoldDays: 0,
      avgReturnProbability: 0,
    };
  }

  const avgHoldDays = round0(clampNum(
    held.reduce((s, h) => s + h.holdDays, 0) / heldCount,
    HOLD_MIN, HOLD_MAX, 30,
  ));
  const avgReturnProbability = round0(clampNum(
    held.reduce((s, h) => s + h.returnProbability, 0) / heldCount,
    PROBABILITY_MIN, PROBABILITY_MAX, 50,
  ));

  return {
    totalCapitalDeployed,
    totalExpectedReturn,
    capitalReturnRate,
    heldInventoryCount: heldCount,
    avgHoldDays,
    avgReturnProbability,
  };
}

// --- Deterministic maximization -----------------------------------------

function decideItemAction(h: HeldComputed): ReturnAction {
  // LIQUIDATE: high risk + low probability + held long → cut losses
  if (h.aiRisk > 70 && h.returnProbability < 40 && h.holdDays > 45) {
    return 'LIQUIDATE';
  }
  // SELL_NOW: high probability + estValue > capital → sell now while profitable
  if (h.returnProbability > 70 && h.expectedReturn > h.capital) {
    return 'SELL_NOW';
  }
  // REPRICE: low probability + held long → reprice to move
  if (h.returnProbability < 50 && h.holdDays > 30) {
    return 'REPRICE';
  }
  // CROSS_POST: medium probability + decent estValue → cross-post for more exposure
  if (h.returnProbability >= 50 && h.returnProbability <= 70 && h.holdDays > 14) {
    return 'CROSS_POST';
  }
  // BUNDLE: low estValue items → bundle with premium items
  if (h.expectedReturn < 100) {
    return 'BUNDLE';
  }
  // Default
  return 'SELL_NOW';
}

function buildPerItemReturn(h: HeldComputed): PerItemReturn {
  return {
    tradeId: h.id,
    title: h.title,
    category: h.category,
    capitalDeployed: h.capital,
    estValue: h.estValue,
    expectedReturn: h.expectedReturn,
    returnProbability: h.returnProbability,
    holdDays: h.holdDays,
    aiRisk: h.aiRisk,
    recommendedAction: decideItemAction(h),
  };
}

function computeCapitalAtRisk(held: HeldComputed[]): number {
  // Capital at risk = sum of capital where estValue < capital (declining items)
  // OR where returnProbability < 30 (low demand)
  const atRiskCapital = held.reduce((s, h) => {
    if (h.estValue < h.capital || h.returnProbability < 30) {
      return s + h.capital;
    }
    return s;
  }, 0);
  return round0(clampNum(
    atRiskCapital, CAPITAL_AT_RISK_MIN, CAPITAL_AT_RISK_MAX, 0,
  ));
}

function computeMaximizedCapitalReturnRate(
  current: CurrentState,
  held: HeldComputed[],
  sold: SoldComputed[],
): { maximizedCapitalReturnRate: number; returnUplift: number } {
  // Maximized: SOLD revenue (already returned) + probability-weighted HELD expectedReturn
  // Recovery boost from actions: SELL_NOW/CROSS_POST = +20% probability, REPRICE = +15%, BUNDLE = +10%, LIQUIDATE = +5%
  // maximizedReturn = soldRevenue + sum(h.expectedReturn × (h.probability + actionBoost)/100)
  const soldRevenue = round0(clampNum(
    sold.reduce((s, t) => s + t.capitalReturned, 0),
    EXPECTED_RETURN_MIN, EXPECTED_RETURN_MAX, 0,
  ));
  let heldBoostedReturn = 0;
  for (const h of held) {
    const action = decideItemAction(h);
    let actionBoost = 0;
    switch (action) {
      case 'SELL_NOW': actionBoost = 20; break;
      case 'CROSS_POST': actionBoost = 20; break;
      case 'REPRICE': actionBoost = 15; break;
      case 'BUNDLE': actionBoost = 10; break;
      case 'LIQUIDATE': actionBoost = 5; break;
    }
    const effectiveProb = Math.min(95, h.returnProbability + actionBoost);
    heldBoostedReturn += h.expectedReturn * (effectiveProb / 100);
  }
  const maximizedReturn = soldRevenue + heldBoostedReturn;
  const maximizedCapitalReturnRate = round2(clampNum(
    current.totalCapitalDeployed > 0
      ? (maximizedReturn / current.totalCapitalDeployed) * 100
      : 0,
    RETURN_RATE_MIN, RETURN_RATE_MAX, current.capitalReturnRate,
  ));
  const returnUplift = round2(clampNum(
    Math.max(0, maximizedCapitalReturnRate - current.capitalReturnRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  return { maximizedCapitalReturnRate, returnUplift };
}

function buildReturnMaximizationActions(
  held: HeldComputed[],
): Array<{
  tradeId: string;
  title: string;
  action: ReturnAction;
  expectedReturnGain: number;
  actionReason: string;
}> {
  // Sort by expected return gain (highest first)
  // Take top items with actions (limit to 8 for AI override context)
  const actions = held.map((h) => {
    const action = decideItemAction(h);
    let actionBoost = 0;
    let reason = '';
    switch (action) {
      case 'SELL_NOW':
        actionBoost = 20;
        reason = `High demand (${h.returnProbability}%) + profitable (estValue ${h.estValue}€ > capital ${h.capital}€). Sell now while profitable.`;
        break;
      case 'CROSS_POST':
        actionBoost = 20;
        reason = `Medium demand (${h.returnProbability}%) + held ${h.holdDays}d. Cross-post na Bolha+Vinted+mobile.de za +20% probability.`;
        break;
      case 'REPRICE':
        actionBoost = 15;
        reason = `Low demand (${h.returnProbability}%) + held ${h.holdDays}d. Reprice za -10-15% za faster sale.`;
        break;
      case 'BUNDLE':
        actionBoost = 10;
        reason = `Low estValue (${h.estValue}€). Bundle z premium items za cross-sell.`;
        break;
      case 'LIQUIDATE':
        actionBoost = 5;
        reason = `High risk (${h.aiRisk}) + low probability (${h.returnProbability}%) + held ${h.holdDays}d. Liquidate za capital recovery.`;
        break;
    }
    const effectiveProb = Math.min(95, h.returnProbability + actionBoost);
    const currentExpectedReturn = h.expectedReturn * (h.returnProbability / 100);
    const actionedExpectedReturn = h.expectedReturn * (effectiveProb / 100);
    const expectedReturnGain = round0(clampNum(
      Math.max(0, actionedExpectedReturn - currentExpectedReturn),
      RETURN_GAIN_MIN, RETURN_GAIN_MAX, 0,
    ));
    return {
      tradeId: h.id,
      title: h.title,
      action,
      expectedReturnGain,
      actionReason: reason.slice(0, 200),
    };
  });
  actions.sort((a, b) => b.expectedReturnGain - a.expectedReturnGain);
  return actions.slice(0, 8);
}

function computeCapitalReturnTimeline(
  held: HeldComputed[],
  sold: SoldComputed[],
): number {
  // Timeline = avg days for capital to return
  // Use SOLD trades' avg holdDays as baseline (how fast they sold)
  const soldCount = sold.length;
  const soldAvgHoldDays = soldCount > 0
    ? sold.reduce((s, t) => s + t.holdDays, 0) / soldCount
    : 30;
  // With actions: timeline = 70% of avg sold hold days (actions accelerate)
  const timeline = Math.max(7, Math.round(soldAvgHoldDays * 0.7));
  void held;
  return round0(clampNum(timeline, TIMELINE_MIN, TIMELINE_MAX, 30));
}

function decideReturnGrade(
  maximizedCapitalReturnRate: number,
  returnUplift: number,
): ReturnGrade {
  // A+ if maximized ≥ 120% (capital + 20% profit returned) or uplift ≥ 50pp
  // A if maximized ≥ 100% (full capital returned) or uplift ≥ 30pp
  // B if maximized ≥ 80% or uplift ≥ 20pp
  // C if maximized ≥ 60% or uplift ≥ 10pp
  // D if maximized ≥ 40% or uplift ≥ 5pp
  // else F
  if (maximizedCapitalReturnRate >= 120 || returnUplift >= 50) return 'A+';
  if (maximizedCapitalReturnRate >= 100 || returnUplift >= 30) return 'A';
  if (maximizedCapitalReturnRate >= 80 || returnUplift >= 20) return 'B';
  if (maximizedCapitalReturnRate >= 60 || returnUplift >= 10) return 'C';
  if (maximizedCapitalReturnRate >= 40 || returnUplift >= 5) return 'D';
  return 'F';
}

function buildCapitalReturnProjection(
  current: CurrentState,
  maximizedCapitalReturnRate: number,
): CapitalReturnProjectionWeek[] {
  // 8-week projection: capital returns gradually
  // Total capital to be returned = totalCapitalDeployed × maximizedRate/100
  // Distribution: most capital returns in first 4 weeks, tapering off
  // Use S-curve: week 1: 10%, week 2: 22%, week 3: 38%, week 4: 55%, week 5: 70%, week 6: 82%, week 7: 92%, week 8: 100%
  const distributionFactors = [0.10, 0.22, 0.38, 0.55, 0.70, 0.82, 0.92, 1.00];
  const totalReturnableCapital = round0(clampNum(
    current.totalCapitalDeployed * (maximizedCapitalReturnRate / 100),
    EXPECTED_RETURN_MIN, EXPECTED_RETURN_MAX, 0,
  ));
  const projections: CapitalReturnProjectionWeek[] = [];
  let prevCumulative = 0;
  for (let week = 1; week <= MAX_WEEKS; week++) {
    const factor = distributionFactors[week - 1];
    const cumulativeCapitalReturned = round0(clampNum(
      totalReturnableCapital * factor,
      CUMULATIVE_RETURNED_MIN, CUMULATIVE_RETURNED_MAX, 0,
    ));
    const weeklyCapitalReturned = round0(clampNum(
      Math.max(0, cumulativeCapitalReturned - prevCumulative),
      WEEKLY_RETURNED_MIN, WEEKLY_RETURNED_MAX, 0,
    ));
    const cumulativeReturnRate = round2(clampNum(
      current.totalCapitalDeployed > 0
        ? (cumulativeCapitalReturned / current.totalCapitalDeployed) * 100
        : 0,
      CUMULATIVE_RATE_MIN, CUMULATIVE_RATE_MAX, 0,
    ));
    projections.push({
      week,
      cumulativeCapitalReturned,
      weeklyCapitalReturned,
      cumulativeReturnRate,
    });
    prevCumulative = cumulativeCapitalReturned;
  }
  return projections;
}

function buildSummary(
  current: CurrentState,
  max: CapitalReturnMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.capitalReturnRate}% capital return (${current.totalCapitalDeployed}€ deployed, ${current.totalExpectedReturn}€ expected).`,
    `Maximized: ${max.maximizedCapitalReturnRate}% (uplift +${max.returnUplift}pp, grade ${max.returnOptimizationGrade}).`,
    `Timeline: ${max.capitalReturnTimeline}d. Capital at risk: ${max.capitalAtRisk}€.`,
  ];
  return parts.join(' ').slice(0, 400);
}

function buildDeterministicMaximization(
  current: CurrentState,
  held: HeldComputed[],
  sold: SoldComputed[],
): CapitalReturnMaximization {
  const { maximizedCapitalReturnRate, returnUplift } = computeMaximizedCapitalReturnRate(
    current, held, sold,
  );
  const returnMaximizationActions = buildReturnMaximizationActions(held);
  const capitalReturnTimeline = computeCapitalReturnTimeline(held, sold);
  const capitalAtRisk = computeCapitalAtRisk(held);
  const returnOptimizationGrade = decideReturnGrade(maximizedCapitalReturnRate, returnUplift);
  const capitalReturnProjection = buildCapitalReturnProjection(current, maximizedCapitalReturnRate);

  return {
    maximizedCapitalReturnRate,
    returnUplift,
    returnMaximizationActions,
    capitalReturnTimeline,
    capitalAtRisk,
    returnOptimizationGrade,
    capitalReturnProjection,
  };
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryCapitalReturnMaximizerInput {}

// --- Handler -------------------------------------------------------------

const inventoryCapitalReturnMaximizerHandler = withAiRoute<InventoryCapitalReturnMaximizerInput>({
  endpoint: '/api/ai/inventory-capital-return-maximizer',
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

    // 1) Parallel query HELD trades + SOLD trades (last 12m) for return history
    const [heldTrades, soldTrades] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          title: true,
          category: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
              aiScore: true,
              aiRisk: true,
              dealScore: true,
            },
          },
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
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
    ]);

    // Empty-state: no HELD and no SOLD trades
    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          totalExpectedReturn: 0,
          capitalReturnRate: 0,
          heldInventoryCount: 0,
          avgHoldDays: 0,
          avgReturnProbability: 0,
        },
        perItem: [],
        maximization: {
          maximizedCapitalReturnRate: 0,
          returnUplift: 0,
          returnMaximizationActions: [],
          capitalReturnTimeline: 0,
          capitalAtRisk: 0,
          returnOptimizationGrade: 'F',
          capitalReturnProjection: [],
        },
        summary: 'Ni HELD in SOLD trgovin — Inventory Capital Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD in SOLD trgovin — Inventory Capital Return Maximizer ni mogoč.',
      } satisfies InventoryCapitalReturnResponse);
    }

    // 2) Compute HELD trades
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    // If no HELD trades, can't compute capital return
    if (heldComputed.length === 0) {
      return apiOk({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          totalExpectedReturn: 0,
          capitalReturnRate: 0,
          heldInventoryCount: 0,
          avgHoldDays: 0,
          avgReturnProbability: 0,
        },
        perItem: [],
        maximization: {
          maximizedCapitalReturnRate: 0,
          returnUplift: 0,
          returnMaximizationActions: [],
          capitalReturnTimeline: 0,
          capitalAtRisk: 0,
          returnOptimizationGrade: 'F',
          capitalReturnProjection: [],
        },
        summary: 'Ni HELD trgovin (z estValue) — Inventory Capital Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin (z estValue) — Inventory Capital Return Maximizer ni mogoč.',
      } satisfies InventoryCapitalReturnResponse);
    }

    // Compute SOLD trades for return history (within 12m)
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t);
      if (c) soldComputed.push(c);
    }

    const current = computeCurrent(heldComputed, soldComputed);
    let maximization = buildDeterministicMaximization(current, heldComputed, soldComputed);
    let summary = buildSummary(current, maximization);

    // Build perItem (full payload for response)
    const perItem: PerItemReturn[] = heldComputed.map(buildPerItemReturn);

    // 3) AI cache check (6h TTL) — key by held inventory composition
    const heldItemIdsHash = heldComputed.map((h) => h.id).sort().join(',').slice(0, 200);
    const cacheKey = `inventory-capital-return-maximizer:${heldItemIdsHash}`;
    const cached = getCachedAI<{
      maximization: CapitalReturnMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        perItem,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryCapitalReturnResponse);
    }

    // 4) AI prompt with grounding

    // Compact context for AI — top N items by capital
    const perItemForAI = perItem
      .slice()
      .sort((a, b) => b.capitalDeployed - a.capitalDeployed)
      .slice(0, MAX_ITEMS_PER_AI)
      .map((h) => ({
        id: h.tradeId.slice(0, 8),
        cat: h.category,
        cap: h.capitalDeployed,
        est: h.estValue,
        expRet: h.expectedReturn,
        prob: h.returnProbability,
        holdDays: h.holdDays,
        risk: h.aiRisk,
        recAction: h.recommendedAction,
      }));

    const promptData = {
      heldCount: heldComputed.length,
      soldCount12m: soldComputed.length,
      current,
      perItemSample: perItemForAI,
      deterministicMaximization: {
        maximizedCapitalReturnRate: maximization.maximizedCapitalReturnRate,
        returnUplift: maximization.returnUplift,
        returnMaximizationActions: maximization.returnMaximizationActions,
        capitalReturnTimeline: maximization.capitalReturnTimeline,
        capitalAtRisk: maximization.capitalAtRisk,
        returnOptimizationGrade: maximization.returnOptimizationGrade,
        capitalReturnProjection: maximization.capitalReturnProjection,
      },
      caps: {
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        returnRateMin: RETURN_RATE_MIN, returnRateMax: RETURN_RATE_MAX,
        expectedReturnMin: EXPECTED_RETURN_MIN, expectedReturnMax: EXPECTED_RETURN_MAX,
        probabilityMin: PROBABILITY_MIN, probabilityMax: PROBABILITY_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        timelineMin: TIMELINE_MIN, timelineMax: TIMELINE_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        returnGainMin: RETURN_GAIN_MIN, returnGainMax: RETURN_GAIN_MAX,
        capitalAtRiskMin: CAPITAL_AT_RISK_MIN, capitalAtRiskMax: CAPITAL_AT_RISK_MAX,
        cumulativeReturnedMin: CUMULATIVE_RETURNED_MIN, cumulativeReturnedMax: CUMULATIVE_RETURNED_MAX,
        weeklyReturnedMin: WEEKLY_RETURNED_MIN, weeklyReturnedMax: WEEKLY_RETURNED_MAX,
        cumulativeRateMin: CUMULATIVE_RATE_MIN, cumulativeRateMax: CUMULATIVE_RATE_MAX,
      },
    };

    const prompt = `Si AI "Inventory Capital Return Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL RETURN MAXIMIZATION — koliko deployed kapitala se VRNE (return OF capital, ne return ON capital). Tvoj cilj je "deployed 5000€ v inventory. 3200€ se je že vrnilo (64%), ampak z optimalnim sell order bi se lahko 4800€ (96%) vrnilo v 30 dneh." Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ti MAKSIMIZIRAŠ CAPITAL RETURN (% deployed capital ki se vrne, ne % profit). Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion cycle) — ta maksimizira CAPITAL RETURN z returnMaximizationActions in capitalReturnTimeline. Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) — ta maksimizira CAPITAL RETURN RATE z capitalAtRisk in returnOptimizationGrade. Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ta maksimizira CAPITAL RETURN z capitalReturnProjection (week-by-week). Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item) — ta maksimizira PORTFOLIO CAPITAL RETURN z returnMaximizationActions. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ta maksimizira CAPITAL RETURN z capitalReturnTimeline in capitalAtRisk. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta maksimizira CAPITAL RETURN OF (ne return ON). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ta maksimizira CAPITAL RETURN (% capital returned) z returnMaximizationActions per item. Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira CAPITAL RETURN z maximizedCapitalReturnRate in capitalReturnProjection.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trades z listing.aiEstimatedValue + SOLD trades zadnjih 12m za return history):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedCapitalReturnRate % [0, 200] (≥ current.capitalReturnRate, ≤ current × 1.5 ali +60pp absolute),
2. maximization.returnUplift pp [0, 200] (improvement = maximized − current),
3. maximization.returnMaximizationActions: 4-8 elementov { tradeId (MORA match-at enega iz perItemSample — anti-hallucination), action: SELL_NOW | REPRICE | CROSS_POST | BUNDLE | LIQUIDATE, expectedReturnGain € [0, 100000] (capital ki se bo vrnil z to akcijo), actionReason (max 200, slovenski — zakaj ta akcija) },
4. maximization.capitalReturnTimeline dni [1, 180] (koliko dni da se kapital vrne z actions — shorter = faster recovery),
5. maximization.capitalAtRisk € [0, 500000] (kapital ki se morda ne vrne — items declining v value ali z low demand),
6. maximization.returnOptimizationGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 120% ali uplift ≥ 50pp, A ≥ 100%/30, B ≥ 80%/20, C ≥ 60%/10, D ≥ 40%/5, else F),
7. maximization.capitalReturnProjection: 8 elementov { week 1-8, cumulativeCapitalReturned € [0, 500000], weeklyCapitalReturned € [0, 100000], cumulativeReturnRate % [0, 200] (S-curve: week 1=10%, 2=22%, 3=38%, 4=55%, 5=70%, 6=82%, 7=92%, 8=100% of total returnable) },
8. summary: slovenski povzetek (max 400 znakov — poudari capital return % + timeline + at risk).

VRNI LE JSON:
{
  "maximization": {
    "maximizedCapitalReturnRate": 96,
    "returnUplift": 32,
    "returnMaximizationActions": [
      { "tradeId": "abc12345", "action": "SELL_NOW", "expectedReturnGain": 180, "actionReason": "High demand 75% + profitable." },
      { "tradeId": "def67890", "action": "REPRICE", "expectedReturnGain": 95, "actionReason": "Low demand 40% + held 45d." }
    ],
    "capitalReturnTimeline": 21,
    "capitalAtRisk": 850,
    "returnOptimizationGrade": "A",
    "capitalReturnProjection": [
      { "week": 1, "cumulativeCapitalReturned": 480, "weeklyCapitalReturned": 480, "cumulativeReturnRate": 9.6 },
      { "week": 4, "cumulativeCapitalReturned": 2640, "weeklyCapitalReturned": 816, "cumulativeReturnRate": 52.8 },
      { "week": 8, "cumulativeCapitalReturned": 4800, "weeklyCapitalReturned": 384, "cumulativeReturnRate": 96 }
    ]
  },
  "summary": "Current: 64% capital return (5000€ deployed, 3200€ expected). Maximized: 96% (uplift +32pp, grade A). Timeline: 21d. Capital at risk: 850€."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override maximizedCapitalReturnRate — anti-hallucination bounds
        if (aiMax.maximizedCapitalReturnRate !== undefined) {
          const minBound = current.capitalReturnRate;
          const maxBound = Math.max(
            minBound + 1,
            Math.min(
              RETURN_RATE_MAX,
              Math.max(current.capitalReturnRate * 1.5, current.capitalReturnRate + 60),
            ),
          );
          const maximizedCapitalReturnRate = round2(clampNum(
            aiMax.maximizedCapitalReturnRate,
            minBound, maxBound, maximization.maximizedCapitalReturnRate,
          ));
          const returnUplift = round2(clampNum(
            Math.max(0, maximizedCapitalReturnRate - current.capitalReturnRate),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          maximization = {
            ...maximization,
            maximizedCapitalReturnRate,
            returnUplift,
          };
        }

        // Override returnMaximizationActions — must reference real trade IDs (anti-hallucination)
        if (Array.isArray(aiMax.returnMaximizationActions) &&
            aiMax.returnMaximizationActions.length >= 4) {
          const validTradeIds = new Set(heldComputed.map((h) => h.id));
          // Also allow short IDs (first 8 chars) for AI matching
          const validShortIds = new Set(heldComputed.map((h) => h.id.slice(0, 8)));
          const tradeById = new Map(heldComputed.map((h) => [h.id, h]));
          const tradeByShortId = new Map(heldComputed.map((h) => [h.id.slice(0, 8), h]));

          const aiActions: CapitalReturnMaximization['returnMaximizationActions'] = [];
          const seen = new Set<string>();
          for (const a of aiMax.returnMaximizationActions.slice(0, 8)) {
            if (!a || typeof a !== 'object') continue;
            const rawTradeId = String(a.tradeId ?? '').trim();
            // Try exact match first, then short ID match
            let trade: HeldComputed | undefined;
            if (validTradeIds.has(rawTradeId)) {
              trade = tradeById.get(rawTradeId);
            } else if (validShortIds.has(rawTradeId.slice(0, 8))) {
              trade = tradeByShortId.get(rawTradeId.slice(0, 8));
            }
            if (!trade) continue; // skip — anti-hallucination: trade must exist
            if (seen.has(trade.id)) continue; // dedupe
            seen.add(trade.id);

            const action = clampEnum(a.action, VALID_ACTION, decideItemAction(trade));
            const expectedReturnGain = round0(clampNum(
              a.expectedReturnGain,
              RETURN_GAIN_MIN, RETURN_GAIN_MAX, 0,
            ));
            const actionReason = clampString(a.actionReason, 200, 'Akcija za max capital return.');
            aiActions.push({
              tradeId: trade.id,
              title: trade.title,
              action,
              expectedReturnGain,
              actionReason,
            });
          }
          if (aiActions.length >= 4) {
            maximization = { ...maximization, returnMaximizationActions: aiActions };
          }
        }

        // Override capitalReturnTimeline
        if (aiMax.capitalReturnTimeline !== undefined) {
          const v = round0(clampNum(
            aiMax.capitalReturnTimeline,
            TIMELINE_MIN, TIMELINE_MAX, maximization.capitalReturnTimeline,
          ));
          maximization = { ...maximization, capitalReturnTimeline: v };
        }

        // Override capitalAtRisk — must be ≤ totalCapitalDeployed
        if (aiMax.capitalAtRisk !== undefined) {
          const maxAtRisk = Math.min(CAPITAL_AT_RISK_MAX, current.totalCapitalDeployed);
          const v = round0(clampNum(
            aiMax.capitalAtRisk,
            CAPITAL_AT_RISK_MIN, maxAtRisk, maximization.capitalAtRisk,
          ));
          maximization = { ...maximization, capitalAtRisk: v };
        }

        // Override capitalReturnProjection — must be 8 entries with weeks 1-8
        if (Array.isArray(aiMax.capitalReturnProjection) &&
            aiMax.capitalReturnProjection.length >= 8) {
          const aiProj: CapitalReturnProjectionWeek[] = [];
          for (let week = 1; week <= MAX_WEEKS; week++) {
            const ai = aiMax.capitalReturnProjection.find(
              (p) => p && Number(p.week) === week,
            );
            if (!ai) continue;
            const cumulativeCapitalReturned = round0(clampNum(
              ai.cumulativeCapitalReturned,
              CUMULATIVE_RETURNED_MIN, CUMULATIVE_RETURNED_MAX, 0,
            ));
            const weeklyCapitalReturned = round0(clampNum(
              ai.weeklyCapitalReturned,
              WEEKLY_RETURNED_MIN, WEEKLY_RETURNED_MAX, 0,
            ));
            const cumulativeReturnRate = round2(clampNum(
              ai.cumulativeReturnRate,
              CUMULATIVE_RATE_MIN, CUMULATIVE_RATE_MAX, 0,
            ));
            aiProj.push({
              week,
              cumulativeCapitalReturned,
              weeklyCapitalReturned,
              cumulativeReturnRate,
            });
          }
          if (aiProj.length === MAX_WEEKS) {
            maximization = { ...maximization, capitalReturnProjection: aiProj };
          }
        }

        // Override returnOptimizationGrade — recompute or use AI value
        if (aiMax.returnOptimizationGrade) {
          const grade = clampEnum(
            aiMax.returnOptimizationGrade,
            VALID_GRADE,
            decideReturnGrade(
              maximization.maximizedCapitalReturnRate,
              maximization.returnUplift,
            ),
          );
          maximization = { ...maximization, returnOptimizationGrade: grade };
        } else {
          maximization = {
            ...maximization,
            returnOptimizationGrade: decideReturnGrade(
              maximization.maximizedCapitalReturnRate,
              maximization.returnUplift,
            ),
          };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-capital-return-maximizer',
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
      perItem,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryCapitalReturnResponse);
  },
});

export const GET = inventoryCapitalReturnMaximizerHandler;
export const POST = inventoryCapitalReturnMaximizerHandler;
