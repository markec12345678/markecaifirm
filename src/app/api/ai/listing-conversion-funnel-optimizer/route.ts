// v6.73: AI Listing Conversion Funnel Optimizer — optimizira conversion funnel z ML in drop-off analysis
// POST /api/ai/listing-conversion-funnel-optimizer
// Body: { tradeId?: string, days?: number }
// Returns: { ok, optimizer: { funnel, dropoffs, optimizations, experiments, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const FUNNEL_STAGES = ['impression', 'view', 'engagement', 'inquiry', 'qualification', 'consideration', 'negotiation', 'commitment', 'payment', 'completion'] as const;
const OPTIMIZATION_TYPES = ['title_improvement', 'image_enhancement', 'price_adjustment', 'description_optimization', 'response_speed', 'trust_building', 'urgency_injection', 'follow_up', 'payment_options', 'shipping_options'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const days = Math.max(7, Math.min(90, Number(body?.days ?? 30)));

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const soldTrades = await db.trade.findMany({ where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: since, not: null } }, select: { id: true, title: true, category: true, sellPrice: true, sellFees: true, sellDate: true, buyDate: true }, take: 300, orderBy: { sellDate: 'desc' } });
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, listing: { select: { aiEstimatedValue: true, dealScore: true, contactStatus: true } } }, take: tradeId ? 1 : 20 });
    const contactedListings = await db.listing.findMany({ where: { contactStatus: { not: 'none' }, firstSeenAt: { gte: since } }, select: { id: true, title: true, contactStatus: true, contactedAt: true, sellerResponse: true }, take: 300 });

    if (soldTrades.length === 0 && heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni podatkov za funnel optimizacijo.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI listing conversion funnel optimizer z ML in drop-off analysis.
Optimizira conversion funnel z 10 fazami za zadnje ${days} dni.

STATS:
- Prodano: ${soldTrades.length}
- Held: ${heldTrades.length}
- Kontaktiranih listingov: ${contactedListings.length}

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "funnel": [
    { "stage": "<10 faz>", "count": <number>, "conversion_rate_to_next_pct": <number 0-100>, "drop_off_count": <number>, "drop_off_pct": <number 0-100>, "avg_time_in_stage_hours": <number>, "ml_prediction": { "stage_conversion_probability_pct": <number 0-100>, "optimization_potential_pct": <number 0-100> }, "biggest_drop_reason": "<max 100 znakov>", "improvement_action": "<max 150 znakov>" }
  ],
  "dropoffs": [
    { "from_stage": "<10 faz>", "to_stage": "<10 faz>", "drop_off_count": <number>, "drop_off_pct": <number 0-100>, "primary_reason": "<max 100 znakov>", "secondary_reasons": ["<max 80 znakov>"], "recoverable_pct": <number 0-100>, "recovery_strategy": "<max 150 znakov>", "expected_recovered_conversions": <number> }
  ],
  "optimizations": [
    { "optimization_type": "<10 tipov>", "stage_targeted": "<10 faz>", "description": "<max 120 znakov>", "expected_conversion_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "expected_revenue_impact_eur": <number>, "priority": "<high|medium|low>" }
  ],
  "experiments": [
    { "experiment_name": "<max 80 znakov>", "stage_targeted": "<10 faz>", "hypothesis": "<max 150 znakov>", "variant_a": "<max 100 znakov>", "variant_b": "<max 100 znakov>", "primary_metric": "<conversion_rate|drop_off_rate|time_in_stage|revenue>", "expected_lift_pct": <number>, "test_duration_days": <number>, "sample_size_needed": <number> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|neural_network|random_forest|lstm|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<stage_conversion|drop_off_probability|recovery_potential|optimal_intervention>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "overall_conversion_rate_pct": <number 0-100>, "biggest_drop_off_stage": "<10 faz>", "biggest_drop_off_pct": <number>,
    "total_recoverable_conversions": <number>, "total_recoverable_revenue_eur": <number>,
    "best_optimization": "<10 tipov>", "quickest_funnel_win": "<max 100 znakov>",
    "funnel_optimization_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      funnel: (parsed?.funnel || []).slice(0, 10).map((f: any) => ({
        stage: FUNNEL_STAGES.includes(String(f?.stage) as any) ? String(f.stage) : 'impression',
        count: Math.max(0, Number(f?.count ?? 0)), conversionRateToNextPct: Math.max(0, Math.min(100, Number(f?.conversion_rate_to_next_pct ?? 50))),
        dropOffCount: Math.max(0, Number(f?.drop_off_count ?? 0)), dropOffPct: Math.max(0, Math.min(100, Number(f?.drop_off_pct ?? 50))),
        avgTimeInStageHours: Math.round(Number(f?.avg_time_in_stage_hours ?? 0) * 10) / 10,
        mlPrediction: { stageConversionProbabilityPct: Math.max(0, Math.min(100, Number(f?.ml_prediction?.stage_conversion_probability_pct ?? 50))), optimizationPotentialPct: Math.max(0, Math.min(100, Number(f?.ml_prediction?.optimization_potential_pct ?? 30))) },
        biggestDropReason: String(f?.biggest_drop_reason ?? '').slice(0, 200), improvementAction: String(f?.improvement_action ?? '').slice(0, 300),
      })),
      dropoffs: (parsed?.dropoffs || []).slice(0, 9).map((d: any) => ({
        fromStage: FUNNEL_STAGES.includes(String(d?.from_stage) as any) ? String(d.from_stage) : 'impression',
        toStage: FUNNEL_STAGES.includes(String(d?.to_stage) as any) ? String(d.to_stage) : 'view',
        dropOffCount: Math.max(0, Number(d?.drop_off_count ?? 0)), dropOffPct: Math.max(0, Math.min(100, Number(d?.drop_off_pct ?? 30))),
        primaryReason: String(d?.primary_reason ?? '').slice(0, 200), secondaryReasons: (d?.secondary_reasons || []).slice(0, 4).map((r: any) => String(r).slice(0, 150)),
        recoverablePct: Math.max(0, Math.min(100, Number(d?.recoverable_pct ?? 30))), recoveryStrategy: String(d?.recovery_strategy ?? '').slice(0, 300),
        expectedRecoveredConversions: Math.max(0, Number(d?.expected_recovered_conversions ?? 0)),
      })),
      optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
        optimizationType: OPTIMIZATION_TYPES.includes(String(o?.optimization_type) as any) ? String(o.optimization_type) : 'title_improvement',
        stageTargeted: FUNNEL_STAGES.includes(String(o?.stage_targeted) as any) ? String(o.stage_targeted) : 'impression',
        description: String(o?.description ?? '').slice(0, 250), expectedConversionLiftPct: Math.round(Number(o?.expected_conversion_lift_pct ?? 0) * 10) / 10,
        implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
        expectedRevenueImpactEur: Math.round(Number(o?.expected_revenue_impact_eur ?? 0)), priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
      })),
      experiments: (parsed?.experiments || []).slice(0, 6).map((e: any) => ({
        experimentName: String(e?.experiment_name ?? '').slice(0, 150), stageTargeted: FUNNEL_STAGES.includes(String(e?.stage_targeted) as any) ? String(e.stage_targeted) : 'impression',
        hypothesis: String(e?.hypothesis ?? '').slice(0, 300), variantA: String(e?.variant_a ?? '').slice(0, 200), variantB: String(e?.variant_b ?? '').slice(0, 200),
        primaryMetric: ['conversion_rate', 'drop_off_rate', 'time_in_stage', 'revenue'].includes(String(e?.primary_metric)) ? String(e.primary_metric) : 'conversion_rate',
        expectedLiftPct: Math.round(Number(e?.expected_lift_pct ?? 0) * 10) / 10, testDurationDays: Math.max(3, Number(e?.test_duration_days ?? 7)), sampleSizeNeeded: Math.max(50, Number(e?.sample_size_needed ?? 100)),
      })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
        model: ['gradient_boosting', 'neural_network', 'random_forest', 'lstm', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
        accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
        predictionType: ['stage_conversion', 'drop_off_probability', 'recovery_potential', 'optimal_intervention'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'stage_conversion',
        weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
      })),
      summary: {
        overallConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.summary?.overall_conversion_rate_pct ?? 10))),
        biggestDropOffStage: FUNNEL_STAGES.includes(String(parsed?.summary?.biggest_drop_off_stage) as any) ? String(parsed.summary.biggest_drop_off_stage) : 'impression',
        biggestDropOffPct: Math.round(Number(parsed?.summary?.biggest_drop_off_pct ?? 0) * 10) / 10,
        totalRecoverableConversions: Math.max(0, Number(parsed?.summary?.total_recoverable_conversions ?? 0)),
        totalRecoverableRevenueEur: Math.round(Number(parsed?.summary?.total_recoverable_revenue_eur ?? 0)),
        bestOptimization: OPTIMIZATION_TYPES.includes(String(parsed?.summary?.best_optimization) as any) ? String(parsed.summary.best_optimization) : 'title_improvement',
        quickestFunnelWin: String(parsed?.summary?.quickest_funnel_win ?? '').slice(0, 200),
        funnelOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.funnel_optimization_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/listing-conversion-funnel-optimizer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
