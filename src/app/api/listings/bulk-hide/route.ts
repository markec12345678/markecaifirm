// v6.1: Bulk hide listings (used after deduplication to hide duplicates)
// POST /api/listings/bulk-hide
// Body: { listingIds: string[] }
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { listingIds } = body;
    if (!Array.isArray(listingIds) || listingIds.length === 0) {
      return NextResponse.json({ error: 'listingIds mora biti ne-prazen array' }, { status: 400 });
    }
    const result = await db.listing.updateMany({
      where: { id: { in: listingIds } },
      data: { isHidden: true, hiddenAt: new Date() },
    });
    return NextResponse.json({ ok: true, hidden: result.count });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
