// v8.71: Targeted Item Search API
// GET /api/search/items?q=golf+5&category=avto&priceMin=1000&priceMax=15000&location=Ljubljana&yearMin=2018&sortBy=cheapest
// Searches across all listings (not hidden) with filters, returns sorted results.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    const category = url.searchParams.get('category') ?? '';
    const priceMin = url.searchParams.get('priceMin');
    const priceMax = url.searchParams.get('priceMax');
    const location = url.searchParams.get('location') ?? '';
    const yearMin = url.searchParams.get('yearMin');
    const yearMax = url.searchParams.get('yearMax');
    const verdict = url.searchParams.get('verdict') ?? ''; // PRILIKA/SUMNJIVO
    const sortBy = url.searchParams.get('sortBy') ?? 'cheapest'; // cheapest | best_score | newest | closest
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);

    // Build where clause
    const where: any = { isHidden: false };

    // Text search on title + description
    if (q.trim()) {
      const words = q.trim().split(/\s+/).filter(w => w.length > 0);
      if (words.length === 1) {
        where.OR = [
          { title: { contains: words[0] } },
          { description: { contains: words[0] } },
          { detailDescription: { contains: words[0] } },
        ];
      } else if (words.length > 1) {
        // All words must appear somewhere (AND of ORs)
        where.AND = words.map(w => ({
          OR: [
            { title: { contains: w } },
            { description: { contains: w } },
            { detailDescription: { contains: w } },
          ],
        }));
      }
    }

    // Price range
    if (priceMin || priceMax) {
      where.price = {};
      if (priceMin) where.price.gte = parseInt(priceMin, 10);
      if (priceMax) where.price.lte = parseInt(priceMax, 10);
    } else {
      // Must have a price for meaningful results
      where.price = { not: null, gt: 0 };
    }

    // Location filter
    if (location.trim()) {
      where.OR = where.OR
        ? [...(Array.isArray(where.OR) ? where.OR : [where.OR]), { location: { contains: location } }]
        : { location: { contains: location } };
    }

    // AI verdict filter
    if (verdict && ['PRILIKA', 'SUMNJIVO'].includes(verdict)) {
      where.aiVerdict = verdict;
    }

    // Category filter (via monitor.tags)
    const monitorWhere: any = {};
    if (category) {
      monitorWhere.tags = { contains: category };
    }

    // Fetch listings
    let listings = await db.listing.findMany({
      where: {
        ...where,
        monitor: monitorWhere.tags ? { tags: monitorWhere.tags } : undefined,
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        location: true, description: true, detailDescription: true, imageUrl: true,
        postedAt: true, firstSeenAt: true,
        aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true, aiEstimatedValue: true,
        aiImageVerdict: true, previousPrice: true, priceDroppedAt: true,
        sellerName: true, sellerListingCount: true,
        monitor: { select: { name: true, source: true, tags: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 200, // fetch more than needed for in-memory sorting
    });

    // Year filter (in-memory — year is embedded in title/description)
    if (yearMin || yearMax) {
      const minY = yearMin ? parseInt(yearMin, 10) : 0;
      const maxY = yearMax ? parseInt(yearMax, 10) : 9999;
      listings = listings.filter(l => {
        const text = `${l.title} ${l.description} ${l.detailDescription ?? ''}`;
        const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
        if (!yearMatches) return false;
        const years = yearMatches.map(y => parseInt(y, 10));
        const hasYearInRange = years.some(y => y >= minY && y <= maxY);
        return hasYearInRange;
      });
    }

    // Compute buy scores for sorting (if sortBy === 'best_score')
    let buyScores: Record<string, number> = {};
    if (sortBy === 'best_score') {
      try {
        const { computeBuyScore } = await import('@/lib/trades/buy-opportunity');
        // Need category context — simplified batch
        const allSold = await db.trade.findMany({
          where: { status: 'sold', sellPrice: { not: null } },
          select: { category: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
        });
        const catContext: Record<string, { avgSell: number | null; avgROI: number | null }> = {};
        const catMap: Record<string, any[]> = {};
        for (const t of allSold) {
          const c = t.category || 'drugo';
          if (!catMap[c]) catMap[c] = [];
          catMap[c].push(t);
        }
        for (const [cat, ts] of Object.entries(catMap)) {
          if (ts.length === 0) continue;
          const sellPrices = ts.map(t => t.sellPrice ?? 0);
          const rois = ts.map(t => {
            const c = t.buyPrice + (t.buyFees ?? 0);
            const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
            return c > 0 ? ((r - c) / c) * 100 : 0;
          });
          catContext[cat] = {
            avgSell: sellPrices.reduce((s, p) => s + p, 0) / ts.length,
            avgROI: rois.reduce((s, r) => s + r, 0) / rois.length,
          };
        }
        for (const l of listings) {
          const tags = (l.monitor?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
          const cat = tags[0] || 'drugo';
          const ctx = catContext[cat] || { avgSell: null, avgROI: null };
          const result = computeBuyScore(
            {
              id: l.id, title: l.title, price: l.price, priceText: l.priceText,
              aiScore: l.aiScore, aiRisk: l.aiRisk, aiVerdict: l.aiVerdict,
              aiEstimatedValue: l.aiEstimatedValue, previousPrice: l.previousPrice,
              priceDroppedAt: l.priceDroppedAt,
            },
            {
              category: cat,
              marketAvgSellPrice: ctx.avgSell,
              marketAvgROI: ctx.avgROI,
              comparableCount: allSold.filter(t => (t.category || 'drugo') === cat).length,
            }
          );
          buyScores[l.id] = result.score;
        }
      } catch { /* non-critical */ }
    }

    // Sort
    switch (sortBy) {
      case 'cheapest':
        listings.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        break;
      case 'best_score':
        listings.sort((a, b) => (buyScores[b.id] ?? 0) - (buyScores[a.id] ?? 0));
        break;
      case 'newest':
        listings.sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime());
        break;
      case 'closest':
        // Sort by location text match quality (exact match first, then contains)
        if (location.trim()) {
          const loc = location.toLowerCase().trim();
          listings.sort((a, b) => {
            const aMatch = (a.location || '').toLowerCase().includes(loc) ? 0 : 1;
            const bMatch = (b.location || '').toLowerCase().includes(loc) ? 0 : 1;
            if (aMatch !== bMatch) return aMatch - bMatch;
            return (a.price ?? Infinity) - (b.price ?? Infinity);
          });
        } else {
          listings.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        }
        break;
      case 'price_drop':
        listings.sort((a, b) => {
          if (a.priceDroppedAt && b.priceDroppedAt) {
            return new Date(b.priceDroppedAt).getTime() - new Date(a.priceDroppedAt).getTime();
          }
          if (a.priceDroppedAt) return -1;
          if (b.priceDroppedAt) return 1;
          return 0;
        });
        break;
    }

    const results = listings.slice(0, limit).map(l => ({
      ...l,
      buyScore: buyScores[l.id] ?? null,
      // Full description (prefer detailDescription if available)
      fullDescription: l.detailDescription || l.description || '',
    }));

    return NextResponse.json({
      ok: true,
      total: results.length,
      totalBeforeLimit: listings.length,
      results,
      sortBy,
    });

  } catch (err) {
    logger.error('/api/search/items', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
