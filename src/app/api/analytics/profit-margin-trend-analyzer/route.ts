// v7.82: Profit Margin Trend Analyzer — analizira profit margin TRENDE čez
// čas — ali se marže izboljšujejo, stabilne ali padajo? Identificira kaj
// gnani spremembe marže. Pure DB analytics — NO AI.
//
// "Margin trend: IMPROVING (+2.3%/mo, momentum +0.5). Driver: price increases.
// Best: elektronika (+5%/mo). Worst: avto (-2%/mo)."
//
// Razlika od profit-margin-heatmap (ki prikaže category × price matrix) — ta
// gleda margin TREND čez 12 mesecev z direction (IMPROVING/STABLE/DECLINING)
// in drivers (price/cost/fee/efficiency).
// Razlika od profit-margin-forecaster (v7.80, AI ki napove future margin) —
// ta analizira HISTORICAL margin trend z 12m/3m linear regression +
// momentum. Razlika od profit-margin-optimizer-v2 (ki optimira margin) — ta
// gleda DRIVERS margin sprememb (price/cost/fee/efficiency trend).
// Razlika od profit-efficiency-analyzer (ki gleda profit per day) — ta gleda
// margin PERCENT trend z drivers. Razlika od profit-margin-predictor (AI
// ki napove future margin) — ta je pure DB HISTORICAL analysis.
//
// Pure DB analytics (NO AI). GET /api/analytics/profit-margin-trend-analyzer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type MarginDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';
type DriverImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

interface MarginTrend {
  currentMargin: number; // %
  avgMargin12m: number;
  bestMargin12m: number;
  worstMargin12m: number;
  marginTrend12m: number; // slope (% per month)
  marginTrend3m: number;
  marginDirection: MarginDirection;
  marginVolatility: number; // stddev of monthly margins
  marginMomentum: number; // acceleration: recent3 slope - prior3 slope
}

interface MonthlyDatum {
  month: string; // YYYY-MM
  avgMargin: number;
  avgProfit: number;
  avgROI: number;
  tradeCount: number;
}

interface DriverInfo {
  trend: number;
  impact: DriverImpact;
  detail: string;
}

interface Drivers {
  priceDriver: DriverInfo;
  costDriver: DriverInfo;
  feeDriver: DriverInfo;
  efficiencyDriver: DriverInfo;
}

interface CategoryTrend {
  category: string;
  currentMargin: number;
  trend12m: number;
  direction: MarginDirection;
  rank: number; // 1 = best margin trend
}

