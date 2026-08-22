// v8.06 / v8.96.6-batch1: AI Revenue Per Trade Maximizer — AI MAXIMIZIRA REVENUE per individual
// trade (top-line sell price per deal, ne profit-after-costs). "Tvoj avg
// sell price je 180€, z 6 revenue akcijami bi lahko bil 245€ — multiplier 1.36x
// in 17800€ več portfolio revenue na leto." Razlika od
// deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira PROFIT per trade
// € po odštevanju costov) — ta MAKSIMIZIRA REVENUE per trade (top-line sell
// price). Razlika od profit-per-trade-maximizer (v8.03 ki maksimizira profit
// per trade €) — ta maksimizira SELL PRICE / top-line revenue per trade, ne
// bottom-line profit. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira
// growth rate revenue) — ta maksimizira REVENUE PER TRADE (avg sell price),
// ne growth rate. Razlika od revenue-stream-optimizer (v7.96 ki optimizira
// multiple revenue streams) — ta fokusira na enoto — REVENUE PER TRADE.
// Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding
// reinvest rate) — ta maksimizira REVENUE PER TRADE z revenueMaximizationActions
// in revenueMultiplier. Razlika od profit-acceleration-maximizer (v8.05 ki
// maksimizira growth rate acceleration) — ta maksimizira REVENUE PER TRADE
// (avg sell price per deal), ne growth rate. Razlika od
// inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield)
// — ta maksimizira REVENUE PER TRADE (per-deal top-line) z revenueGrade in
// bestRevenueCategory. Razlika od pricing-strategy engine (v7.70 ki daje
// pricing recommendations) — ta MAXIMIZIRA REVENUE per trade z
// portfolioRevenueProjection in pricingStrategyAdvice.
//
// GET+POST /api/ai/revenue-per-trade-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RevenuePerTradeInput {}

// --- Types ---------------------------------------------------------------

type RevenueGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

type RevenueAction =
  | 'INCREASE_SELL_PRICE'
  | 'IMPROVE_LISTING_QUALITY'
  | 'TARGET_PREMIUM_BUYERS'
  | 'TIMING_THE_SALE'
  | 'CROSS_PLATFORM_PREMIUM';

type Difficulty = 'LOW' | 'MEDIUM' | 'HIGH';

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface CurrentState {
  avgRevenuePerTrade: number; // € = avg(sellPrice)
  avgSellPrice: number; // € (same as avgRevenue, before fees)
  avgSellFees: number; // €
  avgNetRevenue: number; // € = avgSellPrice - avgSellFees
  avgBuyPrice: number; // €
  avgMarkup: number; // ratio = avgNetRevenue / avgBuyPrice
  revenuePerTradeTrend: number; // % (slope of revenue per trade over time, positive = improving)
  soldCount12m: number;
}

interface RevenueActionItem {
  action: RevenueAction;
  expectedRevenueGain: number; // % uplift in revenue per trade
  difficulty: Difficulty;
  implementation: string;
}

interface RevenueMaximization {
  revenueMaximizationActions: RevenueActionItem[];
  maximizedRevenuePerTrade: number; // € projected with actions
  revenueUpliftPerTrade: number; // € improvement per trade
  revenueMultiplier: number; // ratio maximized / current
  portfolioRevenueProjection: number; // € annual revenue if all trades at maximized revenue
  revenueGrade: RevenueGrade;
  bestRevenueCategory: string;
  pricingStrategyAdvice: string;
}

