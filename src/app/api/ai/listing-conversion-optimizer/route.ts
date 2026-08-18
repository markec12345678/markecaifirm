// v6.61 / v8.94.6-c-refactor: AI Listing Conversion Optimizer — optimizira conversion rate z ML in multi-variate testing
// Refaktoriran z withAiRoute helperjem (v8.94) — boilerplate (try/catch, settings load,
// fallback provider, rate limit, JSON parse, AI counter increment) je izločen.
//
// POST /api/ai/listing-conversion-optimizer
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, optimizer: { listings, conversionFactors, optimizations, mvTests, mlPredictions, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiNotFound } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

const CONVERSION_FACTORS = [
  'price_competitiveness',
  'image_quality',
  'title_clarity',
  'description_completeness',
  'seller_reputation',
  'location_convenience',
  'shipping_options',
  'payment_methods',
  'response_speed',
  'trust_signals',
  'urgency_elements',
  'social_proof',
] as const;

const OPTIMIZATION_TYPES = [
  'price_adjustment', 'image_improvement', 'title_rewrite', 'description_enhancement',
  'urgency_addition', 'trust_building', 'response_optimization', 'shipping_expansion',
] as const;

const ML_MODELS = [
  'gradient_boosting', 'neural_network', 'logistic_regression', 'random_forest', 'xgboost',
] as const;

const PRIORITIES = ['high', 'medium', 'low'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;
const IMPROVEMENT_POTENTIALS = ['high', 'medium', 'low'] as const;
const CONSENSUS_LEVELS = ['strong', 'moderate', 'weak'] as const;
const VARIANT_IDS = ['a', 'b', 'c', 'd'] as const;
const PRIMARY_METRICS = ['conversion_rate', 'time_to_sale', 'revenue'] as const;

interface ListingConversionInput {
  tradeId?: string;
  listingId?: string;
}

interface TargetListing {
  id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  estValue: number;
  imageUrl: string;
  location: string;
}

export const POST = withAiRoute<ListingConversionInput>({
  endpoint: '/api/ai/listing-conversion-optimizer',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget + avtomatsko recordAiCall

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : undefined,
      listingId: body?.listingId ? String(body.listingId) : undefined,
    };
  },

  // No validateInput — vsi trije branch-i (tradeId / listingId / default) so veljavni

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, listingId } = input;

    let targetListings: TargetListing[] = [];

    if (tradeId) {
      const t = await db.trade.findUnique({
        where: { id: tradeId },
        select: {
          id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true, location: true, contactStatus: true } },
        },
      });
      if (!t) return apiNotFound('Trade ne obstaja');
      targetListings = [buildTargetFromTrade(t)];
    } else if (listingId) {
      const l = await db.listing.findUnique({
        where: { id: listingId },
        select: { id: true, title: true, description: true, detailDescription: true, price: true, imageUrl: true, aiEstimatedValue: true, location: true },
      });
      if (!l) return apiNotFound('Listing ne obstaja');
      targetListings = [buildTargetFromListing(l)];
    } else {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true, title: true, category: true, buyPrice: true,
          listing: { select: { description: true, detailDescription: true, imageUrl: true, aiEstimatedValue: true, price: true, location: true } },
        },
        take: 12,
        orderBy: { buyDate: 'desc' },
      });
      targetListings = heldTrades.map(buildTargetFromTrade);
    }

    if (targetListings.length === 0) {
      return apiOk({ ok: true, optimizer: null, message: 'Ni listingov za conversion optimizacijo.' });
    }

    const prompt = buildPrompt(targetListings);

    let raw: string;
    try {
      raw = await callAi(prompt);
    } catch {
      // callAi interno poskusi fallback provider; če tudi ta odpove, vrnemo prazno
      return apiOk({ ok: true, optimizer: null, message: 'AI ni na voljo za conversion optimizacijo.' });
    }

    const parsed: any = parseAi(raw);
    const validIds = new Set(targetListings.map(i => i.id));
    const optimizer = transformOptimizer(parsed, validIds, targetListings.length);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

