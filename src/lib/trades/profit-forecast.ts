// v8.53: Profit Forecast — "pri trenutni hitrosti boš imel X€ do konca meseca"
// Combines actual profit trend + daily average → projected end-of-month profit.

import { db } from '@/lib/db';
import { calculateActualProfit } from '@/lib/profit/actual';

export interface ProfitForecast {
  ok: true;
  // Current month actual
  currentMonthProfit: number;
  currentMonthTrades: number;
  // Daily run rate
  dailyAvgProfit: number;
  // Days remaining in month
  daysElapsed: number;
  daysRemaining: number;
  // Forecast
  projectedMonthEnd: number;      // if current trend continues
  projectedAtGoal: number;        // if daily rate × remaining days added to current
  monthlyGoal: number;
  goalLikely: boolean;
  goalDeficit: number;            // positive = behind, negative = ahead
  // Trend
  trend: 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'NO_DATA';
  trendReason: string;
  // Distribution (where profit comes from)
  distribution: Array<{
    category: string;
    profit: number;
    tradeCount: number;
    percentage: number;
  }>;
  // Held potential (unrealized)
  heldPotentialProfit: number;
  heldItemCount: number;
  source: 'v8.53-profit-forecast';
}

export async function getProfitForecast(): Promise<ProfitForecast> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysRemaining = daysInMonth - daysElapsed;

  // Get this month's sold trades
  const trades = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: monthStart },
    },
    select: {
      title: true,
      category: true,
      buyPrice: true,
      buyFees: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
    },
    orderBy: { sellDate: 'asc' },
  });

  const currentMonthProfit = trades.reduce(
    (s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)),
    0
  );

  const dailyAvgProfit = daysElapsed > 0 ? currentMonthProfit / daysElapsed : 0;
  const projectedMonthEnd = dailyAvgProfit * daysInMonth;

  // Get goal
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { monthlyProfitGoal: true },
  });
  const monthlyGoal = settings?.monthlyProfitGoal ?? 0;
  const goalDeficit = monthlyGoal - projectedMonthEnd;
  const goalLikely = monthlyGoal > 0 && projectedMonthEnd >= monthlyGoal;

  // Trend
  let trend: ProfitForecast['trend'] = 'NO_DATA';
  let trendReason = 'Ni dovolj podatkov.';
  if (trades.length >= 2) {
    if (monthlyGoal > 0) {
      if (projectedMonthEnd >= monthlyGoal * 1.1) {
        trend = 'AHEAD';
        trendReason = `Pri trenutni hitrosti boš presegel cilj za ${(projectedMonthEnd - monthlyGoal).toFixed(0)}€!`;
      } else if (projectedMonthEnd >= monthlyGoal * 0.9) {
        trend = 'ON_TRACK';
        trendReason = `Si na pravi poti za doseg cilja ${monthlyGoal}€.`;
      } else {
        trend = 'BEHIND';
        trendReason = `Zaostajaš za ${(monthlyGoal - projectedMonthEnd).toFixed(0)}€. Potrebnih ${(goalDeficit / Math.max(1, daysRemaining)).toFixed(0)}€/dan do konca meseca.`;
      }
    } else {
      trend = 'ON_TRACK';
      trendReason = `Pri trenutni hitrosti boš končal mesec z ${projectedMonthEnd.toFixed(0)}€ profit.`;
    }
  }

  // Category distribution
  const categoryMap: Record<string, { profit: number; count: number }> = {};
  for (const t of trades) {
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    const cat = t.category || 'Ostalo';
    if (!categoryMap[cat]) categoryMap[cat] = { profit: 0, count: 0 };
    categoryMap[cat].profit += profit;
    categoryMap[cat].count += 1;
  }

  const distribution = Object.entries(categoryMap)
    .map(([category, data]) => ({
      category,
      profit: Math.round(data.profit * 100) / 100,
      tradeCount: data.count,
      percentage: currentMonthProfit > 0 ? Math.round((data.profit / currentMonthProfit) * 100) : 0,
    }))
    .sort((a, b) => b.profit - a.profit);

  // Held potential
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: { buyPrice: true },
  });
  const heldPotentialProfit = heldTrades.reduce((s, t) => s + t.buyPrice * 0.2, 0); // assume 20% avg margin
  const heldItemCount = heldTrades.length;

  return {
    ok: true,
    currentMonthProfit: Math.round(currentMonthProfit * 100) / 100,
    currentMonthTrades: trades.length,
    dailyAvgProfit: Math.round(dailyAvgProfit * 100) / 100,
    daysElapsed,
    daysRemaining,
    projectedMonthEnd: Math.round(projectedMonthEnd * 100) / 100,
    projectedAtGoal: Math.round((currentMonthProfit + dailyAvgProfit * daysRemaining) * 100) / 100,
    monthlyGoal,
    goalLikely,
    goalDeficit: Math.round(goalDeficit * 100) / 100,
    trend,
    trendReason,
    distribution,
    heldPotentialProfit: Math.round(heldPotentialProfit * 100) / 100,
    heldItemCount,
    source: 'v8.53-profit-forecast',
  };
}
