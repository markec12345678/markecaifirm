// v7.89: AI Seller Performance Forecaster — AI forecast-a FUTURE performance
// vsakega sellerja — predicted deal volume, profit, in reliability čez
// naslednjih 30/60/90 dni. Razlika od seller-performance-analytics (v7.77 ki da
// current performance snapshot) — ta FORECAST-a future performance z
// lifecycle stage + recommended engagement + outreach timing.
// "Marjan: 12 trades, +8%/mo trend. 30d forecast: 3 trades, +450€. Stage:
// GROWING. Increase engagement."
//
// Razlika od seller-reliability-scorecard (v7.80 ki da current reliability
// scorecard) — ta forecast-a future reliability + engagement. Razlika od
// seller-churn-predictor (v7.84 ki predict-a churn risk) — ta forecast-a
// PERFORMANCE (volume + profit) ne churn. Razlika od seller-reliability-v2 /
// seller-trust-score-v2 (ki merita reliability/trust) — ta forecast-a
// lifecycle stage + engagement action. Razlika od seller-performance-analytics
// (current snapshot) — ta je FORWARD-LOOKING z 30/60/90d projection.
//
// GET+POST /api/ai/seller-performance-forecaster
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

type FrequencyTrend = 'INCREASING' | 'STABLE' | 'DECREASING';
type ProfitTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';
type ReliabilityTier = 'PLATINUM' | 'GOLD' | 'SILVER' | 'BRONZE';
type PerformanceForecast = 'IMPROVING' | 'STABLE' | 'DECLINING';
type SellerLifecycleStage = 'EMERGING' | 'GROWING' | 'MATURE' | 'DECLINING';
type RecommendedEngagement = 'INCREASE' | 'MAINTAIN' | 'REDUCE' | 'EXIT';

interface SellerHistorical {
  totalTrades: number;
  totalProfit: number;
  avgProfitPerTrade: number;
  avgROI: number;
  tradeFrequency: number; // trades per month
  frequencyTrend: FrequencyTrend;
  profitTrend: ProfitTrend;
  daysSinceLastTrade: number;
  reliabilityTier: ReliabilityTier;
}

interface SellerForecast {
  predictedTrades30d: number;
  predictedTrades60d: number;
  predictedTrades90d: number;
  predictedProfit30d: number;
  predictedAvgROI: number;
  performanceForecast: PerformanceForecast;
  forecastConfidence: number; // 0-100
  sellerLifecycleStage: SellerLifecycleStage;
  recommendedEngagement: RecommendedEngagement;
  outreachTiming: string;
  reasoning: string;
}

interface SellerEntry {
  sellerName: string;
  historical: SellerHistorical;
  forecast: SellerForecast;
}

interface PortfolioSummary {
  totalSellers: number;
  improvingCount: number;
  decliningCount: number;
  bestForecastSeller: string | null;
  totalPredictedProfit30d: number;
  advice: string;
}

