// v6.62: AI Inventory Demand Forecaster — napove povpraševanje po kategorijah z ML
// POST /api/ai/inventory-demand-forecaster
// Body: { monthsAhead?: number, category?: string }
// Returns: { ok, forecaster: { current, forecast, categories, trends, mlModels, recommendations, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const monthsAhead = Math.max(1, Math.min(12, Number(body?.monthsAhead ?? 6)));
    const categoryFilter = body?.category ? String(body.category).toLowerCase() : null;

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true },
      take: 1000,
      orderBy: { sellDate: 'desc' },
    });

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true } } },
      take: 100,
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, forecaster: null, message: 'Ni prodaj za demand forecast.' });
    }

    // Compute category demand stats
    const catMap = new Map<string, { count: number; revenue: number; avgPrice: number; avgDaysToSell: number; monthlyAvg: number; trend: string }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      if (categoryFilter && !cat.includes(categoryFilter)) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000)));
      if (!catMap.has(cat)) catMap.set(cat, { count: 0, revenue: 0, avgPrice: 0, avgDaysToSell: 0, monthlyAvg: 0, trend: 'stable' });
      const c = catMap.get(cat)!;
      c.count += 1; c.revenue += revenue; c.avgDaysToSell += days;
    }
    catMap.forEach(c => {
      c.avgPrice = Math.round(c.revenue / c.count);
      c.avgDaysToSell = Math.round(c.avgDaysToSell / c.count);
      c.monthlyAvg = Math.round(c.count / 12 * 10) / 10;
    });

    const categoryStats = Array.from(catMap.entries()).map(([cat, c]) => ({ category: cat, ...c, revenue: Math.round(c.revenue) }))
      .sort((a, b) => b.count - a.count);

    // Current inventory by category
    const heldByCategory = new Map<string, number>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').toLowerCase();
      heldByCategory.set(cat, (heldByCategory.get(cat) ?? 0) + 1);
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const catStr = categoryStats.slice(0, 10).map(c =>
      `- ${c.category}: ${c.count}x sold (12m), ${c.monthlyAvg}/mesec, ${c.avgPrice}€ povp, ${c.avgDaysToSell}d povp, held: ${heldByCategory.get(c.category) ?? 0}`
    ).join('\n');

    const prompt = `Si AI inventory demand forecaster z ML za napoved povpraševanja.
Napove povpraševanje po kategorijah za naslednjih ${monthsAhead} mesecev.

KATEGORIJE (zadnjih 12m):
${catStr}

ML modeli za demand forecasting:
- ARIMA: time series forecasting
- LSTM: deep learning za sequential patterns
- PROPHET: Facebook Prophet za seasonal
- XGBOOST: gradient boosting
- ENSEMBLE: kombinacija vseh

Demand faktorji:
- HISTORICAL_TREND: zadnjih 12m trend
- SEASONALITY: mesečna nihanja
- MARKET_CONDITIONS: splošno povpraševanje
- COMPETITION: število konkurentov
- ECONOMIC_INDICATORS: gospodarski kazalci
- LOCAL_DEMAND: lokalno povpraševanje

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": {
    "total_sold_12m": <number>,
    "total_revenue_12m_eur": <number>,
    "avg_items_per_month": <number>,
    "top_category": "<max 50 znakov>",
    "fastest_moving_category": "<max 50 znakov>",
    "slowest_moving_category": "<max 50 znakov>"
  },
  "forecast": [
    {
      "month": <1-12>,
      "predicted_demand_items": <number>,
      "predicted_revenue_eur": <number>,
      "confidence_pct": <number 0-100>,
      "seasonal_factor": "<high|medium|low|negative>",
      "key_drivers": ["<max 80 znakov>"]
    }
  ],
  "categories": [
    {
      "category": "<kategorija>",
      "current_monthly_demand": <number>,
      "predicted_monthly_demand": <number>,
      "demand_change_pct": <number>,
      "current_held_count": <number>,
      "demand_supply_ratio": <number>,
      "recommended_action": "<stock_up|maintain|reduce|exit>",
      "predicted_revenue_eur": <number>,
      "trend": "<rising|stable|falling>",
      "seasonality_impact": "<high|medium|low>"
    }
  ],
  "trends": [
    {
      "trend_name": "<max 80 znakov>",
      "description": "<max 120 znakov>",
      "affected_categories": ["<kategorija>"],
      "trend_strength": <number 0-100>,
      "timeframe": "<short_term|medium_term|long_term>",
      "opportunity_level": "<high|medium|low>"
    }
  ],
  "ml_models": [
    {
      "model": "<arima|lstm|prophet|xgboost|ensemble>",
      "accuracy_pct": <number 0-100>,
      "mae": <number>,
      "weight_in_ensemble": <number 0-100>,
      "best_for": "<max 80 znakov>",
      "prediction_horizon_days": <number>
    }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "category_targeted": "<kategorija ali all>", "expected_revenue_impact_eur": <number>, "timeframe_days": <number> }
  ],
  "summary": {
    "total_categories_analyzed": <number>,
    "total_predicted_demand_${monthsAhead}m": <number>,
    "total_predicted_revenue_eur": <number>,
    "avg_confidence_pct": <number>,
    "best_model": "<max 80 znakov>",
    "biggest_demand_opportunity": "<max 100 znakov>",
    "biggest_demand_threat": "<max 100 znakov>",
    "demand_forecast_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validCats = new Set(categoryStats.map(c => c.category));

    const forecaster = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: {
        totalSold12m: Math.max(0, Number(parsed?.current?.total_sold_12m ?? soldTrades.length)),
        totalRevenue12mEur: Math.round(Number(parsed?.current?.total_revenue_12m_eur ?? soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0))),
        avgItemsPerMonth: Math.round(Number(parsed?.current?.avg_items_per_month ?? soldTrades.length / 12) * 10) / 10,
        topCategory: String(parsed?.current?.top_category ?? categoryStats[0]?.category ?? '').slice(0, 80),
        fastestMovingCategory: String(parsed?.current?.fastest_moving_category ?? '').slice(0, 80),
        slowestMovingCategory: String(parsed?.current?.slowest_moving_category ?? '').slice(0, 80),
      },
      forecast: (parsed?.forecast || []).slice(0, monthsAhead).map((f: any) => ({
        month: Math.max(1, Math.min(12, Number(f?.month ?? 1))),
        predictedDemandItems: Math.max(0, Math.round(Number(f?.predicted_demand_items ?? 0))),
        predictedRevenueEur: Math.round(Number(f?.predicted_revenue_eur ?? 0)),
        confidencePct: Math.max(0, Math.min(100, Number(f?.confidence_pct ?? 60))),
        seasonalFactor: ['high', 'medium', 'low', 'negative'].includes(String(f?.seasonal_factor)) ? String(f.seasonal_factor) : 'medium',
        keyDrivers: (f?.key_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      })),
      categories: (parsed?.categories || [])
        .filter((c: any) => validCats.has(String(c?.category ?? '')))
        .slice(0, 12)
        .map((c: any) => {
          const orig = categoryStats.find(x => x.category === String(c?.category));
          return {
            category: String(c?.category ?? '').slice(0, 50),
            currentMonthlyDemand: Math.round(Number(c?.current_monthly_demand ?? orig?.monthlyAvg ?? 0) * 10) / 10,
            predictedMonthlyDemand: Math.round(Number(c?.predicted_monthly_demand ?? 0) * 10) / 10,
            demandChangePct: Math.round(Number(c?.demand_change_pct ?? 0) * 10) / 10,
            currentHeldCount: Math.max(0, Number(c?.current_held_count ?? heldByCategory.get(String(c?.category)) ?? 0)),
            demandSupplyRatio: Math.round(Number(c?.demand_supply_ratio ?? 1) * 100) / 100,
            recommendedAction: ['stock_up', 'maintain', 'reduce', 'exit'].includes(String(c?.recommended_action)) ? String(c.recommended_action) : 'maintain',
            predictedRevenueEur: Math.round(Number(c?.predicted_revenue_eur ?? 0)),
            trend: ['rising', 'stable', 'falling'].includes(String(c?.trend)) ? String(c.trend) : 'stable',
            seasonalityImpact: ['high', 'medium', 'low'].includes(String(c?.seasonality_impact)) ? String(c.seasonality_impact) : 'medium',
          };
        }),
      trends: (parsed?.trends || []).slice(0, 6).map((t: any) => ({
        trendName: String(t?.trend_name ?? '').slice(0, 150),
        description: String(t?.description ?? '').slice(0, 250),
        affectedCategories: (t?.affected_categories || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)),
        trendStrength: Math.max(0, Math.min(100, Number(t?.trend_strength ?? 50))),
        timeframe: ['short_term', 'medium_term', 'long_term'].includes(String(t?.timeframe)) ? String(t.timeframe) : 'medium_term',
        opportunityLevel: ['high', 'medium', 'low'].includes(String(t?.opportunity_level)) ? String(t.opportunity_level) : 'medium',
      })),
      mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
        model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        mae: Math.round(Number(m?.mae ?? 0) * 100) / 100,
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
        bestFor: String(m?.best_for ?? '').slice(0, 150),
        predictionHorizonDays: Math.max(7, Number(m?.prediction_horizon_days ?? 30)),
      })),
      recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
        action: String(r?.action ?? '').slice(0, 300),
        priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
        categoryTargeted: String(r?.category_targeted ?? 'all').slice(0, 50),
        expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)),
        timeframeDays: Math.max(1, Number(r?.timeframe_days ?? 7)),
      })),
      summary: {
        totalCategoriesAnalyzed: categoryStats.length,
        totalPredictedDemandMonths: Math.max(0, Number(parsed?.summary?.[`total_predicted_demand_${monthsAhead}m`] ?? parsed?.summary?.total_predicted_demand_6m ?? 0)),
        totalPredictedRevenueEur: Math.round(Number(parsed?.summary?.total_predicted_revenue_eur ?? 0)),
        avgConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_confidence_pct ?? 60))),
        bestModel: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(parsed?.summary?.best_model)) ? String(parsed.summary.best_model) : 'ensemble',
        biggestDemandOpportunity: String(parsed?.summary?.biggest_demand_opportunity ?? '').slice(0, 200),
        biggestDemandThreat: String(parsed?.summary?.biggest_demand_threat ?? '').slice(0, 200),
        demandForecastScore: Math.max(0, Math.min(100, Number(parsed?.summary?.demand_forecast_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