interface RevenuePerTradeResponse {
  ok: true;
  current: CurrentState;
  maximization: RevenueMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  revenueMaximizationActions?: Array<{
    action?: RevenueAction;
    expectedRevenueGain?: number;
    difficulty?: Difficulty;
    implementation?: string;
  }>;
  maximizedRevenuePerTrade?: number;
  revenueUpliftPerTrade?: number;
  revenueMultiplier?: number;
  portfolioRevenueProjection?: number;
  revenueGrade?: RevenueGrade;
  bestRevenueCategory?: string;
  pricingStrategyAdvice?: string;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const REVENUE_MIN = 0;
const REVENUE_MAX = 50_000;
const SELL_PRICE_MIN = 0;
const SELL_PRICE_MAX = 50_000;
const FEES_MIN = 0;
const FEES_MAX = 5_000;
const BUY_MIN = 0;
const BUY_MAX = 50_000;
const MARKUP_MIN = 0;
const MARKUP_MAX = 20; // 20× = 2000% net markup
const TREND_MIN = -100;
const TREND_MAX = 200;
const MULTIPLIER_MIN = 1.0;
const MULTIPLIER_MAX = 3.0;
const UPLIFT_PCT_MIN = 0;
const UPLIFT_PCT_MAX = 200;
const PORTFOLIO_MIN = 0;
const PORTFOLIO_MAX = 2_000_000;

const VALID_GRADE: readonly RevenueGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_ACTION: readonly RevenueAction[] = [
  'INCREASE_SELL_PRICE',
  'IMPROVE_LISTING_QUALITY',
  'TARGET_PREMIUM_BUYERS',
  'TIMING_THE_SALE',
  'CROSS_PLATFORM_PREMIUM',
];
const VALID_DIFFICULTY: readonly Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];

const MAX_ACTIONS = 6;
const MAX_TRADES_FOR_AI = 250;

const ACTION_UPLIFT: Record<RevenueAction, number> = {
  INCREASE_SELL_PRICE: 18,
  IMPROVE_LISTING_QUALITY: 14,
  TARGET_PREMIUM_BUYERS: 22,
  TIMING_THE_SALE: 10,
  CROSS_PLATFORM_PREMIUM: 16,
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
  sellPrice: number;
  sellFees: number;
  buyPrice: number;
  netRevenue: number;
  markup: number;
  sellMs: number;
  category: string;
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
  const sellFees = t.sellFees ?? 0;
  const netRevenue = sellPrice - sellFees;
  const markup = buyPrice > 0 ? netRevenue / buyPrice : 0;
  const category = clampString(t.category, 60, 'drugo');
  return { sellPrice, sellFees, buyPrice, netRevenue, markup, sellMs, category, within12m };
}

function computeCurrent(trades: SoldComputed[]): CurrentState {
  if (trades.length === 0) {
    return {
      avgRevenuePerTrade: 0,
      avgSellPrice: 0,
      avgSellFees: 0,
      avgNetRevenue: 0,
      avgBuyPrice: 0,
      avgMarkup: 0,
      revenuePerTradeTrend: 0,
      soldCount12m: 0,
    };
  }

  const n = trades.length;
  let sumSellPrice = 0;
  let sumSellFees = 0;
  let sumBuyPrice = 0;
  let sumNetRevenue = 0;
  for (const t of trades) {
    sumSellPrice += t.sellPrice;
    sumSellFees += t.sellFees;
    sumBuyPrice += t.buyPrice;
    sumNetRevenue += t.netRevenue;
  }

  const avgSellPrice = round0(clampNum(
    sumSellPrice / n, SELL_PRICE_MIN, SELL_PRICE_MAX, 0,
  ));
  const avgSellFees = round0(clampNum(
    sumSellFees / n, FEES_MIN, FEES_MAX, 0,
  ));
  const avgNetRevenue = round0(clampNum(
    sumNetRevenue / n, REVENUE_MIN, REVENUE_MAX, 0,
  ));
  const avgBuyPrice = round0(clampNum(
    sumBuyPrice / n, BUY_MIN, BUY_MAX, 0,
  ));
  const avgMarkup = round2(clampNum(
    avgBuyPrice > 0 ? avgNetRevenue / avgBuyPrice : 0,
    MARKUP_MIN, MARKUP_MAX, 0,
  ));

  // Trend: split sorted trades into 2 halves (by sell time), compute avg revenue
  // per trade in each, then trend% = (recent - older) / older × 100
  let revenuePerTradeTrend = 0;
  if (n >= 4) {
    const sorted = [...trades].sort((a, b) => a.sellMs - b.sellMs);
    const mid = Math.floor(n / 2);
    const older = sorted.slice(0, mid);
    const recent = sorted.slice(mid);
    const olderAvg = older.reduce((s, t) => s + t.sellPrice, 0) / older.length;
    const recentAvg = recent.reduce((s, t) => s + t.sellPrice, 0) / recent.length;
    if (olderAvg > 0) {
      revenuePerTradeTrend = round2(clampNum(
        ((recentAvg - olderAvg) / olderAvg) * 100,
        TREND_MIN, TREND_MAX, 0,
      ));
    }
  }

  return {
    avgRevenuePerTrade: avgSellPrice,
    avgSellPrice,
    avgSellFees,
    avgNetRevenue,
    avgBuyPrice,
    avgMarkup,
    revenuePerTradeTrend,
    soldCount12m: n,
  };
}

