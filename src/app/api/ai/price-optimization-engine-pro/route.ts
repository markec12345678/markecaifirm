// v7.95 / v8.96.4-batch3: AI Price Optimization Engine Pro — AI GENERIRA optimalne cene za
// VSE HELD inventorija hkrati z A/B testing priporočili in dynamic
// pricing rules. Razlika od price-intelligence-engine (v7.72 ki analizira
// pricing patterns) — ta GENERIRA optimal price per item z A/B testing
// priporočili in dynamic pricing rules. Razlika od smart-pricing-engine
// (basic pricing) — ta je PRO z A/B testing in dynamic pricing. Razlika
// od reserve-price-optimizer (ki optimizira reserve) — ta optimizira
// AKTUALNE cene za HELD inventorij. Razlika od profit-margin-optimizer-v2
// (ki optimizira margin) — ta optimizira CENE per item. Razlika od
// profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers) —
// ta fokusira izključno na PRICING per item z A/B testing in dynamic
// pricing rules.
//
// "PS5: current 380€, optimal 395€ (+4%, PREMIUM). Expected: +15€ profit,
// -5% sell prob. A/B test: yes."
//
// GET+POST /api/ai/price-optimization-engine-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface PriceOptimizationEngineProInput {}

// --- Types ---------------------------------------------------------------

type PriceAction = 'INCREASE' | 'DECREASE' | 'MAINTAIN';
type PricingStrategy = 'PREMIUM' | 'COMPETITIVE' | 'VALUE' | 'LIQUIDATION';

interface PriceOptItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  currentPrice: number;
  estValue: number | null;
  pricePosition: 'BELOW' | 'AT' | 'ABOVE';
  optimalPrice: number;
  priceAction: PriceAction;
  priceAdjustmentPercent: number;
  expectedSellProbabilityLift: number;
  expectedProfitChange: number;
  pricingStrategy: PricingStrategy;
  dynamicPricingRule: string;
  abTestRecommendation: boolean;
  reasoning: string;
}

interface Portfolio {
  totalExpectedProfitLift: number;
  totalExpectedSellProbabilityLift: number;
  pricingPortfolioScore: number;
  averagePriceAdjustment: number;
  itemsNeedingIncrease: number;
  itemsNeedingDecrease: number;
}

interface PriceOptResponse {
  ok: true;
  items: PriceOptItem[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiPriceOptResponse {
  items?: Array<{
    tradeId?: string;
    optimalPrice?: number;
    priceAction?: PriceAction;
    priceAdjustmentPercent?: number;
    expectedSellProbabilityLift?: number;
    expectedProfitChange?: number;
    pricingStrategy?: PricingStrategy;
    dynamicPricingRule?: string;
    abTestRecommendation?: boolean;
    reasoning?: string;
  }>;
  portfolio?: {
    totalExpectedProfitLift?: number;
    totalExpectedSellProbabilityLift?: number;
    pricingPortfolioScore?: number;
    averagePriceAdjustment?: number;
    itemsNeedingIncrease?: number;
    itemsNeedingDecrease?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PERCENT_MIN = -50; // max -50% drop
const PERCENT_MAX = 50; // max +50% raise
const SELL_PROB_MIN = -25; // lift -25pp
const SELL_PROB_MAX = 25; // lift +25pp
const PROFIT_CHANGE_MIN = -5000;
const PROFIT_CHANGE_MAX = 5000;

const VALID_PRICE_ACTION: readonly PriceAction[] = ['INCREASE', 'DECREASE', 'MAINTAIN'];
const VALID_STRATEGY: readonly PricingStrategy[] = ['PREMIUM', 'COMPETITIVE', 'VALUE', 'LIQUIDATION'];

const PRICE_POSITION_THRESHOLD = 0.05; // 5% from estValue = "AT"

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

// --- DB row types --------------------------------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  listing: {
    id: string;
    title: string;
    price: number | null;
    aiEstimatedValue: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    dealScore: number | null;
    aiVerdict: string | null;
    monitor: { tags: string } | null;
  } | null;
}

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string;
  listing: {
    aiEstimatedValue: number | null;
  } | null;
}

// --- Historical pattern computation --------------------------------------

interface HistoricalPatterns {
  avgSellPriceVsEstValue: number; // ratio: sellPrice / estValue (1.0 = at est)
  priceElasticityByCategory: Map<string, number>; // -10 to +10 (negative = elastic)
  optimalPricePointByCategory: Map<string, number>; // ratio
  sampleSize: number;
  categoryStats: Map<string, {
    count: number;
    avgProfit: number;
    avgSellPrice: number;
    avgBuyPrice: number;
    winRate: number; // 0-1
  }>;
}

function computeHistoricalPatterns(soldTrades: SoldTradeRow[]): HistoricalPatterns {
  const byCategory = new Map<string, {
    profits: number[];
    sellPrices: number[];
    buyPrices: number[];
    wins: number;
    count: number;
    ratios: number[]; // sellPrice / estValue
  }>();

  let totalRatio = 0;
  let ratioCount = 0;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const revenue = sellPrice - sellFees;
    const cost = buyPrice + buyFees;
    const profit = revenue - cost;
    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';

    const entry = byCategory.get(cat) || {
      profits: [], sellPrices: [], buyPrices: [], wins: 0, count: 0, ratios: [],
    };
    entry.profits.push(profit);
    entry.sellPrices.push(sellPrice);
    entry.buyPrices.push(buyPrice);
    if (profit > 0) entry.wins += 1;
    entry.count += 1;

    const estValue = t.listing?.aiEstimatedValue ?? null;
    if (estValue && estValue > 0 && sellPrice > 0) {
      const ratio = sellPrice / estValue;
      entry.ratios.push(ratio);
      totalRatio += ratio;
      ratioCount += 1;
    }

    byCategory.set(cat, entry);
  }

