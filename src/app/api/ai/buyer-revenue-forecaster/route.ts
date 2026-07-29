// v6.75: AI Buyer Revenue Forecaster — napoveduje prihodek per kupec z ML in revenue decomposition
// POST /api/ai/buyer-revenue-forecaster
// Body: { customerName?: string, monthsAhead?: number }
// Returns: { ok, forecaster: { buyers, revenueProjections, revenueDrivers, scenarios, mlModels, summary } }

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
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const monthsAhead = Math.max(1, Math.min(24, Number(body?.monthsAhead ?? 12)));

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, forecaster: null, message: 'Ni prodaj za revenue forecasting.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; firstPurchase: Date | null; categories: Set<string> }>();
    const now = Date.now();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2 || !t.sellDate) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set() }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate; if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate; if (t.category) b.categories.add(t.category); }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, forecaster: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d`).join('\n');

    const prompt = `Si AI buyer revenue forecaster z ML in revenue decomposition.
Napoveduje prihodek per kupec za ${monthsAhead} mesecev.

KUPCI (${targetBuyers.length}):
${buyersStr}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "current_revenue_eur": <number>, "projected_revenue_eur": <number>, "revenue_change_pct": <number>, "projected_purchases": <number>, "avg_projected_order_value_eur": <number>, "revenue_drivers": ["<max 80 znakov>"], "revenue_risks": ["<max 80 znakov>"], "revenue_segment": "<high_value|medium_value|low_value|declining|growing>", "confidence_pct": <number 0-100>, "recommended_action": "<maintain|upsell|cross_sell|retain|reactivate>", "expected_revenue_uplift_eur": <number> }
  ],
  "revenueProjections": [
    { "month": <1-24>, "projected_total_revenue_eur": <number>, "projected_active_buyers": <number>, "projected_avg_order_value_eur": <number>, "projected_new_buyers": <number>, "cumulative_revenue_eur": <number>, "confidence_pct": <number 0-100> }
  ],
  "revenueDrivers": [
    { "driver": "<purchase_frequency|order_value|retention_rate|cross_sell|upsell|referral|seasonality|market_trend|pricing|category_expansion>", "current_contribution_eur": <number>, "current_contribution_pct": <number 0-100>, "projected_contribution_eur": <number>, "growth_potential_pct": <number>, "optimization_action": "<max 120 znakov>" }
  ],
  "scenarios": [
    { "scenario": "<pessimistic|realistic|optimistic|stretch>", "total_projected_revenue_eur": <number>, "avg_monthly_revenue_eur": <number>, "active_buyers": <number>, "avg_order_value_eur": <number>, "probability_pct": <number 0-100> }
  ],
  "mlModels": [
    { "model": "<arima|lstm|prophet|xgboost|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<revenue_forecast|buyer_spend|purchase_frequency|order_value>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_forecasted": <number>, "current_total_revenue_eur": <number>, "projected_total_revenue_eur": <number>,
    "total_revenue_change_pct": <number>, "best_revenue_driver": "<max 80 znakov>",
    "biggest_revenue_risk": "<max 100 znakov>", "quickest_revenue_win": "<max 100 znakov>",
    "revenue_forecasting_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const forecaster = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), currentRevenueEur: Math.round(Number(b?.current_revenue_eur ?? 0)), projectedRevenueEur: Math.round(Number(b?.projected_revenue_eur ?? 0)), revenueChangePct: Math.round(Number(b?.revenue_change_pct ?? 0) * 10) / 10, projectedPurchases: Math.max(0, Number(b?.projected_purchases ?? 0)), avgProjectedOrderValueEur: Math.round(Number(b?.avg_projected_order_value_eur ?? 0)), revenueDrivers: (b?.revenue_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)), revenueRisks: (b?.revenue_risks || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)), revenueSegment: ['high_value', 'medium_value', 'low_value', 'declining', 'growing'].includes(String(b?.revenue_segment)) ? String(b.revenue_segment) : 'medium_value', confidencePct: Math.max(0, Math.min(100, Number(b?.confidence_pct ?? 50))), recommendedAction: ['maintain', 'upsell', 'cross_sell', 'retain', 'reactivate'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'maintain', expectedRevenueUpliftEur: Math.round(Number(b?.expected_revenue_uplift_eur ?? 0)) })),
      revenueProjections: (parsed?.revenueProjections || []).slice(0, monthsAhead).map((p: any) => ({ month: Math.max(1, Math.min(24, Number(p?.month ?? 1))), projectedTotalRevenueEur: Math.round(Number(p?.projected_total_revenue_eur ?? 0)), projectedActiveBuyers: Math.max(0, Number(p?.projected_active_buyers ?? 0)), projectedAvgOrderValueEur: Math.round(Number(p?.projected_avg_order_value_eur ?? 0)), projectedNewBuyers: Math.max(0, Number(p?.projected_new_buyers ?? 0)), cumulativeRevenueEur: Math.round(Number(p?.cumulative_revenue_eur ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
      revenueDrivers: (parsed?.revenueDrivers || []).slice(0, 10).map((d: any) => ({ driver: ['purchase_frequency', 'order_value', 'retention_rate', 'cross_sell', 'upsell', 'referral', 'seasonality', 'market_trend', 'pricing', 'category_expansion'].includes(String(d?.driver)) ? String(d.driver) : 'purchase_frequency', currentContributionEur: Math.round(Number(d?.current_contribution_eur ?? 0)), currentContributionPct: Math.max(0, Math.min(100, Number(d?.current_contribution_pct ?? 10))), projectedContributionEur: Math.round(Number(d?.projected_contribution_eur ?? 0)), growthPotentialPct: Math.round(Number(d?.growth_potential_pct ?? 0) * 10) / 10, optimizationAction: String(d?.optimization_action ?? '').slice(0, 250) })),
      scenarios: (parsed?.scenarios || []).slice(0, 4).map((s: any) => ({ scenario: ['pessimistic', 'realistic', 'optimistic', 'stretch'].includes(String(s?.scenario)) ? String(s.scenario) : 'realistic', totalProjectedRevenueEur: Math.round(Number(s?.total_projected_revenue_eur ?? 0)), avgMonthlyRevenueEur: Math.round(Number(s?.avg_monthly_revenue_eur ?? 0)), activeBuyers: Math.max(0, Number(s?.active_buyers ?? 0)), avgOrderValueEur: Math.round(Number(s?.avg_order_value_eur ?? 0)), probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 50))) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['arima', 'lstm', 'prophet', 'xgboost', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), predictionType: ['revenue_forecast', 'buyer_spend', 'purchase_frequency', 'order_value'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'revenue_forecast', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalBuyersForecasted: targetBuyers.length, currentTotalRevenueEur: Math.round(Number(parsed?.summary?.current_total_revenue_eur ?? 0)), projectedTotalRevenueEur: Math.round(Number(parsed?.summary?.projected_total_revenue_eur ?? 0)), totalRevenueChangePct: Math.round(Number(parsed?.summary?.total_revenue_change_pct ?? 0) * 10) / 10, bestRevenueDriver: ['purchase_frequency', 'order_value', 'retention_rate', 'cross_sell', 'upsell', 'referral', 'seasonality', 'market_trend', 'pricing', 'category_expansion'].includes(String(parsed?.summary?.best_revenue_driver)) ? String(parsed.summary.best_revenue_driver) : 'purchase_frequency', biggestRevenueRisk: String(parsed?.summary?.biggest_revenue_risk ?? '').slice(0, 200), quickestRevenueWin: String(parsed?.summary?.quickest_revenue_win ?? '').slice(0, 200), revenueForecastingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.revenue_forecasting_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, forecaster });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
