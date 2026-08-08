// v7.88: Deal Quality Distribution Forecaster — forecast-a kako se bo
// distribution deal quality spremenil v naslednjih 30/60/90 dneh — ali bo
// market produciral več high-quality deal-ov ali manj? "Quality outlook:
// IMPROVING. High-quality deals: 32% → projected 38% in 30d. Best: elektronika
// (avg 58 → 62)."
//
// Razlika od deal-quality-distribution (ki da current snapshot) — ta
// FORECAST-a future distribution. Razlika od deal-quality-trend-analyzer
// (v7.83 ki analizira quality trend overall) — ta gleda DISTRIBUTION shift
// per quality bucket z 30/60/90d projection. Razlika od deal-quality-scorecard
// (v7.79 ki da quality scorecard) — ta forecast-a distribution shift.
// Razlika od deal-quality-forecaster (AI ki forecast-a day-of-week) — ta je
// pure DB distribution forecast čez 26 tednov. Razlika od deal-source-quality-
// tracker (v7.86 ki track-a quality per source) — ta gleda quality BUCKETS
// ne sources.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-quality-distribution-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type DistributionShift = 'TOWARD_HIGHER' | 'STABLE' | 'TOWARD_LOWER';
type QualityOutlook = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface QualityBucketDef {
  bucket: string;
  label: string;
  min: number;
  max: number;
}

interface BucketCount {
  bucket: string;
  label: string;
  count: number;
  percentage: number;
}

interface ProjectedBucket {
  bucket: string;
  count: number;
  percentage: number;
}

interface CurrentDistribution {
  distribution: BucketCount[];
  avgDealScore: number;
  highQualityRate: number; // % 50+
  lowQualityRate: number; // % <30
}

interface Trends {
  highQualityTrend: number; // slope of count of 50+ listings per week
  lowQualityTrend: number; // slope of count of <30 listings per week
  avgDealScoreTrend: number; // slope of avg dealScore per week
  distributionShift: DistributionShift;
}

interface Forecast {
  projectedDistribution30d: ProjectedBucket[];
  projectedDistribution60d: ProjectedBucket[];
  projectedDistribution90d: ProjectedBucket[];
  projectedAvgDealScore30d: number;
  projectedAvgDealScore60d: number;
  projectedAvgDealScore90d: number;
  projectedHighQualityRate30d: number;
  qualityOutlook: QualityOutlook;
}

interface CategoryForecast {
  category: string;
  currentAvgScore: number;
  projectedAvgScore30d: number;
  qualityOutlook: string;
}

interface Recommendations {
  bestImprovingCategory: string | null;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_180D = 180 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;
const WEEKS_26 = 26;

// 10 quality buckets 0-100 (10 points each)
const BUCKETS: QualityBucketDef[] = [
  { bucket: 'TERRIBLE', label: '0-10', min: 0, max: 10 },
  { bucket: 'POOR', label: '10-20', min: 10, max: 20 },
  { bucket: 'BELOW_AVG', label: '20-30', min: 20, max: 30 },
  { bucket: 'AVERAGE', label: '30-40', min: 30, max: 40 },
  { bucket: 'ABOVE_AVG', label: '40-50', min: 40, max: 50 },
  { bucket: 'GOOD', label: '50-60', min: 50, max: 60 },
  { bucket: 'GREAT', label: '60-70', min: 60, max: 70 },
  { bucket: 'EXCELLENT', label: '70-80', min: 70, max: 80 },
  { bucket: 'OUTSTANDING', label: '80-90', min: 80, max: 90 },
  { bucket: 'ELITE', label: '90-100', min: 90, max: 100 },
];

const HIGH_QUALITY_BUCKETS = new Set(
  BUCKETS.filter((b) => b.min >= 50).map((b) => b.bucket),
);
const LOW_QUALITY_BUCKETS = new Set(
  BUCKETS.filter((b) => b.max <= 30).map((b) => b.bucket),
);

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

// Linear regression slope (per index = per week)
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

// Assign a dealScore to a bucket
function bucketForScore(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  for (const b of BUCKETS) {
    if (clamped >= b.min && clamped < b.max) return b.bucket;
    if (b.bucket === 'ELITE' && clamped >= 90) return b.bucket;
  }
  return 'ELITE';
}

// --- Listing row ---------------------------------------------------------

interface ListingRow {
  dealScore: number | null;
  firstSeenAt: Date;
  monitor: { source: string | null } | null;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff180d = new Date(now - HORIZON_180D);

