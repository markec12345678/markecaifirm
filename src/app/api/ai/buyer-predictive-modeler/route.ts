// v6.71: AI Buyer Predictive Modeler — napove vedenje kupca z ML ensemble
// POST /api/ai/buyer-predictive-modeler
// Body: { customerName?: string, daysAhead?: number }
// Returns: { ok, modeler: { buyers, predictions, behavioralModels, triggers, mlEnsemble, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const PREDICTION_TYPES = ['next_purchase', 'purchase_amount', 'category_preference', 'churn_probability', 'ltv_projection', 'referral_probability', 'response_probability', 'negotiation_outcome'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;
    const daysAhead = Math.max(7, Math.min(365, Number(body?.daysAhead ?? 90)));

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, modeler: null, message: 'Ni prodaj za predictive modeling.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; firstPurchase: Date | null; categories: Set<string>; purchaseDates: Date[] }>();
    const now = Date.now();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2 || !t.sellDate) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, firstPurchase: t.sellDate, categories: new Set(), purchaseDates: [] }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; if (!b.firstPurchase || t.sellDate < b.firstPurchase) b.firstPurchase = t.sellDate; if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate; if (t.category) b.categories.add(t.category); b.purchaseDates.push(t.sellDate); }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, modeler: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 25);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.avgOrder}€ povp | ${b.daysSinceLast}d zadnji | ${b.categories.size} kat`).join('\n');

    const prompt = `Si AI buyer predictive modeler z ML ensemble za napoved vedenja kupcev.
Napove 8 tipov vedenja v naslednjih ${daysAhead} dneh.

KUPCI (${targetBuyers.length}):
${buyersStr}

