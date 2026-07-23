import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics
 * Returns aggregated data for charts:
 * - alerts per day (last 14 days)
 * - verdict distribution
 * - monitor performance table
 * - AI accuracy (userAction breakdown)
 * - listings per day (last 14 days)
 */
export async function GET() {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. Alerts per day (last 14 days)
  const alertsPerDayRaw = await db.alert.findMany({
    where: { createdAt: { gte: fourteenDaysAgo } },
    select: { createdAt: true, aiVerdict: true },
  });
  const alertsPerDay = aggregateByDay(alertsPerDayRaw, a => a.createdAt, ['PRILIKA', 'SUMNJIVO', 'NEZANIMIVO'], a => a.aiVerdict);

  // 2. Listings per day (last 14 days)
  const listingsPerDayRaw = await db.listing.findMany({
    where: { firstSeenAt: { gte: fourteenDaysAgo } },
    select: { firstSeenAt: true },
  });
  const listingsPerDay = aggregateByDaySimple(listingsPerDayRaw, l => l.firstSeenAt);

  // 3. Verdict distribution (all time)
  const verdictCounts = await db.alert.groupBy({
    by: ['aiVerdict'],
    _count: { aiVerdict: true },
  });
  const verdictDistribution = {
    PRILIKA: 0,
    SUMNJIVO: 0,
    NEZANIMIVO: 0,
    ...Object.fromEntries(verdictCounts.map(v => [v.aiVerdict ?? 'NEZANIMIVO', v._count.aiVerdict])),
  };

  // 4. Monitor performance
  const monitors = await db.monitor.findMany({
    include: {
      _count: { select: { listings: true, alerts: true, runLogs: true } },
      runLogs: {
        where: { startedAt: { gte: thirtyDaysAgo } },
        select: { status: true, durationMs: true },
      },
      alerts: {
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { aiVerdict: true, userAction: true },
      },
    },
  });
  const monitorPerformance = monitors.map(m => {
    const totalRuns = m.runLogs.length;
    const okRuns = m.runLogs.filter(r => r.status === 'ok').length;
    const durations = m.runLogs.filter(r => r.durationMs != null).map(r => r.durationMs!);
    const avgDurationMs = durations.length > 0 ? durations.reduce((s, x) => s + x, 0) / durations.length : 0;
    const recentAlerts = m.alerts.length;
    const prilika = m.alerts.filter(a => a.aiVerdict === 'PRILIKA').length;
    const userInterested = m.alerts.filter(a => a.userAction === 'interested').length;
    const userScam = m.alerts.filter(a => a.userAction === 'scam').length;
    const userArchived = m.alerts.filter(a => a.userAction === 'archived').length;
    return {
      id: m.id,
      name: m.name,
      source: m.source,
      isActive: m.isActive,
      totalListings: m._count.listings,
      totalAlerts: m._count.alerts,
      recentAlerts,
      prilika,
      successRate: totalRuns > 0 ? okRuns / totalRuns : 0,
      avgDurationMs: Math.round(avgDurationMs),
      // AI accuracy: of alerts user actioned, how many were "interested" (good precision signal)
      userInterested,
      userScam,
      userArchived,
      // Approximate precision: interested / (interested + scam)
      precision: (userInterested + userScam) > 0 ? userInterested / (userInterested + userScam) : null,
      conversionRate: recentAlerts > 0 ? userInterested / recentAlerts : 0,
    };
  });

  // 5. AI accuracy summary (all-time alerts with user feedback)
  const userActionCounts = await db.alert.groupBy({
    by: ['userAction'],
    _count: { userAction: true },
    where: { userAction: { not: null } },
  });
  const accuracy = {
    interested: 0,
    archived: 0,
    scam: 0,
    ignored: 0,
    ...Object.fromEntries(userActionCounts.map(u => [u.userAction ?? 'ignored', u._count.userAction])),
  };
  const totalFeedback = accuracy.interested + accuracy.archived + accuracy.scam + accuracy.ignored;
  const precision = (accuracy.interested + accuracy.scam) > 0
    ? accuracy.interested / (accuracy.interested + accuracy.scam)
    : null;

  // v1.7: Trade stats (profit tracker integration)
  const trades = await db.trade.findMany({
    where: { status: { in: ['held', 'sold'] } },
    select: {
      buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
      status: true, category: true, sellDate: true,
    },
  });
  const soldTrades = trades.filter(t => t.status === 'sold' && t.sellPrice != null);
  const realizedProfit = soldTrades.reduce((sum, t) => {
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const cost = t.buyPrice + (t.buyFees ?? 0);
    return sum + (revenue - cost);
  }, 0);
  // Profit by month (last 12)
  const tradeByMonth: Array<{ month: string; profit: number; count: number }> = [];
  const tradeNow = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(tradeNow.getFullYear(), tradeNow.getMonth() - i, 1);
    const monthKey = d.toISOString().slice(0, 7);
    const monthTrades = soldTrades.filter(t => {
      if (!t.sellDate) return false;
      return t.sellDate.toISOString().slice(0, 7) === monthKey;
    });
    const profit = monthTrades.reduce((sum, t) => {
      return sum + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
    }, 0);
    tradeByMonth.push({ month: monthKey, profit: Math.round(profit * 100) / 100, count: monthTrades.length });
  }
  // By category
  const tradeByCategory: Array<{ category: string; count: number; profit: number }> = [];
  const categoryMap: Record<string, { count: number; profit: number }> = {};
  for (const t of trades) {
    const cat = t.category || 'brez kategorije';
    if (!categoryMap[cat]) categoryMap[cat] = { count: 0, profit: 0 };
    categoryMap[cat].count++;
    if (t.status === 'sold' && t.sellPrice != null) {
      categoryMap[cat].profit += (t.sellPrice - (t.sellFees ?? 0)) - t.buyPrice - (t.buyFees ?? 0);
    }
  }
  for (const [cat, v] of Object.entries(categoryMap)) {
    tradeByCategory.push({ category: cat, count: v.count, profit: Math.round(v.profit * 100) / 100 });
  }

  return NextResponse.json({
    alertsPerDay,
    listingsPerDay,
    verdictDistribution,
    monitorPerformance,
    accuracy: {
      ...accuracy,
      total: totalFeedback,
      precision,
    },
    // v1.7: Trade stats
    trades: {
      totalTrades: trades.length,
      heldCount: trades.filter(t => t.status === 'held').length,
      soldCount: soldTrades.length,
      realizedProfit: Math.round(realizedProfit * 100) / 100,
      byMonth: tradeByMonth,
      byCategory: tradeByCategory,
    },
    generatedAt: tradeNow.toISOString(),
  });
}

/** Aggregate records by day with breakdown by category. */
function aggregateByDay<T>(
  records: T[],
  dateFn: (r: T) => Date | null,
  categories: string[],
  categoryFn: (r: T) => string | null
): Array<{ date: string; total: number; [cat: string]: number | string }> {
  const byDay = new Map<string, { total: number; cats: Record<string, number> }>();
  for (const r of records) {
    const d = dateFn(r);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    if (!byDay.has(key)) {
      byDay.set(key, { total: 0, cats: Object.fromEntries(categories.map(c => [c, 0])) });
    }
    const entry = byDay.get(key)!;
    entry.total++;
    const cat = categoryFn(r) ?? 'NEZANIMIVO';
    if (entry.cats[cat] != null) entry.cats[cat]++;
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, total: v.total, ...v.cats }));
}

function aggregateByDaySimple<T>(
  records: T[],
  dateFn: (r: T) => Date | null
): Array<{ date: string; count: number }> {
  const byDay = new Map<string, number>();
  for (const r of records) {
    const d = dateFn(r);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}
