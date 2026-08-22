// v6.52 / v8.96.3-batch2: AI Listing Performance Tracker v2 — ML predikcija konverzije z demographic data
// Refaktoriran z withAiRoute helperjem (v8.96.3) + enforceBudget guard.
//
// POST /api/ai/listing-performance-tracker-v2
// Body: { tradeId?: string, days?: number }
// Returns: { ok, tracker: { listings, mlPredictions, demographicFactors, channelAnalysis, timeSeries, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ListingPerformanceTrackerInput {
  tradeId: string | null;
  days: number;
}

export const POST = withAiRoute<ListingPerformanceTrackerInput>({
  endpoint: '/api/ai/listing-performance-tracker-v2',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      days: Math.max(7, Math.min(365, Number(body?.days ?? 30))),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, days } = input;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. Pridobi sold trades z listing info
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: since } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true, sellLocation: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, location: true, firstSeenAt: true, monitor: { select: { name: true, source: true } } } },
      },
      take: 200,
      orderBy: { sellDate: 'desc' },
    });

    // 2. Pridobi held trades
    const heldWhere: any = { status: 'held' };
    if (tradeId) heldWhere.id = tradeId;
    const heldTrades = await db.trade.findMany({
      where: heldWhere,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiScore: true, aiRisk: true, location: true, imageUrl: true, monitor: { select: { name: true, source: true } } } },
      },
      take: tradeId ? 1 : 25,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, tracker: null, message: 'Ni held tradeov za ML analizo.' });
    }

    // 3. Agregacija sold data za ML features
    const soldByCategory = new Map<string, { count: number; avgDaysToSell: number; avgMarginPct: number; avgSellPrice: number }>();
    const soldByLocation = new Map<string, { count: number; avgDaysToSell: number; avgSellPrice: number }>();
    const soldBySource = new Map<string, { count: number; avgDaysToSell: number; avgSellPrice: number }>();

    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;
      const marginPct = cost > 0 ? (profit / cost) * 100 : 0;
      const daysToSell = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
      const sellPrice = t.sellPrice ?? 0;

      if (!soldByCategory.has(cat)) soldByCategory.set(cat, { count: 0, avgDaysToSell: 0, avgMarginPct: 0, avgSellPrice: 0 });
      const c = soldByCategory.get(cat)!;
      c.count += 1; c.avgDaysToSell += daysToSell; c.avgMarginPct += marginPct; c.avgSellPrice += sellPrice;

      const loc = (t.sellLocation || 'unknown').trim();
      if (!soldByLocation.has(loc)) soldByLocation.set(loc, { count: 0, avgDaysToSell: 0, avgSellPrice: 0 });
      const l = soldByLocation.get(loc)!;
      l.count += 1; l.avgDaysToSell += daysToSell; l.avgSellPrice += sellPrice;

      const src = t.listing?.monitor?.source || 'bolha';
      if (!soldBySource.has(src)) soldBySource.set(src, { count: 0, avgDaysToSell: 0, avgSellPrice: 0 });
      const s = soldBySource.get(src)!;
      s.count += 1; s.avgDaysToSell += daysToSell; s.avgSellPrice += sellPrice;
    }

    // Normalize averages
    soldByCategory.forEach(v => {
      if (v.count > 0) {
        v.avgDaysToSell = Math.round(v.avgDaysToSell / v.count);
        v.avgMarginPct = Math.round((v.avgMarginPct / v.count) * 10) / 10;
        v.avgSellPrice = Math.round(v.avgSellPrice / v.count);
      }
    });
    soldByLocation.forEach(v => {
      if (v.count > 0) {
        v.avgDaysToSell = Math.round(v.avgDaysToSell / v.count);
        v.avgSellPrice = Math.round(v.avgSellPrice / v.count);
      }
    });
    soldBySource.forEach(v => {
      if (v.count > 0) {
        v.avgDaysToSell = Math.round(v.avgDaysToSell / v.count);
        v.avgSellPrice = Math.round(v.avgSellPrice / v.count);
      }
    });

    // 4. ML features za held items
    const itemsWithFeatures = heldTrades.map(t => {
      const cat = (t.category || 'drugo').toLowerCase();
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
      const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24*60*60*1000));
      const catStats = soldByCategory.get(cat);
      const sourceStats = soldBySource.get(t.listing?.monitor?.source || 'bolha');
      return {
        id: t.id, title: t.title, category: cat, cost, estValue, daysHeld,
        dealScore: t.listing?.dealScore ?? 50,
        aiScore: t.listing?.aiScore ?? 5,
        aiRisk: t.listing?.aiRisk ?? 5,
        location: t.listing?.location || '',
        source: t.listing?.monitor?.source || 'bolha',
        catAvgDaysToSell: catStats?.avgDaysToSell ?? 14,
        catAvgMarginPct: catStats?.avgMarginPct ?? 25,
        catAvgSellPrice: catStats?.avgSellPrice ?? estValue,
        sourceAvgDaysToSell: sourceStats?.avgDaysToSell ?? 14,
      };
    });

    const itemsStr = itemsWithFeatures.slice(0, 20).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore} AI ${i.aiScore} risk ${i.aiRisk} | cat avg ${i.catAvgDaysToSell}d, ${i.catAvgMarginPct}% margin | source ${i.source} avg ${i.sourceAvgDaysToSell}d`
    ).join('\n');

    const catStr = Array.from(soldByCategory.entries()).slice(0, 8).map(([cat, v]) =>
      `- ${cat}: ${v.count}x sold, ${v.avgDaysToSell}d povp, ${v.avgMarginPct}% margin, ${v.avgSellPrice}€ povp cena`
    ).join('\n');

    const srcStr = Array.from(soldBySource.entries()).slice(0, 5).map(([src, v]) =>
      `- ${src}: ${v.count}x sold, ${v.avgDaysToSell}d povp, ${v.avgSellPrice}€ povp cena`
    ).join('\n');

    const prompt = buildPrompt(itemsStr, catStr, srcStr, itemsWithFeatures.length, days);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const tracker = transformTracker(parsed, itemsWithFeatures);

    return apiOk({ ok: true, tracker });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildPrompt(itemsStr: string, catStr: string, srcStr: string, itemsLength: number, days: number): string {
  return `Si AI listing performance tracker v2 z ML modelom za predikcijo konverzije.
