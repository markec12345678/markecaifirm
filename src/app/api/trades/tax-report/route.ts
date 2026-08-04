// v6.9: Tax Report Generator — slovenski davčni poročilo za preprodajo
// GET /api/trades/tax-report?year=2026
// Returns: { ok, report: { year, totalRevenue, totalCosts, grossProfit, netProfit, tax, trades, byCategory, byMonth } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const year = parseInt(url.searchParams.get('year') ?? String(new Date().getFullYear()), 10);

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    // Get all sold trades in the year
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { gte: yearStart, lt: yearEnd },
      },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true,
        sellDate: true, buyDate: true,
      },
      orderBy: { sellDate: 'asc' },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, report: null, message: `Ni prodaj v letu ${year}.` });
    }

    // Calculate per trade
    const trades = soldTrades.map(t => {
      const buyCost = t.buyPrice + (t.buyFees ?? 0);
      const sellRevenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = sellRevenue - buyCost;
      const marginPct = buyCost > 0 ? Math.round((profit / buyCost) * 100) : 0;
      return {
        id: t.id, title: t.title, category: t.category || 'drugo',
        buyPrice: t.buyPrice, buyFees: t.buyFees ?? 0, buyCost,
        sellPrice: t.sellPrice, sellFees: t.sellFees ?? 0, sellRevenue,
        profit: Math.round(profit), marginPct,
        sellDate: t.sellDate,
      };
    });

    // Totals
    const totalRevenue = trades.reduce((s, t) => s + t.sellRevenue, 0);
    const totalBuyCost = trades.reduce((s, t) => s + t.buyCost, 0);
    const totalFees = trades.reduce((s, t) => s + t.buyFees + t.sellFees, 0);
    const grossProfit = totalRevenue - totalBuyCost;

    // Slovenian tax (pribitki - drugi dohodek)
    // Neoporečni del: 5.000€ letno
    // Nad 5.000€: 40% dohodnina
    const TAX_FREE = 5000;
    const TAX_RATE = 0.40;
    const taxableAmount = Math.max(0, grossProfit - TAX_FREE);
    const tax = Math.round(taxableAmount * TAX_RATE);
    const netProfit = grossProfit - tax;

    // By category
    const byCatMap: Record<string, { count: number; revenue: number; cost: number; profit: number }> = {};
    for (const t of trades) {
      if (!byCatMap[t.category]) byCatMap[t.category] = { count: 0, revenue: 0, cost: 0, profit: 0 };
      byCatMap[t.category].count++;
      byCatMap[t.category].revenue += t.sellRevenue;
      byCatMap[t.category].cost += t.buyCost;
      byCatMap[t.category].profit += t.profit;
    }
    const byCategory = Object.entries(byCatMap).map(([cat, v]) => ({
      category: cat, ...v, roi: v.cost > 0 ? Math.round((v.profit / v.cost) * 100) : 0,
    })).sort((a, b) => b.profit - a.profit);

    // By month
    const byMonthMap: Record<string, { count: number; profit: number; revenue: number }> = {};
    for (const t of trades) {
      const monthKey = t.sellDate!.toISOString().slice(0, 7);
      if (!byMonthMap[monthKey]) byMonthMap[monthKey] = { count: 0, profit: 0, revenue: 0 };
      byMonthMap[monthKey].count++;
      byMonthMap[monthKey].profit += t.profit;
      byMonthMap[monthKey].revenue += t.sellRevenue;
    }
    const byMonth = Object.entries(byMonthMap).map(([month, v]) => ({
      month, ...v, profit: Math.round(v.profit), revenue: Math.round(v.revenue),
    })).sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      ok: true,
      report: {
        year,
        totalTrades: trades.length,
        totalRevenue: Math.round(totalRevenue),
        totalBuyCost: Math.round(totalBuyCost),
        totalFees: Math.round(totalFees),
        grossProfit: Math.round(grossProfit),
        taxFreeAllowance: TAX_FREE,
        taxableAmount: Math.round(taxableAmount),
        taxRate: TAX_RATE * 100,
        tax,
        netProfit: Math.round(netProfit),
        avgMarginPct: totalBuyCost > 0 ? Math.round((grossProfit / totalBuyCost) * 100) : 0,
        byCategory,
        byMonth,
        trades: trades.map(t => ({
          ...t,
          sellDate: t.sellDate?.toISOString(),
          sellDateFormatted: t.sellDate ? new Date(t.sellDate).toLocaleDateString('sl-SI') : '',
        })),
      },
      // CSV format for accountant
      csv: generateCSV(trades),
    });

  } catch (err) {
    logger.error("/api/trades/tax-report", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

function generateCSV(trades: any[]): string {
  const headers = [
    'Datum prodaje', 'Naslov', 'Kategorija', 'Kupna cena', 'Nakupne pristojbine',
    'Skupni strošek nakupa', 'Prodajna cena', 'Prodajne pristojbine',
    'Neto prihodek', 'Dobiček', 'Marža %',
  ];
  const rows = trades.map(t => [
    t.sellDate ? new Date(t.sellDate).toLocaleDateString('sl-SI') : '',
    `"${t.title.replace(/"/g, '""')}"`,
    t.category,
    t.buyPrice,
    t.buyFees,
    t.buyCost,
    t.sellPrice,
    t.sellFees,
    t.sellRevenue,
    t.profit,
    t.marginPct,
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
