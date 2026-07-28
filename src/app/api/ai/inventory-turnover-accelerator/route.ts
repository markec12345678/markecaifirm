// v6.74: AI Inventory Turnover Accelerator — pospešuje obrtnost z ML in bottleneck analysis
// POST /api/ai/inventory-turnover-accelerator
// Body: { tradeId?: string }
// Returns: { ok, accelerator: { current, bottlenecks, accelerators, actionPlan, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const ACCELERATOR_TYPES = ['price_drop', 'bundle_creation', 'cross_post', 'refresh_listing', 'flash_sale', 'auction_listing', 'bundle_break', 'platform_switch', 'image_upgrade', 'description_rewrite', 'tag_optimization', 'urgency_injection'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true } } }, take: tradeId ? 1 : 50 });
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 300, orderBy: { sellDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, accelerator: null, message: 'Ni held tradeov za turnover acceleration.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const now = Date.now();
    const items = heldTrades.map(t => { const cost = t.buyPrice + (t.buyFees ?? 0); const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25); const daysHeld = Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)); return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, daysHeld, dealScore: t.listing?.dealScore ?? 50 }; });
    const avgDays = soldTrades.length > 0 ? Math.round(soldTrades.reduce((s, t) => s + Math.max(0, Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24*60*60*1000))), 0) / soldTrades.length) : 14;
    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d | deal ${i.dealScore}/100`).join('\n');

    const prompt = `Si AI inventory turnover accelerator z ML in bottleneck analysis.
Pospešuje obrtnost inventarja za ${items.length} itemov.

INVENTAR:
${itemsStr}
Povp dni do prodaje (90d): ${avgDays}d

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "current": { "avg_days_to_sell": <number>, "turnover_rate": <number>, "capital_tied_eur": <number>, "holding_cost_per_day_eur": <number>, "turnover_efficiency_pct": <number 0-100>, "acceleration_potential_pct": <number 0-100> },
  "bottlenecks": [
    { "bottleneck_type": "<slow_category|overpriced|poor_listing|wrong_platform|seasonal_mismatch|competition|low_demand|bad_timing>", "affected_items": <number>, "avg_extra_days": <number>, "cost_impact_eur": <number>, "root_cause": "<max 120 znakov>", "fix_action": "<max 150 znakov>", "priority": "<high|medium|low>" }
  ],
  "accelerators": [
    { "accelerator_type": "<12 tipov>", "description": "<max 120 znakov>", "expected_days_saved": <number>, "expected_revenue_acceleration_eur": <number>, "items_affected": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number>, "roi_score": <number 0-100> }
  ],
  "actionPlan": [
    { "step": <number>, "action": "<max 120 znakov>", "accelerator_type": "<12 tipov>", "target_items": ["<trade_id>"], "expected_days_saved": <number>, "expected_revenue_impact_eur": <number>, "priority": "<high|medium|low>", "timeframe_days": <number> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<days_to_sell|acceleration_potential|optimal_action|turnover_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_items_analyzed": <number>, "current_avg_days_to_sell": <number>, "target_avg_days_to_sell": <number>,
    "expected_days_saved": <number>, "expected_revenue_acceleration_eur": <number>,
    "best_accelerator": "<12 tipov>", "biggest_bottleneck": "<max 100 znakov>",
    "quickest_acceleration_win": "<max 100 znakov>", "turnover_acceleration_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const accelerator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      current: { avgDaysToSell: Math.round(Number(parsed?.current?.avg_days_to_sell ?? avgDays)), turnoverRate: Math.round(Number(parsed?.current?.turnover_rate ?? (365 / avgDays)) * 10) / 10, capitalTiedEur: Math.round(Number(parsed?.current?.capital_tied_eur ?? items.reduce((s, i) => s + i.cost, 0))), holdingCostPerDayEur: Math.round(Number(parsed?.current?.holding_cost_per_day_eur ?? 0) * 100) / 100, turnoverEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.current?.turnover_efficiency_pct ?? 60))), accelerationPotentialPct: Math.max(0, Math.min(100, Number(parsed?.current?.acceleration_potential_pct ?? 40))) },
      bottlenecks: (parsed?.bottlenecks || []).slice(0, 8).map((b: any) => ({ bottleneckType: ['slow_category', 'overpriced', 'poor_listing', 'wrong_platform', 'seasonal_mismatch', 'competition', 'low_demand', 'bad_timing'].includes(String(b?.bottleneck_type)) ? String(b.bottleneck_type) : 'slow_category', affectedItems: Math.max(0, Number(b?.affected_items ?? 0)), avgExtraDays: Math.max(0, Number(b?.avg_extra_days ?? 0)), costImpactEur: Math.round(Number(b?.cost_impact_eur ?? 0)), rootCause: String(b?.root_cause ?? '').slice(0, 250), fixAction: String(b?.fix_action ?? '').slice(0, 300), priority: ['high', 'medium', 'low'].includes(String(b?.priority)) ? String(b.priority) : 'medium' })),
      accelerators: (parsed?.accelerators || []).slice(0, 12).map((a: any) => ({ acceleratorType: ACCELERATOR_TYPES.includes(String(a?.accelerator_type) as any) ? String(a.accelerator_type) : 'price_drop', description: String(a?.description ?? '').slice(0, 250), expectedDaysSaved: Math.max(0, Number(a?.expected_days_saved ?? 0)), expectedRevenueAccelerationEur: Math.round(Number(a?.expected_revenue_acceleration_eur ?? 0)), itemsAffected: Math.max(0, Number(a?.items_affected ?? 0)), implementationDifficulty: ['low', 'medium', 'high'].includes(String(a?.implementation_difficulty)) ? String(a.implementation_difficulty) : 'low', timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 3)), roiScore: Math.max(0, Math.min(100, Number(a?.roi_score ?? 50))) })),
      actionPlan: (parsed?.actionPlan || []).slice(0, 10).map((a: any) => ({ step: Math.max(1, Number(a?.step ?? 1)), action: String(a?.action ?? '').slice(0, 250), acceleratorType: ACCELERATOR_TYPES.includes(String(a?.accelerator_type) as any) ? String(a.accelerator_type) : 'price_drop', targetItems: (a?.target_items || []).filter((id: any) => validIds.has(String(id))).slice(0, 10).map((id: any) => String(id).slice(0, 50)), expectedDaysSaved: Math.max(0, Number(a?.expected_days_saved ?? 0)), expectedRevenueImpactEur: Math.round(Number(a?.expected_revenue_impact_eur ?? 0)), priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium', timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 3)) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['days_to_sell', 'acceleration_potential', 'optimal_action', 'turnover_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'days_to_sell', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalItemsAnalyzed: items.length, currentAvgDaysToSell: Math.round(Number(parsed?.summary?.current_avg_days_to_sell ?? avgDays)), targetAvgDaysToSell: Math.round(Number(parsed?.summary?.target_avg_days_to_sell ?? avgDays * 0.7)), expectedDaysSaved: Math.round(Number(parsed?.summary?.expected_days_saved ?? 0)), expectedRevenueAccelerationEur: Math.round(Number(parsed?.summary?.expected_revenue_acceleration_eur ?? 0)), bestAccelerator: ACCELERATOR_TYPES.includes(String(parsed?.summary?.best_accelerator) as any) ? String(parsed.summary.best_accelerator) : 'price_drop', biggestBottleneck: String(parsed?.summary?.biggest_bottleneck ?? '').slice(0, 200), quickestAccelerationWin: String(parsed?.summary?.quickest_acceleration_win ?? '').slice(0, 200), turnoverAccelerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.turnover_acceleration_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, accelerator });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
