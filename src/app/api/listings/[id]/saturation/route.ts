// v6.2: Market Saturation Analysis — AI preveri koliko podobnih oglasov je na trgu
// GET /api/listings/:id/saturation
// Returns: { ok, saturation: { level, count, avgPrice, priceRange, trend, recommendation, similarListings } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const listing = await db.listing.findUnique({
      where: { id },
      select: { id: true, title: true, price: true, monitorId: true, firstSeenAt: true, monitor: { select: { source: true } } },
    });
    if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });
    if (!listing.price) return NextResponse.json({ error: 'Brez cene' }, { status: 400 });

    // Find similar listings in price range ±30%
    const minP = Math.floor(listing.price * 0.7);
    const maxP = Math.ceil(listing.price * 1.3);

    const [similar, recent7d, older30d] = await Promise.all([
      db.listing.findMany({
        where: {
          id: { not: id },
          isHidden: false,
          OR: [
            { monitorId: listing.monitorId!, price: { gte: minP, lte: maxP } },
          ],
        },
        select: { id: true, title: true, price: true, priceText: true, url: true, firstSeenAt: true, aiVerdict: true, dealScore: true, monitor: { select: { source: true, name: true } } },
        take: 50,
        orderBy: { firstSeenAt: 'desc' },
      }),
      db.listing.count({
        where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, price: { gte: minP, lte: maxP } },
      }),
      db.listing.count({
        where: { isHidden: false, firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, price: { gte: minP, lte: maxP } },
      }),
    ]);

    const prices = similar.map(l => l.price!).filter(Boolean);
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : listing.price;
    const minPrice = prices.length > 0 ? Math.min(...prices) : listing.price;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : listing.price;

    // Saturation level
    const count = similar.length;
    let level: 'low' | 'medium' | 'high' | 'very_high';
    let levelLabel: string;
    let color: string;
    if (count <= 3) { level = 'low'; levelLabel = 'Nizka'; color = 'text-primary'; }
    else if (count <= 10) { level = 'medium'; levelLabel = 'Srednja'; color = 'text-amber-400'; }
    else if (count <= 20) { level = 'high'; levelLabel = 'Visoka'; color = 'text-orange-400'; }
    else { level = 'very_high'; levelLabel = 'Zelo visoka'; color = 'text-red-500'; }

    // Trend: are listings increasing or decreasing?
    const trend = recent7d > older30d / 4 ? 'increasing' : recent7d < older30d / 4 ? 'decreasing' : 'stable';

    // Position of this listing vs market
    const positionPct = avgPrice > 0 ? Math.round(((listing.price - avgPrice) / avgPrice) * 100) : 0;

    // Recommendation
    let recommendation: string;
    if (level === 'low') {
      recommendation = '✅ DOBRO — malo konkurence, visoka verjetnost prodaje';
    } else if (level === 'medium') {
      recommendation = '⚠️ ZMERNO — primerna konkurenca, postavi konkurenčno ceno';
    } else if (level === 'high') {
      recommendation = '🔴 VISOKO — veliko podobnih oglasov, težja prodaja. Razmisli o nižji ceni ali čakanju.';
    } else {
      recommendation = '🚫 PREVEČ — trg nasičen. Ne priporočamo nakupa za preprodajo.';
    }

    return NextResponse.json({
      ok: true,
      saturation: {
        level,
        levelLabel,
        color,
        count,
        avgPrice,
        minPrice,
        maxPrice,
        positionPct,
        trend,
        trendLabel: trend === 'increasing' ? 'Rastoča' : trend === 'decreasing' ? 'Padajoča' : 'Stabilna',
        recent7d,
        older30d,
        recommendation,
      },
      similarListings: similar.slice(0, 10).map(l => ({
        id: l.id, title: l.title, price: l.price, priceText: l.priceText, url: l.url,
        source: l.monitor?.source, dealScore: l.dealScore, firstSeenAt: l.firstSeenAt,
      })),
    });

  } catch (err) {
    logger.error("/api/listings/[id]/saturation", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
