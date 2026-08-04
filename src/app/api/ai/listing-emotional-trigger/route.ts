// v6.86: AI Listing Emotional Trigger — ML optimizacija čustvenih sprožilcev v oglasih
// POST /api/ai/listing-emotional-trigger
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, emotionalTriggers, psychologicalDrivers, optimization, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const EMOTION_TYPES = ['scarcity', 'urgency', 'exclusivity', 'social_proof', 'fear_of_missing_out', 'aspiration', 'nostalgia', 'trust', 'belonging', 'achievement'] as const;
const PSYCHOLOGICAL_DRIVERS = ['loss_aversion', 'reciprocity', 'authority', 'commitment', 'liking', 'consensus', 'contrast', 'anchoring', 'framing', 'endowment'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId).trim() : null;

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 200, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za emotional trigger analizo.' });

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing = target.listingId ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, description: true, url: true } }) : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI listing emotional trigger optimizer z ML in behavioral psychology.
Analizira čustvene sprožilce v oglasih z 10 čustvi in 10 psihološkimi dejavniki.

CILJNI OGLAS:
- Naslov: ${target.title}
- Kategorija: ${target.category}
- Nabavna cena: ${target.buyPrice}€
- Predlagana cena: ${suggestedPrice}€
- Kupljeno pri: ${target.buyLocation}
- Opis: ${(target.notes || targetListing?.description || '').slice(0, 300) || 'brez'}

10 čustvenih sprožilcev:
1. SCARCITY: redkost
2. URGENCY: nujnost
3. EXCLUSIVITY: ekskluzivnost
4. SOCIAL_PROOF: socialno dokazilo
5. FEAR_OF_MISSING_OUT: FOMO
6. ASPIRATION: aspiracija
7. NOSTALGIA: nostalgija
8. TRUST: zaupanje
9. BELONGING: pripadnost
10. ACHIEVEMENT: dosežek

