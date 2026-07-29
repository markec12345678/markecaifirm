// v6.81: AI Buyer Churn Predictor v2 — ML napoved odhoda kupcev z intervention strategy
// POST /api/ai/buyer-churn-predictor-v2
// Body: { customerName?: string, days?: number }
// Returns: { ok, predictor: { buyers, churnDrivers, interventionStrategies, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const CHURN_TIERS = ['safe', 'low_risk', 'medium_risk', 'high_risk', 'critical', 'churned'] as const;
const CHURN_DRIVERS = ['inactivity', 'price_sensitivity', 'competitor_switch', 'poor_experience', 'no_engagement', 'category_disinterest', 'seasonal_gap', 'communication_failure'] as const;
const INTERVENTION_TYPES = ['win_back_offer', 'personalized_outreach', 'loyalty_upgrade', 'discount_campaign', 'product_recommendation', 'feedback_request', 'reactivation_bundle'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za churn analizo.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; firstPurchase: Date | null; lastPurchase: Date | null; categories: Set<string>; daysSinceLast: number }>();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, firstPurchase: t.sellDate, lastPurchase: t.sellDate, categories: new Set(), daysSinceLast: 0 });
      const b = buyerMap.get(name)!;
      b.purchases += 1; b.totalSpent += rev;
      if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / DAY) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d nazadnje | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer churn predictor v2 z ML in intervention strategy design.
Napoveduje odhod kupcev z 6 tierji in 8 dejavniki, predlaga 7 tipov intervencij.

KUPCI (${targetBuyers.length}):
${buyersStr}

6 churn tierjev:
1. SAFE: <10% verjetnost odhoda
2. LOW_RISK: 10-25% verjetnost
3. MEDIUM_RISK: 25-50% verjetnost
4. HIGH_RISK: 50-75% verjetnost
5. CRITICAL: 75-90% verjetnost
6. CHURNED: >90% verjetnost (že izgubljen)

8 churn driverjev:
1. INACTIVITY: dolga neaktivnost
2. PRICE_SENSITIVITY: občutljivost na ceno
3. COMPETITOR_SWITCH: preklop na konkurenco
4. POOR_EXPERIENCE: slaba izkušnja
5. NO_ENGAGEMENT: brez engagementa
6. CATEGORY_DISINTEREST: nezanimanje za kategorijo
7. SEASONAL_GAP: sezonska vrzel
8. COMMUNICATION_FAILURE: napaka v komunikaciji

