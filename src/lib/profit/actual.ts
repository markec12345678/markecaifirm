// v8.23: Actual Profit Tracker — computes REAL EUR profit from the Trade table.
//
// This is the GROUND TRUTH that v8.25 (Historical Accuracy) will compare against
// Master Brain predictions stored in BrainSnapshot table.
//
// Until v8.23:
//   - The Brain architecture (v8.15-v8.22) made predictions ("30d: 3133€") but
//     had NO way to verify accuracy — no historical record of predictions,
//     and no measurement of ACTUAL profit realized.
//   - v8.23 solves the "actual" side: this pure function reads from the Trade
//     table (status='sold', sellDate within last N days) and computes REAL EUR
//     profit. Together with BrainSnapshot (which stores predictions), this
//     enables accuracy = actual / predicted × 100.
//
// Pure function — reads from Prisma Trade table, computes profit metrics.
// No AI, no Brain calls — just real numbers from real sales.
//
// Used by:
//   - GET /api/ai/brain/actual-profit?days=30 — UI card "Dejanski profit"
//   - GET /api/ai/brain/snapshots?days=30 — combined with snapshots for comparison
//   - (v8.25 future) accuracy backfill cron — fills actualProfit30d/90d cols
//     on BrainSnapshot rows older than 30/90 days.

import { db } from '@/lib/db';

export interface ActualProfitResult {
  ok: true;
  period: string; // '30d' | '90d' | etc.
  totalProfitEUR: number; // sum of (sellPrice - sellFees - buyPrice - buyFees) for sold trades in period
  totalRevenueEUR: number; // sum of sellPrice
  totalCostEUR: number; // sum of (buyPrice + buyFees + sellFees)
  tradeCount: number; // number of sold trades in period
  avgProfitPerTradeEUR: number;
  avgMarginPct: number; // totalProfit / totalRevenue × 100
  dailyAvgEUR: number; // totalProfit / days
  bestTrade: { title: string; profitEUR: number } | null;
  worstTrade: { title: string; profitEUR: number } | null;
}

/**
 * Calculate actual profit from sold trades in the last N days.
 *
 * Reads from Trade table where:
 *   - status='sold' (the trade was completed)
 *   - sellDate >= (now - days) (sold within the lookback window)
 *
 * Per-trade profit formula:
 *   profit = sellPrice - sellFees - buyPrice - buyFees
 *
 * Aggregations:
 *   - totalProfitEUR = Σ trade.profit
 *   - totalRevenueEUR = Σ sellPrice
 *   - totalCostEUR = Σ (buyPrice + buyFees + sellFees)
 *   - avgProfitPerTradeEUR = totalProfit / tradeCount
 *   - avgMarginPct = totalProfit / totalRevenue × 100
 *   - dailyAvgEUR = totalProfit / days (calendar days, not trade count)
 *   - bestTrade = trade with highest profit
 *   - worstTrade = trade with lowest profit (may be negative = loss)
 *
 * @param days - lookback window in days (default 30)
 * @returns ActualProfitResult with all metrics (tradeCount=0 returns zeroes)
 */
export async function calculateActualProfit(days = 30): Promise<ActualProfitResult> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const trades = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: since },
    },
    select: {
      title: true,
      buyPrice: true,
      buyFees: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
    },
    orderBy: { sellDate: 'desc' },
  });

  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return {
      ok: true,
      period: `${days}d`,
      totalProfitEUR: 0,
      totalRevenueEUR: 0,
      totalCostEUR: 0,
      tradeCount: 0,
      avgProfitPerTradeEUR: 0,
      avgMarginPct: 0,
      dailyAvgEUR: 0,
      bestTrade: null,
      worstTrade: null,
    };
  }

  // Compute per-trade profit + revenue + cost
  const tradeProfits = trades.map((t) => {
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    return {
      title: t.title,
      profitEUR: profit,
      sellPrice: t.sellPrice ?? 0,
      cost: t.buyPrice + (t.buyFees ?? 0) + (t.sellFees ?? 0),
    };
  });

  const totalProfit = tradeProfits.reduce((s, t) => s + t.profitEUR, 0);
  const totalRevenue = tradeProfits.reduce((s, t) => s + t.sellPrice, 0);
  const totalCost = tradeProfits.reduce((s, t) => s + t.cost, 0);

  // Find best + worst (by profit, not revenue)
  const best = tradeProfits.reduce(
    (best, t) => (t.profitEUR > (best?.profitEUR ?? -Infinity) ? t : best),
    null as null | { title: string; profitEUR: number },
  );
  const worst = tradeProfits.reduce(
    (worst, t) => (t.profitEUR < (worst?.profitEUR ?? Infinity) ? t : worst),
    null as null | { title: string; profitEUR: number },
  );

  return {
    ok: true,
    period: `${days}d`,
    totalProfitEUR: Math.round(totalProfit * 100) / 100,
    totalRevenueEUR: Math.round(totalRevenue * 100) / 100,
    totalCostEUR: Math.round(totalCost * 100) / 100,
    tradeCount,
    avgProfitPerTradeEUR:
      tradeCount > 0 ? Math.round((totalProfit / tradeCount) * 100) / 100 : 0,
    avgMarginPct:
      totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 10000) / 100 : 0,
    dailyAvgEUR: Math.round((totalProfit / days) * 100) / 100,
    bestTrade: best
      ? { title: best.title, profitEUR: Math.round(best.profitEUR * 100) / 100 }
      : null,
    worstTrade: worst
      ? { title: worst.title, profitEUR: Math.round(worst.profitEUR * 100) / 100 }
      : null,
  };
}
