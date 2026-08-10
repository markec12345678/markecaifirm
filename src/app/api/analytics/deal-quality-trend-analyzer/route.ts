// v7.83: Deal Quality Trend Analyzer — analizira kako se deal QUALITY
// spreminja čez čas — ali trg producira boljše ali slabše deal-e? Track-a
// dealScore, estValue accuracy, in prilika rate trends. Pure DB analytics —
// NO AI. "Quality trend: IMPROVING (+1.2/wk, momentum +0.3). Prilika rate:
// 32% (+5%/mo). Best: elektronika (+2.1/wk)."
//
// Razlika od deal-quality-distribution (v7.74, snapshot distribucije
// dealScore) — ta analizira TREND quality-ja čez 26 tednov z linear
// regression + momentum. Razlika od deal-quality-forecaster (v7.79, AI ki
// napove quality posameznega deal-a po dnevu tedna) — ta gleda HISTORICAL
// quality trend čez celoten portfelj z direction (IMPROVING/STABLE/
// DECLINING). Razlika od deal-quality-scorecard (v7.79, ki score-a
// posamezne deal-e) — ta gleda aggregate quality trend z byCategory
// ranking. Razlika od deal-conversion-funnel-analyzer (ki gleda
// conversion) — ta gleda quality SCORE trend in prilika rate trend.
// Razlika od deal-velocity (ki meri market temperature) — ta gleda
// QUALITY direction z momentum in volatility.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-quality-trend-analyzer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type QualityDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';
type OpportunityOutlook = 'INCREASING' | 'STABLE' | 'DECREASING';

interface QualityTrend {
  currentDealScore: number;
  avgDealScore26w: number;
  bestDealScore26w: number;
  dealScoreTrend: number; // slope (per week)
  dealScoreTrend3m: number; // slope over last 3 months (~13 weeks)
  qualityDirection: QualityDirection;
  qualityVolatility: number; // std dev of weekly dealScores
  qualityMomentum: number; // acceleration: recent13 slope - prior13 slope
}

interface WeeklyDatum {
  week: string; // "2026-W01"
  avgDealScore: number;
  avgAiScore: number;
  avgAiRisk: number;
  prilikaRate: number; // % listings with aiVerdict = 'PRILIKA'
  avgEstValue: number;
  listingCount: number;
}

interface CategoryTrend {
  category: string;
  currentDealScore: number;
  trend26w: number; // slope
  direction: QualityDirection;
  qualityRank: number; // 1 = best improving trend
}

interface PrilikaAnalysis {
  currentPrilikaRate: number;
  prilikaTrend: number; // slope over 26 weeks
  bestPrilikaWeek: { week: string; rate: number } | null;
  opportunityOutlook: OpportunityOutlook;
}

interface QualityInsights {
  qualityPercentile: number; // 0-100
  bestImprovingCategory: string | null;
  worstDecliningCategory: string | null;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_180D = 180 * DAY_MS;

// --- Math helpers --------------------------------------------------------

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

// Linear slope — positive = increasing
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

function classifyDirection(
  slope: number,
  threshold: number,
): QualityDirection {
  if (slope > threshold) return 'IMPROVING';
  if (slope < -threshold) return 'DECLINING';
  return 'STABLE';
}

function classifyOutlook(slope: number, threshold: number): OpportunityOutlook {
  if (slope > threshold) return 'INCREASING';
  if (slope < -threshold) return 'DECREASING';
  return 'STABLE';
}

// ISO week key (YYYY-Www)
function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

function isoWeekStart(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1; // shift to Mon=0
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset),
  );
  return start.getTime();
}

// --- Weekly aggregation --------------------------------------------------

interface WeekAgg {
  weekMs: number;
  weekKey: string;
  dealScoreSum: number;
  dealScoreCount: number;
  aiScoreSum: number;
  aiScoreCount: number;
  aiRiskSum: number;
  aiRiskCount: number;
  prilikaCount: number;
  totalListings: number;
  estValueSum: number;
  estValueCount: number;
}

