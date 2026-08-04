// v6.70: AI Buyer Journey Optimizer — optimizira buyer journey z ML in touchpoint mapping
// POST /api/ai/buyer-journey-optimizer
// Body: { customerName?: string }
// Returns: { ok, optimizer: { buyers, journeys, touchpoints, optimizations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const JOURNEY_STAGES = ['awareness', 'interest', 'consideration', 'intent', 'evaluation', 'purchase', 'retention', 'advocacy'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const customerName = body?.customerName ? String(body.customerName).trim() : null;

    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellLocation: { not: '' }, sellDate: { not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, sellLocation: true, buyDate: true }, take: 500, orderBy: { sellDate: 'desc' } });
    if (soldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni prodaj za journey optimization.' });

    const buyerMap = new Map<string, { name: string; purchases: number; totalSpent: number; avgOrder: number; daysSinceLast: number; lastPurchase: Date | null; categories: Set<string> }>();
    const now = Date.now();
    for (const t of soldTrades) { const name = (t.sellLocation || '').trim(); if (!name || name.length < 2 || !t.sellDate) continue; const rev = (t.sellPrice ?? 0) - (t.sellFees ?? 0); if (!buyerMap.has(name)) buyerMap.set(name, { name, purchases: 0, totalSpent: 0, avgOrder: 0, daysSinceLast: 0, lastPurchase: t.sellDate, categories: new Set() }); const b = buyerMap.get(name)!; b.purchases += 1; b.totalSpent += rev; if (!b.lastPurchase || t.sellDate > b.lastPurchase) b.lastPurchase = t.sellDate; if (t.category) b.categories.add(t.category); }
    const buyers = Array.from(buyerMap.values()).map(b => { b.avgOrder = b.purchases > 0 ? Math.round(b.totalSpent / b.purchases) : 0; b.daysSinceLast = b.lastPurchase ? Math.round((now - b.lastPurchase.getTime()) / (24*60*60*1000)) : 999; return b; });
    if (customerName) { const f = buyers.filter(b => b.name === customerName); if (f.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: `Kupec "${customerName}" ni najden.` }); }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const targetBuyers = customerName ? buyers.filter(b => b.name === customerName) : buyers.slice(0, 20);
    const buyersStr = targetBuyers.slice(0, 10).map(b => `- ${b.name} | ${b.purchases}x | ${b.totalSpent}€ | ${b.daysSinceLast}d`).join('\n');

    const prompt = `Si AI buyer journey optimizer z ML in touchpoint mapping.
Optimizira buyer journey z 8 fazami in predlaga touchpoint improvements.

KUPCI (${targetBuyers.length}):
${buyersStr}

8 journey faz:
1. AWARENESS: kupec spozna da želi item
2. INTEREST: zanima se za specifične iteme
3. CONSIDERATION: primerja, razmišlja
4. INTENT: izrazi namero nakupa
5. EVALUATION: preverja stanje, ceno, lokacijo
6. PURCHASE: plača in prevzame
7. RETENTION: ponovni nakup
8. ADVOCACY: priporoča drugim

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "buyers": [
    { "name": "<ime>", "current_stage": "<8 faz>", "journey_progress_pct": <number 0-100>, "stage_probabilities": [{"stage": "<8 faz>", "probability_pct": <number 0-100>}], "next_optimal_stage": "<8 faz>", "stage_conversion_probability_pct": <number 0-100>, "journey_velocity_score": <number 0-100>, "blockers": ["<max 80 znakov>"], "accelerators": ["<max 80 znakov>"], "recommended_touchpoint": "<max 100 znakov>", "expected_conversion_uplift_pct": <number> }
  ],
  "journeys": [
    { "stage": "<8 faz>", "buyer_count": <number>, "avg_time_in_stage_days": <number>, "conversion_rate_to_next_pct": <number 0-100>, "drop_off_pct": <number 0-100>, "biggest_drop_reason": "<max 100 znakov>", "improvement_action": "<max 150 znakov>" }
  ],
  "touchpoints": [
    { "stage": "<8 faz>", "touchpoint": "<max 80 znakov>", "channel": "<bolha|facebook|vinted|email|sms|social|in_person>", "timing": "<max 80 znakov>", "message_template": "<max 200 znakov>", "expected_engagement_pct": <number 0-100>, "conversion_lift_pct": <number> }
  ],
  "optimizations": [
    { "optimization_type": "<stage_acceleration|drop_off_reduction|touchpoint_addition|timing_optimization|channel_optimization>", "stage_targeted": "<8 faz>", "description": "<max 120 znakov>", "expected_conversion_improvement_pct": <number>, "implementation_effort": "<low|medium|high>", "expected_revenue_impact_eur": <number> }
  ],
  "mlModels": [
    { "model": "<random_forest|gradient_boosting|lstm|markov_chain|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<stage_transition|conversion_probability|journey_velocity|drop_off>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_buyers_analyzed": <number>, "avg_journey_progress_pct": <number>, "avg_journey_velocity_score": <number>,
    "biggest_drop_off_stage": "<8 faz>", "biggest_journey_opportunity": "<max 100 znakov>",
    "quickest_journey_win": "<max 100 znakov>", "journey_optimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validNames = new Set(targetBuyers.map(b => b.name));

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      buyers: (parsed?.buyers || []).filter((b: any) => validNames.has(String(b?.name ?? ''))).slice(0, 25).map((b: any) => ({
        name: String(b?.name ?? '').slice(0, 100),
        currentStage: JOURNEY_STAGES.includes(String(b?.current_stage) as any) ? String(b.current_stage) : 'consideration',
        journeyProgressPct: Math.max(0, Math.min(100, Number(b?.journey_progress_pct ?? 50))),
        stageProbabilities: (b?.stage_probabilities || []).slice(0, 8).map((s: any) => ({
          stage: JOURNEY_STAGES.includes(String(s?.stage) as any) ? String(s.stage) : 'awareness',
          probabilityPct: Math.max(0, Math.min(100, Number(s?.probability_pct ?? 30))),
        })),
        nextOptimalStage: JOURNEY_STAGES.includes(String(b?.next_optimal_stage) as any) ? String(b.next_optimal_stage) : 'intent',
        stageConversionProbabilityPct: Math.max(0, Math.min(100, Number(b?.stage_conversion_probability_pct ?? 50))),
        journeyVelocityScore: Math.max(0, Math.min(100, Number(b?.journey_velocity_score ?? 50))),
        blockers: (b?.blockers || []).slice(0, 4).map((x: any) => String(x).slice(0, 150)),
        accelerators: (b?.accelerators || []).slice(0, 4).map((x: any) => String(x).slice(0, 150)),
        recommendedTouchpoint: String(b?.recommended_touchpoint ?? '').slice(0, 200),
        expectedConversionUpliftPct: Math.round(Number(b?.expected_conversion_uplift_pct ?? 0)),
      })),
      journeys: (parsed?.journeys || []).slice(0, 8).map((j: any) => ({
        stage: JOURNEY_STAGES.includes(String(j?.stage) as any) ? String(j.stage) : 'awareness',
        buyerCount: Math.max(0, Number(j?.buyer_count ?? 0)), avgTimeInStageDays: Math.max(0, Number(j?.avg_time_in_stage_days ?? 0)),
        conversionRateToNextPct: Math.max(0, Math.min(100, Number(j?.conversion_rate_to_next_pct ?? 50))),
        dropOffPct: Math.max(0, Math.min(100, Number(j?.drop_off_pct ?? 30))),
        biggestDropReason: String(j?.biggest_drop_reason ?? '').slice(0, 200),
        improvementAction: String(j?.improvement_action ?? '').slice(0, 300),
      })),
      touchpoints: (parsed?.touchpoints || []).slice(0, 15).map((t: any) => ({
        stage: JOURNEY_STAGES.includes(String(t?.stage) as any) ? String(t.stage) : 'awareness',
        touchpoint: String(t?.touchpoint ?? '').slice(0, 150),
        channel: ['bolha', 'facebook', 'vinted', 'email', 'sms', 'social', 'in_person'].includes(String(t?.channel)) ? String(t.channel) : 'email',
        timing: String(t?.timing ?? '').slice(0, 150), messageTemplate: String(t?.message_template ?? '').slice(0, 400),
        expectedEngagementPct: Math.max(0, Math.min(100, Number(t?.expected_engagement_pct ?? 30))),
        conversionLiftPct: Math.round(Number(t?.conversion_lift_pct ?? 0)),
      })),
      optimizations: (parsed?.optimizations || []).slice(0, 6).map((o: any) => ({
        optimizationType: ['stage_acceleration', 'drop_off_reduction', 'touchpoint_addition', 'timing_optimization', 'channel_optimization'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'stage_acceleration',
        stageTargeted: JOURNEY_STAGES.includes(String(o?.stage_targeted) as any) ? String(o.stage_targeted) : 'consideration',
        description: String(o?.description ?? '').slice(0, 250),
        expectedConversionImprovementPct: Math.round(Number(o?.expected_conversion_improvement_pct ?? 0) * 10) / 10,
        implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
        expectedRevenueImpactEur: Math.round(Number(o?.expected_revenue_impact_eur ?? 0)),
      })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
        model: ['random_forest', 'gradient_boosting', 'lstm', 'markov_chain', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 70))),
        predictionType: ['stage_transition', 'conversion_probability', 'journey_velocity', 'drop_off'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'stage_transition',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      summary: {
        totalBuyersAnalyzed: targetBuyers.length, avgJourneyProgressPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_journey_progress_pct ?? 50))),
        avgJourneyVelocityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_journey_velocity_score ?? 50))),
        biggestDropOffStage: JOURNEY_STAGES.includes(String(parsed?.summary?.biggest_drop_off_stage) as any) ? String(parsed.summary.biggest_drop_off_stage) : 'consideration',
        biggestJourneyOpportunity: String(parsed?.summary?.biggest_journey_opportunity ?? '').slice(0, 200),
        quickestJourneyWin: String(parsed?.summary?.quickest_journey_win ?? '').slice(0, 200),
        journeyOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.journey_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/buyer-journey-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
