// v7.80: AI Trade Performance Forecaster — AI napove individualno trade
// performance za vsak HELD item — predvidi izid (profit, hold time, sell
// probability) glede na zgodovinske vzorce. "PS5 bo verjetno prodan v 18
// dneh za 380€ (72% verjetnost)." Per-item forecast z estimated sell date
// range, sell price, profit, ROI, sell probability in 5-level outlook.
//
// Razlika od inventory-roi-optimizer (v7.79, ki optimira ROI z rebalance
// actions) — ta FORECAST-a individual trade performance z sell probability
// in date range. Razlika od inventory-turnover-forecast (v7.78, ki napove
// turnover RATE za portfolio) — ta gleda POSAMEZNE HELD item-e z
// sellProbability in predictedSellDate. Razlika od deal-quality-forecaster
// (ki napove quality po dnevih) — ta gleda POSAMEZNE HELD inventar z
// per-item prediction. Razlika od deal-pipeline-forecaster (v7.76, ki
// napove pipeline faze) — ta da PREDICTED SELL DATE in PRICE za held item-e.
// Razlika od profit-trajectory-forecaster (ki napove growth trajectory) —
// ta forecast-a POSAMEZNE held trade-e z sellProbability in confidence.
// Razlika od deal-source-roi (ki gleda ROI po viru) — ta forecast-a PER
// ITEM z date range in probability. Razlika od inventory-profitability-
// analyzer (ki analizira profitabilnost kategorij) — ta forecast-a
// POSAMEZNE held item-e z actionable prediction. Razlika od cash-flow-
// velocity (ki gleda cash velocity) — ta gleda SELL PROBABILITY in
// PREDICTED SELL DATE za held inventar. Razlika od profit-efficiency-
// analyzer (ki gleda profit/day) — ta da PROBABILITY-BASED forecast per
// item z date range in outlook.
//
// GET+POST /api/ai/trade-performance-forecaster
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import {
  callProviderForRaw,
  parseJsonLooseExported,
  type AiProviderType,
  type AiSettings,
} from '@/lib/ai';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type PerformanceOutlook =
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'POOR'
  | 'VERY_POOR';
type ImpactType = 'POSITIVE' | 'NEGATIVE';

interface KeyFactor {
  factor: string;
  impact: ImpactType;
  weight: number; // 0-100
}

interface ForecastItem {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  daysHeld: number;
  predictedSellDate: {
    earliest: string; // ISO date
    latest: string; // ISO date
  };
  predictedSellPrice: number;
  predictedProfit: number;
  predictedROI: number; // %
  sellProbability: number; // %
  predictedHoldDays: number; // additional days until sale
  confidenceLevel: number; // 0-100
  keyFactors: KeyFactor[];
  performanceOutlook: PerformanceOutlook;
}

interface OutlookDistribution {
  excellent: number;
  good: number;
  average: number;
  poor: number;
  veryPoor: number;
}

interface PortfolioForecast {
  totalItems: number;
  avgSellProbability: number;
  avgPredictedROI: number;
  totalPredictedProfit: number;
  avgConfidence: number;
  outlookDistribution: OutlookDistribution;
}

interface AiForecastResponse {
  items?: unknown;
  summary?: unknown;
}

// --- Helpers -------------------------------------------------------------

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

const VALID_OUTLOOK: readonly PerformanceOutlook[] = [
  'EXCELLENT',
  'GOOD',
  'AVERAGE',
  'POOR',
  'VERY_POOR',
];

const VALID_IMPACT: readonly ImpactType[] = ['POSITIVE', 'NEGATIVE'];

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

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

// --- Historical model ----------------------------------------------------

interface CategoryHistory {
  avgHoldDays: number;
  avgProfit: number;
  avgROI: number; // %
  sellCount: number;
  totalCount: number;
  sellProbability: number; // %
}

interface HistoricalModel {
  perCategory: Map<string, CategoryHistory>;
  overall: CategoryHistory;
  perPriceRange: Map<string, CategoryHistory>;
  recentSellRate: number; // sold per day in last 30d — market momentum
}

