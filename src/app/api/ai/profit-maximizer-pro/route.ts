// v7.94 / v8.96.9-final3: AI Profit Maximizer Pro — ULTIMATIVNI profit maximization engine
// ki kombinira VSE profit levers (pricing, timing, bundling, sourcing,
// inventory mix, turnover, fees) v en sam AI-driven profit maximization
// plan. Razlika od profit-maximizer (basic sell price optimization) —
// ta je COMPREHENSIVE engine z 7 levers in quick wins. Razlika od
// profit-maximizer-v2 (v7.56 ML compounding projections) — ta gleda
// LEVERS (kateri vzvodi so na voljo in kaj prinesejo). Razlika od
// profit-accelerator (v7.71 ki da acceleration actions) — ta
// identificira VSE profit levers in jih rangira po ROI.
//
// "Annual profit: 12,000€ → maximized 21,000€ (+75% uplift). Quick win:
// raise elektronika prices 5% → +150€/mo. Lever #1: pricing (+3,200€/yr)."
//
// Razlika od inventory-profit-maximizer (ki optimizira inventory profit)
// — ta gleda VSE levers hkrati (pricing + timing + bundle + sourcing +
// inventory mix + turnover + fee). Razlika od profit-forecast (ki napove
// profit) — ta daje MAXIMIZATION PLAN z actionable levers. Razlika od
// profit-trajectory-forecaster (v7.72 ki forecast-a growth trajectory)
// — ta daje SPECIFIČNE levers in quick wins z ROI rangiranjem. Razlika
// od profit-margin-forecaster-pro (v7.85 ki forecast-a margin z
// scenarios) — ta optimizira VEČ levers hkrati ne le margin. Razlika
// od capital-allocation-optimizer (v7.63 ki alocira capital) — ta
// optimizira PROFIT preko 7 različnih vzvodov.
//
// GET+POST /api/ai/profit-maximizer-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.9) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitMaximizerProInput {}

// --- Types ---------------------------------------------------------------

type LeverDifficulty = 'LOW' | 'MEDIUM' | 'HIGH';
type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type ActionEffort = 'LOW' | 'MEDIUM' | 'HIGH';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type LeverName =
  | 'pricingLever'
  | 'timingLever'
  | 'bundleLever'
  | 'sourcingLever'
  | 'inventoryMixLever'
  | 'turnoverLever'
  | 'feeLever';

interface Lever {
  currentGap: number; // EUR — gap between current state and maximized state
  maximizationPotential: number; // EUR — total potential profit lift
  difficulty: LeverDifficulty;
  requiredActions: string[];
  expectedProfitLift: number; // EUR per year
}

interface Levers {
  pricingLever: Lever;
  timingLever: Lever;
  bundleLever: Lever;
  sourcingLever: Lever;
  inventoryMixLever: Lever;
  turnoverLever: Lever;
  feeLever: Lever;
}

interface Baseline {
  currentAnnualProfit: number; // EUR
  currentMonthlyAvg: number; // EUR
  maximizedAnnualProfit: number; // EUR
  profitUpliftPercent: number; // %
  profitUpliftEuros: number; // EUR
}

interface PrioritizedAction {
  action: string;
  lever: string;
  priority: ActionPriority;
  expectedProfitLift: number; // EUR
  effort: ActionEffort;
  timeline: string;
  roi: number; // 0-100 (expectedProfitLift per unit effort)
}

interface QuickWin {
  action: string;
  expectedProfitLift: number; // EUR
  timeline: string;
}

interface MediumTermOptimization {
  action: string;
  expectedProfitLift: number;
  timeline: string;
}

interface LongTermStrategy {
  action: string;
  expectedProfitLift: number;
  timeline: string;
}

interface Plan {
  prioritizedActions: PrioritizedAction[];
  quickWins: QuickWin[];
  mediumTermOptimizations: MediumTermOptimization[];
  longTermStrategy: LongTermStrategy[];
}

interface ProjectionPoint {
  month: number; // 1-12
  currentProfit: number; // EUR
  maximizedProfit: number; // EUR
  cumulativeLift: number; // EUR (running sum of (max - current))
}

