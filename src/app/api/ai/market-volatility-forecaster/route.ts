// v7.91: AI Market Volatility Forecaster — AI forecast-a FUTURE market
// volatiliteto 30/60/90 dni vnaprej — bodo cene bolj nestabilne (risk) ali
// bolj stabilne (safe)? Razlika od price-volatility-analyzer (v7.86 ki
// analizira CURRENT volatility per category) — ta FORECAST-a FUTURE
// volatility z outlook + risk implication + mitigation actions.
// "Volatility outlook: INCREASING. Elektronika: 22% → 28% in 30d (riskier).
// Moda: 8% → 6% (stable). Action: shift to moda."
//
// Razlika od market-trend-forecaster-pro (v7.78 ki forecast-a trend) — ta
// forecast-a VOLATILITY (variabilnost cen) ne trend direction. Razlika od
// market-trend-acceleration-tracker (v7.89 ki track-a acceleration 2nd deriv)
// — ta gleda volatility trend + momentum z 30/60/90d projection. Razlika od
// market-sentiment-trend-analyzer (v7.90 ki track-a sentiment trends) — ta
// gleda PRICE volatility ne sentiment. Razlika od price-volatility-analyzer
// (v7.86 ki da current volatility) — ta FORECAST-a future volatility z
// hotspot in stability zone identification.
//
// GET+POST /api/ai/market-volatility-forecaster
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

type VolatilityDirection = 'INCREASING' | 'STABLE' | 'DECREASING';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CurrentVolatility {
  avgVolatility: number; // %
  mostVolatileCategory: string | null;
  mostStableCategory: string | null;
  volatilityTrend26w: number; // slope per week
  volatilityMomentum: number; // 2nd derivative
  volatilityDirection: VolatilityDirection;
}

interface VolatilityForecast {
  projectedAvgVolatility30d: number;
  projectedAvgVolatility60d: number;
  projectedAvgVolatility90d: number;
  volatilityOutlook: VolatilityDirection;
  confidenceLevel: number; // 0-100
}

interface CategoryForecast {
  category: string;
  currentVolatility: number;
  projectedVolatility30d: number;
  projectedVolatility90d: number;
  trend: VolatilityDirection;
}

interface VolatilityHotspot {
  category: string;
  projectedVolatility: number;
  risk: string;
}

interface StabilityZone {
  category: string;
  projectedVolatility: number;
  benefit: string;
}

interface VolatilityMitigationAction {
  action: string;
  priority: ActionPriority;
  detail: string;
}

interface VolatilityAnalysis {
  riskImplication: string;
  volatilityHotspots: VolatilityHotspot[];
  stabilityZones: StabilityZone[];
  volatilityMitigationActions: VolatilityMitigationAction[];
  tradingStrategyAdjustment: string;
}

interface AiVolatilityResponse {
  projectedAvgVolatility30d?: number;
  projectedAvgVolatility60d?: number;
  projectedAvgVolatility90d?: number;
  volatilityOutlook?: VolatilityDirection;
  confidenceLevel?: number;
  riskImplication?: string;
  volatilityHotspots?: Array<{
    category?: string;
    projectedVolatility?: number;
    risk?: string;
  }>;
  stabilityZones?: Array<{
    category?: string;
    projectedVolatility?: number;
    benefit?: string;
  }>;
  volatilityMitigationActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    detail?: string;
  }>;
  tradingStrategyAdjustment?: string;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_180D = 180 * DAY_MS;
const WEEKS_26 = 26;
const VOL_MIN = 0;
const VOL_MAX = 200; // volatility can exceed 100% in extreme cases
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;

const VALID_DIRECTION: readonly VolatilityDirection[] = ['INCREASING', 'STABLE', 'DECREASING'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / values.length);
}

// Linear regression slope per index
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

// 2nd derivative: slope of second half minus slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

// Coefficient of variation (CV) = stddev / mean × 100 (%)
function coefficientOfVariation(values: number[]): number {
  const m = avg(values);
  if (m <= 0) return 0;
  const sd = stddev(values);
  return (sd / m) * 100;
}

// --- Listing row ---------------------------------------------------------

