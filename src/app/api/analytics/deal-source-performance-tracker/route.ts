// v7.85: Deal Source Performance Tracker — tracks performance metrics of
// each deal source over time — monthly ROI, win rate, trade volume trends,
// and performance scorecard. Pure DB analytics — NO AI. "Bolha: performance
// 82/100 (IMPROVING, ROI +2%/mo). Vinted: 58/100 (DECLINING). Best month:
// Jul (1200€)."
//
// Razlika od deal-source-roi (ki da current snapshot ROI per source) — ta
// tracks PERFORMANCE TRENDS čez 12 mesecev z monthly ROI/win rate/volume
// trendi. Razlika od deal-source-comparison-matrix (v7.70 ki primerja
// trenutne atribute source-ov) — ta gleda TIME-SERIES trende in performance
// direction. Razlika od deal-source-intelligence (v7.82 AI ki da source
// intelligence) — ta je pure DB HISTORICAL performance tracking. Razlika od
// source-quality (ki meri quality) — ta gleda PERFORMANCE TRENDS z
// performance scorecard 0-100 in rank.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-source-performance-tracker

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type PerformanceDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface SourceCurrentMonth {
  profit: number;
  roi: number; // %
  winRate: number; // %
  volume: number;
  avgDealScore: number;
}

interface SourceTrends {
  profitTrend12m: number; // slope per month
  roiTrend12m: number;
  volumeTrend12m: number;
  winRateTrend12m: number;
  performanceDirection: PerformanceDirection;
}

interface MonthlyDatum {
  month: string; // YYYY-MM
  profit: number;
  roi: number;
  winRate: number;
  volume: number;
}

interface SourcePerformance {
  source: string;
  displayName: string;
  currentMonth: SourceCurrentMonth;
  trends: SourceTrends;
  performanceScore: number; // 0-100
  performanceRank: number; // 1 = best
  monthlyData: MonthlyDatum[];
  bestMonth: { month: string; profit: number } | null;
  worstMonth: { month: string; profit: number } | null;
}

interface PerformanceSummary {
  totalSources: number;
  improvingSources: number;
  decliningSources: number;
  bestPerformingSource: string | null;
  worstPerformingSource: string | null;
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

function classifyDirection(
  score: number,
  threshold: number,
): PerformanceDirection {
  if (score > threshold) return 'IMPROVING';
  if (score < -threshold) return 'DECLINING';
  return 'STABLE';
}

// Display name — prettify source string (e.g. "bolha" → "Bolha",
// "mobile-de" → "mobile.de", "vinted" → "Vinted")
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
  // Fallback — capitalize first letter
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// --- Sold trade row with linked listing/source --------------------------

interface SoldTradeWithSource {
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string;
  listing: {
    monitor: { source: string } | null;
    dealScore: number | null;
  } | null;
}

// Per-source per-month aggregation
interface SrcMonthAgg {
  monthKey: string;
  monthMs: number;
  invested: number;
  profit: number;
  wins: number;
  trades: number;
  dealScoreSum: number;
  dealScoreCount: number;
}

interface SrcAggregate {
  monthlyMap: Map<string, SrcMonthAgg>; // monthKey → agg
  displayName: string;
}

// --- Performance score ---------------------------------------------------

function computePerformanceScore(
  trends: SourceTrends,
  monthlyProfits: number[],
): number {
  // Performance score 0-100 weighted:
  // 30% ROI trend (improving = higher score)
  // 25% profit trend
  // 20% volume trend (growing = healthy)
  // 15% win rate trend
  // 10% consistency (low volatility = higher)

  // Normalize each slope to 0-100 scale
  // ROI trend: ±5%/month is significant
  const roiScore = Math.max(
    0,
    Math.min(100, 50 + (trends.roiTrend12m / 5) * 50),
  );
  // Profit trend: ±200€/month is significant
  const profitScore = Math.max(
    0,
    Math.min(100, 50 + (trends.profitTrend12m / 200) * 50),
  );
  // Volume trend: ±3 trades/month is significant
  const volumeScore = Math.max(
    0,
    Math.min(100, 50 + (trends.volumeTrend12m / 3) * 50),
  );
  // Win rate trend: ±5%/month
  const winRateScore = Math.max(
    0,
    Math.min(100, 50 + (trends.winRateTrend12m / 5) * 50),
  );
  // Consistency: lower stddev = higher score (max 100 if stddev=0, 0 if stddev>500)
  const volatility = stdDev(monthlyProfits);
  const consistencyScore = Math.max(
    0,
    Math.min(100, 100 - (volatility / 500) * 100),
  );

  const score =
    roiScore * 0.3 +
    profitScore * 0.25 +
    volumeScore * 0.2 +
    winRateScore * 0.15 +
    consistencyScore * 0.1;

  return round0(Math.max(0, Math.min(100, score)));
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for source + dealScore)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        category: true,
        listing: {
          select: {
            dealScore: true,
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
          invested: 0,
          profit: 0,
          wins: 0,
          trades: 0,
          dealScoreSum: 0,
          dealScoreCount: 0,
        };
        agg.monthlyMap.set(monthKey, monthAgg);
      }

