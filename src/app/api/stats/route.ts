import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
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

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const newListings24h = await db.listing.count({ where: { firstSeenAt: { gte: last24h } } });
  const newAlerts24h = await db.alert.count({ where: { createdAt: { gte: last24h } } });

  return NextResponse.json({
    totalMonitors,
    activeMonitors,
    totalListings,
    totalAlerts,
    unreadAlerts,
    prilikaAlerts,
    sumnjivoAlerts,
    bookmarkedListings,
    // v3.1: New stats
    contactedListings,
    priceDropCount,
    newListings24h,
    newAlerts24h,
    recentRuns,
  });
}
