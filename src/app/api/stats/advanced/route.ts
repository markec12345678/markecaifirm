// v4.7: Advanced statistics — for the new Statistics dashboard
// GET /api/stats/advanced
// Returns: P&L over time, conversion rates, AI accuracy, monitor performance, source breakdown

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();

  // ===== 1. P&L OVER TIME (last 12 months, cumulative) =====
  const trades = await db.trade.findMany({
    where: { status: { in: ['held', 'sold', 'cancelled'] } },
    select: {
      id: true,
      buyPrice: true,
      buyFees: true,
      buyDate: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
      status: true,
      category: true,
    },
  });

  const sold = trades.filter(t => t.status === 'sold' && t.sellPrice != null && t.sellDate != null);
  const held = trades.filter(t => t.status === 'held');
  const cancelled = trades.filter(t => t.status === 'cancelled');

  // Monthly P&L with cumulative
  const monthlyPnl: Array<{ month: string; label: string; profit: number; count: number; cumulative: number; invested: number }> = [];
  let cumulative = 0;
  // start cumul from 24 months ago to get accurate 12-month cumulative
  const startCumul = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  const beforeSold = sold.filter(t => t.sellDate && t.sellDate < startCumul);
  cumulative = beforeSold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
  let investedCumulative = 0;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = d.toISOString().slice(0, 7);
    const monthLabel = d.toLocaleDateString('sl-SI', { month: 'short', year: '2-digit' });
    const monthSold = sold.filter(t => t.sellDate?.toISOString().slice(0, 7) === monthKey);
    const monthBought = trades.filter(t => t.buyDate.toISOString().slice(0, 7) === monthKey);
    const profit = monthSold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const invested = monthBought.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    cumulative += profit;
    investedCumulative += invested;
    monthlyPnl.push({ month: monthKey, label: monthLabel, profit, count: monthSold.length, cumulative, invested });
  }

  // ===== 2. CONVERSION RATES =====
  const totalListings = await db.listing.count();
  const bookmarked = await db.listing.count({ where: { isBookmarked: true } });
  const contacted = await db.listing.count({ where: { contactStatus: { in: ['contacted', 'responded', 'closed'] } } });
  const responded = await db.listing.count({ where: { contactStatus: { in: ['responded', 'closed'] } } });
  const closed = await db.listing.count({ where: { contactStatus: 'closed' } });
  const withTarget = await db.listing.count({ where: { targetPrice: { not: null } } });
  const targetsHit = await db.listing.count({
    where: {
      targetPrice: { not: null },
      targetPriceAlertSent: true,
    }
  });

  // Trades conversion: bookmark → trade
  const tradesFromListings = trades.filter(t => t.status === 'sold').length;

  // ===== 3. AI ACCURACY =====
  // Compare AI estimated value to actual sell price (for trades that originated from listings)
  const aiEvaluatedListings = await db.listing.findMany({
    where: {
      aiEstimatedValue: { not: null },
      aiVerdict: { not: null },
      trades: { some: { status: 'sold', sellPrice: { not: null } } },
    },
    select: {
      id: true,
      title: true,
      price: true,
      aiEstimatedValue: true,
      aiVerdict: true,
      aiScore: true,
      aiRisk: true,
      dealScore: true,
      trades: {
        where: { status: 'sold', sellPrice: { not: null } },
        select: { sellPrice: true, sellDate: true },
      },
    },
    take: 100,
  });

  const aiAccuracyData = aiEvaluatedListings.map(l => {
    const trade = l.trades[0];
    const actualPrice = trade?.sellPrice ?? null;
    const aiEstimate = l.aiEstimatedValue;
    const diff = actualPrice != null && aiEstimate != null ? actualPrice - aiEstimate : null;
    const diffPct = actualPrice != null && aiEstimate != null && aiEstimate > 0
      ? Math.round((diff! / aiEstimate) * 100)
      : null;
    return {
      id: l.id,
      title: l.title,
      listingPrice: l.price,
      aiEstimate,
      actualPrice,
      diff,
      diffPct,
      aiVerdict: l.aiVerdict,
      aiScore: l.aiScore,
    };
  });

  // AI accuracy stats
  const validForAccuracy = aiAccuracyData.filter(a => a.diffPct != null);
  const avgAbsErrorPct = validForAccuracy.length > 0
    ? Math.round(validForAccuracy.reduce((s, a) => s + Math.abs(a.diffPct!), 0) / validForAccuracy.length)
    : null;
  // % within ±15% of actual
  const within15 = validForAccuracy.filter(a => Math.abs(a.diffPct!) <= 15).length;
  const within15Pct = validForAccuracy.length > 0 ? Math.round((within15 / validForAccuracy.length) * 100) : null;
  // % within ±30%
  const within30 = validForAccuracy.filter(a => Math.abs(a.diffPct!) <= 30).length;
  const within30Pct = validForAccuracy.length > 0 ? Math.round((within30 / validForAccuracy.length) * 100) : null;

  // AI verdict accuracy: how often PRILIKA actually led to profitable trade?
  const prilikaListingsSold = aiEvaluatedListings.filter(l => l.aiVerdict === 'PRILIKA');
  const prilikaProfitable = prilikaListingsSold.filter(l => {
    const trade = l.trades[0];
    if (!trade?.sellPrice) return false;
    return l.price != null && trade.sellPrice > l.price;
  });
  const prilikaAccuracyPct = prilikaListingsSold.length > 0
    ? Math.round((prilikaProfitable.length / prilikaListingsSold.length) * 100)
    : null;

  // ===== 4. MONITOR PERFORMANCE =====
  const monitors = await db.monitor.findMany({
    select: {
      id: true,
      name: true,
      source: true,
      isActive: true,
      intervalMinutes: true,
      _count: {
        select: {
          listings: true,
          alerts: true,
          runLogs: true,
        },
      },
      runLogs: {
        orderBy: { startedAt: 'desc' },
        take: 30,
        select: { status: true, startedAt: true, durationMs: true, newListings: true, alertsSent: true },
      },
    },
  });

  const monitorPerformance = monitors.map(m => {
    const recentRuns = m.runLogs ?? [];
    const successCount = recentRuns.filter(r => r.status === 'ok').length;
    const errorCount = recentRuns.filter(r => r.status === 'error').length;
    const emptyCount = recentRuns.filter(r => r.status === 'empty').length;
    const successRate = recentRuns.length > 0 ? Math.round((successCount / recentRuns.length) * 100) : null;
    const avgDuration = recentRuns.length > 0
      ? Math.round(recentRuns.reduce((s, r) => s + (r.durationMs ?? 0), 0) / recentRuns.length)
      : null;
    const newListings = recentRuns.reduce((s, r) => s + (r.newListings ?? 0), 0);
    const alertsSent = recentRuns.reduce((s, r) => s + (r.alertsSent ?? 0), 0);
    return {
      id: m.id,
      name: m.name,
      source: m.source,
      isActive: m.isActive,
      intervalMinutes: m.intervalMinutes,
      totalListings: m._count.listings,
      totalAlerts: m._count.alerts,
      totalRuns: m._count.runLogs,
      recentRuns: recentRuns.length,
      successRate,
      successCount,
      errorCount,
      emptyCount,
      avgDuration,
      recentNewListings: newListings,
      recentAlertsSent: alertsSent,
    };
  }).sort((a, b) => b.totalListings - a.totalListings);

  // ===== 5. SOURCE BREAKDOWN =====
  const sourceBreakdown = await db.listing.groupBy({
    by: ['monitorId'],
    _count: true,
  });
  // Map monitorId to source
  const sourceMap = new Map<string, { source: string; name: string }>();
  for (const m of monitors) {
    sourceMap.set(m.id, { source: m.source, name: m.name });
  }
  const bySource: Record<string, { count: number; monitors: number }> = {};
  for (const sb of sourceBreakdown) {
    const info = sourceMap.get(sb.monitorId);
    if (!info) continue;
    if (!bySource[info.source]) bySource[info.source] = { count: 0, monitors: 0 };
    bySource[info.source].count += sb._count;
  }
  // Count monitors per source
  for (const m of monitors) {
    if (!bySource[m.source]) bySource[m.source] = { count: 0, monitors: 0 };
    bySource[m.source].monitors++;
  }

  // ===== 6. TOP CATEGORIES BY PROFIT =====
  const catMap: Record<string, { count: number; profit: number; invested: number; sold: number; held: number }> = {};
  for (const t of trades) {
    const cat = t.category || 'brez kategorije';
    if (!catMap[cat]) catMap[cat] = { count: 0, profit: 0, invested: 0, sold: 0, held: 0 };
    catMap[cat].count++;
    catMap[cat].invested += t.buyPrice + (t.buyFees ?? 0);
    if (t.status === 'sold' && t.sellPrice != null) {
      catMap[cat].sold++;
      catMap[cat].profit += (t.sellPrice - (t.sellFees ?? 0)) - t.buyPrice - (t.buyFees ?? 0);
    } else if (t.status === 'held') {
      catMap[cat].held++;
    }
  }
  const topCategories = Object.entries(catMap)
    .map(([name, v]) => ({
      name,
      ...v,
      avgRoi: v.invested > 0 ? Math.round((v.profit / v.invested) * 100) : 0,
      conversionRate: v.count > 0 ? Math.round((v.sold / v.count) * 100) : 0,
    }))
    .sort((a, b) => b.profit - a.profit);

  // ===== 7. KEY METRICS =====
  const totalRealizedProfit = sold.reduce((s, t) =>
    s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
  const totalInvestedHeld = held.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
  const avgRoi = sold.length > 0
    ? Math.round(sold.reduce((s, t) => {
        const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
        const cost = t.buyPrice + (t.buyFees ?? 0);
        return s + (cost > 0 ? profit / cost : 0);
      }, 0) / sold.length * 100)
    : null;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    keyMetrics: {
      totalRealizedProfit,
      totalInvestedHeld,
      avgRoi,
      totalTrades: trades.length,
      soldCount: sold.length,
      heldCount: held.length,
      cancelledCount: cancelled.length,
    },
    monthlyPnl,
    conversion: {
      totalListings,
      bookmarked,
      contacted,
      responded,
      closed,
      withTarget,
      targetsHit,
      tradesFromListings,
      bookmarkToContactPct: bookmarked > 0 ? Math.round((contacted / bookmarked) * 100) : null,
      contactToResponsePct: contacted > 0 ? Math.round((responded / contacted) * 100) : null,
      responseToClosedPct: responded > 0 ? Math.round((closed / responded) * 100) : null,
      bookmarkToTradePct: bookmarked > 0 ? Math.round((tradesFromListings / bookmarked) * 100) : null,
      targetHitPct: withTarget > 0 ? Math.round((targetsHit / withTarget) * 100) : null,
    },
    aiAccuracy: {
      sampleSize: aiAccuracyData.length,
      avgAbsErrorPct,
      within15Pct,
      within30Pct,
      prilikaAccuracyPct,
      prilikaSampleSize: prilikaListingsSold.length,
      topPredictions: aiAccuracyData
        .filter(a => a.diffPct != null)
        .sort((a, b) => Math.abs(a.diffPct!) - Math.abs(b.diffPct!))
        .slice(0, 5),
      worstPredictions: aiAccuracyData
        .filter(a => a.diffPct != null)
        .sort((a, b) => Math.abs(b.diffPct!) - Math.abs(a.diffPct!))
        .slice(0, 5),
    },
    monitorPerformance,
    sourceBreakdown: Object.entries(bySource).map(([source, v]) => ({
      source,
      listings: v.count,
      monitors: v.monitors,
    })).sort((a, b) => b.listings - a.listings),
    topCategories,
  });
}
