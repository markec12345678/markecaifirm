// v6.7: Profit Goal Tracker v2 — enhanced z AI projekcijami in milestone alerts
// GET /api/trades/goal-tracker
// Returns: { ok, current, projected, milestones, recommendation, history }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await db.settings.findFirst({ where: { id: 'singleton' }, select: { monthlyProfitGoal: true } });
  const monthlyGoal = settings?.monthlyProfitGoal ?? 0;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Get this month's sold trades
  const thisMonthSold = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: monthStart } },
    select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, sellDate: true, title: true, category: true },
  });

  // Get last month's sold trades for comparison
  const lastMonthSold = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: lastMonthStart, lt: monthStart } },
    select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
  });

  // Get currently held trades (potential future profit)
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: { buyPrice: true, buyFees: true, title: true, category: true, buyDate: true,
      listing: { select: { aiEstimatedValue: true } } },
  });

  // Calculate this month's realized profit
  const realizedProfit = thisMonthSold.reduce((s, t) =>
    s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

  // Calculate last month's profit
  const lastMonthProfit = lastMonthSold.reduce((s, t) =>
    s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

  // Calculate potential profit from held trades
  const potentialProfit = heldTrades.reduce((s, t) => {
    const estSell = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.15);
    return s + (estSell - t.buyPrice - (t.buyFees ?? 0) - estSell * 0.1); // minus 10% fees
  }, 0);

  // Days in month + days remaining
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = daysInMonth - dayOfMonth;

  // Projected profit: current profit + daily rate * remaining days
  const dailyRate = dayOfMonth > 0 ? realizedProfit / dayOfMonth : 0;
  const projectedProfit = Math.round(realizedProfit + dailyRate * daysRemaining);

  // Goal tracking
  const goalPct = monthlyGoal > 0 ? Math.round((realizedProfit / monthlyGoal) * 100) : 0;
  const projectedPct = monthlyGoal > 0 ? Math.round((projectedProfit / monthlyGoal) * 100) : 0;
  const remainingToGoal = Math.max(0, monthlyGoal - realizedProfit);
  const dailyNeeded = daysRemaining > 0 ? Math.round(remainingToGoal / daysRemaining) : 0;

  // Milestones
  const milestones = [
    { pct: 25, label: 'četrtina', achieved: goalPct >= 25, profit: Math.round(monthlyGoal * 0.25) },
    { pct: 50, label: 'polovica', achieved: goalPct >= 50, profit: Math.round(monthlyGoal * 0.50) },
    { pct: 75, label: 'tri četrtine', achieved: goalPct >= 75, profit: Math.round(monthlyGoal * 0.75) },
    { pct: 100, label: 'CILJ', achieved: goalPct >= 100, profit: monthlyGoal },
  ];

  // History (last 6 months)
  const history: any[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = d.toISOString().slice(0, 7);
    const monthLabel = d.toLocaleDateString('sl-SI', { month: 'short', year: '2-digit' });
    const monthTrades = i === 0 ? thisMonthSold : await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { gte: new Date(d.getFullYear(), d.getMonth(), 1), lt: new Date(d.getFullYear(), d.getMonth() + 1, 1) } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
    });
    const profit = monthTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    history.push({ month: monthKey, label: monthLabel, profit: Math.round(profit), count: monthTrades.length });
  }

  // Recommendation
  let recommendation: string;
  let recommendationLevel: 'good' | 'warning' | 'critical';
  if (monthlyGoal === 0) {
    recommendation = 'Nastavi mesečni cilj v Nastavitve za sledenje napredku.';
    recommendationLevel = 'warning';
  } else if (goalPct >= 100) {
    recommendation = `🎉 CILJ DOSEŽEN! ${realizedProfit}€ od ${monthlyGoal}€. Premagaj cilj za dodatni dobiček!`;
    recommendationLevel = 'good';
  } else if (projectedPct >= 100) {
    recommendation = `✅ Na poti za doseganje cilja! Pričakovani dobiček: ${projectedProfit}€ (${projectedPct}%).`;
    recommendationLevel = 'good';
  } else if (projectedPct >= 75) {
    recommendation = `⚠️ Blizu cilja, a potreben še 1-2 prodaji. Dnevno potrebno: ${dailyNeeded}€.`;
    recommendationLevel = 'warning';
  } else if (projectedPct >= 50) {
    recommendation = `🟡 Zmerno zaostajanje. Pospeši prodajo — dnevno potrebno: ${dailyNeeded}€/${daysRemaining}d.`;
    recommendationLevel = 'warning';
  } else {
    recommendation = `🔴 Zaostajek! Pričakovani dobiček ${projectedProfit}€ ni dovolj za cilj ${monthlyGoal}€. Razmisli o znižanju cen ali večjem obsegu.`;
    recommendationLevel = 'critical';
  }

  // Month-over-month trend
  const momTrend = lastMonthProfit > 0 ? Math.round(((realizedProfit - lastMonthProfit) / lastMonthProfit) * 100) : null;

  return NextResponse.json({
    ok: true,
    current: {
      realizedProfit: Math.round(realizedProfit),
      potentialProfit: Math.round(potentialProfit),
      totalPotential: Math.round(realizedProfit + potentialProfit),
      soldCount: thisMonthSold.length,
      heldCount: heldTrades.length,
      lastMonthProfit: Math.round(lastMonthProfit),
      momTrend,
    },
    goal: {
      monthlyGoal,
      goalPct,
      projectedPct,
      projectedProfit,
      remainingToGoal,
      dailyNeeded,
      daysRemaining,
      achieved: goalPct >= 100,
    },
    milestones,
    recommendation,
    recommendationLevel,
    history,
  });
}
