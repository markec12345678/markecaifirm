// v7.57: Competitor Listing Tracker — sledi oglasom prodajalcev, od katerih si kupoval.
//
// "Janez Novak — 23 oglasov, 4 kupljene od njega, 1.250€ skupaj porabljenih.
//  Povprečno 3 oglase na teden — njegov katalog je vreden spremljanja!"
//
// Sledi "konkurentom"/dobaviteljem (sellerjem od katerih si kupoval):
// - kaj prodajajo, povprečne cene, kako pogosto objavljajo
// - katere kategorije pokrivajo
// - relationship: SUPPLIER (2+ nakupa) | ONE_TIME | WATCHED
//
// GET /api/analytics/competitor-tracker

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;
const MAX_COMPETITORS_RETURNED = 20;
const SUPPLIER_THRESHOLD = 2; // 2+ purchases = SUPPLIER

interface Competitor {
  sellerName: string;
  relationship: 'SUPPLIER' | 'ONE_TIME' | 'WATCHED';
  totalListings: number;
  purchasesFromThem: number;
  totalSpent: number;
  avgPrice: number;
  categoriesSold: string[];
  firstSeen: string;
  lastSeen: string;
  listingFrequencyPerWeek: number;
  recentListings: Array<{
    title: string;
    price: number;
    url: string;
    firstSeenAt: string;
  }>;
}

