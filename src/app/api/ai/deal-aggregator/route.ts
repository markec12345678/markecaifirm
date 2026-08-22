// v6.44 / v8.95.5-other: AI Multi-Source Deal Aggregator — agregira najboljše priložnosti iz vseh virov.
// Refaktoriran z withAiRoute helperjem (v8.95.5-other) + enforceBudget guard.
//
// POST /api/ai/deal-aggregator
// Body: { minDealScore?: number, maxPrice?: number, category?: string }
// Returns: { ok, aggregator: { deals: [], bySource, topPicks, trending, summary } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface Input {
  minDealScore: number;
  maxPrice: number;
  category: string;
}

interface ListingRow {
  id: string;
  title: string;
  price: number | null;
  aiVerdict: string | null;
  aiScore: number | null;
  aiRisk: number | null;
  dealScore: number | null;
  dealScoreReason: string | null;
  aiEstimatedValue: number | null;
  firstSeenAt: Date;
  location: string | null;
  monitor: { source: string | null; name: string | null } | null;
}

const OPPORTUNITY_RATES = ['high', 'medium', 'low'] as const;
const URGENCIES = ['high', 'medium', 'low'] as const;
const TRENDS = ['rising', 'stable', 'falling'] as const;
const ACTIONS = ['buy_more', 'monitor', 'avoid'] as const;

function includes<T extends string>(arr: ReadonlyArray<T>, v: string): v is T {
  return (arr as ReadonlyArray<string>).includes(v);
}

export const POST = withAiRoute<Input>({
  endpoint: '/api/ai/deal-aggregator',
  maxDuration: 90,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      minDealScore: Math.max(0, Math.min(100, Number(body?.minDealScore) || 60)),
      maxPrice: Number(body?.maxPrice) || 0,
      category: String(body?.category || '').trim(),
    };
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { minDealScore, maxPrice, category: _category } = input;
    // Note: category filter se NE aplicira na query (original koda ne filtrira po category);
    // se samo posreduje nazaj v response. Zadržujemo _category da TypeScript ne pritoži.
    void _category;

    const recentListings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        dealScore: { gte: minDealScore },
        ...(maxPrice > 0 ? { price: { lte: maxPrice } } : {}),
      },
      select: { id: true, title: true, price: true, aiVerdict: true, aiScore: true, aiRisk: true,
        dealScore: true, dealScoreReason: true, aiEstimatedValue: true, firstSeenAt: true, location: true,
        monitor: { select: { source: true, name: true } } },
      take: 200,
      orderBy: { dealScore: 'desc' },
    });

    if (recentListings.length === 0) {
      return apiOk({ ok: true, aggregator: null, message: 'Ni priložnosti z deal score >= ' + minDealScore });
    }

    // Group by source
    const bySource = groupBySource(recentListings);
    const dealsStr = formatDealsStr(recentListings);
    const sourceStr = formatSourceStr(bySource);
    const prompt = buildPrompt(recentListings.length, minDealScore, sourceStr, dealsStr);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const aggregator = transformAggregator(parsed, recentListings);

    return apiOk({ ok: true, aggregator, minDealScore });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function groupBySource(listings: ListingRow[]): Record<string, ListingRow[]> {
  const bySource: Record<string, ListingRow[]> = {};
  for (const l of listings) {
    const s = l.monitor?.source || 'neznan';
    if (!bySource[s]) bySource[s] = [];
    bySource[s].push(l);
  }
  return bySource;
}

function formatDealsStr(listings: ListingRow[]): string {
  return listings.slice(0, 30).map(l => {
    const discount = l.aiEstimatedValue && l.price ? Math.round(((l.aiEstimatedValue - l.price) / l.aiEstimatedValue) * 100) : 0;
    return `- [${l.id}] ${l.title} | ${l.monitor?.source} | ${l.price}€ (est ${l.aiEstimatedValue ?? '?'}€, -${discount}%) | deal ${l.dealScore}/100 | risk ${l.aiRisk ?? '?'}/10 | ${l.location}`;
  }).join('\n');
}

function formatSourceStr(bySource: Record<string, ListingRow[]>): string {
  return Object.entries(bySource).map(([src, items]) => `- ${src}: ${items.length} priložnosti, povp. deal ${Math.round(items.reduce((s, i) => s + (i.dealScore ?? 0), 0) / items.length)}`).join('\n');
}