interface TrendInsights {
  marginPercentile: number; // 0-100
  bestImprovingCategory: string | null;
  worstDecliningCategory: string | null;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round0(v: number): number {
  return Math.round(v);
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / 86_400_000));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
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
    num += (i - xMean) * (values[i] - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

function classifyDirection(
  slope: number,
  threshold: number,
): MarginDirection {
  if (slope > threshold) return 'IMPROVING';
  if (slope < -threshold) return 'DECLINING';
  return 'STABLE';
}

function classifyImpact(slope: number, threshold: number): DriverImpact {
  if (slope > threshold) return 'POSITIVE';
  if (slope < -threshold) return 'NEGATIVE';
  return 'NEUTRAL';
}

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// --- Monthly aggregation ------------------------------------------------

interface MonthAgg {
  monthKey: string;
  year: number;
  month: number;
  profitSum: number;
  revenueSum: number;
  costSum: number;
  feesSum: number;
  tradeCount: number;
  holdDaysSum: number;
  holdCount: number;
  roiSum: number; // % per trade
  marginSum: number; // % per trade
}

interface MonthlyResult {
  buckets: MonthAgg[];
  last12: MonthAgg[];
  last3: MonthAgg[];
}

function buildMonthlyAgg(
  soldTrades: Array<{
    buyPrice: number | null;
    buyFees: number | null;
    sellPrice: number | null;
    sellFees: number | null;
    buyDate: Date | null;
    sellDate: Date | null;
  }>,
): MonthlyResult {
  const map = new Map<string, MonthAgg>();

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;
    const sellDate = new Date(sellMs);
    const key = monthKeyOf(sellDate);

    let b = map.get(key);
    if (!b) {
      b = {
        monthKey: key,
        year: sellDate.getFullYear(),
        month: sellDate.getMonth(),
        profitSum: 0,
        revenueSum: 0,
        costSum: 0,
        feesSum: 0,
        tradeCount: 0,
        holdDaysSum: 0,
        holdCount: 0,
        roiSum: 0,
        marginSum: 0,
      };
      map.set(key, b);
    }

    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const profit = sellPrice - sellFees - buyPrice - buyFees;
    const revenue = sellPrice;
    const cost = buyPrice + buyFees;
    const fees = buyFees + sellFees;

    b.profitSum += profit;
    b.revenueSum += revenue;
    b.costSum += cost;
    b.feesSum += fees;
    b.tradeCount += 1;

    // Per-trade metrics (only counted when valid)
    if (revenue > 0) {
      b.marginSum += (profit / revenue) * 100;
    }
    if (cost > 0) {
      b.roiSum += (profit / cost) * 100;
    }

    const buyMs = toMs(t.buyDate);
    if (buyMs > 0 && sellMs > 0) {
      b.holdDaysSum += daysBetween(buyMs, sellMs);
      b.holdCount += 1;
    }
  }

  // Finalize
  for (const b of map.values()) {
    b.profitSum = round0(b.profitSum);
    b.revenueSum = round0(b.revenueSum);
    b.costSum = round0(b.costSum);
    b.feesSum = round0(b.feesSum);
  }

  const buckets = Array.from(map.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );
  const last12 = buckets.slice(-12);
  const last3 = last12.slice(-3);

  return { buckets, last12, last3 };
}