function computeBestRevenueCategory(trades: SoldComputed[]): string {
  if (trades.length === 0) return 'drugo';
  const catMap = new Map<string, { sum: number; count: number }>();
  for (const t of trades) {
    const e = catMap.get(t.category);
    if (e) {
      e.sum += t.sellPrice;
      e.count += 1;
    } else {
      catMap.set(t.category, { sum: t.sellPrice, count: 1 });
    }
  }
  let bestCat = 'drugo';
  let bestAvg = -Infinity;
  for (const [cat, agg] of catMap.entries()) {
    if (agg.count < 1) continue;
    const avg = agg.sum / agg.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestCat = cat;
    }
  }
  return bestCat.slice(0, 60);
}

// --- Deterministic maximization -----------------------------------------

function buildRevenueActions(current: CurrentState): RevenueActionItem[] {
  const actions: RevenueActionItem[] = [];
  // 1) TARGET_PREMIUM_BUYERS — highest revenue gain
  actions.push({
    action: 'TARGET_PREMIUM_BUYERS',
    expectedRevenueGain: round2(clampNum(
      ACTION_UPLIFT.TARGET_PREMIUM_BUYERS - (current.avgMarkup > 1.5 ? 4 : 0),
      UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 10,
    )),
    difficulty: 'MEDIUM',
    implementation: 'Ciljaj premium kupce z izboljšano fotografijo, garancijo, hitro dostavo in premium pozicioniranjem oglasa (naslov, opis, tag-i).',
  });

  // 2) INCREASE_SELL_PRICE
  actions.push({
    action: 'INCREASE_SELL_PRICE',
    expectedRevenueGain: round2(clampNum(
      ACTION_UPLIFT.INCREASE_SELL_PRICE + (current.revenuePerTradeTrend < 0 ? 4 : 0),
      UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 10,
    )),
    difficulty: 'LOW',
    implementation: 'Dvigaj ask price za 12-18% z AI pricing engine — spremljaj conv. rate in po potrebi A/B testiraj.',
  });

  // 3) IMPROVE_LISTING_QUALITY
  actions.push({
    action: 'IMPROVE_LISTING_QUALITY',
    expectedRevenueGain: round2(clampNum(
      ACTION_UPLIFT.IMPROVE_LISTING_QUALITY,
      UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 8,
    )),
    difficulty: 'MEDIUM',
    implementation: 'Restavriraj oglas (naslov, opis, fotografije) za premium pozicioniranje — VLM photo analysis in SEO-optimized naslov.',
  });

  // 4) CROSS_PLATFORM_PREMIUM
  actions.push({
    action: 'CROSS_PLATFORM_PREMIUM',
    expectedRevenueGain: round2(clampNum(
      ACTION_UPLIFT.CROSS_PLATFORM_PREMIUM,
      UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 8,
    )),
    difficulty: 'MEDIUM',
    implementation: 'Postavi oglas na 2-3 platforme hkrati z različnimi premium cenami (Bolha premium, Vinted+, mobile.de Top insertion).',
  });

  // 5) TIMING_THE_SALE
  actions.push({
    action: 'TIMING_THE_SALE',
    expectedRevenueGain: round2(clampNum(
      ACTION_UPLIFT.TIMING_THE_SALE,
      UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 6,
    )),
    difficulty: 'LOW',
    implementation: 'Objavi v peak urah (18-21h) in vikendih — AI listing scheduler optimizira za max views in conversion.',
  });

  // 6) Second pass on TARGET_PREMIUM_BUYERS via repricing — INCREASE_SELL_PRICE covered above.
  // Replace #6 with a focused bundle/premium action.
  actions.push({
    action: 'TARGET_PREMIUM_BUYERS',
    expectedRevenueGain: round2(clampNum(
      Math.max(8, ACTION_UPLIFT.TARGET_PREMIUM_BUYERS - 6),
      UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 8,
    )),
    difficulty: 'HIGH',
    implementation: 'Vzpostavi repeat-buyer CRM za premium segment (top 20% kupcev) z ekskluzivnimi pred-ponudbami in 1:1 komunikacijo.',
  });

  return actions.slice(0, MAX_ACTIONS);
}