function buildWeekAggregates(
  listings: Array<{
    dealScore: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    aiVerdict: string | null;
    aiEstimatedValue: number | null;
    firstSeenAt: Date;
    monitor: { source: string | null } | null;
  }>,
): Map<number, WeekAgg> {
  const map = new Map<number, WeekAgg>();
  for (const l of listings) {
    const firstSeenMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
    if (!Number.isFinite(firstSeenMs)) continue;
    const weekMs = isoWeekStart(firstSeenMs);
    let a = map.get(weekMs);
    if (!a) {
      a = {
        weekMs,
        weekKey: isoWeekKey(weekMs),
        dealScoreSum: 0,
        dealScoreCount: 0,
        aiScoreSum: 0,
        aiScoreCount: 0,
        aiRiskSum: 0,
        aiRiskCount: 0,
        prilikaCount: 0,
        totalListings: 0,
        estValueSum: 0,
        estValueCount: 0,
      };
      map.set(weekMs, a);
    }
    a.totalListings += 1;
    if (l.dealScore != null && l.dealScore > 0) {
      a.dealScoreSum += l.dealScore;
      a.dealScoreCount += 1;
    }
    if (l.aiScore != null && l.aiScore > 0) {
      a.aiScoreSum += l.aiScore;
      a.aiScoreCount += 1;
    }
    if (l.aiRisk != null && l.aiRisk > 0) {
      a.aiRiskSum += l.aiRisk;
      a.aiRiskCount += 1;
    }
    if (l.aiVerdict === 'PRILIKA') {
      a.prilikaCount += 1;
    }
    if (l.aiEstimatedValue != null && l.aiEstimatedValue > 0) {
      a.estValueSum += l.aiEstimatedValue;
      a.estValueCount += 1;
    }
  }
  return map;
}