function buildHistoricalModel(
  soldTrades: Array<{
    category: string;
    buyPrice: number | null;
    buyFees: number | null;
    sellPrice: number | null;
    sellFees: number | null;
    buyDate: Date | null;
    sellDate: Date | null;
  }>,
  now: number,
): HistoricalModel {
  const cutoff30d = now - 30 * 86_400_000;
  let recentSold = 0;

  const catMap = new Map<string, CategoryHistory>();
  const priceMap = new Map<string, CategoryHistory>();

  // Overall accumulators
  let oHoldSum = 0;
  let oProfitSum = 0;
  let oRoiSum = 0;
  let oSellCount = 0;
  let oTotalCount = 0;

  for (const t of soldTrades) {
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyMs = toMs(t.buyDate);
    const sellMs = toMs(t.sellDate);
    const holdDays = buyMs > 0 && sellMs > 0 ? daysBetween(buyMs, sellMs) : 0;
    const profit = sellPrice - sellFees - buyPrice - buyFees;
    const cost = buyPrice + buyFees;
    const roi = cost > 0 ? (profit / cost) * 100 : 0;

    if (sellMs >= cutoff30d) recentSold += 1;

    // Per-category
    const category = (t.category || '').trim().toLowerCase() || 'neznan';
    let c = catMap.get(category);
    if (!c) {
      c = {
        avgHoldDays: 0,
        avgProfit: 0,
        avgROI: 0,
        sellCount: 0,
        totalCount: 0,
        sellProbability: 0,
      };
      catMap.set(category, c);
    }
    c.avgHoldDays += holdDays;
    c.avgProfit += profit;
    c.avgROI += roi;
    c.sellCount += 1;
    c.totalCount += 1;

    // Per-price-range (buckets: <100, 100-500, 500-2000, 2000+)
    let bucket = '<100';
    if (buyPrice >= 2000) bucket = '2000+';
    else if (buyPrice >= 500) bucket = '500-2000';
    else if (buyPrice >= 100) bucket = '100-500';
    let p = priceMap.get(bucket);
    if (!p) {
      p = {
        avgHoldDays: 0,
        avgProfit: 0,
        avgROI: 0,
        sellCount: 0,
        totalCount: 0,
        sellProbability: 0,
      };
      priceMap.set(bucket, p);
    }
    p.avgHoldDays += holdDays;
    p.avgProfit += profit;
    p.avgROI += roi;
    p.sellCount += 1;
    p.totalCount += 1;

    // Overall
    oHoldSum += holdDays;
    oProfitSum += profit;
    oRoiSum += roi;
    oSellCount += 1;
    oTotalCount += 1;
  }

  // Finalize averages
  for (const c of catMap.values()) {
    if (c.sellCount > 0) {
      c.avgHoldDays = round1(c.avgHoldDays / c.sellCount);
      c.avgProfit = round1(c.avgProfit / c.sellCount);
      c.avgROI = round1(c.avgROI / c.sellCount);
    }
    c.sellProbability =
      c.totalCount > 0 ? round1((c.sellCount / c.totalCount) * 100) : 0;
  }
  for (const p of priceMap.values()) {
    if (p.sellCount > 0) {
      p.avgHoldDays = round1(p.avgHoldDays / p.sellCount);
      p.avgProfit = round1(p.avgProfit / p.sellCount);
      p.avgROI = round1(p.avgROI / p.sellCount);
    }
    p.sellProbability =
      p.totalCount > 0 ? round1((p.sellCount / p.totalCount) * 100) : 0;
  }

  const overall: CategoryHistory = {
    avgHoldDays: oSellCount > 0 ? round1(oHoldSum / oSellCount) : 0,
    avgProfit: oSellCount > 0 ? round1(oProfitSum / oSellCount) : 0,
    avgROI: oSellCount > 0 ? round1(oRoiSum / oSellCount) : 0,
    sellCount: oSellCount,
    totalCount: oTotalCount,
    sellProbability: 0,
  };
  overall.sellProbability =
    oTotalCount > 0 ? round1((oSellCount / oTotalCount) * 100) : 0;

  // recentSellRate = sold/day in last 30d
  const recentSellRate = round1(recentSold / 30);

  return {
    perCategory: catMap,
    overall,
    perPriceRange: priceMap,
    recentSellRate,
  };
}

