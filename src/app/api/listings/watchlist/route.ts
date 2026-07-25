// v4.6: Watchlist — oglasi, ki jih uporabnik spremlja (bookmarked ALI imajo targetPrice)
// GET /api/listings/watchlist
//   Query: ?sort=recent|target|price|score
//   Vrne: { watchlist: [...], stats: {...} }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') ?? 'recent';

  // Listings with bookmark OR target price set
  const where = {
    isHidden: false,
    OR: [
      { isBookmarked: true },
      { targetPrice: { not: null } },
    ],
  };

  let orderBy: any;
  switch (sort) {
    case 'target':
      // Soonest to hit target (price closest to target, above)
      orderBy = { targetPrice: 'asc' };
      break;
    case 'price':
      orderBy = { price: 'asc' };
      break;
    case 'score':
      orderBy = { aiScore: 'desc' };
      break;
    case 'recent':
    default:
      orderBy = { firstSeenAt: 'desc' };
      break;
  }

  const listings = await db.listing.findMany({
    where,
    orderBy,
    include: {
      monitor: { select: { name: true, source: true } },
      priceHistory: {
        orderBy: { seenAt: 'asc' },
        select: { id: true, price: true, priceText: true, seenAt: true },
        take: 50,
      },
    },
    take: 100,
  });

  // Stats
  const total = listings.length;
  const withTarget = listings.filter(l => l.targetPrice != null).length;
  const bookmarked = listings.filter(l => l.isBookmarked).length;
  const targetsHit = listings.filter(l =>
    l.targetPrice != null && l.price != null && l.price <= l.targetPrice
  ).length;
  const targetsAbove = withTarget - targetsHit;
  const priceDropPending = listings.filter(l =>
    l.targetPrice != null && l.price != null && l.price > l.targetPrice
  ).length;
  // How much below target (potential savings if all hit)
  const totalPotentialSavings = listings.reduce((sum, l) => {
    if (l.targetPrice != null && l.price != null && l.price > l.targetPrice) {
      return sum + (l.price - l.targetPrice);
    }
    return sum;
  }, 0);
  // Total value of all watchlist items (current price)
  const totalValue = listings.reduce((sum, l) => sum + (l.price ?? 0), 0);

  // Per-listing computed fields
  const enriched = listings.map(l => {
    const distanceToTarget = l.targetPrice != null && l.price != null
      ? l.price - l.targetPrice
      : null;
    const distancePct = l.targetPrice != null && l.price != null && l.price > 0
      ? Math.round((distanceToTarget! / l.price) * 100)
      : null;
    const targetHit = l.targetPrice != null && l.price != null && l.price <= l.targetPrice;
    const priceHistory = l.priceHistory ?? [];
    const lowestEver = priceHistory.length > 0
      ? Math.min(...priceHistory.map(p => p.price ?? Infinity), l.price ?? Infinity)
      : l.price ?? null;
    const highestEver = priceHistory.length > 0
      ? Math.max(...priceHistory.map(p => p.price ?? -Infinity), l.price ?? -Infinity)
      : l.price ?? null;

    return {
      id: l.id,
      title: l.title,
      price: l.price,
      priceText: l.priceText,
      url: l.url,
      location: l.location,
      imageUrl: l.imageUrl,
      firstSeenAt: l.firstSeenAt,
      // AI
      aiScore: l.aiScore,
      aiRisk: l.aiRisk,
      aiVerdict: l.aiVerdict,
      aiEstimatedValue: l.aiEstimatedValue,
      dealScore: l.dealScore,
      dealScoreReason: l.dealScoreReason,
      // Watchlist
      isBookmarked: l.isBookmarked,
      bookmarkedAt: l.bookmarkedAt,
      targetPrice: l.targetPrice,
      targetPriceSetAt: l.targetPriceSetAt,
      targetPriceAlertSent: l.targetPriceAlertSent,
      // Computed
      distanceToTarget,
      distancePct,
      targetHit,
      lowestEver,
      highestEver,
      priceHistoryCount: priceHistory.length,
      // Monitor
      monitor: l.monitor,
      // Contact
      contactStatus: l.contactStatus,
    };
  });

  return NextResponse.json({
    watchlist: enriched,
    stats: {
      total,
      withTarget,
      bookmarked,
      targetsHit,
      targetsAbove,
      priceDropPending,
      totalPotentialSavings,
      totalValue,
    },
  });
}
