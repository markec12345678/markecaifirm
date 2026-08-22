// v6.92 / v8.95.5-listing: AI Listing Image Background Cleaner — ML čiščenje ozadja slik z segmentation
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-image-background-cleaner
// Body: { tradeId?: string }
// Returns: { ok, cleaner: { listing, backgroundAnalysis, cleaningActions, replacementOptions, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const BACKGROUND_TYPES = ['cluttered', 'messy', 'distracting', 'low_contrast', 'busy_pattern', 'unrelated_objects', 'poor_lighting_bg', 'other_people', 'text_overlay', 'watermark'] as const;
const REPLACEMENT_BACKGROUNDS = ['pure_white', 'pure_black', 'studio_gray', 'gradient_blue', 'gradient_warm', 'lifestyle_context', 'neutral_office', 'seamless_paper', 'transparent', 'branded'] as const;

interface ListingImageBackgroundCleanerInput {
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
  aiImageAnalysis: string;
}

export const POST = withAiRoute<ListingImageBackgroundCleanerInput>({
  endpoint: '/api/ai/listing-image-background-cleaner',
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
      return apiOk({ ok: true, cleaner: null, message: 'Ni aktivnih oglasov za background cleaning analizo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, url: true, imageUrl: true, aiImageAnalysis: true, aiImageVerdict: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      suggestedPrice,
      imageUrl: targetListing?.imageUrl ?? null,
      aiImageAnalysis: (targetListing?.aiImageAnalysis || '').slice(0, 200),
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const cleaner = transformCleaner(parsed, { title: target.title, category: target.category, imageUrl: targetListing?.imageUrl ?? null });

    return apiOk({ ok: true, cleaner });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing image background cleaner z ML in image segmentation.
Čisti ozadje slik z 10 tipi težav in 10 nadomestnimi ozadji.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Image URL: ${ctx.imageUrl || 'brez'}
- AI image analysis: ${ctx.aiImageAnalysis || 'brez'}

10 tipov težav z ozadjem:
1. CLUTTERED: nered
2. MESSY: umazano
3. DISTRACTING: moti pozornost
4. LOW_CONTRAST: nizek kontrast
5. BUSY_PATTERN: vzorčasto
6. UNRELATED_OBJECTS: nepovezani predmeti
7. POOR_LIGHTING_BG: slaba osvetlitev ozadja
8. OTHER_PEOPLE: druge osebe
9. TEXT_OVERLAY: besedilo čez
10. WATERMARK: vodni žig

10 nadomestnih ozadij: pure_white, pure_black, studio_gray, gradient_blue, gradient_warm, lifestyle_context, neutral_office, seamless_paper, transparent, branded

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "image_url": "<max 200 znakov>", "current_background_score": <number 0-100>, "cleaned_background_score": <number 0-100>, "current_ctr_pct": <number 0-100>, "cleaned_ctr_pct": <number 0-100>, "background_grade": "<A|B|C|D|F>" },
  "backgroundAnalysis": [
    { "issue_type": "<${BACKGROUND_TYPES.join('|')}>", "severity": "<critical|high|medium|low>", "affected_area_pct": <number 0-100>, "impact_on_ctr_pct": <number -30 do 0>, "detection_confidence_pct": <number 0-100>, "description": "<max 120 znakov>" }
  ],
  "cleaningActions": [
    { "action": "<max 150 znakov>", "technique": "<background_removal|object_inpainting|color_replacement|blur|crop|mask_refinement>", "tool_recommended": "<photoshop|canva|remove_bg|gimp|affinity_photo|lightroom>", "difficulty": "<easy|medium|hard>", "time_required_minutes": <number>, "expected_ctr_lift_pct": <number 0-30>, "priority": "<high|medium|low>" }
  ],
  "replacementOptions": [
    { "background_type": "<${REPLACEMENT_BACKGROUNDS.join('|')}>", "suitability_score": <number 0-100>, "category_fit": "<max 80 znakov>", "psychological_impact": "<max 100 znakov>", "best_for_segment": "<max 80 znakov>", "implementation_difficulty": "<easy|medium|hard>" }
  ],
  "mlModels": [
    { "model": "<u2net|sam|deeplabv3|mask_rcnn|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<background_detection|segmentation|ctr_prediction|aesthetic_scoring>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "background_cleaning_score": <number 0-100>, "background_grade": "<A|B|C|D|F>", "current_background_score": <number 0-100>,
    "cleaned_background_score": <number 0-100>, "expected_ctr_lift_pct": <number 0-100>,
    "biggest_background_risk": "<max 100 znakov>", "biggest_background_opportunity": "<max 100 znakov>",
    "quickest_background_win": "<max 100 znakov>", "background_analysis_score": <number 0-100>
  }
}`;
}

function transformCleaner(parsed: any, target: { title: string; category: string; imageUrl: string | null }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      imageUrl: String(parsed?.listing?.image_url ?? target.imageUrl ?? '').slice(0, 400),
      currentBackgroundScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_background_score ?? 50))),
      cleanedBackgroundScore: Math.max(0, Math.min(100, Number(parsed?.listing?.cleaned_background_score ?? 80))),
      currentCtrPct: Math.max(0, Math.min(100, Number(parsed?.listing?.current_ctr_pct ?? 5))),
      cleanedCtrPct: Math.max(0, Math.min(100, Number(parsed?.listing?.cleaned_ctr_pct ?? 9))),
      backgroundGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.background_grade)) ? String(parsed.listing.background_grade) : 'C',
    },
    backgroundAnalysis: (parsed?.backgroundAnalysis || []).slice(0, 10).map((a: any) => ({
      issueType: includes(BACKGROUND_TYPES, String(a?.issue_type)) ? String(a.issue_type) : 'cluttered',
      severity: ['critical', 'high', 'medium', 'low'].includes(String(a?.severity)) ? String(a.severity) : 'medium',
      affectedAreaPct: Math.max(0, Math.min(100, Number(a?.affected_area_pct ?? 30))),
      impactOnCtrPct: Math.max(-30, Math.min(0, Number(a?.impact_on_ctr_pct ?? -5))),
      detectionConfidencePct: Math.max(0, Math.min(100, Number(a?.detection_confidence_pct ?? 80))),
      description: String(a?.description ?? '').slice(0, 250),
    })),
    cleaningActions: (parsed?.cleaningActions || []).slice(0, 10).map((c: any) => ({
      action: String(c?.action ?? '').slice(0, 300),
      technique: ['background_removal', 'object_inpainting', 'color_replacement', 'blur', 'crop', 'mask_refinement'].includes(String(c?.technique)) ? String(c.technique) : 'background_removal',
      toolRecommended: ['photoshop', 'canva', 'remove_bg', 'gimp', 'affinity_photo', 'lightroom'].includes(String(c?.tool_recommended)) ? String(c.tool_recommended) : 'remove_bg',
      difficulty: ['easy', 'medium', 'hard'].includes(String(c?.difficulty)) ? String(c.difficulty) : 'medium',
      timeRequiredMinutes: Math.max(1, Number(c?.time_required_minutes ?? 10)),
      expectedCtrLiftPct: Math.max(0, Math.min(30, Number(c?.expected_ctr_lift_pct ?? 5))),
      priority: ['high', 'medium', 'low'].includes(String(c?.priority)) ? String(c.priority) : 'medium',
    })),
    replacementOptions: (parsed?.replacementOptions || []).slice(0, 10).map((r: any) => ({
      backgroundType: includes(REPLACEMENT_BACKGROUNDS, String(r?.background_type)) ? String(r.background_type) : 'pure_white',
      suitabilityScore: Math.max(0, Math.min(100, Number(r?.suitability_score ?? 70))),
      categoryFit: String(r?.category_fit ?? '').slice(0, 160),
      psychologicalImpact: String(r?.psychological_impact ?? '').slice(0, 200),
      bestForSegment: String(r?.best_for_segment ?? '').slice(0, 160),
      implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(r?.implementation_difficulty)) ? String(r.implementation_difficulty) : 'easy',
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['u2net', 'sam', 'deeplabv3', 'mask_rcnn', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 80))),
      predictionType: ['background_detection', 'segmentation', 'ctr_prediction', 'aesthetic_scoring'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'background_detection',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      backgroundCleaningScore: Math.max(0, Math.min(100, Number(parsed?.summary?.background_cleaning_score ?? 50))),
      backgroundGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.background_grade)) ? String(parsed.summary.background_grade) : 'C',
      currentBackgroundScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_background_score ?? 50))),
      cleanedBackgroundScore: Math.max(0, Math.min(100, Number(parsed?.summary?.cleaned_background_score ?? 80))),
      expectedCtrLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_ctr_lift_pct ?? 20))),
      biggestBackgroundRisk: String(parsed?.summary?.biggest_background_risk ?? '').slice(0, 200),
      biggestBackgroundOpportunity: String(parsed?.summary?.biggest_background_opportunity ?? '').slice(0, 200),
      quickestBackgroundWin: String(parsed?.summary?.quickest_background_win ?? '').slice(0, 200),
      backgroundAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.background_analysis_score ?? 50))),
    },
  };
}
