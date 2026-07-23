import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/trades?status=held|sold|cancelled
 * Returns all trades, optionally filtered by status.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const where: any = {};
  if (status && ['held', 'sold', 'cancelled'].includes(status)) {
    where.status = status;
  }
  const trades = await db.trade.findMany({
    where,
    orderBy: { buyDate: 'desc' },
    include: { listing: { select: { id: true, title: true, url: true, imageUrl: true, monitor: { select: { name: true } } } } },
  });
  return NextResponse.json(trades);
}

/**
 * POST /api/trades
 * Create a new trade (manual or from listing).
 * Body: { listingId?, title, category, buyPrice, buyDate?, buyLocation?, buyFees?, notes?, imageUrl?, url? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.title || typeof body.buyPrice !== 'number') {
    return NextResponse.json({ error: 'Manjkajo title ali buyPrice' }, { status: 400 });
  }
  const trade = await db.trade.create({
    data: {
      listingId: body.listingId || null,
      title: String(body.title),
      category: String(body.category ?? ''),
      imageUrl: body.imageUrl ?? null,
      url: body.url ?? null,
      buyPrice: Number(body.buyPrice),
      buyDate: body.buyDate ? new Date(body.buyDate) : new Date(),
      buyLocation: String(body.buyLocation ?? ''),
      buyFees: Number(body.buyFees ?? 0),
      notes: String(body.notes ?? ''),
    },
  });
  return NextResponse.json(trade, { status: 201 });
}
