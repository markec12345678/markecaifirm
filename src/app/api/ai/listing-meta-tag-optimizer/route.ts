// v6.82 / v8.95.5-listing: AI Listing Meta Tag Optimizer — ML optimizacija meta tagov za oglase z SEO
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// POST /api/ai/listing-meta-tag-optimizer
// Body: { tradeId?: string }
// Returns: { ok, optimizer: { listing, metaTags, seoScore, optimization, mlModels, summary } | null }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

const META_TAG_TYPES = ['title', 'description', 'keywords', 'og_title', 'og_description', 'og_image_alt', 'twitter_card', 'canonical', 'schema_markup', 'robots'] as const;
const SEO_FACTORS = ['keyword_density', 'title_length', 'description_length', 'readability', 'keyword_relevance', 'search_intent_match', 'competitor_alignment', 'click_through_predictor', 'serp_position_predictor', 'mobile_optimization'] as const;

interface ListingMetaTagOptimizerInput {
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
  description: string;
}

interface TargetContext {
  title: string;
  category: string;
  buyPrice: number;
  buyLocation: string;
  suggestedPrice: number;
  description: string;
}

export const POST = withAiRoute<ListingMetaTagOptimizerInput>({
  endpoint: '/api/ai/listing-meta-tag-optimizer',
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
      return apiOk({ ok: true, optimizer: null, message: 'Ni aktivnih oglasov za meta tag analizo.' });
    }

    const target = heldTrades.find(t => t.id === tradeId) ?? heldTrades[0];
    const targetListing: TargetListingRow | null = target.listingId
      ? await db.listing.findUnique({ where: { id: target.listingId }, select: { aiEstimatedValue: true, aiRisk: true, url: true, description: true } })
      : null;
    const suggestedPrice = targetListing?.aiEstimatedValue ?? Math.round(target.buyPrice * 1.25);

    const description = (target.notes || targetListing?.description || '').slice(0, 300);

    const prompt = buildPrompt({
      title: target.title,
      category: target.category,
      buyPrice: target.buyPrice,
      buyLocation: target.buyLocation,
      suggestedPrice,
      description,
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
  return `Si AI listing meta tag optimizer z ML in NLP za SEO optimizacijo.
Optimizira meta tagove za oglase z 10 tipi in 10 SEO faktorji.

CILJNI OGLAS:
- Naslov: ${ctx.title}
- Kategorija: ${ctx.category}
- Nabavna cena: ${ctx.buyPrice}€
- Predlagana cena: ${ctx.suggestedPrice}€
- Kupljeno pri: ${ctx.buyLocation}
- Opis: ${ctx.description || 'brez'}

10 tipov meta tagov:
1. TITLE: naslov strani (50-60 chars)
2. DESCRIPTION: opis (150-160 chars)
3. KEYWORDS: ključne besede
4. OG_TITLE: Open Graph naslov
5. OG_DESCRIPTION: Open Graph opis
6. OG_IMAGE_ALT: alt tekst slike
7. TWITTER_CARD: Twitter card tip
8. CANONICAL: canonical URL
9. SCHEMA_MARKUP: structured data
10. ROBOTS: robots direktive

10 SEO faktorjev: keyword_density, title_length, description_length, readability, keyword_relevance, search_intent_match, competitor_alignment, click_through_predictor, serp_position_predictor, mobile_optimization

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listing": { "title": "<string>", "category": "<string>", "current_seo_score": <number 0-100>, "predicted_serp_position": <number 1-100>, "current_click_through_pct": <number 0-100>, "optimized_click_through_pct": <number 0-100>, "meta_tag_grade": "<A|B|C|D|F>" },
  "metaTags": [
    { "tag_type": "<${META_TAG_TYPES.join('|')}>", "current_value": "<max 200 znakov>", "optimized_value": "<max 200 znakov>", "character_count": <number>, "optimal_length": <number>, "length_status": "<optimal|too_short|too_long>", "improvement_pct": <number 0-50> }
  ],
  "seoScore": [
    { "factor": "<${SEO_FACTORS.join('|')}>", "current_score": <number 0-100>, "optimized_score": <number 0-100>, "weight_pct": <number 0-100>, "improvement_pct": <number 0-50>, "recommendation": "<max 120 znakov>" }
  ],
  "optimization": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_seo_lift_pct": <number 0-50>, "expected_traffic_lift_pct": <number 0-100>, "implementation_difficulty": "<easy|medium|hard>", "time_to_impact_days": <number> }
  ],
  "mlModels": [
    { "model": "<bert|t5|roberta|distilbert|ensemble>", "accuracy_pct": <number 0-100>, "prediction_type": "<serp_prediction|ctr_prediction|keyword_extraction|content_optimization>", "weight_in_ensemble": <number 0-100> }
  ],
  "summary": {
    "meta_tag_optimization_score": <number 0-100>, "meta_tag_grade": "<A|B|C|D|F>", "current_seo_score": <number 0-100>,
    "optimized_seo_score": <number 0-100>, "expected_traffic_lift_pct": <number 0-100>,
    "biggest_seo_risk": "<max 100 znakov>", "biggest_seo_opportunity": "<max 100 znakov>",
    "quickest_seo_win": "<max 100 znakov>", "meta_tag_analysis_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, target: { title: string; category: string }): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listing: {
      title: String(parsed?.listing?.title ?? target.title).slice(0, 200),
      category: String(parsed?.listing?.category ?? target.category).slice(0, 50),
      currentSeoScore: Math.max(0, Math.min(100, Number(parsed?.listing?.current_seo_score ?? 50))),
      predictedSerpPosition: Math.max(1, Math.min(100, Number(parsed?.listing?.predicted_serp_position ?? 50))),
      currentClickThroughPct: Math.max(0, Math.min(100, Number(parsed?.listing?.current_click_through_pct ?? 5))),
      optimizedClickThroughPct: Math.max(0, Math.min(100, Number(parsed?.listing?.optimized_click_through_pct ?? 8))),
      metaTagGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.listing?.meta_tag_grade)) ? String(parsed.listing.meta_tag_grade) : 'C',
    },
    metaTags: (parsed?.metaTags || []).slice(0, 10).map((m: any) => ({
      tagType: includes(META_TAG_TYPES, String(m?.tag_type)) ? String(m.tag_type) : 'title',
      currentValue: String(m?.current_value ?? '').slice(0, 400),
      optimizedValue: String(m?.optimized_value ?? '').slice(0, 400),
      characterCount: Math.max(0, Number(m?.character_count ?? 0)),
      optimalLength: Math.max(0, Number(m?.optimal_length ?? 60)),
      lengthStatus: ['optimal', 'too_short', 'too_long'].includes(String(m?.length_status)) ? String(m.length_status) : 'optimal',
      improvementPct: Math.max(0, Math.min(50, Number(m?.improvement_pct ?? 0))),
    })),
    seoScore: (parsed?.seoScore || []).slice(0, 10).map((s: any) => ({
      factor: includes(SEO_FACTORS, String(s?.factor)) ? String(s.factor) : 'keyword_density',
      currentScore: Math.max(0, Math.min(100, Number(s?.current_score ?? 50))),
      optimizedScore: Math.max(0, Math.min(100, Number(s?.optimized_score ?? 70))),
      weightPct: Math.max(0, Math.min(100, Number(s?.weight_pct ?? 10))),
      improvementPct: Math.max(0, Math.min(50, Number(s?.improvement_pct ?? 0))),
      recommendation: String(s?.recommendation ?? '').slice(0, 250),
    })),
    optimization: (parsed?.optimization || []).slice(0, 8).map((o: any) => ({
      action: String(o?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(o?.priority)) ? String(o.priority) : 'medium',
      expectedSeoLiftPct: Math.max(0, Math.min(50, Number(o?.expected_seo_lift_pct ?? 10))),
      expectedTrafficLiftPct: Math.max(0, Math.min(100, Number(o?.expected_traffic_lift_pct ?? 20))),
      implementationDifficulty: ['easy', 'medium', 'hard'].includes(String(o?.implementation_difficulty)) ? String(o.implementation_difficulty) : 'medium',
      timeToImpactDays: Math.max(1, Number(o?.time_to_impact_days ?? 14)),
    })),
    mlModels: (parsed?.mlModels || []).slice(0, 5).map((m: any) => ({
      model: ['bert', 't5', 'roberta', 'distilbert', 'ensemble'].includes(String(m?.model)) ? String(m.model) : 'ensemble',
      accuracyPct: Math.max(0, Math.min(100, Number(m?.accuracy_pct ?? 75))),
      predictionType: ['serp_prediction', 'ctr_prediction', 'keyword_extraction', 'content_optimization'].includes(String(m?.prediction_type)) ? String(m.prediction_type) : 'serp_prediction',
      weightInEnsemble: Math.max(0, Math.min(100, Number(m?.weight_in_ensemble ?? 20))),
    })),
    summary: {
      metaTagOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.meta_tag_optimization_score ?? 50))),
      metaTagGrade: ['A', 'B', 'C', 'D', 'F'].includes(String(parsed?.summary?.meta_tag_grade)) ? String(parsed.summary.meta_tag_grade) : 'C',
      currentSeoScore: Math.max(0, Math.min(100, Number(parsed?.summary?.current_seo_score ?? 50))),
      optimizedSeoScore: Math.max(0, Math.min(100, Number(parsed?.summary?.optimized_seo_score ?? 70))),
      expectedTrafficLiftPct: Math.max(0, Math.min(100, Number(parsed?.summary?.expected_traffic_lift_pct ?? 20))),
      biggestSeoRisk: String(parsed?.summary?.biggest_seo_risk ?? '').slice(0, 200),
      biggestSeoOpportunity: String(parsed?.summary?.biggest_seo_opportunity ?? '').slice(0, 200),
      quickestSeoWin: String(parsed?.summary?.quickest_seo_win ?? '').slice(0, 200),
      metaTagAnalysisScore: Math.max(0, Math.min(100, Number(parsed?.summary?.meta_tag_analysis_score ?? 50))),
    },
  };
}
