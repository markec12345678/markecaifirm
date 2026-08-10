// v7.74: Deal Quality Distribution Analyzer — analizira DISTRIBUCIJO deal
// quality score-ov čez vse listinge — ali so normalno distribuirani,
// skewed toward high/low quality, ali bimodal? "Deal quality: mean 52,
// LEFT_SKEWED (more high-quality). Top 25%: 65+. Elite deals: 12.
// Elektronika rank #1 (avg 58)."
//
// Razlika od deal-quality-forecaster (ki napove quality posameznega deal-a)
// — ta analizira DISTRIBUCIJO quality-ja čez vse listinge. Razlika od
// deal-scoring-model-v2 (ki score-a posamezne deal-e) — ta gleda
// statistiko distribucije (mean, median, stdDev, skewness, kurtosis).
// Razlika od deal-velocity (ki meri market temperature) — ta gleda
// quality distribucijo. Razlika od profit-distribution-optimizer (ki
// optimira profit distribucijo) — ta gleda deal quality distribucijo.
// Razlika od deal-profitability-matrix (ki gleda profit po kategorija×hold)
// — ta gleda quality score statistiko čez vse listinge.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-quality-distribution

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type DistributionType =
  | 'NORMAL'
  | 'RIGHT_SKEWED' // more low-quality (tail on right would be high, so right-skewed = mean > median, more low quality)
  | 'LEFT_SKEWED' // more high-quality
  | 'BIMODAL'
  | 'UNIFORM';

type QualityTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface Distribution {
  mean: number;
  median: number;
  mode: string; // bucket name
  stdDev: number;
  skewness: number;
  kurtosis: number;
  distributionType: DistributionType;
}

interface Bucket {
  range: string; // "0-10"
  label: string; // "TERRIBLE"
  count: number;
  percentage: number;
  cumulativePercentage: number;
}

interface CategoryDistribution {
  category: string;
  mean: number;
  median: number;
  stdDev: number;
  distributionType: string;
  eliteCount: number; // 90+ deals
  qualityRank: number; // 1 = best quality
}

interface Insights {
  topQuartileThreshold: number;
  eliteDealsCount: number;
  poorDealsCount: number; // <20 score
  qualityTrend: QualityTrend;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const ANALYSIS_PERIOD_DAYS = 90;

// Deal score buckets: 0-10, 10-20, ..., 90-100
interface BucketDef {
  range: string;
  label: string;
  min: number;
  max: number;
}
const BUCKETS: BucketDef[] = [
  { range: '0-10', label: 'TERRIBLE', min: 0, max: 10 },
  { range: '10-20', label: 'POOR', min: 10, max: 20 },
  { range: '20-30', label: 'BELOW_AVG', min: 20, max: 30 },
  { range: '30-40', label: 'AVERAGE', min: 30, max: 40 },
  { range: '40-50', label: 'ABOVE_AVG', min: 40, max: 50 },
  { range: '50-60', label: 'GOOD', min: 50, max: 60 },
  { range: '60-70', label: 'GREAT', min: 60, max: 70 },
  { range: '70-80', label: 'EXCELLENT', min: 70, max: 80 },
  { range: '80-90', label: 'OUTSTANDING', min: 80, max: 90 },
  { range: '90-100', label: 'ELITE', min: 90, max: 100 },
];

// --- Helpers -------------------------------------------------------------

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// Skewness (Fisher-Pearson): (1/n) * Σ((x - mean)/stdDev)^3
function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const m = mean(arr);
  const sd = stdDev(arr);
  if (sd === 0) return 0;
  const sum = arr.reduce((s, v) => s + ((v - m) / sd) ** 3, 0);
  return sum / arr.length;
}

// Excess kurtosis: (1/n) * Σ((x - mean)/stdDev)^4 - 3
// Positive = leptokurtic (peaked), Negative = platykurtic (flat)
function kurtosis(arr: number[]): number {
  if (arr.length < 4) return 0;
  const m = mean(arr);
  const sd = stdDev(arr);
  if (sd === 0) return 0;
  const sum = arr.reduce((s, v) => s + ((v - m) / sd) ** 4, 0);
  return sum / arr.length - 3;
}

// Classify distribution shape from skewness, kurtosis, and bucket histogram
function classifyDistribution(
  skew: number,
  kurt: number,
  bucketCounts: number[],
): DistributionType {
  const total = bucketCounts.reduce((s, c) => s + c, 0);
  if (total === 0) return 'UNIFORM';

  // Detect bimodal: two peaks separated by a valley
  // A peak = bucket higher than both neighbors
  const peaks: number[] = [];
  for (let i = 0; i < bucketCounts.length; i++) {
    const prev = i > 0 ? bucketCounts[i - 1]! : 0;
    const curr = bucketCounts[i]!;
    const next = i < bucketCounts.length - 1 ? bucketCounts[i + 1]! : 0;
    if (curr > prev && curr > next && curr > total * 0.1) {
      peaks.push(i);
    }
  }
  if (peaks.length >= 2) {
    // Check that the peaks are separated by a valley (not adjacent)
    const minDist = 2;
    let bimodal = false;
    for (let i = 1; i < peaks.length; i++) {
      if (peaks[i]! - peaks[i - 1]! >= minDist) {
        bimodal = true;
        break;
      }
    }
    if (bimodal) return 'BIMODAL';
  }

  // Skewness thresholds
  const skewThreshold = 0.5;
  if (skew > skewThreshold) return 'RIGHT_SKEWED'; // long tail on right (more low-quality deals, few very high)
  if (skew < -skewThreshold) return 'LEFT_SKEWED'; // long tail on left (more high-quality)

  // Kurtosis check: very negative = uniform-like (flat)
  if (kurt < -1) return 'UNIFORM';

  return 'NORMAL';
}

