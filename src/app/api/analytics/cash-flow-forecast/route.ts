// v7.51: Cash Flow Forecaster — predvidi razpoložljivi kapital v 7/14/30 dneh.
//
// "Čez 7 dni: 200€ od pričakovanih prodaj + 500€ sproščenih iz inventarja = 700€"
// Upošteva: expected sales (based on sell probability), aging items (likely sold),
// carrying costs, in-coming deals (likely bought).
//
// GET /api/analytics/cash-flow-forecast

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true, category: true,
        flipChecklist: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });

    const soldHistory = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true, category: true },
      take: 100,
    });

    // Current cash = 0 (local-first, we track inventory value)
    // Available = estimated sell value of items likely to sell in timeframe
    const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice, 0);

    // Compute sell probability per item based on:
    // - Days held vs category avg
    // - Has flip checklist progress (listed = higher prob)
    // - Deal score (higher = more attractive)
    const catAvgHold = new Map<string, number[]>();
    for (const t of soldHistory) {
      const cat = (t.category || 'drugo').trim();
      const days = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
      if (!catAvgHold.has(cat)) catAvgHold.set(cat, []);
      catAvgHold.get(cat)!.push(days);
    }
    const catAvgHoldMap = new Map<string, number>();
    catAvgHold.forEach((days, cat) => {
      catAvgHoldMap.set(cat, Math.round(days.reduce((s, d) => s + d, 0) / days.length));
    });

    // Forecast for 7/14/30 days
    const forecast: Array<{
      days: number;
      expectedInflowEur: number;
      expectedOutflowEur: number;
      netCashFlowEur: number;
      itemsLikelySold: number;
      itemsLikelyBought: number;
      availableCapitalEur: number;
      detail: Array<{ title: string; estPrice: number; probability: number; timeframe: string }>;
    }> = [];

    for (const [days] of [[7], [14], [30]] as number[][]) {
      const detail: Array<{ title: string; estPrice: number; probability: number; timeframe: string }> = [];
      let expectedInflow = 0;
      let itemsLikelySold = 0;

      for (const t of heldTrades) {
        const daysHeld = Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / 86400000);
        const estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
        const avgHold = catAvgHoldMap.get((t.category || 'drugo').trim()) ?? 30;

        // Parse flip checklist — if listed, higher sell probability
        let isListed = false;
        try { const cl = JSON.parse(t.flipChecklist || '[]'); isListed = cl.some((s: any) => s.step?.includes('listed')); } catch { /* */ }

        // Sell probability model:
        // - If listed + daysHeld >= avgHold * 0.5: 60% in 7d, 80% in 14d, 90% in 30d
        // - If listed + daysHeld < avgHold * 0.5: 30% in 7d, 50% in 14d, 70% in 30d
        // - If not listed: 10% in 7d, 25% in 14d, 50% in 30d
        // - Aging items (>avgHold * 1.5): +20% (more likely to discount-sell)
        let baseProb: number;
        if (isListed && daysHeld >= avgHold * 0.5) baseProb = 0.6;
        else if (isListed) baseProb = 0.3;
        else baseProb = 0.1;

        if (daysHeld > avgHold * 1.5) baseProb += 0.2; // aging boost

        // Scale by timeframe
        let timeframeProb: number;
        if (days === 7) timeframeProb = baseProb;
        else if (days === 14) timeframeProb = baseProb + 0.2;
        else timeframeProb = baseProb + 0.3;

        timeframeProb = Math.min(0.95, timeframeProb);

        const expectedPrice = Math.round(estValue * 0.9); // 10% under est for fast sale
        const contribution = Math.round(expectedPrice * timeframeProb);

        if (timeframeProb > 0.15) {
          expectedInflow += contribution;
          itemsLikelySold += 1;
          detail.push({
            title: t.title.slice(0, 40),
            estPrice: expectedPrice,
            probability: Math.round(timeframeProb * 100),
            timeframe: `${days}d`,
          });
        }
      }

      // Expected outflow (new purchases)
      // Based on historical buy rate: avg buys per 30 days
      const buyRate = soldHistory.length > 0 ? soldHistory.length / 3 : 2; // rough monthly buy rate
      const expectedBuys = Math.ceil(buyRate * (days / 30));
      const avgBuyPrice = soldHistory.length > 0
        ? Math.round(soldHistory.reduce((s, t) => s + t.buyPrice, 0) / soldHistory.length)
        : 150;
      const expectedOutflow = expectedBuys * avgBuyPrice;

      const netCashFlow = expectedInflow - expectedOutflow;
      const availableCapital = expectedInflow; // inflow = cash freed from sales

      forecast.push({
        days,
        expectedInflowEur: Math.round(expectedInflow),
        expectedOutflowEur: Math.round(expectedOutflow),
        netCashFlowEur: Math.round(netCashFlow),
        itemsLikelySold,
        itemsLikelyBought: expectedBuys,
        availableCapitalEur: Math.round(availableCapital),
        detail: detail.sort((a, b) => b.probability - a.probability).slice(0, 10),
      });
    }

    return NextResponse.json({
      ok: true,
      currentInventory: {
        totalItems: heldTrades.length,
        totalInvested: Math.round(totalInvested),
        totalEstValue: Math.round(heldTrades.reduce((s, t) => s + (t.listing?.aiEstimatedValue ?? t.buyPrice * 1.2), 0)),
      },
      forecast,
      recommendation: forecast[0].availableCapitalEur > totalInvested * 0.3
        ? `💰 V 7 dneh boš imel ~${forecast[0].availableCapitalEur}€ sproščenega — dovolj za nove nakupe!`
        : forecast[0].availableCapitalEur > 0
        ? `🟡 V 7 dneh ~${forecast[0].availableCapitalEur}€ — omejeno. Razmisli o hitri prodaji zastarelih.`
        : `🔴 V 7 dneh pričakovan 0€ inflow — pošhitri prodajo (znižaj cene)!`,
    });
  } catch (err: any) {
    logger.error('/api/analytics/cash-flow-forecast', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
