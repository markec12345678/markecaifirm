// v7.62: Market Momentum Indicator — real-time market momentum score
// (BULLISH / BEARISH / NEUTRAL) baziran na listing velocity, price trend in
// deal frequency v zadnjih 7 dneh v primerjavi s prejšnjimi 7 dnevi.
//
// "Market momentum: 72/100 BULLISH — listings +15%, prices +8%, več priložnosti. BUY"
//
// Pure DB analytics (NO AI). GET /api/analytics/market-momentum

import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Classification = 'BULLISH' | 'NEUTRAL' | 'BEARISH';

interface WindowMetrics {
  totalListings: number;
  avgPrice: number;
  prilikaCount: number;
  avgDealScore: number;
  soldCount: number;
}

interface SourceBreakdown {
  source: string;
  displayName: string;
  momentumScore: number;
  classification: Classification;
  listingCount: number;
  avgPrice: number;
}

const SOURCE_DISPLAY: Record<string, string> = {
  bolha: 'Bolha',
  vinted: 'Vinted',
  facebook: 'Facebook Marketplace',
  'mobile-de': 'mobile.de',
  mobilede: 'mobile.de',
  'mobile.de': 'mobile.de',
  kleinanzeigen: 'Kleinanzeigen',
  avtonet: 'Avtonet',
  nepremicnine: 'Nepremicnine.net',
  salomon: 'Salomon',
  subito: 'Subito',
  willhaben: 'Willhaben',
  'custom-rss': 'Custom RSS',
  unknown: 'Neznan vir',
};

function classifyScore(score: number): Classification {
  if (score > 60) return 'BULLISH';
  if (score < 40) return 'BEARISH';
  return 'NEUTRAL';
}

function displayName(source: string): string {
  return SOURCE_DISPLAY[source] || source.charAt(0).toUpperCase() + source.slice(1);
}

