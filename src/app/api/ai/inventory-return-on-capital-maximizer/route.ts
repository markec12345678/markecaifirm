// v8.08: AI Inventory Return On Capital Maximizer — AI MAKSIMIZIRA RETURN ON
// CAPITAL (ROC) za HELD inventory — ne samo ROI per item, ampak overall ROC celotne
// inventory portfolio. "Tvoj ROC je 22%, ampak bi lahko bil 38% z boljšim inventory
// mix in hitrejšim turnover." Razlika od inventory-capital-return-maximizer (v8.07
// ki maksimizira return OF capital — koliko deployed capital se vrne) — ta
// MAKSIMIZIRA RETURN ON CAPITAL (ROC = unrealized profit / total capital deployed
// × 100, ne return rate of capital). Razlika od inventory-annualized-return-
// maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ta
// maksimizira ROC z rocMaximizationLevers in capitalReallocationPlan (ne sam %
// annualized return). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira
// ROI per item) — ta maksimizira PORTFOLIO ROC z optimalPortfolioComposition in
// rocVsBenchmark. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki
// maksimizira capital efficiency per item z reallocation) — ta maksimizira ROC z
// inventoryMixOptimization (ne sam per-item efficiency). Razlika od
// inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) — ta
// maksimizira ROC (return on capital, ne cash yield). Razlika od
// inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ta
// maksimizira ROC z rocProjection (3/6/12 month). Razlika od inventory-yield-
// maximizer (v8.03 ki maksimizira yield % per item) — ta maksimizira PORTFOLIO
// ROC z rocGrade in rocVsBenchmark. Razlika od profit-per-euro-maximizer (v8.07 ki
// maksimizira profit per euro deployed čez SOLD+HELD) — ta maksimizira ROC samo
// za HELD inventory (return ON capital %, ne €/€ ratio). Razlika od
// inventory-capital-allocator (v7.97 ki alloca capital per item) — ta maksimizira
// ROC z capitalReallocationPlan med low-ROC in high-ROC items.

// GET+POST /api/ai/inventory-return-on-capital-maximizer
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

type RocGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

type RocLever =
  | 'OPTIMIZE_INVENTORY_MIX'
  | 'FASTER_TURNOVER'
  | 'BETTER_SOURCING'
  | 'REDUCE_IDLE_CAPITAL';

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
    aiRisk: number | null;
    dealScore: number | null;
    aiScore: number | null;
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
  totalCapitalDeployed: number; // € = sum(buyPrice + buyFees) over HELD
  totalUnrealizedProfit: number; // € = sum(estValue - capital) over HELD
  currentROC: number; // % = unrealizedProfit / totalCapitalDeployed × 100
  annualizedROC: number; // % (extrapolated to annual based on avg hold)
  heldInventoryCount: number;
  avgHoldDays: number;
  avgEstValue: number; // €
}

interface RocLeverItem {
  lever: RocLever;
  potentialGain: number; // pp (percentage point ROC uplift)
  action: string; // slovenski
}

interface InventoryMixOptimization {
  increaseCategories: string[]; // categories to increase allocation
  decreaseCategories: string[]; // categories to decrease allocation
  rationale: string; // slovenski
}

interface CapitalReallocationEntry {
  fromCategory: string;
  toCategory: string;
  amount: number; // €
  expectedRocGain: number; // pp
}

interface RocProjectionEntry {
  months: number; // 3, 6, 12
  projectedROC: number; // %
  projectedProfit: number; // €
}

interface InventoryReturnOnCapitalMaximization {
  maximizedROC: number; // % optimal achievable
  rocUplift: number; // pp improvement
  rocMaximizationLevers: RocLeverItem[];
  inventoryMixOptimization: InventoryMixOptimization;
  capitalReallocationPlan: CapitalReallocationEntry[];
  rocProjection: RocProjectionEntry[];
  rocGrade: RocGrade;
  rocVsBenchmark: {
    bankDeposit: number; // % = 2
    stocks: number; // % = 8
    realEstate: number; // % = 5
    yourCurrentROC: number; // %
    yourMaximizedROC: number; // %
    maximizedVsBank: number; // pp
    maximizedVsStocks: number; // pp
    maximizedVsRealEstate: number; // pp
  };
  optimalPortfolioComposition: string; // slovenski
}

