// v4.5: Skladišče dashboard — concise data for dashboard widget
// Returns: monthly P&L (12 months), top categories, top performing trades, quick stats

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const trades = await db.trade.findMany({
    where: { status: { in: ['held', 'sold'] } },
    select: {
      id: true,
      title: true,
      category: true,
      buyPrice: true,
      buyFees: true,
      buyDate: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
      status: true,
      imageUrl: true,
    },
    orderBy: { buyDate: 'desc' },
  });

  const sold = trades.filter(t => t.status === 'sold' && t.sellPrice != null);
  const held = trades.filter(t => t.status === 'held');

  // Total realized profit
  const totalRealizedProfit = sold.reduce((sum, t) => {
    return sum + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
  }, 0);

  // Total invested (held)
  const totalInvested = held.reduce((sum, t) => sum + t.buyPrice + (t.buyFees ?? 0), 0);

  // Monthly P&L — last 12 months
  const now = new Date();
  const monthlyPnl: Array<{ month: string; label: string; profit: number; count: number; cumulative: number }> = [];
  let cumulative = 0;
  // Calculate cumulative starting from -24 months ago to get accurate cumulative for last 12
  const startCumul = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  const allSoldBeforeWindow = sold.filter(t => t.sellDate && t.sellDate < startCumul);
  cumulative = allSoldBeforeWindow.reduce((sum, t) => {
    return sum + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
  }, 0);

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = d.toISOString().slice(0, 7);
    const monthLabel = d.toLocaleDateString('sl-SI', { month: 'short', year: '2-digit' });
    const monthTrades = sold.filter(t => {
      if (!t.sellDate) return false;
      return t.sellDate.toISOString().slice(0, 7) === monthKey;
    });
    const profit = monthTrades.reduce((sum, t) => {
      return sum + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
    }, 0);
    cumulative += profit;
    monthlyPnl.push({ month: monthKey, label: monthLabel, profit, count: monthTrades.length, cumulative });
  }

  // Top categories by profit
  const catMap: Record<string, { count: number; profit: number; invested: number; sold: number }> = {};
  for (const t of trades) {
    const cat = t.category || 'brez kategorije';
    if (!catMap[cat]) catMap[cat] = { count: 0, profit: 0, invested: 0, sold: 0 };
    catMap[cat].count++;
    catMap[cat].invested += t.buyPrice + (t.buyFees ?? 0);
    if (t.status === 'sold' && t.sellPrice != null) {
      catMap[cat].sold++;
      catMap[cat].profit += (t.sellPrice - (t.sellFees ?? 0)) - t.buyPrice - (t.buyFees ?? 0);
    }
  }
  const topCategories = Object.entries(catMap)
    .map(([name, v]) => ({ name, ...v, avgRoi: v.invested > 0 ? (v.profit / v.invested) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  // Top 5 best trades (by absolute profit)
  const topTrades = sold
    .map(t => ({
      id: t.id,
      title: t.title,
      category: t.category,
      profit: (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0),
      roi: t.buyPrice > 0 ? (((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)) / (t.buyPrice + (t.buyFees ?? 0))) * 100 : 0,
      sellDate: t.sellDate,
      imageUrl: t.imageUrl,
    }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  // This month + last month
  const thisMonthKey = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
  const thisMonthProfit = sold
    .filter(t => t.sellDate && t.sellDate.toISOString().slice(0, 7) === thisMonthKey)
    .reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
  const lastMonthProfit = sold
    .filter(t => t.sellDate && t.sellDate.toISOString().slice(0, 7) === lastMonthKey)
    .reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
  const trend = thisMonthProfit - lastMonthProfit;

  return NextResponse.json({
    totalTrades: trades.length,
    heldCount: held.length,
    soldCount: sold.length,
    totalRealizedProfit,
    totalInvested,
    thisMonthProfit,
    lastMonthProfit,
    trend,
    monthlyPnl,
    topCategories,
    topTrades,
  });
}