interface RiskTradeoff {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface Projection {
  profitMaximizationScore: number; // 0-100
  maximizedProfitProjection: ProjectionPoint[];
  riskTradeoffs: RiskTradeoff[];
  confidenceLevel: number; // 0-100
}

interface AiProfitMaxResponse {
  plan?: {
    prioritizedActions?: Array<{
      action?: string;
      lever?: ActionPriority;
      priority?: ActionPriority;
      expectedProfitLift?: number;
      effort?: ActionEffort;
      timeline?: string;
      roi?: number;
    }>;
    quickWins?: Array<{ action?: string; expectedProfitLift?: number; timeline?: string }>;
    mediumTermOptimizations?: Array<{ action?: string; expectedProfitLift?: number; timeline?: string }>;
    longTermStrategy?: Array<{ action?: string; expectedProfitLift?: number; timeline?: string }>;
  };
  projection?: {
    profitMaximizationScore?: number;
    maximizedProfitProjection?: Array<{
      month?: number;
      currentProfit?: number;
      maximizedProfit?: number;
      cumulativeLift?: number;
    }>;
    riskTradeoffs?: Array<{ risk?: string; severity?: RiskSeverity; mitigation?: string }>;
    confidenceLevel?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const LIFT_MIN_EUR = 0;
const LIFT_MAX_EUR = 500_000; // EUR per year upper bound
const ROI_MIN = 0;
const ROI_MAX = 100;
const CONF_MIN = 0;
const CONF_MAX = 100;
const UPLIFT_PERCENT_MIN = 0;
const UPLIFT_PERCENT_MAX = 300; // up to 3x

const VALID_DIFFICULTY: readonly LeverDifficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_PRIORITY: readonly ActionPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VALID_EFFORT: readonly ActionEffort[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

const LEVER_NAMES: LeverName[] = [
  'pricingLever',
  'timingLever',
  'bundleLever',
  'sourcingLever',
  'inventoryMixLever',
  'turnoverLever',
  'feeLever',
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

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Linear regression slope per index
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// --- Trade row types ----------------------------------------------------

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  sellLocation: string;
  category: string;
  listingId: string | null;
}

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  category: string;
}

interface HeldListingRow {
  id: string;
  title: string;
  price: number | null;
  aiEstimatedValue: number | null;
  aiScore: number | null;
  aiRisk: number | null;
  dealScore: number | null;
  aiVerdict: string | null;
  monitor: { tags: string } | null;
}

// --- Lever computation --------------------------------------------------

interface LeverContext {
  soldTrades: SoldTradeRow[];
  heldTrades: HeldTradeRow[];
  heldListings: HeldListingRow[];
  monthlyProfit: number[]; // last 12 months
  totalProfit12m: number;
  totalRevenue12m: number;
  totalCost12m: number;
  totalFees12m: number;
  avgProfitPerTrade: number;
  avgHoldDays: number;
  totalTrades: number;
  categories: Set<string>;
  byCategory: Map<string, { count: number; profit: number; revenue: number; cost: number }>;
  bySource: Map<string, { count: number; profit: number; revenue: number; cost: number }>;
}

function computeLeverContext(
  soldTrades: SoldTradeRow[],
  heldTrades: HeldTradeRow[],
  heldListings: HeldListingRow[],
  now: number,
): LeverContext {
  const cutoff12m = now - HORIZON_12M;
  const monthStartMs = (t: number): number => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  const thisMonthStart = monthStartMs(now);
  const months: number[] = Array.from({ length: MONTHS_12 }, () => 0);

  const byCategory = new Map<string, { count: number; profit: number; revenue: number; cost: number }>();
  const bySource = new Map<string, { count: number; profit: number; revenue: number; cost: number }>();
  const categories = new Set<string>();

  let totalProfit12m = 0;
  let totalRevenue12m = 0;
  let totalCost12m = 0;
  let totalFees12m = 0;
  let holdDaysSum = 0;
  let holdDayCount = 0;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;
    if (sellMs < cutoff12m) continue;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const buyMs = toMs(t.buyDate);
    const revenue = sellPrice - sellFees;
    const cost = buyPrice + buyFees;
    const profit = revenue - cost;
    totalProfit12m += profit;
    totalRevenue12m += revenue;
    totalCost12m += cost;
    totalFees12m += sellFees + buyFees;
    if (buyMs > 0) {
      holdDaysSum += (sellMs - buyMs) / DAY_MS;
      holdDayCount += 1;
    }

    // Month bucket
    const sellMonthStart = monthStartMs(sellMs);
    const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
    const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
    if (bucketIdx >= 0 && bucketIdx <= 11) {
      months[bucketIdx]! += profit;
    }

    // Category
    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    categories.add(cat);
    const c = byCategory.get(cat) || { count: 0, profit: 0, revenue: 0, cost: 0 };
    c.count += 1;
    c.profit += profit;
    c.revenue += revenue;
    c.cost += cost;
    byCategory.set(cat, c);

    // Source (sell location)
    const src = (t.sellLocation || 'neznano').trim().toLowerCase() || 'neznano';
    const s = bySource.get(src) || { count: 0, profit: 0, revenue: 0, cost: 0 };
    s.count += 1;
    s.profit += profit;
    s.revenue += revenue;
    s.cost += cost;
    bySource.set(src, s);
  }

  return {
    soldTrades,
    heldTrades,
    heldListings,
    monthlyProfit: months,
    totalProfit12m,
    totalRevenue12m,
    totalCost12m,
    totalFees12m,
    avgProfitPerTrade: soldTrades.length > 0 ? totalProfit12m / soldTrades.length : 0,
    avgHoldDays: holdDayCount > 0 ? holdDaysSum / holdDayCount : 0,
    totalTrades: soldTrades.length,
    categories,
    byCategory,
    bySource,
  };
}

function buildPricingLever(ctx: LeverContext): Lever {
  // Pricing lever: potential profit from optimal pricing (sell at estValue vs current)
  // For HELD listings with estValue > buyPrice, compute the gap
  let gapSum = 0;
  let pricedBelowEst = 0;
  for (const l of ctx.heldListings) {
    const price = l.price ?? 0;
    const est = l.aiEstimatedValue ?? 0;
    if (est > 0 && price > 0 && est > price) {
      gapSum += est - price;
      pricedBelowEst += 1;
    }
  }
  // Annualized potential: scale to yearly turnover
  const annualTurnover = ctx.soldTrades.length; // trades/year
  const heldCount = ctx.heldListings.length;
  // Maximization potential: assume pricing lift applies to all annual trades
  const avgGapPerItem = pricedBelowEst > 0 ? gapSum / pricedBelowEst : 0;
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, avgGapPerItem * annualTurnover * 0.6)); // 60% capture rate
  const expectedProfitLift = round0(maximizationPotential * 0.8); // 80% realized
  const difficulty: LeverDifficulty = pricedBelowEst > 0 ? 'LOW' : 'MEDIUM';
  const requiredActions = pricedBelowEst > 0
    ? [
      `Povišaj cene na ${pricedBelowEst} itemsih, ki so pod estValue (povprečno ${round0(avgGapPerItem)}€/item pod ceno).`,
      'A/B test price increases v 5-10% korakih za optimizacijo konverzije.',
      'Spremljaj sell-through rate po price increase in adjust-aj če prehitro pada.',
    ]
    : [
      'Analiziraj competitor cene za vsako kategorijo.',
      'Testiraj 5-10% price increase na top-tier inventoriju.',
      'Optimiziraj pricing strategijo glede na demand Elasticity.',
    ];
  return {
    currentGap: round0(gapSum),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildTimingLever(ctx: LeverContext): Lever {
  // Timing lever: potential profit from optimal sell timing (seasonal, cycle)
  // Analyze monthly profit variance — if high variance, timing matters
  const activeMonths = ctx.monthlyProfit.filter((v) => v !== 0);
  const mean = avg(activeMonths);
  const variance = activeMonths.length > 0
    ? activeMonths.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / activeMonths.length
    : 0;
  const stdDev = Math.sqrt(variance);
  // Coefficient of variation
  const cv = mean !== 0 ? Math.abs(stdDev / mean) : 0;
  // High CV means timing matters — selling at right time can boost profit
  // Maximization potential: max(0, (max_month - avg_month)) × 12
  const maxMonth = activeMonths.length > 0 ? Math.max(...activeMonths) : 0;
  const liftPerMonth = Math.max(0, maxMonth - mean);
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, liftPerMonth * 6)); // 6 optimal-timed months/year
  const expectedProfitLift = round0(maximizationPotential * 0.6);
  const difficulty: LeverDifficulty = cv > 0.5 ? 'MEDIUM' : 'HIGH';
  const requiredActions = [
    `Analiziraj sezonske vzorce (CV=${round0(cv * 100)}%) — izkoriščaj peak mesece.`,
    'Postavi sezonski koledar za kategorije z visokim timing vplivom.',
    'Premakni listings v peak sezone za maksimalno ceno.',
  ];
  return {
    currentGap: round0(liftPerMonth * 12),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildBundleLever(ctx: LeverContext): Lever {
  // Bundle lever: potential profit from bundling complementary items
  // If many HELD items in same category, bundling opportunity is high
  const heldByCat = new Map<string, number>();
  for (const t of ctx.heldTrades) {
    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    heldByCat.set(cat, (heldByCat.get(cat) ?? 0) + 1);
  }
  let bundleOpps = 0;
  let bundlePotentialPer = 0;
  for (const [cat, count] of heldByCat) {
    if (count >= 3) {
      bundleOpps += Math.floor(count / 3);
      // Bundling typically adds 10-15% to combined value
      bundlePotentialPer += Math.floor(count / 3) * ctx.avgProfitPerTrade * 0.15;
    }
  }
  // Scale to annual (assume 4 bundle cycles/year)
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, bundlePotentialPer * 4));
  const expectedProfitLift = round0(maximizationPotential * 0.7);
  const difficulty: LeverDifficulty = bundleOpps > 0 ? 'LOW' : 'MEDIUM';
  const requiredActions = bundleOpps > 0
    ? [
      `Identificiraj ${bundleOpps} bundle priložnosti v kategorijah z ≥3 items.`,
      'Ponudi bundle popuste 5-10% za incentivizacijo multi-item nakupov.',
      'Cross-sell komplementarne iteme pri checkout-u.',
    ]
    : [
      'Gradi inventar z ≥3 items per kategorijo za bundle priložnosti.',
      'Testiraj bundle pricing strategije (10% off bundle, free shipping, itd.).',
      'Analiziraj katere kategorije se dobro dopolnjujejo.',
    ];
  return {
    currentGap: round0(bundlePotentialPer),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildSourcingLever(ctx: LeverContext): Lever {
  // Sourcing lever: potential profit from buying cheaper (better sources)
  // Compute avg buyPrice per category, identify categories with high buy price
  const buyByCat = new Map<string, { sum: number; count: number }>();
  for (const t of ctx.soldTrades) {
    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    const c = buyByCat.get(cat) || { sum: 0, count: 0 };
    c.sum += t.buyPrice + (t.buyFees ?? 0);
    c.count += 1;
    buyByCat.set(cat, c);
  }
  // If average buy cost > 50% of revenue, sourcing improvement has potential
  let sourcingGap = 0;
  for (const [cat, c] of buyByCat) {
    const avgBuy = c.count > 0 ? c.sum / c.count : 0;
    const catData = ctx.byCategory.get(cat);
    const avgRev = catData && catData.count > 0 ? catData.revenue / catData.count : 0;
    if (avgRev > 0 && avgBuy / avgRev > 0.5) {
      // Could potentially reduce buy cost by 10-15%
      sourcingGap += avgBuy * 0.12 * c.count;
    }
  }
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, sourcingGap));
  const expectedProfitLift = round0(maximizationPotential * 0.75);
  const difficulty: LeverDifficulty = 'MEDIUM';
  const requiredActions = [
    'Poišči ceneje nabavne vire (wholesale, spletni дроги, FB Marketplace).',
    'Pogajaj se z existing dobavitelji za boljše cene (10-15% popust).',
    'Diversificiraj nabavne vire za izboljšanje bargaining power.',
  ];
  return {
    currentGap: round0(sourcingGap),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildInventoryMixLever(ctx: LeverContext): Lever {
  // Inventory mix lever: potential profit from rebalancing inventory categories
  // Compare profit per trade per category — identify under-represented high-profit cats
  const catProfitPerTrade: Array<{ cat: string; profit: number; count: number }> = [];
  for (const [cat, data] of ctx.byCategory) {
    const ppt = data.count > 0 ? data.profit / data.count : 0;
    catProfitPerTrade.push({ cat, profit: ppt, count: data.count });
  }
  catProfitPerTrade.sort((a, b) => b.profit - a.profit);
  const topCats = catProfitPerTrade.slice(0, 3);
  const bottomCats = catProfitPerTrade.slice(-3);

  // Maximization: shift volume from low-profit to high-profit cats
  let mixLift = 0;
  if (topCats.length > 0 && bottomCats.length > 0) {
    const topAvg = avg(topCats.map((c) => c.profit));
    const bottomAvg = avg(bottomCats.map((c) => c.profit));
    const diff = topAvg - bottomAvg;
    // Assume we can shift 20% of bottom volume to top
    const bottomCount = bottomCats.reduce((s, c) => s + c.count, 0);
    mixLift = diff * bottomCount * 0.2;
  }
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, Math.max(0, mixLift)));
  const expectedProfitLift = round0(maximizationPotential * 0.65);
  const difficulty: LeverDifficulty = 'HIGH';
  const requiredActions = [
    'Premakni kapital v top-3 profit kategorije (zmanjšaj obseg v low-profit cats).',
    'Analiziraj zakaj top kategorije profitne — repliciraj vzorec.',
    'Postopno izstopi iz low-profit kategorij z majhnim potencialom.',
  ];
  return {
    currentGap: round0(Math.max(0, mixLift)),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildTurnoverLever(ctx: LeverContext): Lever {
  // Turnover lever: potential profit from faster turnover
  // If avg hold days is high, faster turnover means more cycles/year
  const avgHold = ctx.avgHoldDays;
  // Optimized hold time = 70% of current
  const optimizedHold = avgHold * 0.7;
  const cyclesPerYear = avgHold > 0 ? 365 / avgHold : 0;
  const optimizedCycles = optimizedHold > 0 ? 365 / optimizedHold : 0;
  const extraCycles = Math.max(0, optimizedCycles - cyclesPerYear);
  // Each extra cycle adds avgProfitPerTrade
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, extraCycles * ctx.avgProfitPerTrade));
  const expectedProfitLift = round0(maximizationPotential * 0.7);
  const difficulty: LeverDifficulty = avgHold > 60 ? 'MEDIUM' : 'HIGH';
  const requiredActions = [
    `Pospeši prodajo z boljšo pricing, marketing-om in optimiziranimi listings.`,
    'Identificiraj "stale" inventory (>60 dni) in liquidiraj s popusti.',
    'Optimiziraj listing kvaliteto (slike, opis) za hitrejšo konverzijo.',
  ];
  return {
    currentGap: round0(extraCycles * ctx.avgProfitPerTrade),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildFeeLever(ctx: LeverContext): Lever {
  // Fee lever: potential profit from fee optimization (platform selection)
  // If fees are high relative to revenue, switching platforms can help
  const totalFees = ctx.totalFees12m;
  const totalRev = ctx.totalRevenue12m;
  const feeRate = totalRev > 0 ? totalFees / totalRev : 0;
  // If feeRate > 8%, can potentially reduce by 30% via better platform selection
  const feeReduction = feeRate > 0.08 ? totalFees * 0.3 : totalFees * 0.1;
  const maximizationPotential = round0(Math.min(LIFT_MAX_EUR, feeReduction));
  const expectedProfitLift = round0(maximizationPotential * 0.85);
  const difficulty: LeverDifficulty = feeRate > 0.1 ? 'LOW' : 'MEDIUM';
  const requiredActions = [
    `Analiziraj fee rate (${round0(feeRate * 100)}%) in primerjaj platforme.`,
    'Premakni listings na platforme z nižjimi fees (Vinted 0% buyer fee, Bolha free listings).',
    'Optimiziraj listing timing za izogibanje premium/paid promotion fees.',
  ];
  return {
    currentGap: round0(feeReduction),
    maximizationPotential,
    difficulty,
    requiredActions: requiredActions.map((s) => s.slice(0, 200)),
    expectedProfitLift,
  };
}

function buildLevers(ctx: LeverContext): Levers {
  return {
    pricingLever: buildPricingLever(ctx),
    timingLever: buildTimingLever(ctx),
    bundleLever: buildBundleLever(ctx),
    sourcingLever: buildSourcingLever(ctx),
    inventoryMixLever: buildInventoryMixLever(ctx),
    turnoverLever: buildTurnoverLever(ctx),
    feeLever: buildFeeLever(ctx),
  };
}

function buildBaseline(ctx: LeverContext, levers: Levers): Baseline {
  const currentAnnualProfit = round0(ctx.totalProfit12m);
  const currentMonthlyAvg = round0(currentAnnualProfit / 12);
  // Maximized profit = current + sum of lever expected lifts (with diminishing returns)
  // Apply overlap factor: levers overlap so multiply by 0.85
  const totalLeverLift = LEVER_NAMES.reduce(
    (s, name) => s + levers[name].expectedProfitLift,
    0,
  );
  const adjustedLift = totalLeverLift * 0.85;
  // Clamp maximized to [current, current × 3]
  const maximizedAnnualProfit = round0(
    Math.max(currentAnnualProfit, Math.min(currentAnnualProfit * 3, currentAnnualProfit + adjustedLift)),
  );
  const profitUpliftEuros = round0(maximizedAnnualProfit - currentAnnualProfit);
  const profitUpliftPercent = currentAnnualProfit > 0
    ? round0(Math.max(UPLIFT_PERCENT_MIN, Math.min(UPLIFT_PERCENT_MAX, (profitUpliftEuros / currentAnnualProfit) * 100)))
    : 0;
  return {
    currentAnnualProfit,
    currentMonthlyAvg,
    maximizedAnnualProfit,
    profitUpliftPercent,
    profitUpliftEuros,
  };
}

// --- Deterministic plan -------------------------------------------------

function buildDeterministicPlan(
  levers: Levers,
  baseline: Baseline,
): { plan: Plan; projection: Projection } {
  // Build prioritized actions — sort by ROI (expectedProfitLift / effort weight)
  const effortWeight: Record<ActionEffort, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  const actions: PrioritizedAction[] = [];
  for (const name of LEVER_NAMES) {
    const lever = levers[name];
    for (const actionText of lever.requiredActions) {
      const effort: ActionEffort = lever.difficulty === 'LOW' ? 'LOW'
        : lever.difficulty === 'MEDIUM' ? 'MEDIUM'
          : 'HIGH';
      const expectedLift = round0(lever.expectedProfitLift / lever.requiredActions.length);
      const roi = round0(Math.max(ROI_MIN, Math.min(ROI_MAX, expectedLift / effortWeight[effort])));
      const priority: ActionPriority = expectedLift > 1000 ? 'CRITICAL'
        : expectedLift > 500 ? 'HIGH'
          : expectedLift > 200 ? 'MEDIUM'
            : 'LOW';
      const timeline = effort === 'LOW' ? '1-7 dni'
        : effort === 'MEDIUM' ? '2-4 tedne'
          : '1-3 mesece';
      actions.push({
        action: actionText,
        lever: name,
        priority,
        expectedProfitLift: expectedLift,
        effort,
        timeline,
        roi,
      });
    }
  }
  actions.sort((a, b) => {
    // Sort by ROI descending, then by expectedProfitLift descending
    if (b.roi !== a.roi) return b.roi - a.roi;
    return b.expectedProfitLift - a.expectedProfitLift;
  });

  // Quick wins: top 3 LOW-effort actions
  const quickWins: QuickWin[] = actions
    .filter((a) => a.effort === 'LOW')
    .slice(0, 3)
    .map((a) => ({
      action: a.action,
      expectedProfitLift: a.expectedProfitLift,
      timeline: a.timeline,
    }));

  // Medium-term: MEDIUM-effort actions
  const mediumTerm: MediumTermOptimization[] = actions
    .filter((a) => a.effort === 'MEDIUM')
    .slice(0, 3)
    .map((a) => ({
      action: a.action,
      expectedProfitLift: a.expectedProfitLift,
      timeline: a.timeline,
    }));

  // Long-term: HIGH-effort actions
  const longTerm: LongTermStrategy[] = actions
    .filter((a) => a.effort === 'HIGH')
    .slice(0, 3)
    .map((a) => ({
      action: a.action,
      expectedProfitLift: a.expectedProfitLift,
      timeline: a.timeline,
    }));

  // Fallback if any tier is empty
  if (quickWins.length === 0 && actions.length > 0) {
    for (const a of actions.slice(0, 3)) {
      quickWins.push({
        action: a.action,
        expectedProfitLift: a.expectedProfitLift,
        timeline: a.timeline,
      });
    }
  }
  if (mediumTerm.length === 0 && actions.length > 0) {
    for (const a of actions.slice(3, 6)) {
      mediumTerm.push({
        action: a.action,
        expectedProfitLift: a.expectedProfitLift,
        timeline: a.timeline,
      });
    }
  }
  if (longTerm.length === 0 && actions.length > 0) {
    for (const a of actions.slice(6, 9)) {
      longTerm.push({
        action: a.action,
        expectedProfitLift: a.expectedProfitLift,
        timeline: a.timeline,
      });
    }
  }

  // Projection: month-by-month for 12 months
  // currentProfit stays flat at currentMonthlyAvg
  // maximizedProfit ramps up as actions implemented (15% / month for 6 months, then flat)
  const projection: ProjectionPoint[] = [];
  const rampMonths = 6;
  const maxMonthly = baseline.maximizedAnnualProfit / 12;
  const currMonthly = baseline.currentMonthlyAvg;
  let cumulativeLift = 0;
  for (let m = 1; m <= MONTHS_12; m++) {
    const rampFactor = Math.min(1, m / rampMonths);
    const maxProfit = round0(currMonthly + (maxMonthly - currMonthly) * rampFactor);
    const lift = round0(maxProfit - currMonthly);
    cumulativeLift = round0(cumulativeLift + lift);
    projection.push({
      month: m,
      currentProfit: currMonthly,
      maximizedProfit: maxProfit,
      cumulativeLift,
    });
  }

  // Profit maximization score: 100 - (upliftPercent / 3 × 100) — higher uplift = lower score (more opportunity)
  const score = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, 100 - baseline.profitUpliftPercent / 3)),
  );

  // Risk tradeoffs
  const riskTradeoffs: RiskTradeoff[] = [
    {
      risk: 'Agresivno povišanje cen lahko zmanjša sell-through rate.',
      severity: 'MEDIUM',
      mitigation: 'A/B test v 5-10% korakih, spremljaj konverzijo.',
    },
    {
      risk: 'Premik v nove kategorije lahko zahteva learning curve.',
      severity: 'MEDIUM',
      mitigation: 'Start small (10% capital), testiraj 30 dni pred scale.',
    },
    {
      risk: 'Bundle pricing lahko zniža individual unit margin.',
      severity: 'LOW',
      mitigation: 'Postavi bundle popuste le za multi-item nakupe (>15% off).',
    },
  ];

  // Confidence
  const totalTrades = baseline.currentAnnualProfit > 0 ? 50 : 20;
  let confidence = 30;
  confidence += Math.min(25, totalTrades);
  confidence += Math.min(20, Math.min(50, ctx_totalTradesCounter(baseline)) * 0.4);
  if (baseline.profitUpliftPercent > 50) confidence -= 10; // aggressive projection = lower confidence
  confidence = round0(Math.max(CONF_MIN, Math.min(CONF_MAX, confidence)));

  return {
    plan: {
      prioritizedActions: actions.slice(0, 10),
      quickWins: quickWins.slice(0, 3),
      mediumTermOptimizations: mediumTerm.slice(0, 3),
      longTermStrategy: longTerm.slice(0, 3),
    },
    projection: {
      profitMaximizationScore: score,
      maximizedProfitProjection: projection,
      riskTradeoffs,
      confidenceLevel: confidence,
    },
  };
}

