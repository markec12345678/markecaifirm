// v6.81: AI Inventory Demand Forecaster — ML napoved povpraševanja za kategorije inventarja
// POST /api/ai/inventory-demand-forecaster
// Body: { days?: number, horizonDays?: number }
// Returns: { ok, forecaster: { overview, categoryForecasts, trendAnalysis, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const TREND_DIRECTIONS = ['rising', 'stable', 'declining', 'volatile', 'seasonal'] as const;
const DEMAND_TIERS = ['oversupply', 'balanced', 'undersupply', 'critical_shortage', 'no_supply'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));
    const horizonDays = Math.max(7, Math.min(180, Number(body?.horizonDays ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellDate: true, buyDate: true }, take: 1000, orderBy: { sellDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true }, take: 200 });
    if (soldTrades.length === 0 && heldTrades.length === 0) return NextResponse.json({ ok: true, forecaster: null, message: 'Ni podatkov za demand forecast.' });

    const categoryStats = new Map<string, { sold: number; held: number; revenue: number; avgPrice: number }>();
    for (const t of soldTrades) {
      const cat = t.category || 'unknown';
      if (!categoryStats.has(cat)) categoryStats.set(cat, { sold: 0, held: 0, revenue: 0, avgPrice: 0 });
      const s = categoryStats.get(cat)!;
      s.sold += 1; s.revenue += (t.sellPrice ?? 0);
    }
    for (const t of heldTrades) {
      const cat = t.category || 'unknown';
      if (!categoryStats.has(cat)) categoryStats.set(cat, { sold: 0, held: 0, revenue: 0, avgPrice: 0 });
      categoryStats.get(cat)!.held += 1;
    }
    for (const s of categoryStats.values()) { s.avgPrice = s.sold > 0 ? Math.round(s.revenue / s.sold) : 0; }

    const totalSold = soldTrades.length;
    const totalHeld = heldTrades.length;
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const catList = Array.from(categoryStats.entries()).slice(0, 12).map(([cat, s]) => `- ${cat} | sold: ${s.sold} | held: ${s.held} | rev: ${Math.round(s.revenue)}€ | avg: ${s.avgPrice}€`).join('\n');

    const prompt = `Si AI inventory demand forecaster z ML in time series forecasting.
Napoveduje povpraševanje za kategorije inventarja na ${horizonDays} dni naprej.

STATS (zadnjih ${days} dni):
- Skupno prodano: ${totalSold} | vrednost: ${Math.round(totalRevenue)}€
- Skupno na zalogi: ${totalHeld}

KATEGORIJE:
${catList}

5 trend smeri: rising, stable, declining, volatile, seasonal
5 demand tierjev: oversupply, balanced, undersupply, critical_shortage, no_supply

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_categories": <number>, "total_sold_items": <number>, "total_held_items": <number>, "total_revenue_eur": <number>, "avg_demand_score": <number 0-100>, "forecast_confidence_pct": <number 0-100>, "demand_forecast_grade": "<A|B|C|D|F>" },
  "categoryForecasts": [
    { "category": "<string>", "current_demand_score": <number 0-100>, "predicted_demand_30d": <number>, "predicted_demand_90d": <number>, "demand_trend": "<${TREND_DIRECTIONS.join('|')}>", "demand_tier": "<${DEMAND_TIERS.join('|')}>", "supply_vs_demand_ratio": <number 0-3>, "recommended_stock_level": <number>, "urgency": "<critical|high|medium|low>" }
  ],
  "trendAnalysis": [
    { "category": "<string>", "trend_direction": "<${TREND_DIRECTIONS.join('|')}>", "trend_strength_pct": <number 0-100>, "seasonality_factor": <number 0.5-2.0>, "anomaly_detected": <boolean>, "anomaly_description": "<max 100 znakov>", "forecast_horizon_days": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "category": "<string>", "action_type": "<restock|liquidate|hold|source|diversify>", "expected_revenue_impact_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<prophet|arima|lstm|gradient_boosting|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<demand_forecast|trend_analysis|seasonality_detection|anomaly_detection>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "demand_forecast_score": <number 0-100>, "demand_forecast_grade": "<A|B|C|D|F>", "total_predicted_demand_30d": <number>,
    "critical_categories_count": <number>, "oversupply_categories_count": <number>,
    "biggest_demand_risk": "<max 100 znakov>", "biggest_demand_opportunity": "<max 100 znakov>",
    "quickest_demand_win": "<max 100 znakov>", "demand_forecast_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const forecaster = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalCategories: Math.max(0, Number(parsed?.overview?.total_categories ?? categoryStats.size)), totalSoldItems: Math.max(0, Number(parsed?.overview?.total_sold_items ?? totalSold)), totalHeldItems: Math.max(0, Number(parsed?.overview?.total_held_items ?? totalHeld)), totalRevenueEur: Math.round(Number(parsed?.overview?.total_revenue_eur ?? totalRevenue)), avgDemandScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_demand_score ?? 50))), forecastConfidencePct: Math.max(0, Math.min(100, Number(parsed?.overview?.forecast_confidence_pct ?? 70))), demandForecastGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.demand_forecast_grade)) ? String(parsed.overview.demand_forecast_grade) : 'C' },
      categoryForecasts: (parsed?.categoryForecasts || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), currentDemandScore: Math.max(0, Math.min(100, Number(c?.current_demand_score ?? 50))), predictedDemand30d: Math.max(0, Number(c?.predicted_demand_30d ?? 0)), predictedDemand90d: Math.max(0, Number(c?.predicted_demand_90d ?? 0)), demandTrend: (TREND_DIRECTIONS as readonly string[]).includes(String(c?.demand_trend)) ? String(c.demand_trend) : 'stable', demandTier: (DEMAND_TIERS as readonly string[]).includes(String(c?.demand_tier)) ? String(c.demand_tier) : 'balanced', supplyVsDemandRatio: Math.max(0, Math.min(3, Number(c?.supply_vs_demand_ratio ?? 1))), recommendedStockLevel: Math.max(0, Number(c?.recommended_stock_level ?? 0)), urgency: ['critical', 'high', 'medium', 'low'].includes(String(c?.urgency)) ? String(c.urgency) : 'medium' })),
      trendAnalysis: (parsed?.trendAnalysis || []).slice(0, 12).map((t: any) => ({ category: String(t?.category ?? '').slice(0, 50), trendDirection: (TREND_DIRECTIONS as readonly string[]).includes(String(t?.trend_direction)) ? String(t.trend_direction) : 'stable', trendStrengthPct: Math.max(0, Math.min(100, Number(t?.trend_strength_pct ?? 50))), seasonalityFactor: Math.max(0.5, Math.min(2.0, Number(t?.seasonality_factor ?? 1.0))), anomalyDetected: Boolean(t?.anomaly_detected ?? false), anomalyDescription: String(t?.anomaly_description ?? '').slice(0, 200), forecastHorizonDays: Math.max(1, Number(t?.forecast_horizon_days ?? horizonDays)) })),
      recommendations: (parsed?.recommendations || []).slice(0, 8).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), category: String(r?.category ?? '').slice(0, 50), actionType: ['restock', 'liquidate', 'hold', 'source', 'diversify'].includes(String(r?.action_type)) ? String(r.action_type) : 'hold', expectedRevenueImpactEur: Math.round(Number(r?.expected_revenue_impact_eur ?? 0)), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'arima', 'lstm', 'gradient_boosting', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['demand_forecast', 'trend_analysis', 'seasonality_detection', 'anomaly_detection'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'demand_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { demandForecastScore: Math.max(0, Math.min(100, Number(parsed?.summary?.demand_forecast_score ?? 50))), demandForecastGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.demand_forecast_grade)) ? String(parsed.summary.demand_forecast_grade) : 'C', totalPredictedDemand30d: Math.max(0, Number(parsed?.summary?.total_predicted_demand_30d ?? 0)), criticalCategoriesCount: Math.max(0, Number(parsed?.summary?.critical_categories_count ?? 0)), oversupplyCategoriesCount: Math.max(0, Number(parsed?.summary?.oversupply_categories_count ?? 0)), biggestDemandRisk: String(parsed?.summary?.biggest_demand_risk ?? '').slice(0, 200), biggestDemandOpportunity: String(parsed?.summary?.biggest_demand_opportunity ?? '').slice(0, 200), quickestDemandWin: String(parsed?.summary?.quickest_demand_win ?? '').slice(0, 200), demandForecastAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.demand_forecast_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
