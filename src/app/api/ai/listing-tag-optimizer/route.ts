// v6.64 / v8.96.0-refactor: AI Listing Tag Optimizer — ML tag optimization z keyword research in search visibility
// Refaktoriran z withAiRoute helperjem (v8.96.0) + enforceBudget guard.
//
// POST /api/ai/listing-tag-optimizer
// Body: { tradeId?: string, listingId?: string }
// Returns: { ok, optimizer: { listings, tagAnalysis, keywordResearch, mlScoring, recommendations, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface ListingTagOptimizerInput {
  tradeId: string | null;
  listingId: string | undefined;
}

export const POST = withAiRoute<ListingTagOptimizerInput>({
  endpoint: '/api/ai/listing-tag-optimizer',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      tradeId: body?.tradeId ? String(body.tradeId) : null,
      listingId: body?.listingId ? String(body.listingId) : undefined,
    };
  },

  // No validateInput — oba polji opcijski (listingId je unused, preserved za backward-compat)

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, listingId } = input;
    void listingId; // backward-compat — v originalu destrukturiran vendar ne uporabljen

    let targetListings: TargetListing[] = [];

    if (tradeId) {
      const t = await db.trade.findUnique({ where: { id: tradeId }, select: { id: true, title: true, category: true, buyPrice: true, listing: { select: { description: true, detailDescription: true, price: true } } } });
      if (!t) throw new ApiRouteError('Trade ne obstaja', 404);
      targetListings = [{ id: t.id, title: t.title, category: t.category || 'drugo', price: t.listing?.price ?? t.buyPrice, description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 400) }];
    } else {
      const heldTrades = await db.trade.findMany({ where: { status: 'held' }, select: { id: true, title: true, category: true, buyPrice: true, listing: { select: { description: true, detailDescription: true, price: true } } }, take: 10, orderBy: { buyDate: 'desc' } });
      targetListings = heldTrades.map(t => ({ id: t.id, title: t.title, category: t.category || 'drugo', price: t.listing?.price ?? t.buyPrice, description: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 400) }));
    }

    if (targetListings.length === 0) return apiOk({ ok: true, optimizer: null, message: 'Ni listingov za tag optimizacijo.' });

    const prompt = buildPrompt(targetListings);
    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const optimizer = transformOptimizer(parsed, targetListings);

    return apiOk({ ok: true, optimizer });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface TargetListing {
  id: string;
  title: string;
  category: string;
  price: number;
  description: string;
}

