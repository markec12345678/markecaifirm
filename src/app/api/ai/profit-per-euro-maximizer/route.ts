// v8.07: AI Profit Per Euro Maximizer — AI MAKSIMIZIRA PROFIT PER EURO DEPLOYED —
// ultimate capital efficiency metric. "Vsak evro deployed generira 0.35€ profita,
// ampak bi lahko generiral 0.62€ z optimalno strategijo." Razlika od
// inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return
// na held inventory) — ta MAKSIMIZIRA PROFIT PER EURO DEPLOYED (€ profit / €
// capital deployed, ne % annualized). Razlika od revenue-per-trade-maximizer (v8.06
// ki maksimizira top-line sell price per trade) — ta maksimizira PROFIT PER EURO
// (capital efficiency, ne per-trade revenue). Razlika od deal-source-cash-flow-maximizer
// (v8.06 ki maksimizira cash flow per source) — ta maksimizira PROFIT PER EURO
// DEPLOYED čez celoten portfolio (ne per-source cash flow). Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency
// per item z reallocation) — ta maksimizira PORTFOLIO PROFIT PER EURO z
// maximizationLevers in capitalEfficiencyComparison. Razlika od profit-per-trade-maximizer
// (v8.03 ki maksimizira profit per trade €) — ta maksimizira PROFIT PER EURO
// (capital efficiency, ne absolute profit per trade). Razlika od
// profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) —
// ta maksimizira PROFIT PER EURO z maximizationLevers in profitPerEuroGrade.
// Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate
// acceleration) — ta maksimizira PROFIT PER EURO (€ profit / € capital deployed),
// ne growth rate. Razlika od profit-margin-maximizer (v7.85 ki maksimizira margin %)
// — ta maksimizira PROFIT PER EURO DEPLOYED (€ profit / € capital, absolute capital
// efficiency metric, ne margin %). Razlika od inventory-roi-maximizer-pro (v7.99
// ki maksimizira ROI per item) — ta maksimizira PORTFOLIO PROFIT PER EURO z
// capitalEfficiencyComparison (bank deposit ~2%, stocks ~8%, real estate ~5%).

// GET+POST /api/ai/profit-per-euro-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.9) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ProfitPerEuroGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

type MaximizationLever =
  | 'BETTER_SOURCING'
  | 'FASTER_TURNOVER'
  | 'HIGHER_SELL_PRICE'
  | 'LOWER_FEES'
  | 'REDUCE_CARRYING_COSTS';

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

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
  } | null;
}

interface CurrentState {
  totalCapitalDeployed: number; // € = sum(buyPrice + buyFees) over SOLD + HELD
  totalProfit: number; // € = sum(profit) over SOLD (held excluded — realized only)
  profitPerEuro: number; // ratio = totalProfit / totalCapitalDeployed
  realizedProfit: number; // € from SOLD trades only
  heldCapitalDeployed: number; // € capital in HELD trades
  soldCapitalDeployed: number; // € capital deployed to SOLD trades
  soldCount12m: number;
  heldCount: number;
  avgHoldDays: number; // days (avg over SOLD)
}

interface MaximizationLeverItem {
  lever: MaximizationLever;
  currentGap: number; // % gap (how much room to improve this lever)
  potentialGain: number; // ratio uplift (e.g. +0.10 means +0.10€ profit per euro)
  action: string;
}

interface CapitalEfficiencyComparison {
  bankDeposit: number; // % ~2% (bank deposit)
  stocks: number; // % ~8% (S&P 500)
  realEstate: number; // % ~5% (real estate)
  yourProfitPerEuro: number; // % (currentProfitPerEuro × 100)
  yourProfitPerEuroVsBank: number; // pp = your − bankDeposit
  yourProfitPerEuroVsStocks: number; // pp = your − stocks
  yourProfitPerEuroVsRealEstate: number; // pp = your − realEstate
}

interface ProfitPerEuroProjection {
  months: number; // 3, 6, 12
  projectedProfitPerEuro: number; // ratio at horizon (assuming actions implemented)
  projectedProfit: number; // € absolute profit at horizon (capital × projectedProfitPerEuro × months/12)
}

interface ProfitPerEuroMaximization {
  currentProfitPerEuro: number; // ratio (current)
  maximizedProfitPerEuro: number; // ratio (optimal achievable)
  profitPerEuroUplift: number; // ratio improvement = maximized − current
  maximizationLevers: MaximizationLeverItem[];
  capitalEfficiencyComparison: CapitalEfficiencyComparison;
  profitPerEuroProjection: ProfitPerEuroProjection[]; // 3/6/12 month
  profitPerEuroGrade: ProfitPerEuroGrade;
  optimalCapitalDeployment: string; // slovenski — how to deploy capital for max profit per euro
}

