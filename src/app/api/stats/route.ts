import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [
      totalMonitors,
      activeMonitors,
      totalListings,
      totalAlerts,
      unreadAlerts,
      prilikaAlerts,
      sumnjivoAlerts,
      bookmarkedListings,
      contactedListings,
      priceDropCount,
      recentRuns,
    ] = await Promise.all([
      db.monitor.count(),
      db.monitor.count({ where: { isActive: true } }),
      db.listing.count(),
      db.alert.count(),
      db.alert.count({ where: { isRead: false, isArchived: false } }),
      db.alert.count({ where: { aiVerdict: 'PRILIKA' } }),
      db.alert.count({ where: { aiVerdict: 'SUMNJIVO' } }),
      db.listing.count({ where: { isBookmarked: true } }),
      // v3.1: Contacted listings
      db.listing.count({ where: { contactStatus: { in: ['contacted', 'responded'] } } }),
      // v3.1: Price drops
      db.listing.count({ where: { priceDroppedAt: { not: null } } }),
      db.runLog.findMany({
        take: 10,
        orderBy: { startedAt: 'desc' },
        include: { monitor: { select: { name: true } } },
      }),
    ]);

    // Monitor cards for dashboard
    const monitors = await db.monitor.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        source: true,
        isActive: true,
        lastRunAt: true,
        lastStatus: true,
        consecutiveErrors: true,
        _count: { select: { listings: true, alerts: true } },
      },
    });

    // Get new listings per monitor from last run
    const monitorCards = await Promise.all(
      monitors.map(async (m) => {
        const lastRun = await db.runLog.findFirst({
          where: { monitorId: m.id },
          orderBy: { startedAt: 'desc' },
          select: { newListings: true, listingsFound: true, alertsSent: true },
        });
        return {
          id: m.id,
          name: m.name,
          source: m.source,
          isActive: m.isActive,
          lastRunAt: m.lastRunAt?.toISOString() || null,
          lastStatus: m.lastStatus,
          newListings: lastRun?.newListings ?? 0,
          totalListings: m._count.listings,
          alertsSent: m._count.alerts,
          consecutiveErrors: m.consecutiveErrors,
        };
      })
    );

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const newListings24h = await db.listing.count({ where: { firstSeenAt: { gte: last24h } } });
    const newAlerts24h = await db.alert.count({ where: { createdAt: { gte: last24h } } });
    // v4.0: Today's stats
    const todayNewListings = await db.listing.count({ where: { firstSeenAt: { gte: todayStart } } });
    const todayNewAlerts = await db.alert.count({ where: { createdAt: { gte: todayStart } } });
    const todayPriceDrops = await db.listing.count({ where: { priceDroppedAt: { gte: todayStart } } });
    const todayRuns = await db.runLog.count({ where: { startedAt: { gte: todayStart } } });
    const todaySuccessfulRuns = await db.runLog.count({ where: { startedAt: { gte: todayStart }, status: 'ok' } });

    return NextResponse.json({
      totalMonitors,
      activeMonitors,
      totalListings,
      totalAlerts,
      unreadAlerts,
      prilikaAlerts,
      sumnjivoAlerts,
      bookmarkedListings,
      contactedListings,
      priceDropCount,
      newListings24h,
      newAlerts24h,
      today: {
        newListings: todayNewListings,
        newAlerts: todayNewAlerts,
        priceDrops: todayPriceDrops,
        runs: todayRuns,
        successfulRuns: todaySuccessfulRuns,
      },
      monitors: monitorCards,
      recentRuns,
    });

  } catch (err) {
    logger.error("/api/stats", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
