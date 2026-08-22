// v6.36 / v8.95.9-competitor: AI Competitor Price Tracker — sledi cenam konkurentov v realnem času
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/competitor-tracker
// Body: {}
// Returns: { ok, tracking: { competitors: [], priceChanges, ourPosition, actions } }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CompetitorTrackerInput {}

interface SellerAgg {
  listings: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  priceDrops: number;
  avgDealScore: number;
  sources: Set<string>;
}

export const POST = withAiRoute<CompetitorTrackerInput>({
  endpoint: '/api/ai/competitor-tracker',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, category: true, buyPrice: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } } },
      take: 30,
    });

    // Pridobi podobne listinge (konkurenčni oglasi) z sellerName
    const competitorListings = await db.listing.findMany({
      where: { isHidden: false, price: { gt: 0 }, sellerName: { not: null } },
      select: { title: true, price: true, sellerName: true, sellerListingCount: true,
        aiVerdict: true, dealScore: true, firstSeenAt: true, previousPrice: true, priceDroppedAt: true,
        monitor: { select: { source: true, name: true } } },
      take: 500,
      orderBy: { firstSeenAt: 'desc' },
    });

    if (competitorListings.length === 0 && heldTrades.length === 0) {
      return apiOk({ ok: true, tracking: null, message: 'Ni podatkov o konkurentih.' });
    }

    // Group by seller (competitor)
    const bySeller = aggregateBySeller(competitorListings);

    const prompt = buildPrompt(heldTrades, competitorListings, bySeller);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const tracking = transformTracking(parsed);

    return apiOk({ ok: true, tracking });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function aggregateBySeller(
  competitorListings: Array<{
    price: number | null; sellerName: string | null; dealScore: number | null;
    priceDroppedAt: Date | null;
    monitor: { source: string | null; name: string | null } | null;
  }>
): Record<string, SellerAgg> {
  const bySeller: Record<string, SellerAgg> = {};
  for (const l of competitorListings) {
    const seller = l.sellerName || 'neznan';
    if (!bySeller[seller]) bySeller[seller] = { listings: 0, avgPrice: 0, minPrice: Infinity, maxPrice: 0, priceDrops: 0, avgDealScore: 0, sources: new Set() };
    bySeller[seller].listings++;
    bySeller[seller].avgPrice += l.price ?? 0;
    bySeller[seller].minPrice = Math.min(bySeller[seller].minPrice, l.price ?? 0);
    bySeller[seller].maxPrice = Math.max(bySeller[seller].maxPrice, l.price ?? 0);
    if (l.priceDroppedAt) bySeller[seller].priceDrops++;
    bySeller[seller].avgDealScore += l.dealScore ?? 0;
    if (l.monitor?.source) bySeller[seller].sources.add(l.monitor.source);
  }
  for (const s of Object.keys(bySeller)) {
    bySeller[s].avgPrice = bySeller[s].listings > 0 ? Math.round(bySeller[s].avgPrice / bySeller[s].listings) : 0;
    bySeller[s].avgDealScore = bySeller[s].listings > 0 ? Math.round(bySeller[s].avgDealScore / bySeller[s].listings) : 0;
    if (bySeller[s].minPrice === Infinity) bySeller[s].minPrice = 0;
  }
  return bySeller;
}

