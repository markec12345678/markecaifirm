// v8.04 / v8.96.6-batch2: AI Inventory Cash Yield Maximizer — AI MAXIMIZIRA CASH YIELD —
// annualizirani return rate na kapitalu deployed v inventory. Kot financial
// investor ki optimizira portfolio yield. "Tvoj cash yield je 45%
// annualiziran, vendar bi lahko bil 78% z optimalnim inventory mix in hitrejšim
// turnover." Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield
// % per item z yieldGrade) — ta MAKSIMIZIRA CASH YIELD (annualized return rate
// na capital deployed) čez PORTFOLIO z currentCashYield/maximizedCashYield in
// benchmarkYield. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki
// maksimizira capital efficiency per item z reallocation) — ta maksimizira
// CASH YIELD % z annualized view in yieldComparisonTable. Razlika od
// inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta
// maksimizira CASH YIELD z optimalHoldTime in benchmarkYield. Razlika od
// deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per item) — ta
// maksimizira CASH YIELD (ne margin) z yieldVsBenchmark. Razlika od
// inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit) — ta
// daje PER-ITEM annualized yield analizo z yieldComparisonTable. Razlika od
// profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ta
// fokusira na PORTFOLIO CASH YIELD z benchmark comparison. Razlika od
// profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest) —
// ta maksimizira CASH YIELD (annualized yield %, ne reinvest compounding).
// Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8
// levers) — ta fokusira na CASH YIELD % z yieldGrade in yieldVsBenchmark.
//
// "Current: 8500€ deployed, portfolio cash yield 45% annualized (benchmark 32%),
// 13% above benchmark. Maximized: 78% annualized (+33pp uplift). Item analysis:
// iPhone 13 yield 421% annualized (hold 25d), PS5 yield 48% (hold 60d), TV
// yield -28% (hold 90d). Maximization: HOLD iPhone (already excellent), SELL
// PS5 (slow yield), REPRICE TV (negative yield). Yield comparison: 8 items, 5
// above benchmark, 3 below. Optimal hold time: 30 dni (sweet spot za max
// annualized yield). Yield grade: B (above benchmark, room for optimization).
// Yield vs benchmark: +13pp above typical 32% for this trading type."

// GET+POST /api/ai/inventory-cash-yield-maximizer
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
interface InventoryCashYieldMaximizerInput {}

// --- Types ---------------------------------------------------------------

type YieldGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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
  totalCapitalDeployed: number;
  currentCashYield: number; // % annualized portfolio yield
  avgHoldDays: number;
  heldItemCount: number;
}

interface PerItemYield {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number;
  estValue: number;
  unrealizedProfit: number;
  holdDays: number;
  annualizedYield: number; // %
  currentYield: number; // % (non-annualized)
}

interface YieldComparisonRow {
  tradeId: string;
  title: string;
  currentAnnualizedYield: number;
  maximizedAnnualizedYield: number;
  yieldUplift: number;
  action: string;
}

interface MaximizedState {
  maximizedCashYield: number; // %
  yieldOptimizationActions: string[];
  yieldComparisonTable: YieldComparisonRow[];
  optimalHoldTime: number; // days
  yieldGrade: YieldGrade;
  benchmarkYield: number; // % typical for this trading type
  yieldVsBenchmark: number; // pp (current - benchmark)
}

