// v8.11 / v8.96.6-batch4: AI Inventory Annual Yield Maximizer — AI MAKSIMIZIRA ANNUAL YIELD
// held inventory-ja — letni profit kot % povprečne vrednosti inventory-ja.
// "Tvoj letni yield je 32%, ampak bi lahko bil 58% z optimalno inventory
// sestavo in turnover." Razlika od inventory-annualized-return-maximizer
// (v8.06 ki maksimizira annualized return per item — unrealized profit × 365/
// holdDays) — ta MAKSIMIZIRA ANNUAL YIELD čez celoten inventory (realized
// annual profit / held inventory value × 100, ne per-item unrealized return).
// Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira
// velocity kapitala skozi inventory — koliko cycle-ov/leto) — ta MAKSIMIZIRA
// ANNUAL YIELD (letni profit / inventory value × 100, ne cycle count). Razlika
// od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item z
// yieldGrade) — ta MAKSIMIZIRA PORTFOLIO ANNUAL YIELD z yieldVsBenchmark
// (dividend stocks 3%, bonds 2%, REITs 4%) in optimalInventorySize. Razlika
// od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash
// yield čez portfolio z yieldComparisonTable) — ta MAKSIMIZIRA ANNUAL YIELD z
// yieldMaximizationLevers (REDUCE_INVENTORY_VALUE/INCREASE_PROFIT/FASTER_
// TURNOVER/OPTIMIZE_MIX) in inventoryYieldOptimization. Razlika od
// inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve
// in optimalTurnoverRate) — ta MAKSIMIZIRA ANNUAL YIELD z yieldProjection
// (3/6/12 month) in yieldGrade. Razlika od inventory-capital-efficiency-
// maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation)
// — ta MAKSIMIZIRA ANNUAL YIELD čez celoten inventory z yieldVsBenchmark.
// Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item)
// — ta MAKSIMIZIRA ANNUAL YIELD (letni profit / inventory value, ne per-item
// ROI). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira
// daily profit per item) — ta MAKSIMIZIRA ANNUAL YIELD (letni % yield, ne €/dan
// per item). Razlika od inventory-capital-return-maximizer (v8.07 ki
// maksimizira capital return OF inventory) — ta MAKSIMIZIRA ANNUAL YIELD
// (letni profit / inventory value × 100, ne % capital returned). Razlika od
// inventory-return-on-capital-maximizer (v8.08 ki maksimizira return ON capital
// za HELD inventory) — ta MAKSIMIZIRA ANNUAL YIELD z optimalInventorySize in
// yieldVsBenchmark. Razlika od profit-multiplier-maximizer (v8.09 ki
// maksimizira maximum profit multiplier z 6 dimensions) — ta MAKSIMIZIRA
// ANNUAL YIELD (letni yield %, ne profit multiplier ×). Razlika od
// profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate profit-a v
// %/mo) — ta MAKSIMIZIRA ANNUAL YIELD (letni yield %, ne growth rate %/mo).
// Razlika od deal-source-profit-per-day-maximizer (v8.11 ki maksimizira daily
// profit per source) — ta MAKSIMIZIRA ANNUAL YIELD čez inventory (letni
// yield %, ne €/dan per source).

// GET+POST /api/ai/inventory-annual-yield-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type YieldGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type YieldLeverType =
  | 'REDUCE_INVENTORY_VALUE'
  | 'INCREASE_PROFIT'
  | 'FASTER_TURNOVER'
  | 'OPTIMIZE_MIX';

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
  avgInventoryValue: number; // € = sum of estValues of HELD items
  heldInventoryCount: number;
  annualProfit: number; // € = total profit from SOLD trades in last 12m
  currentAnnualYield: number; // % = annualProfit / avgInventoryValue × 100
  avgHoldDays: number; // days from SOLD trades
  soldCount12m: number;
  totalCapitalDeployed: number; // € (SOLD 12m capital + HELD capital)
}

interface YieldLeverEntry {
  lever: YieldLeverType;
  potentialGain: number; // pp uplift in annual yield %
  action: string; // slovenski, max 200
}

interface YieldVsBenchmark {
  dividendStocks: number; // % benchmark ~3%
  bonds: number; // % benchmark ~2%
  reits: number; // % benchmark ~4%
  yourCurrentYield: number; // % current annual yield
  yourMaximizedYield: number; // % maximized annual yield
  maximizedVsDividendStocks: number; // pp = maximized − dividendStocks
  maximizedVsBonds: number; // pp = maximized − bonds
  maximizedVsReits: number; // pp = maximized − reits
}