function computeMaximizedRevenue(current: CurrentState, actions: RevenueActionItem[]): {
  maximizedRevenuePerTrade: number;
  revenueUpliftPerTrade: number;
  revenueMultiplier: number;
} {
  // Top-3 actions compound (with diminishing returns)
  const sortedActions = [...actions].sort((a, b) => b.expectedRevenueGain - a.expectedRevenueGain);
  const top3 = sortedActions.slice(0, 3);
  const baseUplift = top3.reduce((s, a) => s + a.expectedRevenueGain, 0);
  // Diminishing returns: total uplift = base × 0.7 (top-3 do not perfectly stack)
  const compoundedUpliftPct = round2(clampNum(
    baseUplift * 0.7, UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 0,
  ));
  const maximizedRevenuePerTrade = round0(clampNum(
    current.avgRevenuePerTrade * (1 + compoundedUpliftPct / 100),
    REVENUE_MIN, REVENUE_MAX, current.avgRevenuePerTrade,
  ));
  const revenueUpliftPerTrade = round0(clampNum(
    maximizedRevenuePerTrade - current.avgRevenuePerTrade,
    0, REVENUE_MAX, 0,
  ));
  const revenueMultiplier = round2(clampNum(
    current.avgRevenuePerTrade > 0
      ? maximizedRevenuePerTrade / current.avgRevenuePerTrade
      : 1.0,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 1.0,
  ));
  return { maximizedRevenuePerTrade, revenueUpliftPerTrade, revenueMultiplier };
}

function computePortfolioRevenueProjection(
  current: CurrentState,
  maximizedRevenuePerTrade: number,
): number {
  // Annualized revenue projection = maximizedRevenuePerTrade × annualizedTradeCount
  // annualizedTradeCount = soldCount12m (we assume similar trade velocity)
  const annualTradeCount = current.soldCount12m;
  const projected = round0(clampNum(
    maximizedRevenuePerTrade * annualTradeCount,
    PORTFOLIO_MIN, PORTFOLIO_MAX, 0,
  ));
  return projected;
}

function decideRevenueGrade(
  multiplier: number,
  upliftPct: number,
): RevenueGrade {
  // A+ if multiplier ≥ 1.6 or uplift ≥ 50%
  // A if multiplier ≥ 1.4 or uplift ≥ 35%
  // B if multiplier ≥ 1.25 or uplift ≥ 20%
  // C if multiplier ≥ 1.15 or uplift ≥ 12%
  // D if multiplier ≥ 1.05 or uplift ≥ 5%
  // else F
  if (multiplier >= 1.6 || upliftPct >= 50) return 'A+';
  if (multiplier >= 1.4 || upliftPct >= 35) return 'A';
  if (multiplier >= 1.25 || upliftPct >= 20) return 'B';
  if (multiplier >= 1.15 || upliftPct >= 12) return 'C';
  if (multiplier >= 1.05 || upliftPct >= 5) return 'D';
  return 'F';
}

function buildPricingStrategyAdvice(
  current: CurrentState,
  bestRevenueCategory: string,
): string {
  const advice = `Pricing strategija: trenutna avg sell ${current.avgSellPrice}€ (markup ${round2(current.avgMarkup)}×). ` +
    `Ciljaj premium pricing v kategoriji "${bestRevenueCategory}" z 12-18% višjim ask price ` +
    `in AI A/B testingom (test 10-15% vzorca prvih 14 dni). ` +
    `Cross-platform premium listings na Bolha+Vinted+mobile.de z različnimi cenami ` +
    `(Bolha premium: +15%, Vinted+: +8%, mobile.de Top: +20%). ` +
    `Premium kupci (top 20%) plačajo 22% več — vzpostavi buyer CRM.`;
  return advice.slice(0, 400);
}

