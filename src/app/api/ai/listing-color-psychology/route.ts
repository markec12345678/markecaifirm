// v6.89: AI Listing Color Psychology — ML optimizacija barvne psihologije v oglasih
// POST /api/ai/listing-color-psychology
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, colorAnalysis, emotionalImpact, recommendations, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const COLOR_PSYCHOLOGIES = ['red_urgency', 'blue_trust', 'green_natural', 'yellow_optimism', 'purple_luxury', 'orange_energy', 'black_premium', 'white_minimal', 'pink_playful', 'brown_earthy'] as const;
const EMOTIONAL_RESPONSES = ['excitement', 'trust', 'calm', 'urgency', 'luxury', 'happiness', 'professionalism', 'warmth', 'sophistication', 'approachability'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId).trim() : null;

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 200, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za color psychology analizo.' });

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing = target.listingId ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true, imageUrl: true } }) : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI listing color psychology optimizer z ML in color theory.
Optimizira barvno psihologijo z 10 barvami in 10 čustvenimi odzivi.

CILJNI OGLAS:
- Naslov: ${target.title}
- Kategorija: ${target.category}
- Nabavna cena: ${target.buyPrice}€
- Predlagana cena: ${suggestedPrice}€
- Image URL: ${targetListing?.imageUrl || 'brez'}

10 barvnih psihologij:
1. RED_URGENCY: rdeča (nujnost, akcija)
2. BLUE_TRUST: modra (zaupanje, stabilnost)
3. GREEN_NATURAL: zelena (narava, rast)
4. YELLOW_OPTIMISM: rumena (optimizem, energija)
5. PURPLE_LUXURY: vijolična (luksuz, prestiž)
6. ORANGE_ENERGY: oranžna (energija, veselje)
7. BLACK_PREMIUM: črna (premium, sofisticiranost)
8. WHITE_MINIMAL: bela (minimalizem, čistoča)
9. PINK_PLAYFUL: roza (igrivost, nežnost)
10. BROWN_EARTHY: rjava (zemeljskost, toplota)