  const categoryStats = new Map<string, { count: number; avgProfit: number; avgSellPrice: number; avgBuyPrice: number; winRate: number }>();
  const priceElasticityByCategory = new Map<string, number>();
  const optimalPricePointByCategory = new Map<string, number>();

  for (const [cat, entry] of byCategory) {
    const avgProfit = avg(entry.profits);
    const avgSell = avg(entry.sellPrices);
    const avgBuy = avg(entry.buyPrices);
    const winRate = entry.count > 0 ? entry.wins / entry.count : 0;
    categoryStats.set(cat, {
      count: entry.count,
      avgProfit,
      avgSellPrice: avgSell,
      avgBuyPrice: avgBuy,
      winRate,
    });

    // Price elasticity: proxy from profit variability (high std dev = elastic)
    const profitMean = avgProfit;
    const variance = entry.profits.length > 0
      ? entry.profits.reduce((s, v) => s + Math.pow(v - profitMean, 2), 0) / entry.profits.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const cv = profitMean !== 0 ? Math.abs(stdDev / profitMean) : 0;
    // Elasticity score: 0 (inelastic) to 10 (very elastic)
    const elasticity = round0(Math.max(0, Math.min(10, cv * 10)));
    priceElasticityByCategory.set(cat, elasticity);

    // Optimal price point = avg sell price ratio (or 0.92 fallback)
    const avgRatio = entry.ratios.length > 0 ? avg(entry.ratios) : 0.92;
    optimalPricePointByCategory.set(cat, round0(Math.max(0.5, Math.min(1.3, avgRatio)) * 100) / 100);
  }

  const avgSellPriceVsEstValue = ratioCount > 0 ? round0((totalRatio / ratioCount) * 100) / 100 : 0.92;

  return {
    avgSellPriceVsEstValue,
    priceElasticityByCategory,
    optimalPricePointByCategory,
    sampleSize: soldTrades.length,
    categoryStats,
  };
}

// --- Per-item computation ------------------------------------------------

function pricePosition(current: number, est: number | null): 'BELOW' | 'AT' | 'ABOVE' {
  if (!est || est <= 0) return 'AT';
  const ratio = current / est;
  if (ratio < 1 - PRICE_POSITION_THRESHOLD) return 'BELOW';
  if (ratio > 1 + PRICE_POSITION_THRESHOLD) return 'ABOVE';
  return 'AT';
}