// Simple helper used by buildDeterministicPlan to estimate sample size
function ctx_totalTradesCounter(baseline: Baseline): number {
  return baseline.currentMonthlyAvg > 0 ? Math.max(10, baseline.currentMonthlyAvg / 10) : 10;
}

function buildSummary(
  baseline: Baseline,
  levers: Levers,
  plan: Plan,
  projection: Projection,
): string {
  const topLever = LEVER_NAMES
    .map((name) => ({ name, lift: levers[name].expectedProfitLift }))
    .sort((a, b) => b.lift - a.lift)[0];
  const topLeverLabel = topLever ? topLever.name.replace('Lever', '') : 'pricing';
  const quickWin = plan.quickWins[0];
  const parts: string[] = [
    `Annual profit: ${baseline.currentAnnualProfit}€ → maximized ${baseline.maximizedAnnualProfit}€ (+${baseline.profitUpliftPercent}% uplift).`,
  ];
  if (quickWin) {
    parts.push(`Quick win: ${quickWin.action.slice(0, 80)} → +${quickWin.expectedProfitLift}€/${quickWin.timeline}.`);
  }
  if (topLever) {
    parts.push(`Lever #1: ${topLeverLabel} (+${topLever!.lift}€/yr).`);
  }
  parts.push(`Score: ${projection.profitMaximizationScore}/100, confidence ${projection.confidenceLevel}/100.`);
  return parts.join(' ').slice(0, 400);
}

