// v8.09 / v8.96.7-batch4: AI Profit Multiplier Maximizer — AI MAKSIMIZIRA MAXIMUM PROFIT
// MULTIPLIER — koliko-krat je mogoče pomnožiti trenutni profit z vsemi
// optimizacijami simultano. "Tvoj profit je 2000€/mo. Z vsemi optimizacijami
// bi lahko bil 7.2× = 14,400€/mo." Razlika od profit-per-day-scaling-maximizer
// (v8.08 ki maksimizira in skalira DAILY PROFIT z scalingPath phases) — ta
// MAKSIMIZIRA PROFIT MULTIPLIER (cumulative product vseh 6 dimensions
// pricing/volume/sourcing/turnover/channel/efficiency, ne daily profit scaling).
// Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per euro
// deployed — capital efficiency ratio) — ta MAKSIMIZIRA PROFIT MULTIPLIER
// (koliko-krat × profit, ne €/€ ratio). Razlika od revenue-per-trade-maximizer
// (v8.06 ki maksimizira top-line sell price per trade) — ta MAKSIMIZIRA PROFIT
// MULTIPLIER z 6 dimension multipliers in cumulativeMaxMultiplier. Razlika od
// deal-source-cash-flow-maximizer (v8.06 ki maksimizira cash flow per source)
// — ta MAKSIMIZIRA PROFIT MULTIPLIER čez celoten portfolio z multiplierGrade
// in multiplierProjection. Razlika od inventory-annualized-return-maximizer
// (v8.06 ki maksimizira annualized % return na held inventory) — ta maksimizira
// PROFIT MULTIPLIER (× koliko-krat, ne % return). Razlika od
// inventory-capital-return-maximizer (v8.07 ki maksimizira return OF capital)
// — ta maksimizira PROFIT MULTIPLIER (return ON profit scaled, ne capital
// returned). Razlika od profit-scale-engine (v7.96 ki skalira profit z growth
// engine) — ta MAKSIMIZIRA PROFIT MULTIPLIER z 6 dimension multipliers
// (pricing/volume/sourcing/turnover/channel/efficiency) in cumulativeMaxMultiplier.
// Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity)
// — ta maksimizira PROFIT MULTIPLIER (cumulative ×, ne €/day velocity).
// Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate
// acceleration) — ta MAKSIMIZIRA PROFIT MULTIPLIER z multiplierGrade in
// topMultiplierActions. Razlika od profit-multiplier-engine (v7.96 ki ima
// multiplier-like scoring) — ta MAKSIMIZIRA PROFIT MULTIPLIER z
// cumulativeMaxMultiplier (compounding product vseh 6 dimensions) in
// multiplierProjection (3/6/12 month profit at maximized multiplier).

// GET+POST /api/ai/profit-multiplier-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type MultiplierGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type MultiplierDimension =
  | 'PRICING'
  | 'VOLUME'
  | 'SOURCING'
  | 'TURNOVER'
  | 'CHANNEL'
  | 'EFFICIENCY';

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
  monthlyProfit: number; // €/mo (= totalProfit12m / 12)
  avgROI: number; // % (= totalProfit12m / soldCapital × 100)
  avgHoldDays: number; // days
  tradeVolume: number; // trades/12m
  capitalDeployed: number; // € (SOLD 12m + HELD)
  totalProfit12m: number; // €
  soldCount12m: number;
  heldCount: number;
}

