// v7.45: Profit Heatmap — vizualni koledar kdaj zaslužiš največ.
//
// 7×24 matrika: dan v tednu × ura → profit
// Pokaže: "Torek 14:00-15:00 = +85€ (najboljša ura za prodajo)"
//
// GET /api/analytics/profit-heatmap

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];

export async function GET() {
  try {
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { not: null }, sellPrice: { not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, category: true },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, heatmap: [], message: 'Ni prodaj za heatmap analizo.' });
    }

    // Build 7×24 heatmap (day × hour)
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const countMap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const t of soldTrades) {
      const sellDate = new Date(t.sellDate!);
      const day = sellDate.getDay();
      const hour = sellDate.getHours();
      const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      heatmap[day][hour] += profit;
      countMap[day][hour] += 1;
    }

    // Find best and worst slots
    let bestSlot = { day: 0, hour: 0, profit: -Infinity, count: 0 };
    let worstSlot = { day: 0, hour: 0, profit: Infinity, count: 0 };
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (countMap[d][h] > 0) {
          if (heatmap[d][h] > bestSlot.profit) {
            bestSlot = { day: d, hour: h, profit: heatmap[d][h], count: countMap[d][h] };
          }
          if (heatmap[d][h] < worstSlot.profit) {
            worstSlot = { day: d, hour: h, profit: heatmap[d][h], count: countMap[d][h] };
          }
        }
      }
    }

    // Day totals
    const dayTotals = Array.from({ length: 7 }, (_, d) => ({
      day: DAY_NAMES[d],
      dayIndex: d,
      totalProfit: Math.round(heatmap[d].reduce((s, x) => s + x, 0)),
      tradeCount: countMap[d].reduce((s, x) => s + x, 0),
      avgProfit: 0,
    }));
    dayTotals.forEach(d => { d.avgProfit = d.tradeCount > 0 ? Math.round(d.totalProfit / d.tradeCount) : 0; });
    dayTotals.sort((a, b) => b.totalProfit - a.totalProfit);

    // Hour totals
    const hourTotals = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      totalProfit: Math.round(heatmap.reduce((s, day) => s + day[h], 0)),
      tradeCount: countMap.reduce((s, day) => s + day[h], 0),
    }));
    hourTotals.sort((a, b) => b.totalProfit - a.totalProfit);

    // Best day + best hour
    const bestDay = dayTotals[0];
    const bestHour = hourTotals[0];

    // Recommendation
    let recommendation = '';
    if (bestDay && bestDay.tradeCount > 0) {
      recommendation = `📈 Najboljši dan za prodajo: ${bestDay.day} (avg ${bestDay.avgProfit}€/trade).`;
      if (bestHour && bestHour.tradeCount > 0) {
        recommendation += ` Najboljša ura: ${bestHour.hour}:00 (${bestHour.totalProfit}€ skupno).`;
      }
      if (worstSlot.count > 0) {
        recommendation += ` Najslabši: ${DAY_NAMES[worstSlot.day]} ${worstSlot.hour}:00 (${worstSlot.profit}€).`;
      }
      recommendation += ` \n💡 Strateško objavljaj oglase ob optimalnih časih!`;
    }

    return NextResponse.json({
      ok: true,
      heatmap: heatmap.map((day, d) => day.map((profit, h) => ({
        day: d, dayName: DAY_NAMES[d], hour: h,
        profit: Math.round(profit), count: countMap[d][h],
      }))).flat(),
      dayTotals,
      hourTotals,
      bestSlot: { day: DAY_NAMES[bestSlot.day], dayIndex: bestSlot.day, hour: bestSlot.hour, profit: Math.round(bestSlot.profit), count: bestSlot.count },
      worstSlot: worstSlot.count > 0 ? { day: DAY_NAMES[worstSlot.day], hour: worstSlot.hour, profit: Math.round(worstSlot.profit), count: worstSlot.count } : null,
      bestDay: bestDay ? { day: bestDay.day, totalProfit: bestDay.totalProfit, avgProfit: bestDay.avgProfit } : null,
      bestHour: bestHour ? { hour: bestHour.hour, totalProfit: bestHour.totalProfit } : null,
      totalTrades: soldTrades.length,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/profit-heatmap', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
