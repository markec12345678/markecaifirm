// v8.43: Annual Summary — yearly profit/loss breakdown for tax + dashboard.
//
// Aggregates: quarterly profit, monthly trend, category breakdown, top trades,
// tax estimate. Pure compute reading from Trade table — no AI, no Brain calls.
//
// Used by:
//   - GET /api/trades/annual-summary?year=2026 → AnnualSummary JSON
//   - GET /api/trades/tax-report-pdf?year=2026 → PDF (uses this module internally)
//   - Dashboard AnnualSummaryCard (self-fetches /api/trades/annual-summary every 60s)
//
// Tax model (Slovenian — dohodek iz oportunitetne dejavnosti / drugi dohodek):
//   - 22% flat tax (poenostavljena stopnja) for dohodek iz dejavnosti (ZDoh-2)
//     Most flippers/resellers qualify — same as s.p. poenostavljena stopnja.
//   - Above 60.000€/year: must register as s.p. (out of scope for this module).
//
// Per-trade profit formula (consistent with v8.23 actual.ts + v8.40 trade-insights):
//   profit = sellPrice - sellFees - buyPrice - buyFees
//
// Source derivation: prefer sellLocation, fall back to buyLocation, else 'Neznano'.

import { db } from '@/lib/db';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface QuarterlyBreakdown {
  quarter: number; // 1-4
  label: string; // 'Q1 (Jan-Mar)', 'Q2 (Apr-Jun)', etc.
  tradeCount: number;
  revenue: number;
  cost: number;
  profit: number;
  avgROI: number;
  winRate: number;
}

export interface MonthlyBreakdown {
  month: number; // 0-11 (0=Jan)
  label: string; // 'Januar', 'Februar', ..., 'December'
  shortLabel: string; // 'Jan', 'Feb', ...
  tradeCount: number;
  profit: number;
  cumulativeProfit: number;
}

export interface AnnualSummary {
  ok: true;
  year: number;
  summary: {
    totalTrades: number;
    soldTrades: number;
    heldTrades: number;
    cancelledTrades: number;
    totalRevenue: number;
    totalCost: number; // buyPrice + buyFees + sellFees
    totalBuyCost: number; // buyPrice + buyFees
    totalFees: number; // buyFees + sellFees
    grossProfit: number;
    estimatedTax: number; // grossProfit × 22% (Slovenian flat tax)
    netProfitAfterTax: number;
    taxRate: number; // 22 (%)
    avgROI: number; // %
    winRate: number; // %
    avgHoldDays: number;
    avgProfitPerTrade: number;
    bestMonth: { month: string; profit: number } | null;
    worstMonth: { month: string; profit: number } | null;
    bestCategory: { category: string; profit: number; roi: number } | null;
  };
  quarterly: QuarterlyBreakdown[]; // 4 entries
  monthly: MonthlyBreakdown[]; // 12 entries (including 0-profit months)
  topTrades: Array<{
    title: string;
    profit: number;
    category: string;
    source: string;
    sellDate: string;
    roi: number;
  }>; // top 5 by profit
  worstTrades: Array<{
    title: string;
    profit: number;
    category: string;
    source: string;
    sellDate: string;
    roi: number;
  }>; // worst 3 by profit (if any losses)
  categoryBreakdown: Array<{
    category: string;
    tradeCount: number;
    profit: number;
    revenue: number;
    cost: number;
    roi: number;
    winRate: number;
  }>;
  sourceBreakdown: Array<{
    source: string;
    tradeCount: number;
    profit: number;
    revenue: number;
    cost: number;
    roi: number;
    winRate: number;
  }>;
  source: 'v8.43-annual-summary';
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MONTH_NAMES_SL = [
  'Januar', 'Februar', 'Marec', 'April', 'Maj', 'Junij',
  'Julij', 'Avgust', 'September', 'Oktober', 'November', 'December',
];

const MONTH_SHORT_SL = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
  'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec',
];

const QUARTER_LABELS = [
  'Q1 (Jan-Mar)',
  'Q2 (Apr-Jun)',
  'Q3 (Jul-Sep)',
  'Q4 (Oct-Dec)',
];

