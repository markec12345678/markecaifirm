// v6.58: AI Listing Image Generator — AI-generated listing image concepts z VLM prompts
// POST /api/ai/listing-image-generator
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, generator: { items, imagePrompts, shotPlans, editingPresets, abTestPlan, summary } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { callProviderForRaw, parseJsonLooseExported, type AiProviderType, type AiSettings } from '@/lib/ai';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SHOT_TYPES = [
  'hero_shot',         // glavna slika — item v sredini, dobra osvetlitev
  'detail_closeup',    // close-up na blagovno znamko, specifikacije
  'context_lifestyle', // item v uporabi (kontekst)
  'angle_side',        // stranski kot
  'angle_top',         // pogled od zgoraj
  'damage_honest',     // honestly pokazi poškodbe (trust building)
  'size_reference',    // z referenco za velikost (roka, kovanec)
  'accessory_bundle',  // z dodatki (etui, polnilec)
  'before_after',      // pred/po obnovi
  'seasonal_themed',   // sezonski kontekst (božič, poletje)
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;

    let targetListings: Array<{
      id: string; title: string; category: string; price: number;
      description: string; imageUrl: string; estValue: number;
    }> = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true } } },
      });
      if (!t) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      targetListings = [{
        id: t.id, title: t.title, category: t.category || 'drugo',
        price: t.listing?.price ?? t.buyPrice,
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300),
        imageUrl: t.listing?.imageUrl ?? '',
        estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      }];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: String(listingId) },
        select: { id: true, title: true, price: true, description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true },
      });
      if (!l) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
      targetListings = [{
        id: l.id, title: l.title, category: '',
        price: l.price ?? 0, description: (l.detailDescription || l.description || '').slice(0, 300),
        imageUrl: l.imageUrl ?? '', estValue: l.aiEstimatedValue ?? l.price ?? 0,
      }];
    } else {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true } } },
        take: 10,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = heldTrades.map(t => ({
        id: t.id, title: t.title, category: t.category || 'drugo',
        price: t.listing?.price ?? t.buyPrice,
        description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 300),
        imageUrl: t.listing?.imageUrl ?? '',
        estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      }));
    }

    if (targetListings.length === 0) {
      return NextResponse.json({ ok: true, generator: null, message: 'Ni listingov za image generation.' });
    }

    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl, apiKey: settings.aiApiKey, model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as AiProviderType | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '', fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    const itemsStr = targetListings.slice(0, 10).map(i =>
      `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | slika: ${i.imageUrl ? 'da' : 'ne'} | opis: ${i.description.slice(0, 100)}`
    ).join('\n');

    const prompt = `Si AI listing image generator za slovenske oglasne platforme.
Generiraj AI prompts za optimalne slike oglasa (za Midjourney/DALL-E/Flux).

OGLASI (${targetListings.length}):
${itemsStr}

10 shot tipov za oglasne slike:
1. HERO_SHOT: glavna slika — item v sredini, enobarvno ozadje, dobra osvetlitev
2. DETAIL_CLOSEUP: close-up na blagovno znamko, certifikat, specifikacije
3. CONTEXT_LIFESTYLE: item v uporabi (telefon v roki, kolo na cesti)
4. ANGLE_SIDE: stranski kot za 3D občutek
5. ANGLE_TOP: pogled od zgoraj (pogosto za hrano, modele)
6. DAMAGE_HONEST: honestly pokazi poškodbe (trust building, expectation management)
7. SIZE_REFERENCE: z referenco za velikost (roka, kovanec, A4 papir)
8. ACCESSORY_BUNDLE: z dodatki (etui, polnilec, original embalaža)
9. BEFORE_AFTER: pred/po obnovi (renovation story)
10. SEASONAL_THEMED: sezonski kontekst (božič, poletje, šola)

AI prompt tehnike:
- DETAILED_DESCRIPTION: natančen opis itema, barve, materiala
- LIGHTING: natural light, soft box, golden hour
- COMPOSITION: rule of thirds, centered, minimal background
- MOOD: clean, professional, warm, premium
- TECHNICAL: 4K, sharp focus, depth of field
- NEGATIVE_PROMPT: brez vodnih žigov, brez stock photo feel

Editing presets:
- BRIGHTNESS_BOOST: +20% za bolj žive barve
- CONTRAST_ENHANCE: +15% za bolj definitivne robove
- COLOR_CORRECTION: white balance, saturation
- BACKGROUND_CLEANUP: odstrani moteče elemente
- SHARPNESS_ENHANCE: +10% za clarity
- CROP_OPTIMIZE: 4:3 za Bolha, 1:1 za Facebook, 1.91:1 za Facebook link

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "items": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_image_score": <number 0-100>,
      "recommended_shot_count": <number>,
      "primary_shot": "<10 shot tipov>",
      "image_prompts": [
        {
          "shot_type": "<10 shot tipov>",
          "prompt": "<AI prompt 200c za Midjourney/DALL-E>",
          "negative_prompt": "<max 100c>",
          "expected_quality_score": <number 0-100>,
          "priority": "<high|medium|low>",
          "technical_specs": "<max 80 znakov>"
        }
      ],
      "editing_presets": ["<brightness_boost|contrast_enhance|color_correction|background_cleanup|sharpness_enhance|crop_optimize>"],
      "expected_views_increase_pct": <number>,
      "expected_inquiries_increase_pct": <number>
    }
  ],
  "image_prompts": [
    {
      "category": "<kategorija>",
      "best_shot_types": ["<10 shot tipov>"],
      "example_prompts": [{"shot_type": "<tip>", "prompt": "<max 250c>", "ai_tool": "<midjourney|dalle|flux|stable_diffusion>"}],
      "expected_performance_pct": <number>
    }
  ],
  "shot_plans": [
    {
      "shot_type": "<10 shot tipov>",
      "description": "<max 100 znakov>",
      "best_for_category": "<max 80 znakov>",
      "camera_angle": "<max 80 znakov>",
      "lighting_setup": "<max 100 znakov>",
      "background_recommendation": "<max 100 znakov>",
      "priority": "<high|medium|low>"
    }
  ],
  "editing_presets_list": [
    {
      "preset": "<6 preset-ov>",
      "description": "<max 100 znakov>",
      "intensity_pct": <number 0-100>,
      "best_for_shot_type": "<max 80 znakov>",
      "tool_recommendation": "<snapseed|lightroom|photoshop|canva|phone_default>",
      "step_by_step": "<max 200 znakov>"
    }
  ],
  "ab_test_plan": [
    {
      "listing_id": "<trade_id>",
      "variant_a_shot": "<shot tip>",
      "variant_b_shot": "<shot tip>",
      "test_duration_days": <number>,
      "primary_metric": "<views|inquiries|conversion_rate>",
      "expected_winner": "<a|b>",
      "success_threshold_pct": <number>
    }
  ],
  "summary": {
    "total_listings_analyzed": <number>,
    "avg_current_image_score": <number>,
    "avg_target_image_score": <number>,
    "total_prompts_generated": <number>,
    "avg_expected_views_increase_pct": <number>,
    "avg_expected_inquiries_increase_pct": <number>,
    "best_shot_type_overall": "<max 80 znakov>",
    "biggest_image_issue": "<max 100 znakov>",
    "quickest_image_win": "<max 100 znakov>",
    "image_generation_score": <number 0-100>
  }
}`;

    let raw = '';
    try { raw = await callProviderForRaw(aiSettings, prompt); }
    catch (primaryError: any) {
      if (aiSettings.fallbackProvider && aiSettings.fallbackModel) {
        const fb: AiSettings = { provider: aiSettings.fallbackProvider, baseUrl: aiSettings.fallbackBaseUrl || '', apiKey: aiSettings.fallbackApiKey || '', model: aiSettings.fallbackModel };
        raw = await callProviderForRaw(fb, prompt);
      } else { return NextResponse.json({ error: primaryError?.message ?? 'AI failed' }, { status: 500 }); }
    }

    const parsed: any = parseJsonLooseExported(raw);
    const validIds = new Set(targetListings.map(i => i.id));

    const generator = {
      insights: String(parsed?.insights ?? '').slice(0, 500),
      items: (parsed?.items || [])
        .filter((it: any) => validIds.has(String(it?.id ?? '')))
        .slice(0, 10)
        .map((it: any) => {
          const orig = targetListings.find(x => x.id === String(it?.id));
          return {
            tradeId: String(it?.id ?? ''),
            title: String(it?.title ?? orig?.title ?? '').slice(0, 150),
            currentImageScore: Math.max(0, Math.min(100, Number(it?.current_image_score ?? 50))),
            recommendedShotCount: Math.max(1, Math.min(10, Number(it?.recommended_shot_count ?? 5))),
            primaryShot: SHOT_TYPES.includes(String(it?.primary_shot) as any) ? String(it.primary_shot) : 'hero_shot',
            imagePrompts: (it?.image_prompts || []).slice(0, 8).map((p: any) => ({
              shotType: SHOT_TYPES.includes(String(p?.shot_type) as any) ? String(p.shot_type) : 'hero_shot',
              prompt: String(p?.prompt ?? '').slice(0, 400),
              negativePrompt: String(p?.negative_prompt ?? '').slice(0, 200),
              expectedQualityScore: Math.max(0, Math.min(100, Number(p?.expected_quality_score ?? 60))),
              priority: ['high', 'medium', 'low'].includes(String(p?.priority)) ? String(p.priority) : 'medium',
              technicalSpecs: String(p?.technical_specs ?? '').slice(0, 150),
            })),
            editingPresets: (it?.editing_presets || []).slice(0, 6).map((p: any) => {
              const presets = ['brightness_boost', 'contrast_enhance', 'color_correction', 'background_cleanup', 'sharpness_enhance', 'crop_optimize'];
              return presets.includes(String(p)) ? String(p) : 'brightness_boost';
            }),
            expectedViewsIncreasePct: Math.round(Number(it?.expected_views_increase_pct ?? 30)),
            expectedInquiriesIncreasePct: Math.round(Number(it?.expected_inquiries_increase_pct ?? 25)),
          };
        }),
      imagePrompts: (parsed?.image_prompts || []).slice(0, 8).map((c: any) => ({
        category: String(c?.category ?? '').slice(0, 50),
        bestShotTypes: (c?.best_shot_types || []).slice(0, 5).map((s: any) => SHOT_TYPES.includes(String(s) as any) ? String(s) : 'hero_shot'),
        examplePrompts: (c?.example_prompts || []).slice(0, 4).map((p: any) => ({
          shotType: SHOT_TYPES.includes(String(p?.shot_type) as any) ? String(p.shot_type) : 'hero_shot',
          prompt: String(p?.prompt ?? '').slice(0, 500),
          aiTool: ['midjourney', 'dalle', 'flux', 'stable_diffusion'].includes(String(p?.ai_tool)) ? String(p.ai_tool) : 'midjourney',
        })),
        expectedPerformancePct: Math.max(0, Math.min(100, Number(c?.expected_performance_pct ?? 60))),
      })),
      shotPlans: (parsed?.shot_plans || []).slice(0, 10).map((s: any) => ({
        shotType: SHOT_TYPES.includes(String(s?.shot_type) as any) ? String(s.shot_type) : 'hero_shot',
        description: String(s?.description ?? '').slice(0, 200),
        bestForCategory: String(s?.best_for_category ?? '').slice(0, 150),
        cameraAngle: String(s?.camera_angle ?? '').slice(0, 150),
        lightingSetup: String(s?.lighting_setup ?? '').slice(0, 200),
        backgroundRecommendation: String(s?.background_recommendation ?? '').slice(0, 200),
        priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
      })),
      editingPresetsList: (parsed?.editing_presets_list || []).slice(0, 6).map((p: any) => ({
        preset: ['brightness_boost', 'contrast_enhance', 'color_correction', 'background_cleanup', 'sharpness_enhance', 'crop_optimize'].includes(String(p?.preset)) ? String(p.preset) : 'brightness_boost',
        description: String(p?.description ?? '').slice(0, 200),
        intensityPct: Math.max(0, Math.min(100, Number(p?.intensity_pct ?? 50))),
        bestForShotType: String(p?.best_for_shot_type ?? '').slice(0, 150),
        toolRecommendation: ['snapseed', 'lightroom', 'photoshop', 'canva', 'phone_default'].includes(String(p?.tool_recommendation)) ? String(p.tool_recommendation) : 'phone_default',
        stepByStep: String(p?.step_by_step ?? '').slice(0, 400),
      })),
      abTestPlan: (parsed?.ab_test_plan || [])
        .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
        .slice(0, 10)
        .map((t: any) => ({
          tradeId: String(t?.listing_id ?? '').slice(0, 50),
          variantAShot: SHOT_TYPES.includes(String(t?.variant_a_shot) as any) ? String(t.variant_a_shot) : 'hero_shot',
          variantBShot: SHOT_TYPES.includes(String(t?.variant_b_shot) as any) ? String(t.variant_b_shot) : 'detail_closeup',
          testDurationDays: Math.max(1, Math.min(30, Number(t?.test_duration_days ?? 7))),
          primaryMetric: ['views', 'inquiries', 'conversion_rate'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'conversion_rate',
          expectedWinner: ['a', 'b'].includes(String(t?.expected_winner)) ? String(t.expected_winner) : 'b',
          successThresholdPct: Math.round(Number(t?.success_threshold_pct ?? 5)),
        })),
      summary: {
        totalListingsAnalyzed: targetListings.length,
        avgCurrentImageScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_image_score ?? 50))),
        avgTargetImageScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_target_image_score ?? 80))),
        totalPromptsGenerated: Math.max(0, Number(parsed?.summary?.total_prompts_generated ?? targetListings.length * 5)),
        avgExpectedViewsIncreasePct: Math.round(Number(parsed?.summary?.avg_expected_views_increase_pct ?? 30)),
        avgExpectedInquiriesIncreasePct: Math.round(Number(parsed?.summary?.avg_expected_inquiries_increase_pct ?? 25)),
        bestShotTypeOverall: SHOT_TYPES.includes(String(parsed?.summary?.best_shot_type_overall) as any) ? String(parsed.summary.best_shot_type_overall) : 'hero_shot',
        biggestImageIssue: String(parsed?.summary?.biggest_image_issue ?? '').slice(0, 200),
        quickestImageWin: String(parsed?.summary?.quickest_image_win ?? '').slice(0, 200),
        imageGenerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.image_generation_score ?? 60))),
      },
    };

    const today = new Date().toISOString().slice(0, 10);
    if (settings.aiCallsDate !== today) { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsDate: today, aiCallsToday: 1 } }); }
    else { await db.settings.update({ where: { id: 'singleton' }, data: { aiCallsToday: { increment: 1 } } }); }

    return NextResponse.json({ ok: true, generator });
  } catch (e: any) { logger.error("/api/ai/listing-image-generator", "POST handler failed", e); return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 }); }
}