function computeSellProbability(
  current: number,
  optimal: number,
  estValue: number | null,
  categoryStats: Map<string, { count: number; avgProfit: number; avgSellPrice: number; avgBuyPrice: number; winRate: number }>,
  category: string,
): { atCurrent: number; atOptimal: number } {
  const stats = categoryStats.get(category);
  const winRate = stats && stats.count > 0 ? stats.winRate : 0.5;
  // At current price: based on win rate (50 base + winRate×50)
  const atCurrent = round0(Math.max(5, Math.min(95, 50 + (winRate - 0.5) * 100)));
  // At optimal price: depending on whether optimal is higher or lower than current
  const adjustmentRatio = current > 0 ? (optimal - current) / current : 0;
  // Lower price = higher sell probability; higher price = lower sell probability
  const sellProbAtOptimal = atCurrent - (adjustmentRatio * 100); // negative ratio (lower price) increases prob
  const atOptimal = round0(Math.max(5, Math.min(95, sellProbAtOptimal)));
  // Reference estValue to keep signature behaviour identical
  void estValue;
  return { atCurrent, atOptimal };
}

function buildDeterministicItem(
  t: HeldTradeRow,
  patterns: HistoricalPatterns,
): PriceOptItem {
  const buyPrice = t.buyPrice ?? 0;
  const listingPrice = t.listing?.price ?? null;
  const estValue = t.listing?.aiEstimatedValue ?? null;
  const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';

  // currentPrice: use listing price if available, else estValue, else buyPrice × 1.2
  const currentPrice = listingPrice && listingPrice > 0
    ? listingPrice
    : estValue && estValue > 0
      ? estValue
      : round0(buyPrice * 1.2);

  // Anti-hallucination: optimal price clamped to [0.5x, 1.3x] estValue
  let optimalPrice: number;
  if (estValue && estValue > 0) {
    const optRatio = patterns.optimalPricePointByCategory.get(category) ?? 0.92;
    optimalPrice = round0(estValue * optRatio);
    // Clamp to [0.5, 1.3] × estValue anti-hallucination
    optimalPrice = round0(Math.max(estValue * 0.5, Math.min(estValue * 1.3, optimalPrice)));
  } else {
    // Fallback: buyPrice × 1.25 (25% markup)
    optimalPrice = round0(buyPrice * 1.25);
  }

  const position = pricePosition(currentPrice, estValue);

  // Price action
  const diff = optimalPrice - currentPrice;
  const pct = currentPrice > 0 ? (diff / currentPrice) * 100 : 0;
  let priceAction: PriceAction = 'MAINTAIN';
  if (pct > 3) priceAction = 'INCREASE';
  else if (pct < -3) priceAction = 'DECREASE';

  const priceAdjustmentPercent = round0(clampNum(pct, PERCENT_MIN, PERCENT_MAX, 0));

  // Sell probability
  const { atCurrent, atOptimal } = computeSellProbability(
    currentPrice, optimalPrice, estValue, patterns.categoryStats, category,
  );
  const expectedSellProbabilityLift = round0(
    clampNum(atOptimal - atCurrent, SELL_PROB_MIN, SELL_PROB_MAX, 0),
  );

  // Profit change
  const profitAtCurrent = round0(currentPrice - buyPrice);
  const profitAtOptimal = round0(optimalPrice - buyPrice);
  const expectedProfitChange = round0(
    clampNum(profitAtOptimal - profitAtCurrent, PROFIT_CHANGE_MIN, PROFIT_CHANGE_MAX, 0),
  );

  // Pricing strategy
  let pricingStrategy: PricingStrategy = 'COMPETITIVE';
  if (estValue && estValue > 0) {
    const ratio = optimalPrice / estValue;
    if (ratio >= 1.1) pricingStrategy = 'PREMIUM';
    else if (ratio >= 0.95) pricingStrategy = 'COMPETITIVE';
    else if (ratio >= 0.75) pricingStrategy = 'VALUE';
    else pricingStrategy = 'LIQUIDATION';
  }

  // Dynamic pricing rule
  let dynamicPricingRule: string;
  if (priceAction === 'INCREASE') {
    dynamicPricingRule = `Povišaj ceno na ${optimalPrice}€; če ni prodano v 14 dneh, znižaj za 3% in ponovi vsakih 14 dni do minimuma ${round0(optimalPrice * 0.9)}€.`;
  } else if (priceAction === 'DECREASE') {
    dynamicPricingRule = `Znižaj ceno na ${optimalPrice}€; če je prodano v 7 dneh, naslednjič zaženjaj višje (+5%).`;
  } else {
    dynamicPricingRule = `Vzdržuj ceno ${optimalPrice}€; če ni prodano v 21 dneh, znižaj za 5%.`;
  }

  // A/B test recommendation: yes if action is INCREASE/DECREASE and prob lift is moderate
  const abTestRecommendation = priceAction !== 'MAINTAIN' && Math.abs(priceAdjustmentPercent) >= 5;

  // Reasoning
  const estLabel = estValue ? `${estValue}€` : 'neznan';
  const reasoning = `Trenutna cena ${currentPrice}€ (estValue ${estLabel}, ${position}). Optimalna ${optimalPrice}€ glede na historical pattern (ratio ${patterns.optimalPricePointByCategory.get(category) ?? 0.92}). Strategija: ${pricingStrategy}.`;

  return {
    tradeId: t.id,
    title: t.listing?.title || t.title || 'Brez naslova',
    category,
    buyPrice: round0(buyPrice),
    currentPrice: round0(currentPrice),
    estValue: estValue ?? null,
    pricePosition: position,
    optimalPrice,
    priceAction,
    priceAdjustmentPercent,
    expectedSellProbabilityLift,
    expectedProfitChange,
    pricingStrategy,
    dynamicPricingRule: dynamicPricingRule.slice(0, 300),
    abTestRecommendation,
    reasoning: reasoning.slice(0, 400),
  };
}