      const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
      const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = proceeds - invested;
      monthAgg.invested += invested;
      monthAgg.profit += profit;
      if (profit > 0) monthAgg.wins += 1;
      monthAgg.trades += 1;
      if (t.listing?.dealScore != null) {
        monthAgg.dealScoreSum += t.listing.dealScore;
        monthAgg.dealScoreCount += 1;
      }
    }

    // 3) Compute per-source metrics
    const sources: SourcePerformance[] = [];
    const currentMonthKey = monthKeyOf(new Date(now));

    for (const [source, agg] of sourceMap.entries()) {
      // Sort monthly data by monthMs
      const monthlyData: MonthlyDatum[] = [];
      const monthlyProfits: number[] = [];
      const monthlyRois: number[] = [];
      const monthlyVolumes: number[] = [];
      const monthlyWinRates: number[] = [];

      const sortedMonths = Array.from(agg.monthlyMap.values()).sort(
        (a, b) => a.monthMs - b.monthMs,
      );

      let bestMonth: { month: string; profit: number } | null = null;
      let worstMonth: { month: string; profit: number } | null = null;

      for (const m of sortedMonths) {
        const roi = m.invested > 0 ? round1((m.profit / m.invested) * 100) : 0;
        const winRate = m.trades > 0 ? round1((m.wins / m.trades) * 100) : 0;
        const avgDealScore = m.dealScoreCount > 0 ? round1(m.dealScoreSum / m.dealScoreCount) : 0;
        monthlyData.push({
          month: m.monthKey,
          profit: round0(m.profit),
          roi,
          winRate,
          volume: m.trades,
        });
        monthlyProfits.push(m.profit);
        monthlyRois.push(roi);
        monthlyVolumes.push(m.trades);
        monthlyWinRates.push(winRate);

        if (!bestMonth || m.profit > bestMonth.profit) {
          bestMonth = { month: m.monthKey, profit: round0(m.profit) };
        }
        if (!worstMonth || m.profit < worstMonth.profit) {
          worstMonth = { month: m.monthKey, profit: round0(m.profit) };
        }
      }

      // Current month metrics (or last available month if current is empty)
      let currentMonthAgg = agg.monthlyMap.get(currentMonthKey);
      if (!currentMonthAgg && sortedMonths.length > 0) {
        currentMonthAgg = sortedMonths[sortedMonths.length - 1]!;
      }

      const currentMonth: SourceCurrentMonth = currentMonthAgg
        ? {
            profit: round0(currentMonthAgg.profit),
            roi:
              currentMonthAgg.invested > 0
                ? round1((currentMonthAgg.profit / currentMonthAgg.invested) * 100)
                : 0,
            winRate:
              currentMonthAgg.trades > 0
                ? round1((currentMonthAgg.wins / currentMonthAgg.trades) * 100)
                : 0,
            volume: currentMonthAgg.trades,
            avgDealScore:
              currentMonthAgg.dealScoreCount > 0
                ? round1(currentMonthAgg.dealScoreSum / currentMonthAgg.dealScoreCount)
                : 0,
          }
        : { profit: 0, roi: 0, winRate: 0, volume: 0, avgDealScore: 0 };

      // Trends — linear regression slopes
      const profitTrend12m = round2(trendSlope(monthlyProfits));
      const roiTrend12m = round2(trendSlope(monthlyRois));
      const volumeTrend12m = round2(trendSlope(monthlyVolumes));
      const winRateTrend12m = round2(trendSlope(monthlyWinRates));

      // Performance direction — composite of profit + ROI trend
      const compositeTrend = (profitTrend12m / 200 + roiTrend12m / 5) / 2;
      const performanceDirection = classifyDirection(compositeTrend, 0.1);

      const trends: SourceTrends = {
        profitTrend12m,
        roiTrend12m,
        volumeTrend12m,
        winRateTrend12m,
        performanceDirection,
      };

      const performanceScore = computePerformanceScore(trends, monthlyProfits);

      sources.push({
        source,
        displayName: agg.displayName,
        currentMonth,
        trends,
        performanceScore,
        performanceRank: 0, // assigned later
        monthlyData,
        bestMonth,
        worstMonth,
      });
    }

    // 4) Compute ranks (1 = best)
    sources.sort((a, b) => b.performanceScore - a.performanceScore);
    sources.forEach((s, idx) => {
      s.performanceRank = idx + 1;
    });

    // 5) Summary
    const improvingSources = sources.filter(
      (s) => s.trends.performanceDirection === 'IMPROVING',
    ).length;
    const decliningSources = sources.filter(
      (s) => s.trends.performanceDirection === 'DECLINING',
    ).length;

    const bestPerformingSource =
      sources.length > 0 ? sources[0]!.displayName : null;
    const worstPerformingSource =
      sources.length > 0 ? sources[sources.length - 1]!.displayName : null;

    const advice =
      sources.length === 0
        ? 'Ni SOLD trgovin z linked listing v zadnjih 12 mesecih — Deal Source Performance Tracker ni mogoč.'
        : `Spremljaš ${sources.length} virov. ${improvingSources} improving, ${decliningSources} declining. ` +
          (bestPerformingSource
            ? `Najboljši: ${bestPerformingSource} (${sources[0]!.performanceScore}/100). `
            : '') +
          (worstPerformingSource && sources.length > 1
            ? `Najšibkejši: ${worstPerformingSource} (${sources[sources.length - 1]!.performanceScore}/100). `
            : '') +
          (decliningSources > improvingSources
            ? 'Več virov declining — razmisli o diversifikaciji ali premiku fokusa.'
            : improvingSources > decliningSources
              ? 'Več virov improving — povečaj volumen v top virih.'
              : 'Viri stabilni — vzdržuj trenutno strategijo.');

    const summary: PerformanceSummary = {
      totalSources: sources.length,
      improvingSources,
      decliningSources,
      bestPerformingSource,
      worstPerformingSource,
      advice,
    };

    return NextResponse.json({
      ok: true,
      sources,
      summary,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-source-performance-tracker',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