function buildSummary(
  current: CurrentState,
  max: RevenueMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.avgRevenuePerTrade}€/trade, markup ${round2(current.avgMarkup)}×, trend ${round2(current.revenuePerTradeTrend)}%.`,
    `Maximized: ${max.maximizedRevenuePerTrade}€/trade (multiplier ${round2(max.revenueMultiplier)}×, grade ${max.revenueGrade}).`,
    `Uplift: +${max.revenueUpliftPerTrade}€/trade → portfolio ${max.portfolioRevenueProjection}€/leto.`,
  ];
  return parts.join(' ').slice(0, 400);
}

function buildDeterministicMaximization(
  current: CurrentState,
  trades: SoldComputed[],
): RevenueMaximization {
  const revenueMaximizationActions = buildRevenueActions(current);
  const { maximizedRevenuePerTrade, revenueUpliftPerTrade, revenueMultiplier } =
    computeMaximizedRevenue(current, revenueMaximizationActions);
  const portfolioRevenueProjection = computePortfolioRevenueProjection(
    current,
    maximizedRevenuePerTrade,
  );
  const bestRevenueCategory = computeBestRevenueCategory(trades);
  const pricingStrategyAdvice = buildPricingStrategyAdvice(current, bestRevenueCategory);

  const upliftPct = current.avgRevenuePerTrade > 0
    ? (revenueUpliftPerTrade / current.avgRevenuePerTrade) * 100
    : 0;
  const revenueGrade = decideRevenueGrade(revenueMultiplier, upliftPct);

  return {
    revenueMaximizationActions,
    maximizedRevenuePerTrade,
    revenueUpliftPerTrade,
    revenueMultiplier,
    portfolioRevenueProjection,
    revenueGrade,
    bestRevenueCategory,
    pricingStrategyAdvice,
  };
}

// --- Prompt builders (čisti, testabilni) ---------------------------------

interface CategoryStat {
  category: string;
  avgRevenuePerTrade: number;
  tradeCount: number;
}

function buildTradeSample(soldComputed: SoldComputed[]): Array<{
  cat: string;
  sell: number;
  fees: number;
  buy: number;
  net: number;
  markup: number;
}> {
  return soldComputed
    .slice(-MAX_TRADES_FOR_AI)
    .map((t) => ({
      cat: t.category,
      sell: t.sellPrice,
      fees: t.sellFees,
      buy: t.buyPrice,
      net: t.netRevenue,
      markup: round2(t.markup),
    }));
}

function buildCategoryStats(soldComputed: SoldComputed[]): CategoryStat[] {
  const catMap = new Map<string, { sum: number; count: number }>();
  for (const t of soldComputed) {
    const e = catMap.get(t.category);
    if (e) { e.sum += t.sellPrice; e.count += 1; }
    else catMap.set(t.category, { sum: t.sellPrice, count: 1 });
  }
  return Array.from(catMap.entries())
    .map(([cat, agg]) => ({
      category: cat,
      avgRevenuePerTrade: round0(agg.sum / agg.count),
      tradeCount: agg.count,
    }))
    .sort((a, b) => b.avgRevenuePerTrade - a.avgRevenuePerTrade)
    .slice(0, 8);
}

function buildPromptData(
  soldComputed: SoldComputed[],
  current: CurrentState,
  maximization: RevenueMaximization,
  categoryStats: CategoryStat[],
  tradeSample: ReturnType<typeof buildTradeSample>,
): unknown {
  return {
    soldCount12m: soldComputed.length,
    current,
    deterministicMaximization: {
      revenueMaximizationActions: maximization.revenueMaximizationActions,
      maximizedRevenuePerTrade: maximization.maximizedRevenuePerTrade,
      revenueUpliftPerTrade: maximization.revenueUpliftPerTrade,
      revenueMultiplier: maximization.revenueMultiplier,
      portfolioRevenueProjection: maximization.portfolioRevenueProjection,
      revenueGrade: maximization.revenueGrade,
      bestRevenueCategory: maximization.bestRevenueCategory,
      pricingStrategyAdvice: maximization.pricingStrategyAdvice,
    },
    categoryStats,
    tradeSample,
    caps: {
      revenueMin: REVENUE_MIN, revenueMax: REVENUE_MAX,
      sellPriceMin: SELL_PRICE_MIN, sellPriceMax: SELL_PRICE_MAX,
      feesMin: FEES_MIN, feesMax: FEES_MAX,
      buyMin: BUY_MIN, buyMax: BUY_MAX,
      markupMin: MARKUP_MIN, markupMax: MARKUP_MAX,
      trendMin: TREND_MIN, trendMax: TREND_MAX,
      multiplierMin: MULTIPLIER_MIN, multiplierMax: MULTIPLIER_MAX,
      upliftPctMin: UPLIFT_PCT_MIN, upliftPctMax: UPLIFT_PCT_MAX,
      portfolioMin: PORTFOLIO_MIN, portfolioMax: PORTFOLIO_MAX,
    },
  };
}

function buildPrompt(promptData: unknown): string {
  return `Si AI "Revenue Per Trade Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za REVENUE PER TRADE MAXIMIZATION — kako maksimizirati top-line SELL PRICE / REVENUE na vsakem individualnem trade-u (ne profit-after-costs ampak čisti sell price). Tvoj cilj je "tvoj avg sell price je 180€, z 6 revenue akcijami bi lahko bil 245€ — multiplier 1.36x in 17800€ več portfolio revenue na leto". Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira PROFIT per trade € po odštevanju costov) — ti MAKSIMIZIRAŠ REVENUE per trade (top-line sell price). Razlika od profit-per-trade-maximizer (v8.03 ki maksimizira profit per trade €) — ta maksimizira SELL PRICE / top-line revenue per trade, ne bottom-line profit. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira growth rate revenue) — ta maksimizira REVENUE PER TRADE (avg sell price), ne growth rate. Razlika od revenue-stream-optimizer (v7.96 ki optimizira multiple revenue streams) — ta fokusira na enoto — REVENUE PER TRADE. Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira REVENUE PER TRADE z revenueMaximizationActions in revenueMultiplier. Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) — ta maksimizira REVENUE PER TRADE (avg sell price per deal), ne growth rate. Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) — ta maksimizira REVENUE PER TRADE (per-deal top-line) z revenueGrade in bestRevenueCategory. Razlika od pricing-strategy engine (v7.70 ki daje pricing recommendations) — ta MAXIMIZIRA REVENUE per trade z portfolioRevenueProjection in pricingStrategyAdvice.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. revenueMaximizationActions: 4-6 elementov { action: INCREASE_SELL_PRICE | IMPROVE_LISTING_QUALITY | TARGET_PREMIUM_BUYERS | TIMING_THE_SALE | CROSS_PLATFORM_PREMIUM, expectedRevenueGain % [0, 200] (koliko % dvigne revenue per trade — TARGET_PREMIUM_BUYERS ~22%, INCREASE_SELL_PRICE ~18%, CROSS_PLATFORM_PREMIUM ~16%, IMPROVE_LISTING_QUALITY ~14%, TIMING_THE_SALE ~10%), difficulty LOW/MEDIUM/HIGH, implementation (max 200, slovenski — specifična akcija) },
