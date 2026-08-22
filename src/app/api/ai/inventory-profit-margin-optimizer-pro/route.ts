// v7.96 / v8.96.4-batch1: AI Inventory Profit Margin Optimizer Pro — AI
// provides per-item margin optimization z SPECIFIC price targets, expected
// margin lift in risk assessment. Greje dlje od profit-margin-maximizer
// (v7.95 ki identificira optimization areas) — ta da EXACT price recommendations
// z confidence intervals za vsak HELD item posebej.
//
// Razlika od profit-margin-maximizer (v7.95 ki identificira optimization
// AREAS z actions) — ta da PER-ITEM specific price targets z confidence
// intervals. Razlika od profit-margin-optimizer-v2 (ki optimizira
// margin aggregate) — ta optimira PER ITEM z optimalPrice + sellProbability.
// Razlika od price-optimization-engine-pro (v7.95 ki optimira CENE z
// A/B testing) — ta optimira MARGIN per item z risk-adjusted expected
// margin. Razlika from profit-margin-forecaster-pro (v7.85 ki forecast-a
// margin) — ta OPTIMIRA margin z actionable per-item plan. Razlika od
// inventory-profit-maximizer (ki optimizira inventory profit) — ta
// optimira MARGIN per item z optimalPrice + riskAdjustedMargin. Razlika
// od profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers)
// — ta fokusira izključno na PER-ITEM margin z confidence intervals.
//
// "iPhone 13: buyPrice 280€, estValue 380€, current margin 35% (GOOD).
// Optimal price: 365€ (margin 30%, sell prob 75%). Margin lift -5pp
// but +18pp risk-adjusted. Action: SELL_AT_OPTIMAL. Confidence interval
// [340€, 390€]. Portfolio margin: 22% → 28% (+6pp, €420 lift, grade B)."
//
// GET+POST /api/ai/inventory-profit-margin-optimizer-pro
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.4-batch1) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type MarginCategory = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'NEGATIVE';
type OptimizationAction =
  | 'HOLD_FOR_BETTER_MARGIN'
  | 'SELL_AT_OPTIMAL'
  | 'DISCOUNT_FOR_QUICK_SALE'
  | 'REPRICE';
type MarginGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface HeldItemRow {
  id: string;
  title: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  category: string;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    dealScore: number | null;
    monitor: { tags: string } | null;
  } | null;
}

interface MarginItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  currentMargin: number; // %
  marginCategory: MarginCategory;
  optimalPrice: number; // €
  expectedMarginAtOptimal: number; // %
  marginLift: number; // pp
  sellProbability: number; // 0-100 %
  riskAdjustedMargin: number; // % (expectedMargin × sellProbability)
  optimizationAction: OptimizationAction;
  priceConfidenceInterval: { low: number; high: number };
  reasoning: string;
  competitorPricingImpact: string;
}

interface Portfolio {
  currentPortfolioMargin: number; // %
  optimizedPortfolioMargin: number; // %
  totalMarginLift: number; // €
  marginOptimizationGrade: MarginGrade;
  itemsToOptimize: number;
  quickWins: number;
}

