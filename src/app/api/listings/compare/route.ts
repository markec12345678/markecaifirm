import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/listings/compare
 * Body: { ids: string[] } — up to 4 listing IDs
 * Returns detailed data for side-by-side comparison.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 4) : [];

  if (ids.length < 2) {
    return NextResponse.json({ error: 'Potrebna vsaj 2 listings za primerjavo' }, { status: 400 });
  }

  const listings = await db.listing.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      location: true, description: true, imageUrl: true, firstSeenAt: true,
      aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true,
      aiEstimatedValue: true, aiImageVerdict: true, aiImageAnalysis: true,
      isBookmarked: true, previousPrice: true, priceDroppedAt: true,
      sellerName: true, monitor: { select: { name: true, source: true } },
      priceHistory: {
        orderBy: { seenAt: 'asc' },
        select: { price: true, priceText: true, seenAt: true },
        take: 5,
      },
    },
  });

  // Sort by the order of IDs in the request
  const sorted = ids.map(id => listings.find(l => l.id === id)).filter(Boolean);

  return NextResponse.json({ listings: sorted });
}