function finalizeWeek(a: WeekAgg): WeeklyDatum {
  return {
    week: a.weekKey,
    avgDealScore: a.dealScoreCount > 0 ? round1(a.dealScoreSum / a.dealScoreCount) : 0,
    avgAiScore: a.aiScoreCount > 0 ? round1(a.aiScoreSum / a.aiScoreCount) : 0,
    avgAiRisk: a.aiRiskCount > 0 ? round1(a.aiRiskSum / a.aiRiskCount) : 0,
    prilikaRate:
      a.totalListings > 0
        ? round1((a.prilikaCount / a.totalListings) * 100)
        : 0,
    avgEstValue: a.estValueCount > 0 ? round0(a.estValueSum / a.estValueCount) : 0,
    listingCount: a.totalListings,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff = new Date(now - HORIZON_180D);

    // 1) Query listings from last 180 days with quality-related fields
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        dealScore: true,
        aiScore: true,
        aiRisk: true,
        aiVerdict: true,
        aiEstimatedValue: true,
        firstSeenAt: true,
        monitor: { select: { source: true } },
      },
      take: 200000,
    });

    const emptyResponse = {
      ok: true,
      trend: {
        currentDealScore: 0,
        avgDealScore26w: 0,
        bestDealScore26w: 0,
        dealScoreTrend: 0,
        dealScoreTrend3m: 0,
        qualityDirection: 'STABLE' as QualityDirection,
        qualityVolatility: 0,
        qualityMomentum: 0,
      },
      weeklyData: [] as WeeklyDatum[],
      byCategory: [] as CategoryTrend[],
      prilikaAnalysis: {
        currentPrilikaRate: 0,
        prilikaTrend: 0,
        bestPrilikaWeek: null as { week: string; rate: number } | null,
        opportunityOutlook: 'STABLE' as OpportunityOutlook,
      },
      insights: {
        qualityPercentile: 0,
        bestImprovingCategory: null,
        worstDecliningCategory: null,
        advice:
          'Ni listing-ov v zadnjih 180 dneh — Deal Quality Trend Analyzer ni mogoč.',
      },
      message:
        'Ni listing-ov v zadnjih 180 dneh — Deal Quality Trend Analyzer ni mogoč.',
    };

    if (listings.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 2) Build weekly aggregates
    const weekMap = buildWeekAggregates(listings);
    const sortedWeeks = Array.from(weekMap.keys()).sort((a, b) => a - b);

    // Need at least 4 weeks for trend analysis
    if (sortedWeeks.length < 4) {
      return NextResponse.json({
        ok: true,
        trend: {
          currentDealScore: 0,
          avgDealScore26w: 0,
          bestDealScore26w: 0,
          dealScoreTrend: 0,
          dealScoreTrend3m: 0,
          qualityDirection: 'STABLE' as QualityDirection,
          qualityVolatility: 0,
          qualityMomentum: 0,
        },
        weeklyData: sortedWeeks.map((wk) =>
          finalizeWeek(weekMap.get(wk)!),
        ),
        byCategory: [] as CategoryTrend[],
        prilikaAnalysis: {
          currentPrilikaRate: 0,
          prilikaTrend: 0,
          bestPrilikaWeek: null,
          opportunityOutlook: 'STABLE' as OpportunityOutlook,
        },
        insights: {
          qualityPercentile: 0,
          bestImprovingCategory: null,
          worstDecliningCategory: null,
          advice: `Premalo tedenskih podatkov (${sortedWeeks.length} tednov) — zberi vsaj 4 tedne za zanesljiv quality trend.`,
        },
        message: `Premalo tedenskih podatkov (${sortedWeeks.length} tednov) — Deal Quality Trend Analyzer ni zanesljiv.`,
      });
    }

    // Take last 26 weeks (or all if fewer)
    const last26Weeks = sortedWeeks.slice(-26);
    const weeklyData: WeeklyDatum[] = last26Weeks.map((wk) =>
      finalizeWeek(weekMap.get(wk)!),
    );

    // 3) Compute quality trend metrics
    const dealScores = last26Weeks.map((wk) => {
      const a = weekMap.get(wk)!;
      return a.dealScoreCount > 0 ? a.dealScoreSum / a.dealScoreCount : 0;
    });

    const currentDealScore =
      dealScores.length > 0 ? round1(dealScores[dealScores.length - 1]!) : 0;
    const avgDealScore26w =
      dealScores.length > 0 ? round1(avg(dealScores)) : 0;
    const bestDealScore26w =
      dealScores.length > 0 ? round1(Math.max(...dealScores)) : 0;

    const dealScoreTrend = round2(trendSlope(dealScores));

    // 3-month trend: last 13 weeks
    const last13WeeksKeys = sortedWeeks.slice(-13);
    const last13DealScores = last13WeeksKeys.map((wk) => {
      const a = weekMap.get(wk)!;
      return a.dealScoreCount > 0 ? a.dealScoreSum / a.dealScoreCount : 0;
    });
    const dealScoreTrend3m = round2(trendSlope(last13DealScores));

    // Direction: trend > 0.2 = IMPROVING, < -0.2 = DECLINING
    const qualityDirection = classifyDirection(dealScoreTrend, 0.2);

    // Volatility
    const qualityVolatility =
      dealScores.length > 1 ? round1(stdDev(dealScores)) : 0;

    // Momentum: (slope of last 13) - (slope of prior 13)
    const prior13WeeksKeys = sortedWeeks.slice(-26, -13);
    const prior13DealScores = prior13WeeksKeys.length >= 2
      ? prior13WeeksKeys.map((wk) => {
          const a = weekMap.get(wk)!;
          return a.dealScoreCount > 0 ? a.dealScoreSum / a.dealScoreCount : 0;
        })
      : last13DealScores;
    const recent13Slope = trendSlope(last13DealScores);
    const prior13Slope =
      prior13DealScores.length >= 2 ? trendSlope(prior13DealScores) : 0;
    const qualityMomentum = round2(recent13Slope - prior13Slope);

    const trend: QualityTrend = {
      currentDealScore,
      avgDealScore26w,
      bestDealScore26w,
      dealScoreTrend,
      dealScoreTrend3m,
      qualityDirection,
      qualityVolatility,
      qualityMomentum,
    };

    // 4) Per-category quality trend
    interface CatWeekAgg {
      dealScoreSum: number;
      dealScoreCount: number;
    }
    interface CatAgg {
      category: string;
      weeks: Map<string, CatWeekAgg>;
    }
    const catMap = new Map<string, CatAgg>();
    for (const l of listings) {
      const firstSeenMs = new Date(
        l.firstSeenAt as unknown as Date | string,
      ).getTime();
      if (!Number.isFinite(firstSeenMs)) continue;
      const wKey = isoWeekKey(firstSeenMs);
      const cat =
        (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      let c = catMap.get(cat);
      if (!c) {
        c = { category: cat, weeks: new Map() };
        catMap.set(cat, c);
      }
      let m = c.weeks.get(wKey);
      if (!m) {
        m = { dealScoreSum: 0, dealScoreCount: 0 };
        c.weeks.set(wKey, m);
      }
      if (l.dealScore != null && l.dealScore > 0) {
        m.dealScoreSum += l.dealScore;
        m.dealScoreCount += 1;
      }
    }

    const byCategoryRaw: Array<{
      category: string;
      currentDealScore: number;
      trend26w: number;
      direction: QualityDirection;
    }> = [];

    for (const c of catMap.values()) {
      const sortedMonths = Array.from(c.weeks.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      if (sortedMonths.length < 2) continue;
      const weeklyScores = sortedMonths.map(([, m]) =>
        m.dealScoreCount > 0 ? m.dealScoreSum / m.dealScoreCount : 0,
      );
      // Skip categories with too few scored listings
      const totalScored = sortedMonths.reduce(
        (s, [, m]) => s + m.dealScoreCount,
        0,
      );
      if (totalScored < 3) continue;

      // Current = last 4 weeks avg
      const last4 = weeklyScores.slice(-4);
      const currentScore =
        last4.length > 0 ? round1(avg(last4)) : 0;
      const catTrend = round2(trendSlope(weeklyScores));
      const direction = classifyDirection(catTrend, 0.2);

      byCategoryRaw.push({
        category: c.category,
        currentDealScore: currentScore,
        trend26w: catTrend,
        direction,
      });
    }

    // Sort by trend26w desc (best improving first), assign rank
    byCategoryRaw.sort((a, b) => b.trend26w - a.trend26w);
    const byCategory: CategoryTrend[] = byCategoryRaw.map((c, i) => ({
      category: c.category,
      currentDealScore: c.currentDealScore,
      trend26w: c.trend26w,
      direction: c.direction,
      qualityRank: i + 1,
    }));

    // 5) Prilika trend analysis
    const prilikaRates = last26Weeks.map((wk) => {
      const a = weekMap.get(wk)!;
      return a.totalListings > 0
        ? (a.prilikaCount / a.totalListings) * 100
        : 0;
    });
    const currentPrilikaRate =
      prilikaRates.length > 0 ? round1(prilikaRates[prilikaRates.length - 1]!) : 0;
    const prilikaTrend = round2(trendSlope(prilikaRates));

    // Best prilika week (highest rate with at least 5 listings to be meaningful)
    let bestPrilikaWeek: { week: string; rate: number } | null = null;
    let bestRate = -1;
    for (const wk of last26Weeks) {
      const a = weekMap.get(wk)!;
      if (a.totalListings < 5) continue;
      const rate = (a.prilikaCount / a.totalListings) * 100;
      if (rate > bestRate) {
        bestRate = rate;
        bestPrilikaWeek = {
          week: a.weekKey,
          rate: round1(rate),
        };
      }
    }

    const opportunityOutlook = classifyOutlook(prilikaTrend, 0.2);

    const prilikaAnalysis: PrilikaAnalysis = {
      currentPrilikaRate,
      prilikaTrend,
      bestPrilikaWeek,
      opportunityOutlook,
    };

    // 6) Insights
    // qualityPercentile: how does current dealScore compare to historical
    // (% of weeks with dealScore <= currentDealScore)
    let qualityPercentile = 50;
    if (dealScores.length > 1) {
      const below = dealScores.filter((s) => s <= currentDealScore).length;
      qualityPercentile = round0((below / dealScores.length) * 100);
    }

    const bestImprovingCategory =
      byCategory.length > 0 && byCategory[0]!.trend26w > 0
        ? byCategory[0]!.category
        : null;
    const worstDecliningCategory =
      byCategory.length > 0 &&
      byCategory[byCategory.length - 1]!.trend26w < 0
        ? byCategory[byCategory.length - 1]!.category
        : null;

    const advice = (() => {
      const parts: string[] = [];
      parts.push(
        `Quality trend: ${qualityDirection} (${dealScoreTrend > 0 ? '+' : ''}${dealScoreTrend}/wk, momentum ${qualityMomentum > 0 ? '+' : ''}${qualityMomentum}). Trenutni deal score: ${currentDealScore}.`,
      );
      parts.push(
        `Volatilnost: ${qualityVolatility}. Best 26w: ${bestDealScore26w}, avg: ${avgDealScore26w}. Percentile: ${qualityPercentile}%.`,
      );
      parts.push(
        `Prilika rate: ${currentPrilikaRate}% (${prilikaTrend > 0 ? '+' : ''}${prilikaTrend}/wk). Outlook: ${opportunityOutlook}.`,
      );
      if (bestImprovingCategory) {
        const cat = byCategory.find(
          (c) => c.category === bestImprovingCategory,
        );
        if (cat) {
          parts.push(
            `Best: ${bestImprovingCategory} (${cat.trend26w > 0 ? '+' : ''}${cat.trend26w}/wk).`,
          );
        }
      }
      if (worstDecliningCategory) {
        const cat = byCategory.find(
          (c) => c.category === worstDecliningCategory,
        );
        if (cat) {
          parts.push(
            `Worst: ${worstDecliningCategory} (${cat.trend26w}/wk).`,
          );
        }
      }
      if (qualityDirection === 'DECLINING') {
        parts.push(
          'Quality pada — zmanjšaj fokus na declining kategorije, povečaj na improving.',
        );
      } else if (qualityDirection === 'IMPROVING' && qualityMomentum > 0) {
        parts.push(
          'Quality raste z pozitivno momentum — povečaj fokus na improving kategorije.',
        );
      } else {
        parts.push(
          'Quality stabilna — optimiraj mix kategorij za višji avg deal score.',
        );
      }
      return parts.join(' ');
    })();

    const insights: QualityInsights = {
      qualityPercentile,
      bestImprovingCategory,
      worstDecliningCategory,
      advice,
    };

    return NextResponse.json({
      ok: true,
      trend,
      weeklyData,
      byCategory,
      prilikaAnalysis,
      insights,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-quality-trend-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

