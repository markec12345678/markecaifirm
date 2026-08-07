// v7.69: Market Saturation Forecaster — projektira trende saturacije trga —
// ali bo kategorija postala prezasičena v 30/60/90 dneh? Pomaga odločati kdaj
// izstopiti iz kategorije preden cene padejo. Pure DB analytics — NO AI.
//
// "Elektronika: SATURATING (1.4), timeToOversaturation 45d. Exit NOW.
//  Moda: UNDERSTARTED (0.6). Enter NOW."
//
// Razlika od market-saturation (ki gleda AKTUALNO saturacijo) — ta gleda
// NAPREDOVANJE saturacije v času z linearno regresijo + projekcijo 30/60/90
// dni vnaprej. Razlika od market-depth-analyzer (ki meri GLOBINO trga z
// cenovno distribucijo) — ta meri SATURACIJO (current vs historical avg).
// Razlika od market-momentum (ki gleda 7-dnevni BULLISH/BEARISH trend) —
// ta gleda 90-dnevno saturacijo z napovedjo in EXIT/ENTER signali.
// Razlika od deal-velocity (ki meri hitrost prodaje) — ta meri KOLIKO je
// trg nasičen z oglasi in ali se bo še bolj nasičil.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-saturation-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type ListingTrend = 'INCREASING' | 'STABLE' | 'DECREASING';
type PriceTrend = 'RISING' | 'STABLE' | 'FALLING';
type SaturationStatus =
  | 'UNDERSTARTED'
  | 'HEALTHY'
  | 'SATURATING'
  | 'OVERSATURATED';
type Action = 'ENTER_NOW' | 'CONTINUE' | 'SLOW_DOWN' | 'EXIT_NOW';

interface CategoryCurrent {
  saturation: number; // 1.0 = normal
  newListingsThisWeek: number;
  avgPrice: number;
  sellThroughRate: number;
}

interface CategoryTrend {
  listingTrend: ListingTrend;
  priceTrend: PriceTrend;
  saturationVelocity: number; // listings/week²
}

interface CategoryForecast {
  projected30d: number;
  projected60d: number;
  projected90d: number;
  saturationStatus: SaturationStatus;
  timeToOversaturation: number | null; // days
}

interface CategoryRecommendation {
  action: Action;
  pricePressureExpected: number; // %
  reasoning: string;
}

interface CategoryForecastRow {
  category: string;
  current: CategoryCurrent;
  trend: CategoryTrend;
  forecast: CategoryForecast;
  recommendation: CategoryRecommendation;
}

