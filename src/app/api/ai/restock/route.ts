// v6.7: Smart Restock Recommendations — AI priporoča kaj ponovno kupiti za preprodajo
// GET /api/ai/restock
// Analizira uspešne prodaje in išče podobne trenutne priložnosti
// Returns: { ok, recommendations: Array<{ category, item, avgProfit, avgRoi, avgDaysToSell, currentOpportunities, reason }> }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Get sold trades to find what was profitable
  const soldTrades = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null } },
    select: {
      id: true, title: true, category: true, buyPrice: true, sellPrice: true,
      buyFees: true, sellFees: true, buyDate: true, sellDate: true,
    },
    take: 200,
  });

  if (soldTrades.length === 0) {
    return NextResponse.json({ ok: true, recommendations: [], message: 'Ni prodanih tradeov za analizo.' });
  }

  // Group by category and extract keywords
  const extractKeywords = (title: string): string[] => {
    const stopWords = new Set(['prodam', 'nov', 'novo', 'rabljen', 'rabljeno', 'dober', 'odličen', 'lepi', 'kompletni', 'z', 'in', 'za']);
    return title.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !stopWords.has(w))
      .slice(0, 5);
  };

  const catStats: Record<string, { trades: any[]; totalProfit: number; totalCost: number; daysToSell: number[] }> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!catStats[cat]) catStats[cat] = { trades: [], totalProfit: 0, totalCost: 0, daysToSell: [] };
    catStats[cat].trades.push(t);
    const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    catStats[cat].totalProfit += profit;
    catStats[cat].totalCost += t.buyPrice + (t.buyFees ?? 0);
    if (t.sellDate && t.buyDate) {
      catStats[cat].daysToSell.push(Math.round((t.sellDate.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000)));
    }
  }

  // Find top performing categories
  const topCategories = Object.entries(catStats)
    .map(([cat, s]) => ({
      category: cat,
      soldCount: s.trades.length,
      totalProfit: Math.round(s.totalProfit),
      avgRoi: s.totalCost > 0 ? Math.round((s.totalProfit / s.totalCost) * 100) : 0,
      avgDaysToSell: s.daysToSell.length > 0 ? Math.round(s.daysToSell.reduce((a, b) => a + b, 0) / s.daysToSell.length) : 0,
      keywords: new Set(s.trades.flatMap(t => extractKeywords(t.title))),
    }))
    .filter(c => c.soldCount >= 1 && c.avgRoi > 0)
    .sort((a, b) => b.avgRoi - a.avgRoi || b.totalProfit - a.totalProfit);

  // For each top category, find current opportunities
  const recommendations: any[] = [];
  for (const cat of topCategories.slice(0, 8)) {
    // Search for current listings matching keywords
    const keywords = Array.from(cat.keywords).slice(0, 3);
    let opportunities: any[] = [];

    for (const kw of keywords) {
      const listings = await db.listing.findMany({
        where: {
          isHidden: false,
          isBookmarked: false,
          title: { contains: kw },
          OR: [
            { aiVerdict: 'PRILIKA' },
            { dealScore: { gte: 60 } },
          ],
        },
        select: {
          id: true, title: true, price: true, priceText: true, url: true,
          aiVerdict: true, dealScore: true, aiEstimatedValue: true,
          monitor: { select: { source: true, name: true } },
        },
        take: 5,
        orderBy: { dealScore: 'desc' },
      });
      opportunities.push(...listings);
    }

    // Deduplicate
    const seen = new Set<string>();
    opportunities = opportunities.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    if (opportunities.length === 0) continue;

    // Calculate potential profit for each opportunity
    const enrichedOpps = opportunities.slice(0, 5).map(l => {
      const estSellPrice = l.aiEstimatedValue ?? Math.round((l.price ?? 0) * 1.2);
      const potentialProfit = estSellPrice - (l.price ?? 0) - (l.price ?? 0) * 0.1; // minus 10% fees
      const potentialRoi = (l.price ?? 0) > 0 ? Math.round((potentialProfit / (l.price ?? 0)) * 100) : 0;
      return {
        ...l,
        estSellPrice,
        potentialProfit: Math.round(potentialProfit),
        potentialRoi,
      };
    }).sort((a, b) => b.potentialProfit - a.potentialProfit);

    let reason: string;
    if (cat.avgRoi > 50) {
      reason = `🔥 TOP niša! ${cat.soldCount} prodaj z ${cat.avgRoi}% ROI. Ponovno investiraj!`;
    } else if (cat.avgRoi > 20) {
      reason = `✅ Donosna niša: ${cat.avgRoi}% ROI, ${cat.avgDaysToSell}d povp. prodaja`;
    } else {
      reason = `📊 Stabilna niša: ${cat.avgRoi}% ROI, ${cat.soldCount} prodaj`;
    }

    recommendations.push({
      category: cat.category,
      soldCount: cat.soldCount,
      avgProfit: cat.totalProfit,
      avgRoi: cat.avgRoi,
      avgDaysToSell: cat.avgDaysToSell,
      keywords: keywords,
      reason,
      opportunities: enrichedOpps,
    });
  }

  return NextResponse.json({
    ok: true,
    recommendations: recommendations.sort((a, b) => b.avgRoi - a.avgRoi),
    totalSoldTrades: soldTrades.length,
    categoriesAnalyzed: topCategories.length,
    totalOpportunities: recommendations.reduce((s, r) => s + r.opportunities.length, 0),
  });
}
