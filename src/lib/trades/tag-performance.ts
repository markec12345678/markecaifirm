// v8.63: Trade Tag Performance — aggregated stats per user-defined tag.
// Answers: "Which tags make me the most money?", "Are my 'experiment' trades profitable?",
//          "Should I keep buying 'premium' items?"

import { db } from '@/lib/db';
import { parseTags } from '@/app/api/trades/route';

export interface TagStats {
  tag: string;
  totalCount: number;
  heldCount: number;
  soldCount: number;
  cancelledCount: number;
  totalInvested: number;       // sum of buyPrice + buyFees for all trades with this tag
  totalRevenue: number;        // sum of (sellPrice - sellFees) for sold trades
  totalProfit: number;         // revenue - invested (only sold)
  avgProfitPerTrade: number;  // totalProfit / soldCount
  avgROI: number;              // % — weighted by invested
  winRate: number;             // % of sold trades with profit > 0
  avgHoldDays: number;         // avg days between buyDate and sellDate (sold only)
  bestTrade: { title: string; profit: number } | null;
  worstTrade: { title: string; profit: number } | null;
  verdict: 'STAR' | 'SOLID' | 'MIXED' | 'UNDERPERFORMER' | 'INSUFFICIENT_DATA';
}

export interface TagPerformanceResult {
  ok: true;
  totalTags: number;
  totalTradesWithTags: number;
  tags: TagStats[];
  bestProfitTag: { tag: string; profit: number } | null;
  bestROITag: { tag: string; roi: number } | null;
  mostUsedTag: { tag: string; count: number } | null;
  suggestedFocus: string[];   // tags the user should keep buying (high ROI + enough samples)
  suggestedAvoid: string[];   // tags that are losing money
  source: 'v8.63-tag-performance';
}

export async function getTagPerformance(): Promise<TagPerformanceResult> {
  // Fetch all trades that have tags
  const trades = await db.trade.findMany({
    where: { NOT: { tags: '' } },
    select: {
      id: true,
      title: true,
      tags: true,
      status: true,
      buyPrice: true,
      buyFees: true,
      buyDate: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
    },
  });

  // Group trades by tag (a trade can have multiple tags)
  const tagMap: Record<string, any[]> = {};
  for (const t of trades) {
    const tags = parseTags(t.tags);
    for (const tag of tags) {
      if (!tagMap[tag]) tagMap[tag] = [];
      tagMap[tag].push(t);
    }
  }

  const tags: TagStats[] = Object.entries(tagMap).map(([tag, ts]) => {
    const totalCount = ts.length;
    const heldCount = ts.filter(t => t.status === 'held').length;
    const soldCount = ts.filter(t => t.status === 'sold').length;
    const cancelledCount = ts.filter(t => t.status === 'cancelled').length;

    const sold = ts.filter(t => t.status === 'sold' && t.sellPrice != null);
    const totalInvested = ts.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRevenue = sold.reduce((s, t) => s + (t.sellPrice ?? 0) - (t.sellFees ?? 0), 0);
    const totalInvestedSold = sold.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalProfit = totalRevenue - totalInvestedSold;

    const avgProfitPerTrade = sold.length > 0 ? totalProfit / sold.length : 0;
    const avgROI = totalInvestedSold > 0 ? (totalProfit / totalInvestedSold) * 100 : 0;
    const winRate = sold.length > 0
      ? (sold.filter(t => {
          const profit = (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
          return profit > 0;
        }).length / sold.length) * 100
      : 0;

    // avg hold days
    const holdDays = sold
      .filter(t => t.sellDate && t.buyDate)
      .map(t => Math.max(0, (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)));
    const avgHoldDays = holdDays.length > 0 ? holdDays.reduce((s, d) => s + d, 0) / holdDays.length : 0;

    // best / worst sold trade
    const soldWithProfit = sold.map(t => ({
      title: t.title,
      profit: (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0),
    })).sort((a, b) => b.profit - a.profit);
    const bestTrade = soldWithProfit[0] ? { title: soldWithProfit[0].title, profit: Math.round(soldWithProfit[0].profit * 100) / 100 } : null;
    const worstTrade = soldWithProfit[soldWithProfit.length - 1]
      ? { title: soldWithProfit[soldWithProfit.length - 1].title, profit: Math.round(soldWithProfit[soldWithProfit.length - 1].profit * 100) / 100 }
      : null;

    // Verdict
    let verdict: TagStats['verdict'] = 'INSUFFICIENT_DATA';
    if (sold.length >= 3) {
      if (avgROI >= 30 && winRate >= 70) verdict = 'STAR';
      else if (avgROI >= 15 && winRate >= 60) verdict = 'SOLID';
      else if (avgROI >= 0) verdict = 'MIXED';
      else verdict = 'UNDERPERFORMER';
    }

    return {
      tag,
      totalCount,
      heldCount,
      soldCount,
      cancelledCount,
      totalInvested: Math.round(totalInvested * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      avgProfitPerTrade: Math.round(avgProfitPerTrade * 100) / 100,
      avgROI: Math.round(avgROI * 100) / 100,
      winRate: Math.round(winRate * 100) / 100,
      avgHoldDays: Math.round(avgHoldDays * 10) / 10,
      bestTrade,
      worstTrade,
      verdict,
    };
  }).sort((a, b) => b.totalProfit - a.totalProfit);

  // Aggregates
  const profitableTags = tags.filter(t => t.soldCount >= 3);
  const bestProfitTag = profitableTags.length > 0
    ? { tag: profitableTags[0].tag, profit: profitableTags[0].totalProfit }
    : (tags[0] ? { tag: tags[0].tag, profit: tags[0].totalProfit } : null);
  const bestROITag = profitableTags.length > 0
    ? { tag: profitableTags.reduce((best, t) => t.avgROI > best.avgROI ? t : best).tag,
        roi: profitableTags.reduce((best, t) => t.avgROI > best.avgROI ? t : best).avgROI }
    : (tags[0] ? { tag: tags[0].tag, roi: tags[0].avgROI } : null);
  const mostUsedTag = tags.length > 0
    ? { tag: tags.reduce((max, t) => t.totalCount > max.totalCount ? t : max).tag,
        count: tags.reduce((max, t) => t.totalCount > max.totalCount ? t : max).totalCount }
    : null;

  // Suggestions
  const suggestedFocus = profitableTags
    .filter(t => t.verdict === 'STAR' || t.verdict === 'SOLID')
    .map(t => t.tag);
  const suggestedAvoid = profitableTags
    .filter(t => t.verdict === 'UNDERPERFORMER')
    .map(t => t.tag);

  return {
    ok: true,
    totalTags: tags.length,
    totalTradesWithTags: trades.length,
    tags,
    bestProfitTag,
    bestROITag,
    mostUsedTag,
    suggestedFocus,
    suggestedAvoid,
    source: 'v8.63-tag-performance',
  };
}

/** v8.63: Return a list of all distinct tags in use across all trades (for autocomplete). */
export async function getAllTags(): Promise<string[]> {
  const rows = await db.trade.findMany({
    where: { NOT: { tags: '' } },
    select: { tags: true },
  });
  const set = new Set<string>();
  for (const r of rows) {
    for (const t of parseTags(r.tags)) set.add(t);
  }
  return Array.from(set).sort();
}