    // 1) Query all listings from last 180 days with dealScore + source
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff180d },
        dealScore: { not: null },
      },
      select: {
        dealScore: true,
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
        current: {
          distribution: BUCKETS.map((b) => ({
            bucket: b.bucket,
            label: b.label,
            count: 0,
            percentage: 0,
          })),
          avgDealScore: 0,
          highQualityRate: 0,
          lowQualityRate: 0,
        },
        trends: {
          highQualityTrend: 0,
          lowQualityTrend: 0,
          avgDealScoreTrend: 0,
          distributionShift: 'STABLE',
        },
        forecast: {
          projectedDistribution30d: BUCKETS.map((b) => ({
            bucket: b.bucket,
            count: 0,
            percentage: 0,
          })),
          projectedDistribution60d: BUCKETS.map((b) => ({
            bucket: b.bucket,
            count: 0,
            percentage: 0,
          })),
          projectedDistribution90d: BUCKETS.map((b) => ({
            bucket: b.bucket,
            count: 0,
            percentage: 0,
          })),
          projectedAvgDealScore30d: 0,
          projectedAvgDealScore60d: 0,
          projectedAvgDealScore90d: 0,
          projectedHighQualityRate30d: 0,
          qualityOutlook: 'STABLE',
        },
        byCategory: [],
        recommendations: {
          bestImprovingCategory: null,
          advice: 'Ni oglasov z dealScore v zadnjih 180 dneh — Deal Quality Distribution Forecaster ni mogoč.',
        },
        message: 'Ni oglasov z dealScore v zadnjih 180 dneh — Deal Quality Distribution Forecaster ni mogoč.',
      });
    }

    // 2) Group by ISO week (26 weeks back from now)
    const weekStartMs = (t: number): number => {
      const d = new Date(t);
      // Align to Monday
      const day = d.getDay(); // 0 = Sunday
      const diff = day === 0 ? -6 : 1 - day; // shift to Monday
      const monday = new Date(d);
      monday.setDate(d.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      return monday.getTime();
    };

    interface WeekAgg {
      weekMs: number;
      bucketCounts: Record<string, number>; // bucket → count
      totalListings: number;
      dealScoreSum: number;
      dealScoreCount: number;
    }

    const weekMap = new Map<number, WeekAgg>();
    for (const l of rows) {
      const seenMs = toMs(l.firstSeenAt);
      if (seenMs <= 0) continue;
      const wMs = weekStartMs(seenMs);
      let agg = weekMap.get(wMs);
      if (!agg) {
        agg = {
          weekMs: wMs,
          bucketCounts: {},
          totalListings: 0,
          dealScoreSum: 0,
          dealScoreCount: 0,
        };
        for (const b of BUCKETS) agg.bucketCounts[b.bucket] = 0;
        weekMap.set(wMs, agg);
      }
      const score = l.dealScore ?? 0;
      const bucket = bucketForScore(score);
      agg.bucketCounts[bucket] = (agg.bucketCounts[bucket] ?? 0) + 1;
      agg.totalListings += 1;
      agg.dealScoreSum += score;
      agg.dealScoreCount += 1;
    }

    // Sort weeks
    const sortedWeeks = Array.from(weekMap.values()).sort((a, b) => a.weekMs - b.weekMs);

    // 3) Compute distribution trends per bucket
    // For each bucket: count per week series
    const bucketSeries: Record<string, number[]> = {};
    for (const b of BUCKETS) bucketSeries[b.bucket] = [];

    const avgScoreSeries: number[] = [];

    for (const w of sortedWeeks) {
      for (const b of BUCKETS) {
        bucketSeries[b.bucket]!.push(w.bucketCounts[b.bucket] ?? 0);
      }
      avgScoreSeries.push(w.dealScoreCount > 0 ? w.dealScoreSum / w.dealScoreCount : 0);
    }

    // Per-bucket slope (per week)
    const bucketSlopes: Record<string, number> = {};
    for (const b of BUCKETS) {
      bucketSlopes[b.bucket] = trendSlope(bucketSeries[b.bucket]!);
    }

    // High-quality trend: sum of slopes for GOOD+ (50+) buckets
    const highQualityTrend = round2(
      BUCKETS.filter((b) => HIGH_QUALITY_BUCKETS.has(b.bucket))
        .reduce((s, b) => s + bucketSlopes[b.bucket]!, 0),
    );
    // Low-quality trend: sum of slopes for BELOW_AVG- (30-) buckets
    const lowQualityTrend = round2(
      BUCKETS.filter((b) => LOW_QUALITY_BUCKETS.has(b.bucket))
        .reduce((s, b) => s + bucketSlopes[b.bucket]!, 0),
    );
    // Avg dealScore trend (per week)
    const avgDealScoreTrend = round2(trendSlope(avgScoreSeries));

    // Distribution shift: TOWARD_HIGHER if high slope > low slope + 0.3, TOWARD_LOWER if opposite, else STABLE
    let distributionShift: DistributionShift = 'STABLE';
    if (highQualityTrend - lowQualityTrend > 0.3) {
      distributionShift = 'TOWARD_HIGHER';
    } else if (lowQualityTrend - highQualityTrend > 0.3) {
      distributionShift = 'TOWARD_LOWER';
    }

    // 4) Current distribution (last week or last 7 days)
    const lastWeek = sortedWeeks[sortedWeeks.length - 1]!;
    const totalCurrent = lastWeek.totalListings;
    const currentDistribution: BucketCount[] = BUCKETS.map((b) => {
      const count = lastWeek.bucketCounts[b.bucket] ?? 0;
      return {
        bucket: b.bucket,
        label: b.label,
        count,
        percentage: totalCurrent > 0 ? round1((count / totalCurrent) * 100) : 0,
      };
    });

    const currentAvgScore = lastWeek.dealScoreCount > 0
      ? round1(lastWeek.dealScoreSum / lastWeek.dealScoreCount)
      : 0;
    const highQualityCountCurrent = BUCKETS
      .filter((b) => HIGH_QUALITY_BUCKETS.has(b.bucket))
      .reduce((s, b) => s + (lastWeek.bucketCounts[b.bucket] ?? 0), 0);
    const lowQualityCountCurrent = BUCKETS
      .filter((b) => LOW_QUALITY_BUCKETS.has(b.bucket))
      .reduce((s, b) => s + (lastWeek.bucketCounts[b.bucket] ?? 0), 0);
    const currentHighQualityRate = totalCurrent > 0
      ? round1((highQualityCountCurrent / totalCurrent) * 100)
      : 0;
    const currentLowQualityRate = totalCurrent > 0
      ? round1((lowQualityCountCurrent / totalCurrent) * 100)
      : 0;

    // 5) Forecast future distribution
    // Project count per bucket in N weeks (30d = ~4.3 weeks, 60d = ~8.6, 90d = ~12.9)
    // Use last week count as base + slope × weeks ahead
    const projectWeeks = (daysAhead: number): number => daysAhead / 7;

    const projectBuckets = (daysAhead: number): ProjectedBucket[] => {
      const weeks = projectWeeks(daysAhead);
      const proj = BUCKETS.map((b) => {
        const lastCount = lastWeek.bucketCounts[b.bucket] ?? 0;
        const slope = bucketSlopes[b.bucket]!;
        let projected = lastCount + slope * weeks;
        projected = Math.max(0, projected);
        return {
          bucket: b.bucket,
          count: round0(projected),
          percentage: 0, // filled below
        };
      });
      const totalProj = proj.reduce((s, p) => s + p.count, 0);
      for (const p of proj) {
        p.percentage = totalProj > 0 ? round1((p.count / totalProj) * 100) : 0;
      }
      return proj;
    };

    const projectedDistribution30d = projectBuckets(30);
    const projectedDistribution60d = projectBuckets(60);
    const projectedDistribution90d = projectBuckets(90);

    // Projected avg score
    const projectedAvgDealScore30d = round1(
      Math.max(0, Math.min(100, currentAvgScore + avgDealScoreTrend * projectWeeks(30))),
    );
    const projectedAvgDealScore60d = round1(
      Math.max(0, Math.min(100, currentAvgScore + avgDealScoreTrend * projectWeeks(60))),
    );
    const projectedAvgDealScore90d = round1(
      Math.max(0, Math.min(100, currentAvgScore + avgDealScoreTrend * projectWeeks(90))),
    );

    // Projected high-quality rate (30d)
    const totalProj30d = projectedDistribution30d.reduce((s, p) => s + p.count, 0);
    const highQualityProj30d = projectedDistribution30d
      .filter((p) => HIGH_QUALITY_BUCKETS.has(p.bucket))
      .reduce((s, p) => s + p.count, 0);
    const projectedHighQualityRate30d = totalProj30d > 0
      ? round1((highQualityProj30d / totalProj30d) * 100)
      : 0;

    // Quality outlook: IMPROVING if highQualityTrend > 0.3, DECLINING if < -0.3, else STABLE
    let qualityOutlook: QualityOutlook = 'STABLE';
    if (highQualityTrend - lowQualityTrend > 0.3 && avgDealScoreTrend > 0) {
      qualityOutlook = 'IMPROVING';
    } else if (highQualityTrend - lowQualityTrend < -0.3 && avgDealScoreTrend < 0) {
      qualityOutlook = 'DECLINING';
    }

    // 6) Per-category distribution forecast
    // Group listings by source (Listing has no category field — use monitor.source)
    interface CatAgg {
      source: string;
      scores: number[]; // all dealScores in last 30 days
      recentScores: number[]; // last 30 days
      olderScores: number[]; // 30-180 days ago
    }
    const catMap = new Map<string, CatAgg>();
    const cutoff30d = new Date(now - 30 * DAY_MS);
    for (const l of rows) {
      const seenMs = toMs(l.firstSeenAt);
      const src = (l.monitor?.source ?? 'neznan').trim().toLowerCase() || 'neznan';
      let agg = catMap.get(src);
      if (!agg) {
        agg = { source: src, scores: [], recentScores: [], olderScores: [] };
        catMap.set(src, agg);
      }
      agg.scores.push(l.dealScore ?? 0);
      if (seenMs >= cutoff30d.getTime()) {
        agg.recentScores.push(l.dealScore ?? 0);
      } else {
        agg.olderScores.push(l.dealScore ?? 0);
      }
    }

    const byCategory: CategoryForecast[] = [];
    let bestImprovingCategory: string | null = null;
    let bestImprovementDelta = 0;
    for (const [, agg] of catMap.entries()) {
      const currentAvg = agg.recentScores.length > 0 ? avg(agg.recentScores) : 0;
      const olderAvg = agg.olderScores.length > 0 ? avg(agg.olderScores) : currentAvg;
      // Projected 30d = current + (current - older) × 1 (linear extrapolation)
      const delta = currentAvg - olderAvg;
      const projected = currentAvg + delta;
      const clampedProjected = Math.max(0, Math.min(100, projected));

      let outlook = 'STABLE';
      if (delta > 2) outlook = 'IMPROVING';
      else if (delta < -2) outlook = 'DECLINING';

      byCategory.push({
        category: agg.source,
        currentAvgScore: round1(currentAvg),
        projectedAvgScore30d: round1(clampedProjected),
        qualityOutlook: outlook,
      });

      if (delta > bestImprovementDelta && agg.recentScores.length >= 5) {
        bestImprovementDelta = delta;
        bestImprovingCategory = agg.source;
      }
    }
    byCategory.sort((a, b) => b.projectedAvgScore30d - a.projectedAvgScore30d);

    // 7) Recommendations
    let advice = '';
    if (qualityOutlook === 'IMPROVING') {
      advice = `Quality outlook IMPROVING — high-quality deals naraščajo (${currentHighQualityRate}% → ${projectedHighQualityRate30d}% v 30d). Povečaj buying aktivnost — incoming quality je visoka.`;
    } else if (qualityOutlook === 'DECLINING') {
      advice = `Quality outlook DECLINING — high-quality deals padajo (${currentHighQualityRate}% → ${projectedHighQualityRate30d}% v 30d). Bolj selektiven pri nabavi, čakaj boljše pogoje.`;
    } else {
      advice = `Quality outlook STABLE — high-quality deals ostajajo ${currentHighQualityRate}% tudi v 30d. Vzdržuj trenutno strategijo.`;
    }
    if (bestImprovingCategory) {
      advice += ` Best improving: ${bestImprovingCategory}.`;
    }

    return NextResponse.json({
      ok: true,
      current: {
        distribution: currentDistribution,
        avgDealScore: currentAvgScore,
        highQualityRate: currentHighQualityRate,
        lowQualityRate: currentLowQualityRate,
      },
      trends: {
        highQualityTrend,
        lowQualityTrend,
        avgDealScoreTrend,
        distributionShift,
      },
      forecast: {
        projectedDistribution30d,
        projectedDistribution60d,
        projectedDistribution90d,
        projectedAvgDealScore30d,
        projectedAvgDealScore60d,
        projectedAvgDealScore90d,
        projectedHighQualityRate30d,
        qualityOutlook,
      },
      byCategory,
      recommendations: {
        bestImprovingCategory,
        advice,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-quality-distribution-forecaster',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