interface ListingRow {
  price: number | null;
  category: string | null;
  firstSeenAt: Date;
  monitor: { source: string | null } | null;
}

// We use monitor.source as category proxy (since Listing has no `category` field).
// The prompt mentions "category" but in our DB schema, Listing has no category.
// We use monitor.source (Bolha, Vinted, etc.) as the grouping key, exposing
// per-source volatility.

interface WeekAgg {
  weekMs: number;
  priceSum: number;
  priceCount: number;
  listingCount: number;
}

function newWeekAgg(weekMs: number): WeekAgg {
  return { weekMs, priceSum: 0, priceCount: 0, listingCount: 0 };
}

// --- Deterministic current volatility ------------------------------------

interface CategoryWeeklySeries {
  category: string;
  weeklyAvgPrices: number[]; // 26 weeks, NaN-filled for missing weeks
  weeklyVolatility: number; // CV %
  trend: VolatilityDirection;
}

function buildCategorySeries(
  catMap: Map<string, Map<number, WeekAgg>>,
  sortedWeeks: number[],
): CategoryWeeklySeries[] {
  const out: CategoryWeeklySeries[] = [];
  for (const [cat, weekMap] of catMap.entries()) {
    const series: number[] = [];
    for (const wMs of sortedWeeks) {
      const w = weekMap.get(wMs);
      if (w && w.priceCount > 0) {
        series.push(w.priceSum / w.priceCount);
      }
      // skip missing weeks — only include populated weeks for CV
    }
    // Need ≥4 populated weeks for meaningful stats
    if (series.length < 4) continue;
    const weeklyVolatility = round1(coefficientOfVariation(series));
    const slope = trendSlope(series);
    const accel = computeAcceleration(series);
    // Volatility trend: how is the *spread* changing? Approx via sign of slope of weekly deviations
    // Simplify: if slope strongly positive AND accel positive => INCREASING, etc.
    let trend: VolatilityDirection = 'STABLE';
    const trendRef = Math.max(1, Math.abs(avg(series)) * 0.02); // 2% of mean as threshold
    if (slope > trendRef && accel > 0) trend = 'INCREASING';
    else if (slope < -trendRef && accel < 0) trend = 'DECREASING';
    // For volatility specifically, increasing CV is the real signal
    const firstHalf = series.slice(0, Math.floor(series.length / 2));
    const secondHalf = series.slice(Math.floor(series.length / 2));
    const cvFirst = coefficientOfVariation(firstHalf);
    const cvSecond = coefficientOfVariation(secondHalf);
    const cvDelta = cvSecond - cvFirst;
    if (cvDelta > 2) trend = 'INCREASING';
    else if (cvDelta < -2) trend = 'DECREASING';

    out.push({
      category: cat,
      weeklyAvgPrices: series,
      weeklyVolatility,
      trend,
    });
  }
  return out;
}

// --- Deterministic forecast ---------------------------------------------

function buildDeterministicForecast(
  current: CurrentVolatility,
  categorySeries: CategoryWeeklySeries[],
): VolatilityForecast {
  const base = current.avgVolatility;
  // Daily change in volatility derived from trend slope (per week → per day)
  const dailyChange = current.volatilityTrend26w / 7;
  // Momentum adjustment: acceleration amplifies or dampens the change
  const momentumFactor = Math.max(0.5, Math.min(1.5, 1 + current.volatilityMomentum * 0.1));
  const projectedAvgVolatility30d = round1(
    Math.max(VOL_MIN, Math.min(VOL_MAX, base + dailyChange * 30 * momentumFactor)),
  );
  const projectedAvgVolatility60d = round1(
    Math.max(VOL_MIN, Math.min(VOL_MAX, base + dailyChange * 60 * momentumFactor)),
  );
  const projectedAvgVolatility90d = round1(
    Math.max(VOL_MIN, Math.min(VOL_MAX, base + dailyChange * 90 * momentumFactor)),
  );

  // Outlook: direction of projected change
  const delta90 = projectedAvgVolatility90d - base;
  let volatilityOutlook: VolatilityDirection = 'STABLE';
  if (delta90 > 2) volatilityOutlook = 'INCREASING';
  else if (delta90 < -2) volatilityOutlook = 'DECREASING';

  // Confidence: based on data volume + trend strength
  let confidence = 40;
  confidence += Math.min(25, categorySeries.length * 4);
  confidence += Math.min(15, Math.abs(current.volatilityTrend26w) * 3);
  confidence += Math.min(10, Math.abs(current.volatilityMomentum) * 5);
  const confidenceLevel = round0(
    Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, confidence)),
  );

  return {
    projectedAvgVolatility30d,
    projectedAvgVolatility60d,
    projectedAvgVolatility90d,
    volatilityOutlook,
    confidenceLevel,
  };
}