interface Summary {
  totalCategories: number;
  healthyCategories: number;
  saturatingCategories: number;
  oversaturatedCategories: number;
  bestExitCategory: string | null;
  bestEntryCategory: string | null;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEKS_TO_ANALYZE = 13; // ~90 days
const SATURATION_THRESHOLD = 1.7; // over this = oversaturated
const OVERSATURATED_THRESHOLD = 1.7;
const SATURATING_THRESHOLD = 1.3;
const HEALTHY_MIN = 0.7;

// Linear regression: y = slope * x + intercept
// x = week index (0 = oldest), y = value
function linearRegression(values: number[]): {
  slope: number;
  intercept: number;
} {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0] ?? 0 };
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (values[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function deriveListingTrend(slope: number, meanValue: number): ListingTrend {
  if (meanValue === 0) return 'STABLE';
  const relativeSlope = slope / meanValue;
  if (relativeSlope > 0.05) return 'INCREASING'; // >5%/week growth
  if (relativeSlope < -0.05) return 'DECREASING';
  return 'STABLE';
}

function derivePriceTrend(slope: number, meanPrice: number): PriceTrend {
  if (meanPrice === 0) return 'STABLE';
  const relativeSlope = slope / meanPrice;
  if (relativeSlope > 0.01) return 'RISING'; // >1%/week
  if (relativeSlope < -0.01) return 'FALLING';
  return 'STABLE';
}

function deriveSaturationStatus(saturation: number): SaturationStatus {
  if (saturation < HEALTHY_MIN) return 'UNDERSTARTED';
  if (saturation < SATURATING_THRESHOLD) return 'HEALTHY';
  if (saturation < OVERSATURATED_THRESHOLD) return 'SATURATING';
  return 'OVERSATURATED';
}

// Compute time to oversaturation in days, given current saturation + weekly slope
function computeTimeToOversaturation(
  currentSaturation: number,
  weeklySlope: number,
): number | null {
  if (currentSaturation >= OVERSATURATED_THRESHOLD) return null; // already oversaturated
  if (weeklySlope <= 0) return null; // not trending up
  const remaining = OVERSATURATED_THRESHOLD - currentSaturation;
  const weeksToOversaturation = remaining / weeklySlope;
  if (weeksToOversaturation <= 0) return null;
  if (weeksToOversaturation > 52 * 4) return null; // >4 years — irrelevant
  return Math.round(weeksToOversaturation * 7);
}

// Project saturation in N weeks (based on linear regression)
function projectSaturation(
  currentSaturation: number,
  weeklySlope: number,
  weeksAhead: number,
): number {
  const projected = currentSaturation + weeklySlope * weeksAhead;
  return Math.max(0, Math.round(projected * 100) / 100);
}

// Price pressure expected (% drop in 90d based on supply growth)
function computePricePressure(
  listingTrend: ListingTrend,
  saturation: number,
): number {
  if (listingTrend === 'INCREASING' && saturation > 1.0) {
    // More supply → price drop. Estimate 5-15% drop based on saturation level.
    const basePressure = Math.min(20, (saturation - 1) * 30);
    return Math.round(basePressure * 10) / 10;
  }
  if (listingTrend === 'INCREASING' && saturation <= 1.0) {
    return 2; // mild pressure even at normal levels
  }
  if (listingTrend === 'DECREASING' && saturation > 1.3) {
    return 3; // already saturated but supply declining → mild pressure relief
  }
  return 0;
}

function deriveAction(
  status: SaturationStatus,
  listingTrend: ListingTrend,
  priceTrend: PriceTrend,
): Action {
  if (status === 'OVERSATURATED') return 'EXIT_NOW';
  if (status === 'SATURATING' && listingTrend === 'INCREASING') return 'EXIT_NOW';
  if (status === 'SATURATING') return 'SLOW_DOWN';
  if (status === 'UNDERSTARTED' && listingTrend !== 'DECREASING') return 'ENTER_NOW';
  if (status === 'UNDERSTARTED') return 'CONTINUE';
  if (status === 'HEALTHY' && listingTrend === 'DECREASING' && priceTrend === 'RISING') {
    return 'ENTER_NOW';
  }
  if (status === 'HEALTHY' && listingTrend === 'INCREASING' && priceTrend === 'FALLING') {
    return 'SLOW_DOWN';
  }
  return 'CONTINUE';
}

function buildReasoning(
  status: SaturationStatus,
  listingTrend: ListingTrend,
  priceTrend: PriceTrend,
  timeToOversaturation: number | null,
  pricePressure: number,
): string {
  const parts: string[] = [];
  parts.push(`Saturacija ${status}`);
  if (listingTrend !== 'STABLE') {
    parts.push(`ponudba ${listingTrend === 'INCREASING' ? 'raste' : 'pada'}`);
  }
  if (priceTrend !== 'STABLE') {
    parts.push(`cene ${priceTrend === 'RISING' ? 'riage' : 'padajo'}`);
  }
  if (timeToOversaturation != null) {
    parts.push(`do oversaturacije ${timeToOversaturation} dni`);
  }
  if (pricePressure > 0) {
    parts.push(`pričakovan padec cen ${pricePressure}% v 90 dneh`);
  }
  return parts.join(', ') + '.';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all listings from last 90 days (13 weeks) with full data
    const cutoff = new Date(Date.now() - WEEKS_TO_ANALYZE * 7 * DAY_MS);
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        isBookmarked: true,
        contactStatus: true,
        monitor: { select: { tags: true } },
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
          healthyCategories: 0,
          saturatingCategories: 0,
          oversaturatedCategories: 0,
          bestExitCategory: null,
          bestEntryCategory: null,
          advice:
            'Ni oglasov v zadnjih 90 dneh — Market Saturation Forecast ni mogoč. Dodaš oglase ali počakaj na scrapanje.',
        },
        message:
          'Ni oglasov v zadnjih 90 dneh — Market Saturation Forecast ni mogoč.',
      });
    }

    // 2) Group by category AND week index (0 = oldest week)
    const nowMs = Date.now();
    const weekMs = 7 * DAY_MS;
    const byCategoryAndWeek = new Map<
      string,
      Map<number, { listings: number; prices: number[]; bookmarked: number; contacted: number }>
    >();

    for (const l of listings) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const category = (firstTag || 'drugo').trim() || 'drugo';

      const seenAt = l.firstSeenAt ? new Date(l.firstSeenAt).getTime() : null;
      if (!seenAt) continue;
      const ageDays = (nowMs - seenAt) / DAY_MS;
      if (ageDays < 0) continue;
      const weekIdx = Math.min(
        WEEKS_TO_ANALYZE - 1,
        Math.max(0, Math.floor(ageDays / 7)),
      );
      // Reverse: week 0 = oldest, WEEKS_TO_ANALYZE-1 = current
      const reverseWeek = WEEKS_TO_ANALYZE - 1 - weekIdx;

      let catMap = byCategoryAndWeek.get(category);
      if (!catMap) {
        catMap = new Map();
        byCategoryAndWeek.set(category, catMap);
      }
      let weekData = catMap.get(reverseWeek);
      if (!weekData) {
        weekData = { listings: 0, prices: [], bookmarked: 0, contacted: 0 };
        catMap.set(reverseWeek, weekData);
      }
      weekData.listings += 1;
      if (l.price != null && l.price > 0) weekData.prices.push(l.price);
      if (l.isBookmarked) weekData.bookmarked += 1;
      if (l.contactStatus && l.contactStatus !== 'none') {
        weekData.contacted += 1;
      }
    }

    // 3) Compute per-category forecast
    const rows: CategoryForecastRow[] = [];

    for (const [category, weekMap] of byCategoryAndWeek.entries()) {
      // Build weekly time series (fill missing weeks with 0)
      const weeklyNewListings: number[] = [];
      const weeklyAvgPrices: number[] = [];
      const weeklySellThrough: number[] = [];
      for (let w = 0; w < WEEKS_TO_ANALYZE; w++) {
        const wd = weekMap.get(w);
        weeklyNewListings.push(wd?.listings ?? 0);
        const prices = wd?.prices ?? [];
        const avgPrice =
          prices.length > 0
            ? prices.reduce((s, p) => s + p, 0) / prices.length
            : 0;
        weeklyAvgPrices.push(avgPrice);
        const total = wd?.listings ?? 0;
        const bookmarked = wd?.bookmarked ?? 0;
        weeklySellThrough.push(total > 0 ? bookmarked / total : 0);
      }

      // Skip categories with very few listings overall
      const totalListings90d = weeklyNewListings.reduce((s, x) => s + x, 0);
      if (totalListings90d < 5) continue;

      // Linear regression on weekly new listings
      const listingReg = linearRegression(weeklyNewListings);
      const meanWeekly = totalListings90d / WEEKS_TO_ANALYZE;
      const listingTrend = deriveListingTrend(listingReg.slope, meanWeekly);

      // Linear regression on weekly avg prices
      const validPrices = weeklyAvgPrices.filter(p => p > 0);
      const meanPrice =
        validPrices.length > 0
          ? validPrices.reduce((s, p) => s + p, 0) / validPrices.length
          : 0;
      const priceReg = linearRegression(weeklyAvgPrices);
      const priceTrend = derivePriceTrend(priceReg.slope, meanPrice);

      // Saturation velocity = listingReg.slope (listings/week²)
      const saturationVelocity = Math.round(listingReg.slope * 100) / 100;

      // Current week metrics
      const currentWeekData = weekMap.get(WEEKS_TO_ANALYZE - 1);
      const newListingsThisWeek = currentWeekData?.listings ?? 0;
      const currentPrices = currentWeekData?.prices ?? [];
      const avgPrice =
        currentPrices.length > 0
          ? Math.round(
              currentPrices.reduce((s, p) => s + p, 0) / currentPrices.length,
            )
          : Math.round(meanPrice);
      const currentTotal = currentWeekData?.listings ?? 0;
      const currentBookmarked = currentWeekData?.bookmarked ?? 0;
      const sellThroughRate =
        currentTotal > 0
          ? Math.round((currentBookmarked / currentTotal) * 1000) / 10
          : 0;

      // Current saturation: current week listings vs historical avg
      // saturation = newListingsThisWeek / meanWeekly
      // (1.0 = at historical average, >1.5 = saturated)
      const currentSaturation =
        meanWeekly > 0
          ? Math.round((newListingsThisWeek / meanWeekly) * 100) / 100
          : 0;

      // Weekly slope of saturation (relative) — for projection
      // If listings grow by X% per week, saturation also grows by that %
      const weeklySaturationSlope =
        meanWeekly > 0 ? listingReg.slope / meanWeekly : 0;

      // Project saturation in 30/60/90 days (≈4.3/8.6/12.9 weeks)
      const projected30d = projectSaturation(
        currentSaturation,
        weeklySaturationSlope,
        30 / 7,
      );
      const projected60d = projectSaturation(
        currentSaturation,
        weeklySaturationSlope,
        60 / 7,
      );
      const projected90d = projectSaturation(
        currentSaturation,
        weeklySaturationSlope,
        90 / 7,
      );

      const saturationStatus = deriveSaturationStatus(currentSaturation);
      const timeToOversaturation = computeTimeToOversaturation(
        currentSaturation,
        weeklySaturationSlope,
      );

      const pricePressureExpected = computePricePressure(
        listingTrend,
        currentSaturation,
      );

      const action = deriveAction(
        saturationStatus,
        listingTrend,
        priceTrend,
      );

      const reasoning = buildReasoning(
        saturationStatus,
        listingTrend,
        priceTrend,
        timeToOversaturation,
        pricePressureExpected,
      );

      rows.push({
        category,
        current: {
          saturation: currentSaturation,
          newListingsThisWeek,
          avgPrice,
          sellThroughRate,
        },
        trend: {
          listingTrend,
          priceTrend,
          saturationVelocity,
        },
        forecast: {
          projected30d,
          projected60d,
          projected90d,
          saturationStatus,
          timeToOversaturation,
        },
        recommendation: {
          action,
          pricePressureExpected,
          reasoning,
        },
      });
    }

    // Sort by saturation desc (most saturated first)
    rows.sort((a, b) => b.current.saturation - a.current.saturation);

    // 4) Summary
    const totalCategories = rows.length;
    if (totalCategories === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          healthyCategories: 0,
          saturatingCategories: 0,
          oversaturatedCategories: 0,
          bestExitCategory: null,
          bestEntryCategory: null,
          advice:
            'Ni kategorij z dovolj podatki (vsaj 5 oglasov v 90 dneh) za Market Saturation Forecast.',
        },
        message:
          'Ni kategorij z dovolj oglasov v 90 dneh za Market Saturation Forecast.',
      });
    }

    const oversaturatedCategories = rows.filter(
      r => r.forecast.saturationStatus === 'OVERSATURATED',
    ).length;
    const saturatingCategories = rows.filter(
      r => r.forecast.saturationStatus === 'SATURATING',
    ).length;
    const healthyCategories = rows.filter(
      r => r.forecast.saturationStatus === 'HEALTHY',
    ).length;

    // Best exit = highest saturation (or saturating + increasing)
    const exitCandidate = rows.find(
      r =>
        r.forecast.saturationStatus === 'OVERSATURATED' ||
        (r.forecast.saturationStatus === 'SATURATING' &&
          r.trend.listingTrend === 'INCREASING'),
    );
    const bestExitCategory = exitCandidate?.category ?? null;

    // Best entry = UNDERSTARTED + not decreasing
    const entryCandidate = [...rows]
      .reverse()
      .find(
        r =>
          r.forecast.saturationStatus === 'UNDERSTARTED' &&
          r.trend.listingTrend !== 'DECREASING',
      );
    const bestEntryCategory = entryCandidate?.category ?? null;

    let advice: string;
    if (oversaturatedCategories > 0 && bestExitCategory) {
      advice = `Kritično: ${oversaturatedCategories} kategorij OVERSATURATED. IZSTOPI iz "${bestExitCategory}" (saturation ${exitCandidate?.current.saturation ?? 0}).${
        bestEntryCategory
          ? ` Premakni kapital v "${bestEntryCategory}" (UNDERSTARTED).`
          : ''
      }`;
    } else if (saturatingCategories > 0 && bestExitCategory) {
      advice = `Opozorilo: ${saturatingCategories} kategorij SATURATING. Upočasni aktivnost v "${bestExitCategory}".${
        bestEntryCategory
          ? ` Razmisli o vstopu v "${bestEntryCategory}".`
          : ''
      }`;
    } else if (bestEntryCategory) {
      advice = `Trg je ZDRAV — ${healthyCategories} od ${totalCategories} kategorij HEALTHY. Najboljša priložnost za vstop: "${bestEntryCategory}" (UNDERSTARTED).`;
    } else {
      advice = `Trg je ZDRAV — ${healthyCategories} od ${totalCategories} kategorij HEALTHY. Vzdržuj trenutno aktivnost.`;
    }

    return NextResponse.json({
      ok: true,
      categories: rows,
      summary: {
        totalCategories,
        healthyCategories,
        saturatingCategories,
        oversaturatedCategories,
        bestExitCategory,
        bestEntryCategory,
        advice,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-saturation-forecaster',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
