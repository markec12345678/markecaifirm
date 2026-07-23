import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/listings/bookmark
 * Body: { id: string, isBookmarked: boolean }
 * Toggles bookmark on a listing
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isBookmarked } = body;
  if (!id) return NextResponse.json({ error: 'Manjka id' }, { status: 400 });

  const updated = await db.listing.update({
    where: { id },
    data: {
      isBookmarked: !!isBookmarked,
      bookmarkedAt: isBookmarked ? new Date() : null,
    },
  });
  return NextResponse.json({ ok: true, isBookmarked: updated.isBookmarked, bookmarkedAt: updated.bookmarkedAt });
}

/**
 * GET /api/listings/bookmark
 * Returns all bookmarked listings
 */
export async function GET() {
  const listings = await db.listing.findMany({
    where: { isBookmarked: true },
    orderBy: { bookmarkedAt: 'desc' },
    include: { monitor: { select: { name: true, source: true } } },
    take: 100,
  });
  return NextResponse.json(listings);
}
