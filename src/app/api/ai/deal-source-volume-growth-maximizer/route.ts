// v8.13: AI Deal Source Volume Growth Maximizer — AI MAKSIMIZIRA GROWTH
// RATE trade VOLUME-ja PER SOURCE — ne trenutni volume, ampak kako hitro
// volume raste per source month-over-month. "Bolha volume raste +8%/mo, Vinted
// +3%/mo — ampak bi lahko bilo +15% in +8%." Razlika od deal-source-profit-
// margin-growth-maximizer (v8.12 ki maksimizira margin growth rate per source
// v %/mo) — ta MAKSIMIZIRA VOLUME GROWTH RATE per source (%/mo kako hitro
// volume raste, ne kako hitro margin raste). Razlika od profit-per-trade-
// scaling-maximizer (v8.13 ki skalira profit per trade z 4-phase progression)
// — ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo volume growth, ne €/trade
// scaling). Razlika od profit-per-day-scaling-maximizer (v8.08 ki skalira
// daily profit z requiredTradesPerDay) — ta MAKSIMIZIRA VOLUME GROWTH per
// source (%/mo source volume growth, ne absolute €/dan scaling). Razlika od
// inventory-turnover-profit-growth-maximizer (v8.13 ki maksimizira growth
// turnover profit-a v €/mo) — ta MAKSIMIZIRA VOLUME GROWTH RATE per source
// (%/mo per-source volume growth, ne €/mo turnover profit growth). Razlika
// od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega
// profit-a v %/mo) — ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo kako hitro
// trade COUNT raste per source, ne kako hitro profit € raste). Razlika od
// deal-source-profit-per-day-maximizer (v8.11 ki maksimizira profit per day
// per source €/dan) — ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo volume
// growth, ne €/dan profit per source). Razlika od inventory-capital-
// efficiency-growth-maximizer (v8.12 ki maksimizira capital efficiency growth
// %/mo) — ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo source volume growth,
// ne capital efficiency %/mo growth). Razlika od profit-per-cycle-maximizer
// (v8.12 ki maksimizira profit per cycle €/cycle) — ta MAKSIMIZIRA VOLUME
// GROWTH per source (%/mo source volume growth, ne €/cycle profit). Razlika
// od deal-source-annual-return-maximizer (v8.10 ki maksimizira annualized
// return per source z benchmark) — ta MAKSIMIZIRA VOLUME GROWTH RATE per
// source (%/mo, ne % annual return). Razlika od deal-source-profit-velocity-
// maximizer (v8.08 ki maksimizira velocity profit-a per source €/teden) —
// ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo, ne €/teden). Razlika od
// deal-source-profitability-analyzer (v8.06 ki analizira profitability per
// source) — ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo growth, ne
// profitability snapshot). Razlika od deal-source-profit-per-trade-maximizer
// (v8.04 ki maksimizira profit per trade per source €) — ta MAKSIMIZIRA
// VOLUME GROWTH per source (%/mo volume growth, ne €/trade profit per source).
// Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira net cash
// flow per source) — ta MAKSIMIZIRA VOLUME GROWTH per source (%/mo volume
// growth rate, ne € net cash flow). Razlika od deal-source-margin-maximizer
// (v8.03 ki maksimizira margin % per source) — ta MAKSIMIZIRA VOLUME GROWTH
// RATE per source (%/mo kako hitro volume raste, ne absolutna margin %).

// GET+POST /api/ai/deal-source-volume-growth-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.6) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface DealSourceVolumeGrowthMaximizerInput {}

// --- Types ---------------------------------------------------------------

type VolumeGrowthAction =
  | 'ADD_MONITORS'
  | 'EXPAND_CATEGORIES'
  | 'INCREASE_SEARCH_FREQUENCY'
  | 'CROSS_POST'
  | 'OPTIMIZE_LISTING_QUALITY';
type VolumeGrowthTrend =
  | 'ACCELERATING'
  | 'STABLE'
  | 'DECLINING'
  | 'VOLATILE'
  | 'INSUFFICIENT_DATA';
type VolumeGrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface SoldTradeRow {
  id: string;
  sellDate: Date | null;
  buyLocation: string;
  listing: {
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface MonthlyVolumeBucket {
  month: number; // 0-11 (oldest → newest)
  monthLabel: string; // YYYY-MM
  tradeCount: number;
}

interface SourceMetrics {
  source: string;
  displayName: string;
  tradeCount12m: number;
  monthlyVolumes: number[]; // 12 entries (trade count per month, oldest → newest)
  currentMonthlyVolume: number; // last month with data
  avgMonthlyVolume: number; // avg over 12 months
  volumeGrowthRate: number; // %/mo (linear regression slope / mean × 100)
  volumeGrowthTrend: VolumeGrowthTrend;
  volumeGrowthAcceleration: number; // %/mo² (slope of last half vs first half)
  monthsWithData: number;
  bestMonthlyVolume: number;
  worstMonthlyVolume: number;
}

interface VolumeGrowthProjectionEntry {
  months: number; // 3, 6, 12
  projectedVolume: number; // trade count [0, 10000] (= current × (1 + months × maximizedVolumeGrowthRate/100))
}

interface SourceMaximization {
  volumeGrowthMaximizationAction: VolumeGrowthAction;
  maximizedVolumeGrowthRate: number; // %/mo [-50, 100] (≥ current, ≤ current + 30pp absolute uplift — anti-hallucination)
  volumeGrowthUplift: number; // pp [0, 100] (improvement = maximized − current)
  volumeGrowthLevers: string[]; // 3-5 slovenian max 200 each
  volumeGrowthProjection: VolumeGrowthProjectionEntry[]; // 3/6/12 month volume forecast
  volumeGrowthGrade: VolumeGrowthGrade;
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  currentPortfolioVolumeGrowth: number; // %/mo = weighted avg of source growth rates
  maximizedPortfolioVolumeGrowth: number; // %/mo = weighted avg of maximized
  portfolioVolumeGrowthUplift: number; // pp
  sourceVolumeGrowthRanking: Array<{
    source: string;
    displayName: string;
    currentVolumeGrowthRate: number; // %/mo
    maximizedVolumeGrowthRate: number; // %/mo
    rank: number;
  }>;
  bestVolumeGrowthSource: string;
}

interface DealSourceVolumeGrowthResponse {
  ok: true;
  sources: SourceEntry[];
  portfolio: PortfolioSummary;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  sources?: Array<{
    source?: string;
    maximization?: {
      volumeGrowthMaximizationAction?: VolumeGrowthAction;
      maximizedVolumeGrowthRate?: number;
      volumeGrowthUplift?: number;
      volumeGrowthLevers?: string[];
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const VOLUME_MIN = 0;
const VOLUME_MAX = 1000;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 100;
const ACCELERATION_MIN = -50;
const ACCELERATION_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100;
const PROJECTED_VOLUME_MIN = 0;
const PROJECTED_VOLUME_MAX = 10_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const ABSOLUTE_UPLIFT_CAP_PP = 30; // max +30pp absolute uplift — anti-hallucination
const MAX_LEVERS = 5;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;

const VALID_ACTION: readonly VolumeGrowthAction[] = [
  'ADD_MONITORS',
  'EXPAND_CATEGORIES',
  'INCREASE_SEARCH_FREQUENCY',
  'CROSS_POST',
  'OPTIMIZE_LISTING_QUALITY',
];

const VALID_TREND: readonly VolumeGrowthTrend[] = [
  'ACCELERATING',
  'STABLE',
  'DECLINING',
  'VOLATILE',
  'INSUFFICIENT_DATA',
];

// Per-action absolute uplift potential (pp — anti-hallucination cap)
// Maximised uplift = current + ACTION_GAIN_PP
const ACTION_GAIN_PP: Record<VolumeGrowthAction, number> = {
  ADD_MONITORS: 8.0, // +8pp by adding more search monitors per source
  EXPAND_CATEGORIES: 6.0, // +6pp by expanding to new categories within source
  INCREASE_SEARCH_FREQUENCY: 5.0, // +5pp by increasing search frequency (hourly vs daily)
  CROSS_POST: 10.0, // +10pp by cross-posting same items across platforms
  OPTIMIZE_LISTING_QUALITY: 4.0, // +4pp by improving listing quality → higher conversion
};

const SOURCE_DISPLAY: Record<string, string> = {
  bolha: 'Bolha',
  vinted: 'Vinted',
  avtonet: 'Avtonet',
  'mobile.de': 'mobile.de',
  kleinanzeigen: 'Kleinanzeigen',
  subito: 'Subito',
  willhaben: 'Willhaben',
  salomon: 'Salomon',
  'custom-rss': 'Custom RSS',
  nepremicnine: 'Nepremičnine',
};

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
function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
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

function detectSource(t: SoldTradeRow): string {
  const monitorSource = t.listing?.monitor?.source ?? '';
  if (monitorSource && monitorSource.trim().length > 0) {
    return monitorSource.toLowerCase().trim();
  }
  const loc = (t.buyLocation ?? '').toLowerCase().trim();
  if (loc.includes('bolha')) return 'bolha';
  if (loc.includes('vinted')) return 'vinted';
  if (loc.includes('avtonet')) return 'avtonet';
  if (loc.includes('mobile.de') || loc.includes('mobile de')) return 'mobile.de';
  if (loc.includes('kleinanzeigen')) return 'kleinanzeigen';
  if (loc.includes('subito')) return 'subito';
  if (loc.includes('willhaben')) return 'willhaben';
  if (loc.includes('salomon')) return 'salomon';
  if (loc.includes('nepremicnine')) return 'nepremicnine';
  if (loc.includes('custom') || loc.includes('rss')) return 'custom-rss';
  return loc.length > 0 ? loc.slice(0, 50) : 'drugo';
}

function displayName(source: string): string {
  if (SOURCE_DISPLAY[source]) return SOURCE_DISPLAY[source];
  if (!source) return 'Drugo';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

// --- Deterministic computation ------------------------------------------

interface TradeComputed {
  source: string;
  sellMs: number;
  within12m: boolean;
}

function computeTrade(t: SoldTradeRow, now: number): TradeComputed | null {
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  if (!within12m) return null;
  const source = detectSource(t);
  return { source, sellMs, within12m };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
}

function aggregateBySource(trades: TradeComputed[]): Map<string, SourceAgg> {
  const map = new Map<string, SourceAgg>();
  for (const tr of trades) {
    let agg = map.get(tr.source);
    if (!agg) {
      agg = { source: tr.source, trades: [] };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
  }
  return map;
}

function monthLabelForIndex(idx: number, now: number): string {
  const targetMs = now - (11 - idx) * MONTH_MS;
  return new Date(targetMs).toISOString().slice(0, 7);
}

// Bucket trades into 12 monthly volume buckets per source
// Returns array of 12 monthly volume buckets (oldest → newest)
function bucketMonthlyVolumes(
  trades: TradeComputed[],
  now: number,
): MonthlyVolumeBucket[] {
  const buckets: MonthlyVolumeBucket[] = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    monthLabel: monthLabelForIndex(i, now),
    tradeCount: 0,
  }));
  for (const t of trades) {
    const monthsAgo = Math.floor((now - t.sellMs) / MONTH_MS);
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo; // 0 = oldest, 11 = newest
      buckets[idx].tradeCount += 1;
    }
  }
  for (const b of buckets) {
    b.tradeCount = round0(clampNum(b.tradeCount, VOLUME_MIN, VOLUME_MAX, 0));
  }
  return buckets;
}

function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

function computeGrowthRate(monthlyVolumes: number[]): number {
  if (monthlyVolumes.length < 2) return 0;
  const slope = linearRegressionSlope(monthlyVolumes);
  const mean = monthlyVolumes.reduce((s, v) => s + v, 0) / monthlyVolumes.length;
  if (Math.abs(mean) < 0.01) return 0;
  return (slope / mean) * 100;
}

function computeAcceleration(monthlyVolumes: number[]): number {
  const n = monthlyVolumes.length;
  if (n < 4) return 0;
  const half = Math.floor(n / 2);
  const firstHalf = monthlyVolumes.slice(0, half);
  const secondHalf = monthlyVolumes.slice(n - half);
  const slopeFirst = linearRegressionSlope(firstHalf);
  const slopeSecond = linearRegressionSlope(secondHalf);
  const mean = monthlyVolumes.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 0.01) return 0;
  return ((slopeSecond - slopeFirst) / mean) * 100;
}

function decideTrend(
  growthRate: number,
  acceleration: number,
  monthsWithData: number,
): VolumeGrowthTrend {
  if (monthsWithData < 4) return 'INSUFFICIENT_DATA';
  if (growthRate >= 5 && acceleration >= 1) return 'ACCELERATING';
  if (growthRate <= -3 && acceleration <= -1) return 'DECLINING';
  if (Math.abs(acceleration) > 15 || growthRate > 30) return 'VOLATILE';
  return 'STABLE';
}

function computeSourceMetrics(agg: SourceAgg, now: number): SourceMetrics {
  const monthlyBuckets = bucketMonthlyVolumes(agg.trades, now);
  const monthlyVolumes = monthlyBuckets.map((b) => b.tradeCount);
  const monthsWithData = monthlyVolumes.filter((v) => v !== 0).length;
  const tradeCount12m = agg.trades.length;

  const avgMonthlyVolume = round2(clampNum(
    monthlyVolumes.length > 0
      ? monthlyVolumes.reduce((s, v) => s + v, 0) / monthlyVolumes.length
      : 0,
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const currentMonthlyVolume = round2(clampNum(
    monthlyVolumes[monthlyVolumes.length - 1] ?? 0,
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const volumeGrowthRate = round2(clampNum(
    computeGrowthRate(monthlyVolumes),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const volumeGrowthAcceleration = round2(clampNum(
    computeAcceleration(monthlyVolumes),
    ACCELERATION_MIN, ACCELERATION_MAX, 0,
  ));
  const volumeGrowthTrend = decideTrend(volumeGrowthRate, volumeGrowthAcceleration, monthsWithData);
  const bestMonthlyVolume = round0(clampNum(
    monthlyVolumes.length > 0 ? Math.max(...monthlyVolumes) : 0,
    VOLUME_MIN, VOLUME_MAX, 0,
  ));
  const worstMonthlyVolume = round0(clampNum(
    monthlyVolumes.length > 0 ? Math.min(...monthlyVolumes) : 0,
    VOLUME_MIN, VOLUME_MAX, 0,
  ));

  return {
    source: agg.source,
    displayName: displayName(agg.source),
    tradeCount12m,
    monthlyVolumes,
    currentMonthlyVolume,
    avgMonthlyVolume,
    volumeGrowthRate,
    volumeGrowthTrend,
    volumeGrowthAcceleration,
    monthsWithData,
    bestMonthlyVolume,
    worstMonthlyVolume,
  };
}

// --- Deterministic maximization -----------------------------------------

function decideAction(metrics: SourceMetrics): VolumeGrowthAction {
  // If volume growth is declining → ADD_MONITORS (recover by more search coverage)
  if (metrics.volumeGrowthTrend === 'DECLINING') return 'ADD_MONITORS';
  // If current volume is low (< 5/month) → INCREASE_SEARCH_FREQUENCY
  if (metrics.currentMonthlyVolume < 5) return 'INCREASE_SEARCH_FREQUENCY';
  // If volume growth is stable but slow (< 5%/mo) → EXPAND_CATEGORIES
  if (metrics.volumeGrowthRate < 5 && metrics.avgMonthlyVolume >= 5) {
    return 'EXPAND_CATEGORIES';
  }
  // If volume is healthy and growing → CROSS_POST for multi-platform boost
  if (metrics.volumeGrowthRate >= 5 && metrics.avgMonthlyVolume >= 10) {
    return 'CROSS_POST';
  }
  // Default → OPTIMIZE_LISTING_QUALITY
  return 'OPTIMIZE_LISTING_QUALITY';
}

function buildLevers(metrics: SourceMetrics, action: VolumeGrowthAction): string[] {
  const levers: string[] = [];
  levers.push(`Trenutno: ${metrics.tradeCount12m} trades 12m, ${metrics.avgMonthlyVolume.toFixed(2)} trades/mo avg, current ${metrics.currentMonthlyVolume.toFixed(2)}, growth ${metrics.volumeGrowthRate.toFixed(2)}%/mo, trend ${metrics.volumeGrowthTrend}, ${metrics.monthsWithData} mesecev z data, best ${metrics.bestMonthlyVolume}/mo.`);
  switch (action) {
    case 'ADD_MONITORS':
      levers.push(`Dodaj 3-5 novih iskalnih monitorjev za ${metrics.displayName} z različnimi keyword combinations in geo-radius — +8pp/mo volume growth z boljšim deal coverage.`);
      levers.push('Vklopi AI keyword-expander za long-tail keywords z nizko konkurenco in visoko konverzijo — +3-5pp/mo z boljšim niche coverage.');
      levers.push('Avtomatiziraj monitor rotation — deaktiviraj nizko-performanco monitorje (< 2 trades/mo) in aktiviraj nove z AI suggestion.');
      break;
    case 'EXPAND_CATEGORIES':
      levers.push(`Razširi ${metrics.displayName} sourcing v 2-3 nove kategorije (npr. electronics → home audio, watches, gaming) — +6pp/mo z novim category coverage.`);
      levers.push('AI category-opportunity-detector za identifikacijo high-demand nizko-konkurenčnih kategorij z +5-10pp/mo volume growth potential.');
      levers.push('Cross-pollinate uspešne kategorije iz drugih source-ov v ${metrics.displayName} — +2-4pp/mo z boljšim category mix.');
      break;
    case 'INCREASE_SEARCH_FREQUENCY':
      levers.push(`Povečaj search frequency na ${metrics.displayName} iz daily na hourly (4-8×/dan) — +5pp/mo z boljšim deal timing in first-mover advantage.`);
      levers.push('Vklopi real-time alerts (push, email) za nove listing-e z deal score > 80 — +2-3pp/mo z boljšo hitrostjo odziva.');
      levers.push('Avtomatiziraj buy workflow z AI fast-close za premium deals (deal score > 90) — +1-2pp/mo z zero-friction buying.');
      break;
    case 'CROSS_POST':
      levers.push(`Cross-post ${metrics.displayName} listing-e na 2-3 druge platforme (npr. Bolha → Vinted + mobile.de) — +10pp/mo z multi-platform exposure in 2-3× potential buyers.`);
      levers.push('AI cross-post optimizer za optimal platform selection per category (lowest fee + highest demand) — +3-5pp/mo z boljšo platform-deal match.');
      levers.push('Avtomatiziraj cross-posting z AI listing-adapter (formatira naslov, opis, ceno per platformo) — +2-4pp/mo z operational efficiency.');
      break;
    case 'OPTIMIZE_LISTING_QUALITY':
      levers.push(`Izboljšaj listing quality na ${metrics.displayName} z AI SEO naslovi, professional fotografijami in podrobnimi opisi — +4pp/mo z višjo conversion rate (+10-15%) in večjim buyer interest.`);
      levers.push('A/B test listing titles in thumbnails za optimal click-through rate — +2-3pp/mo z boljšim CTR in boljšim listing visibility.');
      levers.push('Vklopi AI listing-quality-score in optimize vsak listing pred objavo — +1-2pp/mo z boljšo začetno pozicijo in boljšim long-tail discovery.');
      break;
  }
  return levers.slice(0, MAX_LEVERS).map((s) => clampString(s, 200, 'Volume growth lever neopisan.'));
}

function buildVolumeGrowthProjection(
  currentMonthlyVolume: number,
  maximizedVolumeGrowthRate: number,
): VolumeGrowthProjectionEntry[] {
  const out: VolumeGrowthProjectionEntry[] = [];
  for (const months of [3, 6, 12]) {
    // Linear projection: current × (1 + months × growthRate/100)
    const projected = currentMonthlyVolume * (1 + (months * maximizedVolumeGrowthRate) / 100);
    out.push({
      months,
      projectedVolume: round0(clampNum(
        projected, PROJECTED_VOLUME_MIN, PROJECTED_VOLUME_MAX, currentMonthlyVolume,
      )),
    });
  }
  return out.slice(0, MAX_PROJECTIONS);
}

function decideGrade(maximizedVolumeGrowthRate: number): VolumeGrowthGrade {
  if (maximizedVolumeGrowthRate >= 25) return 'A+';
  if (maximizedVolumeGrowthRate >= 15) return 'A';
  if (maximizedVolumeGrowthRate >= 8) return 'B';
  if (maximizedVolumeGrowthRate >= 4) return 'C';
  if (maximizedVolumeGrowthRate >= 1) return 'D';
  return 'F';
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideAction(metrics);
  const gainPp = ACTION_GAIN_PP[action];

  // Anti-hallucination: maximized ∈ [current, min(current + 30pp, 100%/mo)]
  const minBound = Math.max(GROWTH_RATE_MIN, metrics.volumeGrowthRate);
  const maxBound = Math.min(GROWTH_RATE_MAX, metrics.volumeGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
  const maximizedVolumeGrowthRate = round2(clampNum(
    metrics.volumeGrowthRate + gainPp,
    minBound, maxBound,
    metrics.volumeGrowthRate,
  ));
  const volumeGrowthUplift = round2(clampNum(
    Math.max(0, maximizedVolumeGrowthRate - metrics.volumeGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const volumeGrowthLevers = buildLevers(metrics, action);
  const volumeGrowthProjection = buildVolumeGrowthProjection(
    metrics.currentMonthlyVolume,
    maximizedVolumeGrowthRate,
  );
  const volumeGrowthGrade = decideGrade(maximizedVolumeGrowthRate);

  return {
    volumeGrowthMaximizationAction: action,
    maximizedVolumeGrowthRate,
    volumeGrowthUplift,
    volumeGrowthLevers,
    volumeGrowthProjection,
    volumeGrowthGrade,
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>, now: number): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg, now);
    if (metrics.monthsWithData < 1) continue;
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization: {} as SourceMaximization,
    });
  }
  // Sort by volumeGrowthRate desc (best source first)
  entries.sort((a, b) => b.metrics.volumeGrowthRate - a.metrics.volumeGrowthRate);
  for (let i = 0; i < entries.length; i++) {
    entries[i].maximization = buildSourceMaximization(entries[i].metrics);
  }
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  // Weighted by trade count
  const totalTrades = entries.reduce((s, e) => s + e.metrics.tradeCount12m, 0);
  let currentPortfolio = 0;
  let maximizedPortfolio = 0;
  for (const e of entries) {
    const weight = totalTrades > 0 ? e.metrics.tradeCount12m / totalTrades : 0;
    currentPortfolio += e.metrics.volumeGrowthRate * weight;
    maximizedPortfolio += e.maximization.maximizedVolumeGrowthRate * weight;
  }
  currentPortfolio = round2(clampNum(
    currentPortfolio, GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  maximizedPortfolio = round2(clampNum(
    maximizedPortfolio, GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const portfolioVolumeGrowthUplift = round2(clampNum(
    Math.max(0, maximizedPortfolio - currentPortfolio),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const sourceVolumeGrowthRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentVolumeGrowthRate: e.metrics.volumeGrowthRate,
    maximizedVolumeGrowthRate: e.maximization.maximizedVolumeGrowthRate,
    rank: idx + 1,
  }));
  const bestEntry = entries[0];
  const bestVolumeGrowthSource = bestEntry ? bestEntry.source : '';
  return {
    currentPortfolioVolumeGrowth: currentPortfolio,
    maximizedPortfolioVolumeGrowth: maximizedPortfolio,
    portfolioVolumeGrowthUplift,
    sourceVolumeGrowthRanking,
    bestVolumeGrowthSource,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Volume Growth Maximizer ni mogoč.';
  }
  const best = entries[0];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio volume growth: ${portfolio.currentPortfolioVolumeGrowth.toFixed(2)}%/mo → ${portfolio.maximizedPortfolioVolumeGrowth.toFixed(2)}%/mo (+${portfolio.portfolioVolumeGrowthUplift.toFixed(2)}pp uplift).`,
    `Best: ${best.displayName} (${best.metrics.volumeGrowthRate.toFixed(2)}%/mo → ${best.maximization.maximizedVolumeGrowthRate.toFixed(2)}%/mo).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

const dealSourceVolumeGrowthMaximizerHandler = withAiRoute<DealSourceVolumeGrowthMaximizerInput>({
  endpoint: '/api/ai/deal-source-volume-growth-maximizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades last 12 months with linked Listing for source
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
      },
      select: {
        id: true,
        sellDate: true,
        buyLocation: true,
        listing: {
          select: {
            monitor: { select: { source: true, tags: true } },
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        sources: [],
        portfolio: {
          currentPortfolioVolumeGrowth: 0,
          maximizedPortfolioVolumeGrowth: 0,
          portfolioVolumeGrowthUplift: 0,
          sourceVolumeGrowthRanking: [],
          bestVolumeGrowthSource: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Volume Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Volume Growth Maximizer ni mogoč.',
      } satisfies DealSourceVolumeGrowthResponse);
    }

    // 2) Compute trades within 12m
    const computed: TradeComputed[] = [];
    for (const t of soldTrades) {
      const c = computeTrade(t, now);
      if (c) computed.push(c);
    }

    if (computed.length === 0) {
      return apiOk({
        ok: true,
        sources: [],
        portfolio: {
          currentPortfolioVolumeGrowth: 0,
          maximizedPortfolioVolumeGrowth: 0,
          portfolioVolumeGrowthUplift: 0,
          sourceVolumeGrowthRanking: [],
          bestVolumeGrowthSource: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Volume Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Volume Growth Maximizer ni mogoč.',
      } satisfies DealSourceVolumeGrowthResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap, now);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `deal-source-volume-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      sources: SourceEntry[];
      portfolio: PortfolioSummary;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        sources: cached.sources,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealSourceVolumeGrowthResponse);
    }

    // 4) AI prompt with grounding
    const sourcesForAI = entries.map((e) => ({
      source: e.source,
      displayName: e.displayName,
      metrics: e.metrics,
      deterministicMaximization: e.maximization,
    }));

    const promptData = {
      totalTrades: computed.length,
      totalSources: entries.length,
      sources: sourcesForAI.slice(0, 20),
      deterministicPortfolio: {
        currentPortfolioVolumeGrowth: portfolio.currentPortfolioVolumeGrowth,
        maximizedPortfolioVolumeGrowth: portfolio.maximizedPortfolioVolumeGrowth,
        portfolioVolumeGrowthUplift: portfolio.portfolioVolumeGrowthUplift,
        sourceVolumeGrowthRanking: portfolio.sourceVolumeGrowthRanking,
        bestVolumeGrowthSource: portfolio.bestVolumeGrowthSource,
      },
      caps: {
        volumeMin: VOLUME_MIN, volumeMax: VOLUME_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        projectedVolumeMin: PROJECTED_VOLUME_MIN, projectedVolumeMax: PROJECTED_VOLUME_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        absoluteUpliftCapPp: ABSOLUTE_UPLIFT_CAP_PP,
      },
      actionGainPp: ACTION_GAIN_PP,
    };

    const prompt = `Si AI "Deal Source Volume Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za VOLUME GROWTH RATE MAXIMIZATION per source — kako maksimizirati GROWTH RATE trade VOLUME-ja PER SOURCE (koliko hitro število trade-ov raste per source month-over-month). Tvoj cilj je "Bolha volume raste +8%/mo, Vinted +3%/mo — ampak bi lahko bilo +15% in +8%." Razlika od deal-source-profit-margin-growth-maximizer (v8.12 ki maksimizira margin growth rate per source v %/mo) — ti MAKSIMIZIRAŠ VOLUME GROWTH RATE per source (%/mo kako hitro volume raste, ne kako hitro margin raste). Razlika od profit-per-trade-scaling-maximizer (v8.13 ki skalira profit per trade z 4-phase progression) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo volume growth, ne €/trade scaling). Razlika od profit-per-day-scaling-maximizer (v8.08 ki skalira daily profit z requiredTradesPerDay) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo source volume growth, ne absolute €/dan scaling). Razlika od inventory-turnover-profit-growth-maximizer (v8.13 ki maksimizira growth turnover profit-a v €/mo) — ti MAKSIMIZIRAŠ VOLUME GROWTH RATE per source (%/mo per-source volume growth, ne €/mo turnover profit growth). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega profit-a v %/mo) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo kako hitro trade COUNT raste per source, ne kako hitro profit € raste). Razlika od deal-source-profit-per-day-maximizer (v8.11 ki maksimizira profit per day per source €/dan) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo volume growth, ne €/dan profit per source). Razlika od inventory-capital-efficiency-growth-maximizer (v8.12 ki maksimizira capital efficiency growth %/mo) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo source volume growth, ne capital efficiency %/mo growth). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira profit per cycle €/cycle) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo source volume growth, ne €/cycle profit). Razlika od deal-source-annual-return-maximizer (v8.10 ki maksimizira annualized return per source z benchmark) — ti MAKSIMIZIRAŠ VOLUME GROWTH RATE per source (%/mo, ne % annual return). Razlika od deal-source-profit-velocity-maximizer (v8.08 ki maksimizira velocity profit-a per source €/teden) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo, ne €/teden). Razlika od deal-source-profitability-analyzer (v8.06 ki analizira profitability per source) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo growth, ne profitability snapshot). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade per source €) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo volume growth, ne €/trade profit per source). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira net cash flow per source) — ti MAKSIMIZIRAŠ VOLUME GROWTH per source (%/mo volume growth rate, ne € net cash flow). Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin % per source) — ti MAKSIMIZIRAŠ VOLUME GROWTH RATE per source (%/mo kako hitro volume raste, ne absolutna margin %).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source, grouped by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.volumeGrowthMaximizationAction: ADD_MONITORS | EXPAND_CATEGORIES | INCREASE_SEARCH_FREQUENCY | CROSS_POST | OPTIMIZE_LISTING_QUALITY (gain 8/6/5/10/4 pp absolute uplift),
   - maximization.maximizedVolumeGrowthRate %/mo [-50, 100] (≥ current volumeGrowthRate, ≤ current + 30pp absolute uplift — anti-hallucination),
   - maximization.volumeGrowthUplift pp [0, 100] (improvement = maximized − current),
   - maximization.volumeGrowthLevers: 3-5 stringov (max 200 vsak, slovenski — specific volume growth levers per source),
   - (volumeGrowthProjection 3/6/12 month in volumeGrowthGrade se avtomatsko izračunata v backend-u — AI ne vrača teh),
2. summary: slovenski povzetek (max 500 znakov — poudari total current portfolio volume growth rate, total maximized portfolio volume growth rate, total uplift, best source).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "volumeGrowthMaximizationAction": "CROSS_POST",
        "maximizedVolumeGrowthRate": 18.0,
        "volumeGrowthUplift": 10.0,
        "volumeGrowthLevers": [
          "Cross-post Bolha listing-e na Vinted + mobile.de za +10pp/mo.",
          "AI cross-post optimizer za optimal platform selection per category.",
          "Avtomatiziraj cross-posting z AI listing-adapter."
        ]
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "volumeGrowthMaximizationAction": "ADD_MONITORS",
        "maximizedVolumeGrowthRate": 8.0,
        "volumeGrowthUplift": 5.0,
        "volumeGrowthLevers": [
          "Dodaj 3-5 novih iskalnih monitorjev z različnimi keywords.",
          "Vklopi AI keyword-expander za long-tail keywords.",
          "Avtomatiziraj monitor rotation."
        ]
      }
    }
  ],
  "summary": "2 source-a. Portfolio volume growth: 5.50%/mo → 13.00%/mo (+7.50pp uplift). Best: Bolha (8.00%/mo → 18.00%/mo)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const aiSourcesMap = new Map<string, NonNullable<AiResponse['sources']>[number]>();
        if (Array.isArray(parsed.sources)) {
          for (const ai of parsed.sources) {
            if (ai && typeof ai === 'object' && typeof ai.source === 'string') {
              aiSourcesMap.set(ai.source, ai);
            }
          }
        }

        const newEntries: SourceEntry[] = [];
        for (const det of entries) {
          const ai = aiSourcesMap.get(det.source);
          if (!ai || !ai.maximization) {
            newEntries.push(det);
            continue;
          }

          const aiMax = ai.maximization;
          const action = clampEnum(
            aiMax.volumeGrowthMaximizationAction,
            VALID_ACTION,
            det.maximization.volumeGrowthMaximizationAction,
          );

          // Anti-hallucination: maximized ∈ [current, min(current + 30pp, 100%/mo)]
          const minBound = Math.max(GROWTH_RATE_MIN, det.metrics.volumeGrowthRate);
          const maxBound = Math.min(GROWTH_RATE_MAX, det.metrics.volumeGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
          const maximizedVolumeGrowthRate = round2(clampNum(
            aiMax.maximizedVolumeGrowthRate,
            minBound, maxBound,
            det.maximization.maximizedVolumeGrowthRate,
          ));
          const volumeGrowthUplift = round2(clampNum(
            Math.max(0, maximizedVolumeGrowthRate - det.metrics.volumeGrowthRate),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          let volumeGrowthLevers = det.maximization.volumeGrowthLevers;
          if (Array.isArray(aiMax.volumeGrowthLevers) &&
              aiMax.volumeGrowthLevers.length >= 2) {
            const aiLevers: string[] = [];
            for (const l of aiMax.volumeGrowthLevers.slice(0, MAX_LEVERS)) {
              aiLevers.push(clampString(l, 200, 'Volume growth lever neopisan.'));
            }
            if (aiLevers.length >= 2) {
              volumeGrowthLevers = aiLevers;
            }
          }

          // Recompute projection with new maximizedVolumeGrowthRate
          const volumeGrowthProjection = buildVolumeGrowthProjection(
            det.metrics.currentMonthlyVolume,
            maximizedVolumeGrowthRate,
          );

          const volumeGrowthGrade = decideGrade(maximizedVolumeGrowthRate);

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              volumeGrowthMaximizationAction: action,
              maximizedVolumeGrowthRate,
              volumeGrowthUplift,
              volumeGrowthLevers,
              volumeGrowthProjection,
              volumeGrowthGrade,
            },
          });
        }

        if (newEntries.length === entries.length) {
          entries = newEntries;
        }

        // Rebuild portfolio
        portfolio = buildPortfolio(entries);
        summary = clampString(parsed.summary, 500, buildSummary(entries, portfolio));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-volume-growth-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { sources: entries, portfolio, summary });
    }

    return apiOk({
      ok: true,
      sources: entries,
      portfolio,
      summary,
      aiUsed,
    } satisfies DealSourceVolumeGrowthResponse);
  },
});

export const GET = dealSourceVolumeGrowthMaximizerHandler;
export const POST = dealSourceVolumeGrowthMaximizerHandler;