export async function GET(_req: NextRequest) {
  try {
    const now = Date.now();
    const weekMs = 7 * 86_400_000;
    const currentWeekStart = new Date(now - weekMs);
    const previousWeekStart = new Date(now - 2 * weekMs);

    // 1) Listings from last 14 days, split into two 7-day windows
    const [currentWeekListings, previousWeekListings] = await Promise.all([
      db.listing.findMany({
        where: {
          firstSeenAt: { gte: currentWeekStart },
          isHidden: false,
        },
        select: {
          id: true,
          price: true,
          aiVerdict: true,
          dealScore: true,
          monitor: { select: { source: true } },
        },
        take: 5000,
      }),
      db.listing.findMany({
        where: {
          firstSeenAt: { gte: previousWeekStart, lt: currentWeekStart },
          isHidden: false,
        },
        select: {
          id: true,
          price: true,
          aiVerdict: true,
          dealScore: true,
          monitor: { select: { source: true } },
        },
        take: 5000,
      }),
    ]);

    // 2) Sold trades per window
    const [soldCurrentWeek, soldPreviousWeek] = await Promise.all([
      db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: { gte: currentWeekStart, not: null },
        },
        select: { id: true },
      }),
      db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: { gte: previousWeekStart, lt: currentWeekStart, not: null },
        },
        select: { id: true },
      }),
    ]);

    // 3) Compute per-window metrics
    function computeWindow(
      listings: typeof currentWeekListings,
      soldCount: number,
    ): WindowMetrics {
      const totalListings = listings.length;
      const pricedListings = listings.filter(l => l.price != null && l.price > 0);
      const avgPrice =
        pricedListings.length > 0
          ? Math.round(
              pricedListings.reduce((s, l) => s + (l.price ?? 0), 0) / pricedListings.length,
            )
          : 0;
      const prilikaListings = listings.filter(l => l.aiVerdict === 'PRILIKA');
      const prilikaCount = prilikaListings.length;
      const dealScoreValues = prilikaListings
        .map(l => l.dealScore)
        .filter((v): v is number => v != null);
      const avgDealScore =
        dealScoreValues.length > 0
          ? Math.round(
              dealScoreValues.reduce((s, v) => s + v, 0) / dealScoreValues.length,
            )
          : 0;
      return { totalListings, avgPrice, prilikaCount, avgDealScore, soldCount };
    }

    const currentWeek = computeWindow(currentWeekListings, soldCurrentWeek.length);
    const previousWeek = computeWindow(previousWeekListings, soldPreviousWeek.length);

    // 4) Compute momentum indicators (% changes)
    const listingVelocityChange =
      previousWeek.totalListings > 0
        ? Math.round(
            ((currentWeek.totalListings - previousWeek.totalListings) /
              previousWeek.totalListings) *
              100,
          )
        : 0;
    const priceTrend =
      previousWeek.avgPrice > 0
        ? Math.round(
            ((currentWeek.avgPrice - previousWeek.avgPrice) / previousWeek.avgPrice) * 100,
          )
        : 0;
    const dealQualityChange = Math.round(
      currentWeek.avgDealScore - previousWeek.avgDealScore,
    );
    const opportunityChange =
      previousWeek.prilikaCount > 0
        ? Math.round(
            ((currentWeek.prilikaCount - previousWeek.prilikaCount) /
              previousWeek.prilikaCount) *
              100,
          )
        : 0;

    // 5) Compute overall momentum score (0-100)
    let momentumScore = 50; // baseline neutral
    if (listingVelocityChange > 10) momentumScore += 30;
    else if (listingVelocityChange > 0) momentumScore += 15;
    else if (listingVelocityChange < -10) momentumScore -= 20;
    else if (listingVelocityChange < 0) momentumScore -= 10;

    if (priceTrend > 5) momentumScore += 20;
    else if (priceTrend > 0) momentumScore += 10;
    else if (priceTrend < -5) momentumScore -= 15;
    else if (priceTrend < 0) momentumScore -= 8;

    if (dealQualityChange > 0) momentumScore += 20;
    else if (dealQualityChange < 0) momentumScore -= 15;

    if (opportunityChange > 20) momentumScore += 30;
    else if (opportunityChange > 0) momentumScore += 15;
    else if (opportunityChange < -20) momentumScore -= 25;
    else if (opportunityChange < 0) momentumScore -= 12;

    momentumScore = Math.max(0, Math.min(100, momentumScore));
    const classification = classifyScore(momentumScore);

    // Build summary string
    const summaryParts: string[] = [];
    summaryParts.push(`Momentum ${momentumScore}/100 (${classification})`);
    if (listingVelocityChange !== 0) {
      summaryParts.push(
        `listings ${listingVelocityChange > 0 ? '+' : ''}${listingVelocityChange}%`,
      );
    }
    if (priceTrend !== 0) {
      summaryParts.push(`cena ${priceTrend > 0 ? '+' : ''}${priceTrend}%`);
    }
    if (opportunityChange !== 0) {
      summaryParts.push(
        `priložnosti ${opportunityChange > 0 ? '+' : ''}${opportunityChange}%`,
      );
    }
    const summary = summaryParts.join(' • ');

    // 6) Per-source breakdown (Bolha vs Vinted vs Facebook vs ...)
    const sourceMap = new Map<
      string,
      { listings: number; total: number; pricedCount: number; prilikaCount: number }
    >();
    for (const l of currentWeekListings) {
      const src = (l.monitor?.source || 'unknown').toLowerCase();
      const cur =
        sourceMap.get(src) || { listings: 0, total: 0, pricedCount: 0, prilikaCount: 0 };
      cur.listings += 1;
      if (l.price != null && l.price > 0) {
        cur.total += l.price;
        cur.pricedCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') cur.prilikaCount += 1;
      sourceMap.set(src, cur);
    }

    const perSource: SourceBreakdown[] = Array.from(sourceMap.entries()).map(
      ([source, d]) => {
        // Per-source momentum: combine opportunity density + listing velocity proxy
        const opportunityDensity =
          d.listings > 0 ? (d.prilikaCount / d.listings) * 100 : 0;
        const sourceScore = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              30 + // baseline
                Math.min(40, d.listings / 5) + // volume factor (max 40 at 200+ listings)
                Math.min(30, opportunityDensity * 1.5), // opportunity factor
            ),
          ),
        );
        return {
          source,
          displayName: displayName(source),
          momentumScore: sourceScore,
          classification: classifyScore(sourceScore),
          listingCount: d.listings,
          avgPrice: d.pricedCount > 0 ? Math.round(d.total / d.pricedCount) : 0,
        };
      },
    );
    perSource.sort((a, b) => b.listingCount - a.listingCount);

    // 7) Recommendation
    let action: 'BUY_AGGRESSIVELY' | 'BUY_NORMAL' | 'HOLD' | 'SELL_FAST';
    let reasoning: string;
    if (classification === 'BULLISH') {
      // Bullish → prices rising. If we can still find PRILIKA → buy aggressively.
      if (currentWeek.prilikaCount >= 3) {
        action = 'BUY_AGGRESSIVELY';
        reasoning = `Trg je BULLISH (${momentumScore}/100). Cene rastejo (+${priceTrend}%), a ${currentWeek.prilikaCount} priložnosti je še vedno na voljo — kupuj hitro preden cene še bolj narastejo.`;
      } else {
        action = 'SELL_FAST';
        reasoning = `Trg je BULLISH (${momentumScore}/100) s ${priceTrend > 0 ? '+' : ''}${priceTrend}% rastjo cen, a priložnosti se redčijo (le ${currentWeek.prilikaCount}). Prodi inventar drago zdaj, preden trg obrne.`;
      }
    } else if (classification === 'BEARISH') {
      // Bearish → prices falling. BUY_NORMAL (cheap to acquire) but be careful with selling.
      if (currentWeek.prilikaCount >= 3) {
        action = 'BUY_NORMAL';
        reasoning = `Trg je BEARISH (${momentumScore}/100). Cene padajo (${priceTrend}%), a ${currentWeek.prilikaCount} priložnosti nakazuje poceni nakup — kupuj normalno, prodaj počasi.`;
      } else {
        action = 'HOLD';
        reasoning = `Trg je BEARISH (${momentumScore}/100) — cene padajo (${priceTrend}%) in priložnosti je malo (${currentWeek.prilikaCount}). Zadrži inventar dokler trg ne obrne.`;
      }
    } else {
      // Neutral
      action = 'BUY_NORMAL';
      reasoning = `Trg je NEVTRAL (${momentumScore}/100). Listing velocity ${listingVelocityChange > 0 ? '+' : ''}${listingVelocityChange}%, cena ${priceTrend > 0 ? '+' : ''}${priceTrend}%. Običajni tempo nakupov in prodaj.`;
    }

    return NextResponse.json({
      ok: true,
      overall: {
        momentumScore,
        classification,
        summary,
      },
      indicators: {
        listingVelocityChange,
        priceTrend,
        dealQualityChange,
        opportunityChange,
      },
      windows: {
        currentWeek,
        previousWeek,
      },
      perSource,
      recommendation: {
        action,
        reasoning,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/market-momentum', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
