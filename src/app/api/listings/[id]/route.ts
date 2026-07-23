import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings/:id
 * Returns full listing detail + similar listings + price history.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await db.listing.findUnique({
    where: { id },
    include: {
      monitor: { select: { name: true, source: true, id: true } },
      alerts: {
        select: {
          id: true, aiVerdict: true, aiScore: true, aiRisk: true,
          userAction: true, createdAt: true, isArchived: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      priceHistory: {
        orderBy: { seenAt: 'asc' },
        select: { id: true, price: true, priceText: true, seenAt: true },
      },
      // v1.7: include related trades
      trades: {
        orderBy: { buyDate: 'desc' },
        select: { id: true, status: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      },
    },
  });
  if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

  // v2.4: Ensure notes fields are included (they're on the model, just explicitly noted)
  // No additional query needed — fields come back automatically

  // Parse detailImages JSON if present
  let detailImages: string[] = [];
  try {
    if (listing.detailImages) {
      detailImages = JSON.parse(listing.detailImages);
    }
  } catch { /* ignore */ }

  // Find similar listings: same monitor, similar price range (±30%), different id
  const price = listing.price;
  let similar: any[] = [];
  let marketComparison: any = null;
  if (price != null) {
    const min = Math.floor(price * 0.7);
    const max = Math.ceil(price * 1.3);
    similar = await db.listing.findMany({
      where: {
        monitorId: listing.monitorId,
        id: { not: listing.id },
        price: { gte: min, lte: max },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 5,
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        aiScore: true, aiRisk: true, aiVerdict: true, firstSeenAt: true,
        imageUrl: true,
      },
    });

    // v1.8: Compute market comparison stats from ALL similar listings (not just top 5)
    const allSimilar = await db.listing.findMany({
      where: {
        monitorId: listing.monitorId,
        id: { not: listing.id },
        price: { gte: min, lte: max },
      },
      select: { price: true, aiVerdict: true },
    });
    if (allSimilar.length > 0) {
      const prices = allSimilar.map(l => l.price).filter((p): p is number => p != null);
      if (prices.length > 0) {
        prices.sort((a, b) => a - b);
        const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
        const median = prices.length % 2 === 0
          ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
          : prices[Math.floor(prices.length / 2)];
        const variance = prices.reduce((s, p) => s + Math.pow(p - avg, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        const minP = prices[0];
        const maxP = prices[prices.length - 1];
        const belowMarket = price < avg;
        const diffFromAvg = avg - price;
        const diffPct = avg > 0 ? (diffFromAvg / avg) * 100 : 0;

        marketComparison = {
          count: prices.length,
          average: Math.round(avg * 100) / 100,
          median: Math.round(median * 100) / 100,
          stdDev: Math.round(stdDev * 100) / 100,
          min: minP,
          max: maxP,
          belowMarket, // true if listing is below average
          diffFromAvg: Math.round(diffFromAvg * 100) / 100,
          diffPct: Math.round(diffPct * 100) / 100,
          aiEstimate: listing.aiEstimatedValue,
          aiVsMarketDiff: listing.aiEstimatedValue != null
            ? Math.round((listing.aiEstimatedValue - avg) * 100) / 100
            : null,
        };
      }
    }
  }

  return NextResponse.json({
    listing: {
      ...listing,
      detailImages,
    },
    similar,
    marketComparison,
    priceHistory: listing.priceHistory,
  });
}
