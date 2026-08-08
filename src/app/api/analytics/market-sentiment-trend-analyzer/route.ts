// v7.90: Market Sentiment Trend Analyzer — analizira kako SENTIMENT trga
// spreminja čez čas — track-a sentiment score trends čez tedne,
// identificira sentiment cikle in detektira sentiment turning points.
// Pure DB analytics (NO AI). "Sentiment: 72/100 (HOT), phase EXPANSION.
// Trend: +2.1/wk (IMPROVING). Last trough: W12. Next peak: ~W22."
//
// Razlika od market-sentiment-pulse (v7.75 ki da current snapshot) — ta
// track-a SENTIMENT TRENDS čez 26 tednov z turning points in cikli.
// Razlika od market-trend-momentum (v7.73 ki track-a momentum) — ta
// gleda SENTIMENT composite (5 signalov) ne enega metrike. Razlika od
// market-trend-acceleration-tracker (v7.89 ki track-a acceleration) — ta
// gleda sentiment phasing z RECOVERY/EXPANSION/PEAK/CONTRACTION/TROUGH.
// Razlika od market-cycle-detector (v7.77 ki klasificira Wyckoff phase)
// — ta gleda SENTIMENT specifično (ne price cycle). Razlika od
// market-cycle-phase-predictor (v7.87 ki predict-a phase transition)
// — ta je pure DB z sentiment cycle detection čez 26 tednov.
//
// GET /api/analytics/market-sentiment-trend-analyzer (Pure DB — NO AI)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type SentimentClassification = 'VERY_HOT' | 'HOT' | 'WARM' | 'COOL' | 'COLD';
type SentimentDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';
type SentimentPhase = 'RECOVERY' | 'EXPANSION' | 'PEAK' | 'CONTRACTION' | 'TROUGH';

interface CurrentSentiment {
  sentimentScore: number; // 0-100
  classification: SentimentClassification;
  currentSentimentPhase: SentimentPhase;
}

interface SentimentTrends {
  sentimentTrend26w: number; // slope per week
  sentimentTrend3m: number; // slope last 3 months (~13 weeks)
  sentimentDirection: SentimentDirection;
  sentimentVolatility: number; // stddev of weekly scores
  sentimentMomentum: number; // acceleration = slope second half - slope first half
}

interface WeeklyDataPoint {
  week: string; // ISO date (Monday)
  sentimentScore: number;
  classification: SentimentClassification;
  listingVelocity: number; // new listings that week
  sellThroughRate: number; // % (engagement rate)
  prilikaRate: number; // % PRILIKA listings
}

interface TurningPoint {
  week: string;
  score: number;
}

interface LastTurningPoint {
  week: string;
  direction: 'UP' | 'DOWN';
  score: number;
}

interface CycleAnalysis {
  avgSentimentCycleLength: number; // avg weeks between peaks
  sentimentCyclePosition: string;
  nextPredictedPeak: string | null; // ISO date or null
}

interface CategorySentimentTrend {
  category: string;
  currentSentiment: number;
  trend: number;
  direction: SentimentDirection;
  rank: number;
}

interface Insights {
  bestImprovingCategory: string | null;
  worstDecliningCategory: string | null;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_180D = 180 * DAY_MS;
const WEEKS_26 = 26;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / values.length);
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

// 2nd derivative: slope of second half - slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

function classifySentiment(score: number): SentimentClassification {
  if (score >= 80) return 'VERY_HOT';
  if (score >= 60) return 'HOT';
  if (score >= 40) return 'WARM';
  if (score >= 20) return 'COOL';
  return 'COLD';
}

