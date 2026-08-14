// v8.40: Trade Insights Deep Dive — aggregates Trade data into actionable insights.
// "KDAJ in KJE prodati za maksimalen profit?"
//
// Pure compute reading from Trade table — no AI, no Brain calls.
//
// Six analysis dimensions:
//   1. Day-of-Week     — avg profit per weekday (najboljši dan za prodajo)
//   2. Source Platform  — Bolha vs Vinted vs Avtonet vs mobile.de (ROI, win rate, best category)
//   3. Category         — profit per category with trend (GROWING/STABLE/DECLINING)
//   4. Hold Period      — optimalni hold (0-7d, 8-14d, 15-30d, 31-60d, 60+d)
//   5. Profit Distrib.  — kako so porazdeljeni profiti (majhni wini vs veliki wini)
//   6. Actionable Insights — avtomatska slovenska priporočila
//
// Per-trade profit formula (consistent with src/lib/profit/actual.ts + v8.37 profit-timeline):
//   profit = sellPrice - sellFees - buyPrice - buyFees
//
// Used by:
//   - GET /api/analytics/trade-insights?days=365 → TradeInsights
//   - Dashboard TradeInsightsCard (6 collapsible sections, 4 recharts charts, auto-refresh 60s)

import { db } from '@/lib/db';

export interface DayOfWeekInsight {
  dayOfWeek: number; // 0=Sunday ... 6=Saturday
  dayName: string; // 'Nedelja', 'Ponedeljek', ...
  tradeCount: number; // SOLD trades sold on this weekday
  totalProfit: number;
  avgProfit: number;
  sellThroughRate: number; // sold / (sold + held + cancelled) for trades BOUGHT on this weekday
}

export interface SourcePlatformInsight {
  source: string; // 'Bolha', 'Vinted', 'Avtonet', 'mobile.de', 'Neznano'
  tradeCount: number;
  totalInvested: number;
  totalRevenue: number;
  totalProfit: number;
  avgROI: number; // (totalProfit / totalInvested) × 100
  avgHoldDays: number;
  winRate: number; // profitable trades / total trades × 100
  bestCategory: string; // category with highest total profit in this source
}

export interface CategoryInsight {
  category: string;
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
  avgROI: number;
  avgHoldDays: number;
  winRate: number;
  trend: 'GROWING' | 'STABLE' | 'DECLINING'; // first half vs second half by sellDate
}

export interface HoldPeriodInsight {
  bucket: string; // '0-7d', '8-14d', '15-30d', '31-60d', '60+d'
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
  avgROI: number;
  winRate: number;
}

export interface ProfitDistributionInsight {
  bucket: string; // '<-50€', '-50-0€', '0-50€', '50-100€', '100-200€', '200+€'
  tradeCount: number;
  percentage: number;
}

export interface TradeInsights {
  ok: true;
  summary: {
    totalTrades: number;
    soldTrades: number;
    heldTrades: number;
    cancelledTrades: number;
    totalProfit: number;
    totalInvested: number;
    avgProfitPerTrade: number;
    avgROI: number;
    avgHoldDays: number;
    overallWinRate: number;
    profitableCount: number;
  };
  bestDayOfWeek: DayOfWeekInsight | null;
  worstDayOfWeek: DayOfWeekInsight | null;
  dayOfWeekAnalysis: DayOfWeekInsight[]; // 7 entries (Sun-Sat)
  sourcePlatformAnalysis: SourcePlatformInsight[];
  bestSource: SourcePlatformInsight | null;
  categoryAnalysis: CategoryInsight[];
  bestCategory: CategoryInsight | null;
  holdPeriodAnalysis: HoldPeriodInsight[]; // 5 buckets
  optimalHoldDays: string | null; // bucket with highest avgProfit
  profitDistribution: ProfitDistributionInsight[]; // 6 buckets
  actionableInsights: string[]; // Slovenian recommendations
  source: 'v8.40-trade-insights';
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const DAY_NAMES_SL = [
  'Nedelja', // 0
  'Ponedeljek', // 1
  'Torek', // 2
  'Sreda', // 3
  'Četrtek', // 4
  'Petek', // 5
  'Sobota', // 6
];

const DAY_SHORT_SL = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];

