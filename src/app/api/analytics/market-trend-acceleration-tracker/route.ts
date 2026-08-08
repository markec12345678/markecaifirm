// v7.89: Market Trend Acceleration Tracker — track-a ACCELERATION (2nd
// derivative) market trend-ov — ne samo "is it rising?" temveč "is the rate
// of rise speeding up or slowing down?". Pure DB analytics (NO AI).
// "Overall: ACCELERATING_UP (score 72). Price momentum +5€/wk, accel +1€/wk².
// Volume speeding up. Best: elektronika (ACCEL_UP)."
//
// Razlika od market-trend-momentum (v7.73 ki track-a momentum 1st derivative)
// — ta track-a ACCELERATION (2nd derivative — change in momentum). Razlika od
// market-trend-forecaster-pro (v7.78 AI ki forecast-a trend) — ta je pure DB
// ANALYSIS čez 26 tednov z 2nd derivative. Razlika od market-trend (ki
// rising/falling) — ta gleda acceleration ( speeding up / slowing down).
// Razlika od weekly-trend-radar (7-day) — ta je 26-tedenski z 2nd derivative.
//
// GET /api/analytics/market-trend-acceleration-tracker (Pure DB — NO AI)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type AccelerationClass =
  | 'ACCELERATING_UP'
  | 'DECELERATING_UP'
  | 'FLAT'
  | 'DECELERATING_DOWN'
  | 'ACCELERATING_DOWN';

type AccelerationTrend = 'SPEEDING_UP' | 'STABLE' | 'SLOWING_DOWN';

interface MetricAcceleration {
  momentum: number; // 1st derivative (slope per week)
  acceleration: number; // 2nd derivative (change in momentum)
  classification: AccelerationClass;
  interpretation: string;
}

interface CategoryAcceleration {
  category: string;
  accelerationScore: number;
  classification: AccelerationClass;
  priceAcceleration: number;
  volumeAcceleration: number;
}

interface HistoricalPattern {
  accelerationPattern: Array<{ week: string; acceleration: number; event: string }>;
  lastAccelerationUp: string | null;
  lastAccelerationDown: string | null;
}

