// v7.86: Deal Source Quality Tracker — tracks DEAL QUALITY per source over
// time — avg dealScore, prilika rate, aiRisk trends per source. Razlika od
// deal-source-performance-tracker (v7.85 ki track-a profit/ROI) — ta track-a
// QUALITY metrics (dealScore, aiScore, aiRisk, prilikaRate). "Bolha: quality
// 78/100 (IMPROVING, +1.2/mo). Vinted: 62/100 (STABLE). Best month: Jul (85).
// Rank: #1."
//
// Razlika od source-quality (v7.43 ki da CURRENT snapshot quality per monitor)
// — ta track-a QUALITY TRENDS čez 12 mesecev z monthly aggregation in quality
// scorecard 0-100. Razlika od deal-source-roi (ki meri ROI per source) — ta
// meri QUALITY ne profit. Razlika od deal-source-comparison-matrix (v7.70 ki
// primerja trenutne atribute) — ta gleda TIME-SERIES quality trende. Razlika
// od deal-source-intelligence (v7.82 AI ki da intelligence) — ta je pure DB
// HISTORICAL quality tracking. Razlika od deal-quality-trend-analyzer (v7.83
// ki analizira quality trend overall) — ta track-a quality PER SOURCE z
// rank-om. Razlika od deal-quality-distribution (ki da quality distribution)
// — ta gleda SOURCE × quality over time.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-source-quality-tracker

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type QualityTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface SourceCurrentMonth {
  avgDealScore: number;
  avgAiScore: number;
  avgAiRisk: number;
  prilikaRate: number; // %
  qualityScore: number; // 0-100 composite
}

interface SourceTrends {
  dealScoreTrend12m: number; // slope per month
  qualityTrend: QualityTrend;
  qualityVolatility: number; // stddev of monthly quality scores
  qualityConsistency: number; // 0-100 (higher = more consistent)
}

interface MonthExtreme {
  month: string; // YYYY-MM
  score: number;
}

interface SourceQualityScorecard {
  currentQualityScore: number; // 0-100
  avgQualityScore12m: number; // 0-100
  bestQualityMonth: MonthExtreme | null;
  worstQualityMonth: MonthExtreme | null;
  qualityRank: number; // 1 = best
}

interface MonthlyQualityDatum {
  month: string; // YYYY-MM
  avgDealScore: number;
  avgAiScore: number;
  avgAiRisk: number;
  prilikaRate: number;
  qualityScore: number;
}

interface SourceQuality {
  source: string;
  displayName: string;
  currentMonth: SourceCurrentMonth;
  trends: SourceTrends;
  qualityScorecard: SourceQualityScorecard;
  monthlyData: MonthlyQualityDatum[];
}

