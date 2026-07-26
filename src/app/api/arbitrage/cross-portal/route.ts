// v5.2: Cross-Portal Arbitrage — najdi iste izdelke na različnih portalih in primerjaj cene
// GET /api/arbitrage/cross-portal
// Query: ?threshold=20 (min % difference), ?limit=50
// Returns: { ok, opportunities: Array<{ title, sources: [{ listingId, source, price, url, monitorName }], priceDiff, priceDiffPct, cheapest, mostExpensive, profit }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
    .slice(0, 100);
}

function extractKeywords(title: string): string[] {
  // Extract significant words (length >= 3, no numbers-only)
  const stopWords = new Set(['the', 'and', 'for', 'with', 'nov', 'nova', 'novi', 'novo', 'prodam', 'komp', 'komplet']);
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !stopWords.has(w))
    .slice(0, 5); // top 5 keywords
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const threshold = Math.min(80, Math.max(5, parseInt(url.searchParams.get('threshold') ?? '20', 10) || 20));
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const daysBack = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') ?? '30', 10) || 30));

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // Get all recent listings with prices, grouped by source
  const listings = await db.listing.findMany({
    where: {
      price: { not: null },
      isHidden: false,
      firstSeenAt: { gte: since },
    },
    select: {
      id: true,
      title: true,
      price: true,
      priceText: true,
      url: true,
      location: true,
      imageUrl: true,
      firstSeenAt: true,
      aiVerdict: true,
      aiScore: true,
      dealScore: true,
      monitor: { select: { name: true, source: true } },
    },
    orderBy: { firstSeenAt: 'desc' },
    take: 2000, // limit base query
  });

  // Group listings by normalized title (only those that appear on different sources)
  const groups = new Map<string, Array<typeof listings[0]>>();
  for (const l of listings) {
    const normalized = normalizeTitle(l.title);
    if (normalized.length < 5) continue; // skip too short titles
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized)!.push(l);
  }

  // Filter groups: must have at least 2 listings from different sources
  const opportunities: any[] = [];
  for (const [title, group] of groups.entries()) {
    const sourcesSet = new Set(group.map(l => l.monitor?.source).filter(Boolean));
    if (sourcesSet.size < 2) continue; // need different sources

    // Get min and max price in group
    const prices = group.map(l => l.price!).filter(Boolean);
    if (prices.length < 2) continue;

    const cheapest = Math.min(...prices);
    const mostExpensive = Math.max(...prices);
    const priceDiff = mostExpensive - cheapest;
    const priceDiffPct = Math.round((priceDiff / cheapest) * 100);

    if (priceDiffPct < threshold) continue;

    // Sort by price ascending
    const sorted = group.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));

    opportunities.push({
      title: sorted[0].title, // use original title from cheapest
      normalizedTitle: title,
      sources: sorted.map(l => ({
        listingId: l.id,
        source: l.monitor?.source ?? 'neznan',
        monitorName: l.monitor?.name ?? 'neznan',
        price: l.price,
        priceText: l.priceText,
        url: l.url,
        location: l.location,
        imageUrl: l.imageUrl,
        firstSeenAt: l.firstSeenAt,
        aiVerdict: l.aiVerdict,
        aiScore: l.aiScore,
        dealScore: l.dealScore,
      })),
      priceDiff,
      priceDiffPct,
      cheapestPrice: cheapest,
      mostExpensivePrice: mostExpensive,
      sourceCount: sourcesSet.size,
      listingCount: group.length,
      profit: priceDiff, // potential profit if buy cheapest, sell at most expensive price
      keywords: extractKeywords(sorted[0].title),
    });
  }

  // Sort by priceDiffPct desc, then by listingCount desc
  opportunities.sort((a, b) => b.priceDiffPct - a.priceDiffPct || b.listingCount - a.listingCount);

  // Stats
  const stats = {
    totalListingsAnalyzed: listings.length,
    groupsFound: groups.size,
    opportunitiesFound: opportunities.length,
    avgPriceDiffPct: opportunities.length > 0
      ? Math.round(opportunities.reduce((s, o) => s + o.priceDiffPct, 0) / opportunities.length)
      : 0,
    totalPotentialProfit: opportunities.reduce((s, o) => s + o.profit, 0),
    bySourcePair: countSourcePairs(opportunities),
  };

  return NextResponse.json({
    ok: true,
    opportunities: opportunities.slice(0, limit),
    stats,
    threshold,
    analyzedAt: new Date().toISOString(),
  });
}

function countSourcePairs(opportunities: any[]): Record<string, number> {
  const pairs: Record<string, number> = {};
  for (const o of opportunities) {
    const sources = Array.from(new Set(o.sources.map((s: any) => s.source))).sort();
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const pair = `${sources[i]} ↔ ${sources[j]}`;
        pairs[pair] = (pairs[pair] || 0) + 1;
      }
    }
  }
  return pairs;
}