// Compute deterministic predicted sell price for a held item
// (clamp to [0.5x, 1.3x] aiEstimatedValue — anti-hallucination)
function computePredictedSellPrice(
  aiEstimatedValue: number | null,
  buyPrice: number,
  categoryHistory: CategoryHistory | null,
  overall: CategoryHistory,
): number {
  // Anchor on AI estValue if available
  let base: number;
  if (aiEstimatedValue != null && aiEstimatedValue > 0) {
    // Use category avg ROI to adjust — if category historically underperforms estValue, lean lower
    const catROI =
      categoryHistory != null ? categoryHistory.avgROI : overall.avgROI;
    // If category historically achieves positive ROI, estValue is reliable
    // If negative, sell price tends to be lower than estValue
    const adjustment = catROI >= 0 ? 1.0 : 0.9;
    base = aiEstimatedValue * adjustment;
  } else if (categoryHistory != null && categoryHistory.sellCount > 0) {
    // No estValue — use category avg ROI applied to buyPrice
    base = buyPrice * (1 + categoryHistory.avgROI / 100);
  } else {
    // Fallback to overall avg ROI applied to buyPrice
    base = buyPrice * (1 + overall.avgROI / 100);
  }

  // Anti-hallucination: clamp predictedSellPrice to [0.5x, 1.3x] estValue
  // (or [0.5x, 1.3x] buyPrice if no estValue)
  const anchor =
    aiEstimatedValue != null && aiEstimatedValue > 0
      ? aiEstimatedValue
      : buyPrice;
  const minP = anchor * 0.5;
  const maxP = anchor * 1.3;
  return round0(Math.max(minP, Math.min(maxP, base)));
}

// Compute deterministic sell probability (0-100)
// Based on: category sell rate, days held vs avg, dealScore
function computeSellProbability(
  daysHeld: number,
  categoryHistory: CategoryHistory | null,
  overall: CategoryHistory,
  dealScore: number | null,
  aiEstimatedValue: number | null,
  buyPrice: number,
): number {
  // Base probability from category sell rate
  let prob =
    categoryHistory != null && categoryHistory.sellCount > 0
      ? categoryHistory.sellProbability
      : overall.sellProbability;

  // If no historical data at all, start with neutral 50%
  if (overall.sellCount === 0) prob = 50;

  // Adjust based on daysHeld vs category avg
  const avgHoldDays =
    categoryHistory != null && categoryHistory.sellCount > 0
      ? categoryHistory.avgHoldDays
      : overall.avgHoldDays;
  if (avgHoldDays > 0) {
    if (daysHeld < avgHoldDays * 0.5) {
      // Fresh item — full probability
      // (no penalty)
    } else if (daysHeld < avgHoldDays) {
      prob -= 5; // approaching avg hold time
    } else if (daysHeld < avgHoldDays * 2) {
      prob -= 15; // beyond avg — aging
    } else {
      prob -= 30; // well beyond avg — stale
    }
  } else {
    // No avg — use generic buckets
    if (daysHeld > 60) prob -= 30;
    else if (daysHeld > 30) prob -= 15;
    else if (daysHeld > 14) prob -= 5;
  }

  // Adjust based on dealScore (higher = better deal = more likely to sell)
  if (dealScore != null && dealScore > 0) {
    // dealScore 50 = neutral, 80+ = +15, <30 = -15
    const delta = (dealScore - 50) * 0.3;
    prob += delta;
  }

  // Adjust based on price attractiveness (estValue/buyPrice ratio)
  if (aiEstimatedValue != null && aiEstimatedValue > 0 && buyPrice > 0) {
    const ratio = aiEstimatedValue / buyPrice;
    if (ratio > 1.2) prob += 10;
    else if (ratio > 1.0) prob += 5;
    else if (ratio < 0.8) prob -= 10;
  }

  return Math.max(0, Math.min(100, round1(prob)));
}