interface QualitySummary {
  totalSources: number;
  avgQualityAcrossSources: number;
  bestQualitySource: string | null;
  worstQualitySource: string | null;
  improvingSources: number;
  decliningSources: number;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;

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

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Linear regression slope
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

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function classifyQualityTrend(slope: number): QualityTrend {
  // Slope = quality points per month. ±0.5 points/month is significant.
  if (slope > 0.5) return 'IMPROVING';
  if (slope < -0.5) return 'DECLINING';
  return 'STABLE';
}

// Display name — prettify source string
function prettifySource(raw: string): string {
  if (!raw) return 'Neznan vir';
  const lower = raw.toLowerCase();
  const map: Record<string, string> = {
    'bolha': 'Bolha',
    'nepremicnine': 'Nepremičnine.net',
    'avtonet': 'Avtonet',
    'salomon': 'Salomon',
    'custom-rss': 'Custom RSS',
    'vinted': 'Vinted',
    'mobile-de': 'mobile.de',
    'mobile.de': 'mobile.de',
    'kleinanzeigen': 'Kleinanzeigen',
    'subito': 'Subito',
    'willhaben': 'Willhaben',
    'facebook': 'Facebook',
    'fb': 'Facebook',
  };
  if (map[lower]) return map[lower]!;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// Composite quality score 0-100 per month
// Weighted: dealScore 40%, aiScore 20%, aiRisk inverse 20%, prilikaRate 20%
function computeQualityScore(
  avgDealScore: number,
  avgAiScore: number,
  avgAiRisk: number,
  prilikaRate: number,
): number {
  // Normalize each:
  // dealScore is already 0-100
  // aiScore is 1-10 → scale to 0-100
  // aiRisk is 1-10 (lower = better) → inverse: (10 - risk) / 10 × 100
  // prilikaRate is 0-100
  const dealScoreNorm = Math.max(0, Math.min(100, avgDealScore));
  const aiScoreNorm = Math.max(0, Math.min(100, (avgAiScore / 10) * 100));
  const aiRiskNorm = Math.max(0, Math.min(100, ((10 - avgAiRisk) / 10) * 100));
  const prilikaNorm = Math.max(0, Math.min(100, prilikaRate));

  const score =
    dealScoreNorm * 0.4 +
    aiScoreNorm * 0.2 +
    aiRiskNorm * 0.2 +
    prilikaNorm * 0.2;

  return round0(Math.max(0, Math.min(100, score)));
}

// --- Sold trade row with linked listing/source --------------------------

interface SoldTradeWithSource {
  sellDate: Date | null;
  listing: {
    dealScore: number | null;
    aiScore: number | null;
    aiRisk: number | null;
    aiVerdict: string | null;
    monitor: { source: string } | null;
  } | null;
}

// Per-source per-month aggregation
interface SrcMonthAgg {
  monthKey: string;
  monthMs: number;
  dealScoreSum: number;
  dealScoreCount: number;
  aiScoreSum: number;
  aiScoreCount: number;
  aiRiskSum: number;
  aiRiskCount: number;
  prilikaCount: number;
  totalListings: number;
}

interface SrcAggregate {
  monthlyMap: Map<string, SrcMonthAgg>; // monthKey → agg
  displayName: string;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months with linked Listing
    //    (for monitor.source, dealScore, aiScore, aiRisk, aiVerdict)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        sellDate: true,
        listing: {
          select: {
            dealScore: true,
            aiScore: true,
            aiRisk: true,
            aiVerdict: true,
            monitor: {
              select: { source: true },
            },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const rows = soldTrades as unknown as SoldTradeWithSource[];

    // 2) Group by source AND month
    const sourceMap = new Map<string, SrcAggregate>();
    for (const t of rows) {
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      const d = new Date(sellMs);
      const monthKey = monthKeyOf(d);
      const monthMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

      const sourceRaw = t.listing?.monitor?.source ?? 'neznan';
      const source = (sourceRaw ?? '').trim().toLowerCase() || 'neznan';

      let agg = sourceMap.get(source);
      if (!agg) {
        agg = {
          monthlyMap: new Map<string, SrcMonthAgg>(),
          displayName: prettifySource(sourceRaw),
        };
        sourceMap.set(source, agg);
      }

      let monthAgg = agg.monthlyMap.get(monthKey);
      if (!monthAgg) {
        monthAgg = {
          monthKey,
          monthMs,
          dealScoreSum: 0,
          dealScoreCount: 0,
          aiScoreSum: 0,
          aiScoreCount: 0,
          aiRiskSum: 0,
          aiRiskCount: 0,
          prilikaCount: 0,
          totalListings: 0,
        };
        agg.monthlyMap.set(monthKey, monthAgg);
      }

      const listing = t.listing;
      if (listing?.dealScore != null) {
        monthAgg.dealScoreSum += listing.dealScore;
        monthAgg.dealScoreCount += 1;
      }
      if (listing?.aiScore != null) {
        monthAgg.aiScoreSum += listing.aiScore;
        monthAgg.aiScoreCount += 1;
      }
      if (listing?.aiRisk != null) {
        monthAgg.aiRiskSum += listing.aiRisk;
        monthAgg.aiRiskCount += 1;
      }
      if (listing?.aiVerdict === 'PRILIKA') {
        monthAgg.prilikaCount += 1;
      }
      monthAgg.totalListings += 1;
    }

    // 3) Compute per-source metrics
    const sources: SourceQuality[] = [];
    const currentMonthKey = monthKeyOf(new Date(now));

    for (const [source, agg] of sourceMap.entries()) {
      // Sort monthly data by monthMs
      const sortedMonths = Array.from(agg.monthlyMap.values()).sort(
        (a, b) => a.monthMs - b.monthMs,
      );

      const monthlyData: MonthlyQualityDatum[] = [];
      const monthlyQualityScores: number[] = [];
      const monthlyDealScores: number[] = [];

      let bestQualityMonth: MonthExtreme | null = null;
      let worstQualityMonth: MonthExtreme | null = null;

      for (const m of sortedMonths) {
        const avgDealScore = m.dealScoreCount > 0 ? round1(m.dealScoreSum / m.dealScoreCount) : 0;
        const avgAiScore = m.aiScoreCount > 0 ? round1(m.aiScoreSum / m.aiScoreCount) : 0;
        const avgAiRisk = m.aiRiskCount > 0 ? round1(m.aiRiskSum / m.aiRiskCount) : 0;
        const prilikaRate =
          m.totalListings > 0 ? round1((m.prilikaCount / m.totalListings) * 100) : 0;
        const qualityScore = computeQualityScore(
          avgDealScore,
          avgAiScore,
          avgAiRisk,
          prilikaRate,
        );

        monthlyData.push({
          month: m.monthKey,
          avgDealScore,
          avgAiScore,
          avgAiRisk,
          prilikaRate,
          qualityScore,
        });
        monthlyQualityScores.push(qualityScore);
        monthlyDealScores.push(avgDealScore);

        if (!bestQualityMonth || qualityScore > bestQualityMonth.score) {
          bestQualityMonth = { month: m.monthKey, score: qualityScore };
        }
        if (!worstQualityMonth || qualityScore < worstQualityMonth.score) {
          worstQualityMonth = { month: m.monthKey, score: qualityScore };
        }
      }

      // Current month metrics (or last available month if current is empty)
      let currentMonthAgg = agg.monthlyMap.get(currentMonthKey);
      if (!currentMonthAgg && sortedMonths.length > 0) {
        currentMonthAgg = sortedMonths[sortedMonths.length - 1]!;
      }

      const currentMonth: SourceCurrentMonth = currentMonthAgg
        ? {
            avgDealScore:
              currentMonthAgg.dealScoreCount > 0
                ? round1(currentMonthAgg.dealScoreSum / currentMonthAgg.dealScoreCount)
                : 0,
            avgAiScore:
              currentMonthAgg.aiScoreCount > 0
                ? round1(currentMonthAgg.aiScoreSum / currentMonthAgg.aiScoreCount)
                : 0,
            avgAiRisk:
              currentMonthAgg.aiRiskCount > 0
                ? round1(currentMonthAgg.aiRiskSum / currentMonthAgg.aiRiskCount)
                : 0,
            prilikaRate:
              currentMonthAgg.totalListings > 0
                ? round1((currentMonthAgg.prilikaCount / currentMonthAgg.totalListings) * 100)
                : 0,
            qualityScore: 0, // computed below
          }
        : {
            avgDealScore: 0,
            avgAiScore: 0,
            avgAiRisk: 0,
            prilikaRate: 0,
            qualityScore: 0,
          };

      currentMonth.qualityScore = computeQualityScore(
        currentMonth.avgDealScore,
        currentMonth.avgAiScore,
        currentMonth.avgAiRisk,
        currentMonth.prilikaRate,
      );

      // Trends — linear regression slopes
      const dealScoreTrend12m = round2(trendSlope(monthlyDealScores));
      const qualityTrend = classifyQualityTrend(trendSlope(monthlyQualityScores));

      // Quality volatility = stddev of monthly quality scores
      const qualityVolatility = round1(stdDev(monthlyQualityScores));

      // Quality consistency: lower volatility = higher consistency
      // Map volatility 0-30 → consistency 100-0
      const qualityConsistency = round0(
        Math.max(0, Math.min(100, 100 - (qualityVolatility / 30) * 100)),
      );

      const trends: SourceTrends = {
        dealScoreTrend12m,
        qualityTrend,
        qualityVolatility,
        qualityConsistency,
      };

      // Quality scorecard
      const currentQualityScore = currentMonth.qualityScore;
      const avgQualityScore12m =
        monthlyQualityScores.length > 0
          ? round0(avg(monthlyQualityScores))
          : 0;

      const qualityScorecard: SourceQualityScorecard = {
        currentQualityScore,
        avgQualityScore12m,
        bestQualityMonth,
        worstQualityMonth,
        qualityRank: 0, // assigned later
      };

      sources.push({
        source,
        displayName: agg.displayName,
        currentMonth,
        trends,
        qualityScorecard,
        monthlyData,
      });
    }

    // 4) Compute ranks (1 = best, by currentQualityScore then avgQualityScore12m)
    sources.sort(
      (a, b) =>
        b.qualityScorecard.currentQualityScore -
          a.qualityScorecard.currentQualityScore ||
        b.qualityScorecard.avgQualityScore12m -
          a.qualityScorecard.avgQualityScore12m,
    );
    sources.forEach((s, idx) => {
      s.qualityScorecard.qualityRank = idx + 1;
    });

    // 5) Summary
    const improvingSources = sources.filter(
      (s) => s.trends.qualityTrend === 'IMPROVING',
    ).length;
    const decliningSources = sources.filter(
      (s) => s.trends.qualityTrend === 'DECLINING',
    ).length;
    const avgQualityAcrossSources =
      sources.length > 0
        ? round0(
            sources.reduce(
              (s, src) => s + src.qualityScorecard.currentQualityScore,
              0,
            ) / sources.length,
          )
        : 0;

    const bestQualitySource =
      sources.length > 0 ? sources[0]!.displayName : null;
    const worstQualitySource =
      sources.length > 0 ? sources[sources.length - 1]!.displayName : null;

    const advice =
      sources.length === 0
        ? 'Ni SOLD trgovin z linked listing v zadnjih 12 mesecih — Deal Source Quality Tracker ni mogoč.'
        : `Spremljaš ${sources.length} virov. Povprečna quality ${avgQualityAcrossSources}/100. ` +
          `${improvingSources} improving, ${decliningSources} declining. ` +
          (bestQualitySource
            ? `Najboljša quality: ${bestQualitySource} (${sources[0]!.qualityScorecard.currentQualityScore}/100). `
            : '') +
          (worstQualitySource && sources.length > 1
            ? `Najslabša: ${worstQualitySource} (${sources[sources.length - 1]!.qualityScorecard.currentQualityScore}/100). `
            : '') +
          (decliningSources > improvingSources
            ? 'Več virov declining — razmisli o premiku fokusa na improving virovi.'
            : improvingSources > decliningSources
              ? 'Več virov improving — povečaj volumen v najboljših virih.'
              : 'Quality virov stabilen — vzdržuj trenutno strategijo.');

    const summary: QualitySummary = {
      totalSources: sources.length,
      avgQualityAcrossSources,
      bestQualitySource,
      worstQualitySource,
      improvingSources,
      decliningSources,
      advice,
    };

    return NextResponse.json({
      ok: true,
      sources,
      summary,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-source-quality-tracker',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
