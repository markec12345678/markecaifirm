// v7.80: Market Liquidity Analyzer — meri kako "likvidna" je vsaka kategorija
// — kako hitro lahko inventar pretvoriš v gotovino? Kombinira sell-through
// rate, povprečne dni na trgu, stabilnost cen in volume. Pure DB analytics.
// "Elektronika: HIGHLY_LIQUID (85/100, 14d cash conversion). Avto:
// ILLIQUID (25/100, 65d). Najboljši za quick cash: elektronika."
//
// Razlika od market-depth-analyzer (v7.68, ki gleda market depth bid/ask) —
// ta gleda LIKVIDNOST kategorij z 5-metričnim score-om in cash conversion
// time. Razlika od market-sentiment-pulse (v7.75, ki gleda sentiment) — ta
// gleda LIKVIDNOST (how fast you can sell). Razlika od market-momentum (ki
// gleda BULLISH/BEARISH) — ta gleda CASH CONVERTIBILITY per kategorija.
// Razlika od market-cycle-detector (v7.77, ki detektira cycle faze) — ta
// gleda LIKVIDNOST 0-100 z 5-level klasifikacijo. Razlika od
// listing-engagement-analytics (v7.79, ki gleda engagement listingov) —
// ta gleda LIKVIDNOST kategorij z cash conversion time. Razlika od
// deal-pipeline-forecaster (v7.76, ki napove pipeline faze) — ta gleda
// AKTUALNO likvidnost per kategorija z rank. Razlika od
// inventory-turnover-forecast (v7.78, ki napove turnover rate) — ta
// analizira LIKVIDNOST KATEGORIJ z 5 dimenzijami in cash conversion time.
// Razlika from cash-flow-velocity (ki gleda cash velocity portfelja) —
// ta gleda LIKVIDNOST KATEGORIJ na trgu (sell-through, price stability).
//
// Pure DB analytics (NO AI). GET /api/analytics/market-liquidity-analyzer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type LiquidityClass =
  | 'HIGHLY_LIQUID'
  | 'LIQUID'
  | 'MODERATE'
  | 'ILLIQUID'
  | 'HIGHLY_ILLIQUID';
type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface LiquidityMetrics {
  sellThroughRate: number; // %
  avgDaysToList: number;
  priceStabilityIndex: number; // 0-100
  volumeIndex: number; // 0-100
  demandIndex: number; // 0-100
}

interface CategoryLiquidity {
  category: string;
  liquidityScore: number; // 0-100
  classification: LiquidityClass;
  metrics: LiquidityMetrics;
  cashConversionTime: number; // estimated days to convert to cash
  liquidityRank: number; // 1 = most liquid
}

interface LiquidityTrend {
  currentAvgLiquidity: number;
  previousAvgLiquidity: number;
  trend: Trend;
}

