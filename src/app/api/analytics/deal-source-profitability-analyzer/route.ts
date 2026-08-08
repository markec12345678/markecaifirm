// v7.89: Deal Source Profitability Analyzer — deep profitability analiza per
// deal source — razčleni profit na komponente (price margin, volume
// contribution, fee impact, efficiency) in identificira kaj profitabilnost
// per source poganja. Pure DB analytics (NO AI).
// "Bolha: profit 3200€, margin 28%, markup 42%, score 85/100 (#1). Driver:
// cost (-15% below estValue). Vinted: 800€, score 58/100 (#2)."
//
// Razlika od deal-source-roi (ki da simple ROI calculation) — ta DECOMPOSES
// profitability na drivers (price/cost/volume/efficiency). Razlika od
// deal-source-comparison-matrix (v7.70 ki primerja trenutne atribute) — ta
// gleda PROFITABILITY components + drivers + rank. Razlika od
// deal-source-intelligence (v7.82 AI ki da source intelligence) — ta je pure DB
// z decomposition. Razlika od deal-source-trend-analyzer (v7.87 ki analizira
// trends) — ta gleda PROFITABILITY komponente ne trends. Razlika od
// deal-source-performance-tracker (v7.85) in deal-source-quality-tracker
// (v7.86) — ta gleda PROFITABILITY z driver analysis.
//
// GET /api/analytics/deal-source-profitability-analyzer (Pure DB — NO AI)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type DriverImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
type TrendDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface DriverInfo {
  value: number;
  impact: DriverImpact;
  detail: string;
}

interface ProfitabilityComponents {
  grossProfit: number;
  revenue: number;
  cost: number;
  grossMargin: number; // %
  markupPercent: number; // %
  feeImpactPercent: number; // % (lower = better)
  volumeContribution: number;
  efficiencyScore: number; // € per day held
  tradeCount: number;
  avgProfitPerTrade: number;
}

interface ProfitabilityDrivers {
  priceDriver: DriverInfo;
  costDriver: DriverInfo;
  volumeDriver: DriverInfo;
  efficiencyDriver: DriverInfo;
}

interface SourceTrend {
  recent3mProfit: number;
  previous3mProfit: number;
  trendDirection: TrendDirection;
  trendPercent: number;
}

interface SourceEntry {
  source: string;
  displayName: string;
  components: ProfitabilityComponents;
  drivers: ProfitabilityDrivers;
  profitabilityScore: number; // 0-100
  profitabilityRank: number;
  trend: SourceTrend;
}

interface Summary {
  totalProfit: number;
  bestProfitSource: string | null;
  worstProfitSource: string | null;
  mostImprovedSource: string | null;
  avgProfitabilityScore: number;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
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

function clampScore(v: number): number {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, v));
}

function impactFromValue(v: number, threshold: number): DriverImpact {
  if (v > threshold) return 'POSITIVE';
  if (v < -threshold) return 'NEGATIVE';
  return 'NEUTRAL';
}

