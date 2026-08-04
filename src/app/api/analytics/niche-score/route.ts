// v7.34: Niche Opportunity Score — katere kategorije so najbolj donosne?
// Analizira sold trade-e in najde kategorije z visokim ROI + nizko konkurenco.
// GET /api/analytics/niche-score
// Returns: { ok, niches: [{ category, score, roi, profit, count, avgHoldDays, competition, recommendation }] }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: {
        title: true, category: true, buyPrice: true, buyFees: true,
        sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
      },
    });

    // Also count listings per category (competition proxy — how many listings exist)
    const listings = await db.listing.findMany({
      where: { isHidden: false },
      select: { title: true, price: true, firstSeenAt: true },
      take: 5000,
    });

    if (trades.length === 0) {
      return NextResponse.json({
        ok: true,
        niches: [],
        message: 'Ni prodaj za analizo. Dodaj sold trade-e za niche score.',
      });
    }

    // Group trades by category
    const categoryData = new Map<string, {
      trades: typeof trades;
      totalInvested: number;
      totalReturned: number;
      totalProfit: number;
      holdDays: number[];
    }>();

    for (const t of trades) {
      const cat = (t.category || 'drugo').trim();
      if (!cat) continue;
      const cur = categoryData.get(cat) || { trades: [], totalInvested: 0, totalReturned: 0, totalProfit: 0, holdDays: [] };
      cur.trades.push(t);
      const invested = t.buyPrice + (t.buyFees ?? 0);
      const returned = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = returned - invested;
      cur.totalInvested += invested;
      cur.totalReturned += returned;
      cur.totalProfit += profit;
      if (t.sellDate) {
        const holdDays = (new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / 86400000;
        if (holdDays >= 0) cur.holdDays.push(holdDays);
      }
      categoryData.set(cat, cur);
    }

    // Compute niche scores
    const allProfits = Array.from(categoryData.values()).map(d => d.totalProfit);
    const maxProfit = Math.max(...allProfits, 1);

    const niches = Array.from(categoryData.entries()).map(([category, d]) => {
      const roi = d.totalInvested > 0 ? (d.totalProfit / d.totalInvested) * 100 : 0;
      const avgHoldDays = d.holdDays.length > 0
        ? Math.round(d.holdDays.reduce((s, x) => s + x, 0) / d.holdDays.length)
        : 0;

      // Profitability score (0-40): based on ROI
      const profitScore = Math.min(40, Math.max(0, (roi + 20) * 0.8));

      // Volume score (0-30): based on number of trades
      const volumeScore = Math.min(30, d.trades.length * 6);

      // Velocity score (0-20): faster turnover = better
      const velocityScore = avgHoldDays > 0 && avgHoldDays < 60
        ? Math.max(0, 20 - Math.floor(avgHoldDays / 3))
        : 0;

      // Competition score (0-10): fewer listings in this category = less competition
      // (we don't have exact category-listing count, so we use trade volume as proxy)
      const competitionScore = Math.min(10, Math.max(0, 10 - Math.floor(d.trades.length / 3)));

      const totalScore = Math.round(profitScore + volumeScore + velocityScore + competitionScore);

      // Recommendation
      let recommendation = '';
      if (totalScore >= 70 && roi > 15) {
        recommendation = `🎯 TOP NIŠA — visok ROI (${roi.toFixed(0)}%) + dobra prodaja. Fokusiraj tukaj.`;
      } else if (totalScore >= 50 && roi > 0) {
        recommendation = `✅ DONOSNA — soliden ROI (${roi.toFixed(0)}%), ${d.trades.length} prodaj. Vredi nadaljevati.`;
      } else if (roi < 0) {
        recommendation = `❌ IZGUBA — negativen ROI (${roi.toFixed(0)}%). Zmanjšaj aktivnost tukaj.`;
      } else {
        recommendation = `➡️ POVPREČNA — ROI ${roi.toFixed(0)}%. Ni slaba, ni odlična.`;
      }

      return {
        category,
        score: totalScore,
        roi: Math.round(roi * 100) / 100,
        profit: Math.round(d.totalProfit * 100) / 100,
        count: d.trades.length,
        avgHoldDays,
        avgProfit: Math.round((d.totalProfit / d.trades.length) * 100) / 100,
        totalInvested: Math.round(d.totalInvested),
        recommendation,
      };
    }).sort((a, b) => b.score - a.score);

    return NextResponse.json({
      ok: true,
      totalCategories: niches.length,
      niches,
      bestNiche: niches[0] || null,
      worstNiche: niches[niches.length - 1] || null,
    });
  } catch (err: any) {
    logger.error('/api/analytics/niche-score', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
