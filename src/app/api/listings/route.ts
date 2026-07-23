import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings
 * Query params:
 *   monitorId     — filter by monitor
 *   verdict       — PRILIKA | SUMNJIVO | NEZANIMIVO
 *   minScore      — minimum AI score
 *   maxRisk       — maximum AI risk
 *   hasImage      — "1" only listings with imageUrl
 *   limit         — default 100, max 500
 *   offset        — pagination
 *   sort          — "firstSeen" (default), "score", "price", "risk"
 *   order         — "desc" (default), "asc"
 *   format        — "csv" for CSV export, "json" (default)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const monitorId = url.searchParams.get('monitorId') ?? undefined;
  const verdict = url.searchParams.get('verdict') ?? undefined;
  const minScore = url.searchParams.get('minScore') ? parseInt(url.searchParams.get('minScore')!, 10) : undefined;
  const maxRisk = url.searchParams.get('maxRisk') ? parseInt(url.searchParams.get('maxRisk')!, 10) : undefined;
  const hasImage = url.searchParams.get('hasImage') === '1' ? true : undefined;
  const bookmarked = url.searchParams.get('bookmarked') === '1' ? true : undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const sortField = url.searchParams.get('sort') ?? 'firstSeen';
  const sortOrder = url.searchParams.get('order') ?? 'desc';
  const format = url.searchParams.get('format') ?? 'json';

  const where: any = {};
  if (monitorId) where.monitorId = monitorId;
  if (verdict) where.aiVerdict = verdict;
  if (minScore != null) where.aiScore = { gte: minScore };
  if (maxRisk != null) where.aiRisk = { lte: maxRisk };
  if (hasImage) where.NOT = { imageUrl: null };
  if (bookmarked) where.isBookmarked = true;

  const orderBy: any = {
    firstSeen: 'firstSeenAt',
    score: 'aiScore',
    price: 'price',
    risk: 'aiRisk',
  }[sortField] ?? 'firstSeenAt';

  const listings = await db.listing.findMany({
    where,
    orderBy: { [orderBy]: sortOrder === 'asc' ? 'asc' : 'desc' },
    take: limit,
    skip: offset,
    include: { monitor: { select: { name: true, source: true } } },
  });

  if (format === 'csv') {
    const csv = listingsToCsv(listings);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="listings-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // For JSON, also return total count for pagination
  const total = await db.listing.count({ where });
  return NextResponse.json({ listings, total, offset, limit });
}

function listingsToCsv(listings: any[]): string {
  const headers = [
    'firstSeenAt', 'monitor', 'source', 'title', 'price', 'priceText',
    'location', 'url', 'aiScore', 'aiRisk', 'aiVerdict', 'aiReason',
    'aiEstimatedValue', 'aiImageVerdict', 'aiImageAnalysis',
  ];
  const rows = listings.map(l => [
    l.firstSeenAt?.toISOString() ?? '',
    csvEscape(l.monitor?.name ?? ''),
    csvEscape(l.monitor?.source ?? ''),
    csvEscape(l.title ?? ''),
    l.price ?? '',
    csvEscape(l.priceText ?? ''),
    csvEscape(l.location ?? ''),
    csvEscape(l.url ?? ''),
    l.aiScore ?? '',
    l.aiRisk ?? '',
    l.aiVerdict ?? '',
    csvEscape(l.aiReason ?? ''),
    l.aiEstimatedValue ?? '',
    l.aiImageVerdict ?? '',
    csvEscape(l.aiImageAnalysis ?? ''),
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function csvEscape(s: string): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
