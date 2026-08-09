// v7.93: AI Market Depth Trend Analyzer — AI analizira kako se GLOBINA trga
// (market depth) spreminja čez čas. Track-a depth trend, identificira depth
// cycles in napove kdaj bo trg postal globlji (bolj likviden) ali plitvejši.
// Razlika od market-depth-analyzer (v7.68 ki da snapshot depth-a) — ta track-a
// HISTORICAL trend čez 26 tednov z cycle detection. Razlika od market-depth-
// forecaster (v7.84 ki projicira future depth) — ta analizira TRENDS in
// cycles (kaj povzroča spremembe). "Depth: DEEPENING (+2.5/wk, momentum +0.5).
// Cycle position: MID_EXPANSION. Liquidity forecast: improving. Best: elektronika
// (+4/wk)."
//
// Razlika od market-depth-analyzer (v7.68 ki da snapshot per category) — ta
// gleda časovni trend depth-a (26 tednov). Razlika od market-depth-forecaster
// (v7.84 ki forecast-a future depth) — ta gleda HISTORICAL cycles z
// peak/trough detection. Razlika od market-liquidity-analyzer (ki meri
// liquidity) — ta gleda DEPTH trend direction (DEEPENING/STABLE/SHALLOWING).
// Razlika od market-trend-momentum (ki gleda price momentum) — ta gleda
// DEPTH momentum (2nd derivative depth-a). Razlika od market-trend-acceleration-
// tracker (v7.78 ki track-a price acceleration) — ta gleda DEPTH-specific
// acceleration.
//
// GET+POST /api/ai/market-depth-trend-analyzer
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

type DepthDirection = 'DEEPENING' | 'STABLE' | 'SHALLOWING';
type CyclePosition =
  | 'EARLY_EXPANSION'
  | 'MID_EXPANSION'
  | 'LATE_EXPANSION'
  | 'PEAK'
  | 'EARLY_CONTRACTION'
  | 'MID_CONTRACTION'
  | 'LATE_CONTRACTION'
  | 'TROUGH'
  | 'UNCLEAR';
type LiquidityAssessment = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface DepthTrends {
  depthTrend26w: number; // slope per week
  depthMomentum: number; // 2nd derivative (acceleration)
  depthDirection: DepthDirection;
  depthVolatility: number; // stddev of weekly depth scores
  currentDepthScore: number;
  currentLiquidity: string;
}

interface WeeklyDataPoint {
  week: string; // ISO date (week start)
  depthScore: number; // 0-100
  liquidity: string;
  listingCount: number;
  avgPrice: number;
  pricingConfidence: number;
}

interface DepthCycle {
  depthPeaks: Array<{ week: string; score: number }>;
  depthTroughs: Array<{ week: string; score: number }>;
  avgCycleLength: number; // weeks between peaks
  currentCyclePosition: CyclePosition;
}

interface CategoryDepthTrend {
  category: string;
  depthTrend: number;
  direction: string;
  currentDepth: number;
}

interface DepthAnalysis {
  depthTrendAssessment: string;
  predictedDepthDirection30d: string;
  depthCycleInsight: string;
  liquidityForecast: string;
  tradingImplications: string;
  depthOptimizationActions: Array<{
    action: string;
    priority: ActionPriority;
    detail: string;
  }>;
  confidenceLevel: number;
}

interface AiDepthResponse {
  depthTrendAssessment?: string;
  predictedDepthDirection30d?: string;
  depthCycleInsight?: string;
  liquidityForecast?: string;
  tradingImplications?: string;
  depthOptimizationActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    detail?: string;
  }>;
  confidenceLevel?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_180D = 180 * DAY_MS;
const WEEKS_26 = 26;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const CYCLE_MIN = 0;
const CYCLE_MAX = 52;
const CONF_MIN = 0;
const CONF_MAX = 100;

const VALID_DIRECTION: readonly DepthDirection[] = ['DEEPENING', 'STABLE', 'SHALLOWING'];
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
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}
function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = avg(values);
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
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