interface InventoryMarginOptimizerResponse {
  ok: true;
  items: MarginItem[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  items?: Array<{
    tradeId?: string;
    optimalPrice?: number;
    sellProbability?: number;
    optimizationAction?: OptimizationAction;
    reasoning?: string;
    competitorPricingImpact?: string;
  }>;
  portfolio?: {
    marginOptimizationGrade?: MarginGrade;
  };
  summary?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryProfitMarginOptimizerProInput {}

// --- Constants -----------------------------------------------------------

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const MARGIN_MIN = -50;
const MARGIN_MAX = 200;
const MARGIN_LIFT_MIN = -50;
const MARGIN_LIFT_MAX = 100;
const PROB_MIN = 0;
const PROB_MAX = 100;
const PRICE_MIN = 0;
const PRICE_MAX = 100_000;
const LIFT_EUR_MIN = -50_000;
const LIFT_EUR_MAX = 100_000;

const VALID_ACTION: readonly OptimizationAction[] = [
  'HOLD_FOR_BETTER_MARGIN',
  'SELL_AT_OPTIMAL',
  'DISCOUNT_FOR_QUICK_SALE',
  'REPRICE',
];
const VALID_GRADE: readonly MarginGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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

// --- Margin computation -------------------------------------------------

function classifyMargin(marginPct: number): MarginCategory {
  if (marginPct > 40) return 'EXCELLENT';
  if (marginPct > 20) return 'GOOD';
  if (marginPct >= 0) return 'AVERAGE';
  return 'NEGATIVE';
}

interface DetMarginItem {
  item: MarginItem;
  estValue: number;
}

function computeMarginItem(t: HeldItemRow, now: number): DetMarginItem {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const totalCost = buyPrice + buyFees;
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  const estValue =
    listingEst && listingEst > 0 ? listingEst
      : listingPrice && listingPrice > 0 ? listingPrice
        : Math.round(buyPrice * 1.2);
  const aiEstimatedValue = (listingEst && listingEst > 0) ? listingEst : null;

  // Current margin (based on estValue vs totalCost)
  const currentMargin = totalCost > 0
    ? round2(clampNum(((estValue - totalCost) / totalCost) * 100, MARGIN_MIN, MARGIN_MAX, 0))
    : 0;
  const marginCategory = classifyMargin(currentMargin);

  // Optimal price: AI-recommended (deterministic = estValue × 0.92 anti-hallucination clamped [0.5x, 1.3x] estValue)
  const optRatio = 0.92; // slightly below estValue for faster sale
  const optimalPrice = round0(
    Math.max(
      Math.round(estValue * 0.5),
      Math.min(Math.round(estValue * 1.3), Math.round(estValue * optRatio)),
    ),
  );

  // Expected margin at optimal price (after estFees 5%)
  const estFeesAtOptimal = Math.round(optimalPrice * 0.05);
  const netAtOptimal = optimalPrice - estFeesAtOptimal;
  const expectedMarginAtOptimal = totalCost > 0
    ? round2(clampNum(((netAtOptimal - totalCost) / totalCost) * 100, MARGIN_MIN, MARGIN_MAX, 0))
    : 0;

  // Margin lift: improvement vs current margin
  const marginLift = round2(clampNum(
    expectedMarginAtOptimal - currentMargin,
    MARGIN_LIFT_MIN, MARGIN_LIFT_MAX, 0,
  ));

  // Sell probability: based on how competitive the optimal price is
  // Lower price → higher probability
  const priceVsEst = estValue > 0 ? optimalPrice / estValue : 1;
  const sellProbability = round0(clampNum(
    100 - (priceVsEst - 0.7) * 100, // 0.7× = 100%, 1.0× = 70%, 1.3× = 40%
    PROB_MIN, PROB_MAX, 60,
  ));

  // Risk-adjusted margin: expected margin × sell probability / 100
  const riskAdjustedMargin = round2(clampNum(
    expectedMarginAtOptimal * (sellProbability / 100),
    MARGIN_MIN, MARGIN_MAX, 0,
  ));

  // Optimization action: decide based on margin category, lift, sell prob
  let optimizationAction: OptimizationAction;
  if (currentMargin < 0) {
    optimizationAction = 'DISCOUNT_FOR_QUICK_SALE';
  } else if (marginLift > 5 && sellProbability > 60) {
    optimizationAction = 'SELL_AT_OPTIMAL';
  } else if (currentMargin > 50 && sellProbability < 40) {
    // High margin but unlikely to sell — reprice for higher prob
    optimizationAction = 'REPRICE';
  } else if (currentMargin > 30 && marginLift < 0) {
    // Current margin is good but optimal would lower it — hold for better margin
    optimizationAction = 'HOLD_FOR_BETTER_MARGIN';
  } else {
    optimizationAction = 'SELL_AT_OPTIMAL';
  }

  // Price confidence interval: ±10% around optimal (clamped to [0.5x, 1.3x] estValue)
  const ciLow = round0(Math.max(Math.round(estValue * 0.5), Math.round(optimalPrice * 0.9)));
  const ciHigh = round0(Math.min(Math.round(estValue * 1.3), Math.round(optimalPrice * 1.1)));

  // Reasoning (deterministic, slovenski)
  const reasoning = `Current margin ${currentMargin}% (${marginCategory}). Optimal price ${optimalPrice}€ daje ${expectedMarginAtOptimal}% margin (lift ${marginLift > 0 ? '+' : ''}${marginLift}pp) z ${sellProbability}% sell probability. Risk-adjusted margin: ${riskAdjustedMargin}%. Action: ${optimizationAction}.`.slice(0, 400);

  // Competitor pricing impact (deterministic, slovenski)
  const competitorPricingImpact = `Pri optimal ceni ${optimalPrice}€ si ${optimalPrice < estValue ? 'pod' : optimalPrice > estValue ? 'nad' : 'pri'} estValue (${estValue}€) — ${optimalPrice < estValue ? 'konkurenčno' : optimalPrice > estValue ? 'premium' : 'tržno'} pozicioniranje.`.slice(0, 300);

  return {
    item: {
      tradeId: t.id,
      title: clampString(t.title, 200, 'Item'),
      category: clampString(t.category, 50, 'drugo').toLowerCase() || 'drugo',
      buyPrice: round0(buyPrice),
      aiEstimatedValue,
      currentMargin,
      marginCategory,
      optimalPrice,
      expectedMarginAtOptimal,
      marginLift,
      sellProbability,
      riskAdjustedMargin,
      optimizationAction,
      priceConfidenceInterval: { low: ciLow, high: ciHigh },
      reasoning,
      competitorPricingImpact,
    },
    estValue,
  };
}

function computePortfolio(detItems: DetMarginItem[]): Portfolio {
  if (detItems.length === 0) {
    return {
      currentPortfolioMargin: 0,
      optimizedPortfolioMargin: 0,
      totalMarginLift: 0,
      marginOptimizationGrade: 'F',
      itemsToOptimize: 0,
      quickWins: 0,
    };
  }
  // Weighted average by totalCost (buyPrice + buyFees)
  let totalCost = 0;
  let currentWeightedMargin = 0;
  let optimizedWeightedMargin = 0;
  let itemsToOptimize = 0;
  let quickWins = 0;
  let totalLiftEuros = 0;
  for (const d of detItems) {
    const cost = d.item.buyPrice; // approximate (ignoring buyFees for weighting)
    totalCost += cost;
    currentWeightedMargin += d.item.currentMargin * cost;
    optimizedWeightedMargin += d.item.expectedMarginAtOptimal * cost;
    if (d.item.marginLift > 0 || d.item.optimizationAction !== 'SELL_AT_OPTIMAL') itemsToOptimize += 1;
    if (d.item.optimizationAction === 'DISCOUNT_FOR_QUICK_SALE' || d.item.marginLift > 5) quickWins += 1;
    // Margin lift in € = (marginLift / 100) × cost (per item)
    totalLiftEuros += (d.item.marginLift / 100) * cost;
  }
  const currentPortfolioMargin = totalCost > 0
    ? round2(clampNum(currentWeightedMargin / totalCost, MARGIN_MIN, MARGIN_MAX, 0))
    : 0;
  const optimizedPortfolioMargin = totalCost > 0
    ? round2(clampNum(optimizedWeightedMargin / totalCost, MARGIN_MIN, MARGIN_MAX, 0))
    : 0;
  const totalMarginLift = round0(clampNum(totalLiftEuros, LIFT_EUR_MIN, LIFT_EUR_MAX, 0));

  // Margin optimization grade: based on (a) how well-optimized current portfolio is, (b) potential lift
  // Score: 100 - |marginLift avg| (lower lift = better optimized) + currentPortfolioMargin / 2
  const avgLift = detItems.length > 0
    ? detItems.reduce((s, d) => s + Math.abs(d.item.marginLift), 0) / detItems.length
    : 0;
  const optimizationScore = clampNum(
    100 - avgLift + currentPortfolioMargin / 2,
    0, 100, 50,
  );
  let marginOptimizationGrade: MarginGrade;
  if (optimizationScore >= 90) marginOptimizationGrade = 'A+';
  else if (optimizationScore >= 80) marginOptimizationGrade = 'A';
  else if (optimizationScore >= 70) marginOptimizationGrade = 'B';
  else if (optimizationScore >= 55) marginOptimizationGrade = 'C';
  else if (optimizationScore >= 40) marginOptimizationGrade = 'D';
  else marginOptimizationGrade = 'F';

  return {
    currentPortfolioMargin,
    optimizedPortfolioMargin,
    totalMarginLift,
    marginOptimizationGrade,
    itemsToOptimize,
    quickWins,
  };
}

function buildSummary(portfolio: Portfolio, items: DetMarginItem[]): string {
  const topItem = [...items].sort((a, b) => b.item.marginLift - a.item.marginLift)[0];
  const parts: string[] = [
    `Portfolio margin: ${portfolio.currentPortfolioMargin}% → ${portfolio.optimizedPortfolioMargin}% (${portfolio.totalMarginLift > 0 ? '+' : ''}${portfolio.totalMarginLift}€ lift, grade ${portfolio.marginOptimizationGrade}).`,
    `${portfolio.itemsToOptimize} items za optimizacijo, ${portfolio.quickWins} quick wins.`,
  ];
  if (topItem) {
    parts.push(`Top item: ${topItem.item.title.slice(0, 40)} (${topItem.item.marginLift > 0 ? '+' : ''}${topItem.item.marginLift}pp lift).`);
  }
  return parts.join(' ').slice(0, 400);
}

// --- Prompt builder ------------------------------------------------------

interface PromptArgs {
  portfolio: Portfolio;
  topItemsForAI: Array<Record<string, unknown>>;
}

function buildPrompt(args: PromptArgs): string {
  const { portfolio, topItemsForAI } = args;

  const promptData = {
    portfolio,
    heldItems: topItemsForAI,
    caps: {
      scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
      marginLiftMin: MARGIN_LIFT_MIN, marginLiftMax: MARGIN_LIFT_MAX,
      probMin: PROB_MIN, probMax: PROB_MAX,
      priceMin: PRICE_MIN, priceMax: PRICE_MAX,
      liftEurMin: LIFT_EUR_MIN, liftEurMax: LIFT_EUR_MAX,
    },
  };

  return `Si AI "Inventory Profit Margin Optimizer Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PER-ITEM margin optimization — daješ SPECIFIČNE price target-e z confidence intervals za vsak HELD item posebej. Razlika od profit-margin-maximizer (v7.95 ki identificira optimization AREAS z actions) — ti daš PER-ITEM specific price targets z confidence intervals. Razlika od profit-margin-optimizer-v2 (ki optimizira margin aggregate) — ti optimiraš PER ITEM z optimalPrice + sellProbability. Razlika od price-optimization-engine-pro (v7.95 ki optimira CENE z A/B testing) — ti optimiraš MARGIN per item z risk-adjusted expected margin. Razlika od profit-margin-forecaster-pro (v7.85 ki forecast-a margin) — ti OPTIMIRAŠ margin z actionable per-item plan.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovin z linked Listing):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: za vsak tradeId iz heldItems, daj per-item optimization:
   - tradeId (string, MORA match-at enega iz heldItems — anti-hallucination),
   - optimalPrice € [0, 100000] (CLAMPED to [0.5x, 1.3x] estValue anti-hallucination; ±20% od detOptimalPrice),
   - sellProbability [0, 100] % (verjetnost prodaje pri optimalPrice; ±20 od detSellProbability),
   - optimizationAction: HOLD_FOR_BETTER_MARGIN | SELL_AT_OPTIMAL | DISCOUNT_FOR_QUICK_SALE | REPRICE,
   - reasoning (max 400, slovenski — zakaj ta cena maksimizira margin),
   - competitorPricingImpact (max 300, slovenski — kako competitors vplivajo na to priporočilo).
   Ostali field-i (currentMargin, marginCategory, expectedMarginAtOptimal, marginLift, riskAdjustedMargin, priceConfidenceInterval) se avtomatsko izračunajo iz optimalPrice v backendu.
2. portfolio.marginOptimizationGrade: A+ | A | B | C | D | F (kako dobro optimiziran je current portfolio; ±1 grade od deterministic).
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "items": [
    { "tradeId": "ckxxxxx", "optimalPrice": 365, "sellProbability": 75, "optimizationAction": "SELL_AT_OPTIMAL", "reasoning": "Pri 365€ dosežemo optimalno ravnovesje med margin in sell-through.", "competitorPricingImpact": "5% pod competitors — konkurenčno pozicioniranje." }
  ],
  "portfolio": {
    "marginOptimizationGrade": "B"
  },
  "summary": "Portfolio margin: 22% → 28% (+6pp, €420 lift, grade B). 8 items za optimizacijo, 3 quick wins."
}${GROUNDING_PROMPT_SUFFIX}`;
}

// --- AI response parser --------------------------------------------------

interface ParsedArgs {
  parsed: AiResponse | null;
  detItems: DetMarginItem[];
  portfolio: Portfolio;
}

function parseAiItems(args: ParsedArgs): {
  items: MarginItem[];
  portfolio: Portfolio;
  summary: string;
  aiUsed: boolean;
} {
  const { parsed, detItems, portfolio } = args;

  if (!parsed || typeof parsed !== 'object') {
    // Fallback to deterministic
    const items = detItems.map((d) => d.item);
    items.sort((a, b) => b.marginLift - a.marginLift);
    return {
      items,
      portfolio,
      summary: buildSummary(portfolio, detItems),
      aiUsed: false,
    };
  }

  // Build a quick lookup map of det items by tradeId
  const detByTradeId = new Map<string, DetMarginItem>();
  for (const d of detItems) detByTradeId.set(d.item.tradeId, d);

  // Parse per-item AI optimization
  const aiItems: MarginItem[] = [];
  if (parsed.items && Array.isArray(parsed.items)) {
    for (const r of parsed.items) {
      if (!r || typeof r !== 'object') continue;
      const det = detByTradeId.get(String(r.tradeId ?? ''));
      if (!det) continue; // skip unknown tradeId — anti-hallucination
      const aiOptimalPrice = round0(clampNum(
        r.optimalPrice,
        PRICE_MIN, PRICE_MAX,
        det.item.optimalPrice,
      ));
      // Anti-hallucination: clamp optimalPrice to [0.5x, 1.3x] estValue
      const estValue = det.estValue;
      const priceLowBound = Math.round(estValue * 0.5);
      const priceHighBound = Math.round(estValue * 1.3);
      const optimalPrice = round0(
        Math.max(priceLowBound, Math.min(priceHighBound, aiOptimalPrice)),
      );

      // Recompute derived fields based on optimalPrice
      const totalCost = det.item.buyPrice;
      const estFeesAtOptimal = Math.round(optimalPrice * 0.05);
      const netAtOptimal = optimalPrice - estFeesAtOptimal;
      const expectedMarginAtOptimal = totalCost > 0
        ? round2(clampNum(((netAtOptimal - totalCost) / totalCost) * 100, MARGIN_MIN, MARGIN_MAX, det.item.expectedMarginAtOptimal))
        : det.item.expectedMarginAtOptimal;
      const marginLift = round2(clampNum(
        expectedMarginAtOptimal - det.item.currentMargin,
        MARGIN_LIFT_MIN, MARGIN_LIFT_MAX, det.item.marginLift,
      ));
      const sellProbability = round0(clampNum(
        r.sellProbability,
        PROB_MIN, PROB_MAX,
        det.item.sellProbability,
      ));
      const riskAdjustedMargin = round2(clampNum(
        expectedMarginAtOptimal * (sellProbability / 100),
        MARGIN_MIN, MARGIN_MAX, det.item.riskAdjustedMargin,
      ));
      const optimizationAction = clampEnum(
        r.optimizationAction,
        VALID_ACTION,
        det.item.optimizationAction,
      );
      const priceConfidenceInterval = {
        low: round0(Math.max(priceLowBound, Math.round(optimalPrice * 0.9))),
        high: round0(Math.min(priceHighBound, Math.round(optimalPrice * 1.1))),
      };
      const reasoning = clampString(r.reasoning, 400, det.item.reasoning);
      const competitorPricingImpact = clampString(r.competitorPricingImpact, 300, det.item.competitorPricingImpact);

      aiItems.push({
        ...det.item,
        optimalPrice,
        expectedMarginAtOptimal,
        marginLift,
        sellProbability,
        riskAdjustedMargin,
        optimizationAction,
        priceConfidenceInterval,
        reasoning,
        competitorPricingImpact,
      });
    }
  }

  // Fallback to deterministic if AI returned nothing useful
  let items: MarginItem[];
  if (aiItems.length === 0) {
    items = detItems.map((d) => d.item);
  } else {
    // For items AI didn't return, keep deterministic values
    const aiTradeIds = new Set(aiItems.map((r) => r.tradeId));
    items = [...aiItems];
    for (const d of detItems) {
      if (!aiTradeIds.has(d.item.tradeId)) {
        items.push(d.item);
      }
    }
  }
  // Sort by marginLift descending (biggest improvement first)
  items.sort((a, b) => b.marginLift - a.marginLift);

  // Update portfolio margin based on AI items
  const aiPortfolio = computePortfolio(
    items.map((i) => ({ item: i, estValue: i.aiEstimatedValue ?? i.optimalPrice })),
  );
  // Apply AI grade ±1 from deterministic
  const aiGrade = clampEnum(parsed.portfolio?.marginOptimizationGrade, VALID_GRADE, portfolio.marginOptimizationGrade);
  // Validate: AI grade must be within ±1 of deterministic grade
  const gradeIdx = VALID_GRADE.indexOf(portfolio.marginOptimizationGrade);
  const aiGradeIdx = VALID_GRADE.indexOf(aiGrade);
  const finalGrade = Math.abs(aiGradeIdx - gradeIdx) <= 1 ? aiGrade : portfolio.marginOptimizationGrade;

  // Update portfolio (recompute with AI prices, use final grade)
  const updatedPortfolio: Portfolio = {
    ...aiPortfolio,
    marginOptimizationGrade: finalGrade,
  };

  const summary = clampString(parsed.summary, 400, buildSummary(updatedPortfolio, items.map((i) => ({ item: i, estValue: i.aiEstimatedValue ?? i.optimalPrice }))));

  return { items, portfolio: updatedPortfolio, summary, aiUsed: true };
}

// --- Handler -------------------------------------------------------------

const inventoryProfitMarginOptimizerProHandler = withAiRoute<InventoryProfitMarginOptimizerProInput>({
  endpoint: '/api/ai/inventory-profit-margin-optimizer-pro',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // dual GET+POST

  parseBody: async () => {
    // Body ignored
    return {};
  },

  // No validateInput — body ignored

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        category: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            price: true,
            aiScore: true,
            aiRisk: true,
            dealScore: true,
            monitor: { select: { tags: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as HeldItemRow[];

    // Empty-state: no HELD trades
    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        items: [],
        portfolio: {
          currentPortfolioMargin: 0,
          optimizedPortfolioMargin: 0,
          totalMarginLift: 0,
          marginOptimizationGrade: 'F',
          itemsToOptimize: 0,
          quickWins: 0,
        },
        summary: 'Ni HELD trgovin v inventarju — Inventory Profit Margin Optimizer Pro ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Inventory Profit Margin Optimizer Pro ni mogoč.',
      } satisfies InventoryMarginOptimizerResponse);
    }

    // 2) Compute per-item margin (deterministic baseline)
    const detItems = heldTrades.map((t) => computeMarginItem(t, now));
    const portfolio = computePortfolio(detItems);
    let items: MarginItem[] = detItems.map((d) => d.item);
    let summary = buildSummary(portfolio, detItems);

    // 3) AI cache check (6h TTL) — key by held item ids
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `inventory-profit-margin-optimizer-pro:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: MarginItem[];
      portfolio: Portfolio;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        items: cached.items,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryMarginOptimizerResponse);
    }

    // 4) AI prompt with grounding
    // Compact context for AI (top 40 items)
    const topItemsForAI = [...detItems]
      .sort((a, b) => Math.abs(b.item.marginLift) - Math.abs(a.item.marginLift))
      .slice(0, 40)
      .map((d) => ({
        tradeId: d.item.tradeId,
        title: d.item.title,
        category: d.item.category,
        buyPrice: d.item.buyPrice,
        estValue: d.estValue,
        currentMargin: d.item.currentMargin,
        marginCategory: d.item.marginCategory,
        detOptimalPrice: d.item.optimalPrice,
        detExpectedMargin: d.item.expectedMarginAtOptimal,
        detMarginLift: d.item.marginLift,
        detSellProbability: d.item.sellProbability,
        detRiskAdjustedMargin: d.item.riskAdjustedMargin,
        detOptimizationAction: d.item.optimizationAction,
        detCiLow: d.item.priceConfidenceInterval.low,
        detCiHigh: d.item.priceConfidenceInterval.high,
      }));

    const prompt = buildPrompt({ portfolio, topItemsForAI });

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;
      const result = parseAiItems({ parsed, detItems, portfolio });
      items = result.items;
      Object.assign(portfolio, result.portfolio);
      summary = result.summary;
      aiUsed = result.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-profit-margin-optimizer-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { items, portfolio, summary });
    }

    return apiOk({
      ok: true,
      items,
      portfolio,
      summary,
      aiUsed,
    } satisfies InventoryMarginOptimizerResponse);
  },
});

export const GET = inventoryProfitMarginOptimizerProHandler;
export const POST = inventoryProfitMarginOptimizerProHandler;