function buildPrompt(targetListings: TargetListing[]): string {
  const itemsStr = targetListings.slice(0, 10).map(i => `- [${i.id}] "${i.title}" | ${i.category} | ${i.price}€`).join('\n');

  return `Si AI listing tag optimizer z ML keyword research in search visibility optimization.
Optimizira tag-e za maksimalno search visibility na Bolha/Facebook/Vinted.

OGLASI (${targetListings.length}):
${itemsStr}

Tag kategorije:
1. PRIMARY_TAGS: glavne ključne besede (brand, model)
2. SPECIFICATION_TAGS: specifikacije (velikost, barva, material)
3. CONDITION_TAGS: stanje (novo, rabljeno, odlično)
4. LOCATION_TAGS: lokacija (mesto, regija)
5. PRICE_TAGS: cenovni rang (budget, premium, luxury)
6. SEASONAL_TAGS: sezonske (poletje, zima, božič)
7. LONG_TAIL_TAGS: dolge ključne besede (specifične)
8. TRENDING_TAGS: trending keywords
9. COMPETITOR_TAGS: tagi ki jih uporabljajo competitorji
10. NICHE_TAGS: niche specifični tagi

ML scoring:
- SEARCH_VOLUME: iskalni volumen per tag
- COMPETITION: konkurenca per tag
- CLICK_THROUGH_RATE: predviden CTR per tag
- CONVERSION_RATE: predvidena konverzija per tag
- RELEVANCE_SCORE: relevantnost tag-a za item

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "listings": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "current_tag_count": <number>,
      "current_search_visibility_pct": <number 0-100>,
      "optimized_tags": [
        {
          "tag": "<max 50 znakov>",
          "tag_category": "<10 kategorij>",
          "search_volume": "<low|medium|high|very_high>",
          "competition": "<low|medium|high|very_high>",
          "relevance_score": <number 0-100>,
          "expected_ctr_pct": <number 0-100>,
          "expected_visibility_pct": <number 0-100>,
          "priority": "<high|medium|low>"
        }
      ],
      "optimized_tag_count": <number>,
      "optimized_search_visibility_pct": <number 0-100>,
      "visibility_improvement_pct": <number>,
      "tags_removed": ["<tag>"],
      "tags_added": ["<tag>"]
    }
  ],
  "tag_analysis": [
    { "tag_category": "<10 kategorij>", "description": "<max 100 znakov>", "avg_search_volume": "<low|medium|high|very_high>", "avg_relevance": <number 0-100>, "best_practice": "<max 120 znakov>" }
  ],
  "keyword_research": [
    { "keyword": "<max 60 znakov>", "search_volume": "<low|medium|high|very_high>", "competition": "<low|medium|high|very_high>", "difficulty_score": <number 0-100>, "opportunity_score": <number 0-100>, "trend": "<rising|stable|falling>" }
  ],
  "ml_scoring": [
    { "metric": "<search_volume|competition|click_through_rate|conversion_rate|relevance_score>", "weight": <number 0-100>, "description": "<max 100 znakov>", "benchmark": <number 0-100> }
  ],
  "recommendations": [
    { "action": "<max 150 znakov>", "priority": "<high|medium|low>", "expected_visibility_increase_pct": <number>, "listings_affected": <number> }
  ],
  "summary": {
    "total_listings_optimized": <number>,
    "avg_current_visibility_pct": <number>,
    "avg_optimized_visibility_pct": <number>,
    "avg_improvement_pct": <number>,
    "total_tags_generated": <number>,
    "best_tag_category": "<max 80 znakov>",
    "biggest_tag_issue": "<max 100 znakov>",
    "tag_optimization_score": <number 0-100>
  }
}`;
}