interface MaximizerAction {
  dimension: MultiplierDimension;
  action: string; // slovenski, max 200
  expectedMultiplierLift: number; // × [1.0, 3.0]
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface MultiplierBreakdownEntry {
  dimension: MultiplierDimension;
  multiplier: number; // [1.0, 3.0]
  contribution: number; // % share of cumulative
  rationale: string; // slovenski, max 200
}

interface MultiplierProjectionEntry {
  months: number; // 3 / 6 / 12
  projectedProfit: number; // € = current × cumulative × adoption
}

interface ProfitMultiplierMaximization {
  pricingMultiplier: number; // [1.0, 2.0]
  volumeMultiplier: number; // [1.0, 3.0]
  sourcingMultiplier: number; // [1.0, 2.0]
  turnoverMultiplier: number; // [1.0, 2.5]
  channelMultiplier: number; // [1.0, 1.5]
  efficiencyMultiplier: number; // [1.0, 1.5]
  cumulativeMaxMultiplier: number; // product of all 6, [1.0, 50.0]
  maximizedMonthlyProfit: number; // € [0, 200000]
  maximizationBreakdown: MultiplierBreakdownEntry[]; // 6 entries
  multiplierGrade: MultiplierGrade;
  topMultiplierActions: MaximizerAction[]; // 6-8 entries
  multiplierProjection: MultiplierProjectionEntry[]; // 3 entries (3/6/12 month)
}

interface ProfitMultiplierResponse {
  ok: true;
  current: CurrentState;
  maximization: ProfitMultiplierMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    pricingMultiplier?: number;
    volumeMultiplier?: number;
    sourcingMultiplier?: number;
    turnoverMultiplier?: number;
    channelMultiplier?: number;
    efficiencyMultiplier?: number;
    cumulativeMaxMultiplier?: number;
    maximizedMonthlyProfit?: number;
    maximizationBreakdown?: Array<{
      dimension?: MultiplierDimension;
      multiplier?: number;
      contribution?: number;
      rationale?: string;
    }>;
    multiplierGrade?: MultiplierGrade;
    topMultiplierActions?: Array<{
      dimension?: MultiplierDimension;
      action?: string;
      expectedMultiplierLift?: number;
      priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    }>;
    multiplierProjection?: Array<{
      months?: number;
      projectedProfit?: number;
    }>;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const MONTHLY_PROFIT_MIN = 0;
const MONTHLY_PROFIT_MAX = 200_000;
const ROI_MIN = -100;
const ROI_MAX = 500;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const HOLD_MIN = 1;
const HOLD_MAX = 730;
const TRADES_MIN = 0;
const TRADES_MAX = 10_000;

// Per-dimension multiplier caps (anti-hallucination)
const PRICING_MULT_MIN = 1.0;
const PRICING_MULT_MAX = 2.0;
const VOLUME_MULT_MIN = 1.0;
const VOLUME_MULT_MAX = 3.0;
const SOURCING_MULT_MIN = 1.0;
const SOURCING_MULT_MAX = 2.0;
const TURNOVER_MULT_MIN = 1.0;
const TURNOVER_MULT_MAX = 2.5;
const CHANNEL_MULT_MIN = 1.0;
const CHANNEL_MULT_MAX = 1.5;
const EFFICIENCY_MULT_MIN = 1.0;
const EFFICIENCY_MULT_MAX = 1.5;

const CUMULATIVE_MIN = 1.0;
const CUMULATIVE_MAX = 50.0;

const CONTRIBUTION_MIN = 0;
const CONTRIBUTION_MAX = 100;

const UPLIFT_MIN = 1.0;
const UPLIFT_MAX = 3.0;

const PROJECTION_MIN = 0;
const PROJECTION_MAX = 200_000;

const VALID_GRADE: readonly MultiplierGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_DIMENSION: readonly MultiplierDimension[] = [
  'PRICING',
  'VOLUME',
  'SOURCING',
  'TURNOVER',
  'CHANNEL',
  'EFFICIENCY',
];
const VALID_PRIORITY: readonly ('HIGH' | 'MEDIUM' | 'LOW')[] = ['HIGH', 'MEDIUM', 'LOW'];

const MAX_BREAKDOWN = 6;
const MAX_ACTIONS = 8;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;

// Per-dimension deterministic multiplier baseline (driven by current state)
// These are MAXIMUM achievable multipliers per dimension — anti-hallucination bounds
function pricingMultiplierMax(_c: CurrentState): number {
  return 1.6; // +60% profit per trade with optimal pricing
}
function volumeMultiplierMax(c: CurrentState): number {
  // Lower trade volume → higher room to grow
  if (c.tradeVolume < 12) return 3.0; // < 1 trade/mo → 3×
  if (c.tradeVolume < 50) return 2.4;
  if (c.tradeVolume < 150) return 1.9;
  return 1.5;
}
function sourcingMultiplierMax(_c: CurrentState): number {
  return 1.7; // +70% by better buy prices
}
function turnoverMultiplierMax(c: CurrentState): number {
  // Longer holds → higher room to compress
  if (c.avgHoldDays > 90) return 2.5;
  if (c.avgHoldDays > 45) return 2.0;
  if (c.avgHoldDays > 21) return 1.7;
  return 1.3;
}
function channelMultiplierMax(_c: CurrentState): number {
  return 1.4; // +40% by cross-platform listings
}
function efficiencyMultiplierMax(_c: CurrentState): number {
  return 1.3; // +30% by reduced fees
}

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

interface HeldComputed {
  capital: number;
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

  const monthlyProfit = round2(clampNum(
    totalProfit12m / 12,
    MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, 0,
  ));

  const avgROI = round2(clampNum(
    soldCapital > 0 ? (totalProfit12m / soldCapital) * 100 : 0,
    ROI_MIN, ROI_MAX, 0,
  ));

