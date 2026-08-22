// v6.78 / v8.95.6-listing: AI Listing Thumbnail Optimizer — ML optimizacija thumbnail slik z VLM in A/B testing
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-thumbnail-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listings, thumbnailFactors, variants, editingPlan, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const THUMBNAIL_FACTORS = ['composition', 'lighting', 'color_saturation', 'item_visibility', 'background_cleanliness', 'angle_optimization', 'size_proportion', 'emotion_trigger', 'brand_visibility', 'resolution_quality'] as const;

interface ListingThumbnailOptimizerInput {
  tradeId: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  listing: {
    imageUrl: string | null;
    aiEstimatedValue: number | null;
    price: number | null;
    detailDescription: string | null;
    description: string | null;
  } | null;
}

interface ThumbnailItem {
  id: string;
  title: string;
  category: string;
  price: number;
  imageUrl: string;
}

export const POST = withAiRoute<ListingThumbnailOptimizerInput>({
  endpoint: '/api/ai/listing-thumbnail-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
    };
  },

  // No validateInput — tradeId je opcijski (null = vsi held tradei)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;
    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where,
      select: { id: true, title: true, category: true, buyPrice: true, buyFees: true, listing: { select: { imageUrl: true, aiEstimatedValue: true, price: true, detailDescription: true, description: true } } },
      take: tradeId ? 1 : 15,
    });
    if (heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni held tradeov za thumbnail optimizacijo.' });
    }

    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const prompt = buildPrompt(items, itemsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, items);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildItems(heldTrades: HeldTradeRow[]): ThumbnailItem[] {
  return heldTrades.map(t => ({
    id: t.id,
    title: t.title,
    category: t.category || 'drugo',
    price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
    imageUrl: t.listing?.imageUrl ?? '',
  }));
}

