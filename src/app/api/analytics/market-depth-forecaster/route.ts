// v7.84: Market Depth Forecaster — projicira tržno GLOBINO 30/60/90 dni v
// prihodnost — ali bo trg postal globlji (bolj likviden) ali plitvejši
// (tanjši)? Pure DB analytics — NO AI. "Market depth: 65/100 (MEDIUM).
// Forecast: SHALLOWING v 60d (-8). Elektronika deepening (+12). Avto
// shallowing (-15)."
//
// Razlika od market-depth-analyzer (v7.68, ki meri CURRENT depth in
// liquidity) — ta FORECAST-a future depth 30/60/90 dni z listingCountTrend
// in sellThroughRateTrend. Razlika od market-cycle-forecaster (v7.83, ki
// projicira 4-fazne cikle) — ta gleda DEPTH/GLOBINO specifično z
// listingCountAcceleration in depthVolatility. Razlika od
// market-saturation-forecaster (ki forecast-a saturacijo) — ta gleda DEPTH
// (koliko oglasov, kako porazdeljeni) ne saturacijo. Razlika od
// market-trend-momentum (ki gleda ACCELERATION cen) — ta gleda
// listingCountTrend + sellThroughRateTrend za depth projekcijo.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-depth-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type Liquidity = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
type DepthDirection = 'DEEPENING' | 'STABLE' | 'SHALLOWING';

interface CurrentDepth {
  depthScore: number; // 0-100
  liquidity: Liquidity;
  listingCount: number;
  avgPriceStability: number; // 0-100
}

interface DepthForecast {
  projectedDepth30d: number;
  projectedDepth60d: number;
  projectedDepth90d: number;
  depthDirection: DepthDirection;
  depthMomentum: number; // acceleration of depth change
  projectedLiquidity30d: string;
  projectedLiquidity60d: string;
  projectedLiquidity90d: string;
}

interface CategoryDepthForecast {
  category: string;
  currentDepth: number;
  projectedDepth30d: number;
  projectedDepth90d: number;
  depthDirection: DepthDirection;
  listingCountTrend: number;
}

interface HistoricalDepth {
  deepestWeek: { week: string; depth: number } | null;
  shallowestWeek: { week: string; depth: number } | null;
  depthVolatility: number;
}

interface DepthRecommendations {
  bestDeepeningCategory: string | null;
  shallowingCategories: string[];
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_180D = 180 * DAY_MS;
const MIN_WEEKS_FOR_FORECAST = 6;

// --- Helpers -------------------------------------------------------------

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// 2nd derivative — acceleration
function acceleration(values: number[]): number {
  if (values.length < 3) return 0;
  const firstSlope = trendSlope(values.slice(0, Math.ceil(values.length / 2)));
  const secondSlope = trendSlope(values.slice(Math.floor(values.length / 2)));
  return secondSlope - firstSlope;
}

// ISO week starts Monday
function isoWeekStart(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1; // shift to Mon=0
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset),
  );
  return start.getTime();
}

function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

function assessLiquidity(depthScore: number): Liquidity {
  if (depthScore >= 70) return 'HIGH';
  if (depthScore >= 45) return 'MEDIUM';
  if (depthScore >= 25) return 'LOW';
  return 'VERY_LOW';
}

function classifyDirection(
  slope: number,
  threshold: number,
): DepthDirection {
  if (slope > threshold) return 'DEEPENING';
  if (slope < -threshold) return 'SHALLOWING';
  return 'STABLE';
}

// depthScore 0-100 from listing count + price stability
function computeDepthScore(
  totalListings: number,
  priceStability: number,
): number {
  // Listing count component: max 50 at >=50 listings
  let countScore: number;
  if (totalListings >= 50) countScore = 50;
  else if (totalListings >= 30) countScore = 40;
  else if (totalListings >= 20) countScore = 30;
  else if (totalListings >= 10) countScore = 20;
  else if (totalListings >= 5) countScore = 10;
  else countScore = 5;
  // Price stability: 0-50 component
  const stabilityScore = Math.max(0, Math.min(50, priceStability * 0.5));
  return round0(Math.max(0, Math.min(100, countScore + stabilityScore)));
}

// --- Weekly aggregation --------------------------------------------------

interface WeekAgg {
  weekMs: number;
  weekKey: string;
  totalListings: number;
  pricedListings: number;
  sumPrice: number;
  // For sell-through: listings with aiVerdict = 'PRILIKA' (proxy for "active demand")
  prilikaCount: number;
}

function emptyWeekAgg(weekMs: number): WeekAgg {
  return {
    weekMs,
    weekKey: isoWeekKey(weekMs),
    totalListings: 0,
    pricedListings: 0,
    sumPrice: 0,
    prilikaCount: 0,
  };
}