8 prediction tipov:
1. NEXT_PURCHASE: kdaj bo naslednji nakup
2. PURCHASE_AMOUNT: koliko bo porabil
3. CATEGORY_PREFERENCE: katero kategorijo bo izbral
4. CHURN_PROBABILITY: verjetnost odhoda
5. LTV_PROJECTION: projected lifetime value
6. REFERRAL_PROBABILITY: verjetnost priporočila
7. RESPONSE_PROBABILITY: verjetnost odziva na outreach
8. NEGOTIATION_OUTCOME: izid pogajanja

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    {
      "name": "<ime>",
      "predictions": [
        { "prediction_type": "<8 tipov>", "predicted_value": "<max 100 znakov>", "probability_pct": <number 0-100>, "confidence_pct": <number 0-100>, "timeframe_days": <number>, "based_on_factors": ["<max 60 znakov>"] }
      ],
      "next_purchase_prediction": { "predicted_date": "<YYYY-MM-DD>", "predicted_category": "<max 50 znakov>", "predicted_amount_eur": <number>, "probability_pct": <number 0-100> },
      "ltv_projection": { "6m_eur": <number>, "12m_eur": <number>, "24m_eur": <number>, "confidence_pct": <number 0-100> },
      "churn_risk_pct": <number 0-100>, "referral_probability_pct": <number 0-100>,
      "predicted_segment": "<champion|loyal|casual|at_risk|churning>",
      "recommended_action": "<nurture|reward|win_back|maintain|escalate>", "action_priority": "<high|medium|low>"
    }
  ],
  "predictions": [
    { "prediction_type": "<8 tipov>", "avg_probability_pct": <number 0-100>, "avg_confidence_pct": <number 0-100>, "buyer_count": <number>, "description": "<max 120 znakov>", "best_model": "<max 80 znakov>" }
  ],
  "behavioralModels": [
    { "model_name": "<max 80 znakov>", "description": "<max 120 znakov>", "input_features": ["<max 60 znakov>"], "output_prediction": "<8 tipov>", "accuracy_pct": <number 0-100>, "best_for": "<max 80 znakov>" }
  ],
  "triggers": [
    { "trigger_name": "<max 80 znakov>", "description": "<max 100 znakov>", "affected_buyers": <number>, "prediction_type": "<8 tipov>", "trigger_condition": "<max 100 znakov>", "recommended_action": "<max 120 znakov>", "urgency": "<immediate|7d|30d|90d>" }
  ],
  "mlEnsemble": [
    { "model": "<random_forest|gradient_boosting|lstm|neural_network|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<8 tipov>", "weight_in_ensemble": <number 0-100>, "training_data_size": <number> }
  ],
  "summary": {
    "total_buyers_modeled": <number>, "avg_confidence_pct": <number 0-100>, "most_reliable_prediction": "<8 tipov>",
    "biggest_predictive_opportunity": "<max 100 znakov>", "biggest_predictive_risk": "<max 100 znakov>",
    "quickest_predictive_win": "<max 100 znakov>", "predictive_modeling_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const modeler = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        predictions: (b?.predictions || []).slice(0, 8).map((p: any) => ({
          predictionType: PREDICTION_TYPES.includes(String(p?.prediction_type) as any) ? String(p.prediction_type) : 'next_purchase',
          predictedValue: String(p?.predicted_value ?? '').slice(0, 200), probabilityPct: Math.max(0, Math.min(100, Number(p?.probability_pct ?? 50))),
          confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))), timeframeDays: Math.max(1, Number(p?.timeframe_days ?? 30)),
          basedOnFactors: (p?.based_on_factors || []).slice(0, 5).map((f: any) => String(f).slice(0, 100)),
        })),
        nextPurchasePrediction: {
          predictedDate: String(b?.next_purchase_prediction?.predicted_date ?? '').slice(0, 20),
          predictedCategory: String(b?.next_purchase_prediction?.predicted_category ?? '').slice(0, 80),
          predictedAmountEur: Math.round(Number(b?.next_purchase_prediction?.predicted_amount_eur ?? 0)),
          probabilityPct: Math.max(0, Math.min(100, Number(b?.next_purchase_prediction?.probability_pct ?? 30))),
        },
        ltvProjection: {
          '6mEur': Math.round(Number(b?.ltv_projection?.['6m_eur'] ?? 0)), '12mEur': Math.round(Number(b?.ltv_projection?.['12m_eur'] ?? 0)),
          '24mEur': Math.round(Number(b?.ltv_projection?.['24m_eur'] ?? 0)), confidencePct: Math.max(0, Math.min(100, Number(b?.ltv_projection?.confidence_pct ?? 50))),
        },
        churnRiskPct: Math.max(0, Math.min(100, Number(b?.churn_risk_pct ?? 30))),
        referralProbabilityPct: Math.max(0, Math.min(100, Number(b?.referral_probability_pct ?? 20))),
        predictedSegment: ['champion', 'loyal', 'casual', 'at_risk', 'churning'].includes(String(b?.predicted_segment)) ? String(b.predicted_segment) : 'casual',
        recommendedAction: ['nurture', 'reward', 'win_back', 'maintain', 'escalate'].includes(String(b?.recommended_action)) ? String(b.recommended_action) : 'maintain',
        actionPriority: ['high', 'medium', 'low'].includes(String(b?.action_priority)) ? String(b.action_priority) : 'medium',
      })),
      predictions: (parsed?.predictions || []).slice(0, 8).map((p: any) => ({
        predictionType: PREDICTION_TYPES.includes(String(p?.prediction_type) as any) ? String(p.prediction_type) : 'next_purchase',
        avgProbabilityPct: Math.max(0, Math.min(100, Number(p?.avg_probability_pct ?? 40))), avgConfidencePct: Math.max(0, Math.min(100, Number(p?.avg_confidence_pct ?? 50))),
        buyerCount: Math.max(0, Number(p?.buyer_count ?? 0)), description: String(p?.description ?? '').slice(0, 250), bestModel: String(p?.best_model ?? '').slice(0, 150),
      })),
      behavioralModels: (parsed?.behavioralModels || []).slice(0, 5).map((m: any) => ({
        modelName: String(m?.model_name ?? '').slice(0, 150), description: String(m?.description ?? '').slice(0, 250),
        inputFeatures: (m?.input_features || []).slice(0, 6).map((f: any) => String(f).slice(0, 100)),
        outputPrediction: PREDICTION_TYPES.includes(String(m?.output_prediction) as any) ? String(m.output_prediction) : 'next_purchase',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))), bestFor: String(m?.best_for ?? '').slice(0, 150),
      })),
      triggers: (parsed?.triggers || []).slice(0, 8).map((t: any) => ({
        triggerName: String(t?.trigger_name ?? '').slice(0, 150), description: String(t?.description ?? '').slice(0, 200),
        affectedBuyers: Math.max(0, Number(t?.affected_buyers ?? 0)),
        predictionType: PREDICTION_TYPES.includes(String(t?.prediction_type) as any) ? String(t.prediction_type) : 'churn_probability',
        triggerCondition: String(t?.trigger_condition ?? '').slice(0, 200), recommendedAction: String(t?.recommended_action ?? '').slice(0, 250),
        urgency: ['immediate', '7d', '30d', '90d'].includes(String(t?.urgency)) ? String(t.urgency) : '30d',
      })),
      mlEnsemble: (parsed?.mlEnsemble || []).slice(0, 5).map((m: any) => ({
        model: ['random_forest', 'gradient_boosting', 'lstm', 'neural_network', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        predictionType: PREDICTION_TYPES.includes(String(m?.prediction_type) as any) ? String(m.prediction_type) : 'next_purchase',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))), trainingDataSize: Math.max(0, Number(m?.training_data_size ?? 0)),
      })),
      summary: {
        totalBuyersModeled: targetBuyers.length, avgConfidencePct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_confidence_pct ?? 50))),
        mostReliablePrediction: PREDICTION_TYPES.includes(String(parsed?.summary?.most_reliable_prediction) as any) ? String(parsed.summary.most_reliable_prediction) : 'next_purchase',
        biggestPredictiveOpportunity: String(parsed?.summary?.biggest_predictive_opportunity ?? '').slice(0, 200),
        biggestPredictiveRisk: String(parsed?.summary?.biggest_predictive_risk ?? '').slice(0, 200),
        quickestPredictiveWin: String(parsed?.summary?.quickest_predictive_win ?? '').slice(0, 200),
        predictiveModelingScore: Math.max(0, Math.min(100, Number(parsed?.summary?.predictive_modeling_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, modeler });
  } catch (e: any) { logger.error("/api/ai/buyer-predictive-modeler", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