function buildItemsStr(items: ThumbnailItem[]): string {
  return items.slice(0, 15).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | slika: ${i.imageUrl ? 'da' : 'ne'}`).join('\n');
}

function buildPrompt(items: ThumbnailItem[], itemsStr: string): string {
  return `Si AI listing thumbnail optimizer z VLM in ML.
Optimizira thumbnail slike za maksimalen CTR in konverzijo.

OGLASI (${items.length}):
${itemsStr}

10 thumbnail faktorjev:
1. COMPOSITION: kompozicija slike (rule of thirds, centered)
2. LIGHTING: osvetlitev (natural, soft box, golden hour)
3. COLOR_SATURATION: nasičenost barv (vibrant, muted)
4. ITEM_VISIBILITY: vidljivost itema (clear, partially obscured)
5. BACKGROUND_CLEANLINESS: čistoča ozadja (clean, distracting)
6. ANGLE_OPTIMIZATION: optimalen kot snemanja
7. SIZE_PROPORTION: proporcija itema v sliki
8. EMOTION_TRIGGER: čustveni sprožilec (desire, trust, urgency)
9. BRAND_VISIBILITY: vidljivost blagovne znamke
10. RESOLUTION_QUALITY: kakovost resolucije

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "current_thumbnail_score": <number 0-100>, "optimized_thumbnail_score": <number 0-100>, "thumbnail_factors": [{"factor": "<10 faktorjev>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "issue": "<max 100 znakov>", "fix": "<max 120 znakov>"}], "recommended_angle": "<max 80 znakov>", "recommended_lighting": "<max 80 znakov>", "recommended_background": "<max 80 znakov>", "expected_ctr_increase_pct": <number>, "expected_conversion_increase_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "thumbnailFactors": [
    { "factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 120 znakov>" }
  ],
  "variants": [
    { "listing_id": "<trade_id>", "variant_name": "<max 60 znakov>", "description": "<max 120 znakov>", "ai_prompt": "<max 200 znakov za AI image gen>", "expected_ctr_pct": <number 0-100>, "expected_conversion_pct": <number 0-100>, "winner_probability_pct": <number 0-100> }
  ],
  "editingPlan": [
    { "edit_type": "<brightness|contrast|saturation|crop|background_removal|sharpen|color_balance|vignette|text_overlay|logo_placement>", "description": "<max 100 znakov>", "intensity_pct": <number 0-100>, "tool": "<snapseed|lightroom|photoshop|canva|phone>", "step_by_step": "<max 200 znakov>", "expected_improvement_pct": <number> }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<thumbnail_score|ctr_prediction|conversion_prediction|aesthetic_score>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_optimized": <number>, "avg_current_score": <number>, "avg_optimized_score": <number>,
    "avg_improvement_pct": <number>, "biggest_thumbnail_issue": "<max 100 znakov>",
    "quickest_thumbnail_win": "<max 100 znakov>", "thumbnail_optimization_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, items: ThumbnailItem[]): any {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 15).map((l: any) => ({
      tradeId: String(l?.id ?? ''),
      title: String(l?.title ?? '').slice(0, 150),
      currentThumbnailScore: Math.max(0, Math.min(100, Number(l?.current_thumbnail_score ?? 40))),
      optimizedThumbnailScore: Math.max(0, Math.min(100, Number(l?.optimized_thumbnail_score ?? 70))),
      thumbnailFactors: (l?.thumbnail_factors || []).slice(0, 10).map((f: any) => ({
        factor: includes(THUMBNAIL_FACTORS, String(f?.factor)) ? String(f.factor) : 'composition',
        currentScore: Math.max(0, Math.min(100, Number(f?.current_score ?? 40))),
        optimizedScore: Math.max(0, Math.min(100, Number(f?.optimized_score ?? 65))),
        issue: String(f?.issue ?? '').slice(0, 200),
        fix: String(f?.fix ?? '').slice(0, 250),
      })),
      recommendedAngle: String(l?.recommended_angle ?? '').slice(0, 150),
      recommendedLighting: String(l?.recommended_lighting ?? '').slice(0, 150),
      recommendedBackground: String(l?.recommended_background ?? '').slice(0, 150),
      expectedCtrIncreasePct: Math.round(Number(l?.expected_ctr_increase_pct ?? 0) * 10) / 10,
      expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0) * 10) / 10,
      priority: ['high', 'medium', 'low'].includes(String(l?.priority)) ? String(l.priority) : 'medium',
    })),
    thumbnailFactors: (parsed?.thumbnailFactors || []).slice(0, 10).map((f: any) => ({
      factor: includes(THUMBNAIL_FACTORS, String(f?.factor)) ? String(f.factor) : 'composition',
      weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))),
      avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 40))),
      benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))),
      improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
      bestPractice: String(f?.best_practice ?? '').slice(0, 250),
    })),
    variants: (parsed?.variants || []).filter((v: any) => validIds.has(String(v?.listing_id ?? ''))).slice(0, 15).map((v: any) => ({
      listingId: String(v?.listing_id ?? '').slice(0, 50),
      variantName: String(v?.variant_name ?? '').slice(0, 100),
      description: String(v?.description ?? '').slice(0, 250),
      aiPrompt: String(v?.ai_prompt ?? '').slice(0, 400),
      expectedCtrPct: Math.max(0, Math.min(100, Number(v?.expected_ctr_pct ?? 5))),
      expectedConversionPct: Math.max(0, Math.min(100, Number(v?.expected_conversion_pct ?? 10))),
      winnerProbabilityPct: Math.max(0, Math.min(100, Number(v?.winner_probability_pct ?? 25))),
    })),
    editingPlan: (parsed?.editingPlan || []).slice(0, 10).map((e: any) => ({
      editType: ['brightness', 'contrast', 'saturation', 'crop', 'background_removal', 'sharpen', 'color_balance', 'vignette', 'text_overlay', 'logo_placement'].includes(String(e?.edit_type)) ? String(e.edit_type) : 'brightness',
      description: String(e?.description ?? '').slice(0, 200),
      intensityPct: Math.max(0, Math.min(100, Number(e?.intensity_pct ?? 50))),
      tool: ['snapseed', 'lightroom', 'photoshop', 'canva', 'phone'].includes(String(e?.tool)) ? String(e.tool) : 'phone',
      stepByStep: String(e?.step_by_step ?? '').slice(0, 400),
      expectedImprovementPct: Math.round(Number(e?.expected_improvement_pct ?? 0) * 10) / 10,
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['cnn', 'resnet', 'vit', 'efficientnet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['thumbnail_score', 'ctr_prediction', 'conversion_prediction', 'aesthetic_score'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'thumbnail_score',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalListingsOptimized: items.length,
      avgCurrentScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_score ?? 40))),
      avgOptimizedScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_score ?? 70))),
      avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 30) * 10) / 10,
      biggestThumbnailIssue: String(parsed?.summary?.biggest_thumbnail_issue ?? '').slice(0, 200),
      quickestThumbnailWin: String(parsed?.summary?.quickest_thumbnail_win ?? '').slice(0, 200),
      thumbnailOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.thumbnail_optimization_score ?? 60))),
    },
  };
}
