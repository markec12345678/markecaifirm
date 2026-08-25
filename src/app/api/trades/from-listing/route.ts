// v8.51: Quick Trade iz Listing — create Trade record from Listing data.
// Uporabnik vidi oglas na Bolha → klikne "Kupi kot trade" → Trade se samodejno
// ustvari z izpolnjenimi title, buyPrice, buyLocation, url, category.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const listingId = body.listingId;
    if (!listingId) {
      return NextResponse.json({ ok: false, error: 'listingId je obvezen' }, { status: 400 });
    }

    const listing = await db.listing.findUnique({
      where: { id: listingId },
      include: { monitor: { select: { name: true, source: true } } },
    });

    if (!listing) {
      return NextResponse.json({ ok: false, error: 'Listing ni najden' }, { status: 404 });
    }

    const buyPrice = typeof body.buyPrice === 'number' ? body.buyPrice : (listing.price ?? 0);
    if (buyPrice <= 0) {
      return NextResponse.json({ ok: false, error: 'buyPrice mora biti > 0 (listing nima cene — podaj ročno)' }, { status: 400 });
    }

    const monitorSource = listing.monitor?.source || listing.monitor?.name || 'Bolha';
    const buyLocation = monitorSource.charAt(0).toUpperCase() + monitorSource.slice(1);
    const category = (listing as any).category || '';

    const trade = await db.trade.create({
      data: {
        title: listing.title,
        category,
        buyPrice,
        buyFees: 0,
        buyDate: new Date(),
        buyLocation,
        status: 'held',
        listingId: listing.id,
        url: listing.url,
        imageUrl: listing.imageUrl,
        notes: `Samodejno ustvarjeno iz oglasa: ${listing.url}`,
      },
    });

    logger.info('/api/trades/from-listing', `created trade from listing ${listingId}`, { tradeId: trade.id, buyPrice });

    await createNotification({
      type: 'system',
      title: `🛒 Trade ustvarjen iz oglasa: ${listing.title.substring(0, 50)}`,
      body: `Kupljeno za ${buyPrice}€ na ${buyLocation}. Status: held. URL: ${listing.url}`,
      severity: 'success',
      source: 'system',
      metadata: { listingId, tradeId: trade.id, buyPrice, source: buyLocation },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      trade: {
        id: trade.id,
        title: trade.title,
        buyPrice: trade.buyPrice,
        buyLocation: trade.buyLocation,
        status: trade.status,
        listingId: trade.listingId,
      },
    });
  } catch (err: any) {
    logger.error('/api/trades/from-listing', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
