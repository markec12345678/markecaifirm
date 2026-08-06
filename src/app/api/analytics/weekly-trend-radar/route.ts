// v7.50: Weekly Trend Radar — 7-dnevni pregled tržnih premikov.
//
// "Ta teden: elektronika +12% deal-ov, avto -30% (sezonsko).
//  Največ deal-ov: Bolha (45). Povprečni deal score: 78."
//
// GET /api/analytics/weekly-trend-radar

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 86400000);
    const twoWeeksAgo = new Date(now - 14 * 86400000);

    // This week vs last week
    const [thisWeek, lastWeek] = await Promise.all([
      db.listing.findMany({
        where: { firstSeenAt: { gte: weekAgo }, isHidden: false },
        select: { id: true, aiVerdict: true, dealScore: true, price: true, firstSeenAt: true, monitor: { select: { source: true } } },
      }),
      db.listing.findMany({
        where: { firstSeenAt: { gte: twoWeeksAgo, lt: weekAgo }, isHidden: false },
        select: { id: true, aiVerdict: true, dealScore: true, price: true, firstSeenAt: true, monitor: { select: { source: true } } },
      }),
    ]);

    // Sold trades this week vs last
    const [soldThisWeek, soldLastWeek] = await Promise.all([
      db.trade.findMany({ where: { status: 'sold', sellDate: { gte: weekAgo, not: null } }, select: { buyPrice: true, sellPrice: true, buyFees: true, sellFees: true, category: true } }),
      db.trade.findMany({ where: { status: 'sold', sellDate: { gte: twoWeeksAgo, lt: weekAgo, not: null } }, select: { buyPrice: true, sellPrice: true, buyFees: true, sellFees: true, category: true } }),
    ]);

    // Compute metrics
    const dealsThisWeek = thisWeek.filter(l => l.aiVerdict === 'PRILIKA');
    const dealsLastWeek = lastWeek.filter(l => l.aiVerdict === 'PRILIKA');
    const profitThisWeek = soldThisWeek.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const profitLastWeek = soldLastWeek.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

    const avgDealScoreThis = dealsThisWeek.length > 0 ? Math.round(dealsThisWeek.reduce((s, l) => s + (l.dealScore ?? 0), 0) / dealsThisWeek.length) : 0;
    const avgDealScoreLast = dealsLastWeek.length > 0 ? Math.round(dealsLastWeek.reduce((s, l) => s + (l.dealScore ?? 0), 0) / dealsLastWeek.length) : 0;

    const avgPriceThis = thisWeek.length > 0 ? Math.round(thisWeek.filter(l => l.price).reduce((s, l) => s + (l.price ?? 0), 0) / thisWeek.filter(l => l.price).length) : 0;
    const avgPriceLast = lastWeek.length > 0 ? Math.round(lastWeek.filter(l => l.price).reduce((s, l) => s + (l.price ?? 0), 0) / lastWeek.filter(l => l.price).length) : 0;

    // Per-source breakdown
    const sourceMap = new Map<string, { thisWeek: number; lastWeek: number; deals: number }>();
    for (const l of thisWeek) { const s = l.monitor?.source || 'unknown'; const cur = sourceMap.get(s) || { thisWeek: 0, lastWeek: 0, deals: 0 }; cur.thisWeek += 1; if (l.aiVerdict === 'PRILIKA') cur.deals += 1; sourceMap.set(s, cur); }
    for (const l of lastWeek) { const s = l.monitor?.source || 'unknown'; const cur = sourceMap.get(s) || { thisWeek: 0, lastWeek: 0, deals: 0 }; cur.lastWeek += 1; sourceMap.set(s, cur); }

    const sources = Array.from(sourceMap.entries()).map(([source, d]) => ({
      source,
      thisWeek: d.thisWeek, lastWeek: d.lastWeek,
      changePct: d.lastWeek > 0 ? Math.round(((d.thisWeek - d.lastWeek) / d.lastWeek) * 100) : 0,
      deals: d.deals,
    })).sort((a, b) => b.thisWeek - a.thisWeek);

    // Daily breakdown (7 days)
    const daily: Array<{ date: string; listings: number; deals: number; avgScore: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now - i * 86400000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59);
      const dayListings = thisWeek.filter(l => { const t = new Date(l.firstSeenAt); return t >= dayStart && t <= dayEnd; });
      const dayDeals = dayListings.filter(l => l.aiVerdict === 'PRILIKA');
      daily.push({
        date: dayStart.toLocaleDateString('sl-SI', { weekday: 'short', day: 'numeric' }),
        listings: dayListings.length,
        deals: dayDeals.length,
        avgScore: dayDeals.length > 0 ? Math.round(dayDeals.reduce((s, l) => s + (l.dealScore ?? 0), 0) / dayDeals.length) : 0,
      });
    }

    // Trend direction
    const dealChangePct = dealsLastWeek.length > 0 ? Math.round(((dealsThisWeek.length - dealsLastWeek.length) / dealsLastWeek.length) * 100) : 0;
    const profitChangePct = profitLastWeek !== 0 ? Math.round(((profitThisWeek - profitLastWeek) / Math.abs(profitLastWeek)) * 100) : 0;

    return NextResponse.json({
      ok: true,
      thisWeek: {
        totalListings: thisWeek.length,
        totalDeals: dealsThisWeek.length,
        avgDealScore: avgDealScoreThis,
        avgPrice: avgPriceThis,
        soldCount: soldThisWeek.length,
        profit: Math.round(profitThisWeek),
      },
      lastWeek: {
        totalListings: lastWeek.length,
        totalDeals: dealsLastWeek.length,
        avgDealScore: avgDealScoreLast,
        avgPrice: avgPriceLast,
        soldCount: soldLastWeek.length,
        profit: Math.round(profitLastWeek),
      },
      changes: {
        listingsPct: lastWeek.length > 0 ? Math.round(((thisWeek.length - lastWeek.length) / lastWeek.length) * 100) : 0,
        dealsPct: dealChangePct,
        dealScorePct: avgDealScoreLast > 0 ? Math.round(((avgDealScoreThis - avgDealScoreLast) / avgDealScoreLast) * 100) : 0,
        pricePct: avgPriceLast > 0 ? Math.round(((avgPriceThis - avgPriceLast) / avgPriceLast) * 100) : 0,
        profitPct: profitChangePct,
      },
      sources,
      daily,
      trend: dealChangePct > 10 ? 'IMPROVING' : dealChangePct < -10 ? 'DECLINING' : 'STABLE',
    });
  } catch (err: any) {
    logger.error('/api/analytics/weekly-trend-radar', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
