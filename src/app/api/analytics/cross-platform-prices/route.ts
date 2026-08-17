// v8.74: Cross-Platform Price Comparison API
// GET /api/analytics/cross-platform-prices?category=elektronika&q=iphone
// Vrne povprečne cene listings per platform — "iPhone je na Bolha avg 450€, na Quoka avg 380€"

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get('category') ?? '';
    const q = url.searchParams.get('q') ?? '';
    const days = parseInt(url.searchParams.get('days') ?? '30', 10);

    // Build where clause
    const where: any = {
      isHidden: false,
      price: { not: null, gt: 0 },
      firstSeenAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    };

    // Category filter (via monitor.tags)
    if (category) {
      where.monitor = { tags: { contains: category } };
    }

    // Text search
    if (q.trim()) {
      const words = q.trim().split(/\s+/).filter(w => w.length > 0);
      if (words.length === 1) {
        where.OR = [
          { title: { contains: words[0] } },
          { description: { contains: words[0] } },
        ];
      } else if (words.length > 1) {
        where.AND = words.map(w => ({
          OR: [
            { title: { contains: w } },
            { description: { contains: w } },
          ],
        }));
      }
    }

    const listings = await db.listing.findMany({
      where,
      select: {
        id: true,
        title: true,
        price: true,
        monitor: { select: { source: true, tags: true } },
      },
      take: 500,
    });

    // Group by platform
    const platformMap: Record<string, { prices: number[]; listings: Array<{ title: string; price: number }> }> = {};
    for (const l of listings) {
      const source = l.monitor?.source || 'unknown';
      if (!platformMap[source]) {
        platformMap[source] = { prices: [], listings: [] };
      }
      platformMap[source].prices.push(l.price!);
      platformMap[source].listings.push({ title: l.title, price: l.price! });
    }

    // Compute stats per platform
    const platforms = Object.entries(platformMap).map(([source, data]) => {
      const sorted = [...data.prices].sort((a, b) => a - b);
      const avg = data.prices.reduce((s, p) => s + p, 0) / data.prices.length;
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      // Standard deviation
      const variance = data.prices.reduce((s, p) => s + Math.pow(p - avg, 2), 0) / data.prices.length;
      const stdDev = Math.sqrt(variance);

      return {
        source,
        label: SOURCE_LABELS[source] || source,
        icon: SOURCE_ICONS[source] || '📋',
        count: data.prices.length,
        avgPrice: Math.round(avg),
        minPrice: min,
        maxPrice: max,
        medianPrice: Math.round(median),
        stdDev: Math.round(stdDev),
        // Cheapest listing on this platform
        cheapestListing: data.listings.sort((a, b) => a.price - b.price)[0] || null,
      };
    }).sort((a, b) => a.avgPrice - b.avgPrice);

    // Overall stats
    const allPrices = listings.map(l => l.price!);
    const overallAvg = allPrices.length > 0 ? allPrices.reduce((s, p) => s + p, 0) / allPrices.length : 0;
    const cheapestPlatform = platforms[0] || null;
    const expensivePlatform = platforms[platforms.length - 1] || null;

    // Price difference between cheapest and most expensive platform
    let priceGap = 0;
    let priceGapPercent = 0;
    if (cheapestPlatform && expensivePlatform && cheapestPlatform.source !== expensivePlatform.source) {
      priceGap = expensivePlatform.avgPrice - cheapestPlatform.avgPrice;
      priceGapPercent = cheapestPlatform.avgPrice > 0 ? (priceGap / cheapestPlatform.avgPrice) * 100 : 0;
    }

    return NextResponse.json({
      ok: true,
      totalListings: listings.length,
      totalPlatforms: platforms.length,
      platforms,
      overallAvgPrice: Math.round(overallAvg),
      cheapestPlatform,
      expensivePlatform,
      priceGap: Math.round(priceGap),
      priceGapPercent: Math.round(priceGapPercent),
      days,
      source: 'v8.74-cross-platform-prices',
    });

  } catch (err) {
    logger.error('/api/analytics/cross-platform-prices', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

const SOURCE_LABELS: Record<string, string> = {
  bolha: 'Bolha (SI)',
  nepremicnine: 'Nepremičnine (SI)',
  avtonet: 'Avtonet (SI)',
  salomon: 'Salomon (SI)',
  vinted: 'Vinted (SI)',
  'mobile-de': 'Mobile.de (DE)',
  kleinanzeigen: 'Kleinanzeigen (DE)',
  subito: 'Subito (IT)',
  willhaben: 'Willhaben (AT)',
  quoka: 'Quoka (DE)',
  'custom-rss': 'Custom RSS',
};

const SOURCE_ICONS: Record<string, string> = {
  bolha: '🇸🇮',
  nepremicnine: '🏠',
  avtonet: '🚗',
  salomon: '🛍️',
  vinted: '👕',
  'mobile-de': '🇩🇪',
  kleinanzeigen: '🇩🇪',
  subito: '🇮🇹',
  willhaben: '🇦🇹',
  quoka: '🇩🇪',
  'custom-rss': '📡',
};
