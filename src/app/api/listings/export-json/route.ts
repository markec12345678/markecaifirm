import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings/export-json
 * Exports all listings with AI data as JSON for external analysis.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const monitorId = url.searchParams.get('monitorId') ?? undefined;

    const where: any = {};
    if (monitorId) where.monitorId = monitorId;

    const listings = await db.listing.findMany({
      where,
      orderBy: { firstSeenAt: 'desc' },
      take: 500,
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, description: true, imageUrl: true, firstSeenAt: true,
        aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true,
        aiEstimatedValue: true, aiImageVerdict: true, aiImageAnalysis: true,
        isBookmarked: true, contactStatus: true, contactedAt: true,
        previousPrice: true, priceDroppedAt: true, sellerName: true, userNotes: true,
        monitor: { select: { name: true, source: true } },
        priceHistory: {
          orderBy: { seenAt: 'asc' },
          select: { price: true, priceText: true, seenAt: true },
        },
      },
    });

    const exportData = {
      version: '3.3',
      exportedAt: new Date().toISOString(),
      totalListings: listings.length,
      listings: listings.map(l => ({
        ...l,
        firstSeenAt: l.firstSeenAt?.toISOString(),
        priceDroppedAt: l.priceDroppedAt?.toISOString(),
        contactedAt: l.contactedAt?.toISOString(),
        priceHistory: l.priceHistory.map(ph => ({ ...ph, seenAt: ph.seenAt.toISOString() })),
      })),
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="markec-listings-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });

  } catch (err) {
    logger.error("/api/listings/export-json", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
