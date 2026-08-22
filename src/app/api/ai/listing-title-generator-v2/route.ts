// v6.62 / v8.96.2-batch4: AI Listing Title Generator v2 — ML naslovi z A/B testing in platform optimization
// Refaktoriran z withAiRoute helperjem (v8.96.2) + enforceBudget guard.
//
// POST /api/ai/listing-title-generator-v2
// Body: { tradeId?: string, listingId?: string, platforms?: string[] }
// Returns: { ok, generator: { listings, titleVariants, mlScoring, abTestPlan, platformOptimizations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

const TITLE_STRATEGIES = [
  'keyword_front_loaded',
  'brand_model_spec',
  'benefit_focused',
  'urgency_driven',
  'question_format',
  'number_included',
  'emotional_appeal',
  'local_seo',
  'comparison_format',
  'scarcity_emphasis',
] as const;

interface ListingTitleGeneratorInput {
  tradeId: string | null;
  listingId?: string;
  platforms: string[];
}

interface TargetListing {
  id: string;
  title: string;
  category: string;
  price: number;
  description: string;
  estValue: number;
}

export const POST = withAiRoute<ListingTitleGeneratorInput>({
  endpoint: '/api/ai/listing-title-generator-v2',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const platforms: string[] = Array.isArray(body?.platforms) ? body.platforms : ['bolha', 'facebook', 'vinted'];
    return {
      tradeId,
      listingId: listingId ? String(listingId) : undefined,
      platforms,
    };
  },

  // No validateInput — listing lookup needs DB access, validation je v handlerju
  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, listingId, platforms } = input;

    const targetListings = await resolveTargetListings(db, tradeId, listingId);
    if (targetListings.length === 0) {
      return apiOk({ ok: true, generator: null, message: 'Ni listingov za title generacijo.' });
    }

    const prompt = buildPrompt(targetListings, platforms);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const generator = transformGenerator(parsed, targetListings, platforms);

    return apiOk({ ok: true, generator });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

async function resolveTargetListings(
  db: AiRouteContext['db'],
  tradeId: string | null,
  listingId?: string
): Promise<TargetListing[]> {
  if (tradeId) {
    const t = await db.trade.findUnique({
      where: { id: tradeId },
      select: { id: true, title: true, category: true, buyPrice: true,
        listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true, price: true } } },
    });
    if (!t) throw new ApiRouteError('Trade ne obstaja', 404);
    return [{
      id: t.id, title: t.title, category: t.category || 'drugo',
      price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
      description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 400),
    }];
  }
  if (listingId) {
    const l = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: { id: true, title: true, price: true, description: true, detailDescription: true, aiEstimatedValue: true },
    });
    if (!l) throw new ApiRouteError('Listing ne obstaja', 404);
    return [{
      id: l.id, title: l.title, category: '', price: l.price ?? 0, estValue: l.aiEstimatedValue ?? l.price ?? 0,
      description: (l.detailDescription || l.description || '').slice(0, 400),
    }];
  }
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: { id: true, title: true, category: true, buyPrice: true,
      listing: { select: { description: true, detailDescription: true, aiEstimatedValue: true, price: true } } },
    take: 10,
    orderBy: { buyDate: 'desc' },
  });
  return heldTrades.map(t => ({
    id: t.id, title: t.title, category: t.category || 'drugo',
    price: t.listing?.price ?? t.buyPrice, estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
    description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 400),
  }));
}