interface ProfitPerEuroResponse {
  ok: true;
  current: CurrentState;
  maximization: ProfitPerEuroMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedProfitPerEuro?: number;
    profitPerEuroUplift?: number;
    maximizationLevers?: Array<{
      lever?: MaximizationLever;
      currentGap?: number;
      potentialGain?: number;
      action?: string;
    }>;
    capitalEfficiencyComparison?: Partial<CapitalEfficiencyComparison>;
    profitPerEuroProjection?: Array<{
      months?: number;
      projectedProfitPerEuro?: number;
      projectedProfit?: number;
    }>;
    profitPerEuroGrade?: ProfitPerEuroGrade;
    optimalCapitalDeployment?: string;
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
const PROFIT_PER_EURO_MIN = 0;
const PROFIT_PER_EURO_MAX = 5; // 5× = 500% profit per euro deployed (rare but possible)
const GAP_MIN = 0;
const GAP_MAX = 100;
const GAIN_MIN = 0;
const GAIN_MAX = 5; // +5€ profit per euro uplift (cap)
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 5;
const HOLD_MIN = 1;
const HOLD_MAX = 365;
const PROJECTION_MIN = 0;
const PROJECTION_MAX = 5;
const PROJECTION_PROFIT_MIN = -1_000_000;
const PROJECTION_PROFIT_MAX = 5_000_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

const BENCHMARK_BANK = 0.02; // 2% bank deposit
const BENCHMARK_STOCKS = 0.08; // 8% stocks
const BENCHMARK_REAL_ESTATE = 0.05; // 5% real estate

const VALID_GRADE: readonly ProfitPerEuroGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_LEVER: readonly MaximizationLever[] = [
  'BETTER_SOURCING',
  'FASTER_TURNOVER',
  'HIGHER_SELL_PRICE',
  'LOWER_FEES',
  'REDUCE_CARRYING_COSTS',
];

const MAX_LEVERS = 5;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;
const MAX_ITEMS_PER_AI = 50;

const LEVER_GAIN: Record<MaximizationLever, number> = {
  BETTER_SOURCING: 0.22, // +0.22€ profit per euro via cheaper sourcing
  FASTER_TURNOVER: 0.18, // +0.18€ via faster cycle (more turns per year)
  HIGHER_SELL_PRICE: 0.15, // +0.15€ via higher sell price
  LOWER_FEES: 0.08, // +0.08€ via fee reduction
  REDUCE_CARRYING_COSTS: 0.06, // +0.06€ via shorter holding
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
  id: string;
  title: string;
  category: string;
  capital: number;
  estValue: number;
  unrealizedProfit: number;
  holdDays: number;
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
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0
    ? Math.max(1, Math.round((now - buyMs) / DAY_MS))
    : 1;
  const category = clampString(t.category ?? '', 60, 'drugo');
  return {
    id: t.id,
    title: clampString(t.title, 100, 'Brez naslova'),
    category,
    capital,
    estValue,
    unrealizedProfit,
    holdDays,
  };
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
  const totalCapitalDeployed = round0(clampNum(
    soldCapital + heldCapital,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  const realizedProfit = round0(clampNum(
    sold.reduce((s, t) => s + t.profit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  // Profit per euro = realized profit / total capital deployed
  const profitPerEuro = round2(clampNum(
    totalCapitalDeployed > 0
      ? realizedProfit / totalCapitalDeployed
      : 0,
    PROFIT_PER_EURO_MIN, PROFIT_PER_EURO_MAX, 0,
  ));

  const avgHoldDays = round0(clampNum(
    soldCount > 0
      ? sold.reduce((s, t) => s + t.holdDays, 0) / soldCount
      : 0,
    soldCount > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
  ));

  return {
    totalCapitalDeployed,
    totalProfit: realizedProfit,
    profitPerEuro,
    realizedProfit,
    heldCapitalDeployed: heldCapital,
    soldCapitalDeployed: soldCapital,
    soldCount12m: soldCount,
    heldCount,
    avgHoldDays,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildMaximizationLevers(
  current: CurrentState,
): MaximizationLeverItem[] {
  const levers: MaximizationLeverItem[] = [];

  // 1) BETTER_SOURCING — buy cheaper
  // Current gap: based on avg ROI. If ROI is 0.30 (30%), gap = 60% room to grow.
  const avgRoi = current.soldCapitalDeployed > 0
    ? current.realizedProfit / current.soldCapitalDeployed
    : 0;
  const betterSourcingGap = round2(clampNum(
    Math.max(10, Math.min(90, 100 - avgRoi * 100)),
    GAP_MIN, GAP_MAX, 50,
  ));
  levers.push({
    lever: 'BETTER_SOURCING',
    currentGap: betterSourcingGap,
    potentialGain: round2(clampNum(
      LEVER_GAIN.BETTER_SOURCING * (betterSourcingGap / 100),
      GAIN_MIN, GAIN_MAX, 0.10,
    )),
    action: `Sourcing pod 60% market value z AI deal score filterjem in monitor alert-i za below-market listings. Vsakih -10% na buy price = +0.10€ profit per euro. Cilj: ${Math.round(betterSourcingGap)}% room za izboljšati sourcing.`,
  });

  // 2) FASTER_TURNOVER — more cycles per year
  // Gap = based on how far avgHoldDays is from optimal (7-14 days)
  const optimalHold = 14;
  const fasterTurnoverGap = round2(clampNum(
    current.avgHoldDays > optimalHold
      ? Math.min(80, ((current.avgHoldDays - optimalHold) / Math.max(1, current.avgHoldDays)) * 100)
      : Math.max(5, 20),
    GAP_MIN, GAP_MAX, 30,
  ));
  levers.push({
    lever: 'FASTER_TURNOVER',
    currentGap: fasterTurnoverGap,
    potentialGain: round2(clampNum(
      LEVER_GAIN.FASTER_TURNOVER * (fasterTurnoverGap / 100),
      GAIN_MIN, GAIN_MAX, 0.08,
    )),
    action: `Skrajšaj avg hold z ${current.avgHoldDays} na ${optimalHold} dni z avtomatiziranim listing refresh, aggressive pricing in cross-platform exposure. Vsak dan krajši = +1× annualized cycle = +več profit per euro.`,
  });

  // 3) HIGHER_SELL_PRICE — premium pricing
  // Gap = if avgRoi is below 0.5 (50%), room to push prices
  const higherSellGap = round2(clampNum(
    avgRoi < 0.5
      ? Math.min(70, (0.5 - avgRoi) * 200)
      : 15,
    GAP_MIN, GAP_MAX, 30,
  ));
  levers.push({
    lever: 'HIGHER_SELL_PRICE',
    currentGap: higherSellGap,
    potentialGain: round2(clampNum(
      LEVER_GAIN.HIGHER_SELL_PRICE * (higherSellGap / 100),
      GAIN_MIN, GAIN_MAX, 0.07,
    )),
    action: 'Dvigni sell price za 12-18% z AI pricing engine, premium fotografijo, garancijo in premium pozicioniranjem. Cross-platform premium listings na Bolha+Vinted+mobile.de z različnimi cenami.',
  });

  // 4) LOWER_FEES — bundle & negotiate fees
  // Gap based on held capital (more capital = more fee optimization opportunity)
  const lowerFeesGap = round2(clampNum(
    current.totalCapitalDeployed > 5000 ? 50 : 30,
    GAP_MIN, GAP_MAX, 30,
  ));
  levers.push({
    lever: 'LOWER_FEES',
    currentGap: lowerFeesGap,
    potentialGain: round2(clampNum(
      LEVER_GAIN.LOWER_FEES * (lowerFeesGap / 100),
      GAIN_MIN, GAIN_MAX, 0.04,
    )),
    action: 'Bundle multiple items v enem shipping-u, izberi Bolha free insertion windows, premakni low-margin items na platforme z nižjimi fees (Subito/Kleinanzeigen). -3% fees = +0.06€ profit per euro.',
  });

  // 5) REDUCE_CARRYING_COSTS — shorter holding on stale items
  // Gap based on heldCount — more held items = more carrying cost reduction possible
  const reduceCarryingGap = round2(clampNum(
    current.heldCount > 0 ? Math.min(60, current.heldCount * 5) : 10,
    GAP_MIN, GAP_MAX, 20,
  ));
  levers.push({
    lever: 'REDUCE_CARRYING_COSTS',
    currentGap: reduceCarryingGap,
    potentialGain: round2(clampNum(
      LEVER_GAIN.REDUCE_CARRYING_COSTS * (reduceCarryingGap / 100),
      GAIN_MIN, GAIN_MAX, 0.03,
    )),
    action: 'Premakni dolgo-held items na platforme z nižjimi carrying costs ali prodaj na debelo. Bundle stagnirajoče items v discounted bundle. Vsak dan manj hold = -0.5% carrying cost.',
  });

  return levers.slice(0, MAX_LEVERS);
}

function computeMaximizedProfitPerEuro(
  current: CurrentState,
  levers: MaximizationLeverItem[],
): { maximizedProfitPerEuro: number; profitPerEuroUplift: number } {
  // Combined uplift from top-3 levers (diminishing returns × 0.7)
  const sorted = [...levers].sort((a, b) => b.potentialGain - a.potentialGain);
  const top3 = sorted.slice(0, 3);
  const combinedGain = top3.reduce((s, l) => s + l.potentialGain, 0) * 0.7;
  const uplift = round2(clampNum(
    combinedGain, UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const maximized = round2(clampNum(
    current.profitPerEuro + uplift,
    PROFIT_PER_EURO_MIN, PROFIT_PER_EURO_MAX, current.profitPerEuro,
  ));
  return { maximizedProfitPerEuro: maximized, profitPerEuroUplift: uplift };
}

function buildCapitalEfficiencyComparison(
  current: CurrentState,
): CapitalEfficiencyComparison {
  const yourPct = current.profitPerEuro * 100;
  return {
    bankDeposit: BENCHMARK_BANK * 100,
    stocks: BENCHMARK_STOCKS * 100,
    realEstate: BENCHMARK_REAL_ESTATE * 100,
    yourProfitPerEuro: round2(clampNum(yourPct, 0, 500, 0)),
    yourProfitPerEuroVsBank: round2(clampNum(
      yourPct - BENCHMARK_BANK * 100, -100, 500, 0,
    )),
    yourProfitPerEuroVsStocks: round2(clampNum(
      yourPct - BENCHMARK_STOCKS * 100, -100, 500, 0,
    )),
    yourProfitPerEuroVsRealEstate: round2(clampNum(
      yourPct - BENCHMARK_REAL_ESTATE * 100, -100, 500, 0,
    )),
  };
}

function buildProfitPerEuroProjection(
  current: CurrentState,
  maximizedProfitPerEuro: number,
): ProfitPerEuroProjection[] {
  const projections: ProfitPerEuroProjection[] = [];
  for (const months of [3, 6, 12]) {
    // Linear ramp: 3m=25%, 6m=50%, 12m=100% adoption
    const adoptionFraction = months / 12;
    const projectedProfitPerEuro = round2(clampNum(
      current.profitPerEuro + (maximizedProfitPerEuro - current.profitPerEuro) * adoptionFraction,
      PROJECTION_MIN, PROJECTION_MAX, 0,
    ));
    // Projected profit = totalCapital × projectedProfitPerEuro × (months/12)
    const projectedProfit = round0(clampNum(
      current.totalCapitalDeployed * projectedProfitPerEuro * (months / 12),
      PROJECTION_PROFIT_MIN, PROJECTION_PROFIT_MAX, 0,
    ));
    projections.push({ months, projectedProfitPerEuro, projectedProfit });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function decideProfitPerEuroGrade(
  maximizedProfitPerEuro: number,
  uplift: number,
): ProfitPerEuroGrade {
  // A+ if maximized ≥ 1.0 (100% return per euro) or uplift ≥ 0.50
  // A if maximized ≥ 0.7 or uplift ≥ 0.30
  // B if maximized ≥ 0.4 or uplift ≥ 0.20
  // C if maximized ≥ 0.2 or uplift ≥ 0.10
  // D if maximized ≥ 0.1 or uplift ≥ 0.05
  // else F
  if (maximizedProfitPerEuro >= 1.0 || uplift >= 0.50) return 'A+';
  if (maximizedProfitPerEuro >= 0.7 || uplift >= 0.30) return 'A';
  if (maximizedProfitPerEuro >= 0.4 || uplift >= 0.20) return 'B';
  if (maximizedProfitPerEuro >= 0.2 || uplift >= 0.10) return 'C';
  if (maximizedProfitPerEuro >= 0.1 || uplift >= 0.05) return 'D';
  return 'F';
}

function buildOptimalCapitalDeployment(
  current: CurrentState,
  levers: MaximizationLeverItem[],
): string {
  const bestLever = [...levers].sort((a, b) => b.potentialGain - a.potentialGain)[0];
  const advice = `Optimal capital deployment: trenutno ${current.totalCapitalDeployed}€ deployed ` +
    `(${current.soldCount12m} SOLD, ${current.heldCount} HELD). ` +
    `Cilj: ${Math.round(current.totalCapitalDeployed * 0.6)}€ v high-velocity sourcing ` +
    `(Bolha + Vinted premium listings z ${bestLever?.lever ?? 'BETTER_SOURCING'}), ` +
    `${Math.round(current.totalCapitalDeployed * 0.3)}€ v premium-priced slow-flip items ` +
    `(mobile.de/Avtonet z 12-18% višjim ask price), ` +
    `${Math.round(current.totalCapitalDeployed * 0.1)}€ reserve za bargain hunting ` +
    `(below 60% market value). Vsak evro deployed bi moral generirati ≥0.40€ profita ` +
    `(cilj profit per euro = 0.40+, benchmark stocks 8%, bank 2%).`;
  return advice.slice(0, 500);
}

function buildSummary(
  current: CurrentState,
  max: ProfitPerEuroMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.profitPerEuro.toFixed(2)}€ profit per euro deployed (${current.totalCapitalDeployed}€ deployed, ${current.realizedProfit}€ profit).`,
    `Maximized: ${max.maximizedProfitPerEuro.toFixed(2)}€/€ (uplift +${max.profitPerEuroUplift.toFixed(2)}, grade ${max.profitPerEuroGrade}).`,
    `Vs bank deposit: ${max.capitalEfficiencyComparison.yourProfitPerEuroVsBank}pp, vs stocks: ${max.capitalEfficiencyComparison.yourProfitPerEuroVsStocks}pp.`,
  ];
  return parts.join(' ').slice(0, 400);
}

function buildDeterministicMaximization(
  current: CurrentState,
): ProfitPerEuroMaximization {
  const maximizationLevers = buildMaximizationLevers(current);
  const { maximizedProfitPerEuro, profitPerEuroUplift } = computeMaximizedProfitPerEuro(
    current,
    maximizationLevers,
  );
  const capitalEfficiencyComparison = buildCapitalEfficiencyComparison(current);
  const profitPerEuroProjection = buildProfitPerEuroProjection(current, maximizedProfitPerEuro);
  const profitPerEuroGrade = decideProfitPerEuroGrade(maximizedProfitPerEuro, profitPerEuroUplift);
  const optimalCapitalDeployment = buildOptimalCapitalDeployment(current, maximizationLevers);

  return {
    currentProfitPerEuro: current.profitPerEuro,
    maximizedProfitPerEuro,
    profitPerEuroUplift,
    maximizationLevers,
    capitalEfficiencyComparison,
    profitPerEuroProjection,
    profitPerEuroGrade,
    optimalCapitalDeployment,
  };
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitPerEuroMaximizerInput {}

// --- Handler -------------------------------------------------------------

const profitPerEuroMaximizerHandler = withAiRoute<ProfitPerEuroMaximizerInput>({
  endpoint: '/api/ai/profit-per-euro-maximizer',
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
          title: true,
          category: true,
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
          title: true,
          category: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
            },
          },
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD and no HELD trades
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          totalProfit: 0,
          profitPerEuro: 0,
          realizedProfit: 0,
          heldCapitalDeployed: 0,
          soldCapitalDeployed: 0,
          soldCount12m: 0,
          heldCount: 0,
          avgHoldDays: 0,
        },
        maximization: {
          currentProfitPerEuro: 0,
          maximizedProfitPerEuro: 0,
          profitPerEuroUplift: 0,
          maximizationLevers: [],
          capitalEfficiencyComparison: {
            bankDeposit: BENCHMARK_BANK * 100,
            stocks: BENCHMARK_STOCKS * 100,
            realEstate: BENCHMARK_REAL_ESTATE * 100,
            yourProfitPerEuro: 0,
            yourProfitPerEuroVsBank: 0,
            yourProfitPerEuroVsStocks: 0,
            yourProfitPerEuroVsRealEstate: 0,
          },
          profitPerEuroProjection: [],
          profitPerEuroGrade: 'F',
          optimalCapitalDeployment: '',
        },
        summary: 'Ni SOLD in HELD trgovin — Profit Per Euro Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Profit Per Euro Maximizer ni mogoč.',
      } satisfies ProfitPerEuroResponse);
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
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    // If no SOLD trades, can't compute realized profit
    if (soldComputed.length === 0) {
      const heldCap = heldComputed.reduce((s, h) => s + h.capital, 0);
      return apiOk({
        ok: true,
        current: {
          totalCapitalDeployed: heldCap,
          totalProfit: 0,
          profitPerEuro: 0,
          realizedProfit: 0,
          heldCapitalDeployed: heldCap,
          soldCapitalDeployed: 0,
          soldCount12m: 0,
          heldCount: heldComputed.length,
          avgHoldDays: 0,
        },
        maximization: {
          currentProfitPerEuro: 0,
          maximizedProfitPerEuro: 0,
          profitPerEuroUplift: 0,
          maximizationLevers: [],
          capitalEfficiencyComparison: {
            bankDeposit: BENCHMARK_BANK * 100,
            stocks: BENCHMARK_STOCKS * 100,
            realEstate: BENCHMARK_REAL_ESTATE * 100,
            yourProfitPerEuro: 0,
            yourProfitPerEuroVsBank: 0,
            yourProfitPerEuroVsStocks: 0,
            yourProfitPerEuroVsRealEstate: 0,
          },
          profitPerEuroProjection: [],
          profitPerEuroGrade: 'F',
          optimalCapitalDeployment: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Euro Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Euro Maximizer ni mogoč.',
      } satisfies ProfitPerEuroResponse);
    }

    const current = computeCurrent(soldComputed, heldComputed);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-per-euro-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ProfitPerEuroMaximization;
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
      } satisfies ProfitPerEuroResponse);
    }

    // 5) AI prompt with grounding
    // Compact trade sample for AI
    const soldSampleForAI = soldComputed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        cap: t.capital,
        profit: t.profit,
        holdDays: t.holdDays,
      }));

    const heldSampleForAI = heldComputed
      .slice()
      .sort((a, b) => b.capital - a.capital)
      .slice(0, MAX_ITEMS_PER_AI)
      .map((h) => ({
        cat: h.category,
        cap: h.capital,
        est: h.estValue,
        profit: h.unrealizedProfit,
        holdDays: h.holdDays,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      heldCount: heldComputed.length,
      current,
      deterministicMaximization: {
        currentProfitPerEuro: maximization.currentProfitPerEuro,
        maximizedProfitPerEuro: maximization.maximizedProfitPerEuro,
        profitPerEuroUplift: maximization.profitPerEuroUplift,
        maximizationLevers: maximization.maximizationLevers,
        capitalEfficiencyComparison: maximization.capitalEfficiencyComparison,
        profitPerEuroProjection: maximization.profitPerEuroProjection,
        profitPerEuroGrade: maximization.profitPerEuroGrade,
        optimalCapitalDeployment: maximization.optimalCapitalDeployment,
      },
      soldSample: soldSampleForAI,
      heldSample: heldSampleForAI,
      caps: {
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        profitPerEuroMin: PROFIT_PER_EURO_MIN, profitPerEuroMax: PROFIT_PER_EURO_MAX,
        gapMin: GAP_MIN, gapMax: GAP_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        projectionMin: PROJECTION_MIN, projectionMax: PROJECTION_MAX,
        projectionProfitMin: PROJECTION_PROFIT_MIN, projectionProfitMax: PROJECTION_PROFIT_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      },
    };

    const prompt = `Si AI "Profit Per Euro Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER EURO DEPLOYED MAXIMIZATION — ultimate capital efficiency metric. Koliko profita generira vsak evro deployed kapitala? Tvoj cilj je "vsak evro deployed generira 0.35€ profita, ampak bi lahko generiral 0.62€ z optimalno strategijo." Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ti MAKSIMIZIRAŠ PROFIT PER EURO DEPLOYED (€ profit / € capital deployed, ne % annualized). Razlika od revenue-per-trade-maximizer (v8.06 ki maksimizira top-line sell price per trade) — ta maksimizira PROFIT PER EURO (capital efficiency, ne per-trade revenue). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira cash flow per source) — ta maksimizira PROFIT PER EURO DEPLOYED čez celoten portfolio (ne per-source cash flow). Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ta maksimizira PORTFOLIO PROFIT PER EURO z maximizationLevers in capitalEfficiencyComparison. Razlika od profit-per-trade-maximizer (v8.03 ki maksimizira profit per trade €) — ta maksimizira PROFIT PER EURO (capital efficiency, ne absolute profit per trade). Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira PROFIT PER EURO z maximizationLevers in profitPerEuroGrade. Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) — ta maksimizira PROFIT PER EURO (€ profit / € capital deployed), ne growth rate. Razlika od profit-margin-maximizer (v7.85 ki maksimizira margin %) — ta maksimizira PROFIT PER EURO DEPLOYED (€ profit / € capital, absolute capital efficiency metric, ne margin %). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta maksimizira PORTFOLIO PROFIT PER EURO z capitalEfficiencyComparison (bank deposit ~2%, stocks ~8%, real estate ~5%).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD trgovine):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedProfitPerEuro ratio [0, 5] (≥ current.profitPerEuro, ≤ current × 1.8 ali +2.0 absolute uplift),
2. maximization.profitPerEuroUplift ratio [0, 5] (improvement = maximized − current),
3. maximization.maximizationLevers: 5 elementov { lever: BETTER_SOURCING | FASTER_TURNOVER | HIGHER_SELL_PRICE | LOWER_FEES | REDUCE_CARRYING_COSTS, currentGap % [0, 100] (koliko % room je za izboljšati ta lever), potentialGain ratio [0, 5] (koliko € profit per euro uplift — BETTER_SOURCING ~0.22, FASTER_TURNOVER ~0.18, HIGHER_SELL_PRICE ~0.15, LOWER_FEES ~0.08, REDUCE_CARRYING_COSTS ~0.06), action (max 200, slovenski — specifična akcija) },
4. maximization.capitalEfficiencyComparison: { bankDeposit % = 2, stocks % = 8, realEstate % = 5, yourProfitPerEuro % (current × 100), yourProfitPerEuroVsBank pp, yourProfitPerEuroVsStocks pp, yourProfitPerEuroVsRealEstate pp },
5. maximization.profitPerEuroProjection: 3 elementi { months 3/6/12, projectedProfitPerEuro ratio [0, 5] (linear ramp: 3m=25%, 6m=50%, 12m=100% adoption), projectedProfit € [-1000000, 5000000] (= totalCapital × projectedProfitPerEuro × months/12) },
6. maximization.profitPerEuroGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 1.0 ali uplift ≥ 0.50, A ≥ 0.7/0.30, B ≥ 0.4/0.20, C ≥ 0.2/0.10, D ≥ 0.1/0.05, else F),
7. maximization.optimalCapitalDeployment: slovenski (max 500 znakov — kako deploy-at capital za max profit per euro — 60% high-velocity sourcing, 30% premium slow-flip, 10% reserve za bargain hunting),
8. summary: slovenski povzetek (max 400 znakov — poudari profit per euro + benchmark comparison).

VRNI LE JSON:
{
  "maximization": {
    "maximizedProfitPerEuro": 0.62,
    "profitPerEuroUplift": 0.27,
    "maximizationLevers": [
      { "lever": "BETTER_SOURCING", "currentGap": 60, "potentialGain": 0.22, "action": "Sourcing pod 60% market value z AI deal score filterjem." },
      { "lever": "FASTER_TURNOVER", "currentGap": 50, "potentialGain": 0.18, "action": "Skrajšaj hold z 30 na 14 dni z auto-refresh." }
    ],
    "capitalEfficiencyComparison": {
      "bankDeposit": 2, "stocks": 8, "realEstate": 5,
      "yourProfitPerEuro": 35,
      "yourProfitPerEuroVsBank": 33,
      "yourProfitPerEuroVsStocks": 27,
      "yourProfitPerEuroVsRealEstate": 30
    },
    "profitPerEuroProjection": [
      { "months": 3, "projectedProfitPerEuro": 0.42, "projectedProfit": 630 },
      { "months": 6, "projectedProfitPerEuro": 0.49, "projectedProfit": 1470 },
      { "months": 12, "projectedProfitPerEuro": 0.62, "projectedProfit": 3720 }
    ],
    "profitPerEuroGrade": "B",
    "optimalCapitalDeployment": "Optimal capital deployment: 60% v high-velocity sourcing, 30% v premium slow-flip, 10% reserve."
  },
  "summary": "Current: 0.35€ profit per euro deployed (5000€ deployed, 1750€ profit). Maximized: 0.62€/€ (uplift +0.27, grade B). Vs bank deposit: +33pp, vs stocks: +27pp."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override maximizedProfitPerEuro — anti-hallucination bounds
        if (aiMax.maximizedProfitPerEuro !== undefined) {
          const minBound = current.profitPerEuro;
          const maxBound = Math.max(
            minBound + 0.01,
            Math.min(
              PROFIT_PER_EURO_MAX,
              Math.max(current.profitPerEuro * 1.8, current.profitPerEuro + 2.0),
            ),
          );
          const maximizedProfitPerEuro = round2(clampNum(
            aiMax.maximizedProfitPerEuro,
            minBound, maxBound, maximization.maximizedProfitPerEuro,
          ));
          const profitPerEuroUplift = round2(clampNum(
            maximizedProfitPerEuro - current.profitPerEuro,
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          maximization = {
            ...maximization,
            maximizedProfitPerEuro,
            profitPerEuroUplift,
          };
        }

        // Override maximizationLevers — must be all 5 distinct levers
        if (Array.isArray(aiMax.maximizationLevers) &&
            aiMax.maximizationLevers.length >= 5) {
          const aiLevers: MaximizationLeverItem[] = [];
          const seen = new Set<MaximizationLever>();
          for (const l of aiMax.maximizationLevers.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            const lever = clampEnum(l.lever, VALID_LEVER, 'BETTER_SOURCING');
            if (seen.has(lever)) continue; // dedupe
            seen.add(lever);
            aiLevers.push({
              lever,
              currentGap: round2(clampNum(
                l.currentGap,
                GAP_MIN, GAP_MAX, 30,
              )),
              potentialGain: round2(clampNum(
                l.potentialGain,
                GAIN_MIN, GAIN_MAX, 0.10,
              )),
              action: clampString(l.action, 200, 'Izboljšaj ta lever za max profit per euro.'),
            });
          }
          if (aiLevers.length >= 5) {
            maximization = { ...maximization, maximizationLevers: aiLevers };
          }
        }

        // Override capitalEfficiencyComparison
        if (aiMax.capitalEfficiencyComparison) {
          const cmp = aiMax.capitalEfficiencyComparison;
          const yourPct = round2(clampNum(
            cmp.yourProfitPerEuro ?? current.profitPerEuro * 100,
            0, 500, current.profitPerEuro * 100,
          ));
          maximization = {
            ...maximization,
            capitalEfficiencyComparison: {
              bankDeposit: BENCHMARK_BANK * 100,
              stocks: BENCHMARK_STOCKS * 100,
              realEstate: BENCHMARK_REAL_ESTATE * 100,
              yourProfitPerEuro: yourPct,
              yourProfitPerEuroVsBank: round2(clampNum(
                cmp.yourProfitPerEuroVsBank ?? yourPct - BENCHMARK_BANK * 100,
                -100, 500, yourPct - BENCHMARK_BANK * 100,
              )),
              yourProfitPerEuroVsStocks: round2(clampNum(
                cmp.yourProfitPerEuroVsStocks ?? yourPct - BENCHMARK_STOCKS * 100,
                -100, 500, yourPct - BENCHMARK_STOCKS * 100,
              )),
              yourProfitPerEuroVsRealEstate: round2(clampNum(
                cmp.yourProfitPerEuroVsRealEstate ?? yourPct - BENCHMARK_REAL_ESTATE * 100,
                -100, 500, yourPct - BENCHMARK_REAL_ESTATE * 100,
              )),
            },
          };
        }

        // Override profitPerEuroProjection — must be 3 entries with months 3/6/12
        if (Array.isArray(aiMax.profitPerEuroProjection) &&
            aiMax.profitPerEuroProjection.length >= 3) {
          const aiProj: ProfitPerEuroProjection[] = [];
          const expectedMonths = [3, 6, 12];
          for (const expected of expectedMonths) {
            const ai = aiMax.profitPerEuroProjection.find(
              (p) => p && Number(p.months) === expected,
            );
            if (!ai) continue;
            const projectedProfitPerEuro = round2(clampNum(
              ai.projectedProfitPerEuro,
              PROJECTION_MIN, PROJECTION_MAX, 0,
            ));
            const projectedProfit = round0(clampNum(
              ai.projectedProfit,
              PROJECTION_PROFIT_MIN, PROJECTION_PROFIT_MAX, 0,
            ));
            aiProj.push({ months: expected, projectedProfitPerEuro, projectedProfit });
          }
          if (aiProj.length === 3) {
            maximization = { ...maximization, profitPerEuroProjection: aiProj };
          }
        }

        // Override optimalCapitalDeployment
        if (aiMax.optimalCapitalDeployment) {
          maximization = {
            ...maximization,
            optimalCapitalDeployment: clampString(
              aiMax.optimalCapitalDeployment, 500, maximization.optimalCapitalDeployment,
            ),
          };
        }

        // Override profitPerEuroGrade — recompute or use AI value
        if (aiMax.profitPerEuroGrade) {
          const grade = clampEnum(
            aiMax.profitPerEuroGrade,
            VALID_GRADE,
            decideProfitPerEuroGrade(
              maximization.maximizedProfitPerEuro,
              maximization.profitPerEuroUplift,
            ),
          );
          maximization = { ...maximization, profitPerEuroGrade: grade };
        } else {
          maximization = {
            ...maximization,
            profitPerEuroGrade: decideProfitPerEuroGrade(
              maximization.maximizedProfitPerEuro,
              maximization.profitPerEuroUplift,
            ),
          };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-per-euro-maximizer',
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
    } satisfies ProfitPerEuroResponse);
  },
});

export const GET = profitPerEuroMaximizerHandler;
export const POST = profitPerEuroMaximizerHandler;