  const avgHoldDays = round0(clampNum(
    soldCount > 0
      ? sold.reduce((s, t) => s + t.holdDays, 0) / soldCount
      : 0,
    soldCount > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
  ));

  return {
    monthlyProfit,
    avgROI,
    avgHoldDays,
    tradeVolume: round0(clampNum(soldCount, TRADES_MIN, TRADES_MAX, 0)),
    capitalDeployed,
    totalProfit12m,
    soldCount12m: soldCount,
    heldCount,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildMaximizationBreakdown(
  current: CurrentState,
  multipliers: {
    pricing: number;
    volume: number;
    sourcing: number;
    turnover: number;
    channel: number;
    efficiency: number;
  },
): MultiplierBreakdownEntry[] {
  const entries: Array<[MultiplierDimension, number, string]> = [
    [
      'PRICING',
      multipliers.pricing,
      `Optimalna pricing strategija (AI pricing engine, premium fotografija, dynamic pricing) dvigne profit per trade z ${(current.monthlyProfit / Math.max(1, current.tradeVolume)).toFixed(2)}€ na ${((current.monthlyProfit / Math.max(1, current.tradeVolume)) * multipliers.pricing).toFixed(2)}€ per trade.`,
    ],
    [
      'VOLUME',
      multipliers.volume,
      `Povečan trade volume z ${current.tradeVolume} na ${Math.round(current.tradeVolume * multipliers.volume)} trades/12m z več monitorji, nižjim deal score threshold in auto-buy.`,
    ],
    [
      'SOURCING',
      multipliers.sourcing,
      `Boljši sourcing z Bolha + Vinted premium listings, deal score > 80 in cross-border sourcing (Kleinanzeigen/Subito) zniža buy price za 15-25%.`,
    ],
    [
      'TURNOVER',
      multipliers.turnover,
      `Hitrejši turnover z avg hold days ${current.avgHoldDays} → ${Math.round(current.avgHoldDays / multipliers.turnover)} (listing-refresh-scheduler, auto-relisting, optimal timing).`,
    ],
    [
      'CHANNEL',
      multipliers.channel,
      `Multi-platform listings (Bolha + Vinted + Avtonet + mobile.de) povečajo exposure za +${Math.round((multipliers.channel - 1) * 100)}% close rate.`,
    ],
    [
      'EFFICIENCY',
      multipliers.efficiency,
      `Znižani fees in carrying costs z optimal fee structure, bundle deals in tax-aware selling (+${Math.round((multipliers.efficiency - 1) * 100)}% net profit).`,
    ],
  ];

  // Compute contribution = (mult - 1) / sum(mult - 1)
  const sumLift = entries.reduce((s, [, m]) => s + Math.max(0, m - 1), 0);
  return entries.slice(0, MAX_BREAKDOWN).map(([dim, mult, rationale]) => ({
    dimension: dim,
    multiplier: round2(mult),
    contribution: round0(clampNum(
      sumLift > 0 ? (Math.max(0, mult - 1) / sumLift) * 100 : 0,
      CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
    )),
    rationale: clampString(rationale, 200, 'Maximization rationale neopisan.'),
  }));
}

function buildTopActions(
  current: CurrentState,
  multipliers: {
    pricing: number;
    volume: number;
    sourcing: number;
    turnover: number;
    channel: number;
    efficiency: number;
  },
): MaximizerAction[] {
  const out: MaximizerAction[] = [];

  // Order by (mult-1) descending — biggest lift first
  const sortedPairs: Array<[MultiplierDimension, number]> = [
    ['VOLUME', multipliers.volume],
    ['TURNOVER', multipliers.turnover],
    ['SOURCING', multipliers.sourcing],
    ['PRICING', multipliers.pricing],
    ['CHANNEL', multipliers.channel],
    ['EFFICIENCY', multipliers.efficiency],
  ];
  const sorted = sortedPairs.sort((a, b) => (b[1] - 1) - (a[1] - 1));

  const actionText: Record<MultiplierDimension, string> = {
    PRICING: `Vklopi AI pricing engine in dynamic pricing — dvigni profit per trade z ${(current.monthlyProfit / Math.max(1, current.tradeVolume)).toFixed(2)}€ na ${((current.monthlyProfit / Math.max(1, current.tradeVolume)) * multipliers.pricing).toFixed(2)}€.`,
    VOLUME: `Dodaj 3 nove monitorje z keyword expansion, znižaj deal score threshold z 70 na 60, omogoči auto-buy za deal score > 85 — povečaj volume z ${current.tradeVolume} na ${Math.round(current.tradeVolume * multipliers.volume)} trades/12m.`,
    SOURCING: `Aktiviraj cross-border sourcing (Kleinanzeigen + Subito + Willhaben) in Bolha/Vinted premium filter za deal score > 80 — znižaj buy price za 15-25%.`,
    TURNOVER: `Vklopi listing-refresh-scheduler in auto-relisting-scheduler za vse stale HELD items — skrajšaj hold z ${current.avgHoldDays} na ${Math.round(current.avgHoldDays / multipliers.turnover)} dni.`,
    CHANNEL: `Aktiviraj multi-platform-listing-generator in cross-platform-listing-generator — vsak listing na 3+ platformah (Bolha + Vinted + Avtonet).`,
    EFFICIENCY: `Optimiziraj fee structure z bundle deals, tax-aware selling, in carrying cost reduction — znižaj total fees za 20-30%.`,
  };

  const priorityByLift = (lift: number): 'HIGH' | 'MEDIUM' | 'LOW' =>
    lift >= 1.5 ? 'HIGH' : lift >= 1.25 ? 'MEDIUM' : 'LOW';

  for (const [dim, mult] of sorted) {
    out.push({
      dimension: dim,
      action: clampString(actionText[dim], 200, `Optimizacija ${dim.toLowerCase()} dimension.`),
      expectedMultiplierLift: round2(clampNum(mult, UPLIFT_MIN, UPLIFT_MAX, 1.0)),
      priority: priorityByLift(mult),
    });
  }

  return out.slice(0, MAX_ACTIONS);
}

function buildMultiplierProjection(
  current: CurrentState,
  cumulative: number,
): MultiplierProjectionEntry[] {
  const projections: MultiplierProjectionEntry[] = [];
  for (const months of [3, 6, 12]) {
    // Linear ramp: 3m=25%, 6m=50%, 12m=100% adoption of cumulative multiplier
    const adoption = months / 12;
    const projected = current.monthlyProfit + (current.monthlyProfit * cumulative - current.monthlyProfit) * adoption;
    projections.push({
      months,
      projectedProfit: round0(clampNum(
        projected,
        PROJECTION_MIN, PROJECTION_MAX, 0,
      )),
    });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function decideMultiplierGrade(cumulative: number): MultiplierGrade {
  if (cumulative >= 15.0) return 'A+';
  if (cumulative >= 8.0) return 'A';
  if (cumulative >= 4.0) return 'B';
  if (cumulative >= 2.0) return 'C';
  if (cumulative >= 1.2) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentState,
): ProfitMultiplierMaximization {
  const pricing = round2(clampNum(
    pricingMultiplierMax(current), PRICING_MULT_MIN, PRICING_MULT_MAX, 1.4,
  ));
  const volume = round2(clampNum(
    volumeMultiplierMax(current), VOLUME_MULT_MIN, VOLUME_MULT_MAX, 2.0,
  ));
  const sourcing = round2(clampNum(
    sourcingMultiplierMax(current), SOURCING_MULT_MIN, SOURCING_MULT_MAX, 1.5,
  ));
  const turnover = round2(clampNum(
    turnoverMultiplierMax(current), TURNOVER_MULT_MIN, TURNOVER_MULT_MAX, 1.8,
  ));
  const channel = round2(clampNum(
    channelMultiplierMax(current), CHANNEL_MULT_MIN, CHANNEL_MULT_MAX, 1.3,
  ));
  const efficiency = round2(clampNum(
    efficiencyMultiplierMax(current), EFFICIENCY_MULT_MIN, EFFICIENCY_MULT_MAX, 1.2,
  ));

  const multipliers = { pricing, volume, sourcing, turnover, channel, efficiency };

  const cumulativeRaw = pricing * volume * sourcing * turnover * channel * efficiency;
  const cumulativeMaxMultiplier = round2(clampNum(
    cumulativeRaw, CUMULATIVE_MIN, CUMULATIVE_MAX, 1.0,
  ));

  const maximizedMonthlyProfit = round0(clampNum(
    current.monthlyProfit * cumulativeMaxMultiplier,
    MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX, current.monthlyProfit,
  ));

  const maximizationBreakdown = buildMaximizationBreakdown(current, multipliers);
  const topMultiplierActions = buildTopActions(current, multipliers);
  const multiplierProjection = buildMultiplierProjection(current, cumulativeMaxMultiplier);
  const multiplierGrade = decideMultiplierGrade(cumulativeMaxMultiplier);

  return {
    pricingMultiplier: pricing,
    volumeMultiplier: volume,
    sourcingMultiplier: sourcing,
    turnoverMultiplier: turnover,
    channelMultiplier: channel,
    efficiencyMultiplier: efficiency,
    cumulativeMaxMultiplier,
    maximizedMonthlyProfit,
    maximizationBreakdown,
    multiplierGrade,
    topMultiplierActions,
    multiplierProjection,
  };
}

function buildSummary(
  current: CurrentState,
  max: ProfitMultiplierMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.monthlyProfit.toFixed(2)}€/mo (${current.soldCount12m} SOLD 12m, ${current.avgROI.toFixed(1)}% ROI, ${current.avgHoldDays}d hold, ${current.capitalDeployed}€ deployed).`,
    `Maximized: ${max.maximizedMonthlyProfit}€/mo (cumulative ×${max.cumulativeMaxMultiplier.toFixed(2)}, grade ${max.multiplierGrade}).`,
    `6 dimensions: pricing ×${max.pricingMultiplier}, volume ×${max.volumeMultiplier}, sourcing ×${max.sourcingMultiplier}, turnover ×${max.turnoverMultiplier}, channel ×${max.channelMultiplier}, efficiency ×${max.efficiencyMultiplier}.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitMultiplierMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitMultiplierMaximizerHandler = withAiRoute<ProfitMultiplierMaximizerInput>({
  endpoint: '/api/ai/profit-multiplier-maximizer',
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
          monthlyProfit: 0,
          avgROI: 0,
          avgHoldDays: 0,
          tradeVolume: 0,
          capitalDeployed: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          heldCount: 0,
        },
        maximization: {
          pricingMultiplier: 1.0,
          volumeMultiplier: 1.0,
          sourcingMultiplier: 1.0,
          turnoverMultiplier: 1.0,
          channelMultiplier: 1.0,
          efficiencyMultiplier: 1.0,
          cumulativeMaxMultiplier: 1.0,
          maximizedMonthlyProfit: 0,
          maximizationBreakdown: [],
          multiplierGrade: 'F',
          topMultiplierActions: [],
          multiplierProjection: [],
        },
        summary: 'Ni SOLD in HELD trgovin — Profit Multiplier Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Profit Multiplier Maximizer ni mogoč.',
      } satisfies ProfitMultiplierResponse);
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

    // If no SOLD trades, can't compute baseline profit
    if (soldComputed.length === 0) {
      const heldCap = heldComputed.reduce((s, h) => s + h.capital, 0);
      return apiOk({
        ok: true,
        current: {
          monthlyProfit: 0,
          avgROI: 0,
          avgHoldDays: 0,
          tradeVolume: 0,
          capitalDeployed: heldCap,
          totalProfit12m: 0,
          soldCount12m: 0,
          heldCount: heldComputed.length,
        },
        maximization: {
          pricingMultiplier: 1.0,
          volumeMultiplier: 1.0,
          sourcingMultiplier: 1.0,
          turnoverMultiplier: 1.0,
          channelMultiplier: 1.0,
          efficiencyMultiplier: 1.0,
          cumulativeMaxMultiplier: 1.0,
          maximizedMonthlyProfit: 0,
          maximizationBreakdown: [],
          multiplierGrade: 'F',
          topMultiplierActions: [],
          multiplierProjection: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Multiplier Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Multiplier Maximizer ni mogoč.',
      } satisfies ProfitMultiplierResponse);
    }

    const current = computeCurrent(soldComputed, heldComputed);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-multiplier-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ProfitMultiplierMaximization;
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
      } satisfies ProfitMultiplierResponse);
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
        pricingMultiplier: maximization.pricingMultiplier,
        volumeMultiplier: maximization.volumeMultiplier,
        sourcingMultiplier: maximization.sourcingMultiplier,
        turnoverMultiplier: maximization.turnoverMultiplier,
        channelMultiplier: maximization.channelMultiplier,
        efficiencyMultiplier: maximization.efficiencyMultiplier,
        cumulativeMaxMultiplier: maximization.cumulativeMaxMultiplier,
        maximizedMonthlyProfit: maximization.maximizedMonthlyProfit,
        multiplierGrade: maximization.multiplierGrade,
        maximizationBreakdown: maximization.maximizationBreakdown,
        topMultiplierActions: maximization.topMultiplierActions,
        multiplierProjection: maximization.multiplierProjection,
      },
      soldSample: soldSampleForAI,
      caps: {
        monthlyProfitMin: MONTHLY_PROFIT_MIN, monthlyProfitMax: MONTHLY_PROFIT_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        pricingMultMin: PRICING_MULT_MIN, pricingMultMax: PRICING_MULT_MAX,
        volumeMultMin: VOLUME_MULT_MIN, volumeMultMax: VOLUME_MULT_MAX,
        sourcingMultMin: SOURCING_MULT_MIN, sourcingMultMax: SOURCING_MULT_MAX,
        turnoverMultMin: TURNOVER_MULT_MIN, turnoverMultMax: TURNOVER_MULT_MAX,
        channelMultMin: CHANNEL_MULT_MIN, channelMultMax: CHANNEL_MULT_MAX,
        efficiencyMultMin: EFFICIENCY_MULT_MIN, efficiencyMultMax: EFFICIENCY_MULT_MAX,
        cumulativeMin: CUMULATIVE_MIN, cumulativeMax: CUMULATIVE_MAX,
        contributionMin: CONTRIBUTION_MIN, contributionMax: CONTRIBUTION_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        projectionMin: PROJECTION_MIN, projectionMax: PROJECTION_MAX,
      },
    };

