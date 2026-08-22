// v6.85 / v8.95.6-listing: AI Listing Mobile Optimizer — ML optimizacija oglasov za mobilne naprave z UX analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-mobile-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, mobileUxScore, optimizations, deviceAnalysis, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const UX_FACTORS = ['load_speed', 'image_optimization', 'text_readability', 'tap_targets', 'viewport_config', 'touch_friendly_navigation', 'form_usability', 'cta_visibility', 'scroll_depth_optimization', 'offline_capability'] as const;
const DEVICE_TYPES = ['iphone_se', 'iphone_standard', 'iphone_pro_max', 'android_compact', 'android_standard', 'android_tablet', 'ipad', 'foldable'] as const;

interface ListingMobileOptimizerInput {
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
  description: string | null;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  suggestedPrice: number;
  url: string | null;
  imageUrl: string | null;
  description: string;
}

export const POST = withAiRoute<ListingMobileOptimizerInput>({
  endpoint: '/api/ai/listing-mobile-optimizer',
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
      return apiOk({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za mobile optimizacijo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true, imageUrl: true, description: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      suggestedPrice,
      url: targetListing?.url ?? null,
      imageUrl: targetListing?.imageUrl ?? null,
      description: (target.notes || targetListing?.description || '').slice(0, 200),
    });

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, { title: target.title, category: target.category });

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function includes<T extends string>(arr: readonly T[], v: string): v is T {
  return (arr as readonly string[]).includes(v);
}

function buildPrompt(ctx: TargetContext): string {
  return `Si AI listing mobile optimizer z ML in UX analysis za mobilne naprave.
Optimizira oglase za mobile z 10 UX faktorji in 8 tipi naprav.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- URL: ${ctx.url || 'brez'}
- Image URL: ${ctx.imageUrl || 'brez'}
- Opis: ${ctx.description || 'brez'}

10 UX faktorjev: load_speed, image_optimization, text_readability, tap_targets, viewport_config, touch_friendly_navigation, form_usability, cta_visibility, scroll_depth_optimization, offline_capability

8 tipov naprav: iphone_se, iphone_standard, iphone_pro_max, android_compact, android_standard, android_tablet, ipad, foldable

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_mobile_score": <number 0-100>, "optimized_mobile_score": <number 0-100>, "mobile_conversion_rate_pct": <number 0-100>, "optimized_mobile_conversion_rate_pct": <number 0-100>, "mobile_optimization_grade": "<A|B|C|D|F>" },
  "mobileUxScore": [
    { "factor": "<${UX_FACTORS.join('|')}>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "weight_pct": <number 0-100>, "improvement_pct": <number 0-50>, "issue_description": "<max 120 znakov>", "fix_recommendation": "<max 150 znakov>" }
  ],
  "optimizations": [
    { "action": "<max 150 znakov>", "factor": "<${UX_FACTORS.join('|')}>", "implementation_difficulty": "<easy|medium|hard>", "expected_load_time_reduction_ms": <number>, "expected_conversion_lift_pct": <number 0-50>, "priority": "<high|medium|low>", "time_to_implement_hours": <number> }
  ],
  "deviceAnalysis": [
    { "device_type": "<${DEVICE_TYPES.join('|')}>", "compatibility_score": <number 0-100>, "rendering_issues": "<max 100 znakov>", "load_time_ms": <number>, "conversion_rate_pct": <number 0-100>, "specific_optimization": "<max 100 znakov>" }
  ],
  "mlModels": [
    { "model": "<cnn|resnet|vit|efficientnet|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<ux_scoring|conversion_prediction|rendering_optimization|device_compatibility>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "mobile_optimization_score": <number 0-100>, "mobile_optimization_grade": "<A|B|C|D|F>", "current_mobile_score": <number 0-100>,
    "optimized_mobile_score": <number 0-100>, "expected_conversion_lift_pct": <number 0-100>,
    "biggest_mobile_risk": "<max 100 znakov>", "biggest_mobile_opportunity": "<max 100 znakov>",
    "quickest_mobile_win": "<max 100 znakov>", "mobile_analysis_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, target: { title: string; category: string }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentMobileScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_mobile_score ?? 50))),
      optimizedMobileScore: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_mobile_score ?? 75))),
      mobileConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.listing?.mobile_conversion_rate_pct ?? 15))),
      optimizedMobileConversionRatePct: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_mobile_conversion_rate_pct ?? 22))),
      mobileOptimizationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.mobile_optimization_grade)) ? String(parsed.listing.mobile_optimization_grade) : 'C',
    },
    mobileUxScore: (parsed?.mobileUxScore || []).slice(0, 10).map((s: any) => ({
      factor: includes(UX_FACTORS, String(s?.factor)) ? String(s.factor) : 'load_speed',
      currentScore: Math.max(0, Math.min(100, Number(s?.current_score ?? 50))),
      optimizedScore: Math.max(0, Math.min(100, Number(s?.optimized_score ?? 75))),
      weightPct: Math.max(0, Math.min(100, Number(s?.weight_pct ?? 10))),
      improvementPct: Math.max(0, Math.min(50, Number(s?.improvement_pct ?? 0))),
      issueDescription: String(s?.issue_description ?? '').slice(0, 250),
      fixRecommendation: String(s?.fix_recommendation ?? '').slice(0, 300),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
      action: String(o?.action ?? '').slice(0, 300),
      factor: includes(UX_FACTORS, String(o?.factor)) ? String(o.factor) : 'load_speed',
      implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium',
      expectedLoadTimeReductionMs: Math.max(0, Number(o?.expected_load_time_reduction_ms ?? 0)),
      expectedConversionLiftPct: Math.max(0, Math.min(50, Number(o?.expected_conversion_lift_pct ?? 10))),
      priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
      timeToImplementHours: Math.max(0, Number(o?.time_to_implement_hours ?? 1)),
    })),
    deviceAnalysis: (parsed?.deviceAnalysis || []).slice(0, 8).map((d: any) => ({
      deviceType: includes(DEVICE_TYPES, String(d?.device_type)) ? String(d.device_type) : 'iphone_standard',
      compatibilityScore: Math.max(0, Math.min(100, Number(d?.compatibility_score ?? 70))),
      renderingIssues: String(d?.rendering_issues ?? '').slice(0, 200),
      loadTimeMs: Math.max(0, Number(d?.load_time_ms ?? 2000)),
      conversionRatePct: Math.max(0, Math.min(100, Number(d?.conversion_rate_pct ?? 15))),
      specificOptimization: String(d?.specific_optimization ?? '').slice(0, 200),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['cnn', 'resnet', 'vit', 'efficientnet', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['ux_scoring', 'conversion_prediction', 'rendering_optimization', 'device_compatibility'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'ux_scoring',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      mobileOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.mobile_optimization_score ?? 50))),
      mobileOptimizationGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.mobile_optimization_grade)) ? String(parsed.summary.mobile_optimization_grade) : 'C',
      currentMobileScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_mobile_score ?? 50))),
      optimizedMobileScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_mobile_score ?? 75))),
      expectedConversionLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_conversion_lift_pct ?? 20))),
      biggestMobileRisk: String(parsed?.summary?.biggest_mobile_risk ?? '').slice(0, 200),
      biggestMobileOpportunity: String(parsed?.summary?.biggest_mobile_opportunity ?? '').slice(0, 200),
      quickestMobileWin: String(parsed?.summary?.quickest_mobile_win ?? '').slice(0, 200),
      mobileAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.mobile_analysis_score ?? 50))),
    },
  };
}
