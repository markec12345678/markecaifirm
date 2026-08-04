// v6.75: AI Inventory Cost Minimizer — minimizira skupne stroške z ML in cost decomposition
// POST /api/ai/inventory-cost-minimizer
// Body: { tradeId?: string }
// Returns: { ok, minimizer: { current, costBreakdown, optimizations, mlModels, projections, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const COST_CATEGORIES = ['sourcing_cost', 'platform_fees', 'payment_fees', 'shipping_cost', 'storage_cost', 'holding_cost', 'renovation_cost', 'opportunity_cost', 'insurance_cost', 'return_cost'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, price: true } } }, take: tradeId ? 1 : 50 });
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 300 });
    if (heldTrades.length === 0 && soldTrades.length === 0) return NextResponse.json({ ok: true, minimizer: null, message: 'Ni podatkov za cost minimization.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const totalBuyCost = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalSellFees = soldTrades.reduce((s, t) => s + (t.sellFees ?? 0), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0)), 0);
    const totalProfit = totalRevenue - totalBuyCost;
    const heldCapital = heldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);

    const prompt = `Si AI inventory cost minimizer z ML in cost decomposition.
Minimizira skupne stroške inventarja z 10-kategorijsko analizo.

STATS:
- Total buy cost (90d): ${Math.round(totalBuyCost)}€
- Total sell fees (90d): ${Math.round(totalSellFees)}€
- Total revenue (90d): ${Math.round(totalRevenue)}€
- Total profit (90d): ${Math.round(totalProfit)}€
- Held capital: ${Math.round(heldCapital)}€

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "total_cost_eur": <number>, "total_revenue_eur": <number>, "total_profit_eur": <number>, "cost_ratio_pct": <number>, "held_capital_eur": <number>, "cost_efficiency_pct": <number 0-100>, "cost_grade": "<A|B|C|D|F>" },
  "costBreakdown": [
    { "category": "<10 kategorij>", "current_cost_eur": <number>, "percentage_of_total": <number 0-100>, "optimized_cost_eur": <number>, "savings_eur": <number>, "savings_pct": <number>, "optimization_action": "<max 120 znakov>", "priority": "<high|medium|low>" }
  ],
  "optimizations": [
    { "optimization_type": "<fee_negotiation|platform_switch|bulk_shipping|faster_turnover|bundle_savings|supplier_renegotiation|storage_optimization|insurance_reduction|return_prevention|opportunity_cost_reduction>", "description": "<max 120 znakov>", "current_cost_eur": <number>, "optimized_cost_eur": <number>, "savings_eur": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<cost_forecast|optimal_cost|savings_potential|cost_attribution>", "weight_in_ensemble": <number 0-100> }
  ],
  "projections": [
    { "month": <1-12>, "projected_total_cost_eur": <number>, "projected_total_savings_eur": <number>, "projected_net_cost_eur": <number>, "projected_profit_increase_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "summary": {
    "current_total_cost_eur": <number>, "optimized_total_cost_eur": <number>, "total_savings_eur": <number>,
    "total_savings_pct": <number>, "biggest_cost_category": "<max 80 znakov>",
    "biggest_savings_opportunity": "<max 100 znakov>", "quickest_cost_win": "<max 100 znakov>",
    "cost_minimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const minimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: { totalCostEur: Math.round(Number(parsed?.current?.total_cost_eur ?? totalBuyCost + totalSellFees)), totalRevenueEur: Math.round(Number(parsed?.current?.total_revenue_eur ?? totalRevenue)), totalProfitEur: Math.round(Number(parsed?.current?.total_profit_eur ?? totalProfit)), costRatioPct: Math.round(Number(parsed?.current?.cost_ratio_pct ?? 0) * 10) / 10, heldCapitalEur: Math.round(Number(parsed?.current?.held_capital_eur ?? heldCapital)), costEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.cost_efficiency_pct ?? 60))), costGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.current?.cost_grade)) ? String(parsed.current.cost_grade) : 'C' },
      costBreakdown: (parsed?.costBreakdown || []).slice(0, 10).map((c: any) => ({ category: COST_CATEGORIES.includes(String(c?.category) as any) ? String(c.category) : 'sourcing_cost', currentCostEur: Math.round(Number(c?.current_cost_eur ?? 0)), percentageOfTotal: Math.max(0, Math.min(100, Number(c?.percentage_of_total ?? 0))), optimizedCostEur: Math.round(Number(c?.optimized_cost_eur ?? 0)), savingsEur: Math.round(Number(c?.savings_eur ?? 0)), savingsPct: Math.round(Number(c?.savings_pct ?? 0) * 10) / 10, optimizationAction: String(c?.optimization_action ?? '').slice(0, 250), priority: ['high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'medium' })),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({ optimizationType: ['fee_negotiation', 'platform_switch', 'bulk_shipping', 'faster_turnover', 'bundle_savings', 'supplier_renegotiation', 'storage_optimization', 'insurance_reduction', 'return_prevention', 'opportunity_cost_reduction'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'fee_negotiation', description: String(o?.description ?? '').slice(0, 250), currentCostEur: Math.round(Number(o?.current_cost_eur ?? 0)), optimizedCostEur: Math.round(Number(o?.optimized_cost_eur ?? 0)), savingsEur: Math.round(Number(o?.savings_eur ?? 0)), implementationDifficulty: ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'low', timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['cost_forecast', 'optimal_cost', 'savings_potential', 'cost_attribution'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'cost_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      projections: (parsed?.projections || []).slice(0, 12).map((p: any) => ({ month: Math.max(1, Math.min(12, Number(p?.month ?? 1))), projectedTotalCostEur: Math.round(Number(p?.projected_total_cost_eur ?? 0)), projectedTotalSavingsEur: Math.round(Number(p?.projected_total_savings_eur ?? 0)), projectedNetCostEur: Math.round(Number(p?.projected_net_cost_eur ?? 0)), projectedProfitIncreaseEur: Math.round(Number(p?.projected_profit_increase_eur ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
      summary: { currentTotalCostEur: Math.round(Number(parsed?.summary?.current_total_cost_eur ?? 0)), optimizedTotalCostEur: Math.round(Number(parsed?.summary?.optimized_total_cost_eur ?? 0)), totalSavingsEur: Math.round(Number(parsed?.summary?.total_savings_eur ?? 0)), totalSavingsPct: Math.round(Number(parsed?.summary?.total_savings_pct ?? 0) * 10) / 10, biggestCostCategory: COST_CATEGORIES.includes(String(parsed?.summary?.biggest_cost_category) as any) ? String(parsed.summary.biggest_cost_category) : 'sourcing_cost', biggestSavingsOpportunity: String(parsed?.summary?.biggest_savings_opportunity ?? '').slice(0, 200), quickestCostWin: String(parsed?.summary?.quickest_cost_win ?? '').slice(0, 200), costMinimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cost_minimization_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, minimizer });
  } catch (e: any) { logger.error("/api/ai/inventory-cost-minimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