interface Insights {
  accelerationTrend: AccelerationTrend;
  bestAcceleratingCategory: string | null;
  worstDeceleratingCategory: string | null;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_180D = 180 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;
const WEEKS_26 = 26;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

// Thresholds for classification
const MOMENTUM_THRESHOLD = 0.05; // small positive momentum
const ACCEL_THRESHOLD = 0.05; // small positive acceleration

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

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Linear regression slope per index (per week)
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

// 2nd derivative: slope of the second half of values minus slope of the first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

// Classify acceleration based on momentum (1st der) + acceleration (2nd der)
function classifyAcceleration(
  momentum: number,
  acceleration: number,
  momThreshold: number = MOMENTUM_THRESHOLD,
  accThreshold: number = ACCEL_THRESHOLD,
): AccelerationClass {
  if (momentum > momThreshold) {
    // positive momentum
    if (acceleration > accThreshold) return 'ACCELERATING_UP';
    if (acceleration < -accThreshold) return 'DECELERATING_UP';
    return 'ACCELERATING_UP'; // if momentum strongly positive and accel neutral, still accelerating up
  } else if (momentum < -momThreshold) {
    // negative momentum
    if (acceleration < -accThreshold) return 'ACCELERATING_DOWN'; // getting worse faster
    if (acceleration > accThreshold) return 'DECELERATING_DOWN'; // downtrend slowing
    return 'ACCELERATING_DOWN';
  }
  // momentum near zero
  if (acceleration > accThreshold) return 'ACCELERATING_UP';
  if (acceleration < -accThreshold) return 'DECELERATING_DOWN';
  return 'FLAT';
}

function interpretMetric(
  metricName: string,
  classification: AccelerationClass,
  momentum: number,
  acceleration: number,
): string {
  const unit = metricName === 'price' ? '€/wk' : metricName === 'volume' ? '/wk' : '/wk';
  switch (classification) {
    case 'ACCELERATING_UP':
      return `${metricName} momentum ${round2(momentum)} ${unit} in pospešuje (accel +${round2(acceleration)}). Trend raste vse hitreje — priložnost za povečanje aktivnosti.`;
    case 'DECELERATING_UP':
      return `${metricName} momentum ${round2(momentum)} ${unit} ampak upočasnjuje (accel ${round2(acceleration)}). Rast se zmanjšuje — previdno pri dodajanju.`;
    case 'FLAT':
      return `${metricName} momentum ${round2(momentum)} ${unit} in stabilen (accel ${round2(acceleration)}). Ni pomembne spremembe — vzdržuj strategijo.`;
    case 'DECELERATING_DOWN':
      return `${metricName} momentum ${round2(momentum)} ${unit} ampak upočasnjuje (accel +${round2(acceleration)}). Padec se zmanjšuje — možnost za ponovno rast.`;
    case 'ACCELERATING_DOWN':
      return `${metricName} momentum ${round2(momentum)} ${unit} in pospešuje padec (accel ${round2(acceleration)}). Trend pada vse hitreje — zmanjšaj izpostavljenost.`;
  }
}

// --- Listing row ---------------------------------------------------------

interface ListingRow {
  price: number | null;
  dealScore: number | null;
  aiVerdict: string | null;
  firstSeenAt: Date;
  monitor: { source: string | null } | null;
}

// --- Week aggregation ----------------------------------------------------

interface WeekAgg {
  weekMs: number;
  priceSum: number;
  priceCount: number;
  listingCount: number;
  dealScoreSum: number;
  dealScoreCount: number;
  prilikaCount: number;
  totalListings: number;
}

function newWeekAgg(weekMs: number): WeekAgg {
  return {
    weekMs,
    priceSum: 0,
    priceCount: 0,
    listingCount: 0,
    dealScoreSum: 0,
    dealScoreCount: 0,
    prilikaCount: 0,
    totalListings: 0,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff180d = new Date(now - HORIZON_180D);

    // 1) Query all listings from last 180 days
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff180d },
      },
      select: {
        price: true,
        dealScore: true,
        aiVerdict: true,
        firstSeenAt: true,
        monitor: { select: { source: true } },
      },
      orderBy: { firstSeenAt: 'asc' },
      take: 200000,
    });

    const rows = listings as unknown as ListingRow[];

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        overall: {
          accelerationScore: 50,
          classification: 'FLAT',
          summary: 'Ni oglasov v zadnjih 180 dneh — Market Trend Acceleration Tracker ni mogoč.',
        },
        metrics: {
          price: { momentum: 0, acceleration: 0, classification: 'FLAT', interpretation: 'Ni podatkov.' },
          volume: { momentum: 0, acceleration: 0, classification: 'FLAT', interpretation: 'Ni podatkov.' },
          quality: { momentum: 0, acceleration: 0, classification: 'FLAT', interpretation: 'Ni podatkov.' },
          opportunity: { momentum: 0, acceleration: 0, classification: 'FLAT', interpretation: 'Ni podatkov.' },
        },
        byCategory: [],
        historical: {
          accelerationPattern: [],
          lastAccelerationUp: null,
          lastAccelerationDown: null,
        },
        insights: {
          accelerationTrend: 'STABLE',
          bestAcceleratingCategory: null,
          worstDeceleratingCategory: null,
          advice: 'Ni oglasov v zadnjih 180 dneh — Market Trend Acceleration Tracker ni mogoč.',
        },
        message: 'Ni oglasov v zadnjih 180 dneh — Market Trend Acceleration Tracker ni mogoč.',
      });
    }

    // 2) Group by ISO week (26 weeks back from now)
    const weekStartMs = (t: number): number => {
      const d = new Date(t);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      return monday.getTime();
    };

    const weekMap = new Map<number, WeekAgg>();
    for (const l of rows) {
      const seenMs = toMs(l.firstSeenAt);
      if (seenMs <= 0) continue;
      const wMs = weekStartMs(seenMs);
      let agg = weekMap.get(wMs);
      if (!agg) {
        agg = newWeekAgg(wMs);
        weekMap.set(wMs, agg);
      }
      agg.totalListings += 1;
      const price = l.price;
      if (price != null && price > 0) {
        agg.priceSum += price;
        agg.priceCount += 1;
      }
      const dealScore = l.dealScore;
      if (dealScore != null) {
        agg.dealScoreSum += dealScore;
        agg.dealScoreCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') {
        agg.prilikaCount += 1;
      }
      agg.listingCount += 1;
    }

    // Sort weeks chronologically
    const sortedWeeks = Array.from(weekMap.values()).sort((a, b) => a.weekMs - b.weekMs);

    // Build metric time series (avg per week)
    const priceSeries: number[] = [];
    const volumeSeries: number[] = [];
    const qualitySeries: number[] = [];
    const opportunitySeries: number[] = [];

    for (const w of sortedWeeks) {
      priceSeries.push(w.priceCount > 0 ? w.priceSum / w.priceCount : 0);
      volumeSeries.push(w.listingCount);
      qualitySeries.push(w.dealScoreCount > 0 ? w.dealScoreSum / w.dealScoreCount : 0);
      opportunitySeries.push(w.listingCount > 0 ? (w.prilikaCount / w.listingCount) * 100 : 0);
    }

    // 3) Compute 1st derivative (momentum) and 2nd derivative (acceleration) per metric
    const priceMomentum = trendSlope(priceSeries);
    const volumeMomentum = trendSlope(volumeSeries);
    const qualityMomentum = trendSlope(qualitySeries);
    const opportunityMomentum = trendSlope(opportunitySeries);

    const priceAcceleration = computeAcceleration(priceSeries);
    const volumeAcceleration = computeAcceleration(volumeSeries);
    const qualityAcceleration = computeAcceleration(qualitySeries);
    const opportunityAcceleration = computeAcceleration(opportunitySeries);

    // 4) Classify each metric
    const priceClass = classifyAcceleration(priceMomentum, priceAcceleration, 2, 1);
    const volumeClass = classifyAcceleration(volumeMomentum, volumeAcceleration, 0.5, 0.3);
    const qualityClass = classifyAcceleration(qualityMomentum, qualityAcceleration, 0.3, 0.15);
    const opportunityClass = classifyAcceleration(opportunityMomentum, opportunityAcceleration, 0.5, 0.3);

    const metrics = {
      price: {
        momentum: round2(priceMomentum),
        acceleration: round2(priceAcceleration),
        classification: priceClass,
        interpretation: interpretMetric('price', priceClass, priceMomentum, priceAcceleration),
      },
      volume: {
        momentum: round2(volumeMomentum),
        acceleration: round2(volumeAcceleration),
        classification: volumeClass,
        interpretation: interpretMetric('volume', volumeClass, volumeMomentum, volumeAcceleration),
      },
      quality: {
        momentum: round2(qualityMomentum),
        acceleration: round2(qualityAcceleration),
        classification: qualityClass,
        interpretation: interpretMetric('quality', qualityClass, qualityMomentum, qualityAcceleration),
      },
      opportunity: {
        momentum: round2(opportunityMomentum),
        acceleration: round2(opportunityAcceleration),
        classification: opportunityClass,
        interpretation: interpretMetric('opportunity', opportunityClass, opportunityMomentum, opportunityAcceleration),
      },
    };

    // 5) Overall acceleration score (0-100): weighted combination
    // Convert each metric classification to a score, then weight
    const classToScore = (c: AccelerationClass): number => {
      switch (c) {
        case 'ACCELERATING_UP': return 90;
        case 'DECELERATING_UP': return 65;
        case 'FLAT': return 50;
        case 'DECELERATING_DOWN': return 35;
        case 'ACCELERATING_DOWN': return 10;
      }
    };

    const overallScore = round0(
      Math.max(SCORE_MIN, Math.min(SCORE_MAX,
        classToScore(priceClass) * 0.30 +
        classToScore(volumeClass) * 0.25 +
        classToScore(qualityClass) * 0.20 +
        classToScore(opportunityClass) * 0.25)),
    );

    // Overall classification — pick dominant
    let overallClass: AccelerationClass = 'FLAT';
    if (overallScore >= 75) overallClass = 'ACCELERATING_UP';
    else if (overallScore >= 60) overallClass = 'DECELERATING_UP';
    else if (overallScore >= 40) overallClass = 'FLAT';
    else if (overallScore >= 25) overallClass = 'DECELERATING_DOWN';
    else overallClass = 'ACCELERATING_DOWN';

    const overallSummary = `Overall: ${overallClass} (score ${overallScore}/100). Price momentum ${round2(priceMomentum)}€/wk, accel ${round2(priceAcceleration)}€/wk². Volume ${volumeClass === 'ACCELERATING_UP' ? 'speeding up' : volumeClass === 'ACCELERATING_DOWN' ? 'falling faster' : 'stable'}.`.slice(0, 400);

    // 6) Per-category acceleration analysis
    interface CatAgg {
      category: string;
      weeks: WeekAgg[];
    }
    const catMap = new Map<string, WeekAgg[]>();
    for (const l of rows) {
      const seenMs = toMs(l.firstSeenAt);
      if (seenMs <= 0) continue;
      const src = (l.monitor?.source ?? 'neznan').trim().toLowerCase() || 'neznan';
      const wMs = weekStartMs(seenMs);
      let arr = catMap.get(src);
      if (!arr) {
        arr = [];
        catMap.set(src, arr);
      }
      let agg = arr.find((a) => a.weekMs === wMs);
      if (!agg) {
        agg = newWeekAgg(wMs);
        arr.push(agg);
      }
      agg.totalListings += 1;
      const price = l.price;
      if (price != null && price > 0) {
        agg.priceSum += price;
        agg.priceCount += 1;
      }
      agg.listingCount += 1;
    }

    const byCategory: CategoryAcceleration[] = [];
    let bestAcceleratingCategory: string | null = null;
    let bestAccelScore = 50;
    let worstDeceleratingCategory: string | null = null;
    let worstAccelScore = 50;

    for (const [category, weeks] of catMap.entries()) {
      if (weeks.length < 4) continue; // need at least 4 weeks
      weeks.sort((a, b) => a.weekMs - b.weekMs);
      const prices = weeks.map((w) => (w.priceCount > 0 ? w.priceSum / w.priceCount : 0));
      const volumes = weeks.map((w) => w.listingCount);
      const priceAcc = computeAcceleration(prices);
      const volumeAcc = computeAcceleration(volumes);
      const priceMom = trendSlope(prices);
      const volumeMom = trendSlope(volumes);

      const pClass = classifyAcceleration(priceMom, priceAcc, 2, 1);
      const vClass = classifyAcceleration(volumeMom, volumeAcc, 0.5, 0.3);

      // Category score = average of price + volume classification scores
      const catScore = round0(
        Math.max(SCORE_MIN, Math.min(SCORE_MAX,
          (classToScore(pClass) + classToScore(vClass)) / 2)),
      );

      // Overall category classification from score
      let catClass: AccelerationClass = 'FLAT';
      if (catScore >= 75) catClass = 'ACCELERATING_UP';
      else if (catScore >= 60) catClass = 'DECELERATING_UP';
      else if (catScore >= 40) catClass = 'FLAT';
      else if (catScore >= 25) catClass = 'DECELERATING_DOWN';
      else catClass = 'ACCELERATING_DOWN';

      byCategory.push({
        category,
        accelerationScore: catScore,
        classification: catClass,
        priceAcceleration: round2(priceAcc),
        volumeAcceleration: round2(volumeAcc),
      });

      if (catScore > bestAccelScore && catClass === 'ACCELERATING_UP') {
        bestAccelScore = catScore;
        bestAcceleratingCategory = category;
      }
      if (catScore < worstAccelScore && (catClass === 'ACCELERATING_DOWN' || catClass === 'DECELERATING_DOWN')) {
        worstAccelScore = catScore;
        worstDeceleratingCategory = category;
      }
    }

    byCategory.sort((a, b) => b.accelerationScore - a.accelerationScore);

    // 7) Historical acceleration pattern — week-by-week acceleration signal
    const accelerationPattern: Array<{ week: string; acceleration: number; event: string }> = [];
    // Use a sliding window: compute price momentum over previous 4 weeks at each step
    for (let i = 4; i < sortedWeeks.length; i++) {
      const window = priceSeries.slice(i - 4, i + 1);
      const mom = trendSlope(window);
      const prevWindow = priceSeries.slice(Math.max(0, i - 8), i - 3);
      const prevMom = prevWindow.length >= 2 ? trendSlope(prevWindow) : mom;
      const acc = mom - prevMom;
      const wMs = sortedWeeks[i]!.weekMs;
      const weekLabel = new Date(wMs).toISOString().slice(0, 10);
      let event = 'stable';
      if (mom > 2 && acc > 1) event = 'accelerating_up';
      else if (mom < -2 && acc < -1) event = 'accelerating_down';
      else if (mom > 0 && acc < -1) event = 'decelerating_up';
      else if (mom < 0 && acc > 1) event = 'decelerating_down';
      accelerationPattern.push({
        week: weekLabel,
        acceleration: round2(acc),
        event,
      });
    }

    // Last acceleration up/down (most recent events)
    let lastAccelerationUp: string | null = null;
    let lastAccelerationDown: string | null = null;
    for (let i = accelerationPattern.length - 1; i >= 0; i--) {
      const p = accelerationPattern[i]!;
      if (!lastAccelerationUp && p.event === 'accelerating_up') {
        lastAccelerationUp = p.week;
      }
      if (!lastAccelerationDown && p.event === 'accelerating_down') {
        lastAccelerationDown = p.week;
      }
      if (lastAccelerationUp && lastAccelerationDown) break;
    }

    // 8) Insights — acceleration trend (last 4 weeks vs previous 4 weeks)
    let accelerationTrend: AccelerationTrend = 'STABLE';
    if (sortedWeeks.length >= 8) {
      const recentAccel = computeAcceleration(priceSeries.slice(-8));
      if (recentAccel > 1) accelerationTrend = 'SPEEDING_UP';
      else if (recentAccel < -1) accelerationTrend = 'SLOWING_DOWN';
    }

    let advice = '';
    if (overallClass === 'ACCELERATING_UP') {
      advice = `Market ACCELERATING_UP (score ${overallScore}/100) — trend raste vse hitreje. Povečaj buying aktivnost${bestAcceleratingCategory ? ` posebej v kategoriji "${bestAcceleratingCategory}"` : ''}. Priložnost za izrabitev rastočega trenda.`;
    } else if (overallClass === 'DECELERATING_UP') {
      advice = `Market DECELERATING_UP (score ${overallScore}/100) — rast se upočasnjuje. Zmanjšaj buying hitrost — trend bo morda kmalu obrnil.`;
    } else if (overallClass === 'FLAT') {
      advice = `Market FLAT (score ${overallScore}/100) — ni pomembne spremembe. Vzdržuj trenutno strategijo in čakaj na signal.`;
    } else if (overallClass === 'DECELERATING_DOWN') {
      advice = `Market DECELERATING_DOWN (score ${overallScore}/100) — padec se zmanjšuje. Trend se morda bliža dnu — pripravi kapital za naslednji cikel.`;
    } else {
      advice = `Market ACCELERATING_DOWN (score ${overallScore}/100) — trend pada vse hitreje${worstDeceleratingCategory ? ` (kategorija "${worstDeceleratingCategory}")` : ''}. Zmanjšaj izpostavljenost in čakaj na signal za obrat.`;
    }

    return NextResponse.json({
      ok: true,
      overall: {
        accelerationScore: overallScore,
        classification: overallClass,
        summary: overallSummary,
      },
      metrics,
      byCategory,
      historical: {
        accelerationPattern,
        lastAccelerationUp,
        lastAccelerationDown,
      },
      insights: {
        accelerationTrend,
        bestAcceleratingCategory,
        worstDeceleratingCategory,
        advice: advice.slice(0, 500),
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-trend-acceleration-tracker',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
