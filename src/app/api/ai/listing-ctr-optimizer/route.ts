// v6.75 / v8.94-refactor: AI Listing CTR Optimizer — ML optimizacija click-through rate z element analysis
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-ctr-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listings, ctrFactors, optimizations, experiments, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic, maxDuration } = AI_ROUTE_DEFAULTS;

const CTR_FACTORS = [
  'title_relevance', 'thumbnail_quality', 'price_appeal', 'position_ranking',
  'category_match', 'search_keywords', 'freshness', 'seller_rating',
  'location_proximity', 'urgency_signals',
] as const;

interface ListingCtrOptimizerInput {
  tradeId: string | null;
}

export const POST = withAiRoute<ListingCtrOptimizerInput>({
  endpoint: '/api/ai/listing-ctr-optimizer',
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

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: {
          select: {
            aiEstimatedValue: true, price: true, imageUrl: true, description: true,
            detailDescription: true, location: true, dealScore: true,
          },
        },
      },
      take: tradeId ? 1 : 15,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni held tradeov za CTR optimizacijo.' });
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

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    imageUrl: string | null;
    description: string;
    detailDescription: string | null;
    location: string;
    dealScore: number | null;
  } | null;
}

interface CtrItem {
  id: string;
  title: string;
  category: string;
  price: number;
  imageUrl: string;
  location: string;
  description: string;
}

function buildItems(heldTrades: HeldTradeRow[]): CtrItem[] {
  return heldTrades.map(t => ({
    id: t.id,
    title: t.title,
    category: t.category || 'drugo',
    price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
    imageUrl: t.listing?.imageUrl ?? '',
    location: t.listing?.location ?? '',
    description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200),
  }));
}

function buildItemsStr(items: CtrItem[]): string {
  return items
    .slice(0, 15)
    .map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.location} | slika: ${i.imageUrl ? 'da' : 'ne'}`)
    .join('\n');
}

function buildPrompt(items: CtrItem[], itemsStr: string): string {
  return `Si AI listing CTR optimizer z ML in element analysis.
Optimizira click-through rate z 10-faktorsko analizo.

OGLASI (${items.length}):
${itemsStr}