// --- Prompt + AI response sanitization (anti-hallucination overrides) -----

interface PromptData {
  baseline: Baseline;
  levers: Levers;
  deterministicBaseline: { plan: Plan; projection: Projection };
  caps: Record<string, number>;
}

function buildPromptData(
  baseline: Baseline,
  levers: Levers,
  det: { plan: Plan; projection: Projection },
): PromptData {
  return {
    baseline,
    levers,
    deterministicBaseline: det,
    caps: {
      scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      liftMinEur: LIFT_MIN_EUR, liftMaxEur: LIFT_MAX_EUR,
      roiMin: ROI_MIN, roiMax: ROI_MAX,
      confMin: CONF_MIN, confMax: CONF_MAX,
    },
  };
}

function buildPrompt(promptData: PromptData): string {
  return `Si AI "Profit Maximizer Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si ULTIMATIVNI profit maximization engine — kombiniraš VSE profit levers (pricing, timing, bundling, sourcing, inventory mix, turnover, fees) v en sam AI-driven profit maximization plan. Razlika od profit-maximizer (basic sell price optimization) — ti si COMPREHENSIVE engine z 7 levers in quick wins. Razlika od profit-maximizer-v2 (v7.56 ki dela ML compounding projections) — ti identificiraš KATERE levers so na voljo in kaj prinesejo.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD + HELD trgovin + aktivnih listings):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. plan.prioritizedActions: 5-10 akcij, ranked po ROI { action (max 200 chars), lever (eno od: pricingLever|timingLever|bundleLever|sourcingLever|inventoryMixLever|turnoverLever|feeLever), priority CRITICAL|HIGH|MEDIUM|LOW, expectedProfitLift EUR [0, 500000], effort LOW|MEDIUM|HIGH, timeline (max 50 chars), roi 0-100 }.
2. plan.quickWins: 3 akcije, ki jih lahko narediš DANES za immediate profit { action (max 200), expectedProfitLift EUR, timeline (max 50) }.
3. plan.mediumTermOptimizations: 3 akcije za naslednje 30 dni { action, expectedProfitLift, timeline }.
4. plan.longTermStrategy: 3 strukturne spremembe za sustained profit maximization { action, expectedProfitLift, timeline }.
5. projection.profitMaximizationScore: 0-100 (kako dobro je profit trenutno maximiziran — višji = bolje).
6. projection.maximizedProfitProjection: 12 mesecev { month 1-12, currentProfit EUR, maximizedProfit EUR, cumulativeLift EUR } — ramp up 6 mesecev do max.
7. projection.riskTradeoffs: 2-3 tveganja agresivne maximization { risk (max 200), severity LOW|MEDIUM|HIGH, mitigation (max 200) }.
8. projection.confidenceLevel: 0-100, ±10 od deterministic.
9. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministic baseline.

VRNI LE JSON:
{
  "plan": {
    "prioritizedActions": [
      { "action": "Povišaj cene na 12 itemsih pod estValue.", "lever": "pricingLever", "priority": "CRITICAL", "expectedProfitLift": 1500, "effort": "LOW", "timeline": "1-7 dni", "roi": 75 }
    ],
    "quickWins": [
      { "action": "Povišaj cene na 3 top itemsih.", "expectedProfitLift": 150, "timeline": "1-7 dni" }
    ],
    "mediumTermOptimizations": [
      { "action": "Postavi sezonski koledar.", "expectedProfitLift": 400, "timeline": "2-4 tedne" }
    ],
    "longTermStrategy": [
      { "action": "Premakni kapital v top-3 profit kategorije.", "expectedProfitLift": 2000, "timeline": "1-3 mesece" }
    ]
  },
  "projection": {
    "profitMaximizationScore": 62,
    "maximizedProfitProjection": [
      { "month": 1, "currentProfit": 1000, "maximizedProfit": 1100, "cumulativeLift": 100 }
    ],
    "riskTradeoffs": [
      { "risk": "Agresivno povišanje cen lahko zmanjša sell-through rate.", "severity": "MEDIUM", "mitigation": "A/B test v 5-10% korakih." }
    ],
    "confidenceLevel": 72
  },
  "summary": "Annual profit: 12000€ → maximized 21000€ (+75% uplift). Quick win: raise elektronika prices 5% → +150€/mo. Lever #1: pricing (+3200€/yr)."
}${GROUNDING_PROMPT_SUFFIX}`;
}

