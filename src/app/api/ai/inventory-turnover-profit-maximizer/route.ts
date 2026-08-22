// v8.00 / v8.96.6-batch4: AI Inventory Turnover Profit Maximizer — AI maksimizira profit preko
// OPTIMAL inventory turnover — najde popolno ravnovesje med turnover speed
// (hitrejši = več ciklov) in profit per cycle (višja margin = več € na prodajo).
// "Your optimal turnover rate is 3.5x/month giving 1200€/month — faster than
// current 2.8x and more profitable."
//
// Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ta
// maksimizira TURNOVER-PROFIT balance (ne compounding growth). Razlika od
// deal-profit-accelerator-pro (v7.99 ki accelera profit per item) — ta daje
// GLOBAL turnover-profit optimization (ne per-item). Razlika od
// inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta
// maksimizira MONTHLY PROFIT preko turnover optimization (ne ROI %). Razlika od
// profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ta
// fokusira na TURNOVER-PROFIT curve optimization (ne 8 levers). Razlika od
// inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) —
// ta maksimizira PROFIT (ne cash conversion speed). Razlika od
// inventory-roi-optimizer (v7.79 ki optimira ROI z rebalance) — ta maksimizira
// turnover-profit curve (ne ROI rebalance). Razlika od profit-velocity-
// maximizer (v7.98 ki maksimizira €/day velocity) — ta maksimizira MONTHLY
// PROFIT preko optimal turnover rate (ne velocity). Razlika od
// inventory-profit-maximizer (ki maksimizira profit na inventarju) — ta
// KOMBINIRA turnover + profit per cycle za max monthly profit.
//
// "Current: turnover 2.8x/mo, profit/cycle 320€, monthly profit 896€ (12
// items in inventory). Optimal: turnover 3.5x/mo, profit/cycle 340€, monthly
// profit 1190€ (+294€ uplift, grade A). Turnover actions: price -5% za stagnant
// items (HIGH, +0.4x), refresh listings weekly (MEDIUM, +0.3x). Profit actions:
// bundle for upsell (HIGH, +15€/cycle), premium photo (MEDIUM, +8€/cycle).
// Optimal inventory: 8 items (rebalance -4 items)."

// GET+POST /api/ai/inventory-turnover-profit-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type TurnoverProfitGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
  } | null;
}

interface CurrentState {
  currentTurnoverRate: number;
  currentProfitPerCycle: number;
  currentMonthlyProfit: number;
  currentInventorySize: number;
}

interface TurnoverProfitPoint {
  turnoverRate: number;
  profitPerCycle: number;
  monthlyProfit: number;
}

interface TurnoverAction {
  action: string;
  priority: Priority;
  expectedTurnoverImpact: number;
}

interface ProfitAction {
  action: string;
  priority: Priority;
  expectedProfitImpact: number;
}

interface Maximization {
  optimalTurnoverRate: number;
  optimalProfitPerCycle: number;
  maximizedMonthlyProfit: number;
  turnoverProfitUplift: number;
  turnoverActions: TurnoverAction[];
  profitActions: ProfitAction[];
  turnoverProfitGrade: TurnoverProfitGrade;
  optimalInventorySize: number;
  rebalancePlan: string;
}

interface InventoryTurnoverProfitResponse {
  ok: true;
  current: CurrentState;
  turnoverProfitCurve: TurnoverProfitPoint[];
  maximization: Maximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    optimalTurnoverRate?: number;
    optimalProfitPerCycle?: number;
    turnoverProfitGrade?: TurnoverProfitGrade;
    turnoverActions?: Array<{
      action?: string;
      priority?: Priority;
      expectedTurnoverImpact?: number;
    }>;
    profitActions?: Array<{
      action?: string;
      priority?: Priority;
      expectedProfitImpact?: number;
    }>;
    optimalInventorySize?: number;
    rebalancePlan?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const RATE_MIN = 0;
const RATE_MAX = 20;
const PROFIT_MIN = 0;
const PROFIT_MAX = 50_000;
const PROFIT_PER_CYCLE_MIN = 0;
const PROFIT_PER_CYCLE_MAX = 10_000;
const INVENTORY_MIN = 0;
const INVENTORY_MAX = 1_000;
const IMPACT_MIN = 0;
const IMPACT_MAX = 10; // rate impact ceiling
const PROFIT_IMPACT_MIN = 0;
const PROFIT_IMPACT_MAX = 5_000;
const MAX_ACTIONS = 5;

const VALID_PRIORITY: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_GRADE: readonly TurnoverProfitGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const CURVE_POINTS = 7; // 7 points on the turnover-profit curve
const OPTIMAL_RATE_BOOST = 1.25; // anti-hallucination: optimal ≤ current × 1.25 or +1.5

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
  sellMs: number;
  within12m: boolean;
  within1m: boolean;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const within1m = (now - sellMs) <= 30 * DAY_MS;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { profit, sellMs, within12m, within1m };
}