function finalizeMonthly(buckets: MonthAgg[]): MonthlyDatum[] {
  return buckets.map((b) => ({
    month: b.monthKey,
    avgMargin:
      b.tradeCount > 0 && b.revenueSum > 0
        ? round1(b.marginSum / b.tradeCount)
        : 0,
    avgProfit: round0(b.profitSum / Math.max(1, b.tradeCount)),
    avgROI: round1(b.roiSum / Math.max(1, b.tradeCount)),
    tradeCount: b.tradeCount,
  }));
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff12m = new Date(now - 365 * 86_400_000);

    // 1) Query all SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
        sellPrice: { not: null },
      },
      select: {
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const emptyResponse = {
      ok: true,
      trend: {
        currentMargin: 0,
        avgMargin12m: 0,
        bestMargin12m: 0,
        worstMargin12m: 0,
        marginTrend12m: 0,
        marginTrend3m: 0,
        marginDirection: 'STABLE' as MarginDirection,
        marginVolatility: 0,
        marginMomentum: 0,
      },
      monthlyData: [] as MonthlyDatum[],
      drivers: {
        priceDriver: { trend: 0, impact: 'NEUTRAL' as DriverImpact, detail: '' },
        costDriver: { trend: 0, impact: 'NEUTRAL' as DriverImpact, detail: '' },
        feeDriver: { trend: 0, impact: 'NEUTRAL' as DriverImpact, detail: '' },
        efficiencyDriver: {
          trend: 0,
          impact: 'NEUTRAL' as DriverImpact,
          detail: '',
        },
      },
      byCategory: [] as CategoryTrend[],
      insights: {
        marginPercentile: 0,
        bestImprovingCategory: null,
        worstDecliningCategory: null,
        advice:
          'Ni zgodovinskih prodaj (SOLD) v zadnjih 12 mesecih — Profit Margin Trend Analyzer ni mogoč.',
      },
      message:
        'Ni zgodovinskih prodaj (SOLD) v zadnjih 12 mesecih — Profit Margin Trend Analyzer ni mogoč.',
    };

    if (soldTrades.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    // 2) Monthly aggregation (margin % per trade)
    const monthly = buildMonthlyAgg(soldTrades);

    if (monthly.last12.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    const monthlyData = finalizeMonthly(monthly.last12);

    // 3) Compute margin trend
    const margins = monthly.last12.map((b) =>
      b.tradeCount > 0 && b.revenueSum > 0
        ? b.marginSum / b.tradeCount
        : 0,
    );

    const currentMargin =
      margins.length > 0 ? round1(margins[margins.length - 1]) : 0;
    const avgMargin12m =
      margins.length > 0 ? round1(avg(margins)) : 0;
    const bestMargin12m =
      margins.length > 0 ? round1(Math.max(...margins)) : 0;
    const worstMargin12m =
      margins.length > 0 ? round1(Math.min(...margins)) : 0;

    const trend12m = round1(trendSlope(margins));
    const last3Margins = margins.slice(-3);
    const trend3m = round1(trendSlope(last3Margins));

    // Direction: trend12m > 0.5 = IMPROVING, < -0.5 = DECLINING
    const marginDirection = classifyDirection(trend12m, 0.5);

    // Volatility: stddev of monthly margins
    const marginVolatility =
      margins.length > 1 ? round1(stdDev(margins)) : 0;

    // Momentum: (slope of last 3) - (slope of prior 3)
    const prior3 = margins.slice(-6, -3);
    const recent3Slope = trendSlope(last3Margins);
    const prior3Slope = prior3.length >= 2 ? trendSlope(prior3) : 0;
    const marginMomentum = round1(recent3Slope - prior3Slope);

    const trend: MarginTrend = {
      currentMargin,
      avgMargin12m,
      bestMargin12m,
      worstMargin12m,
      marginTrend12m: trend12m,
      marginTrend3m: trend3m,
      marginDirection,
      marginVolatility,
      marginMomentum,
    };

    // 4) Drivers — what's driving margin changes?
    // priceDriver: are selling prices (revenue/trade) increasing?
    const priceSeries = monthly.last12.map((b) =>
      b.tradeCount > 0 ? b.revenueSum / b.tradeCount : 0,
    );
    const priceSlope = round1(trendSlope(priceSeries));
    const priceImpact = classifyImpact(priceSlope, 1);
    const priceDriver: DriverInfo = {
      trend: priceSlope,
      impact: priceImpact,
      detail:
        priceImpact === 'POSITIVE'
          ? `Prodajne cene rastejo (${priceSlope > 0 ? '+' : ''}${priceSlope}€/trade/mo)`
          : priceImpact === 'NEGATIVE'
            ? `Prodajne cene padajo (${priceSlope}€/trade/mo)`
            : `Prodajne cene stabilne (${priceSlope}€/trade/mo)`,
    };

    // costDriver: are buy prices (cost/trade) increasing?
    const costSeries = monthly.last12.map((b) =>
      b.tradeCount > 0 ? b.costSum / b.tradeCount : 0,
    );
    const costSlope = round1(trendSlope(costSeries));
    const costImpact = classifyImpact(-costSlope, 1);
    const costDriver: DriverInfo = {
      trend: costSlope,
      impact: costImpact,
      detail:
        costImpact === 'POSITIVE'
          ? `Nabavne cene padajo (${costSlope}€/trade/mo — nižji stroški)`
          : costImpact === 'NEGATIVE'
            ? `Nabavne cene rastejo (${costSlope > 0 ? '+' : ''}${costSlope}€/trade/mo — višji stroški)`
            : `Nabavne cene stabilne (${costSlope}€/trade/mo)`,
    };

    // feeDriver: are fees as % of trade increasing?
    const feeSeries = monthly.last12.map((b) =>
      b.revenueSum > 0 ? (b.feesSum / b.revenueSum) * 100 : 0,
    );
    const feeSlope = round1(trendSlope(feeSeries));
    const feeImpact = classifyImpact(-feeSlope, 0.1);
    const feeDriver: DriverInfo = {
      trend: feeSlope,
      impact: feeImpact,
      detail:
        feeImpact === 'POSITIVE'
          ? `Fee-ji kot % prihodka padajo (${feeSlope}%/mo — manjši overhead)`
          : feeImpact === 'NEGATIVE'
            ? `Fee-ji kot % prihodka rastejo (${feeSlope > 0 ? '+' : ''}${feeSlope}%/mo — večji overhead)`
            : `Fee-ji stabilni (${feeSlope}%/mo)`,
    };

    // efficiencyDriver: are hold times affecting margins?
    const efficiencySeries = monthly.last12.map((b) =>
      b.holdCount > 0 ? b.holdDaysSum / b.holdCount : 0,
    );
    const efficiencySlope = round1(trendSlope(efficiencySeries));
    const efficiencyImpact = classifyImpact(-efficiencySlope, 0.5);
    const efficiencyDriver: DriverInfo = {
      trend: efficiencySlope,
      impact: efficiencyImpact,
      detail:
        efficiencyImpact === 'POSITIVE'
          ? `Hold days se zmanjšujejo (${efficiencySlope}/mo — hitrejši turnover, boljši cash flow)`
          : efficiencyImpact === 'NEGATIVE'
            ? `Hold days se povečujejo (${efficiencySlope > 0 ? '+' : ''}${efficiencySlope}/mo — počasnejši turnover)`
            : `Hold days stabilni (${efficiencySlope}/mo)`,
    };

    const drivers: Drivers = {
      priceDriver,
      costDriver,
      feeDriver,
      efficiencyDriver,
    };

    // 5) Per-category margin trend
    interface CatMonthAgg {
      profitSum: number;
      revenueSum: number;
      tradeCount: number;
      monthKeys: string[];
    }
    interface CatAgg {
      category: string;
      months: Map<string, CatMonthAgg>;
      recentMargin: number; // last 3 months avg
      trend12m: number; // slope
      direction: MarginDirection;
    }
    const catMap = new Map<string, CatAgg>();
    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      const sellDate = new Date(sellMs);
      const key = monthKeyOf(sellDate);
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';

      let c = catMap.get(cat);
      if (!c) {
        c = {
          category: cat,
          months: new Map(),
          recentMargin: 0,
          trend12m: 0,
          direction: 'STABLE',
        };
        catMap.set(cat, c);
      }
      let m = c.months.get(key);
      if (!m) {
        m = {
          profitSum: 0,
          revenueSum: 0,
          tradeCount: 0,
          monthKeys: [],
        };
        c.months.set(key, m);
      }
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;
      const revenue = sellPrice;
      m.profitSum += profit;
      m.revenueSum += revenue;
      m.tradeCount += 1;
    }

    const byCategoryRaw: Array<{
      category: string;
      currentMargin: number;
      trend12m: number;
      direction: MarginDirection;
      monthCount: number;
    }> = [];

    for (const c of catMap.values()) {
      const sortedMonths = Array.from(c.months.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      if (sortedMonths.length < 2) continue;
      const monthMargins = sortedMonths.map(([, m]) =>
        m.tradeCount > 0 && m.revenueSum > 0
          ? (m.profitSum / m.revenueSum) * 100
          : 0,
      );
      // currentMargin = average of last 3 months (or fewer)
      const last3 = monthMargins.slice(-3);
      const currentMarginCat =
        last3.length > 0 ? round1(avg(last3)) : 0;
      const catTrend = round1(trendSlope(monthMargins));
      const direction = classifyDirection(catTrend, 0.5);

      // Skip categories with too few trades
      const totalTrades = sortedMonths.reduce(
        (s, [, m]) => s + m.tradeCount,
        0,
      );
      if (totalTrades < 3) continue;

      byCategoryRaw.push({
        category: c.category,
        currentMargin: currentMarginCat,
        trend12m: catTrend,
        direction,
        monthCount: sortedMonths.length,
      });
    }

    // Sort by trend12m desc (best improving first), assign rank
    byCategoryRaw.sort((a, b) => b.trend12m - a.trend12m);
    const byCategory: CategoryTrend[] = byCategoryRaw.map((c, i) => ({
      category: c.category,
      currentMargin: c.currentMargin,
      trend12m: c.trend12m,
      direction: c.direction,
      rank: i + 1,
    }));

    // 6) Insights
    // marginPercentile: how does current margin compare to historical
    // (percent of months with margin <= currentMargin)
    let marginPercentile = 50;
    if (margins.length > 1) {
      const below = margins.filter((m) => m <= currentMargin).length;
      marginPercentile = round0((below / margins.length) * 100);
    }

    const bestImprovingCategory =
      byCategory.length > 0 && byCategory[0].trend12m > 0
        ? byCategory[0].category
        : null;
    const worstDecliningCategory =
      byCategory.length > 0 &&
      byCategory[byCategory.length - 1].trend12m < 0
        ? byCategory[byCategory.length - 1].category
        : null;

    const advice = (() => {
      const parts: string[] = [];
      parts.push(
        `Margin trend: ${marginDirection} (${trend12m > 0 ? '+' : ''}${trend12m}%/mo, momentum ${marginMomentum > 0 ? '+' : ''}${marginMomentum}). Trenutna marža: ${currentMargin}%.`,
      );
      parts.push(
        `Volatilnost: ${marginVolatility}%. Best 12m: ${bestMargin12m}%, worst: ${worstMargin12m}%, avg: ${avgMargin12m}%. Percentile: ${marginPercentile}%.`,
      );
      const driverParts: string[] = [];
      if (priceDriver.impact !== 'NEUTRAL')
        driverParts.push(
          `price ${priceDriver.impact === 'POSITIVE' ? '↑' : '↓'}`,
        );
      if (costDriver.impact !== 'NEUTRAL')
        driverParts.push(
          `cost ${costDriver.impact === 'POSITIVE' ? '↓' : '↑'}`,
        );
      if (feeDriver.impact !== 'NEUTRAL')
        driverParts.push(
          `fees ${feeDriver.impact === 'POSITIVE' ? '↓' : '↑'}`,
        );
      if (efficiencyDriver.impact !== 'NEUTRAL')
        driverParts.push(
          `hold ${efficiencyDriver.impact === 'POSITIVE' ? '↓' : '↑'}`,
        );
      if (driverParts.length > 0) {
        parts.push(`Drivers: ${driverParts.join(', ')}.`);
      }
      if (bestImprovingCategory) {
        const cat = byCategory.find(
          (c) => c.category === bestImprovingCategory,
        );
        if (cat) {
          parts.push(
            `Best: ${bestImprovingCategory} (${cat.trend12m > 0 ? '+' : ''}${cat.trend12m}%/mo).`,
          );
        }
      }
      if (worstDecliningCategory) {
        const cat = byCategory.find(
          (c) => c.category === worstDecliningCategory,
        );
        if (cat) {
          parts.push(
            `Worst: ${worstDecliningCategory} (${cat.trend12m}%/mo).`,
          );
        }
      }
      if (marginDirection === 'DECLINING') {
        parts.push(
          'Marže padajo — zmanjšaj nabavo v declining kategorijah, povečaj v improving.',
        );
      } else if (marginDirection === 'IMPROVING' && marginMomentum > 0) {
        parts.push(
          'Marže rastejo z pozitivno momentum — povečaj fokus na improving kategorije.',
        );
      } else {
        parts.push('Marže stabilne — optimiraj mix kategorij za višji avg margin.');
      }
      return parts.join(' ');
    })();

    const insights: TrendInsights = {
      marginPercentile,
      bestImprovingCategory,
      worstDecliningCategory,
      advice,
    };

    return NextResponse.json({
      ok: true,
      trend,
      monthlyData,
      drivers,
      byCategory,
      insights,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/profit-margin-trend-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
