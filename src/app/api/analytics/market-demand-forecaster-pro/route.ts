// v7.81: Market Demand Forecaster Pro — napredno demand forecasting ki
// kombinira več demand signalov (searches, bookmarks, contacts, sell-through,
// velocity) v celovit demand index 0-100 per kategorija. "Elektronika:
// VERY_HIGH demand (88/100, RISING). Tight market (ratio 1.8). Buy
// aggressively. Moda: LOW demand (25)."
//
// Razlika od demand-forecast (ki napove demand za posamezno kategorijo) —
// ta kombinatorično združi 5 signalov (search/bookmark/contact/sell-through/
// velocity) v demand INDEX 0-100 z demand level classification in demand-
// supply ratio. Razlika od demand-forecast-v6 (v6.12) — ta da COMPOSITE
// demand index z demand direction in market tightness per kategorija.
// Razlika od inventory-demand-forecaster (ki napove demand za inventar) — ta
// gleda MARKET demand čez vse kategorije z 5-signals. Razlika od
// supply-demand-balance (v7.68, ki gleda balance) — ta da demand INDEX 0-100
// per kategorija z demand direction in market tightness. Razlika od
// market-liquidity-analyzer (v7.80, ki gleda likvidnost) — ta gleda DEMAND
// (interest signals) z demand forecast 30d in momentum. Razlika od
// market-sentiment-pulse (v7.75, ki gleda sentiment) — ta gleda KVANTITATIVNE
// demand signale z composite index in rank. Razlika od market-momentum (ki
// gleda BULLISH/BEARISH) — ta da DEMAND SCORE per kategorija z direction.
// Razlika from market-trend-forecaster-pro (v7.78, ki napove tržne trende) —
// ta gleda CURRENT demand z 5 signals in demand-supply ratio.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-demand-forecaster-pro

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type DemandLevel =
  | 'VERY_HIGH'
  | 'HIGH'
  | 'MODERATE'
  | 'LOW'
  | 'VERY_LOW';
type DemandDirection = 'RISING' | 'STABLE' | 'FALLING';
type MarketTightness = 'TIGHT' | 'BALANCED' | 'LOOSE';
type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface DemandSignals {
  searchDemandScore: number; // 0-100 normalized
  bookmarkDemandScore: number;
  contactDemandScore: number;
  sellThroughDemandScore: number;
  velocityDemandScore: number;
}

interface DemandForecast {
  projectedDemand30d: number;
  demandDirection: DemandDirection;
  demandMomentum: number;
}

interface CategoryDemand {
  category: string;
  demandIndex: number; // 0-100 composite
  demandLevel: DemandLevel;
  signals: DemandSignals;
  forecast: DemandForecast;
  demandSupplyRatio: number;
  marketTightness: MarketTightness;
  demandRank: number; // 1 = highest demand
}

interface DemandTrend {
  currentAvgDemand: number;
  previousAvgDemand: number;
  trend: Trend;
}

interface DemandSummary {
  totalCategories: number;
  veryHighDemandCount: number;
  lowDemandCount: number;
  bestDemandCategory: string | null;
  tightestMarket: string | null;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
}

function clamp0_100(v: number): number {
  return Math.max(0, Math.min(100, v));
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

// Normalize a value to 0-100 based on min/max across categories
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return clamp0_100(round1(((value - min) / (max - min)) * 100));
}

function classifyDemandLevel(score: number): DemandLevel {
  if (score >= 80) return 'VERY_HIGH';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  if (score >= 20) return 'LOW';
  return 'VERY_LOW';
}

function classifyTightness(ratio: number): MarketTightness {
  // ratio > 1.3 = TIGHT (demand > supply), < 0.7 = LOOSE, else BALANCED
  if (ratio >= 1.3) return 'TIGHT';
  if (ratio <= 0.7) return 'LOOSE';
  return 'BALANCED';
}