// Per-week price stability: 1 - stdDev/mean × 100 (clamped 0-100)
function weeklyPriceStability(a: WeekAgg): number {
  if (a.pricedListings < 2) return 50; // neutral when insufficient data
  const mean = a.sumPrice / a.pricedListings;
  if (mean <= 0) return 0;
  // Use per-listing price data via DB aggregate (would need raw prices).
  // Approximate: stability inversely proportional to count vs priced ratio.
  // Better: compute per-listing stdDev at query time — see handler.
  return 50;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff = new Date(now - HORIZON_180D);

    // 1) Query listings from last 180 days for depth analysis
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        price: true,
        firstSeenAt: true,
        aiVerdict: true,
        monitor: { select: { source: true } },
      },
      take: 200000,
    });

    const emptyResponse = {
      ok: true,
      current: {
        depthScore: 0,
        liquidity: 'VERY_LOW' as Liquidity,
        listingCount: 0,
        avgPriceStability: 0,
      },
      forecast: {
        projectedDepth30d: 0,
        projectedDepth60d: 0,
        projectedDepth90d: 0,
        depthDirection: 'STABLE' as DepthDirection,
        depthMomentum: 0,
        projectedLiquidity30d: 'VERY_LOW',
        projectedLiquidity60d: 'VERY_LOW',
        projectedLiquidity90d: 'VERY_LOW',
      },
      byCategory: [] as CategoryDepthForecast[],
      historical: {
        deepestWeek: null as { week: string; depth: number } | null,
        shallowestWeek: null as { week: string; depth: number } | null,
        depthVolatility: 0,
      },
      recommendations: {
        bestDeepeningCategory: null,
        shallowingCategories: [] as string[],
        advice:
          'Ni listing-ov v zadnjih 180 dneh — Market Depth Forecaster ni mogoč.',
      },
      message:
        'Ni listing-ov v zadnjih 180 dneh — Market Depth Forecaster ni mogoč.',
    };

    if (listings.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 2) Build weekly aggregates — overall + per-source (category)
    interface ListingRow {
      price: number | null;
      firstSeenAt: Date;
      aiVerdict: string | null;
      monitor: { source: string | null } | null;
    }

    const overallByWeek = new Map<number, WeekAgg>();
    // For price stability we need per-week price arrays (not just sum)
    const overallWeekPrices = new Map<number, number[]>();
    const perSourceByWeek = new Map<string, Map<number, WeekAgg>>();
    const perSourceWeekPrices = new Map<string, Map<number, number[]>>();

    for (const l of listings as ListingRow[]) {
      const firstSeenMs = new Date(
        l.firstSeenAt as unknown as Date | string,
      ).getTime();
      if (!Number.isFinite(firstSeenMs)) continue;
      const weekMs = isoWeekStart(firstSeenMs);

      // Overall
      let oAgg = overallByWeek.get(weekMs);
      if (!oAgg) {
        oAgg = emptyWeekAgg(weekMs);
        overallByWeek.set(weekMs, oAgg);
      }
      oAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        oAgg.pricedListings += 1;
        oAgg.sumPrice += l.price;
        let prices = overallWeekPrices.get(weekMs);
        if (!prices) {
          prices = [];
          overallWeekPrices.set(weekMs, prices);
        }
        prices.push(l.price);
      }
      if (l.aiVerdict === 'PRILIKA') oAgg.prilikaCount += 1;

      // Per source
      const source =
        (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      let srcMap = perSourceByWeek.get(source);
      if (!srcMap) {
        srcMap = new Map<number, WeekAgg>();
        perSourceByWeek.set(source, srcMap);
      }
      let sAgg = srcMap.get(weekMs);
      if (!sAgg) {
        sAgg = emptyWeekAgg(weekMs);
        srcMap.set(weekMs, sAgg);
      }
      sAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        sAgg.pricedListings += 1;
        sAgg.sumPrice += l.price;
        let srcPricesMap = perSourceWeekPrices.get(source);
        if (!srcPricesMap) {
          srcPricesMap = new Map<number, number[]>();
          perSourceWeekPrices.set(source, srcPricesMap);
        }
        let prices = srcPricesMap.get(weekMs);
        if (!prices) {
          prices = [];
          srcPricesMap.set(weekMs, prices);
        }
        prices.push(l.price);
      }
      if (l.aiVerdict === 'PRILIKA') sAgg.prilikaCount += 1;
    }

    const sortedWeekKeys = Array.from(overallByWeek.keys()).sort(
      (a, b) => a - b,
    );

    if (sortedWeekKeys.length < MIN_WEEKS_FOR_FORECAST) {
      return NextResponse.json({
        ok: true,
        current: {
          depthScore: 0,
          liquidity: 'VERY_LOW' as Liquidity,
          listingCount: listings.length,
          avgPriceStability: 0,
        },
        forecast: {
          projectedDepth30d: 0,
          projectedDepth60d: 0,
          projectedDepth90d: 0,
          depthDirection: 'STABLE' as DepthDirection,
          depthMomentum: 0,
          projectedLiquidity30d: 'VERY_LOW',
          projectedLiquidity60d: 'VERY_LOW',
          projectedLiquidity90d: 'VERY_LOW',
        },
        byCategory: [] as CategoryDepthForecast[],
        historical: {
          deepestWeek: null as { week: string; depth: number } | null,
          shallowestWeek: null as { week: string; depth: number } | null,
          depthVolatility: 0,
        },
        recommendations: {
          bestDeepeningCategory: null,
          shallowingCategories: [] as string[],
          advice: `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — zberi vsaj ${MIN_WEEKS_FOR_FORECAST} tednov za zanesljiv depth forecast.`,
        },
        message: `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — Market Depth Forecaster ni zanesljiv.`,
      });
    }

    // 3) Compute per-week depth (overall)
    interface WeekDepthEntry {
      weekMs: number;
      weekKey: string;
      listingCount: number;
      pricedListings: number;
      priceStability: number; // 0-100
      sellThroughRate: number; // % prilika
      depthScore: number; // 0-100
    }
    const weekDepths: WeekDepthEntry[] = [];
    for (const wk of sortedWeekKeys) {
      const a = overallByWeek.get(wk)!;
      const prices = overallWeekPrices.get(wk) ?? [];
      let priceStability = 50;
      if (prices.length >= 2) {
        const mean = avg(prices);
        if (mean > 0) {
          const cv = stdDev(prices) / mean; // coefficient of variation
          // Stability = 100 - cv × 100 (clamped 0-100). cv 0 = stable, cv > 1 = unstable.
          priceStability = round0(
            Math.max(0, Math.min(100, 100 - cv * 100)),
          );
        }
      } else if (prices.length === 1) {
        priceStability = 80; // single price = stable but limited info
      }
      const sellThroughRate =
        a.totalListings > 0
          ? round1((a.prilikaCount / a.totalListings) * 100)
          : 0;
      const depthScore = computeDepthScore(a.totalListings, priceStability);
      weekDepths.push({
        weekMs: wk,
        weekKey: a.weekKey,
        listingCount: a.totalListings,
        pricedListings: a.pricedListings,
        priceStability,
        sellThroughRate,
        depthScore,
      });
    }

    // 4) Current depth = last week's depth
    const lastWeek = weekDepths[weekDepths.length - 1]!;
    const listingCountTrend = round2(trendSlope(weekDepths.map((w) => w.listingCount)));
    const sellThroughTrend = round2(trendSlope(weekDepths.map((w) => w.sellThroughRate)));
    const listingCountAcceleration = round2(acceleration(weekDepths.map((w) => w.listingCount)));

    // 5) Forecast future depth
    // Projected depth = current + (listingCountTrend × N weeks) translated to depth score change
    // Listing count contribution to depth: 1 listing ≈ 1 unit on count score scale (max 50)
    // Translate: depth change per week = trend × (1/50) × 100 = trend × 2
    const depthChangePerWeek = listingCountTrend * 2;
    const projectedDepth30d = round0(
      Math.max(0, Math.min(100, lastWeek.depthScore + depthChangePerWeek * 4)),
    );
    const projectedDepth60d = round0(
      Math.max(0, Math.min(100, lastWeek.depthScore + depthChangePerWeek * 8)),
    );
    const projectedDepth90d = round0(
      Math.max(0, Math.min(100, lastWeek.depthScore + depthChangePerWeek * 13)),
    );

    const depthDirection = classifyDirection(depthChangePerWeek, 0.5);
    const depthMomentum = round2(listingCountAcceleration * 2);

    const projectedLiquidity30d = assessLiquidity(projectedDepth30d);
    const projectedLiquidity60d = assessLiquidity(projectedDepth60d);
    const projectedLiquidity90d = assessLiquidity(projectedDepth90d);

    // 6) Per-category depth forecast
    const byCategory: CategoryDepthForecast[] = [];
    for (const [source, srcMap] of perSourceByWeek.entries()) {
      const sortedWeeksSrc = Array.from(srcMap.keys()).sort((a, b) => a - b);
      if (sortedWeeksSrc.length < 3) continue;
      const srcPricesMap = perSourceWeekPrices.get(source);
      const srcWeekDepths: WeekDepthEntry[] = [];
      for (const wk of sortedWeeksSrc) {
        const a = srcMap.get(wk)!;
        const prices = srcPricesMap?.get(wk) ?? [];
        let priceStability = 50;
        if (prices.length >= 2) {
          const mean = avg(prices);
          if (mean > 0) {
            const cv = stdDev(prices) / mean;
            priceStability = round0(
              Math.max(0, Math.min(100, 100 - cv * 100)),
            );
          }
        }
        const depthScore = computeDepthScore(a.totalListings, priceStability);
        srcWeekDepths.push({
          weekMs: wk,
          weekKey: a.weekKey,
          listingCount: a.totalListings,
          pricedListings: a.pricedListings,
          priceStability,
          sellThroughRate:
            a.totalListings > 0
              ? round1((a.prilikaCount / a.totalListings) * 100)
              : 0,
          depthScore,
        });
      }
      const catLast = srcWeekDepths[srcWeekDepths.length - 1]!;
      const catListingTrend = round2(
        trendSlope(srcWeekDepths.map((w) => w.listingCount)),
      );
      const catDepthChangePerWeek = catListingTrend * 2;
      const catDepth30 = round0(
        Math.max(0, Math.min(100, catLast.depthScore + catDepthChangePerWeek * 4)),
      );
      const catDepth90 = round0(
        Math.max(0, Math.min(100, catLast.depthScore + catDepthChangePerWeek * 13)),
      );
      byCategory.push({
        category: source,
        currentDepth: catLast.depthScore,
        projectedDepth30d: catDepth30,
        projectedDepth90d: catDepth90,
        depthDirection: classifyDirection(catDepthChangePerWeek, 0.5),
        listingCountTrend: catListingTrend,
      });
    }
    byCategory.sort((a, b) => b.projectedDepth90d - a.projectedDepth90d);

    // 7) Historical depth analysis
    let deepestWeek: { week: string; depth: number } | null = null;
    let shallowestWeek: { week: string; depth: number } | null = null;
    for (const w of weekDepths) {
      if (!deepestWeek || w.depthScore > deepestWeek.depth) {
        deepestWeek = { week: w.weekKey, depth: w.depthScore };
      }
      if (!shallowestWeek || w.depthScore < shallowestWeek.depth) {
        shallowestWeek = { week: w.weekKey, depth: w.depthScore };
      }
    }
    const depthVolatility = round1(stdDev(weekDepths.map((w) => w.depthScore)));

    // 8) Recommendations
    const deepeningCats = byCategory.filter((c) => c.depthDirection === 'DEEPENING');
    const shallowingCats = byCategory.filter((c) => c.depthDirection === 'SHALLOWING');
    const bestDeepeningCategory =
      deepeningCats.length > 0
        ? deepeningCats.sort(
            (a, b) => b.projectedDepth90d - a.projectedDepth90d,
          )[0]!.category
        : null;
    const shallowingCategories = shallowingCats.map((c) => c.category).slice(0, 5);

    const advice = `Market depth: ${lastWeek.depthScore}/100 (${assessLiquidity(lastWeek.depthScore)}). Forecast: ${depthDirection} v 90d (${projectedDepth90d >= lastWeek.depthScore ? '+' : ''}${projectedDepth90d - lastWeek.depthScore}). ${bestDeepeningCategory ? `Best deepening: ${bestDeepeningCategory} (+${Math.max(0, byCategory.find((c) => c.category === bestDeepeningCategory)?.projectedDepth90d ?? 0 - (byCategory.find((c) => c.category === bestDeepeningCategory)?.currentDepth ?? 0))}).` : 'Brez deepening kategorij.'} ${shallowingCategories.length > 0 ? `Shallowing: ${shallowingCategories.join(', ')}.` : ''} ${depthDirection === 'SHALLOWING' ? 'Trg postaja tanjši — zmanjšaj fokus ali diversificiraj.' : depthDirection === 'DEEPENING' ? 'Trg se poglablja — povečaj fokus na deepening kategorije.' : 'Trg stabilen — vzdržuj trenutno strategijo.'}`;

    return NextResponse.json({
      ok: true,
      current: {
        depthScore: lastWeek.depthScore,
        liquidity: assessLiquidity(lastWeek.depthScore),
        listingCount: lastWeek.listingCount,
        avgPriceStability: round1(
          avg(weekDepths.map((w) => w.priceStability)),
        ),
      },
      forecast: {
        projectedDepth30d,
        projectedDepth60d,
        projectedDepth90d,
        depthDirection,
        depthMomentum,
        projectedLiquidity30d,
        projectedLiquidity60d,
        projectedLiquidity90d,
      },
      byCategory,
      historical: {
        deepestWeek,
        shallowestWeek,
        depthVolatility,
      },
      recommendations: {
        bestDeepeningCategory,
        shallowingCategories,
        advice,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-depth-forecaster',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
