// v6.77 / v8.94.7-f-refactor: AI Listing Social Proof Optimizer — ML optimizacija social proof elementov z trust building
// Refaktoriran z withAiRoute helperjem (v8.94) — boilerplate (try/catch, settings load,
// fallback provider, rate limit, JSON parse, AI counter increment) je izločen v helper.
// enforceBudget: true — helper avtomatsko recordAiCall PO uspešnem klicu.
//
// POST /api/ai/listing-social-proof-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listings, proofElements, trustSignals, optimizations, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const PROOF_TYPES = [
  'testimonials', 'review_count', 'seller_rating', 'sales_history', 'social_mentions',
  'view_count', 'saved_count', 'shared_count', 'repeat_buyers', 'certification_badges',
] as const;

const VALID_TRUST_LEVELS = ['low', 'medium', 'high', 'very_high'] as const;
const VALID_PRIORITIES = ['high', 'medium', 'low'] as const;
const VALID_DIFFICULTIES = ['low', 'medium', 'high'] as const;
const VALID_SIGNAL_TYPES = [
  'authority', 'consensus', 'scarcity', 'reciprocity', 'commitment', 'liking',
] as const;
const VALID_OPTIMIZATION_TYPES = [
  'testimonial_addition', 'review_request', 'badge_display', 'history_highlight',
  'social_integration', 'view_counter', 'save_prompt', 'share_incentive',
  'loyalty_display', 'certification_showcase',
] as const;
const VALID_ML_MODELS = [
  'gradient_boosting', 'neural_network', 'random_forest', 'deep_learning', 'ensemble',
] as const;
const VALID_PREDICTION_TYPES = [
  'trust_score', 'conversion_probability', 'engagement_lift', 'proof_effectiveness',
] as const;

interface SocialProofInput {
  tradeId?: string;
}

export const POST = withAiRoute<SocialProofInput>({
  endpoint: '/api/ai/listing-social-proof-optimizer',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return { tradeId: body?.tradeId ? String(body.tradeId) : undefined };
  },

  // No validateInput — tradeId je opcijski (če manjka, vzamemo 15 held trade-ov)

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
            aiEstimatedValue: true, price: true, description: true, detailDescription: true,
            sellerName: true, sellerListingCount: true, location: true,
          },
        },
      },
      take: tradeId ? 1 : 15,
    });

    if (heldTrades.length === 0) {
      return apiOk({
        ok: true,
        optimizer: null,
        message: 'Ni held tradeov za social proof optimizacijo.',
      });
    }

    const items = buildItems(heldTrades);
    const prompt = buildPrompt(items);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const optimizer = transformOptimizer(parsed, items);

    // (AI counter increment obravnava helper preko enforceBudget: true → recordAiCall)
    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) ---------------------------------

interface ItemInfo {
  id: string;
  title: string;
  category: string;
  price: number;
  sellerName: string;
  sellerListingCount: number;
  description: string;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    description: string | null;
    detailDescription: string | null;
    sellerName: string | null;
    sellerListingCount: number | null;
    location: string | null;
  } | null;
}

/** Zgradi listo ItemInfo iz held trade-ov (select IDENTIČEN originalu). */
function buildItems(heldTrades: HeldTradeRow[]): ItemInfo[] {
  return heldTrades.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category || 'drugo',
    price: t.listing?.price ?? Math.round(t.buyPrice * 1.25),
    sellerName: t.listing?.sellerName ?? '',
    sellerListingCount: t.listing?.sellerListingCount ?? 0,
    description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 200),
  }));
}

