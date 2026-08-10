// v7.46: Platform Performance Tracker — katera platforma je najboljša za katero kategorijo?
//
// "Elektronika se proda 2x hitreje na Bolhi (avg 12d) vs Vinted (28d).
//  Oblačila: Vinted 3x hitreje (8d vs 25d)."
//
// GET /api/analytics/platform-performance

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
        title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
        buyLocation: true, sellLocation: true,
      },
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({ ok: true, platforms: [], message: 'Ni prodaj za analizo.' });
    }

    // sellLocation = platform where sold (Bolha, Vinted, FB, etc.)
    const platformMap = new Map<string, {
      trades: typeof soldTrades;
      profit: number;
      invested: number;
      holdDays: number[];
    }>();

    for (const t of soldTrades) {
      const platform = (t.sellLocation || 'neznan').trim().toLowerCase();
      if (!platformMap.has(platform)) {
        platformMap.set(platform, { trades: [], profit: 0, invested: 0, holdDays: [] });
      }
      const p = platformMap.get(platform)!;
      p.trades.push(t);
      p.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      p.invested += t.buyPrice + (t.buyFees ?? 0);
      const days = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
      if (days >= 0) p.holdDays.push(days);
    }

    // Per-platform stats
    const platforms = Array.from(platformMap.entries()).map(([platform, d]) => {
      const roi = d.invested > 0 ? Math.round((d.profit / d.invested) * 100) : 0;
      const avgHold = d.holdDays.length > 0 ? Math.round(d.holdDays.reduce((s, x) => s + x, 0) / d.holdDays.length) : 0;
      const avgProfit = d.trades.length > 0 ? Math.round(d.profit / d.trades.length) : 0;

      // Per-category within this platform
      const catMap = new Map<string, { count: number; profit: number; holdDays: number[] }>();
      for (const t of d.trades) {
        const cat = (t.category || 'drugo').trim().toLowerCase();
        const cur = catMap.get(cat) || { count: 0, profit: 0, holdDays: [] };
        cur.count += 1;
        cur.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
        const days = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
        if (days >= 0) cur.holdDays.push(days);
        catMap.set(cat, cur);
      }

      const categories = Array.from(catMap.entries()).map(([cat, cd]) => ({
        category: cat,
        count: cd.count,
        totalProfit: Math.round(cd.profit),
        avgProfit: Math.round(cd.profit / cd.count),
        avgHoldDays: cd.holdDays.length > 0 ? Math.round(cd.holdDays.reduce((s, x) => s + x, 0) / cd.holdDays.length) : 0,
        roi: d.invested > 0 ? Math.round((cd.profit / (d.invested / d.trades.length * cd.count)) * 100) : 0,
      })).sort((a, b) => b.avgProfit - a.avgProfit);

      return {
        platform,
        totalTrades: d.trades.length,
        totalProfit: Math.round(d.profit),
        avgProfit,
        avgHoldDays: avgHold,
        roi,
        avgSellPrice: Math.round(d.trades.reduce((s, t) => s + (t.sellPrice ?? 0), 0) / d.trades.length),
        categories,
      };
    }).sort((a, b) => b.totalProfit - a.totalProfit);

    // Cross-platform comparison per category
    const allCategories = new Set<string>();
    platforms.forEach(p => p.categories.forEach(c => allCategories.add(c.category)));

    const categoryComparison = Array.from(allCategories).map(cat => {
      const platformData = platforms.map(p => {
        const cd = p.categories.find(c => c.category === cat);
        return cd ? { platform: p.platform, count: cd.count, avgProfit: cd.avgProfit, avgHoldDays: cd.avgHoldDays, roi: cd.roi } : null;
      }).filter(Boolean);

      const best = platformData.reduce((best, cur) => (cur && (!best || cur.avgProfit > best.avgProfit)) ? cur : best, null);
      const fastest = platformData.reduce((fast, cur) => (cur && (!fast || cur.avgHoldDays < fast.avgHoldDays)) ? cur : fast, null);

      return {
        category: cat,
        platforms: platformData,
        bestPlatform: best ? { platform: best.platform, avgProfit: best.avgProfit, reason: 'najvišji dobiček' } : null,
        fastestPlatform: fastest ? { platform: fastest.platform, avgHoldDays: fastest.avgHoldDays, reason: 'najhitrejša prodaja' } : null,
      };
    }).sort((a, b) => {
      const aBest = a.bestPlatform?.avgProfit ?? 0;
      const bBest = b.bestPlatform?.avgProfit ?? 0;
      return bBest - aBest;
    });

    // Recommendations
    const recommendations: string[] = [];
    for (const cc of categoryComparison.slice(0, 5)) {
      if (cc.bestPlatform && cc.fastestPlatform && cc.bestPlatform.platform !== cc.fastestPlatform.platform) {
        recommendations.push(`📦 ${cc.category}: najvišji dobiček na ${cc.bestPlatform.platform} (${cc.bestPlatform.avgProfit}€), najhitrejša na ${cc.fastestPlatform.platform} (${cc.fastestPlatform.avgHoldDays}d)`);
      } else if (cc.bestPlatform) {
        recommendations.push(`📦 ${cc.category}: najboljša platforma = ${cc.bestPlatform.platform} (${cc.bestPlatform.avgProfit}€ avg, ${cc.fastestPlatform?.avgHoldDays ?? '?'}d)`);
      }
    }

    return NextResponse.json({
      ok: true,
      platforms,
      categoryComparison,
      recommendations,
      summary: {
        totalTrades: soldTrades.length,
        totalPlatforms: platforms.length,
        bestPlatform: platforms[0] ? { platform: platforms[0].platform, profit: platforms[0].totalProfit, roi: platforms[0].roi } : null,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/platform-performance', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
