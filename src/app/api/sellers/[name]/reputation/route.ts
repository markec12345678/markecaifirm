// v5.1: Seller reputation — analiza prodajalca (št. oglasov, povprečni čas, response rate)
// GET /api/sellers/:name/reputation
// Returns: { ok, seller: { name, listingsCount, activeListingsCount, avgPrice, sources, firstSeenAt, lastSeenAt, contactStats, alertStats, topListings, priceDropCount, aiVerdictBreakdown } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'Ime prodajalca je obvezno' }, { status: 400 });
    }

    // Find all listings by this seller
    const listings = await db.listing.findMany({
      where: { sellerName: name },
      orderBy: { firstSeenAt: 'desc' },
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        url: true,
        location: true,
        imageUrl: true,
        firstSeenAt: true,
        postedAt: true,
        aiVerdict: true,
        aiScore: true,
        aiRisk: true,
        aiEstimatedValue: true,
        dealScore: true,
        isBookmarked: true,
        isHidden: true,
        previousPrice: true,
        priceDroppedAt: true,
        contactStatus: true,
        contactedAt: true,
        monitor: { select: { name: true, source: true } },
        alerts: {
          select: { id: true, aiVerdict: true, createdAt: true, isRead: true, isArchived: true },
        },
        trades: {
          select: { id: true, status: true, buyPrice: true, sellPrice: true, sellDate: true },
        },
      },
      take: 500,
    });

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        seller: null,
        message: `Prodajalec "${name}" ni najden v bazi.`,
      });
    }

    // Aggregate stats
    const totalListings = listings.length;
    const activeListings = listings.filter(l => !l.isHidden).length;
    const hiddenListings = listings.filter(l => l.isHidden).length;
    const bookmarkedListings = listings.filter(l => l.isBookmarked).length;

    // Price stats (only listings with known price)
    const pricedListings = listings.filter(l => l.price != null);
    const prices = pricedListings.map(l => l.price!);
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
    const medianPrice = prices.length > 0
      ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
      : null;

    // Time stats
    const firstSeenAt = listings[listings.length - 1]?.firstSeenAt;
    const lastSeenAt = listings[0]?.firstSeenAt;
    const daysActive = firstSeenAt ? Math.round((Date.now() - firstSeenAt.getTime()) / (24 * 60 * 60 * 1000)) : 0;

    // Sources (which monitors/sources has this seller been seen on)
    const sourcesSet = new Set<string>();
    for (const l of listings) {
      if (l.monitor?.source) sourcesSet.add(l.monitor.source);
    }

    // Contact stats (across all listings)
    const contacted = listings.filter(l => l.contactStatus !== 'none').length;
    const responded = listings.filter(l => ['responded', 'closed'].includes(l.contactStatus)).length;
    const closed = listings.filter(l => l.contactStatus === 'closed').length;
    const contactRate = totalListings > 0 ? Math.round((contacted / totalListings) * 100) : 0;
    const responseRate = contacted > 0 ? Math.round((responded / contacted) * 100) : 0;

    // AI verdict breakdown
    const aiVerdicts: Record<string, number> = {};
    for (const l of listings) {
      if (l.aiVerdict) {
        aiVerdicts[l.aiVerdict] = (aiVerdicts[l.aiVerdict] || 0) + 1;
      }
    }

    // Alerts stats
    const totalAlerts = listings.reduce((s, l) => s + l.alerts.length, 0);
    const prilikaAlerts = listings.reduce((s, l) => s + l.alerts.filter(a => a.aiVerdict === 'PRILIKA').length, 0);
    const sumnjivoAlerts = listings.reduce((s, l) => s + l.alerts.filter(a => a.aiVerdict === 'SUMNJIVO').length, 0);

    // Price drops
    const priceDropCount = listings.filter(l => l.priceDroppedAt != null).length;

    // Trades (sold listings)
    const tradesList = listings.flatMap(l => l.trades.map(t => ({ ...t, listingTitle: l.title })));
    const soldTrades = tradesList.filter(t => t.status === 'sold');
    const avgSellTime = soldTrades.length > 0
      ? Math.round(soldTrades.reduce((s, t) => {
          if (!t.sellDate) return s;
          const listing = listings.find(l => l.trades.some(tt => tt.id === t.id));
          if (!listing?.firstSeenAt) return s;
          return s + (t.sellDate.getTime() - listing.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000);
        }, 0) / soldTrades.length)
      : null;

    // Top listings (best deal scores)
    const topListings = listings
      .filter(l => l.dealScore != null || l.aiScore != null)
      .sort((a, b) => (b.dealScore ?? 0) - (a.dealScore ?? 0) || (b.aiScore ?? 0) - (a.aiScore ?? 0))
      .slice(0, 5)
      .map(l => ({
        id: l.id,
        title: l.title,
        price: l.price,
        priceText: l.priceText,
        url: l.url,
        aiVerdict: l.aiVerdict,
        aiScore: l.aiScore,
        dealScore: l.dealScore,
        firstSeenAt: l.firstSeenAt,
        isBookmarked: l.isBookmarked,
        monitor: l.monitor,
      }));

    // Reputation score (0-100) — heuristic
    let reputationScore = 50; // baseline
    // More listings = more established
    if (totalListings >= 10) reputationScore += 10;
    if (totalListings >= 50) reputationScore += 10;
    // Response rate
    if (contactRate > 0 && responseRate > 0) {
      reputationScore += Math.min(20, responseRate / 5);
    }
    // Lots of PRILIKA alerts = good seller (lots of deals)
    if (prilikaAlerts > 0) reputationScore += Math.min(10, prilikaAlerts);
    // Lots of SUMNJIVO alerts = bad seller
    if (sumnjivoAlerts > 0) reputationScore -= Math.min(20, sumnjivoAlerts * 2);
    // Sold trades = reliable
    if (soldTrades.length > 0) reputationScore += Math.min(10, soldTrades.length);
    // Long history = established
    if (daysActive > 30) reputationScore += 5;
    if (daysActive > 180) reputationScore += 5;
    reputationScore = Math.max(0, Math.min(100, Math.round(reputationScore)));

    // Tier label
    let tier = 'Novinec';
    if (reputationScore >= 80) tier = 'Odličen';
    else if (reputationScore >= 65) tier = 'Dober';
    else if (reputationScore >= 45) tier = 'Povprečen';
    else if (reputationScore >= 25) tier = 'Tvegan';
    else tier = 'Nezanesljiv';

    return NextResponse.json({
      ok: true,
      seller: {
        name,
        reputationScore,
        tier,
        listingsCount: totalListings,
        activeListingsCount: activeListings,
        hiddenListingsCount: hiddenListings,
        bookmarkedCount: bookmarkedListings,
        avgPrice,
        minPrice,
        maxPrice,
        medianPrice,
        firstSeenAt,
        lastSeenAt,
        daysActive,
        sources: Array.from(sourcesSet),
        contactStats: {
          contacted,
          responded,
          closed,
          contactRate,
          responseRate,
        },
        alertStats: {
          total: totalAlerts,
          prilika: prilikaAlerts,
          sumnjivo: sumnjivoAlerts,
        },
        aiVerdictBreakdown: aiVerdicts,
        priceDropCount,
        tradesStats: {
          total: tradesList.length,
          sold: soldTrades.length,
          avgSellTimeDays: avgSellTime,
        },
        topListings,
      },
    });

  } catch (err) {
    logger.error("/api/sellers/[name]/reputation", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
