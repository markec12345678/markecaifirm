// v6.71: AI Inventory Profit Maximizer — maksimizira profit z ML optimization engine
// POST /api/ai/inventory-profit-maximizer
// Body: { tradeId?: string }
// Returns: { ok, maximizer: { items, optimizations, scenarios, mlModels, actionPlan, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const OPTIMIZATION_TYPES = ['price_increase', 'price_decrease', 'bundle_creation', 'cross_sell', 'upsell', 'renovation', 'relist', 'platform_switch', 'timing_optimization', 'bundle_break'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, location: true } } }, take: tradeId ? 1 : 50 });
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null, gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 300, orderBy: { sellDate: 'desc' } });

    if (heldTrades.length === 0) return NextResponse.json({ ok: true, maximizer: null, message: 'Ni held tradeov za profit maximization.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const now = Date.now();
    const items = heldTrades.map(t => { const cost = t.buyPrice + (t.buyFees ?? 0); const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25); const daysHeld = Math.round((now - t.buyDate.getTime()) / (24*60*60*1000)); return { id: t.id, title: t.title, category: (t.category || 'drugo').toLowerCase(), cost, estValue, daysHeld, dealScore: t.listing?.dealScore ?? 50, aiRisk: t.listing?.aiRisk ?? 5 }; });
    const itemsStr = items.slice(0, 25).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.cost}€→${i.estValue}€ | ${i.daysHeld}d`).join('\n');

    const prompt = `Si AI inventory profit maximizer z ML optimization engine.
Maksimizira profit inventarja z 10 optimization tipi.

INVENTAR (${items.length}):
${itemsStr}

