import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchListingDetail } from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/listings/:id/fetch-detail
 * Scrapes the full detail page of the listing (Bolha ad page) and saves:
 * - detailDescription (longer than listing description)
 * - detailImages (JSON array of all image URLs)
 * - detailFetchedAt
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await db.listing.findUnique({ where: { id }, select: { id: true, url: true, monitorId: true } });
  if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

  try {
    const detail = await fetchListingDetail(listing.url);
    const updated = await db.listing.update({
      where: { id: listing.id },
      data: {
        detailDescription: detail.fullDescription || null,
        detailImages: JSON.stringify(detail.images),
        detailFetchedAt: detail.fetchedAt,
      },
    });
    return NextResponse.json({
      ok: true,
      fullDescription: detail.fullDescription,
      images: detail.images,
      fetchedAt: detail.fetchedAt,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'Napaka pri pridobivanju detail page',
    }, { status: 200 });
  }
}
