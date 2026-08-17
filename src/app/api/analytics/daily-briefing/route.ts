// v8.80: Daily Opportunity Briefing — combines all intelligence into one concise summary.
// "Danes: 3 nova ujemanja, 2 held trades za prodajo, Sony A7III predlagana cena 856€,
//  včerajši outcome PERFECT, dobiček ta mesec +312€"

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      activeBuyRequests,
      newMatchesToday,
      heldTrades,
      soldToday,
      soldYesterday,
      monthlyProfit,
      monthlyGoal,
    ] = await Promise.all([
      // 1. Active BuyRequests with new matches
      db.buyRequest.findMany({
        where: { isActive: true, newMatchesCount: { gt: 0 } },
        select: { id: true, title: true, searchFor: true, newMatchesCount: true },
        orderBy: { newMatchesCount: 'desc' },
        take: 3,
      }),
      // 2. Total new matches today
      db.buyRequestMatch.count({
        where: { matchedAt: { gte: todayStart } },
      }),
      // 3. Held trades (for sell priority)
      db.trade.findMany({
        where: { status: 'held' },
        select: { id: true, title: true, buyPrice: true, buyDate: true, category: true, tags: true, buyScore: true },
        orderBy: { buyDate: 'asc' },
      }),
      // 4. Sold today
      db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: todayStart } },
        select: { id: true, title: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      }),
      // 5. Sold yesterday (for outcome reference)
      db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: yesterdayStart, lt: todayStart } },
        select: { id: true, title: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      }),
      // 6. Monthly realized profit
      db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      }),
      // 7. Monthly goal
      db.settings.findUnique({
        where: { id: 'singleton' },
        select: { monthlyProfitGoal: true },
      }),
    ]);

    // --- Compute sell priority (simplified — oldest held = most urgent) ---
    const heldWithDays = heldTrades.map(t => {
      const daysHeld = Math.max(0, Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)));
      return { ...t, daysHeld };
    }).sort((a, b) => b.daysHeld - a.daysHeld);
    const topSellPriority = heldWithDays.slice(0, 2).map(t => ({
      id: t.id,
      title: t.title,
      daysHeld: t.daysHeld,
      buyPrice: t.buyPrice,
      buyScore: t.buyScore,
    }));

    // --- Compute today's profit ---
    const todayProfit = soldToday.reduce((s, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return s + (revenue - cost);
    }, 0);

    // --- Compute yesterday's profit + outcome ---
    const yesterdayProfit = soldYesterday.reduce((s, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return s + (revenue - cost);
    }, 0);

    // --- Monthly profit ---
    const monthProfit = monthlyProfit.reduce((s, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return s + (revenue - cost);
    }, 0);

    const goalProgress = monthlyGoal?.monthlyProfitGoal && monthlyGoal.monthlyProfitGoal > 0
      ? (monthProfit / monthlyGoal.monthlyProfitGoal) * 100
      : null;

    // --- Days in month remaining ---
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    // --- Build action items ---
    const actionItems: Array<{ priority: 'high' | 'medium' | 'low'; text: string; link?: string }> = [];

    if (activeBuyRequests.length > 0) {
      const totalNew = activeBuyRequests.reduce((s, r) => s + r.newMatchesCount, 0);
      actionItems.push({
        priority: 'high',
        text: `${totalNew} novih ujemanj za ${activeBuyRequests.length} ${activeBuyRequests.length === 1 ? 'iskanje' : 'iskanj'} — preglej v Iskalniku`,
        link: `/?view=iskalnik&matchRequestId=${activeBuyRequests[0].id}`,
      });
    }

    if (topSellPriority.length > 0) {
      const top = topSellPriority[0];
      actionItems.push({
        priority: top.daysHeld > 30 ? 'high' : 'medium',
        text: `"${top.title}" držiš že ${top.daysHeld} dni — premisli o prodaji`,
        link: '/?view=trades',
      });
    }

    if (soldToday.length > 0) {
      actionItems.push({
        priority: 'low',
        text: `Danes prodal ${soldToday.length} ${soldToday.length === 1 ? 'artikel' : 'artikle'} za ${todayProfit >= 0 ? '+' : ''}${todayProfit.toFixed(0)}€`,
      });
    }

    if (goalProgress != null) {
      if (goalProgress >= 100) {
        actionItems.push({ priority: 'low', text: `🏆 Mesečni cilj dosežen (${goalProgress.toFixed(0)}%)!` });
      } else if (daysRemaining > 0 && goalProgress < 50) {
        const dailyNeeded = (monthlyGoal!.monthlyProfitGoal - monthProfit) / daysRemaining;
        actionItems.push({
          priority: 'medium',
          text: `Za cilj rabiš ${dailyNeeded.toFixed(0)}€/dan v preostalih ${daysRemaining} dneh (${goalProgress.toFixed(0)}%)`,
        });
      }
    }

    if (actionItems.length === 0) {
      actionItems.push({ priority: 'low', text: 'Ni novih dogajanj — sistem monitoring aktiven.' });
    }

    return NextResponse.json({
      ok: true,
      date: now.toISOString().slice(0, 10),
      // BuyRequest matches
      newMatchesToday,
      activeBuyRequestsWithMatches: activeBuyRequests.length,
      topBuyRequests: activeBuyRequests,
      // Sell priority
      heldCount: heldTrades.length,
      topSellPriority,
      // Today's sales
      soldTodayCount: soldToday.length,
      todayProfit: Math.round(todayProfit * 100) / 100,
      // Yesterday
      soldYesterdayCount: soldYesterday.length,
      yesterdayProfit: Math.round(yesterdayProfit * 100) / 100,
      // Monthly
      monthProfit: Math.round(monthProfit * 100) / 100,
      monthlyGoal: monthlyGoal?.monthlyProfitGoal ?? null,
      goalProgress: goalProgress != null ? Math.round(goalProgress * 100) / 100 : null,
      daysRemaining,
      // Actions
      actionItems,
      source: 'v8.80-daily-briefing',
    });

  } catch (err) {
    logger.error('/api/analytics/daily-briefing', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
