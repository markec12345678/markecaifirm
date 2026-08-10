// v8.06: AI Inventory Annualized Return Maximizer — AI MAXIMIZIRA ANNUALIZED
// RETURN na held inventory — pretvarja per-trade ROI v annualiziran rate za
// primerjavo z drugimi investicijami (stocks, bonds). "Tvoj annualized return
// je 52% — boljše od stocks, ampak bi lahko bilo 95% z optimalnim turnover."
// Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized
// cash yield čez portfolio z yieldComparisonTable) — ta MAKSIMIZIRA ANNUALIZED
// RETURN z returnMaximizationLevers in returnVsBenchmark. Razlika od
// inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve
// in optimalTurnoverRate) — ta maksimizira ANNUALIZED RETURN (not yield curve)
// z optimalHoldTime in returnProjection. Razlika od inventory-yield-maximizer
// (v8.03 ki maksimizira yield % per item z yieldGrade) — ta maksimizira
// PORTFOLIO ANNUALIZED RETURN z excessReturn in riskAdjustedReturn. Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital
// efficiency per item z reallocation) — ta maksimizira ANNUALIZED RETURN
// (realized + unrealized) z returnMaximizationLevers. Razlika od
// inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta
// maksimizira ANNUALIZED ROI (per-item ROI × 365/holdDays) z benchmark
// comparison. Razlika od inventory-profit-per-day-maximizer (v8.02 ki
// maksimizira daily profit per item) — ta maksimizira annualized % return
// (compared with stocks/bonds). Razlika od inventory-cash-conversion-maximizer
// (v7.98 ki maksimizira cash conversion) — ta daje ANNUALIZED RETURN VIEW z
// returnGrade in riskAdjustedReturn. Razlika od profit-compounding-maximizer
// (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira
// ANNUALIZED RETURN na HELD inventory z returnVsBenchmark in excessReturn.

// GET+POST /api/ai/inventory-annualized-return-maximizer
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

type ReturnGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

type ReturnLever =
  | 'FASTER_TURNOVER'
  | 'HIGHER_MARGIN'
  | 'BETTER_SOURCING'
  | 'LOWER_FEES';

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
  totalCapitalDeployed: number; // €
  heldInventoryCount: number;
  avgHoldDays: number;
  portfolioAnnualizedReturn: number; // % (weighted by capital)
  benchmarkReturn: number; // % (S&P 500 ~10%)
  excessReturn: number; // pp = portfolio − benchmark
  avgUnrealizedProfit: number; // € per item
}

interface PerItemReturn {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number; // €
  estValue: number; // €
  unrealizedProfit: number; // €
  holdDays: number; // days
  annualizedReturn: number; // % = (unrealizedProfit/capital) × (365/holdDays) × 100
  currentReturn: number; // % = unrealizedProfit / capital × 100 (non-annualized)
  aiRisk: number; // 0-100 (from Listing.aiRisk)
}

interface ReturnLeverItem {
  lever: ReturnLever;
  potentialGain: number; // pp uplift in annualized return
  action: string;
}

interface ReturnProjection {
  months: number; // 3, 6, 12
  projectedReturn: number; // % annualized at that horizon
  projectedProfit: number; // € absolute profit
}

interface ReturnMaximization {
  maximizedAnnualizedReturn: number; // % optimal achievable
  returnUplift: number; // pp improvement = maximized − current
  returnMaximizationLevers: ReturnLeverItem[];
  returnVsBenchmark: number; // pp = maximized − benchmark
  optimalHoldTime: number; // days that maximizes annualized return
  returnProjection: ReturnProjection[]; // 3, 6, 12 month
  returnGrade: ReturnGrade;
  riskAdjustedReturn: number; // % annualized adjusted for aiRisk
}

