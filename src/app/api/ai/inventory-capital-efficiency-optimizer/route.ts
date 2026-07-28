// v6.72: AI Inventory Capital Efficiency Optimizer — optimizira kapitalsko učinkovitost z ML
// POST /api/ai/inventory-capital-efficiency-optimizer
// Body: { monthsAhead?: number }
// Returns: { ok, optimizer: { current, efficiency, optimizations, mlModels, projections, summary } }

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

    const since12m = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since12m, not: null } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true } } }, take: 100 });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni podatkov za capital efficiency optimizacijo.' });

    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalProfit = totalRevenue - totalCost;
    const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const avgDaysToSell = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0) / soldTrades.length) : 0;
    const capitalTurnoverRate = avgDaysToSell > 0 ? Math.round((365 / avgDaysToSell) * 10) / 10 : 0;
    const roi = totalCost > 0 ? Math.round((totalProfit / totalCost) * 1000) / 10 : 0;

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI inventory capital efficiency optimizer z ML.
Optimizira kapitalsko učinkovitost inventarja za ${monthsAhead} mesecev.

TRENUTNO:
- Letni prihodek: ${Math.round(totalRevenue)}€
- Letni profit: ${Math.round(totalProfit)}€
- ROI: ${roi}%
- Held capital: ${Math.round(heldCapital)}€
- Povp dni do prodaje: ${avgDaysToSell}
- Capital turnover rate: ${capitalTurnoverRate}x

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_revenue_eur": <number>, "total_profit_eur": <number>, "roi_pct": <number>, "held_capital_eur": <number>, "capital_turnover_rate": <number>, "avg_days_to_sell": <number>, "capital_efficiency_pct": <number 0-100>, "efficiency_grade": "<A|B|C|D|F>" },
  "efficiency": [
    { "metric": "<roi|turnover_rate|days_to_sell|profit_per_euro_invested|capital_utilization|holding_cost_ratio|opportunity_cost>", "current_value": <number>, "benchmark": <number>, "target_value": <number>, "gap_pct": <number>, "status": "<above_benchmark|at_benchmark|below_benchmark|critical>", "improvement_action": "<max 120 znakov>" }
  ],
  "optimizations": [
    { "optimization_type": "<faster_turnover|reduce_holding|increase_roi|capital_reallocation|cost_reduction|price_optimization|bundle_efficiency|liquidation_acceleration>", "description": "<max 120 znakov>", "current_value": <number>, "target_value": <number>, "expected_efficiency_gain_pct": <number>, "expected_profit_impact_eur": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<efficiency_forecast|optimal_allocation|turnover_prediction|roi_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "projections": [
    { "month": <1-12>, "projected_roi_pct": <number>, "projected_turnover_rate": <number>, "projected_capital_efficiency_pct": <number 0-100>, "projected_profit_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "summary": {
    "current_efficiency_score": <number 0-100>, "target_efficiency_score": <number 0-100>, "improvement_pct": <number>,
    "total_expected_profit_increase_eur": <number>, "best_optimization_type": "<max 80 znakov>",
    "biggest_efficiency_bottleneck": "<max 100 znakov>", "quickest_efficiency_win": "<max 100 znakov>",
    "capital_efficiency_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: { totalRevenueEur: Math.round(Number(parsed?.current?.total_revenue_eur ?? totalRevenue)), totalProfitEur: Math.round(Number(parsed?.current?.total_profit_eur ?? totalProfit)), roiPct: Math.round(Number(parsed?.current?.roi_pct ?? roi) * 10) / 10, heldCapitalEur: Math.round(Number(parsed?.current?.held_capital_eur ?? heldCapital)), capitalTurnoverRate: Math.round(Number(parsed?.current?.capital_turnover_rate ?? capitalTurnoverRate) * 10) / 10, avgDaysToSell: Math.round(Number(parsed?.current?.avg_days_to_sell ?? avgDaysToSell)), capitalEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.capital_efficiency_pct ?? 60))), efficiencyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.current?.efficiency_grade)) ? String(parsed.current.efficiency_grade) : 'C' },
      efficiency: (parsed?.efficiency || []).slice(0, 7).map((e: any) => ({ metric: ['roi', 'turnover_rate', 'days_to_sell', 'profit_per_euro_invested', 'capital_utilization', 'holding_cost_ratio', 'opportunity_cost'].includes(String(e?.metric)) ? String(e.metric) : 'roi', currentValue: Math.round(Number(e?.current_value ?? 0) * 100) / 100, benchmark: Math.round(Number(e?.benchmark ?? 0) * 100) / 100, targetValue: Math.round(Number(e?.target_value ?? 0) * 100) / 100, gapPct: Math.round(Number(e?.gap_pct ?? 0) * 10) / 10, status: ['above_benchmark', 'at_benchmark', 'below_benchmark', 'critical'].includes(String(e?.status)) ? String(e.status) : 'at_benchmark', improvementAction: String(e?.improvement_action ?? '').slice(0, 250) })),
      optimizations: (parsed?.optimizations || []).slice(0, 8).map((o: any) => ({ optimizationType: ['faster_turnover', 'reduce_holding', 'increase_roi', 'capital_reallocation', 'cost_reduction', 'price_optimization', 'bundle_efficiency', 'liquidation_acceleration'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'faster_turnover', description: String(o?.description ?? '').slice(0, 250), currentValue: Math.round(Number(o?.current_value ?? 0) * 100) / 100, targetValue: Math.round(Number(o?.target_value ?? 0) * 100) / 100, expectedEfficiencyGainPct: Math.round(Number(o?.expected_efficiency_gain_pct ?? 0) * 10) / 10, expectedProfitImpactEur: Math.round(Number(o?.expected_profit_impact_eur ?? 0)), implementationDifficulty: ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium', timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['efficiency_forecast', 'optimal_allocation', 'turnover_prediction', 'roi_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'efficiency_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      projections: (parsed?.projections || []).slice(0, monthsAhead).map((p: any) => ({ month: Math.max(1, Math.min(12, Number(p?.month ?? 1))), projectedRoiPct: Math.round(Number(p?.projected_roi_pct ?? 0) * 10) / 10, projectedTurnoverRate: Math.round(Number(p?.projected_turnover_rate ?? 0) * 10) / 10, projectedCapitalEfficiencyPct: Math.max(0, Math.min(100, Number(p?.projected_capital_efficiency_pct ?? 60))), projectedProfitEur: Math.round(Number(p?.projected_profit_eur ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
      summary: { currentEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_efficiency_score ?? 60))), targetEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.target_efficiency_score ?? 80))), improvementPct: Math.round(Number(parsed?.summary?.improvement_pct ?? 0) * 10) / 10, totalExpectedProfitIncreaseEur: Math.round(Number(parsed?.summary?.total_expected_profit_increase_eur ?? 0)), bestOptimizationType: ['faster_turnover', 'reduce_holding', 'increase_roi', 'capital_reallocation', 'cost_reduction', 'price_optimization', 'bundle_efficiency', 'liquidation_acceleration'].includes(String(parsed?.summary?.best_optimization_type)) ? String(parsed.summary.best_optimization_type) : 'faster_turnover', biggestEfficiencyBottleneck: String(parsed?.summary?.biggest_efficiency_bottleneck ?? '').slice(0, 200), quickestEfficiencyWin: String(parsed?.summary?.quickest_efficiency_win ?? '').slice(0, 200), capitalEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.capital_efficiency_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
