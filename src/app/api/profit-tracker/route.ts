import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      orderBy: { buyDate: 'desc' },
      take: 50,
      include: {
        listing: { select: { title: true, url: true, price: true } },
      },
    });

    let totalProfit = 0;
    let totalInvested = 0;
    let totalSold = 0;
    const byCategory: Record<string, { count: number; profit: number }> = {};

    for (const t of trades) {
      if (t.buyPrice) totalInvested += t.buyPrice;
      if (t.sellPrice && t.buyPrice) {
        const profit = t.sellPrice - t.buyPrice;
        totalProfit += profit;
        totalSold++;
      }
      const cat = t.listing?.title?.slice(0, 20) || 'Drugo';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0 };
      byCategory[cat].count++;
      if (t.sellPrice && t.buyPrice) byCategory[cat].profit += t.sellPrice - t.buyPrice;
    }

    return NextResponse.json({
      trades,
      stats: {
        totalProfit,
        totalInvested,
        totalSold,
        totalTrades: trades.length,
        byCategory,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { listingId, buyPrice, buyDate, notes } = body;

    const trade = await db.trade.create({
      data: {
        title: notes || 'Trade',
        listingId,
        buyPrice: typeof buyPrice === 'number' ? buyPrice : 0,
        buyDate: buyDate ? new Date(buyDate) : new Date(),
        status: 'bought',
      },
    });

    return NextResponse.json(trade, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
