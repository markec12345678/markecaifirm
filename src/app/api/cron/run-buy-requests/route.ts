// v8.75: Cron — run all active BuyRequests, find new matches, notify user.
// GET /api/cron/run-buy-requests
// Runs each saved search, finds listings that match, stores new matches, creates notifications.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  try {
    const activeRequests = await db.buyRequest.findMany({
      where: { isActive: true },
      take: 50,
    });

    let totalNewMatches = 0;
    let totalNotifications = 0;
    const results: Array<{ requestId: string; title: string; newMatches: number; notified: boolean }> = [];

    for (const request of activeRequests) {
      try {
        // Build search query (same logic as /api/search/items)
        const where: any = { isHidden: false, price: { not: null, gt: 0 } };

        // Text search
        if (request.title.trim()) {
          const words = request.title.trim().split(/\s+/).filter(w => w.length > 0);
          if (words.length === 1) {
            where.OR = [
              { title: { contains: words[0] } },
              { description: { contains: words[0] } },
              { detailDescription: { contains: words[0] } },
            ];
          } else if (words.length > 1) {
            where.AND = words.map(w => ({
              OR: [
                { title: { contains: w } },
                { description: { contains: w } },
                { detailDescription: { contains: w } },
              ],
            }));
          }
        }

        // Price range
        if (request.priceMin || request.priceMax) {
          if (request.priceMin) where.price.gte = request.priceMin;
          if (request.priceMax) where.price.lte = request.priceMax;
        }

        // Category filter
        if (request.category) {
          where.monitor = { tags: { contains: request.category } };
        }

        // Location filter
        if (request.location.trim()) {
          where.location = { contains: request.location };
        }

        // Fetch matching listings
        const listings = await db.listing.findMany({
          where,
          select: { id: true, title: true, price: true, url: true, location: true, imageUrl: true,
            aiScore: true, aiVerdict: true, monitor: { select: { source: true } } },
          take: 20,
          orderBy: { firstSeenAt: 'desc' },
        });

        // Find NEW matches (not already in BuyRequestMatch)
        let newMatches = 0;
        for (const listing of listings) {
          const existing = await db.buyRequestMatch.findUnique({
            where: { buyRequestId_listingId: { buyRequestId: request.id, listingId: listing.id } },
          });
          if (!existing) {
            // New match! Store it.
            await db.buyRequestMatch.create({
              data: {
                buyRequestId: request.id,
                listingId: listing.id,
                matchPrice: listing.price,
                matchBuyScore: null, // TODO: compute buy score
                isNotified: false,
                isRead: false,
              },
            });
            newMatches++;
            totalNewMatches++;
          }
        }

        // Update request stats
        await db.buyRequest.update({
          where: { id: request.id },
          data: {
            lastRunAt: new Date(),
            newMatchesCount: { increment: newMatches },
          },
        });

        // Create notification if new matches found
        if (newMatches > 0) {
          try {
            const { createNotification } = await import('@/lib/notifications');
            await createNotification({
              type: 'buy_request_match',
              severity: newMatches >= 3 ? 'success' : 'info',
              source: 'system',
              title: `🔍 ${newMatches} ${newMatches === 1 ? 'nov oglas' : 'novih oglasov'} za "${request.title}"`,
              body: request.searchFor
                ? `${newMatches} novih ujemanj za iskanje "${request.title}" (iščeš za: ${request.searchFor}).`
                : `${newMatches} novih ujemanj za iskanje "${request.title}".`,
              metadata: {
                buyRequestId: request.id,
                newMatches,
                searchFor: request.searchFor || undefined,
              },
            });
            totalNotifications++;
          } catch { /* non-critical */ }
        }

        results.push({
          requestId: request.id,
          title: request.title,
          newMatches,
          notified: newMatches > 0,
        });
      } catch (err) {
        logger.error('/api/cron/run-buy-requests', `Failed for request ${request.id}`, err);
        results.push({ requestId: request.id, title: request.title, newMatches: 0, notified: false });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('/api/cron/run-buy-requests', `Completed: ${activeRequests.length} requests, ${totalNewMatches} new matches, ${totalNotifications} notifications in ${duration}ms`);

    return NextResponse.json({
      ok: true,
      processedRequests: activeRequests.length,
      totalNewMatches,
      totalNotifications,
      durationMs: duration,
      results,
    });

  } catch (err) {
    logger.error('/api/cron/run-buy-requests', 'Fatal error', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
