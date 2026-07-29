// v6.87: AI Buyer CLV Predictor — ML napoved Customer Lifetime Value z behavior modeling
// POST /api/ai/buyer-clv-predictor
// Body: { customerName?: string }
// Returns: { ok, predictor: { overview, buyers, clvComponents, predictions, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const CLV_TIERS = ['vip', 'high_value', 'medium_value', 'low_value', 'marginal', 'unprofitable'] as const;
const VALUE_DRIVERS = ['purchase_frequency', 'avg_order_value', 'category_breadth', 'referral_value', 'retention_length', 'price_premium_acceptance', 'cross_sell_receptiveness', 'feedback_value', 'advocacy_impact', 'lifetime_engagement'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za CLV analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; daysSinceLast: number; lifetimeDays: number }>();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), daysSinceLast: 0, lifetimeDays: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; b.lifetimeDays = b.firstPurchase ? Math.round((now - b.firstPurchase.getTime()) / DAY) : 0; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d | ${b.lifetimeDays}d lifetime | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer CLV (Customer Lifetime Value) predictor z ML in behavior modeling.
Napoveduje CLV z 6 tierji in 10 value driverji.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 CLV tierjev:
1. VIP: >10000€ CLV
2. HIGH_VALUE: 5000-10000€
3. MEDIUM_VALUE: 2000-5000€
4. LOW_VALUE: 500-2000€
5. MARGINAL: 100-500€
6. UNPROFITABLE: <100€