function buildPrompt(totalCount: number, minDealScore: number, sourceStr: string, dealsStr: string): string {
  return `Si AI multi-source deal aggregator. Agregiraj in rangiraj najboljše priložnosti iz vseh virov.

SKUPno: ${totalCount} priložnosti (deal score >= ${minDealScore})

PODATKI PO VIRIH:
${sourceStr}

TOP 30 PRILIŽNOSTI:
${dealsStr}

Agregacijska pravila:
1. RANGIRAJ po: deal score, discount %, AI risk (inverzno), est. profit
2. FILTRIRAJ: AI risk <= 5, verdict = PRILIKA
3. GRUPIRAJ po kategorijah za diverzifikacijo
4. IDENTIFICIRAJ "deal of the day" (najvišji deal score)
5. TRENDING: kategorije z več priložnostmi = trend

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "deals": [
    {
      "id": "<listing_id>",
      "title": "<naslov>",
      "source": "<vir>",
      "price_eur": <number>,
      "est_value_eur": <number>,
      "discount_pct": <number>,
      "deal_score": <number>,
      "ai_risk": <number>,
      "ai_verdict": "<string>",
      "location": "<string>",
      "potential_profit_eur": <number>,
      "potential_roi_pct": <number>,
      "rank": <number>,
      "category": "<max 50 znakov>",
      "deal_of_day": <boolean>,
      "reasoning": "<max 80 znakov>"
    }
  ],
  "by_source": [
    { "source": "<vir>", "count": <number>, "avg_deal_score": <number>, "avg_discount_pct": <number>, "best_deal_title": "<max 80 znakov>", "opportunity_rate": "<high|medium|low>" }
  ],
  "top_picks": [
    { "rank": <number>, "title": "<naslov>", "source": "<vir>", "price_eur": <number>, "potential_profit_eur": <number>, "why": "<max 80 znakov>", "urgency": "<high|medium|low>" }
  ],
  "trending": [
    { "category": "<kat>", "listing_count": <number>, "avg_deal_score": <number>, "trend": "<rising|stable|falling>", "action": "<buy_more|monitor|avoid>" }
  ],
  "summary": {
    "total_deals": <number>,
    "deal_of_day": "<naslov>",
    "best_source": "<vir>",
    "avg_deal_score": <number>,
    "avg_discount_pct": <number>,
    "total_potential_profit_eur": <number>,
    "aggregator_efficiency_score": <number 0-100>
  }
}`;
}

function transformAggregator(parsed: any, recentListings: ListingRow[]): any {
  const validIds = new Set(recentListings.map(l => l.id));

  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    deals: (parsed?.deals || []).filter((d: any) => validIds.has(String(d?.id ?? ''))).slice(0, 30).map((d: any) => ({
      id: String(d?.id ?? ''), title: String(d?.title ?? '').slice(0, 150),
      source: String(d?.source ?? '').slice(0, 30), priceEur: Math.max(0, Number(d?.price_eur ?? 0)),
      estValueEur: Math.max(0, Number(d?.est_value_eur ?? 0)), discountPct: Math.round(Number(d?.discount_pct ?? 0)),
      dealScore: Math.max(0, Math.min(100, Number(d?.deal_score ?? 0))), aiRisk: Math.max(0, Number(d?.ai_risk ?? 5)),
      aiVerdict: String(d?.ai_verdict ?? '').slice(0, 20), location: String(d?.location ?? '').slice(0, 50),
      potentialProfitEur: Math.round(Number(d?.potential_profit_eur ?? 0)), potentialRoiPct: Math.round(Number(d?.potential_roi_pct ?? 0)),
      rank: Math.max(1, Number(d?.rank ?? 1)), category: String(d?.category ?? '').slice(0, 50),
      dealOfDay: Boolean(d?.deal_of_day ?? false), reasoning: String(d?.reasoning ?? '').slice(0, 150),
    })),
    bySource: (parsed?.by_source || []).slice(0, 10).map((s: any) => ({
      source: String(s?.source ?? '').slice(0, 50), count: Math.max(0, Number(s?.count ?? 0)),
      avgDealScore: Math.round(Number(s?.avg_deal_score ?? 0)), avgDiscountPct: Math.round(Number(s?.avg_discount_pct ?? 0)),
      bestDealTitle: String(s?.best_deal_title ?? '').slice(0, 100),
      opportunityRate: includes(OPPORTUNITY_RATES, String(s?.opportunity_rate)) ? String(s.opportunity_rate) : 'medium',
    })),
    topPicks: (parsed?.top_picks || []).slice(0, 10).map((p: any) => ({
      rank: Math.max(1, Number(p?.rank ?? 1)), title: String(p?.title ?? '').slice(0, 100),
      source: String(p?.source ?? '').slice(0, 30), priceEur: Math.max(0, Number(p?.price_eur ?? 0)),
      potentialProfitEur: Math.round(Number(p?.potential_profit_eur ?? 0)),
      why: String(p?.why ?? '').slice(0, 150),
      urgency: includes(URGENCIES, String(p?.urgency)) ? String(p.urgency) : 'medium',
    })),
    trending: (parsed?.trending || []).slice(0, 8).map((t: any) => ({
      category: String(t?.category ?? '').slice(0, 50), listingCount: Math.max(0, Number(t?.listing_count ?? 0)),
      avgDealScore: Math.round(Number(t?.avg_deal_score ?? 0)),
      trend: includes(TRENDS, String(t?.trend)) ? String(t.trend) : 'stable',
      action: includes(ACTIONS, String(t?.action)) ? String(t.action) : 'monitor',
    })),
    summary: {
      totalDeals: Math.max(0, Number(parsed?.summary?.total_deals ?? 0)),
      dealOfDay: String(parsed?.summary?.deal_of_day ?? '').slice(0, 100),
      bestSource: String(parsed?.summary?.best_source ?? '').slice(0, 50),
      avgDealScore: Math.round(Number(parsed?.summary?.avg_deal_score ?? 0)),
      avgDiscountPct: Math.round(Number(parsed?.summary?.avg_discount_pct ?? 0)),
      totalPotentialProfitEur: Math.round(Number(parsed?.summary?.total_potential_profit_eur ?? 0)),
      aggregatorEfficiencyScore: Math.max(0, Math.min(100, Number(parsed?.summary?.aggregator_efficiency_score ?? 50))),
    },
  };
}
