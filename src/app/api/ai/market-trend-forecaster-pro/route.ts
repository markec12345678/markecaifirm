// v7.78: Market Trend Forecaster Pro — napreden AI trend forecaster, ki
// kombinira 4 trend signale (price, volume, deal quality, demand) v
// celovit 90-dnevni trend forecast z scenario analizo. "Elektronika:
// STRONG_UP (price +8%, volume +12%, demand +15%). BULL 40%, BASE 45%,
// BEAR 15%. BUY."
//
// Razlika od market-trends (basic trend analysis) — ta da 4-signals
// COMPOSITE trend forecast z BULL/BASE/BEAR scenarios. Razlika od
// trend-predictions (basic predictions) — ta da SCENARIO MODELING z
// probabilities in trend convergence/divergence analysis. Razlika od
// listing-trend-detector (listing-level trend detection) — ta gleda
// KATEGORIJSKE tržne trende z 4 signali. Razlika od market-trend (basic
// rising/falling prices) — ta kombinira 4 signale (price, volume, quality,
// demand) v composite score. Razlika od market-trend-momentum (v7.73 trend
// acceleration per kategorija) — ta da SCENARIO ANALYSIS (BULL/BASE/BEAR) z
// probabilities in actionable insights. Razlika od weekly-trend-radar (7-day
// trends) — ta gleda 90-dnevni forecast z 4 signali. Razlika od
// price-history-forecaster (v7.71 price forecast) — ta gleda 4 signale +
// scenarios, ne le ceno. Razlika od market-cycle-detector (v7.77 4-fazni
// Wyckoff cycle) — ta je PRO verzija z SCENARIO MODELING in convergence
// analysis.
//
// GET+POST /api/ai/market-trend-forecaster-pro
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

type TrendDirection =
  | 'STRONG_UP'
  | 'UP'
  | 'FLAT'
  | 'DOWN'
  | 'STRONG_DOWN';

type ConvergenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type ActionType = 'BUY' | 'SELL' | 'HOLD';

interface PriceSignal {
  slope: number;
  acceleration: number;
  volatility: number;
  normalized: number; // 0-100
}

interface VolumeSignal {
  slope: number;
  acceleration: number;
  normalized: number; // 0-100
}

interface QualitySignal {
  slope: number;
  normalized: number; // 0-100
}

interface DemandSignal {
  slope: number;
  normalized: number; // 0-100
}

interface CategorySignals {
  priceSignal: PriceSignal;
  volumeSignal: VolumeSignal;
  qualitySignal: QualitySignal;
  demandSignal: DemandSignal;
}

interface CategoryForecast {
  predictedPriceChange30d: number; // %
  predictedPriceChange90d: number; // %
  predictedVolumeChange30d: number; // %
  predictedDemandChange30d: number; // %
  trendDirection: TrendDirection;
  confidenceScore: number; // 0-100
}

interface Scenarios {
  BULL_CASE: { priceChange: number; probability: number };
  BASE_CASE: { priceChange: number; probability: number };
  BEAR_CASE: { priceChange: number; probability: number };
}

interface CategoryAnalysis {
  category: string;
  signals: CategorySignals;
  compositeScore: number; // 0-100
  forecast: CategoryForecast;
  scenarios: Scenarios;
}

interface TrendDivergence {
  category: string;
  conflict: string;
}

interface TrendDriver {
  driver: string;
  impact: string;
  weight: number; // 0-1
}

interface ActionableInsight {
  category: string;
  action: ActionType;
  reasoning: string;
}

interface TrendAnalysis {
  trendConvergence: ConvergenceLevel;
  trendDivergence: TrendDivergence[];
  keyTrendDrivers: TrendDriver[];
  actionableInsights: ActionableInsight[];
}

