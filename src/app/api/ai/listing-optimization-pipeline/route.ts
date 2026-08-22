// v6.57 / v8.96.2-batch3: AI Listing Optimization Pipeline — celovit pipeline za optimization oglasa (title→desc→price→images→timing)
// Refaktoriran z withAiRoute helperjem (v8.96.2-batch3) + enforceBudget guard.
//
// POST /api/ai/listing-optimization-pipeline
// Body: { tradeId?: string, platforms?: string[] }
// Returns: { ok, pipeline: { stages, items, optimizations, platformVersions, beforeAfter, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 120;

const PIPELINE_STAGES = [
  'analysis',          // analiza trenutnega oglasa
  'title_optimization',
  'description_optimization',
  'price_optimization',
  'image_optimization',
  'tag_optimization',
  'timing_optimization',
  'platform_adaptation',
  'final_review',
  'launch',
] as const;

interface ListingOptimizationPipelineInput {
  tradeId: string | null;
  platforms: string[];
}

export const POST = withAiRoute<ListingOptimizationPipelineInput>({
  endpoint: '/api/ai/listing-optimization-pipeline',
  maxDuration: 120,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId ? String(body.tradeId) : null;
    const platforms: string[] = Array.isArray(body?.platforms) ? body.platforms : ['bolha', 'facebook', 'vinted'];
    return { tradeId, platforms };
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { tradeId, platforms } = input;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiRisk: true, imageUrl: true, description: true, detailDescription: true, location: true, monitor: { select: { source: true } } } },
      },
      take: tradeId ? 1 : 10,
    });

    if (heldTrades.length === 0) {
      return apiOk({ ok: true, pipeline: null, message: 'Ni held tradeov za optimization pipeline.' });
    }

    const items = prepareItems(heldTrades);
    const prompt = buildPrompt(items, platforms);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const pipeline = transformPipeline(parsed, items, platforms);

    return apiOk({ ok: true, pipeline });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

interface PreparedItem {
  id: string;
  title: string;
  category: string;
  cost: number;
  estValue: number;
  daysHeld: number;
  currentTitle: string;
  currentDescription: string;
  currentPrice: number;
  imageUrl: string;
  location: string;
}

