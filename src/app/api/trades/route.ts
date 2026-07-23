import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/trades?status=held|sold|cancelled&format=csv
 * Returns all trades, optionally filtered by status, optionally as CSV.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const format = url.searchParams.get('format') ?? 'json';
  const where: any = {};
  if (status && ['held', 'sold', 'cancelled'].includes(status)) {
    where.status = status;
  }
  const trades = await db.trade.findMany({
    where,
    orderBy: { buyDate: 'desc' },
    include: { listing: { select: { id: true, title: true, url: true, imageUrl: true, monitor: { select: { name: true } } } } },
  });

  if (format === 'csv') {
    const csv = tradesToCsv(trades);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="trades-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json(trades);
}

function tradesToCsv(trades: any[]): string {
  const headers = [
    'buyDate', 'sellDate', 'status', 'category', 'title',
    'buyPrice', 'buyFees', 'buyLocation',
    'sellPrice', 'sellFees', 'sellLocation',
    'profit', 'roiPercent', 'notes', 'url',
  ];
  const rows = trades.map(t => {
    const totalCost = t.buyPrice + (t.buyFees || 0);
    const revenue = t.sellPrice != null ? t.sellPrice - (t.sellFees || 0) : null;
    const profit = revenue != null ? revenue - totalCost : null;
    const roi = (profit != null && totalCost > 0) ? (profit / totalCost) * 100 : null;
    return [
      t.buyDate ? new Date(t.buyDate).toISOString().slice(0, 10) : '',
      t.sellDate ? new Date(t.sellDate).toISOString().slice(0, 10) : '',
      t.status,
      csvEscape(t.category ?? ''),
      csvEscape(t.title ?? ''),
      t.buyPrice ?? '',
      t.buyFees ?? 0,
      csvEscape(t.buyLocation ?? ''),
      t.sellPrice ?? '',
      t.sellFees ?? 0,
      csvEscape(t.sellLocation ?? ''),
      profit != null ? profit.toFixed(2) : '',
      roi != null ? roi.toFixed(2) : '',
      csvEscape(t.notes ?? ''),
      csvEscape(t.url ?? ''),
    ];
  });
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function csvEscape(s: string): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * POST /api/trades
 * Create a new trade (manual or from listing).
 * Body: { listingId?, title, category, buyPrice, buyDate?, buyLocation?, buyFees?, notes?, imageUrl?, url? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  // v1.7: Support "convert from listing" mode
  if (body?.fromListingId) {
    const listing = await db.listing.findUnique({
      where: { id: body.fromListingId },
      select: { id: true, title: true, url: true, imageUrl: true, price: true, priceText: true, monitor: { select: { name: true } } },
    });
    if (!listing) {
      return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    }
    // Parse price from listing (use AI estimated value if available, otherwise listing price)
    const buyPrice = body.buyPrice ?? listing.price ?? 0;
    const trade = await db.trade.create({
      data: {
        listingId: listing.id,
        title: listing.title,
        category: body.category ?? '',
        imageUrl: listing.imageUrl,
        url: listing.url,
        buyPrice: Number(buyPrice),
        buyDate: body.buyDate ? new Date(body.buyDate) : new Date(),
        buyLocation: body.buyLocation ?? listing.monitor?.name ?? 'Bolha',
        buyFees: Number(body.buyFees ?? 0),
        notes: body.notes ?? '',
      },
    });
    return NextResponse.json(trade, { status: 201 });
  }

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