interface AiTrendResponse {
  analysis?: unknown;
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

const VALID_DIRECTION: readonly TrendDirection[] = [
  'STRONG_UP',
  'UP',
  'FLAT',
  'DOWN',
  'STRONG_DOWN',
];

const VALID_CONVERGENCE: readonly ConvergenceLevel[] = [
  'HIGH',
  'MEDIUM',
  'LOW',
];

const VALID_ACTION: readonly ActionType[] = ['BUY', 'SELL', 'HOLD'];

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

// Linear regression
function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const xs = Array.from({ length: n }, (_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Compute acceleration: difference between recent slope and older slope
function computeAcceleration(weeklyValues: number[]): number {
  if (weeklyValues.length < 4) return 0;
  const mid = Math.floor(weeklyValues.length / 2);
  const recentSlope = linearRegression(weeklyValues.slice(mid)).slope;
  const olderSlope = linearRegression(weeklyValues.slice(0, mid + 1)).slope;
  return recentSlope - olderSlope;
}

// Normalize a signal value to 0-100 based on slope direction (positive=up=high score)
function normalizeSignal(slope: number, meanValue: number): number {
  if (meanValue <= 0) return 50;
  const relSlope = (slope / meanValue) * 100; // % per week
  // Map slope to 0-100: -10%/week → 0, 0%/week → 50, +10%/week → 100
  const normalized = 50 + relSlope * 5;
  return Math.max(0, Math.min(100, round0(normalized)));
}

// Classify trend direction from composite score
function classifyDirection(compositeScore: number): TrendDirection {
  if (compositeScore >= 80) return 'STRONG_UP';
  if (compositeScore >= 60) return 'UP';
  if (compositeScore >= 40) return 'FLAT';
  if (compositeScore >= 20) return 'DOWN';
  return 'STRONG_DOWN';
}

// Build deterministic forecast per category
function buildDeterministicForecast(
  signals: CategorySignals,
  compositeScore: number,
): CategoryForecast {
  // Predicted % change based on slope extrapolation
  const priceSlopePctWeek = signals.priceSignal.slope > 0 && signals.priceSignal.normalized > 0
    ? (signals.priceSignal.normalized - 50) / 5
    : (signals.priceSignal.normalized - 50) / 5;
  const volumeSlopePctWeek = (signals.volumeSignal.normalized - 50) / 5;
  const demandSlopePctWeek = (signals.demandSignal.normalized - 50) / 5;

  // 30d ≈ 4.3 weeks, 90d ≈ 13 weeks — clamp to [-50, 50]
  const predictedPriceChange30d = clampNumber(
    priceSlopePctWeek * 4.3,
    -50,
    50,
    0,
  );
  const predictedPriceChange90d = clampNumber(
    priceSlopePctWeek * 13,
    -50,
    50,
    0,
  );
  const predictedVolumeChange30d = clampNumber(
    volumeSlopePctWeek * 4.3,
    -50,
    50,
    0,
  );
  const predictedDemandChange30d = clampNumber(
    demandSlopePctWeek * 4.3,
    -50,
    50,
    0,
  );

  // Confidence based on signal agreement + sample
  const signalAgreement = Math.min(
    signals.priceSignal.normalized,
    signals.volumeSignal.normalized,
    signals.demandSignal.normalized,
  ) - Math.max(
    signals.priceSignal.normalized,
    signals.volumeSignal.normalized,
    signals.demandSignal.normalized,
  );
  const agreementScore = Math.max(0, 100 + signalAgreement); // smaller spread = higher
  const confidenceScore = clampNumber(
    Math.round((compositeScore / 2 + agreementScore / 2)),
    0,
    100,
    50,
  );

  return {
    predictedPriceChange30d: round1(predictedPriceChange30d),
    predictedPriceChange90d: round1(predictedPriceChange90d),
    predictedVolumeChange30d: round1(predictedVolumeChange30d),
    predictedDemandChange30d: round1(predictedDemandChange30d),
    trendDirection: classifyDirection(compositeScore),
    confidenceScore,
  };
}

// Build scenarios per category
function buildScenarios(
  forecast: CategoryForecast,
  confidence: number,
): Scenarios {
  const base = forecast.predictedPriceChange30d;
  // Bull = base × 1.8 (capped 50), Bear = base × -1.5 (capped -50)
  // Probabilities: bull high when confidence high + base positive
  const bullPrice = clampNumber(base * 1.8, -50, 50, base);
  const bearPrice = clampNumber(base * -1.5, -50, 50, base);
  // Probabilities depend on confidence + direction
  let bullProb: number;
  let baseProb: number;
  let bearProb: number;
  if (base > 5) {
    // Uptrend → bull more likely
    bullProb = Math.min(60, 30 + confidence * 0.3);
    baseProb = 40;
    bearProb = Math.max(5, 100 - bullProb - baseProb);
  } else if (base < -5) {
    // Downtrend → bear more likely
    bearProb = Math.min(60, 30 + confidence * 0.3);
    baseProb = 40;
    bullProb = Math.max(5, 100 - bearProb - baseProb);
  } else {
    // Flat → base more likely
    baseProb = Math.min(60, 40 + confidence * 0.2);
    bullProb = Math.round((100 - baseProb) / 2);
    bearProb = 100 - baseProb - bullProb;
  }
  return {
    BULL_CASE: {
      priceChange: round1(bullPrice),
      probability: round0(bullProb),
    },
    BASE_CASE: {
      priceChange: round1(base),
      probability: round0(baseProb),
    },
    BEAR_CASE: {
      priceChange: round1(bearPrice),
      probability: round0(bearProb),
    },
  };
}

// Determine actionable insight per category
function actionableInsight(
  forecast: CategoryForecast,
  scenarios: Scenarios,
): { action: ActionType; reasoning: string } {
  if (forecast.trendDirection === 'STRONG_UP' && scenarios.BULL_CASE.probability >= 35) {
    return {
      action: 'BUY',
      reasoning: `STRONG_UP trend (price +${forecast.predictedPriceChange30d}% v 30 dneh, BULL ${scenarios.BULL_CASE.probability}%) — kupuj zdaj pred nadaljnjo rastjo.`,
    };
  }
  if (forecast.trendDirection === 'STRONG_DOWN' && scenarios.BEAR_CASE.probability >= 35) {
    return {
      action: 'SELL',
      reasoning: `STRONG_DOWN trend (price ${forecast.predictedPriceChange30d}% v 30 dneh, BEAR ${scenarios.BEAR_CASE.probability}%) — likvidiraj inventar pred padcem.`,
    };
  }
  if (forecast.trendDirection === 'UP') {
    return {
      action: 'BUY',
      reasoning: `UP trend (price +${forecast.predictedPriceChange30d}% v 30 dneh) — zmerno kupuj, vendar spremljaj signale.`,
    };
  }
  if (forecast.trendDirection === 'DOWN') {
    return {
      action: 'SELL',
      reasoning: `DOWN trend (price ${forecast.predictedPriceChange30d}% v 30 dneh) — zmanjšaj inventar, počakaj na stabilizacijo.`,
    };
  }
  return {
    action: 'HOLD',
    reasoning: `FLAT trend (price ${forecast.predictedPriceChange30d}% v 30 dneh) — drži pozicije, čakaj na jasnejše signale.`,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketTrendForecasterPro(req);
}
export async function POST(req: NextRequest) {
  return handleMarketTrendForecasterPro(req);
}

async function handleMarketTrendForecasterPro(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-trend-forecaster-pro', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff180d = new Date(now - 180 * 86_400_000); // 180 days
    const weekMs = 7 * 86_400_000;

    // 1) Query listings from last 180 days
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff180d },
        isHidden: false,
      },
      select: {
        id: true,
        monitor: { select: { source: true } },
        price: true,
        firstSeenAt: true,
        dealScore: true,
        isBookmarked: true,
        contactStatus: true,
      },
      take: 200000,
    });

