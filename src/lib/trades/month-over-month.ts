// v8.61: Month-over-Month Comparison — "This month: 351€ vs Last month: 667€, -47%"
// + Category Performance Timeline — monthly profit per category over last 6 months.

import { db } from '@/lib/db';

export interface MonthData {
  month: number;           // 0-11
  year: number;
  label: string;           // 'Jul 2026', 'Avg 2026'
  tradeCount: number;
  profit: number;
  revenue: number;
  cost: number;
  avgROI: number;
  winRate: number;
}

export interface CategoryMonthData {
  category: string;
  months: Array<{ month: string; profit: number; tradeCount: number }>;
  totalProfit: number;
  avgMonthlyProfit: number;
  trend: 'GROWING' | 'STABLE' | 'DECLINING' | 'NEW' | 'DEAD';
}

export interface MonthOverMonthResult {
  ok: true;
  currentMonth: MonthData;
  lastMonth: MonthData;
  momChange: number;        // absolute EUR difference
  momChangePct: number;     // % change
  momDirection: 'UP' | 'DOWN' | 'FLAT';
  // 6-month history
  monthlyHistory: MonthData[];  // 6 entries (current + 5 previous)
  // Category breakdown
  categories: CategoryMonthData[];
  bestCategory: string | null;
  worstCategory: string | null;
  // Summary
  avgMonthlyProfit: number;
  bestMonth: { label: string; profit: number } | null;
  worstMonth: { label: string; profit: number } | null;
  source: 'v8.61-month-over-month';
}

const MONTH_LABELS_SL = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];