/** Zgradi AI prompt (besedilo IDENTIČNO originalu — slovenski kontekst, JSON schema). */
function buildPrompt(items: ItemInfo[]): string {
  const itemsStr = items
    .slice(0, 15)
    .map(
      (i) =>
        `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€ | seller: ${i.sellerName || 'nepoznan'} (${i.sellerListingCount} listingov)`
    )
    .join('\n');

  return `Si AI listing social proof optimizer z ML in trust building.
Optimizira social proof elemente za večje zaupanje in konverzijo.

OGLASI (${items.length}):
${itemsStr}

10 social proof tipov:
1. TESTIMONIALS: pričevanja zadovoljnih kupcev
2. REVIEW_COUNT: število review-ov
3. SELLER_RATING: rating prodajalca
4. SALES_HISTORY: zgodovina prodaj
5. SOCIAL_MENTIONS: omenjanja na socialnih medijih
6. VIEW_COUNT: število ogledov
7. SAVED_COUNT: število shranitev
8. SHARED_COUNT: število deljenj
9. REPEAT_BUYERS: ponavljajoči kupci
10. CERTIFICATION_BADGES: certifikati in značke

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    { "id": "<trade_id>", "title": "<naslov>", "current_social_proof_score": <number 0-100>, "optimized_social_proof_score": <number 0-100>, "proof_elements": [{"proof_type": "<10 tipov>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "available": <boolean>, "implementation": "<max 120 znakov>"}], "trust_level": "<low|medium|high|very_high>", "recommended_proof_additions": ["<max 100 znakov>"], "expected_trust_increase_pct": <number>, "expected_conversion_increase_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "proofElements": [
    { "proof_type": "<10 tipov>", "weight": <number 0-100>, "avg_score": <number 0-100>, "benchmark": <number 0-100>, "implementation_difficulty": "<low|medium|high>", "best_practice": "<max 120 znakov>", "example_implementation": "<max 150 znakov>" }
  ],
  "trustSignals": [
    { "signal": "<max 80 znakov>", "signal_type": "<authority|consensus|scarcity|reciprocity|commitment|liking>", "impact_on_trust_pct": <number 0-100>, "implementation_cost_eur": <number>, "expected_conversion_lift_pct": <number>, "priority": "<high|medium|low>" }
  ],
  "optimizations": [
    { "optimization_type": "<testimonial_addition|review_request|badge_display|history_highlight|social_integration|view_counter|save_prompt|share_incentive|loyalty_display|certification_showcase>", "description": "<max 120 znakov>", "expected_trust_lift_pct": <number>, "expected_conversion_lift_pct": <number>, "implementation_effort": "<low|medium|high>", "timeframe_hours": <number> }
  ],
  "mlModels": [
    { "model": "<gradient_boosting|neural_network|random_forest|deep_learning|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<trust_score|conversion_probability|engagement_lift|proof_effectiveness>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "total_listings_analyzed": <number>, "avg_current_proof_score": <number>, "avg_optimized_proof_score": <number>,
    "biggest_proof_gap": "<max 100 znakov>", "quickest_proof_win": "<max 100 znakov>",
    "best_proof_type": "<10 tipov>", "social_proof_optimization_score": <number 0-100>
  }
}`;
}