function assessLiquidity(listingCount: number): LiquidityAssessment {
  if (listingCount > 100) return 'HIGH';
  if (listingCount >= 30) return 'MEDIUM';
  if (listingCount >= 10) return 'LOW';
  return 'VERY_LOW';
}

// depthScore = listing count score (0-50) + distribution evenness score (0-50)
function computeDepthScore(
  totalListings: number,
  prices: number[],
): number {
  // Listing count component: max 50 at >=50 listings
  let countScore: number;
  if (totalListings >= 50) countScore = 50;
  else if (totalListings >= 30) countScore = 40;
  else if (totalListings >= 20) countScore = 30;
  else if (totalListings >= 10) countScore = 20;
  else if (totalListings >= 5) countScore = 10;
  else countScore = 5;

  // Distribution evenness: based on coefficient of variation of price buckets
  let evennessScore = 0;
  if (totalListings > 0 && prices.length > 0) {
    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const range = max - min;
    if (range > 0) {
      const bucketCount = 10;
      const bucketSize = range / bucketCount;
      const counts = new Array(bucketCount).fill(0);
      for (const p of prices) {
        const idx = Math.min(bucketCount - 1, Math.floor((p - min) / bucketSize));
        counts[idx] = (counts[idx] ?? 0) + 1;
      }
      const sum = counts.reduce((s, c) => s + c, 0);
      const mean = sum / counts.length;
      if (mean > 0) {
        const cv = stdDev(counts) / mean;
        const evenness = Math.max(0, 1 - cv / 2);
        evennessScore = Math.round(evenness * 50);
      }
    } else {
      evennessScore = 25; // all prices same
    }
  }

  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, countScore + evennessScore));
}

function computePricingConfidence(
  totalListings: number,
  stdDevPrice: number,
  meanPrice: number,
): number {
  let conf = 0;
  if (totalListings >= 100) conf += 60;
  else if (totalListings >= 50) conf += 50;
  else if (totalListings >= 30) conf += 40;
  else if (totalListings >= 15) conf += 25;
  else if (totalListings >= 5) conf += 10;
  else conf += 5;

  if (meanPrice > 0) {
    const cv = stdDevPrice / meanPrice;
    let cvScore = 0;
    if (cv < 0.2) cvScore = 40;
    else if (cv < 0.4) cvScore = 30;
    else if (cv < 0.6) cvScore = 20;
    else if (cv < 1.0) cvScore = 10;
    else cvScore = 5;
    conf += cvScore;
  }
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, conf));
}

function directionFromTrend(trend: number): DepthDirection {
  if (trend > 0.5) return 'DEEPENING';
  if (trend < -0.5) return 'SHALLOWING';
  return 'STABLE';
}

// Detect local maxima (peaks) and minima (troughs) in a depth score series
function detectCycles(
  weekly: WeeklyDataPoint[],
): {
  peaks: Array<{ week: string; score: number; index: number }>;
  troughs: Array<{ week: string; score: number; index: number }>;
} {
  const peaks: Array<{ week: string; score: number; index: number }> = [];
  const troughs: Array<{ week: string; score: number; index: number }> = [];
  if (weekly.length < 5) return { peaks, troughs };

  // Smooth: use 3-week moving average to reduce noise
  const smoothed = weekly.map((w, i) => {
    if (i === 0 || i === weekly.length - 1) return w.depthScore;
    return round0((weekly[i - 1]!.depthScore + w.depthScore + weekly[i + 1]!.depthScore) / 3);
  });

  for (let i = 1; i < smoothed.length - 1; i++) {
    const prev = smoothed[i - 1]!;
    const curr = smoothed[i]!;
    const next = smoothed[i + 1]!;
    // Peak: curr > prev AND curr > next AND curr >= 40 (significance threshold)
    if (curr > prev && curr > next && curr >= 40) {
      peaks.push({ week: weekly[i]!.week, score: curr, index: i });
    }
    // Trough: curr < prev AND curr < next AND curr <= 60
    if (curr < prev && curr < next && curr <= 60) {
      troughs.push({ week: weekly[i]!.week, score: curr, index: i });
    }
  }
  return { peaks, troughs };
}

