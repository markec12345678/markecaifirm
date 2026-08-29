import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const listings = await db.listing.findMany({
      where: {
        dealScore: { gte: 70 },
        aiVerdict: { not: 'SUMNJIVO' },
      },
      orderBy: { dealScore: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        url: true,
        dealScore: true,
        aiScore: true,
        aiVerdict: true,
        aiReason: true,
        aiEstimatedValue: true,
        firstSeenAt: true,
        monitor: { select: { name: true } },
      },
    });

    const highMarginAlerts = listings.map((l) => {
      const margin = l.aiEstimatedValue && l.price
        ? Math.round(((l.aiEstimatedValue - l.price) / l.aiEstimatedValue) * 100)
        : null;
      return {
        ...l,
        margin,
        alertType: margin && margin >= 40 ? '🚨 TAKOJ KUPI' : margin && margin >= 25 ? '⭐ DOBRA PRILOŽKA' : '💡 RAZISKOJ',
      };
    });

    return NextResponse.json({
      count: highMarginAlerts.length,
      alerts: highMarginAlerts,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
