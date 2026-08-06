// v7.47: Market Trend Detector — "cene elektronike padajo 3%/mesec — čakaj z nakupom"
//
// Analizira trend cen v aktivnih oglasih (ne prodanih!) per kategorija:
// - Povprečna cena zadnjih 7 dni vs prejšnjih 7 dni
// - Povprečna cena zadnjih 30 dni vs prejšnjih 30 dni
// - Trend: RISING / FALLING / STABLE
// - Stopnja spremembe (%/mesec)
//
// GET /api/analytics/market-trend?category=elektronika

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const categoryFilter = url.searchParams.get('category') || '';
    const now = Date.now();

    // Get listings from last 60 days with prices
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { not: null, gt: 0 },
        firstSeenAt: { gte: new Date(now - 60 * 86400000) },
        ...(categoryFilter ? { monitor: { source: categoryFilter } } : {}),
      },
      select: { id: true, title: true, price: true, firstSeenAt: true, monitor: { select: { source: true, name: true } } },
      take: 3000,
    });

    if (listings.length < 5) {
      return NextResponse.json({ ok: true, trends: [], message: 'Ni dovolj oglasov za trend analizo (min 5).' });
    }

    // Group by source (proxy for category — monitor source = platform/category)
    const sourceMap = new Map<string, typeof listings>();
    for (const l of listings) {
      const src = l.monitor?.source || l.monitor?.name || 'unknown';
      if (!sourceMap.has(src)) sourceMap.set(src, []);
      sourceMap.get(src)!.push(l);
    }

    const trends: Array<{
      source: string;
      count: number;
      avgPrice7d: number;
      avgPricePrev7d: number;
      weeklyChangePct: number;
      avgPrice30d: number;
      avgPricePrev30d: number;
      monthlyChangePct: number;
      trend: 'RISING' | 'FALLING' | 'STABLE';
      monthlyRatePct: number;
      recommendation: string;
    }> = [];

    for (const [source, items] of sourceMap) {
      if (items.length < 5) continue;

      // Split into time windows
      const last7d = items.filter(l => new Date(l.firstSeenAt).getTime() >= now - 7 * 86400000);
      const prev7d = items.filter(l => {
        const t = new Date(l.firstSeenAt).getTime();
        return t >= now - 14 * 86400000 && t < now - 7 * 86400000;
      });
      const last30d = items.filter(l => new Date(l.firstSeenAt).getTime() >= now - 30 * 86400000);
      const prev30d = items.filter(l => {
        const t = new Date(l.firstSeenAt).getTime();
        return t >= now - 60 * 86400000 && t < now - 30 * 86400000;
      });

      const avg = (arr: typeof items) => arr.length > 0 ? arr.reduce((s, l) => s + (l.price ?? 0), 0) / arr.length : 0;

      const avgPrice7d = Math.round(avg(last7d));
      const avgPricePrev7d = Math.round(avg(prev7d));
      const weeklyChangePct = avgPricePrev7d > 0 ? Math.round(((avgPrice7d - avgPricePrev7d) / avgPricePrev7d) * 100) : 0;

      const avgPrice30d = Math.round(avg(last30d));
      const avgPricePrev30d = Math.round(avg(prev30d));
      const monthlyChangePct = avgPricePrev30d > 0 ? Math.round(((avgPrice30d - avgPricePrev30d) / avgPricePrev30d) * 100) : 0;

      // Monthly rate (extrapolate weekly to monthly)
      const monthlyRatePct = weeklyChangePct !== 0 ? Math.round(weeklyChangePct * 4) : monthlyChangePct;

      // Trend determination
      let trend: 'RISING' | 'FALLING' | 'STABLE';
      if (Math.abs(monthlyChangePct) < 3) trend = 'STABLE';
      else if (monthlyChangePct > 0) trend = 'RISING';
      else trend = 'FALLING';

      // Recommendation
      let recommendation = '';
      if (trend === 'FALLING' && Math.abs(monthlyRatePct) > 5) {
        recommendation = `📉 Cene padajo ${Math.abs(monthlyRatePct)}%/mesec — ČAKAJ z nakupom. Za prodajo: pohitri (cene bodo še nižje).`;
      } else if (trend === 'FALLING') {
        recommendation = `📉 Cene rahlo padajo (${Math.abs(monthlyRatePct)}%/mesec) — ni nujno, a počakaj če lahko za boljšo ceno.`;
      } else if (trend === 'RISING' && monthlyRatePct > 5) {
        recommendation = `📈 Cene rastejo ${monthlyRatePct}%/mesec — KUPI ZDAJ (bo dražje). Za prodajo: zadrži (bo še višje).`;
      } else if (trend === 'RISING') {
        recommendation = `📈 Cene rahlo rastejo (${monthlyRatePct}%/mesec) — ugoden čas za prodajo.`;
      } else {
        recommendation = `➡️ Cene stabilne — ugoden čas tako za nakup kot prodajo.`;
      }

      trends.push({
        source, count: items.length,
        avgPrice7d, avgPricePrev7d, weeklyChangePct,
        avgPrice30d, avgPricePrev30d, monthlyChangePct,
        trend, monthlyRatePct, recommendation,
      });
    }

    // Sort by absolute monthly change (most volatile first)
    trends.sort((a, b) => Math.abs(b.monthlyChangePct) - Math.abs(a.monthlyChangePct));

    // Overall market trend
    const fallingCount = trends.filter(t => t.trend === 'FALLING').length;
    const risingCount = trends.filter(t => t.trend === 'RISING').length;
    const stableCount = trends.filter(t => t.trend === 'STABLE').length;

    let overallTrend = 'STABLE';
    if (fallingCount > risingCount + 1) overallTrend = 'BEARISH (falling)';
    else if (risingCount > fallingCount + 1) overallTrend = 'BULLISH (rising)';

    return NextResponse.json({
      ok: true,
      category: categoryFilter || 'all',
      trends,
      overall: {
        totalCategories: trends.length,
        rising: risingCount,
        falling: fallingCount,
        stable: stableCount,
        trend: overallTrend,
      },
      bestBuyOpportunity: trends.filter(t => t.trend === 'FALLING').sort((a, b) => a.monthlyChangePct - b.monthlyChangePct)[0] || null,
      bestSellOpportunity: trends.filter(t => t.trend === 'RISING').sort((a, b) => b.monthlyChangePct - a.monthlyChangePct)[0] || null,
    });
  } catch (err: any) {
    logger.error('/api/analytics/market-trend', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
