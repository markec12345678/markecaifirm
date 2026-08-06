// v7.37: Deal Velocity — "koliko deal-ov na dan" trend.
//
// Answers: "Ali trg postaja boljši ali slabši?"
// - Deals per day (trend: rising/falling/stable)
// - Avg deal score trend
// - Market temperature: HOT / WARM / COLD
// - Best time of day / day of week for deals
//
// GET /api/analytics/deal-velocity?days=30

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get all listings with aiVerdict='PRILIKA' in period
    const deals = await db.listing.findMany({
      where: {
        aiVerdict: 'PRILIKA',
        firstSeenAt: { gte: since },
        isHidden: false,
      },
      select: {
        id: true,
        title: true,
        price: true,
        aiScore: true,
        dealScore: true,
        firstSeenAt: true,
        monitor: { select: { source: true, name: true } },
      },
      orderBy: { firstSeenAt: 'asc' },
    });

    // Group by day
    const dailyMap = new Map<string, { count: number; totalScore: number; totalValue: number; sources: Set<string> }>();
    for (const d of deals) {
      const dateKey = new Date(d.firstSeenAt).toISOString().slice(0, 10);
      const cur = dailyMap.get(dateKey) || { count: 0, totalScore: 0, totalValue: 0, sources: new Set() };
      cur.count += 1;
      cur.totalScore += d.dealScore ?? 0;
      cur.totalValue += d.price ?? 0;
      if (d.monitor?.source) cur.sources.add(d.monitor.source);
      dailyMap.set(dateKey, cur);
    }

    // Build daily array (fill gaps)
    const daily: Array<{ date: string; deals: number; avgScore: number; avgValue: number; sources: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const d = dailyMap.get(date);
      daily.push({
        date,
        deals: d?.count ?? 0,
        avgScore: d && d.count > 0 ? Math.round(d.totalScore / d.count) : 0,
        avgValue: d && d.count > 0 ? Math.round(d.totalValue / d.count) : 0,
        sources: d?.sources.size ?? 0,
      });
    }

    // Compute trend (compare last 7 days vs previous 7 days)
    const last7 = daily.slice(-7);
    const prev7 = daily.slice(-14, -7);
    const last7Avg = last7.reduce((s, d) => s + d.deals, 0) / 7;
    const prev7Avg = prev7.reduce((s, d) => s + d.deals, 0) / 7;
    const trendPct = prev7Avg > 0 ? Math.round(((last7Avg - prev7Avg) / prev7Avg) * 100) : 0;

    // Market temperature
    let temperature: 'HOT' | 'WARM' | 'COLD';
    if (last7Avg >= 5) temperature = 'HOT';
    else if (last7Avg >= 2) temperature = 'WARM';
    else temperature = 'COLD';

    // Best day of week
    const dayOfWeekMap = new Map<number, { count: number; total: number }>();
    for (const d of deals) {
      const dow = new Date(d.firstSeenAt).getDay();
      const cur = dayOfWeekMap.get(dow) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += d.dealScore ?? 0;
      dayOfWeekMap.set(dow, cur);
    }
    const dayNames = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];
    const bestDay = Array.from(dayOfWeekMap.entries())
      .map(([dow, d]) => ({ day: dayNames[dow], dayIndex: dow, avgDeals: d.count / Math.max(1, Math.ceil(days / 7)), avgScore: d.count > 0 ? Math.round(d.total / d.count) : 0 }))
      .sort((a, b) => b.avgDeals - a.avgDeals)[0];

    // Best time of day
    const hourMap = new Map<number, number>();
    for (const d of deals) {
      const hour = new Date(d.firstSeenAt).getHours();
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
    }
    const bestHour = Array.from(hourMap.entries()).sort((a, b) => b[1] - a[1])[0];

    // Source breakdown
    const sourceMap = new Map<string, number>();
    for (const d of deals) {
      const src = d.monitor?.source || 'unknown';
      sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
    }
    const sources = Array.from(sourceMap.entries())
      .map(([source, count]) => ({ source, count, pct: Math.round((count / deals.length) * 100) }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      ok: true,
      days,
      summary: {
        totalDeals: deals.length,
        dealsPerDay: Math.round((deals.length / days) * 10) / 10,
        avgDealScore: deals.length > 0 ? Math.round(deals.reduce((s, d) => s + (d.dealScore ?? 0), 0) / deals.length) : 0,
        avgDealValue: deals.length > 0 ? Math.round(deals.reduce((s, d) => s + (d.price ?? 0), 0) / deals.length) : 0,
        trendPct,
        temperature,
        last7Days: Math.round(last7Avg * 10) / 10,
        prev7Days: Math.round(prev7Avg * 10) / 10,
      },
      daily,
      bestDayOfWeek: bestDay || null,
      bestHour: bestHour ? { hour: bestHour[0], deals: bestHour[1] } : null,
      sources,
    });
  } catch (err: any) {
    logger.error('/api/analytics/deal-velocity', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