// Compute predicted additional hold days (until sale)
function computePredictedHoldDays(
  daysHeld: number,
  categoryHistory: CategoryHistory | null,
  overall: CategoryHistory,
): number {
  const avgHoldDays =
    categoryHistory != null && categoryHistory.sellCount > 0
      ? categoryHistory.avgHoldDays
      : overall.avgHoldDays > 0
        ? overall.avgHoldDays
        : 21; // default 3 weeks

  // If item is fresh — predict full avg hold time
  if (daysHeld < avgHoldDays) {
    return Math.max(0, round0(avgHoldDays - daysHeld));
  }
  // If aging — predict shorter remaining time
  // (older items have less remaining time, but never 0 unless already past avg*2)
  const overshoot = daysHeld - avgHoldDays;
  if (overshoot > avgHoldDays) {
    // Very stale — predict fast clearance (within 7 days)
    return Math.max(1, Math.min(7, round0(avgHoldDays * 0.3)));
  }
  // Mild overshoot — predict half of avg remaining
  return Math.max(1, round0(avgHoldDays * 0.5));
}

// Compute confidence level (0-100)
function computeConfidence(
  categoryHistory: CategoryHistory | null,
  overall: CategoryHistory,
  hasEstValue: boolean,
  hasDealScore: boolean,
): number {
  let conf = 40; // base
  // More historical data = more confidence
  const sampleSize =
    categoryHistory != null && categoryHistory.sellCount > 0
      ? categoryHistory.sellCount
      : overall.sellCount;
  if (sampleSize >= 20) conf += 30;
  else if (sampleSize >= 10) conf += 22;
  else if (sampleSize >= 5) conf += 15;
  else if (sampleSize >= 1) conf += 8;
  // AI estValue boosts confidence
  if (hasEstValue) conf += 15;
  if (hasDealScore) conf += 10;
  return Math.max(10, Math.min(95, round1(conf)));
}

// Compute performance outlook from predicted ROI + sell probability + confidence
function computeOutlook(
  predictedROI: number,
  sellProbability: number,
  confidence: number,
): PerformanceOutlook {
  // Composite score
  const roiScore = Math.max(0, Math.min(100, 50 + predictedROI * 1.5));
  const composite = roiScore * 0.5 + sellProbability * 0.35 + confidence * 0.15;
  if (composite >= 80) return 'EXCELLENT';
  if (composite >= 65) return 'GOOD';
  if (composite >= 50) return 'AVERAGE';
  if (composite >= 35) return 'POOR';
  return 'VERY_POOR';
}

// Build key factors for a held item (top 3)
interface FactorInput {
  category: string;
  daysHeld: number;
  buyPrice: number;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  categoryHistory: CategoryHistory | null;
  overall: CategoryHistory;
  sellProbability: number;
  predictedROI: number;
}