function buildTargetFromTrade(t: {
  id: string; title: string; category: string | null; buyPrice: number;
  listing: { description: string | null; detailDescription: string | null; imageUrl: string | null; aiEstimatedValue: number | null; price: number | null; location: string | null } | null;
}): TargetListing {
  return {
    id: t.id,
    title: t.title,
    category: t.category || 'drugo',
    description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
    price: t.listing?.price ?? t.buyPrice,
    estValue: t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.25),
    imageUrl: t.listing?.imageUrl ?? '',
    location: t.listing?.location ?? '',
  };
}

function buildTargetFromListing(l: {
  id: string; title: string; description: string | null; detailDescription: string | null;
  price: number | null; imageUrl: string | null; aiEstimatedValue: number | null; location: string | null;
}): TargetListing {
  return {
    id: l.id,
    title: l.title,
    category: '',
    description: (l.detailDescription || l.description || '').slice(0, 500),
    price: l.price ?? 0,
    estValue: l.aiEstimatedValue ?? l.price ?? 0,
    imageUrl: l.imageUrl ?? '',
    location: l.location ?? '',
  };
}

function buildPrompt(targetListings: TargetListing[]): string {
  const itemsStr = targetListings.slice(0, 12).map(i =>
    `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | ${i.location} | opis: ${i.description.slice(0, 100)}...`
  ).join('\n');

  return `Si AI listing conversion optimizer z ML in multi-variate testing.
Optimizira conversion rate z 12-faktorsko analizo in A/B/n testiranjem.

OGLASI (${targetListings.length}):
${itemsStr}

12 conversion faktorjev:
1. PRICE_COMPETITIVENESS: cena glede na tržno povprečje
2. IMAGE_QUALITY: kakovost in število slik
3. TITLE_CLARITY: jasnost in informativnost naslova
4. DESCRIPTION_COMPLETENESS: popolnost opisa (specifikacije, stanje)
5. SELLER_REPUTATION: rating in reviews prodajalca
6. LOCATION_CONVENIENCE: primernost lokacije za kupca
7. SHIPPING_OPTIONS: raznolikost dostavnih opcij
8. PAYMENT_METHODS: raznolikost plačilnih metod
9. RESPONSE_SPEED: hitrost odgovora na povpraševanja
10. TRUST_SIGNALS: garancija, vračila, certifikati
11. URGENCY_ELEMENTS: časovna omejitev, redkost
12. SOCIAL_PROOF: število ogledov, like, priporočila

Multi-variate (A/B/n) testing:
- Testiraj več variant hkrati (title, price, image, description)
- Statistična signifikantnost (95% confidence)
- Sample size calculation
- Sequential testing (stop early if winner clear)

ML modeli:
- GRADIENT_BOOSTING: za conversion prediction
- NEURAL_NETWORK: za kompleksne interakcije
- LOGISTIC_REGRESSION: za interpretable baseline
- RANDOM_FOREST: za robust prediction
- XGBOOST: za high accuracy

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_conversion_rate_pct": <number 0-100>,
      "optimized_conversion_rate_pct": <number 0-100>,
      "conversion_lift_pct": <number>,
      "conversion_factors": [
        {"factor": "<12 faktorjev>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "impact_pct": <number>, "priority": "<high|medium|low>"}
      ],
      "ml_predictions": {
        "predicted_conversion_rate_pct": <number 0-100>,
        "predicted_time_to_sale_days": <number>,
        "predicted_final_price_eur": <number>,
        "confidence_pct": <number 0-100>,
        "model_consensus": "<strong|moderate|weak>"
      },
      "recommended_optimizations": [
        {"optimization": "<max 120 znakov>", "factor_targeted": "<12 faktorjev>", "expected_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "time_to_implement_hours": <number>}
      ],
      "expected_revenue_impact_eur": <number>,
      "priority": "<high|medium|low>"
    }
  ],
  "conversion_factors": [
    {"factor": "<12 faktorjev>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "improvement_potential": "<high|medium|low>", "best_practice": "<max 150 znakov>"}
  ],
  "optimizations": [
    {"optimization_type": "<price_adjustment|image_improvement|title_rewrite|description_enhancement|urgency_addition|trust_building|response_optimization|shipping_expansion>", "description": "<max 120 znakov>", "expected_conversion_lift_pct": <number>, "implementation_difficulty": "<low|medium|high>", "best_for_category": "<max 80 znakov>"}
  ],
  "mv_tests": [
    {
      "listing_id": "<trade_id>",
      "test_name": "<max 80 znakov>",
      "variants": [
        {"variant_id": "<a|b|c|d>", "change_description": "<max 100 znakov>", "predicted_conversion_pct": <number 0-100>}
      ],
      "test_duration_days": <number>,
      "sample_size_per_variant": <number>,
      "primary_metric": "<conversion_rate|time_to_sale|revenue>",
      "statistical_significance_pct": <number 0-100>,
      "expected_winner": "<a|b|c|d>",
      "confidence_level_pct": <number 0-100>
    }
  ],
  "ml_predictions": [
    {"model": "<gradient_boosting|neural_network|logistic_regression|random_forest|xgboost>", "accuracy_pct": <number 0-100>, "precision_pct": <number 0-100>, "recall_pct": <number 0-100>, "f1_score": <number 0-100>, "weight_in_ensemble": <number 0-100>, "best_for": "<max 80 znakov>"}
  ],
  "summary": {
    "total_listings_optimized": <number>,
    "avg_current_conversion_rate_pct": <number>,
    "avg_optimized_conversion_rate_pct": <number>,
    "avg_conversion_lift_pct": <number>,
    "total_expected_revenue_impact_eur": <number>,
    "biggest_conversion_blocker": "<max 100 znakov>",
    "biggest_conversion_opportunity": "<max 100 znakov>",
    "best_optimization_overall": "<max 80 znakov>",
    "conversion_optimization_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, validIds: Set<string>, totalListings: number) {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 12)
      .map((l: any) => ({
        tradeId: String(l?.id ?? ''),
        title: String(l?.title ?? '').slice(0, 150),
        currentConversionRatePct: clamp01to100(Number(l?.current_conversion_rate_pct ?? 10)),
        optimizedConversionRatePct: clamp01to100(Number(l?.optimized_conversion_rate_pct ?? 20)),
        conversionLiftPct: Math.round(Number(l?.conversion_lift_pct ?? 0) * 10) / 10,
        conversionFactors: (l?.conversion_factors || []).slice(0, 12).map((f: any) => ({
          factor: whitelist(String(f?.factor), CONVERSION_FACTORS, 'price_competitiveness'),
          currentScore: clamp01to100(Number(f?.current_score ?? 50)),
          optimizedScore: clamp01to100(Number(f?.optimized_score ?? 70)),
          impactPct: Math.round(Number(f?.impact_pct ?? 0) * 10) / 10,
          priority: whitelist(String(f?.priority), PRIORITIES, 'medium'),
        })),
        mlPredictions: {
          predictedConversionRatePct: clamp01to100(Number(l?.ml_predictions?.predicted_conversion_rate_pct ?? 15)),
          predictedTimeToSaleDays: Math.max(1, Math.round(Number(l?.ml_predictions?.predicted_time_to_sale_days ?? 14))),
          predictedFinalPriceEur: Math.max(0, Math.round(Number(l?.ml_predictions?.predicted_final_price_eur ?? 0))),
          confidencePct: clamp01to100(Number(l?.ml_predictions?.confidence_pct ?? 60)),
          modelConsensus: whitelist(String(l?.ml_predictions?.model_consensus), CONSENSUS_LEVELS, 'moderate'),
        },
        recommendedOptimizations: (l?.recommended_optimizations || []).slice(0, 6).map((o: any) => ({
          optimization: String(o?.optimization ?? '').slice(0, 250),
          factorTargeted: whitelist(String(o?.factor_targeted), CONVERSION_FACTORS, 'price_competitiveness'),
          expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)),
          implementationEffort: whitelist(String(o?.implementation_effort), EFFORTS, 'medium'),
          timeToImplementHours: Math.max(0.5, Number(o?.time_to_implement_hours ?? 1)),
        })),
        expectedRevenueImpactEur: Math.round(Number(l?.expected_revenue_impact_eur ?? 0)),
        priority: whitelist(String(l?.priority), PRIORITIES, 'medium'),
      })),
    conversionFactors: (parsed?.conversion_factors || []).slice(0, 12).map((f: any) => ({
      factor: whitelist(String(f?.factor), CONVERSION_FACTORS, 'price_competitiveness'),
      weight: clamp01to100(Number(f?.weight ?? 10)),
      avgScore: clamp01to100(Number(f?.avg_score ?? 50)),
      benchmark: clamp01to100(Number(f?.benchmark ?? 60)),
      improvementPotential: whitelist(String(f?.improvement_potential), IMPROVEMENT_POTENTIALS, 'medium'),
      bestPractice: String(f?.best_practice ?? '').slice(0, 300),
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 8).map((o: any) => ({
      optimizationType: whitelist(String(o?.optimization_type), OPTIMIZATION_TYPES, 'price_adjustment'),
      description: String(o?.description ?? '').slice(0, 250),
      expectedConversionLiftPct: Math.round(Number(o?.expected_conversion_lift_pct ?? 0)),
      implementationDifficulty: whitelist(String(o?.implementation_difficulty), EFFORTS, 'medium'),
      bestForCategory: String(o?.best_for_category ?? '').slice(0, 150),
    })),
    mvTests: (parsed?.mv_tests || [])
      .filter((t: any) => validIds.has(String(t?.listing_id ?? '')))
      .slice(0, 12)
      .map((t: any) => ({
        tradeId: String(t?.listing_id ?? '').slice(0, 50),
        testName: String(t?.test_name ?? '').slice(0, 150),
        variants: (t?.variants || []).slice(0, 4).map((v: any) => ({
          variantId: whitelist(String(v?.variant_id), VARIANT_IDS, 'a'),
          changeDescription: String(v?.change_description ?? '').slice(0, 200),
          predictedConversionPct: clamp01to100(Number(v?.predicted_conversion_pct ?? 10)),
        })),
        testDurationDays: Math.max(3, Math.min(30, Number(t?.test_duration_days ?? 7))),
        sampleSizePerVariant: Math.max(50, Number(t?.sample_size_per_variant ?? 100)),
        primaryMetric: whitelist(String(t?.primary_metric), PRIMARY_METRICS, 'conversion_rate'),
        statisticalSignificancePct: clamp01to100(Number(t?.statistical_significance_pct ?? 95)),
        expectedWinner: whitelist(String(t?.expected_winner), VARIANT_IDS, 'b'),
        confidenceLevelPct: clamp01to100(Number(t?.confidence_level_pct ?? 95)),
      })),
    mlPredictions: (parsed?.ml_predictions || []).slice(0, 5).map((m: any) => ({
      model: whitelist(String(m?.model), ML_MODELS, 'gradient_boosting'),
      accuracyPct: clamp01to100(Number(m?.accuracy_pct ?? 75)),
      precisionPct: clamp01to100(Number(m?.precision_pct ?? 70)),
      recallPct: clamp01to100(Number(m?.recall_pct ?? 65)),
      f1Score: clamp01to100(Number(m?.f1_score ?? 67)),
      weightInEnsemble: clamp01to100(Number(m?.weight_in_ensemble ?? 20)),
      bestFor: String(m?.best_for ?? '').slice(0, 150),
    })),
    summary: {
      totalListingsOptimized: totalListings,
      avgCurrentConversionRatePct: clamp01to100(Number(parsed?.summary?.avg_current_conversion_rate_pct ?? 10)),
      avgOptimizedConversionRatePct: clamp01to100(Number(parsed?.summary?.avg_optimized_conversion_rate_pct ?? 20)),
      avgConversionLiftPct: Math.round(Number(parsed?.summary?.avg_conversion_lift_pct ?? 50) * 10) / 10,
      totalExpectedRevenueImpactEur: Math.round(Number(parsed?.summary?.total_expected_revenue_impact_eur ?? 0)),
      biggestConversionBlocker: String(parsed?.summary?.biggest_conversion_blocker ?? '').slice(0, 200),
      biggestConversionOpportunity: String(parsed?.summary?.biggest_conversion_opportunity ?? '').slice(0, 200),
      bestOptimizationOverall: whitelist(String(parsed?.summary?.best_optimization_overall), OPTIMIZATION_TYPES, 'price_adjustment'),
      conversionOptimizationScore: clamp01to100(Number(parsed?.summary?.conversion_optimization_score ?? 60)),
    },
  };
}

function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function whitelist<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