function buildPrompt(targetListings: TargetListing[], platforms: string[]): string {
  const itemsStr = targetListings.slice(0, 10).map(i =>
    `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.description.slice(0, 80)}`
  ).join('\n');

  return `Si AI listing title generator v2 z ML scoring in A/B testing.
Generira 5 naslovov per listing z ML scoring in platform-specific optimizacijo.

OGLASI (${targetListings.length}):
${itemsStr}

PLATFORME: ${platforms.join(', ')}

10 title strategij:
1. KEYWORD_FRONT_LOADED: ključne besede spredaj (iPhone 13 Pro 128GB)
2. BRAND_MODEL_SPEC: brand + model + specifikacije (Samsung Galaxy S22 Ultra 256GB)
3. BENEFIT_FOCUSED: korist za kupca (Popolno stanje, garancija)
4. URGENCY_DRIVEN: nujnost (Danes, omejeno, zadnji)
5. QUESTION_FORMAT: vprašanje (iščeš telefon?)
6. NUMBER_INCLUDED: številke (3x, 50% popust, 2024)
7. EMOTIONAL_APPEAL: čustven apel (darilo, spomin)
8. LOCAL_SEO: lokalna optimizacija (Ljubljana, Maribor)
9. COMPARISON_FORMAT: primerjava (boljše od, kot novo)
10. SCARCITY_EMPHASIS: redkost (redko, limited, edinstveno)

Platform-specifične omejitve:
- BOLHA: max 60 znakov, ključne besede spredaj
- FACEBOOK: max 80 znakov, čustveni element
- VINTED: max 50 znakov, brand + velikost + stanje
- EBAY: max 80 znakov, specifikacije
- KLEINANZEIGEN: max 70 znakov, praktično

ML scoring faktorji:
- CTR_PREDICTION: click-through rate prediction
- SEARCH_VISIBILITY: vidljivost v iskanju
- CONVERSION_PROBABILITY: verjetnost konverzije
- ENGAGEMENT_SCORE: kombiniran score

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "current_title": "<original>",
      "current_title_score": <number 0-100>,
      "title_variants": [
        {
          "variant_id": "<a|b|c|d|e>",
          "title": "<naslov>",
          "strategy": "<10 strategij>",
          "character_count": <number>,
          "ml_scores": {
            "ctr_prediction_pct": <number 0-100>,
            "search_visibility_pct": <number 0-100>,
            "conversion_probability_pct": <number 0-100>,
            "engagement_score": <number 0-100>,
            "overall_score": <number 0-100>
          },
          "keywords_included": ["<ključna beseda>"],
          "platform_fit": [{"platform": "<platforma>", "fit_score": <number 0-100>}],
          "expected_ctr_lift_pct": <number>,
          "winner_probability_pct": <number 0-100>
        }
      ],
      "recommended_title": "<max 100 znakov>",
      "recommended_strategy": "<10 strategij>",
      "expected_ctr_increase_pct": <number>,
      "expected_views_increase_pct": <number>
    }
  ],
  "title_variants": [
    {
      "strategy": "<10 strategij>",
      "description": "<max 100 znakov>",
      "best_for_category": "<max 80 znakov>",
      "example": "<max 80 znakov>",
      "avg_ctr_lift_pct": <number>,
      "avg_overall_score": <number 0-100>
    }
  ],
  "ml_scoring": [
    {
      "metric": "<ctr_prediction|search_visibility|conversion_probability|engagement_score|overall_score>",
      "weight": <number 0-100>,
      "description": "<max 100 znakov>",
      "benchmark": <number 0-100>,
      "optimization_tip": "<max 120 znakov>"
    }
  ],
  "ab_test_plan": [
    {
      "listing_id": "<trade_id>",
      "variant_a_title": "<title>",
      "variant_a_strategy": "<strategija>",
      "variant_b_title": "<title>",
      "variant_b_strategy": "<strategija>",
      "test_duration_days": <number>,
      "primary_metric": "<ctr|views|inquiries|conversion_rate>",
      "sample_size_needed": <number>,
      "expected_winner": "<a|b>",
      "confidence_level_pct": <number 0-100>
    }
  ],
  "platform_optimizations": [
    {
      "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
      "max_chars": <number>,
      "best_strategy": "<10 strategij>",
      "example_title": "<max 100 znakov>",
      "keyword_placement": "<front|middle|end>",
      "emoji_usage": "<recommended|optional|avoid>",
      "expected_performance_pct": <number 0-100>
    }
  ],
  "summary": {
    "total_listings_processed": <number>,
    "total_variants_generated": <number>,
    "avg_current_title_score": <number>,
    "avg_recommended_title_score": <number>,
    "avg_improvement_pct": <number>,
    "best_strategy_overall": "<max 80 znakov>",
    "biggest_title_issue": "<max 100 znakov>",
    "quickest_title_win": "<max 100 znakov>",
    "title_generation_score": <number 0-100>
  }
}`;
}