2. maximizedRevenuePerTrade € [0, 50000] (projected revenue per trade z actions — ≥ current.avgRevenuePerTrade),
3. revenueUpliftPerTrade € [0, 50000] (improvement = maximized − current),
4. revenueMultiplier [1.0, 3.0] (maximized / current ratio),
5. portfolioRevenueProjection € [0, 2000000] (annual revenue če vsi trades pri maximized revenue = maximizedRevenuePerTrade × soldCount12m),
6. revenueGrade: A+ | A | B | C | D | F (A+ če multiplier ≥ 1.6 ali uplift ≥ 50%, A ≥ 1.4/35, B ≥ 1.25/20, C ≥ 1.15/12, D ≥ 1.05/5, else F),
7. bestRevenueCategory: kategorija z najvišjim avg sell price (MORA biti ena iz deterministic categoryStats — anti-hallucination),
8. pricingStrategyAdvice: slovenski (max 400 znakov — kako ceniti za max revenue per trade),
9. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "revenueMaximizationActions": [
    { "action": "TARGET_PREMIUM_BUYERS", "expectedRevenueGain": 22, "difficulty": "MEDIUM", "implementation": "Ciljaj premium kupce z izboljšano fotografijo in garancijo." },
    { "action": "INCREASE_SELL_PRICE", "expectedRevenueGain": 18, "difficulty": "LOW", "implementation": "Dvigaj ask price za 15% z AI pricing engine." }
  ],
  "maximizedRevenuePerTrade": 245,
  "revenueUpliftPerTrade": 65,
  "revenueMultiplier": 1.36,
  "portfolioRevenueProjection": 29400,
  "revenueGrade": "A",
  "bestRevenueCategory": "iphone",
  "pricingStrategyAdvice": "Ciljaj premium pricing z 12-18% višjim ask price in AI A/B testing.",
  "summary": "Current: 180€/trade, markup 1.4×. Maximized: 245€/trade (multiplier 1.36×, grade A). Uplift: +65€/trade → portfolio 29400€/leto."
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI merge (čist, testabilen) ----------------------------------------

