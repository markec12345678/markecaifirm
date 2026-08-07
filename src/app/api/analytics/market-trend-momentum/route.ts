// v7.73: Market Trend Momentum Analyzer — analizira MOMENTUM tržnih trendov
// — ne le "ali raste?" ampak "kako hitro pospešuje?". Izračuna trend
// acceleration/velocity za vsako kategorijo. "Elektronika: ACCELERATING_UP
// (cena +8€/ted, pospešek +2€/ted²). Hot rising. Moda: DECELERATING_DOWN.
// Exit moda."
//
// Razlika od market-momentum (ki da BULLISH/BEARISH/NEUTRAL score 0-100 za
// cel trg) — ta gleda ACCELERATION (2. derivat) per kategorija. Razlika od
// market-trend (ki pove ali cena raste/pada) — ta pove KAKO HITRO se trend
// pospešuje. Razlika od weekly-trend-radar (ki gleda 7-dnevne trende) — ta
// gleda 13-tedensko zgodovino z 2. derivatom. Razlika od market-trends
// (AI-generated) — ta je pure DB analytics. Razlika od trend-predictions
// (AI predictions) — ta izračuna matematiko trend accel/velocity.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-trend-momentum

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type Momentum =
  | 'ACCELERATING_UP'
  | 'RISING_STEADY'
  | 'DECELERATING_UP'
  | 'FLAT'
  | 'DECELERATING_DOWN'
  | 'FALLING_STEADY'
  | 'ACCELERATING_DOWN';

type Classification =
  | 'HOT_RISING'
  | 'WARM_RISING'
  | 'STABLE'
  | 'COOLING'
  | 'COLD_FALLING';

interface PriceTrend {
  slope: number; // €/week
  acceleration: number; // €/week²
  momentum: Momentum;
  currentAvgPrice: number;
  projectedPrice30d: number;
}

interface VolumeTrend {
  slope: number; // listings/week
  acceleration: number;
  momentum: Momentum;
  currentListingCount: number;
  projectedVolume30d: number;
}

interface PrilikaTrend {
  slope: number;
  currentRate: number;
  projectedRate30d: number;
}

interface CategoryMomentum {
  category: string;
  priceTrend: PriceTrend;
  volumeTrend: VolumeTrend;
  prilikaTrend: PrilikaTrend;
  momentumScore: number; // 0-100
  classification: Classification;
}

interface Summary {
  totalCategories: number;
  hotRisingCount: number;
  coldFallingCount: number;
  bestMomentumCategory: string | null;
  worstMomentumCategory: string | null;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// Classify momentum from slope + acceleration
// slope > 0 → rising, slope < 0 → falling
// accel same sign as slope → ACCELERATING (speeding up)
// accel opposite sign of slope → DECELERATING (slowing down)
// slope near 0 → FLAT
// |accel| small → STEADY
function classifyMomentum(
  slope: number,
  acceleration: number,
  slopeThreshold: number,
  accelThreshold: number,
): Momentum {
  const absSlope = Math.abs(slope);
  const absAccel = Math.abs(acceleration);
  if (absSlope < slopeThreshold) {
    // Near-flat slope
    if (absAccel < accelThreshold) return 'FLAT';
    if (acceleration > 0) return 'ACCELERATING_UP';
    return 'ACCELERATING_DOWN';
  }
  if (slope > 0) {
    // Rising
    if (absAccel < accelThreshold) return 'RISING_STEADY';
    if (acceleration > 0) return 'ACCELERATING_UP';
    return 'DECELERATING_UP';
  }
  // Falling
  if (absAccel < accelThreshold) return 'FALLING_STEADY';
  if (acceleration < 0) return 'ACCELERATING_DOWN';
  return 'DECELERATING_DOWN';
}

// Linear regression (least squares) — returns slope (per week index).
// x = week index (0..n-1), y = metric value.
function linearRegressionSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i]!;
    sumXY += i * ys[i]!;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// Compute acceleration (2nd derivative) — difference in slope between