function buildKeyFactors(input: FactorInput): KeyFactor[] {
  const factors: KeyFactor[] = [];

  // 1. Price attractiveness
  if (
    input.aiEstimatedValue != null &&
    input.aiEstimatedValue > 0 &&
    input.buyPrice > 0
  ) {
    const ratio = input.aiEstimatedValue / input.buyPrice;
    const discount = round1((ratio - 1) * 100);
    if (discount > 0) {
      factors.push({
        factor: `Cena ${discount}% pod AI estValue`,
        impact: 'POSITIVE',
        weight: Math.min(95, Math.round(50 + discount * 1.5)),
      });
    } else if (discount < 0) {
      factors.push({
        factor: `Cena ${Math.abs(discount)}% nad AI estValue`,
        impact: 'NEGATIVE',
        weight: Math.min(95, Math.round(50 + Math.abs(discount) * 1.5)),
      });
    }
  }

  // 2. Category performance
  if (input.categoryHistory != null && input.categoryHistory.sellCount > 0) {
    const catROI = input.categoryHistory.avgROI;
    if (catROI >= 10) {
      factors.push({
        factor: `Kategorija ${input.category} zgodovinsko +${catROI}% ROI`,
        impact: 'POSITIVE',
        weight: Math.min(90, Math.round(40 + catROI)),
      });
    } else if (catROI < 0) {
      factors.push({
        factor: `Kategorija ${input.category} zgodovinsko ${catROI}% ROI`,
        impact: 'NEGATIVE',
        weight: Math.min(90, Math.round(40 + Math.abs(catROI))),
      });
    }
  }

  // 3. Days held vs avg
  const avgHold =
    input.categoryHistory != null && input.categoryHistory.sellCount > 0
      ? input.categoryHistory.avgHoldDays
      : input.overall.avgHoldDays;
  if (avgHold > 0) {
    if (input.daysHeld < avgHold * 0.5) {
      factors.push({
        factor: `Svež item (${input.daysHeld}d od ${round0(avgHold)}d povp.)`,
        impact: 'POSITIVE',
        weight: 60,
      });
    } else if (input.daysHeld > avgHold * 1.5) {
      factors.push({
        factor: `Zastarel (${input.daysHeld}d od ${round0(avgHold)}d povp.)`,
        impact: 'NEGATIVE',
        weight: Math.min(95, 50 + Math.round((input.daysHeld - avgHold) * 0.5)),
      });
    }
  }

  // 4. DealScore
  if (input.dealScore != null && input.dealScore > 0) {
    if (input.dealScore >= 70) {
      factors.push({
        factor: `DealScore ${input.dealScore}/100 — dobra ponudba`,
        impact: 'POSITIVE',
        weight: Math.min(95, input.dealScore),
      });
    } else if (input.dealScore < 40) {
      factors.push({
        factor: `DealScore ${input.dealScore}/100 — šibka ponudba`,
        impact: 'NEGATIVE',
        weight: Math.min(95, 100 - input.dealScore),
      });
    }
  }

  // 5. Sell probability
  if (input.sellProbability >= 70) {
    factors.push({
      factor: `Visoka sell probability (${input.sellProbability}%)`,
      impact: 'POSITIVE',
      weight: Math.min(95, Math.round(input.sellProbability)),
    });
  } else if (input.sellProbability < 35) {
    factors.push({
      factor: `Nizka sell probability (${input.sellProbability}%)`,
      impact: 'NEGATIVE',
      weight: Math.min(95, Math.round(100 - input.sellProbability)),
    });
  }

  // Sort by weight desc, take top 3
  factors.sort((a, b) => b.weight - a.weight);
  return factors.slice(0, 3);
}