function mergeAiIntoMaximization(
  parsed: AiResponse | null,
  current: CurrentState,
  maximizationIn: RevenueMaximization,
  categoryStats: CategoryStat[],
): { maximization: RevenueMaximization; summary: string; aiUsed: boolean } {
  let maximization = maximizationIn;
  let summary = buildSummary(current, maximization);
  let aiUsed = false;

  if (parsed && typeof parsed === 'object') {
    // Override revenueMaximizationActions if AI provided 4+
    if (Array.isArray(parsed.revenueMaximizationActions) &&
        parsed.revenueMaximizationActions.length >= 4) {
      const aiActions: RevenueActionItem[] = [];
      for (const a of parsed.revenueMaximizationActions.slice(0, MAX_ACTIONS)) {
        if (!a || typeof a !== 'object') continue;
        aiActions.push({
          action: clampEnum(a.action, VALID_ACTION, 'INCREASE_SELL_PRICE'),
          expectedRevenueGain: round2(clampNum(
            a.expectedRevenueGain,
            UPLIFT_PCT_MIN, UPLIFT_PCT_MAX, 10,
          )),
          difficulty: clampEnum(a.difficulty, VALID_DIFFICULTY, 'MEDIUM'),
          implementation: clampString(a.implementation, 200, 'Izboljšaj listing in pricing.'),
        });
      }
      if (aiActions.length >= 4) {
        maximization = { ...maximization, revenueMaximizationActions: aiActions };
        // Recompute maximizedRevenuePerTrade based on new actions
        const r = computeMaximizedRevenue(current, aiActions);
        maximization = {
          ...maximization,
          maximizedRevenuePerTrade: r.maximizedRevenuePerTrade,
          revenueUpliftPerTrade: r.revenueUpliftPerTrade,
          revenueMultiplier: r.revenueMultiplier,
        };
      }
    }

    // Override maximizedRevenuePerTrade
    if (parsed.maximizedRevenuePerTrade !== undefined) {
      const minBound = current.avgRevenuePerTrade;
      const maxBound = Math.max(minBound + 1, Math.min(
        REVENUE_MAX,
        current.avgRevenuePerTrade * MULTIPLIER_MAX,
      ));
      const maximizedRevenuePerTrade = round0(clampNum(
        parsed.maximizedRevenuePerTrade,
        minBound, maxBound, maximization.maximizedRevenuePerTrade,
      ));
      const revenueUpliftPerTrade = round0(clampNum(
        maximizedRevenuePerTrade - current.avgRevenuePerTrade,
        0, REVENUE_MAX, maximization.revenueUpliftPerTrade,
      ));
      const revenueMultiplier = round2(clampNum(
        current.avgRevenuePerTrade > 0
          ? maximizedRevenuePerTrade / current.avgRevenuePerTrade
          : 1.0,
        MULTIPLIER_MIN, MULTIPLIER_MAX, maximization.revenueMultiplier,
      ));
      maximization = {
        ...maximization,
        maximizedRevenuePerTrade,
        revenueUpliftPerTrade,
        revenueMultiplier,
      };
    }

    // Override portfolioRevenueProjection
    if (parsed.portfolioRevenueProjection !== undefined) {
      const v = round0(clampNum(
        parsed.portfolioRevenueProjection,
        PORTFOLIO_MIN, PORTFOLIO_MAX, maximization.portfolioRevenueProjection,
      ));
      maximization = { ...maximization, portfolioRevenueProjection: v };
    } else {
      // Recompute based on updated maximizedRevenuePerTrade
      maximization = {
        ...maximization,
        portfolioRevenueProjection: computePortfolioRevenueProjection(
          current,
          maximization.maximizedRevenuePerTrade,
        ),
      };
    }

    // Override bestRevenueCategory — must match one of categoryStats (anti-hallucination)
    if (parsed.bestRevenueCategory) {
      const validCats = new Set(categoryStats.map((c) => c.category.toLowerCase()));
      const aiCat = clampString(parsed.bestRevenueCategory, 60, maximization.bestRevenueCategory);
      if (validCats.has(aiCat.toLowerCase())) {
        maximization = { ...maximization, bestRevenueCategory: aiCat };
      }
    }

    // Override pricingStrategyAdvice
    if (parsed.pricingStrategyAdvice) {
      maximization = {
        ...maximization,
        pricingStrategyAdvice: clampString(
          parsed.pricingStrategyAdvice,
          400,
          maximization.pricingStrategyAdvice,
        ),
      };
    }

    // Override revenueGrade — recompute or use AI value
    const upliftPct = current.avgRevenuePerTrade > 0
      ? (maximization.revenueUpliftPerTrade / current.avgRevenuePerTrade) * 100
      : 0;
    if (parsed.revenueGrade) {
      const grade = clampEnum(parsed.revenueGrade, VALID_GRADE, decideRevenueGrade(maximization.revenueMultiplier, upliftPct));
      maximization = { ...maximization, revenueGrade: grade };
    } else {
      maximization = {
        ...maximization,
        revenueGrade: decideRevenueGrade(maximization.revenueMultiplier, upliftPct),
      };
    }

    summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
    aiUsed = true;
  }

  return { maximization, summary, aiUsed };
}

