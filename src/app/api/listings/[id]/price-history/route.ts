import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings/:id/price-history
 * Returns all price changes for a listing, ordered by time.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, title: true, price: true, priceText: true },
  });
  if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

  const history = await db.priceHistory.findMany({
    where: { listingId: id },
    orderBy: { seenAt: 'asc' },
  });

  return NextResponse.json({
    listing,
    history,
    priceChanges: history.length > 1 ? computeChanges(history) : [],
  });
}

function computeChanges(history: any[]): Array<{ from: number | null; to: number | null; fromText: string; toText: string; diff: number | null; pctChange: number | null; seenAt: string }> {
  const changes: any[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (prev.price !== curr.price || prev.priceText !== curr.priceText) {
      const diff = (curr.price != null && prev.price != null) ? curr.price - prev.price : null;
      const pctChange = (diff != null && prev.price != null && prev.price !== 0) ? (diff / prev.price) * 100 : null;
      changes.push({
        from: prev.price,
        to: curr.price,
        fromText: prev.priceText,
        toText: curr.priceText,
        diff,
        pctChange,
        seenAt: curr.seenAt,
      });
    }
  }
  return changes;
}
