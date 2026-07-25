// v4.5: Set target price for a listing — alert me when price drops at or below this.
// PATCH /api/listings/:id/target
// Body: { targetPrice: number | null }
//   - number > 0: set target price
//   - null: clear target price

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, price: true, targetPrice: true, targetPriceAlertSent: true },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
  }

  // null = clear target
  if (body.targetPrice === null || body.targetPrice === undefined || body.targetPrice === '') {
    const updated = await db.listing.update({
      where: { id },
      data: {
        targetPrice: null,
        targetPriceSetAt: null,
        targetPriceAlertSent: false,
      },
    });
    return NextResponse.json({ ok: true, targetPrice: null });
  }

  // Validate number
  const target = typeof body.targetPrice === 'number'
    ? body.targetPrice
    : parseInt(String(body.targetPrice), 10);

  if (Number.isNaN(target) || target <= 0) {
    return NextResponse.json({ error: 'Ciljna cena mora biti pozitivno število' }, { status: 400 });
  }

  // Reset alert flag if target changed or lowered
  const resetAlertFlag = listing.targetPrice !== target ? false : listing.targetPriceAlertSent;

  const updated = await db.listing.update({
    where: { id },
    data: {
      targetPrice: target,
      targetPriceSetAt: new Date(),
      targetPriceAlertSent: resetAlertFlag,
    },
  });

  // If current price is already <= target, inform user (don't auto-spam alert here — pipeline handles it)
  const alreadyBelow = listing.price != null && listing.price <= target;

  return NextResponse.json({
    ok: true,
    targetPrice: updated.targetPrice,
    targetPriceSetAt: updated.targetPriceSetAt,
    targetPriceAlertSent: updated.targetPriceAlertSent,
    currentPrice: listing.price,
    alreadyBelow,
  });
}