interface AiSellerResponse {
  sellers?: Array<{
    sellerName?: string;
    predictedTrades30d?: number;
    predictedTrades60d?: number;
    predictedTrades90d?: number;
    predictedProfit30d?: number;
    predictedAvgROI?: number;
    performanceForecast?: PerformanceForecast;
    forecastConfidence?: number;
    sellerLifecycleStage?: SellerLifecycleStage;
    recommendedEngagement?: RecommendedEngagement;
    outreachTiming?: string;
    reasoning?: string;
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const PRED_TRADES_MIN = 0;
const PRED_TRADES_MAX = 50;
const PRED_PROFIT_MIN = 0;
const PRED_PROFIT_MAX = 10000;
const PRED_ROI_MIN = -100;
const PRED_ROI_MAX = 500;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;

const VALID_PERF_FC: readonly PerformanceForecast[] = ['IMPROVING', 'STABLE', 'DECLINING'];
const VALID_STAGE: readonly SellerLifecycleStage[] = ['EMERGING', 'GROWING', 'MATURE', 'DECLINING'];
const VALID_ENG: readonly RecommendedEngagement[] = ['INCREASE', 'MAINTAIN', 'REDUCE', 'EXIT'];

// --- Helpers -------------------------------------------------------------

function clampString(s: unknown, max: number, fallback: string): string {
  if (typeof s === 'string' && s.trim().length > 0) {
    return s.trim().slice(0, max);
  }
  return fallback.slice(0, max);
}

function clampEnum<T extends string>(
  raw: unknown,
  valid: readonly T[],
  fallback: T,
): T {
  const s = String(raw ?? '').trim().toUpperCase();
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
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

// Linear regression slope per index (per month)
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

// --- Seller aggregation --------------------------------------------------

interface SellerTradeAgg {
  sellerName: string;
  totalTrades: number;
  profitSum: number;
  profitPerTrade: number[]; // per-trade profit for trend
  buyCostSum: number; // buyPrice + buyFees (cost basis)
  tradeDates: number[]; // ms timestamps (sorted asc)
  firstTradeMs: number;
  lastTradeMs: number;
  monthlyTradeCounts: number[]; // trades per month bucket (12 buckets, oldest first)
}

function newSellerAgg(sellerName: string): SellerTradeAgg {
  return {
    sellerName,
    totalTrades: 0,
    profitSum: 0,
    profitPerTrade: [],
    buyCostSum: 0,
    tradeDates: [],
    firstTradeMs: 0,
    lastTradeMs: 0,
    monthlyTradeCounts: new Array(12).fill(0),
  };
}

// Compute reliability tier from profit + volume + ROI + recency
function reliabilityTierFromHistory(hist: SellerHistorical): ReliabilityTier {
  const profitScore = Math.max(0, Math.min(100, 50 + (hist.avgProfitPerTrade / 200) * 50));
  const volumeScore = Math.max(0, Math.min(100, hist.totalTrades * 8));
  const roiScore = Math.max(0, Math.min(100, 50 + (hist.avgROI / 100) * 50));
  const recencyScore = hist.daysSinceLastTrade <= 30
    ? 100
    : hist.daysSinceLastTrade <= 90
      ? 70
      : hist.daysSinceLastTrade <= 180
        ? 40
        : 10;
  const score = profitScore * 0.4 + volumeScore * 0.3 + roiScore * 0.2 + recencyScore * 0.1;
  if (score >= 80) return 'PLATINUM';
  if (score >= 65) return 'GOLD';
  if (score >= 45) return 'SILVER';
  return 'BRONZE';
}

// --- Deterministic forecast ----------------------------------------------

function buildDeterministicForecast(hist: SellerHistorical): SellerForecast {
  // Future trades = trade frequency × months ahead, adjusted by frequency trend
  const trendMult =
    hist.frequencyTrend === 'INCREASING' ? 1.15 :
    hist.frequencyTrend === 'DECREASING' ? 0.85 : 1.0;

  const predictedTrades30d = round0(
    Math.max(PRED_TRADES_MIN, Math.min(PRED_TRADES_MAX,
      hist.tradeFrequency * 1 * trendMult)),
  );
  const predictedTrades60d = round0(
    Math.max(PRED_TRADES_MIN, Math.min(PRED_TRADES_MAX,
      hist.tradeFrequency * 2 * trendMult)),
  );
  const predictedTrades90d = round0(
    Math.max(PRED_TRADES_MIN, Math.min(PRED_TRADES_MAX,
      hist.tradeFrequency * 3 * trendMult)),
  );

  // Predicted profit 30d = predicted trades × avg profit, adjusted by profit trend
  const profitMult =
    hist.profitTrend === 'IMPROVING' ? 1.10 :
    hist.profitTrend === 'DECLINING' ? 0.90 : 1.0;
  const predictedProfit30d = round0(
    Math.max(PRED_PROFIT_MIN, Math.min(PRED_PROFIT_MAX,
      predictedTrades30d * hist.avgProfitPerTrade * profitMult)),
  );

  // Predicted ROI — same as historical, slightly adjusted by trends
  const roiAdj =
    hist.profitTrend === 'IMPROVING' ? 5 :
    hist.profitTrend === 'DECLINING' ? -5 : 0;
  const predictedAvgROI = round1(
    Math.max(PRED_ROI_MIN, Math.min(PRED_ROI_MAX,
      hist.avgROI + roiAdj)),
  );

  // Performance forecast from combined trends
  const perfForecast: PerformanceForecast =
    (hist.frequencyTrend === 'INCREASING' && hist.profitTrend !== 'DECLINING') ||
    (hist.profitTrend === 'IMPROVING' && hist.frequencyTrend !== 'DECREASING')
      ? 'IMPROVING'
      : (hist.frequencyTrend === 'DECREASING' && hist.profitTrend === 'DECLINING')
        ? 'DECLINING'
        : 'STABLE';

  // Confidence — higher with more data, more recent activity
  let confidence = 30;
  confidence += Math.min(40, hist.totalTrades * 4); // up to 40 from volume
  confidence += hist.daysSinceLastTrade <= 30 ? 20 : hist.daysSinceLastTrade <= 90 ? 10 : 0;
  confidence += hist.reliabilityTier === 'PLATINUM' ? 10 : hist.reliabilityTier === 'GOLD' ? 5 : 0;
  const forecastConfidence = round0(
    Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, confidence)),
  );

  // Lifecycle stage
  let stage: SellerLifecycleStage = 'MATURE';
  if (hist.totalTrades <= 3 && hist.daysSinceLastTrade <= 90) {
    stage = 'EMERGING';
  } else if (hist.frequencyTrend === 'INCREASING' && hist.profitTrend !== 'DECLINING') {
    stage = 'GROWING';
  } else if (hist.frequencyTrend === 'DECREASING' && hist.profitTrend === 'DECLINING') {
    stage = 'DECLINING';
  } else if (hist.daysSinceLastTrade > 180) {
    stage = 'DECLINING';
  } else {
    stage = 'MATURE';
  }

  // Recommended engagement
  let engagement: RecommendedEngagement = 'MAINTAIN';
  if (stage === 'GROWING' && perfForecast === 'IMPROVING') {
    engagement = 'INCREASE';
  } else if (stage === 'DECLINING' && perfForecast === 'DECLINING') {
    engagement = hist.reliabilityTier === 'BRONZE' ? 'EXIT' : 'REDUCE';
  } else if (hist.reliabilityTier === 'BRONZE' && hist.daysSinceLastTrade > 180) {
    engagement = 'EXIT';
  } else if (stage === 'EMERGING') {
    engagement = 'INCREASE';
  }

  // Outreach timing
  let outreachTiming = 'Kontaktiraj v naslednjih 7 dneh za sveže ponudbe.';
  if (hist.daysSinceLastTrade > 90) {
    outreachTiming = 'Kontaktiraj takoj — zadnja prodaja je bila več kot 90 dni nazaj.';
  } else if (hist.frequencyTrend === 'INCREASING') {
    outreachTiming = 'Kontaktiraj v naslednjih 14 dneh — seller pridobiva momentum.';
  } else if (stage === 'MATURE') {
    outreachTiming = 'Kontaktiraj po potrebi — zanesljiv partner z redno ponudbo.';
  }

  // Reasoning
  const reasoning = `${hist.totalTrades} trgov, ${round1(hist.tradeFrequency)}/mesec, ${hist.reliabilityTier}. Trend frekvence: ${hist.frequencyTrend}, profit: ${hist.profitTrend}. Napoved: ${predictedTrades30d} trgov v 30d z ${round1(hist.avgProfitPerTrade)}€ povprečja. Stage: ${stage}, action: ${engagement}.`.slice(0, 300);

  return {
    predictedTrades30d,
    predictedTrades60d,
    predictedTrades90d,
    predictedProfit30d,
    predictedAvgROI,
    performanceForecast: perfForecast,
    forecastConfidence,
    sellerLifecycleStage: stage,
    recommendedEngagement: engagement,
    outreachTiming,
    reasoning,
  };
}

function buildPortfolioSummary(sellers: SellerEntry[]): PortfolioSummary {
  const totalSellers = sellers.length;
  const improvingCount = sellers.filter((s) => s.forecast.performanceForecast === 'IMPROVING').length;
  const decliningCount = sellers.filter((s) => s.forecast.performanceForecast === 'DECLINING').length;
  const totalPredictedProfit30d = round0(
    sellers.reduce((s, x) => s + x.forecast.predictedProfit30d, 0),
  );

  // Best forecast seller = highest predictedProfit30d (with positive trend)
  let bestForecastSeller: string | null = null;
  let bestProfit = -Infinity;
  for (const s of sellers) {
    if (
      s.forecast.predictedProfit30d > bestProfit &&
      s.forecast.performanceForecast !== 'DECLINING'
    ) {
      bestProfit = s.forecast.predictedProfit30d;
      bestForecastSeller = s.sellerName;
    }
  }

  let advice = '';
  if (totalSellers === 0) {
    advice = 'Ni seller-jev z dovolj trgovinami — Seller Performance Forecaster ni mogoč.';
  } else if (improvingCount > decliningCount) {
    advice = `Portfolio v rasti: ${improvingCount} seller-jev z IMPROVING forecast. Skupno napovedan profit v 30d: ${totalPredictedProfit30d}€. Povečaj aktivnost pri ${bestForecastSeller ?? 'top seller-ju'}.`;
  } else if (decliningCount > improvingCount) {
    advice = `Portfolio v upadanju: ${decliningCount} seller-jev z DECLINING forecast. Skupno napovedan profit v 30d: ${totalPredictedProfit30d}€. Diversificiraj ali zmanjšaj obseg posla z declining seller-ji.`;
  } else {
    advice = `Portfolio stabilen: ${improvingCount} improving, ${decliningCount} declining. Skupno napovedan profit v 30d: ${totalPredictedProfit30d}€. Vzdržuj trenutno strategijo.`;
  }

  return {
    totalSellers,
    improvingCount,
    decliningCount,
    bestForecastSeller,
    totalPredictedProfit30d,
    advice: advice.slice(0, 400),
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
    sellerName: string | null;
  } | null;
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleSellerPerformanceForecaster(req);
}
export async function POST(req: NextRequest) {
  return handleSellerPerformanceForecaster(req);
}

async function handleSellerPerformanceForecaster(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-seller-performance-forecaster', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for sellerName)
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
            sellerName: true,
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // 2) Aggregate per seller
    const sellers = new Map<string, SellerTradeAgg>();

    // For monthly buckets: align to calendar month
    const monthStartMs = (t: number): number => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    const thisMonthStart = monthStartMs(now);

    for (const t of soldTrades) {
      const sellerName = (t.listing?.sellerName || '').trim();
      if (!sellerName) continue; // skip trades without seller

      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;

      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;
      const cost = buyPrice + buyFees;

      let agg = sellers.get(sellerName);
      if (!agg) {
        agg = newSellerAgg(sellerName);
        sellers.set(sellerName, agg);
      }

      agg.totalTrades += 1;
      agg.profitSum += profit;
      agg.profitPerTrade.push(profit);
      agg.buyCostSum += cost;
      agg.tradeDates.push(sellMs);
      if (agg.firstTradeMs === 0 || sellMs < agg.firstTradeMs) agg.firstTradeMs = sellMs;
      if (sellMs > agg.lastTradeMs) agg.lastTradeMs = sellMs;

      // Determine which month bucket (index 0 = oldest, 11 = newest)
      const sellMonthStart = monthStartMs(sellMs);
      const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
      const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
      if (bucketIdx >= 0 && bucketIdx <= 11) {
        agg.monthlyTradeCounts[bucketIdx] = (agg.monthlyTradeCounts[bucketIdx] ?? 0) + 1;
      }
    }

    // 3) Compute historical performance per seller (only those with 2+ trades)
    const sellerHistories: SellerEntry[] = [];
    for (const [, agg] of sellers.entries()) {
      if (agg.totalTrades < 2) continue; // skip sellers with <2 trades

      const totalTrades = agg.totalTrades;
      const totalProfit = round0(agg.profitSum);
      const avgProfitPerTrade = round0(agg.profitSum / totalTrades);
      const avgROI = agg.buyCostSum > 0
        ? round1((agg.profitSum / agg.buyCostSum) * 100)
        : 0;

      // Trade frequency = total trades / span in months (min 1)
      const spanMonths = Math.max(1, (now - agg.firstTradeMs) / (30 * DAY_MS));
      const tradeFrequency = round1(totalTrades / spanMonths);

      // Frequency trend from monthly counts
      const monthlyCounts = agg.monthlyTradeCounts;
      const freqSlope = trendSlope(monthlyCounts);
      const frequencyTrend: FrequencyTrend =
        freqSlope > 0.15 ? 'INCREASING' : freqSlope < -0.15 ? 'DECREASING' : 'STABLE';

      // Profit trend from profit-per-trade series (chronological)
      const profitSlope = trendSlope(agg.profitPerTrade);
      const profitTrend: ProfitTrend =
        profitSlope > 5 ? 'IMPROVING' : profitSlope < -5 ? 'DECLINING' : 'STABLE';

      const daysSinceLastTrade = Math.max(0, Math.round((now - agg.lastTradeMs) / DAY_MS));

      const historical: SellerHistorical = {
        totalTrades,
        totalProfit,
        avgProfitPerTrade,
        avgROI,
        tradeFrequency,
        frequencyTrend,
        profitTrend,
        daysSinceLastTrade,
        reliabilityTier: 'BRONZE', // set below
      };
      historical.reliabilityTier = reliabilityTierFromHistory(historical);

      const forecast = buildDeterministicForecast(historical);
      sellerHistories.push({
        sellerName: agg.sellerName.slice(0, 100),
        historical,
        forecast,
      });
    }

    if (sellerHistories.length === 0) {
      return NextResponse.json({
        ok: true,
        sellers: [],
        summary: {
          totalSellers: 0,
          improvingCount: 0,
          decliningCount: 0,
          bestForecastSeller: null,
          totalPredictedProfit30d: 0,
          advice:
            'Ni seller-jev z 2+ SOLD trgovinami v zadnjih 12 mesecih — Seller Performance Forecaster ni mogoč.',
        },
        aiUsed: false,
        message:
          'Ni seller-jev z 2+ SOLD trgovinami v zadnjih 12 mesecih — Seller Performance Forecaster ni mogoč.',
      });
    }

    // Sort by predictedProfit30d desc
    sellerHistories.sort((a, b) => b.forecast.predictedProfit30d - a.forecast.predictedProfit30d);

    // 4) Build deterministic baseline (fallback)
    let sellersOut: SellerEntry[] = sellerHistories;
    let summary = buildPortfolioSummary(sellersOut);

    // 5) AI cache check (6h TTL) — key by total sellers
    const cacheKey = `seller-performance-forecaster:${sellerHistories.length}`;
    const cached = getCachedAI<{
      sellers: SellerEntry[];
      summary: PortfolioSummary;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        sellers: cached.sellers,
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

    const promptData = {
      sellers: sellerHistories.map((s) => ({
        sellerName: s.sellerName,
        historical: s.historical,
        deterministicForecast: s.forecast,
      })),
      caps: {
        predTradesMin: PRED_TRADES_MIN, predTradesMax: PRED_TRADES_MAX,
        predProfitMin: PRED_PROFIT_MIN, predProfitMax: PRED_PROFIT_MAX,
        roiMin: PRED_ROI_MIN, roiMax: PRED_ROI_MAX,
        confidenceMin: CONFIDENCE_MIN, confidenceMax: CONFIDENCE_MAX,
      },
    };

    const prompt = `Si AI "Seller Performance Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Forecast-aš FUTURE performance vsakega sellerja — predicted deal volume, profit, in reliability čez naslednjih 30/60/90 dni. Razlika od seller-performance-analytics (ki da current snapshot) — ti forecast-a FUTURE performance z lifecycle stage in engagement action.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD trgovin):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sellers: array z istim vrstnim redom kot v inputu. Za vsak seller:
   - sellerName: mora biti enak kot v inputu
   - predictedTrades30d/60d/90d: 0-50, majhen ±adjustment od deterministične (±5/10/15 max)
   - predictedProfit30d: 0-10000, ±20% od deterministične
   - predictedAvgROI: -100 do 500, ±10 od deterministične
   - performanceForecast: IMPROVING | STABLE | DECLINING (na podlagi frequency + profit trend)
   - forecastConfidence: 0-100, ±15 od deterministične
   - sellerLifecycleStage: EMERGING | GROWING | MATURE | DECLINING
   - recommendedEngagement: INCREASE | MAINTAIN | REDUCE | EXIT
   - outreachTiming: slovensko, max 200 znakov — KDAJ kontaktirati sellerja za najboljše pogoje
   - reasoning: slovensko, max 300 znakov — zakaj ta forecast
2. summary: slovenski povzetek portfolia (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "sellers": [
    {
      "sellerName": "Marjan",
      "predictedTrades30d": 3,
      "predictedTrades60d": 6,
      "predictedTrades90d": 9,
      "predictedProfit30d": 450,
      "predictedAvgROI": 35,
      "performanceForecast": "IMPROVING",
      "forecastConfidence": 75,
      "sellerLifecycleStage": "GROWING",
      "recommendedEngagement": "INCREASE",
      "outreachTiming": "Kontaktiraj v naslednjih 14 dneh — seller pridobiva momentum.",
      "reasoning": "12 trgov, +8%/mo trend. Profit improving. Stage GROWING z visoko confidence."
    }
  ],
  "summary": "Portfolio v rasti: 3 sellers z IMPROVING forecast. Skupno napovedan profit v 30d: 1200€."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiSellerResponse | null;

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sellers)) {
        const aiSellers = parsed.sellers;

        // Map of deterministic forecasts by sellerName for adjustment
        const detMap = new Map<string, SellerEntry>();
        for (const s of sellerHistories) detMap.set(s.sellerName, s);

        const merged: SellerEntry[] = [];
        for (const ai of aiSellers) {
          if (!ai || typeof ai !== 'object') continue;
          const det = detMap.get(String(ai.sellerName ?? ''));
          if (!det) continue; // unknown seller — skip (anti-hallucination)

          const detTrades30 = det.forecast.predictedTrades30d;
          const detTrades60 = det.forecast.predictedTrades60d;
          const detTrades90 = det.forecast.predictedTrades90d;
          const detProfit = det.forecast.predictedProfit30d;
          const detROI = det.forecast.predictedAvgROI;
          const detConf = det.forecast.forecastConfidence;

          // Predicted trades ±5/10/15 within deterministic
          const predictedTrades30d = round0(
            Math.max(PRED_TRADES_MIN, Math.min(PRED_TRADES_MAX,
              detTrades30 + Math.max(-5, Math.min(5, Number(ai.predictedTrades30d ?? detTrades30) - detTrades30)))),
          );
          const predictedTrades60d = round0(
            Math.max(PRED_TRADES_MIN, Math.min(PRED_TRADES_MAX,
              detTrades60 + Math.max(-10, Math.min(10, Number(ai.predictedTrades60d ?? detTrades60) - detTrades60)))),
          );
          const predictedTrades90d = round0(
            Math.max(PRED_TRADES_MIN, Math.min(PRED_TRADES_MAX,
              detTrades90 + Math.max(-15, Math.min(15, Number(ai.predictedTrades90d ?? detTrades90) - detTrades90)))),
          );

          // Predicted profit ±20% within deterministic
          const profitDelta = Math.max(-0.20, Math.min(0.20,
            (Number(ai.predictedProfit30d ?? detProfit) - detProfit) / Math.max(1, Math.abs(detProfit))));
          const predictedProfit30d = round0(
            Math.max(PRED_PROFIT_MIN, Math.min(PRED_PROFIT_MAX,
              detProfit * (1 + profitDelta))),
          );

          // Predicted ROI ±10 within deterministic
          const predictedAvgROI = round1(
            Math.max(PRED_ROI_MIN, Math.min(PRED_ROI_MAX,
              detROI + Math.max(-10, Math.min(10, Number(ai.predictedAvgROI ?? detROI) - detROI)))),
          );

          // Confidence ±15
          const forecastConfidence = round0(
            Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX,
              detConf + Math.max(-15, Math.min(15, Number(ai.forecastConfidence ?? detConf) - detConf)))),
          );

          const performanceForecast = clampEnum(ai.performanceForecast, VALID_PERF_FC, det.forecast.performanceForecast);
          const sellerLifecycleStage = clampEnum(ai.sellerLifecycleStage, VALID_STAGE, det.forecast.sellerLifecycleStage);
          const recommendedEngagement = clampEnum(ai.recommendedEngagement, VALID_ENG, det.forecast.recommendedEngagement);
          const outreachTiming = clampString(ai.outreachTiming, 200, det.forecast.outreachTiming);
          const reasoning = clampString(ai.reasoning, 300, det.forecast.reasoning);

          merged.push({
            sellerName: det.sellerName,
            historical: det.historical,
            forecast: {
              predictedTrades30d,
              predictedTrades60d,
              predictedTrades90d,
              predictedProfit30d,
              predictedAvgROI,
              performanceForecast,
              forecastConfidence,
              sellerLifecycleStage,
              recommendedEngagement,
              outreachTiming,
              reasoning,
            },
          });
        }

        if (merged.length > 0) {
          sellersOut = merged;
          summary = buildPortfolioSummary(sellersOut);
          aiUsed = true;
        }
      }
    } catch (err) {
      logger.warn(
        '/api/ai/seller-performance-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        sellers: sellersOut,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      sellers: sellersOut,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/seller-performance-forecaster',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
