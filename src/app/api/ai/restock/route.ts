// v6.7 / v8.94.4-f: Smart Restock Recommendations — AI priporoča kaj ponovno kupiti za preprodajo
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// GET /api/ai/restock
// Analizira uspešne prodaje in išče podobne trenutne priložnosti
// Returns: { ok, recommendations: Array<{ category, item, avgProfit, avgRoi, avgDaysToSell, currentOpportunities, reason }> }

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RestockInput {}

export const GET = withAiRoute<RestockInput>({
  endpoint: '/api/ai/restock',
  maxDuration: 60,
  enforceBudget: true, // v8.94: budget guard + avtomatski recordAiCall
  method: 'GET',

  // GET — brez telesa; parseBody vrne prazen objekt
  parseBody: async () => ({}),

  // Brez validateInput — endpoint nima inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { db } = ctx;

    // 1. Pridobi prodane tradeove za analizo donosnosti
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        id: true, title: true, category: true, buyPrice: true, sellPrice: true,
        buyFees: true, sellFees: true, buyDate: true, sellDate: true,
      },
      take: 200,
    });

    if (soldTrades.length === 0) {
      return apiOk({ ok: true, recommendations: [], message: 'Ni prodanih tradeov za analizo.' });
    }

    // 2. Agregiraj statistiko po kategorijah
    const catStats = aggregateCategoryStats(soldTrades);

    // 3. Top donosne kategorije (filtrirane + sortirane)
    const topCategories = computeTopCategories(catStats);

    // 4. Za vsako top kategorijo poišči trenutne priložnosti
    const recommendations = await buildRestockRecommendations(topCategories, db);

    return apiOk({
      ok: true,
      recommendations: recommendations.sort((a, b) => b.avgRoi - a.avgRoi),
      totalSoldTrades: soldTrades.length,
      categoriesAnalyzed: topCategories.length,
      totalOpportunities: recommendations.reduce((s, r) => s + r.opportunities.length, 0),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

const STOP_WORDS = new Set([
  'prodam', 'nov', 'novo', 'rabljen', 'rabljeno',
  'dober', 'odličen', 'lepi', 'kompletni', 'z', 'in', 'za',
]);

function extractKeywords(title: string): string[] {
  return title.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w))
    .slice(0, 5);
}

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  sellPrice: number | null;
  buyFees: number;
  sellFees: number;
  buyDate: Date;
  sellDate: Date | null;
}

interface CategoryStats {
  trades: SoldTradeRow[];
  totalProfit: number;
  totalCost: number;
  daysToSell: number[];
}

function aggregateCategoryStats(soldTrades: SoldTradeRow[]): Record<string, CategoryStats> {
  const catStats: Record<string, CategoryStats> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!catStats[cat]) {
      catStats[cat] = { trades: [], totalProfit: 0, totalCost: 0, daysToSell: [] };
    }
    catStats[cat].trades.push(t);
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    catStats[cat].totalProfit += profit;
    catStats[cat].totalCost += t.buyPrice + (t.buyFees ?? 0);
    if (t.sellDate && t.buyDate) {
      catStats[cat].daysToSell.push(
        Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000))
      );
    }
  }
  return catStats;
}

interface TopCategory {
  category: string;
  soldCount: number;
  totalProfit: number;
  avgRoi: number;
  avgDaysToSell: number;
  keywords: Set<string>;
}

function computeTopCategories(catStats: Record<string, CategoryStats>): TopCategory[] {
  return Object.entries(catStats)
    .map(([cat, s]) => ({
      category: cat,
      soldCount: s.trades.length,
      totalProfit: Math.round(s.totalProfit),
      avgRoi: s.totalCost > 0 ? Math.round((s.totalProfit / s.totalCost) * 100) : 0,
      avgDaysToSell: s.daysToSell.length > 0
        ? Math.round(s.daysToSell.reduce((a, b) => a + b, 0) / s.daysToSell.length)
        : 0,
      keywords: new Set(s.trades.flatMap(t => extractKeywords(t.title))),
    }))
    .filter(c => c.soldCount >= 1 && c.avgRoi > 0)
    .sort((a, b) => b.avgRoi - a.avgRoi || b.totalProfit - a.totalProfit);
}