function transformOptimizer(parsed: any, targetListings: TargetListing[]) {
  const validIds = new Set(targetListings.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    listings: (parsed?.listings || []).filter((l: any) => validIds.has(String(l?.id ?? ''))).slice(0, 10).map((l: any) => {
      const orig = targetListings.find(x => x.id === String(l?.id));
      return {
        tradeId: String(l?.id ?? ''),
        title: String(l?.title ?? orig?.title ?? '').slice(0, 150),
        currentTagCount: Math.max(0, Number(l?.current_tag_count ?? 0)),
        currentSearchVisibilityPct: Math.max(0, Math.min(100, Number(l?.current_search_visibility_pct ?? 30))),
        optimizedTags: (l?.optimized_tags || []).slice(0, 15).map((t: any) => ({
          tag: String(t?.tag ?? '').slice(0, 80),
          tagCategory: ['primary', 'specification', 'condition', 'location', 'price', 'seasonal', 'long_tail', 'trending', 'competitor', 'niche'].includes(String(t?.tag_category)) ? String(t.tag_category) : 'primary',
          searchVolume: ['low', 'medium', 'high', 'very_high'].includes(String(t?.search_volume)) ? String(t.search_volume) : 'medium',
          competition: ['low', 'medium', 'high', 'very_high'].includes(String(t?.competition)) ? String(t.competition) : 'medium',
          relevanceScore: Math.max(0, Math.min(100, Number(t?.relevance_score ?? 50))),
          expectedCtrPct: Math.max(0, Math.min(100, Number(t?.expected_ctr_pct ?? 30))),
          expectedVisibilityPct: Math.max(0, Math.min(100, Number(t?.expected_visibility_pct ?? 50))),
          priority: ['high', 'medium', 'low'].includes(String(t?.priority)) ? String(t.priority) : 'medium',
        })),
        optimizedTagCount: Math.max(0, Number(l?.optimized_tag_count ?? 0)),
        optimizedSearchVisibilityPct: Math.max(0, Math.min(100, Number(l?.optimized_search_visibility_pct ?? 60))),
        visibilityImprovementPct: Math.round(Number(l?.visibility_improvement_pct ?? 0) * 10) / 10,
        tagsRemoved: (l?.tags_removed || []).slice(0, 10).map((t: any) => String(t).slice(0, 80)),
        tagsAdded: (l?.tags_added || []).slice(0, 15).map((t: any) => String(t).slice(0, 80)),
      };
    }),
    tagAnalysis: (parsed?.tag_analysis || []).slice(0, 10).map((a: any) => ({
      tagCategory: ['primary', 'specification', 'condition', 'location', 'price', 'seasonal', 'long_tail', 'trending', 'competitor', 'niche'].includes(String(a?.tag_category)) ? String(a.tag_category) : 'primary',
      description: String(a?.description ?? '').slice(0, 200),
      avgSearchVolume: ['low', 'medium', 'high', 'very_high'].includes(String(a?.avg_search_volume)) ? String(a.avg_search_volume) : 'medium',
      avgRelevance: Math.max(0, Math.min(100, Number(a?.avg_relevance ?? 50))),
      bestPractice: String(a?.best_practice ?? '').slice(0, 250),
    })),
    keywordResearch: (parsed?.keyword_research || []).slice(0, 20).map((k: any) => ({
      keyword: String(k?.keyword ?? '').slice(0, 100),
      searchVolume: ['low', 'medium', 'high', 'very_high'].includes(String(k?.search_volume)) ? String(k.search_volume) : 'medium',
      competition: ['low', 'medium', 'high', 'very_high'].includes(String(k?.competition)) ? String(k.competition) : 'medium',
      difficultyScore: Math.max(0, Math.min(100, Number(k?.difficulty_score ?? 50))),
      opportunityScore: Math.max(0, Math.min(100, Number(k?.opportunity_score ?? 50))),
      trend: ['rising', 'stable', 'falling'].includes(String(k?.trend)) ? String(k.trend) : 'stable',
    })),
    mlScoring: (parsed?.ml_scoring || []).slice(0, 5).map((m: any) => ({
      metric: ['search_volume', 'competition', 'click_through_rate', 'conversion_rate', 'relevance_score'].includes(String(m?.metric)) ? String(m.metric) : 'relevance_score',
      weight: Math.max(0, Math.min(100, Number(m?.weight ?? 20))),
      description: String(m?.description ?? '').slice(0, 200),
      benchmark: Math.max(0, Math.min(100, Number(m?.benchmark ?? 50))),
    })),
    recommendations: (parsed?.recommendations || []).slice(0, 6).map((r: any) => ({
      action: String(r?.action ?? '').slice(0, 300),
      priority: ['high', 'medium', 'low'].includes(String(r?.priority)) ? String(r.priority) : 'medium',
      expectedVisibilityIncreasePct: Math.round(Number(r?.expected_visibility_increase_pct ?? 0)),
      listingsAffected: Math.max(0, Number(r?.listings_affected ?? 0)),
    })),
    summary: {
      totalListingsOptimized: targetListings.length,
      avgCurrentVisibilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_current_visibility_pct ?? 30))),
      avgOptimizedVisibilityPct: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_optimized_visibility_pct ?? 60))),
      avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 30) * 10) / 10,
      totalTagsGenerated: Math.max(0, Number(parsed?.summary?.total_tags_generated ?? 0)),
      bestTagCategory: ['primary', 'specification', 'condition', 'location', 'price', 'seasonal', 'long_tail', 'trending', 'competitor', 'niche'].includes(String(parsed?.summary?.best_tag_category)) ? String(parsed.summary.best_tag_category) : 'primary',
      biggestTagIssue: String(parsed?.summary?.biggest_tag_issue ?? '').slice(0, 200),
      tagOptimizationScore: Math.max(0, Math.min(100, Number(parsed?.summary?.tag_optimization_score ?? 60))),
    },
  };
}
