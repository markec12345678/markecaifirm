import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings/:id
 * Returns full listing detail + similar listings + price history.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await db.listing.findUnique({
    where: { id },
    include: {
      monitor: { select: { name: true, source: true, id: true } },
      alerts: {
        select: {
          id: true, aiVerdict: true, aiScore: true, aiRisk: true,
          userAction: true, createdAt: true, isArchived: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      priceHistory: {
        orderBy: { seenAt: 'asc' },
        select: { id: true, price: true, priceText: true, seenAt: true },
      },
    },
  });
  if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

  // Parse detailImages JSON if present
  let detailImages: string[] = [];
  try {
    if (listing.detailImages) {
      detailImages = JSON.parse(listing.detailImages);
    }
  } catch { /* ignore */ }

  // Find similar listings: same monitor, similar price range (±30%), different id
  const price = listing.price;
  let similar: any[] = [];
  if (price != null) {
    const min = Math.floor(price * 0.7);
    const max = Math.ceil(price * 1.3);
    similar = await db.listing.findMany({
      where: {
        monitorId: listing.monitorId,
        id: { not: listing.id },
        price: { gte: min, lte: max },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 5,
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        aiScore: true, aiRisk: true, aiVerdict: true, firstSeenAt: true,
        imageUrl: true,
      },
    });
  }

  return NextResponse.json({
    listing: {
      ...listing,
      detailImages,
    },
    similar,
    priceHistory: listing.priceHistory,
  });
}
