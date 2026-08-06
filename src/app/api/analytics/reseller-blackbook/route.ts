// v7.44: Reseller Blackbook — sledi prodajalcem ki consistently imajo dobre deal-e.
//
// "Janez123 je objavil 8 prilik v 3 mesecih — 3 smo kupili in zaslužili 150€.
//  Sledi temu prodajalcu!"
//
// Najde prodajalce z največ prilikami, najvišjim deal score-om, največ kontaktov.
// Pomaga najti recurring vire dobrih deal-ov.
//
// GET /api/analytics/reseller-blackbook

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get all listings with sellerName set
    const listings = await db.listing.findMany({
      where: {
        sellerName: { not: null },
        isHidden: false,
      },
      select: {
        id: true, title: true, sellerName: true, price: true,
        aiVerdict: true, aiScore: true, dealScore: true, aiRisk: true,
        aiEstimatedValue: true, firstSeenAt: true, contactStatus: true,
        isBookmarked: true, monitor: { select: { source: true } },
      },
      take: 2000,
      orderBy: { firstSeenAt: 'desc' },
    });

    if (listings.length === 0) {
      return NextResponse.json({ ok: true, sellers: [], message: 'Ni oglasov z imenom prodajalca.' });
    }

    // Group by seller
    const sellerMap = new Map<string, {
      name: string;
      listings: typeof listings;
      prilikaCount: number;
      sumnjivoCount: number;
      highDealCount: number;
      contactedCount: number;
      boughtCount: number;
      avgDealScore: number;
      avgPrice: number;
      totalSavings: number;
      sources: Set<string>;
      firstSeen: Date;
      lastSeen: Date;
    }>();

    for (const l of listings) {
      const seller = l.sellerName!;
      if (!sellerMap.has(seller)) {
        sellerMap.set(seller, {
          name: seller,
          listings: [],
          prilikaCount: 0, sumnjivoCount: 0, highDealCount: 0,
          contactedCount: 0, boughtCount: 0,
          avgDealScore: 0, avgPrice: 0, totalSavings: 0,
          sources: new Set(),
          firstSeen: new Date(l.firstSeenAt), lastSeen: new Date(l.firstSeenAt),
        });
      }
      const s = sellerMap.get(seller)!;
      s.listings.push(l);
      if (l.aiVerdict === 'PRILIKA') s.prilikaCount++;
      if (l.aiVerdict === 'SUMNJIVO') s.sumnjivoCount++;
      if ((l.dealScore ?? 0) >= 70) s.highDealCount++;
      if (l.contactStatus !== 'none') s.contactedCount++;
      if (l.contactStatus === 'closed') s.boughtCount++;
      if (l.monitor?.source) s.sources.add(l.monitor.source);
      if (new Date(l.firstSeenAt) < s.firstSeen) s.firstSeen = new Date(l.firstSeenAt);
      if (new Date(l.firstSeenAt) > s.lastSeen) s.lastSeen = new Date(l.firstSeenAt);
    }

    // Get trades linked to listings with sellerName
    const tradesWithSeller = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        listing: { sellerName: { not: null } },
      },
      select: {
        buyPrice: true, sellPrice: true, buyFees: true, sellFees: true,
        listing: { select: { sellerName: true } },
      },
    });

    // Profit per seller
    const profitBySeller = new Map<string, { count: number; profit: number }>();
    for (const t of tradesWithSeller) {
      const seller = t.listing?.sellerName;
      if (!seller) continue;
      const cur = profitBySeller.get(seller) || { count: 0, profit: 0 };
      cur.count += 1;
      cur.profit += (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
      profitBySeller.set(seller, cur);
    }

    // Compute seller scores + build blackbook
    const sellers = Array.from(sellerMap.values()).map(s => {
      const total = s.listings.length;
      const dealRate = total > 0 ? (s.prilikaCount / total) * 100 : 0;
      const highDealRate = total > 0 ? (s.highDealCount / total) * 100 : 0;
      const contactRate = total > 0 ? (s.contactedCount / total) * 100 : 0;
      const scored = s.listings.filter(l => l.dealScore != null);
      const avgDealScore = scored.length > 0 ? Math.round(scored.reduce((sum, l) => sum + (l.dealScore ?? 0), 0) / scored.length) : 0;
      const priced = s.listings.filter(l => l.price != null && l.price > 0);
      const avgPrice = priced.length > 0 ? Math.round(priced.reduce((sum, l) => sum + (l.price ?? 0), 0) / priced.length) : 0;
      const totalSavings = s.listings.reduce((sum, l) => sum + ((l.aiEstimatedValue ?? 0) - (l.price ?? 0) > 0 ? (l.aiEstimatedValue ?? 0) - (l.price ?? 0) : 0), 0);

      const tradeData = profitBySeller.get(s.name);
      const profit = tradeData?.profit ?? 0;
      const soldCount = tradeData?.count ?? 0;

      // Blackbook score (0-100):
      // 30% deal rate + 25% high deal rate + 20% contact rate + 15% volume + 10% profit
      const volumeScore = Math.min(100, total * 10);
      const profitScore = Math.min(100, Math.abs(profit) / 5);
      const score = Math.round(dealRate * 0.30 + highDealRate * 0.25 + contactRate * 0.20 + volumeScore * 0.15 + profitScore * 0.10);

      // Tier
      let tier: 'gold' | 'silver' | 'bronze' | 'watch' | 'avoid';
      if (score >= 60 && s.prilikaCount >= 3) tier = 'gold';
      else if (score >= 45 && s.prilikaCount >= 2) tier = 'silver';
      else if (score >= 30) tier = 'bronze';
      else if (s.sumnjivoCount > s.prilikaCount) tier = 'avoid';
      else tier = 'watch';

      const daysActive = Math.round((s.lastSeen.getTime() - s.firstSeen.getTime()) / 86400000);

      return {
        name: s.name,
        totalListings: total,
        prilikaCount: s.prilikaCount,
        sumnjivoCount: s.sumnjivoCount,
        highDealCount: s.highDealCount,
        contactedCount: s.contactedCount,
        boughtCount: s.boughtCount,
        soldCount,
        avgDealScore,
        avgPrice,
        totalSavings: Math.round(totalSavings),
        totalProfit: Math.round(profit),
        dealRate: Math.round(dealRate),
        highDealRate: Math.round(highDealRate),
        contactRate: Math.round(contactRate),
        score,
        tier,
        sources: Array.from(s.sources),
        firstSeen: s.firstSeen.toISOString(),
        lastSeen: s.lastSeen.toISOString(),
        daysActive,
        isRecurring: total >= 3 && s.prilikaCount >= 2,
      };
    });

    // Sort by score
    sellers.sort((a, b) => b.score - a.score);

    // Filter: only sellers with at least 1 listing
    const filtered = sellers.filter(s => s.totalListings >= 1);

    // Top tier sellers (blackbook)
    const blackbook = filtered.filter(s => s.tier === 'gold' || s.tier === 'silver');
    const avoid = filtered.filter(s => s.tier === 'avoid');

    return NextResponse.json({
      ok: true,
      totalSellers: filtered.length,
      blackbook: blackbook.slice(0, 10),
      avoid: avoid.slice(0, 5),
      allSellers: filtered.slice(0, 30),
      summary: {
        gold: filtered.filter(s => s.tier === 'gold').length,
        silver: filtered.filter(s => s.tier === 'silver').length,
        bronze: filtered.filter(s => s.tier === 'bronze').length,
        watch: filtered.filter(s => s.tier === 'watch').length,
        avoid: avoid.length,
        recurringSources: filtered.filter(s => s.isRecurring).length,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/reseller-blackbook', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