// the first half and second half of the data.
function computeAcceleration(ys: number[]): number {
  const n = ys.length;
  if (n < 4) return 0;
  const mid = Math.floor(n / 2);
  const firstHalf = ys.slice(0, mid);
  const secondHalf = ys.slice(mid);
  return linearRegressionSlope(secondHalf) - linearRegressionSlope(firstHalf);
}

// Classify category from momentum score (0-100) + price momentum
function classifyCategory(
  momentumScore: number,
  priceMomentum: Momentum,
): Classification {
  if (momentumScore >= 70 && (priceMomentum === 'ACCELERATING_UP' || priceMomentum === 'RISING_STEADY')) {
    return 'HOT_RISING';
  }
  if (momentumScore >= 55 && (priceMomentum === 'ACCELERATING_UP' || priceMomentum === 'RISING_STEADY' || priceMomentum === 'DECELERATING_UP')) {
    return 'WARM_RISING';
  }
  if (momentumScore <= 30 && (priceMomentum === 'ACCELERATING_DOWN' || priceMomentum === 'FALLING_STEADY')) {
    return 'COLD_FALLING';
  }
  if (momentumScore <= 45 && (priceMomentum === 'DECELERATING_DOWN' || priceMomentum === 'ACCELERATING_DOWN' || priceMomentum === 'FALLING_STEADY')) {
    return 'COOLING';
  }
  return 'STABLE';
}

