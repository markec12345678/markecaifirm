import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/arbitrage
 * Finds potential arbitrage opportunities: same/similar items listed on different sources
 * at different prices.
 *
 * Algorithm:
 * 1. Group all listings by normalized title (first 30 chars, lowercase, alphanumeric only)
 * 2. For groups with 2+ listings from different monitors, compute price difference
 * 3. Return sorted by potential profit (price difference) descending
 */
export async function GET() {
  // Get all listings with prices, grouped by monitor source
  const listings = await db.listing.findMany({
    where: {
      price: { not: null },
      // Only recent listings (last 30 days)
      firstSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true, title: true, price: true, priceText: true, url: true,
      imageUrl: true, location: true, firstSeenAt: true,
      aiScore: true, aiVerdict: true,
      monitor: { select: { name: true, source: true, id: true } },
    },
    take: 500, // limit for performance
    orderBy: { firstSeenAt: 'desc' },
  });

  // Group by normalized title
  const groups: Map<string, typeof listings> = new Map();
  for (const l of listings) {
    const normalized = l.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5) // first 5 words
      .join(' ');
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized)!.push(l);
  }

  // Find groups with 2+ listings from different sources
  const opportunities: Array<{
    title: string;
    normalizedTitle: string;
    listings: Array<{
      id: string;
      title: string;
      price: number;
      priceText: string;
      url: string;
      imageUrl: string | null;
      source: string;
      monitorName: string;
      aiScore: number | null;
      aiVerdict: string | null;
    }>;
    cheapestPrice: number;
    expensivePrice: number;
    potentialProfit: number;
    profitPct: number;
  }> = [];

  for (const [normalized, group] of groups) {
    if (group.length < 2) continue;
    // Check if listings are from different sources
    const sources = new Set(group.map(l => l.monitor.source));
    if (sources.size < 2) continue;

    // Sort by price
    const sorted = group.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    const cheapest = sorted[0];
    const expensive = sorted[sorted.length - 1];
    if (!cheapest.price || !expensive.price) continue;

    const profit = expensive.price - cheapest.price;
    const profitPct = cheapest.price > 0 ? Math.round((profit / cheapest.price) * 100) : 0;

    // Only include if profit > 10€ and > 5%
    if (profit < 10 || profitPct < 5) continue;

    opportunities.push({
      title: cheapest.title,
      normalizedTitle: normalized,
      listings: sorted.map(l => ({
        id: l.id,
        title: l.title,
        price: l.price ?? 0,
        priceText: l.priceText,
        url: l.url,
        imageUrl: l.imageUrl,
        source: l.monitor.source,
        monitorName: l.monitor.name,
        aiScore: l.aiScore,
        aiVerdict: l.aiVerdict,
      })),
      cheapestPrice: cheapest.price,
      expensivePrice: expensive.price,
      potentialProfit: profit,
      profitPct,
    });
  }

  // Sort by potential profit descending
  opportunities.sort((a, b) => b.potentialProfit - a.potentialProfit);

  return NextResponse.json({
    opportunities: opportunities.slice(0, 20), // top 20
    total: opportunities.length,
  });
}
