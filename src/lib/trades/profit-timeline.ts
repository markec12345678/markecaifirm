// v8.37: Profit Timeline — aggregates Trade profit by week/month from DB.
//
// Used by Dashboard chart to show profit trend over time. Uporabnik vidi
// trend (raste/pada/stabilen) in lahko hitro odgovori na "kako poslujevem
// zadnjih N tednov/mesecev?".
//
// Per-trade profit formula (consistent with src/lib/profit/actual.ts):
//   profit = sellPrice - sellFees - buyPrice - buyFees
//
// Grouping:
//   - weekly    → ISO week (Monday start). Labels: "T32 2026", "T33 2026", ...
//   - monthly   → calendar month. Labels: "Avg 2026", "Sep 2026", ...
//
// Continuous timeline: includes empty periods with 0 profit (so chart shows
// gaps). Period range = [earliest sellDate in window, latest sellDate in window].
// If no trades in window: empty points[] array + trend='INSUFFICIENT_DATA'.
//
// Trend detection:
//   - INSUFFICIENT_DATA: <4 points OR sum of all profits == 0
//   - Split points into first half + second half
//   - firstAvg  = mean(profit) of first half
//   - secondAvg = mean(profit) of second half
//   - GROWING   : secondAvg > firstAvg × 1.1
//   - DECLINING : secondAvg < firstAvg × 0.9
//   - STABLE    : within ±10%
//
// Used by:
//   - GET /api/analytics/profit-timeline?granularity=weekly&days=90
//   - Dashboard ProfitTimelineChart (recharts line chart)

import { db } from '@/lib/db';

export interface TimelinePoint {
  date: string;              // ISO date (start of period, e.g. "2026-08-04" for week 32)
  label: string;             // human-readable: "T32 2026" or "Avg 2026"
  profit: number;            // sum of (sellPrice - sellFees - buyPrice - buyFees) for sold trades in period
  revenue: number;            // sum of sellPrice
  cost: number;               // sum of (buyPrice + buyFees + sellFees)
  tradeCount: number;         // number of sold trades in period
  cumulativeProfit: number;   // running total
}

export interface ProfitTimelineResult {
  ok: true;
  points: TimelinePoint[];
  granularity: 'weekly' | 'monthly';
  days: number;
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  totalTrades: number;
  bestWeek: TimelinePoint | null;
  worstWeek: TimelinePoint | null;
  avgWeeklyProfit: number;
  trend: 'GROWING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
  source: 'v8.37-profit-timeline';
}

/**
 * Round to 2 decimals (EUR precision).
 */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Get ISO week number (1-53) — Monday-start week.
 */
function getISOWeek(date: Date): { week: number; year: number } {
  // Copy date so we don't mutate original
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

/**
 * Get the Monday-start of the week containing `date`.
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sunday, 1=Monday, ...
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Get the first day of the month containing `date`.
 */
function getMonthStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

/**
 * Format a date as ISO yyyy-mm-dd.
 */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Slovenian month short labels (Jan, Feb, ...) — Slavic-friendly abbreviations.
 */
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
  'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec',
];

/**
 * Build a label for a period start date.
 * - weekly: "T32 2026" (ISO week number + year)
 * - monthly: "Avg 2026" (Slovenian month abbreviation + year)
 */