// Display name for source (capitalized)
function displayName(source: string): string {
  const known: Record<string, string> = {
    'bolha': 'Bolha',
    'vinted': 'Vinted',
    'avtonet': 'Avtonet',
    'mobile-de': 'mobile.de',
    'kleinanzeigen': 'Kleinanzeigen',
    'subito': 'Subito',
    'willhaben': 'Willhaben',
    'salomon': 'Salomon',
    'facebook': 'Facebook',
    'nepremicnine': 'Nepremičnine',
    'neznan': 'Neznan',
  };
  return known[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

// --- Source aggregation --------------------------------------------------

interface SoldTradeAgg {
  grossProfit: number;
  revenue: number;
  cost: number;
  totalFees: number;
  tradeCount: number;
  totalHoldDays: number;
  holdDaysCount: number; // number of trades with valid hold days
  profitPerTrade: number[]; // for trend
  sellPriceSum: number;
  estValueSum: number;
  estValueCount: number;
  buyPriceSum: number;
  // Trend data
  recent3mProfit: number;
  previous3mProfit: number;
}

function newSoldTradeAgg(): SoldTradeAgg {
  return {
    grossProfit: 0,
    revenue: 0,
    cost: 0,
    totalFees: 0,
    tradeCount: 0,
    totalHoldDays: 0,
    holdDaysCount: 0,
    profitPerTrade: [],
    sellPriceSum: 0,
    estValueSum: 0,
    estValueCount: 0,
    buyPriceSum: 0,
    recent3mProfit: 0,
    previous3mProfit: 0,
  };
}

// --- Trade row with linked listing ---------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    monitor: { source: string | null } | null;
  } | null;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);
    const cutoff6m = new Date(now - 6 * 30 * DAY_MS); // ~6 months ago
    const cutoff3m = new Date(now - 3 * 30 * DAY_MS); // ~3 months ago

    // 1) Query all SOLD trades from last 12 months with linked Listing (for monitor.source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        summary: {
          totalProfit: 0,
          bestProfitSource: null,
          worstProfitSource: null,
          mostImprovedSource: null,
          avgProfitabilityScore: 0,
          advice: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profitability Analyzer ni mogoč.',
        },
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profitability Analyzer ni mogoč.',
      });
    }

    // 2) Aggregate per source
    const sourceMap = new Map<string, SoldTradeAgg>();

    // For overall market averages (for driver comparisons)
    let totalAllProfit = 0;
    let totalAllSellPrice = 0;
    let totalAllSellCount = 0;
    let totalAllEstValue = 0;
    let totalAllEstCount = 0;
    let totalAllBuyPrice = 0;
    let totalAllBuyCount = 0;
    let totalAllHoldDays = 0;
    let totalAllHoldCount = 0;

    for (const t of soldTrades) {
      const source = (t.listing?.monitor?.source ?? 'neznan').trim().toLowerCase() || 'neznan';
      const sellMs = toMs(t.sellDate);
      const buyMs = toMs(t.buyDate);
      if (sellMs <= 0) continue;

      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;
      const revenue = sellPrice - sellFees;
      const cost = buyPrice + buyFees;
      const totalFees = sellFees + buyFees;
      const estValue = t.listing?.aiEstimatedValue ?? null;

      let agg = sourceMap.get(source);
      if (!agg) {
        agg = newSoldTradeAgg();
        sourceMap.set(source, agg);
      }
      agg.tradeCount += 1;
      agg.grossProfit += profit;
      agg.revenue += revenue;
      agg.cost += cost;
      agg.totalFees += totalFees;
      agg.sellPriceSum += sellPrice;
      agg.buyPriceSum += buyPrice;
      agg.profitPerTrade.push(profit);
      if (estValue != null && estValue > 0) {
        agg.estValueSum += estValue;
        agg.estValueCount += 1;
      }

      // Hold time = days between buy and sell
      if (buyMs > 0 && sellMs > buyMs) {
        const holdDays = (sellMs - buyMs) / DAY_MS;
        if (holdDays > 0 && holdDays < 3650) {
          agg.totalHoldDays += holdDays;
          agg.holdDaysCount += 1;
        }
      }

      // Recent 3m vs previous 3m trend
      if (sellMs >= cutoff3m.getTime()) {
        agg.recent3mProfit += profit;
      } else if (sellMs >= cutoff6m.getTime()) {
        agg.previous3mProfit += profit;
      }

      // Totals across all sources
      totalAllProfit += profit;
      totalAllSellPrice += sellPrice;
      totalAllSellCount += 1;
      if (estValue != null && estValue > 0) {
        totalAllEstValue += estValue;
        totalAllEstCount += 1;
      }
      totalAllBuyPrice += buyPrice;
      totalAllBuyCount += 1;
      if (buyMs > 0 && sellMs > buyMs) {
        const holdDays = (sellMs - buyMs) / DAY_MS;
        if (holdDays > 0 && holdDays < 3650) {
          totalAllHoldDays += holdDays;
          totalAllHoldCount += 1;
        }
      }
    }

    // Market averages for driver comparison
    const marketAvgSellPrice = totalAllSellCount > 0 ? totalAllSellPrice / totalAllSellCount : 0;
    const marketAvgEstValue = totalAllEstCount > 0 ? totalAllEstValue / totalAllEstCount : 0;
    const marketAvgBuyPrice = totalAllBuyCount > 0 ? totalAllBuyPrice / totalAllBuyCount : 0;
    const marketAvgHoldDays = totalAllHoldCount > 0 ? totalAllHoldDays / totalAllHoldCount : 0;
    const marketAvgProfitPerTrade = totalAllSellCount > 0 ? totalAllProfit / totalAllSellCount : 0;
    const marketAvgTradeCount = totalAllSellCount > 0 ? totalAllSellCount / Math.max(1, sourceMap.size) : 0;

    // 3) Compute per-source profitability components + drivers + score
    const sources: SourceEntry[] = [];
    for (const [source, agg] of sourceMap.entries()) {
      if (agg.tradeCount === 0) continue;

      const grossProfit = round0(agg.grossProfit);
      const revenue = round0(agg.revenue);
      const cost = round0(agg.cost);
      const grossMargin = revenue > 0 ? round1((agg.grossProfit / revenue) * 100) : 0;
      const markupPercent = cost > 0 ? round1((agg.revenue - agg.cost) / agg.cost * 100) : 0;
      const feeImpactPercent = revenue > 0 ? round1((agg.totalFees / revenue) * 100) : 0;
      const avgProfitPerTrade = round0(agg.grossProfit / agg.tradeCount);
      const volumeContribution = round0(agg.tradeCount * avgProfitPerTrade);
      const avgHoldDays = agg.holdDaysCount > 0 ? agg.totalHoldDays / agg.holdDaysCount : 0;
      const efficiencyScore = avgHoldDays > 0 ? round2(agg.grossProfit / avgHoldDays) : 0;

      // --- Drivers ---
      // Price driver: avg sell price vs market avg sell price
      const sourceAvgSellPrice = agg.tradeCount > 0 ? agg.sellPriceSum / agg.tradeCount : 0;
      const priceDelta = marketAvgSellPrice > 0
        ? round1(((sourceAvgSellPrice - marketAvgSellPrice) / marketAvgSellPrice) * 100)
        : 0;
      const priceDriver: DriverInfo = {
        value: round0(sourceAvgSellPrice),
        impact: impactFromValue(priceDelta, 5),
        detail: `Povprečna prodajna cena ${round0(sourceAvgSellPrice)}€ vs market ${round0(marketAvgSellPrice)}€ (${priceDelta > 0 ? '+' : ''}${priceDelta}%).`.slice(0, 200),
      };

      // Cost driver: avg buy price vs avg estValue (are we buying below value?)
      const sourceAvgEstValue = agg.estValueCount > 0 ? agg.estValueSum / agg.estValueCount : 0;
      const sourceAvgBuyPrice = agg.tradeCount > 0 ? agg.buyPriceSum / agg.tradeCount : 0;
      const costDelta = sourceAvgEstValue > 0
        ? round1(((sourceAvgBuyPrice - sourceAvgEstValue) / sourceAvgEstValue) * 100)
        : 0;
      const costDriver: DriverInfo = {
        value: round0(sourceAvgBuyPrice),
        impact: impactFromValue(-costDelta, 5), // negative delta (buy below estValue) = POSITIVE
        detail: sourceAvgEstValue > 0
          ? `Povprečna kupna ${round0(sourceAvgBuyPrice)}€ vs estValue ${round0(sourceAvgEstValue)}€ (${costDelta > 0 ? '+' : ''}${costDelta}%).`.slice(0, 200)
          : `Povprečna kupna ${round0(sourceAvgBuyPrice)}€ (brez estValue podatkov).`.slice(0, 200),
      };

      // Volume driver: trade count contribution vs market avg per source
      const volumeDelta = marketAvgTradeCount > 0
        ? round1(((agg.tradeCount - marketAvgTradeCount) / marketAvgTradeCount) * 100)
        : 0;
      const volumeDriver: DriverInfo = {
        value: agg.tradeCount,
        impact: impactFromValue(volumeDelta, 10),
        detail: `${agg.tradeCount} trgov vs market avg ${round1(marketAvgTradeCount)} (${volumeDelta > 0 ? '+' : ''}${volumeDelta}%).`.slice(0, 200),
      };

      // Efficiency driver: avg hold days vs market avg
      const efficiencyDelta = marketAvgHoldDays > 0
        ? round1(((avgHoldDays - marketAvgHoldDays) / marketAvgHoldDays) * 100)
        : 0;
      const efficiencyDriver: DriverInfo = {
        value: round1(avgHoldDays),
        impact: impactFromValue(-efficiencyDelta, 10), // lower hold days = POSITIVE
        detail: `Povprečno ${round1(avgHoldDays)} dni held vs market ${round1(marketAvgHoldDays)} (${efficiencyDelta > 0 ? '+' : ''}${efficiencyDelta}%).`.slice(0, 200),
      };

      // --- Profitability score (0-100) ---
      // 30% weight: grossMargin (clamped to [0, 50] → 0-100)
      // 25% weight: markupPercent (clamped to [0, 100] → 0-100)
      // 20% weight: volumeContribution (relative to top source)
      // 15% weight: efficiencyScore (relative to top source)
      // 10% weight: feeImpactPercent (inverse — lower fees = higher score)
      const marginScore = clampScore(grossMargin * 2); // 0-50% → 0-100
      const markupScore = clampScore(markupPercent); // 0-100% → 0-100
      // Volume + efficiency scored relative to top — defer, store raw for now
      sources.push({
        source,
        displayName: displayName(source),
        components: {
          grossProfit,
          revenue,
          cost,
          grossMargin,
          markupPercent,
          feeImpactPercent,
          volumeContribution,
          efficiencyScore,
          tradeCount: agg.tradeCount,
          avgProfitPerTrade,
        },
        drivers: {
          priceDriver,
          costDriver,
          volumeDriver,
          efficiencyDriver,
        },
        profitabilityScore: round0(
          marginScore * 0.30 + markupScore * 0.25, // partial; volume/efficiency/fee added later
        ),
        profitabilityRank: 0,
        trend: {
          recent3mProfit: round0(agg.recent3mProfit),
          previous3mProfit: round0(agg.previous3mProfit),
          trendDirection: 'STABLE',
          trendPercent: 0,
        },
      });

      // Store trend data — recent3m vs previous3m
      const last = sources[sources.length - 1]!;
      const recent = agg.recent3mProfit;
      const previous = agg.previous3mProfit;
      let trendDirection: TrendDirection = 'STABLE';
      let trendPercent = 0;
      if (previous > 0) {
        trendPercent = round1(((recent - previous) / Math.abs(previous)) * 100);
        if (trendPercent > 10) trendDirection = 'IMPROVING';
        else if (trendPercent < -10) trendDirection = 'DECLINING';
      } else if (recent > 0) {
        trendPercent = 100; // growth from zero
        trendDirection = 'IMPROVING';
      } else if (recent < 0 && previous >= 0) {
        trendPercent = -100;
        trendDirection = 'DECLINING';
      }
      last.trend = {
        recent3mProfit: round0(recent),
        previous3mProfit: round0(previous),
        trendDirection,
        trendPercent,
      };
    }

    if (sources.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        summary: {
          totalProfit: 0,
          bestProfitSource: null,
          worstProfitSource: null,
          mostImprovedSource: null,
          avgProfitabilityScore: 0,
          advice: 'Ni SOLD trgovin z znanim source-om v zadnjih 12 mesecih — Deal Source Profitability Analyzer ni mogoč.',
        },
        message: 'Ni SOLD trgovin z znanim source-om v zadnjih 12 mesecih — Deal Source Profitability Analyzer ni mogoč.',
      });
    }

    // 4) Compute relative volume + efficiency + fee scores (relative to max)
    const maxVolumeContribution = Math.max(1, ...sources.map((s) => s.components.volumeContribution));
    const maxEfficiencyScore = Math.max(1, ...sources.map((s) => s.components.efficiencyScore));
    const maxFeeImpact = Math.max(0.01, ...sources.map((s) => s.components.feeImpactPercent));

    for (const s of sources) {
      const volumeScore = clampScore((s.components.volumeContribution / maxVolumeContribution) * 100);
      const efficiencyRelScore = clampScore((s.components.efficiencyScore / maxEfficiencyScore) * 100);
      // Fee impact — lower is better. Score = (1 - feeImpact/maxFee) * 100
      const feeScore = clampScore((1 - s.components.feeImpactPercent / maxFeeImpact) * 100);

      // Recompute profitability score with all 5 components
      const marginScore = clampScore(s.components.grossMargin * 2);
      const markupScore = clampScore(s.components.markupPercent);
      s.profitabilityScore = round0(
        marginScore * 0.30 +
        markupScore * 0.25 +
        volumeScore * 0.20 +
        efficiencyRelScore * 0.15 +
        feeScore * 0.10,
      );
    }

    // 5) Rank by profitability score desc
    sources.sort((a, b) => b.profitabilityScore - a.profitabilityScore);
    sources.forEach((s, i) => {
      s.profitabilityRank = i + 1;
    });

    // 6) Summary
    const totalProfit = round0(sources.reduce((s, x) => s + x.components.grossProfit, 0));
    const bestProfitSource = sources.length > 0
      ? sources.reduce((b, s) => (s.components.grossProfit > b.components.grossProfit ? s : b), sources[0]!).source
      : null;
    const worstProfitSource = sources.length > 0
      ? sources.reduce((w, s) => (s.components.grossProfit < w.components.grossProfit ? s : w), sources[0]!).source
      : null;
    const mostImproved = sources
      .filter((s) => s.trend.trendDirection === 'IMPROVING')
      .sort((a, b) => b.trend.trendPercent - a.trend.trendPercent)[0];
    const mostImprovedSource = mostImproved ? mostImproved.source : null;
    const avgProfitabilityScore = sources.length > 0
      ? round1(sources.reduce((s, x) => s + x.profitabilityScore, 0) / sources.length)
      : 0;

    let advice = '';
    if (sources.length === 1) {
      advice = `En sam source (${sources[0]!.displayName}): profit ${sources[0]!.components.grossProfit}€, score ${sources[0]!.profitabilityScore}/100. Diversifikacija na druge vire priporočena za zmanjšanje tveganja.`;
    } else {
      const top = sources[0]!;
      const bottom = sources[sources.length - 1]!;
      advice = `Top source: ${top.displayName} (${top.components.grossProfit}€, score ${top.profitabilityScore}/100, rank #${top.profitabilityRank}). Bottom: ${bottom.displayName} (${bottom.components.grossProfit}€, score ${bottom.profitabilityScore}/100).`;
      if (mostImproved) {
        advice += ` Najbolj improved: ${mostImproved.displayName} (+${mostImproved.trend.trendPercent}%).`;
      }
      if (bottom.profitabilityScore < 40) {
        advice += ` Zmanjšaj aktivnost na ${bottom.displayName}.`;
      }
      if (top.profitabilityScore > 70) {
        advice += ` Povečaj obseg na ${top.displayName}.`;
      }
    }

    return NextResponse.json({
      ok: true,
      sources,
      summary: {
        totalProfit,
        bestProfitSource,
        worstProfitSource,
        mostImprovedSource,
        avgProfitabilityScore,
        advice: advice.slice(0, 500),
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-source-profitability-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
