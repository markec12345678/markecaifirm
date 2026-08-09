// v8.05: AI Inventory Turnover Yield Maximizer — AI najde OPTIMALNI TURNOVER
// RATE ki maksimizira ANNUALIZED YIELD. Prehitro = nizka margin per trade.
// Prepočasi = kapital vezan. "Tvoj optimalni turnover je 3.2x/mesec kar da
// 85% annual yield — hitreje od trenutnega 2.5x in bolj profitabilno."
// Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item
// z yieldGrade) — ta MAKSIMIZIRA TURNOVER RATE za max ANNUALIZED YIELD z
// yieldCurve (7 točk: 1x-7x/month). Razlika od inventory-cash-yield-maximizer
// (v8.04 ki maksimizira annualized cash yield čez portfolio z benchmark) — ta
// maksimizira TURNOVER RATE (frequency of trades) z optimalTurnoverRate in
// breakEvenTurnover. Razlika od inventory-turnover-accelerator-pro (v7.85 ki
// accelerira turnover per item z PRICE_DROP/RELIST/CROSS_POST) — ta MAXIMIZIRA
// YIELD pri optimalnem turnover rate (curve optimization, ne per-item
// action). Razlika od inventory-turnover-optimizer (v7.50 ki optimizira
// turnover) — ta maksimizira ANNUALIZED YIELD z yieldCurve. Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital
// efficiency per item z reallocation) — ta maksimizira YIELD čez TURNOVER
// rate z optimalInventorySize. Razlika od inventory-roi-maximizer-pro (v7.99
// ki maksimizira ROI per item) — ta maksimizira ANNUALIZED YIELD (ROI ×
// turnover). Razlika od inventory-profit-per-day-maximizer (v8.02 ki
// maksimizira daily profit per item) — ta maksimizira YIELD (annualized ROI)
// z turnover optimization. Razlika od inventory-turnover-profit-maximizer
// (v8.00 ki maksimizira profit per turnover cycle) — ta maksimizira YIELD
// čez turnover rate (1x-7x curve). Razlika od inventory-cash-conversion-
// maximizer (v7.98 ki maksimizira cash conversion) — ta daje YIELD CURVE
// z breakEvenTurnover in optimalInventorySize. Razlika od profit-velocity-
// maximizer (v7.98 ki maksimizira €/day velocity) — ta maksimizira annualized
// YIELD (ROI × turnover) z yieldCurve 7 točk.

// GET+POST /api/ai/inventory-turnover-yield-maximizer
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

type TurnoverYieldGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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

interface CurrentState {
  currentTurnoverRate: number; // x/month
  currentYield: number; // % annualized
  currentMonthlyProfit: number; // €
  avgROIPerTrade: number; // % per trade (avg profit/cost × 100)
  avgHoldDays: number;
  heldInventoryCount: number;
  heldCapitalDeployed: number; // €
}

interface YieldCurvePoint {
  turnoverRate: number; // x/month (1, 2, 3, 4, 5, 6, 7)
  projectedYield: number; // % annualized at this turnover rate
  projectedMonthlyProfit: number; // €
  projectedAnnualProfit: number; // €
  isOptimal: boolean; // whether this is the max yield point
  description: string;
}

interface TurnoverYieldMaximization {
  yieldCurve: YieldCurvePoint[];
  optimalTurnoverRate: number; // x/month that maximizes annualized yield
  maximizedYield: number; // % annualized
  yieldUplift: number; // pp (maximized − current)
  turnoverYieldActions: string[];
  optimalInventorySize: number; // ideal # items for optimal turnover
  turnoverYieldGrade: TurnoverYieldGrade;
  breakEvenTurnover: number; // minimum turnover to maintain positive yield
}