// Build predicted sell date range (earliest, latest)
function buildDateRange(
  predictedHoldDays: number,
  now: number,
): { earliest: string; latest: string } {
  const earliestMs =
    now + Math.max(1, Math.round(predictedHoldDays * 0.6)) * 86_400_000;
  const latestMs =
    now + Math.max(2, Math.round(predictedHoldDays * 1.4)) * 86_400_000;
  return {
    earliest: new Date(earliestMs).toISOString().slice(0, 10),
    latest: new Date(latestMs).toISOString().slice(0, 10),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleTradePerformanceForecaster(req);
}
export async function POST(req: NextRequest) {
  return handleTradePerformanceForecaster(req);
}

async function handleTradePerformanceForecaster(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-trade-performance-forecaster', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            dealScore: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    });

    // 2) Query historical SOLD trades to build prediction model
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
      },
      select: {
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'desc' },
      take: 100000,
    });

    const model = buildHistoricalModel(soldTrades, now);

    // 3) Compute per-item forecast (deterministic)
    const items: ForecastItem[] = [];

    for (const t of heldTrades) {
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      if (buyPrice <= 0) continue;

      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? null;
      const dealScore = t.listing?.dealScore ?? null;
      const buyMs = toMs(t.buyDate);
      const daysHeld = buyMs > 0 ? daysBetween(buyMs, now) : 0;

      const category =
        (t.category || t.listing?.monitor?.source || '').trim().toLowerCase() ||
        'neznan';
      const categoryHistory = model.perCategory.get(category) ?? null;

      const predictedSellPrice = computePredictedSellPrice(
        aiEstimatedValue,
        buyPrice,
        categoryHistory,
        model.overall,
      );
      const predictedProfit = round0(predictedSellPrice - buyPrice - buyFees);
      const predictedROI = round1(
        (predictedProfit / Math.max(1, buyPrice + buyFees)) * 100,
      );
      const sellProbability = computeSellProbability(
        daysHeld,
        categoryHistory,
        model.overall,
        dealScore,
        aiEstimatedValue,
        buyPrice,
      );
      const predictedHoldDays = computePredictedHoldDays(
        daysHeld,
        categoryHistory,
        model.overall,
      );
      const confidenceLevel = computeConfidence(
        categoryHistory,
        model.overall,
        aiEstimatedValue != null && aiEstimatedValue > 0,
        dealScore != null && dealScore > 0,
      );
      const performanceOutlook = computeOutlook(
        predictedROI,
        sellProbability,
        confidenceLevel,
      );
      const dateRange = buildDateRange(predictedHoldDays, now);
      const keyFactors = buildKeyFactors({
        category,
        daysHeld,
        buyPrice,
        aiEstimatedValue,
        dealScore,
        categoryHistory,
        overall: model.overall,
        sellProbability,
        predictedROI,
      });

      items.push({
        tradeId: t.id,
        title: t.title.slice(0, 100),
        category,
        buyPrice: round0(buyPrice),
        aiEstimatedValue: aiEstimatedValue ?? null,
        daysHeld,
        predictedSellDate: dateRange,
        predictedSellPrice,
        predictedProfit,
        predictedROI,
        sellProbability,
        predictedHoldDays,
        confidenceLevel,
        keyFactors,
        performanceOutlook,
      });
    }

    const totalItems = items.length;

    // 4) Portfolio summary
    const outlookDistribution: OutlookDistribution = {
      excellent: items.filter((i) => i.performanceOutlook === 'EXCELLENT')
        .length,
      good: items.filter((i) => i.performanceOutlook === 'GOOD').length,
      average: items.filter((i) => i.performanceOutlook === 'AVERAGE').length,
      poor: items.filter((i) => i.performanceOutlook === 'POOR').length,
      veryPoor: items.filter((i) => i.performanceOutlook === 'VERY_POOR')
        .length,
    };
    const avgSellProbability =
      totalItems > 0
        ? round1(items.reduce((s, i) => s + i.sellProbability, 0) / totalItems)
        : 0;
    const avgPredictedROI =
      totalItems > 0
        ? round1(items.reduce((s, i) => s + i.predictedROI, 0) / totalItems)
        : 0;
    const totalPredictedProfit = round0(
      items.reduce((s, i) => s + i.predictedProfit, 0),
    );
    const avgConfidence =
      totalItems > 0
        ? round1(items.reduce((s, i) => s + i.confidenceLevel, 0) / totalItems)
        : 0;

    const portfolio: PortfolioForecast = {
      totalItems,
      avgSellProbability,
      avgPredictedROI,
      totalPredictedProfit,
      avgConfidence,
      outlookDistribution,
    };

    // Empty state — no HELD items
    if (totalItems === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        portfolio,
        summary:
          'Ni HELD inventarja — Trade Performance Forecaster ni mogoč.',
        aiUsed: false,
        message:
          'Ni HELD inventarja — Trade Performance Forecaster ni mogoč.',
      });
    }

    // 5) AI cache check (6h TTL) — key by heldItemIds
    const heldItemIds = items.map((i) => i.tradeId).sort();
    const cacheKey = `trade-performance-forecaster:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      items: ForecastItem[];
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        items: cached.items,
        portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) Deterministic summary fallback
    const excellent = outlookDistribution.excellent;
    const good = outlookDistribution.good;
    const poor = outlookDistribution.poor;
    const veryPoor = outlookDistribution.veryPoor;
    const deterministicSummary =
      `Trade Performance Forecast: ${totalItems} HELD item-ov. ` +
      `Povprečna sell probability ${avgSellProbability}%, povprečni predicted ROI ${avgPredictedROI}%. ` +
      `Outlook: ${excellent} EXCELLENT, ${good} GOOD, ${outlookDistribution.average} AVERAGE, ${poor} POOR, ${veryPoor} VERY_POOR. ` +
      `Skupni predicted profit: ${totalPredictedProfit >= 0 ? '+' : ''}${totalPredictedProfit}€. ` +
      `Confidence: ${avgConfidence}/100.`;

    // 7) AI prompt with grounding
    const settings = await getSettingsRow();
    const aiSettings: AiSettings = {
      provider: settings.aiProvider as AiProviderType,
      baseUrl: settings.aiBaseUrl,
      apiKey: settings.aiApiKey,
      model: settings.aiModel,
      fallbackProvider: (settings.fallbackProvider || '') as
        | AiProviderType
        | '',
      fallbackBaseUrl: settings.fallbackBaseUrl || '',
      fallbackApiKey: settings.fallbackApiKey || '',
      fallbackModel: settings.fallbackModel || '',
    };

    // Items for prompt — top 25 by confidence (most data-rich)
    const itemsForPrompt = items
      .slice()
      .sort((a, b) => b.confidenceLevel - a.confidenceLevel)
      .slice(0, 25)
      .map((i) => ({
        tradeId: i.tradeId,
        title: i.title,
        category: i.category,
        buyPrice: i.buyPrice,
        aiEstimatedValue: i.aiEstimatedValue,
        daysHeld: i.daysHeld,
        deterministicPredictedSellPrice: i.predictedSellPrice,
        deterministicPredictedProfit: i.predictedProfit,
        deterministicPredictedROI: i.predictedROI,
        deterministicSellProbability: i.sellProbability,
        deterministicPredictedHoldDays: i.predictedHoldDays,
        deterministicConfidence: i.confidenceLevel,
        deterministicKeyFactors: i.keyFactors,
        deterministicOutlook: i.performanceOutlook,
      }));

    // Per-category historical summaries for prompt
    const categorySummaries = Array.from(model.perCategory.entries())
      .map(([cat, h]) => ({
        category: cat,
        avgHoldDays: h.avgHoldDays,
        avgROI: h.avgROI,
        sellCount: h.sellCount,
        sellProbability: h.sellProbability,
      }))
      .sort((a, b) => b.sellCount - a.sellCount)
      .slice(0, 10);

    const prompt = `Si AI "Trade Performance Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napoveduj individualno trade performance za vsak HELD item — predvidi izid (profit, hold time, sell probability) glede na zgodovinske vzorce.

