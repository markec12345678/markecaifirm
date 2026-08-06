// v7.51: Purchase Pattern Analyzer — kdaj TI najbolje kupuješ.
//
// "Ob torek 14h najdeš 40% več deal-ov. Tvoji najboljši nakupi so bili ob ponedeljkih."
// Analizira TVOJE nakupe (ne oglase) — kdaj kupuješ profitable item-e.
//
// GET /api/analytics/purchase-pattern

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { id: true, title: true, buyPrice: true, buyDate: true, sellPrice: true, buyFees: true, sellFees: true, category: true },
    });

    if (trades.length < 3) {
      return NextResponse.json({ ok: true, message: 'Potrebnih vsaj 3 prodani nakupi za analizo nakupnih vzorcev.' });
    }

    // Analyze purchase patterns
    const byDay: Array<{ day: string; dayIndex: number; count: number; avgProfit: number; avgRoi: number; totalProfit: number }> = [];
    const byHour: Array<{ hour: number; count: number; avgProfit: number }> = [];
    const byDayHour: Map<string, { count: number; profit: number }> = new Map();

    for (let d = 0; d < 7; d++) {
      const dayTrades = trades.filter(t => new Date(t.buyDate).getDay() === d);
      const profits = dayTrades.map(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
      const invested = dayTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
      const totalProfit = profits.reduce((s, p) => s + p, 0);
      byDay.push({
        day: DAY_NAMES[d], dayIndex: d,
        count: dayTrades.length,
        avgProfit: dayTrades.length > 0 ? Math.round(totalProfit / dayTrades.length) : 0,
        avgRoi: invested > 0 ? Math.round((totalProfit / invested) * 100) : 0,
        totalProfit: Math.round(totalProfit),
      });
    }
    byDay.sort((a, b) => b.avgProfit - a.avgProfit);

    for (let h = 0; h < 24; h++) {
      const hourTrades = trades.filter(t => new Date(t.buyDate).getHours() === h);
      const profits = hourTrades.map(t => (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0));
      byHour.push({
        hour: h,
        count: hourTrades.length,
        avgProfit: hourTrades.length > 0 ? Math.round(profits.reduce((s, p) => s + p, 0) / hourTrades.length) : 0,
      });
    }
    byHour.sort((a, b) => b.avgProfit - a.avgProfit);

    // Day×hour matrix
    for (const t of trades) {
      const d = new Date(t.buyDate).getDay();
      const h = new Date(t.buyDate).getHours();
      const key = `${d}-${h}`;
      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      const cur = byDayHour.get(key) || { count: 0, profit: 0 };
      cur.count += 1;
      cur.profit += profit;
      byDayHour.set(key, cur);
    }

    // Best purchase slot
    let bestSlot: { day: string; hour: number; count: number; avgProfit: number } | null = null;
    for (const [key, val] of byDayHour) {
      if (val.count < 1) continue;
      const [d, h] = key.split('-').map(Number);
      const avgProfit = Math.round(val.profit / val.count);
      if (!bestSlot || avgProfit > bestSlot.avgProfit) {
        bestSlot = { day: DAY_NAMES[d], hour: h, count: val.count, avgProfit };
      }
    }

    // Category purchase timing
    const catTiming = new Map<string, { bestDay: string; bestHour: number; count: number; avgRoi: number }>();
    for (const t of trades) {
      const cat = (t.category || 'drugo').trim();
      if (!catTiming.has(cat)) catTiming.set(cat, { bestDay: '', bestHour: 0, count: 0, avgRoi: 0 });
      const cur = catTiming.get(cat)!;
      cur.count += 1;
    }

    // Recommendation
    const bestDay = byDay[0];
    const bestHour = byHour[0];
    let recommendation = '';
    if (bestDay && bestDay.count > 0) {
      recommendation = `📊 Najboljši dan za NAKUP: ${bestDay.day} (avg profit ${bestDay.avgProfit}€, ROI ${bestDay.avgRoi}%).`;
      if (bestHour && bestHour.count > 0) {
        recommendation += ` Najboljša ura: ${bestHour.hour}:00 (avg ${bestHour.avgProfit}€/nakup).`;
      }
      if (bestSlot) {
        recommendation += `\n🎯 TOP slot: ${bestSlot.day} ${bestSlot.hour}:00 (${bestSlot.avgProfit}€ avg profit).`;
      }
      recommendation += `\n💡 Nastavi monitor check na te čase za max nakupno uspešnost!`;
    }

    return NextResponse.json({
      ok: true,
      totalTrades: trades.length,
      byDay: byDay.filter(d => d.count > 0),
      byHour: byHour.filter(h => h.count > 0).slice(0, 8),
      bestDay: bestDay && bestDay.count > 0 ? { day: bestDay.day, avgProfit: bestDay.avgProfit, avgRoi: bestDay.avgRoi, count: bestDay.count } : null,
      bestHour: bestHour && bestHour.count > 0 ? { hour: bestHour.hour, avgProfit: bestHour.avgProfit, count: bestHour.count } : null,
      bestSlot,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/purchase-pattern', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
