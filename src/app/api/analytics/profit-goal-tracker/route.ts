// v7.42: Profit Goal Tracker — vizualni napredek do mesečnega cilja + AI predikcija.
//
// GET /api/analytics/profit-goal-tracker
// Returns: { ok, goal, current, progressPct, daysLeft, dailyTargetNeeded,
//   projection: { expectedEndOfMonth, willHitGoal, shortfall, surplus },
//   history: [{ month, profit, goal, achieved }] }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: { monthlyProfitGoal: true },
    });

    const goal = settings?.monthlyProfitGoal ?? 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysInMonth = monthEnd.getDate();
    const dayOfMonth = now.getDate();
    const daysLeft = daysInMonth - dayOfMonth;

    // This month's sold trades
    const soldThisMonth = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: monthStart, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true },
    });

    const currentProfit = soldThisMonth.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const progressPct = goal > 0 ? Math.min(100, Math.round((currentProfit / goal) * 100)) : 0;

    // Daily average so far
    const dailyAvg = dayOfMonth > 0 ? currentProfit / dayOfMonth : 0;
    const projectedEndOfMonth = Math.round(dailyAvg * daysInMonth);
    const willHitGoal = projectedEndOfMonth >= goal;
    const shortfall = willHitGoal ? 0 : Math.round(goal - projectedEndOfMonth);
    const surplus = willHitGoal ? Math.round(projectedEndOfMonth - goal) : 0;
    const dailyTargetNeeded = daysLeft > 0 ? Math.round((goal - currentProfit) / daysLeft) : 0;

    // History — last 6 months
    const history: Array<{ month: string; profit: number; goal: number; achieved: boolean }> = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const sold = await db.trade.findMany({
        where: { status: 'sold', sellDate: { gte: start, lte: end, not: null } },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      });
      const profit = sold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
      const monthName = start.toLocaleDateString('sl-SI', { month: 'short' });
      history.push({
        month: monthName,
        profit: Math.round(profit),
        goal: Math.round(goal),
        achieved: goal > 0 ? profit >= goal : true,
      });
    }

    // Currently held inventory value (potential future profit)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { buyPrice: true, listing: { select: { aiEstimatedValue: true } } },
    });
    const heldValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const potentialProfit = heldTrades.reduce((s, t) => s + ((t.listing?.aiEstimatedValue ?? t.buyPrice * 1.2) - t.buyPrice), 0);

    // Recommendation
    let recommendation = '';
    if (goal <= 0) {
      recommendation = 'Nastavi mesečni cilj v Nastavitvah za sledenje napredka.';
    } else if (progressPct >= 100) {
      recommendation = `🎉 Cilj dosežen! ${currentProfit}€ / ${goal}€. Presežek: +${Math.round(currentProfit - goal)}€. Dvigni cilj za naslednji mesec!`;
    } else if (willHitGoal) {
      recommendation = `📈 Na poti! Pri trenutnem tempu (${Math.round(dailyAvg)}€/dan) boš dosegel ${projectedEndOfMonth}€ do konca meseca. Surplus: +${surplus}€.`;
    } else if (daysLeft > 0) {
      recommendation = `⚠️ Zaostajaš. Potrebnih ${dailyTargetNeeded}€/dan v preostalih ${daysLeft} dneh za dosego cilja. Ali: prodaaj ${Math.ceil(shortfall / (dailyAvg > 0 ? dailyAvg : 1))} več item-ov.`;
    } else {
      recommendation = `Konec meseca. Doseženo: ${currentProfit}€ / ${goal}€ (${progressPct}%).`;
    }

    return NextResponse.json({
      ok: true,
      goal: Math.round(goal),
      current: Math.round(currentProfit),
      progressPct,
      dayOfMonth,
      daysInMonth,
      daysLeft,
      dailyAvg: Math.round(dailyAvg * 100) / 100,
      dailyTargetNeeded,
      projection: {
        expectedEndOfMonth: projectedEndOfMonth,
        willHitGoal,
        shortfall,
        surplus,
      },
      heldInventory: {
        count: heldTrades.length,
        value: Math.round(heldValue),
        potentialProfit: Math.round(potentialProfit),
      },
      history,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/profit-goal-tracker', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