10 čustvenih odzivov: excitement, trust, calm, urgency, luxury, happiness, professionalism, warmth, sophistication, approachability

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_color_score": <number 0-100>, "optimized_color_score": <number 0-100>, "current_emotional_response": "<${EMOTIONAL_RESPONSES.join('|')}>", "optimized_emotional_response": "<${EMOTIONAL_RESPONSES.join('|')}>", "color_psychology_grade": "<A|B|C|D|F>" },
  "colorAnalysis": [
    { "color_psychology": "<${COLOR_PSYCHOLOGIES.join('|')}>", "hex_code": "<#RRGGBB>", "current_usage_pct": <number 0-100>, "recommended_usage_pct": <number 0-100>, "emotional_trigger": "<${EMOTIONAL_RESPONSES.join('|')}>", "cultural_consideration": "<max 100 znakov>", "best_for_element": "<background|accent|cta|text|border>" }
  ],
  "emotionalImpact": [
    { "emotion": "<${EMOTIONAL_RESPONSES.join('|')}>", "current_intensity_pct": <number 0-100>, "optimized_intensity_pct": <number 0-100>, "primary_color_driver": "<${COLOR_PSYCHOLOGIES.join('|')}>", "buyer_segment_appeal": "<max 100 znakov>", "conversion_correlation_pct": <number -50 do 50> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "color_psychology": "<${COLOR_PSYCHOLOGIES.join('|')}>", "target_element": "<background|accent|cta|text|border>", "expected_conversion_lift_pct": <number 0-30>, "implementation_difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<color_analysis|emotion_prediction|conversion_forecast|aesthetic_scoring>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "color_psychology_score": <number 0-100>, "color_psychology_grade": "<A|B|C|D|F>", "current_color_score": <number 0-100>,
    "optimized_color_score": <number 0-100>, "expected_conversion_lift_pct": <number 0-100>,
    "biggest_color_risk": "<max 100 znakov>", "biggest_color_opportunity": "<max 100 znakov>",
    "quickest_color_win": "<max 100 znakov>", "color_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listing: { title: String(parsed?.listing?.title ?? target.title).slice(0, 200), category: String(parsed?.listing?.category ?? target.category).slice(0, 50), currentColorScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_color_score ?? 50))), optimizedColorScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_color_score ?? 75))), currentEmotionalResponse: (EMOTIONAL_RESPONSES as readonly string[]).includes(String(parsed?.listing?.current_emotional_response)) ? String(parsed.listing.current_emotional_response) : 'trust', optimizedEmotionalResponse: (EMOTIONAL_RESPONSES as readonly string[]).includes(String(parsed?.listing?.optimized_emotional_response)) ? String(parsed.listing.optimized_emotional_response) : 'excitement', colorPsychologyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.color_psychology_grade)) ? String(parsed.listing.color_psychology_grade) : 'C' },
      colorAnalysis: (parsed?.colorAnalysis || []).slice(0, 10).map((c: any) => ({ colorPsychology: (COLOR_PSYCHOLOGIES as readonly string[]).includes(String(c?.color_psychology)) ? String(c.color_psychology) : 'blue_trust', hexCode: String(c?.hex_code ?? '').slice(0, 7), currentUsagePct: Math.max(0, Math.min(100, Number(c?.current_usage_pct ?? 30))), recommendedUsagePct: Math.max(0, Math.min(100, Number(c?.recommended_usage_pct ?? 50))), emotionalTrigger: (EMOTIONAL_RESPONSES as readonly string[]).includes(String(c?.emotional_trigger)) ? String(c.emotional_trigger) : 'trust', culturalConsideration: String(c?.cultural_consideration ?? '').slice(0, 200), bestForElement: ['background', 'accent', 'cta', 'text', 'border'].includes(String(c?.best_for_element)) ? String(c.best_for_element) : 'accent' })),
      emotionalImpact: (parsed?.emotionalImpact || []).slice(0, 10).map((e: any) => ({ emotion: (EMOTIONAL_RESPONSES as readonly string[]).includes(String(e?.emotion)) ? String(e.emotion) : 'trust', currentIntensityPct: Math.max(0, Math.min(100, Number(e?.current_intensity_pct ?? 50))), optimizedIntensityPct: Math.max(0, Math.min(100, Number(e?.optimized_intensity_pct ?? 70))), primaryColorDriver: (COLOR_PSYCHOLOGIES as readonly string[]).includes(String(e?.primary_color_driver)) ? String(e.primary_color_driver) : 'blue_trust', buyerSegmentAppeal: String(e?.buyer_segment_appeal ?? '').slice(0, 200), conversionCorrelationPct: Math.max(-50, Math.min(50, Number(e?.conversion_correlation_pct ?? 0))) })),
      recommendations: (parsed?.recommendations || []).slice(0, 10).map((r: any) => ({ action: String(r?.action ?? '').slice(0, 300), colorPsychology: (COLOR_PSYCHOLOGIES as readonly string[]).includes(String(r?.color_psychology)) ? String(r.color_psychology) : 'blue_trust', targetElement: ['background', 'accent', 'cta', 'text', 'border'].includes(String(r?.target_element)) ? String(r.target_element) : 'accent', expectedConversionLiftPct: Math.max(0, Math.min(30, Number(r?.expected_conversion_lift_pct ?? 5))), implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(r?.implementation_difficulty)) ? String(r.implementation_difficulty) : 'medium', priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['cnn', 'resnet', 'vit', 'efficientnet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['color_analysis', 'emotion_prediction', 'conversion_forecast', 'aesthetic_scoring'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'color_analysis', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { colorPsychologyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.color_psychology_score ?? 50))), colorPsychologyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.color_psychology_grade)) ? String(parsed.summary.color_psychology_grade) : 'C', currentColorScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_color_score ?? 50))), optimizedColorScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_color_score ?? 75))), expectedConversionLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_lift_pct ?? 15))), biggestColorRisk: String(parsed?.summary?.biggest_color_risk ?? '').slice(0, 200), biggestColorOpportunity: String(parsed?.summary?.biggest_color_opportunity ?? '').slice(0, 200), quickestColorWin: String(parsed?.summary?.quickest_color_win ?? '').slice(0, 200), colorAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.color_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
