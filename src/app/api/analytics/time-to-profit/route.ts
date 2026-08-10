// v7.44: Time-to-Profit Dashboard — "od najdbe do prodaje = koliko časa?"
//
// Analizira cikel preprodaje:
// 1. Discovery → Contact (koliko časa od najdbe do kontaktiranja)
// 2. Contact → Buy (koliko časa od kontaktiranja do nakupa)
// 3. Buy → List (koliko časa od nakupa do objave za prodajo)
// 4. List → Sell (koliko časa od objave do prodaje)
// 5. Total cycle (od najdbe do prodaje)
//
// GET /api/analytics/time-to-profit

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get sold trades with linked listings (for firstSeenAt)
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: {
        id: true, title: true, category: true,
        buyPrice: true, buyDate: true, sellPrice: true, sellDate: true,
        listing: {
          select: {
            firstSeenAt: true, contactedAt: true, contactStatus: true,
            priceDroppedAt: true, detailFetchedAt: true,
          },
        },
      },
      take: 200,
    });

    if (soldTrades.length < 1) {
      return NextResponse.json({ ok: true, message: 'Ni prodanih trade-ov za analizo cikla.' });
    }

    // Compute cycle stages for each trade
    type Cycle = {
      tradeId: string;
      title: string;
      category: string;
      profit: number;
      discoveryToContact: number | null;
      contactToBuy: number | null;
      buyToSell: number | null;
      totalCycle: number | null;
      buyPrice: number;
      sellPrice: number;
    };

    const cycles: Cycle[] = soldTrades.map(t => {
      const listing = t.listing;
      const discovery = listing?.firstSeenAt ? new Date(listing.firstSeenAt) : null;
      const contact = listing?.contactedAt ? new Date(listing.contactedAt) : null;
      const buy = new Date(t.buyDate);
      const sell = new Date(t.sellDate!);

      const profit = (t.sellPrice ?? 0) - t.buyPrice;

      return {
        tradeId: t.id,
        title: t.title,
        category: t.category || 'drugo',
        profit,
        discoveryToContact: discovery && contact ? Math.round((contact.getTime() - discovery.getTime()) / 86400000) : null,
        contactToBuy: contact ? Math.round((buy.getTime() - contact.getTime()) / 86400000) : null,
        buyToSell: Math.round((sell.getTime() - buy.getTime()) / 86400000),
        totalCycle: discovery ? Math.round((sell.getTime() - discovery.getTime()) / 86400000) : null,
        buyPrice: t.buyPrice,
        sellPrice: t.sellPrice ?? 0,
      };
    });

    // Compute averages
    const validD2C = cycles.filter(c => c.discoveryToContact != null).map(c => c.discoveryToContact!);
    const validC2B = cycles.filter(c => c.contactToBuy != null).map(c => c.contactToBuy!);
    const validB2S = cycles.filter(c => c.buyToSell != null && c.buyToSell >= 0).map(c => c.buyToSell!);
    const validTotal = cycles.filter(c => c.totalCycle != null).map(c => c.totalCycle!);

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : 0;
    const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0;
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

    // Profit per day metric (how much you earn per day of cycle)
    const totalProfit = cycles.reduce((s, c) => s + c.profit, 0);
    const avgTotalCycle = avg(validTotal);
    const profitPerDay = avgTotalCycle > 0 ? Math.round((totalProfit / (avgTotalCycle * cycles.length)) * 10) / 10 : 0;

    // By category
    const catMap = new Map<string, { cycles: Cycle[]; profit: number }>();
    for (const c of cycles) {
      const cat = c.category;
      if (!catMap.has(cat)) catMap.set(cat, { cycles: [], profit: 0 });
      catMap.get(cat)!.cycles.push(c);
      catMap.get(cat)!.profit += c.profit;
    }
    const byCategory = Array.from(catMap.entries()).map(([cat, d]) => {
      const totalCycles = d.cycles.filter(c => c.totalCycle != null).map(c => c.totalCycle!);
      const buyToSell = d.cycles.filter(c => c.buyToSell != null).map(c => c.buyToSell!);
      return {
        category: cat,
        count: d.cycles.length,
        avgTotalCycle: avg(totalCycles),
        avgBuyToSell: avg(buyToSell),
        totalProfit: Math.round(d.profit),
        avgProfit: Math.round(d.profit / d.cycles.length),
        profitPerDay: avg(totalCycles) > 0 ? Math.round((d.profit / (avg(totalCycles) * d.cycles.length)) * 10) / 10 : 0,
      };
    }).sort((a, b) => b.profitPerDay - a.profitPerDay);

    // Slowest and fastest trades
    const sortedByCycle = cycles.filter(c => c.totalCycle != null).sort((a, b) => (a.totalCycle!) - (b.totalCycle!));
    const fastest = sortedByCycle.slice(0, 3).map(c => ({ title: c.title, days: c.totalCycle, profit: c.profit }));
    const slowest = sortedByCycle.slice(-3).reverse().map(c => ({ title: c.title, days: c.totalCycle, profit: c.profit }));

    // Recommendation
    let recommendation = '';
    if (avgTotalCycle > 0) {
      if (avgTotalCycle <= 14) {
        recommendation = `🚀 Odličen cikel! Povprečno ${avgTotalCycle} dni od najdbe do prodaje. Profit/dan: ${profitPerDay}€.`;
      } else if (avgTotalCycle <= 30) {
        recommendation = `✅ Dober cikel (${avgTotalCycle} dni). Za izboljšavo: pohitri kontaktiranje (avg ${avg(validD2C)}d) in objavo (flip checklist).`;
      } else if (avgTotalCycle <= 60) {
        recommendation = `⚠️ Počasen cikel (${avgTotalCycle} dni). Capital vezan predolgo. Ciljaj na <30 dni — pošhitri flip workflow.`;
      } else {
        recommendation = `🔴 Zelo počasno (${avgTotalCycle} dni)! Capital efficiency nizka. Likvidiraj zastarele item-e, pošhitri prodajo.`;
      }
    }

    return NextResponse.json({
      ok: true,
      summary: {
        totalTrades: cycles.length,
        avgDiscoveryToContact: avg(validD2C),
        avgContactToBuy: avg(validC2B),
        avgBuyToSell: avg(validB2S),
        avgTotalCycle,
        minCycle: min(validTotal),
        maxCycle: max(validTotal),
        totalProfit: Math.round(totalProfit),
        profitPerDay,
      },
      stages: {
        discoveryToContact: { avg: avg(validD2C), min: min(validD2C), max: max(validD2C), label: 'Odkritje → Kontakt' },
        contactToBuy: { avg: avg(validC2B), min: min(validC2B), max: max(validC2B), label: 'Kontakt → Nakup' },
        buyToSell: { avg: avg(validB2S), min: min(validB2S), max: max(validB2S), label: 'Nakup → Prodaja' },
        total: { avg: avgTotalCycle, min: min(validTotal), max: max(validTotal), label: 'Total cikel' },
      },
      byCategory,
      fastest,
      slowest,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/time-to-profit', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