interface InventoryReturnOnCapitalResponse {
  ok: true;
  current: CurrentState;
  maximization: InventoryReturnOnCapitalMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedROC?: number;
    rocUplift?: number;
    rocMaximizationLevers?: Array<{
      lever?: RocLever;
      potentialGain?: number;
      action?: string;
    }>;
    inventoryMixOptimization?: {
      increaseCategories?: string[];
      decreaseCategories?: string[];
      rationale?: string;
    };
    capitalReallocationPlan?: Array<{
      fromCategory?: string;
      toCategory?: string;
      amount?: number;
      expectedRocGain?: number;
    }>;
    rocProjection?: Array<{
      months?: number;
      projectedROC?: number;
      projectedProfit?: number;
    }>;
    rocGrade?: RocGrade;
    optimalPortfolioComposition?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const PROFIT_MIN = -500_000;
const PROFIT_MAX = 1_000_000;
const ROC_MIN = -50;
const ROC_MAX = 500;
const ANNUALIZED_ROC_MIN = -100;
const ANNUALIZED_ROC_MAX = 1000;
const GAIN_MIN = 0;
const GAIN_MAX = 200; // pp
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 300;
const HOLD_MIN = 1;
const HOLD_MAX = 730;
const PROJECTION_ROC_MIN = -50;
const PROJECTION_ROC_MAX = 500;
const PROJECTION_PROFIT_MIN = -1_000_000;
const PROJECTION_PROFIT_MAX = 5_000_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const AMOUNT_MIN = 0;
const AMOUNT_MAX = 1_000_000;

const BENCHMARK_BANK = 2; // % bank deposit
const BENCHMARK_STOCKS = 8; // % stocks (S&P 500)
const BENCHMARK_REAL_ESTATE = 5; // % real estate

const VALID_GRADE: readonly RocGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_LEVER: readonly RocLever[] = [
  'OPTIMIZE_INVENTORY_MIX',
  'FASTER_TURNOVER',
  'BETTER_SOURCING',
  'REDUCE_IDLE_CAPITAL',
];

const MAX_LEVERS = 4;
const MAX_REALLOCATIONS = 5;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;

const LEVER_GAIN: Record<RocLever, number> = {
  OPTIMIZE_INVENTORY_MIX: 8, // +8pp by mix optimization
  FASTER_TURNOVER: 6, // +6pp by faster turnover
  BETTER_SOURCING: 5, // +5pp by better sourcing
  REDUCE_IDLE_CAPITAL: 3, // +3pp by reducing idle capital
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

interface HeldComputed {
  id: string;
  category: string;
  capital: number;
  estValue: number;
  unrealizedProfit: number;
  holdDays: number;
  roc: number; // % per item
}

interface SoldComputed {
  capital: number;
  profit: number;
  holdDays: number;
  sellMs: number;
  within12m: boolean;
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
  const unrealizedProfit = estValue - capital;
  const roc = capital > 0 ? (unrealizedProfit / capital) * 100 : 0;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((now - buyMs) / DAY_MS))
    : 1;
  const category = clampString(t.category ?? '', 60, 'drugo');
  return {
    id: t.id,
    category,
    capital,
    estValue,
    unrealizedProfit,
    holdDays,
    roc,
  };
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

function computeCurrent(
  held: HeldComputed[],
  sold: SoldComputed[],
  now: number,
): CurrentState {
  const heldCount = held.length;

  const totalCapitalDeployed = round0(clampNum(
    held.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const totalUnrealizedProfit = round0(clampNum(
    held.reduce((s, t) => s + t.unrealizedProfit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const currentROC = round2(clampNum(
    totalCapitalDeployed > 0
      ? (totalUnrealizedProfit / totalCapitalDeployed) * 100
      : 0,
    ROC_MIN, ROC_MAX, 0,
  ));

  // Avg hold days from HELD (or fall back to SOLD 12m if no HELD)
  const avgHoldDays = round0(clampNum(
    heldCount > 0
      ? held.reduce((s, t) => s + t.holdDays, 0) / heldCount
      : (sold.length > 0
        ? sold.reduce((s, t) => s + t.holdDays, 0) / sold.length
        : 30),
    HOLD_MIN, HOLD_MAX, 30,
  ));

  // Annualized ROC = currentROC × (365 / avgHoldDays)
  const annualizedROC = round2(clampNum(
    avgHoldDays > 0 ? currentROC * (365 / avgHoldDays) : 0,
    ANNUALIZED_ROC_MIN, ANNUALIZED_ROC_MAX, 0,
  ));

  const avgEstValue = round2(clampNum(
    heldCount > 0
      ? held.reduce((s, t) => s + t.estValue, 0) / heldCount
      : 0,
    0, CAPITAL_MAX, 0,
  ));

  // Suppress unused-now warning while keeping helper available
  void now;

  return {
    totalCapitalDeployed,
    totalUnrealizedProfit,
    currentROC,
    annualizedROC,
    heldInventoryCount: heldCount,
    avgHoldDays,
    avgEstValue,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildRocLevers(current: CurrentState): RocLeverItem[] {
  const levers: RocLeverItem[] = [];

  // 1) OPTIMIZE_INVENTORY_MIX — move capital to higher-ROC categories
  levers.push({
    lever: 'OPTIMIZE_INVENTORY_MIX',
    potentialGain: round2(clampNum(
      LEVER_GAIN.OPTIMIZE_INVENTORY_MIX,
      GAIN_MIN, GAIN_MAX, 8,
    )),
    action: 'Premakni capital iz low-ROC kategorij v high-ROC kategorije. Analiziraj kategorije z ROC > 30% in povečaj allocation. Razširi kategorije z dokazano hitrim turnover in visokim unrealized profit.',
  });

  // 2) FASTER_TURNOVER — shorter hold → higher annualized ROC
  const turnoverGap = current.avgHoldDays > 14
    ? Math.min(15, ((current.avgHoldDays - 14) / Math.max(1, current.avgHoldDays)) * 30)
    : 2;
  levers.push({
    lever: 'FASTER_TURNOVER',
    potentialGain: round2(clampNum(
      LEVER_GAIN.FASTER_TURNOVER * (turnoverGap / 10),
      GAIN_MIN, GAIN_MAX, 4,
    )),
    action: `Skrajšaj avg hold z ${current.avgHoldDays} na ${Math.max(7, Math.round(current.avgHoldDays * 0.6))} dni z avtomatiziranim listing refresh, aggressive pricing in cross-platform exposure. Krajiši hold = več cycle-ov/leto = višji annualized ROC.`,
  });

  // 3) BETTER_SOURCING — buy below market value
  levers.push({
    lever: 'BETTER_SOURCING',
    potentialGain: round2(clampNum(
      LEVER_GAIN.BETTER_SOURCING,
      GAIN_MIN, GAIN_MAX, 5,
    )),
    action: 'Sourcing pod 60% market value z AI deal score filterjem in monitor alert-i za below-market listings. Vsak -10% na buy price = +10pp ROC. Cilj: deal score > 80 pri vsakem novem nakupu.',
  });

  // 4) REDUCE_IDLE_CAPITAL — sell or repurpose stale items
  levers.push({
    lever: 'REDUCE_IDLE_CAPITAL',
    potentialGain: round2(clampNum(
      LEVER_GAIN.REDUCE_IDLE_CAPITAL,
      GAIN_MIN, GAIN_MAX, 3,
    )),
    action: 'Identificiraj HELD items z hold > 90 dni in unrealized profit < 0 — prodaj ali bundle. Sproščen capital reinvestiraj v high-ROC items. -10% idle capital = +3pp portfolio ROC.',
  });

  return levers.slice(0, MAX_LEVERS);
}

function computeMaximizedROC(
  current: CurrentState,
  levers: RocLeverItem[],
): { maximizedROC: number; rocUplift: number } {
  // Combined uplift from top-3 levers (diminishing returns × 0.7)
  const sorted = [...levers].sort((a, b) => b.potentialGain - a.potentialGain);
  const top3 = sorted.slice(0, 3);
  const combinedGain = top3.reduce((s, l) => s + l.potentialGain, 0) * 0.7;
  const uplift = round2(clampNum(
    combinedGain, UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const maximized = round2(clampNum(
    current.currentROC + uplift,
    ROC_MIN, ROC_MAX, current.currentROC,
  ));
  return { maximizedROC: maximized, rocUplift: uplift };
}

function buildInventoryMixOptimization(
  held: HeldComputed[],
): InventoryMixOptimization {
  // Group by category and compute ROC per category
  const catMap = new Map<string, { capital: number; profit: number; count: number }>();
  for (const h of held) {
    let agg = catMap.get(h.category);
    if (!agg) {
      agg = { capital: 0, profit: 0, count: 0 };
      catMap.set(h.category, agg);
    }
    agg.capital += h.capital;
    agg.profit += h.unrealizedProfit;
    agg.count++;
  }

  const catRocs: Array<{ category: string; roc: number; capital: number }> = [];
  for (const [cat, agg] of catMap) {
    const roc = agg.capital > 0 ? (agg.profit / agg.capital) * 100 : 0;
    catRocs.push({ category: cat, roc, capital: agg.capital });
  }

  // Sort by ROC desc — top half = increase, bottom half = decrease
  catRocs.sort((a, b) => b.roc - a.roc);
  const half = Math.max(1, Math.ceil(catRocs.length / 2));
  const increaseCategories = catRocs.slice(0, half).map((c) => c.category);
  const decreaseCategories = catRocs.slice(half).map((c) => c.category);

  const topCat = catRocs[0];
  const bottomCat = catRocs[catRocs.length - 1];
  const rationale = `Top ROC kategorija: ${topCat?.category ?? 'n/a'} (${round2(topCat?.roc ?? 0)}% ROC). ` +
    `Bottom: ${bottomCat?.category ?? 'n/a'} (${round2(bottomCat?.roc ?? 0)}% ROC). ` +
    `Premakni 30% capital iz low-ROC v high-ROC za +${round2(LEVER_GAIN.OPTIMIZE_INVENTORY_MIX)}pp portfolio ROC.`;

  return {
    increaseCategories: increaseCategories.slice(0, 5),
    decreaseCategories: decreaseCategories.slice(0, 5),
    rationale: rationale.slice(0, 400),
  };
}

function buildCapitalReallocationPlan(
  held: HeldComputed[],
  _current: CurrentState,
): CapitalReallocationEntry[] {
  const catMap = new Map<string, { capital: number; profit: number }>();
  for (const h of held) {
    let agg = catMap.get(h.category);
    if (!agg) {
      agg = { capital: 0, profit: 0 };
      catMap.set(h.category, agg);
    }
    agg.capital += h.capital;
    agg.profit += h.unrealizedProfit;
  }
  const catRocs = Array.from(catMap.entries()).map(([cat, agg]) => ({
    category: cat,
    capital: agg.capital,
    roc: agg.capital > 0 ? (agg.profit / agg.capital) * 100 : 0,
  }));
  catRocs.sort((a, b) => b.roc - a.roc);

  const reallocs: CapitalReallocationEntry[] = [];
  // Top 3 high-ROC categories receive from bottom 3 low-ROC categories
  const top = catRocs.slice(0, 3);
  const bottom = catRocs.slice(-3).reverse();

  for (let i = 0; i < Math.min(top.length, bottom.length); i++) {
    const fromCat = bottom[i];
    const toCat = top[i];
    if (!fromCat || !toCat || fromCat.category === toCat.category) continue;
    const amount = round0(clampNum(
      fromCat.capital * 0.30, // move 30% of from-cat capital
      AMOUNT_MIN, AMOUNT_MAX, 0,
    ));
    if (amount < 50) continue; // skip tiny reallocations
    const expectedRocGain = round2(clampNum(
      (toCat.roc - fromCat.roc) * 0.30, // 30% of ROC differential
      GAIN_MIN, GAIN_MAX, 1,
    ));
    reallocs.push({
      fromCategory: fromCat.category,
      toCategory: toCat.category,
      amount,
      expectedRocGain,
    });
  }

  return reallocs.slice(0, MAX_REALLOCATIONS);
}

function buildRocProjection(
  current: CurrentState,
  maximizedROC: number,
): RocProjectionEntry[] {
  const projections: RocProjectionEntry[] = [];
  for (const months of [3, 6, 12]) {
    const adoptionFraction = months / 12;
    const projectedROC = round2(clampNum(
      current.currentROC + (maximizedROC - current.currentROC) * adoptionFraction,
      PROJECTION_ROC_MIN, PROJECTION_ROC_MAX, 0,
    ));
    // Projected profit = totalCapital × projectedROC / 100 × (months/12)
    const projectedProfit = round0(clampNum(
      current.totalCapitalDeployed * (projectedROC / 100) * (months / 12),
      PROJECTION_PROFIT_MIN, PROJECTION_PROFIT_MAX, 0,
    ));
    projections.push({ months, projectedROC, projectedProfit });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function decideRocGrade(maximizedROC: number, uplift: number): RocGrade {
  // A+ if maximized ≥ 100% or uplift ≥ 50pp
  // A if maximized ≥ 50% or uplift ≥ 30
  // B if maximized ≥ 25% or uplift ≥ 15
  // C if maximized ≥ 10% or uplift ≥ 5
  // D if maximized ≥ 0% or uplift ≥ 1
  // else F (negative ROC)
  if (maximizedROC >= 100 || uplift >= 50) return 'A+';
  if (maximizedROC >= 50 || uplift >= 30) return 'A';
  if (maximizedROC >= 25 || uplift >= 15) return 'B';
  if (maximizedROC >= 10 || uplift >= 5) return 'C';
  if (maximizedROC >= 0 || uplift >= 1) return 'D';
  return 'F';
}

function buildOptimalPortfolioComposition(
  current: CurrentState,
  held: HeldComputed[],
): string {
  // Compute category mix and recommend optimal mix
  const catMap = new Map<string, number>();
  for (const h of held) {
    catMap.set(h.category, (catMap.get(h.category) ?? 0) + h.capital);
  }
  const totalCap = current.totalCapitalDeployed > 0 ? current.totalCapitalDeployed : 1;
  const top3 = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, cap]) => `${cat} (${Math.round((cap / totalCap) * 100)}%)`)
    .join(', ');

  return `Optimal inventory mix za max ROC: 40% v high-ROC quick-flip kategorijah ` +
    `(deal score > 80, hold < 21 dni, ROC > 30%), 35% v premium slow-flip ` +
    `(AI est. value > 1.5× buy, hold 30-60 dni, ROC > 50%), 20% v seasonal/bundle items ` +
    `(bundle-profit-optimizer, ROC > 20%), 5% reserve za bargain hunting (deal score > 90, ROC > 100%). ` +
    `Trenutno top 3 kategorije: ${top3}. Cilj annualized ROC ≥ 50% (vs benchmark stocks 8%).`;
}

function buildDeterministicMaximization(
  current: CurrentState,
  held: HeldComputed[],
): InventoryReturnOnCapitalMaximization {
  const rocMaximizationLevers = buildRocLevers(current);
  const { maximizedROC, rocUplift } = computeMaximizedROC(current, rocMaximizationLevers);
  const inventoryMixOptimization = buildInventoryMixOptimization(held);
  const capitalReallocationPlan = buildCapitalReallocationPlan(held, current);
  const rocProjection = buildRocProjection(current, maximizedROC);
  const rocGrade = decideRocGrade(maximizedROC, rocUplift);
  const optimalPortfolioComposition = buildOptimalPortfolioComposition(current, held);

  return {
    maximizedROC,
    rocUplift,
    rocMaximizationLevers,
    inventoryMixOptimization,
    capitalReallocationPlan,
    rocProjection,
    rocGrade,
    rocVsBenchmark: {
      bankDeposit: BENCHMARK_BANK,
      stocks: BENCHMARK_STOCKS,
      realEstate: BENCHMARK_REAL_ESTATE,
      yourCurrentROC: round2(clampNum(current.currentROC, ROC_MIN, ROC_MAX, 0)),
      yourMaximizedROC: round2(clampNum(maximizedROC, ROC_MIN, ROC_MAX, 0)),
      maximizedVsBank: round2(clampNum(
        maximizedROC - BENCHMARK_BANK, -100, 500, 0,
      )),
      maximizedVsStocks: round2(clampNum(
        maximizedROC - BENCHMARK_STOCKS, -100, 500, 0,
      )),
      maximizedVsRealEstate: round2(clampNum(
        maximizedROC - BENCHMARK_REAL_ESTATE, -100, 500, 0,
      )),
    },
    optimalPortfolioComposition: optimalPortfolioComposition.slice(0, 500),
  };
}

function buildSummary(
  current: CurrentState,
  max: InventoryReturnOnCapitalMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.currentROC.toFixed(2)}% ROC (${current.totalCapitalDeployed}€ deployed, ${current.totalUnrealizedProfit}€ unrealized, ${current.heldInventoryCount} HELD).`,
    `Maximized: ${max.maximizedROC.toFixed(2)}% (uplift +${max.rocUplift.toFixed(2)}pp, grade ${max.rocGrade}).`,
    `Vs stocks: ${max.rocVsBenchmark.maximizedVsStocks}pp, vs bank: ${max.rocVsBenchmark.maximizedVsBank}pp.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryReturnOnCapitalMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryReturnOnCapitalMaximizer(req);
}

async function handleInventoryReturnOnCapitalMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-return-on-capital-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query HELD trades + SOLD trades (12m) for historical ROC
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
              aiRisk: true,
              dealScore: true,
              aiScore: true,
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

    // Compute HELD trades
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    // Compute SOLD trades (12m) for historical ROC reference (avgHoldDays)
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    // Empty-state: no HELD trades
    if (heldComputed.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          totalUnrealizedProfit: 0,
          currentROC: 0,
          annualizedROC: 0,
          heldInventoryCount: 0,
          avgHoldDays: 0,
          avgEstValue: 0,
        },
        maximization: {
          maximizedROC: 0,
          rocUplift: 0,
          rocMaximizationLevers: [],
          inventoryMixOptimization: {
            increaseCategories: [],
            decreaseCategories: [],
            rationale: '',
          },
          capitalReallocationPlan: [],
          rocProjection: [],
          rocGrade: 'F',
          rocVsBenchmark: {
            bankDeposit: BENCHMARK_BANK,
            stocks: BENCHMARK_STOCKS,
            realEstate: BENCHMARK_REAL_ESTATE,
            yourCurrentROC: 0,
            yourMaximizedROC: 0,
            maximizedVsBank: 0,
            maximizedVsStocks: 0,
            maximizedVsRealEstate: 0,
          },
          optimalPortfolioComposition: '',
        },
        summary: 'Ni HELD trgovin — Inventory Return On Capital Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin — Inventory Return On Capital Maximizer ni mogoč.',
      } satisfies InventoryReturnOnCapitalResponse);
    }

    const current = computeCurrent(heldComputed, soldComputed, now);
    let maximization = buildDeterministicMaximization(current, heldComputed);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month + held item ids hash
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const heldIdsHash = heldComputed
      .map((h) => h.id)
      .sort()
      .join(',')
      .slice(0, 200);
    const cacheKey = `inventory-return-on-capital-maximizer:${currentMonth}:${heldIdsHash}`;
    const cached = getCachedAI<{
      maximization: InventoryReturnOnCapitalMaximization;
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
      } satisfies InventoryReturnOnCapitalResponse);
    }

    // 5) AI prompt with grounding
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

    // Compact trade sample for AI
    const heldSampleForAI = heldComputed
      .slice()
      .sort((a, b) => b.capital - a.capital)
      .slice(0, MAX_TRADES_FOR_AI)
      .map((h) => ({
        cat: h.category,
        cap: h.capital,
        est: h.estValue,
        profit: h.unrealizedProfit,
        holdDays: h.holdDays,
        roc: h.roc,
      }));

    const promptData = {
      heldCount: heldComputed.length,
      sold12mCount: soldComputed.length,
      current,
      deterministicMaximization: {
        maximizedROC: maximization.maximizedROC,
        rocUplift: maximization.rocUplift,
        rocMaximizationLevers: maximization.rocMaximizationLevers,
        inventoryMixOptimization: maximization.inventoryMixOptimization,
        capitalReallocationPlan: maximization.capitalReallocationPlan,
        rocProjection: maximization.rocProjection,
        rocGrade: maximization.rocGrade,
        rocVsBenchmark: maximization.rocVsBenchmark,
        optimalPortfolioComposition: maximization.optimalPortfolioComposition,
      },
      heldSample: heldSampleForAI,
      caps: {
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        rocMin: ROC_MIN, rocMax: ROC_MAX,
        annualizedRocMin: ANNUALIZED_ROC_MIN, annualizedRocMax: ANNUALIZED_ROC_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        projectionRocMin: PROJECTION_ROC_MIN, projectionRocMax: PROJECTION_ROC_MAX,
        projectionProfitMin: PROJECTION_PROFIT_MIN, projectionProfitMax: PROJECTION_PROFIT_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        amountMin: AMOUNT_MIN, amountMax: AMOUNT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Return On Capital Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za RETURN ON CAPITAL (ROC) MAXIMIZATION za HELD inventory — ne samo ROI per item ampak overall ROC celotne inventory portfolio. Tvoj cilj je "Tvoj ROC je 22%, ampak bi lahko bil 38% z boljšim inventory mix in hitrejšim turnover." Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira return OF capital — koliko deployed capital se vrne) — ti MAKSIMIZIRAŠ RETURN ON CAPITAL (ROC = unrealized profit / total capital deployed × 100, ne return rate of capital). Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ta maksimizira ROC z rocMaximizationLevers in capitalReallocationPlan (ne sam % annualized return). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta maksimizira PORTFOLIO ROC z optimalPortfolioComposition in rocVsBenchmark. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ta maksimizira ROC z inventoryMixOptimization (ne sam per-item efficiency). Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) — ta maksimizira ROC (return on capital, ne cash yield). Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ta maksimizira ROC z rocProjection (3/6/12 month). Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item) — ta maksimizira PORTFOLIO ROC z rocGrade in rocVsBenchmark. Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per euro deployed čez SOLD+HELD) — ta maksimizira ROC samo za HELD inventory (return ON capital %, ne €/€ ratio). Razlika od inventory-capital-allocator (v7.97 ki alloca capital per item) — ta maksimizira ROC z capitalReallocationPlan med low-ROC in high-ROC items.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovine z linked Listing + SOLD 12m za historical ROC):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedROC % [-50, 500] (≥ current.currentROC, ≤ current × 1.8 ali +200pp absolute uplift),
2. maximization.rocUplift pp [0, 300] (improvement = maximized − current),
3. maximization.rocMaximizationLevers: 4 elementi { lever: OPTIMIZE_INVENTORY_MIX | FASTER_TURNOVER | BETTER_SOURCING | REDUCE_IDLE_CAPITAL, potentialGain pp [0, 200] (koliko pp ROC uplift — OPTIMIZE_INVENTORY_MIX ~8, FASTER_TURNOVER ~6, BETTER_SOURCING ~5, REDUCE_IDLE_CAPITAL ~3), action (max 200, slovenski — specifična akcija) },
4. maximization.inventoryMixOptimization: { increaseCategories (3-5 kategorij za povečat allocation), decreaseCategories (3-5 za zmanjšat), rationale (max 400, slovenski) },
5. maximization.capitalReallocationPlan: 3-5 elementov { fromCategory, toCategory, amount € [0, 1000000], expectedRocGain pp [0, 200] },
6. maximization.rocProjection: 3 elementi { months 3/6/12, projectedROC % [-50, 500] (linear ramp: 3m=25%, 6m=50%, 12m=100% adoption), projectedProfit € [-1000000, 5000000] (= totalCapital × projectedROC / 100 × months/12) },
7. maximization.rocGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 100% ali uplift ≥ 50pp, A ≥ 50/30, B ≥ 25/15, C ≥ 10/5, D ≥ 0/1, else F),
8. maximization.optimalPortfolioComposition: slovenski (max 500 znakov — ideal category/price-range mix za max ROC: 40% high-ROC quick-flip, 35% premium slow-flip, 20% seasonal/bundle, 5% reserve za bargain hunting),
9. summary: slovenski povzetek (max 400 znakov — poudari current ROC, maximized ROC, uplift, grade, benchmark comparison).

