// v7.55: Inventory Liquidation Strategist — za 60+ dni item-e: izhodna strategija.
//
// "PS5 držan 90 dni — nabava 400€, carrying cost 18€, depreciation 36€.
//  Bolha: prodaj za 350€ (gubi 50€). Vinted: 320€ (gubi 80€).
//  FB Marketplace: 380€ (gubi 20€) — NAJBOLJŠI kanal za likvidacijo."
//
// GET /api/ai/liquidation-strategist

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CARRYING_COST_PER_DAY = 0.50;
const DEPRECIATION_RATES: Record<string, number> = {
  elektronika: 5, avto: 2, moda: 1, orodje: 1.5, drugo: 3,
};

const PLATFORM_FEES: Record<string, number> = {
  bolha: 0.02, vinted: 0.05, 'facebook': 0, 'fb': 0,
};

export async function GET() {
  try {
    const now = Date.now();
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true, category: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
      orderBy: { buyDate: 'asc' },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, items: [], message: 'Skladišče je prazno.' });
    }

    // Filter to items that need liquidation (60+ days)
    const liquidationItems = heldTrades.map(t => {
      const days = Math.floor((now - new Date(t.buyDate).getTime()) / 86400000);
      const estValue = t.listing?.aiEstimatedValue ?? Math.round(t.buyPrice * 1.2);
      const cat = (t.category || 'drugo').toLowerCase();
      const depRate = DEPRECIATION_RATES[cat] ?? DEPRECIATION_RATES.drugo;
      const carryingCost = Math.round(days * CARRYING_COST_PER_DAY * 100) / 100;
      const depreciation = Math.round(t.buyPrice * (depRate / 100) * (days / 30) * 100) / 100;
      const totalLoss = carryingCost + depreciation;
      const netValueIfSoldNow = estValue - totalLoss;

      // Platform-specific pricing (Bolha highest, FB lowest for fast sale)
      const bolhaPrice = Math.round(estValue * 0.85); // 15% under
      const vintedPrice = Math.round(estValue * 0.75); // 25% under (Vinted cheaper)
      const fbPrice = Math.round(estValue * 0.70); // 30% under (FB fastest)

      // Net profit per platform (after fees + carrying cost already lost)
      const bolhaFee = Math.round(bolhaPrice * (PLATFORM_FEES.bolha ?? 0.02));
      const vintedFee = Math.round(vintedPrice * (PLATFORM_FEES.vinted ?? 0.05));
      const fbFee = 0;

      const bolhaNet = bolhaPrice - bolhaFee - t.buyPrice;
      const vintedNet = vintedPrice - vintedFee - t.buyPrice;
      const fbNet = fbPrice - fbFee - t.buyPrice;

      // Best channel
      const channels = [
        { platform: 'Bolha', price: bolhaPrice, net: bolhaNet, fee: bolhaFee, sellProbability: days > 60 ? 70 : 85 },
        { platform: 'Vinted', price: vintedPrice, net: vintedNet, fee: vintedFee, sellProbability: days > 60 ? 60 : 75 },
        { platform: 'Facebook', price: fbPrice, net: fbNet, fee: fbFee, sellProbability: days > 60 ? 80 : 90 },
      ].sort((a, b) => b.net - a.net);

      const bestChannel = channels[0];
      const worstChannel = channels[channels.length - 1];

      // Action
      let action: 'LIQUIDATE_NOW' | 'DROP_PRICE' | 'HOLD';
      if (days >= 90) action = 'LIQUIDATE_NOW';
      else if (days >= 60) action = 'DROP_PRICE';
      else action = 'HOLD';

      return {
        tradeId: t.id,
        title: t.title,
        category: t.category || 'drugo',
        buyPrice: t.buyPrice,
        estValue,
        daysHeld: days,
        carryingCost,
        depreciation,
        totalLoss: Math.round(totalLoss * 100) / 100,
        netValueIfSoldNow: Math.round(netValueIfSoldNow * 100) / 100,
        action,
        channels,
        bestChannel,
        worstChannel,
        recommendation: action === 'LIQUIDATE_NOW'
          ? `🔴 LIKVIDACIJA: ${days}d — prodaj na ${bestChannel.platform} za ${bestChannel.price}€ (net ${bestChannel.net >= 0 ? '+' : ''}${bestChannel.net}€)`
          : action === 'DROP_PRICE'
          ? `🟠 ZNIŽAJ: ${days}d — prodaj na ${bestChannel.platform} za ${bestChannel.price}€ (net ${bestChannel.net >= 0 ? '+' : ''}${bestChannel.net}€)`
          : `🟢 HOLD: ${days}d — še sveže, počakaj na boljšo ceno`,
      };
    }).filter(item => item.daysHeld >= 30); // only items 30+ days

    if (liquidationItems.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        message: '✅ Vsi item-i so pod 30 dni — ni potrebe po likvidaciji.',
      });
    }

    // Sort by urgency (most loss first)
    liquidationItems.sort((a, b) => b.totalLoss - a.totalLoss);

    // Summary
    const totalLoss = liquidationItems.reduce((s, i) => s + i.totalLoss, 0);
    const liquidateCount = liquidationItems.filter(i => i.action === 'LIQUIDATE_NOW').length;
    const dropCount = liquidationItems.filter(i => i.action === 'DROP_PRICE').length;
    const capitalAtRisk = liquidationItems.reduce((s, i) => s + i.buyPrice, 0);

    // Best channel overall
    const channelStats = new Map<string, { count: number; totalNet: number }>();
    for (const item of liquidationItems) {
      const ch = item.bestChannel.platform;
      const cur = channelStats.get(ch) || { count: 0, totalNet: 0 };
      cur.count += 1;
      cur.totalNet += item.bestChannel.net;
      channelStats.set(ch, cur);
    }
    const bestOverallChannel = Array.from(channelStats.entries())
      .map(([platform, d]) => ({ platform, count: d.count, avgNet: Math.round(d.totalNet / d.count) }))
      .sort((a, b) => b.avgNet - a.avgNet)[0];

    return NextResponse.json({
      ok: true,
      items: liquidationItems.slice(0, 20),
      summary: {
        totalItems: liquidationItems.length,
        liquidateNow: liquidateCount,
        dropPrice: dropCount,
        totalLossEur: Math.round(totalLoss),
        capitalAtRiskEur: Math.round(capitalAtRisk),
        bestOverallChannel: bestOverallChannel ? { platform: bestOverallChannel.platform, avgNet: bestOverallChannel.avgNet, count: bestOverallChannel.count } : null,
      },
      recommendation: liquidateCount > 0
        ? `🔴 ${liquidateCount} item-ov potrebujejo TAKOJŠNO likvidacijo! Skupna izguba: ${Math.round(totalLoss)}€. Najboljši kanal: ${bestOverallChannel?.platform}.`
        : dropCount > 0
        ? `🟠 ${dropCount} item-ov potrebujejo znižanje cene. Najboljši kanal: ${bestOverallChannel?.platform}.`
        : '✅ Vsi item-i so v acceptable starosti.',
    });
  } catch (err: any) {
    logger.error('/api/ai/liquidation-strategist', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