interface InventoryTurnoverYieldResponse {
  ok: true;
  current: CurrentState;
  maximization: TurnoverYieldMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  yieldCurve?: Array<{
    turnoverRate?: number;
    projectedYield?: number;
    projectedMonthlyProfit?: number;
    projectedAnnualProfit?: number;
    description?: string;
  }>;
  optimalTurnoverRate?: number;
  maximizedYield?: number;
  yieldUplift?: number;
  turnoverYieldActions?: string[];
  optimalInventorySize?: number;
  turnoverYieldGrade?: TurnoverYieldGrade;
  breakEvenTurnover?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 500_000;
const RATE_MIN = 0;
const RATE_MAX = 20; // x/month
const YIELD_MIN = -100; // %
const YIELD_MAX = 1000; // %
const HOLD_MIN = 1;
const HOLD_MAX = 365;
const ROI_MIN = -100; // % per trade
const ROI_MAX = 500;
const INVENTORY_MIN = 0;
const INVENTORY_MAX = 1000;
const UPLIFT_MIN = -200;
const UPLIFT_MAX = 500; // pp
const MONTHS_PER_YEAR = 12;

const VALID_GRADE: readonly TurnoverYieldGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const TURNOVER_RATES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
const MAX_ACTIONS = 7;
const MAX_CURVE_POINTS = 7;
const MAX_DESCRIPTION_CHARS = 200;

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
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  const cost = buyPrice + buyFees;
  if (cost <= 0) return null;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const roi = (profit / cost) * 100;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { profit, cost, roi, holdDays, sellMs, within12m };
}

interface HeldComputed {
  id: string;
  cost: number;
  holdDays: number;
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((now - buyMs) / DAY_MS))
    : 1;
  return { id: t.id, cost: buyPrice + buyFees, holdDays };
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