function mergeAiIntoResponse(
  parsed: AiProfitMaxResponse | null,
  det: { plan: Plan; projection: Projection },
  baseline: Baseline,
  levers: Levers,
): { plan: Plan; projection: Projection; summary: string; aiUsed: boolean } {
  let plan = det.plan;
  let projection = det.projection;
  let summary = buildSummary(baseline, levers, plan, projection);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Parse prioritized actions
    const prioritizedActions: PrioritizedAction[] = [];
    if (parsed.plan?.prioritizedActions && Array.isArray(parsed.plan.prioritizedActions)) {
      for (const a of parsed.plan.prioritizedActions.slice(0, 10)) {
        if (!a || typeof a !== 'object') continue;
        const leverName = LEVER_NAMES.includes(a.lever as unknown as LeverName) ? (a.lever as unknown as LeverName) : 'pricingLever';
        const leverData = levers[leverName];
        const effort = clampEnum(a.effort, VALID_EFFORT, leverData.difficulty === 'LOW' ? 'LOW' : leverData.difficulty === 'MEDIUM' ? 'MEDIUM' : 'HIGH');
        const expectedLift = round0(clampNum(a.expectedProfitLift, LIFT_MIN_EUR, LIFT_MAX_EUR, leverData.expectedProfitLift / Math.max(1, leverData.requiredActions.length)));
        const roi = round0(clampNum(a.roi, ROI_MIN, ROI_MAX, 50));
        const priority: ActionPriority = clampEnum(a.priority, VALID_PRIORITY, expectedLift > 1000 ? 'CRITICAL' : expectedLift > 500 ? 'HIGH' : expectedLift > 200 ? 'MEDIUM' : 'LOW');
        const timeline = clampString(a.timeline, 50, effort === 'LOW' ? '1-7 dni' : effort === 'MEDIUM' ? '2-4 tedne' : '1-3 mesece');
        prioritizedActions.push({
          action: clampString(a.action, 200, leverData.requiredActions[0] ?? 'Optimiziraj profit strategijo.'),
          lever: leverName,
          priority,
          expectedProfitLift: expectedLift,
          effort,
          timeline,
          roi,
        });
      }
    }
    if (prioritizedActions.length === 0) {
      for (const a of det.plan.prioritizedActions) prioritizedActions.push(a);
    }

    // Quick wins
    const quickWins: QuickWin[] = [];
    if (parsed.plan?.quickWins && Array.isArray(parsed.plan.quickWins)) {
      for (const q of parsed.plan.quickWins.slice(0, 3)) {
        if (!q || typeof q !== 'object') continue;
        quickWins.push({
          action: clampString(q.action, 200, det.plan.quickWins[0]?.action ?? 'Optimiziraj pricing danes.'),
          expectedProfitLift: round0(clampNum(q.expectedProfitLift, LIFT_MIN_EUR, LIFT_MAX_EUR, det.plan.quickWins[0]?.expectedProfitLift ?? 100)),
          timeline: clampString(q.timeline, 50, '1-7 dni'),
        });
      }
    }
    if (quickWins.length === 0) {
      for (const q of det.plan.quickWins) quickWins.push(q);
    }

    // Medium-term
    const mediumTerm: MediumTermOptimization[] = [];
    if (parsed.plan?.mediumTermOptimizations && Array.isArray(parsed.plan.mediumTermOptimizations)) {
      for (const m of parsed.plan.mediumTermOptimizations.slice(0, 3)) {
        if (!m || typeof m !== 'object') continue;
        mediumTerm.push({
          action: clampString(m.action, 200, det.plan.mediumTermOptimizations[0]?.action ?? 'Optimiziraj v 30 dneh.'),
          expectedProfitLift: round0(clampNum(m.expectedProfitLift, LIFT_MIN_EUR, LIFT_MAX_EUR, det.plan.mediumTermOptimizations[0]?.expectedProfitLift ?? 300)),
          timeline: clampString(m.timeline, 50, '2-4 tedne'),
        });
      }
    }
    if (mediumTerm.length === 0) {
      for (const m of det.plan.mediumTermOptimizations) mediumTerm.push(m);
    }

    // Long-term
    const longTerm: LongTermStrategy[] = [];
    if (parsed.plan?.longTermStrategy && Array.isArray(parsed.plan.longTermStrategy)) {
      for (const l of parsed.plan.longTermStrategy.slice(0, 3)) {
        if (!l || typeof l !== 'object') continue;
        longTerm.push({
          action: clampString(l.action, 200, det.plan.longTermStrategy[0]?.action ?? 'Strateška sprememba v 1-3 mesecih.'),
          expectedProfitLift: round0(clampNum(l.expectedProfitLift, LIFT_MIN_EUR, LIFT_MAX_EUR, det.plan.longTermStrategy[0]?.expectedProfitLift ?? 1000)),
          timeline: clampString(l.timeline, 50, '1-3 mesece'),
        });
      }
    }
    if (longTerm.length === 0) {
      for (const l of det.plan.longTermStrategy) longTerm.push(l);
    }

    plan = {
      prioritizedActions: prioritizedActions.slice(0, 10),
      quickWins: quickWins.slice(0, 3),
      mediumTermOptimizations: mediumTerm.slice(0, 3),
      longTermStrategy: longTerm.slice(0, 3),
    };

    // Projection
    const detScore = det.projection.profitMaximizationScore;
    const profitMaximizationScore = round0(
      Math.max(SCORE_MIN, Math.min(SCORE_MAX,
        detScore + Math.max(-10, Math.min(10,
          (Number(parsed.projection?.profitMaximizationScore ?? detScore)) - detScore)))),
    );

    const detConf = det.projection.confidenceLevel;
    const confidenceLevel = round0(
      Math.max(CONF_MIN, Math.min(CONF_MAX,
        detConf + Math.max(-10, Math.min(10,
          (Number(parsed.projection?.confidenceLevel ?? detConf)) - detConf)))),
    );

    // Projection points
    const maximizedProfitProjection: ProjectionPoint[] = [];
    if (parsed.projection?.maximizedProfitProjection && Array.isArray(parsed.projection.maximizedProfitProjection)) {
      let cumLift = 0;
      for (let i = 0; i < MONTHS_12; i++) {
        const aiPoint = parsed.projection.maximizedProfitProjection[i];
        const detPoint = det.projection.maximizedProfitProjection[i]!;
        const month = i + 1;
        const currentProfit = round0(clampNum(aiPoint?.currentProfit, 0, LIFT_MAX_EUR, detPoint.currentProfit));
        // Clamp maximized to [current, current × 3] anti-hallucination
        const maxAllowed = currentProfit * 3;
        const maximizedProfit = round0(
          Math.max(currentProfit, Math.min(maxAllowed, clampNum(aiPoint?.maximizedProfit, 0, LIFT_MAX_EUR, detPoint.maximizedProfit))),
        );
        const lift = round0(maximizedProfit - currentProfit);
        cumLift = round0(cumLift + lift);
        maximizedProfitProjection.push({
          month,
          currentProfit,
          maximizedProfit,
          cumulativeLift: cumLift,
        });
      }
    }
    if (maximizedProfitProjection.length === 0) {
      for (const p of det.projection.maximizedProfitProjection) maximizedProfitProjection.push(p);
    }

    // Risk tradeoffs
    const riskTradeoffs: RiskTradeoff[] = [];
    if (parsed.projection?.riskTradeoffs && Array.isArray(parsed.projection.riskTradeoffs)) {
      for (const r of parsed.projection.riskTradeoffs.slice(0, 3)) {
        if (!r || typeof r !== 'object') continue;
        riskTradeoffs.push({
          risk: clampString(r.risk, 200, det.projection.riskTradeoffs[0]?.risk ?? 'Tveganje agresivne maximization.'),
          severity: clampEnum(r.severity, VALID_SEVERITY, det.projection.riskTradeoffs[0]?.severity ?? 'MEDIUM'),
          mitigation: clampString(r.mitigation, 200, det.projection.riskTradeoffs[0]?.mitigation ?? 'Testiraj postopoma.'),
        });
      }
    }
    if (riskTradeoffs.length === 0) {
      for (const r of det.projection.riskTradeoffs) riskTradeoffs.push(r);
    }

    projection = {
      profitMaximizationScore,
      maximizedProfitProjection,
      riskTradeoffs,
      confidenceLevel,
    };
    summary = clampString(parsed.summary, 400, buildSummary(baseline, levers, plan, projection));
    aiUsed = true;
  }

  return { plan, projection, summary, aiUsed };
}