function buildDeterministicPortfolio(items: PriceOptItem[]): Portfolio {
  const totalProfitLift = items.reduce((s, i) => s + Math.max(0, i.expectedProfitChange), 0);
  const totalProbLift = items.reduce((s, i) => s + i.expectedSellProbabilityLift, 0);
  const avgAdjustment = items.length > 0
    ? items.reduce((s, i) => s + Math.abs(i.priceAdjustmentPercent), 0) / items.length
    : 0;
  const itemsNeedingIncrease = items.filter((i) => i.priceAction === 'INCREASE').length;
  const itemsNeedingDecrease = items.filter((i) => i.priceAction === 'DECREASE').length;
  // Score: 100 - (avg |adjustment|) — fewer adjustments needed = higher score
  const score = round0(Math.max(SCORE_MIN, Math.min(SCORE_MAX, 100 - avgAdjustment)));
  return {
    totalExpectedProfitLift: round0(totalProfitLift),
    totalExpectedSellProbabilityLift: round0(totalProbLift),
    pricingPortfolioScore: score,
    averagePriceAdjustment: round0(avgAdjustment * 100) / 100,
    itemsNeedingIncrease,
    itemsNeedingDecrease,
  };
}

function buildSummary(items: PriceOptItem[], portfolio: Portfolio): string {
  if (items.length === 0) {
    return 'Ni HELD trgovin za optimizacijo cen.';
  }
  const first = items[0]!;
  const parts: string[] = [
    `${items.length} items optimiziranih. Score: ${portfolio.pricingPortfolioScore}/100.`,
    `${first.title.slice(0, 30)}: ${first.currentPrice}€ → ${first.optimalPrice}€ (${first.priceAdjustmentPercent >= 0 ? '+' : ''}${first.priceAdjustmentPercent}%, ${first.pricingStrategy}).`,
    `Portfolio lift: +${portfolio.totalExpectedProfitLift}€ profit.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Prompt builder + AI response transform (čisti helperji) ------------

interface PromptData {
  heldItems: Array<{
    tradeId: string;
    title: string;
    category: string;
    buyPrice: number;
    currentPrice: number;
    estValue: number | null;
    pricePosition: 'BELOW' | 'AT' | 'ABOVE';
    deterministic: {
      optimalPrice: number;
      priceAction: PriceAction;
      priceAdjustmentPercent: number;
      pricingStrategy: PricingStrategy;
    };
  }>;
  historicalPatterns: {
    avgSellPriceVsEstValue: number;
    sampleSize: number;
    categoryStats: Record<string, unknown>;
    priceElasticityByCategory: Record<string, number>;
    optimalPricePointByCategory: Record<string, number>;
  };
  deterministicPortfolio: Portfolio;
  caps: {
    percentMin: number; percentMax: number;
    sellProbMin: number; sellProbMax: number;
    profitChangeMin: number; profitChangeMax: number;
  };
}

function buildPrompt(
  items: PriceOptItem[],
  patterns: HistoricalPatterns,
  portfolio: Portfolio,
): string {
  const promptData: PromptData = {
    heldItems: items.slice(0, 30).map((i) => ({
      tradeId: i.tradeId,
      title: i.title,
      category: i.category,
      buyPrice: i.buyPrice,
      currentPrice: i.currentPrice,
      estValue: i.estValue,
      pricePosition: i.pricePosition,
      deterministic: {
        optimalPrice: i.optimalPrice,
        priceAction: i.priceAction,
        priceAdjustmentPercent: i.priceAdjustmentPercent,
        pricingStrategy: i.pricingStrategy,
      },
    })),
    historicalPatterns: {
      avgSellPriceVsEstValue: patterns.avgSellPriceVsEstValue,
      sampleSize: patterns.sampleSize,
      categoryStats: Object.fromEntries(
        Array.from(patterns.categoryStats.entries()).slice(0, 10).map(([k, v]) => [k, v]),
      ),
      priceElasticityByCategory: Object.fromEntries(patterns.priceElasticityByCategory),
      optimalPricePointByCategory: Object.fromEntries(patterns.optimalPricePointByCategory),
    },
    deterministicPortfolio: portfolio,
    caps: {
      percentMin: PERCENT_MIN, percentMax: PERCENT_MAX,
      sellProbMin: SELL_PROB_MIN, sellProbMax: SELL_PROB_MAX,
      profitChangeMin: PROFIT_CHANGE_MIN, profitChangeMax: PROFIT_CHANGE_MAX,
    },
  };

  return `Si AI "Price Optimization Engine Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Ti GENERIRAŠ optimalne cene za VSE HELD inventorija hkrati z A/B testing priporočili in dynamic pricing rules. Razlika od price-intelligence-engine (ki analizira pricing patterns) — ti GENERIRAŠ optimal price per item z A/B testing in dynamic pricing. Razlika od smart-pricing-engine (basic) — ti si PRO z A/B testing in dynamic pricing rules.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovine z linked Listing + SOLD 12m za historical patterns):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak HELD item generiraj optimal price. Per item: { tradeId (string), optimalPrice EUR (CLAMPED to [0.5x, 1.3x] estValue anti-hallucination; če ni estValue, [0.8x, 1.5x] buyPrice), priceAction INCREASE|DECREASE|MAINTAIN (INCREASE če optimal > current+3%, DECREASE če optimal < current-3%, sicer MAINTAIN), priceAdjustmentPercent [-50, 50] (= (optimal-current)/current × 100), expectedSellProbabilityLift [-25, 25] pp (positive = boljša prodaja, negativna = slabša ampak večji profit), expectedProfitChange € [-5000, 5000] (= optimal-current pri buyPrice不变), pricingStrategy PREMIUM|COMPETITIVE|VALUE|LIQUIDATION (PREMIUM >1.1×estValue, COMPETITIVE 0.95-1.1, VALUE 0.75-0.95, LIQUIDATION <0.75), dynamicPricingRule (max 300 chars — npr. "drop 5% every 14 days until min €X"), abTestRecommendation boolean (true če |adjustment| >= 5%), reasoning (max 400 chars — slovenski povzetek) }.
2. portfolio: { totalExpectedProfitLift € (sum max(0, profitChange)), totalExpectedSellProbabilityLift pp (sum), pricingPortfolioScore 0-100 (višji = bolje optimizirano; ±10 od deterministic), averagePriceAdjustment % (avg |pct|), itemsNeedingIncrease count, itemsNeedingDecrease count }.
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministic baseline. Primer: "PS5: current 380€, optimal 395€ (+4%, PREMIUM). Expected: +15€ profit, -5% sell prob. A/B test: yes."

VRNI LE JSON:
{
  "items": [
    { "tradeId": "abc", "optimalPrice": 395, "priceAction": "INCREASE", "priceAdjustmentPercent": 4, "expectedSellProbabilityLift": -5, "expectedProfitChange": 15, "pricingStrategy": "PREMIUM", "dynamicPricingRule": "Povišaj na 395€; če ni prodano v 14 dneh, znižaj 3%.", "abTestRecommendation": true, "reasoning": "PS5 current 380€, optimal 395€ (estValue 410€, 0.96 ratio)." }
  ],
  "portfolio": {
    "totalExpectedProfitLift": 250,
    "totalExpectedSellProbabilityLift": -20,
    "pricingPortfolioScore": 72,
    "averagePriceAdjustment": 6.5,
    "itemsNeedingIncrease": 8,
    "itemsNeedingDecrease": 3
  },
  "summary": "30 items optimiziranih. Score: 72/100. PS5: 380€ → 395€ (+4%, PREMIUM). Portfolio lift: +250€ profit."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface AiTransformResult {
  items: PriceOptItem[];
  portfolio: Portfolio;
  summary: string;
}

function transformAiResponse(
  parsed: unknown,
  detItems: PriceOptItem[],
  detPortfolio: Portfolio,
): AiTransformResult | null {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as AiPriceOptResponse).items)) {
    return null;
  }
  const ai = parsed as AiPriceOptResponse;

  // Build a map for quick lookup of deterministic item by tradeId
  const detMap = new Map(detItems.map((i) => [i.tradeId, i]));
  const aiItems: PriceOptItem[] = [];

  for (const a of ai.items ?? []) {
    if (!a || typeof a !== 'object') continue;
    const tradeId = String(a.tradeId ?? '').trim();
    const det = detMap.get(tradeId);
    if (!det) continue; // skip unknown tradeIds (anti-hallucination: must match held item)

    // Anti-hallucination: optimalPrice clamped to [0.5x, 1.3x] estValue (if estValue exists)
    let optimalPrice: number;
    if (det.estValue && det.estValue > 0) {
      const minAllowed = det.estValue * 0.5;
      const maxAllowed = det.estValue * 1.3;
      optimalPrice = round0(
        Math.max(minAllowed, Math.min(maxAllowed, clampNum(a.optimalPrice, minAllowed, maxAllowed, det.optimalPrice))),
      );
    } else {
      // Fallback: [0.8x, 1.5x] buyPrice
      const minAllowed = det.buyPrice * 0.8;
      const maxAllowed = det.buyPrice * 1.5;
      optimalPrice = round0(
        Math.max(minAllowed, Math.min(maxAllowed, clampNum(a.optimalPrice, minAllowed, maxAllowed, det.optimalPrice))),
      );
    }

    const priceAdjustmentPercent = round0(
      clampNum(a.priceAdjustmentPercent, PERCENT_MIN, PERCENT_MAX, det.priceAdjustmentPercent),
    );

    const priceAction = clampEnum(a.priceAction, VALID_PRICE_ACTION, det.priceAction);
    // Re-validate action matches pct sign
    let finalAction = priceAction;
    if (priceAdjustmentPercent > 3 && finalAction !== 'INCREASE') finalAction = 'INCREASE';
    else if (priceAdjustmentPercent < -3 && finalAction !== 'DECREASE') finalAction = 'DECREASE';
    else if (Math.abs(priceAdjustmentPercent) <= 3) finalAction = 'MAINTAIN';

    const expectedSellProbabilityLift = round0(
      clampNum(a.expectedSellProbabilityLift, SELL_PROB_MIN, SELL_PROB_MAX, det.expectedSellProbabilityLift),
    );
    const expectedProfitChange = round0(
      clampNum(a.expectedProfitChange, PROFIT_CHANGE_MIN, PROFIT_CHANGE_MAX, det.expectedProfitChange),
    );
    const pricingStrategy = clampEnum(a.pricingStrategy, VALID_STRATEGY, det.pricingStrategy);
    const dynamicPricingRule = clampString(a.dynamicPricingRule, 300, det.dynamicPricingRule);
    const abTestRecommendation = typeof a.abTestRecommendation === 'boolean'
      ? a.abTestRecommendation
      : det.abTestRecommendation;
    const reasoning = clampString(a.reasoning, 400, det.reasoning);

    aiItems.push({
      tradeId: det.tradeId,
      title: det.title,
      category: det.category,
      buyPrice: det.buyPrice,
      currentPrice: det.currentPrice,
      estValue: det.estValue,
      pricePosition: det.pricePosition,
      optimalPrice,
      priceAction: finalAction,
      priceAdjustmentPercent,
      expectedSellProbabilityLift,
      expectedProfitChange,
      pricingStrategy,
      dynamicPricingRule,
      abTestRecommendation,
      reasoning,
    });
  }

  if (aiItems.length === 0) {
    return null;
  }

  let items = aiItems;
  let portfolio = detPortfolio;
  const aiPortfolio = ai.portfolio;
  if (aiPortfolio && typeof aiPortfolio === 'object') {
    const detScore = detPortfolio.pricingPortfolioScore;
    const pricingPortfolioScore = round0(
      Math.max(SCORE_MIN, Math.min(SCORE_MAX,
        detScore + Math.max(-10, Math.min(10,
          (Number(aiPortfolio.pricingPortfolioScore ?? detScore)) - detScore)))),
    );
    portfolio = {
      totalExpectedProfitLift: round0(
        clampNum(aiPortfolio.totalExpectedProfitLift, 0, 1_000_000, detPortfolio.totalExpectedProfitLift),
      ),
      totalExpectedSellProbabilityLift: round0(
        clampNum(aiPortfolio.totalExpectedSellProbabilityLift, -500, 500, detPortfolio.totalExpectedSellProbabilityLift),
      ),
      pricingPortfolioScore,
      averagePriceAdjustment: round0(
        clampNum(aiPortfolio.averagePriceAdjustment, 0, 100, detPortfolio.averagePriceAdjustment) * 100,
      ) / 100,
      itemsNeedingIncrease: items.filter((i) => i.priceAction === 'INCREASE').length,
      itemsNeedingDecrease: items.filter((i) => i.priceAction === 'DECREASE').length,
    };
  } else {
    portfolio = buildDeterministicPortfolio(items);
  }

  const summary = clampString(ai.summary, 400, buildSummary(items, portfolio));

  return { items, portfolio, summary };
}

