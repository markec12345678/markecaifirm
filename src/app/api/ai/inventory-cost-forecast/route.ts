// v6.87: AI Inventory Cost Forecast — ML napoved stroškov inventarja z budget planning
// POST /api/ai/inventory-cost-forecast
// Body: { days?: number, horizonDays?: number }
// Returns: { ok, forecaster: { overview, costForecasts, categoryBreakdown, costDrivers, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const COST_CATEGORIES = ['purchase_cost', 'shipping_cost', 'storage_cost', 'maintenance_cost', 'insurance_cost', 'platform_fees', 'marketing_cost', 'packaging_cost', 'return_cost', 'opportunity_cost'] as const;
const FORECAST_TIERS = ['under_budget', 'on_budget', 'slightly_over', 'over_budget', 'critical'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.max(7, Math.min(365, Number(body?.days ?? 90)));
    const horizonDays = Math.max(7, Math.min(180, Number(body?.horizonDays ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, buyLocation: true }, take: 500, orderBy: { buyDate: 'desc' } });
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true }, take: 1000 });
    if (heldTrades.length === 0 && soldTrades.length === 0) return NextResponse.json({ ok: true, forecaster: null, message: 'Ni podatkov za cost forecast.' });

    const totalHeldValue = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalBuyCosts = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalSellFees = soldTrades.reduce((s, t) => s + (t.sellFees ?? 0), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
    const netProfit = totalRevenue - totalBuyCosts - totalSellFees;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI inventory cost forecaster z ML in budget planning.
Napoveduje stroške inventarja z 10 kategorijami in 5 tierji za ${horizonDays} dni naprej.

STATS (zadnjih ${days} dni):
- Held items: ${heldTrades.length} | vrednost: ${Math.round(totalHeldValue)}€
- Sold items: ${soldTrades.length}
- Total buy costs: ${Math.round(totalBuyCosts)}€
- Total sell fees: ${Math.round(totalSellFees)}€
- Total revenue: ${Math.round(totalRevenue)}€
- Net profit: ${Math.round(netProfit)}€

10 kategorij stroškov: purchase_cost, shipping_cost, storage_cost, maintenance_cost, insurance_cost, platform_fees, marketing_cost, packaging_cost, return_cost, opportunity_cost

5 forecast tierjev: under_budget, on_budget, slightly_over, over_budget, critical

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_current_costs_eur": <number>, "forecasted_costs_${horizonDays}d_eur": <number>, "cost_change_pct": <number -50 do 100>, "avg_cost_per_item_eur": <number>, "cost_efficiency_pct": <number 0-100>, "forecast_grade": "<A|B|C|D|F>" },
  "costForecasts": [
    { "cost_category": "<${COST_CATEGORIES.join('|')}>", "current_cost_eur": <number>, "forecasted_cost_eur": <number>, "change_pct": <number -50 do 100>, "trend": "<increasing|decreasing|stable>", "volatility_pct": <number 0-100>, "forecast_tier": "<${FORECAST_TIERS.join('|')}>" }
  ],
  "categoryBreakdown": [
    { "category": "<string>", "current_cost_eur": <number>, "forecasted_cost_eur": <number>, "cost_pct_of_total": <number 0-100>, "avg_cost_per_item_eur": <number>, "trend": "<increasing|decreasing|stable>", "cost_optimization_potential_pct": <number 0-50> }
  ],
  "costDrivers": [
    { "driver": "<max 100 znakov>", "impact_pct": <number 0-100>, "affected_categories": "<max 100 znakov>", "controllable": <boolean>, "mitigation_strategy": "<max 150 znakov>", "expected_savings_eur": <number> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "cost_category": "<${COST_CATEGORIES.join('|')}>", "expected_savings_eur": <number>, "implementation_days": <number>, "difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<prophet|arima|lstm|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<cost_forecast|trend_analysis|budget_optimization|volatility_prediction>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "cost_forecast_score": <number 0-100>, "forecast_grade": "<A|B|C|D|F>", "total_forecasted_costs_eur": <number>,
    "potential_savings_eur": <number>, "critical_cost_categories_count": <number>,
    "biggest_cost_risk": "<max 100 znakov>", "biggest_cost_opportunity": "<max 100 znakov>",
    "quickest_cost_win": "<max 100 znakov>", "cost_forecast_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const forecaster = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalCurrentCostsEur: Math.round(Number(parsed?.overview?.total_current_costs_eur ?? totalBuyCosts + totalSellFees)), forecastedCostsEur: Math.round(Number(parsed?.overview?.[`forecasted_costs_${horizonDays}d_eur`] ?? parsed?.overview?.forecasted_costs_30d_eur ?? (totalBuyCosts + totalSellFees) * (horizonDays / days))), costChangePct: Math.round(Number(parsed?.overview?.cost_change_pct ?? 0) * 10) / 10, avgCostPerItemEur: Math.round(Number(parsed?.overview?.avg_cost_per_item_eur ?? (soldTrades.length > 0 ? (totalBuyCosts + totalSellFees) / soldTrades.length : 0))), costEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.overview?.cost_efficiency_pct ?? 60))), forecastGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.forecast_grade)) ? String(parsed.overview.forecast_grade) : 'C' },
      costForecasts: (parsed?.costForecasts || []).slice(0, 10).map((c: any) => ({ costCategory: (COST_CATEGORIES as readonly string[]).includes(String(c?.cost_category)) ? String(c.cost_category) : 'purchase_cost', currentCostEur: Math.round(Number(c?.current_cost_eur ?? 0)), forecastedCostEur: Math.round(Number(c?.forecasted_cost_eur ?? 0)), changePct: Math.round(Number(c?.change_pct ?? 0) * 10) / 10, trend: ['increasing', 'decreasing', 'stable'].includes(String(c?.trend)) ? String(c.trend) : 'stable', volatilityPct: Math.max(0, Math.min(100, Number(c?.volatility_pct ?? 20))), forecastTier: (FORECAST_TIERS as readonly string[]).includes(String(c?.forecast_tier)) ? String(c.forecast_tier) : 'on_budget' })),
      categoryBreakdown: (parsed?.categoryBreakdown || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), currentCostEur: Math.round(Number(c?.current_cost_eur ?? 0)), forecastedCostEur: Math.round(Number(c?.forecasted_cost_eur ?? 0)), costPctOfTotal: Math.max(0, Math.min(100, Number(c?.cost_pct_of_total ?? 0))), avgCostPerItemEur: Math.round(Number(c?.avg_cost_per_item_eur ?? 0)), trend: ['increasing', 'decreasing', 'stable'].includes(String(c?.trend)) ? String(c.trend) : 'stable', costOptimizationPotentialPct: Math.max(0, Math.min(50, Number(c?.cost_optimization_potential_pct ?? 10))) })),
      costDrivers: (parsed?.costDrivers || []).slice(0, 8).map((d: any) => ({ driver: String(d?.driver ?? '').slice(0, 200), impactPct: Math.max(0, Math.min(100, Number(d?.impact_pct ?? 50))), affectedCategories: String(d?.affected_categories ?? '').slice(0, 200), controllable: Boolean(d?.controllable ?? true), mitigationStrategy: String(d?.mitigation_strategy ?? '').slice(0, 300), expectedSavingsEur: Math.round(Number(d?.expected_savings_eur ?? 0)) })),
      recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), costCategory: (COST_CATEGORIES as readonly string[]).includes(String(r?.cost_category)) ? String(r.cost_category) : 'purchase_cost', expectedSavingsEur: Math.round(Number(r?.expected_savings_eur ?? 0)), implementationDays: Math.max(1, Number(r?.implementation_days ?? 7)), difficulty: ['easy', 'medium', 'hard'].includes(String(r?.difficulty)) ? String(r.difficulty) : 'medium', priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['prophet', 'arima', 'lstm', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['cost_forecast', 'trend_analysis', 'budget_optimization', 'volatility_prediction'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'cost_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { costForecastScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cost_forecast_score ?? 50))), forecastGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.forecast_grade)) ? String(parsed.summary.forecast_grade) : 'C', totalForecastedCostsEur: Math.round(Number(parsed?.summary?.total_forecasted_costs_eur ?? 0)), potentialSavingsEur: Math.round(Number(parsed?.summary?.potential_savings_eur ?? 0)), criticalCostCategoriesCount: Math.max(0, Number(parsed?.summary?.critical_cost_categories_count ?? 0)), biggestCostRisk: String(parsed?.summary?.biggest_cost_risk ?? '').slice(0, 200), biggestCostOpportunity: String(parsed?.summary?.biggest_cost_opportunity ?? '').slice(0, 200), quickestCostWin: String(parsed?.summary?.quickest_cost_win ?? '').slice(0, 200), costForecastAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cost_forecast_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { logger.error("/api/ai/inventory-cost-forecast", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
