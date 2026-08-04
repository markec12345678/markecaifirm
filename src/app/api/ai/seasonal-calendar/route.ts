// v6.5: Seasonal Trend Calendar — AI zazna sezonske vzorce v cenah
// GET /api/ai/seasonal-calendar
// Analizira historical listings data za sezonske trende po mesecih
// Returns: { ok, calendar: Array<{ month, avgPrice, listingCount, trend, predictedDrop }>, insights }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get all listings with prices from last 2 years
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const listings = await db.listing.findMany({
      where: {
        price: { not: null },
        isHidden: false,
        firstSeenAt: { gte: twoYearsAgo },
      },
      select: { id: true, price: true, firstSeenAt: true, aiVerdict: true, monitor: { select: { source: true } } },
      take: 5000,
    });

    if (listings.length < 30) {
      return NextResponse.json({ ok: true, calendar: [], insights: [], message: 'Premalo podatkov (potrebno vsaj 30 oglasov v 2 letih).' });
    }

    // Group by month
    const monthMap: Record<string, { prices: number[]; count: number; sources: Set<string> }> = {};
    for (const l of listings) {
      const monthKey = l.firstSeenAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthMap[monthKey]) monthMap[monthKey] = { prices: [], count: 0, sources: new Set() };
      monthMap[monthKey].prices.push(l.price!);
      monthMap[monthKey].count++;
      if (l.monitor?.source) monthMap[monthKey].sources.add(l.monitor.source);
    }

    // Calculate monthly stats
    const months = Object.entries(monthMap).map(([month, data]) => {
      const avgPrice = Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length);
      const minPrice = Math.min(...data.prices);
      const maxPrice = Math.max(...data.prices);
      const date = new Date(month + '-01');
      const monthNum = date.getMonth();
      const monthName = date.toLocaleDateString('sl-SI', { month: 'long' });
      return {
        month,
        monthName,
        monthNum,
        avgPrice,
        minPrice,
        maxPrice,
        count: data.count,
        sources: Array.from(data.sources),
      };
    }).sort((a, b) => a.month.localeCompare(b.month));

    // Calculate year-over-year comparison for same months
    const byMonthNum: Record<number, any[]> = {};
    for (const m of months) {
      if (!byMonthNum[m.monthNum]) byMonthNum[m.monthNum] = [];
      byMonthNum[m.monthNum].push(m);
    }

    // Calculate seasonal patterns
    const seasonalPatterns: Array<{ monthNum: number; monthName: string; avgPrice: number; trend: string; prediction: string; diffPct: number }> = [];
    const monthNames = ['Januar', 'Februar', 'Marec', 'April', 'Maj', 'Junij', 'Julij', 'Avgust', 'September', 'Oktober', 'November', 'December'];

    for (let m = 0; m < 12; m++) {
      const data = byMonthNum[m] || [];
      if (data.length === 0) continue;
      const avgPrice = Math.round(data.reduce((s, d) => s + d.avgPrice, 0) / data.length);
      const overallAvg = Math.round(months.reduce((s, d) => s + d.avgPrice, 0) / months.length);
      const diffPct = Math.round(((avgPrice - overallAvg) / overallAvg) * 100);

      let trend: string;
      let prediction: string;
      if (diffPct < -10) {
        trend = '📉 Nizke cene';
        prediction = 'Dobor čas za nakup — cene so pod povprečjem';
      } else if (diffPct > 10) {
        trend = '📈 Visoke cene';
        prediction = 'Dobor čas za prodajo — cene so nad povprečjem';
      } else {
        trend = '➡️ Stabilne cene';
        prediction = 'Cene so v normalnem rangu';
      }

      seasonalPatterns.push({
        monthNum: m,
        monthName: monthNames[m],
        avgPrice,
        trend,
        prediction,
        diffPct,
      });
    }

    // Find best buy and sell months
    const sorted = [...seasonalPatterns].sort((a, b) => a.avgPrice - b.avgPrice);
    const bestBuyMonth = sorted[0];
    const bestSellMonth = sorted[sorted.length - 1];

    // Generate insights
    const insights: string[] = [];
    if (bestBuyMonth && bestSellMonth) {
      insights.push(`💰 Najboljši mesec za NAKUP: ${bestBuyMonth.monthName} (povprečna cena ${bestBuyMonth.avgPrice}€, ${bestBuyMonth.diffPct}% pod letnim povprečjem)`);
      insights.push(`💸 Najboljši mesec za PRODAJO: ${bestSellMonth.monthName} (povprečna cena ${bestSellMonth.avgPrice}€, ${bestSellMonth.diffPct}% nad letnim povprečjem)`);
      if (bestSellMonth && bestBuyMonth) {
        const spreadPct = Math.round(((bestSellMonth.avgPrice - bestBuyMonth.avgPrice) / bestBuyMonth.avgPrice) * 100);
        insights.push(`📊 Sezonski spread: ${spreadPct}% — kupi v ${bestBuyMonth.monthName}, prodaj v ${bestSellMonth.monthName}`);
      }
    }

    // Check current month
    const currentMonth = new Date().getMonth();
    const currentPattern = seasonalPatterns.find(p => p.monthNum === currentMonth);
    if (currentPattern) {
      insights.push(`📅 Trenutni mesec (${currentPattern.monthName}): ${currentPattern.prediction} (${currentPattern.diffPct > 0 ? '+' : ''}${currentPattern.diffPct}%)`);
    }

    // Next month prediction
    const nextMonth = (currentMonth + 1) % 12;
    const nextPattern = seasonalPatterns.find(p => p.monthNum === nextMonth);
    if (nextPattern) {
      insights.push(`🔮 Naslednji mesec (${nextPattern.monthName}): ${nextPattern.prediction}`);
    }

    return NextResponse.json({
      ok: true,
      calendar: seasonalPatterns,
      monthlyData: months,
      insights,
      bestBuyMonth: bestBuyMonth || null,
      bestSellMonth: bestSellMonth || null,
      overallAvgPrice: Math.round(months.reduce((s, d) => s + d.avgPrice, 0) / months.length),
      dataPoints: listings.length,
      monthsAnalyzed: months.length,
    });

  } catch (err) {
    logger.error("/api/ai/seasonal-calendar", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
