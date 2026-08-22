// v6.91 / v8.95.6-listing: AI Listing Image Quality Scorer — ML ocena kakovosti slik z VLM in aesthetic scoring
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-image-quality-scorer
// Body: { tradeId?: string }
// Returns: { ok, scorer: { listing, imageAnalysis, qualityDimensions, improvementActions, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const QUALITY_DIMENSIONS = ['resolution', 'lighting', 'composition', 'color_accuracy', 'sharpness', 'background_cleanliness', 'angle_variety', 'detail_visibility', 'white_balance', 'noise_level'] as const;

interface ListingImageQualityScorerInput {
  tradeId: string | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date;
  buyLocation: string;
  notes: string | null;
  listingId: string | null;
}

interface TargetListingRow {
  aiEstimatedValue: number | null;
  aiRisk: number | null;
  url: string | null;
  imageUrl: string | null;
  aiImageAnalysis: string | null;
  aiImageVerdict: string | null;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  suggestedPrice: number;
  imageUrl: string | null;
  aiImageVerdict: string | null;
  aiImageAnalysis: string;
}

export const POST = withAiRoute<ListingImageQualityScorerInput>({
  endpoint: '/api/ai/listing-image-quality-scorer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId).trim() : null,
    };
  },

  // No validateInput — tradeId je opcijski (null = prvi held trade)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId } = input;

    const heldTrades: HeldTradeRow[] = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true, buyDate: true, buyLocation: true, notes: true, listingId: true },
      take: 200,
      orderBy: { buyDate: 'desc' },
    });
    if (heldTrades.length === 0) {
      return apiOk({ ok: true, scorer: null, message: 'Ni aktivnih oglasov za image quality analizo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true, imageUrl: true, aiImageAnalysis: true, aiImageVerdict: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      suggestedPrice,
      imageUrl: targetListing?.imageUrl ?? null,
      aiImageVerdict: targetListing?.aiImageVerdict ?? null,
      aiImageAnalysis: (targetListing?.aiImageAnalysis || '').slice(0, 200),
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const scorer = transformScorer(parsed, {
      title: target.title,
      category: target.category,
      imageUrl: targetListing?.imageUrl ?? null,
    });

    return apiOk({ ok: true, scorer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing image quality scorer z ML in VLM za aesthetic scoring.
Ocenjuje kakovost slik z 10 dimenzijami in predlaga izboljšave.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Image URL: ${ctx.imageUrl || 'brez'}
- AI image verdict: ${ctx.aiImageVerdict || 'brez'}
- AI image analysis: ${ctx.aiImageAnalysis || 'brez'}

10 dimenzij kakovosti: resolution, lighting, composition, color_accuracy, sharpness, background_cleanliness, angle_variety, detail_visibility, white_balance, noise_level

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "image_url": "<max 200 znakov>", "current_quality_score": <number 0-100>, "optimized_quality_score": <number 0-100>, "current_ctr_prediction_pct": <number 0-100>, "optimized_ctr_prediction_pct": <number 0-100>, "quality_grade": "<A|B|C|D|F>" },
  "imageAnalysis": [
    { "aspect": "<format|size|orientation|file_type|color_profile|transparency|metadata>", "current_value": "<max 100 znakov>", "optimal_value": "<max 100 znakov>", "compliant": <boolean>, "fix_required": <boolean>, "fix_description": "<max 120 znakov>" }
  ],
  "qualityDimensions": [
    { "dimension": "<${QUALITY_DIMENSIONS.join('|')}>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "weight_pct": <number 0-100>, "improvement_pct": <number 0-50>, "issue_description": "<max 100 znakov>", "fix_recommendation": "<max 150 znakov>" }
  ],
  "improvementActions": [
    { "action": "<max 150 znakov>", "dimension": "<${QUALITY_DIMENSIONS.join('|')}>", "tool_recommended": "<snapseed|lightroom|photoshop|canva|phone_camera|dslr|tripod|light_box>", "difficulty": "<easy|medium|hard>", "expected_quality_lift_pct": <number 0-50>, "expected_ctr_lift_pct": <number 0-30>, "time_required_minutes": <number>, "priority": "<high|medium|low>" }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|clip>", "accuracy_pct": <number 0-100>, "prediction_type": "<quality_scoring|aesthetic_prediction|ctr_forecast|defect_detection>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "image_quality_score": <number 0-100>, "quality_grade": "<A|B|C|D|F>", "current_quality_score": <number 0-100>,
    "optimized_quality_score": <number 0-100>, "expected_ctr_lift_pct": <number 0-100>,
    "biggest_quality_risk": "<max 100 znakov>", "biggest_quality_opportunity": "<max 100 znakov>",
    "quickest_quality_win": "<max 100 znakov>", "image_analysis_score": <number 0-100>
  }
}`;
}

function transformScorer(parsed: any, target: { title: string; category: string; imageUrl: string | null }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      imageUrl: String(parsed?.listing?.image_url ?? target.imageUrl ?? '').slice(0, 400),
      currentQualityScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_quality_score ?? 50))),
      optimizedQualityScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_quality_score ?? 75))),
      currentCtrPredictionPct: Math.max(0, Math.min(100, Number(parsed?.listing?.current_ctr_prediction_pct ?? 5))),
      optimizedCtrPredictionPct: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_ctr_prediction_pct ?? 9))),
      qualityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.quality_grade)) ? String(parsed.listing.quality_grade) : 'C',
    },
    imageAnalysis: (parsed?.imageAnalysis || []).slice(0, 8).map((a: any) => ({
      aspect: String(a?.aspect ?? 'format').slice(0, 50),
      currentValue: String(a?.current_value ?? '').slice(0, 200),
      optimalValue: String(a?.optimal_value ?? '').slice(0, 200),
      compliant: Boolean(a?.compliant ?? false),
      fixRequired: Boolean(a?.fix_required ?? false),
      fixDescription: String(a?.fix_description ?? '').slice(0, 250),
    })),
    qualityDimensions: (parsed?.qualityDimensions || []).slice(0, 10).map((d: any) => ({
      dimension: includes(QUALITY_DIMENSIONS, String(d?.dimension)) ? String(d.dimension) : 'resolution',
      currentScore: Math.max(0, Math.min(100, Number(d?.current_score ?? 50))),
      optimizedScore: Math.max(0, Math.min(100, Number(d?.optimized_score ?? 75))),
      weightPct: Math.max(0, Math.min(100, Number(d?.weight_pct ?? 10))),
      improvementPct: Math.max(0, Math.min(50, Number(d?.improvement_pct ?? 15))),
      issueDescription: String(d?.issue_description ?? '').slice(0, 200),
      fixRecommendation: String(d?.fix_recommendation ?? '').slice(0, 300),
    })),
    improvementActions: (parsed?.improvementActions || []).slice(0, 10).map((a: any) => ({
      action: String(a?.action ?? '').slice(0, 300),
      dimension: includes(QUALITY_DIMENSIONS, String(a?.dimension)) ? String(a.dimension) : 'resolution',
      toolRecommended: ['snapseed', 'lightroom', 'photoshop', 'canva', 'phone_camera', 'dslr', 'tripod', 'light_box'].includes(String(a?.tool_recommended)) ? String(a.tool_recommended) : 'snapseed',
      difficulty: ['easy', 'medium', 'hard'].includes(String(a?.difficulty)) ? String(a.difficulty) : 'medium',
      expectedQualityLiftPct: Math.max(0, Math.min(50, Number(a?.expected_quality_lift_pct ?? 15))),
      expectedCtrLiftPct: Math.max(0, Math.min(30, Number(a?.expected_ctr_lift_pct ?? 5))),
      timeRequiredMinutes: Math.max(1, Number(a?.time_required_minutes ?? 15)),
      priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['cnn', 'resnet', 'vit', 'efficientnet', 'clip'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['quality_scoring', 'aesthetic_prediction', 'ctr_forecast', 'defect_detection'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'quality_scoring',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      imageQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.image_quality_score ?? 50))),
      qualityGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.quality_grade)) ? String(parsed.summary.quality_grade) : 'C',
      currentQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_quality_score ?? 50))),
      optimizedQualityScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_quality_score ?? 75))),
      expectedCtrLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_ctr_lift_pct ?? 15))),
      biggestQualityRisk: String(parsed?.summary?.biggest_quality_risk ?? '').slice(0, 200),
      biggestQualityOpportunity: String(parsed?.summary?.biggest_quality_opportunity ?? '').slice(0, 200),
      quickestQualityWin: String(parsed?.summary?.quickest_quality_win ?? '').slice(0, 200),
      imageAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.image_analysis_score ?? 50))),
    },
  };
}