// Slovenian flat tax rate for dohodek iz dejavnosti (poenostavljena stopnja).
// Most resellers/flippers fall under this — 22% flat, no deductions needed.
// Above 60.000€/yr one must register as s.p. (out of scope).
const SLO_FLAT_TAX_RATE = 0.22;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Round to 2 decimal places (EUR precision). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round to nearest integer (used for display of EUR amounts in PDF). */
function rInt(n: number): number {
  return Math.round(n);
}

/** Compute profit per trade (consistent with v8.23 actual.ts + v8.40 trade-insights). */
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

/** Compute ROI = totalProfit / totalInvested × 100 (0 if invested <= 0). */
function roiOf(totalProfit: number, totalInvested: number): number {
  if (totalInvested <= 0) return 0;
  return r2((totalProfit / totalInvested) * 100);
}

/** Derive source platform name from trade (prefer sellLocation, fallback buyLocation, else Neznano). */
function sourceOf(t: { sellLocation: string; buyLocation: string }): string {
  const s = (t.sellLocation ?? '').trim();
  if (s) return s;
  const b = (t.buyLocation ?? '').trim();
  if (b) return b;
  return 'Neznano';
}

/** Quarter number 1-4 from month 0-11. */
function quarterOf(month: number): number {
  return Math.floor(month / 3) + 1;
}

// ─── Augmented trade type ──────────────────────────────────────────────────

type TradeRow = {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date;
  buyLocation: string;
  sellPrice: number | null;
  sellDate: Date | null;
  sellLocation: string;
  sellFees: number;
  status: string;
};

type AugTrade = TradeRow & {
  profit: number;
  invested: number;
  holdDays: number;
  source: string;
  sellMonth: number; // 0-11 (NaN-safe — defaults to -1 if no sellDate)
  sellYear: number;
  roi: number; // per-trade ROI %
};

// ─── Main compute function ────────────────────────────────────────────────

/**
 * Generate annual summary for a given year.
 *
 * Aggregates all SOLD trades with sellDate in [year-01-01, year+1-01-01).
 * Also fetches HELD/CANCELLED trades bought in the same window for context
 * counts (soldTrades vs heldTrades vs cancelledTrades).
 *
 * @param year 4-digit year (e.g. 2026). Defaults to current year.
 */