Uporabi historical data in ML features za napovedovanje performance za vsak held item.

ML FEATURES (inputs):
- Item: title, category, cost, estValue, daysHeld, dealScore, aiScore, aiRisk, location, source
- Category stats: avgDaysToSell, avgMarginPct, avgSellPrice
- Source stats: avgDaysToSell
- Demographic: location (city/region), source (bolha/facebook/vinted/ebay)

HELD INVENTAR (${itemsLength}):
${itemsStr}

HISTORICAL DATA (zadnjih ${days} dni):
KATEGORIJE:
${catStr}

VIRI:
${srcStr}

ML predikcijski modeli:
1. CONVERSION_PROBABILITY: verjetnost prodaje v 30 dneh (0-100)
2. TIME_TO_SELL_PREDICTION: napoved dni do prodaje
3. FINAL_PRICE_PREDICTION: napoved končne prodajne cene (EUR)
4. PROFIT_PREDICTION: napoved dobička (EUR)
5. INQUIRY_RATE: pričakovano število povpraševanj v 7 dneh
6. VIEW_RATE: pričakovano število ogledov v 7 dneh
7. BOUNCE_RATE: % kupcev ki gledajo a ne povprašajo
8. NEGOTIATION_PROBABILITY: verjetnost pogajanja

Demographic faktorji:
- LOCATION_IMPACT: mesto/regija vpliva na ceno in hitrost prodaje
- SOURCE_PREFERENCE: katere platforme delujejo bolje za to kategorijo
- AUDIENCE_MATCH: kako dobro item ustreza publiki platforme
- SEASONAL_FIT: ali je čas ugoden za to kategorijo