7 intervencijskih tipov: win_back_offer, personalized_outreach, loyalty_upgrade, discount_campaign, product_recommendation, feedback_request, reactivation_bundle

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<string>", "churn_probability_pct": <number 0-100>, "churn_tier": "<${CHURN_TIERS.join('|')}>", "predicted_churn_date": "<YYYY-MM>", "primary_driver": "<${CHURN_DRIVERS.join('|')}>", "days_since_last_purchase": <number>, "lifetime_value_eur": <number>, "at_risk_revenue_eur": <number>, "recommended_intervention": "<${INTERVENTION_TYPES.join('|')}>" }
  ],
  "churnDrivers": [
    { "driver": "<${CHURN_DRIVERS.join('|')}>", "affected_buyers_count": <number>, "avg_churn_probability_pct": <number 0-100>, "revenue_at_risk_eur": <number>, "severity": "<critical|high|medium|low>", "mitigation_strategy": "<max 150 znakov>" }
  ],
  "interventionStrategies": [
    { "intervention_type": "<${INTERVENTION_TYPES.join('|')}>", "target_buyer_count": <number>, "estimated_cost_eur": <number>, "expected_recovery_rate_pct": <number 0-100>, "expected_revenue_recovered_eur": <number>, "implementation_days": <number>, "roi_pct": <number> }
  ],
  "mlModels": [
    { "model": "<random_forest|xgboost|neural_net|survival_analysis|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<churn_probability|risk_score|lifetime_value|intervention_response>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "churn_risk_score": <number 0-100>, "churn_risk_grade": "<A|B|C|D|F>", "total_at_risk_revenue_eur": <number>,
    "critical_buyers_count": <number>, "avg_churn_probability_pct": <number 0-100>,
    "biggest_churn_risk": "<max 100 znakov>", "biggest_retention_opportunity": "<max 100 znakov>",
    "quickest_retention_win": "<max 100 znakov>", "churn_prediction_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).slice(0, 25).map((b: any) => ({ name: String(b?.name ?? '').slice(0, 100), churnProbabilityPct: Math.max(0, Math.min(100, Number(b?.churn_probability_pct ?? 30))), churnTier: (CHURN_TIERS as readonly string[]).includes(String(b?.churn_tier)) ? String(b.churn_tier) : 'low_risk', predictedChurnDate: String(b?.predicted_churn_date ?? '').slice(0, 7), primaryDriver: (CHURN_DRIVERS as readonly string[]).includes(String(b?.primary_driver)) ? String(b.primary_driver) : 'inactivity', daysSinceLastPurchase: Math.max(0, Number(b?.days_since_last_purchase ?? 0)), lifetimeValueEur: Math.round(Number(b?.lifetime_value_eur ?? 0)), atRiskRevenueEur: Math.round(Number(b?.at_risk_revenue_eur ?? 0)), recommendedIntervention: (INTERVENTION_TYPES as readonly string[]).includes(String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'personalized_outreach' })),
      churnDrivers: (parsed?.churnDrivers || []).slice(0, 8).map((d: any) => ({ driver: (CHURN_DRIVERS as readonly string[]).includes(String(d?.driver)) ? String(d.driver) : 'inactivity', affectedBuyersCount: Math.max(0, Number(d?.affected_buyers_count ?? 0)), avgChurnProbabilityPct: Math.max(0, Math.min(100, Number(d?.avg_churn_probability_pct ?? 0))), revenueAtRiskEur: Math.round(Number(d?.revenue_at_risk_eur ?? 0)), severity: ['critical', 'high', 'medium', 'low'].includes(String(d?.severity)) ? String(d.severity) : 'medium', mitigationStrategy: String(d?.mitigation_strategy ?? '').slice(0, 300) })),
      interventionStrategies: (parsed?.interventionStrategies || []).slice(0, 7).map((s: any) => ({ interventionType: (INTERVENTION_TYPES as readonly string[]).includes(String(s?.intervention_type)) ? String(s.intervention_type) : 'win_back_offer', targetBuyerCount: Math.max(0, Number(s?.target_buyer_count ?? 0)), estimatedCostEur: Math.round(Number(s?.estimated_cost_eur ?? 0)), expectedRecoveryRatePct: Math.max(0, Math.min(100, Number(s?.expected_recovery_rate_pct ?? 30))), expectedRevenueRecoveredEur: Math.round(Number(s?.expected_revenue_recovered_eur ?? 0)), implementationDays: Math.max(1, Number(s?.implementation_days ?? 7)), roiPct: Math.round(Number(s?.roi_pct ?? 0) * 10) / 10 })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['random_forest', 'xgboost', 'neural_net', 'survival_analysis', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['churn_probability', 'risk_score', 'lifetime_value', 'intervention_response'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'churn_probability', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { churnRiskScore: Math.max(0, Math.min(100, Number(parsed?.summary?.churn_risk_score ?? 50))), churnRiskGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.churn_risk_grade)) ? String(parsed.summary.churn_risk_grade) : 'C', totalAtRiskRevenueEur: Math.round(Number(parsed?.summary?.total_at_risk_revenue_eur ?? 0)), criticalBuyersCount: Math.max(0, Number(parsed?.summary?.critical_buyers_count ?? 0)), avgChurnProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_churn_probability_pct ?? 30))), biggestChurnRisk: String(parsed?.summary?.biggest_churn_risk ?? '').slice(0, 200), biggestRetentionOpportunity: String(parsed?.summary?.biggest_retention_opportunity ?? '').slice(0, 200), quickestRetentionWin: String(parsed?.summary?.quickest_retention_win ?? '').slice(0, 200), churnPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.churn_prediction_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