// Determine sentiment phase based on trajectory + current position
function classifyPhase(
  currentScore: number,
  trend26w: number,
  acceleration: number,
  percentileRank: number, // 0-100 (where current sits vs past)
): SentimentPhase {
  // PEAK: high score + flat or negative trend
  if (currentScore >= 65 && trend26w <= 1) return 'PEAK';
  // TROUGH: low score + flat or positive trend
  if (currentScore <= 35 && trend26w >= -1) return 'TROUGH';
  // EXPANSION: improving trend + moderate-to-high score
  if (trend26w > 1 && currentScore >= 40) return 'EXPANSION';
  // RECOVERY: improving trend + low score (recovering from trough)
  if (trend26w > 0.5 && currentScore < 40) return 'RECOVERY';
  // CONTRACTION: declining trend
  if (trend26w < -0.5) return 'CONTRACTION';
  // Fallback — use percentile rank
  if (percentileRank >= 75) return 'PEAK';
  if (percentileRank <= 25) return 'TROUGH';
  return 'EXPANSION';
}

// --- Listing row ---------------------------------------------------------

interface ListingRow {
  id: string;
  price: number | null;
  dealScore: number | null;
  aiVerdict: string | null;
  firstSeenAt: Date;
  isBookmarked: boolean;
  contactStatus: string | null;
  monitor: { source: string | null } | null;
}

// --- Week aggregation ----------------------------------------------------

interface WeekAgg {
  weekMs: number;
  totalListings: number;
  pricedListings: number;
  priceSum: number;
  dealScoreSum: number;
  dealScoreCount: number;
  prilikaCount: number;
  bookmarkedCount: number;
  contactedCount: number;
}

function newWeekAgg(weekMs: number): WeekAgg {
  return {
    weekMs,
    totalListings: 0,
    pricedListings: 0,
    priceSum: 0,
    dealScoreSum: 0,
    dealScoreCount: 0,
    prilikaCount: 0,
    bookmarkedCount: 0,
    contactedCount: 0,
  };
}

