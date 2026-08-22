// v6.36 / v8.95.9-competitor: AI Competitor Price Tracker — sledi cenam konkurence v realnem času
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/competitor-price-tracker
// Body: {}
// Returns: { ok, tracking: { competitors: [], priceChanges, ourPosition, actions } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CompetitorPriceTrackerInput {}

interface SourceAgg {
  count: number;
  avgPrice: number;
  priceDrops: number;
  avgDealScore: number;
}

interface PriceStats {
  priceDrops: number;
  avgPrice: number;
  priceRange: [number, number];
  bySource: Record<string, SourceAgg>;
}

export const POST = withAiRoute<CompetitorPriceTrackerInput>({
  endpoint: '/api/ai/competitor-price-tracker',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    // Pridobi podobne listinge (konkurenčni oglasi) za naše held iteme
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, price: true } } },
      take: 20,
    });

    // Vsi aktivni listingi = konkurenca
    const allListings = await db.listing.findMany({
      where: { isHidden: false, price: { gt: 0 }, firstSeenAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
      select: { id: true, title: true, price: true, previousPrice: true, priceDroppedAt: true,
        firstSeenAt: true, aiVerdict: true, dealScore: true,
        monitor: { select: { source: true, name: true } } },
      take: 500,
      orderBy: { firstSeenAt: 'desc' },
    });

    if (allListings.length === 0) {
      return apiOk({ ok: true, tracking: null, message: 'Ni oglasov za competitor tracking.' });
    }

    // Analiza cenovnih sprememb
    const stats = computePriceStats(allListings);

    const prompt = buildPrompt(heldTrades, allListings, stats);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);
    const validIds = new Set(heldTrades.map(t => t.id));

    const tracking = transformTracking(parsed, stats, validIds, allListings.length);

    return apiOk({ ok: true, tracking });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function computePriceStats(
  allListings: Array<{
    price: number | null; priceDroppedAt: Date | null;
    dealScore: number | null;
    monitor: { source: string | null; name: string | null } | null;
  }>
): PriceStats {
  const priceDrops = allListings.filter(l => l.priceDroppedAt).length;
  const avgPrice = allListings.length > 0 ? Math.round(allListings.reduce((s, l) => s + (l.price ?? 0), 0) / allListings.length) : 0;
  const priceRange: [number, number] = allListings.length > 0
    ? [Math.min(...allListings.map(l => l.price ?? 0)), Math.max(...allListings.map(l => l.price ?? 0))]
    : [0, 0];

  const bySource: Record<string, SourceAgg> = {};
  for (const l of allListings) {
    const src = l.monitor?.source || 'neznan';
    if (!bySource[src]) bySource[src] = { count: 0, avgPrice: 0, priceDrops: 0, avgDealScore: 0 };
    bySource[src].count++;
    bySource[src].avgPrice += l.price ?? 0;
    if (l.priceDroppedAt) bySource[src].priceDrops++;
    bySource[src].avgDealScore += l.dealScore ?? 0;
  }
  for (const s of Object.keys(bySource)) {
    bySource[s].avgPrice = bySource[s].count > 0 ? Math.round(bySource[s].avgPrice / bySource[s].count) : 0;
    bySource[s].avgDealScore = bySource[s].count > 0 ? Math.round(bySource[s].avgDealScore / bySource[s].count) : 0;
  }

  return { priceDrops, avgPrice, priceRange, bySource };
}