function classifyCyclePosition(
  weekly: WeeklyDataPoint[],
  peaks: Array<{ week: string; score: number; index: number }>,
  troughs: Array<{ week: string; score: number; index: number }>,
  currentScore: number,
): CyclePosition {
  if (weekly.length < 5) return 'UNCLEAR';

  const lastIdx = weekly.length - 1;
  const lastScore = currentScore;

  // Determine if we're past a recent peak or trough
  const lastPeak = peaks.length > 0 ? peaks[peaks.length - 1] : null;
  const lastTrough = troughs.length > 0 ? troughs[troughs.length - 1] : null;

  const recentPeak = lastPeak && lastPeak.index >= lastIdx - 3 ? lastPeak : null;
  const recentTrough = lastTrough && lastTrough.index >= lastIdx - 3 ? lastTrough : null;

  if (recentPeak && !recentTrough) {
    // Just past a peak — contraction starting
    const distFromPeak = lastIdx - recentPeak.index;
    if (distFromPeak <= 1) return 'PEAK';
    if (distFromPeak <= 2) return 'EARLY_CONTRACTION';
    if (distFromPeak <= 4) return 'MID_CONTRACTION';
    return 'LATE_CONTRACTION';
  }
  if (recentTrough && !recentPeak) {
    // Just past a trough — expansion starting
    const distFromTrough = lastIdx - recentTrough.index;
    if (distFromTrough <= 1) return 'TROUGH';
    if (distFromTrough <= 2) return 'EARLY_EXPANSION';
    if (distFromTrough <= 4) return 'MID_EXPANSION';
    return 'LATE_EXPANSION';
  }
  // No recent peak/trough — look at trend direction + level
  if (lastScore >= 70) {
    return 'LATE_EXPANSION'; // high but no recent peak = sustained expansion
  }
  if (lastScore <= 30) {
    return 'LATE_CONTRACTION';
  }
  // Mid-range — determine from slope
  const recentTrend = trendSlope(weekly.slice(Math.max(0, lastIdx - 4)).map((w) => w.depthScore));
  if (recentTrend > 0.5) return 'MID_EXPANSION';
  if (recentTrend < -0.5) return 'MID_CONTRACTION';
  return 'UNCLEAR';
}

// --- Listing row type ---------------------------------------------------

interface ListingRow {
  price: number;
  firstSeenAt: Date;
  monitor: { tags: string | null } | null;
}

// --- Weekly aggregation -----------------------------------------------

interface WeekAgg {
  prices: number[];
  listingCount: number;
}

function newWeekAgg(): WeekAgg {
  return { prices: [], listingCount: 0 };
}

// --- Deterministic analysis ------------------------------------------