// --- Empty-state response ------------------------------------------------

function buildEmptyStateResponse(): {
  ok: true;
  baseline: Baseline;
  levers: Levers;
  plan: Plan;
  projection: Projection;
  summary: string;
  aiUsed: boolean;
  message: string;
} {
  const emptyLevers: Levers = {
    pricingLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
    timingLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
    bundleLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
    sourcingLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
    inventoryMixLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
    turnoverLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
    feeLever: { currentGap: 0, maximizationPotential: 0, difficulty: 'LOW', requiredActions: [], expectedProfitLift: 0 },
  };
  const emptyBaseline: Baseline = {
    currentAnnualProfit: 0,
    currentMonthlyAvg: 0,
    maximizedAnnualProfit: 0,
    profitUpliftPercent: 0,
    profitUpliftEuros: 0,
  };
  return {
    ok: true,
    baseline: emptyBaseline,
    levers: emptyLevers,
    plan: {
      prioritizedActions: [],
      quickWins: [],
      mediumTermOptimizations: [],
      longTermStrategy: [],
    },
    projection: {
      profitMaximizationScore: 0,
      maximizedProfitProjection: [],
      riskTradeoffs: [],
      confidenceLevel: 0,
    },
    summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Maximizer Pro ni mogoč.',
    aiUsed: false,
    message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Maximizer Pro ni mogoč.',
  };
}

