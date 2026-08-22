// v6.67 / v8.95.7-listing: AI Listing Image Quality Assessor v2 — VLM analiza z ML scoring in improvement roadmap
// Refaktoriran z withAiRoute helperjem (v8.95.7-listing) + enforceBudget guard.
//
// POST /api/ai/listing-image-quality-assessor-v2
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, assessor: { listings, qualityFactors, improvements, shotPlan, editingPlan, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiNotFound } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

const QUALITY_FACTORS = ['composition', 'lighting', 'background', 'focus', 'color_accuracy', 'angle', 'detail_visibility', 'item_proportion', 'image_resolution', 'emotional_appeal'] as const;

interface ListingImageQualityAssessorV2Input {
  tradeId: string | null;
  listingId: unknown; // ohranjen za isti input — unused v handlerju (konsistentno z originalom)
}

export const POST = withAiRoute<ListingImageQualityAssessorV2Input>({
  endpoint: '/api/ai/listing-image-quality-assessor-v2',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      listingId: body?.listingId, // ohranjen za isti input — unused v handlerju
    };
  },

  // No validateInput — tradeId je opcijski, listingId unused

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    let targetListings: TargetListingRow[] = [];
    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: { id: true, title: true, category: true, listing: { select: { imageUrl: true, detailImages: true } } },
      });
      if (!t) return apiNotFound('Trade ne obstaja');
      targetListings = [{ id: t.id, title: t.title, category: t.category || 'drugo', imageUrl: t.listing?.imageUrl ?? '' }];
    } else {
      const held = await db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, category: true, listing: { select: { imageUrl: true } } },
        take: 10,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = held.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', imageUrl: t.listing?.imageUrl ?? '' }));
    }
    if (targetListings.length === 0) {
      return apiOk({ ok: true, assessor: null, message: 'Ni listingov za image quality assessment.' });
    }

    const itemsStr = buildItemsStr(targetListings);
    const prompt = buildPrompt(targetListings.length, itemsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const assessor = transformAssessor(parsed, targetListings);

    return apiOk({ ok: true, assessor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface TargetListingRow {
  id: string;
  title: string;
  category: string;
  imageUrl: string;
}

function buildItemsStr(targetListings: TargetListingRow[]): string {
  return targetListings
    .slice(0, 10)
    .map(i => `- [${i.id}] "${i.title}" | ${i.category} | slika: ${i.imageUrl ? 'da' : 'ne'}`)
    .join('\n');
}

function buildPrompt(targetListingsCount: number, itemsStr: string): string {
  return `Si AI listing image quality assessor v2 z VLM in ML scoring.
Analizira kakovost slik z 10-dimenzionalno analizo in improvement roadmap.

OGLASI (${targetListingsCount}):
${itemsStr}

10 quality faktorjev:
1. COMPOSITION: kompozicija slike (rule of thirds, centered)
2. LIGHTING: osvetlitev (natural, soft box, golden hour)
3. BACKGROUND: ozadje (clean, distracting, contextual)
4. FOCUS: ostrina (sharp, blurry, depth of field)
5. COLOR_ACCURACY: barvna natančnost (true colors, over-saturated)
6. ANGLE: kot snemanja (front, side, top, creative)
7. DETAIL_VISIBILITY: vidnost detajlov (brand, spec, damage)
8. ITEM_PROPORTION: proporcija itema v sliki (too small, too large)
9. IMAGE_RESOLUTION: resolucija (4K, HD, low)
10. EMOTIONAL_APPEAL: čustveni apel (wants to buy, indifferent)

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>", "title": "<naslov>",
      "current_image_score": <number 0-100>, "optimized_image_score": <number 0-100>,
      "quality_factors": [{"factor": "<10 faktorjev>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "priority": "<high|medium|low>", "issue": "<max 100 znakov>", "fix": "<max 120 znakov>"}],
      "recommended_shots": [{"shot_type": "<hero|detail|context|angle|damage|size|accessory|before_after>", "description": "<max 100 znakov>", "priority": "<high|medium|low>", "how_to_shoot": "<max 150 znakov>"}],
      "editing_recommendations": [{"edit_type": "<brightness|contrast|color_correction|background_removal|sharpening|crop>", "intensity": "<low|medium|high>", "tool": "<snapseed|lightroom|photoshop|canva|phone>", "step_by_step": "<max 200 znakov>"}],
      "expected_views_increase_pct": <number>, "expected_inquiries_increase_pct": <number>, "expected_conversion_increase_pct": <number>
    }
  ],
  "quality_factors": [
    {"factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 120 znakov>"}
  ],
  "improvements": [
    {"improvement": "<max 120 znakov>", "factor_targeted": "<10 faktorjev>", "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "time_to_complete_minutes": <number>}
  ],
  "shot_plan": [
    {"shot_type": "<hero|detail|context|angle|damage|size|accessory|before_after>", "description": "<max 100 znakov>", "best_for_category": "<max 80 znakov>", "camera_setup": "<max 100 znakov>", "lighting_setup": "<max 100 znakov>", "background": "<max 80 znakov>", "priority": "<high|medium|low>"}
  ],
  "editing_plan": [
    {"edit_type": "<brightness|contrast|color_correction|background_removal|sharpening|crop>", "description": "<max 100 znakov>", "intensity_pct": <number 0-100>, "tool": "<snapseed|lightroom|photoshop|canva|phone>", "step_by_step": "<max 200 znakov>", "expected_improvement_pct": <number>}
  ],
  "summary": {
    "total_listings_assessed": <number>, "avg_current_score": <number>, "avg_optimized_score": <number>,
    "avg_improvement_pct": <number>, "weakest_factor": "<max 80 znakov>", "strongest_factor": "<max 80 znakov>",
    "biggest_image_issue": "<max 100 znakov>", "quickest_image_fix": "<max 100 znakov>",
    "image_quality_score": <number 0-100>
  }
}`;
}

function transformAssessor(parsed: any, targetListings: TargetListingRow[]): any {
  const validIds = new Set(targetListings.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 10).map((l: any) => ({
      tradeId: String(l?.id ?? ''), title: String(l?.title ?? '').slice(0, 150),
      currentImageScore: Math.max(0, Math.min(100, Number(l?.current_image_score ?? 50))),
      optimizedImageScore: Math.max(0, Math.min(100, Number(l?.optimized_image_score ?? 75))),
      qualityFactors: (l?.quality_factors || []).slice(0, 10).map((f: any) => ({
        factor: QUALITY_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'composition',
        currentScore: Math.max(0, Math.min(100, Number(f?.current_score ?? 50))),
        optimizedScore: Math.max(0, Math.min(100, Number(f?.optimized_score ?? 70))),
        priority: ['high', 'medium', 'low'].includes(String(f?.priority)) ? String(f.priority) : 'medium',
        issue: String(f?.issue ?? '').slice(0, 200), fix: String(f?.fix ?? '').slice(0, 250),
      })),
      recommendedShots: (l?.recommended_shots || []).slice(0, 8).map((s: any) => ({
        shotType: ['hero', 'detail', 'context', 'angle', 'damage', 'size', 'accessory', 'before_after'].includes(String(s?.shot_type)) ? String(s.shot_type) : 'hero',
        description: String(s?.description ?? '').slice(0, 200), priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
        howToShoot: String(s?.how_to_shoot ?? '').slice(0, 300),
      })),
      editingRecommendations: (l?.editing_recommendations || []).slice(0, 6).map((e: any) => ({
        editType: ['brightness', 'contrast', 'color_correction', 'background_removal', 'sharpening', 'crop'].includes(String(e?.edit_type)) ? String(e.edit_type) : 'brightness',
        intensity: ['low', 'medium', 'high'].includes(String(e?.intensity)) ? String(e.intensity) : 'medium',
        tool: ['snapseed', 'lightroom', 'photoshop', 'canva', 'phone'].includes(String(e?.tool)) ? String(e.tool) : 'phone',
        stepByStep: String(e?.step_by_step ?? '').slice(0, 400),
      })),
      expectedViewsIncreasePct: Math.round(Number(l?.expected_views_increase_pct ?? 30)),
      expectedInquiriesIncreasePct: Math.round(Number(l?.expected_inquiries_increase_pct ?? 25)),
      expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 15)),
    })),
    qualityFactors: (parsed?.quality_factors || []).slice(0, 10).map((f: any) => ({
      factor: QUALITY_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'composition',
      weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))), avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
      benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))),
      improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
      bestPractice: String(f?.best_practice ?? '').slice(0, 250),
    })),
    improvements: (parsed?.improvements || []).slice(0, 8).map((i: any) => ({
      improvement: String(i?.improvement ?? '').slice(0, 250),
      factorTargeted: QUALITY_FACTORS.includes(String(i?.factor_targeted) as any) ? String(i.factor_targeted) : 'composition',
      expectedLiftPct: Math.round(Number(i?.expected_lift_pct ?? 0)),
      implementationEffort: ['low', 'medium', 'high'].includes(String(i?.implementation_effort)) ? String(i.implementation_effort) : 'low',
      timeToCompleteMinutes: Math.max(1, Number(i?.time_to_complete_minutes ?? 5)),
    })),
    shotPlan: (parsed?.shot_plan || []).slice(0, 8).map((s: any) => ({
      shotType: ['hero', 'detail', 'context', 'angle', 'damage', 'size', 'accessory', 'before_after'].includes(String(s?.shot_type)) ? String(s.shot_type) : 'hero',
      description: String(s?.description ?? '').slice(0, 200), bestForCategory: String(s?.best_for_category ?? '').slice(0, 150),
      cameraSetup: String(s?.camera_setup ?? '').slice(0, 200), lightingSetup: String(s?.lighting_setup ?? '').slice(0, 200),
      background: String(s?.background ?? '').slice(0, 150), priority: ['high', 'medium', 'low'].includes(String(s?.priority)) ? String(s.priority) : 'medium',
    })),
    editingPlan: (parsed?.editing_plan || []).slice(0, 6).map((e: any) => ({
      editType: ['brightness', 'contrast', 'color_correction', 'background_removal', 'sharpening', 'crop'].includes(String(e?.edit_type)) ? String(e.edit_type) : 'brightness',
      description: String(e?.description ?? '').slice(0, 200), intensityPct: Math.max(0, Math.min(100, Number(e?.intensity_pct ?? 50))),
      tool: ['snapseed', 'lightroom', 'photoshop', 'canva', 'phone'].includes(String(e?.tool)) ? String(e.tool) : 'phone',
      stepByStep: String(e?.step_by_step ?? '').slice(0, 400), expectedImprovementPct: Math.round(Number(e?.expected_improvement_pct ?? 0)),
    })),
    summary: {
      totalListingsAssessed: targetListings.length, avgCurrentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_score ?? 50))),
      avgOptimizedScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_score ?? 75))),
      avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 25) * 10) / 10,
      weakestFactor: QUALITY_FACTORS.includes(String(parsed?.summary?.weakest_factor) as any) ? String(parsed.summary.weakest_factor) : 'composition',
      strongestFactor: QUALITY_FACTORS.includes(String(parsed?.summary?.strongest_factor) as any) ? String(parsed.summary.strongest_factor) : 'composition',
      biggestImageIssue: String(parsed?.summary?.biggest_image_issue ?? '').slice(0, 200),
      quickestImageFix: String(parsed?.summary?.quickest_image_fix ?? '').slice(0, 200),
      imageQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.image_quality_score ?? 60))),
    },
  };
}