Channel analysis (katere platforme za vsak item):
- BOLHA: lokalno slovenski, 0% fee, dober za večino kategorij
- FACEBOOK: širši demographics, 0% fee, dober za emotional items
- VINTED: modno ozaveščeni, 5% fee, dober za modo inštrumente
- EBAY: mednarodni, 10% fee, dober za collector items
- KLEINANZEIGEN: nemški, 0% fee, dober za pohištvo in elektroniko

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "ml_predictions": {
        "conversion_probability_30d_pct": <number 0-100>,
        "predicted_time_to_sell_days": <number>,
        "predicted_final_price_eur": <number>,
        "predicted_profit_eur": <number>,
        "predicted_inquiries_7d": <number>,
        "predicted_views_7d": <number>,
        "bounce_rate_pct": <number 0-100>,
        "negotiation_probability_pct": <number 0-100>
      },
      "demographic_match": {
        "location_impact_score": <number 0-100>,
        "best_source": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
        "audience_match_score": <number 0-100>,
        "seasonal_fit_score": <number 0-100>
      },
      "performance_forecast": {
        "next_7d_views": <number>,
        "next_7d_inquiries": <number>,
        "next_30d_sale_probability_pct": <number>,
        "next_90d_sale_probability_pct": <number>
      },
      "risk_factors": ["<max 80 znakov>"],
      "opportunity_factors": ["<max 80 znakov>"],
      "recommended_action": "<hold|price_adjust|relist|cross_post|bundle|liquidate>",
      "confidence_score": <number 0-100>
    }
  ],
  "ml_predictions": [
    { "metric": "<conversion_probability|time_to_sell|final_price|profit|inquiry_rate|view_rate|bounce_rate|negotiation_probability>", "avg_value": <number>, "min_value": <number>, "max_value": <number>, "std_dev": <number>, "trend": "<up|down|stable>", "confidence_pct": <number 0-100> }
  ],
  "demographic_factors": [
    { "factor": "<location_impact|source_preference|audience_match|seasonal_fit>", "weight": <number 0-100>, "description": "<max 100 znakov>", "best_performing_value": "<max 80 znakov>", "impact_on_conversion_pct": <number> }
  ],
  "channel_analysis": [
    { "source": "<bolha|facebook|vinted|ebay|kleinanzeigen>", "items_recommended": <number>, "avg_predicted_conversion_pct": <number>, "avg_predicted_days_to_sell": <number>, "total_predicted_revenue_eur": <number>, "fee_pct": <number>, "net_revenue_eur": <number> }
  ],
  "time_series": [
    { "day_offset": <number 0-30>, "predicted_views": <number>, "predicted_inquiries": <number>, "predicted_sales": <number>, "cumulative_revenue_eur": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "items_affected": <number>, "expected_revenue_impact_eur": <number>, "implementation_effort": "<low|medium|high>" }
  ],
  "summary": {
    "total_items_analyzed": <number>,
    "avg_conversion_probability_30d_pct": <number>,
    "avg_predicted_time_to_sell_days": <number>,
    "total_predicted_revenue_eur": <number>,
    "total_predicted_profit_eur": <number>,
    "best_performing_source": "<max 80 znakov>",
    "best_performing_category": "<max 80 znakov>",
    "ml_confidence_avg_pct": <number>,
    "biggest_opportunity_id": "<trade_id>",
    "biggest_risk_id": "<trade_id>",
    "performance_prediction_score": <number 0-100>
  }
}`;
}

interface ItemWithFeatures {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  dealScore: number;
  aiScore: number;
  aiRisk: number;
  location: string;
  source: string;
  catAvgDaysToSell: number;
  catAvgMarginPct: number;
  catAvgSellPrice: number;
  sourceAvgDaysToSell: number;
}

function transformTracker(parsed: any, itemsWithFeatures: ItemWithFeatures[]): any {
  const validIds = new Set(itemsWithFeatures.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 25)
      .map((l: any) => {
        const orig = itemsWithFeatures.find(x => x.id === String(l?.id));
        return {
          tradeId: String(l?.id ?? ''),
          title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
          mlPredictions: {
            conversionProbability30dPct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.conversion_probability_30d_pct ?? 50))),
            predictedTimeToSellDays: Math.max(0, Math.round(Number(l?.ml_predictions?.predicted_time_to_sell_days ?? orig?.catAvgDaysToSell ?? 14))),
            predictedFinalPriceEur: Math.max(0, Math.round(Number(l?.ml_predictions?.predicted_final_price_eur ?? orig?.estValue ?? 0))),
            predictedProfitEur: Math.round(Number(l?.ml_predictions?.predicted_profit_eur ?? 0)),
            predictedInquiries7d: Math.max(0, Math.round(Number(l?.ml_predictions?.predicted_inquiries_7d ?? 0))),
            predictedViews7d: Math.max(0, Math.round(Number(l?.ml_predictions?.predicted_views_7d ?? 0))),
            bounceRatePct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.bounce_rate_pct ?? 60))),
            negotiationProbabilityPct: Math.max(0, Math.min(100, Number(l?.ml_predictions?.negotiation_probability_pct ?? 30))),
          },
          demographicMatch: {
            locationImpactScore: Math.max(0, Math.min(100, Number(l?.demographic_match?.location_impact_score ?? 50))),
            bestSource: ['bolha', 'facebook', 'vinted', 'ebay', 'kleinanzeigen'].includes(String(l?.demographic_match?.best_source)) ? String(l.demographic_match.best_source) : 'bolha',
            audienceMatchScore: Math.max(0, Math.min(100, Number(l?.demographic_match?.audience_match_score ?? 50))),
            seasonalFitScore: Math.max(0, Math.min(100, Number(l?.demographic_match?.seasonal_fit_score ?? 50))),
          },
          performanceForecast: {
            next7dViews: Math.max(0, Math.round(Number(l?.performance_forecast?.next_7d_views ?? 0))),
            next7dInquiries: Math.max(0, Math.round(Number(l?.performance_forecast?.next_7d_inquiries ?? 0))),
            next30dSaleProbabilityPct: Math.max(0, Math.min(100, Number(l?.performance_forecast?.next_30d_sale_probability_pct ?? 30))),
            next90dSaleProbabilityPct: Math.max(0, Math.min(100, Number(l?.performance_forecast?.next_90d_sale_probability_pct ?? 60))),
          },
          riskFactors: (l?.risk_factors || []).slice(0, 5).map((r: any) => String(r).slice(0, 150)),
          opportunityFactors: (l?.opportunity_factors || []).slice(0, 5).map((o: any) => String(o).slice(0, 150)),
          recommendedAction: ['hold', 'price_adjust', 'relist', 'cross_post', 'bundle', 'liquidate'].includes(String(l?.recommended_action)) ? String(l.recommended_action) : 'hold',
          confidenceScore: Math.max(0, Math.min(100, Number(l?.confidence_score ?? 50))),
        };
      }),
    mlPredictions: (parsed?.ml_predictions || []).slice(0, 8).map((m: any) => ({
      metric: ['conversion_probability', 'time_to_sell', 'final_price', 'profit', 'inquiry_rate', 'view_rate', 'bounce_rate', 'negotiation_probability'].includes(String(m?.metric)) ? String(m.metric) : 'conversion_probability',
      avgValue: Math.round(Number(m?.avg_value ?? 0) * 100) / 100,
      minValue: Math.round(Number(m?.min_value ?? 0) * 100) / 100,
      maxValue: Math.round(Number(m?.max_value ?? 0) * 100) / 100,
      stdDev: Math.round(Number(m?.std_dev ?? 0) * 100) / 100,
      trend: ['up', 'down', 'stable'].includes(String(m?.trend)) ? String(m.trend) : 'stable',
      confidencePct: Math.max(0, Math.min(100, Number(m?.confidence_pct ?? 50))),
    })),
    demographicFactors: (parsed?.demographic_factors || []).slice(0, 4).map((d: any) => ({
      factor: ['location_impact', 'source_preference', 'audience_match', 'seasonal_fit'].includes(String(d?.factor)) ? String(d.factor) : 'audience_match',
      weight: Math.max(0, Math.min(100, Number(d?.weight ?? 50))),
      description: String(d?.description ?? '').slice(0, 200),
      bestPerformingValue: String(d?.best_performing_value ?? '').slice(0, 150),
      impactOnConversionPct: Math.round(Number(d?.impact_on_conversion_pct ?? 0)),
    })),
    channelAnalysis: (parsed?.channel_analysis || []).slice(0, 5).map((c: any) => ({
      source: ['bolha', 'facebook', 'vinted', 'ebay', 'kleinanzeigen'].includes(String(c?.source)) ? String(c.source) : 'bolha',
      itemsRecommended: Math.max(0, Number(c?.items_recommended ?? 0)),
      avgPredictedConversionPct: Math.max(0, Math.min(100, Number(c?.avg_predicted_conversion_pct ?? 30))),
      avgPredictedDaysToSell: Math.round(Number(c?.avg_predicted_days_to_sell ?? 14)),
      totalPredictedRevenueEur: Math.round(Number(c?.total_predicted_revenue_eur ?? 0)),
      feePct: Math.round(Number(c?.fee_pct ?? 0)),
      netRevenueEur: Math.round(Number(c?.net_revenue_eur ?? 0)),
    })),
    timeSeries: (parsed?.time_series || []).slice(0, 30).map((t: any) => ({
      dayOffset: Math.max(0, Math.min(30, Number(t?.day_offset ?? 0))),
      predictedViews: Math.max(0, Math.round(Number(t?.predicted_views ?? 0))),
      predictedInquiries: Math.max(0, Math.round(Number(t?.predicted_inquiries ?? 0))),
      predictedSales: Math.max(0, Math.round(Number(t?.predicted_sales ?? 0))),
      cumulativeRevenueEur: Math.round(Number(t?.cumulative_revenue_eur ?? 0)),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      itemsAffected: Math.max(0, Number(r?.items_affected ?? 0)),
      expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
      implementationEffort: ['low', 'medium', 'high'].includes(String(r?.implementation_effort)) ? String(r.implementation_effort) : 'medium',
    })),
    summary: {
      totalItemsAnalyzed: itemsWithFeatures.length,
      avgConversionProbability30dPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_conversion_probability_30d_pct ?? 50))),
      avgPredictedTimeToSellDays: Math.max(0, Math.round(Number(parsed?.summary?.avg_predicted_time_to_sell_days ?? 14))),
      totalPredictedRevenueEur: Math.round(Number(parsed?.summary?.total_predicted_revenue_eur ?? 0)),
      totalPredictedProfitEur: Math.round(Number(parsed?.summary?.total_predicted_profit_eur ?? 0)),
      bestPerformingSource: ['bolha', 'facebook', 'vinted', 'ebay', 'kleinanzeigen'].includes(String(parsed?.summary?.best_performing_source)) ? String(parsed.summary.best_performing_source) : 'bolha',
      bestPerformingCategory: String(parsed?.summary?.best_performing_category ?? '').slice(0, 150),
      mlConfidenceAvgPct: Math.max(0, Math.min(100, Number(parsed?.summary?.ml_confidence_avg_pct ?? 50))),
      biggestOpportunityId: String(parsed?.summary?.biggest_opportunity_id ?? '').slice(0, 50),
      biggestRiskId: String(parsed?.summary?.biggest_risk_id ?? '').slice(0, 50),
      performancePredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.performance_prediction_score ?? 50))),
    },
  };
}
