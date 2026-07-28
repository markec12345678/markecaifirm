// v6.67: AI Buyer Satisfaction Predictor — napove zadovoljstvo kupca z ML in NPS prediction
// POST /api/ai/buyer-satisfaction-predictor
// Body: { customerName?: string }
// Returns: { ok, predictor: { buyers, satisfactionFactors, npsPrediction, interventions, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const SATISFACTION_FACTORS = ['price_fairness', 'item_quality', 'communication_quality', 'shipping_speed', 'packaging_quality', 'description_accuracy', 'seller_responsiveness', 'post_sale_support', 'overall_experience', 'value_for_money'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } },
      select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true, buyPrice: true, buyFees: true },
      take: 500, orderBy: { sellDate: 'desc' },
    });

    if (soldTrades.length === 0) return NextResponse.json({ ok: true, predictor: null, message: 'Ni prodaj za satisfaction prediction.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; categories: Set<string> }>();
    const now = Date.now();
    for (const t of soldTrades) {
      const name = (t.sellLocation || '').trim();
      if (!name || name.length < 2 || !t.sellDate) continue;
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, categories: new Set() });
      const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += revenue;
      if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate;
      if (t.category) b.categories.add(t.category);
    }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });

    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, predictor: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 15).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d zadnji`).join('\n');

    const prompt = `Si AI buyer satisfaction predictor z ML in NPS prediction.
Napove zadovoljstvo kupca z 10-faktorsko analizo in NPS (Net Promoter Score).

KUPCI (${targetBuyers.length}):
${buyersStr}

10 satisfaction faktorjev:
1. PRICE_FAIRNESS: ali je kupec dobil vrednost za ceno
2. ITEM_QUALITY: ali je item ustrezal opisu
3. COMMUNICATION_QUALITY: kakovost komunikacije
4. SHIPPING_SPEED: hitrost dostave/prevzema
5. PACKAGING_QUALITY: kakovost pakiranja
6. DESCRIPTION_ACCURACY: ali je opis ustrezal realnosti
7. SELLER_RESPONSIVENESS: hitrost odgovorov
8. POST_SALE_SUPPORT: support po nakupu
9. OVERALL_EXPERIENCE: splošna izkušnja
10. VALUE_FOR_MONEY: razmerje cena/kakovost

