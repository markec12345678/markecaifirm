// v7.54: Missed Opportunity Tracker — sledi oglasom ki so izginili (prodal nekdo drug).
//
// "Ta iPhone 13 je bil 150€, nisi kupil. 3 dni kasneje je izginil iz Bolhe
//  = nekdo ga je kupil. Če bi ga ti, bi zaslužil +150€."
//
// Analizira:
// 1. Listings ki so izginili (neaktivni >7 dni) in niso bili kupljeni od tebe
// 2. Primerja jih z ocenjeno vrednostjo = "zamujeni dobiček"
// 3. Uči iz vzorcev: katere tipe oglasov najpogosteje zamudiš?
//
// GET /api/analytics/missed-opportunities

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 86400000);
    const monthAgo = new Date(now - 30 * 86400000);

    // Find listings that were PRILIKA (good deals) but:
    // - You didn't buy (no trade linked)
    // - You didn't contact (contactStatus = 'none')
    // - They haven't been seen recently (firstSeenAt > 7 days ago = likely sold by someone else)
    const missedOpportunities = await db.listing.findMany({
      where: {
        aiVerdict: 'PRILIKA',
        isHidden: false,
        contactStatus: 'none',
        firstSeenAt: { lt: weekAgo, gte: monthAgo },
        dealScore: { gte: 60 },
        // Not linked to any trade (you didn't buy it)
        trades: { none: {} },
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        aiScore: true, aiRisk: true, aiVerdict: true, aiEstimatedValue: true,
        dealScore: true, firstSeenAt: true, location: true,
        monitor: { select: { source: true, name: true } },
      },
      orderBy: { dealScore: 'desc' },
      take: 100,
    });

    if (missedOpportunities.length === 0) {
      return NextResponse.json({
        ok: true,
        missed: [],
        message: '🎉 Nisi zamudil nobene priložnosti v zadnjih 30 dneh!',
      });
    }

    // Compute missed profit for each
    const missedWithProfit = missedOpportunities.map(l => {
      const estValue = l.aiEstimatedValue ?? Math.round((l.price ?? 0) * 1.2);
      const potentialProfit = l.price ? estValue - l.price : 0;
      const daysSinceSeen = Math.floor((now - new Date(l.firstSeenAt).getTime()) / 86400000);

      return {
        id: l.id,
        title: l.title,
        price: l.price,
        priceText: l.priceText,
        estValue,
        potentialProfit: Math.round(potentialProfit),
        potentialRoiPct: l.price ? Math.round((potentialProfit / l.price) * 100) : 0,
        dealScore: l.dealScore,
        aiRisk: l.aiRisk,
        daysAgo: daysSinceSeen,
        source: l.monitor?.source || 'unknown',
        url: l.url,
        location: l.location,
        likely: daysSinceSeen > 14 ? 'SOLD_BY_OTHER' : daysSinceSeen > 7 ? 'LIKELY_SOLD' : 'EXPIRED',
      };
    });

    // Summary stats
    const totalMissedProfit = missedWithProfit.reduce((s, m) => s + m.potentialProfit, 0);
    const avgMissedProfit = Math.round(totalMissedProfit / missedWithProfit.length);

    // By source — which platform has most missed deals?
    const bySource = new Map<string, { count: number; profit: number }>();
    for (const m of missedWithProfit) {
      const cur = bySource.get(m.source) || { count: 0, profit: 0 };
      cur.count += 1;
      cur.profit += m.potentialProfit;
      bySource.set(m.source, cur);
    }
    const sourceBreakdown = Array.from(bySource.entries())
      .map(([source, d]) => ({ source, count: d.count, totalMissedProfit: Math.round(d.profit), avgProfit: Math.round(d.profit / d.count) }))
      .sort((a, b) => b.totalMissedProfit - a.totalMissedProfit);

    // By deal score range
    const byScoreRange = [
      { range: '90-100', count: missedWithProfit.filter(m => m.dealScore! >= 90).length, profit: missedWithProfit.filter(m => m.dealScore! >= 90).reduce((s, m) => s + m.potentialProfit, 0) },
      { range: '80-89', count: missedWithProfit.filter(m => m.dealScore! >= 80 && m.dealScore! < 90).length, profit: missedWithProfit.filter(m => m.dealScore! >= 80 && m.dealScore! < 90).reduce((s, m) => s + m.potentialProfit, 0) },
      { range: '70-79', count: missedWithProfit.filter(m => m.dealScore! >= 70 && m.dealScore! < 80).length, profit: missedWithProfit.filter(m => m.dealScore! >= 70 && m.dealScore! < 80).reduce((s, m) => s + m.potentialProfit, 0) },
      { range: '60-69', count: missedWithProfit.filter(m => m.dealScore! >= 60 && m.dealScore! < 70).length, profit: missedWithProfit.filter(m => m.dealScore! >= 60 && m.dealScore! < 70).reduce((s, m) => s + m.potentialProfit, 0) },
    ].filter(r => r.count > 0);

    // Pattern analysis — why were they missed?
    let pattern = '';
    if (sourceBreakdown.length > 0 && sourceBreakdown[0].count > missedWithProfit.length * 0.5) {
      pattern = `📊 ${sourceBreakdown[0].source} predstavlja ${Math.round((sourceBreakdown[0].count / missedWithProfit.length) * 100)}% zamud — povečaj frekvenco monitorjev za to platformo.`;
    } else if (byScoreRange.length > 0 && byScoreRange[0].range === '90-100') {
      pattern = `🎯 Zamudil si ${byScoreRange[0].count} deal-ov s score 90+ — to so TOP priložnosti. Vklopi Smart Deal Alert za takojšnje obvestilo!`;
    } else {
      pattern = `📈 Zamudil si ${missedWithProfit.length} priložnosti. Preverjaj bolj redno ali povečaj monitor frekvenco.`;
    }

    return NextResponse.json({
      ok: true,
      summary: {
        totalMissed: missedWithProfit.length,
        totalMissedProfitEur: Math.round(totalMissedProfit),
        avgMissedProfitEur: avgMissedProfit,
        highestMissedProfit: Math.max(...missedWithProfit.map(m => m.potentialProfit)),
      },
      missed: missedWithProfit.slice(0, 20),
      sourceBreakdown,
      byScoreRange,
      pattern,
      recommendation: `💡 ${totalMissedProfit > 500 ? '🔴 ZAMUDIL SI ' + Math.round(totalMissedProfit) + '€ potencialnega dobička! ' : ''}Povečaj monitor frekvenco in vklopi Smart Deal Alert za hitrejši odziv.`,
    });
  } catch (err: any) {
    logger.error('/api/analytics/missed-opportunities', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