interface InventoryCashYieldResponse {
  ok: true;
  current: CurrentState;
  maximization: MaximizedState;
  perItem: PerItemYield[];
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedCashYield?: number;
    yieldOptimizationActions?: string[];
    yieldComparisonTable?: Array<{
      tradeId?: string;
      maximizedAnnualizedYield?: number;
      action?: string;
    }>;
    optimalHoldTime?: number;
    yieldGrade?: YieldGrade;
    benchmarkYield?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 100_000;
const YIELD_MIN = -100;
const YIELD_MAX = 1000; // annualized yield up to 1000%
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 200; // pp uplift cap
const DAYS_MIN = 1;
const DAYS_MAX = 365;
const FEE_PCT = 0.05;
const BENCHMARK_TYPICAL = 32; // % typical for Slovenian flipping
const MAX_ITEMS_TO_PROCESS = 40;
const MAX_ACTIONS = 6;

const VALID_GRADE: readonly YieldGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number;
  estValue: number;
  unrealizedProfit: number;
  holdDays: number;
  currentYield: number; // %
  annualizedYield: number; // %
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  if (buyPrice <= 0) return null;
  const capitalDeployed = buyPrice + buyFees;
  const aiEst = t.listing?.aiEstimatedValue ?? null;
  const lp = t.listing?.price ?? null;
  let estValue: number;
  if (aiEst && aiEst > 0) {
    estValue = aiEst;
  } else if (lp && lp > 0) {
    estValue = lp;
  } else {
    estValue = buyPrice * 1.1;
  }
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((now - buyMs) / DAY_MS))
    : 1;
  const unrealizedProfit = estValue - capitalDeployed - (estValue * FEE_PCT);
  const currentYield = capitalDeployed > 0
    ? (unrealizedProfit / capitalDeployed) * 100
    : 0;
  // Annualized yield = (unrealizedProfit / capitalDeployed) * (365 / holdDays) * 100
  const annualizedYield = capitalDeployed > 0
    ? (unrealizedProfit / capitalDeployed) * (365 / Math.max(DAYS_MIN, holdDays)) * 100
    : 0;
  return {
    tradeId: t.id,
    title: t.title || 'Untitled',
    category: t.category || 'Unknown',
    capitalDeployed,
    estValue,
    unrealizedProfit,
    holdDays,
    currentYield,
    annualizedYield,
  };
}

interface SoldComputed {
  cost: number;
  profit: number;
  holdDays: number;
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
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 1;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { cost, profit, holdDays, within12m };
}