NPS (Net Promoter Score):
- PROMOTERS (9-10): zelo zadovoljni, priporočajo
- PASSIVES (7-8): zadovoljni, a ne priporočajo
- DETRACTORS (0-6): nezadovoljni, odsvetujejo

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>", "satisfaction_score": <number 0-100>, "satisfaction_level": "<very_satisfied|satisfied|neutral|dissatisfied|very_dissatisfied>",
      "nps_category": "<promoter|passive|detractor>", "nps_score": <number 0-10>,
      "satisfaction_factors": [{"factor": "<10 faktorjev>", "score": <number 0-100>, "status": "<excellent|good|average|poor|critical>", "improvement_action": "<max 100 znakov>"}],
      "predicted_repeat_purchase_probability_pct": <number 0-100>, "predicted_referral_probability_pct": <number 0-100>,
      "predicted_churn_probability_pct": <number 0-100>, "predicted_lifetime_value_eur": <number>,
      "key_satisfaction_drivers": ["<max 80 znakov>"], "key_dissatisfaction_drivers": ["<max 80 znakov>"],
      "recommended_intervention": "<maintain|nurture|recover|escalate>", "intervention_priority": "<high|medium|low>"
    }
  ],
  "satisfaction_factors": [
    {"factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 120 znakov>"}
  ],
  "nps_prediction": [
    {"nps_category": "<promoter|passive|detractor>", "buyer_count": <number>, "percentage": <number 0-100>, "avg_satisfaction_score": <number 0-100>, "characteristics": "<max 100 znakov>", "strategy": "<max 120 znakov>"}
  ],
  "interventions": [
    {"intervention": "<max 120 znakov>", "target_satisfaction_level": "<very_satisfied|satisfied|neutral|dissatisfied|very_dissatisfied>", "description": "<max 150 znakov>", "expected_satisfaction_lift_pct": <number>, "implementation_cost_eur": <number>, "priority": "<high|medium|low>"}
  ],
  "ml_models": [
    {"model": "<random_forest|gradient_boosting|neural_network|logistic_regression|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<satisfaction|nps|churn|repeat_purchase>", "weight_in_ensemble": <number 0-100>}
  ],
  "summary": {
    "total_buyers_analyzed": <number>, "avg_satisfaction_score": <number 0-100>,
    "promoter_count": <number>, "passive_count": <number>, "detractor_count": <number>,
    "nps_score": <number -100 do 100>, "avg_repeat_purchase_probability_pct": <number>,
    "biggest_satisfaction_driver": "<max 100 znakov>", "biggest_dissatisfaction_driver": "<max 100 znakov>",
    "satisfaction_prediction_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const predictor = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        satisfactionScore: Math.max(0, Math.min(100, Number(b?.satisfaction_score ?? 60))),
        satisfactionLevel: ['very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied'].includes(String(b?.satisfaction_level)) ? String(b.satisfaction_level) : 'satisfied',
        npsCategory: ['promoter', 'passive', 'detractor'].includes(String(b?.nps_category)) ? String(b.nps_category) : 'passive',
        npsScore: Math.max(0, Math.min(10, Number(b?.nps_score ?? 7))),
        satisfactionFactors: (b?.satisfaction_factors || []).slice(0, 10).map((f: any) => ({
          factor: SATISFACTION_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'price_fairness',
          score: Math.max(0, Math.min(100, Number(f?.score ?? 50))),
          status: ['excellent', 'good', 'average', 'poor', 'critical'].includes(String(f?.status)) ? String(f.status) : 'average',
          improvementAction: String(f?.improvement_action ?? '').slice(0, 200),
        })),
        predictedRepeatPurchaseProbabilityPct: Math.max(0, Math.min(100, Number(b?.predicted_repeat_purchase_probability_pct ?? 40))),
        predictedReferralProbabilityPct: Math.max(0, Math.min(100, Number(b?.predicted_referral_probability_pct ?? 30))),
        predictedChurnProbabilityPct: Math.max(0, Math.min(100, Number(b?.predicted_churn_probability_pct ?? 30))),
        predictedLifetimeValueEur: Math.round(Number(b?.predicted_lifetime_value_eur ?? 0)),
        keySatisfactionDrivers: (b?.key_satisfaction_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
        keyDissatisfactionDrivers: (b?.key_dissatisfaction_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
        recommendedIntervention: ['maintain', 'nurture', 'recover', 'escalate'].includes(String(b?.recommended_intervention)) ? String(b.recommended_intervention) : 'maintain',
        interventionPriority: ['high', 'medium', 'low'].includes(String(b?.intervention_priority)) ? String(b.intervention_priority) : 'medium',
      })),
      satisfactionFactors: (parsed?.satisfaction_factors || []).slice(0, 10).map((f: any) => ({
        factor: SATISFACTION_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'price_fairness',
        weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))), avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
        benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))),
        improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
        bestPractice: String(f?.best_practice ?? '').slice(0, 250),
      })),
      npsPrediction: (parsed?.nps_prediction || []).slice(0, 3).map((n: any) => ({
        npsCategory: ['promoter', 'passive', 'detractor'].includes(String(n?.nps_category)) ? String(n.nps_category) : 'passive',
        buyerCount: Math.max(0, Number(n?.buyer_count ?? 0)), percentage: Math.max(0, Math.min(100, Number(n?.percentage ?? 33))),
        avgSatisfactionScore: Math.max(0, Math.min(100, Number(n?.avg_satisfaction_score ?? 60))),
        characteristics: String(n?.characteristics ?? '').slice(0, 200), strategy: String(n?.strategy ?? '').slice(0, 250),
      })),
      interventions: (parsed?.interventions || []).slice(0, 6).map((i: any) => ({
        intervention: String(i?.intervention ?? '').slice(0, 250),
        targetSatisfactionLevel: ['very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied'].includes(String(i?.target_satisfaction_level)) ? String(i.target_satisfaction_level) : 'neutral',
        description: String(i?.description ?? '').slice(0, 300),
        expectedSatisfactionLiftPct: Math.round(Number(i?.expected_satisfaction_lift_pct ?? 0)),
        implementationCostEur: Math.round(Number(i?.implementation_cost_eur ?? 0)),
        priority: ['high', 'medium', 'low'].includes(String(i?.priority)) ? String(i.priority) : 'medium',
      })),
      mlModels: (parsed?.ml_models || []).slice(0, 5).map((m: any) => ({
        model: ['random_forest', 'gradient_boosting', 'neural_network', 'logistic_regression', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        predictionType: ['satisfaction', 'nps', 'churn', 'repeat_purchase'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'satisfaction',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length, avgSatisfactionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_satisfaction_score ?? 60))),
        promoterCount: Math.max(0, Number(parsed?.summary?.promoter_count ?? 0)), passiveCount: Math.max(0, Number(parsed?.summary?.passive_count ?? 0)),
        detractorCount: Math.max(0, Number(parsed?.summary?.detractor_count ?? 0)),
        npsScore: Math.max(-100, Math.min(100, Number(parsed?.summary?.nps_score ?? 0))),
        avgRepeatPurchaseProbabilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_repeat_purchase_probability_pct ?? 40))),
        biggestSatisfactionDriver: String(parsed?.summary?.biggest_satisfaction_driver ?? '').slice(0, 200),
        biggestDissatisfactionDriver: String(parsed?.summary?.biggest_dissatisfaction_driver ?? '').slice(0, 200),
        satisfactionPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.satisfaction_prediction_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, predictor });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