/** Transformiraj AI JSON v optimizer objekt (validacija + slice + clamp). */
function transformOptimizer(parsed: any, items: ItemInfo[]) {
  const validIds = new Set(items.map((i) => i.id));
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || [])
      .filter((l: any) => validIds.has(String(l?.id ?? '')))
      .slice(0, 15)
      .map((l: any) => ({
        tradeId: String(l?.id ?? ''),
        title: String(l?.title ?? '').slice(0, 150),
        currentSocialProofScore: clampInt(Number(l?.current_social_proof_score ?? 30), 0, 100),
        optimizedSocialProofScore: clampInt(Number(l?.optimized_social_proof_score ?? 65), 0, 100),
        proofElements: (l?.proof_elements || []).slice(0, 10).map((p: any) => ({
          proofType: (PROOF_TYPES as readonly string[]).includes(String(p?.proof_type))
            ? String(p.proof_type) : 'testimonials',
          currentScore: clampInt(Number(p?.current_score ?? 30), 0, 100),
          optimizedScore: clampInt(Number(p?.optimized_score ?? 60), 0, 100),
          available: Boolean(p?.available ?? false),
          implementation: String(p?.implementation ?? '').slice(0, 250),
        })),
        trustLevel: (VALID_TRUST_LEVELS as readonly string[]).includes(String(l?.trust_level))
          ? String(l.trust_level) : 'medium',
        recommendedProofAdditions: (l?.recommended_proof_additions || [])
          .slice(0, 5)
          .map((r: any) => String(r).slice(0, 200)),
        expectedTrustIncreasePct: Math.round(Number(l?.expected_trust_increase_pct ?? 0) * 10) / 10,
        expectedConversionIncreasePct: Math.round(Number(l?.expected_conversion_increase_pct ?? 0) * 10) / 10,
        priority: (VALID_PRIORITIES as readonly string[]).includes(String(l?.priority))
          ? String(l.priority) : 'medium',
      })),
    proofElements: (parsed?.proofElements || []).slice(0, 10).map((p: any) => ({
      proofType: (PROOF_TYPES as readonly string[]).includes(String(p?.proof_type))
        ? String(p.proof_type) : 'testimonials',
      weight: clampInt(Number(p?.weight ?? 10), 0, 100),
      avgScore: clampInt(Number(p?.avg_score ?? 30), 0, 100),
      benchmark: clampInt(Number(p?.benchmark ?? 50), 0, 100),
      implementationDifficulty: (VALID_DIFFICULTIES as readonly string[]).includes(String(p?.implementation_difficulty))
        ? String(p.implementation_difficulty) : 'medium',
      bestPractice: String(p?.best_practice ?? '').slice(0, 250),
      exampleImplementation: String(p?.example_implementation ?? '').slice(0, 300),
    })),
    trustSignals: (parsed?.trustSignals || []).slice(0, 10).map((t: any) => ({
      signal: String(t?.signal ?? '').slice(0, 150),
      signalType: (VALID_SIGNAL_TYPES as readonly string[]).includes(String(t?.signal_type))
        ? String(t.signal_type) : 'authority',
      impactOnTrustPct: clampInt(Number(t?.impact_on_trust_pct ?? 50), 0, 100),
      implementationCostEur: Math.round(Number(t?.implementation_cost_eur ?? 0)),
      expectedConversionLiftPct: Math.round(Number(t?.expected_conversion_lift_pct ?? 0) * 10) / 10,
      priority: (VALID_PRIORITIES as readonly string[]).includes(String(t?.priority))
        ? String(t.priority) : 'medium',
    })),
    optimizations: (parsed?.optimizations || []).slice(0, 10).map((o: any) => ({
      optimizationType: (VALID_OPTIMIZATION_TYPES as readonly string[]).includes(String(o?.optimization_type))
        ? String(o.optimization_type) : 'testimonial_addition',
      description: String(o?.description ?? '').slice(0, 250),
      expectedTrustLiftPct: Math.round(Number(o?.expected_trust_lift_pct ?? 0) * 10) / 10,
      expectedConversionLiftPct: Math.round(Number(o?.expected_conversion_lift_pct ?? 0) * 10) / 10,
      implementationEffort: (VALID_DIFFICULTIES as readonly string[]).includes(String(o?.implementation_effort))
        ? String(o.implementation_effort) : 'low',
      timeframeHours: Math.max(0.5, Number(o?.timeframe_hours ?? 1)),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: (VALID_ML_MODELS as readonly string[]).includes(String(m?.model))
        ? String(m.model) : 'ensemble',
      accuracyPct: clampInt(Number(m?.accuracy_pct ?? 75), 0, 100),
      predictionType: (VALID_PREDICTION_TYPES as readonly string[]).includes(String(m?.prediction_type))
        ? String(m.prediction_type) : 'trust_score',
      weightInEnsemble: clampInt(Number(m?.weight_in_ensemble ?? 20), 0, 100),
    })),
    summary: {
      totalListingsAnalyzed: items.length,
      avgCurrentProofScore: clampInt(Number(parsed?.summary?.avg_current_proof_score ?? 30), 0, 100),
      avgOptimizedProofScore: clampInt(Number(parsed?.summary?.avg_optimized_proof_score ?? 65), 0, 100),
      biggestProofGap: String(parsed?.summary?.biggest_proof_gap ?? '').slice(0, 200),
      quickestProofWin: String(parsed?.summary?.quickest_proof_win ?? '').slice(0, 200),
      bestProofType: (PROOF_TYPES as readonly string[]).includes(String(parsed?.summary?.best_proof_type))
        ? String(parsed.summary.best_proof_type) : 'testimonials',
      socialProofOptimizationScore: clampInt(
        Number(parsed?.summary?.social_proof_optimization_score ?? 60), 0, 100
      ),
    },
  };
}

/** Clamp števila v [min, max]; non-finite → min. */
function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
