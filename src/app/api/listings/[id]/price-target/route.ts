// v8.51: Price Target Alert — set target price on a listing.
// When listing price drops to/below target, user gets notified.
// Listing model already has: targetPrice Int?, targetPriceSetAt DateTime?, targetPriceAlertSent Boolean

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * POST /api/listings/[id]/price-target
 * Body: { targetPrice: number } — set price target for this listing
 * Body: { targetPrice: null } — clear price target
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const targetPrice = body.targetPrice;

    if (targetPrice !== null && (typeof targetPrice !== 'number' || targetPrice < 0)) {
      return NextResponse.json({ ok: false, error: 'targetPrice mora biti pozitivno število ali null' }, { status: 400 });
    }

    const listing = await db.listing.findUnique({ where: { id }, select: { title: true, price: true } });
    if (!listing) {
      return NextResponse.json({ ok: false, error: 'Listing ni najden' }, { status: 404 });
    }

    await db.listing.update({
      where: { id },
      data: {
        targetPrice: targetPrice ?? null,
        targetPriceSetAt: targetPrice ? new Date() : null,
        targetPriceAlertSent: false, // reset alert flag when setting new target
      },
    });

    logger.info('/api/listings/[id]/price-target', `set target ${targetPrice}€ on listing ${id}`);

    return NextResponse.json({
      ok: true,
      listingId: id,
      title: listing.title,
      currentPrice: listing.price,
      targetPrice,
      message: targetPrice
        ? `🎯 Price target nastavljen: ${targetPrice}€ (trenutna cena: ${listing.price ?? '?'}€)`
        : 'Price target počiščen',
    });
  } catch (err: any) {
    logger.error('/api/listings/[id]/price-target', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
