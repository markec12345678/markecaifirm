import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/listings/bulk
 * Body: { ids: string[], action: 'bookmark' | 'unbookmark' | 'delete' | 'contact' | 'clear_contact' }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  const action: string = body?.action;

  if (ids.length === 0) return NextResponse.json({ error: 'Manjkajo ids' }, { status: 400 });
  if (ids.length > 500) return NextResponse.json({ error: 'Maksimalno 500 naenkrat' }, { status: 400 });

  const valid = ['bookmark', 'unbookmark', 'delete', 'contact', 'clear_contact'];
  if (!valid.includes(action)) {
    return NextResponse.json({ error: `Neveljaven action: ${action}` }, { status: 400 });
  }

  try {
    let affected = 0;

    if (action === 'delete') {
      // Delete related data first
      await db.priceHistory.deleteMany({ where: { listingId: { in: ids } } });
      await db.alert.deleteMany({ where: { listingId: { in: ids } } });
      const result = await db.listing.deleteMany({ where: { id: { in: ids } } });
      affected = result.count;
    } else if (action === 'bookmark') {
      const result = await db.listing.updateMany({
        where: { id: { in: ids } },
        data: { isBookmarked: true, bookmarkedAt: new Date() },
      });
      affected = result.count;
    } else if (action === 'unbookmark') {
      const result = await db.listing.updateMany({
        where: { id: { in: ids } },
        data: { isBookmarked: false, bookmarkedAt: null },
      });
      affected = result.count;
    } else if (action === 'contact') {
      const result = await db.listing.updateMany({
        where: { id: { in: ids } },
        data: { contactStatus: 'contacted', contactedAt: new Date() },
      });
      affected = result.count;
    } else if (action === 'clear_contact') {
      const result = await db.listing.updateMany({
        where: { id: { in: ids } },
        data: { contactStatus: 'none', contactedAt: null, sellerResponse: null },
      });
      affected = result.count;
    }

    return NextResponse.json({ ok: true, action, affected });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