// --- Route handler -------------------------------------------------------

export const profitMaximizerProHandler = withAiRoute<ProfitMaximizerProInput>({
  endpoint: '/api/ai/profit-maximizer-pro',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // GET+POST dual-handler — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        sellLocation: true,
        category: true,
        listingId: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // 2) Query all HELD trades (current inventory)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        category: true,
      },
      take: 100000,
    }) as unknown as HeldTradeRow[];

    // 3) Query all active HELD listings for pricing lever analysis
    const heldListings = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        price: true,
        aiEstimatedValue: true,
        aiScore: true,
        aiRisk: true,
        dealScore: true,
        aiVerdict: true,
        monitor: { select: { tags: true } },
      },
      take: 5000,
    }) as unknown as HeldListingRow[];

    // Empty state: no SOLD trades in last 12 months
    if (soldTrades.length === 0) {
      return apiOk(buildEmptyStateResponse());
    }

    // 4) Compute lever context
    const ctxLever = computeLeverContext(soldTrades, heldTrades, heldListings, now);

    // 5) Build levers
    const levers = buildLevers(ctxLever);

    // 6) Build baseline
    const baseline = buildBaseline(ctxLever, levers);

    // 7) Build deterministic plan + projection (fallback)
    const det = buildDeterministicPlan(levers, baseline);
    let plan = det.plan;
    let projection = det.projection;
    let summary = buildSummary(baseline, levers, plan, projection);

    // 8) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `profit-maximizer-pro:${currentMonth}`;
    const cached = getCachedAI<{ plan: Plan; projection: Projection; summary: string }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        baseline,
        levers,
        plan: cached.plan,
        projection: cached.projection,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 9) AI prompt with grounding
    const promptData = buildPromptData(baseline, levers, det);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiProfitMaxResponse | null;

      const merged = mergeAiIntoResponse(parsed, det, baseline, levers);
      plan = merged.plan;
      projection = merged.projection;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/profit-maximizer-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 10) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { plan, projection, summary });
    }

    return apiOk({
      ok: true,
      baseline,
      levers,
      plan,
      projection,
      summary,
      aiUsed,
    });
  },
});

export const GET = profitMaximizerProHandler;
export const POST = profitMaximizerProHandler;
