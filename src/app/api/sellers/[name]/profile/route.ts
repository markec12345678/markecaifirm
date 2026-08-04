// v7.34: Seller Intelligence — comprehensive seller profile for buy decisions.
//
// GET /api/sellers/:name/profile
// Returns: { ok, seller: { name, totalListings, avgPrice, categories, locations,
//   aiVerdictBreakdown, riskScore, reputationTier, firstSeenAt, lastSeenAt,
//   priceRange, listingFrequency, recommendation } }
//
// Helps answer: "Should I trust this seller? Are they a flipper or a legit seller?"

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const sellerName = decodeURIComponent(name);

    if (!sellerName || sellerName === 'null' || sellerName === 'undefined') {
      return NextResponse.json({ error: 'Ime prodajalca je obvezno' }, { status: 400 });
    }

    // Fetch all listings by this seller
    const listings = await db.listing.findMany({
      where: { sellerName: sellerName },
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        location: true,
        aiVerdict: true,
        aiScore: true,
        aiRisk: true,
        aiImageVerdict: true,
        firstSeenAt: true,
        isBookmarked: true,
        isHidden: true,
        monitor: { select: { source: true } },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 500,
    });

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        seller: {
          name: sellerName,
          totalListings: 0,
          message: 'Ni oglasov za tega prodajalca. Morda ime ni pravilno ekstrahirano iz oglasa.',
        },
      });
    }

    // === Compute seller metrics ===

    const totalListings = listings.length;
    const pricedListings = listings.filter(l => l.price != null && l.price > 0);
    const prices = pricedListings.map(l => l.price!);
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : null;
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

    // Categories breakdown
    const categoryMap = new Map<string, number>();
    for (const l of listings) {
      const cat = l.monitor?.source || 'neznan';
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }
    const categories = Array.from(categoryMap.entries())
      .map(([source, count]) => ({ source, count, pct: Math.round((count / totalListings) * 100) }))
      .sort((a, b) => b.count - a.count);

    // Locations
    const locationMap = new Map<string, number>();
    for (const l of listings) {
      if (l.location) {
        locationMap.set(l.location, (locationMap.get(l.location) || 0) + 1);
      }
    }
    const locations = Array.from(locationMap.entries())
      .map(([loc, count]) => ({ location: loc, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // AI verdict breakdown
    const verdictMap = new Map<string, number>();
    for (const l of listings) {
      const v = l.aiVerdict || 'NEOCENJENO';
      verdictMap.set(v, (verdictMap.get(v) || 0) + 1);
    }
    const aiVerdictBreakdown = Array.from(verdictMap.entries())
      .map(([verdict, count]) => ({ verdict, count, pct: Math.round((count / totalListings) * 100) }))
      .sort((a, b) => b.count - a.count);

    // Image verdict breakdown (AUTHENTIC / SUSPICIOUS / STOCK_PHOTO)
    const imageVerdictMap = new Map<string, number>();
    for (const l of listings) {
      if (l.aiImageVerdict) {
        imageVerdictMap.set(l.aiImageVerdict, (imageVerdictMap.get(l.aiImageVerdict) || 0) + 1);
      }
    }
    const imageVerdictBreakdown = Array.from(imageVerdictMap.entries())
      .map(([verdict, count]) => ({ verdict, count }))
      .sort((a, b) => b.count - a.count);

    // Time range
    const firstSeenAt = listings[listings.length - 1]?.firstSeenAt;
    const lastSeenAt = listings[0]?.firstSeenAt;
    const daysActive = firstSeenAt
      ? Math.max(1, Math.round((new Date(lastSeenAt!).getTime() - new Date(firstSeenAt).getTime()) / 86400000))
      : 0;
    const listingFrequency = daysActive > 0 ? Math.round((totalListings / daysActive) * 10) / 10 : 0;

    // === Risk Score (0-100, lower = safer) ===
    let riskScore = 50; // neutral start

    // High PRILIKA ratio = suspicious (too good to be true)
    const prilikaCount = aiVerdictBreakdown.find(v => v.verdict === 'PRILIKA')?.count ?? 0;
    const prilikaPct = (prilikaCount / totalListings) * 100;
    if (prilikaPct > 60) riskScore += 20; // 60%+ "deals" = red flag
    else if (prilikaPct > 30) riskScore += 10;

    // High SUMNJIVO ratio = bad sign
    const sumnjivoCount = aiVerdictBreakdown.find(v => v.verdict === 'SUMNJIVO')?.count ?? 0;
    const sumnjivoPct = (sumnjivoCount / totalListings) * 100;
    if (sumnjivoPct > 40) riskScore += 25;
    else if (sumnjivoPct > 20) riskScore += 10;

    // SUSPICIOUS images = stock photos, possible scam
    const suspiciousImages = imageVerdictBreakdown.find(v => v.verdict === 'SUSPICIOUS')?.count ?? 0;
    const stockPhotos = imageVerdictBreakdown.find(v => v.verdict === 'STOCK_PHOTO')?.count ?? 0;
    if ((suspiciousImages + stockPhotos) > 3) riskScore += 20;
    else if ((suspiciousImages + stockPhotos) > 0) riskScore += 10;

    // Very high listing frequency = likely a flipper/dealer (not necessarily bad, but different)
    if (listingFrequency > 5) riskScore -= 5; // active seller = more data = lower risk
    else if (totalListings < 3) riskScore += 15; // too few listings = unknown seller

    // AUTHENTIC images = good sign
    const authenticImages = imageVerdictBreakdown.find(v => v.verdict === 'AUTHENTIC')?.count ?? 0;
    if (authenticImages > 3) riskScore -= 15;

    // Clamp 0-100
    riskScore = Math.max(0, Math.min(100, riskScore));

    // Reputation tier
    let reputationTier: string;
    let tierColor: string;
    if (riskScore < 20) { reputationTier = 'Zaupanja vreden'; tierColor = 'green'; }
    else if (riskScore < 40) { reputationTier = 'Verjetno OK'; tierColor = 'lime'; }
    else if (riskScore < 60) { reputationTier = 'Neznano'; tierColor = 'amber'; }
    else if (riskScore < 80) { reputationTier = 'Sumljiv'; tierColor = 'orange'; }
    else { reputationTier = 'Rizičen'; tierColor = 'red'; }

    // Recommendation
    let recommendation = '';
    if (riskScore < 20) {
      recommendation = `✅ ${sellerName} je zaupanja vreden prodajalec (${totalListings} oglasov, ${daysActive}d aktivnosti). Avtentične slike, nizko tveganje. Varna kupčija.`;
    } else if (riskScore < 40) {
      recommendation = `🟢 ${sellerName} je verjetno zanesljiv. Preveri specifični oglas — a prodajalec ima ${totalListings} oglasov z dobrim razmerjem priložnosti.`;
    } else if (riskScore < 60) {
      recommendation = `🟡 ${sellerName} je nepoznan (${totalListings} oglasov). Ni dovolj podatkov za oceno. Preveri osebno, povprašaj za več fotografij.`;
    } else if (riskScore < 80) {
      recommendation = `⚠️ ${sellerName} je sumljiv. ${sumnjivoCount} od ${totalListings} oglasov je AI označil kot sumljivih. Bodisi previden — preveri telefon/priimek.`;
    } else {
      recommendation = `🔴 ${sellerName} je RIZIČEN. Visoko razmerje sumljivih oglasov ali stock fotografij. Priporočljivo plačilo preko varne storitve (PayPal) ali osebni prevzem.`;
    }

    return NextResponse.json({
      ok: true,
      seller: {
        name: sellerName,
        totalListings,
        avgPrice,
        minPrice,
        maxPrice,
        categories,
        locations,
        aiVerdictBreakdown,
        imageVerdictBreakdown,
        firstSeenAt,
        lastSeenAt,
        daysActive,
        listingFrequency,
        riskScore,
        reputationTier,
        tierColor,
        prilikaCount,
        sumnjivoCount,
        authenticImages,
        suspiciousImages: suspiciousImages + stockPhotos,
        recommendation,
      },
    });
  } catch (err) {
    logger.error('/api/sellers/[name]/profile', 'GET handler failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