// --- Handler -------------------------------------------------------------

const priceOptimizationEngineProHandler = withAiRoute<PriceOptimizationEngineProInput>({
  endpoint: '/api/ai/price-optimization-engine-pro',
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
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
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
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 10000,
    }) as unknown as HeldTradeRow[];

    // Empty-state: no HELD trades
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        portfolio: {
          totalExpectedProfitLift: 0,
          totalExpectedSellProbabilityLift: 0,
          pricingPortfolioScore: 0,
          averagePriceAdjustment: 0,
          itemsNeedingIncrease: 0,
          itemsNeedingDecrease: 0,
        },
        summary: 'Ni HELD trgovin v inventarju — Price Optimization Engine Pro ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Price Optimization Engine Pro ni mogoč.',
      } satisfies PriceOptResponse);
    }

    // 2) Query SOLD trades for historical pricing patterns
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        category: true,
        listing: {
          select: {
            aiEstimatedValue: true,
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // 3) Compute historical pricing patterns
    const patterns = computeHistoricalPatterns(soldTrades);

    // 4) Build deterministic per-item plan
    let items: PriceOptItem[] = heldTrades.map((t) => buildDeterministicItem(t, patterns));
    let portfolio = buildDeterministicPortfolio(items);
    let summary = buildSummary(items, portfolio);

    // 5) AI cache check (6h TTL)
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `price-optimization-engine-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{ items: PriceOptItem[]; portfolio: Portfolio; summary: string }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        items: cached.items,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies PriceOptResponse);
    }

    // 6) Build AI prompt with grounding + call AI (try/catch z graceful fallback)
    const prompt = buildPrompt(items, patterns, portfolio);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiPriceOptResponse | null;

      const transformed = transformAiResponse(parsed, items, portfolio);
      if (transformed) {
        items = transformed.items;
        portfolio = transformed.portfolio;
        summary = transformed.summary;
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/price-optimization-engine-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items, portfolio, summary });
    }

    return apiOk({
      ok: true,
      items,
      portfolio,
      summary,
      aiUsed,
    } satisfies PriceOptResponse);
  },
});

export const GET = priceOptimizationEngineProHandler;
export const POST = priceOptimizationEngineProHandler;