// Find bucket with max count (mode)
function findModeBucket(bucketCounts: number[]): string {
  let maxIdx = 0;
  let maxCount = -1;
  for (let i = 0; i < bucketCounts.length; i++) {
    if (bucketCounts[i]! > maxCount) {
      maxCount = bucketCounts[i]!;
      maxIdx = i;
    }
  }
  return BUCKETS[maxIdx]?.label ?? 'AVERAGE';
}

// Compute top quartile threshold (75th percentile)
function topQuartile(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all listings with dealScore from last 90 days
    const cutoff = new Date(Date.now() - ANALYSIS_PERIOD_DAYS * DAY_MS);
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
        dealScore: { not: null },
      },
      select: {
        id: true,
        dealScore: true,
        firstSeenAt: true,
        monitor: { select: { source: true } },
      },
      take: 50000,
    });

    // Filter to listings with valid dealScore (0-100)
    const allScores: number[] = [];
    interface ScoreRow {
      score: number;
      firstSeenMs: number;
      cat: string;
    }
    const scoreRows: ScoreRow[] = [];

    for (const l of listings) {
      const score = l.dealScore;
      if (score == null || score < 0 || score > 100) continue;
      allScores.push(score);
      const firstSeenMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
      const cat = `vir:${(l.monitor?.source || '').trim().toLowerCase() || 'neznan'}`;
      scoreRows.push({ score, firstSeenMs, cat });
    }

    // Empty state
    if (allScores.length === 0) {
      return NextResponse.json({
        ok: true,
        distribution: {
          mean: 0,
          median: 0,
          mode: 'AVERAGE',
          stdDev: 0,
          skewness: 0,
          kurtosis: 0,
          distributionType: 'UNIFORM',
        },
        buckets: BUCKETS.map((b) => ({
          range: b.range,
          label: b.label,
          count: 0,
          percentage: 0,
          cumulativePercentage: 0,
        })),
        byCategory: [],
        insights: {
          topQuartileThreshold: 0,
          eliteDealsCount: 0,
          poorDealsCount: 0,
          qualityTrend: 'STABLE',
          advice: 'Ni listing-ov z dealScore v zadnjih 90 dneh — Deal Quality Distribution ni mogoč.',
        },
        message: 'Ni listing-ov z dealScore — Deal Quality Distribution ni mogoč.',
      });
    }

    // 2) Build buckets
    const bucketCounts = new Array(BUCKETS.length).fill(0);
    for (const score of allScores) {
      // Find bucket: scores in [min, max) for first 9, [min, max] for last
      for (let i = 0; i < BUCKETS.length; i++) {
        const b = BUCKETS[i]!;
        if (i === BUCKETS.length - 1) {
          if (score >= b.min && score <= b.max) {
            bucketCounts[i]! += 1;
            break;
          }
        } else if (score >= b.min && score < b.max) {
          bucketCounts[i]! += 1;
          break;
        }
      }
    }

    const totalListings = allScores.length;
    const buckets: Bucket[] = [];
    let cumulative = 0;
    for (let i = 0; i < BUCKETS.length; i++) {
      const b = BUCKETS[i]!;
      const count = bucketCounts[i]!;
      cumulative += count;
      const percentage = (count / totalListings) * 100;
      const cumulativePercentage = (cumulative / totalListings) * 100;
      buckets.push({
        range: b.range,
        label: b.label,
        count,
        percentage: Math.round(percentage * 10) / 10,
        cumulativePercentage: Math.round(cumulativePercentage * 10) / 10,
      });
    }

    // 3) Compute distribution statistics
    const distMean = mean(allScores);
    const distMedian = median(allScores);
    const distMode = findModeBucket(bucketCounts);
    const distStdDev = stdDev(allScores);
    const distSkewness = skewness(allScores);
    const distKurtosis = kurtosis(allScores);
    const distributionType = classifyDistribution(
      distSkewness,
      distKurtosis,
      bucketCounts,
    );

    const distribution: Distribution = {
      mean: Math.round(distMean * 100) / 100,
      median: Math.round(distMedian * 100) / 100,
      mode: distMode,
      stdDev: Math.round(distStdDev * 100) / 100,
      skewness: Math.round(distSkewness * 1000) / 1000,
      kurtosis: Math.round(distKurtosis * 1000) / 1000,
      distributionType,
    };

    // 4) Per-category distribution
    const catScores = new Map<string, number[]>();
    for (const row of scoreRows) {
      const existing = catScores.get(row.cat) || [];
      existing.push(row.score);
      catScores.set(row.cat, existing);
    }

    const byCategory: CategoryDistribution[] = [];
    for (const [cat, scores] of catScores.entries()) {
      if (scores.length < 3) continue; // need at least 3 listings for meaningful stats

      const catMean = mean(scores);
      const catMedian = median(scores);
      const catStdDev = stdDev(scores);
      const catSkewness = skewness(scores);
      const catKurtosis = kurtosis(scores);

      // Build cat buckets
      const catBucketCounts = new Array(BUCKETS.length).fill(0);
      for (const score of scores) {
        for (let i = 0; i < BUCKETS.length; i++) {
          const b = BUCKETS[i]!;
          if (i === BUCKETS.length - 1) {
            if (score >= b.min && score <= b.max) {
              catBucketCounts[i]! += 1;
              break;
            }
          } else if (score >= b.min && score < b.max) {
            catBucketCounts[i]! += 1;
            break;
          }
        }
      }
      const catDistType = classifyDistribution(catSkewness, catKurtosis, catBucketCounts);
      const eliteCount = scores.filter((s) => s >= 90).length;

      byCategory.push({
        category: cat,
        mean: Math.round(catMean * 100) / 100,
        median: Math.round(catMedian * 100) / 100,
        stdDev: Math.round(catStdDev * 100) / 100,
        distributionType: catDistType,
        eliteCount,
        qualityRank: 0, // assigned after sort
      });
    }

    // Sort by mean desc and assign qualityRank
    byCategory.sort((a, b) => b.mean - a.mean);
    byCategory.forEach((c, i) => {
      c.qualityRank = i + 1;
    });

    // 5) Quality trend: last 4 weeks vs previous 4 weeks (mean dealScore)
    const now = Date.now();
    const last4Cutoff = new Date(now - 28 * DAY_MS);
    const prev4Cutoff = new Date(now - 56 * DAY_MS);
    const last4Scores: number[] = [];
    const prev4Scores: number[] = [];
    for (const row of scoreRows) {
      if (row.firstSeenMs >= last4Cutoff.getTime()) {
        last4Scores.push(row.score);
      } else if (row.firstSeenMs >= prev4Cutoff.getTime()) {
        prev4Scores.push(row.score);
      }
    }
    const last4Mean = mean(last4Scores);
    const prev4Mean = mean(prev4Scores);
    let qualityTrend: QualityTrend = 'STABLE';
    if (prev4Mean > 0) {
      const change = last4Mean - prev4Mean;
      if (change > 3) qualityTrend = 'IMPROVING';
      else if (change < -3) qualityTrend = 'DECLINING';
    }

    // 6) Quality insights
    const topQuartileThreshold = topQuartile(allScores);
    const eliteDealsCount = allScores.filter((s) => s >= 90).length;
    const poorDealsCount = allScores.filter((s) => s < 20).length;

    let advice: string;
    if (distributionType === 'BIMODAL') {
      advice = `Deal quality je BIMODAL — trg ima dva skupina listingov (visoki in nizki quality). Fokus na top 25% (score ≥ ${topQuartileThreshold}).`;
    } else if (distributionType === 'LEFT_SKEWED') {
      advice = `Deal quality je LEFT_SKEWED (večina visoko-kakovostnih). ${eliteDealsCount} elite deals (90+). Fokus na ${byCategory[0]?.category ?? 'top'} kategorijo (rank #1).`;
    } else if (distributionType === 'RIGHT_SKEWED') {
      advice = `Deal quality je RIGHT_SKEWED (večina nizko-kakovostnih). ${poorDealsCount} slabih deals (<20). Premisli bolj selektivno nabavo ali AI scoring threshold.`;
    } else if (distributionType === 'UNIFORM') {
      advice = `Deal quality je enakomerno distribuiran (UNIFORM) — trg nima izrazitih quality skupin. Fokus na individual deal scoring.`;
    } else {
      advice = `Deal quality je NORMALNO distribuiran (mean ${distMean.toFixed(0)}, median ${distMedian.toFixed(0)}). Top 25% threshold: ${topQuartileThreshold}+. ${eliteDealsCount} elite deals.`;
    }
    if (qualityTrend === 'IMPROVING') {
      advice += ' Trend: kvaliteta raste (zadnje 4 tedne boljši kot prejšnje).';
    } else if (qualityTrend === 'DECLINING') {
      advice += ' Trend: kvaliteta pada (zadnje 4 tedne slabši) — pregledaj AI scoring threshold.';
    }

    const insights: Insights = {
      topQuartileThreshold,
      eliteDealsCount,
      poorDealsCount,
      qualityTrend,
      advice,
    };

    return NextResponse.json({
      ok: true,
      distribution,
      buckets,
      byCategory,
      insights,
    });
  } catch (err: any) {
    logger.error('/api/analytics/deal-quality-distribution', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