    // 2) Group by category (= monitor.source) and ISO week
    interface WeekAgg {
      prices: number[];
      count: number;
      dealScoreSum: number;
      dealScoreCount: number;
      bookmarkedCount: number;
      contactedCount: number;
    }
    interface CategoryAgg {
      weeks: Map<number, WeekAgg>; // week start timestamp → agg
    }

    const catAgg = new Map<string, CategoryAgg>();

    for (const l of listings) {
      const category = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      if (l.price == null || l.price <= 0) continue;
      const seenMs = toMs(l.firstSeenAt);
      if (seenMs <= 0) continue;
      // ISO week start (Monday)
      const weekStart = Math.floor(seenMs / weekMs) * weekMs;

      let cat = catAgg.get(category);
      if (!cat) {
        cat = { weeks: new Map<number, WeekAgg>() };
        catAgg.set(category, cat);
      }
      let w = cat.weeks.get(weekStart);
      if (!w) {
        w = {
          prices: [],
          count: 0,
          dealScoreSum: 0,
          dealScoreCount: 0,
          bookmarkedCount: 0,
          contactedCount: 0,
        };
        cat.weeks.set(weekStart, w);
      }
      w.prices.push(l.price);
      w.count += 1;
      if (l.dealScore != null && l.dealScore > 0) {
        w.dealScoreSum += l.dealScore;
        w.dealScoreCount += 1;
      }
      if (l.isBookmarked) w.bookmarkedCount += 1;
      if (l.contactStatus && l.contactStatus !== 'none') {
        w.contactedCount += 1;
      }
    }