/** Round to 2 decimal places (EUR precision). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute profit per trade (consistent with v8.23 actual.ts + v8.37 profit-timeline). */
function profitOf(t: {
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
}): number {
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  const buyFees = t.buyFees ?? 0;
  return sellPrice - sellFees - t.buyPrice - buyFees;
}

/** Compute total invested (buyPrice + buyFees). */
function investedOf(t: { buyPrice: number; buyFees: number }): number {
  return t.buyPrice + (t.buyFees ?? 0);
}

/** Compute hold days = (sellDate - buyDate) in days, floored. Returns 0 if either missing. */
function holdDaysOf(t: { buyDate: Date | string; sellDate: Date | string | null }): number {
  if (!t.sellDate) return 0;
  const buy = new Date(t.buyDate).getTime();
  const sell = new Date(t.sellDate).getTime();
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || sell < buy) return 0;
  return Math.floor((sell - buy) / 86_400_000);
}

/** Compute win rate = profitableTrades / totalTrades × 100 (0 if total=0). */
function winRateOf(profits: number[]): number {
  if (profits.length === 0) return 0;
  const profitable = profits.filter((p) => p > 0).length;
  return r2((profitable / profits.length) * 100);
}

/** Compute average of an array (0 if empty). */
function avgOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Compute ROI = totalProfit / totalInvested × 100 (0 if invested <= 0). */
function roiOf(totalProfit: number, totalInvested: number): number {
  if (totalInvested <= 0) return 0;
  return r2((totalProfit / totalInvested) * 100);
}

/**
 * Trend detection (consistent with v8.37 profit-timeline pattern):
 *   - Need at least 4 trades to detect trend
 *   - Split sorted trades into first half + second half by sellDate
 *   - GROWING   : secondAvg > firstAvg × 1.1
 *   - DECLINING : secondAvg < firstAvg × 0.9
 *   - STABLE    : within ±10%
 */
function trendOf(
  trades: Array<{ sellDate: Date | string | null; profit: number }>,
): 'GROWING' | 'STABLE' | 'DECLINING' {
  if (trades.length < 4) return 'STABLE';
  const sorted = [...trades]
    .filter((t) => t.sellDate)
    .sort((a, b) => new Date(a.sellDate!).getTime() - new Date(b.sellDate!).getTime());
  if (sorted.length < 4) return 'STABLE';
  const half = Math.floor(sorted.length / 2);
  const firstAvg = avgOf(sorted.slice(0, half).map((t) => t.profit));
  const secondAvg = avgOf(sorted.slice(half).map((t) => t.profit));
  if (firstAvg === 0 && secondAvg === 0) return 'STABLE';
  if (firstAvg === 0) return secondAvg > 0 ? 'GROWING' : 'DECLINING';
  if (secondAvg > firstAvg * 1.1) return 'GROWING';
  if (secondAvg < firstAvg * 0.9) return 'DECLINING';
  return 'STABLE';
}

// ─── Buckets ───────────────────────────────────────────────────────────────

const HOLD_BUCKETS: Array<{ key: string; min: number; max: number }> = [
  { key: '0-7d', min: 0, max: 7 },
  { key: '8-14d', min: 8, max: 14 },
  { key: '15-30d', min: 15, max: 30 },
  { key: '31-60d', min: 31, max: 60 },
  { key: '60+d', min: 61, max: Number.POSITIVE_INFINITY },
];

const PROFIT_BUCKETS: Array<{ key: string; min: number; max: number }> = [
  { key: '<-50€', min: Number.NEGATIVE_INFINITY, max: -50 },
  { key: '-50-0€', min: -50, max: 0 },
  { key: '0-50€', min: 0, max: 50 },
  { key: '50-100€', min: 50, max: 100 },
  { key: '100-200€', min: 100, max: 200 },
  { key: '200+€', min: 200, max: Number.POSITIVE_INFINITY },
];

function bucketFor(days: number): typeof HOLD_BUCKETS[number] | null {
  for (const b of HOLD_BUCKETS) {
    if (days >= b.min && days <= b.max) return b;
  }
  return null;
}

