// v6.74 / v8.95.6-listing: AI Listing Price Elasticity Analyzer v2 — ML analiza cenovne elastičnosti z demand curve
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-price-elasticity-analyzer-v2
// Body: { tradeId?: string, category?: string }
// Returns: { ok, analyzer: { items, elasticity, demandCurves, optimalPrices, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ListingPriceElasticityInput {
  tradeId: string | null;
  category: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    dealScore: number | null;
    price: number | null;
  } | null;
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  sellPrice: number | null;
  sellFees: number | null;
  sellDate: Date | null;
  buyDate: Date;
}

interface PriceDropRow {
  id: string;
  title: string;
  price: number | null;
  previousPrice: number | null;
  priceDroppedAt: Date | null;
  firstSeenAt: Date | null;
}

interface ElasticityItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  currentPrice: number;
}

export const POST = withAiRoute<ListingPriceElasticityInput>({
  endpoint: '/api/ai/listing-price-elasticity-analyzer-v2',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      category: body?.category ? String(body.category).toLowerCase() : null,
    };
  },

  // No validateInput — tradeId in category sta opcijska (category v originalu unused, ohranjeno za isti input)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, price: true } } },
      take: tradeId ? 1 : 25,
    });
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const soldTrades: SoldTradeRow[] = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since90, not: null } },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 500,
      orderBy: { sellDate: 'desc' },
    });
    const listings: PriceDropRow[] = await db.listing.findMany({
      where: { firstSeenAt: { gte: since90 }, isHidden: false, price: { not: null, gt: 0 }, previousPrice: { not: null } },
      select: { id: true, title: true, price: true, previousPrice: true, priceDroppedAt: true, firstSeenAt: true },
      take: 300,
    });

    if (heldTrades.length === 0 && soldTrades.length === 0) {
      return apiOk({ ok: true, analyzer: null, message: 'Ni podatkov za price elasticity analizo.' });
    }

    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const dropsStr = buildDropsStr(listings);
    const prompt = buildPrompt(items, itemsStr, listings.length, dropsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const analyzer = transformAnalyzer(parsed, items);

    return apiOk({ ok: true, analyzer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildItems(heldTrades: HeldTradeRow[]): ElasticityItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, currentPrice: t.listing?.price ?? estValue };
  });
}

function buildItemsStr(items: ElasticityItem[]): string {
  return items.slice(0, 20).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.currentPrice}€`).join('\n');
}

function buildDropsStr(listings: PriceDropRow[]): string {
  return listings.slice(0, 10).map(l => `- "${l.title}" | ${l.previousPrice}€→${l.price}€ (-${Math.round(((l.previousPrice! - l.price!) / l.previousPrice!) * 100)}%)`).join('\n');
}

function buildPrompt(items: ElasticityItem[], itemsStr: string, listingsCount: number, dropsStr: string): string {
  return `Si AI listing price elasticity analyzer v2 z ML in demand curve modeling.
Analizira cenovno elastičnost in predlaga optimalne cene.

INVENTAR (${items.length}):
${itemsStr}