function buildPrompt(
  heldTrades: Array<{
    title: string; category: string | null; buyPrice: number;
    listing: { aiEstimatedValue: number | null; dealScore: number | null; price: number | null } | null;
  }>,
  allListings: Array<{ price: number | null; priceDroppedAt: Date | null; dealScore: number | null }>,
  stats: PriceStats
): string {
  const heldStr = heldTrades.slice(0, 10).map(t => `- ${t.title} | ${t.category} | est: ${t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice*1.25)}€`).join('\n');
  const sourceStr = Object.entries(stats.bySource).sort(([,a],[,b]) => b.count - a.count).map(([src, d]) => `- ${src}: ${d.count} oglasov, povp. ${d.avgPrice}€, ${d.priceDrops} padcev, deal ${d.avgDealScore}/100`).join('\n');

  return `Si AI competitor price tracker za spremljanje konkurenčnih cen.
Analiziraj konkurenčne oglase in našo cenovno pozicijo.

SKUPno: ${allListings.length} konkurenčnih oglasov (zadnjih 14 dni)
- Povp. cena: ${stats.avgPrice}€ (range ${stats.priceRange[0]}-${stats.priceRange[1]}€)
- Padcev cen: ${stats.priceDrops} (${Math.round(stats.priceDrops/allListings.length*100)}%)

PODATKI PO VIRIH:
${sourceStr}

NAŠ HELD INVENTAR:
${heldStr || '- Prazno'}

Competitor tracking pravila:
1. IDENTIFY: kateri konkurenčni oglasi so podobni našim held itemom?
2. PRICE_COMPARE: naša est. cena vs. konkurenčna cena
3. POSITIONING: ali smo above/below/at par s konkurenco?
4. TREND: ali konkurenca znižuje/dviguje cene?
5. OPPORTUNITY: kjer je konkurenca draga → mi podrežemo ceno
6. THREAT: kjer je konkurenca cenejša → moramo diferencirati ali znižati

Strategije:
- "undercut": naša cena 5-10% pod konkurenco (za hitro prodajo)
- "premium": naša cena nad konkurenco (za kakovost/redkost)
- "match": enaka cena kot konkurenca (pošteno)
- "wait_competitor": počakaj da konkurenca prodaja, potem dvigni ceno
- "bundle_advantage": bundle za diferenciacijo od konkurence

Odgovori LE z JSON:
{
  "insights": "<max 200 znakov>",
  "market_overview": {
    "total_competitor_listings": <number>,
    "avg_market_price_eur": <number>,
    "price_trend": "<rising|falling|stable>",
    "price_drop_rate_pct": <number>,
    "competition_level": "<low|medium|high>"
  },
  "competitors_by_source": [
    {
      "source": "<vir>",
      "listing_count": <number>,
      "avg_price_eur": <number>,
      "price_drop_count": <number>,
      "avg_deal_score": <number>,
      "price_trend": "<rising|falling|stable>",
      "threat_level": "<low|medium|high>"
    }
  ],
  "our_position": [
    {
      "id": "<trade_id>",
      "title": "<naslov>",
      "our_est_price_eur": <number>,
      "competitor_avg_price_eur": <number>,
      "price_difference_pct": <number>,
      "position": "<above_market|below_market|at_par>",
      "strategy": "<undercut|premium|match|wait_competitor|bundle_advantage>",
      "recommended_price_eur": <number>,
      "competitive_advantage": "<max 80 znakov>",
      "reasoning": "<max 100 znakov>"
    }
  ],
  "price_changes": [
    { "source": "<vir>", "old_price_eur": <number>, "new_price_eur": <number>, "change_pct": <number>, "days_ago": <number> }
  ],
  "actions": [
    { "action": "<max 120 znakov>", "priority": "<high|medium|low>", "affected_items": <number>, "expected_impact_eur": <number> }
  ],
  "summary": {
    "our_avg_position": "<above|below|at_par>",
    "best_priced_source": "<vir>",
    "most_aggressive_source": "<vir (največ padcev)>",
    "items_to_reprice": <number>,
    "potential_competitive_gain_eur": <number>
  }
}`;
}

