// v7.38: 1-click "Kupil" — instant Trade creation from a listing.
//
// Removes friction: instead of manually entering buyPrice, title, category,
// just click "Kupil" on any listing → auto-creates a held Trade with all
// data pre-filled from the listing.
//
// POST /api/listings/:id/buy
// Body: { buyPrice?: number, buyLocation?: string, buyFees?: number, notes?: string }
// Returns: { ok, trade: { id, title, buyPrice, ... } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const listing = await db.listing.findUnique({
      where: { id },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        imageUrl: true, location: true, description: true,
        aiEstimatedValue: true, dealScore: true, aiScore: true, aiVerdict: true,
        sellerName: true, monitor: { select: { source: true, name: true, profileId: true } },
      },
    });

    if (!listing) {
      return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    }

    // Check if already bought (existing held/sold trade linked to this listing)
    const existingTrade = await db.trade.findFirst({
      where: { listingId: id, status: { in: ['held', 'sold'] } },
      select: { id: true, status: true, title: true },
    });
    if (existingTrade) {
      return NextResponse.json({
        error: `Ta oglas je že kupljen (Trade: ${existingTrade.title}, status: ${existingTrade.status})`,
        existingTradeId: existingTrade.id,
      }, { status: 409 });
    }

    // Determine buy price
    const buyPrice = body.buyPrice ? Number(body.buyPrice) : listing.price ?? 0;
    if (buyPrice <= 0) {
      return NextResponse.json({ error: 'Buy price mora biti > 0. Vnesi ceno ročno.' }, { status: 400 });
    }

    // Create Trade with all data auto-filled from listing
    const trade = await db.trade.create({
      data: {
        listingId: listing.id,
        title: listing.title,
        category: listing.monitor?.source || 'drugo',
        imageUrl: listing.imageUrl,
        url: listing.url,
        buyPrice,
        buyDate: new Date(),
        buyLocation: body.buyLocation || listing.monitor?.source || 'Bolha',
        buyFees: body.buyFees ? Number(body.buyFees) : 0,
        status: 'held',
        notes: body.notes || `Auto-created from listing. AI score: ${listing.aiScore ?? '?'}/10, Deal: ${listing.dealScore ?? '?'}/100, Verdict: ${listing.aiVerdict ?? '?'}`,
        profileId: listing.monitor?.profileId ?? null,
        flipChecklist: JSON.stringify([{ step: 'received', completedAt: new Date().toISOString() }]),
      },
    });

    // Update listing contactStatus
    await db.listing.update({
      where: { id: listing.id },
      data: { contactStatus: 'closed', contactedAt: new Date() },
    }).catch(() => {});

    logger.info('/api/listings/[id]/buy', `Trade created: ${trade.id} for listing ${id} at ${buyPrice}€`);

    return NextResponse.json({
      ok: true,
      trade: {
        id: trade.id,
        title: trade.title,
        buyPrice: trade.buyPrice,
        buyDate: trade.buyDate,
        status: trade.status,
        estValue: listing.aiEstimatedValue,
        potentialProfit: listing.aiEstimatedValue ? listing.aiEstimatedValue - buyPrice : null,
        potentialRoiPct: listing.aiEstimatedValue ? Math.round(((listing.aiEstimatedValue - buyPrice) / buyPrice) * 100) : null,
      },
    });
  } catch (err) {
    logger.error('/api/listings/[id]/buy', 'POST handler failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
