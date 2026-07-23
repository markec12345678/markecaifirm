import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=<query>&limit=20
 * Search across listings and alerts by title/description/url.
 * Returns combined results.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50);

  if (q.length < 2) {
    return NextResponse.json({ listings: [], alerts: [], q });
  }

  // SQLite LIKE is case-insensitive for ASCII, but we use lowercase for safety
  const pattern = `%${q}%`;

  const [listings, alerts] = await Promise.all([
    db.listing.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
          { url: { contains: q } },
          { location: { contains: q } },
        ],
      },
      orderBy: { firstSeenAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, imageUrl: true, firstSeenAt: true,
        aiScore: true, aiRisk: true, aiVerdict: true,
        monitor: { select: { name: true } },
      },
    }),
    db.alert.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { body: { contains: q } },
          { url: { contains: q } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, url: true, createdAt: true,
        aiScore: true, aiRisk: true, aiVerdict: true,
        isArchived: true, userAction: true,
        monitor: { select: { name: true } },
      },
    }),
  ]);

  // Suppress unused variable warning
  void pattern;

  return NextResponse.json({ listings, alerts, q, total: listings.length + alerts.length });
}