    const prompt = `Si AI "Profit Multiplier Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT MULTIPLIER MAXIMIZATION — kako maksimizirati MAXIMUM PROFIT MULTIPLIER (koliko-krat je mogoče pomnožiti trenutni profit z vsemi optimizacijami simultano). Tvoj cilj je "Tvoj profit je 2000€/mo. Z vsemi optimizacijami bi lahko bil 7.2× = 14,400€/mo." Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira DAILY PROFIT z scalingPath phases) — ti MAKSIMIZIRAŠ PROFIT MULTIPLIER (cumulative product vseh 6 dimensions pricing/volume/sourcing/turnover/channel/efficiency, ne daily profit scaling). Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per euro deployed — capital efficiency ratio) — ti MAKSIMIZIRAŠ PROFIT MULTIPLIER (koliko-krat × profit, ne €/€ ratio). Razlika od revenue-per-trade-maximizer (v8.06 ki maksimizira top-line sell price per trade) — ta MAKSIMIZIRA PROFIT MULTIPLIER z 6 dimension multipliers in cumulativeMaxMultiplier. Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ta maksimizira PROFIT MULTIPLIER (× koliko-krat, ne % return). Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira return OF capital) — ta maksimizira PROFIT MULTIPLIER (return ON profit scaled, ne capital returned). Razlika od profit-scale-engine (v7.96 ki skalira profit z growth engine) — ta MAKSIMIZIRA PROFIT MULTIPLIER z 6 dimension multipliers in cumulativeMaxMultiplier. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ta maksimizira PROFIT MULTIPLIER (cumulative ×, ne €/day velocity). Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) — ta MAKSIMIZIRA PROFIT MULTIPLIER z multiplierGrade in topMultiplierActions.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD trgovine):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.pricingMultiplier [1.0, 2.0] (max profit gain iz optimal pricing — AI lahko dvigne do 1.6 default),
2. maximization.volumeMultiplier [1.0, 3.0] (max profit gain iz increased trade volume — AI lahko dvigne do 3.0 če tradeVolume < 12),
3. maximization.sourcingMultiplier [1.0, 2.0] (max profit gain iz better buy prices — AI lahko do 1.7 default),
4. maximization.turnoverMultiplier [1.0, 2.5] (max profit gain iz faster turnover — AI lahko do 2.5 če avgHoldDays > 90),
5. maximization.channelMultiplier [1.0, 1.5] (max profit gain iz optimal platforms — AI lahko do 1.4 default),
6. maximization.efficiencyMultiplier [1.0, 1.5] (max profit gain iz reduced fees — AI lahko do 1.3 default),
7. maximization.cumulativeMaxMultiplier [1.0, 50.0] (= product vseh 6 multipliers — compounding),
8. maximization.maximizedMonthlyProfit € [0, 200000] (= current.monthlyProfit × cumulativeMaxMultiplier),
9. maximization.maximizationBreakdown: 6 elementov { dimension PRICING/VOLUME/SOURCING/TURNOVER/CHANNEL/EFFICIENCY, multiplier [1.0, 3.0], contribution % [0, 100] (share of cumulative lift), rationale (slovenski, max 200) },
10. maximization.multiplierGrade: A+ | A | B | C | D | F (A+ če cumulative ≥ 15.0, A ≥ 8.0, B ≥ 4.0, C ≥ 2.0, D ≥ 1.2, else F),
11. maximization.topMultiplierActions: 6-8 elementov { dimension, action (slovenski, max 200 — specifična akcija), expectedMultiplierLift [1.0, 3.0], priority HIGH/MEDIUM/LOW } (sortirano po lift descending),
12. maximization.multiplierProjection: 3 elementi { months 3/6/12, projectedProfit € [0, 200000] (linear ramp: 3m=25%, 6m=50%, 12m=100% adoption of cumulative multiplier) },
13. summary: slovenski povzetek (max 500 znakov — poudari current monthly profit, maximized monthly profit, cumulative multiplier, grade, 6 dimensions).

VRNI LE JSON:
{
  "maximization": {
    "pricingMultiplier": 1.6,
    "volumeMultiplier": 2.5,
    "sourcingMultiplier": 1.7,
    "turnoverMultiplier": 2.0,
    "channelMultiplier": 1.4,
    "efficiencyMultiplier": 1.3,
    "cumulativeMaxMultiplier": 15.6,
    "maximizedMonthlyProfit": 31200,
    "maximizationBreakdown": [
      { "dimension": "PRICING", "multiplier": 1.6, "contribution": 22, "rationale": "Optimalna pricing strategija dvigne profit per trade." },
      { "dimension": "VOLUME", "multiplier": 2.5, "contribution": 35, "rationale": "Povečan trade volume z več monitorji." },
      { "dimension": "SOURCING", "multiplier": 1.7, "contribution": 18, "rationale": "Boljši sourcing zniža buy price." },
      { "dimension": "TURNOVER", "multiplier": 2.0, "contribution": 15, "rationale": "Hitrejši turnover z auto-relisting." },
      { "dimension": "CHANNEL", "multiplier": 1.4, "contribution": 6, "rationale": "Multi-platform listings povečajo close rate." },
      { "dimension": "EFFICIENCY", "multiplier": 1.3, "contribution": 4, "rationale": "Znižani fees z bundle deals." }
    ],
    "multiplierGrade": "A+",
    "topMultiplierActions": [
      { "dimension": "VOLUME", "action": "Dodaj 3 nove monitorje z keyword expansion.", "expectedMultiplierLift": 2.5, "priority": "HIGH" },
      { "dimension": "TURNOVER", "action": "Vklopi listing-refresh-scheduler.", "expectedMultiplierLift": 2.0, "priority": "HIGH" },
      { "dimension": "SOURCING", "action": "Aktiviraj cross-border sourcing.", "expectedMultiplierLift": 1.7, "priority": "HIGH" },
      { "dimension": "PRICING", "action": "Vklopi AI pricing engine.", "expectedMultiplierLift": 1.6, "priority": "HIGH" },
      { "dimension": "CHANNEL", "action": "Multi-platform listings.", "expectedMultiplierLift": 1.4, "priority": "MEDIUM" },
      { "dimension": "EFFICIENCY", "action": "Bundle deals in tax-aware selling.", "expectedMultiplierLift": 1.3, "priority": "MEDIUM" }
    ],
    "multiplierProjection": [
      { "months": 3, "projectedProfit": 7000 },
      { "months": 6, "projectedProfit": 14000 },
      { "months": 12, "projectedProfit": 31200 }
    ]
  },
  "summary": "Current: 2000.00€/mo (50 SOLD 12m, 25.0% ROI, 30d hold, 5000€ deployed). Maximized: 31200€/mo (cumulative ×15.60, grade A+). 6 dimensions: pricing ×1.60, volume ×2.50, sourcing ×1.70, turnover ×2.00, channel ×1.40, efficiency ×1.30."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override each multiplier — clamp to anti-hallucination bounds
        const pricing = round2(clampNum(
          aiMax.pricingMultiplier, PRICING_MULT_MIN, PRICING_MULT_MAX,
          maximization.pricingMultiplier,
        ));
        const volume = round2(clampNum(
          aiMax.volumeMultiplier, VOLUME_MULT_MIN, VOLUME_MULT_MAX,
          maximization.volumeMultiplier,
        ));
        const sourcing = round2(clampNum(
          aiMax.sourcingMultiplier, SOURCING_MULT_MIN, SOURCING_MULT_MAX,
          maximization.sourcingMultiplier,
        ));
        const turnover = round2(clampNum(
          aiMax.turnoverMultiplier, TURNOVER_MULT_MIN, TURNOVER_MULT_MAX,
          maximization.turnoverMultiplier,
        ));
        const channel = round2(clampNum(
          aiMax.channelMultiplier, CHANNEL_MULT_MIN, CHANNEL_MULT_MAX,
          maximization.channelMultiplier,
        ));
        const efficiency = round2(clampNum(
          aiMax.efficiencyMultiplier, EFFICIENCY_MULT_MIN, EFFICIENCY_MULT_MAX,
          maximization.efficiencyMultiplier,
        ));

        const multipliers = { pricing, volume, sourcing, turnover, channel, efficiency };

        const cumulativeMaxMultiplier = round2(clampNum(
          aiMax.cumulativeMaxMultiplier,
          CUMULATIVE_MIN, CUMULATIVE_MAX,
          pricing * volume * sourcing * turnover * channel * efficiency,
        ));

        const maximizedMonthlyProfit = round0(clampNum(
          aiMax.maximizedMonthlyProfit,
          MONTHLY_PROFIT_MIN, MONTHLY_PROFIT_MAX,
          current.monthlyProfit * cumulativeMaxMultiplier,
        ));

        // Override maximizationBreakdown
        let maximizationBreakdown = maximization.maximizationBreakdown;
        if (Array.isArray(aiMax.maximizationBreakdown) &&
            aiMax.maximizationBreakdown.length >= 6) {
          const aiBd: MultiplierBreakdownEntry[] = [];
          const multByDim: Record<MultiplierDimension, number> = {
            PRICING: pricing,
            VOLUME: volume,
            SOURCING: sourcing,
            TURNOVER: turnover,
            CHANNEL: channel,
            EFFICIENCY: efficiency,
          };
          const sumLift = Object.values(multByDim).reduce((s, m) => s + Math.max(0, m - 1), 0);
          for (const b of aiMax.maximizationBreakdown.slice(0, MAX_BREAKDOWN)) {
            if (!b || typeof b !== 'object') continue;
            const dim = clampEnum(b.dimension, VALID_DIMENSION, 'PRICING');
            const mult = multByDim[dim];
            aiBd.push({
              dimension: dim,
              multiplier: round2(clampNum(
                b.multiplier ?? mult,
                Math.max(1.0, mult * 0.9), Math.min(3.0, mult * 1.1),
                mult,
              )),
              contribution: round0(clampNum(
                b.contribution ?? (sumLift > 0 ? (Math.max(0, mult - 1) / sumLift) * 100 : 0),
                CONTRIBUTION_MIN, CONTRIBUTION_MAX, 0,
              )),
              rationale: clampString(b.rationale, 200, `Maximization ${dim.toLowerCase()} rationale neopisan.`),
            });
          }
          if (aiBd.length === 6) {
            maximizationBreakdown = aiBd;
          }
        }

        // Override multiplierGrade
        const multiplierGrade = aiMax.multiplierGrade
          ? clampEnum(aiMax.multiplierGrade, VALID_GRADE, decideMultiplierGrade(cumulativeMaxMultiplier))
          : decideMultiplierGrade(cumulativeMaxMultiplier);

        // Override topMultiplierActions
        let topMultiplierActions = maximization.topMultiplierActions;
        if (Array.isArray(aiMax.topMultiplierActions) &&
            aiMax.topMultiplierActions.length >= 4) {
          const aiAct: MaximizerAction[] = [];
          for (const a of aiMax.topMultiplierActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            aiAct.push({
              dimension: clampEnum(a.dimension, VALID_DIMENSION, 'PRICING'),
              action: clampString(a.action, 200, 'Akcija za profit multiplier.'),
              expectedMultiplierLift: round2(clampNum(
                a.expectedMultiplierLift, UPLIFT_MIN, UPLIFT_MAX, 1.5,
              )),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
            });
          }
          if (aiAct.length >= 4) {
            topMultiplierActions = aiAct;
          }
        }

        // Override multiplierProjection
        let multiplierProjection = maximization.multiplierProjection;
        if (Array.isArray(aiMax.multiplierProjection) &&
            aiMax.multiplierProjection.length >= 3) {
          const aiProj: MultiplierProjectionEntry[] = [];
          const expectedMonths = [3, 6, 12];
          for (const expected of expectedMonths) {
            const ai = aiMax.multiplierProjection.find(
              (p) => p && Number(p.months) === expected,
            );
            if (!ai) continue;
            const projectedProfit = round0(clampNum(
              ai.projectedProfit,
              PROJECTION_MIN, PROJECTION_MAX, 0,
            ));
            aiProj.push({ months: expected, projectedProfit });
          }
          if (aiProj.length === 3) {
            multiplierProjection = aiProj;
          }
        }

        maximization = {
          pricingMultiplier: pricing,
          volumeMultiplier: volume,
          sourcingMultiplier: sourcing,
          turnoverMultiplier: turnover,
          channelMultiplier: channel,
          efficiencyMultiplier: efficiency,
          cumulativeMaxMultiplier,
          maximizedMonthlyProfit,
          maximizationBreakdown,
          multiplierGrade,
          topMultiplierActions,
          multiplierProjection,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-multiplier-maximizer',
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
    } satisfies ProfitMultiplierResponse);
  },
});

export const GET = profitMultiplierMaximizerHandler;
export const POST = profitMultiplierMaximizerHandler;