10 CTR faktorjev:
1. TITLE_RELEVANCE: relevantnost naslova za iskanje
2. THUMBNAIL_QUALITY: kakovost thumbnail slike
3. PRICE_APPEAL: privlačnost cene
4. POSITION_RANKING: pozicija v search results
5. CATEGORY_MATCH: ujemanje kategorije
6. SEARCH_KEYWORDS: ključne besede za iskanje
7. FRESHNESS: svežina oglasa
8. SELLER_RATING: rating prodajalca
9. LOCATION_PROXIMITY: bližina lokacije
10. URGENCY_SIGNALS: signali nujnosti

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "current_ctr_pct": <number 0-100>, "optimized_ctr_pct": <number 0-100>, "ctr_lift_pct": <number>, "ctr_factors": [{"factor": "<10 faktorjev>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "impact_pct": <number>, "priority": "<high|medium|low>"}], "optimized_title": "<max 80 znakov>", "optimized_thumbnail_recommendation": "<max 120 znakov>", "expected_views_increase_pct": <number>, "expected_inquiries_increase_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "ctrFactors": [
    { "factor": "<10 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 120 znakov>" }
  ],
  "optimizations": [
    { "optimization_type": "<title_rewrite|thumbnail_upgrade|price_adjustment|tag_optimization|refresh_posting|keyword_injection|urgency_addition|category_correction|location_emphasis|seller_boost>", "description": "<max 120 znakov>", "expected_ctr_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "time_to_implement_hours": <number> }
  ],
  "experiments": [
    { "listing_id": "<trade_id>", "experiment_name": "<max 80 znakov>", "variant_a": "<max 100 znakov>", "variant_b": "<max 100 znakov>", "predicted_ctr_a_pct": <number 0-100>, "predicted_ctr_b_pct": <number 0-100>, "expected_winner": "<a|b>", "test_duration_days": <number>, "sample_size_needed": <number> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|neural_network|random_forest|deep_learning|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<ctr_prediction|element_importance|view_forecast|inquiry_forecast>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_optimized": <number>, "avg_current_ctr_pct": <number>, "avg_optimized_ctr_pct": <number>,
    "avg_ctr_lift_pct": <number>, "biggest_ctr_blocker": "<max 100 znakov>",
    "quickest_ctr_win": "<max 100 znakov>", "ctr_optimization_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, items: CtrItem[]): any {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 15)
      .map((l: any) => ({
        tradeId: String(l?.id ?? ''),
        title: String(l?.title ?? '').slice(0, 150),
        currentCtrPct: Math.max(0, Math.min(100, Number(l?.current_ctr_pct ?? 5))),
        optimizedCtrPct: Math.max(0, Math.min(100, Number(l?.optimized_ctr_pct ?? 10))),
        ctrLiftPct: Math.round(Number(l?.ctr_lift_pct ?? 0) * 10) / 10,
        ctrFactors: (l?.ctr_factors || []).slice(0, 10).map((f: any) => ({
          factor: CTR_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'title_relevance',
          currentScore: Math.max(0, Math.min(100, Number(f?.current_score ?? 50))),
          optimizedScore: Math.max(0, Math.min(100, Number(f?.optimized_score ?? 70))),
          impactPct: Math.round(Number(f?.impact_pct ?? 0) * 10) / 10,
          priority: ['high', 'medium', 'low'].includes(String(f?.priority)) ? String(f.priority) : 'medium',
        })),
        optimizedTitle: String(l?.optimized_title ?? '').slice(0, 120),
        optimizedThumbnailRecommendation: String(l?.optimized_thumbnail_recommendation ?? '').slice(0, 250),
        expectedViewsIncreasePct: Math.round(Number(l?.expected_views_increase_pct ?? 30)),
        expectedInquiriesIncreasePct: Math.round(Number(l?.expected_inquiries_increase_pct ?? 25)),
        priority: ['high', 'medium', 'low'].includes(String(l?.priority)) ? String(l.priority) : 'medium',
      })),
    ctrFactors: (parsed?.ctrFactors || []).slice(0, 10).map((f: any) => ({
      factor: CTR_FACTORS.includes(String(f?.factor) as any) ? String(f.factor) : 'title_relevance',
      weight: Math.max(0, Math.min(100, Number(f?.weight ?? 10))),
      avgScore: Math.max(0, Math.min(100, Number(f?.avg_score ?? 50))),
      benchmark: Math.max(0, Math.min(100, Number(f?.benchmark ?? 60))),
      improvementPotential: ['high', 'medium', 'low'].includes(String(f?.improvement_potential)) ? String(f.improvement_potential) : 'medium',
      bestPractice: String(f?.best_practice ?? '').slice(0, 250),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
      optimizationType: ['title_rewrite', 'thumbnail_upgrade', 'price_adjustment', 'tag_optimization', 'refresh_posting', 'keyword_injection', 'urgency_addition', 'category_correction', 'location_emphasis', 'seller_boost'].includes(String(o?.optimization_type)) ? String(o.optimization_type) : 'title_rewrite',
      description: String(o?.description ?? '').slice(0, 250),
      expectedCtrLiftPct: Math.round(Number(o?.expected_ctr_lift_pct ?? 0) * 10) / 10,
      implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'low',
      timeToImplementHours: Math.max(0.5, Number(o?.time_to_implement_hours ?? 1)),
    })),
    experiments: (parsed?.experiments || [])
      .filter((e: any) => validIds.has(String(e?.listing_id ?? '')))
      .slice(0, 10)
      .map((e: any) => ({
        tradeId: String(e?.listing_id ?? '').slice(0, 50),
        experimentName: String(e?.experiment_name ?? '').slice(0, 150),
        variantA: String(e?.variant_a ?? '').slice(0, 200),
        variantB: String(e?.variant_b ?? '').slice(0, 200),
        predictedCtrAPct: Math.max(0, Math.min(100, Number(e?.predicted_ctr_a_pct ?? 5))),
        predictedCtrBPct: Math.max(0, Math.min(100, Number(e?.predicted_ctr_b_pct ?? 8))),
        expectedWinner: ['a', 'b'].includes(String(e?.expected_winner)) ? String(e.expected_winner) : 'b',
        testDurationDays: Math.max(3, Number(e?.test_duration_days ?? 7)),
        sampleSizeNeeded: Math.max(50, Number(e?.sample_size_needed ?? 100)),
      })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['gradient_boosting', 'neural_network', 'random_forest', 'deep_learning', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['ctr_prediction', 'element_importance', 'view_forecast', 'inquiry_forecast'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'ctr_prediction',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      totalListingsOptimized: items.length,
      avgCurrentCtrPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_ctr_pct ?? 5))),
      avgOptimizedCtrPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_ctr_pct ?? 10))),
      avgCtrLiftPct: Math.round(Number(parsed?.summary?.avg_ctr_lift_pct ?? 50) * 10) / 10,
      biggestCtrBlocker: String(parsed?.summary?.biggest_ctr_blocker ?? '').slice(0, 200),
      quickestCtrWin: String(parsed?.summary?.quickest_ctr_win ?? '').slice(0, 200),
      ctrOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.ctr_optimization_score ?? 60))),
    },
  };
}