export async function getAnnualSummary(
  year: number = new Date().getFullYear(),
): Promise<AnnualSummary> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  // Fetch SOLD trades in the year window
  const soldRaw = await db.trade.findMany({
    where: {
      status: 'sold',
      sellPrice: { not: null },
      sellDate: { gte: yearStart, lt: yearEnd },
    },
    select: {
      id: true, title: true, category: true,
      buyPrice: true, buyFees: true, buyDate: true, buyLocation: true,
      sellPrice: true, sellDate: true, sellLocation: true, sellFees: true,
      status: true,
    },
  });

  // Fetch HELD + CANCELLED counts (any trade bought in year window — used in summary totals)
  const heldCount = await db.trade.count({
    where: { status: 'held', buyDate: { gte: yearStart, lt: yearEnd } },
  });
  const cancelledCount = await db.trade.count({
    where: { status: 'cancelled', buyDate: { gte: yearStart, lt: yearEnd } },
  });

  // Augment with computed fields
  const sold: AugTrade[] = soldRaw.map((t) => {
    const profit = profitOf(t);
    const invested = investedOf(t);
    const sellDateObj = t.sellDate ? new Date(t.sellDate) : null;
    return {
      ...t,
      profit,
      invested,
      holdDays: holdDaysOf(t),
      source: sourceOf(t),
      sellMonth: sellDateObj ? sellDateObj.getMonth() : -1,
      sellYear: sellDateObj ? sellDateObj.getFullYear() : -1,
      roi: invested > 0 ? r2((profit / invested) * 100) : 0,
    };
  });

  // ─── Summary metrics ────────────────────────────────────────────────────
  const totalRevenue = sold.reduce(
    (s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0),
    0,
  );
  const totalBuyCost = sold.reduce((s, t) => s + t.invested, 0);
  const totalFees = sold.reduce((s, t) => s + (t.buyFees ?? 0) + (t.sellFees ?? 0), 0);
  const totalCost = totalBuyCost + sold.reduce((s, t) => s + (t.sellFees ?? 0), 0);
  const grossProfit = sold.reduce((s, t) => s + t.profit, 0);
  const profitableCount = sold.filter((t) => t.profit > 0).length;
  const overallWinRate = sold.length > 0 ? r2((profitableCount / sold.length) * 100) : 0;
  const avgROI = roiOf(grossProfit, totalBuyCost);
  const avgHoldDays =
    sold.length > 0 ? r2(sold.reduce((s, t) => s + t.holdDays, 0) / sold.length) : 0;
  const avgProfitPerTrade = sold.length > 0 ? r2(grossProfit / sold.length) : 0;

  const estimatedTax = r2(Math.max(0, grossProfit) * SLO_FLAT_TAX_RATE);
  const netProfitAfterTax = r2(grossProfit - estimatedTax);

  // ─── Quarterly breakdown (4 entries, always all 4) ──────────────────────
  const quarterly: QuarterlyBreakdown[] = [];
  for (let q = 1; q <= 4; q++) {
    const qStartMonth = (q - 1) * 3;
    const qTrades = sold.filter((t) => quarterOf(t.sellMonth) === q);
    const qRevenue = qTrades.reduce(
      (s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0),
      0,
    );
    const qCost = qTrades.reduce((s, t) => s + t.invested + (t.sellFees ?? 0), 0);
    const qProfit = qTrades.reduce((s, t) => s + t.profit, 0);
    const qInvested = qTrades.reduce((s, t) => s + t.invested, 0);
    const qWinRate = winRateOf(qTrades.map((t) => t.profit));
    quarterly.push({
      quarter: q,
      label: QUARTER_LABELS[q - 1],
      tradeCount: qTrades.length,
      revenue: r2(qRevenue),
      cost: r2(qCost),
      profit: r2(qProfit),
      avgROI: roiOf(qProfit, qInvested),
      winRate: qWinRate,
    });
  }

  // ─── Monthly breakdown (12 entries, including 0-profit months) ──────────
  const monthly: MonthlyBreakdown[] = [];
  let cumulative = 0;
  for (let m = 0; m < 12; m++) {
    const mTrades = sold.filter((t) => t.sellMonth === m);
    const mProfit = mTrades.reduce((s, t) => s + t.profit, 0);
    cumulative += mProfit;
    monthly.push({
      month: m,
      label: MONTH_NAMES_SL[m],
      shortLabel: MONTH_SHORT_SL[m],
      tradeCount: mTrades.length,
      profit: r2(mProfit),
      cumulativeProfit: r2(cumulative),
    });
  }

  // ─── Best/worst month ────────────────────────────────────────────────────
  const monthsWithSales = monthly.filter((m) => m.tradeCount > 0);
  let bestMonth: { month: string; profit: number } | null = null;
  let worstMonth: { month: string; profit: number } | null = null;
  if (monthsWithSales.length > 0) {
    const best = monthsWithSales.reduce((a, b) => (b.profit > a.profit ? b : a));
    const worst = monthsWithSales.reduce((a, b) => (b.profit < a.profit ? b : a));
    bestMonth = { month: best.label, profit: best.profit };
    worstMonth = { month: worst.label, profit: worst.profit };
  }

  // ─── Top 5 / worst 3 trades ──────────────────────────────────────────────
  const sortedByProfitDesc = [...sold].sort((a, b) => b.profit - a.profit);
  const topTrades = sortedByProfitDesc.slice(0, 5).map((t) => ({
    title: t.title,
    profit: r2(t.profit),
    category: t.category || 'drugo',
    source: t.source,
    sellDate: t.sellDate ? new Date(t.sellDate).toISOString() : '',
    roi: t.roi,
  }));
  // Worst 3 = trades with lowest profit (losses first), only if there are any losses
  const losses = sortedByProfitDesc
    .filter((t) => t.profit < 0)
    .slice(-3)
    .reverse(); // most negative first
  const worstTrades = losses.map((t) => ({
    title: t.title,
    profit: r2(t.profit),
    category: t.category || 'drugo',
    source: t.source,
    sellDate: t.sellDate ? new Date(t.sellDate).toISOString() : '',
    roi: t.roi,
  }));

  // ─── Category breakdown ──────────────────────────────────────────────────
  const catMap: Record<
    string,
    { count: number; profit: number; revenue: number; cost: number; invested: number; profits: number[] }
  > = {};
  for (const t of sold) {
    const cat = t.category || 'drugo';
    if (!catMap[cat]) {
      catMap[cat] = { count: 0, profit: 0, revenue: 0, cost: 0, invested: 0, profits: [] };
    }
    catMap[cat].count++;
    catMap[cat].profit += t.profit;
    catMap[cat].revenue += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    catMap[cat].cost += t.invested + (t.sellFees ?? 0);
    catMap[cat].invested += t.invested;
    catMap[cat].profits.push(t.profit);
  }
  const categoryBreakdown = Object.entries(catMap)
    .map(([cat, v]) => ({
      category: cat,
      tradeCount: v.count,
      profit: r2(v.profit),
      revenue: r2(v.revenue),
      cost: r2(v.cost),
      roi: roiOf(v.profit, v.invested),
      winRate: winRateOf(v.profits),
    }))
    .sort((a, b) => b.profit - a.profit);

  let bestCategory: { category: string; profit: number; roi: number } | null = null;
  if (categoryBreakdown.length > 0) {
    const best = categoryBreakdown[0];
    bestCategory = { category: best.category, profit: best.profit, roi: best.roi };
  }

  // ─── Source breakdown ─────────────────────────────────────────────────────
  const srcMap: Record<
    string,
    { count: number; profit: number; revenue: number; cost: number; invested: number; profits: number[] }
  > = {};
  for (const t of sold) {
    const src = t.source;
    if (!srcMap[src]) {
      srcMap[src] = { count: 0, profit: 0, revenue: 0, cost: 0, invested: 0, profits: [] };
    }
    srcMap[src].count++;
    srcMap[src].profit += t.profit;
    srcMap[src].revenue += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    srcMap[src].cost += t.invested + (t.sellFees ?? 0);
    srcMap[src].invested += t.invested;
    srcMap[src].profits.push(t.profit);
  }
  const sourceBreakdown = Object.entries(srcMap)
    .map(([src, v]) => ({
      source: src,
      tradeCount: v.count,
      profit: r2(v.profit),
      revenue: r2(v.revenue),
      cost: r2(v.cost),
      roi: roiOf(v.profit, v.invested),
      winRate: winRateOf(v.profits),
    }))
    .sort((a, b) => b.profit - a.profit);

  // ─── Return assembled summary ────────────────────────────────────────────
  return {
    ok: true,
    year,
    summary: {
      totalTrades: sold.length + heldCount + cancelledCount,
      soldTrades: sold.length,
      heldTrades: heldCount,
      cancelledTrades: cancelledCount,
      totalRevenue: r2(totalRevenue),
      totalCost: r2(totalCost),
      totalBuyCost: r2(totalBuyCost),
      totalFees: r2(totalFees),
      grossProfit: r2(grossProfit),
      estimatedTax,
      netProfitAfterTax,
      taxRate: SLO_FLAT_TAX_RATE * 100,
      avgROI,
      winRate: overallWinRate,
      avgHoldDays,
      avgProfitPerTrade,
      bestMonth,
      worstMonth,
      bestCategory,
    },
    quarterly,
    monthly,
    topTrades,
    worstTrades,
    categoryBreakdown,
    sourceBreakdown,
    source: 'v8.43-annual-summary',
  };
}

// ─── Exported constants + helpers (for downstream use, e.g. PDF generator) ─

export const ANNUAL_SUMMARY_META = {
  MONTH_NAMES_SL,
  MONTH_SHORT_SL,
  QUARTER_LABELS,
  SLO_FLAT_TAX_RATE,
  r2,
  rInt,
  sourceOf,
  quarterOf,
};

/**
 * Format an EUR amount with thousands separator + 2 decimals.
 * Used by PDF generator + Dashboard card.
 *
 *   fmtEUR(1234.5) → '1.234,50 €'
 *   fmtEUR(-50)    → '-50,00 €'
 *   fmtEUR(0)      → '0,00 €'
 */
export function fmtEUR(n: number, decimals = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${intWithSep},${decPart} €`;
}

/**
 * Format an EUR amount as integer (no decimals, with thousands separator).
 *   fmtEURInt(1234.5) → '1.235 €'
 */
export function fmtEURInt(n: number): string {
  return fmtEUR(Math.round(n), 0);
}
