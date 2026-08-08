// v7.79: Listing Engagement Analytics — celovita analiza engagement-a
// listingov — track-a views (prek contactStatus kot proxy), bookmarks,
// price drops in time-to-engagement vzorce. Pure DB analytics — NO AI.
// "Engagement rate: 35% (175/500 listingov). Najboljši: elektronika (52%
// engagement). Price drops povečajo engagement +40%."
//
// Razlika od listing-exposure-score (v7.63, ki da EXPOSURE score 0-100 za
// posamezni HELD inventar) — ta je PORTFOLIO analiza engagement-a čez
// vse listinge z byCategory breakdown, trend in price drop analysis.
// Razlika od listing-engagement-predictor (v7.x, AI napoved engagement-a
// za posamezni listing) — ta je descriptivna analiza zgodovine
// engagement-a z engagement levels in time-to-engagement. Razlika od
// buyer-engagement-optimizer (ki optimira buyer engagement) — ta gleda
// LISTING engagement (contact, bookmark, price drop). Razlika od
// buyer-engagement-predictor-v2 (ki napove buyer engagement) — ta gleda
// AKTUALNI listing engagement z rate in trend. Razlika od
// buyer-engagement-scoring-engine (ki score-a buyer engagement) — ta
// analizira LISTING engagement z byCategory in priceDrop analysis.
// Razlika od deal-conversion-funnel-analyzer (v7.78, ki gleda deal
// funnel fazami) — ta gleda ENGAGEMENT signale (contact/bookmark/price
// drop) z engagement levels in trend. Razlika od listing-performance
// (ki gleda performance held inventarja) — ta gleda engagement signale
// vseh listingov z byCategory breakdown in time-to-engagement.
//
// Pure DB analytics (NO AI). GET /api/analytics/listing-engagement-analytics

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type EngagementLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface PortfolioEngagement {
  totalListings: number;
  engagedCount: number;
  highEngagementCount: number;
  mediumEngagementCount: number;
  lowEngagementCount: number;
  noEngagementCount: number;
  avgEngagementScore: number;
  engagementRate: number; // %
  avgDaysToEngagement: number;
}

interface CategoryEngagement {
  category: string;
  totalListings: number;
  engagedCount: number;
  engagementRate: number;
  avgEngagementScore: number;
  avgDaysToEngagement: number;
  rank: number;
}

interface EngagementTrend {
  currentWeekEngagement: number;
  previousWeekEngagement: number;
  trend: Trend;
}

interface PriceDropAnalysis {
  priceDropCount: number;
  avgPriceDropPercent: number;
  engagementAfterPriceDrop: number; // % increase in engagement after price drop
  recommendation: string;
}

interface EngagementRecommendations {
  bestEngagingCategory: string | null;
  worstEngagingCategory: string | null;
  advice: string;
  improvementActions: string[];
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / 86_400_000));
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return round1((part / total) * 100);
}

// Engagement score: contact + bookmark + price drop + image signals
function computeEngagementScore(l: {
  contactStatus: string | null;
  isBookmarked: boolean;
  priceDroppedAt: Date | null | undefined;
  imageUrl: string | null;
}): number {
  const hasContact =
    !!l.contactStatus &&
    l.contactStatus !== 'none' &&
    l.contactStatus.trim().length > 0;
  const hasBookmark = !!l.isBookmarked;
  const hasPriceDrop = !!l.priceDroppedAt;
  const hasImage = !!l.imageUrl;
  return (
    (hasContact ? 40 : 0) +
    (hasBookmark ? 30 : 0) +
    (hasPriceDrop ? 20 : 0) +
    (hasImage ? 10 : 0)
  );
}

