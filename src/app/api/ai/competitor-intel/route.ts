// v6.13 / v8.95.9-competitor: AI Competitor Intelligence Tracker — analiza konkurenčnih prodajalcev
// Refaktoriran z withAiRoute helperjem (v8.95.9) + enforceBudget guard.
//
// POST /api/ai/competitor-intel
// Body: { category?: string, limit?: number }
// Returns: { ok, competitors: Array<{ sellerName, listingCount, avgPrice, priceRange, categories, activity, strategy, threat, opportunities }>, insights }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface CompetitorIntelInput {
  category: string;
  limit: number;
}

interface AggregatedSeller {
  listings: any[];
  count: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  categories: Set<string>;
  sources: Set<string>;
  locations: Set<string>;
  lastActivity: Date;
  firstActivity: Date;
  avgDealScore: number;
  opportunityCount: number;
}

interface TopCompetitor {
  sellerName: string;
  listingCount: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  priceRange: number;
  categories: string[];
  sources: string[];
  locations: string[];
  lastActivity: string;
  firstActivity: string;
  daysActive: number;
  avgDealScore: number;
  opportunityCount: number;
  opportunityRate: number;
}

export const POST = withAiRoute<CompetitorIntelInput>({
  endpoint: '/api/ai/competitor-intel',
  maxDuration: 90,
  enforceBudget: true,

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    return {
      category: String(body?.category || '').trim(),
      limit: Math.max(5, Math.min(50, Number(body?.limit) || 20)),
    };
  },

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { category: categoryFilter, limit } = input;

    // 1. Pridobi vse listinge z sellerName
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        sellerName: { not: null },
      },
      select: {
        id: true, title: true, price: true, sellerName: true, sellerListingCount: true,
        firstSeenAt: true, postedAt: true, aiVerdict: true, aiScore: true, dealScore: true,
        aiEstimatedValue: true, location: true, monitor: { select: { source: true, name: true } },
      },
      take: 1000,
      orderBy: { firstSeenAt: 'desc' },
    });

    // 2. Pridobi sold tradeove za kontekst mojih prodaj
    const mySold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, sellDate: true, buyDate: true },
      take: 100,
    });

    if (listings.length === 0) {
      return apiOk({
        ok: true,
        competitors: [],
        message: 'Ni listingov s podatki o prodajalcih (potrebno scrapanje detail page za sellerName).',
      });
    }

    // 3. Agregacija po sellerName
    const bySeller = aggregateBySeller(listings, categoryFilter);

    const topCompetitors = buildTopCompetitors(bySeller, limit);

    if (topCompetitors.length === 0) {
      return apiOk({
        ok: true,
        competitors: [],
        message: 'Ni dovolj prodajalcev z vsaj 2 listingoma za analizo.',
      });
    }

    // 4. AI analiza konkurence
    const prompt = buildPrompt(topCompetitors, mySold);

    const raw = await callAi(prompt);
    const parsed: any = parseAi(raw);

    const { competitors, blueOcean, differentiation, threatBreakdown, strategyBreakdown } = transformResult(parsed, topCompetitors);

    return apiOk({
      ok: true,
      insights: String(parsed?.insights ?? '').slice(0, 600),
      competitors,
      blueOcean,
      differentiation,
      summary: {
        totalCompetitors: competitors.length,
        threatBreakdown,
        strategyBreakdown,
        blueOceanCount: blueOcean.length,
        totalSellersAnalyzed: Object.keys(bySeller).length,
        categoryFilter: categoryFilter || null,
      },
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function aggregateBySeller(
  listings: Array<{
    title: string; price: number | null; sellerName: string | null;
    firstSeenAt: Date; aiVerdict: string | null; aiScore: number | null;
    dealScore: number | null; location: string | null;
    monitor: { source: string | null; name: string | null } | null;
  }>,
  categoryFilter: string
): Record<string, AggregatedSeller> {
  const bySeller: Record<string, AggregatedSeller> = {};

  for (const l of listings) {
    const seller = l.sellerName || 'neznan';
    if (categoryFilter) {
      const titleCat = (l.title || '').toLowerCase();
      const monitorCat = (l.monitor?.name || '').toLowerCase();
      if (!titleCat.includes(categoryFilter.toLowerCase()) && !monitorCat.includes(categoryFilter.toLowerCase())) {
        continue;
      }
    }
    if (!bySeller[seller]) {
      bySeller[seller] = {
        listings: [], count: 0, avgPrice: 0, minPrice: Infinity, maxPrice: 0,
        categories: new Set(), sources: new Set(), locations: new Set(),
        lastActivity: new Date(0), firstActivity: new Date(),
        avgDealScore: 0, opportunityCount: 0,
      };
    }
    const s = bySeller[seller];
    s.listings.push(l);
    s.count++;
    if (l.price) {
      s.avgPrice += l.price;
      s.minPrice = Math.min(s.minPrice, l.price);
      s.maxPrice = Math.max(s.maxPrice, l.price);
    }
    s.categories.add(l.monitor?.name || 'drugo');
    s.sources.add(l.monitor?.source || 'neznan');
    if (l.location) s.locations.add(l.location);
    const firstSeen = l.firstSeenAt;
    if (firstSeen > s.lastActivity) s.lastActivity = firstSeen;
    if (s.firstActivity.getTime() === 0 || firstSeen < s.firstActivity) s.firstActivity = firstSeen;
    s.avgDealScore += l.dealScore ?? l.aiScore ?? 0;
    if (l.aiVerdict === 'PRILIKA' || (l.dealScore ?? 0) >= 70) s.opportunityCount++;
  }

  return bySeller;
}

function buildTopCompetitors(bySeller: Record<string, AggregatedSeller>, limit: number): TopCompetitor[] {
  return Object.entries(bySeller)
    .filter(([_, s]) => s.count >= 2)
    .map(([seller, s]) => ({
      sellerName: seller,
      listingCount: s.count,
      avgPrice: s.count > 0 ? Math.round(s.avgPrice / s.count) : 0,
      minPrice: s.minPrice === Infinity ? 0 : s.minPrice,
      maxPrice: s.maxPrice,
      priceRange: (s.maxPrice - (s.minPrice === Infinity ? 0 : s.minPrice)),
      categories: Array.from(s.categories).slice(0, 5),
      sources: Array.from(s.sources),
      locations: Array.from(s.locations).slice(0, 3),
      lastActivity: s.lastActivity.toISOString(),
      firstActivity: s.firstActivity.toISOString(),
      daysActive: Math.round((s.lastActivity.getTime() - s.firstActivity.getTime()) / (24 * 60 * 60 * 1000)),
      avgDealScore: s.count > 0 ? Math.round(s.avgDealScore / s.count) : 0,
      opportunityCount: s.opportunityCount,
      opportunityRate: s.count > 0 ? Math.round((s.opportunityCount / s.count) * 100) : 0,
    }))
    .sort((a, b) => b.listingCount - a.listingCount)
    .slice(0, limit);
}

function buildPrompt(
  topCompetitors: TopCompetitor[],
  mySold: Array<{ category: string | null; buyPrice: number; sellPrice: number | null }>
): string {
  const competitorsStr = topCompetitors.map(c => `- ${c.sellerName}: ${c.listingCount} oglasov, ${c.avgPrice}€ povp (range ${c.minPrice}-${c.maxPrice}€), ${c.categories.join('/')}, ${c.daysActive}d aktiven, ${c.opportunityRate}% priložnosti, deal score ${c.avgDealScore}/100`).join('\n');

  const myCats = [...new Set(mySold.map(t => t.category || 'drugo'))];
  const myAvgROI = mySold.length > 0
    ? Math.round(mySold.reduce((s, t) => s + (((t.sellPrice ?? 0) - t.buyPrice) / Math.max(1, t.buyPrice) * 100), 0) / mySold.length)
    : 0;

  return `Si ekspert za competitive intelligence pri preprodaji rabljenih dobrin.
Analiziraj konkurenčne prodajalce in predlagaj strategijo za preseganje konkurence.

TOP KONKURENTI (po številu oglasov):
${competitorsStr}

MOJ KONTEKST:
- Kategorije ki jih prodajam: ${myCats.join(', ') || 'brez'}
- Povprečni ROI: ${myAvgROI}%
- Število mojih prodaj: ${mySold.length}

Pravila za analizo:
1. Za vsakega konkurenta določi strategijo (volume_player|premium_niche|discounter|specialist|opportunity_hunter)
2. Threat level (low|medium|high) — kako neposredno konkurira
3. Opportunities — kje ima šibke točke ki jih lahko izkoristim
4. Identificiraj "blue ocean" kategorije kjer je malo konkurence
5. Predlagaj kako se diferencirati (cena, kakovost, hitrost, bundle)

Strategije prodajalcev:
- "volume_player": veliko oglasov, širok asortiman, nizke cene
- "premium_niche": malo oglasov, visoke cene, specializiran
- "discounter": cene 20%+ pod tržnim povprečjem
- "specialist": ena kategorija, globoko znanje
- "opportunity_hunter": redki oglasi a visok deal score (profesionalni flipper)

Odgovori LE z JSON:
{
  "insights": "<splošne ugotovitve o konkurenčnem okolju, max 300 znakov>",
  "competitors": [
    {
      "sellerName": "<ime>",
      "strategy": "<ena od strategij>",
      "threat": "<low|medium|high>",
      "weaknesses": ["<šibkost, max 80 znakov>", "..."],
      "opportunities": ["<priložnost zame, max 100 znakov>", "..."],
      "recommended_action": "<kaj naj naredim glede tega konkurenta, max 150 znakov>"
    }
  ],
  "blue_ocean": [
    {
      "category": "<kategorija>",
      "reasoning": "<zakaj malo konkurence, max 100 znakov>",
      "potential_roi_pct": <number>
    }
  ],
  "differentiation": ["<predlog za diferenciacijo, max 150 znakov>", "..."]
}`;
}

function transformResult(parsed: any, topCompetitors: TopCompetitor[]): {
  competitors: any[];
  blueOcean: any[];
  differentiation: string[];
  threatBreakdown: { high: number; medium: number; low: number };
  strategyBreakdown: Record<string, number>;
} {
  const sellerMap = new Map(topCompetitors.map(c => [c.sellerName, c]));

  const competitors = (parsed?.competitors || [])
    .filter((c: any) => sellerMap.has(String(c?.sellerName ?? '')))
    .map((c: any) => {
      const sellerName = String(c.sellerName);
      const orig = sellerMap.get(sellerName)!;
      return {
        ...orig,
        strategy: ['volume_player', 'premium_niche', 'discounter', 'specialist', 'opportunity_hunter'].includes(String(c?.strategy))
          ? String(c.strategy) : 'volume_player',
        threat: ['low', 'medium', 'high'].includes(String(c?.threat)) ? String(c.threat) : 'medium',
        weaknesses: Array.isArray(c?.weaknesses) ? c.weaknesses.slice(0, 4).map((w: any) => String(w).slice(0, 150)) : [],
        opportunities: Array.isArray(c?.opportunities) ? c.opportunities.slice(0, 4).map((o: any) => String(o).slice(0, 200)) : [],
        recommendedAction: String(c?.recommended_action ?? '').slice(0, 300),
      };
    });

  const blueOcean = (parsed?.blue_ocean || []).slice(0, 6).map((b: any) => ({
    category: String(b?.category ?? '').slice(0, 50),
    reasoning: String(b?.reasoning ?? '').slice(0, 200),
    potentialRoiPct: Math.max(0, Math.min(500, Number(b?.potential_roi_pct ?? 0))),
  }));

  const differentiation = (parsed?.differentiation || []).slice(0, 6).map((d: any) => String(d).slice(0, 250));

  const threatBreakdown = {
    high: competitors.filter(c => c.threat === 'high').length,
    medium: competitors.filter(c => c.threat === 'medium').length,
    low: competitors.filter(c => c.threat === 'low').length,
  };
  const strategyBreakdown: Record<string, number> = {};
  for (const c of competitors) {
    strategyBreakdown[c.strategy] = (strategyBreakdown[c.strategy] ?? 0) + 1;
  }

  return { competitors, blueOcean, differentiation, threatBreakdown, strategyBreakdown };
}
