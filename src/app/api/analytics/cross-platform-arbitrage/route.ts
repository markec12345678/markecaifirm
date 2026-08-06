// v7.48: Cross-Platform Arbitrage Scanner — "iPhone 13 je 180€ na Kleinanzeigen, 280€ na Bolhi"
//
// Najde item-e ki so ceneje na eni platformi in dražje na drugi.
// Kupi na cenejši, proda na dražji = tista razlika je profit.
//
// GET /api/analytics/cross-platform-arbitrage

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get all active listings grouped by source
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { not: null, gt: 0 },
        firstSeenAt: { gte: new Date(Date.now() - 30 * 86400000) }, // last 30 days
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        aiVerdict: true, dealScore: true, aiScore: true,
        location: true, firstSeenAt: true,
        monitor: { select: { source: true, name: true } },
      },
      take: 5000,
    });

    if (listings.length < 10) {
      return NextResponse.json({ ok: true, opportunities: [], message: 'Ni dovolj oglasov za arbitražo (min 10).' });
    }

    // Group by source
    const bySource = new Map<string, typeof listings>();
    for (const l of listings) {
      const src = l.monitor?.source || 'unknown';
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src)!.push(l);
    }

    // Extract "product keywords" from titles — first 2-3 significant words
    function extractKeywords(title: string): string[] {
      const words = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !['prodajam','nov','novo','rabljen','rabljeno','cena','dobra','stanje','like','with'].includes(w));
      return words.slice(0, 3);
    }

    // Build keyword → listings map per source
    const keywordIndex = new Map<string, Array<{ listing: typeof listings[0]; source: string }>>();
    for (const [source, items] of bySource) {
      for (const l of items) {
        const kws = extractKeywords(l.title);
        if (kws.length < 2) continue;
        const key = kws.sort().join(' ');
        if (!keywordIndex.has(key)) keywordIndex.set(key, []);
        keywordIndex.get(key)!.push({ listing: l, source });
      }
    }

    // Find arbitrage opportunities: same keywords on different platforms with price difference
    const opportunities: Array<{
      keywords: string;
      buyPlatform: string;
      buyPrice: number;
      buyUrl: string;
      buyTitle: string;
      sellPlatform: string;
      sellPrice: number;
      sellUrl: string;
      sellTitle: string;
      profitEur: number;
      profitPct: number;
      shippingCostEur: number;
      netProfitEur: number;
      dealScore: number;
    }> = [];

    const SHIPPING_ESTIMATES: Record<string, number> = {
      'kleinanzeigen': 15, // DE → SI
      'mobile-de': 300, // car shipping
      'subito': 20, // IT → SI
      'willhaben': 12, // AT → SI
      'bolha': 0, // local
      'avtonet': 0,
      'vinted': 5, // Vinted internal shipping
    };

    for (const [keywords, items] of keywordIndex) {
      if (items.length < 2) continue;

      // Must have items from at least 2 different sources
      const sources = new Set(items.map(i => i.source));
      if (sources.size < 2) continue;

      // Find cheapest and most expensive
      const sorted = items.sort((a, b) => (a.listing.price ?? 0) - (b.listing.price ?? 0));
      const cheapest = sorted[0];
      const mostExpensive = sorted[sorted.length - 1];

      if (cheapest.source === mostExpensive.source) continue;
      if (!cheapest.listing.price || !mostExpensive.listing.price) continue;

      const buyPrice = cheapest.listing.price;
      const sellPrice = mostExpensive.listing.price;
      const profitEur = sellPrice - buyPrice;
      const profitPct = buyPrice > 0 ? Math.round((profitEur / buyPrice) * 100) : 0;

      // Only meaningful arbitrage (profit > 20€, profitPct > 15%)
      if (profitEur < 20 || profitPct < 15) continue;

      const shippingBuy = SHIPPING_ESTIMATES[cheapest.source] ?? 15;
      const shippingSell = SHIPPING_ESTIMATES[mostExpensive.source] ?? 0;
      const totalShipping = shippingBuy + shippingSell;
      const netProfitEur = profitEur - totalShipping;

      // Only viable after shipping
      if (netProfitEur < 10) continue;

      opportunities.push({
        keywords,
        buyPlatform: cheapest.source,
        buyPrice,
        buyUrl: cheapest.listing.url,
        buyTitle: cheapest.listing.title,
        sellPlatform: mostExpensive.source,
        sellPrice,
        sellUrl: mostExpensive.listing.url,
        sellTitle: mostExpensive.listing.title,
        profitEur,
        profitPct,
        shippingCostEur: totalShipping,
        netProfitEur,
        dealScore: cheapest.listing.dealScore ?? 0,
      });
    }

    // Sort by net profit
    opportunities.sort((a, b) => b.netProfitEur - a.netProfitEur);

    // Top 20
    const top = opportunities.slice(0, 20);

    return NextResponse.json({
      ok: true,
      totalOpportunities: opportunities.length,
      opportunities: top,
      summary: {
        totalComparisons: keywordIndex.size,
        avgProfitPct: top.length > 0 ? Math.round(top.reduce((s, o) => s + o.profitPct, 0) / top.length) : 0,
        bestOpportunity: top[0] ? {
          buy: `${top[0].buyPlatform} (${top[0].buyPrice}€)`,
          sell: `${top[0].sellPlatform} (${top[0].sellPrice}€)`,
          netProfit: `${top[0].netProfitEur}€`,
        } : null,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/cross-platform-arbitrage', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
