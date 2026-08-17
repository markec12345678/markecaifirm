// v8.78: BuyRequest status — aggregate stats for dashboard card.
// GET /api/buy-requests/status → { activeCount, totalNewMatches, lastRunAt, topRequests, recentMatches }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const requests = await db.buyRequest.findMany({
      where: { isActive: true },
      orderBy: { newMatchesCount: 'desc' },
      take: 20,
    });

    const activeCount = requests.length;
    const totalNewMatches = requests.reduce((s, r) => s + r.newMatchesCount, 0);

    // Top 3 requests z največ novimi ujemanji
    const topRequests = requests
      .filter(r => r.newMatchesCount > 0)
      .slice(0, 3)
      .map(r => ({
        id: r.id,
        title: r.title,
        searchFor: r.searchFor,
        newMatchesCount: r.newMatchesCount,
        lastRunAt: r.lastRunAt,
        category: r.category,
        priceMax: r.priceMax,
      }));

    // Zadnje najdene ujemanje (najnovejše iz BuyRequestMatch)
    const recentMatch = await db.buyRequestMatch.findFirst({
      orderBy: { matchedAt: 'desc' },
      include: {
        listing: {
          select: {
            id: true, title: true, price: true, url: true, location: true,
            imageUrl: true, aiScore: true, aiVerdict: true,
            monitor: { select: { source: true } },
          },
        },
        buyRequest: {
          select: { id: true, title: true, searchFor: true },
        },
      },
    });

    // Skupno število vseh ujemanj (zgodovina)
    const totalMatchesAllTime = await db.buyRequestMatch.count();

    // Zadnji run (najnovejši lastRunAt med aktivnimi)
    const lastRunAt = requests
      .map(r => r.lastRunAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;

    return NextResponse.json({
      ok: true,
      activeCount,
      totalNewMatches,
      totalMatchesAllTime,
      lastRunAt,
      topRequests,
      recentMatch: recentMatch ? {
        matchedAt: recentMatch.matchedAt,
        matchPrice: recentMatch.matchPrice,
        listing: recentMatch.listing,
        buyRequest: recentMatch.buyRequest,
      } : null,
    });
  } catch (err) {
    logger.error('/api/buy-requests/status', 'GET failed', err);
    return NextResponse.json({ ok: false, error: 'Napaka' }, { status: 500 });
  }
}