interface InventoryAnnualizedReturnResponse {
  ok: true;
  current: CurrentState;
  perItem: PerItemReturn[];
  maximization: ReturnMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedAnnualizedReturn?: number;
    returnUplift?: number;
    returnMaximizationLevers?: Array<{
      lever?: ReturnLever;
      potentialGain?: number;
      action?: string;
    }>;
    returnVsBenchmark?: number;
    optimalHoldTime?: number;
    returnProjection?: Array<{
      months?: number;
      projectedReturn?: number;
      projectedProfit?: number;
    }>;
    returnGrade?: ReturnGrade;
    riskAdjustedReturn?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const DAYS_PER_YEAR = 365;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 500_000;
const RETURN_MIN = -100;
const RETURN_MAX = 1000;
const HOLD_MIN = 1;
const HOLD_MAX = 365;
const BENCHMARK_MIN = 0;
const BENCHMARK_MAX = 100;
const EXCESS_MIN = -200;
const EXCESS_MAX = 1000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 500;
const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const DEFAULT_BENCHMARK = 10; // S&P 500 avg ~10% annualized

const VALID_GRADE: readonly ReturnGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_LEVER: readonly ReturnLever[] = [
  'FASTER_TURNOVER',
  'HIGHER_MARGIN',
  'BETTER_SOURCING',
  'LOWER_FEES',
];

const MAX_LEVERS = 4;
const MAX_PROJECTIONS = 3;
const MAX_ITEMS_PER_AI = 50;

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
  estValue: number; // aiEstimatedValue or fallback (price or buyPrice)
  unrealizedProfit: number; // estValue - capital
  holdDays: number;
  annualizedReturn: number; // %
  currentReturn: number; // %
  aiRisk: number;
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const aiEst = t.listing?.aiEstimatedValue ?? null;
  const listPrice = t.listing?.price ?? null;
  // estValue fallback chain: aiEstimatedValue → listing.price → buyPrice
  const estValue = aiEst && aiEst > 0
    ? aiEst
    : (listPrice && listPrice > 0 ? listPrice : buyPrice);
  const unrealizedProfit = estValue - capital;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((now - buyMs) / DAY_MS))
    : 1;
  const currentReturn = (unrealizedProfit / capital) * 100;
  const annualizedReturn = (unrealizedProfit / capital) * (DAYS_PER_YEAR / holdDays) * 100;
  const aiRisk = t.listing?.aiRisk ?? 50;
  const category = clampString(t.category ?? '', 60, 'drugo');
  return {
    id: t.id,
    title: clampString(t.title, 100, 'Brez naslova'),
    category,
    capital,
    estValue,
    unrealizedProfit,
    holdDays,
    annualizedReturn: round2(clampNum(annualizedReturn, RETURN_MIN, RETURN_MAX, 0)),
    currentReturn: round2(clampNum(currentReturn, RETURN_MIN, RETURN_MAX, 0)),
    aiRisk: round0(clampNum(aiRisk, SCORE_MIN, SCORE_MAX, 50)),
  };
}

interface SoldComputed {
  profit: number; // €
  cost: number; // €
  roi: number; // %
  holdDays: number;
  sellMs: number;
  within12m: boolean;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellFees = t.sellFees ?? 0;
  const cost = buyPrice + buyFees;
  if (cost <= 0) return null;
  const profit = (sellPrice - sellFees) - cost;
  const roi = (profit / cost) * 100;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { profit, cost, roi, holdDays, sellMs, within12m };
}