// --- Handler -------------------------------------------------------------

const revenuePerTradeHandler = withAiRoute<RevenuePerTradeInput>({
  endpoint: '/api/ai/revenue-per-trade-maximizer',
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

    // 1) Query SOLD trades last 12 months (sellPrice > 0)
    const soldTrades = await db.trade.findMany({
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
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          avgRevenuePerTrade: 0,
          avgSellPrice: 0,
          avgSellFees: 0,
          avgNetRevenue: 0,
          avgBuyPrice: 0,
          avgMarkup: 0,
          revenuePerTradeTrend: 0,
          soldCount12m: 0,
        },
        maximization: {
          revenueMaximizationActions: [],
          maximizedRevenuePerTrade: 0,
          revenueUpliftPerTrade: 0,
          revenueMultiplier: 1.0,
          portfolioRevenueProjection: 0,
          revenueGrade: 'F',
          bestRevenueCategory: 'drugo',
          pricingStrategyAdvice: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Per Trade Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Per Trade Maximizer ni mogoč.',
      } satisfies RevenuePerTradeResponse);
    }

    // 2) Compute per-trade metrics
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }

    if (soldComputed.length === 0) {
      return apiOk({
        ok: true,
        current: {
          avgRevenuePerTrade: 0,
          avgSellPrice: 0,
          avgSellFees: 0,
          avgNetRevenue: 0,
          avgBuyPrice: 0,
          avgMarkup: 0,
          revenuePerTradeTrend: 0,
          soldCount12m: 0,
        },
        maximization: {
          revenueMaximizationActions: [],
          maximizedRevenuePerTrade: 0,
          revenueUpliftPerTrade: 0,
          revenueMultiplier: 1.0,
          portfolioRevenueProjection: 0,
          revenueGrade: 'F',
          bestRevenueCategory: 'drugo',
          pricingStrategyAdvice: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Revenue Per Trade Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Revenue Per Trade Maximizer ni mogoč.',
      } satisfies RevenuePerTradeResponse);
    }

    const current = computeCurrent(soldComputed);
    const deterministicMaximization = buildDeterministicMaximization(current, soldComputed);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `revenue-per-trade-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: RevenueMaximization;
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
      } satisfies RevenuePerTradeResponse);
    }

    // 4) AI prompt with grounding (settings loaded by withAiRoute wrapper)
    const tradeSampleForAI = buildTradeSample(soldComputed);
    const categoryStats = buildCategoryStats(soldComputed);
    const promptData = buildPromptData(
      soldComputed,
      current,
      deterministicMaximization,
      categoryStats,
      tradeSampleForAI,
    );
    const prompt = buildPrompt(promptData);

    // Deterministic baseline (fallback if AI call fails)
    let maximization = deterministicMaximization;
    let summary = buildSummary(current, maximization);
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoMaximization(parsed, current, maximization, categoryStats);
      maximization = merged.maximization;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/revenue-per-trade-maximizer',
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
    } satisfies RevenuePerTradeResponse);
  },
});

export const GET = revenuePerTradeHandler;
export const POST = revenuePerTradeHandler;