function engagementLevel(score: number): EngagementLevel {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 10) return 'LOW';
  return 'NONE';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff90d = new Date(now - 90 * 86_400_000);
    const cutoff28d = new Date(now - 28 * 86_400_000); // last 4 weeks
    const cutoff56d = new Date(now - 56 * 86_400_000); // previous 4 weeks

    // 1) Query all listings from last 90 days (not hidden)
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff90d },
      },
      select: {
        id: true,
        monitor: { select: { source: true } },
        contactStatus: true,
        contactedAt: true,
        firstSeenAt: true,
        isBookmarked: true,
        bookmarkedAt: true,
        priceDroppedAt: true,
        previousPrice: true,
        price: true,
        imageUrl: true,
      },
      take: 200000,
    });

    const totalListings = listings.length;

    // Empty state — no listings
    if (totalListings === 0) {
      return NextResponse.json({
        ok: true,
        portfolio: {
          totalListings: 0,
          engagedCount: 0,
          highEngagementCount: 0,
          mediumEngagementCount: 0,
          lowEngagementCount: 0,
          noEngagementCount: 0,
          avgEngagementScore: 0,
          engagementRate: 0,
          avgDaysToEngagement: 0,
        },
        byCategory: [],
        trend: {
          currentWeekEngagement: 0,
          previousWeekEngagement: 0,
          trend: 'STABLE',
        },
        priceDropAnalysis: {
          priceDropCount: 0,
          avgPriceDropPercent: 0,
          engagementAfterPriceDrop: 0,
          recommendation:
            'Ni listingov v zadnjih 90 dneh — Listing Engagement Analytics ni mogoč.',
        },
        recommendations: {
          bestEngagingCategory: null,
          worstEngagingCategory: null,
          advice:
            'Dodaj listinge (firstSeenAt v zadnjih 90 dneh) za engagement analizo.',
          improvementActions: [],
        },
        message:
          'Ni listingov v zadnjih 90 dneh — Listing Engagement Analytics ni mogoč.',
      });
    }

    // 2) Compute engagement metrics per listing
    interface ListingAgg {
      category: string;
      score: number;
      level: EngagementLevel;
      hasContact: boolean;
      hasBookmark: boolean;
      hasPriceDrop: boolean;
      firstSeenMs: number;
      firstEngagementMs: number; // earliest engagement signal
      daysToEngagement: number;
      hadPriceDrop: boolean;
      priceDropPercent: number; // % reduction if any
      engagedAfterPriceDrop: boolean; // got contact/bookmark AFTER price drop
      firstSeenWeek: number; // ISO week bucket
    }

    const aggs: ListingAgg[] = listings.map((l) => {
      const seenMs = toMs(l.firstSeenAt);
      const contactMs = toMs(l.contactedAt);
      const bookmarkMs = toMs(l.bookmarkedAt);
      const dropMs = toMs(l.priceDroppedAt);

      const hasContact =
        !!l.contactStatus &&
        l.contactStatus !== 'none' &&
        l.contactStatus.trim().length > 0;
      const hasBookmark = !!l.isBookmarked;
      const hasPriceDrop = !!l.priceDroppedAt;

      const score = computeEngagementScore(l);
      const level = engagementLevel(score);

      // First engagement signal = earliest non-zero signal timestamp
      const signals = [hasContact ? contactMs : 0, hasBookmark ? bookmarkMs : 0, hasPriceDrop ? dropMs : 0].filter(
        (v) => v > 0,
      );
      const firstEngagementMs = signals.length > 0 ? Math.min(...signals) : 0;
      const daysToEngagement =
        firstEngagementMs > 0 && seenMs > 0 ? daysBetween(seenMs, firstEngagementMs) : 0;

      // Price drop analysis
      const prevPrice = l.previousPrice ?? 0;
      const currPrice = l.price ?? 0;
      const priceDropPercent =
        hasPriceDrop && prevPrice > 0 && currPrice > 0 && currPrice < prevPrice
          ? round1(((prevPrice - currPrice) / prevPrice) * 100)
          : 0;
      // Did any engagement happen AFTER price drop?
      const engagedAfterPriceDrop =
        hasPriceDrop &&
        dropMs > 0 &&
        ((hasContact && contactMs > dropMs) ||
          (hasBookmark && bookmarkMs > dropMs));

      // ISO week bucket (week starts Monday)
      const weekMs = 7 * 86_400_000;
      const firstSeenWeek = seenMs > 0 ? Math.floor(seenMs / weekMs) : 0;

      const category = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';

      return {
        category,
        score,
        level,
        hasContact,
        hasBookmark,
        hasPriceDrop,
        firstSeenMs: seenMs,
        firstEngagementMs,
        daysToEngagement,
        hadPriceDrop: hasPriceDrop,
        priceDropPercent,
        engagedAfterPriceDrop,
        firstSeenWeek,
      };
    });

    // 3) Portfolio engagement stats
    const engagedCount = aggs.filter((a) => a.score > 0).length;
    const highEngagementCount = aggs.filter((a) => a.level === 'HIGH').length;
    const mediumEngagementCount = aggs.filter((a) => a.level === 'MEDIUM').length;
    const lowEngagementCount = aggs.filter((a) => a.level === 'LOW').length;
    const noEngagementCount = aggs.filter((a) => a.level === 'NONE').length;
    const avgEngagementScore =
      totalListings > 0
        ? round1(aggs.reduce((s, a) => s + a.score, 0) / totalListings)
        : 0;
    const engagementRate = pct(engagedCount, totalListings);
    const engagementTimes = aggs
      .filter((a) => a.daysToEngagement > 0)
      .map((a) => a.daysToEngagement);
    const avgDaysToEngagement =
      engagementTimes.length > 0
        ? round0(engagementTimes.reduce((s, v) => s + v, 0) / engagementTimes.length)
        : 0;

    const portfolio: PortfolioEngagement = {
      totalListings,
      engagedCount,
      highEngagementCount,
      mediumEngagementCount,
      lowEngagementCount,
      noEngagementCount,
      avgEngagementScore,
      engagementRate,
      avgDaysToEngagement,
    };

    // 4) Per-category engagement analysis
    interface CatAgg {
      total: number;
      engaged: number;
      scoreSum: number;
      daysSum: number;
      daysCount: number;
    }
    const catAgg = new Map<string, CatAgg>();
    for (const a of aggs) {
      let c = catAgg.get(a.category);
      if (!c) {
        c = { total: 0, engaged: 0, scoreSum: 0, daysSum: 0, daysCount: 0 };
        catAgg.set(a.category, c);
      }
      c.total += 1;
      if (a.score > 0) c.engaged += 1;
      c.scoreSum += a.score;
      if (a.daysToEngagement > 0) {
        c.daysSum += a.daysToEngagement;
        c.daysCount += 1;
      }
    }

    const byCategory: CategoryEngagement[] = [];
    for (const [category, c] of catAgg.entries()) {
      byCategory.push({
        category,
        totalListings: c.total,
        engagedCount: c.engaged,
        engagementRate: pct(c.engaged, c.total),
        avgEngagementScore: round1(c.scoreSum / c.total),
        avgDaysToEngagement:
          c.daysCount > 0 ? round0(c.daysSum / c.daysCount) : 0,
        rank: 0,
      });
    }
    // Sort by engagementRate desc, then avgEngagementScore desc
    byCategory.sort(
      (a, b) =>
        b.engagementRate - a.engagementRate ||
        b.avgEngagementScore - a.avgEngagementScore,
    );
    byCategory.forEach((c, i) => {
      c.rank = i + 1;
    });

    // 5) Engagement trend (last 4 weeks vs previous 4 weeks)
    const cutoff28dWeek = Math.floor(cutoff28d.getTime() / (7 * 86_400_000));
    const cutoff56dWeek = Math.floor(cutoff56d.getTime() / (7 * 86_400_000));

    const recentAggs = aggs.filter((a) => a.firstSeenWeek >= cutoff28dWeek);
    const previousAggs = aggs.filter(
      (a) => a.firstSeenWeek >= cutoff56dWeek && a.firstSeenWeek < cutoff28dWeek,
    );
    const currentWeekEngagement =
      recentAggs.length > 0
        ? pct(
            recentAggs.filter((a) => a.score > 0).length,
            recentAggs.length,
          )
        : 0;
    const previousWeekEngagement =
      previousAggs.length > 0
        ? pct(
            previousAggs.filter((a) => a.score > 0).length,
            previousAggs.length,
          )
        : 0;

    let trend: Trend = 'STABLE';
    const trendDelta = currentWeekEngagement - previousWeekEngagement;
    if (trendDelta > 5) trend = 'IMPROVING';
    else if (trendDelta < -5) trend = 'DECLINING';

    const trendResult: EngagementTrend = {
      currentWeekEngagement,
      previousWeekEngagement,
      trend,
    };

    // 6) Price drop analysis
    const priceDropListings = aggs.filter((a) => a.hadPriceDrop);
    const priceDropCount = priceDropListings.length;
    const validDrops = priceDropListings.filter((a) => a.priceDropPercent > 0);
    const avgPriceDropPercent =
      validDrops.length > 0
        ? round1(
            validDrops.reduce((s, a) => s + a.priceDropPercent, 0) /
              validDrops.length,
          )
        : 0;

    // Engagement after price drop: % of listings with price drop that had engagement AFTER the drop
    const engagementAfterPriceDrop =
      priceDropCount > 0
        ? pct(
            priceDropListings.filter((a) => a.engagedAfterPriceDrop).length,
            priceDropCount,
          )
        : 0;

    const priceDropAnalysis: PriceDropAnalysis = {
      priceDropCount,
      avgPriceDropPercent,
      engagementAfterPriceDrop,
      recommendation: (() => {
        if (priceDropCount === 0) {
          return 'Ni price drop-ov v zadnjih 90 dneh — razmisli o postopnem zniževanju cen za zastarele listinge.';
        }
        if (engagementAfterPriceDrop >= 40) {
          return `Price drops učinkovito povečujejo engagement (${engagementAfterPriceDrop}% listingov z drop-om je dobilo engagement po znižanju). Nadaljuj z agresivnejšimi drop-i za zastarele listinge.`;
        }
        if (engagementAfterPriceDrop >= 20) {
          return `Price drops zmerno povečujejo engagement (${engagementAfterPriceDrop}%). Večji drop-i (10-15%) bi lahko prinesli več engagement-a.`;
        }
        return `Price drops ne povečujejo dovolj engagement-a (${engagementAfterPriceDrop}%). Premajhni drop-i ali napačen timing — preveri ceno in ponovno objavi.`;
      })(),
    };

    // 7) Recommendations
    const bestCat = byCategory[0] ?? null;
    const worstCat = byCategory[byCategory.length - 1] ?? null;
    const improvementActions: string[] = [];
    if (bestCat && bestCat.engagementRate > 0) {
      improvementActions.push(
        `Fokusiraj se na "${bestCat.category}" (engagement rate ${bestCat.engagementRate}%) — repliciraj strategijo na druge kategorije.`,
      );
    }
    if (worstCat && worstCat.category !== bestCat?.category && worstCat.engagementRate < engagementRate) {
      improvementActions.push(
        `Izboljšaj "${worstCat.category}" (engagement rate ${worstCat.engagementRate}%) — boljše naslove, slike, cene.`,
      );
    }
    if (engagementRate < 30) {
      improvementActions.push(
        `Splošni engagement rate (${engagementRate}%) je nizek — izboljšaj outreach in cene za vse listinge.`,
      );
    }
    if (avgDaysToEngagement > 14) {
      improvementActions.push(
        `Povprečni čas do engagement-a (${avgDaysToEngagement} dni) je visok — pospeši outreach in cenešne prilagoditve.`,
      );
    }
    if (priceDropCount > 0 && engagementAfterPriceDrop < 30) {
      improvementActions.push(
        `Price drops ne generirajo dovolj engagement-a (${engagementAfterPriceDrop}%) — bolj agresivno znižaj zastarele listinge.`,
      );
    }
    if (improvementActions.length === 0) {
      improvementActions.push(
        'Engagement je zdrav — ohrani trenutno strategijo in monitoriraj trend.',
      );
    }

    const recommendations: EngagementRecommendations = {
      bestEngagingCategory: bestCat?.category ?? null,
      worstEngagingCategory:
        worstCat && worstCat.category !== bestCat?.category
          ? worstCat.category
          : null,
      advice: (() => {
        const trendLabel =
          trend === 'IMPROVING'
            ? 'trend engagement-a se izboljšuje'
            : trend === 'DECLINING'
              ? 'trend engagement-a pada'
              : 'trend engagement-a je stabilen';
        return `Engagement rate: ${engagementRate}% (${engagedCount}/${totalListings} listingov). ${trendLabel}. ${
          bestCat ? `Najboljša kategorija: ${bestCat.category} (${bestCat.engagementRate}%).` : ''
        } ${priceDropCount > 0 ? `Price drops povečajo engagement +${engagementAfterPriceDrop}%.` : ''}`;
      })(),
      improvementActions: improvementActions.slice(0, 5),
    };

    return NextResponse.json({
      ok: true,
      portfolio,
      byCategory: byCategory.slice(0, 20),
      trend: trendResult,
      priceDropAnalysis,
      recommendations,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/listing-engagement-analytics',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