interface HeldComputed {
  estValue: number;
}

function computeHeldEstValue(t: HeldTradeRow): number {
  const buyPrice = t.buyPrice ?? 0;
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  if (listingEst && listingEst > 0) return Math.round(listingEst);
  if (listingPrice && listingPrice > 0) return Math.round(listingPrice);
  return Math.round(buyPrice * 1.1);
}

interface SoldAgg {
  soldCount1m: number;
  soldCount12m: number;
  totalProfit12m: number;
}

function aggregateSold(trades: SoldComputed[]): SoldAgg {
  let soldCount1m = 0;
  let soldCount12m = 0;
  let totalProfit12m = 0;
  for (const t of trades) {
    if (t.within1m) soldCount1m += 1;
    if (t.within12m) {
      soldCount12m += 1;
      totalProfit12m += t.profit;
    }
  }
  return { soldCount1m, soldCount12m, totalProfit12m };
}

function computeCurrentState(
  agg: SoldAgg,
  heldItems: HeldTradeRow[],
): CurrentState {
  const currentInventorySize = round0(clampNum(
    heldItems.length, INVENTORY_MIN, INVENTORY_MAX, 0,
  ));

  // currentTurnoverRate = items sold per month / avg inventory
  // Use last 12 months avg sold per month, divided by current inventory
  const avgSoldPerMonth = agg.soldCount12m / 12;
  const effectiveInventory = currentInventorySize > 0
    ? currentInventorySize
    : Math.max(1, Math.round(avgSoldPerMonth));
  const currentTurnoverRate = round2(clampNum(
    avgSoldPerMonth / effectiveInventory,
    RATE_MIN, RATE_MAX, 0,
  ));

  // currentProfitPerCycle = avg profit per sale
  const currentProfitPerCycle = round0(clampNum(
    agg.soldCount12m > 0 ? agg.totalProfit12m / agg.soldCount12m : 0,
    PROFIT_PER_CYCLE_MIN, PROFIT_PER_CYCLE_MAX, 0,
  ));

  // currentMonthlyProfit = turnoverRate × profitPerCycle × inventorySize
  // But to be consistent with "monthly profit", we use:
  // monthlyProfit = (soldPerMonth) × (profitPerCycle)
  // = (turnoverRate × inventorySize) × profitPerCycle
  const currentMonthlyProfit = round0(clampNum(
    currentTurnoverRate * currentInventorySize * currentProfitPerCycle,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  return {
    currentTurnoverRate,
    currentProfitPerCycle,
    currentMonthlyProfit,
    currentInventorySize,
  };
}

// Turnover-profit curve: 7 points around current rate
// Hypothesis: profit per cycle DECREASES as turnover increases (faster = lower margins)
// But monthly profit PEAKS at some optimal rate
function buildTurnoverProfitCurve(
  current: CurrentState,
): TurnoverProfitPoint[] {
  const points: TurnoverProfitPoint[] = [];
  const baseRate = Math.max(0.5, current.currentTurnoverRate);
  // Multipliers around current rate: 0.5x, 0.75x, 1x (current), 1.25x, 1.5x, 2x, 2.75x
  const multipliers = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.75];
  for (const mult of multipliers) {
    const rate = round2(clampNum(baseRate * mult, RATE_MIN, RATE_MAX, 0));
    // Profit per cycle DECREASES as turnover increases (faster sales = lower margins)
    // At 0.5x: profitPerCycle = current × 1.15 (slower = higher margin)
    // At 1.0x: profitPerCycle = current × 1.0
    // At 2.75x: profitPerCycle = current × 0.75 (faster = lower margin)
    const cycleMult = clampNum(
      1.15 - (mult - 0.5) * 0.18,
      0.5, 1.3, 1.0,
    );
    const profitPerCycle = round0(clampNum(
      current.currentProfitPerCycle * cycleMult,
      PROFIT_PER_CYCLE_MIN, PROFIT_PER_CYCLE_MAX, 0,
    ));
    const monthlyProfit = round0(clampNum(
      rate * current.currentInventorySize * profitPerCycle,
      PROFIT_MIN, PROFIT_MAX, 0,
    ));
    points.push({ turnoverRate: rate, profitPerCycle, monthlyProfit });
  }
  return points;
}

function findOptimalRate(curve: TurnoverProfitPoint[]): {
  optimalRate: number;
  optimalProfitPerCycle: number;
  maximizedMonthlyProfit: number;
} {
  if (curve.length === 0) {
    return { optimalRate: 0, optimalProfitPerCycle: 0, maximizedMonthlyProfit: 0 };
  }
  let best = curve[0];
  for (const p of curve) {
    if (p.monthlyProfit > best.monthlyProfit) best = p;
  }
  return {
    optimalRate: best.turnoverRate,
    optimalProfitPerCycle: best.profitPerCycle,
    maximizedMonthlyProfit: best.monthlyProfit,
  };
}

function decideGrade(upliftPct: number): TurnoverProfitGrade {
  // upliftPct = (maximized - current) / current × 100
  // A+ if >= 50%, A if >= 35%, B if >= 20%, C if >= 10%, D if >= 5%, else F
  if (upliftPct >= 50) return 'A+';
  if (upliftPct >= 35) return 'A';
  if (upliftPct >= 20) return 'B';
  if (upliftPct >= 10) return 'C';
  if (upliftPct >= 5) return 'D';
  return 'F';
}

function buildTurnoverActions(current: CurrentState): TurnoverAction[] {
  const actions: TurnoverAction[] = [];

  // If turnover is low, suggest speed-up actions
  actions.push({
    action: clampString(
      `Auto-discount -5% po 14 dneh hold in -10% po 30 dneh za hitrejši turnover.`,
      200,
      'Implementiraj auto-discount za stagnant items.',
    ),
    priority: 'HIGH',
    expectedTurnoverImpact: round2(clampNum(
      0.4, IMPACT_MIN, IMPACT_MAX, 0.4,
    )),
  });

  actions.push({
    action: clampString(
      `Osveži listing-e tedensko (datum, naslov, foto) za vrh search-a in +25% CTR.`,
      200,
      'Osveži listing-e tedensko.',
    ),
    priority: 'MEDIUM',
    expectedTurnoverImpact: round2(clampNum(
      0.3, IMPACT_MIN, IMPACT_MAX, 0.3,
    )),
  });

  actions.push({
    action: clampString(
      `Cross-post na 3 platforme (Bolha + Vinted + FB Marketplace) za +50% prodajne verjetnosti.`,
      200,
      'Cross-post na 3 platforme.',
    ),
    priority: 'MEDIUM',
    expectedTurnoverImpact: round2(clampNum(
      0.35, IMPACT_MIN, IMPACT_MAX, 0.35,
    )),
  });

  actions.push({
    action: clampString(
      `Ciljaj weekend peak time (petek 18-20h) za objavo/refresh za max visibility.`,
      200,
      'Ciljaj weekend peak time.',
    ),
    priority: 'LOW',
    expectedTurnoverImpact: round2(clampNum(
      0.15, IMPACT_MIN, IMPACT_MAX, 0.15,
    )),
  });

  return actions.slice(0, MAX_ACTIONS);
}

function buildProfitActions(current: CurrentState): ProfitAction[] {
  const actions: ProfitAction[] = [];

  actions.push({
    action: clampString(
      `Bundle komplementarne item-e (iPhone + case + cable) za +15€/cycle upsell.`,
      200,
      'Bundle za upsell.',
    ),
    priority: 'HIGH',
    expectedProfitImpact: round0(clampNum(
      15, PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, 15,
    )),
  });

  actions.push({
    action: clampString(
      `Naredi nove foto z boljšo osvetlitvijo in "restored" angle za premium cena +8€/cycle.`,
      200,
      'Naredi nove foto z boljšo osvetlitvijo.',
    ),
    priority: 'MEDIUM',
    expectedProfitImpact: round0(clampNum(
      8, PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, 8,
    )),
  });

  actions.push({
    action: clampString(
      `Negotiate nižje nabavne cene (-10%) za +${Math.max(5, Math.round(current.currentProfitPerCycle * 0.1))}€/cycle margin.`,
      200,
      'Negotiate nižje nabavne cene.',
    ),
    priority: 'HIGH',
    expectedProfitImpact: round0(clampNum(
      Math.max(5, Math.round(current.currentProfitPerCycle * 0.1)),
      PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, 5,
    )),
  });

  actions.push({
    action: clampString(
      `Dodaj "limited time offer" urgency v opis za +5% konverzijo pri isti ceni.`,
      200,
      'Dodaj limited time offer.',
    ),
    priority: 'LOW',
    expectedProfitImpact: round0(clampNum(
      5, PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, 5,
    )),
  });

  return actions.slice(0, MAX_ACTIONS);
}

function buildMaximization(
  current: CurrentState,
  curve: TurnoverProfitPoint[],
): Maximization {
  const opt = findOptimalRate(curve);

  // Anti-hallucination: optimalTurnoverRate ≤ current × 1.5 or +2 absolute
  const optimalRateBound = Math.min(
    RATE_MAX,
    Math.max(
      current.currentTurnoverRate + 0.5,
      current.currentTurnoverRate * OPTIMAL_RATE_BOOST + 0.5,
    ),
  );
  const optimalTurnoverRate = round2(clampNum(
    opt.optimalRate, current.currentTurnoverRate, optimalRateBound, opt.optimalRate,
  ));

  const optimalProfitPerCycle = round0(clampNum(
    opt.optimalProfitPerCycle,
    Math.min(current.currentProfitPerCycle, opt.optimalProfitPerCycle),
    Math.max(current.currentProfitPerCycle, opt.optimalProfitPerCycle * 1.1),
    opt.optimalProfitPerCycle,
  ));

  const maximizedMonthlyProfit = round0(clampNum(
    optimalTurnoverRate * current.currentInventorySize * optimalProfitPerCycle,
    PROFIT_MIN, PROFIT_MAX, opt.maximizedMonthlyProfit,
  ));

  const turnoverProfitUplift = round0(clampNum(
    maximizedMonthlyProfit - current.currentMonthlyProfit,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Uplift percentage for grading
  const upliftPct = current.currentMonthlyProfit > 0
    ? (turnoverProfitUplift / current.currentMonthlyProfit) * 100
    : 0;
  const turnoverProfitGrade = decideGrade(clampNum(
    upliftPct, 0, 200, 0,
  ));

  // Optimal inventory size: if we want faster turnover, we need fewer items
  // Ideal inventory = maxSoldPerMonth / optimalTurnoverRate
  // If current turnover is too slow → reduce inventory (clear old stock)
  // If too fast → add inventory (we're losing sales)
  let optimalInventorySize: number;
  if (current.currentTurnoverRate === 0) {
    optimalInventorySize = current.currentInventorySize;
  } else {
    const ratio = current.currentTurnoverRate > 0
      ? optimalTurnoverRate / current.currentTurnoverRate
      : 1;
    if (ratio > 1.1) {
      // Want faster turnover → keep inventory similar or slightly less
      optimalInventorySize = Math.max(1, Math.round(current.currentInventorySize * 0.8));
    } else if (ratio < 0.9) {
      // Want slower turnover → add inventory
      optimalInventorySize = Math.round(current.currentInventorySize * 1.2);
    } else {
      optimalInventorySize = current.currentInventorySize;
    }
  }
  optimalInventorySize = round0(clampNum(
    optimalInventorySize, INVENTORY_MIN, INVENTORY_MAX, current.currentInventorySize,
  ));

  const turnoverActions = buildTurnoverActions(current);
  const profitActions = buildProfitActions(current);

  const rebalancePlan = clampString(
    optimalInventorySize < current.currentInventorySize
      ? `REBALANCE: zmanjšaj inventar iz ${current.currentInventorySize} na ${optimalInventorySize} item-ov — prodaj stagnant item-e z -10% popustom za hitrejši turnover. Ciljaj ${optimalTurnoverRate}x/mo rate z ${optimalProfitPerCycle}€/cycle profit.`
      : optimalInventorySize > current.currentInventorySize
        ? `REBALANCE: povečaj inventar iz ${current.currentInventorySize} na ${optimalInventorySize} item-ov — dodaj nove high-dealScore sourcing deals za podporo ${optimalTurnoverRate}x/mo rate.`
        : `REBALANCE: ohrani inventar na ${optimalInventorySize} item-ov — izboljšaj pricing in turnover actions za ${optimalTurnoverRate}x/mo optimal rate.`,
    400,
    `Rebalanceraj inventar za optimal turnover-profit balance.`,
  );

  return {
    optimalTurnoverRate,
    optimalProfitPerCycle,
    maximizedMonthlyProfit,
    turnoverProfitUplift,
    turnoverActions,
    profitActions,
    turnoverProfitGrade,
    optimalInventorySize,
    rebalancePlan,
  };
}

function buildSummary(
  current: CurrentState,
  maximization: Maximization,
): string {
  const parts: string[] = [
    `Current: turnover ${current.currentTurnoverRate}x/mo, profit/cycle ${current.currentProfitPerCycle}€, monthly ${current.currentMonthlyProfit}€ (${current.currentInventorySize} items).`,
    `Optimal: ${maximization.optimalTurnoverRate}x/mo, ${maximization.optimalProfitPerCycle}€/cycle → ${maximization.maximizedMonthlyProfit}€/mo (+${maximization.turnoverProfitUplift}€ uplift).`,
    `Grade: ${maximization.turnoverProfitGrade}. Optimal inventory: ${maximization.optimalInventorySize} items.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryTurnoverProfitInput {}

// --- Handler -------------------------------------------------------------

const inventoryTurnoverProfitHandler = withAiRoute<InventoryTurnoverProfitInput>({
  endpoint: '/api/ai/inventory-turnover-profit-maximizer',
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

    // 1) Query SOLD trades last 12 months + HELD trades (parallel)
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
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
            },
          },
        },
        take: 100000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD trades and no HELD inventory
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentTurnoverRate: 0,
          currentProfitPerCycle: 0,
          currentMonthlyProfit: 0,
          currentInventorySize: 0,
        },
        turnoverProfitCurve: [],
        maximization: {
          optimalTurnoverRate: 0,
          optimalProfitPerCycle: 0,
          maximizedMonthlyProfit: 0,
          turnoverProfitUplift: 0,
          turnoverActions: [],
          profitActions: [],
          turnoverProfitGrade: 'F',
          optimalInventorySize: 0,
          rebalancePlan: 'Ni SOLD trgovin in HELD inventorija — Inventory Turnover Profit Maximizer ni mogoč.',
        },
        summary: 'Ni SOLD trgovin in HELD inventorija — Inventory Turnover Profit Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin in HELD inventorija — Inventory Turnover Profit Maximizer ni mogoč.',
      } satisfies InventoryTurnoverProfitResponse);
    }

    // 2) Compute current state
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }

    const agg = aggregateSold(soldComputed);
    const current = computeCurrentState(agg, heldTrades);

    // If no sold trades but held inventory exists, set baseline from held
    if (agg.soldCount12m === 0 && heldTrades.length > 0) {
      let heldValue = 0;
      for (const h of heldTrades) {
        heldValue += computeHeldEstValue(h);
      }
      current.currentProfitPerCycle = round0(clampNum(
        heldValue / heldTrades.length * 0.2,
        PROFIT_PER_CYCLE_MIN, PROFIT_PER_CYCLE_MAX, 0,
      ));
      current.currentTurnoverRate = 1; // baseline assumption
      current.currentMonthlyProfit = round0(clampNum(
        current.currentTurnoverRate * current.currentInventorySize * current.currentProfitPerCycle,
        PROFIT_MIN, PROFIT_MAX, 0,
      ));
    }

    const turnoverProfitCurve = buildTurnoverProfitCurve(current);
    let maximization = buildMaximization(current, turnoverProfitCurve);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-turnover-profit-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: Maximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        turnoverProfitCurve,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryTurnoverProfitResponse);
    }

    // 4) AI prompt with grounding
    const promptData = {
      soldCount12m: agg.soldCount12m,
      soldCount1m: agg.soldCount1m,
      totalProfit12m: agg.totalProfit12m,
      heldCount: heldTrades.length,
      current,
      turnoverProfitCurve,
      deterministicMaximization: {
        optimalTurnoverRate: maximization.optimalTurnoverRate,
        optimalProfitPerCycle: maximization.optimalProfitPerCycle,
        maximizedMonthlyProfit: maximization.maximizedMonthlyProfit,
        turnoverProfitUplift: maximization.turnoverProfitUplift,
        turnoverProfitGrade: maximization.turnoverProfitGrade,
        optimalInventorySize: maximization.optimalInventorySize,
        rebalancePlan: maximization.rebalancePlan,
      },
      caps: {
        rateMin: RATE_MIN, rateMax: RATE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        profitPerCycleMin: PROFIT_PER_CYCLE_MIN, profitPerCycleMax: PROFIT_PER_CYCLE_MAX,
        inventoryMin: INVENTORY_MIN, inventoryMax: INVENTORY_MAX,
        impactMin: IMPACT_MIN, impactMax: IMPACT_MAX,
        profitImpactMin: PROFIT_IMPACT_MIN, profitImpactMax: PROFIT_IMPACT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Turnover Profit Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za TURNOVER-PROFIT maximization — identificiraš OPTIMAL turnover rate ki maksimizira TOTAL monthly profit z ravnovesjem med turnover speed (hitrejši = več ciklov) in profit per cycle (višja margin = več € na prodajo). Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ti maksimiziraš TURNOVER-PROFIT balance (ne compounding growth). Razlika od deal-profit-accelerator-pro (v7.99 ki accelera profit per item) — ti daje GLOBAL turnover-profit optimization (ne per-item). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti maksimiziraš MONTHLY PROFIT preko turnover optimization (ne ROI %). Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na TURNOVER-PROFIT curve optimization. Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) — ti maksimiziraš PROFIT (ne cash conversion speed). Razlika od inventory-roi-optimizer (v7.79 ki optimira ROI z rebalance) — ti maksimiziraš turnover-profit curve (ne ROI rebalance). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti maksimiziraš MONTHLY PROFIT preko optimal turnover rate.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventorij):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.optimalTurnoverRate [0, 20] (≥ currentTurnoverRate, ≤ current × 1.25 + 0.5 ali +2 — anti-hallucination),
2. maximization.optimalProfitPerCycle € [0, 10000] (v dosegljivem rangu od current),
3. maximization.turnoverProfitGrade: A+ | A | B | C | D | F (A+ če uplift ≥ 50%, A ≥ 35%, B ≥ 20%, C ≥ 10%, D ≥ 5%, else F),
4. maximization.turnoverActions: 3-5 akcij { action (max 200, slovenski), priority HIGH | MEDIUM | LOW, expectedTurnoverImpact [0, 10] (koliko x rate impact) },
5. maximization.profitActions: 3-5 akcij { action (max 200, slovenski), priority HIGH | MEDIUM | LOW, expectedProfitImpact € [0, 5000] (koliko €/cycle impact) },
6. maximization.optimalInventorySize [0, 1000] (ideal število item-ov za max profit),
7. maximization.rebalancePlan (max 400, slovenski — kako adjust-at inventory size in pricing),
8. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "maximization": {
    "optimalTurnoverRate": 3.5,
    "optimalProfitPerCycle": 340,
    "turnoverProfitGrade": "A",
    "turnoverActions": [
      { "action": "Auto-discount -5% po 14 dneh hold.", "priority": "HIGH", "expectedTurnoverImpact": 0.4 },
      { "action": "Cross-post na 3 platforme.", "priority": "MEDIUM", "expectedTurnoverImpact": 0.35 }
    ],
    "profitActions": [
      { "action": "Bundle komplementarne item-e.", "priority": "HIGH", "expectedProfitImpact": 15 },
      { "action": "Naredi nove foto z boljšo osvetlitvijo.", "priority": "MEDIUM", "expectedProfitImpact": 8 }
    ],
    "optimalInventorySize": 8,
    "rebalancePlan": "REBALANCE: zmanjšaj inventar iz 12 na 8 item-ov — prodaj stagnant item-e z -10% popustom za hitrejši turnover. Ciljaj 3.5x/mo rate z 340€/cycle profit."
  },
  "summary": "Current: turnover 2.8x/mo, profit/cycle 320€, monthly 896€. Optimal: 3.5x/mo, 340€/cycle → 1190€/mo (+294€ uplift, grade A)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Anti-hallucination: optimalTurnoverRate ∈ [current, current × 1.25 + 0.5]
        const optimalRateBound = Math.min(
          RATE_MAX,
          Math.max(
            current.currentTurnoverRate + 0.5,
            current.currentTurnoverRate * OPTIMAL_RATE_BOOST + 0.5,
          ),
        );
        const optimalTurnoverRate = round2(clampNum(
          aiMax.optimalTurnoverRate,
          current.currentTurnoverRate, optimalRateBound,
          maximization.optimalTurnoverRate,
        ));

        // Optimal profit per cycle: clamp to reasonable range
        const cycleLowBound = Math.min(
          current.currentProfitPerCycle,
          maximization.optimalProfitPerCycle,
        );
        const cycleHighBound = Math.max(
          current.currentProfitPerCycle * 1.3,
          maximization.optimalProfitPerCycle * 1.1,
        );
        const optimalProfitPerCycle = round0(clampNum(
          aiMax.optimalProfitPerCycle,
          cycleLowBound, cycleHighBound,
          maximization.optimalProfitPerCycle,
        ));

        // Recompute maximized monthly profit
        const maximizedMonthlyProfit = round0(clampNum(
          optimalTurnoverRate * current.currentInventorySize * optimalProfitPerCycle,
          PROFIT_MIN, PROFIT_MAX, maximization.maximizedMonthlyProfit,
        ));
        const turnoverProfitUplift = round0(clampNum(
          maximizedMonthlyProfit - current.currentMonthlyProfit,
          PROFIT_MIN, PROFIT_MAX, 0,
        ));

        const turnoverProfitGrade = clampEnum(
          aiMax.turnoverProfitGrade,
          VALID_GRADE,
          maximization.turnoverProfitGrade,
        );

        // Turnover actions
        const turnoverActions: TurnoverAction[] = [];
        if (Array.isArray(aiMax.turnoverActions)) {
          for (const a of aiMax.turnoverActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            turnoverActions.push({
              action: clampString(a.action, 200, 'Akcija.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
              expectedTurnoverImpact: round2(clampNum(
                a.expectedTurnoverImpact,
                IMPACT_MIN, IMPACT_MAX, 0,
              )),
            });
          }
        }
        if (turnoverActions.length === 0) {
          for (const a of maximization.turnoverActions) turnoverActions.push(a);
        }

        // Profit actions
        const profitActions: ProfitAction[] = [];
        if (Array.isArray(aiMax.profitActions)) {
          for (const a of aiMax.profitActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            profitActions.push({
              action: clampString(a.action, 200, 'Akcija.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
              expectedProfitImpact: round0(clampNum(
                a.expectedProfitImpact,
                PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, 0,
              )),
            });
          }
        }
        if (profitActions.length === 0) {
          for (const a of maximization.profitActions) profitActions.push(a);
        }

        // Optimal inventory size
        const inventoryLowBound = Math.max(0, Math.min(
          current.currentInventorySize,
          maximization.optimalInventorySize,
        ));
        const inventoryHighBound = Math.max(
          current.currentInventorySize * 1.5,
          maximization.optimalInventorySize * 1.2,
        );
        const optimalInventorySize = round0(clampNum(
          aiMax.optimalInventorySize,
          inventoryLowBound, Math.max(inventoryHighBound, inventoryLowBound + 1),
          maximization.optimalInventorySize,
        ));

        const rebalancePlan = clampString(
          aiMax.rebalancePlan,
          400,
          maximization.rebalancePlan,
        );

        maximization = {
          optimalTurnoverRate,
          optimalProfitPerCycle,
          maximizedMonthlyProfit,
          turnoverProfitUplift,
          turnoverActions,
          profitActions,
          turnoverProfitGrade,
          optimalInventorySize,
          rebalancePlan,
        };

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-profit-maximizer',
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
      turnoverProfitCurve,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryTurnoverProfitResponse);
  },
});

export const GET = inventoryTurnoverProfitHandler;
export const POST = inventoryTurnoverProfitHandler;
