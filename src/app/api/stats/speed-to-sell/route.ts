// v6.4: Speed-to-Sell Analytics — povprečni čas prodaje po kategorijah, cenovnih rangih in virih
// GET /api/stats/speed-to-sell
// Returns: { ok, byCategory, byPriceRange, bySource, overall, fastestCategory, slowestCategory }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: {
        id: true, title: true, buyPrice: true, sellPrice: true,
        buyDate: true, sellDate: true, category: true,
      },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, byCategory: [], byPriceRange: [], bySource: [], overall: null, message: 'Ni prodanih tradeov.' });
    }

    // Calculate days to sell
    const withDays = soldTrades.map(t => {
      const days = Math.round((t.sellDate!.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const profit = (t.sellPrice ?? 0) - t.buyPrice;
      const marginPct = t.buyPrice > 0 ? Math.round((profit / t.buyPrice) * 100) : 0;
      return { ...t, days, profit, marginPct };
    });

    // Overall stats
    const allDays = withDays.map(t => t.days).filter(d => d >= 0);
    const overall = {
      totalSold: withDays.length,
      avgDays: Math.round(allDays.reduce((a, b) => a + b, 0) / Math.max(1, allDays.length)),
      minDays: Math.min(...allDays),
      maxDays: Math.max(...allDays),
      medianDays: allDays.sort((a, b) => a - b)[Math.floor(allDays.length / 2)],
      avgMargin: Math.round(withDays.reduce((s, t) => s + t.marginPct, 0) / withDays.length),
      fastFlips: withDays.filter(t => t.days <= 7).length,
      slowFlips: withDays.filter(t => t.days > 30).length,
    };

    // By category
    const catMap: Record<string, any[]> = {};
    for (const t of withDays) {
      const cat = t.category || 'brez kategorije';
      if (!catMap[cat]) catMap[cat] = [];
      catMap[cat].push(t);
    }
    const byCategory: any[] = Object.entries(catMap).map(([cat, items]) => {
      const days = items.map(t => t.days).filter(d => d >= 0);
      return {
        category: cat,
        count: items.length,
        avgDays: Math.round(days.reduce((a, b) => a + b, 0) / Math.max(1, days.length)),
        minDays: Math.min(...days),
        maxDays: Math.max(...days),
        avgMargin: Math.round(items.reduce((s, t) => s + t.marginPct, 0) / items.length),
        avgProfit: Math.round(items.reduce((s, t) => s + t.profit, 0) / items.length),
        fastFlips: items.filter(t => t.days <= 7).length,
        slowFlips: items.filter(t => t.days > 30).length,
      };
    }).sort((a, b) => a.avgDays - b.avgDays);

    // By price range
    const priceRanges = [
      { label: '0-50€', min: 0, max: 50 },
      { label: '50-150€', min: 50, max: 150 },
      { label: '150-500€', min: 150, max: 500 },
      { label: '500-1500€', min: 500, max: 1500 },
      { label: '1500€+', min: 1500, max: Infinity },
    ];
    const byPriceRange = priceRanges.map(range => {
      const items = withDays.filter(t => t.buyPrice >= range.min && t.buyPrice < range.max);
      if (items.length === 0) return { ...range, count: 0, avgDays: null, avgMargin: null };
      const days = items.map(t => t.days).filter(d => d >= 0);
      return {
        ...range,
        count: items.length,
        avgDays: Math.round(days.reduce((a, b) => a + b, 0) / Math.max(1, days.length)),
        avgMargin: Math.round(items.reduce((s, t) => s + t.marginPct, 0) / items.length),
      };
    });

    // Speed score per category (0-100, higher = faster)
    byCategory.forEach(c => {
      c.speedScore = Math.max(0, Math.min(100, Math.round(100 - (c.avgDays / overall.maxDays) * 100)));
      c.speedLabel = c.avgDays <= 7 ? '⚡ Zelo hitro' : c.avgDays <= 14 ? '🟢 Hitro' : c.avgDays <= 30 ? '🟡 Zmerno' : '🔴 Počasno';
    });

    return NextResponse.json({
      ok: true,
      overall,
      byCategory,
      byPriceRange,
      fastestCategory: byCategory[0] || null,
      slowestCategory: byCategory[byCategory.length - 1] || null,
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    logger.error("/api/stats/speed-to-sell", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
