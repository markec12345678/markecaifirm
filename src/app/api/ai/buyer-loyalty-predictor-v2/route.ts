// v6.86: AI Buyer Loyalty Predictor v2 — ML napoved loyalnosti kupcev z behavior prediction
// POST /api/ai/buyer-loyalty-predictor-v2
// Body: { customerName?: string }
// Returns: { ok, predictor: { overview, buyers, loyaltyFactors, predictions, interventions, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const LOYALTY_LEVELS = ['devoted', 'committed', 'engaged', 'casual', 'at_risk', 'disengaged'] as const;
const FACTOR_TYPES = ['purchase_frequency', 'avg_order_growth', 'category_diversity', 'engagement_score', 'referral_activity', 'feedback_provision', 'seasonal_consistency', 'price_insensitivity', 'communication_responsiveness', 'brand_advocacy'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za loyalty prediction.' });

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

    const prompt = `Si AI buyer loyalty predictor v2 z ML in behavior prediction.
Napoveduje loyalnost kupcev z 6 nivoji in 10 dejavniki, predlaga intervencije.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 nivojev loyalnosti:
1. DEVOTED: zelo zvest (95-100%)
2. COMMITTED: zvest (80-94%)
3. ENGAGED: angažiran (65-79%)
4. CASUAL: občasen (45-64%)
5. AT_RISK: ogrožen (25-44%)
6. DISENGAGED: nezainteresiran (<25%)

10 dejavnikov loyalnosti: purchase_frequency, avg_order_growth, category_diversity, engagement_score, referral_activity, feedback_provision, seasonal_consistency, price_insensitivity, communication_responsiveness, brand_advocacy

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "overview": { "total_buyers": <number>, "avg_loyalty_score": <number 0-100>, "devoted_count": <number>, "at_risk_count": <number>, "disengaged_count": <number>, "loyalty_grade": "<A|B|C|D|F>" },
  "buyers": [
    { "name": "<string>", "loyalty_score": <number 0-100>, "loyalty_level": "<${LOYALTY_LEVELS.join('|')}>", "predicted_loyalty_6m_pct": <number 0-100>, "predicted_loyalty_12m_pct": <number 0-100>, "lifetime_value_eur": <number>, "churn_probability_pct": <number 0-100>, "loyalty_trend": "<improving|stable|declining>", "primary_action": "<reward|maintain|re_engage|save|monitor>" }
  ],
  "loyaltyFactors": [
    { "factor": "<${FACTOR_TYPES.join('|')}>", "avg_score": <number 0-100>, "weight_pct": <number 0-100>, "impact_on_loyalty": "<high|medium|low>", "improvement_potential_pct": <number 0-50>, "improvement_strategy": "<max 120 znakov>" }
  ],
  "predictions": [
    { "buyer_name": "<string>", "predicted_next_purchase_date": "<YYYY-MM>", "predicted_next_purchase_value_eur": <number>, "predicted_loyalty_trajectory": "<ascending|plateau|descending>", "key_risk_factor": "<max 100 znakov>", "key_opportunity": "<max 100 znakov>", "confidence_pct": <number 0-100> }
  ],
  "interventions": [
    { "buyer_name": "<string>", "intervention_type": "<loyalty_reward|personal_offer|exclusive_access|feedback_request|check_in|upgrade_tier>", "description": "<max 150 znakov>", "expected_loyalty_lift_pct": <number 0-30>, "cost_eur": <number>, "expected_revenue_eur": <number>, "implementation_days": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|survival_analysis|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<loyalty_prediction|churn_probability|lifetime_value|behavior_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "loyalty_prediction_score": <number 0-100>, "loyalty_grade": "<A|B|C|D|F>", "avg_loyalty_score": <number 0-100>,
    "devoted_buyers_count": <number>, "at_risk_buyers_count": <number>,
    "biggest_loyalty_risk": "<max 100 znakov>", "biggest_loyalty_opportunity": "<max 100 znakov>",
    "quickest_loyalty_win": "<max 100 znakov>", "loyalty_prediction_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      overview: { totalBuyers: Math.max(0, Number(parsed?.overview?.total_buyers ?? targetBuyers.length)), avgLoyaltyScore: Math.max(0, Math.min(100, Number(parsed?.overview?.avg_loyalty_score ?? 60))), devotedCount: Math.max(0, Number(parsed?.overview?.devoted_count ?? 0)), atRiskCount: Math.max(0, Number(parsed?.overview?.at_risk_count ?? 0)), disengagedCount: Math.max(0, Number(parsed?.overview?.disengaged_count ?? 0)), loyaltyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.overview?.loyalty_grade)) ? String(parsed.overview.loyalty_grade) : 'C' },
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), loyaltyScore: Math.max(0, Math.min(100, Number(b?.loyalty_score ?? 60))), loyaltyLevel: (LOYALTY_LEVELS as readonly string[]).includes(String(b?.loyalty_level)) ? String(b.loyalty_level) : 'engaged', predictedLoyalty6mPct: Math.max(0, Math.min(100, Number(b?.predicted_loyalty_6m_pct ?? 60))), predictedLoyalty12mPct: Math.max(0, Math.min(100, Number(b?.predicted_loyalty_12m_pct ?? 55))), lifetimeValueEur: Math.round(Number(b?.lifetime_value_eur ?? 0)), churnProbabilityPct: Math.max(0, Math.min(100, Number(b?.churn_probability_pct ?? 30))), loyaltyTrend: ['improving', 'stable', 'declining'].includes(String(b?.loyalty_trend)) ? String(b.loyalty_trend) : 'stable', primaryAction: ['reward', 'maintain', 're_engage', 'save', 'monitor'].includes(String(b?.primary_action)) ? String(b.primary_action) : 'maintain' })),
      loyaltyFactors: (parsed?.loyaltyFactors || []).slice(0, 10).map((f: any) => ({ factor: (FACTOR_TYPES as readonly string[]).includes(String(f?.factor)) ? String(f.factor) : 'purchase_frequency', avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 60))), weightPct: Math.max(0, Math.min(100, Number(f?.weight_pct ?? 10))), impactOnLoyalty: ['high', 'medium', 'low'].includes(String(f?.impact_on_loyalty)) ? String(f.impact_on_loyalty) : 'medium', improvementPotentialPct: Math.max(0, Math.min(50, Number(f?.improvement_potential_pct ?? 15))), improvementStrategy: String(f?.improvement_strategy ?? '').slice(0, 250) })),
      predictions: (parsed?.predictions || []).slice(0, 25).map((p: any) => ({ buyerName: String(p?.buyer_name ?? '').slice(0, 100), predictedNextPurchaseDate: String(p?.predicted_next_purchase_date ?? '').slice(0, 7), predictedNextPurchaseValueEur: Math.round(Number(p?.predicted_next_purchase_value_eur ?? 0)), predictedLoyaltyTrajectory: ['ascending', 'plateau', 'descending'].includes(String(p?.predicted_loyalty_trajectory)) ? String(p.predicted_loyalty_trajectory) : 'plateau', keyRiskFactor: String(p?.key_risk_factor ?? '').slice(0, 200), keyOpportunity: String(p?.key_opportunity ?? '').slice(0, 200), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 70))) })),
      interventions: (parsed?.interventions || []).slice(0, 10).map((i: any) => ({ buyerName: String(i?.buyer_name ?? '').slice(0, 100), interventionType: ['loyalty_reward', 'personal_offer', 'exclusive_access', 'feedback_request', 'check_in', 'upgrade_tier'].includes(String(i?.intervention_type)) ? String(i.intervention_type) : 'loyalty_reward', description: String(i?.description ?? '').slice(0, 300), expectedLoyaltyLiftPct: Math.max(0, Math.min(30, Number(i?.expected_loyalty_lift_pct ?? 10))), costEur: Math.round(Number(i?.cost_eur ?? 0)), expectedRevenueEur: Math.round(Number(i?.expected_revenue_eur ?? 0)), implementationDays: Math.max(1, Number(i?.implementation_days ?? 7)), priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'survival_analysis', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['loyalty_prediction', 'churn_probability', 'lifetime_value', 'behavior_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'loyalty_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { loyaltyPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.loyalty_prediction_score ?? 50))), loyaltyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.loyalty_grade)) ? String(parsed.summary.loyalty_grade) : 'C', avgLoyaltyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_loyalty_score ?? 60))), devotedBuyersCount: Math.max(0, Number(parsed?.summary?.devoted_buyers_count ?? 0)), atRiskBuyersCount: Math.max(0, Number(parsed?.summary?.at_risk_buyers_count ?? 0)), biggestLoyaltyRisk: String(parsed?.summary?.biggest_loyalty_risk ?? '').slice(0, 200), biggestLoyaltyOpportunity: String(parsed?.summary?.biggest_loyalty_opportunity ?? '').slice(0, 200), quickestLoyaltyWin: String(parsed?.summary?.quickest_loyalty_win ?? '').slice(0, 200), loyaltyPredictionAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.loyalty_prediction_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { logger.error("/api/ai/buyer-loyalty-predictor-v2", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