export async function getMonthOverMonth(): Promise<MonthOverMonthResult> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Fetch all sold trades from last 6 months
  const sixMonthsAgo = new Date(currentYear, currentMonth - 5, 1);
  const soldTrades = await db.trade.findMany({
    where: {
      status: 'sold',
      sellDate: { gte: sixMonthsAgo },
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

  // Group by month
  const monthlyMap: Record<string, MonthData> = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date(currentYear, currentMonth - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthlyMap[key] = {
      month: d.getMonth(),
      year: d.getFullYear(),
      label: `${MONTH_LABELS_SL[d.getMonth()]} ${d.getFullYear()}`,
      tradeCount: 0,
      profit: 0,
      revenue: 0,
      cost: 0,
      avgROI: 0,
      winRate: 0,
    };
  }

  // Populate monthly data
  const monthlyTrades: Record<string, any[]> = {};
  for (const t of soldTrades) {
    if (!t.sellDate) continue;
    const d = new Date(t.sellDate);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!monthlyMap[key]) continue;

    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const cost = t.buyPrice + (t.buyFees ?? 0);

    monthlyMap[key].tradeCount++;
    monthlyMap[key].profit += profit;
    monthlyMap[key].revenue += revenue;
    monthlyMap[key].cost += cost;

    if (!monthlyTrades[key]) monthlyTrades[key] = [];
    monthlyTrades[key].push({ profit, cost, category: t.category || 'Ostalo' });
  }

  // Calculate avgROI + winRate per month
  for (const key of Object.keys(monthlyMap)) {
    const m = monthlyMap[key];
    const trades = monthlyTrades[key] || [];
    if (trades.length > 0) {
      m.avgROI = m.cost > 0 ? (m.profit / m.cost) * 100 : 0;
      m.winRate = (trades.filter(t => t.profit > 0).length / trades.length) * 100;
    }
    m.profit = Math.round(m.profit * 100) / 100;
    m.revenue = Math.round(m.revenue * 100) / 100;
    m.cost = Math.round(m.cost * 100) / 100;
    m.avgROI = Math.round(m.avgROI * 100) / 100;
    m.winRate = Math.round(m.winRate * 100) / 100;
  }

  // Build monthly history (oldest → newest)
  const monthlyHistory: MonthData[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (monthlyMap[key]) monthlyHistory.push(monthlyMap[key]);
  }

  const currentKey = `${currentYear}-${currentMonth}`;
  const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const lastKey = `${lastMonthDate.getFullYear()}-${lastMonthDate.getMonth()}`;

  const currentMonthData = monthlyMap[currentKey] || monthlyHistory[monthlyHistory.length - 1];
  const lastMonthData = monthlyMap[lastKey] || monthlyHistory[monthlyHistory.length - 2] || currentMonthData;

  const momChange = currentMonthData.profit - lastMonthData.profit;
  const momChangePct = lastMonthData.profit !== 0 ? (momChange / Math.abs(lastMonthData.profit)) * 100 : 0;
  const momDirection = momChange > 0 ? 'UP' : momChange < 0 ? 'DOWN' : 'FLAT';

  // Category breakdown per month
  const categoryMap: Record<string, Record<string, { profit: number; count: number }>> = {};
  for (const key of Object.keys(monthlyTrades)) {
    for (const t of monthlyTrades[key]) {
      const cat = t.category;
      if (!categoryMap[cat]) categoryMap[cat] = {};
      if (!categoryMap[cat][key]) categoryMap[cat][key] = { profit: 0, count: 0 };
      categoryMap[cat][key].profit += t.profit;
      categoryMap[cat][key].count++;
    }
  }

  const categories: CategoryMonthData[] = Object.entries(categoryMap).map(([cat, months]) => {
    const monthEntries = Object.entries(months).map(([key, data]) => {
      const m = monthlyMap[key];
      return { month: m?.label || key, profit: Math.round(data.profit * 100) / 100, tradeCount: data.count };
    }).sort((a, b) => a.month.localeCompare(b.month));

    const totalProfit = monthEntries.reduce((s, m) => s + m.profit, 0);
    const avgMonthlyProfit = monthEntries.length > 0 ? totalProfit / monthEntries.length : 0;

    // Trend: compare last 3 months avg vs first 3 months avg
    let trend: CategoryMonthData['trend'] = 'STABLE';
    if (monthEntries.length >= 4) {
      const firstHalf = monthEntries.slice(0, Math.floor(monthEntries.length / 2));
      const secondHalf = monthEntries.slice(Math.floor(monthEntries.length / 2));
      const firstAvg = firstHalf.reduce((s, m) => s + m.profit, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, m) => s + m.profit, 0) / secondHalf.length;
      if (secondAvg > firstAvg * 1.1) trend = 'GROWING';
      else if (secondAvg < firstAvg * 0.9) trend = 'DECLINING';
    } else if (monthEntries.length === 1) {
      trend = 'NEW';
    } else if (monthEntries.every(m => m.profit === 0)) {
      trend = 'DEAD';
    }

    return {
      category: cat,
      months: monthEntries,
      totalProfit: Math.round(totalProfit * 100) / 100,
      avgMonthlyProfit: Math.round(avgMonthlyProfit * 100) / 100,
      trend,
    };
  }).sort((a, b) => b.totalProfit - a.totalProfit);

  // Best/worst month
  const profitableMonths = monthlyHistory.filter(m => m.tradeCount > 0);
  const bestMonth = profitableMonths.length > 0
    ? { label: profitableMonths.reduce((best, m) => m.profit > best.profit ? m : best).label, profit: profitableMonths.reduce((best, m) => m.profit > best.profit ? m : best).profit }
    : null;
  const worstMonth = profitableMonths.length > 0
    ? { label: profitableMonths.reduce((worst, m) => m.profit < worst.profit ? m : worst).label, profit: profitableMonths.reduce((worst, m) => m.profit < worst.profit ? m : worst).profit }
    : null;

  const avgMonthlyProfit = profitableMonths.length > 0
    ? profitableMonths.reduce((s, m) => s + m.profit, 0) / profitableMonths.length
    : 0;

  return {
    ok: true,
    currentMonth: currentMonthData,
    lastMonth: lastMonthData,
    momChange: Math.round(momChange * 100) / 100,
    momChangePct: Math.round(momChangePct * 100) / 100,
    momDirection,
    monthlyHistory,
    categories,
    bestCategory: categories[0]?.category || null,
    worstCategory: categories[categories.length - 1]?.category || null,
    avgMonthlyProfit: Math.round(avgMonthlyProfit * 100) / 100,
    bestMonth,
    worstMonth,
    source: 'v8.61-month-over-month',
  };
}
