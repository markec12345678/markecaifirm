// v7.42: Seasonal Demand Calendar — "kdaj prodati za max dobiček"
//
// Analizira 12-mesečno zgodovino prodaj:
// - Povprečna prodajna cena po mesecih (per kategorija)
// - Najboljši in najslabši mesec za prodajo
// - Sezonski vzorec (strong/moderate/weak/none)
// - Priporočilo: "čakaj do septembra za elektroniko (+15% cena)"
//
// GET /api/analytics/seasonal-calendar?category=elektronika

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];
const MONTH_FULL = ['Januar', 'Februar', 'Marec', 'April', 'Maj', 'Junij', 'Julij', 'Avgust', 'September', 'Oktober', 'November', 'December'];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const categoryFilter = url.searchParams.get('category') || '';

    // Get all sold trades with sellDate
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        ...(categoryFilter ? { category: categoryFilter } : {}),
      },
      select: { title: true, category: true, buyPrice: true, sellPrice: true, sellDate: true, buyDate: true },
    });

    if (soldTrades.length < 3) {
      return NextResponse.json({
        ok: true,
        calendar: [],
        message: 'Potrebnih vsaj 3 prodaje za sezonsko analizo.',
      });
    }

    // Group by month
    const monthlyData: Array<{
      month: number;
      monthName: string;
      monthFull: string;
      count: number;
      avgPrice: number;
      avgProfit: number;
      avgRoi: number;
      totalProfit: number;
    }> = [];

    for (let m = 0; m < 12; m++) {
      const monthTrades = soldTrades.filter(t => new Date(t.sellDate!).getMonth() === m);
      if (monthTrades.length === 0) {
        monthlyData.push({
          month: m, monthName: MONTH_NAMES[m], monthFull: MONTH_FULL[m],
          count: 0, avgPrice: 0, avgProfit: 0, avgRoi: 0, totalProfit: 0,
        });
        continue;
      }

      const prices = monthTrades.map(t => t.sellPrice!);
      const profits = monthTrades.map(t => (t.sellPrice! - t.buyPrice));
      const invested = monthTrades.reduce((s, t) => s + t.buyPrice, 0);
      const totalProfit = profits.reduce((s, p) => s + p, 0);

      monthlyData.push({
        month: m,
        monthName: MONTH_NAMES[m],
        monthFull: MONTH_FULL[m],
        count: monthTrades.length,
        avgPrice: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
        avgProfit: Math.round(totalProfit / monthTrades.length),
        avgRoi: invested > 0 ? Math.round((totalProfit / invested) * 100) : 0,
        totalProfit: Math.round(totalProfit),
      });
    }

    // Find best and worst months (only months with sales)
    const monthsWithSales = monthlyData.filter(m => m.count > 0);
    const bestMonth = monthsWithSales.length > 0
      ? monthsWithSales.reduce((best, cur) => cur.avgProfit > best.avgProfit ? cur : best)
      : null;
    const worstMonth = monthsWithSales.length > 0
      ? monthsWithSales.reduce((worst, cur) => cur.avgProfit < worst.avgProfit ? cur : worst)
      : null;

    // Seasonal pattern strength
    const avgProfitAcrossMonths = monthsWithSales.length > 0
      ? monthsWithSales.reduce((s, m) => s + m.avgProfit, 0) / monthsWithSales.length
      : 0;
    const variance = monthsWithSales.length > 0
      ? Math.sqrt(monthsWithSales.reduce((s, m) => s + Math.pow(m.avgProfit - avgProfitAcrossMonths, 2), 0) / monthsWithSales.length)
      : 0;
    const cv = avgProfitAcrossMonths !== 0 ? Math.abs(variance / avgProfitAcrossMonths) : 1; // coefficient of variation

    let pattern: 'strong' | 'moderate' | 'weak' | 'none';
    if (cv > 0.6) pattern = 'strong';
    else if (cv > 0.3) pattern = 'moderate';
    else if (cv > 0.1) pattern = 'weak';
    else pattern = 'none';

    // Current month
    const currentMonth = new Date().getMonth();
    const currentMonthData = monthlyData[currentMonth];
    const nextBestMonth = monthlyData
      .filter(m => m.count > 0 && m.month !== currentMonth && m.avgProfit > (currentMonthData?.avgProfit ?? 0))
      .sort((a, b) => a.month - b.month)[0]; // next upcoming month that's better

    // Recommendation
    let recommendation = '';
    if (bestMonth && bestMonth.month === currentMonth) {
      recommendation = `✅ ${MONTH_FULL[currentMonth]} je najboljši mesec za prodajo (avg profit ${bestMonth.avgProfit}€). Prodajaj zdaj!`;
    } else if (nextBestMonth) {
      const monthsUntil = (nextBestMonth.month - currentMonth + 12) % 12;
      recommendation = `⏳ ${MONTH_FULL[currentMonth]} ni optimalen. ${MONTH_FULL[nextBestMonth.month]} je boljši (${nextBestMonth.avgProfit}€ vs ${currentMonthData?.avgProfit ?? 0}€ avg profit). Čakaj ${monthsUntil} ${monthsUntil === 1 ? 'mesec' : 'mesecev'}.`;
    } else if (bestMonth) {
      recommendation = `📈 Najboljši mesec: ${MONTH_FULL[bestMonth.month]} (avg profit ${bestMonth.avgProfit}€). Trenutno ni slab, a če lahak čakaš, prodajaj takrat.`;
    } else {
      recommendation = 'Ni dovolj podatkov za priporočilo.';
    }

    // Category breakdown (if no filter)
    let categoryBreakdown: any[] = [];
    if (!categoryFilter) {
      const catMap = new Map<string, { count: number; profit: number }>();
      for (const t of soldTrades) {
        const cat = t.category || 'drugo';
        const cur = catMap.get(cat) || { count: 0, profit: 0 };
        cur.count += 1;
        cur.profit += t.sellPrice! - t.buyPrice;
        catMap.set(cat, cur);
      }
      categoryBreakdown = Array.from(catMap.entries())
        .map(([cat, d]) => ({ category: cat, count: d.count, totalProfit: Math.round(d.profit) }))
        .sort((a, b) => b.totalProfit - a.totalProfit);
    }

    return NextResponse.json({
      ok: true,
      category: categoryFilter || 'all',
      calendar: monthlyData,
      bestMonth: bestMonth ? { month: bestMonth.month, name: bestMonth.monthFull, avgProfit: bestMonth.avgProfit, count: bestMonth.count } : null,
      worstMonth: worstMonth ? { month: worstMonth.month, name: worstMonth.monthFull, avgProfit: worstMonth.avgProfit, count: worstMonth.count } : null,
      seasonalPattern: pattern,
      currentMonth: { month: currentMonth, name: MONTH_FULL[currentMonth], data: currentMonthData },
      nextBestMonth: nextBestMonth ? { month: nextBestMonth.month, name: MONTH_FULL[nextBestMonth.month], avgProfit: nextBestMonth.avgProfit } : null,
      recommendation,
      categoryBreakdown,
      totalSales: soldTrades.length,
    });
  } catch (err: any) {
    logger.error('/api/analytics/seasonal-calendar', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