    // Empty state — no listings in last 180 days
    if (listings.length === 0 || catAgg.size === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        analysis: {
          trendConvergence: 'LOW',
          trendDivergence: [],
          keyTrendDrivers: [],
          actionableInsights: [],
        },
        summary:
          'Ni listing-ov v zadnjih 180 dneh — Market Trend Forecaster Pro ni mogoč.',
        aiUsed: false,
        message:
          'Ni listing-ov v zadnjih 180 dneh — Market Trend Forecaster Pro ni mogoč.',
      });
    }

    // 3) Compute signals per category
    const categoryAnalyses: CategoryAnalysis[] = [];

    for (const [category, agg] of catAgg.entries()) {
      // Sort weeks by timestamp asc
      const sortedWeeks = Array.from(agg.weeks.entries()).sort(
        (a, b) => a[0] - b[0],
      );
      if (sortedWeeks.length < 2) continue; // Need at least 2 weeks of data

      const weekTimestamps = sortedWeeks.map((w) => w[0]);
      const weekPrices = sortedWeeks.map((w) => {
        const p = w[1].prices;
        if (p.length === 0) return 0;
        return p.reduce((s, v) => s + v, 0) / p.length;
      });
      const weekVolumes = sortedWeeks.map((w) => w[1].count);
      const weekDealScores = sortedWeeks.map((w) =>
        w[1].dealScoreCount > 0 ? w[1].dealScoreSum / w[1].dealScoreCount : 0,
      );
      const weekDemand = sortedWeeks.map((w) => {
        const total = w[1].count || 1;
        return ((w[1].bookmarkedCount + w[1].contactedCount) / total) * 100;
      });

      const meanPrice = weekPrices.reduce((s, v) => s + v, 0) / weekPrices.length;
      const meanVolume = weekVolumes.reduce((s, v) => s + v, 0) / weekVolumes.length;
      const meanDealScore =
        weekDealScores.reduce((s, v) => s + v, 0) / weekDealScores.length;
      const meanDemand = weekDemand.reduce((s, v) => s + v, 0) / weekDemand.length;

      // Price signal
      const priceReg = linearRegression(weekPrices);
      const priceVolatility = meanPrice > 0 ? (stdDev(weekPrices) / meanPrice) * 100 : 0;
      const priceSignal: PriceSignal = {
        slope: round1(priceReg.slope),
        acceleration: round1(computeAcceleration(weekPrices)),
        volatility: round1(priceVolatility),
        normalized: normalizeSignal(priceReg.slope, meanPrice),
      };

      // Volume signal
      const volumeReg = linearRegression(weekVolumes);
      const volumeSignal: VolumeSignal = {
        slope: round1(volumeReg.slope),
        acceleration: round1(computeAcceleration(weekVolumes)),
        normalized: normalizeSignal(volumeReg.slope, meanVolume),
      };

      // Quality signal
      const qualityReg = linearRegression(weekDealScores);
      const qualitySignal: QualitySignal = {
        slope: round1(qualityReg.slope),
        normalized: normalizeSignal(qualityReg.slope, meanDealScore || 50),
      };

      // Demand signal
      const demandReg = linearRegression(weekDemand);
      const demandSignal: DemandSignal = {
        slope: round1(demandReg.slope),
        normalized: normalizeSignal(demandReg.slope, meanDemand || 1),
      };

      // Composite score: weighted average
      const compositeScore = round0(
        priceSignal.normalized * 0.35 +
          volumeSignal.normalized * 0.2 +
          qualitySignal.normalized * 0.2 +
          demandSignal.normalized * 0.25,
      );

      const forecast = buildDeterministicForecast(
        {
          priceSignal,
          volumeSignal,
          qualitySignal,
          demandSignal,
        },
        compositeScore,
      );
      const scenarios = buildScenarios(forecast, forecast.confidenceScore);

      categoryAnalyses.push({
        category,
        signals: {
          priceSignal,
          volumeSignal,
          qualitySignal,
          demandSignal,
        },
        compositeScore,
        forecast,
        scenarios,
      });
    }

    if (categoryAnalyses.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        analysis: {
          trendConvergence: 'LOW',
          trendDivergence: [],
          keyTrendDrivers: [],
          actionableInsights: [],
        },
        summary:
          'Ni dovolj tedenskih podatkov (vsaj 2 tedna) za Market Trend Forecaster Pro.',
        aiUsed: false,
        message:
          'Ni dovolj tedenskih podatkov (vsaj 2 tedna) za Market Trend Forecaster Pro.',
      });
    }

    // Sort categories by composite score desc (most bullish first)
    categoryAnalyses.sort((a, b) => b.compositeScore - a.compositeScore);

    // 4) Compute trend analysis (deterministic)
    // Convergence: how aligned are signals across categories?
    const compositeScores = categoryAnalyses.map((c) => c.compositeScore);
    const meanComposite =
      compositeScores.reduce((s, v) => s + v, 0) / compositeScores.length;
    const compositeStd = stdDev(compositeScores);
    const convergence: ConvergenceLevel =
      compositeStd < 10 ? 'HIGH' : compositeStd < 25 ? 'MEDIUM' : 'LOW';

    // Divergence: categories with conflicting signals (e.g. price up but volume down)
    const trendDivergence: TrendDivergence[] = [];
    for (const c of categoryAnalyses) {
      const { priceSignal, volumeSignal, demandSignal } = c.signals;
      if (
        Math.abs(priceSignal.normalized - volumeSignal.normalized) > 40 &&
        Math.abs(priceSignal.normalized - demandSignal.normalized) > 40
      ) {
        trendDivergence.push({
          category: c.category,
          conflict: `Price ${priceSignal.normalized > 50 ? 'UP' : 'DOWN'} (${priceSignal.normalized}/100) v konfliktu z Volume ${volumeSignal.normalized > 50 ? 'UP' : 'DOWN'} (${volumeSignal.normalized}/100) in Demand ${demandSignal.normalized > 50 ? 'UP' : 'DOWN'} (${demandSignal.normalized}/100).`,
        });
      }
    }

    // Key trend drivers — top 3 signals with biggest absolute impact
    const driverCandidates: Array<{
      driver: string;
      impact: string;
      weight: number;
    }> = [];
    for (const c of categoryAnalyses.slice(0, 5)) {
      const { priceSignal, volumeSignal, demandSignal, qualitySignal } = c.signals;
      // Pick the most extreme signal per category
      const signals = [
        {
          driver: `${c.category} — price signal`,
          impact: `Cena ${priceSignal.slope > 0 ? 'raste' : 'pada'} ${Math.abs(priceSignal.slope)}/teden (norm: ${priceSignal.normalized}/100)`,
          weight: Math.abs(priceSignal.normalized - 50) / 100,
        },
        {
          driver: `${c.category} — volume signal`,
          impact: `Volumen ${volumeSignal.slope > 0 ? 'raste' : 'pada'} ${Math.abs(volumeSignal.slope)}/teden (norm: ${volumeSignal.normalized}/100)`,
          weight: Math.abs(volumeSignal.normalized - 50) / 100,
        },
        {
          driver: `${c.category} — demand signal`,
          impact: `Demand ${demandSignal.slope > 0 ? 'raste' : 'pada'} ${Math.abs(demandSignal.slope)}/teden (norm: ${demandSignal.normalized}/100)`,
          weight: Math.abs(demandSignal.normalized - 50) / 100,
        },
        {
          driver: `${c.category} — quality signal`,
          impact: `Deal quality ${qualitySignal.slope > 0 ? 'raste' : 'pada'} ${Math.abs(qualitySignal.slope)}/teden (norm: ${qualitySignal.normalized}/100)`,
          weight: Math.abs(qualitySignal.normalized - 50) / 100,
        },
      ];
      driverCandidates.push(...signals);
    }
    driverCandidates.sort((a, b) => b.weight - a.weight);
    const keyTrendDrivers = driverCandidates.slice(0, 5).map((d) => ({
      driver: d.driver,
      impact: d.impact,
      weight: round1(d.weight),
    }));

    // Actionable insights per category
    const actionableInsights: ActionableInsight[] = categoryAnalyses
      .slice(0, 10)
      .map((c) => {
        const insight = actionableInsight(c.forecast, c.scenarios);
        return {
          category: c.category,
          action: insight.action,
          reasoning: insight.reasoning,
        };
      });

    const deterministicAnalysis: TrendAnalysis = {
      trendConvergence: convergence,
      trendDivergence: trendDivergence.slice(0, 5),
      keyTrendDrivers,
      actionableInsights,
    };

    // 5) AI cache check (6h TTL) — key by current month
    const monthKey = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `market-trend-forecaster-pro:${monthKey}`;
    const cached = getCachedAI<{
      analysis: TrendAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        categories: categoryAnalyses,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
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

    // Build compact prompt data — top 8 categories
    const categoriesForPrompt = categoryAnalyses.slice(0, 8).map((c) => ({
      category: c.category,
      signals: c.signals,
      compositeScore: c.compositeScore,
      forecast: c.forecast,
      scenarios: c.scenarios,
    }));

    const deterministicSummary = `Analiza ${categoryAnalyses.length} kategorij: ${categoryAnalyses.filter((c) => c.forecast.trendDirection === 'STRONG_UP' || c.forecast.trendDirection === 'UP').length} v UP/STRONG_UP trendu, ${categoryAnalyses.filter((c) => c.forecast.trendDirection === 'DOWN' || c.forecast.trendDirection === 'STRONG_DOWN').length} v DOWN/STRONG_DOWN trendu. Convergence: ${convergence}. ${trendDivergence.length} divergence konfliktov. ${actionableInsights.filter((i) => i.action === 'BUY').length} BUY signalov, ${actionableInsights.filter((i) => i.action === 'SELL').length} SELL signalov.`;

    const prompt = `Si AI "Market Trend Forecaster Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Kombiniraj 4 trend signale (price, volume, deal quality, demand) v celovit 90-dnevni trend forecast z scenario analizo (BULL/BASE/BEAR) in actionable insights.

KATEGORIJE Z SIGNALLI (deterministično izračunano iz zadnjih 180 dni):
${JSON.stringify(categoriesForPrompt, null, 2)}

DETERMINISTIČNA ANALIZA:
- trendConvergence: ${convergence} (stdDev composite-a: ${round1(compositeStd)})
- trendDivergence: ${JSON.stringify(trendDivergence.slice(0, 3))}
- actionableInsights: ${JSON.stringify(actionableInsights.slice(0, 5))}

PRAVILA ZA AI ODGOVOR:
1. analysis.trendConvergence: HIGH / MEDIUM / LOW (koliko so signali usklajeni)
2. analysis.trendDivergence: array 0-5 kategorij s konflikti (npr. cena raste, volumen pada — risk indicator)
   - category: ime kategorije (mora obstajati v zgornjem seznamu!)
   - conflict: slovenski opis konflikta (max 200 znakov)
3. analysis.keyTrendDrivers: array 3-5 top faktorjev z:
   - driver: slovenski opis (max 100 znakov)
   - impact: slovenski opis učinka (max 200 znakov)
   - weight: 0-1 (pomembnost faktorja)
4. analysis.actionableInsights: array 3-8 buy/sell/hold priporočil z:
   - category: ime kategorije (mora obstajati v zgornjem seznamu!)
   - action: BUY / SELL / HOLD (validiraj proti enum)
   - reasoning: slovenski opis (max 200 znakov)
5. summary: celovit slovenski povzetek trend analize (max 500 znakov)

VRNI LE JSON:
{
  "analysis": {
    "trendConvergence": "HIGH",
    "trendDivergence": [{ "category": "...", "conflict": "..." }],
    "keyTrendDrivers": [{ "driver": "...", "impact": "...", "weight": 0.8 }],
    "actionableInsights": [{ "category": "...", "action": "BUY", "reasoning": "..." }]
  },
  "summary": "..."
}${GROUNDING_PROMPT_SUFFIX}`;

    let analysis: TrendAnalysis = deterministicAnalysis;
    let summary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiTrendResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.analysis) {
        const a = parsed.analysis as Record<string, unknown>;

        // Parse trendConvergence
        const trendConvergence = clampEnum(
          a.trendConvergence,
          VALID_CONVERGENCE,
          convergence,
        );

        // Parse trendDivergence (anti-hallucination: categories must be from list)
        const validCategories = new Set(
          categoryAnalyses.map((c) => c.category),
        );
        const trendDivergenceParsed: TrendDivergence[] = [];
        if (Array.isArray(a.trendDivergence)) {
          for (const d of a.trendDivergence) {
            const dr = d as Record<string, unknown>;
            if (!dr || typeof dr !== 'object') continue;
            const category = String(dr.category || '').trim().toLowerCase();
            if (!category || !validCategories.has(category)) continue;
            const conflict = clampString(
              dr.conflict,
              200,
              'Signali v konfliktu.',
            );
            trendDivergenceParsed.push({ category, conflict });
            if (trendDivergenceParsed.length >= 5) break;
          }
        }
        const finalDivergence =
          trendDivergenceParsed.length > 0
            ? trendDivergenceParsed
            : deterministicAnalysis.trendDivergence;

        // Parse keyTrendDrivers
        const keyTrendDriversParsed: TrendDriver[] = [];
        if (Array.isArray(a.keyTrendDrivers)) {
          for (const d of a.keyTrendDrivers) {
            const dr = d as Record<string, unknown>;
            if (!dr || typeof dr !== 'object') continue;
            keyTrendDriversParsed.push({
              driver: clampString(dr.driver, 100, 'Trend driver'),
              impact: clampString(dr.impact, 200, 'Vpliva na trend.'),
              weight: clampNumber(dr.weight, 0, 1, 0.5),
            });
            if (keyTrendDriversParsed.length >= 5) break;
          }
        }
        const finalDrivers =
          keyTrendDriversParsed.length > 0
            ? keyTrendDriversParsed
            : deterministicAnalysis.keyTrendDrivers;

        // Parse actionableInsights (anti-hallucination: categories must be from list)
        const insightsParsed: ActionableInsight[] = [];
        if (Array.isArray(a.actionableInsights)) {
          for (const i of a.actionableInsights) {
            const ir = i as Record<string, unknown>;
            if (!ir || typeof ir !== 'object') continue;
            const category = String(ir.category || '').trim().toLowerCase();
            if (!category || !validCategories.has(category)) continue;
            const action = clampEnum(ir.action, VALID_ACTION, 'HOLD');
            const reasoning = clampString(
              ir.reasoning,
              200,
              `${action} priporočilo za ${category}.`,
            );
            insightsParsed.push({ category, action, reasoning });
            if (insightsParsed.length >= 8) break;
          }
        }
        const finalInsights =
          insightsParsed.length > 0
            ? insightsParsed
            : deterministicAnalysis.actionableInsights;

        analysis = {
          trendConvergence,
          trendDivergence: finalDivergence,
          keyTrendDrivers: finalDrivers,
          actionableInsights: finalInsights,
        };

        // Parse summary
        if (typeof parsed === 'object' && 'summary' in parsed) {
          summary = clampString(
            (parsed as Record<string, unknown>).summary,
            500,
            deterministicSummary,
          );
        } else {
          summary = deterministicSummary;
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-trend-forecaster-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { analysis, summary });
    }

    return NextResponse.json({
      ok: true,
      categories: categoryAnalyses,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error('/api/ai/market-trend-forecaster-pro', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