function computeCurrent(agg: SoldAgg, held: HeldComputed[]): CurrentState {
  const avgROIPerTrade = round2(clampNum(
    agg.count12m > 0 ? agg.totalROI / agg.count12m : 30,
    ROI_MIN, ROI_MAX, 30,
  ));
  const avgHoldDays = round0(clampNum(
    agg.count12m > 0 ? agg.totalHoldDays / agg.count12m : 30,
    HOLD_MIN, HOLD_MAX, 30,
  ));
  // Turnover rate = trades per month (assuming 30d cycle = 1x, 15d = 2x, etc.)
  // currentTurnoverRate = (30 / avgHoldDays) × (avg number of concurrent items)
  // For simplicity: 30/avgHoldDays × scaling factor for concurrent inventory
  const baseTurnover = avgHoldDays > 0 ? 30 / avgHoldDays : 1;
  // Scale by held inventory count (more items = more parallel cycles)
  const heldCount = held.length;
  const scalingFactor = Math.max(1, Math.min(5, heldCount / 4)); // 1-5x scaling based on inventory
  const currentTurnoverRate = round2(clampNum(
    baseTurnover * scalingFactor,
    RATE_MIN, RATE_MAX, 1,
  ));
  // Current monthly profit = profit12m / 12
  const currentMonthlyProfit = round0(clampNum(
    agg.count12m > 0 ? agg.profit12m / 12 : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  // Current yield = annualized ROI × turnover rate × 12 months
  // = (avgROIPerTrade/100) × currentTurnoverRate × 12 × 100
  const currentYield = round2(clampNum(
    (avgROIPerTrade / 100) * currentTurnoverRate * MONTHS_PER_YEAR * 100,
    YIELD_MIN, YIELD_MAX, 0,
  ));
  const heldCapitalDeployed = round0(clampNum(
    held.reduce((s, h) => s + h.cost, 0),
    0, 500_000, 0,
  ));

  return {
    currentTurnoverRate,
    currentYield,
    currentMonthlyProfit,
    avgROIPerTrade,
    avgHoldDays,
    heldInventoryCount: heldCount,
    heldCapitalDeployed,
  };
}

// Yield curve model: at higher turnover rate, ROI per trade decreases
// (because faster sales require price cuts), but annualized yield is
// ROI × turnover × 12. There's a sweet spot.
//
// Model: at turnover t (x/month), ROI = baseROI × (1 - 0.10 × (t - baseRate))
// where baseRate is the current rate. At low t, ROI stays high but few trades.
// At high t, ROI drops below 0.
//
// Yield = ROI × t × 12 (in %)

function projectedROIAtTurnover(
  baseROI: number,
  baseTurnover: number,
  targetTurnover: number,
): number {
  // For each unit of turnover above base, ROI drops 8% (price pressure)
  // For each unit below base, ROI increases 5% (premium pricing, longer hold)
  const delta = targetTurnover - baseTurnover;
  const roiMultiplier = delta > 0
    ? Math.max(0.1, 1 - 0.08 * delta) // max 90% drop
    : 1 + 0.05 * (-delta); // +5% per unit below
  return baseROI * roiMultiplier;
}

function buildYieldCurvePoint(
  turnoverRate: number,
  current: CurrentState,
  isOptimal: boolean,
): YieldCurvePoint {
  const projectedROI = projectedROIAtTurnover(
    current.avgROIPerTrade,
    current.currentTurnoverRate,
    turnoverRate,
  );
  const projectedYield = round2(clampNum(
    (projectedROI / 100) * turnoverRate * MONTHS_PER_YEAR * 100,
    YIELD_MIN, YIELD_MAX, 0,
  ));
  // Monthly profit scales with turnover (assuming same inventory base)
  // Profit per trade = avgROIPerTrade × cost
  // Monthly profit = turnover × profit per trade = turnover × (projectedROI/100) × heldCapital
  const base = Math.max(100, current.heldCapitalDeployed / Math.max(1, current.heldInventoryCount));
  const projectedMonthlyProfit = round0(clampNum(
    turnoverRate * (projectedROI / 100) * base * Math.max(1, current.heldInventoryCount),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const projectedAnnualProfit = round0(clampNum(
    projectedMonthlyProfit * 12,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  let description: string;
  if (turnoverRate <= 1) {
    description = `Počasen turnover (${turnoverRate}x/mo) — premium pricing, visok ROI ${round2(projectedROI)}% ampak nizka frekvenca. Letni profit ${projectedAnnualProfit}€.`;
  } else if (turnoverRate <= 3) {
    description = `Zmerno urni turnover (${turnoverRate}x/mo) — balansiran ROI ${round2(projectedROI)}% in frekvenca. Letni profit ${projectedAnnualProfit}€.`;
  } else if (turnoverRate <= 5) {
    description = `Visok turnover (${turnoverRate}x/mo) — ROI ${round2(projectedROI)}% (price pressure). Letni profit ${projectedAnnualProfit}€.`;
  } else {
    description = `Zelo visok turnover (${turnoverRate}x/mo) — ROI ${round2(projectedROI)}% (margin squeeze). Letni profit ${projectedAnnualProfit}€. Risk of negative yield.`;
  }

  return {
    turnoverRate,
    projectedYield,
    projectedMonthlyProfit,
    projectedAnnualProfit,
    isOptimal,
    description: clampString(description, MAX_DESCRIPTION_CHARS, `Turnover ${turnoverRate}x/mo, yield ${projectedYield}%.`),
  };
}

function buildYieldCurve(current: CurrentState): YieldCurvePoint[] {
  // Build curve at 1, 2, 3, 4, 5, 6, 7 x/month
  // Find optimal by computing yield at each point first
  const preCurve = TURNOVER_RATES.map((rate) => {
    const roi = projectedROIAtTurnover(current.avgROIPerTrade, current.currentTurnoverRate, rate);
    const yld = (roi / 100) * rate * MONTHS_PER_YEAR * 100;
    return { rate, yld };
  });
  const maxYield = Math.max(...preCurve.map((c) => c.yld));
  const optimalRate = preCurve.find((c) => c.yld === maxYield)?.rate ?? 3;

  return TURNOVER_RATES.map((rate) => buildYieldCurvePoint(rate, current, rate === optimalRate));
}

function decideOptimalTurnoverRate(curve: YieldCurvePoint[]): number {
  const optimal = curve.find((c) => c.isOptimal);
  if (optimal) return round2(optimal.turnoverRate);
  // Fallback: max yield
  const sorted = [...curve].sort((a, b) => b.projectedYield - a.projectedYield);
  return round2(sorted[0]?.turnoverRate ?? 3);
}

function computeMaximizedYield(curve: YieldCurvePoint[], optimalRate: number): number {
  const point = curve.find((c) => c.turnoverRate === optimalRate);
  return point?.projectedYield ?? 0;
}

function computeBreakEvenTurnover(current: CurrentState): number {
  // Break-even: where projectedYield = 0
  // yield = (ROI × turnover × 12 × 100 / 100) = ROI × turnover × 12
  // = 0 when ROI = 0 OR turnover = 0
  // ROI = 0 when targetTurnover makes ROI multiplier → 0
  // baseROI × (1 - 0.08 × (t - baseRate)) = 0 → t = baseRate + 12.5
  // But that's the absolute maximum. Break-even is more practically when yield drops below current yield.
  // We define break-even as the minimum turnover rate to maintain positive yield.
  // At turnover t, projected ROI = baseROI × (1 - 0.08 × (t - baseRate))
  // Yield = projectedROI × t × 12 / 100 (since yield % = ROI% × t × 12)
  // If baseROI > 0: yield ≥ 0 when projectedROI ≥ 0
  // → 1 - 0.08 × (t - baseRate) ≥ 0 → t ≤ baseRate + 12.5
  // Lower bound: minimum turnover to maintain positive annual yield (when baseROI × t × 12 ≥ 0)
  // If baseROI > 0, even t = 0.01 gives positive yield. So break-even = 0.5x (any realistic activity)
  // If baseROI ≤ 0, no turnover helps. Break-even = Infinity (capped at RATE_MAX)
  if (current.avgROIPerTrade <= 0) return RATE_MAX; // can't break even with negative ROI
  return round2(clampNum(0.5, RATE_MIN, RATE_MAX, 0.5));
}

function buildTurnoverYieldActions(
  current: CurrentState,
  optimalRate: number,
  curve: YieldCurvePoint[],
): string[] {
  const actions: string[] = [];
  const optimal = curve.find((c) => c.turnoverRate === optimalRate);
  const diff = optimalRate - current.currentTurnoverRate;

  // 1) Turnover adjustment
  if (Math.abs(diff) < 0.5) {
    actions.push(
      `Tvoj turnover (${current.currentTurnoverRate}x/mo) je blizu optimalnega (${optimalRate}x/mo) — vzdržuj trenutno tempo.`,
    );
  } else if (diff > 0) {
    actions.push(
      `Povečaj turnover iz ${current.currentTurnoverRate}x/mo na ${optimalRate}x/mo (+${round2(diff)}x) z avtomatiziranim listing refresh in hitrim buyer matchmakerjem.`,
    );
  } else {
    actions.push(
      `Zmanjšaj turnover iz ${current.currentTurnoverRate}x/mo na ${optimalRate}x/mo (−${round2(-diff)}x) za premium pricing in višji ROI per trade.`,
    );
  }

  // 2) Pricing adjustment
  if (diff > 0) {
    actions.push(
      'Ciljaj hitrejše prodaje z 5-10% nižjimi cenami na zastarelih itemih (cross-post + auto-relist).',
    );
  } else {
    actions.push(
      'Ciljaj premium pricing z 10-15% višjimi cenami, refurbished enhancement in boljšo fotografijo.',
    );
  }

  // 3) Inventory size
  const optimalSize = Math.max(1, Math.round(current.heldInventoryCount * (optimalRate / Math.max(0.5, current.currentTurnoverRate))));
  actions.push(
    `Optimalen inventory size: ${optimalSize} item-ov (trenutno ${current.heldInventoryCount}) — prilagodi sourcing ritam.`,
  );

  // 4) Listing quality
  actions.push(
    'Izboljšaj listing quality (fotografije, opis, SEO) za 20%+ boljšo konverzijo = višji turnover brez price drop.',
  );

  // 5) Category shifts
  actions.push(
    'Premakni fokus v kategorije z naravno visoko turnover (electronics, fashion) če tvoja kategorija ima nizko natural turnover.',
  );

  // 6) Reinvestment
  actions.push(
    `Reinvestiraj profit v ${optimalSize} item-ov pri optimalnem turnover (${optimalRate}x/mo) za ${optimal?.projectedAnnualProfit ?? 0}€ letni profit.`,
  );

  // 7) Cycle time
  const optimalHold = Math.max(7, Math.round(30 / optimalRate));
  actions.push(
    `Ciljaj ${optimalHold}-dnevni cycle time (trenutno ${current.avgHoldDays} dni) z instant-buy workflow in avtomatiziranim shipping.`,
  );

  return actions.slice(0, MAX_ACTIONS);
}

function computeOptimalInventorySize(
  current: CurrentState,
  optimalRate: number,
): number {
  // Optimal size scales with turnover rate × capital efficiency
  // If optimal > current rate, we can support more items (more capital efficient)
  // If optimal < current rate, fewer items (premium focus)
  const rateRatio = optimalRate / Math.max(0.5, current.currentTurnoverRate);
  const optimal = Math.round(current.heldInventoryCount * rateRatio);
  return round0(clampNum(optimal, INVENTORY_MIN, INVENTORY_MAX, current.heldInventoryCount));
}

function decideGrade(
  currentYield: number,
  maximizedYield: number,
): TurnoverYieldGrade {
  // A+ if maximized ≥ 200% or uplift ≥ 50pp
  // A if maximized ≥ 100% or uplift ≥ 30pp
  // B if maximized ≥ 50% or uplift ≥ 15pp
  // C if maximized ≥ 25% or uplift ≥ 5pp
  // D if maximized > 0% or uplift > 0
  // F else
  const uplift = maximizedYield - currentYield;
  if (maximizedYield >= 200 || uplift >= 50) return 'A+';
  if (maximizedYield >= 100 || uplift >= 30) return 'A';
  if (maximizedYield >= 50 || uplift >= 15) return 'B';
  if (maximizedYield >= 25 || uplift >= 5) return 'C';
  if (maximizedYield > 0 || uplift > 0) return 'D';
  return 'F';
}

function buildDeterministicMaximization(current: CurrentState): TurnoverYieldMaximization {
  const yieldCurve = buildYieldCurve(current);
  const optimalTurnoverRate = round2(clampNum(
    decideOptimalTurnoverRate(yieldCurve),
    RATE_MIN, RATE_MAX, 3,
  ));
  const maximizedYield = round2(clampNum(
    computeMaximizedYield(yieldCurve, optimalTurnoverRate),
    YIELD_MIN, YIELD_MAX, 0,
  ));
  const yieldUplift = round2(clampNum(
    maximizedYield - current.currentYield,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const turnoverYieldActions = buildTurnoverYieldActions(current, optimalTurnoverRate, yieldCurve);
  const optimalInventorySize = computeOptimalInventorySize(current, optimalTurnoverRate);
  const turnoverYieldGrade = decideGrade(current.currentYield, maximizedYield);
  const breakEvenTurnover = computeBreakEvenTurnover(current);

  return {
    yieldCurve,
    optimalTurnoverRate,
    maximizedYield,
    yieldUplift,
    turnoverYieldActions,
    optimalInventorySize,
    turnoverYieldGrade,
    breakEvenTurnover,
  };
}

function buildSummary(current: CurrentState, max: TurnoverYieldMaximization): string {
  const parts: string[] = [
    `Current: ${current.currentTurnoverRate}x/mo turnover, ${current.avgROIPerTrade}% ROI, ${current.currentYield}% annual yield.`,
    `Optimal: ${max.optimalTurnoverRate}x/mo → ${max.maximizedYield}% yield (+${max.yieldUplift}pp, grade ${max.turnoverYieldGrade}).`,
    `Break-even: ${max.breakEvenTurnover}x/mo. Optimal inventory size: ${max.optimalInventorySize} item-ov.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryTurnoverYieldMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryTurnoverYieldMaximizer(req);
}

async function handleInventoryTurnoverYieldMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-turnover-yield-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query SOLD trades last 12m + HELD trades for inventory
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
          buyDate: true,
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD and no HELD trades
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          currentTurnoverRate: 0,
          currentYield: 0,
          currentMonthlyProfit: 0,
          avgROIPerTrade: 0,
          avgHoldDays: 0,
          heldInventoryCount: 0,
          heldCapitalDeployed: 0,
        },
        maximization: {
          yieldCurve: [],
          optimalTurnoverRate: 0,
          maximizedYield: 0,
          yieldUplift: 0,
          turnoverYieldActions: [],
          optimalInventorySize: 0,
          turnoverYieldGrade: 'F',
          breakEvenTurnover: 0,
        },
        summary: 'Ni SOLD in HELD trgovin — Inventory Turnover Yield Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Inventory Turnover Yield Maximizer ni mogoč.',
      } satisfies InventoryTurnoverYieldResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const heldComputed: HeldComputed[] = heldTrades.map((t) => computeHeldTrade(t, now));

    const agg = aggregateSold(soldComputed);
    const current = computeCurrent(agg, heldComputed);

    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-turnover-yield-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: TurnoverYieldMaximization;
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
      } satisfies InventoryTurnoverYieldResponse);
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
      heldInventoryCount: current.heldInventoryCount,
      heldCapitalDeployed: current.heldCapitalDeployed,
      current,
      deterministicMaximization: {
        yieldCurve: maximization.yieldCurve,
        optimalTurnoverRate: maximization.optimalTurnoverRate,
        maximizedYield: maximization.maximizedYield,
        yieldUplift: maximization.yieldUplift,
        optimalInventorySize: maximization.optimalInventorySize,
        turnoverYieldGrade: maximization.turnoverYieldGrade,
        breakEvenTurnover: maximization.breakEvenTurnover,
      },
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        rateMin: RATE_MIN, rateMax: RATE_MAX,
        yieldMin: YIELD_MIN, yieldMax: YIELD_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        inventoryMin: INVENTORY_MIN, inventoryMax: INVENTORY_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Turnover Yield Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za TURNOVER YIELD MAXIMIZATION — kako najti OPTIMALNI TURNOVER RATE ki maksimizira ANNUALIZED YIELD. Prehitro = nizka margin per trade. Prepočasi = kapital vezan. Tvoj cilj je "tvoj optimalni turnover je 3.2x/mesec kar da 85% annual yield — hitreje od trenutnega 2.5x in bolj profitabilno". Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item z yieldGrade) — ta MAKSIMIZIRA TURNOVER RATE za max ANNUALIZED YIELD z yieldCurve (7 točk: 1x-7x/month). Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield čez portfolio z benchmark) — ta maksimizira TURNOVER RATE (frequency of trades) z optimalTurnoverRate in breakEvenTurnover. Razlika od inventory-turnover-accelerator-pro (v7.85 ki accelerira turnover per item z PRICE_DROP/RELIST/CROSS_POST) — ta MAXIMIZIRA YIELD pri optimalnem turnover rate (curve optimization, ne per-item action). Razlika od inventory-turnover-optimizer (v7.50 ki optimizira turnover) — ta maksimizira ANNUALIZED YIELD z yieldCurve. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ta maksimizira YIELD čez TURNOVER rate z optimalInventorySize. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta maksimizira ANNUALIZED YIELD (ROI × turnover). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ta maksimizira YIELD (annualized ROI) z turnover optimization. Razlika od inventory-turnover-profit-maximizer (v8.00 ki maksimizira profit per turnover cycle) — ta maksimizira YIELD čez turnover rate (1x-7x curve). Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) — ta daje YIELD CURVE z breakEvenTurnover in optimalInventorySize. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ta maksimizira annualized YIELD (ROI × turnover) z yieldCurve 7 točk.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventarja):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. yieldCurve: 7 točk za turnoverRate 1, 2, 3, 4, 5, 6, 7 (x/month) — za vsak:
   - turnoverRate x/month [0, 20] (MORA biti ena od 7 vrednosti),
   - projectedYield % [-100, 1000] (annualized yield = (ROI/100) × turnover × 12 × 100 — višji turnover = nižji ROI ampak več trades; anti-hallucination),
   - projectedMonthlyProfit € [0, 500000] (turnover × profit per trade),
   - projectedAnnualProfit € [0, 500000] (× 12),
   - description (max 200, slovenski — opis trade-off za ta turnover rate),
2. optimalTurnoverRate x/month [0, 20] (turnover rate z max projectedYield — tipično 2-4x),
3. maximizedYield % [-100, 1000] (yield pri optimalTurnoverRate),
4. yieldUplift pp [-200, 500] (maximized − current yield),
5. turnoverYieldActions: 4-7 stringov (max 200 vsak, slovenski — kako doseči optimalen turnover: pricing, listing quality, category shifts, inventory size),
6. optimalInventorySize [0, 1000] (ideal # items za optimal turnover),
7. turnoverYieldGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 200% ali uplift ≥ 50pp, A ≥ 100/30, B ≥ 50/15, C ≥ 25/5, D > 0, else F),
8. breakEvenTurnover x/month [0, 20] (minimum turnover za positive annual yield),
9. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "yieldCurve": [
    { "turnoverRate": 1, "projectedYield": 360, "projectedMonthlyProfit": 800, "projectedAnnualProfit": 9600, "description": "Počasen turnover — premium pricing." },
    { "turnoverRate": 3, "projectedYield": 850, "projectedMonthlyProfit": 2200, "projectedAnnualProfit": 26400, "description": "Optimalen turnover — balansiran ROI in frekvenca." },
    { "turnoverRate": 7, "projectedYield": 240, "projectedMonthlyProfit": 1800, "projectedAnnualProfit": 21600, "description": "Zelo visok turnover — margin squeeze." }
  ],
  "optimalTurnoverRate": 3.2,
  "maximizedYield": 85,
  "yieldUplift": 25,
  "turnoverYieldActions": ["Povečaj turnover iz 2.5x na 3.2x/mo z avtomatiziranim listing refresh.", "Ciljaj 9-dnevni cycle time."],
  "optimalInventorySize": 18,
  "turnoverYieldGrade": "B",
  "breakEvenTurnover": 0.5,
  "summary": "Current: 2.5x/mo, 30% ROI, 60% yield. Optimal: 3.2x/mo → 85% yield (+25pp, grade B). Break-even: 0.5x/mo. Optimal inventory: 18 item-ov."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Override yieldCurve if AI provided all 7
        if (Array.isArray(parsed.yieldCurve) &&
            parsed.yieldCurve.length >= 7) {
          const aiCurve: YieldCurvePoint[] = [];
          const detByRate = new Map<number, YieldCurvePoint>();
          for (const c of maximization.yieldCurve) detByRate.set(c.turnoverRate, c);

          for (const ai of parsed.yieldCurve.slice(0, TURNOVER_RATES.length)) {
            if (!ai || typeof ai !== 'object') continue;
            const turnoverRateRaw = clampNum(ai.turnoverRate, RATE_MIN, RATE_MAX, aiCurve.length + 1);
            // Snap to nearest valid rate
            const nearest = TURNOVER_RATES.reduce((prev, curr) =>
              Math.abs(curr - turnoverRateRaw) < Math.abs(prev - turnoverRateRaw) ? curr : prev,
            );
            const det = detByRate.get(nearest);
            if (!det) continue;

            const projectedYield = round2(clampNum(
              ai.projectedYield,
              YIELD_MIN, YIELD_MAX, det.projectedYield,
            ));
            const projectedMonthlyProfit = round0(clampNum(
              ai.projectedMonthlyProfit,
              PROFIT_MIN, PROFIT_MAX, det.projectedMonthlyProfit,
            ));
            const projectedAnnualProfit = round0(clampNum(
              ai.projectedAnnualProfit,
              PROFIT_MIN, PROFIT_MAX, det.projectedAnnualProfit,
            ));
            const description = clampString(ai.description, MAX_DESCRIPTION_CHARS, det.description);
            const isOptimal = det.isOptimal; // keep deterministic flag initially; recompute later

            aiCurve.push({
              turnoverRate: nearest,
              projectedYield,
              projectedMonthlyProfit,
              projectedAnnualProfit,
              isOptimal,
              description,
            });
          }
          // Ensure all 7 rates present
          const coveredRates = new Set(aiCurve.map((c) => c.turnoverRate));
          for (const rate of TURNOVER_RATES) {
            if (!coveredRates.has(rate)) {
              const det = detByRate.get(rate);
              if (det) aiCurve.push(det);
            }
          }
          aiCurve.sort((a, b) => a.turnoverRate - b.turnoverRate);

          // Recompute isOptimal based on actual projectedYield
          const maxYield = Math.max(...aiCurve.map((c) => c.projectedYield));
          for (const c of aiCurve) {
            c.isOptimal = c.projectedYield === maxYield;
          }

          if (aiCurve.length === TURNOVER_RATES.length) {
            maximization = { ...maximization, yieldCurve: aiCurve };
          }
        }

        // Override optimalTurnoverRate
        if (parsed.optimalTurnoverRate !== undefined) {
          const v = round2(clampNum(
            parsed.optimalTurnoverRate,
            RATE_MIN, RATE_MAX, maximization.optimalTurnoverRate,
          ));
          maximization = { ...maximization, optimalTurnoverRate: v };
        } else {
          // Recompute from updated curve
          maximization = {
            ...maximization,
            optimalTurnoverRate: decideOptimalTurnoverRate(maximization.yieldCurve),
          };
        }

        // Override maximizedYield
        if (parsed.maximizedYield !== undefined) {
          const v = round2(clampNum(
            parsed.maximizedYield,
            YIELD_MIN, YIELD_MAX, maximization.maximizedYield,
          ));
          maximization = { ...maximization, maximizedYield: v };
        } else {
          // Recompute
          maximization = {
            ...maximization,
            maximizedYield: round2(clampNum(
              computeMaximizedYield(maximization.yieldCurve, maximization.optimalTurnoverRate),
              YIELD_MIN, YIELD_MAX, 0,
            )),
          };
        }

        // Override yieldUplift
        if (parsed.yieldUplift !== undefined) {
          const v = round2(clampNum(
            parsed.yieldUplift,
            UPLIFT_MIN, UPLIFT_MAX, maximization.yieldUplift,
          ));
          maximization = { ...maximization, yieldUplift: v };
        } else {
          maximization = {
            ...maximization,
            yieldUplift: round2(clampNum(
              maximization.maximizedYield - current.currentYield,
              UPLIFT_MIN, UPLIFT_MAX, 0,
            )),
          };
        }

        // Override turnoverYieldActions
        if (Array.isArray(parsed.turnoverYieldActions) &&
            parsed.turnoverYieldActions.length >= 3) {
          const aiActions = parsed.turnoverYieldActions
            .slice(0, MAX_ACTIONS)
            .map((a) => clampString(a, 200, 'Optimiziraj turnover.'))
            .filter((s) => s.length > 0);
          if (aiActions.length >= 3) {
            maximization = { ...maximization, turnoverYieldActions: aiActions };
          }
        }

        // Override optimalInventorySize
        if (parsed.optimalInventorySize !== undefined) {
          const v = round0(clampNum(
            parsed.optimalInventorySize,
            INVENTORY_MIN, INVENTORY_MAX, maximization.optimalInventorySize,
          ));
          maximization = { ...maximization, optimalInventorySize: v };
        }

        // Override turnoverYieldGrade
        if (parsed.turnoverYieldGrade) {
          const grade = clampEnum(parsed.turnoverYieldGrade, VALID_GRADE, maximization.turnoverYieldGrade);
          maximization = { ...maximization, turnoverYieldGrade: grade };
        } else {
          maximization = {
            ...maximization,
            turnoverYieldGrade: decideGrade(current.currentYield, maximization.maximizedYield),
          };
        }

        // Override breakEvenTurnover
        if (parsed.breakEvenTurnover !== undefined) {
          const v = round2(clampNum(
            parsed.breakEvenTurnover,
            RATE_MIN, RATE_MAX, maximization.breakEvenTurnover,
          ));
          maximization = { ...maximization, breakEvenTurnover: v };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-yield-maximizer',
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
    } satisfies InventoryTurnoverYieldResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-turnover-yield-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
