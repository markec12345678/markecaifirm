import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: { in: ['held', 'sold'] } },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        status: true,
        category: true,
        buyDate: true,
        sellDate: true,
      },
    });

    const held = trades.filter(t => t.status === 'held');
    const sold = trades.filter(t => t.status === 'sold' && t.sellPrice != null);

    const realizedProfit = sold.reduce((sum, t) => {
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const cost = t.buyPrice + (t.buyFees ?? 0);
      return sum + (revenue - cost);
    }, 0);

    const totalInvested = held.reduce((sum, t) => sum + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRealizedRevenue = sold.reduce((sum, t) => sum + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const totalRealizedCost = sold.reduce((sum, t) => sum + t.buyPrice + (t.buyFees ?? 0), 0);

    const avgRoi = sold.length > 0
      ? sold.reduce((sum, t) => {
          const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
          const cost = t.buyPrice + (t.buyFees ?? 0);
          return sum + (cost > 0 ? profit / cost : 0);
        }, 0) / sold.length
      : 0;

    const byCategory: Record<string, { count: number; profit: number; invested: number }> = {};
    for (const t of trades) {
      const cat = t.category || 'brez kategorije';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, profit: 0, invested: 0 };
      byCategory[cat].count++;
      byCategory[cat].invested += t.buyPrice + (t.buyFees ?? 0);
      if (t.status === 'sold' && t.sellPrice != null) {
        byCategory[cat].profit += (t.sellPrice - (t.sellFees ?? 0)) - t.buyPrice - (t.buyFees ?? 0);
      }
    }

    const byMonth: Array<{ month: string; profit: number; count: number }> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = d.toISOString().slice(0, 7);
      const monthTrades = sold.filter(t => {
        if (!t.sellDate) return false;
        return t.sellDate.toISOString().slice(0, 7) === monthKey;
      });
      const profit = monthTrades.reduce((sum, t) => {
        return sum + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
      }, 0);
      byMonth.push({ month: monthKey, profit, count: monthTrades.length });
    }

    // v4.2: This month profit for goal tracking
    const thisMonthKey = now.toISOString().slice(0, 7);
    const thisMonthProfit = sold
      .filter(t => t.sellDate && t.sellDate.toISOString().slice(0, 7) === thisMonthKey)
      .reduce((sum, t) => sum + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

    // v4.2: Get profit goal from settings
    const settings = await db.settings.findUnique({ where: { id: 'singleton' }, select: { monthlyProfitGoal: true } });
    const monthlyGoal = settings?.monthlyProfitGoal ?? 0;

    return NextResponse.json({
      totalTrades: trades.length,
      heldCount: held.length,
      soldCount: sold.length,
      realizedProfit: Math.round(realizedProfit * 100) / 100,
      totalInvestedHeld: Math.round(totalInvested * 100) / 100,
      totalRealizedRevenue: Math.round(totalRealizedRevenue * 100) / 100,
      totalRealizedCost: Math.round(totalRealizedCost * 100) / 100,
      avgRoiPercent: Math.round(avgRoi * 1000) / 10,
      byCategory: Object.entries(byCategory).map(([cat, v]) => ({
        category: cat,
        count: v.count,
        profit: Math.round(v.profit * 100) / 100,
        invested: Math.round(v.invested * 100) / 100,
      })),
      byMonth,
      // v4.2: Profit goal
      thisMonthProfit: Math.round(thisMonthProfit * 100) / 100,
      monthlyGoal,
      goalProgress: monthlyGoal > 0 ? Math.min(100, Math.round((thisMonthProfit / monthlyGoal) * 100)) : 0,
    });

  } catch (err) {
    logger.error("/api/trades/stats", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