function prepareItems(
  heldTrades: Array<{
    id: string; title: string; category: string | null;
    buyPrice: number; buyFees: number | null; buyDate: Date;
    listing: {
      aiEstimatedValue: number | null; dealScore: number | null; aiRisk: number | null;
      imageUrl: string | null; description: string | null; detailDescription: string | null;
      location: string | null; monitor: { source: string } | null;
    } | null;
  }>,
): PreparedItem[] {
  return heldTrades.map(t => {
    const cost = t.buyPrice + (t.buyFees ?? 0);
    const estValue = t.listing?.aiEstimatedValue ?? Math.round(cost * 1.25);
    const daysHeld = Math.round((Date.now() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
    return {
      id: t.id, title: t.title, category: t.category || 'drugo',
      cost, estValue, daysHeld,
      currentTitle: t.title,
      currentDescription: (t.listing?.detailDescription || t.listing?.description || '').slice(0, 500),
      currentPrice: estValue,
      imageUrl: t.listing?.imageUrl ?? '',
      location: t.listing?.location || '',
    };
  });
}

function buildPrompt(items: PreparedItem[], platforms: string[]): string {
  const itemsStr = items.slice(0, 10).map(i =>
    `- [${i.id}] "${i.currentTitle}" | ${i.category} | ${i.cost}€→${i.currentPrice}€ | ${i.daysHeld}d | opis: ${i.currentDescription.slice(0, 100)}...`
  ).join('\n');

  return `Si AI listing optimization pipeline za slovenske oglasne platforme.
Celovit pipeline za optimization oglasa od analize do launch-a.

OGLASI ZA OPTIMIZACIJO (${items.length}):
${itemsStr}

PLATFORME: ${platforms.join(', ')}

10-fazni optimization pipeline:
1. ANALYSIS: analiza trenutnega oglasa (title, desc, price, images, tags)
2. TITLE_OPTIMIZATION: SEO naslov z ključnimi besedami, brand, specifikacije
3. DESCRIPTION_OPTIMIZATION: strukturiran opis z hook, spec, CTA
4. PRICE_OPTIMIZATION: psihološke cene, anchor, threshold
5. IMAGE_OPTIMIZATION: VLM analiza, suggested shots, editing
6. TAG_OPTIMIZATION: ključne besede za iskanje, long-tail
7. TIMING_OPTIMIZATION: optimalen dan in ura za objavo
8. PLATFORM_ADAPTATION: per-platforma naslov, opis, cena, jezik
9. FINAL_REVIEW: preveri vse skupaj, consistency check
10. LAUNCH: scheduling, multi-platform, monitoring plan

Optimization cilji:
- +50% views v 7 dneh
- +30% inquiries v 7 dneh
- +20% conversion rate
- -25% time to sale
- +15% final sale price

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "stages": [
    {
      "stage": "<10 faz>",
      "description": "<max 100 znakov>",
      "input_required": ["<max 60 znakov>"],
      "output_produced": ["<max 60 znakov>"],
      "optimization_score": <number 0-100>,
      "expected_impact_pct": <number>,
      "time_to_complete_minutes": <number>
    }
  ],
  "items": [
    {
      "id": "<trade_id>",
      "analysis": {
        "current_score": <number 0-100>,
        "title_score": <number 0-100>,
        "description_score": <number 0-100>,
        "price_score": <number 0-100>,
        "image_score": <number 0-100>,
        "tag_score": <number 0-100>,
        "overall_score": <number 0-100>,
        "issues_found": ["<max 80 znakov>"]
      },
      "optimizations": {
        "title": {"before": "<original>", "after": "<optimized>", "improvement_pct": <number>},
        "description": {"before": "<original 200c>", "after": "<optimized 500c>", "improvement_pct": <number>},
        "price": {"before_eur": <number>, "after_eur": <number>, "technique": "<technique>", "improvement_pct": <number>},
        "tags": {"before": ["<tag>"], "after": ["<tag>"], "improvement_pct": <number>},
        "timing": {"best_day": "<dan>", "best_hour": <number>, "reasoning": "<max 100 znakov>"}
      },
      "optimized_score": <number 0-100>,
      "expected_views_increase_pct": <number>,
      "expected_inquiries_increase_pct": <number>,
      "expected_conversion_increase_pct": <number>,
      "expected_sale_speedup_days": <number>
    }
  ],
  "optimizations": [
    {
      "category": "<title|description|price|image|tag|timing|platform>",
      "technique": "<max 80 znakov>",
      "description": "<max 120 znakov>",
      "expected_lift_pct": <number>,
      "implementation_effort": "<low|medium|high>",
      "best_for_category_items": "<max 80 znakov>"
    }
  ],
  "platform_versions": [
    {
      "platform": "<bolha|facebook|vinted|ebay|kleinanzeigen>",
      "title": "<platform-specific naslov>",
      "description": "<platform-specific opis 300c>",
      "price_eur": <number>,
      "tags": ["<tag>"],
      "language": "<sl|en|de>",
      "cta": "<max 80 znakov>",
      "expected_performance_score": <number 0-100>
    }
  ],
  "before_after": [
    {
      "trade_id": "<id>",
      "metric": "<views|inquiries|conversion_rate|time_to_sale|sale_price>",
      "before": <number>,
      "after": <number>,
      "change_pct": <number>,
      "confidence_pct": <number 0-100>
    }
  ],
  "summary": {
    "total_items_optimized": <number>,
    "avg_score_before": <number>,
    "avg_score_after": <number>,
    "avg_improvement_pct": <number>,
    "total_expected_views_increase_pct": <number>,
    "total_expected_revenue_increase_eur": <number>,
    "best_optimization_category": "<max 80 znakov>",
    "biggest_issue_found": "<max 100 znakov>",
    "pipeline_efficiency_score": <number 0-100>
  }
}`;
}

function transformPipeline(parsed: any, items: PreparedItem[], platforms: string[]): {
  insights: string;
  stages: any[];
  items: any[];
  optimizations: any[];
  platformVersions: any[];
  beforeAfter: any[];
  summary: any;
} {
  const validIds = new Set(items.map(i => i.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    stages: (parsed?.stages || []).slice(0, 10).map((s: any) => ({
      stage: PIPELINE_STAGES.includes(String(s?.stage) as any) ? String(s.stage) : 'analysis',
      description: String(s?.description ?? '').slice(0, 200),
      inputRequired: (s?.input_required || []).slice(0, 5).map((i: any) => String(i).slice(0, 100)),
      outputProduced: (s?.output_produced || []).slice(0, 5).map((o: any) => String(o).slice(0, 100)),
      optimizationScore: Math.max(0, Math.min(100, Number(s?.optimization_score ?? 50))),
      expectedImpactPct: Math.round(Number(s?.expected_impact_pct ?? 0)),
      timeToCompleteMinutes: Math.max(1, Number(s?.time_to_complete_minutes ?? 5)),
    })),
    items: (parsed?.items || [])
      .filter((it: any) => validIds.has(String(it?.id ?? '')))
      .slice(0, 10)
      .map((it: any) => {
        const orig = items.find(x => x.id === String(it?.id));
        return {
          tradeId: String(it?.id ?? ''),
          analysis: {
            currentScore: Math.max(0, Math.min(100, Number(it?.analysis?.current_score ?? 50))),
            titleScore: Math.max(0, Math.min(100, Number(it?.analysis?.title_score ?? 50))),
            descriptionScore: Math.max(0, Math.min(100, Number(it?.analysis?.description_score ?? 50))),
            priceScore: Math.max(0, Math.min(100, Number(it?.analysis?.price_score ?? 50))),
            imageScore: Math.max(0, Math.min(100, Number(it?.analysis?.image_score ?? 50))),
            tagScore: Math.max(0, Math.min(100, Number(it?.analysis?.tag_score ?? 50))),
            overallScore: Math.max(0, Math.min(100, Number(it?.analysis?.overall_score ?? 50))),
            issuesFound: (it?.analysis?.issues_found || []).slice(0, 6).map((i: any) => String(i).slice(0, 150)),
          },
          optimizations: {
            title: {
              before: String(it?.optimizations?.title?.before ?? orig?.currentTitle ?? '').slice(0, 200),
              after: String(it?.optimizations?.title?.after ?? '').slice(0, 200),
              improvementPct: Math.round(Number(it?.optimizations?.title?.improvement_pct ?? 0)),
            },
            description: {
              before: String(it?.optimizations?.description?.before ?? orig?.currentDescription.slice(0, 300) ?? '').slice(0, 500),
              after: String(it?.optimizations?.description?.after ?? '').slice(0, 800),
              improvementPct: Math.round(Number(it?.optimizations?.description?.improvement_pct ?? 0)),
            },
            price: {
              beforeEur: Math.max(0, Math.round(Number(it?.optimizations?.price?.before_eur ?? orig?.currentPrice ?? 0))),
              afterEur: Math.max(0, Math.round(Number(it?.optimizations?.price?.after_eur ?? 0))),
              technique: String(it?.optimizations?.price?.technique ?? '').slice(0, 100),
              improvementPct: Math.round(Number(it?.optimizations?.price?.improvement_pct ?? 0)),
            },
            tags: {
              before: (it?.optimizations?.tags?.before || []).slice(0, 8).map((t: any) => String(t).slice(0, 50)),
              after: (it?.optimizations?.tags?.after || []).slice(0, 12).map((t: any) => String(t).slice(0, 50)),
              improvementPct: Math.round(Number(it?.optimizations?.tags?.improvement_pct ?? 0)),
            },
            timing: {
              bestDay: ['pon', 'tor', 'sre', 'cet', 'pet', 'sob', 'ned'].includes(String(it?.optimizations?.timing?.best_day)) ? String(it.optimizations.timing.best_day) : 'pet',
              bestHour: Math.max(0, Math.min(23, Number(it?.optimizations?.timing?.best_hour ?? 18))),
              reasoning: String(it?.optimizations?.timing?.reasoning ?? '').slice(0, 200),
            },
          },
          optimizedScore: Math.max(0, Math.min(100, Number(it?.optimized_score ?? 70))),
          expectedViewsIncreasePct: Math.round(Number(it?.expected_views_increase_pct ?? 30)),
          expectedInquiriesIncreasePct: Math.round(Number(it?.expected_inquiries_increase_pct ?? 25)),
          expectedConversionIncreasePct: Math.round(Number(it?.expected_conversion_increase_pct ?? 20)),
          expectedSaleSpeedupDays: Math.round(Number(it?.expected_sale_speedup_days ?? 5)),
        };
      }),
    optimizations: (parsed?.optimizations || []).slice(0, 8).map((o: any) => ({
      category: ['title', 'description', 'price', 'image', 'tag', 'timing', 'platform'].includes(String(o?.category)) ? String(o.category) : 'title',
      technique: String(o?.technique ?? '').slice(0, 150),
      description: String(o?.description ?? '').slice(0, 250),
      expectedLiftPct: Math.round(Number(o?.expected_lift_pct ?? 0)),
      implementationEffort: ['low', 'medium', 'high'].includes(String(o?.implementation_effort)) ? String(o.implementation_effort) : 'medium',
      bestForCategoryItems: String(o?.best_for_category_items ?? '').slice(0, 150),
    })),
    platformVersions: (parsed?.platform_versions || [])
      .filter((p: any) => platforms.includes(String(p?.platform)))
      .slice(0, 5)
      .map((p: any) => ({
        platform: platforms.includes(String(p?.platform)) ? String(p.platform) : 'bolha',
        title: String(p?.title ?? '').slice(0, 120),
        description: String(p?.description ?? '').slice(0, 500),
        priceEur: Math.max(0, Math.round(Number(p?.price_eur ?? 0))),
        tags: (p?.tags || []).slice(0, 10).map((t: any) => String(t).slice(0, 50)),
        language: ['sl', 'en', 'de'].includes(String(p?.language)) ? String(p.language) : 'sl',
        cta: String(p?.cta ?? '').slice(0, 150),
        expectedPerformanceScore: Math.max(0, Math.min(100, Number(p?.expected_performance_score ?? 60))),
      })),
    beforeAfter: (parsed?.before_after || [])
      .filter((b: any) => validIds.has(String(b?.trade_id ?? '')))
      .slice(0, 15)
      .map((b: any) => ({
        tradeId: String(b?.trade_id ?? '').slice(0, 50),
        metric: ['views', 'inquiries', 'conversion_rate', 'time_to_sale', 'sale_price'].includes(String(b?.metric)) ? String(b.metric) : 'views',
        before: Math.round(Number(b?.before ?? 0) * 100) / 100,
        after: Math.round(Number(b?.after ?? 0) * 100) / 100,
        changePct: Math.round(Number(b?.change_pct ?? 0) * 10) / 10,
        confidencePct: Math.max(0, Math.min(100, Number(b?.confidence_pct ?? 50))),
      })),
    summary: {
      totalItemsOptimized: items.length,
      avgScoreBefore: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_score_before ?? 50))),
      avgScoreAfter: Math.max(0, Math.min(100, Number(parsed?.summary?.avg_score_after ?? 75))),
      avgImprovementPct: Math.round(Number(parsed?.summary?.avg_improvement_pct ?? 25) * 10) / 10,
      totalExpectedViewsIncreasePct: Math.round(Number(parsed?.summary?.total_expected_views_increase_pct ?? 30)),
      totalExpectedRevenueIncreaseEur: Math.round(Number(parsed?.summary?.total_expected_revenue_increase_eur ?? 0)),
      bestOptimizationCategory: ['title', 'description', 'price', 'image', 'tag', 'timing', 'platform'].includes(String(parsed?.summary?.best_optimization_category)) ? String(parsed.summary.best_optimization_category) : 'title',
      biggestIssueFound: String(parsed?.summary?.biggest_issue_found ?? '').slice(0, 200),
      pipelineEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.pipeline_efficiency_score ?? 60))),
    },
  };
}