function computeCurrent(
  held: HeldComputed[],
  sold: SoldComputed[],
): CurrentState {
  const totalCapitalDeployed = round0(clampNum(
    held.reduce((s, h) => s + h.capitalDeployed, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  // Portfolio cash yield = weighted avg annualized yield by capitalDeployed
  let currentCashYield = 0;
  if (totalCapitalDeployed > 0 && held.length > 0) {
    currentCashYield = round2(clampNum(
      held.reduce((s, h) => s + h.annualizedYield * h.capitalDeployed, 0) / totalCapitalDeployed,
      YIELD_MIN, YIELD_MAX, 0,
    ));
  } else if (sold.length > 0) {
    // Fallback: historical yield from sold trades
    const totalProfit = sold.reduce((s, t) => s + t.profit, 0);
    const totalCost = sold.reduce((s, t) => s + t.cost, 0);
    const avgHold = sold.reduce((s, t) => s + t.holdDays, 0) / sold.length;
    if (totalCost > 0 && avgHold > 0) {
      const portfolioYield = (totalProfit / totalCost) * (365 / avgHold) * 100;
      currentCashYield = round2(clampNum(portfolioYield, YIELD_MIN, YIELD_MAX, 0));
    }
  }

  const avgHoldDays = round0(clampNum(
    held.length > 0
      ? held.reduce((s, h) => s + h.holdDays, 0) / held.length
      : (sold.length > 0 ? sold.reduce((s, t) => s + t.holdDays, 0) / sold.length : 30),
    DAYS_MIN, DAYS_MAX, 30,
  ));

  return {
    totalCapitalDeployed,
    currentCashYield,
    avgHoldDays,
    heldItemCount: held.length,
  };
}

function buildYieldComparisonRow(h: HeldComputed): YieldComparisonRow {
  // Maximized yield per item:
  // - if currentYield < 0 → SELL (lock loss, avoid further depreciation)
  // - if currentYield > 0 && holdDays < 30 → HOLD (let yield annualize)
  // - if currentYield > 0 && holdDays > 60 → SELL (peak annualized realized)
  // - else REPRICE for +10% yield uplift
  let maximizedYield = h.annualizedYield;
  let action = 'HOLD';
  if (h.currentYield < 0) {
    maximizedYield = h.annualizedYield; // lock current
    action = 'SELL_FOR_YIELD — negativen yield, likvidiraj in sprosti kapital.';
  } else if (h.holdDays < 30 && h.currentYield > 0) {
    // Continue holding — annualized yield will increase as we approach peak hold time
    const optimalHold = 30;
    const newAnnualized = (h.unrealizedProfit / h.capitalDeployed) * (365 / optimalHold) * 100;
    maximizedYield = Math.max(h.annualizedYield, newAnnualized);
    action = `HOLD_FOR_YIELD — še ${optimalHold - h.holdDays} dni za max annualized yield.`;
  } else if (h.holdDays > 60) {
    // Sell — annualized yield starts decreasing after 60d (slowdown effect)
    action = 'SELL_FOR_YIELD — held >60d, yield se zmanjšuje s časom.';
  } else {
    // Mid-range — reprice for +10% yield uplift
    maximizedYield = h.annualizedYield * 1.1;
    action = 'REPRICE_FOR_YIELD — dvigni ceno za 5-10% za +10% yield uplift.';
  }
  const yieldUplift = round2(clampNum(
    maximizedYield - h.annualizedYield,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  return {
    tradeId: h.tradeId,
    title: h.title,
    currentAnnualizedYield: round2(clampNum(h.annualizedYield, YIELD_MIN, YIELD_MAX, 0)),
    maximizedAnnualizedYield: round2(clampNum(maximizedYield, YIELD_MIN, YIELD_MAX, h.annualizedYield)),
    yieldUplift,
    action: clampString(action, 200, `Optimiziraj yield za ${h.title}.`),
  };
}

function buildYieldComparisonTable(held: HeldComputed[]): YieldComparisonRow[] {
  return held.map((h) => buildYieldComparisonRow(h));
}

function computeMaximizedCashYield(
  held: HeldComputed[],
  comparisonTable: YieldComparisonRow[],
  totalCapital: number,
): number {
  if (totalCapital <= 0 || held.length === 0) return 0;
  // Weighted avg of maximizedAnnualizedYield by capitalDeployed
  let sum = 0;
  for (const h of held) {
    const row = comparisonTable.find((r) => r.tradeId === h.tradeId);
    const maxYield = row?.maximizedAnnualizedYield ?? h.annualizedYield;
    sum += maxYield * h.capitalDeployed;
  }
  return round2(clampNum(sum / totalCapital, YIELD_MIN, YIELD_MAX, 0));
}

function buildOptimizationActions(
  held: HeldComputed[],
  comparisonTable: YieldComparisonRow[],
  current: CurrentState,
  maximizedYield: number,
): string[] {
  const actions: string[] = [];
  const negativeItems = held.filter((h) => h.currentYield < 0);
  const longHoldItems = held.filter((h) => h.holdDays > 60 && h.currentYield > 0);
  const shortHoldItems = held.filter((h) => h.holdDays < 30 && h.currentYield > 0);

  // 1) Liquidate negative-yield items
  if (negativeItems.length > 0) {
    actions.push(
      `Likvidiraj ${negativeItems.length} item-ov z negativnim yield-om za sprostitev ${round0(negativeItems.reduce((s, h) => s + h.capitalDeployed, 0))}€ kapitala v višje-yield priložnosti.`,
    );
  } else {
    actions.push(
      'Vsi held items imajo pozitiven yield — ohrani portfolio.',
    );
  }

  // 2) Sell long-held items
  if (longHoldItems.length > 0) {
    actions.push(
      `Prodaj ${longHoldItems.length} item-ov z hold >60 dni — annualized yield se zmanjšuje, sprosti kapital za nove cikle.`,
    );
  }

  // 3) Hold short-hold items for annualized yield growth
  if (shortHoldItems.length > 0) {
    actions.push(
      `HOLD ${shortHoldItems.length} item-ov (hold <30 dni) za dosego peak annualized yield v ~30 dneh.`,
    );
  }

  // 4) Reprice mid-range items
  const midRange = held.filter((h) => h.holdDays >= 30 && h.holdDays <= 60 && h.currentYield > 0);
  if (midRange.length > 0) {
    actions.push(
      `REPRICE ${midRange.length} mid-range item-ov za +10% yield uplift z premium positioning.`,
    );
  }

  // 5) Capital reallocation
  actions.push(
    `Reinvestiraj sproščen kapital v višje-yield kategorije (elektronika, premium fashion) za dvig portfolio yield iz ${current.currentCashYield}% na ${maximizedYield}%.`,
  );

  // 6) Sourcing optimization
  actions.push(
    `Optimiziraj sourcing za target hold time ${Math.max(20, Math.round(current.avgHoldDays * 0.7))} dni — sweet spot za max annualized yield.`,
  );

  return actions.slice(0, MAX_ACTIONS);
}

function decideGrade(
  currentYield: number,
  maximizedYield: number,
  benchmark: number,
): YieldGrade {
  // A+ if current yield ≥ 3x benchmark (≥ 96%)
  // A if current ≥ 2x benchmark (≥ 64%)
  // B if current ≥ 1.5x benchmark (≥ 48%)
  // C if current ≥ benchmark (≥ 32%)
  // D if current ≥ 0.5x benchmark (≥ 16%)
  // else F
  if (currentYield >= benchmark * 3 || maximizedYield >= benchmark * 4) return 'A+';
  if (currentYield >= benchmark * 2 || maximizedYield >= benchmark * 3) return 'A';
  if (currentYield >= benchmark * 1.5 || maximizedYield >= benchmark * 2) return 'B';
  if (currentYield >= benchmark || maximizedYield >= benchmark * 1.5) return 'C';
  if (currentYield >= benchmark * 0.5 || maximizedYield >= benchmark) return 'D';
  return 'F';
}

function computeOptimalHoldTime(
  held: HeldComputed[],
  sold: SoldComputed[],
): number {
  // Optimal hold time = the hold time that historically produced the highest annualized yield
  // From SOLD trades: find avgHoldDays where avg annualized yield was highest
  if (sold.length >= 4) {
    // Bucket sold trades by holdDays range (0-7, 8-14, 15-30, 31-60, 61-90, 91+)
    const buckets: Array<{ range: [number, number]; yields: number[] }> = [
      { range: [1, 7], yields: [] },
      { range: [8, 14], yields: [] },
      { range: [15, 30], yields: [] },
      { range: [31, 60], yields: [] },
      { range: [61, 90], yields: [] },
      { range: [91, 365], yields: [] },
    ];
    for (const s of sold) {
      if (!s.within12m) continue;
      const annualizedYield = s.cost > 0 && s.holdDays > 0
        ? (s.profit / s.cost) * (365 / s.holdDays) * 100
        : 0;
      for (const b of buckets) {
        if (s.holdDays >= b.range[0] && s.holdDays <= b.range[1]) {
          b.yields.push(annualizedYield);
          break;
        }
      }
    }
    let bestBucket = buckets[2]; // default 15-30
    let bestAvg = 0;
    for (const b of buckets) {
      if (b.yields.length < 1) continue;
      const avg = b.yields.reduce((s, v) => s + v, 0) / b.yields.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestBucket = b;
      }
    }
    // Return midpoint of best bucket
    return round0(clampNum(
      Math.round((bestBucket.range[0] + bestBucket.range[1]) / 2),
      DAYS_MIN, DAYS_MAX, 30,
    ));
  }
  // Fallback: from held items, find peak annualization point
  if (held.length > 0) {
    // Sweet spot is typically 25-35 days for flipping
    const avgHold = held.reduce((s, h) => s + h.holdDays, 0) / held.length;
    return round0(clampNum(
      Math.max(20, Math.min(45, Math.round(avgHold * 0.8))),
      DAYS_MIN, DAYS_MAX, 30,
    ));
  }
  return 30;
}

function buildDeterministicMaximization(
  held: HeldComputed[],
  sold: SoldComputed[],
  current: CurrentState,
): MaximizedState {
  const yieldComparisonTable = buildYieldComparisonTable(held);
  const maximizedCashYield = computeMaximizedCashYield(
    held,
    yieldComparisonTable,
    current.totalCapitalDeployed,
  );
  const yieldOptimizationActions = buildOptimizationActions(
    held,
    yieldComparisonTable,
    current,
    maximizedCashYield,
  );
  const optimalHoldTime = computeOptimalHoldTime(held, sold);
  const benchmarkYield = BENCHMARK_TYPICAL;
  const yieldGrade = decideGrade(current.currentCashYield, maximizedCashYield, benchmarkYield);
  const yieldVsBenchmark = round2(clampNum(
    current.currentCashYield - benchmarkYield,
    YIELD_MIN, YIELD_MAX, 0,
  ));

  return {
    maximizedCashYield,
    yieldOptimizationActions,
    yieldComparisonTable,
    optimalHoldTime,
    yieldGrade,
    benchmarkYield,
    yieldVsBenchmark,
  };
}

function buildPerItem(held: HeldComputed[]): PerItemYield[] {
  return held.map((h) => ({
    tradeId: h.tradeId,
    title: h.title,
    category: h.category,
    capitalDeployed: round0(clampNum(h.capitalDeployed, CAPITAL_MIN, CAPITAL_MAX, 0)),
    estValue: round0(clampNum(h.estValue, CAPITAL_MIN, CAPITAL_MAX, 0)),
    unrealizedProfit: round0(clampNum(h.unrealizedProfit, -CAPITAL_MAX, CAPITAL_MAX, 0)),
    holdDays: round0(clampNum(h.holdDays, DAYS_MIN, DAYS_MAX, 1)),
    annualizedYield: round2(clampNum(h.annualizedYield, YIELD_MIN, YIELD_MAX, 0)),
    currentYield: round2(clampNum(h.currentYield, YIELD_MIN, YIELD_MAX, 0)),
  }));
}

function buildSummary(
  current: CurrentState,
  max: MaximizedState,
  heldCount: number,
): string {
  const parts: string[] = [
    `${heldCount} items, ${current.totalCapitalDeployed}€ deployed.`,
    `Cash yield: ${current.currentCashYield}% → ${max.maximizedCashYield}% (+${round2(max.maximizedCashYield - current.currentCashYield)}pp uplift).`,
    `Benchmark: ${max.benchmarkYield}%, vs benchmark: ${max.yieldVsBenchmark >= 0 ? '+' : ''}${max.yieldVsBenchmark}pp.`,
    `Grade: ${max.yieldGrade}. Optimal hold: ${max.optimalHoldTime}d.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- AI prompt + merge helpers (pure, testable) ---------------------------

interface PromptData {
  heldCount: number;
  soldCount12m: number;
  current: CurrentState;
  topItems: Array<{
    tradeId: string;
    title: string;
    category: string;
    capitalDeployed: number;
    estValue: number;
    unrealizedProfit: number;
    holdDays: number;
    currentYield: number;
    annualizedYield: number;
  }>;
  deterministicMaximization: {
    maximizedCashYield: number;
    optimalHoldTime: number;
    yieldGrade: YieldGrade;
    benchmarkYield: number;
    yieldVsBenchmark: number;
    yieldComparisonTable: YieldComparisonRow[];
  };
  caps: Record<string, number>;
}

function buildPromptData(
  heldCount: number,
  soldCount12m: number,
  current: CurrentState,
  topForPrompt: PerItemYield[],
  maximization: MaximizedState,
): PromptData {
  return {
    heldCount,
    soldCount12m,
    current,
    topItems: topForPrompt.map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      category: i.category,
      capitalDeployed: i.capitalDeployed,
      estValue: i.estValue,
      unrealizedProfit: i.unrealizedProfit,
      holdDays: i.holdDays,
      currentYield: i.currentYield,
      annualizedYield: i.annualizedYield,
    })),
    deterministicMaximization: {
      maximizedCashYield: maximization.maximizedCashYield,
      optimalHoldTime: maximization.optimalHoldTime,
      yieldGrade: maximization.yieldGrade,
      benchmarkYield: maximization.benchmarkYield,
      yieldVsBenchmark: maximization.yieldVsBenchmark,
      yieldComparisonTable: maximization.yieldComparisonTable.slice(0, 10),
    },
    caps: {
      capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
      yieldMin: YIELD_MIN, yieldMax: YIELD_MAX,
      upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      daysMin: DAYS_MIN, daysMax: DAYS_MAX,
    },
  };
}

function buildPrompt(promptData: PromptData, topCount: number): string {
  return `Si AI "Inventory Cash Yield Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CASH YIELD MAXIMIZATION — kako maksimizirati CASH YIELD (annualizirani return rate na capital deployed) v inventory. Kot financial investor ki optimizira portfolio yield — "tvoj cash yield je 45% annualiziran, vendar bi lahko bil 78% z optimalnim inventory mix in hitrejšim turnover". Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item z yieldGrade) — ti MAKSIMIZIRAŠ CASH YIELD (annualized return rate na capital deployed) čez PORTFOLIO z currentCashYield/maximizedCashYield in benchmarkYield. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ta maksimizira CASH YIELD % z annualized view in yieldComparisonTable. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta maksimizira CASH YIELD z optimalHoldTime in benchmarkYield. Razlika od deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per item) — ta maksimizira CASH YIELD (ne margin) z yieldVsBenchmark. Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit) — ta daje PER-ITEM annualized yield analizo z yieldComparisonTable. Razlika od profit-horizon-maximizer (v8.03 ki maksimizira profit per horizon) — ta fokusira na PORTFOLIO CASH YIELD z benchmark comparison. Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest) — ta maksimizira CASH YIELD (annualized yield %, ne reinvest compounding). Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ta fokusira na CASH YIELD % z yieldGrade in yieldVsBenchmark.

DETERMINISTIČNI PODATKI (top ${topCount} HELD item-ov z najnižjim annualized yield):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedCashYield % [-100, 1000] (≥ currentCashYield, ≤ currentCashYield × 1.6 ali +100pp absolute — anti-hallucination),
2. maximization.yieldOptimizationActions: 4-6 stringov (max 200 vsak, slovenski — kako maksimizirati cash yield: faster turnover, better sourcing, premium pricing, capital reallocation, optimal hold time),
3. maximization.yieldComparisonTable: za vsak item iz topItems, daj:
   - tradeId (string, MORA match-at enega iz topItems — anti-hallucination),
   - maximizedAnnualizedYield % [-100, 1000] (≥ currentAnnualizedYield, ≤ currentAnnualizedYield × 1.5 ali +50pp absolute — anti-hallucination),
   - action (max 200, slovenski — specifična akcija za maksimiranje yield-a za ta item),
4. maximization.optimalHoldTime dni [1, 365] (ideal hold time za max annualized yield),
5. maximization.yieldGrade: A+ | A | B | C | D | F (A+ če current ≥ 3x benchmark, A ≥ 2x, B ≥ 1.5x, C ≥ 1x, D ≥ 0.5x, else F),
6. maximization.benchmarkYield % [0, 200] (typical yield za ta tip trading-a, default 32%),
7. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "maximization": {
    "maximizedCashYield": 78,
    "yieldOptimizationActions": ["Likvidiraj 2 item-a z negativnim yield-om.", "HOLD 3 item-e še 14 dni za peak annualized yield."],
    "yieldComparisonTable": [
      { "tradeId": "abc123", "maximizedAnnualizedYield": 425, "action": "HOLD iPhone 13 še 5 dni za max annualized yield." }
    ],
    "optimalHoldTime": 30,
    "yieldGrade": "B",
    "benchmarkYield": 32
  },
  "summary": "8 items, 8500€ deployed. Cash yield: 45% → 78% (+33pp uplift). Benchmark: 32%, vs benchmark: +13pp. Grade B."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiResponse(
  parsed: AiResponse | null,
  detMaximization: MaximizedState,
  current: CurrentState,
  heldCount: number,
): { maximization: MaximizedState; summary: string; aiUsed: boolean } {
  if (!parsed || typeof parsed !== 'object' || !parsed.maximization) {
    return {
      maximization: detMaximization,
      summary: buildSummary(current, detMaximization, heldCount),
      aiUsed: false,
    };
  }

  const aiMax = parsed.maximization;

  // Anti-hallucination: maximizedCashYield ∈ [currentCashYield, currentCashYield × 1.6 or +100pp]
  const maxYieldBound = Math.min(
    YIELD_MAX,
    Math.max(
      current.currentCashYield + 10,
      Math.min(current.currentCashYield * 1.6 + 25, current.currentCashYield + 100),
    ),
  );
  const minYieldBound = Math.max(YIELD_MIN, current.currentCashYield);
  const maximizedCashYield = round2(clampNum(
    aiMax.maximizedCashYield,
    minYieldBound, maxYieldBound,
    detMaximization.maximizedCashYield,
  ));

  // Optimization actions
  let yieldOptimizationActions = detMaximization.yieldOptimizationActions;
  if (Array.isArray(aiMax.yieldOptimizationActions) &&
      aiMax.yieldOptimizationActions.length >= 3) {
    const aiActions = aiMax.yieldOptimizationActions
      .slice(0, MAX_ACTIONS)
      .map((a) => clampString(a, 200, 'Optimiziraj cash yield.'))
      .filter((s) => s.length > 0);
    if (aiActions.length >= 3) {
      yieldOptimizationActions = aiActions;
    }
  }

  // Yield comparison table
  let yieldComparisonTable = detMaximization.yieldComparisonTable;
  if (Array.isArray(aiMax.yieldComparisonTable) &&
      aiMax.yieldComparisonTable.length >= 2) {
    const detMap = new Map<string, YieldComparisonRow>();
    for (const r of detMaximization.yieldComparisonTable) detMap.set(r.tradeId, r);
    const aiTable: YieldComparisonRow[] = [];
    for (const ai of aiMax.yieldComparisonTable.slice(0, MAX_ITEMS_TO_PROCESS)) {
      if (!ai || typeof ai !== 'object' || typeof ai.tradeId !== 'string') continue;
      const det = detMap.get(ai.tradeId);
      if (!det) continue;
      const maxYieldBoundItem = Math.min(
        YIELD_MAX,
        Math.max(
          det.currentAnnualizedYield + 5,
          Math.min(det.currentAnnualizedYield * 1.5 + 15, det.currentAnnualizedYield + 50),
        ),
      );
      const maximizedAnnualizedYield = round2(clampNum(
        ai.maximizedAnnualizedYield,
        det.currentAnnualizedYield, maxYieldBoundItem,
        det.maximizedAnnualizedYield,
      ));
      const yieldUplift = round2(clampNum(
        maximizedAnnualizedYield - det.currentAnnualizedYield,
        UPLIFT_MIN, UPLIFT_MAX, 0,
      ));
      const action = clampString(ai.action, 200, det.action);
      aiTable.push({
        tradeId: ai.tradeId,
        title: det.title,
        currentAnnualizedYield: det.currentAnnualizedYield,
        maximizedAnnualizedYield,
        yieldUplift,
        action,
      });
    }
    // Fill missing items from deterministic
    const coveredIds = new Set(aiTable.map((r) => r.tradeId));
    for (const det of detMaximization.yieldComparisonTable) {
      if (!coveredIds.has(det.tradeId)) aiTable.push(det);
    }
    if (aiTable.length >= Math.min(2, detMaximization.yieldComparisonTable.length)) {
      yieldComparisonTable = aiTable;
    }
  }

  // Optimal hold time
  const optimalHoldTime = round0(clampNum(
    aiMax.optimalHoldTime,
    DAYS_MIN, DAYS_MAX, detMaximization.optimalHoldTime,
  ));

  // Yield grade
  const benchmarkYield = round2(clampNum(
    aiMax.benchmarkYield,
    0, 200, detMaximization.benchmarkYield,
  ));
  const yieldGrade = aiMax.yieldGrade
    ? clampEnum(aiMax.yieldGrade, VALID_GRADE, detMaximization.yieldGrade)
    : decideGrade(current.currentCashYield, maximizedCashYield, benchmarkYield);
  const yieldVsBenchmark = round2(clampNum(
    current.currentCashYield - benchmarkYield,
    YIELD_MIN, YIELD_MAX, 0,
  ));

  const maximization: MaximizedState = {
    maximizedCashYield,
    yieldOptimizationActions,
    yieldComparisonTable,
    optimalHoldTime,
    yieldGrade,
    benchmarkYield,
    yieldVsBenchmark,
  };

  const summary = clampString(parsed.summary, 400, buildSummary(current, maximization, heldCount));
  return { maximization, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const inventoryCashYieldMaximizerHandler = withAiRoute<InventoryCashYieldMaximizerInput>({
  endpoint: '/api/ai/inventory-cash-yield-maximizer',
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

    // 1) Parallel query HELD trades + SOLD trades (last 12m) for historical yield
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
              dealScore: true,
            },
          },
        },
        orderBy: { buyDate: 'asc' },
        take: 100000,
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
          currentCashYield: 0,
          avgHoldDays: 30,
          heldItemCount: 0,
        },
        maximization: {
          maximizedCashYield: 0,
          yieldOptimizationActions: [],
          yieldComparisonTable: [],
          optimalHoldTime: 30,
          yieldGrade: 'F',
          benchmarkYield: BENCHMARK_TYPICAL,
          yieldVsBenchmark: -BENCHMARK_TYPICAL,
        },
        perItem: [],
        summary: 'Ni HELD in SOLD trgovin — Inventory Cash Yield Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD in SOLD trgovin — Inventory Cash Yield Maximizer ni mogoč.',
      } satisfies InventoryCashYieldResponse);
    }

    // 2) Compute aggregates
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }

    const current = computeCurrent(heldComputed, soldComputed);

    let perItem = buildPerItem(heldComputed);
    let maximization = buildDeterministicMaximization(heldComputed, soldComputed, current);
    let summary = buildSummary(current, maximization, heldComputed.length);

    // 3) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = heldComputed.map((c) => c.tradeId).sort();
    const cacheKey = `inventory-cash-yield-maximizer:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      perItem: PerItemYield[];
      maximization: MaximizedState;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        perItem: cached.perItem,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryCashYieldResponse);
    }

    // 4) AI prompt with grounding
    // Sort entries by annualizedYield ASC (worst first) for AI prompt
    const sortedEntries = [...perItem].sort((a, b) => a.annualizedYield - b.annualizedYield);
    const topForPrompt = sortedEntries.slice(0, MAX_ITEMS_TO_PROCESS);

    const promptData = buildPromptData(
      heldComputed.length,
      soldComputed.filter((s) => s.within12m).length,
      current,
      topForPrompt,
      maximization,
    );
    const prompt = buildPrompt(promptData, topForPrompt.length);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const result = mergeAiResponse(parsed, maximization, current, heldComputed.length);
      maximization = result.maximization;
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-cash-yield-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { perItem, maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      perItem,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryCashYieldResponse);
  },
});

export const GET = inventoryCashYieldMaximizerHandler;
export const POST = inventoryCashYieldMaximizerHandler;