// Compute momentum score (0-100) from price/volume/prilika trends
function computeMomentumScore(
  priceMomentum: Momentum,
  volumeMomentum: Momentum,
  prilikaSlope: number,
): number {
  let score = 50; // baseline neutral
  // Price momentum contribution
  switch (priceMomentum) {
    case 'ACCELERATING_UP':
      score += 25;
      break;
    case 'RISING_STEADY':
      score += 15;
      break;
    case 'DECELERATING_UP':
      score += 5;
      break;
    case 'FLAT':
      score += 0;
      break;
    case 'DECELERATING_DOWN':
      score -= 5;
      break;
    case 'FALLING_STEADY':
      score -= 15;
      break;
    case 'ACCELERATING_DOWN':
      score -= 25;
      break;
  }
  // Volume momentum — more supply can be both positive (active market) or negative (oversupply)
  // For market health, we treat rising volume as positive (more activity)
  switch (volumeMomentum) {
    case 'ACCELERATING_UP':
      score += 10;
      break;
    case 'RISING_STEADY':
      score += 5;
      break;
    case 'DECELERATING_UP':
      score += 3;
      break;
    case 'DECELERATING_DOWN':
      score -= 3;
      break;
    case 'FALLING_STEADY':
      score -= 5;
      break;
    case 'ACCELERATING_DOWN':
      score -= 10;
      break;
    case 'FLAT':
      score += 0;
      break;
  }
  // Prilika rate trend — more prilika = positive
  score += Math.max(-15, Math.min(15, prilikaSlope * 3));
  return Math.max(0, Math.min(100, Math.round(score)));
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query listings from last 90 days grouped by category AND week
    const cutoff = new Date(Date.now() - 90 * DAY_MS);
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        id: true,
        title: true,
        price: true,
        firstSeenAt: true,
        aiVerdict: true,
        monitor: { select: { source: true } },
      },
      take: 50000,
    });

    // Empty state
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          hotRisingCount: 0,
          coldFallingCount: 0,
          bestMomentumCategory: null,
          worstMomentumCategory: null,
          advice:
            'Ni listing-ov v zadnjih 90 dneh — Market Trend Momentum ni mogoče izračunati.',
        },
        message: 'Ni listing-ov — Market Trend Momentum ni mogoč.',
      });
    }

    // 2) Bucket listings per category per week (ISO week index relative to cutoff)
    // Categories: from monitor.source ("vir:..." prefix) since Listing has no category field
    const now = Date.now();
    type WeekBucket = {
      totalListings: number;
      pricedListings: number;
      sumPrice: number;
      prilikaCount: number;
    };
    const byCatWeek = new Map<string, Map<number, WeekBucket>>();

    for (const l of listings) {
      const sourceCat = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      const cat = `vir:${sourceCat}`;
      const firstSeenMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
      if (!Number.isFinite(firstSeenMs)) continue;
      // Week index from cutoff (0 = oldest week, 12 = newest in 90-day window)
      const weekIdx = Math.floor((firstSeenMs - cutoff.getTime()) / WEEK_MS);
      if (weekIdx < 0) continue;

      let weekMap = byCatWeek.get(cat);
      if (!weekMap) {
        weekMap = new Map();
        byCatWeek.set(cat, weekMap);
      }
      let bucket = weekMap.get(weekIdx);
      if (!bucket) {
        bucket = {
          totalListings: 0,
          pricedListings: 0,
          sumPrice: 0,
          prilikaCount: 0,
        };
        weekMap.set(weekIdx, bucket);
      }
      bucket.totalListings += 1;
      if (l.price != null && l.price > 0) {
        bucket.pricedListings += 1;
        bucket.sumPrice += l.price;
      }
      if (l.aiVerdict === 'PRILIKA') {
        bucket.prilikaCount += 1;
      }
    }

    // 3) Compute per-category momentum
    const categories: CategoryMomentum[] = [];
    const totalWeeks = 13; // 90 days / 7 = 12.857 → 13 weeks

    for (const [cat, weekMap] of byCatWeek.entries()) {
      // Build arrays of weekly metrics (index 0..12)
      const avgPrices: number[] = [];
      const listingCounts: number[] = [];
      const prilikaRates: number[] = [];

      for (let w = 0; w < totalWeeks; w++) {
        const bucket = weekMap.get(w);
        if (!bucket || bucket.totalListings === 0) {
          avgPrices.push(0);
          listingCounts.push(0);
          prilikaRates.push(0);
          continue;
        }
        const avgPrice = bucket.pricedListings > 0
          ? bucket.sumPrice / bucket.pricedListings
          : 0;
        avgPrices.push(avgPrice);
        listingCounts.push(bucket.totalListings);
        prilikaRates.push((bucket.prilikaCount / bucket.totalListings) * 100);
      }

      // Filter out trailing zeros (future weeks with no data) — only consider weeks with data
      let lastIdxWithData = -1;
      for (let w = totalWeeks - 1; w >= 0; w--) {
        if (listingCounts[w]! > 0) {
          lastIdxWithData = w;
          break;
        }
      }
      if (lastIdxWithData < 1) continue; // need at least 2 weeks of data

      // Trim arrays to only contain weeks up to lastIdxWithData
      const trimmedAvgPrices = avgPrices.slice(0, lastIdxWithData + 1);
      const trimmedListingCounts = listingCounts.slice(0, lastIdxWithData + 1);
      const trimmedPrilikaRates = prilikaRates.slice(0, lastIdxWithData + 1);

      // Replace zeros in avgPrices with previous non-zero (smoothing)
      let lastValidPrice = 0;
      const smoothedPrices = trimmedAvgPrices.map((p) => {
        if (p > 0) {
          lastValidPrice = p;
          return p;
        }
        return lastValidPrice > 0 ? lastValidPrice : 0;
      });

      // Compute slopes
      const priceSlope = linearRegressionSlope(smoothedPrices);
      const volumeSlope = linearRegressionSlope(trimmedListingCounts);
      const prilikaSlope = linearRegressionSlope(trimmedPrilikaRates);

      // Compute acceleration (2nd derivative)
      const priceAcceleration = computeAcceleration(smoothedPrices);
      const volumeAcceleration = computeAcceleration(trimmedListingCounts);

      // Determine thresholds (relative to data scale)
      const currentAvgPrice = trimmedAvgPrices[trimmedAvgPrices.length - 1] || 0;
      const currentListingCount = trimmedListingCounts[trimmedListingCounts.length - 1] || 0;
      const currentPrilikaRate = trimmedPrilikaRates[trimmedPrilikaRates.length - 1] || 0;

      // Threshold: 2% of current value
      const priceSlopeThreshold = Math.max(1, currentAvgPrice * 0.02);
      const priceAccelThreshold = Math.max(1, currentAvgPrice * 0.01);
      const volumeSlopeThreshold = Math.max(0.5, currentListingCount * 0.05);
      const volumeAccelThreshold = Math.max(0.5, currentListingCount * 0.03);

      const priceMomentum = classifyMomentum(
        priceSlope,
        priceAcceleration,
        priceSlopeThreshold,
        priceAccelThreshold,
      );
      const volumeMomentum = classifyMomentum(
        volumeSlope,
        volumeAcceleration,
        volumeSlopeThreshold,
        volumeAccelThreshold,
      );

      // Momentum score
      const momentumScore = computeMomentumScore(
        priceMomentum,
        volumeMomentum,
        prilikaSlope,
      );

      // 30-day projection (4.3 weeks)
      const projectedPrice30d = Math.round(
        (currentAvgPrice + priceSlope * 4.3) * 100,
      ) / 100;
      const projectedVolume30d = Math.max(0, Math.round(
        currentListingCount + volumeSlope * 4.3,
      ));
      const projectedRate30d = Math.max(
        0,
        Math.min(100, Math.round((currentPrilikaRate + prilikaSlope * 4.3) * 10) / 10),
      );

      const classification = classifyCategory(momentumScore, priceMomentum);

      categories.push({
        category: cat,
        priceTrend: {
          slope: Math.round(priceSlope * 100) / 100,
          acceleration: Math.round(priceAcceleration * 100) / 100,
          momentum: priceMomentum,
          currentAvgPrice: Math.round(currentAvgPrice * 100) / 100,
          projectedPrice30d: Math.max(0, projectedPrice30d),
        },
        volumeTrend: {
          slope: Math.round(volumeSlope * 100) / 100,
          acceleration: Math.round(volumeAcceleration * 100) / 100,
          momentum: volumeMomentum,
          currentListingCount,
          projectedVolume30d,
        },
        prilikaTrend: {
          slope: Math.round(prilikaSlope * 100) / 100,
          currentRate: Math.round(currentPrilikaRate * 10) / 10,
          projectedRate30d,
        },
        momentumScore,
        classification,
      });
    }

    // Sort by momentum score desc
    categories.sort((a, b) => b.momentumScore - a.momentumScore);

    // 4) Summary
    const hotRisingCount = categories.filter((c) => c.classification === 'HOT_RISING').length;
    const coldFallingCount = categories.filter((c) => c.classification === 'COLD_FALLING').length;
    const bestMomentumCategory = categories.length > 0 ? categories[0]!.category : null;
    const worstMomentumCategory = categories.length > 0
      ? categories[categories.length - 1]!.category
      : null;

    let advice: string;
    if (categories.length === 0) {
      advice = 'Ni dovolj podatkov za izračun trend momentuma.';
    } else if (hotRisingCount > 0) {
      advice = `${hotRisingCount} kategorij${hotRisingCount > 1 ? 'e' : 'a'} v HOT_RISING stanju — fokusiraj nabavo in prodajo tu. `;
      if (coldFallingCount > 0) {
        advice += `Izogibaj se ${coldFallingCount} kategorij${coldFallingCount > 1 ? 'am' : 'e'} v COLD_FALLING (exit).`;
      }
    } else if (coldFallingCount > 0) {
      advice = `${coldFallingCount} kategorij${coldFallingCount > 1 ? 'e' : 'a'} v COLD_FALLING — premisli exit ali zmanjšaj nabavo. Ostale kategorije so stabilne.`;
    } else {
      advice = 'Trg je stabilen brez izrazitih trending kategorij. Fokus na individual deal quality namesto kategorijo trend.';
    }

    const summary: Summary = {
      totalCategories: categories.length,
      hotRisingCount,
      coldFallingCount,
      bestMomentumCategory,
      worstMomentumCategory,
      advice,
    };

    return NextResponse.json({
      ok: true,
      categories,
      summary,
    });
  } catch (err: any) {
    logger.error('/api/analytics/market-trend-momentum', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