function computeCurrent(
  held: HeldComputed[],
  sold: SoldComputed[],
): CurrentState {
  const heldCount = held.length;
  const totalCapitalDeployed = round0(clampNum(
    held.reduce((s, h) => s + h.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  if (heldCount === 0) {
    return {
      totalCapitalDeployed: 0,
      heldInventoryCount: 0,
      avgHoldDays: 0,
      portfolioAnnualizedReturn: 0,
      benchmarkReturn: DEFAULT_BENCHMARK,
      excessReturn: 0,
      avgUnrealizedProfit: 0,
    };
  }

  // Weighted portfolio annualized return by capital
  const totalCapital = held.reduce((s, h) => s + h.capital, 0);
  const portfolioAnnualizedReturn = round2(clampNum(
    totalCapital > 0
      ? held.reduce((s, h) => s + h.annualizedReturn * h.capital, 0) / totalCapital
      : 0,
    RETURN_MIN, RETURN_MAX, 0,
  ));
  const avgHoldDays = round0(clampNum(
    held.reduce((s, h) => s + h.holdDays, 0) / heldCount,
    HOLD_MIN, HOLD_MAX, 30,
  ));
  const avgUnrealizedProfit = round0(clampNum(
    held.reduce((s, h) => s + h.unrealizedProfit, 0) / heldCount,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const benchmarkReturn = DEFAULT_BENCHMARK;
  const excessReturn = round2(clampNum(
    portfolioAnnualizedReturn - benchmarkReturn,
    EXCESS_MIN, EXCESS_MAX, 0,
  ));

  // Suppress unused warning when no SOLD trades
  void sold;

  return {
    totalCapitalDeployed,
    heldInventoryCount: heldCount,
    avgHoldDays,
    portfolioAnnualizedReturn,
    benchmarkReturn,
    excessReturn,
    avgUnrealizedProfit,
  };
}

function buildReturnLevers(
  current: CurrentState,
  held: HeldComputed[],
  sold12m: SoldComputed[],
): ReturnLeverItem[] {
  // Compute avg sold ROI for context on FASTER_TURNOVER
  const soldCount12m = sold12m.length;
  const avgSoldROI = soldCount12m > 0
    ? sold12m.reduce((s, t) => s + t.roi, 0) / soldCount12m
    : 30;
  const avgSoldHoldDays = soldCount12m > 0
    ? sold12m.reduce((s, t) => s + t.holdDays, 0) / soldCount12m
    : 30;

  const levers: ReturnLeverItem[] = [];

  // 1) FASTER_TURNOVER — biggest lever typically
  const fasterTurnoverGain = current.avgHoldDays > avgSoldHoldDays
    ? Math.min(100, ((current.avgHoldDays / Math.max(7, avgSoldHoldDays)) - 1) * 30)
    : Math.min(80, Math.max(20, avgSoldROI * 0.6));
  levers.push({
    lever: 'FASTER_TURNOVER',
    potentialGain: round2(clampNum(fasterTurnoverGain, UPLIFT_MIN, UPLIFT_MAX, 30)),
    action: `Skrajšaj avg hold time z ${current.avgHoldDays} na ${Math.max(7, Math.round(avgSoldHoldDays * 0.7))} dni z avtomatiziranim listing refresh, aggressive pricing in cross-platform exposure. Vsak dan krajši hold = +(365/holdDays) annualized factor.`,
  });

  // 2) HIGHER_MARGIN — premium pricing for held items
  const higherMarginGain = Math.min(120, Math.max(15, avgSoldROI * 0.4));
  levers.push({
    lever: 'HIGHER_MARGIN',
    potentialGain: round2(clampNum(higherMarginGain, UPLIFT_MIN, UPLIFT_MAX, 25)),
    action: 'Dvigni sell price za 12-18% z AI pricing engine, premium fotografijo, garancijo in premium pozicioniranjem — pretvori margin uplift v annualized return.',
  });

  // 3) BETTER_SOURCING — buy cheaper
  const betterSourcingGain = Math.min(150, Math.max(20, avgSoldROI * 0.5));
  levers.push({
    lever: 'BETTER_SOURCING',
    potentialGain: round2(clampNum(betterSourcingGain, UPLIFT_MIN, UPLIFT_MAX, 35)),
    action: 'Sourcing pod 60% market value z deal score filterjem + monitor alert-i za below-market listings. -10% buy price = +14% annualized return.',
  });

  // 4) LOWER_FEES — reduce buy+sell fees
  const lowerFeesGain = Math.min(60, Math.max(8, current.totalCapitalDeployed > 0 ? 12 : 8));
  levers.push({
    lever: 'LOWER_FEES',
    potentialGain: round2(clampNum(lowerFeesGain, UPLIFT_MIN, UPLIFT_MAX, 12)),
    action: 'Bundle multiple items za bulk shipping, izberi Bolha free insertion windows, premakni low-margin items na platforme z nižjimi fees (Subito/Kleinanzeigen). -3% fees = +8% annualized.',
  });

  void held;
  return levers.slice(0, MAX_LEVERS);
}

function computeMaximizedReturn(
  current: CurrentState,
  levers: ReturnLeverItem[],
): { maximizedAnnualizedReturn: number; returnUplift: number } {
  // Combined uplift from top-2 levers (diminishing returns: × 0.7)
  const sorted = [...levers].sort((a, b) => b.potentialGain - a.potentialGain);
  const top2 = sorted.slice(0, 2);
  const combinedGain = top2.reduce((s, l) => s + l.potentialGain, 0) * 0.7;
  const uplift = round2(clampNum(combinedGain, UPLIFT_MIN, UPLIFT_MAX, 0));
  const maximizedAnnualizedReturn = round2(clampNum(
    current.portfolioAnnualizedReturn + uplift,
    RETURN_MIN, RETURN_MAX, current.portfolioAnnualizedReturn,
  ));
  return { maximizedAnnualizedReturn, returnUplift: uplift };
}

function computeOptimalHoldTime(
  held: HeldComputed[],
  sold12m: SoldComputed[],
): number {
  // Heuristic: optimal hold time = max(7, sold12m avg hold × 0.7)
  const soldCount = sold12m.length;
  if (soldCount === 0) return 14;
  const avgHold = sold12m.reduce((s, t) => s + t.holdDays, 0) / soldCount;
  const optimal = Math.max(7, Math.round(avgHold * 0.7));
  void held;
  return round0(clampNum(optimal, HOLD_MIN, HOLD_MAX, 14));
}

function buildReturnProjection(
  current: CurrentState,
  maximizedAnnualizedReturn: number,
): ReturnProjection[] {
  const projections: ReturnProjection[] = [];
  for (const months of [3, 6, 12]) {
    // Projected return at horizon — annualized rate × fraction of year
    // For shorter horizons, projected return % is lower (proportional to months)
    const annualizedFraction = months / 12;
    const projectedReturn = round2(clampNum(
      maximizedAnnualizedReturn * annualizedFraction,
      RETURN_MIN, RETURN_MAX, 0,
    ));
    // Projected profit = totalCapital × projectedReturn/100
    const projectedProfit = round0(clampNum(
      current.totalCapitalDeployed * projectedReturn / 100,
      PROFIT_MIN, PROFIT_MAX, 0,
    ));
    projections.push({ months, projectedReturn, projectedProfit });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function computeRiskAdjustedReturn(
  maximizedAnnualizedReturn: number,
  held: HeldComputed[],
): number {
  if (held.length === 0) return 0;
  const avgAiRisk = held.reduce((s, h) => s + h.aiRisk, 0) / held.length;
  // Risk adjustment: subtract (avgAiRisk/100) × 30% of return
  // Higher aiRisk → more discount
  const riskDiscount = (avgAiRisk / 100) * 0.30 * maximizedAnnualizedReturn;
  const riskAdjusted = maximizedAnnualizedReturn - riskDiscount;
  return round2(clampNum(riskAdjusted, RETURN_MIN, RETURN_MAX, 0));
}

function decideReturnGrade(
  maximizedAnnualizedReturn: number,
  returnUplift: number,
  benchmark: number,
): ReturnGrade {
  const excessVsBenchmark = maximizedAnnualizedReturn - benchmark;
  // A+ if maximized ≥ 5x benchmark (≥50%) or uplift ≥ 100pp
  // A if maximized ≥ 3x benchmark (≥30%) or uplift ≥ 60pp
  // B if maximized ≥ 2x benchmark (≥20%) or uplift ≥ 30pp
  // C if maximized ≥ 1.5x benchmark (≥15%) or uplift ≥ 15pp
  // D if maximized ≥ 1x benchmark (≥10%) or uplift ≥ 5pp
  // else F
  if (maximizedAnnualizedReturn >= benchmark * 5 || returnUplift >= 100) return 'A+';
  if (maximizedAnnualizedReturn >= benchmark * 3 || returnUplift >= 60) return 'A';
  if (maximizedAnnualizedReturn >= benchmark * 2 || returnUplift >= 30) return 'B';
  if (maximizedAnnualizedReturn >= benchmark * 1.5 || returnUplift >= 15) return 'C';
  if (excessVsBenchmark >= 0 || returnUplift >= 5) return 'D';
  return 'F';
}

function buildSummary(
  current: CurrentState,
  max: ReturnMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.portfolioAnnualizedReturn}% annualized (${current.heldInventoryCount} items, ${current.totalCapitalDeployed}€ deployed, ${current.avgHoldDays}d hold).`,
    `Benchmark ${current.benchmarkReturn}% → excess ${current.excessReturn}pp.`,
    `Maximized: ${max.maximizedAnnualizedReturn}% (uplift +${max.returnUplift}pp, vs benchmark ${max.returnVsBenchmark}pp, grade ${max.returnGrade}).`,
    `Risk-adjusted: ${max.riskAdjustedReturn}%. Optimal hold: ${max.optimalHoldTime}d.`,
  ];
  return parts.join(' ').slice(0, 400);
}

function buildDeterministicMaximization(
  current: CurrentState,
  held: HeldComputed[],
  sold12m: SoldComputed[],
): ReturnMaximization {
  const returnMaximizationLevers = buildReturnLevers(current, held, sold12m);
  const { maximizedAnnualizedReturn, returnUplift } = computeMaximizedReturn(
    current,
    returnMaximizationLevers,
  );
  const optimalHoldTime = computeOptimalHoldTime(held, sold12m);
  const returnProjection = buildReturnProjection(current, maximizedAnnualizedReturn);
  const returnVsBenchmark = round2(clampNum(
    maximizedAnnualizedReturn - current.benchmarkReturn,
    EXCESS_MIN, EXCESS_MAX, 0,
  ));
  const returnGrade = decideReturnGrade(maximizedAnnualizedReturn, returnUplift, current.benchmarkReturn);
  const riskAdjustedReturn = computeRiskAdjustedReturn(maximizedAnnualizedReturn, held);

  return {
    maximizedAnnualizedReturn,
    returnUplift,
    returnMaximizationLevers,
    returnVsBenchmark,
    optimalHoldTime,
    returnProjection,
    returnGrade,
    riskAdjustedReturn,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryAnnualizedReturnMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryAnnualizedReturnMaximizer(req);
}

async function handleInventoryAnnualizedReturnMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-annualized-return-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query HELD trades + SOLD trades (last 12m) for historical benchmark
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
      return NextResponse.json({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          heldInventoryCount: 0,
          avgHoldDays: 0,
          portfolioAnnualizedReturn: 0,
          benchmarkReturn: DEFAULT_BENCHMARK,
          excessReturn: 0,
          avgUnrealizedProfit: 0,
        },
        perItem: [],
        maximization: {
          maximizedAnnualizedReturn: 0,
          returnUplift: 0,
          returnMaximizationLevers: [],
          returnVsBenchmark: -DEFAULT_BENCHMARK,
          optimalHoldTime: 0,
          returnProjection: [],
          returnGrade: 'F',
          riskAdjustedReturn: 0,
        },
        summary: 'Ni HELD in SOLD trgovin — Inventory Annualized Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD in SOLD trgovin — Inventory Annualized Return Maximizer ni mogoč.',
      } satisfies InventoryAnnualizedReturnResponse);
    }

    // 2) Compute HELD trades
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    // If no HELD trades, can't compute annualized return (need estValue)
    if (heldComputed.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          heldInventoryCount: 0,
          avgHoldDays: 0,
          portfolioAnnualizedReturn: 0,
          benchmarkReturn: DEFAULT_BENCHMARK,
          excessReturn: 0,
          avgUnrealizedProfit: 0,
        },
        perItem: [],
        maximization: {
          maximizedAnnualizedReturn: 0,
          returnUplift: 0,
          returnMaximizationLevers: [],
          returnVsBenchmark: -DEFAULT_BENCHMARK,
          optimalHoldTime: 0,
          returnProjection: [],
          returnGrade: 'F',
          riskAdjustedReturn: 0,
        },
        summary: 'Ni HELD trgovin (z estValue) — Inventory Annualized Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin (z estValue) — Inventory Annualized Return Maximizer ni mogoč.',
      } satisfies InventoryAnnualizedReturnResponse);
    }

    // Compute SOLD trades (within 12m)
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    const current = computeCurrent(heldComputed, soldComputed);
    let maximization = buildDeterministicMaximization(current, heldComputed, soldComputed);
    let summary = buildSummary(current, maximization);

    // Build perItem (limited for AI context but full payload for response)
    const perItem: PerItemReturn[] = heldComputed.map((h) => ({
      tradeId: h.id,
      title: h.title,
      category: h.category,
      capitalDeployed: h.capital,
      estValue: h.estValue,
      unrealizedProfit: round0(clampNum(h.unrealizedProfit, PROFIT_MIN, PROFIT_MAX, 0)),
      holdDays: h.holdDays,
      annualizedReturn: h.annualizedReturn,
      currentReturn: h.currentReturn,
      aiRisk: h.aiRisk,
    }));

    // 3) AI cache check (6h TTL) — key by held inventory composition
    const heldItemIdsHash = heldComputed.map((h) => h.id).sort().join(',').slice(0, 200);
    const cacheKey = `inventory-annualized-return-maximizer:${heldItemIdsHash}`;
    const cached = getCachedAI<{
      maximization: ReturnMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        perItem,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryAnnualizedReturnResponse);
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
        profit: h.unrealizedProfit,
        holdDays: h.holdDays,
        annRet: h.annualizedReturn,
        curRet: h.currentReturn,
        risk: h.aiRisk,
      }));

    const promptData = {
      heldCount: heldComputed.length,
      soldCount12m: soldComputed.length,
      current,
      perItemSample: perItemForAI,
      deterministicMaximization: {
        maximizedAnnualizedReturn: maximization.maximizedAnnualizedReturn,
        returnUplift: maximization.returnUplift,
        returnMaximizationLevers: maximization.returnMaximizationLevers,
        returnVsBenchmark: maximization.returnVsBenchmark,
        optimalHoldTime: maximization.optimalHoldTime,
        returnProjection: maximization.returnProjection,
        returnGrade: maximization.returnGrade,
        riskAdjustedReturn: maximization.riskAdjustedReturn,
      },
      caps: {
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        returnMin: RETURN_MIN, returnMax: RETURN_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        benchmarkMin: BENCHMARK_MIN, benchmarkMax: BENCHMARK_MAX,
        excessMin: EXCESS_MIN, excessMax: EXCESS_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      },
    };

    const prompt = `Si AI "Inventory Annualized Return Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za ANNUALIZED RETURN MAXIMIZATION na held inventory — kako maksimizirati annualiziran % return na inventory capital, da je primerljiv z drugimi investicijami (stocks, bonds, real estate). Tvoj cilj je "tvoj annualized return je 52% — boljše od stocks (10%), ampak bi lahko bilo 95% z optimalnim turnover in 4 return levers." Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield čez portfolio z yieldComparisonTable) — ti MAKSIMIZIRAŠ ANNUALIZED RETURN z returnMaximizationLevers in returnVsBenchmark. Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve in optimalTurnoverRate) — ta maksimizira ANNUALIZED RETURN (not yield curve) z optimalHoldTime in returnProjection. Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item z yieldGrade) — ta maksimizira PORTFOLIO ANNUALIZED RETURN z excessReturn in riskAdjustedReturn. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ta maksimizira ANNUALIZED RETURN (realized + unrealized) z returnMaximizationLevers. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta maksimizira ANNUALIZED ROI (per-item ROI × 365/holdDays) z benchmark comparison. Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ta maksimizira annualized % return (compared with stocks/bonds). Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) — ta daje ANNUALIZED RETURN VIEW z returnGrade in riskAdjustedReturn. Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira ANNUALIZED RETURN na HELD inventory z returnVsBenchmark in excessReturn.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trades z listing.aiEstimatedValue + SOLD trades zadnjih 12m za historical benchmark):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedAnnualizedReturn % [-100, 1000] (≥ current.portfolioAnnualizedReturn, ≤ current × 1.8 ali +300pp absolute),
2. maximization.returnUplift pp [0, 500] (improvement = maximized − current),
3. maximization.returnMaximizationLevers: 4 elementi { lever: FASTER_TURNOVER | HIGHER_MARGIN | BETTER_SOURCING | LOWER_FEES, potentialGain pp [0, 500] (koliko pp leta annualized return — FASTER_TURNOVER ~30-100, BETTER_SOURCING ~20-150, HIGHER_MARGIN ~15-120, LOWER_FEES ~8-60), action (max 200, slovenski — specifična akcija) },
4. maximization.returnVsBenchmark pp [-200, 1000] (maximized − benchmark, tipično +30 do +200pp za profitabilno flipping),
5. maximization.optimalHoldTime dni [1, 365] (hold time ki maksimizira annualized return — shorter hold = higher annualized factor, vendar ne prekratko ker margin trpi),
6. maximization.returnProjection: 3 elementi { months 3/6/12, projectedReturn % [-100, 1000] (annualized × months/12), projectedProfit € [-100000, 1000000] (totalCapital × projectedReturn/100) },
7. maximization.returnGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 5x benchmark (≥50%) ali uplift ≥ 100pp, A ≥ 3x/60, B ≥ 2x/30, C ≥ 1.5x/15, D ≥ 1x/5, else F),
8. maximization.riskAdjustedReturn % [-100, 1000] (maximized − risk discount, where risk discount = avgAiRisk/100 × 0.30 × maximized),
9. summary: slovenski povzetek (max 400 znakov — primerjaj z stocks/bonds, poudari excess return).

VRNI LE JSON:
{
  "maximization": {
    "maximizedAnnualizedReturn": 95,
    "returnUplift": 43,
    "returnMaximizationLevers": [
      { "lever": "FASTER_TURNOVER", "potentialGain": 50, "action": "Skrajšaj hold z 30 na 14 dni z avtomatiziranim listing refresh." },
      { "lever": "BETTER_SOURCING", "potentialGain": 80, "action": "Sourcing pod 60% market value z deal score filterjem." }
    ],
    "returnVsBenchmark": 85,
    "optimalHoldTime": 14,
    "returnProjection": [
      { "months": 3, "projectedReturn": 23.75, "projectedProfit": 2375 },
      { "months": 6, "projectedReturn": 47.5, "projectedProfit": 4750 },
      { "months": 12, "projectedReturn": 95, "projectedProfit": 9500 }
    ],
    "returnGrade": "A",
    "riskAdjustedReturn": 78
  },
  "summary": "Current: 52% annualized (8 items, 10000€ deployed, 30d hold). Benchmark 10% → excess +42pp. Maximized: 95% (uplift +43pp, vs benchmark +85pp, grade A). Risk-adjusted: 78%. Optimal hold: 14d."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override maximizedAnnualizedReturn — anti-hallucination bounds
        if (aiMax.maximizedAnnualizedReturn !== undefined) {
          const minBound = current.portfolioAnnualizedReturn;
          const maxBound = Math.max(
            minBound + 1,
            Math.min(
              RETURN_MAX,
              Math.max(current.portfolioAnnualizedReturn * 1.8, current.portfolioAnnualizedReturn + 300),
            ),
          );
          const maximizedAnnualizedReturn = round2(clampNum(
            aiMax.maximizedAnnualizedReturn,
            minBound, maxBound, maximization.maximizedAnnualizedReturn,
          ));
          const returnUplift = round2(clampNum(
            maximizedAnnualizedReturn - current.portfolioAnnualizedReturn,
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          maximization = {
            ...maximization,
            maximizedAnnualizedReturn,
            returnUplift,
          };
        }

        // Override returnMaximizationLevers — must be all 4 distinct levers
        if (Array.isArray(aiMax.returnMaximizationLevers) &&
            aiMax.returnMaximizationLevers.length >= 4) {
          const aiLevers: ReturnLeverItem[] = [];
          const seen = new Set<ReturnLever>();
          for (const l of aiMax.returnMaximizationLevers.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            const lever = clampEnum(l.lever, VALID_LEVER, 'FASTER_TURNOVER');
            if (seen.has(lever)) continue; // dedupe
            seen.add(lever);
            aiLevers.push({
              lever,
              potentialGain: round2(clampNum(
                l.potentialGain,
                UPLIFT_MIN, UPLIFT_MAX, 20,
              )),
              action: clampString(l.action, 200, 'Izboljšaj turnover in margin.'),
            });
          }
          if (aiLevers.length >= 4) {
            maximization = { ...maximization, returnMaximizationLevers: aiLevers };
          }
        }

        // Override optimalHoldTime
        if (aiMax.optimalHoldTime !== undefined) {
          const v = round0(clampNum(
            aiMax.optimalHoldTime,
            HOLD_MIN, HOLD_MAX, maximization.optimalHoldTime,
          ));
          maximization = { ...maximization, optimalHoldTime: v };
        }

        // Override returnProjection — must be 3 entries with months 3/6/12
        if (Array.isArray(aiMax.returnProjection) &&
            aiMax.returnProjection.length >= 3) {
          const aiProj: ReturnProjection[] = [];
          const expectedMonths = [3, 6, 12];
          for (const expected of expectedMonths) {
            const ai = aiMax.returnProjection.find(
              (p) => p && Number(p.months) === expected,
            );
            if (!ai) continue;
            const projectedReturn = round2(clampNum(
              ai.projectedReturn,
              RETURN_MIN, RETURN_MAX, 0,
            ));
            const projectedProfit = round0(clampNum(
              ai.projectedProfit,
              PROFIT_MIN, PROFIT_MAX, 0,
            ));
            aiProj.push({ months: expected, projectedReturn, projectedProfit });
          }
          if (aiProj.length === 3) {
            maximization = { ...maximization, returnProjection: aiProj };
          }
        }

        // Override returnVsBenchmark — recompute or use AI value
        if (aiMax.returnVsBenchmark !== undefined) {
          const v = round2(clampNum(
            aiMax.returnVsBenchmark,
            EXCESS_MIN, EXCESS_MAX,
            maximization.maximizedAnnualizedReturn - current.benchmarkReturn,
          ));
          maximization = { ...maximization, returnVsBenchmark: v };
        } else {
          maximization = {
            ...maximization,
            returnVsBenchmark: round2(clampNum(
              maximization.maximizedAnnualizedReturn - current.benchmarkReturn,
              EXCESS_MIN, EXCESS_MAX, 0,
            )),
          };
        }

        // Override riskAdjustedReturn
        if (aiMax.riskAdjustedReturn !== undefined) {
          const v = round2(clampNum(
            aiMax.riskAdjustedReturn,
            RETURN_MIN, RETURN_MAX,
            computeRiskAdjustedReturn(maximization.maximizedAnnualizedReturn, heldComputed),
          ));
          maximization = { ...maximization, riskAdjustedReturn: v };
        } else {
          maximization = {
            ...maximization,
            riskAdjustedReturn: computeRiskAdjustedReturn(
              maximization.maximizedAnnualizedReturn,
              heldComputed,
            ),
          };
        }

        // Override returnGrade — recompute or use AI value
        if (aiMax.returnGrade) {
          const grade = clampEnum(
            aiMax.returnGrade,
            VALID_GRADE,
            decideReturnGrade(
              maximization.maximizedAnnualizedReturn,
              maximization.returnUplift,
              current.benchmarkReturn,
            ),
          );
          maximization = { ...maximization, returnGrade: grade };
        } else {
          maximization = {
            ...maximization,
            returnGrade: decideReturnGrade(
              maximization.maximizedAnnualizedReturn,
              maximization.returnUplift,
              current.benchmarkReturn,
            ),
          };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-annualized-return-maximizer',
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
      perItem,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryAnnualizedReturnResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-annualized-return-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