export async function GET() {
  try {
    // 1) Query all SOLD/HELD trades with a linked Listing (to extract sellerName)
    const tradesWithListing = await db.trade.findMany({
      where: {
        status: { in: ['sold', 'held'] },
        listing: { isNot: null },
      },
      select: {
        id: true,
        buyPrice: true,
        category: true,
        listing: {
          select: {
            sellerName: true,
          },
        },
      },
      take: 2000,
    });

    // 2) Extract unique seller names (only non-null sellers)
    const sellerToPurchases = new Map<
      string,
      { count: number; totalSpent: number; categories: Set<string> }
    >();

    for (const t of tradesWithListing) {
      const seller = t.listing?.sellerName;
      if (!seller || seller.trim() === '') continue;
      const cur = sellerToPurchases.get(seller) || {
        count: 0,
        totalSpent: 0,
        categories: new Set<string>(),
      };
      cur.count += 1;
      cur.totalSpent += t.buyPrice;
      if (t.category && t.category.trim() !== '') {
        cur.categories.add(t.category.trim());
      }
      sellerToPurchases.set(seller, cur);
    }

    // Graceful handling: no sellers tracked yet
    if (sellerToPurchases.size === 0) {
      return NextResponse.json({
        ok: true,
        competitors: [],
        summary: {
          totalCompetitors: 0,
          suppliers: 0,
          oneTimeSellers: 0,
          watchedOnly: 0,
          totalSpentWithSuppliers: 0,
          topSupplier: null,
        },
        message:
          'Ni sledenih prodajalcev — sellerName ni populiran na nobenem od vaših Listingov. Predlagaj Bolha/Vinted detaljni scraper naj izvleče ime prodajalca.',
      });
    }

    // 3) For each seller (competitor), query all their Listings across all monitors
    const sellerNames = Array.from(sellerToPurchases.keys());

    // Single batched query for all seller listings (much faster than N+1)
    const allSellerListings = await db.listing.findMany({
      where: {
        sellerName: { in: sellerNames },
        isHidden: false,
      },
      select: {
        sellerName: true,
        title: true,
        price: true,
        url: true,
        firstSeenAt: true,
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 5000,
    });

    // Group seller listings
    const sellerListingsMap = new Map<
      string,
      Array<{ title: string; price: number | null; url: string; firstSeenAt: Date }>
    >();
    for (const l of allSellerListings) {
      if (!l.sellerName) continue;
      const cur = sellerListingsMap.get(l.sellerName) || [];
      cur.push({
        title: l.title,
        price: l.price,
        url: l.url,
        firstSeenAt: l.firstSeenAt,
      });
      sellerListingsMap.set(l.sellerName, cur);
    }

    // 4) Build competitor entries
    const competitors: Competitor[] = [];
    for (const [sellerName, purchaseData] of sellerToPurchases.entries()) {
      const listings = sellerListingsMap.get(sellerName) || [];

      // relationship: SUPPLIER if 2+ purchases, ONE_TIME if 1 purchase
      const relationship: Competitor['relationship'] =
        purchaseData.count >= SUPPLIER_THRESHOLD
          ? 'SUPPLIER'
          : 'ONE_TIME';

      // Compute avg price across their listings
      const prices = listings.map(l => l.price).filter((p): p is number => p != null);
      const avgPrice = prices.length > 0
        ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
        : 0;

      // Categories — combine trade categories with derived categories from listing titles
      const categoriesSold = Array.from(purchaseData.categories);
      // Optionally enrich with simple category hints from listing titles (top 5)
      for (const l of listings.slice(0, 50)) {
        const lower = l.title.toLowerCase();
        const hints: Array<[string, RegExp]> = [
          ['elektronika', /iphone|samsung|laptop|telefon|tablet|tv|monitor/],
          ['avto', /\bavto\b|motor|kolo|gume/],
          ['pohistvo', /miza|stol|omara|postelja|kavč/],
          ['orodje', /vijačnik|buldog|žaga|klešče|kladivo/],
          ['moda', /hlače|majica|jakna|čevlji|oblačila/],
        ];
        for (const [cat, re] of hints) {
          if (re.test(lower) && !categoriesSold.includes(cat)) {
            categoriesSold.push(cat);
          }
        }
      }

      // Compute listing frequency per week
      let listingFrequencyPerWeek = 0;
      if (listings.length >= 2) {
        const times = listings.map(l => l.firstSeenAt.getTime()).sort((a, b) => a - b);
        const earliest = times[0];
        const latest = times[times.length - 1];
        const spanDays = Math.max(1, (latest - earliest) / DAY_MS);
        const weeks = spanDays / 7;
        listingFrequencyPerWeek = Math.round((listings.length / weeks) * 10) / 10;
      } else if (listings.length === 1) {
        // single listing — assume 1 listing per week if recently seen
        const ageDays = (Date.now() - listings[0].firstSeenAt.getTime()) / DAY_MS;
        if (ageDays < 14) listingFrequencyPerWeek = 1;
      }

      // recentListings — most recent 5
      const recentListings = listings.slice(0, 5).map(l => ({
        title: l.title,
        price: l.price ?? 0,
        url: l.url,
        firstSeenAt: l.firstSeenAt.toISOString(),
      }));

      // firstSeen / lastSeen from listings
      let firstSeenISO = '';
      let lastSeenISO = '';
      if (listings.length > 0) {
        const times = listings.map(l => l.firstSeenAt.getTime()).sort((a, b) => a - b);
        firstSeenISO = new Date(times[0]).toISOString();
        lastSeenISO = new Date(times[times.length - 1]).toISOString();
      } else {
        // No listings tracked — use current timestamp as fallback
        firstSeenISO = new Date().toISOString();
        lastSeenISO = new Date().toISOString();
      }

      competitors.push({
        sellerName,
        relationship,
        totalListings: listings.length,
        purchasesFromThem: purchaseData.count,
        totalSpent: Math.round(purchaseData.totalSpent),
        avgPrice,
        categoriesSold: categoriesSold.slice(0, 10),
        firstSeen: firstSeenISO,
        lastSeen: lastSeenISO,
        listingFrequencyPerWeek,
        recentListings,
      });
    }

    // 5) Also add WATCHED competitors: sellers we've seen (in Listings) but never bought from
    //    This is sellers whose listings we bookmark/contact but never turned into trades.
    //    (We already query only sellers we purchased from in step 1; to find "watched" sellers
    //    we'd need to query all bookmarked/contacted listings — let's do that.)
    const watchedListings = await db.listing.findMany({
      where: {
        sellerName: { not: null },
        isHidden: false,
        OR: [
          { isBookmarked: true },
          { contactStatus: { not: 'none' } },
        ],
      },
      select: {
        sellerName: true,
        title: true,
        price: true,
        url: true,
        firstSeenAt: true,
        isBookmarked: true,
        contactStatus: true,
      },
      take: 2000,
    });

    const watchedSellerMap = new Map<
      string,
      Array<{ title: string; price: number | null; url: string; firstSeenAt: Date }>
    >();
    for (const l of watchedListings) {
      const seller = l.sellerName;
      if (!seller || seller.trim() === '') continue;
      // Skip if already a supplier/one-time seller
      if (sellerToPurchases.has(seller)) continue;
      const cur = watchedSellerMap.get(seller) || [];
      cur.push({
        title: l.title,
        price: l.price,
        url: l.url,
        firstSeenAt: l.firstSeenAt,
      });
      watchedSellerMap.set(seller, cur);
    }

    // Build WATCHED competitors (top 5 by listing count, to avoid flooding response)
    const watchedCompetitors: Competitor[] = [];
    for (const [sellerName, listings] of watchedSellerMap.entries()) {
      const prices = listings.map(l => l.price).filter((p): p is number => p != null);
      const avgPrice = prices.length > 0
        ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
        : 0;

      let listingFrequencyPerWeek = 0;
      if (listings.length >= 2) {
        const times = listings.map(l => l.firstSeenAt.getTime()).sort((a, b) => a - b);
        const spanDays = Math.max(1, (times[times.length - 1] - times[0]) / DAY_MS);
        listingFrequencyPerWeek = Math.round((listings.length / (spanDays / 7)) * 10) / 10;
      }

      const times = listings.map(l => l.firstSeenAt.getTime()).sort((a, b) => a - b);
      watchedCompetitors.push({
        sellerName,
        relationship: 'WATCHED',
        totalListings: listings.length,
        purchasesFromThem: 0,
        totalSpent: 0,
        avgPrice,
        categoriesSold: [],
        firstSeen: new Date(times[0]).toISOString(),
        lastSeen: new Date(times[times.length - 1]).toISOString(),
        listingFrequencyPerWeek,
        recentListings: listings.slice(0, 5).map(l => ({
          title: l.title,
          price: l.price ?? 0,
          url: l.url,
          firstSeenAt: l.firstSeenAt.toISOString(),
        })),
      });
    }

    // Sort: SUPPLIERS + ONE_TIME by totalSpent desc, then WATCHED by listing count desc
    competitors.sort((a, b) => b.totalSpent - a.totalSpent);
    watchedCompetitors.sort((a, b) => b.totalListings - a.totalListings);

    const combined = [
      ...competitors,
      ...watchedCompetitors.slice(0, 5),
    ].slice(0, MAX_COMPETITORS_RETURNED);

    // 6) Summary
    const suppliers = competitors.filter(c => c.relationship === 'SUPPLIER');
    const oneTimeSellers = competitors.filter(c => c.relationship === 'ONE_TIME');
    const totalSpentWithSuppliers = suppliers.reduce((s, c) => s + c.totalSpent, 0);
    const topSupplier = suppliers.length > 0 ? suppliers[0].sellerName : null;

    return NextResponse.json({
      ok: true,
      competitors: combined,
      summary: {
        totalCompetitors: combined.length,
        suppliers: suppliers.length,
        oneTimeSellers: oneTimeSellers.length,
        watchedOnly: watchedCompetitors.length,
        totalSpentWithSuppliers: Math.round(totalSpentWithSuppliers),
        topSupplier,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/competitor-tracker', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