interface OpportunityRow {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  aiVerdict: string | null;
  dealScore: number | null;
  aiEstimatedValue: number | null;
  monitor: { source: string; name: string } | null;
}

interface EnrichedOpportunity extends OpportunityRow {
  estSellPrice: number;
  potentialProfit: number;
  potentialRoi: number;
}

function enrichOpportunities(opportunities: OpportunityRow[]): EnrichedOpportunity[] {
  return opportunities
    .slice(0, 5)
    .map(l => {
      const estSellPrice = l.aiEstimatedValue ?? Math.round((l.price ?? 0) * 1.2);
      const potentialProfit = estSellPrice - (l.price ?? 0) - (l.price ?? 0) * 0.1; // minus 10% fees
      const potentialRoi = (l.price ?? 0) > 0 ? Math.round((potentialProfit / (l.price ?? 0)) * 100) : 0;
      return {
        ...l,
        estSellPrice,
        potentialProfit: Math.round(potentialProfit),
        potentialRoi,
      };
    })
    .sort((a, b) => b.potentialProfit - a.potentialProfit);
}

function buildReason(cat: TopCategory): string {
  if (cat.avgRoi > 50) {
    return `🔥 TOP niša! ${cat.soldCount} prodaj z ${cat.avgRoi}% ROI. Ponovno investiraj!`;
  } else if (cat.avgRoi > 20) {
    return `✅ Donosna niša: ${cat.avgRoi}% ROI, ${cat.avgDaysToSell}d povp. prodaja`;
  }
  return `📊 Stabilna niša: ${cat.avgRoi}% ROI, ${cat.soldCount} prodaj`;
}

async function findOpportunitiesForCategory(
  cat: TopCategory,
  db: AiRouteContext['db']
): Promise<{ keywords: string[]; opportunities: OpportunityRow[] }> {
  const keywords = Array.from(cat.keywords).slice(0, 3);
  let opportunities: OpportunityRow[] = [];

  for (const kw of keywords) {
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        isBookmarked: false,
        title: { contains: kw },
        OR: [
          { aiVerdict: 'PRILIKA' },
          { dealScore: { gte: 60 } },
        ],
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        aiVerdict: true, dealScore: true, aiEstimatedValue: true,
        monitor: { select: { source: true, name: true } },
      },
      take: 5,
      orderBy: { dealScore: 'desc' },
    });
    opportunities.push(...listings);
  }

  // Deduplicate by listing id
  const seen = new Set<string>();
  opportunities = opportunities.filter(l => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });

  return { keywords, opportunities };
}

interface RestockRecommendation {
  category: string;
  soldCount: number;
  avgProfit: number;
  avgRoi: number;
  avgDaysToSell: number;
  keywords: string[];
  reason: string;
  opportunities: EnrichedOpportunity[];
}

async function buildRestockRecommendations(
  topCategories: TopCategory[],
  db: AiRouteContext['db']
): Promise<RestockRecommendation[]> {
  const recommendations: RestockRecommendation[] = [];

  for (const cat of topCategories.slice(0, 8)) {
    const { keywords, opportunities } = await findOpportunitiesForCategory(cat, db);
    if (opportunities.length === 0) continue;

    const enrichedOpps = enrichOpportunities(opportunities);
    const reason = buildReason(cat);

    recommendations.push({
      category: cat.category,
      soldCount: cat.soldCount,
      avgProfit: cat.totalProfit,
      avgRoi: cat.avgRoi,
      avgDaysToSell: cat.avgDaysToSell,
      keywords,
      reason,
      opportunities: enrichedOpps,
    });
  }

  return recommendations;
}