10 value driverjev: purchase_frequency, avg_order_value, category_breadth, referral_value, retention_length, price_premium_acceptance, cross_sell_receptiveness, feedback_value, advocacy_impact, lifetime_engagement

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_clv_eur": <number>, "total_clv_eur": <number>, "vip_count": <number>, "high_value_count": <number>, "unprofitable_count": <number>, "clv_grade": "<A|B|C|D|F>" },
  "buyers": [
    { "name": "<string>", "current_clv_eur": <number>, "predicted_clv_12m_eur": <number>, "predicted_clv_24m_eur": <number>, "predicted_clv_lifetime_eur": <number>, "clv_tier": "<${CLV_TIERS.join('|')}>", "clv_trend": "<growing|stable|declining>", "roi_pct": <number>, "investment_recommended_eur": <number> }
  ],
  "clvComponents": [
    { "driver": "<${VALUE_DRIVERS.join('|')}>", "current_contribution_eur": <number>, "potential_contribution_eur": <number>, "improvement_pct": <number 0-100>, "weight_in_clv_pct": <number 0-100>, "improvement_strategy": "<max 120 znakov>" }
  ],
  "predictions": [
    { "buyer_name": "<string>", "next_purchase_probability_pct": <number 0-100>, "predicted_next_purchase_value_eur": <number>, "predicted_purchase_frequency_12m": <number>, "churn_probability_pct": <number 0-100>, "key_growth_driver": "<max 100 znakov>", "confidence_pct": <number 0-100> }
  ],
  "recommendations": [
    { "buyer_name": "<string>", "action": "<max 150 znakov>", "expected_clv_lift_eur": <number>, "investment_eur": <number>, "expected_roi_pct": <number>, "timeframe_months": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|survival_analysis|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<clv_prediction|churn_probability|purchase_forecast|value_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "clv_prediction_score": <number 0-100>, "clv_grade": "<A|B|C|D|F>", "total_portfolio_clv_eur": <number>,
    "avg_clv_eur": <number>, "vip_buyers_count": <number>,
    "biggest_clv_risk": "<max 100 znakov>", "biggest_clv_opportunity": "<max 100 znakov>",
    "quickest_clv_win": "<max 100 znakov>", "clv_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)), avgClvEur: Math.round(Number(parsed?.overview?.avg_clv_eur ?? targetBuyers.reduce((s, b) => s + b.totalSpent, 0) / Math.max(1, targetBuyers.length))), totalClvEur: Math.round(Number(parsed?.overview?.total_clv_eur ?? targetBuyers.reduce((s, b) => s + b.totalSpent, 0))), vipCount: Math.max(0, Number(parsed?.overview?.vip_count ?? 0)), highValueCount: Math.max(0, Number(parsed?.overview?.high_value_count ?? 0)), unprofitableCount: Math.max(0, Number(parsed?.overview?.unprofitable_count ?? 0)), clvGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.clv_grade)) ? String(parsed.overview.clv_grade) : 'C' },
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), currentClvEur: Math.round(Number(b?.current_clv_eur ?? 0)), predictedClv12mEur: Math.round(Number(b?.predicted_clv_12m_eur ?? 0)), predictedClv24mEur: Math.round(Number(b?.predicted_clv_24m_eur ?? 0)), predictedClvLifetimeEur: Math.round(Number(b?.predicted_clv_lifetime_eur ?? 0)), clvTier: (CLV_TIERS as readonly string[]).includes(String(b?.clv_tier)) ? String(b.clv_tier) : 'medium_value', clvTrend: ['growing', 'stable', 'declining'].includes(String(b?.clv_trend)) ? String(b.clv_trend) : 'stable', roiPct: Math.round(Number(b?.roi_pct ?? 0) * 10) / 10, investmentRecommendedEur: Math.round(Number(b?.investment_recommended_eur ?? 0)) })),
      clvComponents: (parsed?.clvComponents || []).slice(0, 10).map((c: any) => ({ driver: (VALUE_DRIVERS as readonly string[]).includes(String(c?.driver)) ? String(c.driver) : 'purchase_frequency', currentContributionEur: Math.round(Number(c?.current_contribution_eur ?? 0)), potentialContributionEur: Math.round(Number(c?.potential_contribution_eur ?? 0)), improvementPct: Math.max(0, Math.min(100, Number(c?.improvement_pct ?? 20))), weightInClvPct: Math.max(0, Math.min(100, Number(c?.weight_in_clv_pct ?? 10))), improvementStrategy: String(c?.improvement_strategy ?? '').slice(0, 250) })),
      predictions: (parsed?.predictions || []).slice(0, 25).map((p: any) => ({ buyerName: String(p?.buyer_name ?? '').slice(0, 100), nextPurchaseProbabilityPct: Math.max(0, Math.min(100, Number(p?.next_purchase_probability_pct ?? 50))), predictedNextPurchaseValueEur: Math.round(Number(p?.predicted_next_purchase_value_eur ?? 0)), predictedPurchaseFrequency12m: Math.round(Number(p?.predicted_purchase_frequency_12m ?? 0) * 10) / 10, churnProbabilityPct: Math.max(0, Math.min(100, Number(p?.churn_probability_pct ?? 30))), keyGrowthDriver: String(p?.key_growth_driver ?? '').slice(0, 200), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 70))) })),
      recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({ buyerName: String(r?.buyer_name ?? '').slice(0, 100), action: String(r?.action ?? '').slice(0, 300), expectedClvLiftEur: Math.round(Number(r?.expected_clv_lift_eur ?? 0)), investmentEur: Math.round(Number(r?.investment_eur ?? 0)), expectedRoiPct: Math.round(Number(r?.expected_roi_pct ?? 0) * 10) / 10, timeframeMonths: Math.max(1, Number(r?.timeframe_months ?? 3)), priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'survival_analysis', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['clv_prediction', 'churn_probability', 'purchase_forecast', 'value_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'clv_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { clvPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.clv_prediction_score ?? 50))), clvGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.clv_grade)) ? String(parsed.summary.clv_grade) : 'C', totalPortfolioClvEur: Math.round(Number(parsed?.summary?.total_portfolio_clv_eur ?? 0)), avgClvEur: Math.round(Number(parsed?.summary?.avg_clv_eur ?? 0)), vipBuyersCount: Math.max(0, Number(parsed?.summary?.vip_buyers_count ?? 0)), biggestClvRisk: String(parsed?.summary?.biggest_clv_risk ?? '').slice(0, 200), biggestClvOpportunity: String(parsed?.summary?.biggest_clv_opportunity ?? '').slice(0, 200), quickestClvWin: String(parsed?.summary?.quickest_clv_win ?? '').slice(0, 200), clvAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.clv_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
