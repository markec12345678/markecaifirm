// v6.6: Price War Detection — AI zazna hitre padce cen v kategorijah (buyer's market)
// GET /api/ai/price-war?days=14
// Returns: { ok, wars: Array<{ category, dropCount, avgDropPct, sellers, trend, recommendation }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.min(60, Math.max(3, parseInt(url.searchParams.get('days') ?? '14', 10) || 14));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all listings with price drops in the period
  const droppedListings = await db.listing.findMany({
    where: {
      priceDroppedAt: { gte: since, not: null },
      previousPrice: { not: null },
      isHidden: false,
    },
    select: {
      id: true, title: true, price: true, priceText: true, previousPrice: true,
      priceDroppedAt: true, sellerName: true, url: true,
      monitor: { select: { source: true, name: true } },
    },
    take: 500,
    orderBy: { priceDroppedAt: 'desc' },
  });

  if (droppedListings.length === 0) {
    return NextResponse.json({ ok: true, wars: [], message: 'Ni padcev cen v izbranem obdobju.' });
  }

  // Extract category from title
  const extractCat = (title: string) => {
    const t = title.toLowerCase();
    if (/(iphone|samsung|telefon|laptop|macbook|pc|računalnik|konzola|ps5|xbox|tv|monitor)/.test(t)) return 'elektronika';
    if (/(avto|vozilo|golf|audi|bmw|toyota|renault|peugeot)/.test(t)) return 'avto';
    if (/(stanovanje|hiša|hisa|zemljišče|garaža)/.test(t)) return 'nepremicnine';
    if (/(orodje|bosch|makita|dewalt|vijačnik|bušilka)/.test(t)) return 'orodje';
    if (/(hlače|majica|jakna|čevlji|nike|adidas)/.test(t)) return 'moda';
    if (/(smuči|kolo|fitnes|žoga|tenis)/.test(t)) return 'sport';
    if (/(miza|stol|omara|postelja|pohištvo)/.test(t)) return 'pohistvo';
    return 'drugo';
  };

  // Group by category
  const catMap: Record<string, any[]> = {};
  for (const l of droppedListings) {
    const cat = extractCat(l.title);
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(l);
  }

  // Analyze each category for price war patterns
  const wars = Object.entries(catMap).map(([category, items]) => {
    const drops = items.map(l => {
      const dropPct = l.previousPrice && l.previousPrice > 0
        ? Math.round(((l.previousPrice! - (l.price ?? 0)) / l.previousPrice!) * 100)
        : 0;
      return { ...l, dropPct };
    });

    const avgDropPct = Math.round(drops.reduce((s, d) => s + d.dropPct, 0) / drops.length);
    const maxDropPct = Math.max(...drops.map(d => d.dropPct));
    const sellers = new Set(drops.map(d => d.sellerName).filter(Boolean));
    const sources = new Set(drops.map(d => d.monitor?.source).filter(Boolean));

    // Price war indicators:
    // - Multiple sellers dropping prices (3+)
    // - Average drop > 10%
    // - Multiple drops in short timeframe
    const uniqueSellers = sellers.size;
    const dropCount = drops.length;
    const isPriceWar = uniqueSellers >= 3 && avgDropPct >= 10 && dropCount >= 5;

    // Trend: are drops accelerating?
    const sorted = drops.sort((a, b) => a.priceDroppedAt!.getTime() - b.priceDroppedAt!.getTime());
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, d) => s + d.dropPct, 0) / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, d) => s + d.dropPct, 0) / secondHalf.length : 0;
    const trend = secondAvg > firstAvg * 1.3 ? 'accelerating' : secondAvg < firstAvg * 0.7 ? 'decelerating' : 'stable';

    let recommendation: string;
    let buyerMarket: boolean;
    if (isPriceWar && trend === 'accelerating') {
      recommendation = '🔥 CENOVA VOJNA! Cene padajo hitro — odličen čas za NAKUP. Počakaj še 2-3 dni za najnižje cene.';
      buyerMarket = true;
    } else if (isPriceWar) {
      recommendation = '✅ Cenovna vojna v teku — dober čas za nakup. Cene so pod pritiskom.';
      buyerMarket = true;
    } else if (avgDropPct > 5) {
      recommendation = '⚠️ Zmerni padci cen — spremljaj razvoj.';
      buyerMarket = false;
    } else {
      recommendation = '➡️ Normalni padci — ni posebnega trenda.';
      buyerMarket = false;
    }

    return {
      category,
      dropCount,
      avgDropPct,
      maxDropPct,
      uniqueSellers: uniqueSellers,
      sources: Array.from(sources),
      trend,
      isPriceWar,
      buyerMarket,
      recommendation,
      topDrops: drops.sort((a, b) => b.dropPct - a.dropPct).slice(0, 5).map(d => ({
        title: d.title,
        previousPrice: d.previousPrice,
        currentPrice: d.price,
        priceText: d.priceText,
        dropPct: d.dropPct,
        url: d.url,
        sellerName: d.sellerName,
        source: d.monitor?.source,
      })),
    };
  }).sort((a, b) => b.avgDropPct - a.avgDropPct || b.dropCount - a.dropCount);

  const activeWars = wars.filter(w => w.isPriceWar).length;
  const buyerMarketCategories = wars.filter(w => w.buyerMarket).length;

  return NextResponse.json({
    ok: true,
    wars,
    totalDrops: droppedListings.length,
    activeWars,
    buyerMarketCategories,
    daysAnalyzed: days,
  });
}