function transformGenerator(parsed: any, targetListings: TargetListing[], platforms: string[]): {
  insights: string;
  listings: any[];
  titleVariants: any[];
  mlScoring: any[];
  abTestPlan: any[];
  platformOptimizations: any[];
  summary: any;
} {
  const validIds = new Set(targetListings.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 10)
      .map((l: any) => {
        const orig = targetListings.find(x => x.id === String(l?.id));
        return {
          tradeId: String(l?.id ?? ''),
          currentTitle: String(l?.current_title ?? orig?.title ?? '').slice(0, 200),
          currentTitleScore: Math.max(0, Math.min(100, Number(l?.current_title_score ?? 50))),
          titleVariants: (l?.title_variants || []).slice(0, 5).map((v: any) => ({
            variantId: ['a', 'b', 'c', 'd', 'e'].includes(String(v?.variant_id)) ? String(v.variant_id) : 'a',
            title: String(v?.title ?? '').slice(0, 150),
            strategy: TITLE_STRATEGIES.includes(String(v?.strategy) as any) ? String(v.strategy) : 'keyword_front_loaded',
            characterCount: Math.max(0, Number(v?.character_count ?? 0)),
            mlScores: {
              ctrPredictionPct: Math.max(0, Math.min(100, Number(v?.ml_scores?.ctr_prediction_pct ?? 50))),
              searchVisibilityPct: Math.max(0, Math.min(100, Number(v?.ml_scores?.search_visibility_pct ?? 50))),
              conversionProbabilityPct: Math.max(0, Math.min(100, Number(v?.ml_scores?.conversion_probability_pct ?? 50))),
              engagementScore: Math.max(0, Math.min(100, Number(v?.ml_scores?.engagement_score ?? 50))),
              overallScore: Math.max(0, Math.min(100, Number(v?.ml_scores?.overall_score ?? 50))),
            },
            keywordsIncluded: (v?.keywords_included || []).slice(0, 8).map((k: any) => String(k).slice(0, 60)),
            platformFit: (v?.platform_fit || []).slice(0, 5).map((p: any) => ({
              platform: platforms.includes(String(p?.platform)) ? String(p.platform) : 'bolha',
              fitScore: Math.max(0, Math.min(100, Number(p?.fit_score ?? 60))),
            })),
            expectedCtrLiftPct: Math.round(Number(v?.expected_ctr_lift_pct ?? 0)),
            winnerProbabilityPct: Math.max(0, Math.min(100, Number(v?.winner_probability_pct ?? 20))),
          })),
          recommendedTitle: String(l?.recommended_title ?? '').slice(0, 150),
          recommendedStrategy: TITLE_STRATEGIES.includes(String(l?.recommended_strategy) as any) ? String(l.recommended_strategy) : 'keyword_front_loaded',
          expectedCtrIncreasePct: Math.round(Number(l?.expected_ctr_increase_pct ?? 0)),
          expectedViewsIncreasePct: Math.round(Number(l?.expected_views_increase_pct ?? 0)),
        };
      }),
    titleVariants: (parsed?.title_variants || []).slice(0, 10).map((t: any) => ({
      strategy: TITLE_STRATEGIES.includes(String(t?.strategy) as any) ? String(t.strategy) : 'keyword_front_loaded',
      description: String(t?.description ?? '').slice(0, 200),
      bestForCategory: String(t?.best_for_category ?? '').slice(0, 150),
      example: String(t?.example ?? '').slice(0, 150),
      avgCtrLiftPct: Math.round(Number(t?.avg_ctr_lift_pct ?? 0)),
      avgOverallScore: Math.max(0, Math.min(100, Number(t?.avg_overall_score ?? 50))),
    })),
    mlScoring: (parsed?.ml_scoring || []).slice(0, 5).map((m: any) => ({
      metric: ['ctr_prediction', 'search_visibility', 'conversion_probability', 'engagement_score', 'overall_score'].includes(String(m?.metric)) ? String(m.metric) : 'overall_score',
      weight: Math.max(0, Math.min(100, Number(m?.weight ?? 20))),
      description: String(m?.description ?? '').slice(0, 200),
      benchmark: Math.max(0, Math.min(100, Number(m?.benchmark ?? 50))),
      optimizationTip: String(m?.optimization_tip ?? '').slice(0, 250),
    })),
    abTestPlan: (parsed?.ab_test_plan || [])
      .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
      .slice(0, 10)
      .map((t: any) => ({
        tradeId: String(t?.listing_id ?? '').slice(0, 50),
        variantATitle: String(t?.variant_a_title ?? '').slice(0, 150),
        variantAStrategy: TITLE_STRATEGIES.includes(String(t?.variant_a_strategy) as any) ? String(t.variant_a_strategy) : 'keyword_front_loaded',
        variantBTitle: String(t?.variant_b_title ?? '').slice(0, 150),
        variantBStrategy: TITLE_STRATEGIES.includes(String(t?.variant_b_strategy) as any) ? String(t.variant_b_strategy) : 'brand_model_spec',
        testDurationDays: Math.max(3, Math.min(30, Number(t?.test_duration_days ?? 7))),
        primaryMetric: ['ctr', 'views', 'inquiries', 'conversion_rate'].includes(String(t?.primary_metric)) ? String(t.primary_metric) : 'ctr',
        sampleSizeNeeded: Math.max(50, Number(t?.sample_size_needed ?? 100)),
        expectedWinner: ['a', 'b'].includes(String(t?.expected_winner)) ? String(t.expected_winner) : 'b',
        confidenceLevelPct: Math.max(0, Math.min(100, Number(t?.confidence_level_pct ?? 95))),
      })),
    platformOptimizations: (parsed?.platform_optimizations || [])
      .filter((p: any) => platforms.includes(String(p?.platform)))
      .slice(0, 5)
      .map((p: any) => ({
        platform: platforms.includes(String(p?.platform)) ? String(p.platform) : 'bolha',
        maxChars: Math.max(20, Number(p?.max_chars ?? 60)),
        bestStrategy: TITLE_STRATEGIES.includes(String(p?.best_strategy) as any) ? String(p.best_strategy) : 'keyword_front_loaded',
        exampleTitle: String(p?.example_title ?? '').slice(0, 150),
        keywordPlacement: ['front', 'middle', 'end'].includes(String(p?.keyword_placement)) ? String(p.keyword_placement) : 'front',
        emojiUsage: ['recommended', 'optional', 'avoid'].includes(String(p?.emoji_usage)) ? String(p.emoji_usage) : 'optional',
        expectedPerformancePct: Math.max(0, Math.min(100, Number(p?.expected_performance_pct ?? 60))),
      })),
    summary: {
      totalListingsProcessed: targetListings.length,
      totalVariantsGenerated: Math.max(0, Number(parsed?.summary?.total_variants_generated ?? targetListings.length * 5)),
      avgCurrentTitleScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_title_score ?? 50))),
      avgRecommendedTitleScore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_recommended_title_score ?? 75))),
      avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 25) * 10) / 10,
      bestStrategyOverall: TITLE_STRATEGIES.includes(String(parsed?.summary?.best_strategy_overall) as any) ? String(parsed.summary.best_strategy_overall) : 'keyword_front_loaded',
      biggestTitleIssue: String(parsed?.summary?.biggest_title_issue ?? '').slice(0, 200),
      quickestTitleWin: String(parsed?.summary?.quickest_title_win ?? '').slice(0, 200),
      titleGenerationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.title_generation_score ?? 60))),
    },
  };
}
