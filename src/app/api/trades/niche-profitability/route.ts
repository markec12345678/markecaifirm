// v6.3: Niche Profitability Tracker — katere kategorije so najbolj profitabilne
// GET /api/trades/niche-profitability
// Returns: { ok, niches: Array<{ category, soldCount, heldCount, totalInvested, totalRevenue, totalProfit, avgRoi, avgDaysToSell, recommendation }>, summary }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: { in: ['held', 'sold'] } },
      select: {
        id: true, title: true, category: true, status: true,
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        buyDate: true, sellDate: true,
      },
    });

    if (trades.length === 0) {
      return NextResponse.json({ ok: true, niches: [], summary: null, message: 'Ni tradeov.' });
    }

    // Group by category
    const nicheMap: Record<string, any> = {};

    for (const t of trades) {
      const cat = t.category || 'brez kategorije';
      if (!nicheMap[cat]) {
        nicheMap[cat] = {
          category: cat,
          soldCount: 0, heldCount: 0,
          totalInvested: 0, totalRevenue: 0, totalProfit: 0,
          totalBuyCost: 0, // buyPrice + buyFees
          daysToSell: [],
          items: [],
        };
      }
      const buyCost = t.buyPrice + (t.buyFees ?? 0);

      if (t.status === 'sold') {
        nicheMap[cat].soldCount++;
        const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        const profit = revenue - buyCost;
        nicheMap[cat].totalRevenue += revenue;
        nicheMap[cat].totalProfit += profit;
        nicheMap[cat].totalBuyCost += buyCost;
        if (t.sellDate && t.buyDate) {
          const days = Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
          nicheMap[cat].daysToSell.push(days);
        }
        nicheMap[cat].items.push({ title: t.title, buyPrice: t.buyPrice, sellPrice: t.sellPrice, profit, days: t.sellDate && t.buyDate ? Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24*60*60*1000)) : null });
      } else {
        nicheMap[cat].heldCount++;
        nicheMap[cat].totalInvested += buyCost;
      }
    }

    // Calculate stats per niche
    const niches = Object.values(nicheMap).map((n: any) => {
      const avgRoi = n.totalBuyCost > 0 ? Math.round((n.totalProfit / n.totalBuyCost) * 100) : 0;
      const avgDaysToSell = n.daysToSell.length > 0 ? Math.round(n.daysToSell.reduce((a: number, b: number) => a + b, 0) / n.daysToSell.length) : null;
      const totalItems = n.soldCount + n.heldCount;
      const sellThroughRate = totalItems > 0 ? Math.round((n.soldCount / totalItems) * 100) : 0;

      // Recommendation
      let recommendation: string;
      let score: number;
      if (n.soldCount >= 3 && avgRoi > 30) {
        recommendation = '🔥 TOP niša — visok ROI in dobra prodaja. Osredotoči se tu!';
        score = 90;
      } else if (n.soldCount >= 2 && avgRoi > 15) {
        recommendation = '✅ Dobra niša — donosno in stabilno';
        score = 70;
      } else if (n.soldCount >= 1 && avgRoi > 0) {
        recommendation = '⚠️ Zmerna niša — dobiček je pozitiven ampak nizek';
        score = 50;
      } else if (n.soldCount >= 1 && avgRoi <= 0) {
        recommendation = '🔴 Slaba niša — izguba. Razmisli o zamenjavi.';
        score = 20;
      } else {
        recommendation = '❓ Nova niša — še ni prodaj, težko oceniti';
        score = 40;
      }

      // Top items by profit
      const topItems = n.items.sort((a: any, b: any) => b.profit - a.profit).slice(0, 3);

      return {
        category: n.category,
        soldCount: n.soldCount,
        heldCount: n.heldCount,
        totalInvested: Math.round(n.totalInvested),
        totalRevenue: Math.round(n.totalRevenue),
        totalProfit: Math.round(n.totalProfit),
        avgRoi,
        avgDaysToSell,
        sellThroughRate,
        recommendation,
        score,
        topItems: topItems.map((i: any) => ({
          title: i.title, buyPrice: i.buyPrice, sellPrice: i.sellPrice,
          profit: Math.round(i.profit), days: i.days,
        })),
      };
    }).sort((a, b) => b.score - a.score);

    // Overall summary
    const totalSold = trades.filter(t => t.status === 'sold').length;
    const totalHeld = trades.filter(t => t.status === 'held').length;
    const totalProfit = niches.reduce((s, n) => s + n.totalProfit, 0);
    const totalInvested = niches.reduce((s, n) => s + n.totalInvested, 0);
    const totalRevenue = niches.reduce((s, n) => s + n.totalRevenue, 0);
    const overallRoi = niches.reduce((s, n) => s + (n.totalProfit > 0 ? n.avgRoi * n.soldCount : 0), 0) / Math.max(1, totalSold);

    const bestNiche = niches[0];
    const worstNiche = [...niches].filter(n => n.soldCount > 0).sort((a, b) => a.avgRoi - b.avgRoi)[0];

    return NextResponse.json({
      ok: true,
      niches,
      summary: {
        totalCategories: niches.length,
        totalSold,
        totalHeld,
        totalProfit: Math.round(totalProfit),
        totalInvested: Math.round(totalInvested),
        totalRevenue: Math.round(totalRevenue),
        overallRoi: Math.round(overallRoi),
        bestNiche: bestNiche ? { category: bestNiche.category, avgRoi: bestNiche.avgRoi, recommendation: bestNiche.recommendation } : null,
        worstNiche: worstNiche ? { category: worstNiche.category, avgRoi: worstNiche.avgRoi, recommendation: worstNiche.recommendation } : null,
      },
    });

  } catch (err) {
    logger.error("/api/trades/niche-profitability", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