function buildLabel(date: Date, granularity: 'weekly' | 'monthly'): string {
  if (granularity === 'weekly') {
    const { week, year } = getISOWeek(date);
    return `T${week} ${year}`;
  }
  return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Add one period (week or month) to a date.
 */
function addPeriod(date: Date, granularity: 'weekly' | 'monthly'): Date {
  const d = new Date(date);
  if (granularity === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

/**
 * Aggregate profit by week or month from sold trades.
 *
 * @param granularity 'weekly' (default) or 'monthly'
 * @param days Lookback period (default 90 days). Trades sold before (now - days)
 *             are excluded. Timeline spans from first to last period with sales.
 */
export async function getProfitTimeline(
  granularity: 'weekly' | 'monthly' = 'weekly',
  days: number = 90,
): Promise<ProfitTimelineResult> {
  // Clamp days to [1, 730] (2 years max)
  const clampedDays = Math.max(1, Math.min(days, 730));

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - clampedDays);

  // 1. Fetch all sold trades with sellDate >= (now - days)
  const trades = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: since, not: null },
      sellPrice: { not: null },
    },
    select: {
      title: true,
      buyPrice: true,
      buyFees: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
    },
    orderBy: { sellDate: 'asc' },
  });

  // 2. Group by period
  const periodMap = new Map<string, {
    startDate: Date;
    label: string;
    profit: number;
    revenue: number;
    cost: number;
    tradeCount: number;
  }>();

  for (const t of trades) {
    if (!t.sellDate) continue;
    const sellDate = new Date(t.sellDate);
    const periodStart = granularity === 'weekly' ? getWeekStart(sellDate) : getMonthStart(sellDate);
    const key = isoDate(periodStart);

    const cur = periodMap.get(key) || {
      startDate: periodStart,
      label: buildLabel(periodStart, granularity),
      profit: 0,
      revenue: 0,
      cost: 0,
      tradeCount: 0,
    };

    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyFees = t.buyFees ?? 0;
    const profit = sellPrice - sellFees - t.buyPrice - buyFees;

    cur.profit += profit;
    cur.revenue += sellPrice;
    cur.cost += t.buyPrice + buyFees + sellFees;
    cur.tradeCount += 1;

    periodMap.set(key, cur);
  }

  // 3. Build continuous timeline (include empty periods between first and last)
  const points: TimelinePoint[] = [];

  if (periodMap.size === 0) {
    return {
      ok: true,
      points: [],
      granularity,
      days: clampedDays,
      totalProfit: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalTrades: 0,
      bestWeek: null,
      worstWeek: null,
      avgWeeklyProfit: 0,
      trend: 'INSUFFICIENT_DATA',
      source: 'v8.37-profit-timeline',
    };
  }

  // Sort period starts ascending
  const sortedStarts = Array.from(periodMap.values()).sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );
  const firstStart = sortedStarts[0].startDate;
  const lastStart = sortedStarts[sortedStarts.length - 1].startDate;

  // Walk from firstStart to lastStart, including empty periods
  let cursor = new Date(firstStart);
  let cumulative = 0;

  while (cursor.getTime() <= lastStart.getTime()) {
    const key = isoDate(cursor);
    const bucket = periodMap.get(key);
    const profit = bucket?.profit ?? 0;
    cumulative += profit;
    points.push({
      date: key,
      label: bucket?.label ?? buildLabel(cursor, granularity),
      profit: r2(profit),
      revenue: r2(bucket?.revenue ?? 0),
      cost: r2(bucket?.cost ?? 0),
      tradeCount: bucket?.tradeCount ?? 0,
      cumulativeProfit: r2(cumulative),
    });
    cursor = addPeriod(cursor, granularity);
  }

  // 4. Compute totals
  const totalProfit = points.reduce((s, p) => s + p.profit, 0);
  const totalRevenue = points.reduce((s, p) => s + p.revenue, 0);
  const totalCost = points.reduce((s, p) => s + p.cost, 0);
  const totalTrades = points.reduce((s, p) => s + p.tradeCount, 0);

  // 5. Find best/worst period (by weekly profit; only periods with trades qualify)
  const nonEmpty = points.filter((p) => p.tradeCount > 0);
  let bestWeek: TimelinePoint | null = null;
  let worstWeek: TimelinePoint | null = null;
  if (nonEmpty.length > 0) {
    bestWeek = nonEmpty.reduce((best, p) => (p.profit > best.profit ? p : best), nonEmpty[0]);
    worstWeek = nonEmpty.reduce((worst, p) => (p.profit < worst.profit ? p : worst), nonEmpty[0]);
  }

  // 6. Avg weekly profit
  const avgWeeklyProfit = nonEmpty.length > 0 ? totalProfit / nonEmpty.length : 0;

  // 7. Trend: compare first half avg vs second half avg
  let trend: ProfitTimelineResult['trend'] = 'STABLE';
  if (points.length < 4 || totalProfit === 0) {
    trend = 'INSUFFICIENT_DATA';
  } else {
    const half = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, half);
    const secondHalf = points.slice(half);
    const firstAvg = firstHalf.reduce((s, p) => s + p.profit, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, p) => s + p.profit, 0) / secondHalf.length;

    // Handle edge case: firstAvg == 0 (avoid div-by-zero)
    if (firstAvg === 0 && secondAvg === 0) {
      trend = 'STABLE';
    } else if (firstAvg === 0) {
      // Any positive growth from 0 is GROWING; negative is DECLINING
      trend = secondAvg > 0 ? 'GROWING' : 'DECLINING';
    } else if (secondAvg > firstAvg * 1.1) {
      trend = 'GROWING';
    } else if (secondAvg < firstAvg * 0.9) {
      trend = 'DECLINING';
    } else {
      trend = 'STABLE';
    }
  }

  return {
    ok: true,
    points,
    granularity,
    days: clampedDays,
    totalProfit: r2(totalProfit),
    totalRevenue: r2(totalRevenue),
    totalCost: r2(totalCost),
    totalTrades,
    bestWeek,
    worstWeek,
    avgWeeklyProfit: r2(avgWeeklyProfit),
    trend,
    source: 'v8.37-profit-timeline',
  };
}
