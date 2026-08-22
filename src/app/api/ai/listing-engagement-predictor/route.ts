// v6.76 / v8.95.7-listing: AI Listing Engagement Predictor — ML napoved engagement z 10 dimenzionalno analizo
// Refaktoriran z withAiRoute helperjem (v8.95.7-listing) + enforceBudget guard.
//
// POST /api/ai/listing-engagement-predictor
// Body: { tradeId?: string }
// Returns: { ok, predictor: { listings, engagementFactors, predictions, optimizations, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

const ENGAGEMENT_FACTORS = ['visual_appeal', 'title_attractiveness', 'price_competitiveness', 'description_quality', 'category_demand', 'seller_reputation', 'location_convenience', 'seasonal_relevance', 'social_proof', 'urgency_level'] as const;

interface ListingEngagementPredictorInput {
  tradeId: string | null;
}

export const POST = withAiRoute<ListingEngagementPredictorInput>({
  endpoint: '/api/ai/listing-engagement-predictor',
  maxDuration: 90,
  enforceBudget: true,

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
    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, price: true, imageUrl: true, description: true, detailDescription: true, dealScore: true, aiScore: true, aiRisk: true, location: true } },
      },
      take: tradeId ? 1 : 20,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, predictor: null, message: 'Ni held tradeov za engagement prediction.' });
    }

    const items = buildItems(heldTrades);
    const itemsStr = buildItemsStr(items);
    const prompt = buildPrompt(items.length, itemsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const predictor = transformPredictor(parsed, items);

    return apiOk({ ok: true, predictor });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number | null;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    imageUrl: string | null;
    description: string;
    detailDescription: string | null;
    dealScore: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    location: string | null;
  } | null;
}

interface EngagementItem {
  id: string;
  title: string;
  category: string;
  price: number;
  estValue: number;
  imageUrl: string;
  location: string;
  description: string;
}

function buildItems(heldTrades: HeldTradeRow[]): EngagementItem[] {
  return heldTrades.map(t => ({
    id: t.id,
    title: t.title,
    category: t.category || 'drugo',
    price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
    estValue: t.listing?.aiEstimatedValue ?? Math.round((t.buyPrice + (t.buyFees ?? 0)) * 1.25),
    imageUrl: t.listing?.imageUrl ?? '',
    location: t.listing?.location ?? '',
    description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200),
  }));
}

function buildItemsStr(items: EngagementItem[]): string {
  return items
    .slice(0, 15)
    .map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.location} | slika: ${i.imageUrl ? 'da' : 'ne'}`)
    .join('\n');
}

function buildPrompt(itemsCount: number, itemsStr: string): string {
  return `Si AI listing engagement predictor z ML in 10-dimenzionalno analizo.
Napoveduje engagement level z views, inquiries, saves, shares in conversion probability.

OGLASI (${itemsCount}):
${itemsStr}