function buildDeterministicAnalysis(
  trends: DepthTrends,
  cycle: DepthCycle,
  byCategory: CategoryDepthTrend[],
): DepthAnalysis {
  const dir = trends.depthDirection;
  const trend = trends.depthTrend26w;
  const momentum = trends.depthMomentum;
  const currentScore = trends.currentDepthScore;
  const cyclePos = cycle.currentCyclePosition;

  // Trend assessment
  const dirVerb =
    dir === 'DEEPENING' ? 'postaja globlji (bolj likviden)' :
    dir === 'SHALLOWING' ? 'postaja plitvejši (manj likviden)' : 'je stabilen';
  const trendAssessment =
    `Trg ${dirVerb} — trend ${round1(trend)}/teden, momentum ${round1(momentum)}, ` +
    `trenutni depth ${currentScore}/100. ` +
    `Volatilnost depth-a: ${round1(trends.depthVolatility)}. ` +
    `Cycle position: ${cyclePos}.`.slice(0, 500);

  // Predicted direction 30d
  let predictedDirection: string;
  if (dir === 'DEEPENING' && momentum >= 0) {
    predictedDirection = 'Nadaljnje poglabljanje trga — depth bo rasel tudi v naslednjih 30 dneh.';
  } else if (dir === 'DEEPENING' && momentum < 0) {
    predictedDirection = 'Depth še raste, vendar momentum upada — pričakuj upočasnitev poglabljanja.';
  } else if (dir === 'SHALLOWING' && momentum <= 0) {
    predictedDirection = 'Nadaljnje plitvenje trga — depth bo padal tudi v naslednjih 30 dneh.';
  } else if (dir === 'SHALLOWING' && momentum > 0) {
    predictedDirection = 'Depth še pada, vendar momentum raste — pričakuj upočasnitev plitvenja.';
  } else {
    predictedDirection = 'Trg bo verjetno ostal stabilen v naslednjih 30 dneh.';
  }

  // Cycle insight
  let cycleInsight: string;
  switch (cyclePos) {
    case 'EARLY_EXPANSION':
    case 'MID_EXPANSION':
      cycleInsight = 'Trg je v EXPANSION fazi — depth raste. Idealno za povečanje obsega.';
      break;
    case 'LATE_EXPANSION':
      cycleInsight = 'Trg je v LATE EXPANSION — depth še raste vendar se bliža peak. Bodisi previden pri agresivnem povečevanju obsega.';
      break;
    case 'PEAK':
      cycleInsight = 'Trg je pri PEAK depth-u — likvidnost je maksimalna. Maksimiziraj obseg zdaj.';
      break;
    case 'EARLY_CONTRACTION':
    case 'MID_CONTRACTION':
      cycleInsight = 'Trg je v CONTRACTION fazi — depth pada. Zmanjšaj obseg in bodisi previden pri cenah.';
      break;
    case 'LATE_CONTRACTION':
      cycleInsight = 'Trg je v LATE CONTRACTION — depth še pada vendar se bliža trough. Pripravi se na ponovno expansion.';
      break;
    case 'TROUGH':
      cycleInsight = 'Trg je pri TROUGH — depth je minimalen. Možnost nakupa pred ponovnim expansion.';
      break;
    default:
      cycleInsight = 'Trg nima jasnega cycle signala — spremljaj trende.';
  }
  if (cycle.avgCycleLength > 0) {
    cycleInsight += ` Povprečna dolžina cikla: ${cycle.avgCycleLength} tednov.`;
  }
  cycleInsight = cycleInsight.slice(0, 400);

  // Liquidity forecast
  const currentLiquidity = trends.currentLiquidity;
  let liquidityForecast: string;
  if (dir === 'DEEPENING') {
    liquidityForecast = `Likvidnost se bo izboljševala — trenutno ${currentLiquidity}, napovedan prehod v višjo kategorijo v 30 dneh.`;
  } else if (dir === 'SHALLOWING') {
    liquidityForecast = `Likvidnost se bo slabšala — trenutno ${currentLiquidity}, napovedan prehod v nižjo kategorijo v 30 dneh.`;
  } else {
    liquidityForecast = `Likvidnost bo ostala ${currentLiquidity} — brez signifikantnih sprememb v 30 dneh.`;
  }

  // Trading implications
  let tradingImplications: string;
  if (dir === 'DEEPENING' && (cyclePos === 'EARLY_EXPANSION' || cyclePos === 'MID_EXPANSION' || cyclePos === 'PEAK')) {
    tradingImplications = 'Povečaj obseg nabave — trg postaja bolj likviden in zanesljiv za cene. Lažje boš prodal večji volume.';
  } else if (dir === 'SHALLOWING' || cyclePos === 'EARLY_CONTRACTION' || cyclePos === 'MID_CONTRACTION') {
    tradingImplications = 'Zmanjšaj obseg nabave — trg postaja manj likviden in negotljiv za cene. Težje boš prodal, cene bodo negotljive.';
  } else if (cyclePos === 'TROUGH' || cyclePos === 'LATE_CONTRACTION') {
    tradingImplications = 'Pripravi se na expansion — trg je blizu minima. Nabavljaj poceni, pripravi inventar za naslednji expansion cikla.';
  } else {
    tradingImplications = 'Vzdržuj trenutno strategijo — trg je stabilen in predvidljiv.';
  }

  // Optimization actions
  const actions: Array<{ action: string; priority: ActionPriority; detail: string }> = [];
  if (dir === 'DEEPENING') {
    actions.push({
      action: 'Povečaj obseg nabave v kategorijah z najhitrejšo rastjo depth-a.',
      priority: 'HIGH',
      detail: 'Kategorije z najboljšim depth trendom so najbolj zanesljive za obseg.',
    });
  } else if (dir === 'SHALLOWING') {
    actions.push({
      action: 'Zmanjšaj obseg nabave — preidej v defenzivno strategijo.',
      priority: 'HIGH',
      detail: 'Padajoči depth pomeni večjo negotljivost cen in težjo prodajo.',
    });
    actions.push({
      action: 'Premakni kapital v kategorije, ki še globijo.',
      priority: 'MEDIUM',
      detail: 'Tudi v padajočem trgu nekatere kategorije še globijo.',
    });
  }
  // Always: best category action
  const bestCat = byCategory.length > 0
    ? byCategory.reduce((best, c) => (c.depthTrend > best.depthTrend ? c : best), byCategory[0]!)
    : null;
  if (bestCat) {
    actions.push({
      action: `Fokusiraj na "${bestCat.category}" kategorijo — depth trend ${round1(bestCat.depthTrend)}/teden.`,
      priority: 'MEDIUM',
      detail: `Trenutni depth: ${bestCat.currentDepth}/100, smer: ${bestCat.direction}.`,
    });
  }
  if (cyclePos === 'TROUGH' || cyclePos === 'LATE_CONTRACTION') {
    actions.push({
      action: 'Pripravi kapital za nakup v EXPANSION fazi.',
      priority: 'HIGH',
      detail: 'Trg je blizu minima — idealen čas za pozicioniranje.',
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo in redno preverjaj trende.',
      priority: 'LOW',
      detail: 'Trg je stabilen — ni potrebe po spremembah.',
    });
  }

  // Confidence level
  let confidence = 35;
  confidence += Math.min(25, byCategory.length * 3); // more categories = more reliable
  confidence += Math.min(15, Math.min(50, weeklyListingsCount(byCategory)) * 0.3);
  if (Math.abs(trend) > 1) confidence += 10; // strong trend = more confident
  if (cycle.avgCycleLength > 0) confidence += 5; // cycles detected
  confidence = round0(Math.max(CONF_MIN, Math.min(CONF_MAX, confidence)));

  return {
    depthTrendAssessment: trendAssessment,
    predictedDepthDirection30d: predictedDirection,
    depthCycleInsight: cycleInsight,
    liquidityForecast,
    tradingImplications,
    depthOptimizationActions: actions.slice(0, 3),
    confidenceLevel: confidence,
  };
}

