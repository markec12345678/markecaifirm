// v6.72: AI Listing Emotional Trigger Analyzer — analiza čustvenih sprožilcev z ML NLP
// POST /api/ai/listing-emotional-trigger-analyzer
// Body: { tradeId?: string }
// Returns: { ok, analyzer: { listings, triggers, emotions, optimizations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const TRIGGER_TYPES = ['scarcity', 'urgency', 'social_proof', 'authority', 'reciprocity', 'loss_aversion', 'aspiration', 'nostalgia', 'belonging', 'achievement', 'security', 'novelty'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades = await db.trade.findMany({ where, select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true, price: true } } }, take: tradeId ? 1 : 10 });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, analyzer: null, message: 'Ni held tradeov za emotional trigger analizo.' });

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const items = heldTrades.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', price: t.listing?.price ?? Math.round(t.buyPrice * 1.25), description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300) }));
    const itemsStr = items.slice(0, 10).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.description.slice(0, 100)}`).join('\n');

    const prompt = `Si AI listing emotional trigger analyzer z ML NLP.
Analizira čustvene sprožilce v oglasih in predlaga optimizacije.

OGLASI (${items.length}):
${itemsStr}

12 emotional trigger tipov:
1. SCARCITY: redkost, omejena količina
2. URGENCY: časovna omejenost, danes
3. SOCIAL_PROOF: popularno, bestseller
4. AUTHORITY: ekspertnost, certifikat
5. RECIPROCITY: bonus, dodatek
6. LOSS_AVERSION: kaj izgubiš če ne kupiš
7. ASPIRATION: boljše življenje, status
8. NOSTALGIA: spomin, vintage
9. BELONGING: skupnost, družina
10. ACHIEVEMENT: uspeh, napredek
11. SECURITY: varnost, garancija
12. NOVELTY: novo, trendy

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "current_trigger_score": <number 0-100>, "optimized_trigger_score": <number 0-100>, "detected_triggers": [{"trigger": "<12 tipov>", "intensity": <number 0-100>, "evidence": "<max 100 znakov>"}], "missing_triggers": ["<12 tipov>"], "recommended_triggers": [{"trigger": "<12 tipov>", "implementation": "<max 150 znakov>", "expected_engagement_increase_pct": <number>, "example_phrase": "<max 150 znakov>"}], "optimized_description_snippet": "<max 300 znakov>", "expected_conversion_increase_pct": <number> }
  ],
  "triggers": [
    { "trigger": "<12 tipov>", "description": "<max 100 znakov>", "psychological_basis": "<max 120 znakov>", "avg_intensity": <number 0-100>, "avg_conversion_lift_pct": <number>, "best_for_category": "<max 80 znakov>", "example_phrases": ["<max 80 znakov>"] }
  ],
  "emotions": [
    { "emotion": "<joy|trust|fear|surprise|sadness|disgust|anger|anticipation>", "trigger_association": "<12 tipov>", "avg_intensity": <number 0-100>, "buyer_count": <number>, "conversion_correlation_pct": <number 0-100> }
  ],
  "optimizations": [
    { "optimization_type": "<trigger_addition|trigger_intensification|trigger_removal|trigger_combination>", "trigger_targeted": "<12 tipov>", "description": "<max 120 znakov>", "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "example_before": "<max 100 znakov>", "example_after": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<bert|roberta|distilbert|xlm_roberta|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<trigger_detection|emotion_classification|conversion_prediction|engagement_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "avg_current_trigger_score": <number>, "avg_optimized_trigger_score": <number>,
    "most_effective_trigger": "<12 tipov>", "biggest_trigger_gap": "<max 100 znakov>",
    "quickest_trigger_win": "<max 100 znakov>", "emotional_trigger_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(items.map(i => i.id));

    const analyzer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 10).map((l: any) => ({
        tradeId: String(l?.id ?? ''), title: String(l?.title ?? '').slice(0, 150),
        currentTriggerScore: Math.max(0, Math.min(100, Number(l?.current_trigger_score ?? 40))),
        optimizedTriggerScore: Math.max(0, Math.min(100, Number(l?.optimized_trigger_score ?? 70))),
        detectedTriggers: (l?.detected_triggers || []).slice(0, 6).map((t: any) => ({ trigger: TRIGGER_TYPES.includes(String(t?.trigger) as any) ? String(t.trigger) : 'scarcity', intensity: Math.max(0, Math.min(100, Number(t?.intensity ?? 30))), evidence: String(t?.evidence ?? '').slice(0, 200) })),
        missingTriggers: (l?.missing_triggers || []).slice(0, 8).map((t: any) => TRIGGER_TYPES.includes(String(t) as any) ? String(t) : 'scarcity'),
        recommendedTriggers: (l?.recommended_triggers || []).slice(0, 5).map((t: any) => ({ trigger: TRIGGER_TYPES.includes(String(t?.trigger) as any) ? String(t.trigger) : 'scarcity', implementation: String(t?.implementation ?? '').slice(0, 300), expectedEngagementIncreasePct: Math.round(Number(t?.expected_engagement_increase_pct ?? 0)), examplePhrase: String(t?.example_phrase ?? '').slice(0, 300) })),
        optimizedDescriptionSnippet: String(l?.optimized_description_snippet ?? '').slice(0, 500),
        expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0)),
      })),
      triggers: (parsed?.triggers || []).slice(0, 12).map((t: any) => ({ trigger: TRIGGER_TYPES.includes(String(t?.trigger) as any) ? String(t.trigger) : 'scarcity', description: String(t?.description ?? '').slice(0, 200), psychologicalBasis: String(t?.psychological_basis ?? '').slice(0, 250), avgIntensity: Math.max(0, Math.min(100, Number(t?.avg_intensity ?? 30))), avgConversionLiftPct: Math.round(Number(t?.avg_conversion_lift_pct ?? 0)), bestForCategory: String(t?.best_for_category ?? '').slice(0, 150), examplePhrases: (t?.example_phrases || []).slice(0, 4).map((p: any) => String(p).slice(0, 150)) })),
      emotions: (parsed?.emotions || []).slice(0, 8).map((e: any) => ({ emotion: ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation'].includes(String(e?.emotion)) ? String(e.emotion) : 'joy', triggerAssociation: TRIGGER_TYPES.includes(String(e?.trigger_association) as any) ? String(e.trigger_association) : 'scarcity', avgIntensity: Math.max(0, Math.min(100, Number(e?.avg_intensity ?? 30))), buyerCount: Math.max(0, Number(e?.buyer_count ?? 0)), conversionCorrelationPct: Math.max(0, Math.min(100, Number(e?.conversion_correlation_pct ?? 50))) })),
      optimizations: (parsed?.optimizations || []).slice(0, 8).map((o: any) => ({ optimizationType: ['trigger_addition', 'trigger_intensification', 'trigger_removal', 'trigger_combination'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'trigger_addition', triggerTargeted: TRIGGER_TYPES.includes(String(o?.trigger_targeted) as any) ? String(o.trigger_targeted) : 'scarcity', description: String(o?.description ?? '').slice(0, 250), expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)), implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'low', exampleBefore: String(o?.example_before ?? '').slice(0, 200), exampleAfter: String(o?.example_after ?? '').slice(0, 200) })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['bert', 'roberta', 'distilbert', 'xlm_roberta', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['trigger_detection', 'emotion_classification', 'conversion_prediction', 'engagement_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'trigger_detection', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { totalListingsAnalyzed: items.length, avgCurrentTriggerScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_trigger_score ?? 40))), avgOptimizedTriggerScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_trigger_score ?? 70))), mostEffectiveTrigger: TRIGGER_TYPES.includes(String(parsed?.summary?.most_effective_trigger) as any) ? String(parsed.summary.most_effective_trigger) : 'scarcity', biggestTriggerGap: String(parsed?.summary?.biggest_trigger_gap ?? '').slice(0, 200), quickestTriggerWin: String(parsed?.summary?.quickest_trigger_win ?? '').slice(0, 200), emotionalTriggerScore: Math.max(0, Math.min(100, Number(parsed?.summary?.emotional_trigger_score ?? 60))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, analyzer });
  } catch (e: any) { logger.error("/api/ai/listing-emotional-trigger-analyzer", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