10 psiholoških dejavnikov: loss_aversion, reciprocity, authority, commitment, liking, consensus, contrast, anchoring, framing, endowment

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_emotional_score": <number 0-100>, "optimized_emotional_score": <number 0-100>, "current_conversion_pct": <number 0-100>, "optimized_conversion_pct": <number 0-100>, "emotional_grade": "<A|B|C|D|F>" },
  "emotionalTriggers": [
    { "emotion": "<${EMOTION_TYPES.join('|')}>", "current_intensity_pct": <number 0-100>, "optimized_intensity_pct": <number 0-100>, "trigger_phrase": "<max 150 znakov>", "buyer_segment": "<max 80 znakov>", "expected_conversion_lift_pct": <number 0-30>, "implementation_difficulty": "<easy|medium|hard>" }
  ],
  "psychologicalDrivers": [
    { "driver": "<${PSYCHOLOGICAL_DRIVERS.join('|')}>", "current_usage_pct": <number 0-100>, "optimized_usage_pct": <number 0-100>, "technique": "<max 150 znakov>", "effectiveness_score": <number 0-100>, "ethical_concern": "<none|low|medium|high>" }
  ],
  "optimization": [
    { "action": "<max 200 znakov>", "emotion": "<${EMOTION_TYPES.join('|')}>", "driver": "<${PSYCHOLOGICAL_DRIVERS.join('|')}>", "phrase_to_add": "<max 150 znakov>", "expected_conversion_lift_pct": <number 0-30>, "priority": "<high|medium|low>", "placement": "<headline|description|cta|image_caption>" }
  ],
  "mlModels": [
    { "model": "<bert|gpt|roberta|distilbert|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<emotion_detection|conversion_prediction|sentiment_analysis|trigger_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "emotional_optimization_score": <number 0-100>, "emotional_grade": "<A|B|C|D|F>", "current_emotional_score": <number 0-100>,
    "optimized_emotional_score": <number 0-100>, "expected_conversion_lift_pct": <number 0-100>,
    "biggest_emotional_risk": "<max 100 znakov>", "biggest_emotional_opportunity": "<max 100 znakov>",
    "quickest_emotional_win": "<max 100 znakov>", "emotional_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listing: { title: String(parsed?.listing?.title ?? target.title).slice(0, 200), category: String(parsed?.listing?.category ?? target.category).slice(0, 50), currentEmotionalScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_emotional_score ?? 50))), optimizedEmotionalScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_emotional_score ?? 75))), currentConversionPct: Math.max(0, Math.min(100, Number(parsed?.listing?.current_conversion_pct ?? 5))), optimizedConversionPct: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_conversion_pct ?? 8))), emotionalGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.emotional_grade)) ? String(parsed.listing.emotional_grade) : 'C' },
      emotionalTriggers: (parsed?.emotionalTriggers || []).slice(0, 10).map((t: any) => ({ emotion: (EMOTION_TYPES as readonly string[]).includes(String(t?.emotion)) ? String(t.emotion) : 'scarcity', currentIntensityPct: Math.max(0, Math.min(100, Number(t?.current_intensity_pct ?? 40))), optimizedIntensityPct: Math.max(0, Math.min(100, Number(t?.optimized_intensity_pct ?? 70))), triggerPhrase: String(t?.trigger_phrase ?? '').slice(0, 300), buyerSegment: String(t?.buyer_segment ?? '').slice(0, 160), expectedConversionLiftPct: Math.max(0, Math.min(30, Number(t?.expected_conversion_lift_pct ?? 5))), implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(t?.implementation_difficulty)) ? String(t.implementation_difficulty) : 'easy' })),
      psychologicalDrivers: (parsed?.psychologicalDrivers || []).slice(0, 10).map((d: any) => ({ driver: (PSYCHOLOGICAL_DRIVERS as readonly string[]).includes(String(d?.driver)) ? String(d.driver) : 'loss_aversion', currentUsagePct: Math.max(0, Math.min(100, Number(d?.current_usage_pct ?? 30))), optimizedUsagePct: Math.max(0, Math.min(100, Number(d?.optimized_usage_pct ?? 70))), technique: String(d?.technique ?? '').slice(0, 300), effectivenessScore: Math.max(0, Math.min(100, Number(d?.effectiveness_score ?? 60))), ethicalConcern: ['none', 'low', 'medium', 'high'].includes(String(d?.ethical_concern)) ? String(d.ethical_concern) : 'low' })),
      optimization: (parsed?.optimization || []).slice(0, 10).map((o: any) => ({ action: String(o?.action ?? '').slice(0, 400), emotion: (EMOTION_TYPES as readonly string[]).includes(String(o?.emotion)) ? String(o.emotion) : 'scarcity', driver: (PSYCHOLOGICAL_DRIVERS as readonly string[]).includes(String(o?.driver)) ? String(o.driver) : 'loss_aversion', phraseToAdd: String(o?.phrase_to_add ?? '').slice(0, 300), expectedConversionLiftPct: Math.max(0, Math.min(30, Number(o?.expected_conversion_lift_pct ?? 5))), priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium', placement: ['headline', 'description', 'cta', 'image_caption'].includes(String(o?.placement)) ? String(o.placement) : 'description' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['bert', 'gpt', 'roberta', 'distilbert', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['emotion_detection', 'conversion_prediction', 'sentiment_analysis', 'trigger_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'emotion_detection', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { emotionalOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.emotional_optimization_score ?? 50))), emotionalGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.emotional_grade)) ? String(parsed.summary.emotional_grade) : 'C', currentEmotionalScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_emotional_score ?? 50))), optimizedEmotionalScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_emotional_score ?? 75))), expectedConversionLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_lift_pct ?? 20))), biggestEmotionalRisk: String(parsed?.summary?.biggest_emotional_risk ?? '').slice(0, 200), biggestEmotionalOpportunity: String(parsed?.summary?.biggest_emotional_opportunity ?? '').slice(0, 200), quickestEmotionalWin: String(parsed?.summary?.quickest_emotional_win ?? '').slice(0, 200), emotionalAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.emotional_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { logger.error("/api/ai/listing-emotional-trigger", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