function weeklyListingsCount(byCategory: CategoryDepthTrend[]): number {
  return byCategory.reduce((s, c) => s + c.currentDepth, 0);
}

function buildSummary(
  trends: DepthTrends,
  cycle: DepthCycle,
  byCategory: CategoryDepthTrend[],
): string {
  const parts: string[] = [
    `Depth: ${trends.depthDirection} (${round1(trends.depthTrend26w)}/wk, momentum ${round1(trends.depthMomentum)}).`,
    `Cycle position: ${cycle.currentCyclePosition}.`,
    `Liquidity forecast: ${trends.depthDirection === 'DEEPENING' ? 'improving' : trends.depthDirection === 'SHALLOWING' ? 'declining' : 'stable'}.`,
  ];
  if (byCategory.length > 0) {
    const best = byCategory.reduce((b, c) => (c.depthTrend > b.depthTrend ? c : b), byCategory[0]!);
    parts.push(`Best: ${best.category} (${round1(best.depthTrend)}/wk).`);
  }
  return parts.join(' ').slice(0, 400);
}

// --- Handler -----------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleMarketDepthTrendAnalyzer(req);
}
export async function POST(req: NextRequest) {
  return handleMarketDepthTrendAnalyzer(req);
}

async function handleMarketDepthTrendAnalyzer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-market-depth-trend-analyzer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff180d = new Date(now - HORIZON_180D);

    // 1) Query all listings from last 180 days with a price + firstSeenAt
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { gt: 0 },
        firstSeenAt: { gte: cutoff180d },
      },
      select: {
        price: true,
        firstSeenAt: true,
        monitor: { select: { tags: true } },
      },
      take: 50000,
    }) as unknown as ListingRow[];

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        trends: {
          depthTrend26w: 0,
          depthMomentum: 0,
          depthDirection: 'STABLE',
          depthVolatility: 0,
          currentDepthScore: 0,
          currentLiquidity: 'VERY_LOW',
        },
        weeklyData: [],
        cycles: {
          depthPeaks: [],
          depthTroughs: [],
          avgCycleLength: 0,
          currentCyclePosition: 'UNCLEAR',
        },
        byCategory: [],
        analysis: {
          depthTrendAssessment: 'Ni oglasov v zadnjih 180 dneh — Market Depth Trend Analyzer ni mogoč.',
          predictedDepthDirection30d: 'Ni podatkov.',
          depthCycleInsight: 'Ni cycle podatkov.',
          liquidityForecast: 'Ni podatkov.',
          tradingImplications: 'Dodaj oglase z veljavno ceno za začetek analize.',
          depthOptimizationActions: [],
          confidenceLevel: 0,
        },
        summary: 'Ni oglasov v zadnjih 180 dneh — Market Depth Trend Analyzer ni mogoč.',
        aiUsed: false,
        message: 'Ni oglasov v zadnjih 180 dneh — Market Depth Trend Analyzer ni mogoč.',
      });
    }

    // 2) Group by week (26 buckets, index 0 = oldest, 25 = newest)
    const weekStartMs = (t: number): number => {
      const d = new Date(t);
      // Use ISO week start (Monday)
      const day = d.getDay();
      const diff = (day === 0 ? 6 : day - 1); // days since Monday
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
      return monday.getTime();
    };
    const thisWeekStart = weekStartMs(now);

    const weeks: WeekAgg[] = Array.from({ length: WEEKS_26 }, () => newWeekAgg());

    for (const l of listings) {
      const seenMs = l.firstSeenAt ? new Date(l.firstSeenAt).getTime() : 0;
      if (seenMs <= 0) continue;
      const price = l.price ?? 0;
      if (price <= 0) continue;
      const seenWeekStart = weekStartMs(seenMs);
      const weeksAgo = Math.floor((thisWeekStart - seenWeekStart) / (7 * DAY_MS));
      const bucketIdx = 25 - Math.max(0, Math.min(25, weeksAgo));
      if (bucketIdx >= 0 && bucketIdx <= 25) {
        const w = weeks[bucketIdx]!;
        w.prices.push(price);
        w.listingCount += 1;
      }
    }

    // 3) Build weekly data array
    const weeklyData: WeeklyDataPoint[] = weeks.map((w, i) => {
      const weekDate = new Date(thisWeekStart);
      weekDate.setDate(weekDate.getDate() - (25 - i) * 7);
      const totalCount = w.listingCount;
      const depthScore = computeDepthScore(totalCount, w.prices);
      const liquidity = assessLiquidity(totalCount);
      const avgPrice = w.prices.length > 0 ? round0(w.prices.reduce((s, p) => s + p, 0) / w.prices.length) : 0;
      const sd = w.prices.length > 0 ? stdDev(w.prices) : 0;
      const pricingConfidence = computePricingConfidence(totalCount, sd, avgPrice || 1);
      return {
        week: weekDate.toISOString().slice(0, 10),
        depthScore: round0(depthScore),
        liquidity: String(liquidity),
        listingCount: totalCount,
        avgPrice,
        pricingConfidence: round0(pricingConfidence),
      };
    });

    // 4) Compute depth trend metrics
    const depthSeries = weeklyData.map((w) => w.depthScore);
    const depthTrend26w = trendSlope(depthSeries);
    const depthMomentum = computeAcceleration(depthSeries);
    const depthVolatility = round1(stdDev(depthSeries));
    const currentDepthScore = weeklyData.length > 0 ? weeklyData[weeklyData.length - 1]!.depthScore : 0;
    const currentLiquidity = weeklyData.length > 0 ? weeklyData[weeklyData.length - 1]!.liquidity : 'VERY_LOW';
    const depthDirection = directionFromTrend(depthTrend26w);

    const trends: DepthTrends = {
      depthTrend26w: round1(depthTrend26w),
      depthMomentum: round1(depthMomentum),
      depthDirection,
      depthVolatility,
      currentDepthScore,
      currentLiquidity,
    };

    // 5) Detect cycles (peaks + troughs)
    const { peaks, troughs } = detectCycles(weeklyData);
    // Compute avg cycle length: average distance between consecutive peaks
    let avgCycleLength = 0;
    if (peaks.length >= 2) {
      let totalDist = 0;
      for (let i = 1; i < peaks.length; i++) {
        totalDist += peaks[i]!.index - peaks[i - 1]!.index;
      }
      avgCycleLength = totalDist / (peaks.length - 1);
    }
    const currentCyclePosition = classifyCyclePosition(
      weeklyData,
      peaks,
      troughs,
      currentDepthScore,
    );

    const cycle: DepthCycle = {
      depthPeaks: peaks.map((p) => ({ week: p.week, score: p.score })),
      depthTroughs: troughs.map((t) => ({ week: t.week, score: t.score })),
      avgCycleLength: round1(Math.max(CYCLE_MIN, Math.min(CYCLE_MAX, avgCycleLength))),
      currentCyclePosition,
    };

    // 6) Per-category depth trend (use last 12 weeks for trend per category)
    const byCategoryMap = new Map<string, { weeks: number[]; currentDepth: number }>();
    for (const l of listings) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)[0];
      const cat = (firstTag || 'drugo').trim() || 'drugo';
      const seenMs = l.firstSeenAt ? new Date(l.firstSeenAt).getTime() : 0;
      if (seenMs <= 0) continue;
      const seenWeekStart = weekStartMs(seenMs);
      const weeksAgo = Math.floor((thisWeekStart - seenWeekStart) / (7 * DAY_MS));
      const bucketIdx = 25 - Math.max(0, Math.min(25, weeksAgo));
      if (bucketIdx >= 0 && bucketIdx <= 25) {
        let entry = byCategoryMap.get(cat);
        if (!entry) {
          entry = { weeks: new Array(26).fill(0), currentDepth: 0 };
          byCategoryMap.set(cat, entry);
        }
        entry.weeks[bucketIdx] = (entry.weeks[bucketIdx] ?? 0) + 1;
      }
    }
    const byCategory: CategoryDepthTrend[] = [];
    for (const [category, entry] of byCategoryMap.entries()) {
      const trend = trendSlope(entry.weeks);
      byCategory.push({
        category,
        depthTrend: round1(trend),
        direction: String(directionFromTrend(trend)),
        currentDepth: round0(computeDepthScore(entry.weeks[25] ?? 0, [])),
      });
    }
    byCategory.sort((a, b) => b.depthTrend - a.depthTrend);

    // 7) Build deterministic baseline (fallback)
    const detAnalysis = buildDeterministicAnalysis(trends, cycle, byCategory);
    let analysis = detAnalysis;
    let summary = buildSummary(trends, cycle, byCategory);

    // 8) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `market-depth-trend-analyzer:${currentMonth}`;
    const cached = getCachedAI<{ analysis: DepthAnalysis; summary: string }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        trends,
        weeklyData,
        cycles: cycle,
        byCategory,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 9) AI prompt with grounding
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
      trends,
      weeklyData,
      cycles: cycle,
      byCategory: byCategory.slice(0, 10),
      deterministicBaseline: detAnalysis,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        cycleMin: CYCLE_MIN, cycleMax: CYCLE_MAX,
        confMin: CONF_MIN, confMax: CONF_MAX,
      },
    };

    const prompt = `Si AI "Market Depth Trend Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Analiziraš kako se GLOBINA trga (market depth) spreminja čez čas — track-a depth trend (26 tednov), identificira depth cycles (peaks/troughs) in napove kdaj bo trg globlji ali plitvejši. Razlika od market-depth-analyzer (ki da snapshot depth-a) — ti gledaš HISTORICAL trend z cycle detection.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 180 dni oglasov z veljavno ceno, grouped by week):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. depthTrendAssessment: slovensko, max 500 znakov — kaj depth trend pomeni za trgovanje.
2. predictedDepthDirection30d: slovensko, max 300 znakov — ali bo depth v 30 dneh rasel ali padal.
3. depthCycleInsight: slovensko, max 400 znakov — kaj pomeni trenutni cycle position.
4. liquidityForecast: slovensko, max 300 znakov — ali bo trg bolj ali manj likviden.
5. tradingImplications: slovensko, max 400 znakov — kako prilagoditi strategijo.
6. depthOptimizationActions: 1-3 akcij { action (max 200 chars), priority HIGH | MEDIUM | LOW, detail (max 200 chars) }.
7. confidenceLevel: 0-100, ±10 od deterministične.
8. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "depthTrendAssessment": "Trg postaja globlji — trend +2.5/teden, momentum +0.5. Trenutni depth 65/100. Cycle position: MID_EXPANSION.",
  "predictedDepthDirection30d": "Nadaljnje poglabljanje trga — depth bo rasel tudi v naslednjih 30 dneh.",
  "depthCycleInsight": "Trg je v EXPANSION fazi — depth raste. Idealno za povečanje obsega. Povprečna dolžina cikla: 8 tednov.",
  "liquidityForecast": "Likvidnost se bo izboljševala — trenutno MEDIUM, napovedan prehod v HIGH v 30 dneh.",
  "tradingImplications": "Povečaj obseg nabave — trg postaja bolj likviden in zanesljiv za cene.",
  "depthOptimizationActions": [
    { "action": "Povečaj obseg v kategorijah z najhitrejšo rastjo depth-a.", "priority": "HIGH", "detail": "Elektronika: +4/teden trend." }
  ],
  "confidenceLevel": 72,
  "summary": "Depth: DEEPENING (+2.5/wk, momentum +0.5). Cycle position: MID_EXPANSION. Liquidity forecast: improving. Best: elektronika (+4/wk)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiDepthResponse | null;

      if (parsed && typeof parsed === 'object') {
        const detConf = detAnalysis.confidenceLevel;
        const confidenceLevel = round0(
          Math.max(CONF_MIN, Math.min(CONF_MAX,
            detConf + Math.max(-10, Math.min(10,
              (Number(parsed.confidenceLevel ?? detConf)) - detConf)))),
        );

        // Optimization actions
        const actions: Array<{ action: string; priority: ActionPriority; detail: string }> = [];
        if (Array.isArray(parsed.depthOptimizationActions)) {
          for (const a of parsed.depthOptimizationActions.slice(0, 3)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, detAnalysis.depthOptimizationActions[0]?.action ?? 'Maintain strategy.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, detAnalysis.depthOptimizationActions[0]?.priority ?? 'MEDIUM'),
              detail: clampString(a.detail, 200, detAnalysis.depthOptimizationActions[0]?.detail ?? 'Stabilen trg.'),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of detAnalysis.depthOptimizationActions) actions.push(a);
        }

        analysis = {
          depthTrendAssessment: clampString(parsed.depthTrendAssessment, 500, detAnalysis.depthTrendAssessment),
          predictedDepthDirection30d: clampString(parsed.predictedDepthDirection30d, 300, detAnalysis.predictedDepthDirection30d),
          depthCycleInsight: clampString(parsed.depthCycleInsight, 400, detAnalysis.depthCycleInsight),
          liquidityForecast: clampString(parsed.liquidityForecast, 300, detAnalysis.liquidityForecast),
          tradingImplications: clampString(parsed.tradingImplications, 400, detAnalysis.tradingImplications),
          depthOptimizationActions: actions,
          confidenceLevel,
        };
        summary = clampString(parsed.summary, 400, buildSummary(trends, cycle, byCategory));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/market-depth-trend-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 10) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { analysis, summary });
    }

    return NextResponse.json({
      ok: true,
      trends,
      weeklyData,
      cycles: cycle,
      byCategory,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/market-depth-trend-analyzer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