function classifyDirection(momentum: number): DemandDirection {
  if (momentum > 5) return 'RISING';
  if (momentum < -5) return 'FALLING';
  return 'STABLE';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff90d = new Date(now - 90 * 86_400_000);
    const cutoff28d = new Date(now - 28 * 86_400_000); // last 4 weeks
    const cutoff56d = new Date(now - 56 * 86_400_000); // previous 4 weeks

    // 1) Query listings from last 90 days
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff90d },
      },
      select: {
        id: true,
        monitor: { select: { source: true } },
        firstSeenAt: true,
        isBookmarked: true,
        bookmarkedAt: true,
        contactStatus: true,
        contactedAt: true,
        // For sell-through proxy: listings that became SOLD trades
        // We approximate sell-through by engagement (bookmarked OR contacted)
        // since direct sale status requires Trade relation. Plus priceDroppedAt
        // as additional demand signal (price drops indicate stale demand).
        priceDroppedAt: true,
      },
      take: 200000,
    });

    // Also query SOLD trades to compute real sell-through rate per category
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff90d },
      },
      select: {
        category: true,
        listingId: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'desc' },
      take: 100000,
    });

    const totalListings = listings.length;

    // Empty state
    if (totalListings === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        trend: {
          currentAvgDemand: 0,
          previousAvgDemand: 0,
          trend: 'STABLE',
        },
        summary: {
          totalCategories: 0,
          veryHighDemandCount: 0,
          lowDemandCount: 0,
          bestDemandCategory: null,
          tightestMarket: null,
          advice:
            'Ni listingov v zadnjih 90 dneh — Market Demand Forecaster Pro ni mogoč.',
        },
        message:
          'Ni listingov v zadnjih 90 dneh — Market Demand Forecaster Pro ni mogoč.',
      });
    }

    // 2) Aggregate per category
    interface CatAgg {
      category: string;
      total: number;
      bookmarked: number;
      contacted: number;
      engaged: number; // bookmarked OR contacted
      // For velocity: average days from firstSeenAt to first engagement
      firstEngagementDaysList: number[];
      // For trend (week buckets)
      weekBuckets: Map<number, { total: number; engaged: number }>;
      // For sell-through: count of listings that became SOLD trades
      soldCount: number;
    }
    const catAgg = new Map<string, CatAgg>();
    const weekMs = 7 * 86_400_000;

    // Set of listingIds that became SOLD (for sell-through)
    const soldListingIds = new Set<string>();
    // Also map category -> set of listingIds (for category-based sell-through
    // when trade.listingId is null but trade.category matches)
    const soldByCategory = new Map<string, number>();

    for (const t of soldTrades) {
      if (t.listingId) soldListingIds.add(t.listingId);
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      soldByCategory.set(cat, (soldByCategory.get(cat) ?? 0) + 1);
    }

    // Build a set of listing.id → category for sell-through join
    const listingIdToCat = new Map<string, string>();
    for (const l of listings) {
      const cat = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      listingIdToCat.set(l.id, cat);
    }

    for (const l of listings) {
      const category =
        (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      const seenMs = toMs(l.firstSeenAt);
      const isBookmarked = !!l.isBookmarked;
      const isContacted =
        !!l.contactStatus && l.contactStatus !== 'none';
      const hasEngagement = isBookmarked || isContacted;

      // Days to first engagement (earliest of bookmarkedAt or contactedAt)
      const bookmarkedMs = toMs(l.bookmarkedAt);
      const contactedMs = toMs(l.contactedAt);
      const firstEngMs =
        bookmarkedMs > 0 && contactedMs > 0
          ? Math.min(bookmarkedMs, contactedMs)
          : bookmarkedMs > 0
            ? bookmarkedMs
            : contactedMs > 0
              ? contactedMs
              : 0;
      const firstEngDays =
        firstEngMs > 0 && seenMs > 0 ? daysBetween(seenMs, firstEngMs) : 0;

      const weekBucket = seenMs > 0 ? Math.floor(seenMs / weekMs) : 0;

      let c = catAgg.get(category);
      if (!c) {
        c = {
          category,
          total: 0,
          bookmarked: 0,
          contacted: 0,
          engaged: 0,
          firstEngagementDaysList: [],
          weekBuckets: new Map(),
          soldCount: 0,
        };
        catAgg.set(category, c);
      }
      c.total += 1;
      if (isBookmarked) c.bookmarked += 1;
      if (isContacted) c.contacted += 1;
      if (hasEngagement) c.engaged += 1;
      if (firstEngDays > 0) c.firstEngagementDaysList.push(firstEngDays);

      // Count sold listings
      if (soldListingIds.has(l.id)) {
        c.soldCount += 1;
      }

      let wb = c.weekBuckets.get(weekBucket);
      if (!wb) {
        wb = { total: 0, engaged: 0 };
        c.weekBuckets.set(weekBucket, wb);
      }
      wb.total += 1;
      if (hasEngagement) wb.engaged += 1;
    }

    // For categories where listingId was null on Trade but category matched,
    // add the sold-by-category count (best-effort — distribute by ratio if
    // multiple listings in same category exist).
    // Note: we already count sold listings via soldListingIds intersection.
    // For trades with null listingId but category set, we add a proportional
    // adjustment to the category's soldCount based on the trade's category.
    for (const [cat, count] of soldByCategory.entries()) {
      const c = catAgg.get(cat);
      if (!c) continue;
      // We've already counted via listingId intersection. Estimate the
      // remaining trades with no listing link by assuming they distribute
      // proportionally to listings in this category.
      const alreadyCountedViaListing = c.soldCount;
      const unlinked = Math.max(0, count - alreadyCountedViaListing);
      c.soldCount += unlinked;
    }

    if (catAgg.size === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        trend: {
          currentAvgDemand: 0,
          previousAvgDemand: 0,
          trend: 'STABLE',
        },
        summary: {
          totalCategories: 0,
          veryHighDemandCount: 0,
          lowDemandCount: 0,
          bestDemandCategory: null,
          tightestMarket: null,
          advice: 'Ni kategorij za demand analizo.',
        },
      });
    }

    // 3) Compute raw demand signals per category
    interface RawSignals {
      category: string;
      searchDemandRaw: number; // total listings
      bookmarkDemandRaw: number; // bookmarked count
      contactDemandRaw: number; // contacted count
      sellThroughDemandRaw: number; // % sold
      velocityDemandRaw: number; // avg days to first engagement (lower = better)
      total: number;
      engaged: number;
      soldCount: number;
    }
    const rawSignals: RawSignals[] = [];
    for (const c of catAgg.values()) {
      const sellThrough = pct(c.soldCount, c.total);
      const avgVelocityDays =
        c.firstEngagementDaysList.length > 0
          ? round1(
              c.firstEngagementDaysList.reduce((s, v) => s + v, 0) /
                c.firstEngagementDaysList.length,
            )
          : 0; // 0 means no engagement at all
      rawSignals.push({
        category: c.category,
        searchDemandRaw: c.total,
        bookmarkDemandRaw: c.bookmarked,
        contactDemandRaw: c.contacted,
        sellThroughDemandRaw: sellThrough,
        velocityDemandRaw: avgVelocityDays,
        total: c.total,
        engaged: c.engaged,
        soldCount: c.soldCount,
      });
    }

    // 4) Normalize raw signals across categories (0-100)
    const maxSearch = Math.max(...rawSignals.map((r) => r.searchDemandRaw), 1);
    const maxBookmark = Math.max(
      ...rawSignals.map((r) => r.bookmarkDemandRaw),
      1,
    );
    const maxContact = Math.max(
      ...rawSignals.map((r) => r.contactDemandRaw),
      1,
    );
    const maxSellThrough = Math.max(
      ...rawSignals.map((r) => r.sellThroughDemandRaw),
      1,
    );

    // Velocity: lower days = higher score. Use 0 days = no engagement = 0 score.
    // For engaged categories, normalize inverse days: 0 days = 100, 30+ days = 0
    const maxVelocityDays = Math.max(
      ...rawSignals
        .filter((r) => r.velocityDemandRaw > 0)
        .map((r) => r.velocityDemandRaw),
      1,
    );

    // 5) Compute composite demand index per category
    // 25% sellThrough + 25% contact + 20% bookmark + 15% search + 15% velocity
    const categories: CategoryDemand[] = rawSignals.map((r) => {
      const searchScore = normalize(r.searchDemandRaw, 1, maxSearch);
      const bookmarkScore = normalize(r.bookmarkDemandRaw, 0, maxBookmark);
      const contactScore = normalize(r.contactDemandRaw, 0, maxContact);
      const sellThroughScore = clamp0_100(r.sellThroughDemandRaw);
      // Velocity score: 0 days (no engagement) = 0, 1 day = 100, max = 0
      const velocityScore =
        r.velocityDemandRaw > 0
          ? clamp0_100(
              100 - (r.velocityDemandRaw / maxVelocityDays) * 100,
            )
          : 0;

      const demandIndex = round1(
        sellThroughScore * 0.25 +
          contactScore * 0.25 +
          bookmarkScore * 0.20 +
          searchScore * 0.15 +
          velocityScore * 0.15,
      );

      const demandLevel = classifyDemandLevel(demandIndex);

      // Demand-supply ratio = (engaged + sold) / total — higher = demand > supply
      // Actually: demand signals / listing count. We use engaged/total as the
      // ratio of demand to supply (since each listing represents one "supply").
      const demandSignals = r.engaged + r.soldCount;
      const demandSupplyRatio =
        r.total > 0 ? round1(demandSignals / r.total) : 0;
      const marketTightness = classifyTightness(demandSupplyRatio);

      return {
        category: r.category,
        demandIndex,
        demandLevel,
        signals: {
          searchDemandScore: round1(searchScore),
          bookmarkDemandScore: round1(bookmarkScore),
          contactDemandScore: round1(contactScore),
          sellThroughDemandScore: round1(sellThroughScore),
          velocityDemandScore: round1(velocityScore),
        },
        forecast: {
          projectedDemand30d: 0, // computed below
          demandDirection: 'STABLE',
          demandMomentum: 0,
        },
        demandSupplyRatio,
        marketTightness,
        demandRank: 0, // assigned after sort
      };
    });

    // 6) Compute forecast per category (based on weekly engagement rate trend)
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const agg = catAgg.get(cat.category);
      if (!agg) continue;

      // Current 4 weeks vs previous 4 weeks engagement rate
      let curTotal = 0;
      let curEngaged = 0;
      let prevTotal = 0;
      let prevEngaged = 0;
      for (const [weekBucket, wb] of agg.weekBuckets.entries()) {
        const weekStartMs = weekBucket * weekMs;
        if (weekStartMs >= cutoff28d.getTime()) {
          curTotal += wb.total;
          curEngaged += wb.engaged;
        } else if (
          weekStartMs >= cutoff56d.getTime() &&
          weekStartMs < cutoff28d.getTime()
        ) {
          prevTotal += wb.total;
          prevEngaged += wb.engaged;
        }
      }
      const curRate = curTotal > 0 ? (curEngaged / curTotal) * 100 : 0;
      const prevRate = prevTotal > 0 ? (prevEngaged / prevTotal) * 100 : 0;
      const momentum = round1(curRate - prevRate);
      const direction = classifyDirection(momentum);

      // Projected demand 30d = current demand index * (1 + momentum/100)
      const projected30d = clamp0_100(
        round1(cat.demandIndex * (1 + momentum / 100)),
      );

      cat.forecast = {
        projectedDemand30d: projected30d,
        demandDirection: direction,
        demandMomentum: momentum,
      };
    }

    // 7) Sort by demand index desc and assign rank
    categories.sort((a, b) => b.demandIndex - a.demandIndex);
    categories.forEach((c, i) => {
      c.demandRank = i + 1;
    });

    // 8) Trend (avg demand last 4 weeks vs previous 4 weeks)
    const currentDemandIndices: number[] = [];
    const previousDemandIndices: number[] = [];
    for (const c of catAgg.values()) {
      let curTotal = 0;
      let curEngaged = 0;
      let prevTotal = 0;
      let prevEngaged = 0;
      for (const [weekBucket, wb] of c.weekBuckets.entries()) {
        const weekStartMs = weekBucket * weekMs;
        if (weekStartMs >= cutoff28d.getTime()) {
          curTotal += wb.total;
          curEngaged += wb.engaged;
        } else if (
          weekStartMs >= cutoff56d.getTime() &&
          weekStartMs < cutoff28d.getTime()
        ) {
          prevTotal += wb.total;
          prevEngaged += wb.engaged;
        }
      }
      const curRate = curTotal > 0 ? (curEngaged / curTotal) * 100 : 0;
      const prevRate = prevTotal > 0 ? (prevEngaged / prevTotal) * 100 : 0;
      if (curTotal > 0) currentDemandIndices.push(curRate);
      if (prevTotal > 0) previousDemandIndices.push(prevRate);
    }

    const currentAvgDemand =
      currentDemandIndices.length > 0
        ? round1(
            currentDemandIndices.reduce((s, v) => s + v, 0) /
              currentDemandIndices.length,
          )
        : 0;
    const previousAvgDemand =
      previousDemandIndices.length > 0
        ? round1(
            previousDemandIndices.reduce((s, v) => s + v, 0) /
              previousDemandIndices.length,
          )
        : 0;

    let trend: Trend = 'STABLE';
    const trendDelta = currentAvgDemand - previousAvgDemand;
    if (trendDelta > 5) trend = 'IMPROVING';
    else if (trendDelta < -5) trend = 'DECLINING';

    // 9) Summary
    const veryHighDemandCount = categories.filter(
      (c) => c.demandLevel === 'VERY_HIGH' || c.demandLevel === 'HIGH',
    ).length;
    const lowDemandCount = categories.filter(
      (c) => c.demandLevel === 'LOW' || c.demandLevel === 'VERY_LOW',
    ).length;
    const bestDemandCategory = categories[0]?.category ?? null;
    // Tightest market = highest demandSupplyRatio
    const tightest = categories
      .slice()
      .sort((a, b) => b.demandSupplyRatio - a.demandSupplyRatio)[0];
    const tightestMarket = tightest?.category ?? null;

    const trendLabel =
      trend === 'IMPROVING'
        ? `povpraševanje RASTE (+${Math.abs(trendDelta).toFixed(1)}%)`
        : trend === 'DECLINING'
          ? `povpraševanje PADA (${trendDelta.toFixed(1)}%)`
          : 'povpraševanje stabilno';

    const advice = (() => {
      const parts: string[] = [];
      const best = categories[0];
      const worst = categories[categories.length - 1];
      parts.push(
        `Demand analiza ${categories.length} kategorij. ${trendLabel}.`,
      );
      if (best) {
        parts.push(
          `Najvišji demand: ${best.category} (${best.demandLevel}, ${best.demandIndex}/100, ${best.forecast.demandDirection}).`,
        );
      }
      if (tightest && tightest.category !== best?.category) {
        parts.push(
          `Najbolj tight market: ${tightest.category} (ratio ${tightest.demandSupplyRatio}, ${tightest.marketTightness}) — kupuj agresivno.`,
        );
      }
      if (worst && worst.category !== best?.category) {
        parts.push(
          `Najnižji demand: ${worst.category} (${worst.demandLevel}, ${worst.demandIndex}/100).`,
        );
      }
      if (veryHighDemandCount > 0) {
        parts.push(
          `${veryHighDemandCount} kategorij s HIGH/VERY_HIGH demand — fokusiraj tukaj.`,
        );
      }
      if (lowDemandCount > 0) {
        parts.push(
          `${lowDemandCount} kategorij z LOW/VERY_LOW demand — zmanjšaj nabavo.`,
        );
      }
      return parts.join(' ');
    })();

    const summary: DemandSummary = {
      totalCategories: categories.length,
      veryHighDemandCount,
      lowDemandCount,
      bestDemandCategory,
      tightestMarket,
      advice,
    };

    return NextResponse.json({
      ok: true,
      categories: categories.slice(0, 50), // top 50 by demand
      trend: {
        currentAvgDemand,
        previousAvgDemand,
        trend,
      },
      summary,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-demand-forecaster-pro',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