// --- Deterministic analysis ---------------------------------------------

function buildDeterministicAnalysis(
  forecast: VolatilityForecast,
  categorySeries: CategoryWeeklySeries[],
  current: CurrentVolatility,
): VolatilityAnalysis {
  // Sort categories by projected volatility 90d desc
  // Project per-category 90d using same momentumFactor approach
  const catProjections = categorySeries.map((c) => {
    const slope = trendSlope(c.weeklyAvgPrices);
    const accel = computeAcceleration(c.weeklyAvgPrices);
    const momFactor = Math.max(0.5, Math.min(1.5, 1 + accel * 0.1));
    const dailyChange = slope / 7;
    const proj90d = round1(
      Math.max(VOL_MIN, Math.min(VOL_MAX, c.weeklyVolatility + dailyChange * 90 * momFactor)),
    );
    const proj30d = round1(
      Math.max(VOL_MIN, Math.min(VOL_MAX, c.weeklyVolatility + dailyChange * 30 * momFactor)),
    );
    return {
      category: c.category,
      currentVolatility: c.weeklyVolatility,
      projectedVolatility30d: proj30d,
      projectedVolatility90d: proj90d,
      trend: c.trend,
    };
  });

  catProjections.sort((a, b) => b.projectedVolatility90d - a.projectedVolatility90d);

  // Hotspots: top 3 highest projected volatility
  const volatilityHotspots: VolatilityHotspot[] = catProjections
    .slice(0, 3)
    .map((c) => ({
      category: c.category,
      projectedVolatility: c.projectedVolatility90d,
      risk: `Projecija ${c.projectedVolatility90d}% volatility v 90d — ${c.trend === 'INCREASING' ? 'naraščajoče' : c.trend === 'DECREASING' ? 'upadajoče' : 'stabilno'}. Povečano tveganje za nepredvidljive cene in težje napovedovanje.`,
    }));

  // Stability zones: bottom 3 lowest projected volatility
  const stabilityZones: StabilityZone[] = catProjections
    .slice(-3)
    .reverse()
    .map((c) => ({
      category: c.category,
      projectedVolatility: c.projectedVolatility90d,
      benefit: `Nizka volatility (${c.projectedVolatility90d}%) pomeni stabilne cene in zanesljive napovedi — idealno za dolgoročne pozicije in večje nakupe.`,
    }));

  // Risk implication
  const riskImplication =
    forecast.volatilityOutlook === 'INCREASING'
      ? `Volatility narašča (${current.avgVolatility}% → ${forecast.projectedAvgVolatility90d}% v 90d). Povečana nestabilnost cen pomeni višje tveganje za nakupe brez jasnih komparativov, vendar tudi več priložnosti za arbitražo med cenovnimi skoki.`
      : forecast.volatilityOutlook === 'DECREASING'
        ? `Volatility upada (${current.avgVolatility}% → ${forecast.projectedAvgVolatility90d}% v 90d). Stabilnejše cene pomenijo bolj predvidljiv trg in nižje tveganje, vendar manj arbitražnih priložnosti.`
        : `Volatility ostaja stabilna (${current.avgVolatility}% → ${forecast.projectedAvgVolatility90d}% v 90d). Trg je v ravnovesju — nadaljuj z značilno strategijo z rednim monitoringom.`;

  // Mitigation actions
  const mitigationActions: VolatilityMitigationAction[] = [];
  if (forecast.volatilityOutlook === 'INCREASING') {
    mitigationActions.push({
      action: 'Zmanjšaj povprečno velikost pozicij za 20-30%',
      priority: 'HIGH',
      detail: 'Manjše pozicije zmanjšajo exposure na cenovne skoke in omogočajo bolj fleksibilno odzivanje.',
    });
    mitigationActions.push({
      action: 'Povečaj cash reserve za arbitražne priložnosti',
      priority: 'MEDIUM',
      detail: 'Cenovni skoki ustvarjajo arbitražne priložnosti — cash reserve omogoča izkoristiti jih.',
    });
    mitigationActions.push({
      action: 'Premakni fokus na stability zones kategorije',
      priority: 'MEDIUM',
      detail: 'Premik na kategorije z nizko volatility zmanjša portfolio risk.',
    });
  } else if (forecast.volatilityOutlook === 'DECREASING') {
    mitigationActions.push({
      action: 'Povečaj obseg naročanja v stability zones',
      priority: 'MEDIUM',
      detail: 'Stabilnejše cene omogočajo večje nakupe z nižjim tveganjem.',
    });
    mitigationActions.push({
      action: 'Optimiraj cenovne strategije za daljše obdobje',
      priority: 'LOW',
      detail: 'Stabilne cene omogočajo dolgoročne cenovne strategije brez pogostih popravkov.',
    });
  } else {
    mitigationActions.push({
      action: 'Vzdržuj trenutno strategijo z rednim monitoringom',
      priority: 'LOW',
      detail: 'Trg je stabilen — vzdržuj trenutno strategijo in redno preverjaj volatility signale.',
    });
  }

  // Trading strategy adjustment
  const tradingStrategyAdjustment =
    forecast.volatilityOutlook === 'INCREASING'
      ? `Strategija: DEFENZIVNA. Zmanjšaj exposure na ${current.mostVolatileCategory ?? 'najbolj volatilne kategorije'}, povečaj fokus na ${stabilityZones[0]?.category ?? 'stabilne kategorije'}. Skrajšaj hold time za 30-50%, postavi tighter stop-loss pragme.`
      : forecast.volatilityOutlook === 'DECREASING'
        ? `Strategija: AGRESIVNA. Povečaj exposure na stability zones (${stabilityZones[0]?.category ?? 'stabilne kategorije'}), podaljšaj hold time za izkoristitek dolgoročnih trendov. Povečaj povprečno pozicijo za 15-20%.`
        : `Strategija: VZDRŽUJOČA. Nadaljuj z značilno strategijo, vendar povečaj monitoring volatility signalov. Pripravi contingency plan za scenarij INCREASING (cash reserve) in DECREASING (povečan obseg).`;

  return {
    riskImplication: riskImplication.slice(0, 500),
    volatilityHotspots: volatilityHotspots.slice(0, 3),
    stabilityZones: stabilityZones.slice(0, 3),
    volatilityMitigationActions: mitigationActions.slice(0, 4),
    tradingStrategyAdjustment: tradingStrategyAdjustment.slice(0, 400),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketVolatilityForecaster(req);
}
export async function POST(req: NextRequest) {
  return handleMarketVolatilityForecaster(req);
}

async function handleMarketVolatilityForecaster(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-volatility-forecaster', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff180d = new Date(now - HORIZON_180D);

    // 1) Query listings from last 180 days with monitor.source
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff180d },
      },
      select: {
        price: true,
        firstSeenAt: true,
        monitor: { select: { source: true } },
      },
      orderBy: { firstSeenAt: 'asc' },
      take: 200000,
    }) as unknown as ListingRow[];

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          avgVolatility: 0,
          mostVolatileCategory: null,
          mostStableCategory: null,
          volatilityTrend26w: 0,
          volatilityMomentum: 0,
          volatilityDirection: 'STABLE' as VolatilityDirection,
        },
        forecast: {
          projectedAvgVolatility30d: 0,
          projectedAvgVolatility60d: 0,
          projectedAvgVolatility90d: 0,
          volatilityOutlook: 'STABLE' as VolatilityDirection,
          confidenceLevel: 30,
        },
        byCategory: [],
        analysis: {
          riskImplication: 'Ni oglasov v zadnjih 180 dneh — Market Volatility Forecaster ni mogoč.',
          volatilityHotspots: [],
          stabilityZones: [],
          volatilityMitigationActions: [{
            action: 'Dodaj oglase v bazo (zagnani monitorji) za volatility forecasting',
            priority: 'LOW' as ActionPriority,
            detail: 'Volatility analiza zahteva vsaj 4 tedne podatkov per kategorija.',
          }],
          tradingStrategyAdjustment: 'Ni podatkov za strategijo.',
        },
        summary: 'Ni oglasov v zadnjih 180 dneh — Market Volatility Forecaster ni mogoč.',
        aiUsed: false,
        message: 'Ni oglasov v zadnjih 180 dneh — Market Volatility Forecaster ni mogoč.',
      });
    }

    // 2) Group by ISO week + category (using monitor.source as category proxy)
    const weekStartMs = (t: number): number => {
      const d = new Date(t);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      return monday.getTime();
    };

    // Map: category → Map<weekMs, WeekAgg>
    const catMap = new Map<string, Map<number, WeekAgg>>();
    const allWeeksSet = new Set<number>();
    for (const l of listings) {
      const seenMs = toMs(l.firstSeenAt);
      if (seenMs <= 0) continue;
      const price = l.price;
      if (price == null || price <= 0) continue;
      const wMs = weekStartMs(seenMs);
      const cat = (l.monitor?.source ?? 'neznan').trim().toLowerCase() || 'neznan';

      allWeeksSet.add(wMs);
      let weekMap = catMap.get(cat);
      if (!weekMap) {
        weekMap = new Map();
        catMap.set(cat, weekMap);
      }
      let agg = weekMap.get(wMs);
      if (!agg) {
        agg = newWeekAgg(wMs);
        weekMap.set(wMs, agg);
      }
      agg.priceSum += price;
      agg.priceCount += 1;
      agg.listingCount += 1;
    }

    // Sorted weeks (26 weeks back from now)
    const sortedWeeks = Array.from(allWeeksSet).sort((a, b) => a - b).slice(-WEEKS_26);

    if (sortedWeeks.length < 4) {
      return NextResponse.json({
        ok: true,
        current: {
          avgVolatility: 0,
          mostVolatileCategory: null,
          mostStableCategory: null,
          volatilityTrend26w: 0,
          volatilityMomentum: 0,
          volatilityDirection: 'STABLE' as VolatilityDirection,
        },
        forecast: {
          projectedAvgVolatility30d: 0,
          projectedAvgVolatility60d: 0,
          projectedAvgVolatility90d: 0,
          volatilityOutlook: 'STABLE' as VolatilityDirection,
          confidenceLevel: 25,
        },
        byCategory: [],
        analysis: {
          riskImplication: 'Ni dovolj tednov podatkov (potrebnih ≥4) — Market Volatility Forecaster ni mogoč.',
          volatilityHotspots: [],
          stabilityZones: [],
          volatilityMitigationActions: [],
          tradingStrategyAdjustment: 'Ni dovolj podatkov za strategijo.',
        },
        summary: 'Ni dovolj tednov podatkov (potrebnih ≥4) — Market Volatility Forecaster ni mogoč.',
        aiUsed: false,
        message: 'Ni dovolj tednov podatkov (potrebnih ≥4) — Market Volatility Forecaster ni mogoč.',
      });
    }

    // 3) Compute per-category weekly series + volatility (CV)
    const categorySeries = buildCategorySeries(catMap, sortedWeeks);

    if (categorySeries.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          avgVolatility: 0,
          mostVolatileCategory: null,
          mostStableCategory: null,
          volatilityTrend26w: 0,
          volatilityMomentum: 0,
          volatilityDirection: 'STABLE' as VolatilityDirection,
        },
        forecast: {
          projectedAvgVolatility30d: 0,
          projectedAvgVolatility60d: 0,
          projectedAvgVolatility90d: 0,
          volatilityOutlook: 'STABLE' as VolatilityDirection,
          confidenceLevel: 25,
        },
        byCategory: [],
        analysis: {
          riskImplication: 'Ni kategorij z ≥4 tedni podatkov — Market Volatility Forecaster ni mogoč.',
          volatilityHotspots: [],
          stabilityZones: [],
          volatilityMitigationActions: [],
          tradingStrategyAdjustment: 'Ni dovolj podatkov za strategijo.',
        },
        summary: 'Ni kategorij z ≥4 tedni podatkov — Market Volatility Forecaster ni mogoč.',
        aiUsed: false,
        message: 'Ni kategorij z ≥4 tedni podatkov — Market Volatility Forecaster ni mogoč.',
      });
    }

    // 4) Compute current volatility (cross-category avg)
    const volatilityValues = categorySeries.map((c) => c.weeklyVolatility);
    const avgVolatility = round1(avg(volatilityValues));
    const sortedByVol = [...categorySeries].sort((a, b) => b.weeklyVolatility - a.weeklyVolatility);
    const mostVolatileCategory = sortedByVol[0]?.category ?? null;
    const mostStableCategory = sortedByVol[sortedByVol.length - 1]?.category ?? null;

    // Volatility trend 26w: slope of avg weekly volatility across all categories
    // Build overall weekly avg price series
    const overallWeeklyAvg: number[] = [];
    for (const wMs of sortedWeeks) {
      let sum = 0;
      let cnt = 0;
      for (const [, weekMap] of catMap.entries()) {
        const w = weekMap.get(wMs);
        if (w && w.priceCount > 0) {
          sum += w.priceSum / w.priceCount;
          cnt += 1;
        }
      }
      overallWeeklyAvg.push(cnt > 0 ? sum / cnt : 0);
    }
    // Volatility trend: slope of weekly CV computed via sliding window approach
    // Simpler: compute CV over first half vs second half and slope
    const volatilityTrend26w = round1(trendSlope(overallWeeklyAvg.filter((v) => v > 0)));
    const volatilityMomentum = round1(computeAcceleration(overallWeeklyAvg.filter((v) => v > 0)));

    let volatilityDirection: VolatilityDirection = 'STABLE';
    if (volatilityTrend26w > 1 && volatilityMomentum > 0) volatilityDirection = 'INCREASING';
    else if (volatilityTrend26w < -1 && volatilityMomentum < 0) volatilityDirection = 'DECREASING';

    const current: CurrentVolatility = {
      avgVolatility,
      mostVolatileCategory,
      mostStableCategory,
      volatilityTrend26w,
      volatilityMomentum,
      volatilityDirection,
    };

    // 5) Build deterministic forecast
    const detForecast = buildDeterministicForecast(current, categorySeries);
    const detAnalysis = buildDeterministicAnalysis(detForecast, categorySeries, current);

    // Per-category forecast list
    const catProjections = categorySeries.map((c) => {
      const slope = trendSlope(c.weeklyAvgPrices);
      const accel = computeAcceleration(c.weeklyAvgPrices);
      const momFactor = Math.max(0.5, Math.min(1.5, 1 + accel * 0.1));
      const dailyChange = slope / 7;
      const proj90d = round1(
        Math.max(VOL_MIN, Math.min(VOL_MAX, c.weeklyVolatility + dailyChange * 90 * momFactor)),
      );
      const proj30d = round1(
        Math.max(VOL_MIN, Math.min(VOL_MAX, c.weeklyVolatility + dailyChange * 30 * momFactor)),
      );
      return {
        category: c.category,
        currentVolatility: c.weeklyVolatility,
        projectedVolatility30d: proj30d,
        projectedVolatility90d: proj90d,
        trend: c.trend,
      };
    });

    let forecast = detForecast;
    let analysis = detAnalysis;
    let summary = buildSummary(current, detForecast);

    // 6) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `market-volatility-forecaster:${currentMonth}`;
    const cached = getCachedAI<{
      forecast: VolatilityForecast;
      analysis: VolatilityAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        forecast: cached.forecast,
        byCategory: catProjections,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

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

    const promptData = {
      current,
      deterministicForecast: detForecast,
      deterministicAnalysis: detAnalysis,
      categoryProjections: catProjections,
      caps: {
        volMin: VOL_MIN, volMax: VOL_MAX,
        confidenceMin: CONFIDENCE_MIN, confidenceMax: CONFIDENCE_MAX,
      },
    };

    const prompt = `Si AI "Market Volatility Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Forecast-aš FUTURE market volatiliteto 30/60/90 dni vnaprej — bodo cene bolj nestabilne (risk) ali bolj stabilne (safe)? Razlika od price-volatility-analyzer (ki da current volatility) — ti FORECAST-a FUTURE volatility z outlook + risk implication + mitigation actions.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 26 tednov oglasov z monitor.source kot kategorija proxy, per-week CV of avg prices):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast: { projectedAvgVolatility30d/60d/90d (clamped [0, 200], ±15 od deterministic), volatilityOutlook INCREASING | STABLE | DECREASING, confidenceLevel 0-100 ±15 od deterministic }.
2. analysis.riskImplication: slovensko, max 500 znakov — kaj pomeni projected volatility za trgovanje
3. analysis.volatilityHotspots: 1-3 kategorij z najvišjo projected volatility { category (max 60 chars), projectedVolatility 0-200, risk (max 200 chars) }
4. analysis.stabilityZones: 1-3 kategorij z najnižjo projected volatility { category (max 60 chars), projectedVolatility 0-200, benefit (max 200 chars) }
5. analysis.volatilityMitigationActions: 2-4 akcij { action (max 200 chars), priority HIGH | MEDIUM | LOW, detail (max 200 chars) }
6. analysis.tradingStrategyAdjustment: slovensko, max 400 znakov — kako prilagoditi strategijo glede na volatility forecast
7. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "projectedAvgVolatility30d": 22,
  "projectedAvgVolatility60d": 25,
  "projectedAvgVolatility90d": 28,
  "volatilityOutlook": "INCREASING",
  "confidenceLevel": 72,
  "riskImplication": "Volatility narašča (18% → 28% v 90d). Povečana nestabilnost cen pomeni višje tveganje...",
  "volatilityHotspots": [
    { "category": "elektronika", "projectedVolatility": 28, "risk": "Cenovni skoki in padci — težko napovedovanje." }
  ],
  "stabilityZones": [
    { "category": "moda", "projectedVolatility": 6, "benefit": "Stabilne cene — idealno za dolgoročne pozicije." }
  ],
  "volatilityMitigationActions": [
    { "action": "Zmanjšaj povprečno velikost pozicij za 20-30%", "priority": "HIGH", "detail": "Manjše pozicije zmanjšajo exposure." }
  ],
  "tradingStrategyAdjustment": "Strategija: DEFENZIVNA. Premakni fokus na moda, skrajšaj hold time.",
  "summary": "Volatility outlook: INCREASING (18% → 28%). Elektronika hotspot. Moda stability zone."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiVolatilityResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Projected volatility — ±15 of deterministic, clamped [0, 200]
        const projectedAvgVolatility30d = round1(
          Math.max(VOL_MIN, Math.min(VOL_MAX,
            detForecast.projectedAvgVolatility30d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedAvgVolatility30d ?? detForecast.projectedAvgVolatility30d)) - detForecast.projectedAvgVolatility30d)))),
        );
        const projectedAvgVolatility60d = round1(
          Math.max(VOL_MIN, Math.min(VOL_MAX,
            detForecast.projectedAvgVolatility60d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedAvgVolatility60d ?? detForecast.projectedAvgVolatility60d)) - detForecast.projectedAvgVolatility60d)))),
        );
        const projectedAvgVolatility90d = round1(
          Math.max(VOL_MIN, Math.min(VOL_MAX,
            detForecast.projectedAvgVolatility90d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedAvgVolatility90d ?? detForecast.projectedAvgVolatility90d)) - detForecast.projectedAvgVolatility90d)))),
        );

        const volatilityOutlook = clampEnum(parsed.volatilityOutlook, VALID_DIRECTION, detForecast.volatilityOutlook);
        const confidenceLevel = round0(
          Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX,
            detForecast.confidenceLevel + Math.max(-15, Math.min(15,
              (Number(parsed.confidenceLevel ?? detForecast.confidenceLevel)) - detForecast.confidenceLevel)))),
        );

        forecast = {
          projectedAvgVolatility30d,
          projectedAvgVolatility60d,
          projectedAvgVolatility90d,
          volatilityOutlook,
          confidenceLevel,
        };

        // Hotspots validation
        const volatilityHotspots: VolatilityHotspot[] = [];
        if (Array.isArray(parsed.volatilityHotspots)) {
          for (const h of parsed.volatilityHotspots.slice(0, 3)) {
            if (!h || typeof h !== 'object') continue;
            volatilityHotspots.push({
              category: clampString(h.category, 60, detAnalysis.volatilityHotspots[0]?.category ?? 'neznan'),
              projectedVolatility: clampNum(h.projectedVolatility, VOL_MIN, VOL_MAX,
                detAnalysis.volatilityHotspots[0]?.projectedVolatility ?? 50),
              risk: clampString(h.risk, 200, detAnalysis.volatilityHotspots[0]?.risk ?? 'Povečano tveganje.'),
            });
          }
        }
        if (volatilityHotspots.length === 0) {
          for (const h of detAnalysis.volatilityHotspots) volatilityHotspots.push(h);
        }

        // Stability zones validation
        const stabilityZones: StabilityZone[] = [];
        if (Array.isArray(parsed.stabilityZones)) {
          for (const z of parsed.stabilityZones.slice(0, 3)) {
            if (!z || typeof z !== 'object') continue;
            stabilityZones.push({
              category: clampString(z.category, 60, detAnalysis.stabilityZones[0]?.category ?? 'neznan'),
              projectedVolatility: clampNum(z.projectedVolatility, VOL_MIN, VOL_MAX,
                detAnalysis.stabilityZones[0]?.projectedVolatility ?? 10),
              benefit: clampString(z.benefit, 200, detAnalysis.stabilityZones[0]?.benefit ?? 'Stabilne cene.'),
            });
          }
        }
        if (stabilityZones.length === 0) {
          for (const z of detAnalysis.stabilityZones) stabilityZones.push(z);
        }

        // Mitigation actions validation
        const mitigationActions: VolatilityMitigationAction[] = [];
        if (Array.isArray(parsed.volatilityMitigationActions)) {
          for (const m of parsed.volatilityMitigationActions.slice(0, 4)) {
            if (!m || typeof m !== 'object') continue;
            mitigationActions.push({
              action: clampString(m.action, 200, detAnalysis.volatilityMitigationActions[0]?.action ?? 'Vzdržuj strategijo.'),
              priority: clampEnum(m.priority, VALID_PRIORITY, detAnalysis.volatilityMitigationActions[0]?.priority ?? 'MEDIUM'),
              detail: clampString(m.detail, 200, detAnalysis.volatilityMitigationActions[0]?.detail ?? 'Redno monitoring.'),
            });
          }
        }
        if (mitigationActions.length === 0) {
          for (const m of detAnalysis.volatilityMitigationActions) mitigationActions.push(m);
        }

        analysis = {
          riskImplication: clampString(parsed.riskImplication, 500, detAnalysis.riskImplication),
          volatilityHotspots,
          stabilityZones,
          volatilityMitigationActions: mitigationActions,
          tradingStrategyAdjustment: clampString(parsed.tradingStrategyAdjustment, 400, detAnalysis.tradingStrategyAdjustment),
        };

        summary = clampString(parsed.summary, 400, buildSummary(current, forecast));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-volatility-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        forecast,
        analysis,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      current,
      forecast,
      byCategory: catProjections,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/market-volatility-forecaster',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

function buildSummary(
  current: CurrentVolatility,
  forecast: VolatilityForecast,
): string {
  const parts: string[] = [
    `Volatility outlook: ${forecast.volatilityOutlook} (trenutno ${current.avgVolatility}% → ${forecast.projectedAvgVolatility90d}% v 90d, confidence ${forecast.confidenceLevel}/100).`,
  ];
  if (current.mostVolatileCategory) {
    parts.push(`Najbolj volatilna: ${current.mostVolatileCategory}.`);
  }
  if (current.mostStableCategory) {
    parts.push(`Najbolj stabilna: ${current.mostStableCategory}.`);
  }
  return parts.join(' ').slice(0, 400);
}