function profitBucketFor(profit: number): typeof PROFIT_BUCKETS[number] | null {
  for (const b of PROFIT_BUCKETS) {
    // Use [min, max) semantics — left-inclusive, right-exclusive — except last bucket which is inclusive.
    if (b.max === Number.POSITIVE_INFINITY) {
      if (profit >= b.min) return b;
    } else if (profit >= b.min && profit < b.max) {
      return b;
    }
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────

/**
 * Generate deep trade insights from Trade table.
 *
 * @param days Lookback period in days (default 365). Trades sold before (now - days)
 *             are excluded from analysis. Trades held/cancelled within this window
 *             also count toward sell-through rate.
 */
export async function getTradeInsights(days: number = 365): Promise<TradeInsights> {
  // Clamp days to [1, 1095] (3 years max — longer lookback = better trend detection)
  const clampedDays = Math.max(1, Math.min(days, 1095));

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - clampedDays);

  // Fetch ALL trades (sold + held + cancelled) with sellDate >= since OR buyDate >= since.
  // We need held/cancelled trades too for sell-through rate computation.
  // For sold trades, we filter by sellDate >= since (the moment the sale happened).
  // For held/cancelled, we filter by buyDate >= since (the moment the trade was opened).
  const tradesRaw = await db.trade.findMany({
    where: {
      OR: [
        { status: 'sold', sellDate: { gte: since, not: null } },
        { status: 'held', buyDate: { gte: since } },
        { status: 'cancelled', buyDate: { gte: since } },
      ],
    },
    select: {
      id: true,
      title: true,
      category: true,
      buyPrice: true,
      buyFees: true,
      buyDate: true,
      buyLocation: true,
      sellPrice: true,
      sellDate: true,
      sellLocation: true,
      sellFees: true,
      status: true,
    },
  });

  // Augment with computed profit + invested + holdDays
  type Aug = (typeof tradesRaw)[number] & { profit: number; invested: number; holdDays: number };
  const trades: Aug[] = tradesRaw.map((t) => ({
    ...t,
    profit: profitOf(t),
    invested: investedOf(t),
    holdDays: holdDaysOf(t),
  }));

  const soldTrades = trades.filter((t) => t.status === 'sold');
  const heldTrades = trades.filter((t) => t.status === 'held');
  const cancelledTrades = trades.filter((t) => t.status === 'cancelled');

  const totalTrades = trades.length;
  const soldCount = soldTrades.length;
  const heldCount = heldTrades.length;
  const cancelledCount = cancelledTrades.length;

  const totalProfit = soldTrades.reduce((s, t) => s + t.profit, 0);
  const totalInvested = soldTrades.reduce((s, t) => s + t.invested, 0);
  const profitableCount = soldTrades.filter((t) => t.profit > 0).length;
  const overallWinRate = soldCount > 0 ? r2((profitableCount / soldCount) * 100) : 0;
  const avgProfitPerTrade = soldCount > 0 ? r2(totalProfit / soldCount) : 0;
  const avgROI = roiOf(totalProfit, totalInvested);
  const avgHoldDays =
    soldCount > 0 ? r2(soldTrades.reduce((s, t) => s + t.holdDays, 0) / soldCount) : 0;

  // ─── 1. Day-of-Week analysis (7 entries, Sun-Sat) ───────────────────────
  const dayBuckets: DayOfWeekInsight[] = [];
  for (let d = 0; d < 7; d++) {
    // SOLD trades sold on this weekday
    const soldOnDay = soldTrades.filter((t) => {
      if (!t.sellDate) return false;
      return new Date(t.sellDate).getDay() === d;
    });
    const soldProfit = soldOnDay.reduce((s, t) => s + t.profit, 0);
    const soldCountOnDay = soldOnDay.length;

    // Sell-through rate: of ALL trades (any status) BOUGHT on this weekday, how many sold?
    const allBoughtOnDay = trades.filter((t) => new Date(t.buyDate).getDay() === d);
    const soldBoughtOnDay = allBoughtOnDay.filter((t) => t.status === 'sold').length;
    const str =
      allBoughtOnDay.length > 0 ? r2((soldBoughtOnDay / allBoughtOnDay.length) * 100) : 0;

    dayBuckets.push({
      dayOfWeek: d,
      dayName: DAY_NAMES_SL[d],
      tradeCount: soldCountOnDay,
      totalProfit: r2(soldProfit),
      avgProfit: soldCountOnDay > 0 ? r2(soldProfit / soldCountOnDay) : 0,
      sellThroughRate: str,
    });
  }

  // Best day: highest avgProfit (must have ≥1 sold trade)
  const daysWithSales = dayBuckets.filter((d) => d.tradeCount > 0);
  let bestDayOfWeek: DayOfWeekInsight | null = null;
  let worstDayOfWeek: DayOfWeekInsight | null = null;
  if (daysWithSales.length > 0) {
    bestDayOfWeek = daysWithSales.reduce((best, d) =>
      d.avgProfit > best.avgProfit ? d : best,
    );
    worstDayOfWeek = daysWithSales.reduce((worst, d) =>
      d.avgProfit < worst.avgProfit ? d : worst,
    );
  }

  // ─── 2. Source platform analysis (group by buyLocation) ─────────────────
  const sourceMap = new Map<string, Aug[]>();
  for (const t of soldTrades) {
    const src = t.buyLocation?.trim() || 'Neznano';
    const arr = sourceMap.get(src) ?? [];
    arr.push(t);
    sourceMap.set(src, arr);
  }

  const sourcePlatformAnalysis: SourcePlatformInsight[] = Array.from(sourceMap.entries())
    .map(([source, ts]) => {
      const invested = ts.reduce((s, t) => s + t.invested, 0);
      const revenue = ts.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
      const profit = ts.reduce((s, t) => s + t.profit, 0);
      const profits = ts.map((t) => t.profit);
      const holdDays = ts.map((t) => t.holdDays);
      // bestCategory within this source: highest total profit
      const catMap = new Map<string, number>();
      for (const t of ts) {
        const c = t.category?.trim() || 'brez kategorije';
        catMap.set(c, (catMap.get(c) ?? 0) + t.profit);
      }
      let bestCategory = '—';
      let bestCatProfit = -Infinity;
      for (const [c, p] of catMap) {
        if (p > bestCatProfit) {
          bestCatProfit = p;
          bestCategory = c;
        }
      }
      return {
        source,
        tradeCount: ts.length,
        totalInvested: r2(invested),
        totalRevenue: r2(revenue),
        totalProfit: r2(profit),
        avgROI: roiOf(profit, invested),
        avgHoldDays: r2(avgOf(holdDays)),
        winRate: winRateOf(profits),
        bestCategory,
      };
    })
    .sort((a, b) => b.totalProfit - a.totalProfit);

  // bestSource: highest avgROI (must have ≥1 sold trade, invested > 0 to compute ROI fairly)
  let bestSource: SourcePlatformInsight | null = null;
  const sourcesWithROI = sourcePlatformAnalysis.filter((s) => s.totalInvested > 0);
  if (sourcesWithROI.length > 0) {
    bestSource = sourcesWithROI.reduce((best, s) => (s.avgROI > best.avgROI ? s : best));
  } else if (sourcePlatformAnalysis.length > 0) {
    bestSource = sourcePlatformAnalysis[0];
  }

  // ─── 3. Category analysis (group by category) ───────────────────────────
  const catMap = new Map<string, Aug[]>();
  for (const t of soldTrades) {
    const c = t.category?.trim() || 'brez kategorije';
    const arr = catMap.get(c) ?? [];
    arr.push(t);
    catMap.set(c, arr);
  }

  const categoryAnalysis: CategoryInsight[] = Array.from(catMap.entries())
    .map(([category, ts]) => {
      const invested = ts.reduce((s, t) => s + t.invested, 0);
      const profit = ts.reduce((s, t) => s + t.profit, 0);
      const profits = ts.map((t) => t.profit);
      const holdDays = ts.map((t) => t.holdDays);
      const trend = trendOf(ts.map((t) => ({ sellDate: t.sellDate, profit: t.profit })));
      return {
        category,
        tradeCount: ts.length,
        totalProfit: r2(profit),
        avgProfit: r2(avgOf(profits)),
        avgROI: roiOf(profit, invested),
        avgHoldDays: r2(avgOf(holdDays)),
        winRate: winRateOf(profits),
        trend,
      };
    })
    .sort((a, b) => b.totalProfit - a.totalProfit);

  // bestCategory: highest avgROI (with invested > 0)
  let bestCategory: CategoryInsight | null = null;
  const catsWithROI = categoryAnalysis.filter((c) => c.tradeCount > 0);
  const catsWithInvestment = catsWithROI.filter(
    (c) => c.avgROI !== 0 || c.tradeCount > 0,
  );
  if (catsWithInvestment.length > 0) {
    bestCategory = catsWithInvestment.reduce((best, c) =>
      c.avgROI > best.avgROI ? c : best,
    );
  } else if (categoryAnalysis.length > 0) {
    bestCategory = categoryAnalysis[0];
  }

  // ─── 4. Hold period analysis (5 buckets) ────────────────────────────────
  const holdPeriodAnalysis: HoldPeriodInsight[] = HOLD_BUCKETS.map((b) => {
    const ts = soldTrades.filter((t) => {
      const match = bucketFor(t.holdDays);
      return match?.key === b.key;
    });
    const invested = ts.reduce((s, t) => s + t.invested, 0);
    const profit = ts.reduce((s, t) => s + t.profit, 0);
    const profits = ts.map((t) => t.profit);
    return {
      bucket: b.key,
      tradeCount: ts.length,
      totalProfit: r2(profit),
      avgProfit: ts.length > 0 ? r2(profit / ts.length) : 0,
      avgROI: roiOf(profit, invested),
      winRate: winRateOf(profits),
    };
  });

  // optimalHoldDays: bucket with highest avgProfit (must have ≥1 trade)
  let optimalHoldDays: string | null = null;
  const holdsWithTrades = holdPeriodAnalysis.filter((h) => h.tradeCount > 0);
  if (holdsWithTrades.length > 0) {
    const best = holdsWithTrades.reduce((best, h) =>
      h.avgProfit > best.avgProfit ? h : best,
    );
    optimalHoldDays = best.bucket;
  }

  // ─── 5. Profit distribution (6 buckets) ────────────────────────────────
  const profitDistribution: ProfitDistributionInsight[] = PROFIT_BUCKETS.map((b) => {
    const ts = soldTrades.filter((t) => profitBucketFor(t.profit)?.key === b.key);
    return {
      bucket: b.key,
      tradeCount: ts.length,
      percentage:
        soldCount > 0 ? r2((ts.length / soldCount) * 100) : 0,
    };
  });

  // ─── 6. Actionable insights (Slovenian recommendations) ─────────────────
  const actionableInsights: string[] = [];

  if (soldCount === 0) {
    actionableInsights.push(
      '📊 Ni prodaj v izbranem obdobju — dodaj vsaj 5 sold trades za analizo.',
    );
  } else {
    // Best day
    if (bestDayOfWeek && bestDayOfWeek.tradeCount > 0) {
      actionableInsights.push(
        `📊 Najboljši dan za prodajo: ${bestDayOfWeek.dayName} (avg ${bestDayOfWeek.avgProfit.toFixed(0)}€/trade, ${bestDayOfWeek.tradeCount} prodaj).`,
      );
    }
    // Worst day (only if meaningfully worse — different day, lower profit)
    if (
      worstDayOfWeek &&
      bestDayOfWeek &&
      worstDayOfWeek.dayOfWeek !== bestDayOfWeek.dayOfWeek &&
      worstDayOfWeek.tradeCount > 0 &&
      worstDayOfWeek.avgProfit < bestDayOfWeek.avgProfit
    ) {
      actionableInsights.push(
        `⚠️ Najslabši dan za prodajo: ${worstDayOfWeek.dayName} (avg ${worstDayOfWeek.avgProfit.toFixed(0)}€/trade). Razmisli o prestavitvi objave.`,
      );
    }
    // Best source
    if (bestSource) {
      actionableInsights.push(
        `🏪 Najboljši vir: ${bestSource.source} (${bestSource.avgROI.toFixed(0)}% ROI, ${bestSource.tradeCount} trade-ov, ${bestSource.winRate.toFixed(0)}% win rate).`,
      );
    }
    // Best category
    if (bestCategory) {
      const trendEmoji =
        bestCategory.trend === 'GROWING'
          ? '↗️'
          : bestCategory.trend === 'DECLINING'
            ? '↘️'
            : '→';
      actionableInsights.push(
        `📦 Najboljša kategorija: ${bestCategory.category} (${bestCategory.avgROI.toFixed(0)}% ROI, ${bestCategory.tradeCount} trade-ov, ${trendEmoji} ${bestCategory.trend}).`,
      );
    }
    // Optimal hold
    if (optimalHoldDays) {
      const optBucket = holdPeriodAnalysis.find((h) => h.bucket === optimalHoldDays);
      if (optBucket) {
        actionableInsights.push(
          `⏱️ Optimalni hold: ${optBucket.bucket} (avg ${optBucket.avgProfit.toFixed(0)}€/trade, ${optBucket.winRate.toFixed(0)}% win rate, ${optBucket.tradeCount} trade-ov).`,
        );
      }
    }
    // Win rate
    actionableInsights.push(
      `✅ Win rate: ${overallWinRate.toFixed(0)}% — ${profitableCount} od ${soldCount} trade-ov donosnih.`,
    );
    if (overallWinRate < 50) {
      actionableInsights.push(
        '⚠️ Win rate pod 50% — preglej pricing strategijo in buy pristopbine.',
      );
    }
    // Avg ROI
    actionableInsights.push(
      `📈 Povprečni ROI: ${avgROI.toFixed(0)}% (investirano ${totalInvested.toFixed(0)}€, profit ${totalProfit.toFixed(0)}€).`,
    );
    // Profit distribution — most common bucket
    const topBucket = [...profitDistribution].sort((a, b) => b.tradeCount - a.tradeCount)[0];
    if (topBucket && topBucket.tradeCount > 0) {
      // Loss buckets are explicitly the ones where profit < 0 (negative).
      // '0-50€' contains '-' but is positive (small win), so check explicitly.
      const LOSS_BUCKETS = new Set(['<-50€', '-50-0€']);
      const isLoss = LOSS_BUCKETS.has(topBucket.bucket);
      actionableInsights.push(
        `💰 Večina trade-ov donosi ${topBucket.bucket} (${topBucket.percentage.toFixed(0)}% vseh prodaj)${isLoss ? ' — POZOR: prevlado IZGUBE!' : ' (majhni wini prevladujejo).'}`,
      );
    }
    // Avg hold days
    actionableInsights.push(
      `📅 Povprečni hold: ${avgHoldDays.toFixed(0)} dni (med kupljeno in prodano).`,
    );
  }

  return {
    ok: true,
    summary: {
      totalTrades,
      soldTrades: soldCount,
      heldTrades: heldCount,
      cancelledTrades: cancelledCount,
      totalProfit: r2(totalProfit),
      totalInvested: r2(totalInvested),
      avgProfitPerTrade,
      avgROI,
      avgHoldDays,
      overallWinRate,
      profitableCount,
    },
    bestDayOfWeek,
    worstDayOfWeek,
    dayOfWeekAnalysis: dayBuckets,
    sourcePlatformAnalysis,
    bestSource,
    categoryAnalysis,
    bestCategory,
    holdPeriodAnalysis,
    optimalHoldDays,
    profitDistribution,
    actionableInsights,
    source: 'v8.40-trade-insights',
  };
}

// Export helpers for downstream use (e.g. tests, other analytics modules)
export const TRADE_INSIGHTS_META = {
  DAY_NAMES_SL,
  DAY_SHORT_SL,
  HOLD_BUCKETS: HOLD_BUCKETS.map((b) => b.key),
  PROFIT_BUCKETS: PROFIT_BUCKETS.map((b) => b.key),
};