PORTFOLIO STANJE (deterministično izračunano):
- totalItems: ${totalItems}
- avgSellProbability: ${avgSellProbability}%
- avgPredictedROI: ${avgPredictedROI}%
- totalPredictedProfit: ${totalPredictedProfit}€
- avgConfidence: ${avgConfidence}/100
- outlookDistribution: ${excellent} EXCELLENT, ${good} GOOD, ${outlookDistribution.average} AVERAGE, ${poor} POOR, ${veryPoor} VERY_POOR

ZGODOVINSKI MODEL (zadnji SOLD trade-i):
- overall: avgHoldDays=${model.overall.avgHoldDays}, avgROI=${model.overall.avgROI}%, sellProbability=${model.overall.sellProbability}%, sellCount=${model.overall.sellCount}
- recentSellRate (zadnjih 30d): ${model.recentSellRate} sold/day
- topCategories: ${JSON.stringify(categorySummaries, null, 2)}

HELD ITEM-I (top 25 z najvišjo confidence, deterministično izračunano):
${JSON.stringify(itemsForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. items: array z AI-optimiziranimi forecast-i za vsak item (isti vrstni red kot vhod):
   - tradeId: enak kot v vhodu
   - predictedSellPrice: pričakovana prodajna cena (clamped na [0.5x, 1.3x] aiEstimatedValue, ali [0.5x, 1.3x] buyPrice če manjka estValue)
   - predictedProfit: predictedSellPrice - buyPrice - fees (lahko negativno)
   - predictedROI: (predictedProfit / buyPrice) × 100 (clamped [-100, 500])
   - sellProbability: 0-100% verjetnost prodaje v 30 dneh (clamped [0, 100])
   - predictedHoldDays: dodatni dnevi do prodaje (min 1, max 180)
   - confidenceLevel: 0-100 (clamped [10, 95])
   - keyFactors: top 3 faktorji z impact POSITIVE/NEGATIVE in weight 0-100
   - performanceOutlook: EXCELLENT | GOOD | AVERAGE | POOR | VERY_POOR (validiraj proti enum)
2. summary: slovenski povzetek forecast-a (max 500 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "items": [
    { "tradeId": "...", "predictedSellPrice": 0, "predictedProfit": 0, "predictedROI": 0, "sellProbability": 0, "predictedHoldDays": 0, "confidenceLevel": 0, "keyFactors": [{ "factor": "...", "impact": "POSITIVE", "weight": 50 }], "performanceOutlook": "GOOD" }
  ],
  "summary": "..."
}${GROUNDING_PROMPT_SUFFIX}`;

    let finalItems = items;
    let summary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiForecastResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Parse items — AI overrides per-item forecast
        if (Array.isArray(parsed.items)) {
          const aiItemMap = new Map<string, Record<string, unknown>>();
          for (const a of parsed.items) {
            const ar = a as Record<string, unknown>;
            if (!ar || typeof ar !== 'object') continue;
            const tid = String(ar.tradeId || '').trim();
            if (tid) aiItemMap.set(tid, ar);
          }
          finalItems = items.map((it) => {
            const aiItem = aiItemMap.get(it.tradeId);
            if (!aiItem) return it;

            // Anti-hallucination: clamp predictedSellPrice to [0.5x, 1.3x] estValue (or buyPrice)
            const anchor =
              it.aiEstimatedValue != null && it.aiEstimatedValue > 0
                ? it.aiEstimatedValue
                : it.buyPrice;
            const minPrice = anchor * 0.5;
            const maxPrice = anchor * 1.3;
            const predictedSellPrice = clampNumber(
              aiItem.predictedSellPrice,
              minPrice,
              maxPrice,
              it.predictedSellPrice,
            );
            const predictedProfit = round0(predictedSellPrice - it.buyPrice);
            const predictedROI = clampNumber(
              aiItem.predictedROI != null
                ? aiItem.predictedROI
                : (predictedProfit / Math.max(1, it.buyPrice)) * 100,
              -100,
              500,
              it.predictedROI,
            );
            const sellProbability = clampNumber(
              aiItem.sellProbability,
              0,
              100,
              it.sellProbability,
            );
            const predictedHoldDays = clampNumber(
              aiItem.predictedHoldDays,
              1,
              180,
              it.predictedHoldDays,
            );
            const confidenceLevel = clampNumber(
              aiItem.confidenceLevel,
              10,
              95,
              it.confidenceLevel,
            );

            // Key factors — validate enum
            const aiFactors = Array.isArray(aiItem.keyFactors)
              ? aiItem.keyFactors
              : [];
            const keyFactors: KeyFactor[] = aiFactors
              .map((f: unknown) => {
                const fr = f as Record<string, unknown>;
                if (!fr || typeof fr !== 'object') return null;
                const factor = clampString(fr.factor, 100, '');
                if (!factor) return null;
                const impact = clampEnum(fr.impact, VALID_IMPACT, 'POSITIVE');
                const weight = clampNumber(fr.weight, 0, 100, 50);
                return { factor, impact, weight: round0(weight) };
              })
              .filter((f): f is KeyFactor => f !== null)
              .slice(0, 3);

            const performanceOutlook = clampEnum(
              aiItem.performanceOutlook,
              VALID_OUTLOOK,
              it.performanceOutlook,
            );

            // Update date range from new predictedHoldDays
            const dateRange = buildDateRange(predictedHoldDays, now);

            return {
              ...it,
              predictedSellDate: dateRange,
              predictedSellPrice: round0(predictedSellPrice),
              predictedProfit,
              predictedROI,
              sellProbability: round1(sellProbability),
              predictedHoldDays: round0(predictedHoldDays),
              confidenceLevel: round1(confidenceLevel),
              keyFactors: keyFactors.length > 0 ? keyFactors : it.keyFactors,
              performanceOutlook,
            };
          });
        }

        // Parse summary
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          summary = clampString(parsed.summary, 500, deterministicSummary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/trade-performance-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        items: finalItems,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      items: finalItems,
      portfolio,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/trade-performance-forecaster', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
