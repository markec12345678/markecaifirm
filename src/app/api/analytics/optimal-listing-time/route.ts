// v7.54: Optimal Listing Time Predictor — kdaj objaviti oglas za max Bolha vidljivost.
//
// Analizira katere dneve/ure se največ oglasov PRODA (ne samo objavi).
// "Objavi ob sredo 18:00 — takrat se največ oglasov proda v 7 dneh."
//
// GET /api/analytics/optimal-listing-time

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];

export async function GET() {
  try {
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { buyDate: true, sellDate: true, buyPrice: true, sellPrice: true, category: true, title: true },
    });

    if (soldTrades.length < 5) {
      return NextResponse.json({ ok: true, message: 'Potrebnih vsaj 5 prodaj za analizo optimalnega časa.' });
    }

    // Analyze sell time (when items actually sold)
    const sellDayMap = new Map<number, { count: number; totalProfit: number; fastSales: number }>();
    const sellHourMap = new Map<number, { count: number; totalProfit: number }>();

    for (const t of soldTrades) {
      const sellDate = new Date(t.sellDate!);
      const buyDate = new Date(t.buyDate);
      const holdDays = (sellDate.getTime() - buyDate.getTime()) / 86400000;
      const profit = (t.sellPrice ?? 0) - t.buyPrice;

      const day = sellDate.getDay();
      const hour = sellDate.getHours();

      const dayData = sellDayMap.get(day) || { count: 0, totalProfit: 0, fastSales: 0 };
      dayData.count += 1;
      dayData.totalProfit += profit;
      if (holdDays <= 7) dayData.fastSales += 1; // sold within 7 days = fast
      sellDayMap.set(day, dayData);

      const hourData = sellHourMap.get(hour) || { count: 0, totalProfit: 0 };
      hourData.count += 1;
      hourData.totalProfit += profit;
      sellHourMap.set(hour, hourData);
    }

    // Day analysis
    const dayAnalysis = Array.from(sellDayMap.entries()).map(([day, d]) => ({
      day: DAY_NAMES[day],
      dayIndex: day,
      sellCount: d.count,
      avgProfit: Math.round(d.totalProfit / d.count),
      totalProfit: Math.round(d.totalProfit),
      fastSaleRate: Math.round((d.fastSales / d.count) * 100), // % sold within 7 days
    })).sort((a, b) => b.fastSaleRate - a.fastSaleRate); // best = most fast sales

    // Hour analysis
    const hourAnalysis = Array.from(sellHourMap.entries()).map(([hour, d]) => ({
      hour,
      sellCount: d.count,
      avgProfit: Math.round(d.totalProfit / d.count),
      totalProfit: Math.round(d.totalProfit),
    })).sort((a, b) => b.sellCount - a.sellCount);

    // Best day + best hour
    const bestDay = dayAnalysis[0];
    const bestHour = hourAnalysis[0];

    // Compute "listing time" recommendation
    // Strategy: list 1-2 days BEFORE the best sell day (so your listing is fresh when buyers are active)
    // List at the best sell hour (when buyers browse)
    const bestSellDayIndex = bestDay?.dayIndex ?? 2;
    const recommendedListingDayIndex = (bestSellDayIndex - 1 + 7) % 7; // 1 day before
    const recommendedListingHour = bestHour?.hour ?? 18;

    // Category-specific analysis
    const catMap = new Map<string, { day: number; hour: number; count: number }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').trim();
      const sellDate = new Date(t.sellDate!);
      if (!catMap.has(cat)) catMap.set(cat, { day: sellDate.getDay(), hour: sellDate.getHours(), count: 0 });
      catMap.get(cat)!.count += 1;
    }
    const categoryTiming = Array.from(catMap.entries()).map(([cat, d]) => ({
      category: cat,
      bestDay: DAY_NAMES[d.day],
      bestHour: d.hour,
      count: d.count,
    })).sort((a, b) => b.count - a.count).slice(0, 5);

    // Build recommendation
    let recommendation = '';
    if (bestDay && bestHour) {
      recommendation = `📈 Najboljši dan za prodajo: ${bestDay.day} (${bestDay.fastSaleRate}% fast sale rate).\n`;
      recommendation += `🕐 Najboljša ura: ${bestHour.hour}:00 (${bestHour.sellCount} prodaj).\n`;
      recommendation += `📝 Priporočilo: OBJAVI ob ${DAY_NAMES[recommendedListingDayIndex]} ${recommendedListingHour}:00 — listing bo svež ko kupci brskajo!`;
    }

    // Next optimal listing window (relative to now)
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    let hoursUntilNext: number | null = null;
    for (let i = 0; i < 7 * 24; i++) {
      const checkDay = (currentDay + Math.floor((currentHour + i + 1) / 24)) % 7;
      const checkHour = (currentHour + i + 1) % 24;
      if (checkDay === recommendedListingDayIndex && checkHour === recommendedListingHour) {
        hoursUntilNext = i + 1;
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      bestDay: bestDay ? { day: bestDay.day, fastSaleRate: bestDay.fastSaleRate, avgProfit: bestDay.avgProfit } : null,
      bestHour: bestHour ? { hour: bestHour.hour, sellCount: bestHour.sellCount } : null,
      recommendedListingTime: {
        day: DAY_NAMES[recommendedListingDayIndex],
        hour: recommendedListingHour,
        reasoning: `List 1 dan pred najboljšim sell day (${bestDay?.day}) — oglas bo svež ko kupci brskajo.`,
      },
      nextWindow: hoursUntilNext ? {
        inHours: hoursUntilNext,
        inDays: Math.floor(hoursUntilNext / 24),
        dayName: DAY_NAMES[recommendedListingDayIndex],
        hour: recommendedListingHour,
      } : null,
      dayAnalysis,
      hourAnalysis: hourAnalysis.slice(0, 8),
      categoryTiming,
      recommendation,
      totalTrades: soldTrades.length,
    });
  } catch (err: any) {
    logger.error('/api/analytics/optimal-listing-time', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
