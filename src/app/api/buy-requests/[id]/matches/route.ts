// v8.75: BuyRequest matches — list + mark as read
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const matches = await db.buyRequestMatch.findMany({
      where: { buyRequestId: id },
      include: {
        listing: {
          select: {
            id: true, title: true, price: true, priceText: true, url: true,
            location: true, imageUrl: true, aiScore: true, aiVerdict: true,
            aiEstimatedValue: true, monitor: { select: { source: true, tags: true } },
          },
        },
      },
      orderBy: { matchedAt: 'desc' },
      take: 50,
    });

    // Mark as read (reset newMatchesCount)
    await db.buyRequest.update({
      where: { id },
      data: { newMatchesCount: 0 },
    });
    await db.buyRequestMatch.updateMany({
      where: { buyRequestId: id, isRead: false },
      data: { isRead: true },
    });

    return NextResponse.json({ ok: true, matches });
  } catch (err) {
    logger.error('/api/buy-requests/[id]/matches', 'GET failed', err);
    return NextResponse.json({ ok: false, error: 'Napaka' }, { status: 500 });
  }
}
