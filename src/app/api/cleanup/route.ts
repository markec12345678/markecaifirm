import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/cleanup
 * Automatically archives old alerts and deletes old listings.
 * Called by cron endpoint when autoCleanupEnabled is true.
 *
 * Returns: { archivedAlerts, deletedListings }
 */
export async function POST() {
  const settings = await getSettingsRow();
  if (!settings.autoCleanupEnabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'auto-cleanup onemogočen' });
  }

  const now = new Date();
  const alertsCutoff = new Date(now.getTime() - settings.autoCleanupAlertsDays * 24 * 60 * 60 * 1000);
  const listingsCutoff = new Date(now.getTime() - settings.autoCleanupListingsDays * 24 * 60 * 60 * 1000);

  // Archive old alerts (not already archived)
  const archivedAlerts = await db.alert.updateMany({
    where: {
      createdAt: { lt: alertsCutoff },
      isArchived: false,
    },
    data: { isArchived: true, isRead: true },
  });

  // Delete old listings that are not bookmarked and not in trades
  // First, find listings to delete (check no active trades reference them)
  const oldListings = await db.listing.findMany({
    where: {
      firstSeenAt: { lt: listingsCutoff },
      isBookmarked: false,
      trades: { none: {} },
    },
    select: { id: true },
  });

  if (oldListings.length > 0) {
    const listingIds = oldListings.map(l => l.id);
    // Delete related data first
    await db.priceHistory.deleteMany({ where: { listingId: { in: listingIds } } });
    await db.alert.deleteMany({ where: { listingId: { in: listingIds } } });
    await db.listing.deleteMany({ where: { id: { in: listingIds } } });
  }

  return NextResponse.json({
    ok: true,
    archivedAlerts: archivedAlerts.count,
    deletedListings: oldListings.length,
    alertsCutoff: alertsCutoff.toISOString(),
    listingsCutoff: listingsCutoff.toISOString(),
  });
}