10 optimization tipov:
1. PRICE_INCREASE: zvišaj ceno za items z visokim demand
2. PRICE_DECREASE: znižaj za stalled items
3. BUNDLE_CREATION: ustvari bundle iz več itemov
4. CROSS_SELL: ponudi complementary item
5. UPSELL: ponovi dražjo verzijo
6. RENOVATION: investiraj v obnovo za višji profit
7. RELIST: ponovno objavi z novim naslovom
8. PLATFORM_SWITCH: prestavi na drugo platformo
9. TIMING_OPTIMIZATION: prodaj ob optimalnem času
10. BUNDLE_BREAK: razdruži bundle in prodaj posamezno

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    { "id": "<trade_id>", "title": "<naslov>", "current_profit_eur": <number>, "optimized_profit_eur": <number>, "profit_increase_eur": <number>, "profit_increase_pct": <number>, "recommended_optimization": "<10 tipov>", "optimization_detail": "<max 150 znakov>", "confidence_pct": <number 0-100>, "priority": "<high|medium|low>", "implementation_steps": ["<max 80 znakov>"] }
  ],
  "optimizations": [
    { "optimization_type": "<10 tipov>", "description": "<max 120 znakov>", "items_affected": <number>, "total_profit_increase_eur": <number>, "implementation_difficulty": "<low|medium|high>", "timeframe_days": <number>, "roi_score": <number 0-100> }
  ],
  "scenarios": [
    { "scenario": "<current|optimized|aggressive|conservative>", "total_profit_eur": <number>, "avg_margin_pct": <number>, "total_revenue_eur": <number>, "implementation_cost_eur": <number>, "net_gain_eur": <number>, "probability_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|neural_network|random_forest|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<profit_optimization|price_elasticity|bundle_value|conversion_rate>", "weight_in_ensemble": <number 0-100> }
  ],
  "actionPlan": [
    { "step": <number>, "action": "<max 120 znakov>", "optimization_type": "<10 tipov>", "expected_profit_increase_eur": <number>, "timeframe_days": <number>, "priority": "<high|medium|low>" }
  ],
  "summary": {
    "total_items_analyzed": <number>, "total_current_profit_eur": <number>, "total_optimized_profit_eur": <number>,
    "total_profit_increase_eur": <number>, "avg_profit_increase_pct": <number>,
    "best_optimization_type": "<10 tipov>", "biggest_profit_opportunity": "<max 100 znakov>",
    "quickest_profit_win": "<max 100 znakov>", "profit_maximization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const maximizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || []).filter((it: any) => validIds.has(String(it?.id ?? ''))).slice(0, 50).map((it: any) => ({
        tradeId: String(it?.id ?? ''), title: String(it?.title ?? '').slice(0, 100),
        currentProfitEur: Math.round(Number(it?.current_profit_eur ?? 0)), optimizedProfitEur: Math.round(Number(it?.optimized_profit_eur ?? 0)),
        profitIncreaseEur: Math.round(Number(it?.profit_increase_eur ?? 0)), profitIncreasePct: Math.round(Number(it?.profit_increase_pct ?? 0) * 10) / 10,
        recommendedOptimization: OPTIMIZATION_TYPES.includes(String(it?.recommended_optimization) as any) ? String(it.recommended_optimization) : 'price_increase',
        optimizationDetail: String(it?.optimization_detail ?? '').slice(0, 300), confidencePct: Math.max(0, Math.min(100, Number(it?.confidence_pct ?? 60))),
        priority: ['high', 'medium', 'low'].includes(String(it?.priority)) ? String(it.priority) : 'medium',
        implementationSteps: (it?.implementation_steps || []).slice(0, 5).map((s: any) => String(s).slice(0, 150)),
      })),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
        optimizationType: OPTIMIZATION_TYPES.includes(String(o?.optimization_type) as any) ? String(o.optimization_type) : 'price_increase',
        description: String(o?.description ?? '').slice(0, 250), itemsAffected: Math.max(0, Number(o?.items_affected ?? 0)),
        totalProfitIncreaseEur: Math.round(Number(o?.total_profit_increase_eur ?? 0)),
        implementationDifficulty: ['low', 'medium', 'high'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium',
        timeframeDays: Math.max(1, Number(o?.timeframe_days ?? 7)), roiScore: Math.max(0, Math.min(100, Number(o?.roi_score ?? 50))),
      })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({
        scenario: ['current', 'optimized', 'aggressive', 'conservative'].includes(String(s?.scenario)) ? String(s.scenario) : 'current',
        totalProfitEur: Math.round(Number(s?.total_profit_eur ?? 0)), avgMarginPct: Math.round(Number(s?.avg_margin_pct ?? 0) * 10) / 10,
        totalRevenueEur: Math.round(Number(s?.total_revenue_eur ?? 0)), implementationCostEur: Math.round(Number(s?.implementation_cost_eur ?? 0)),
        netGainEur: Math.round(Number(s?.net_gain_eur ?? 0)), probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))),
      })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
        model: ['gradient_boosting', 'neural_network', 'random_forest', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        predictionType: ['profit_optimization', 'price_elasticity', 'bundle_value', 'conversion_rate'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'profit_optimization',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      actionPlan: (parsed?.actionPlan || []).slice(0, 8).map((a: any) => ({
        step: Math.max(1, Number(a?.step ?? 1)), action: String(a?.action ?? '').slice(0, 250),
        optimizationType: OPTIMIZATION_TYPES.includes(String(a?.optimization_type) as any) ? String(a.optimization_type) : 'price_increase',
        expectedProfitIncreaseEur: Math.round(Number(a?.expected_profit_increase_eur ?? 0)),
        timeframeDays: Math.max(1, Number(a?.timeframe_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      })),
      summary: {
        totalItemsAnalyzed: items.length, totalCurrentProfitEur: Math.round(Number(parsed?.summary?.total_current_profit_eur ?? 0)),
        totalOptimizedProfitEur: Math.round(Number(parsed?.summary?.total_optimized_profit_eur ?? 0)),
        totalProfitIncreaseEur: Math.round(Number(parsed?.summary?.total_profit_increase_eur ?? 0)),
        avgProfitIncreasePct: Math.round(Number(parsed?.summary?.avg_profit_increase_pct ?? 0) * 10) / 10,
        bestOptimizationType: OPTIMIZATION_TYPES.includes(String(parsed?.summary?.best_optimization_type) as any) ? String(parsed.summary.best_optimization_type) : 'price_increase',
        biggestProfitOpportunity: String(parsed?.summary?.biggest_profit_opportunity ?? '').slice(0, 200),
        quickestProfitWin: String(parsed?.summary?.quickest_profit_win ?? '').slice(0, 200),
        profitMaximizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.profit_maximization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, maximizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
