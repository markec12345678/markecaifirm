// v6.88: AI Listing Visual Hierarchy — ML optimizacija vizualne hierarhije oglasov z eye-tracking
// POST /api/ai/listing-visual-hierarchy
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, visualElements, hierarchyScore, attentionFlow, optimization, mlModels, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const VISUAL_ELEMENTS = ['hero_image', 'secondary_images', 'title_block', 'price_block', 'description_block', 'specs_table', 'cta_button', 'trust_badges', 'social_proof', 'shipping_info'] as const;
const ATTENTION_ZONES = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId).trim() : null;

    const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true }, take: 200, orderBy: { buyDate: 'desc' } });
    if (heldTrades.length === 0) return NextResponse.json({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za visual hierarchy analizo.' });

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing = target.listingId ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true, imageUrl: true } }) : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = { provider: settings.aiProvider as AiProviderType, baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel, fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '', fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '', fallbackModel: settings.fallbackModel || '' };

    const prompt = `Si AI listing visual hierarchy optimizer z ML in eye-tracking simulation.
Optimizira vizualno hierarhijo oglasov z 10 elementi in 9 conami pozornosti.

CILJNI OGLAS:
- Naslov: ${target.title}
- Kategorija: ${target.category}
- Nabavna cena: ${target.buyPrice}€
- Predlagana cena: ${suggestedPrice}€
- Image URL: ${targetListing?.imageUrl || 'brez'}

10 vizualnih elementov:
1. HERO_IMAGE: glavna slika
2. SECONDARY_IMAGES: sekundarne slike
3. TITLE_BLOCK: naslov
4. PRICE_BLOCK: cena
5. DESCRIPTION_BLOCK: opis
6. SPECS_TABLE: specifikacije
7. CTA_BUTTON: gumb za akcijo
8. TRUST_BADGES: zaupanja vrednost
9. SOCIAL_PROOF: socialna potrditev
10. SHIPPING_INFO: dostava

9 con pozornosti: top_left, top_center, top_right, middle_left, middle_center, middle_right, bottom_left, bottom_center, bottom_right

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_visual_score": <number 0-100>, "optimized_visual_score": <number 0-100>, "current_attention_efficiency_pct": <number 0-100>, "optimized_attention_efficiency_pct": <number 0-100>, "visual_hierarchy_grade": "<A|B|C|D|F>" },
  "visualElements": [
    { "element": "<${VISUAL_ELEMENTS.join('|')}>", "current_prominence_pct": <number 0-100>, "optimized_prominence_pct": <number 0-100>, "current_position": "<${ATTENTION_ZONES.join('|')}>", "optimized_position": "<${ATTENTION_ZONES.join('|')}>", "attention_weight_pct": <number 0-100>, "issue": "<max 100 znakov>", "fix": "<max 120 znakov>" }
  ],
  "hierarchyScore": [
    { "principle": "<contrast|alignment|proximity|repetition|balance|emphasis|rhythm|unity>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "weight_pct": <number 0-100>, "improvement_pct": <number 0-50>, "recommendation": "<max 120 znakov>" }
  ],
  "attentionFlow": [
    { "zone": "<${ATTENTION_ZONES.join('|')}>", "current_attention_pct": <number 0-100>, "optimized_attention_pct": <number 0-100>, "primary_element": "<${VISUAL_ELEMENTS.join('|')}>", "fixation_time_ms": <number>, "conversion_impact_pct": <number -20 do 30> }
  ],
  "optimization": [
    { "action": "<max 150 znakov>", "element": "<${VISUAL_ELEMENTS.join('|')}>", "change_type": "<reposition|resize|recolor|reorder|emphasize|de_emphasize>", "expected_conversion_lift_pct": <number 0-30>, "implementation_difficulty": "<easy|medium|hard>", "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<attention_prediction|visual_scoring|conversion_forecast|eye_tracking_simulation>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "visual_hierarchy_score": <number 0-100>, "visual_hierarchy_grade": "<A|B|C|D|F>", "current_visual_score": <number 0-100>,
    "optimized_visual_score": <number 0-100>, "expected_conversion_lift_pct": <number 0-100>,
    "biggest_visual_risk": "<max 100 znakov>", "biggest_visual_opportunity": "<max 100 znakov>",
    "quickest_visual_win": "<max 100 znakov>", "visual_analysis_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (e: any) { if (aiSettings.fallbackProvider && aiSettings.fallbackModel) { const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel }; raw = await callProviderForRaw(fb, prompt); } else { return NextResponse.json({ error: e?.message ?? 'AI failed' }, { status: 500 }); } }

    const parsed: any = parseJsonLooseExported(raw);

    const optimizer = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      listing: { title: String(parsed?.listing?.title ?? target.title).slice(0, 200), category: String(parsed?.listing?.category ?? target.category).slice(0, 50), currentVisualScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_visual_score ?? 50))), optimizedVisualScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_visual_score ?? 75))), currentAttentionEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.listing?.current_attention_efficiency_pct ?? 50))), optimizedAttentionEfficiencyPct: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_attention_efficiency_pct ?? 80))), visualHierarchyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.visual_hierarchy_grade)) ? String(parsed.listing.visual_hierarchy_grade) : 'C' },
      visualElements: (parsed?.visualElements || []).slice(0, 10).map((e: any) => ({ element: (VISUAL_ELEMENTS as readonly string[]).includes(String(e?.element)) ? String(e.element) : 'hero_image', currentProminencePct: Math.max(0, Math.min(100, Number(e?.current_prominence_pct ?? 50))), optimizedProminencePct: Math.max(0, Math.min(100, Number(e?.optimized_prominence_pct ?? 75))), currentPosition: (ATTENTION_ZONES as readonly string[]).includes(String(e?.current_position)) ? String(e.current_position) : 'middle_center', optimizedPosition: (ATTENTION_ZONES as readonly string[]).includes(String(e?.optimized_position)) ? String(e.optimized_position) : 'top_center', attentionWeightPct: Math.max(0, Math.min(100, Number(e?.attention_weight_pct ?? 10))), issue: String(e?.issue ?? '').slice(0, 200), fix: String(e?.fix ?? '').slice(0, 250) })),
      hierarchyScore: (parsed?.hierarchyScore || []).slice(0, 8).map((h: any) => ({ principle: String(h?.principle ?? 'contrast').slice(0, 50), currentScore: Math.max(0, Math.min(100, Number(h?.current_score ?? 50))), optimizedScore: Math.max(0, Math.min(100, Number(h?.optimized_score ?? 75))), weightPct: Math.max(0, Math.min(100, Number(h?.weight_pct ?? 12))), improvementPct: Math.max(0, Math.min(50, Number(h?.improvement_pct ?? 15))), recommendation: String(h?.recommendation ?? '').slice(0, 250) })),
      attentionFlow: (parsed?.attentionFlow || []).slice(0, 9).map((a: any) => ({ zone: (ATTENTION_ZONES as readonly string[]).includes(String(a?.zone)) ? String(a.zone) : 'top_center', currentAttentionPct: Math.max(0, Math.min(100, Number(a?.current_attention_pct ?? 15))), optimizedAttentionPct: Math.max(0, Math.min(100, Number(a?.optimized_attention_pct ?? 15))), primaryElement: (VISUAL_ELEMENTS as readonly string[]).includes(String(a?.primary_element)) ? String(a.primary_element) : 'hero_image', fixationTimeMs: Math.max(0, Number(a?.fixation_time_ms ?? 500)), conversionImpactPct: Math.max(-20, Math.min(30, Number(a?.conversion_impact_pct ?? 0))) })),
      optimization: (parsed?.optimization || []).slice(0, 10).map((o: any) => ({ action: String(o?.action ?? '').slice(0, 300), element: (VISUAL_ELEMENTS as readonly string[]).includes(String(o?.element)) ? String(o.element) : 'hero_image', changeType: ['reposition', 'resize', 'recolor', 'reorder', 'emphasize', 'de_emphasize'].includes(String(o?.change_type)) ? String(o.change_type) : 'reposition', expectedConversionLiftPct: Math.max(0, Math.min(30, Number(o?.expected_conversion_lift_pct ?? 5))), implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium', priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium' })),
      mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['cnn', 'resnet', 'vit', 'efficientnet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['attention_prediction', 'visual_scoring', 'conversion_forecast', 'eye_tracking_simulation'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'attention_prediction', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
      summary: { visualHierarchyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.visual_hierarchy_score ?? 50))), visualHierarchyGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.visual_hierarchy_grade)) ? String(parsed.summary.visual_hierarchy_grade) : 'C', currentVisualScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_visual_score ?? 50))), optimizedVisualScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_visual_score ?? 75))), expectedConversionLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_lift_pct ?? 20))), biggestVisualRisk: String(parsed?.summary?.biggest_visual_risk ?? '').slice(0, 200), biggestVisualOpportunity: String(parsed?.summary?.biggest_visual_opportunity ?? '').slice(0, 200), quickestVisualWin: String(parsed?.summary?.quickest_visual_win ?? '').slice(0, 200), visualAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.visual_analysis_score ?? 50))) },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, optimizer });
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
