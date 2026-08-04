// v7.33: Deal Conversion Funnel — kje denar uhaja?
//
// Sledi konverziji od odkritja do dobička:
//   Stage 1: Discovered — AI našel priložnost (Listing aiVerdict='PRILIKA')
//   Stage 2: Interested — Uporabnik označil (Alert userAction='interested' ali isBookmarked)
//   Stage 3: Contacted — Kontaktiral prodajalca (Listing contactStatus != 'none')
//   Stage 4: Bought — Kupil (Trade status='held' ali 'sold')
//   Stage 5: Sold — Prodal (Trade status='sold')
//   Stage 6: Profitable — Dobičkonosno (sellPrice - buyPrice > 0)
//
// Za vsako stopnjo: count, value (EUR), conversion rate, avg time
// Identificira bottleneck (stopnja z najnižjo konverzijo) + priporočila.
//
// GET /api/analytics/deal-funnel?days=90

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 90, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Stage 1: Discovered — Listings z aiVerdict='PRILIKA' v obdobju
    const discovered = await db.listing.count({
      where: { aiVerdict: 'PRILIKA', firstSeenAt: { gte: since }, isHidden: false },
    });
    const discoveredValue = await db.listing.aggregate({
      where: { aiVerdict: 'PRILIKA', firstSeenAt: { gte: since }, isHidden: false, price: { not: null } },
      _sum: { price: true },
    });

    // Stage 2: Interested — Bookmarkani ali userAction='interested'
    const interested = await db.listing.count({
      where: {
        isBookmarked: true,
        firstSeenAt: { gte: since },
        isHidden: false,
      },
    });

    // Stage 3: Contacted — contactStatus != 'none'
    const contacted = await db.listing.count({
      where: {
        contactStatus: { not: 'none' },
        firstSeenAt: { gte: since },
        isHidden: false,
      },
    });

    // Stage 4: Bought — Trades (held + sold) v obdobju
    const bought = await db.trade.count({
      where: { buyDate: { gte: since } },
    });
    const boughtValue = await db.trade.aggregate({
      where: { buyDate: { gte: since } },
      _sum: { buyPrice: true },
    });

    // Stage 5: Sold — Trades z status='sold'
    const sold = await db.trade.count({
      where: { status: 'sold', sellDate: { gte: since } },
    });
    const soldValue = await db.trade.aggregate({
      where: { status: 'sold', sellDate: { gte: since }, sellPrice: { not: null } },
      _sum: { sellPrice: true },
    });

    // Stage 6: Profitable — sold z positive profit
    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: since }, sellPrice: { not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
    });
    const profitable = soldTrades.filter(t => ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)) > 0);
    const totalProfit = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

    // Avg time from buy to sell
    const holdTimes = soldTrades.map(t => (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000).filter(d => d >= 0);
    const avgHoldDays = holdTimes.length > 0 ? holdTimes.reduce((s, d) => s + d, 0) / holdTimes.length : 0;

    // Build funnel stages
    const stages = [
      { name: 'Odkrito', key: 'discovered', count: discovered, valueEur: discoveredValue._sum.price ?? 0, conversion: 100 },
      { name: 'Zanimivo', key: 'interested', count: interested, valueEur: 0, conversion: discovered > 0 ? (interested / discovered) * 100 : 0 },
      { name: 'Kontaktirano', key: 'contacted', count: contacted, valueEur: 0, conversion: interested > 0 ? (contacted / interested) * 100 : 0 },
      { name: 'Kupljeno', key: 'bought', count: bought, valueEur: boughtValue._sum.buyPrice ?? 0, conversion: contacted > 0 ? (bought / contacted) * 100 : 0 },
      { name: 'Prodano', key: 'sold', count: sold, valueEur: soldValue._sum.sellPrice ?? 0, conversion: bought > 0 ? (sold / bought) * 100 : 0 },
      { name: 'Dobiček', key: 'profitable', count: profitable.length, valueEur: Math.round(totalProfit * 100) / 100, conversion: sold > 0 ? (profitable.length / sold) * 100 : 0 },
    ];

    // Identificiraj bottleneck — stopnja z najnižjo konverzijo (razen prve)
    let bottleneck: { stage: string; conversion: number; suggestion: string } | null = null;
    for (let i = 1; i < stages.length; i++) {
      const s = stages[i];
      if (s.count > 0 && (bottleneck === null || s.conversion < bottleneck.conversion)) {
        const suggestions: Record<string, string> = {
          interested: 'Nastavi višji AI score threshold ali dodaj več monitorjev za boljše oglase.',
          contacted: 'Avtomatiziraj kontaktiranje — dodaj quick-response predloge ali Telegram bot za hiter odziv.',
          bought: 'Preveri zakaj kontaktirani oglasi niso kupljeni — morda predrago ali slab opis.',
          sold: 'Ceneje prodaj ali izboljšaj oglase za hitrejšo prodajo.',
          profitable: 'Boljši filtering pred nakupom — AI Deal Score threshold je morda prenizek.',
        };
        bottleneck = { stage: s.name, conversion: s.conversion, suggestion: suggestions[s.key] || 'Preveri konverzijo.' };
      }
    }

    // Overall conversion
    const overallConversion = discovered > 0 ? (profitable.length / discovered) * 100 : 0;

    return NextResponse.json({
      ok: true,
      days,
      stages,
      summary: {
        totalDiscovered: discovered,
        totalProfitable: profitable.length,
        totalProfitEur: Math.round(totalProfit * 100) / 100,
        overallConversion: Math.round(overallConversion * 100) / 100,
        avgHoldDays: Math.round(avgHoldDays * 10) / 10,
        bottleneck,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/deal-funnel', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