// Compute weekly sentiment score using same logic as market-sentiment-pulse:
// listingVelocity 20% + priceTrend 20% + dealQualityTrend 15% + sellThroughRate 25% + prilikaRate 20%
// Adapted for per-week computation (vs previous week as "previous period")
function computeWeeklySentiment(
  weeks: WeekAgg[],
): Array<{ weekMs: number; sentimentScore: number; classification: SentimentClassification; listingVelocity: number; sellThroughRate: number; prilikaRate: number }> {
  const out: Array<{ weekMs: number; sentimentScore: number; classification: SentimentClassification; listingVelocity: number; sellThroughRate: number; prilikaRate: number }> = [];

  for (let i = 0; i < weeks.length; i++) {
    const cur = weeks[i]!;
    const prev = i > 0 ? weeks[i - 1] : null;

    // A: listing velocity normalized (0-100 at 20+ listings/day → /7 for /week)
    const listingVelocity = cur.totalListings; // raw count
    const listingVelocityNorm = Math.max(0, Math.min(100, (cur.totalListings / (20 * 7)) * 100));

    // B: price trend (% change vs previous week avg price)
    const curAvgPrice = cur.pricedListings > 0 ? cur.priceSum / cur.pricedListings : 0;
    const prevAvgPrice = prev && prev.pricedListings > 0 ? prev.priceSum / prev.pricedListings : curAvgPrice;
    let priceTrend = 0;
    if (prevAvgPrice > 0) priceTrend = ((curAvgPrice - prevAvgPrice) / prevAvgPrice) * 100;
    const priceTrendNorm = Math.max(0, Math.min(100, 50 + priceTrend * 2.5));

    // C: deal quality trend (avg dealScore change vs prev)
    const curAvgDeal = cur.dealScoreCount > 0 ? cur.dealScoreSum / cur.dealScoreCount : 0;
    const prevAvgDeal = prev && prev.dealScoreCount > 0 ? prev.dealScoreSum / prev.dealScoreCount : curAvgDeal;
    const dealQualityTrend = curAvgDeal - prevAvgDeal;
    const dealQualityNorm = Math.max(0, Math.min(100, 50 + dealQualityTrend * 5));

    // D: sell-through rate (engagement = bookmarked + contacted %)
    const activeInterest = cur.bookmarkedCount + cur.contactedCount;
    const sellThroughRate = cur.totalListings > 0 ? (activeInterest / cur.totalListings) * 100 : 0;
    const sellThroughNorm = Math.max(0, Math.min(100, sellThroughRate * 2));

    // E: prilika rate (% PRILIKA listings)
    const prilikaRate = cur.totalListings > 0 ? (cur.prilikaCount / cur.totalListings) * 100 : 0;
    const prilikaNorm = Math.max(0, Math.min(100, prilikaRate * 2));

    // Weighted composite
    const sentiment = round0(
      Math.max(SCORE_MIN, Math.min(SCORE_MAX,
        listingVelocityNorm * 0.20 +
        priceTrendNorm * 0.20 +
        dealQualityNorm * 0.15 +
        sellThroughNorm * 0.25 +
        prilikaNorm * 0.20,
      )),
    );

    out.push({
      weekMs: cur.weekMs,
      sentimentScore: sentiment,
      classification: classifySentiment(sentiment),
      listingVelocity,
      sellThroughRate: round1(sellThroughRate),
      prilikaRate: round1(prilikaRate),
    });
  }
  return out;
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
        isHidden: false,
      },
      select: {
        id: true,
        price: true,
        dealScore: true,
        aiVerdict: true,
        firstSeenAt: true,
        isBookmarked: true,
        contactStatus: true,
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
          sentimentScore: 0,
          classification: 'COLD' as SentimentClassification,
          currentSentimentPhase: 'TROUGH' as SentimentPhase,
        },
        trends: {
          sentimentTrend26w: 0,
          sentimentTrend3m: 0,
          sentimentDirection: 'STABLE' as SentimentDirection,
          sentimentVolatility: 0,
          sentimentMomentum: 0,
        },
        weeklyData: [],
        turningPoints: {
          sentimentPeaks: [],
          sentimentTroughs: [],
          lastTurningPoint: null,
        },
        cycleAnalysis: {
          avgSentimentCycleLength: 0,
          sentimentCyclePosition: 'UNKNOWN',
          nextPredictedPeak: null,
        },
        byCategory: [],
        insights: {
          bestImprovingCategory: null,
          worstDecliningCategory: null,
          advice: 'Ni oglasov v zadnjih 180 dneh — Market Sentiment Trend Analyzer ni mogoč.',
        },
        message: 'Ni oglasov v zadnjih 180 dneh — Market Sentiment Trend Analyzer ni mogoč.',
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
      if (l.price != null && l.price > 0) {
        agg.pricedListings += 1;
        agg.priceSum += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        agg.dealScoreSum += l.dealScore;
        agg.dealScoreCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') {
        agg.prilikaCount += 1;
      }
      if (l.isBookmarked) {
        agg.bookmarkedCount += 1;
      }
      if (l.contactStatus && l.contactStatus !== 'none' && l.contactStatus !== '') {
        agg.contactedCount += 1;
      }
    }

    // Sort weeks chronologically
    const sortedWeeks = Array.from(weekMap.values()).sort((a, b) => a.weekMs - b.weekMs);

    // 3) Compute weekly sentiment scores
    const weeklyComputed = computeWeeklySentiment(sortedWeeks);
    const sentimentSeries = weeklyComputed.map((w) => w.sentimentScore);

    // 4) Compute trend metrics
    const sentimentTrend26w = trendSlope(sentimentSeries);
    const last13w = sentimentSeries.slice(-13);
    const sentimentTrend3m = trendSlope(last13w);
    const sentimentVolatility = stddev(sentimentSeries);
    const sentimentMomentum = computeAcceleration(sentimentSeries);

    let sentimentDirection: SentimentDirection = 'STABLE';
    if (sentimentTrend26w > 0.5) sentimentDirection = 'IMPROVING';
    else if (sentimentTrend26w < -0.5) sentimentDirection = 'DECLINING';

    // 5) Current sentiment (most recent week)
    const currentWeek = weeklyComputed[weeklyComputed.length - 1]!;
    const currentSentimentScore = currentWeek.sentimentScore;
    const currentClassification = currentWeek.classification;

    // Percentile rank of current score vs all weekly scores
    const sortedScores = [...sentimentSeries].sort((a, b) => a - b);
    const rankBelow = sortedScores.filter((s) => s < currentSentimentScore).length;
    const percentileRank = round0((rankBelow / Math.max(1, sortedScores.length)) * 100);

    const currentSentimentPhase = classifyPhase(
      currentSentimentScore,
      sentimentTrend26w,
      sentimentMomentum,
      percentileRank,
    );

    // 6) Detect turning points (local maxima/minima)
    // A local maximum: score[i] > score[i-1] AND score[i] > score[i+1]
    // A local minimum: score[i] < score[i-1] AND score[i] < score[i+1]
    const sentimentPeaks: TurningPoint[] = [];
    const sentimentTroughs: TurningPoint[] = [];

    for (let i = 1; i < weeklyComputed.length - 1; i++) {
      const prev = weeklyComputed[i - 1]!;
      const cur = weeklyComputed[i]!;
      const next = weeklyComputed[i + 1]!;
      const weekLabel = new Date(cur.weekMs).toISOString().slice(0, 10);

      if (cur.sentimentScore > prev.sentimentScore && cur.sentimentScore > next.sentimentScore) {
        sentimentPeaks.push({ week: weekLabel, score: cur.sentimentScore });
      }
      if (cur.sentimentScore < prev.sentimentScore && cur.sentimentScore < next.sentimentScore) {
        sentimentTroughs.push({ week: weekLabel, score: cur.sentimentScore });
      }
    }
    // Edge case: include first/last week if they're extreme
    if (weeklyComputed.length >= 2) {
      const first = weeklyComputed[0]!;
      const second = weeklyComputed[1]!;
      const firstLabel = new Date(first.weekMs).toISOString().slice(0, 10);
      if (first.sentimentScore > second.sentimentScore) {
        sentimentPeaks.unshift({ week: firstLabel, score: first.sentimentScore });
      } else if (first.sentimentScore < second.sentimentScore) {
        sentimentTroughs.unshift({ week: firstLabel, score: first.sentimentScore });
      }
    }

    // Last turning point — most recent direction change
    let lastTurningPoint: LastTurningPoint | null = null;
    if (sentimentPeaks.length > 0 || sentimentTroughs.length > 0) {
      // Find the latest among peaks and troughs
      const latestPeak = sentimentPeaks.length > 0 ? sentimentPeaks[sentimentPeaks.length - 1] : null;
      const latestTrough = sentimentTroughs.length > 0 ? sentimentTroughs[sentimentTroughs.length - 1] : null;
      if (latestPeak && latestTrough) {
        if (latestPeak.week > latestTrough.week) {
          lastTurningPoint = { week: latestPeak.week, direction: 'UP', score: latestPeak.score };
        } else {
          lastTurningPoint = { week: latestTrough.week, direction: 'DOWN', score: latestTrough.score };
        }
      } else if (latestPeak) {
        lastTurningPoint = { week: latestPeak.week, direction: 'UP', score: latestPeak.score };
      } else if (latestTrough) {
        lastTurningPoint = { week: latestTrough.week, direction: 'DOWN', score: latestTrough.score };
      }
    }

    // 7) Cycle analysis — avg length between peaks
    let avgSentimentCycleLength = 0;
    if (sentimentPeaks.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < sentimentPeaks.length; i++) {
        const w1 = new Date(sentimentPeaks[i - 1]!.week).getTime();
        const w2 = new Date(sentimentPeaks[i]!.week).getTime();
        diffs.push(Math.max(1, (w2 - w1) / (7 * DAY_MS)));
      }
      avgSentimentCycleLength = round1(avg(diffs));
    } else if (sentimentTroughs.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < sentimentTroughs.length; i++) {
        const w1 = new Date(sentimentTroughs[i - 1]!.week).getTime();
        const w2 = new Date(sentimentTroughs[i]!.week).getTime();
        diffs.push(Math.max(1, (w2 - w1) / (7 * DAY_MS)));
      }
      avgSentimentCycleLength = round1(avg(diffs));
    }

    // Cycle position based on current phase + last turning point
    let sentimentCyclePosition = 'MID_CYCLE';
    if (currentSentimentPhase === 'RECOVERY') sentimentCyclePosition = 'EARLY_RECOVERY';
    else if (currentSentimentPhase === 'EXPANSION') {
      sentimentCyclePosition = percentileRank > 60 ? 'LATE_EXPANSION' : 'MID_EXPANSION';
    } else if (currentSentimentPhase === 'PEAK') sentimentCyclePosition = 'AT_PEAK';
    else if (currentSentimentPhase === 'CONTRACTION') sentimentCyclePosition = 'EARLY_CONTRACTION';
    else if (currentSentimentPhase === 'TROUGH') sentimentCyclePosition = 'AT_TROUGH';

    // Next predicted peak — based on avg cycle length + last peak
    let nextPredictedPeak: string | null = null;
    if (sentimentPeaks.length > 0 && avgSentimentCycleLength > 0) {
      const lastPeak = sentimentPeaks[sentimentPeaks.length - 1]!;
      const lastPeakMs = new Date(lastPeak.week).getTime();
      const predictedMs = lastPeakMs + avgSentimentCycleLength * 7 * DAY_MS;
      // Only suggest if in future
      if (predictedMs > now) {
        nextPredictedPeak = new Date(predictedMs).toISOString().slice(0, 10);
      }
    }

    // 8) Per-category sentiment trend (by monitor.source)
    interface CatWeeklyAgg extends WeekAgg {
      category: string;
    }
    const catWeekMap = new Map<string, Map<number, WeekAgg>>();
    for (const l of rows) {
      const seenMs = toMs(l.firstSeenAt);
      if (seenMs <= 0) continue;
      const src = (l.monitor?.source ?? 'neznan').trim().toLowerCase() || 'neznan';
      const wMs = weekStartMs(seenMs);
      let inner = catWeekMap.get(src);
      if (!inner) {
        inner = new Map<number, WeekAgg>();
        catWeekMap.set(src, inner);
      }
      let agg = inner.get(wMs);
      if (!agg) {
        agg = newWeekAgg(wMs);
        inner.set(wMs, agg);
      }
      agg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        agg.pricedListings += 1;
        agg.priceSum += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        agg.dealScoreSum += l.dealScore;
        agg.dealScoreCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') {
        agg.prilikaCount += 1;
      }
      if (l.isBookmarked) {
        agg.bookmarkedCount += 1;
      }
      if (l.contactStatus && l.contactStatus !== 'none' && l.contactStatus !== '') {
        agg.contactedCount += 1;
      }
    }

    const byCategory: CategorySentimentTrend[] = [];
    let bestImprovingCategory: string | null = null;
    let bestImprovingTrend = 0.3; // threshold
    let worstDecliningCategory: string | null = null;
    let worstDecliningTrend = -0.3;

    for (const [src, innerMap] of catWeekMap.entries()) {
      const sortedInner = Array.from(innerMap.values()).sort((a, b) => a.weekMs - b.weekMs);
      if (sortedInner.length < 4) continue; // need at least 4 weeks
      const computed = computeWeeklySentiment(sortedInner);
      const series = computed.map((w) => w.sentimentScore);
      const curSentiment = series[series.length - 1] ?? 0;
      const trend = trendSlope(series);

      let direction: SentimentDirection = 'STABLE';
      if (trend > 0.3) direction = 'IMPROVING';
      else if (trend < -0.3) direction = 'DECLINING';

      byCategory.push({
        category: src,
        currentSentiment: curSentiment,
        trend: round2(trend),
        direction,
        rank: 0, // set later
      });

      if (direction === 'IMPROVING' && trend > bestImprovingTrend) {
        bestImprovingTrend = trend;
        bestImprovingCategory = src;
      }
      if (direction === 'DECLINING' && trend < worstDecliningTrend) {
        worstDecliningTrend = trend;
        worstDecliningCategory = src;
      }
    }

    // Rank categories by current sentiment (1 = best)
    byCategory.sort((a, b) => b.currentSentiment - a.currentSentiment);
    byCategory.forEach((c, i) => { c.rank = i + 1; });

    // 9) Build weeklyData output
    const weeklyData: WeeklyDataPoint[] = weeklyComputed.map((w) => ({
      week: new Date(w.weekMs).toISOString().slice(0, 10),
      sentimentScore: w.sentimentScore,
      classification: w.classification,
      listingVelocity: w.listingVelocity,
      sellThroughRate: w.sellThroughRate,
      prilikaRate: w.prilikaRate,
    }));

    // 10) Advice based on phase + direction
    let advice = '';
    if (currentSentimentPhase === 'PEAK') {
      advice = `Sentiment ${currentSentimentScore}/100 (${currentClassification}), faza PEAK — trg je na vrhu cikla. Zmanjšaj buying aktivnost${worstDecliningCategory ? ` (izogibaj se "${worstDecliningCategory}")` : ''}, pripravi se na CONTRACTION.`;
    } else if (currentSentimentPhase === 'CONTRACTION') {
      advice = `Sentiment ${currentSentimentScore}/100 (${currentClassification}), faza CONTRACTION — trg upada. Zmanjšaj izpostavljenost${worstDecliningCategory ? ` (posebej "${worstDecliningCategory}")` : ''}, čakaj na RECOVERY signal.`;
    } else if (currentSentimentPhase === 'TROUGH') {
      advice = `Sentiment ${currentSentimentScore}/100 (${currentClassification}), faza TROUGH — trg je na dnu. Pripravi kapital za naslednji cikel, ${bestImprovingCategory ? `začni z "${bestImprovingCategory}" ` : 'povečaj buying aktivnost'}kot recovery signalizira.`;
    } else if (currentSentimentPhase === 'RECOVERY') {
      advice = `Sentiment ${currentSentimentScore}/100 (${currentClassification}), faza RECOVERY — trg se dviga iz dna. Povečaj buying aktivnost${bestImprovingCategory ? ` (posebej "${bestImprovingCategory}")` : ''}, izkoristi nizke cene.`;
    } else {
      // EXPANSION
      advice = `Sentiment ${currentSentimentScore}/100 (${currentClassification}), faza EXPANSION — trg raste${nextPredictedPeak ? `, napovedan PEAK ~${nextPredictedPeak}` : ''}. Povečaj buying in selling aktivnost${bestImprovingCategory ? ` (najboljši "${bestImprovingCategory}")` : ''}.`;
    }

    return NextResponse.json({
      ok: true,
      current: {
        sentimentScore: currentSentimentScore,
        classification: currentClassification,
        currentSentimentPhase,
      },
      trends: {
        sentimentTrend26w: round2(sentimentTrend26w),
        sentimentTrend3m: round2(sentimentTrend3m),
        sentimentDirection,
        sentimentVolatility: round2(sentimentVolatility),
        sentimentMomentum: round2(sentimentMomentum),
      },
      weeklyData,
      turningPoints: {
        sentimentPeaks,
        sentimentTroughs,
        lastTurningPoint,
      },
      cycleAnalysis: {
        avgSentimentCycleLength,
        sentimentCyclePosition,
        nextPredictedPeak,
      },
      byCategory,
      insights: {
        bestImprovingCategory,
        worstDecliningCategory,
        advice: advice.slice(0, 500),
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-sentiment-trend-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