interface YieldProjectionEntry {
  months: number; // 3, 6, 12
  projectedYield: number; // % annualized at that horizon
  projectedProfit: number; // € absolute profit at that horizon (annualized)
}

interface InventoryAnnualYieldMaximization {
  maximizedAnnualYield: number; // % optimal achievable
  yieldUplift: number; // pp improvement = maximized − current
  yieldMaximizationLevers: YieldLeverEntry[]; // 4 entries
  inventoryYieldOptimization: string; // slovenski, max 300 — how to reduce tied-up capital while maintaining profit
  yieldVsBenchmark: YieldVsBenchmark;
  optimalInventorySize: number; // € ideal inventory value for max yield
  yieldProjection: YieldProjectionEntry[]; // 3 entries (3/6/12 month)
  yieldGrade: YieldGrade;
}

interface InventoryAnnualYieldResponse {
  ok: true;
  current: CurrentState;
  maximization: InventoryAnnualYieldMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedAnnualYield?: number;
    yieldUplift?: number;
    yieldMaximizationLevers?: Array<{
      lever?: YieldLeverType;
      potentialGain?: number;
      action?: string;
    }>;
    inventoryYieldOptimization?: string;
    optimalInventorySize?: number;
    yieldProjection?: Array<{
      months?: number;
      projectedYield?: number;
      projectedProfit?: number;
    }>;
    yieldGrade?: YieldGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const INVENTORY_MIN = 0;
const INVENTORY_MAX = 1_000_000;
const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const YIELD_MIN = -50;
const YIELD_MAX = 500;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 500;
const HOLD_MIN = 1;
const HOLD_MAX = 730;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const GAIN_MIN = 0;
const GAIN_MAX = 200;
const PROJECTION_PROFIT_MIN = 0;
const PROJECTION_PROFIT_MAX = 1_000_000;

// Benchmark yields — traditional investment benchmarks
const BENCHMARK_DIVIDEND_STOCKS = 3; // % avg dividend yield S&P 500
const BENCHMARK_BONDS = 2; // % gov bonds
const BENCHMARK_REITS = 4; // % avg REIT yield

// Target yield — what an optimal trading operation should achieve
const TARGET_YIELD = 50; // % (much higher than passive investments)
const ABSOLUTE_UPLIFT_CAP = 200; // pp — anti-hallucination ceiling

const VALID_GRADE: readonly YieldGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_LEVER: readonly YieldLeverType[] = [
  'REDUCE_INVENTORY_VALUE',
  'INCREASE_PROFIT',
  'FASTER_TURNOVER',
  'OPTIMIZE_MIX',
];

const MAX_LEVERS = 4;
const MAX_PROJECTIONS = 3;
const MAX_ITEMS_FOR_AI = 50;

// Per-lever potential gain (pp uplift in annual yield)
const LEVER_POTENTIAL_GAIN: Record<YieldLeverType, number> = {
  REDUCE_INVENTORY_VALUE: 40, // +40pp by reducing tied-up capital
  INCREASE_PROFIT: 50, // +50pp by higher profit per trade
  FASTER_TURNOVER: 60, // +60pp by faster capital cycling
  OPTIMIZE_MIX: 30, // +30pp by better inventory composition
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
  title: string;
  category: string;
  capital: number; // buyPrice + buyFees
  estValue: number; // listing.aiEstimatedValue ?? listing.price ?? capital
  aiRisk: number; // 0-100 (from Listing.aiRisk)
}

interface SoldComputed {
  profit: number; // € = (sellPrice − sellFees) − capital
  capital: number; // € = buyPrice + buyFees
  holdDays: number;
  sellMs: number;
  within12m: boolean;
}

function computeHeldTrade(t: HeldTradeRow): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const estValue = t.listing?.aiEstimatedValue
    ?? t.listing?.price
    ?? capital;
  return {
    id: t.id,
    title: t.title ?? 'Brez naslova',
    category: t.category ?? 'drugo',
    capital,
    estValue: Math.max(0, estValue),
    aiRisk: t.listing?.aiRisk ?? 50,
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
  return { profit, capital, holdDays, sellMs, within12m };
}

function computeCurrent(
  held: HeldComputed[],
  sold: SoldComputed[],
): CurrentState {
  const heldCount = held.length;
  const avgInventoryValue = round0(clampNum(
    held.reduce((s, h) => s + h.estValue, 0),
    INVENTORY_MIN, INVENTORY_MAX, 0,
  ));
  const annualProfit = round0(clampNum(
    sold.reduce((s, t) => s + t.profit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const currentAnnualYield = round2(clampNum(
    avgInventoryValue > 0 ? (annualProfit / avgInventoryValue) * 100 : 0,
    YIELD_MIN, YIELD_MAX, 0,
  ));
  const avgHoldDays = round0(clampNum(
    sold.length > 0 ? sold.reduce((s, t) => s + t.holdDays, 0) / sold.length : 0,
    sold.length > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
  ));
  const soldCapital = round0(clampNum(
    sold.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const heldCapital = round0(clampNum(
    held.reduce((s, h) => s + h.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  return {
    avgInventoryValue,
    heldInventoryCount: heldCount,
    annualProfit,
    currentAnnualYield,
    avgHoldDays,
    soldCount12m: sold.length,
    totalCapitalDeployed: round0(clampNum(
      soldCapital + heldCapital, CAPITAL_MIN, CAPITAL_MAX, 0,
    )),
  };
}

// --- Deterministic maximization -----------------------------------------

function buildYieldLevers(current: CurrentState): YieldLeverEntry[] {
  const leverData: Array<{
    lever: YieldLeverType;
    gain: number;
    action: string;
  }> = [
    {
      lever: 'REDUCE_INVENTORY_VALUE',
      gain: LEVER_POTENTIAL_GAIN.REDUCE_INVENTORY_VALUE,
      action: `Zmanjšaj tied-up capital z ${current.avgInventoryValue}€ na ${Math.round(current.avgInventoryValue * 0.7)}€ — prodaj slow-movers, prestavi capital v hitreje-seprodajajoče items (+40pp yield z istim profit).`,
    },
    {
      lever: 'INCREASE_PROFIT',
      gain: LEVER_POTENTIAL_GAIN.INCREASE_PROFIT,
      action: `Dvigni letni profit z ${current.annualProfit}€ na ${Math.round(current.annualProfit * 1.4)}€ z AI pricing engine in dynamic pricing — +50pp yield z istim inventory value.`,
    },
    {
      lever: 'FASTER_TURNOVER',
      gain: LEVER_POTENTIAL_GAIN.FASTER_TURNOVER,
      action: `Skrajšaj avg hold time z ${current.avgHoldDays} na ${Math.round(current.avgHoldDays * 0.6)} dni z listing-refresh-scheduler in auto-relisting — +60pp yield z faster capital cycling na istem inventory value.`,
    },
    {
      lever: 'OPTIMIZE_MIX',
      gain: LEVER_POTENTIAL_GAIN.OPTIMIZE_MIX,
      action: `Optimiziraj inventory mix — prestavi capital iz commodity items (nizek yield) v premium niche (visok yield) — +30pp yield z boljšo inventory composition.`,
    },
  ];

  return leverData.map((d) => ({
    lever: d.lever,
    potentialGain: round2(clampNum(
      d.gain, GAIN_MIN, GAIN_MAX, 0,
    )),
    action: clampString(d.action, 200, `Maximiziraj ${d.lever.toLowerCase().replace('_', ' ')} za višji annual yield.`),
  })).slice(0, MAX_LEVERS);
}

function buildYieldVsBenchmark(
  currentYield: number,
  maximizedYield: number,
): YieldVsBenchmark {
  return {
    dividendStocks: BENCHMARK_DIVIDEND_STOCKS,
    bonds: BENCHMARK_BONDS,
    reits: BENCHMARK_REITS,
    yourCurrentYield: round2(clampNum(
      currentYield, YIELD_MIN, YIELD_MAX, 0,
    )),
    yourMaximizedYield: round2(clampNum(
      maximizedYield, YIELD_MIN, YIELD_MAX, 0,
    )),
    maximizedVsDividendStocks: round2(clampNum(
      maximizedYield - BENCHMARK_DIVIDEND_STOCKS, -1000, 1000, 0,
    )),
    maximizedVsBonds: round2(clampNum(
      maximizedYield - BENCHMARK_BONDS, -1000, 1000, 0,
    )),
    maximizedVsReits: round2(clampNum(
      maximizedYield - BENCHMARK_REITS, -1000, 1000, 0,
    )),
  };
}

function buildYieldProjection(
  current: CurrentState,
  maximizedYield: number,
): YieldProjectionEntry[] {
  const projections: YieldProjectionEntry[] = [];
  for (const months of [3, 6, 12]) {
    // Linear ramp: 3m=25%, 6m=50%, 12m=100% adoption of maximized yield
    const adoption = months / 12;
    const projectedYield = current.currentAnnualYield
      + (maximizedYield - current.currentAnnualYield) * adoption;
    // Projected profit = projectedYield/100 × currentInventoryValue × (months/12) — annualized to that horizon
    const annualizedProfit = (projectedYield / 100) * current.avgInventoryValue;
    const projectedProfit = annualizedProfit * (months / 12);
    projections.push({
      months,
      projectedYield: round2(clampNum(
        projectedYield, YIELD_MIN, YIELD_MAX, 0,
      )),
      projectedProfit: round0(clampNum(
        projectedProfit, PROJECTION_PROFIT_MIN, PROJECTION_PROFIT_MAX, 0,
      )),
    });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function decideYieldGrade(maximizedYield: number): YieldGrade {
  if (maximizedYield >= 100) return 'A+';
  if (maximizedYield >= 75) return 'A';
  if (maximizedYield >= 50) return 'B';
  if (maximizedYield >= 30) return 'C';
  if (maximizedYield >= 15) return 'D';
  return 'F';
}

function computeOptimalInventorySize(
  current: CurrentState,
  maximizedYield: number,
): number {
  // optimalInventorySize = annualProfit (maximized) / targetYield × 100
  // If maximizedYield is too low, default to current
  if (maximizedYield <= 0) {
    return current.avgInventoryValue;
  }
  // Maximized profit estimate (assume profit can grow 1.4× via levers)
  const maximizedProfit = current.annualProfit * 1.4;
  const optimal = (maximizedProfit / maximizedYield) * 100;
  return round0(clampNum(
    optimal, INVENTORY_MIN, INVENTORY_MAX, current.avgInventoryValue,
  ));
}

function buildInventoryYieldOptimization(current: CurrentState): string {
  const slowMovers = current.heldInventoryCount; // approximation
  return `Optimizacija inventory yield-a: zmanjšaj tied-up capital z ${current.avgInventoryValue}€ na optimalno vrednost (glej optimalInventorySize) s prodajo ${Math.max(1, Math.round(slowMovers * 0.3))} slow-mover items, ki so v inventory-ju > 60 dni. Prestavi sproščen capital v hitreje-se-prodajajoče niche z višjim absolute margin (premium watches, designer bags, electronics). Vzdržuj profit z istim trade volume-om — yield naraste ker je inventory value nižji. Implementiraj inventory-aging-tracker za avtomatsko identifikacijo slow-movers in auto-relisting-scheduler za faster capital recycling. Cilj: LETNI YIELD ≥ ${TARGET_YIELD}% (veliko višje od dividend stocks ${BENCHMARK_DIVIDEND_STOCKS}% in REITs ${BENCHMARK_REITS}%).`;
}

function buildDeterministicMaximization(
  current: CurrentState,
): InventoryAnnualYieldMaximization {
  // Sum of all 4 lever gains — capped to ABSOLUTE_UPLIFT_CAP (200pp)
  const upliftRaw = Math.min(
    ABSOLUTE_UPLIFT_CAP,
    Object.values(LEVER_POTENTIAL_GAIN).reduce((s, v) => s + v, 0),
  );

  // Anti-hallucination: maximizedYield ∈ [current, current + 200pp]
  const minBound = Math.max(YIELD_MIN, current.currentAnnualYield);
  const maxBound = Math.min(YIELD_MAX, current.currentAnnualYield + ABSOLUTE_UPLIFT_CAP);
  const maximizedAnnualYield = round2(clampNum(
    current.currentAnnualYield + upliftRaw,
    minBound, maxBound,
    current.currentAnnualYield,
  ));
  const yieldUplift = round2(clampNum(
    Math.max(0, maximizedAnnualYield - current.currentAnnualYield),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const yieldMaximizationLevers = buildYieldLevers(current);
  const inventoryYieldOptimization = clampString(
    buildInventoryYieldOptimization(current),
    300,
    'Optimiziraj inventory composition za višji annual yield na tied-up capital.',
  );
  const yieldVsBenchmark = buildYieldVsBenchmark(
    current.currentAnnualYield, maximizedAnnualYield,
  );
  const optimalInventorySize = computeOptimalInventorySize(
    current, maximizedAnnualYield,
  );
  const yieldProjection = buildYieldProjection(current, maximizedAnnualYield);
  const yieldGrade = decideYieldGrade(maximizedAnnualYield);

  return {
    maximizedAnnualYield,
    yieldUplift,
    yieldMaximizationLevers,
    inventoryYieldOptimization,
    yieldVsBenchmark,
    optimalInventorySize,
    yieldProjection,
    yieldGrade,
  };
}

function buildSummary(
  current: CurrentState,
  max: InventoryAnnualYieldMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.currentAnnualYield.toFixed(2)}% yield (${current.annualProfit}€ annual profit / ${current.avgInventoryValue}€ inventory, ${current.heldInventoryCount} HELD items, ${current.soldCount12m} SOLD 12m, ${current.avgHoldDays}d hold).`,
    `Maximized: ${max.maximizedAnnualYield.toFixed(2)}% yield (+${max.yieldUplift.toFixed(2)}pp uplift, grade ${max.yieldGrade}).`,
    `Vs dividend stocks (${BENCHMARK_DIVIDEND_STOCKS}%): +${max.yieldVsBenchmark.maximizedVsDividendStocks.toFixed(2)}pp. Vs bonds (${BENCHMARK_BONDS}%): +${max.yieldVsBenchmark.maximizedVsBonds.toFixed(2)}pp. Vs REITs (${BENCHMARK_REITS}%): +${max.yieldVsBenchmark.maximizedVsReits.toFixed(2)}pp.`,
    `Optimal inventory size: ${max.optimalInventorySize}€.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryAnnualYieldInput {}

// --- Handler -------------------------------------------------------------

const inventoryAnnualYieldHandler = withAiRoute<InventoryAnnualYieldInput>({
  endpoint: '/api/ai/inventory-annual-yield-maximizer',
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

    // 1) Parallel query HELD trades (with linked Listing for estValue) + SOLD trades (last 12m)
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
        take: 10000,
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
          avgInventoryValue: 0,
          heldInventoryCount: 0,
          annualProfit: 0,
          currentAnnualYield: 0,
          avgHoldDays: 0,
          soldCount12m: 0,
          totalCapitalDeployed: 0,
        },
        maximization: {
          maximizedAnnualYield: 0,
          yieldUplift: 0,
          yieldMaximizationLevers: [],
          inventoryYieldOptimization: '',
          yieldVsBenchmark: {
            dividendStocks: BENCHMARK_DIVIDEND_STOCKS,
            bonds: BENCHMARK_BONDS,
            reits: BENCHMARK_REITS,
            yourCurrentYield: 0,
            yourMaximizedYield: 0,
            maximizedVsDividendStocks: 0,
            maximizedVsBonds: 0,
            maximizedVsReits: 0,
          },
          optimalInventorySize: 0,
          yieldProjection: [],
          yieldGrade: 'F',
        },
        summary: 'Ni HELD in SOLD trgovin — Inventory Annual Yield Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD in SOLD trgovin — Inventory Annual Yield Maximizer ni mogoč.',
      } satisfies InventoryAnnualYieldResponse);
    }

    // 2) Compute HELD and SOLD trades
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t);
      if (c) heldComputed.push(c);
    }

    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    // If no HELD inventory, yield is undefined — fallback to 0
    if (heldComputed.length === 0) {
      const soldCap = soldComputed.reduce((s, t) => s + t.capital, 0);
      return apiOk({
        ok: true,
        current: {
          avgInventoryValue: 0,
          heldInventoryCount: 0,
          annualProfit: round0(clampNum(
            soldComputed.reduce((s, t) => s + t.profit, 0),
            PROFIT_MIN, PROFIT_MAX, 0,
          )),
          currentAnnualYield: 0,
          avgHoldDays: round0(clampNum(
            soldComputed.length > 0
              ? soldComputed.reduce((s, t) => s + t.holdDays, 0) / soldComputed.length
              : 0,
            soldComputed.length > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
          )),
          soldCount12m: soldComputed.length,
          totalCapitalDeployed: round0(clampNum(
            soldCap, CAPITAL_MIN, CAPITAL_MAX, 0,
          )),
        },
        maximization: {
          maximizedAnnualYield: 0,
          yieldUplift: 0,
          yieldMaximizationLevers: [],
          inventoryYieldOptimization: 'Ni HELD inventory — yield computation ni mogoč. Dodaj HELD trades za izračun annual yield.',
          yieldVsBenchmark: {
            dividendStocks: BENCHMARK_DIVIDEND_STOCKS,
            bonds: BENCHMARK_BONDS,
            reits: BENCHMARK_REITS,
            yourCurrentYield: 0,
            yourMaximizedYield: 0,
            maximizedVsDividendStocks: 0,
            maximizedVsBonds: 0,
            maximizedVsReits: 0,
          },
          optimalInventorySize: 0,
          yieldProjection: [],
          yieldGrade: 'F',
        },
        summary: 'Ni HELD inventory — Inventory Annual Yield Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD inventory — Inventory Annual Yield Maximizer ni mogoč.',
      } satisfies InventoryAnnualYieldResponse);
    }

    const current = computeCurrent(heldComputed, soldComputed);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-annual-yield-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: InventoryAnnualYieldMaximization;
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
      } satisfies InventoryAnnualYieldResponse);
    }

    // 4) AI prompt with grounding
    const heldSampleForAI = heldComputed
      .slice(0, MAX_ITEMS_FOR_AI)
      .map((h) => ({
        title: h.title,
        category: h.category,
        capital: h.capital,
        estValue: h.estValue,
        aiRisk: h.aiRisk,
      }));

    const promptData = {
      heldCount: heldComputed.length,
      soldCount12m: soldComputed.length,
      current,
      deterministicMaximization: {
        maximizedAnnualYield: maximization.maximizedAnnualYield,
        yieldUplift: maximization.yieldUplift,
        yieldMaximizationLevers: maximization.yieldMaximizationLevers,
        inventoryYieldOptimization: maximization.inventoryYieldOptimization,
        yieldVsBenchmark: maximization.yieldVsBenchmark,
        optimalInventorySize: maximization.optimalInventorySize,
        yieldProjection: maximization.yieldProjection,
        yieldGrade: maximization.yieldGrade,
      },
      heldSample: heldSampleForAI,
      benchmarks: {
        dividendStocks: BENCHMARK_DIVIDEND_STOCKS,
        bonds: BENCHMARK_BONDS,
        reits: BENCHMARK_REITS,
      },
      caps: {
        inventoryMin: INVENTORY_MIN, inventoryMax: INVENTORY_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        yieldMin: YIELD_MIN, yieldMax: YIELD_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        projectionProfitMin: PROJECTION_PROFIT_MIN,
        projectionProfitMax: PROJECTION_PROFIT_MAX,
        absoluteUpliftCap: ABSOLUTE_UPLIFT_CAP,
      },
    };

    const prompt = `Si AI "Inventory Annual Yield Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za INVENTORY ANNUAL YIELD MAXIMIZATION — kako maksimizirati ANNUAL YIELD held inventory-ja (letni profit kot % povprečne vrednosti inventory-ja, kot dividend yield ampak za inventory). Tvoj cilj je "Tvoj letni yield je 32%, ampak bi lahko bil 58% z optimalno inventory sestavo in turnover." Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized return per item — unrealized profit × 365/holdDays) — ti MAKSIMIZIRAŠ ANNUAL YIELD čez celoten inventory (realized annual profit / held inventory value × 100, ne per-item unrealized return). Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira velocity kapitala skozi inventory — koliko cycle-ov/leto) — ti MAKSIMIZIRAŠ ANNUAL YIELD (letni profit / inventory value × 100, ne cycle count). Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item z yieldGrade) — ti MAKSIMIZIRAŠ PORTFOLIO ANNUAL YIELD z yieldVsBenchmark (dividend stocks 3%, bonds 2%, REITs 4%) in optimalInventorySize. Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield čez portfolio z yieldComparisonTable) — ti MAKSIMIZIRAŠ ANNUAL YIELD z yieldMaximizationLevers (REDUCE_INVENTORY_VALUE/INCREASE_PROFIT/FASTER_TURNOVER/OPTIMIZE_MIX) in inventoryYieldOptimization. Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve in optimalTurnoverRate) — ti MAKSIMIZIRAŠ ANNUAL YIELD z yieldProjection (3/6/12 month) in yieldGrade. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item z reallocation) — ti MAKSIMIZIRAŠ ANNUAL YIELD čez celoten inventory z yieldVsBenchmark. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti MAKSIMIZIRAŠ ANNUAL YIELD (letni profit / inventory value, ne per-item ROI). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ti MAKSIMIZIRAŠ ANNUAL YIELD (letni % yield, ne €/dan per item). Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF inventory) — ti MAKSIMIZIRAŠ ANNUAL YIELD (letni profit / inventory value × 100, ne % capital returned). Razlika od inventory-return-on-capital-maximizer (v8.08 ki maksimizira return ON capital za HELD inventory) — ti MAKSIMIZIRAŠ ANNUAL YIELD z optimalInventorySize in yieldVsBenchmark. Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ ANNUAL YIELD (letni yield %, ne profit multiplier ×). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate profit-a v %/mo) — ti MAKSIMIZIRAŠ ANNUAL YIELD (letni yield %, ne growth rate %/mo). Razlika od deal-source-profit-per-day-maximizer (v8.11 ki maksimizira daily profit per source) — ti MAKSIMIZIRAŠ ANNUAL YIELD čez inventory (letni yield %, ne €/dan per source).

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovine z linked Listing za estValue + SOLD trgovine v zadnjih 12 mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedAnnualYield % [-50, 500] (optimal achievable, ≥ current.currentAnnualYield, ≤ current.currentAnnualYield + 200pp absolute uplift — anti-hallucination),
2. maximization.yieldUplift pp [0, 500] (improvement = maximized − current),
3. maximization.yieldMaximizationLevers: 4 elementi { lever REDUCE_INVENTORY_VALUE/INCREASE_PROFIT/FASTER_TURNOVER/OPTIMIZE_MIX, potentialGain pp [0, 200] (REDUCE=40, INCREASE=50, FASTER=60, OPTIMIZE_MIX=30), action (slovenski, max 200 — specifična akcija za ta lever) },
4. maximization.inventoryYieldOptimization (slovenski, max 300 — kako zmanjšati tied-up capital pri vzdrževanju profit-a za višji annual yield),
5. maximization.optimalInventorySize € [0, 1000000] (ideal inventory value za max yield = maximizedProfit / maximizedYield × 100),
6. maximization.yieldProjection: 3 elementi { months 3/6/12, projectedYield % [-50, 500] (linear ramp: 3m=25%, 6m=50%, 12m=100% adoption), projectedProfit € [0, 1000000] (annualized profit × months/12) },
7. maximization.yieldGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 100, A ≥ 75, B ≥ 50, C ≥ 30, D ≥ 15, else F),
8. (yieldVsBenchmark z dividendStocks 3%, bonds 2%, reits 4% se avtomatsko izračuna v backend-u — AI ne vrača teh),
9. summary: slovenski povzetek (max 500 znakov — poudari current yield, maximized yield, uplift, grade, vs dividend stocks/bonds/REITs, optimal inventory size).

VRNI LE JSON:
{
  "maximization": {
    "maximizedAnnualYield": 58.0,
    "yieldUplift": 26.0,
    "yieldMaximizationLevers": [
      { "lever": "REDUCE_INVENTORY_VALUE", "potentialGain": 40, "action": "Zmanjšaj tied-up capital s prodajo slow-movers." },
      { "lever": "INCREASE_PROFIT", "potentialGain": 50, "action": "Dvigni letni profit z AI pricing engine." },
      { "lever": "FASTER_TURNOVER", "potentialGain": 60, "action": "Skrajšaj avg hold time z listing-refresh-scheduler." },
      { "lever": "OPTIMIZE_MIX", "potentialGain": 30, "action": "Optimiziraj inventory mix — prestavi capital v premium niche." }
    ],
    "inventoryYieldOptimization": "Optimizacija inventory yield-a: zmanjšaj tied-up capital s prodajo slow-movers, prestavi capital v hitreje-se-prodajajoče niche z višjim absolute margin.",
    "optimalInventorySize": 3500,
    "yieldProjection": [
      { "months": 3, "projectedYield": 38.5, "projectedProfit": 336 },
      { "months": 6, "projectedYield": 45.0, "projectedProfit": 787 },
      { "months": 12, "projectedYield": 58.0, "projectedProfit": 2030 }
    ],
    "yieldGrade": "B"
  },
  "summary": "Current: 32.00% yield (1600€ annual profit / 5000€ inventory, 20 HELD items, 50 SOLD 12m, 28d hold). Maximized: 58.00% yield (+26.00pp uplift, grade B). Vs dividend stocks (3%): +55.00pp. Vs bonds (2%): +56.00pp. Vs REITs (4%): +54.00pp. Optimal inventory size: 3500€."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Anti-hallucination: maximizedAnnualYield ∈ [current, current + 200pp]
        const minBound = Math.max(YIELD_MIN, current.currentAnnualYield);
        const maxBound = Math.min(YIELD_MAX, current.currentAnnualYield + ABSOLUTE_UPLIFT_CAP);
        const maximizedAnnualYield = round2(clampNum(
          aiMax.maximizedAnnualYield,
          minBound, maxBound,
          maximization.maximizedAnnualYield,
        ));
        const yieldUplift = round2(clampNum(
          Math.max(0, maximizedAnnualYield - current.currentAnnualYield),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override yieldMaximizationLevers — must have 4 entries
        let yieldMaximizationLevers = maximization.yieldMaximizationLevers;
        if (Array.isArray(aiMax.yieldMaximizationLevers) &&
            aiMax.yieldMaximizationLevers.length >= 3) {
          const aiLevers: YieldLeverEntry[] = [];
          for (const l of aiMax.yieldMaximizationLevers.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            const lever = clampEnum(l.lever, VALID_LEVER, 'REDUCE_INVENTORY_VALUE');
            aiLevers.push({
              lever,
              potentialGain: round2(clampNum(
                l.potentialGain ?? LEVER_POTENTIAL_GAIN[lever],
                GAIN_MIN, GAIN_MAX,
                LEVER_POTENTIAL_GAIN[lever],
              )),
              action: clampString(l.action, 200, `Maximiziraj ${lever.toLowerCase().replace('_', ' ')} za višji annual yield.`),
            });
          }
          if (aiLevers.length >= 3) {
            yieldMaximizationLevers = aiLevers.slice(0, MAX_LEVERS);
          }
        }

        // Override inventoryYieldOptimization
        const inventoryYieldOptimization = clampString(
          aiMax.inventoryYieldOptimization,
          300,
          maximization.inventoryYieldOptimization,
        );

        // Override optimalInventorySize
        const optimalInventorySize = aiMax.optimalInventorySize !== undefined
          ? round0(clampNum(
              aiMax.optimalInventorySize,
              INVENTORY_MIN, INVENTORY_MAX,
              maximization.optimalInventorySize,
            ))
          : computeOptimalInventorySize(current, maximizedAnnualYield);

        // Override yieldProjection — must have 3 entries with months 3/6/12
        let yieldProjection = maximization.yieldProjection;
        if (Array.isArray(aiMax.yieldProjection) &&
            aiMax.yieldProjection.length >= 3) {
          const aiProj: YieldProjectionEntry[] = [];
          for (const expected of [3, 6, 12]) {
            const ai = aiMax.yieldProjection.find(
              (p) => p && Number(p.months) === expected,
            );
            if (!ai) continue;
            aiProj.push({
              months: expected,
              projectedYield: round2(clampNum(
                ai.projectedYield, YIELD_MIN, YIELD_MAX, 0,
              )),
              projectedProfit: round0(clampNum(
                ai.projectedProfit,
                PROJECTION_PROFIT_MIN, PROJECTION_PROFIT_MAX, 0,
              )),
            });
          }
          if (aiProj.length === 3) {
            yieldProjection = aiProj;
          }
        }

        // Override yieldGrade
        const yieldGrade = aiMax.yieldGrade
          ? clampEnum(aiMax.yieldGrade, VALID_GRADE, decideYieldGrade(maximizedAnnualYield))
          : decideYieldGrade(maximizedAnnualYield);

        // Rebuild yieldVsBenchmark with new maximizedAnnualYield
        const yieldVsBenchmark = buildYieldVsBenchmark(
          current.currentAnnualYield, maximizedAnnualYield,
        );

        maximization = {
          maximizedAnnualYield,
          yieldUplift,
          yieldMaximizationLevers,
          inventoryYieldOptimization,
          yieldVsBenchmark,
          optimalInventorySize,
          yieldProjection,
          yieldGrade,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-annual-yield-maximizer',
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
    } satisfies InventoryAnnualYieldResponse);
  },
});

export const GET = inventoryAnnualYieldHandler;
export const POST = inventoryAnnualYieldHandler;
