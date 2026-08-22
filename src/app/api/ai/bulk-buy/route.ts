// v6.5 / v8.95.3-batch1: Bulk Buy Opportunities — AI zazna serije oglasov od istega prodajalca
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// GET /api/ai/bulk-buy?days=30&minListings=3
// Returns: { ok, opportunities: Array<{ sellerName, listings, totalValue, suggestedBulkPrice, potentialSavings, reason }> }

import { type NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 90;

interface BulkBuyInput {
  days: number;
  minListings: number;
}

interface BulkListingRow {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string | null;
  imageUrl: string | null;
  firstSeenAt: Date;
  aiVerdict: string | null;
  aiScore: number | null;
  dealScore: number | null;
  sellerName: string | null;
  sellerListingCount: number | null;
  monitor: { source: string; name: string } | null;
}

interface BulkOpportunity {
  sellerName: string;
  listingCount: number;
  totalValue: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  suggestedBulkPrice: number;
  potentialSavings: number;
  discountPct: number;
  isSameCategory: boolean;
  isBulkReseller: boolean;
  reason: string;
  score: number;
  listings: Array<{
    id: string; title: string; price: number | null; priceText: string;
    url: string; location: string | null; imageUrl: string | null;
    dealScore: number | null; source: string | undefined;
  }>;
}

export const GET = withAiRoute<BulkBuyInput>({
  endpoint: '/api/ai/bulk-buy',
  maxDuration: 90,
  enforceBudget: true,
  method: 'GET',

  parseBody: async (req: NextRequest) => parseBulkBuyQuery(req),

  handler: async (input, _ctx: AiRouteContext) => {
    const { days, minListings } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. Get listings with seller names
    const listings = await _ctx.db.listing.findMany({
      where: {
        sellerName: { not: null },
        isHidden: false,
        firstSeenAt: { gte: since },
        price: { not: null },
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, imageUrl: true, firstSeenAt: true,
        aiVerdict: true, aiScore: true, dealScore: true,
        sellerName: true, sellerListingCount: true,
        monitor: { select: { source: true, name: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 1000,
    });

    // 2. Group by seller
    const sellerMap: Record<string, BulkListingRow[]> = {};
    for (const l of listings) {
      if (!l.sellerName) continue;
      if (!sellerMap[l.sellerName]) sellerMap[l.sellerName] = [];
      sellerMap[l.sellerName].push(l);
    }

    // 3. Find sellers with multiple listings (bulk buy opportunities)
    const opportunities: BulkOpportunity[] = Object.entries(sellerMap)
      .filter(([, items]) => items.length >= minListings)
      .map(([sellerName, items]) => buildOpportunity(sellerName, items))
      .sort((a, b) => b.score - a.score || b.potentialSavings - a.potentialSavings);

    return apiOk({
      ok: true,
      opportunities: opportunities.slice(0, 20),
      totalSellers: Object.keys(sellerMap).length,
      bulkOpportunities: opportunities.length,
      totalPotentialSavings: opportunities.reduce((s, o) => s + o.potentialSavings, 0),
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function parseBulkBuyQuery(req: NextRequest): BulkBuyInput {
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') ?? '30', 10) || 30));
  const minListings = Math.max(2, parseInt(url.searchParams.get('minListings') ?? '3', 10) || 3);
  return { days, minListings };
}

function extractBulkCategory(title: string): string {
  if (/(iphone|samsung|telefon|laptop)/.test(title)) return 'elektronika';
  if (/(avto|golf|audi)/.test(title)) return 'avto';
  if (/(orodje|bosch|makita)/.test(title)) return 'orodje';
  return 'drugo';
}

function buildOpportunity(sellerName: string, items: BulkListingRow[]): BulkOpportunity {
  const totalValue = items.reduce((s, l) => s + (l.price ?? 0), 0);
  const avgPrice = Math.round(totalValue / items.length);
  const minPrice = Math.min(...items.map(l => l.price!));
  const maxPrice = Math.max(...items.map(l => l.price!));

  // Suggested bulk price: 15-25% discount for buying all
  const discountPct = items.length >= 5 ? 25 : items.length >= 3 ? 20 : 15;
  const suggestedBulkPrice = Math.round(totalValue * (1 - discountPct / 100));
  const potentialSavings = totalValue - suggestedBulkPrice;

  // Similarity check: are items in same category?
  const titles = items.map(l => l.title.toLowerCase());
  const categories = new Set<string>();
  titles.forEach(t => categories.add(extractBulkCategory(t)));

  const isSameCategory = categories.size === 1;
  const isBulkReseller = items.length >= 5;

  let reason: string;
  if (isBulkReseller && isSameCategory) {
    reason = `🔥 Bulk prodajalec z ${items.length} ${Array.from(categories)[0]} oglasi — idealno za paketni nakup s ${discountPct}% popustom`;
  } else if (isSameCategory) {
    reason = `📦 ${items.length} podobnih oglasov od istega prodajalca — predlagaj paketni nakup (${discountPct}% popust)`;
  } else {
    reason = `${items.length} oglasov od istega prodajalca — mogoče paketni dogovor (${discountPct}% popust)`;
  }

  // Score
  let score = 50;
  if (items.length >= 5) score += 20;
  if (isSameCategory) score += 15;
  if (potentialSavings > 100) score += 15;

  return {
    sellerName,
    listingCount: items.length,
    totalValue,
    avgPrice,
    minPrice,
    maxPrice,
    suggestedBulkPrice,
    potentialSavings,
    discountPct,
    isSameCategory,
    isBulkReseller,
    reason,
    score: Math.min(100, score),
    listings: items.slice(0, 10).map(l => ({
      id: l.id, title: l.title, price: l.price, priceText: l.priceText,
      url: l.url, location: l.location, imageUrl: l.imageUrl,
      dealScore: l.dealScore, source: l.monitor?.source,
    })),
  };
}