function transformTracking(parsed: any, stats: PriceStats, validIds: Set<string>, allListingsLength: number): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 500),
    marketOverview: {
      totalCompetitorListings: Math.max(0, Number(parsed?.market_overview?.total_competitor_listings ?? allListingsLength)),
      avgMarketPriceEur: Math.max(0, Number(parsed?.market_overview?.avg_market_price_eur ?? stats.avgPrice)),
      priceTrend: ['rising', 'falling', 'stable'].includes(String(parsed?.market_overview?.price_trend)) ? String(parsed.market_overview.price_trend) : 'stable',
      priceDropRatePct: Math.round(Number(parsed?.market_overview?.price_drop_rate_pct ?? Math.round(stats.priceDrops/allListingsLength*100))),
      competitionLevel: ['low', 'medium', 'high'].includes(String(parsed?.market_overview?.competition_level)) ? String(parsed.market_overview.competition_level) : 'medium',
    },
    competitorsBySource: (parsed?.competitors_by_source || []).slice(0, 10).map((c: any) => ({
      source: String(c?.source ?? '').slice(0, 50),
      listingCount: Math.max(0, Number(c?.listing_count ?? 0)),
      avgPriceEur: Math.max(0, Number(c?.avg_price_eur ?? 0)),
      priceDropCount: Math.max(0, Number(c?.price_drop_count ?? 0)),
      avgDealScore: Math.max(0, Math.min(100, Number(c?.avg_deal_score ?? 0))),
      priceTrend: ['rising', 'falling', 'stable'].includes(String(c?.price_trend)) ? String(c.price_trend) : 'stable',
      threatLevel: ['low', 'medium', 'high'].includes(String(c?.threat_level)) ? String(c.threat_level) : 'medium',
    })),
    ourPosition: (parsed?.our_position || []).filter((p: any) => validIds.has(String(p?.id ?? ''))).map((p: any) => ({
      tradeId: String(p?.id ?? ''),
      title: String(p?.title ?? '').slice(0, 150),
      ourEstPriceEur: Math.max(0, Number(p?.our_est_price_eur ?? 0)),
      competitorAvgPriceEur: Math.max(0, Number(p?.competitor_avg_price_eur ?? 0)),
      priceDifferencePct: Math.round(Number(p?.price_difference_pct ?? 0)),
      position: ['above_market', 'below_market', 'at_par'].includes(String(p?.position)) ? String(p.position) : 'at_par',
      strategy: ['undercut', 'premium', 'match', 'wait_competitor', 'bundle_advantage'].includes(String(p?.strategy)) ? String(p.strategy) : 'match',
      recommendedPriceEur: Math.max(0, Number(p?.recommended_price_eur ?? 0)),
      competitiveAdvantage: String(p?.competitive_advantage ?? '').slice(0, 150),
      reasoning: String(p?.reasoning ?? '').slice(0, 200),
    })),
    priceChanges: (parsed?.price_changes || []).slice(0, 10).map((c: any) => ({
      source: String(c?.source ?? '').slice(0, 50),
      oldPriceEur: Math.max(0, Number(c?.old_price_eur ?? 0)),
      newPriceEur: Math.max(0, Number(c?.new_price_eur ?? 0)),
      changePct: Math.round(Number(c?.change_pct ?? 0)),
      daysAgo: Math.max(0, Number(c?.days_ago ?? 0)),
    })),
    actions: (parsed?.actions || []).slice(0, 6).map((a: any) => ({
      action: String(a?.action ?? '').slice(0, 250),
      priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      affectedItems: Math.max(0, Number(a?.affected_items ?? 0)),
      expectedImpactEur: Math.round(Number(a?.expected_impact_eur ?? 0)),
    })),
    summary: {
      ourAvgPosition: ['above', 'below', 'at_par'].includes(String(parsed?.summary?.our_avg_position)) ? String(parsed.summary.our_avg_position) : 'at_par',
      bestPricedSource: String(parsed?.summary?.best_priced_source ?? '').slice(0, 50),
      mostAggressiveSource: String(parsed?.summary?.most_aggressive_source ?? '').slice(0, 50),
      itemsToReprice: Math.max(0, Number(parsed?.summary?.items_to_reprice ?? 0)),
      potentialCompetitiveGainEur: Math.round(Number(parsed?.summary?.potential_competitive_gain_eur ?? 0)),
    },
  };
}
