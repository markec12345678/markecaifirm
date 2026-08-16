import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/trades?status=held|sold|cancelled&format=csv&category=elektronika&source=Bolha&search=iPhone&tag=flip
 * Returns trades, optionally filtered by status/category/source/search/tag, optionally as CSV.
 * v8.60: Added category, source, search query params for filtered CSV export.
 * v8.63: Added tag filter + tags parsed to array in response.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    const format = url.searchParams.get('format') ?? 'json';
    const category = url.searchParams.get('category') ?? undefined;
    const source = url.searchParams.get('source') ?? undefined;
    const search = url.searchParams.get('search') ?? undefined;
    const tag = url.searchParams.get('tag') ?? undefined;
    const where: any = {};
    if (status && ['held', 'sold', 'cancelled'].includes(status)) {
      where.status = status;
    }
    // v8.60: Category filter
    if (category) {
      where.category = { contains: category };
    }
    // v8.60: Source filter (buyLocation)
    if (source) {
      where.buyLocation = { contains: source };
    }
    // v8.63: Tag filter (contains match on comma-separated tags string)
    if (tag) {
      where.tags = { contains: tag };
    }
    // v8.60: Search filter (title OR notes OR tags)
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { notes: { contains: search } },
        { category: { contains: search } },
        { buyLocation: { contains: search } },
        { tags: { contains: search } },
      ];
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

    // v8.63: Parse tags string to array for convenience on the client
    const withTagsArray = trades.map(t => ({
      ...t,
      tagsArray: parseTags(t.tags),
    }));
    return NextResponse.json(withTagsArray);

  } catch (err) {
    logger.error("/api/trades", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

function tradesToCsv(trades: any[]): string {
  const headers = [
    'buyDate', 'sellDate', 'status', 'category', 'title',
    'buyPrice', 'buyFees', 'buyLocation',
    'sellPrice', 'sellFees', 'sellLocation',
    'profit', 'roiPercent', 'notes', 'url', 'tags',
    // v3.9: Davčne kategorije
    'davcnaKategorija', 'davcnaOznaka', 'brutoPrihodek', 'stroski', 'davcnaOsnova',
  ];
  const rows = trades.map(t => {
    const totalCost = t.buyPrice + (t.buyFees || 0);
    const revenue = t.sellPrice != null ? t.sellPrice - (t.sellFees || 0) : null;
    const profit = revenue != null ? revenue - totalCost : null;
    const roi = (profit != null && totalCost > 0) ? (profit / totalCost) * 100 : null;
    // v3.9: Davčne kategorije (Slovenija)
    const davcnaKategorija = t.status === 'sold' ? 'Dohodek iz preprodaje' : '';
    const davcnaOznaka = t.status === 'sold' ? 'Ostali dohodki' : '';
    const brutoPrihodek = t.sellPrice != null ? t.sellPrice : '';
    const stroski = totalCost + (t.sellFees || 0);
    const davcnaOsnova = profit != null && profit > 0 ? profit : 0;
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
      csvEscape(t.tags ?? ''),
      // v3.9
      davcnaKategorija,
      davcnaOznaka,
      brutoPrihodek,
      stroski,
      davcnaOsnova,
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

/** v8.63: Parse comma-separated tags string into a clean array. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
}

/** v8.63: Normalize an array of tags into a storage-ready comma-separated string. */
export function serializeTags(tags: string[] | string | null | undefined): string {
  if (!tags) return '';
  if (typeof tags === 'string') return tags;
  return tags.map(t => t.trim().toLowerCase()).filter(t => t.length > 0).join(',');
}

/**
 * POST /api/trades
 * Create a new trade (manual or from listing).
 * Body: { listingId?, title, category, buyPrice, buyDate?, buyLocation?, buyFees?, notes?, imageUrl?, url? }
 */
export async function POST(req: NextRequest) {
  try {
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
          tags: serializeTags(body.tags),
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
        tags: serializeTags(body.tags),
      },
    });
    return NextResponse.json(trade, { status: 201 });

  } catch (err) {
    logger.error("/api/trades", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