function buildPrompt(
  heldTrades: Array<{
    title: string; category: string | null; buyPrice: number;
    listing: { aiEstimatedValue: number | null; dealScore: number | null } | null;
  }>,
  competitorListings: Array<{ priceDroppedAt: Date | null }>,
  bySeller: Record<string, SellerAgg>
): string {
  const heldStr = heldTrades.slice(0, 10).map(t => `- ${t.title} | ${t.category} | ${t.buyPrice}€ | est: ${t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice*1.25)}€`).join('\n');
  const competitorStr = Object.entries(bySeller).sort(([,a],[,b]) => b.listings - a.listings).slice(0, 15).map(([seller, d]) =>
    `- ${seller}: ${d.listings} oglasov, povp. ${d.avgPrice}€ (${d.minPrice}-${d.maxPrice}€), ${d.priceDrops} padcev, deal ${d.avgDealScore}/100`
  ).join('\n');

  const priceDrops = competitorListings.filter(l => l.priceDroppedAt).length;
  const recentDrops = competitorListings.filter(l => l.priceDroppedAt && l.priceDroppedAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;

  return `Si AI competitor intelligence analyst za sledenje cen konkurentov.
Analiziraj konkurenčne prodajalce, njihove cene in strategije.

NAŠ INVENTAR (${heldTrades.length}):
${heldStr || '- Prazno'}

KONKURENTI (top 15 po številu oglasov):
${competitorStr || '- Ni podatkov'}

TRŽNI SIGNALI:
- Skupno konkurenčnih oglasov: ${competitorListings.length}
- Cenovni padci (skupno): ${priceDrops}
- Cenovni padci (zadnji 7d): ${recentDrops}

Konkurenčna analiza:
1. PRICE LEADER: kdo ima najnižje cene (agresivno ceneje)
2. QUALITY LEADER: kdo ima najvišje deal score (kakovostnejši itemi)
3. VOLUME PLAYER: kdo ima največ oglasov (množično)
4. NICHE PLAYER: kdo je specializiran (ena kategorija)
5. PRICE DROPPER: kdo pogosto znižuje cene (desperate)

Naša pozicija:
- Smo nad/pod povprečjem cen?
- Kateri konkurenti so najnevarnejši?
- Kje imamo prednost?

Odgovori LE z JSON:
{
  "insights": "<max 250 znakov>",
  "competitors": [
    {
      "name": "<ime prodajalca>",
      "type": "<price_leader|quality_leader|volume_player|niche_player|price_dropper>",
      "listing_count": <number>,
      "avg_price_eur": <number>,
      "price_range": "<min-max>",
      "price_drop_count": <number>,
      "avg_deal_score": <number>,
      "threat_level": "<low|medium|high>",
      "strategy": "<max 80 znakov>",
      "our_advantage": "<max 80 znakov>",
      "our_disadvantage": "<max 80 znakov>"
    }
  ],
  "price_changes": [
    {
      "competitor": "<ime>",
      "item_title": "<naslov, max 60 znakov>",
      "old_price_eur": <number>,
      "new_price_eur": <number>,
      "change_pct": <number>,
      "days_ago": <number>,
      "impact_on_us": "<max 80 znakov>"
    }
  ],
  "our_position": {
    "price_percentile": <number 0-100, kje smo glede na konkurenco>,
    "quality_percentile": <number>,
    "volume_percentile": <number>,
    "overall_competitive_score": <number 0-100>,
    "positioning": "<price_leader|quality_leader|balanced|follower|challenger>",
    "strengths": ["<prednost, max 80 znakov>", "..."],
    "weaknesses": ["<šibkost, max 80 znakov>", "..."]
  },
  "actions": [
    {
      "action": "<max 120 znakov>",
      "target": "<katerega konkurenta/item, max 50 znakov>",
      "priority": "<high|medium|low>",
      "expected_impact": "<max 80 znakov>"
    }
  ],
  "summary": {
    "total_competitors": <number>,
    "biggest_threat": "<ime>",
    "biggest_opportunity": "<ime>",
    "our_competitive_advantage": "<max 150 znakov>",
    "recommended_response": "<max 150 znakov>"
  }
}`;
}

function transformTracking(parsed: any): any {
  return {
    insights: String(parsed?.insights ?? '').slice(0, 600),
    competitors: (parsed?.competitors || []).slice(0, 15).map((c: any) => ({
      name: String(c?.name ?? '').slice(0, 80),
      type: ['price_leader', 'quality_leader', 'volume_player', 'niche_player', 'price_dropper'].includes(String(c?.type)) ? String(c.type) : 'volume_player',
      listingCount: Math.max(0, Number(c?.listing_count ?? 0)),
      avgPriceEur: Math.round(Number(c?.avg_price_eur ?? 0)),
      priceRange: String(c?.price_range ?? '').slice(0, 50),
      priceDropCount: Math.max(0, Number(c?.price_drop_count ?? 0)),
      avgDealScore: Math.max(0, Math.min(100, Number(c?.avg_deal_score ?? 0))),
      threatLevel: ['low', 'medium', 'high'].includes(String(c?.threat_level)) ? String(c.threat_level) : 'medium',
      strategy: String(c?.strategy ?? '').slice(0, 150),
      ourAdvantage: String(c?.our_advantage ?? '').slice(0, 150),
      ourDisadvantage: String(c?.our_disadvantage ?? '').slice(0, 150),
    })),
    priceChanges: (parsed?.price_changes || []).slice(0, 10).map((p: any) => ({
      competitor: String(p?.competitor ?? '').slice(0, 80),
      itemTitle: String(p?.item_title ?? '').slice(0, 100),
      oldPriceEur: Math.round(Number(p?.old_price_eur ?? 0)),
      newPriceEur: Math.round(Number(p?.new_price_eur ?? 0)),
      changePct: Math.round(Number(p?.change_pct ?? 0)),
      daysAgo: Math.max(0, Number(p?.days_ago ?? 0)),
      impactOnUs: String(p?.impact_on_us ?? '').slice(0, 150),
    })),
    ourPosition: {
      pricePercentile: Math.max(0, Math.min(100, Number(parsed?.our_position?.price_percentile ?? 50))),
      qualityPercentile: Math.max(0, Math.min(100, Number(parsed?.our_position?.quality_percentile ?? 50))),
      volumePercentile: Math.max(0, Math.min(100, Number(parsed?.our_position?.volume_percentile ?? 50))),
      overallCompetitiveScore: Math.max(0, Math.min(100, Number(parsed?.our_position?.overall_competitive_score ?? 50))),
      positioning: ['price_leader', 'quality_leader', 'balanced', 'follower', 'challenger'].includes(String(parsed?.our_position?.positioning)) ? String(parsed.our_position.positioning) : 'balanced',
      strengths: (parsed?.our_position?.strengths || []).slice(0, 4).map((s: any) => String(s).slice(0, 150)),
      weaknesses: (parsed?.our_position?.weaknesses || []).slice(0, 4).map((w: any) => String(w).slice(0, 150)),
    },
    actions: (parsed?.actions || []).slice(0, 6).map((a: any) => ({
      action: String(a?.action ?? '').slice(0, 250),
      target: String(a?.target ?? '').slice(0, 80),
      priority: ['high', 'medium', 'low'].includes(String(a?.priority)) ? String(a.priority) : 'medium',
      expectedImpact: String(a?.expected_impact ?? '').slice(0, 150),
    })),
    summary: {
      totalCompetitors: Math.max(0, Number(parsed?.summary?.total_competitors ?? 0)),
      biggestThreat: String(parsed?.summary?.biggest_threat ?? '').slice(0, 80),
      biggestOpportunity: String(parsed?.summary?.biggest_opportunity ?? '').slice(0, 80),
      ourCompetitiveAdvantage: String(parsed?.summary?.our_competitive_advantage ?? '').slice(0, 300),
      recommendedResponse: String(parsed?.summary?.recommended_response ?? '').slice(0, 300),
    },
  };
}