10 engagement faktorjev:
1. VISUAL_APPEAL: vizualni privlek (slika, kompozicija)
2. TITLE_ATTRACTIVENESS: privlačnost naslova
3. PRICE_COMPETITIVENESS: konkurenčnost cene
4. DESCRIPTION_QUALITY: kakovost opisa
5. CATEGORY_DEMAND: povpraševanje po kategoriji
6. SELLER_REPUTATION: ugled prodajalca
7. LOCATION_CONVENIENCE: primernost lokacije
8. SEASONAL_RELEVANCE: sezonska relevantnost
9. SOCIAL_PROOF: socialno dokazilo (views, likes)
10. URGENCY_LEVEL: raven nujnosti

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "engagement_score": <number 0-100>, "engagement_level": "<very_high|high|medium|low|very_low>", "predicted_views_7d": <number>, "predicted_inquiries_7d": <number>, "predicted_saves_7d": <number>, "predicted_shares_7d": <number>, "conversion_probability_pct": <number 0-100>, "engagement_factors": [{"factor": "<10 faktorjev>", "score": <number 0-100>, "weight": <number 0-100>, "trend": "<improving|stable|declining>"}], "key_engagement_drivers": ["<max 80 znakov>"], "key_engagement_barriers": ["<max 80 znakov>"], "recommended_optimizations": ["<max 100 znakov>"], "expected_engagement_increase_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "engagementFactors": [
    { "factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 120 znakov>" }
  ],
  "predictions": [
    { "timeframe": "<24h|7d|30d>", "total_predicted_views": <number>, "total_predicted_inquiries": <number>, "total_predicted_saves": <number>, "total_predicted_shares": <number>, "avg_conversion_probability_pct": <number 0-100>, "confidence_pct": <number 0-100> }
  ],
  "optimizations": [
    { "optimization_type": "<image_upgrade|title_rewrite|price_adjustment|description_enhance|tag_optimization|refresh_posting|urgency_injection|social_proof_boost|category_correction|location_emphasis>", "description": "<max 120 znakov>", "expected_engagement_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "timeframe_hours": <number> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|neural_network|random_forest|deep_learning|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<engagement_score|view_prediction|inquiry_prediction|conversion_probability>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "avg_engagement_score": <number 0-100>, "high_engagement_count": <number>,
    "low_engagement_count": <number>, "total_predicted_views_7d": <number>, "total_predicted_inquiries_7d": <number>,
    "biggest_engagement_driver": "<max 100 znakov>", "biggest_engagement_barrier": "<max 100 znakov>",
    "quickest_engagement_win": "<max 100 znakov>", "engagement_prediction_score": <number 0-100>
  }
}`;
}

function transformPredictor(parsed: any, items: EngagementItem[]): any {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 20).map((l: any) => ({
      tradeId: String(l?.id ?? ''), title: String(l?.title ?? '').slice(0, 150),
      engagementScore: Math.max(0, Math.min(100, Number(l?.engagement_score ?? 50))),
      engagementLevel: ['very_high', 'high', 'medium', 'low', 'very_low'].includes(String(l?.engagement_level)) ? String(l.engagement_level) : 'medium',
      predictedViews7d: Math.max(0, Math.round(Number(l?.predicted_views_7d ?? 0))),
      predictedInquiries7d: Math.max(0, Math.round(Number(l?.predicted_inquiries_7d ?? 0))),
      predictedSaves7d: Math.max(0, Math.round(Number(l?.predicted_saves_7d ?? 0))),
      predictedShares7d: Math.max(0, Math.round(Number(l?.predicted_shares_7d ?? 0))),
      conversionProbabilityPct: Math.max(0, Math.min(100, Number(l?.conversion_probability_pct ?? 30))),
      engagementFactors: (l?.engagement_factors || []).slice(0, 10).map((f: any) => ({ factor: ENGAGEMENT_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'visual_appeal', score: Math.max(0, Math.min(100, Number(f?.score ?? 50))), weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))), trend: ['improving', 'stable', 'declining'].includes(String(f?.trend)) ? String(f.trend) : 'stable' })),
      keyEngagementDrivers: (l?.key_engagement_drivers || []).slice(0, 4).map((d: any) => String(d).slice(0, 150)),
      keyEngagementBarriers: (l?.key_engagement_barriers || []).slice(0, 4).map((b: any) => String(b).slice(0, 150)),
      recommendedOptimizations: (l?.recommended_optimizations || []).slice(0, 5).map((o: any) => String(o).slice(0, 200)),
      expectedEngagementIncreasePct: Math.round(Number(l?.expected_engagement_increase_pct ?? 0) * 10) / 10,
      priority: ['high', 'medium', 'low'].includes(String(l?.priority)) ? String(l.priority) : 'medium',
    })),
    engagementFactors: (parsed?.engagementFactors || []).slice(0, 10).map((f: any) => ({ factor: ENGAGEMENT_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'visual_appeal', weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))), avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))), benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))), improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium', bestPractice: String(f?.best_practice ?? '').slice(0, 250) })),
    predictions: (parsed?.predictions || []).slice(0, 3).map((p: any) => ({ timeframe: ['24h', '7d', '30d'].includes(String(p?.timeframe)) ? String(p.timeframe) : '7d', totalPredictedViews: Math.max(0, Number(p?.total_predicted_views ?? 0)), totalPredictedInquiries: Math.max(0, Number(p?.total_predicted_inquiries ?? 0)), totalPredictedSaves: Math.max(0, Number(p?.total_predicted_saves ?? 0)), totalPredictedShares: Math.max(0, Number(p?.total_predicted_shares ?? 0)), avgConversionProbabilityPct: Math.max(0, Math.min(100, Number(p?.avg_conversion_probability_pct ?? 30))), confidencePct: Math.max(0, Math.min(100, Number(p?.confidence_pct ?? 50))) })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({ optimizationType: ['image_upgrade', 'title_rewrite', 'price_adjustment', 'description_enhance', 'tag_optimization', 'refresh_posting', 'urgency_injection', 'social_proof_boost', 'category_correction', 'location_emphasis'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'image_upgrade', description: String(o?.description ?? '').slice(0, 250), expectedEngagementLiftPct: Math.round(Number(o?.expected_engagement_lift_pct ?? 0) * 10) / 10, implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'low', timeframeHours: Math.max(0.5, Number(o?.timeframe_hours ?? 1)) })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({ model: ['gradient_boosting', 'neural_network', 'random_forest', 'deep_learning', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble', accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))), predictionType: ['engagement_score', 'view_prediction', 'inquiry_prediction', 'conversion_probability'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'engagement_score', weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))) })),
    summary: { totalListingsAnalyzed: items.length, avgEngagementScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_engagement_score ?? 50))), highEngagementCount: Math.max(0, Number(parsed?.summary?.high_engagement_count ?? 0)), lowEngagementCount: Math.max(0, Number(parsed?.summary?.low_engagement_count ?? 0)), totalPredictedViews7d: Math.max(0, Number(parsed?.summary?.total_predicted_views_7d ?? 0)), totalPredictedInquiries7d: Math.max(0, Number(parsed?.summary?.total_predicted_inquiries_7d ?? 0)), biggestEngagementDriver: String(parsed?.summary?.biggest_engagement_driver ?? '').slice(0, 200), biggestEngagementBarrier: String(parsed?.summary?.biggest_engagement_barrier ?? '').slice(0, 200), quickestEngagementWin: String(parsed?.summary?.quickest_engagement_win ?? '').slice(0, 200), engagementPredictionScore: Math.max(0, Math.min(100, Number(parsed?.summary?.engagement_prediction_score ?? 60))) },
  };
}