CENOVNI PADCI (${listingsCount}):
${dropsStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "current_price_eur": <number>, "elasticity_coefficient": <number>, "elasticity_type": "<elastic|inelastic|unitary|perfectly_elastic|perfectly_inelastic>", "optimal_price_eur": <number>, "current_vs_optimal_pct": <number>, "price_change_recommendation": "<increase|decrease|maintain>", "recommended_change_pct": <number>, "expected_demand_change_pct": <number>, "expected_revenue_change_pct": <number>, "expected_profit_change_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "elasticity": [
    { "category": "<kategorija>", "elasticity_coefficient": <number>, "elasticity_type": "<5 tipov>", "price_sensitivity": "<high|medium|low>", "optimal_pricing_strategy": "<penetration|skimming|premium|competitive|value>", "description": "<max 120 znakov>" }
  ],
  "demandCurves": [
    { "category": "<kategorija>", "curve_type": "<linear|exponential|logarithmic|step>", "price_points": [{"price_eur": <number>, "expected_demand_units": <number>, "expected_revenue_eur": <number>}], "revenue_maximizing_price_eur": <number>, "profit_maximizing_price_eur": <number>, "break_even_price_eur": <number> }
  ],
  "optimalPrices": [
    { "trade_id": "<id>", "current_price_eur": <number>, "optimal_price_eur": <number>, "change_eur": <number>, "change_pct": <number>, "rationale": "<max 120 znakov>", "expected_revenue_increase_eur": <number>, "expected_profit_increase_eur": <number> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<elasticity_coefficient|demand_at_price|optimal_price|revenue_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_items_analyzed": <number>, "avg_elasticity_coefficient": <number>, "most_elastic_category": "<max 80 znakov>",
    "most_inelastic_category": "<max 80 znakov>", "total_expected_revenue_increase_eur": <number>,
    "total_expected_profit_increase_eur": <number>, "biggest_pricing_opportunity": "<max 100 znakov>",
    "quickest_pricing_win": "<max 100 znakov>", "price_elasticity_score": <number 0-100>
  }
}`;
}

function transformAnalyzer(parsed: any, items: ElasticityItem[]): any {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 25).map((it: any) => {
      const orig = items.find(x => x.id === String(it?.id));
      return {
        tradeId: String(it?.id ?? ''),
        title: String(it?.title ?? orig?.title ?? '').slice(0, 100),
        currentPriceEur: Math.round(Number(it?.current_price_eur ?? orig?.currentPrice ?? 0)),
        elasticityCoefficient: Math.round(Number(it?.elasticity_coefficient ?? 1) * 100) / 100,
        elasticityType: ['elastic', 'inelastic', 'unitary', 'perfectly_elastic', 'perfectly_inelastic'].includes(String(it?.elasticity_type)) ? String(it.elasticity_type) : 'unitary',
        optimalPriceEur: Math.round(Number(it?.optimal_price_eur ?? 0)),
        currentVsOptimalPct: Math.round(Number(it?.current_vs_optimal_pct ?? 0) * 10) / 10,
        priceChangeRecommendation: ['increase', 'decrease', 'maintain'].includes(String(it?.price_change_recommendation)) ? String(it.price_change_recommendation) : 'maintain',
        recommendedChangePct: Math.round(Number(it?.recommended_change_pct ?? 0) * 10) / 10,
        expectedDemandChangePct: Math.round(Number(it?.expected_demand_change_pct ?? 0) * 10) / 10,
        expectedRevenueChangePct: Math.round(Number(it?.expected_revenue_change_pct ?? 0) * 10) / 10,
        expectedProfitChangeEur: Math.round(Number(it?.expected_profit_change_eur ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(it?.confidence_pct ?? 60))),
      };
    }),
    elasticity: (parsed?.elasticity || []).slice(0, 10).map((e: any) => ({
      category: String(e?.category ?? '').slice(0, 50),
      elasticityCoefficient: Math.round(Number(e?.elasticity_coefficient ?? 1) * 100) / 100,
      elasticityType: ['elastic', 'inelastic', 'unitary', 'perfectly_elastic', 'perfectly_inelastic'].includes(String(e?.elasticity_type)) ? String(e.elasticity_type) : 'unitary',
      priceSensitivity: ['high', 'medium', 'low'].includes(String(e?.price_sensitivity)) ? String(e.price_sensitivity) : 'medium',
      optimalPricingStrategy: ['penetration', 'skimming', 'premium', 'competitive', 'value'].includes(String(e?.optimal_pricing_strategy)) ? String(e.optimal_pricing_strategy) : 'competitive',
      description: String(e?.description ?? '').slice(0, 250),
    })),
    demandCurves: (parsed?.demandCurves || []).slice(0, 10).map((d: any) => ({
      category: String(d?.category ?? '').slice(0, 50),
      curveType: ['linear', 'exponential', 'logarithmic', 'step'].includes(String(d?.curve_type)) ? String(d.curve_type) : 'linear',
      pricePoints: (d?.price_points || []).slice(0, 8).map((p: any) => ({
        priceEur: Math.round(Number(p?.price_eur ?? 0)),
        expectedDemandUnits: Math.max(0, Number(p?.expected_demand_units ?? 0)),
        expectedRevenueEur: Math.round(Number(p?.expected_revenue_eur ?? 0)),
      })),
      revenueMaximizingPriceEur: Math.round(Number(d?.revenue_maximizing_price_eur ?? 0)),
      profitMaximizingPriceEur: Math.round(Number(d?.profit_maximizing_price_eur ?? 0)),
      breakEvenPriceEur: Math.round(Number(d?.break_even_price_eur ?? 0)),
    })),
    optimalPrices: (parsed?.optimalPrices || []).filter((o: any) => validIds.has(String(o?.trade_id ?? ''))).slice(0, 25).map((o: any) => {
      const orig = items.find(x => x.id === String(o?.trade_id));
      return {
        tradeId: String(o?.trade_id ?? ''),
        currentPriceEur: Math.round(Number(o?.current_price_eur ?? orig?.currentPrice ?? 0)),
        optimalPriceEur: Math.round(Number(o?.optimal_price_eur ?? 0)),
        changeEur: Math.round(Number(o?.change_eur ?? 0)),
        changePct: Math.round(Number(o?.change_pct ?? 0) * 10) / 10,
        rationale: String(o?.rationale ?? '').slice(0, 250),
        expectedRevenueIncreaseEur: Math.round(Number(o?.expected_revenue_increase_eur ?? 0)),
        expectedProfitIncreaseEur: Math.round(Number(o?.expected_profit_increase_eur ?? 0)),
      };
    }),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
      predictionType: ['elasticity_coefficient', 'demand_at_price', 'optimal_price', 'revenue_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'elasticity_coefficient',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalItemsAnalyzed: items.length,
      avgElasticityCoefficient: Math.round(Number(parsed?.summary?.avg_elasticity_coefficient ?? 1) * 100) / 100,
      mostElasticCategory: String(parsed?.summary?.most_elastic_category ?? '').slice(0, 150),
      mostInelasticCategory: String(parsed?.summary?.most_inelastic_category ?? '').slice(0, 150),
      totalExpectedRevenueIncreaseEur: Math.round(Number(parsed?.summary?.total_expected_revenue_increase_eur ?? 0)),
      totalExpectedProfitIncreaseEur: Math.round(Number(parsed?.summary?.total_expected_profit_increase_eur ?? 0)),
      biggestPricingOpportunity: String(parsed?.summary?.biggest_pricing_opportunity ?? '').slice(0, 200),
      quickestPricingWin: String(parsed?.summary?.quickest_pricing_win ?? '').slice(0, 200),
      priceElasticityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.price_elasticity_score ?? 60))),
    },
  };
}
