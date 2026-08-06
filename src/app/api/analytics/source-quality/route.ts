// v7.43: Deal Source Quality Score — kateri MONITOR prinaša najboljše deal-e?
//
// "Bolha iPhone monitor finds 3x better deals than Avtonet iPhone monitor"
// → preusmeri trud na boljši monitor, ugasni slabega
//
// GET /api/analytics/source-quality

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const monitors = await db.monitor.findMany({
      select: {
        id: true, name: true, source: true, isActive: true,
        intervalMinutes: true, lastRunAt: true, lastStatus: true,
        consecutiveErrors: true, autoPausedAt: true,
        _count: { select: { listings: true, alerts: true, runLogs: true } },
      },
    });

    if (monitors.length === 0) {
      return NextResponse.json({ ok: true, sources: [], message: 'Ni monitorjev za analizo.' });
    }

    // For each monitor, get listing stats
    const sources: any[] = [];

    for (const m of monitors) {
      const listings = await db.listing.findMany({
        where: { monitorId: m.id, isHidden: false },
        select: {
          aiVerdict: true, aiScore: true, dealScore: true,
          price: true, firstSeenAt: true, contactStatus: true,
          isBookmarked: true,
        },
        take: 500,
      });

      const totalListings = listings.length;
      if (totalListings === 0) {
        sources.push({
          id: m.id, name: m.name, source: m.source, isActive: m.isActive,
          totalListings: 0, score: 0, recommendation: 'Ni oglasov — preveri URL ali dodaj drug monitor.',
        });
        continue;
      }

      // Compute metrics
      const prilikaCount = listings.filter(l => l.aiVerdict === 'PRILIKA').length;
      const sumnjivoCount = listings.filter(l => l.aiVerdict === 'SUMNJIVO').length;
      const avgDealScore = listings.filter(l => l.dealScore != null).reduce((s, l) => s + (l.dealScore ?? 0), 0) / (listings.filter(l => l.dealScore != null).length || 1);
      const highDeals = listings.filter(l => (l.dealScore ?? 0) >= 70).length;
      const contactedCount = listings.filter(l => l.contactStatus !== 'none').length;
      const bookmarkedCount = listings.filter(l => l.isBookmarked).length;

      // Get trades linked to this monitor's listings
      const trades = await db.trade.findMany({
        where: { listing: { monitorId: m.id }, status: 'sold', sellPrice: { not: null } },
        select: { buyPrice: true, sellPrice: true, buyFees: true, sellFees: true },
      });
      const profit = trades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
      const roi = trades.length > 0
        ? Math.round((profit / trades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0)) * 100)
        : 0;

      // Quality score (0-100):
      // 30% deal rate (prilika / total)
      // 25% high deal rate (70+ / total)
      // 20% contact rate (contacted / total — shows actionability)
      // 15% bookmark rate (shows user interest)
      // 10% ROI (if trades exist)
      const dealRate = (prilikaCount / totalListings) * 100;
      const highDealRate = (highDeals / totalListings) * 100;
      const contactRate = (contactedCount / totalListings) * 100;
      const bookmarkRate = (bookmarkedCount / totalListings) * 100;
      const roiScore = Math.min(100, roi);

      const score = Math.round(
        dealRate * 0.30 + highDealRate * 0.25 + contactRate * 0.20 + bookmarkRate * 0.15 + roiScore * 0.10
      );

      // Recommendation
      let recommendation = '';
      if (score >= 70) {
        recommendation = `🟢 ODLIČEN monitor — ${highDeals} top deal-ov, ${contactedCount} kontaktiranih. Povečaj frekvencno na ${Math.max(15, m.intervalMinutes - 10)}min.`;
      } else if (score >= 40) {
        recommendation = `🟡 POVPREČEN — ${highDeals} deal-ov 70+, a nizka konverzija. Preveri filtre (keywords, price range).`;
      } else if (score >= 20) {
        recommendation = `🟠 ŠIBAK — le ${highDeals} top deal-ov iz ${totalListings} oglasov. Razmisli o drugem search URL-ju ali ugaši.`;
      } else {
        recommendation = `🔴 NEUČINKOVIT — skoraj nič deal-ov. Ugasni ali spremeni search URL.`;
      }

      sources.push({
        id: m.id,
        name: m.name,
        source: m.source,
        isActive: m.isActive,
        intervalMinutes: m.intervalMinutes,
        totalListings,
        prilikaCount,
        sumnjivoCount,
        highDealCount: highDeals,
        avgDealScore: Math.round(avgDealScore),
        contactedCount,
        bookmarkedCount,
        soldCount: trades.length,
        totalProfit: Math.round(profit),
        roi,
        score,
        dealRate: Math.round(dealRate),
        highDealRate: Math.round(highDealRate),
        contactRate: Math.round(contactRate),
        lastRunAt: m.lastRunAt,
        lastStatus: m.lastStatus,
        consecutiveErrors: m.consecutiveErrors,
        recommendation,
      });
    }

    // Sort by score descending
    sources.sort((a, b) => b.score - a.score);

    // Summary
    const totalListings = sources.reduce((s, x) => s + x.totalListings, 0);
    const totalDeals = sources.reduce((s, x) => s + x.highDealCount, 0);
    const totalProfit = sources.reduce((s, x) => s + (x.totalProfit || 0), 0);
    const bestSource = sources[0];
    const worstSource = sources[sources.length - 1];

    return NextResponse.json({
      ok: true,
      sources,
      summary: {
        totalMonitors: sources.length,
        activeMonitors: sources.filter(s => s.isActive).length,
        totalListings,
        totalHighDeals: totalDeals,
        totalProfit: Math.round(totalProfit),
        bestSource: bestSource ? { name: bestSource.name, score: bestSource.score, deals: bestSource.highDealCount } : null,
        worstSource: worstSource ? { name: worstSource.name, score: worstSource.score, deals: worstSource.highDealCount } : null,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/source-quality', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