interface LiquiditySummary {
  totalCategories: number;
  highlyLiquidCount: number;
  illiquidCount: number;
  bestCategory: string | null;
  worstCategory: string | null;
  avgCashConversionTime: number;
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

// Standard deviation of prices in a category
function stdDev(prices: number[]): number {
  if (prices.length === 0) return 0;
  const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
  const variance =
    prices.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / prices.length;
  return Math.sqrt(variance);
}

function mean(prices: number[]): number {
  if (prices.length === 0) return 0;
  return prices.reduce((s, v) => s + v, 0) / prices.length;
}

// Classify liquidity based on score 0-100
function classifyLiquidity(score: number): LiquidityClass {
  if (score >= 80) return 'HIGHLY_LIQUID';
  if (score >= 60) return 'LIQUID';
  if (score >= 40) return 'MODERATE';
  if (score >= 20) return 'ILLIQUID';
  return 'HIGHLY_ILLIQUID';
}

// Normalize a value to 0-100 based on min/max across categories
function normalize(
  value: number,
  min: number,
  max: number,
): number {
  if (max <= min) return 50;
  return clamp0_100(round1(((value - min) / (max - min)) * 100));
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff90d = new Date(now - 90 * 86_400_000);
    const cutoff28d = new Date(now - 28 * 86_400_000); // last 4 weeks
    const cutoff56d = new Date(now - 56 * 86_400_000); // previous 4 weeks

    // 1) Query all listings from last 90 days
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        firstSeenAt: { gte: cutoff90d },
      },
      select: {
        id: true,
        monitor: { select: { source: true } },
        price: true,
        previousPrice: true,
        firstSeenAt: true,
        priceDroppedAt: true,
        isBookmarked: true,
        bookmarkedAt: true,
        contactStatus: true,
        contactedAt: true,
      },
      take: 200000,
    });

    const totalListings = listings.length;

    // Empty state
    if (totalListings === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        trend: {
          currentAvgLiquidity: 0,
          previousAvgLiquidity: 0,
          trend: 'STABLE',
        },
        summary: {
          totalCategories: 0,
          highlyLiquidCount: 0,
          illiquidCount: 0,
          bestCategory: null,
          worstCategory: null,
          avgCashConversionTime: 0,
          advice:
            'Ni listingov v zadnjih 90 dneh — Market Liquidity Analyzer ni mogoč.',
        },
        message:
          'Ni listingov v zadnjih 90 dneh — Market Liquidity Analyzer ni mogoč.',
      });
    }

    // 2) Aggregate per category
    interface CatAgg {
      category: string;
      total: number;
      engaged: number; // bookmarked + contacted
      prices: number[];
      daysListed: number[]; // days from firstSeen to now (or sale)
      firstSeenMsList: number[];
      // For trend: split by week bucket
      weekBuckets: Map<number, { total: number; engaged: number }>;
    }
    const catAgg = new Map<string, CatAgg>();
    const weekMs = 7 * 86_400_000;

    for (const l of listings) {
      const category =
        (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      const seenMs = toMs(l.firstSeenAt);
      const daysListed = seenMs > 0 ? daysBetween(seenMs, now) : 0;
      const price = l.price ?? 0;
      const hasEngagement =
        (!!l.isBookmarked) ||
        (!!l.contactStatus && l.contactStatus !== 'none');

      const weekBucket = seenMs > 0 ? Math.floor(seenMs / weekMs) : 0;

      let c = catAgg.get(category);
      if (!c) {
        c = {
          category,
          total: 0,
          engaged: 0,
          prices: [],
          daysListed: [],
          firstSeenMsList: [],
          weekBuckets: new Map(),
        };
        catAgg.set(category, c);
      }
      c.total += 1;
      if (hasEngagement) c.engaged += 1;
      if (price > 0) c.prices.push(price);
      if (daysListed > 0) c.daysListed.push(daysListed);
      if (seenMs > 0) c.firstSeenMsList.push(seenMs);

      let wb = c.weekBuckets.get(weekBucket);
      if (!wb) {
        wb = { total: 0, engaged: 0 };
        c.weekBuckets.set(weekBucket, wb);
      }
      wb.total += 1;
      if (hasEngagement) wb.engaged += 1;
    }

    if (catAgg.size === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        trend: {
          currentAvgLiquidity: 0,
          previousAvgLiquidity: 0,
          trend: 'STABLE',
        },
        summary: {
          totalCategories: 0,
          highlyLiquidCount: 0,
          illiquidCount: 0,
          bestCategory: null,
          worstCategory: null,
          avgCashConversionTime: 0,
          advice: 'Ni kategorij za likvidnostno analizo.',
        },
      });
    }

    // 3) Compute raw metrics per category
    interface RawMetrics {
      category: string;
      sellThroughRate: number;
      avgDaysToList: number;
      priceStabilityIndex: number;
      volume: number;
      demandScore: number;
    }
    const rawMetrics: RawMetrics[] = [];
    for (const c of catAgg.values()) {
      const sellThroughRate = pct(c.engaged, c.total);
      const avgDaysToList =
        c.daysListed.length > 0
          ? round0(c.daysListed.reduce((s, v) => s + v, 0) / c.daysListed.length)
          : 0;
      // Price stability index = 100 - (CV × 100), CV = stddev/mean
      let priceStabilityIndex = 50; // default
      const prices = c.prices;
      if (prices.length > 1) {
        const m = mean(prices);
        const sd = stdDev(prices);
        if (m > 0) {
          const cv = sd / m; // coefficient of variation
          priceStabilityIndex = clamp0_100(round1(100 - cv * 100));
        }
      } else if (prices.length === 1) {
        priceStabilityIndex = 80; // single listing — assume stable
      }
      const volume = c.total;
      const demandScore = c.engaged; // absolute demand

      rawMetrics.push({
        category: c.category,
        sellThroughRate,
        avgDaysToList,
        priceStabilityIndex,
        volume,
        demandScore,
      });
    }

    // 4) Normalize across categories (0-100) for volume and demand
    const maxVolume = Math.max(...rawMetrics.map((m) => m.volume), 1);
    const maxDemand = Math.max(...rawMetrics.map((m) => m.demandScore), 1);
    const minDaysToList = Math.min(
      ...rawMetrics.map((m) => m.avgDaysToList),
      0,
    );
    const maxDaysToList = Math.max(...rawMetrics.map((m) => m.avgDaysToList), 1);

    // 5) Compute liquidity score per category
    // 30% sellThroughRate + 25% (100 - avgDaysToList norm) + 20% priceStability + 15% volumeIndex + 10% demandIndex
    const categories: CategoryLiquidity[] = rawMetrics.map((m) => {
      // sellThroughRate already 0-100
      const sellThroughScore = clamp0_100(m.sellThroughRate);
      // DaysToList inverted & normalized (lower days = higher score)
      const daysScore =
        maxDaysToList > minDaysToList
          ? clamp0_100(
              100 - ((m.avgDaysToList - minDaysToList) / (maxDaysToList - minDaysToList)) * 100,
            )
          : 50;
      const priceStabilityScore = clamp0_100(m.priceStabilityIndex);
      const volumeIndex = normalize(m.volume, 1, maxVolume);
      const demandIndex = normalize(m.demandScore, 0, maxDemand);

      const liquidityScore = round1(
        sellThroughScore * 0.30 +
          daysScore * 0.25 +
          priceStabilityScore * 0.20 +
          volumeIndex * 0.15 +
          demandIndex * 0.10,
      );

      const classification = classifyLiquidity(liquidityScore);

      // Cash conversion time = avgDaysToList (lower = faster cash)
      // Bounded to a minimum of 1 day
      const cashConversionTime = Math.max(1, m.avgDaysToList);

      const metrics: LiquidityMetrics = {
        sellThroughRate: m.sellThroughRate,
        avgDaysToList: m.avgDaysToList,
        priceStabilityIndex: round1(m.priceStabilityIndex),
        volumeIndex: round1(volumeIndex),
        demandIndex: round1(demandIndex),
      };

      return {
        category: m.category,
        liquidityScore,
        classification,
        metrics,
        cashConversionTime,
        liquidityRank: 0, // assigned after sort
      };
    });

    // Sort by liquidityScore desc and assign rank
    categories.sort((a, b) => b.liquidityScore - a.liquidityScore);
    categories.forEach((c, i) => {
      c.liquidityRank = i + 1;
    });

    // 6) Trend (last 4 weeks vs previous 4 weeks)
    const currentWeeks = new Map<string, number>(); // category -> avg liquidity (approx by engagement rate)
    const previousWeeks = new Map<string, number>();
    const currentEngagementRates: number[] = [];
    const previousEngagementRates: number[] = [];

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
      if (curTotal > 0) {
        currentEngagementRates.push(curRate);
        currentWeeks.set(c.category, curRate);
      }
      if (prevTotal > 0) {
        previousEngagementRates.push(prevRate);
        previousWeeks.set(c.category, prevRate);
      }
    }

    const currentAvgLiquidity =
      currentEngagementRates.length > 0
        ? round1(
            currentEngagementRates.reduce((s, v) => s + v, 0) /
              currentEngagementRates.length,
          )
        : 0;
    const previousAvgLiquidity =
      previousEngagementRates.length > 0
        ? round1(
            previousEngagementRates.reduce((s, v) => s + v, 0) /
              previousEngagementRates.length,
          )
        : 0;

    let trend: Trend = 'STABLE';
    const trendDelta = currentAvgLiquidity - previousAvgLiquidity;
    if (trendDelta > 5) trend = 'IMPROVING';
    else if (trendDelta < -5) trend = 'DECLINING';

    // 7) Summary
    const highlyLiquidCount = categories.filter(
      (c) =>
        c.classification === 'HIGHLY_LIQUID' || c.classification === 'LIQUID',
    ).length;
    const illiquidCount = categories.filter(
      (c) =>
        c.classification === 'ILLIQUID' ||
        c.classification === 'HIGHLY_ILLIQUID',
    ).length;
    const bestCategory = categories[0]?.category ?? null;
    const worstCategory = categories[categories.length - 1]?.category ?? null;
    const avgCashConversionTime =
      categories.length > 0
        ? round0(
            categories.reduce((s, c) => s + c.cashConversionTime, 0) /
              categories.length,
          )
        : 0;

    const trendLabel =
      trend === 'IMPROVING'
        ? `trend likvidnosti se IZBOLJŠUJE (+${Math.abs(trendDelta).toFixed(1)}%)`
        : trend === 'DECLINING'
          ? `trend likvidnosti PADA (${trendDelta.toFixed(1)}%)`
          : 'trend likvidnosti je stabilen';

    const advice = (() => {
      const best = categories[0];
      const worst = categories[categories.length - 1];
      const parts: string[] = [];
      parts.push(
        `Likvidnost ${categories.length} kategorij: povprečno ${avgCashConversionTime} dni cash conversion. ${trendLabel}.`,
      );
      if (best) {
        parts.push(
          `Najbolj likvidna: ${best.category} (${best.classification}, ${best.liquidityScore}/100, ${best.cashConversionTime}d).`,
        );
      }
      if (worst && worst.category !== best?.category) {
        parts.push(
          `Najmanj likvidna: ${worst.category} (${worst.classification}, ${worst.liquidityScore}/100, ${worst.cashConversionTime}d).`,
        );
      }
      if (highlyLiquidCount > 0) {
        parts.push(
          `Za quick cash: fokusiraj na ${highlyLiquidCount} likvidnih kategorij.`,
        );
      }
      if (illiquidCount > 0) {
        parts.push(
          `${illiquidCount} kategorij je illikvidnih — izogibaj se dolgih hold time-ov.`,
        );
      }
      return parts.join(' ');
    })();

    const summary: LiquiditySummary = {
      totalCategories: categories.length,
      highlyLiquidCount,
      illiquidCount,
      bestCategory,
      worstCategory,
      avgCashConversionTime,
      advice,
    };

    return NextResponse.json({
      ok: true,
      categories: categories.slice(0, 50), // top 50 by liquidity
      trend: {
        currentAvgLiquidity,
        previousAvgLiquidity,
        trend,
      },
      summary,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-liquidity-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
