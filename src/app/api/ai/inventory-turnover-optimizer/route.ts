// v7.49: Inventory Turnover Optimizer — kateri held item-i naj se prodajo PRVI?
//
// Razvrsti held inventar po "capital efficiency score":
// - Items z visokim ROI + dolg hold → PRODAJ PRVI (sprosti capital)
// - Items z nizkim ROI + kratek hold → ZADRŽI (bo še zraslo)
// - Items z negativnim ROI + dolg hold → LIKVIDIRAJ (reši kar se da)
//
// GET /api/ai/inventory-turnover-optimizer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = Date.now();
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true,
        category: true, flipChecklist: true, imageUrl: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true } },
      },
      orderBy: { buyDate: 'asc' },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, items: [], message: 'Skladišče je prazno.' });
    }

    // Get category avg turnover from sold history
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
    });

    const catStats = new Map<string, { avgHoldDays: number; avgRoiPct: number; count: number }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').trim();
      const holdDays = (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000;
      const roi = t.buyPrice > 0 ? ((t.sellPrice! - t.buyPrice) / t.buyPrice) * 100 : 0;
      const cur = catStats.get(cat) || { avgHoldDays: 0, avgRoiPct: 0, count: 0 };
      cur.avgHoldDays += holdDays;
      cur.avgRoiPct += roi;
      cur.count += 1;
      catStats.set(cat, cur);
    }
    catStats.forEach((v) => {
      if (v.count > 0) { v.avgHoldDays = Math.round(v.avgHoldDays / v.count); v.avgRoiPct = Math.round(v.avgRoiPct / v.count); }
    });

    // Compute priority for each held item
    const items = heldTrades.map(t => {
      const daysHeld = Math.floor((now - new Date(t.buyDate).getTime()) / 86400000);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
      const potentialProfit = estValue - t.buyPrice;
      const potentialRoiPct = t.buyPrice > 0 ? Math.round((potentialProfit / t.buyPrice) * 100) : 0;
      const catStat = catStats.get((t.category || 'drugo').trim());
      const expectedHoldDays = catStat?.avgHoldDays ?? 30;
      const expectedRoiPct = catStat?.avgRoiPct ?? 20;

      // Capital cost: buyPrice * 12% annual / 365 * daysHeld
      const capitalCostEur = Math.round(t.buyPrice * 0.12 / 365 * daysHeld * 100) / 100;
      // Depreciation: 3%/month
      const depreciationEur = Math.round(t.buyPrice * 0.03 * (daysHeld / 30) * 100) / 100;
      const totalCarryingCostEur = Math.round((capitalCostEur + depreciationEur) * 100) / 100;

      // Net value if sold now = estValue - carrying cost
      const netValueIfSoldNow = estValue - totalCarryingCostEur;
      const netProfitIfSoldNow = Math.round((netValueIfSoldNow - t.buyPrice) * 100) / 100;

      // Priority score (higher = sell first):
      // Factors:
      // - Days held vs expected hold (overdue = higher priority)
      // - Capital tied (higher buyPrice = more capital = higher priority)
      // - Depreciation rate (items losing value fast = sell sooner)
      // - ROI (high ROI items = sell to realize profit, low ROI = hold if short)
      const overdueFactor = daysHeld > expectedHoldDays ? (daysHeld - expectedHoldDays) / expectedHoldDays : 0;
      const capitalFactor = t.buyPrice / 100; // 100€ = 1 point
      const depreciationFactor = totalCarryingCostEur / 10; // 10€ carrying = 1 point
      const roiFactor = potentialRoiPct > 30 ? 2 : potentialRoiPct > 15 ? 1 : 0; // high ROI = sell to lock profit

      const priorityScore = Math.round((overdueFactor * 30 + capitalFactor + depreciationFactor + roiFactor * 10) * 10) / 10;

      // Action
      let action: 'SELL_NOW' | 'SELL_SOON' | 'HOLD' | 'LIQUIDATE';
      let reason = '';
      if (potentialProfit < 0 && daysHeld > 45) {
        action = 'LIQUIDATE';
        reason = `Negativni ROI + ${daysHeld}d — likvidiraj za ${t.buyPrice}€ (reši capital)`;
      } else if (daysHeld > 60 || (daysHeld > expectedHoldDays * 1.5)) {
        action = 'SELL_NOW';
        reason = `${daysHeld}d (pričakovano ${expectedHoldDays}d) — prodaj ZDAJ, carrying cost ${totalCarryingCostEur}€`;
      } else if (daysHeld > 30 || priorityScore > 15) {
        action = 'SELL_SOON';
        reason = `${daysHeld}d, priority ${priorityScore} — pripravi za prodajo`;
      } else {
        action = 'HOLD';
        reason = `${daysHeld}d, še freshe — počakaj na optimalno ceno`;
      }

      return {
        tradeId: t.id,
        title: t.title,
        category: t.category || 'drugo',
        buyPrice: t.buyPrice,
        estValue,
        potentialProfit: Math.round(potentialProfit),
        potentialRoiPct,
        daysHeld,
        expectedHoldDays,
        capitalCostEur,
        depreciationEur,
        totalCarryingCostEur,
        netProfitIfSoldNow,
        priorityScore,
        action,
        reason,
        flipProgress: (() => { try { return JSON.parse(t.flipChecklist || '[]').length; } catch { return 0; } })(),
      };
    });

    // Sort by priority score (highest = sell first)
    items.sort((a, b) => b.priorityScore - a.priorityScore);

    // Summary
    const totalCapitalTied = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const totalCarryingCost = items.reduce((s, i) => s + i.totalCarryingCostEur, 0);
    const sellNowCount = items.filter(i => i.action === 'SELL_NOW').length;
    const liquidateCount = items.filter(i => i.action === 'LIQUIDATE').length;
    const holdCount = items.filter(i => i.action === 'HOLD').length;

    // Capital efficiency: if we sell all SELL_NOW + LIQUIDATE items, how much capital freed?
    const sellItems = items.filter(i => i.action === 'SELL_NOW' || i.action === 'LIQUIDATE');
    const capitalFreed = sellItems.reduce((s, i) => s + i.estValue, 0);

    return NextResponse.json({
      ok: true,
      items,
      summary: {
        totalItems: items.length,
        totalCapitalTied: Math.round(totalCapitalTied),
        totalCarryingCost: Math.round(totalCarryingCost),
        sellNow: sellNowCount,
        sellSoon: items.filter(i => i.action === 'SELL_SOON').length,
        hold: holdCount,
        liquidate: liquidateCount,
        capitalFreedIfSold: Math.round(capitalFreed),
        recommendation: sellNowCount + liquidateCount > 0
          ? `🔑 AKCIJA: Prodaj ${sellNowCount + liquidateCount} item-ov ZDAJ — sprosti ${Math.round(capitalFreed)}€ capital!`
          : `✅ Vsi item-i so v optimalnem obdobju — ni naglice.`,
      },
    });
  } catch (err: any) {
    logger.error('/api/ai/inventory-turnover-optimizer', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