VRNI LE JSON:
{
  "maximization": {
    "maximizedROC": 38,
    "rocUplift": 16,
    "rocMaximizationLevers": [
      { "lever": "OPTIMIZE_INVENTORY_MIX", "potentialGain": 8, "action": "Premakni capital iz low-ROC v high-ROC kategorije." },
      { "lever": "FASTER_TURNOVER", "potentialGain": 6, "action": "Skrajšaj avg hold z 30 na 18 dni." },
      { "lever": "BETTER_SOURCING", "potentialGain": 5, "action": "Sourcing pod 60% market value." },
      { "lever": "REDUCE_IDLE_CAPITAL", "potentialGain": 3, "action": "Prodaj stale items z unrealized profit < 0." }
    ],
    "inventoryMixOptimization": {
      "increaseCategories": ["mobilni", "electronika"],
      "decreaseCategories": ["oblačila", "dom"],
      "rationale": "Top ROC kategorija: mobilni (45% ROC). Premakni 30% capital za +8pp ROC."
    },
    "capitalReallocationPlan": [
      { "fromCategory": "oblačila", "toCategory": "mobilni", "amount": 300, "expectedRocGain": 5 }
    ],
    "rocProjection": [
      { "months": 3, "projectedROC": 26, "projectedProfit": 78 },
      { "months": 6, "projectedROC": 32, "projectedProfit": 192 },
      { "months": 12, "projectedROC": 38, "projectedProfit": 456 }
    ],
    "rocGrade": "B",
    "optimalPortfolioComposition": "40% high-ROC quick-flip, 35% premium slow-flip, 20% seasonal, 5% reserve."
  },
  "summary": "Current: 22.00% ROC (5000€ deployed, 1100€ unrealized, 15 HELD). Maximized: 38.00% (uplift +16.00pp, grade B). Vs stocks: +30pp, vs bank: +36pp."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override maximizedROC — anti-hallucination bounds
        if (aiMax.maximizedROC !== undefined) {
          const minBound = current.currentROC;
          const maxBound = Math.max(
            minBound + 1,
            Math.min(
              ROC_MAX,
              Math.max(current.currentROC * 1.8, current.currentROC + 200),
            ),
          );
          const maximizedROC = round2(clampNum(
            aiMax.maximizedROC,
            minBound, maxBound, maximization.maximizedROC,
          ));
          const rocUplift = round2(clampNum(
            maximizedROC - current.currentROC,
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          maximization = {
            ...maximization,
            maximizedROC,
            rocUplift,
          };
        }

        // Override rocMaximizationLevers — must be 4 distinct levers
        if (Array.isArray(aiMax.rocMaximizationLevers) &&
            aiMax.rocMaximizationLevers.length >= 4) {
          const aiLevers: RocLeverItem[] = [];
          const seen = new Set<RocLever>();
          for (const l of aiMax.rocMaximizationLevers.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            const lever = clampEnum(l.lever, VALID_LEVER, 'OPTIMIZE_INVENTORY_MIX');
            if (seen.has(lever)) continue;
            seen.add(lever);
            aiLevers.push({
              lever,
              potentialGain: round2(clampNum(
                l.potentialGain,
                GAIN_MIN, GAIN_MAX, 5,
              )),
              action: clampString(l.action, 200, 'Izboljšaj ta lever za max ROC.'),
            });
          }
          if (aiLevers.length >= 4) {
            maximization = { ...maximization, rocMaximizationLevers: aiLevers };
          }
        }

        // Override inventoryMixOptimization
        if (aiMax.inventoryMixOptimization) {
          const mix = aiMax.inventoryMixOptimization;
          const increaseCategories = Array.isArray(mix.increaseCategories)
            ? mix.increaseCategories
                .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
                .map((c) => c.trim().slice(0, 60))
                .slice(0, 5)
            : [];
          const decreaseCategories = Array.isArray(mix.decreaseCategories)
            ? mix.decreaseCategories
                .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
                .map((c) => c.trim().slice(0, 60))
                .slice(0, 5)
            : [];
          if (increaseCategories.length >= 1 || decreaseCategories.length >= 1) {
            maximization = {
              ...maximization,
              inventoryMixOptimization: {
                increaseCategories,
                decreaseCategories,
                rationale: clampString(
                  mix.rationale, 400,
                  maximization.inventoryMixOptimization.rationale,
                ),
              },
            };
          }
        }

        // Override capitalReallocationPlan
        if (Array.isArray(aiMax.capitalReallocationPlan) &&
            aiMax.capitalReallocationPlan.length >= 1) {
          const aiReallocs: CapitalReallocationEntry[] = [];
          for (const r of aiMax.capitalReallocationPlan.slice(0, MAX_REALLOCATIONS)) {
            if (!r || typeof r !== 'object') continue;
            const fromCategory = clampString(r.fromCategory, 60, 'drugo');
            const toCategory = clampString(r.toCategory, 60, 'drugo');
            if (fromCategory === toCategory) continue;
            aiReallocs.push({
              fromCategory,
              toCategory,
              amount: round0(clampNum(r.amount, AMOUNT_MIN, AMOUNT_MAX, 100)),
              expectedRocGain: round2(clampNum(r.expectedRocGain, GAIN_MIN, GAIN_MAX, 1)),
            });
          }
          if (aiReallocs.length >= 1) {
            maximization = { ...maximization, capitalReallocationPlan: aiReallocs };
          }
        }

        // Override rocProjection — must be 3 entries with months 3/6/12
        if (Array.isArray(aiMax.rocProjection) &&
            aiMax.rocProjection.length >= 3) {
          const aiProj: RocProjectionEntry[] = [];
          const expectedMonths = [3, 6, 12];
          for (const expected of expectedMonths) {
            const ai = aiMax.rocProjection.find(
              (p) => p && Number(p.months) === expected,
            );
            if (!ai) continue;
            const projectedROC = round2(clampNum(
              ai.projectedROC,
              PROJECTION_ROC_MIN, PROJECTION_ROC_MAX, 0,
            ));
            const projectedProfit = round0(clampNum(
              ai.projectedProfit,
              PROJECTION_PROFIT_MIN, PROJECTION_PROFIT_MAX, 0,
            ));
            aiProj.push({ months: expected, projectedROC, projectedProfit });
          }
          if (aiProj.length === 3) {
            maximization = { ...maximization, rocProjection: aiProj };
          }
        }

        // Override rocVsBenchmark — recompute from maximizedROC
        maximization = {
          ...maximization,
          rocVsBenchmark: {
            bankDeposit: BENCHMARK_BANK,
            stocks: BENCHMARK_STOCKS,
            realEstate: BENCHMARK_REAL_ESTATE,
            yourCurrentROC: round2(clampNum(current.currentROC, ROC_MIN, ROC_MAX, 0)),
            yourMaximizedROC: round2(clampNum(maximization.maximizedROC, ROC_MIN, ROC_MAX, 0)),
            maximizedVsBank: round2(clampNum(
              maximization.maximizedROC - BENCHMARK_BANK, -100, 500, 0,
            )),
            maximizedVsStocks: round2(clampNum(
              maximization.maximizedROC - BENCHMARK_STOCKS, -100, 500, 0,
            )),
            maximizedVsRealEstate: round2(clampNum(
              maximization.maximizedROC - BENCHMARK_REAL_ESTATE, -100, 500, 0,
            )),
          },
        };

        // Override optimalPortfolioComposition
        if (aiMax.optimalPortfolioComposition) {
          maximization = {
            ...maximization,
            optimalPortfolioComposition: clampString(
              aiMax.optimalPortfolioComposition, 500, maximization.optimalPortfolioComposition,
            ),
          };
        }

        // Override rocGrade — recompute or use AI value
        if (aiMax.rocGrade) {
          maximization = {
            ...maximization,
            rocGrade: clampEnum(
              aiMax.rocGrade,
              VALID_GRADE,
              decideRocGrade(maximization.maximizedROC, maximization.rocUplift),
            ),
          };
        } else {
          maximization = {
            ...maximization,
            rocGrade: decideRocGrade(maximization.maximizedROC, maximization.rocUplift),
          };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-return-on-capital-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return NextResponse.json({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryReturnOnCapitalResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-return-on-capital-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
