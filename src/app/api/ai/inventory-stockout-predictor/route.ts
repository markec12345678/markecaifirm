// v6.76: AI Inventory Stockout Predictor — napoveduje izpodrpitev z ML in reorder timing
// POST /api/ai/inventory-stockout-predictor
// Body: { category?: string, daysAhead?: number }
// Returns: { ok, predictor: { current, predictions, categories, reorderPlan, mlModels, summary } }

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
    const categoryFilter = body?.category ? String(body.category).toLowerCase() : null;
    const daysAhead = Math.max(7, Math.min(90, Number(body?.daysAhead ?? 30)));

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since90, not: null } }, select: { id: true, title: true, category: true, sellDate: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } }, take: 100 });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni podatkov za stockout prediction.' });

    const catMap = new Map<string, { soldCount: number; heldCount: number; avgDaysToSell: number; totalDays: number }>();
    for (const t of soldTrades) { const cat = (t.category || 'drugo').toLowerCase(); if (categoryFilter && !cat.includes(categoryFilter)) continue; const days = Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))); if (!catMap.has(cat)) catMap.set(cat, { soldCount: 0, heldCount: 0, avgDaysToSell: 0, totalDays: 0 }); const c = catMap.get(cat)!; c.soldCount += 1; c.totalDays += days; }
    for (const t of heldTrades) { const cat = (t.category || 'drugo').toLowerCase(); if (categoryFilter && !cat.includes(categoryFilter)) continue; if (!catMap.has(cat)) catMap.set(cat, { soldCount: 0, heldCount: 0, avgDaysToSell: 0, totalDays: 0 }); catMap.get(cat)!.heldCount += 1; }
    catMap.forEach(c => { c.avgDaysToSell = c.soldCount > 0 ? Math.round(c.totalDays / c.soldCount) : 14; });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const catStr = Array.from(catMap.entries()).slice(0, 10).map(([cat, c]) => `- ${cat}: sold ${c.soldCount}, held ${c.heldCount}, avg ${c.avgDaysToSell}d`).join('\n');

    const prompt = `Si AI inventory stockout predictor z ML in reorder timing.
Napoveduje izpodrpitev inventarja za ${daysAhead} dni.

KATEGORIJE:
${catStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_held_items": <number>, "total_categories": <number>, "avg_days_to_sell": <number>, "stock_coverage_days": <number>, "stockout_risk_level": "<low|medium|high|critical>" },
  "predictions": [
    { "category": "<kategorija>", "current_stock": <number>, "daily_sell_rate": <number>, "days_until_stockout": <number>, "stockout_date": "<YYYY-MM-DD>", "stockout_probability_pct": <number 0-100>, "recommended_reorder_day": <number>, "recommended_reorder_quantity": <number>, "urgency": "<immediate|7d|14d|30d|safe>" }
  ],
  "categories": [
    { "category": "<kategorija>", "stock_status": "<well_stocked|adequate|low|critical|out_of_stock>", "held_count": <number>, "avg_daily_demand": <number>, "projected_stockout_date": "<YYYY-MM-DD>", "reorder_recommended": <boolean>, "reorder_priority": "<high|medium|low>" }
  ],
  "reorderPlan": [
    { "day": <1-30>, "categories_to_reorder": ["<kategorija>"], "estimated_cost_eur": <number>, "expected_revenue_protection_eur": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<stockout_timing|demand_forecast|optimal_reorder|stock_level>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_categories_analyzed": <number>, "categories_at_risk": <number>, "categories_critical": <number>,
    "earliest_stockout_date": "<YYYY-MM-DD>", "total_reorder_cost_eur": <number>,
    "total_revenue_at_risk_eur": <number>, "biggest_stockout_risk": "<max 100 znakov>",
    "quickest_reorder_win": "<max 100 znakov>", "stockout_prediction_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: { totalHeldItems: Math.max(0, Number(parsed?.current?.total_held_items ?? heldTrades.length)), totalCategories: Math.max(0, Number(parsed?.current?.total_categories ?? catMap.size)), avgDaysToSell: Math.round(Number(parsed?.current?.avg_days_to_sell ?? 14)), stockCoverageDays: Math.round(Number(parsed?.current?.stock_coverage_days ?? 30)), stockoutRiskLevel: ['low', 'medium', 'high', 'critical'].includes(String(parsed?.current?.stockout_risk_level)) ? String(parsed.current.stockout_risk_level) : 'medium' },
      predictions: (parsed?.predictions || []).slice(0, 12).map((p: any) => ({ category: String(p?.category ?? '').slice(0, 50), currentStock: Math.max(0, Number(p?.current_stock ?? 0)), dailySellRate: Math.round(Number(p?.daily_sell_rate ?? 0) * 100) / 100, daysUntilStockout: Math.max(0, Number(p?.days_until_stockout ?? 0)), stockoutDate: String(p?.stockout_date ?? '').slice(0, 20), stockoutProbabilityPct: Math.max(0, Math.min(100, Number(p?.stockout_probability_pct ?? 30))), recommendedReorderDay: Math.max(1, Number(p?.recommended_reorder_day ?? 7)), recommendedReorderQuantity: Math.max(0, Number(p?.recommended_reorder_quantity ?? 0)), urgency: ['immediate', '7d', '14d', '30d', 'safe'].includes(String(p?.urgency)) ? String(p.urgency) : '30d' })),
      categories: (parsed?.categories || []).slice(0, 12).map((c: any) => ({ category: String(c?.category ?? '').slice(0, 50), stockStatus: ['well_stocked', 'adequate', 'low', 'critical', 'out_of_stock'].includes(String(c?.stock_status)) ? String(c.stock_status) : 'adequate', heldCount: Math.max(0, Number(c?.held_count ?? 0)), avgDailyDemand: Math.round(Number(c?.avg_daily_demand ?? 0) * 100) / 100, projectedStockoutDate: String(c?.projected_stockout_date ?? '').slice(0, 20), reorderRecommended: Boolean(c?.reorder_recommended ?? false), reorderPriority: ['high', 'medium', 'low'].includes(String(c?.reorder_priority)) ? String(c.reorder_priority) : 'medium' })),
      reorderPlan: (parsed?.reorderPlan || []).slice(0, 30).map((r: any) => ({ day: Math.max(1, Math.min(30, Number(r?.day ?? 1))), categoriesToReorder: (r?.categories_to_reorder || []).slice(0, 5).map((c: any) => String(c).slice(0, 50)), estimatedCostEur: Math.round(Number(r?.estimated_cost_eur ?? 0)), expectedRevenueProtectionEur: Math.round(Number(r?.expected_revenue_protection_eur ?? 0)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['stockout_timing', 'demand_forecast', 'optimal_reorder', 'stock_level'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'stockout_timing', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalCategoriesAnalyzed: catMap.size, categoriesAtRisk: Math.max(0, Number(parsed?.summary?.categories_at_risk ?? 0)), categoriesCritical: Math.max(0, Number(parsed?.summary?.categories_critical ?? 0)), earliestStockoutDate: String(parsed?.summary?.earliest_stockout_date ?? '').slice(0, 20), totalReorderCostEur: Math.round(Number(parsed?.summary?.total_reorder_cost_eur ?? 0)), totalRevenueAtRiskEur: Math.round(Number(parsed?.summary?.total_revenue_at_risk_eur ?? 0)), biggestStockoutRisk: String(parsed?.summary?.biggest_stockout_risk ?? '').slice(0, 200), quickestReorderWin: String(parsed?.summary?.quickest_reorder_win ?? '').slice(0, 200), stockoutPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.stockout_prediction_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
