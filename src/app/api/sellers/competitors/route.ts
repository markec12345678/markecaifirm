// v6.4: Competitor Seller Tracking — spremljaj druge prodajalce v tvoji niši
// GET /api/sellers/competitors
// Returns: { ok, competitors: Array<{ sellerName, listingCount, avgPrice, priceDrops, lastSeen, threatLevel }> }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Find all sellers with 2+ listings (potential competitors)
    const sellers = await db.listing.findMany({
      where: { sellerName: { not: null }, isHidden: false },
      select: {
        id: true, sellerName: true, title: true, price: true, priceText: true,
        url: true, firstSeenAt: true, priceDroppedAt: true, previousPrice: true,
        aiVerdict: true, dealScore: true, monitor: { select: { source: true, name: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 2000,
    });

    // Group by seller
    const sellerMap: Record<string, any[]> = {};
    for (const l of sellers) {
      if (!l.sellerName) continue;
      if (!sellerMap[l.sellerName]) sellerMap[l.sellerName] = [];
      sellerMap[l.sellerName].push(l);
    }

    // Calculate stats per seller
    const competitors = Object.entries(sellerMap)
      .filter(([_, items]) => items.length >= 2) // Only sellers with 2+ listings
      .map(([sellerName, items]) => {
        const prices = items.map(l => l.price).filter(Boolean) as number[];
        const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
        const priceDrops = items.filter(l => l.priceDroppedAt != null).length;
        const lastSeen = items[0]?.firstSeenAt;
        const firstSeen = items[items.length - 1]?.firstSeenAt;
        const daysActive = firstSeen ? Math.round((Date.now() - firstSeen.getTime()) / (24 * 60 * 60 * 1000)) : 0;
        const sources = Array.from(new Set(items.map(l => l.monitor?.source).filter(Boolean)));
        const prilikaCount = items.filter(l => l.aiVerdict === 'PRILIKA').length;
        const sumnjivoCount = items.filter(l => l.aiVerdict === 'SUMNJIVO').length;

        // Threat level: how much competition does this seller represent?
        let threatLevel: 'low' | 'medium' | 'high';
        let threatScore: number;
        if (items.length >= 10 && priceDrops > 2) {
          threatLevel = 'high';
          threatScore = 80;
        } else if (items.length >= 5 || priceDrops > 0) {
          threatLevel = 'medium';
          threatScore = 50;
        } else {
          threatLevel = 'low';
          threatScore = 20;
        }

        // Activity level
        const recentListings = items.filter(l => {
          const days = (Date.now() - l.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000);
          return days <= 7;
        }).length;

        return {
          sellerName,
          listingCount: items.length,
          avgPrice,
          minPrice,
          maxPrice,
          priceDrops,
          priceDropPct: items.length > 0 ? Math.round((priceDrops / items.length) * 100) : 0,
          lastSeen,
          firstSeen,
          daysActive,
          sources,
          prilikaCount,
          sumnjivoCount,
          threatLevel,
          threatScore,
          recentListings,
          recentActivity: recentListings > 0 ? 'active' : 'inactive',
          topListings: items.slice(0, 3).map(l => ({
            title: l.title, price: l.price, priceText: l.priceText, url: l.url,
            dealScore: l.dealScore, source: l.monitor?.source,
          })),
        };
      })
      .sort((a, b) => b.threatScore - a.threatScore || b.listingCount - a.listingCount);

    return NextResponse.json({
      ok: true,
      competitors: competitors.slice(0, 50),
      totalSellers: Object.keys(sellerMap).length,
      activeCompetitors: competitors.filter(c => c.recentActivity === 'active').length,
      highThreatCount: competitors.filter(c => c.threatLevel === 'high').length,
    });

  } catch (err) {
    logger.error("/api/sellers/competitors", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
