// v7.87: AI Deal Source Trend Analyzer — AI analizira TREND PATTERNS per
// deal source — kateri viri pridobivajo momentum in kateri upadajo, ter
// napove future source performance. Razlika od deal-source-performance-tracker
// (v7.85 ki track-a metrics) — ta analizira TRENDS in dela predictions.
// "Bolha: GROWING (momentum 78, +12%/mo). Vinted: DECLINING (-8%/mo).
// Action: scale up Bolha, diversify."
//
// Razlika od deal-source-roi (ki da current snapshot ROI per source) — ta
// analizira TREND acceleration per source. Razlika od deal-source-comparison-matrix
// (v7.70 ki primerja trenutne atribute source-ov) — ta gleda TIME-SERIES
// momentum + lifecycle stage. Razlika od deal-source-intelligence (v7.82 AI
// ki da source intelligence) — ta je TREND-focused z momentum + lifecycle
// prediction. Razlika od deal-source-performance-tracker (v7.85 pure DB ki
// track-a performance metrics) — ta je AI ki ANALYZIRA trends in PREDICTS
// future source performance z lifecycleStage in recommendedSourceAction.
// Razlika od deal-source-quality-tracker (v7.86 ki track-a quality trends)
// — ta analizira MOMENTUM (acceleration) in lifecycle (EMERGING/GROWING/
// MATURE/DECLINING) ne quality.
//
// GET+POST /api/ai/deal-source-trend-analyzer
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

type SourceMomentum = 'GAINING_MOMENTUM' | 'STABLE' | 'LOSING_MOMENTUM';
type LifecycleStage = 'EMERGING' | 'GROWING' | 'MATURE' | 'DECLINING';
type SourceAction = 'SCALE_UP' | 'MAINTAIN' | 'DIVERSIFY' | 'SCALE_DOWN' | 'EXIT';
type ConcentrationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

interface SourceTrends {
  monthlyProfitTrend: number; // EUR per month slope
  monthlyROITrend: number; // % per month slope
  monthlyVolumeTrend: number; // trades per month slope
  momentumScore: number; // 0-100
  sourceMomentum: SourceMomentum;
}

interface SourceAnalysis {
  trendAnalysis: string;
  predictedPerformance30d: string;
  trendConfidence: number; // 0-100
  sourceLifecycleStage: LifecycleStage;
  recommendedSourceAction: SourceAction;
}

interface SourceTrendEntry {
  source: string;
  displayName: string;
  trends: SourceTrends;
  analysis: SourceAnalysis;
}

interface PortfolioAssessment {
  sourceDiversificationScore: number; // 0-100
  dominantSource: string | null;
  concentrationRisk: ConcentrationRisk;
  diversificationAdvice: string;
  sourceRiskAssessment: string;
}

interface AiTrendResponse {
  sourcesPatch?: unknown;
  portfolio?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MOMENTUM_MIN = 0;
const MOMENTUM_MAX = 100;
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;
const DIVERSIFICATION_MIN = 0;
const DIVERSIFICATION_MAX = 100;

const VALID_MOMENTUM: readonly SourceMomentum[] = [
  'GAINING_MOMENTUM',
  'STABLE',
  'LOSING_MOMENTUM',
];
const VALID_LIFECYCLE: readonly LifecycleStage[] = [
  'EMERGING',
  'GROWING',
  'MATURE',
  'DECLINING',
];
const VALID_ACTION: readonly SourceAction[] = [
  'SCALE_UP',
  'MAINTAIN',
  'DIVERSIFY',
  'SCALE_DOWN',
  'EXIT',
];
const VALID_RISK: readonly ConcentrationRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

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
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// --- Sold trade row with linked listing/source --------------------------

interface SoldTradeWithSource {
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  listing: {
    monitor: { source: string } | null;
  } | null;
}

// Per-source per-month aggregation
interface SrcMonthAgg {
  monthKey: string;
  monthMs: number;
  invested: number;
  profit: number;
  trades: number;
}

interface SrcAggregate {
  monthlyMap: Map<string, SrcMonthAgg>; // monthKey → agg
  displayName: string;
  sourceRaw: string;
}

// Classify source momentum based on composite slope
function classifySourceMomentum(
  profitSlope: number,
  roiSlope: number,
  volumeSlope: number,
): SourceMomentum {
  // Composite momentum: profit + ROI + volume (each scaled by typical magnitude)
  // Profit ±100€/mo, ROI ±2%/mo, volume ±1 trade/mo are significant
  const composite =
    profitSlope / 100 + roiSlope / 2 + volumeSlope;
  if (composite > 0.5) return 'GAINING_MOMENTUM';
  if (composite < -0.5) return 'LOSING_MOMENTUM';
  return 'STABLE';
}

// Momentum score 0-100 based on trend acceleration
// Composite of profit slope, ROI slope, volume slope + trend consistency
function computeMomentumScore(
  profitSlope: number,
  roiSlope: number,
  volumeSlope: number,
  monthlyProfits: number[],
): number {
  // Normalize each slope to 0-100 scale around midpoint 50
  // Profit slope: ±200€/mo = ±50 points
  const profitScore = Math.max(0, Math.min(100, 50 + (profitSlope / 200) * 50));
  // ROI slope: ±5%/mo = ±50 points
  const roiScore = Math.max(0, Math.min(100, 50 + (roiSlope / 5) * 50));
  // Volume slope: ±3 trades/mo = ±50 points
  const volumeScore = Math.max(0, Math.min(100, 50 + (volumeSlope / 3) * 50));

  // Trend consistency: lower stddev = higher consistency bonus
  // (consistent growth is more sustainable than volatile growth)
  const vol = stddev(monthlyProfits);
  const consistencyBonus = Math.max(0, Math.min(10, 10 - vol / 100));

  const score =
    profitScore * 0.35 + roiScore * 0.35 + volumeScore * 0.2 + consistencyBonus * 0.1;

  return round0(Math.max(MOMENTUM_MIN, Math.min(MOMENTUM_MAX, score)));
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Determine lifecycle stage from momentum + historical volume + age
function classifyLifecycleStage(
  momentum: SourceMomentum,
  momentumScore: number,
  totalTrades: number,
  monthsActive: number,
): LifecycleStage {
  // EMERGING: < 3 months active AND gaining momentum
  if (monthsActive < 3 && momentum === 'GAINING_MOMENTUM') return 'EMERGING';
  // GROWING: gaining momentum + relatively young OR very high momentum
  if (momentum === 'GAINING_MOMENTUM' && (monthsActive < 8 || momentumScore > 70))
    return 'GROWING';
  // DECLINING: losing momentum OR very low score
  if (momentum === 'LOSING_MOMENTUM' || momentumScore < 30) return 'DECLINING';
  // MATURE: stable, established, decent volume
  if (totalTrades >= 5 && monthsActive >= 6) return 'MATURE';
  // Default: MATURE if stable, otherwise GROWING if momentum positive
  return momentumScore >= 50 ? 'MATURE' : 'GROWING';
}

// Recommended action based on lifecycle + momentum
function recommendSourceAction(
  lifecycle: LifecycleStage,
  momentum: SourceMomentum,
  momentumScore: number,
): SourceAction {
  if (lifecycle === 'EMERGING' && momentum === 'GAINING_MOMENTUM') return 'SCALE_UP';
  if (lifecycle === 'GROWING' && momentumScore >= 65) return 'SCALE_UP';
  if (lifecycle === 'MATURE' && momentum === 'GAINING_MOMENTUM') return 'SCALE_UP';
  if (lifecycle === 'DECLINING' && momentumScore < 25) return 'EXIT';
  if (lifecycle === 'DECLINING') return 'SCALE_DOWN';
  if (momentum === 'LOSING_MOMENTUM') return 'SCALE_DOWN';
  // Stable mature source → diversify if score mid-range, otherwise maintain
  if (lifecycle === 'MATURE' && momentumScore < 60) return 'DIVERSIFY';
  return 'MAINTAIN';
}

// --- Deterministic analysis ---------------------------------------------

function buildDeterministicTrendAnalysis(
  source: string,
  displayName: string,
  trends: SourceTrends,
  lifecycle: LifecycleStage,
  totalTrades: number,
  monthsActive: number,
): string {
  const { monthlyProfitTrend, monthlyROITrend, monthlyVolumeTrend, momentumScore, sourceMomentum } = trends;
  const parts: string[] = [];
  parts.push(
    `${displayName}: ${sourceMomentum} (momentum ${momentumScore}/100).`,
  );
  parts.push(`Profit trend ${monthlyProfitTrend >= 0 ? '+' : ''}${round2(monthlyProfitTrend)}€/mo, ROI trend ${monthlyROITrend >= 0 ? '+' : ''}${round2(monthlyROITrend)}%/mo, volume ${monthlyVolumeTrend >= 0 ? '+' : ''}${round2(monthlyVolumeTrend)} trgovin/mo.`);
  parts.push(`Lifecycle: ${lifecycle} (${monthsActive} mesecev aktivnosti, ${totalTrades} trgovin).`);
  if (sourceMomentum === 'GAINING_MOMENTUM') {
    parts.push('Trend je vzdržen — vir pridobiva traction, vendar preveri ali je rast vzdržna ali driven by anomalije (npr. en large profit trade).');
  } else if (sourceMomentum === 'LOSING_MOMENTUM') {
    parts.push('Trend upada — vir izgublja traction. Preveri ali je vzrok competition, seasonality ali quality drop in premakni fokus na stabilnejše vire.');
  } else {
    parts.push('Trend je stabilen — vir ohranja konsistentno performance, vendar brez izrazite rasti. Diversifikacija priporočena za portfolio balance.');
  }
  return parts.join(' ').slice(0, 600);
}

function buildDeterministicPredictedPerformance(
  trends: SourceTrends,
  lifecycle: LifecycleStage,
): string {
  const { monthlyProfitTrend, monthlyROITrend, monthlyVolumeTrend, momentumScore } = trends;
  // Project 30d: trend × ~1 month
  const projProfit = round0(monthlyProfitTrend * 1);
  const projROI = round1(monthlyROITrend * 1);
  const projVolume = round1(monthlyVolumeTrend * 1);
  const direction = momentumScore >= 55 ? 'nadaljnja rast' : momentumScore <= 45 ? 'nadaljni upad' : 'stabilizacija';
  let stabilityNote = '';
  if (lifecycle === 'MATURE') {
    stabilityNote = ' Vir je MATURE — rast se bo verjetno stabilizirala, ni veliko prostora za ekspanzijo.';
  } else if (lifecycle === 'DECLINING') {
    stabilityNote = ' Vir DECLINING — trend bo verjetno nadaljeval, razmisli o izstopu ali premiku fokusa.';
  } else if (lifecycle === 'EMERGING') {
    stabilityNote = ' Vir EMERGING — high uncertainty, trend je lahko volatile.';
  } else if (lifecycle === 'GROWING') {
    stabilityNote = ' Vir GROWING — trend naj bi se nadaljeval če so pogoji ohranjeni.';
  }
  return `Projecija 30 dni: profit ${projProfit >= 0 ? '+' : ''}${projProfit}€, ROI ${projROI >= 0 ? '+' : ''}${projROI}%, volume ${projVolume >= 0 ? '+' : ''}${projVolume} trgovin. Pričakujemo ${direction}.${stabilityNote}`.slice(0, 400);
}

// Compute trend confidence 0-100 from data sample + trend strength
function computeTrendConfidence(
  totalTrades: number,
  monthsActive: number,
  momentumScore: number,
): number {
  let confidence = 30;
  if (monthsActive >= 12) confidence += 25;
  else if (monthsActive >= 6) confidence += 15;
  else if (monthsActive >= 3) confidence += 8;
  if (totalTrades >= 20) confidence += 25;
  else if (totalTrades >= 10) confidence += 15;
  else if (totalTrades >= 3) confidence += 8;
  // Strong momentum (either direction) = more confident prediction
  if (momentumScore >= 75 || momentumScore <= 25) confidence += 10;
  else if (momentumScore >= 60 || momentumScore <= 40) confidence += 5;
  return round0(Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, confidence)));
}

// --- Portfolio assessment ------------------------------------------------

function computeDiversificationScore(
  sourceTradeCounts: Array<{ source: string; count: number }>,
  totalTrades: number,
): number {
  if (sourceTradeCounts.length === 0 || totalTrades === 0) return 0;
  // Compute Herfindahl-Hirschman Index (HHI) — lower = more diversified
  // Then map HHI 0-1 (1 = monopoly) to score 0-100 (100 = perfectly diversified)
  let hhi = 0;
  for (const s of sourceTradeCounts) {
    const share = s.count / totalTrades;
    hhi += share * share;
  }
  // HHI range: 1/N (perfect diversity) to 1 (single source)
  // Convert to 0-100 score: (1 - hhi) / (1 - 1/N) × 100
  const n = sourceTradeCounts.length;
  if (n <= 1) return 0;
  const minHhi = 1 / n;
  const normalized = (1 - hhi) / (1 - minHhi);
  return round0(Math.max(DIVERSIFICATION_MIN, Math.min(DIVERSIFICATION_MAX, normalized * 100)));
}

function classifyConcentrationRisk(diversificationScore: number, sourceCount: number): ConcentrationRisk {
  if (sourceCount <= 1) return 'HIGH';
  if (diversificationScore < 40) return 'HIGH';
  if (diversificationScore < 65) return 'MEDIUM';
  return 'LOW';
}

function buildDeterministicPortfolio(
  sources: Array<{
    source: string;
    displayName: string;
    trends: SourceTrends;
    totalTrades: number;
  }>,
): PortfolioAssessment {
  const totalTrades = sources.reduce((s, x) => s + x.totalTrades, 0);
  const sourceCounts = sources.map((s) => ({ source: s.source, count: s.totalTrades }));
  const diversificationScore = computeDiversificationScore(sourceCounts, totalTrades);
  const concentrationRisk = classifyConcentrationRisk(diversificationScore, sources.length);

  // Dominant source = highest trade count
  let dominantSource: string | null = null;
  if (sources.length > 0) {
    const sorted = [...sources].sort((a, b) => b.totalTrades - a.totalTrades);
    const top = sorted[0]!;
    if (top.totalTrades > 0) {
      const share = top.totalTrades / Math.max(1, totalTrades);
      if (share >= 0.5) dominantSource = top.displayName;
    }
  }

  // Diversification advice
  let diversificationAdvice: string;
  if (sources.length === 0) {
    diversificationAdvice = 'Ni SOLD trgovin v zadnjih 12 mesecih — trend analiza ni mogoča. Začni z eno platformo in dodaj več virov za diversifikacijo.';
  } else if (concentrationRisk === 'HIGH') {
    diversificationAdvice = `Portfolio je preveč koncentriran (diversifikacija ${diversificationScore}/100, dominanten vir: ${dominantSource ?? 'neznan'}). Priporočljivo je dodati 1-2 nove vire za zmanjšanje odvisnosti.`;
  } else if (concentrationRisk === 'MEDIUM') {
    diversificationAdvice = `Diversifikacija ${diversificationScore}/100 (MEDIUM). Premakni del kapitala v nove vire za boljši portfolio balance in zmanjšanje source-specific risk.`;
  } else {
    diversificationAdvice = `Diversifikacija ${diversificationScore}/100 (LOW risk). Portfolio je dobro razpršen čez ${sources.length} virov. Vzdržuj trenutno distribucijo.`;
  }

  // Source risk assessment
  let sourceRiskAssessment: string;
  const gaining = sources.filter((s) => s.trends.sourceMomentum === 'GAINING_MOMENTUM').length;
  const losing = sources.filter((s) => s.trends.sourceMomentum === 'LOSING_MOMENTUM').length;
  if (sources.length === 0) {
    sourceRiskAssessment = 'Brez podatkov o virih — risk assessment ni mogoč.';
  } else if (losing > gaining && losing > sources.length / 2) {
    sourceRiskAssessment = `Tveganje: ${losing}/${sources.length} virov izgublja momentum. Portfolio je v declininh phase — razmisli o rebalancing ali iskanje novih virov.`;
  } else if (gaining > 0 && gaining >= sources.length / 2) {
    sourceRiskAssessment = `Tveganje: ${gaining}/${sources.length} virov pridobiva momentum. Portfolio je v growth phase — izkoristi priložnosti a pazljivo, da ne postane preveč koncentriran.`;
  } else {
    sourceRiskAssessment = `Tveganje: mešanica trendov (${gaining} gaining, ${losing} losing, ${sources.length - gaining - losing} stable). Portfolio je v tranziciji — monitor naslednje 30 dni za bolj jasen signal.`;
  }

  return {
    sourceDiversificationScore: diversificationScore,
    dominantSource,
    concentrationRisk,
    diversificationAdvice: diversificationAdvice.slice(0, 500),
    sourceRiskAssessment: sourceRiskAssessment.slice(0, 500),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceTrendAnalyzer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceTrendAnalyzer(req);
}

async function handleDealSourceTrendAnalyzer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-trend-analyzer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for monitor.source)
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
        listing: {
          select: {
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
          sourceRaw,
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
          trades: 0,
        };
        agg.monthlyMap.set(monthKey, monthAgg);
      }

      const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
      const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = proceeds - invested;
      monthAgg.invested += invested;
      monthAgg.profit += profit;
      monthAgg.trades += 1;
    }

    // Empty state
    if (sourceMap.size === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        portfolio: {
          sourceDiversificationScore: 0,
          dominantSource: null,
          concentrationRisk: 'HIGH',
          diversificationAdvice:
            'Ni SOLD trgovin z linked listing v zadnjih 12 mesecih — Deal Source Trend Analyzer ni mogoč.',
          sourceRiskAssessment:
            'Brez podatkov o virih — risk assessment ni mogoč. Začni zbirati SOLD trgovine z linked listing-i.',
        },
        summary:
          'Ni SOLD trgovin z linked listing v zadnjih 12 mesecih — Deal Source Trend Analyzer ni mogoč.',
        aiUsed: false,
        message:
          'Ni SOLD trgovin z linked listing v zadnjih 12 mesecih — Deal Source Trend Analyzer ni mogoč.',
      });
    }

    // 3) Compute per-source trend metrics (deterministic)
    const sourceAggs: Array<{
      source: string;
      displayName: string;
      trends: SourceTrends;
      analysis: SourceAnalysis;
      totalTrades: number;
      monthsActive: number;
    }> = [];

    for (const [source, agg] of sourceMap.entries()) {
      const sortedMonths = Array.from(agg.monthlyMap.values()).sort(
        (a, b) => a.monthMs - b.monthMs,
      );

      const monthlyProfits: number[] = [];
      const monthlyRois: number[] = [];
      const monthlyVolumes: number[] = [];
      let totalInvested = 0;
      let totalProfit = 0;
      let totalTrades = 0;

      for (const m of sortedMonths) {
        monthlyProfits.push(m.profit);
        const roi = m.invested > 0 ? (m.profit / m.invested) * 100 : 0;
        monthlyRois.push(roi);
        monthlyVolumes.push(m.trades);
        totalInvested += m.invested;
        totalProfit += m.profit;
        totalTrades += m.trades;
      }

      const profitSlope = trendSlope(monthlyProfits);
      const roiSlope = trendSlope(monthlyRois);
      const volumeSlope = trendSlope(monthlyVolumes);
      const sourceMomentum = classifySourceMomentum(profitSlope, roiSlope, volumeSlope);
      const momentumScore = computeMomentumScore(
        profitSlope,
        roiSlope,
        volumeSlope,
        monthlyProfits,
      );

      const trends: SourceTrends = {
        monthlyProfitTrend: round2(profitSlope),
        monthlyROITrend: round2(roiSlope),
        monthlyVolumeTrend: round2(volumeSlope),
        momentumScore,
        sourceMomentum,
      };

      const monthsActive = sortedMonths.length;
      const lifecycle = classifyLifecycleStage(
        sourceMomentum,
        momentumScore,
        totalTrades,
        monthsActive,
      );
      const action = recommendSourceAction(lifecycle, sourceMomentum, momentumScore);
      const trendConfidence = computeTrendConfidence(totalTrades, monthsActive, momentumScore);

      const trendAnalysis = buildDeterministicTrendAnalysis(
        source,
        agg.displayName,
        trends,
        lifecycle,
        totalTrades,
        monthsActive,
      );
      const predictedPerformance30d = buildDeterministicPredictedPerformance(trends, lifecycle);

      sourceAggs.push({
        source,
        displayName: agg.displayName,
        trends,
        analysis: {
          trendAnalysis,
          predictedPerformance30d,
          trendConfidence,
          sourceLifecycleStage: lifecycle,
          recommendedSourceAction: action,
        },
        totalTrades,
        monthsActive,
      });
    }

    // Sort by momentumScore desc
    sourceAggs.sort((a, b) => b.trends.momentumScore - a.trends.momentumScore);

    // 4) Compute portfolio assessment (deterministic)
    const detPortfolio = buildDeterministicPortfolio(
      sourceAggs.map((s) => ({
        source: s.source,
        displayName: s.displayName,
        trends: s.trends,
        totalTrades: s.totalTrades,
      })),
    );

    // 5) Build response (start from deterministic)
    const sources: SourceTrendEntry[] = sourceAggs.map((s) => ({
      source: s.source,
      displayName: s.displayName,
      trends: s.trends,
      analysis: s.analysis,
    }));

    let portfolio = detPortfolio;
    let finalSummary = buildDeterministicSummary(sources, detPortfolio);

    // 6) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now);
    const monthKey = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const cacheKey = `deal-source-trend-analyzer:${monthKey}`;
    const cached = getCachedAI<{
      sourcesPatch: Array<{
        source: string;
        trendAnalysis: string;
        predictedPerformance30d: string;
        trendConfidence: number;
        sourceLifecycleStage: LifecycleStage;
        recommendedSourceAction: SourceAction;
      }>;
      portfolio: PortfolioAssessment;
      summary: string;
    }>(cacheKey);
    if (cached) {
      // Apply AI patch to sources
      const patchMap = new Map(cached.sourcesPatch.map((p) => [p.source, p]));
      for (const s of sources) {
        const p = patchMap.get(s.source);
        if (p) {
          s.analysis.trendAnalysis = p.trendAnalysis;
          s.analysis.predictedPerformance30d = p.predictedPerformance30d;
          s.analysis.trendConfidence = Math.max(
            CONFIDENCE_MIN,
            Math.min(CONFIDENCE_MAX, p.trendConfidence),
          );
          s.analysis.sourceLifecycleStage = p.sourceLifecycleStage;
          s.analysis.recommendedSourceAction = p.recommendedSourceAction;
        }
      }
      return NextResponse.json({
        ok: true,
        sources,
        portfolio: cached.portfolio,
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
      totalSources: sources.length,
      totalTrades: sourceAggs.reduce((s, x) => s + x.totalTrades, 0),
      sources: sources.map((s) => ({
        source: s.source,
        displayName: s.displayName,
        trends: s.trends,
        analysis: s.analysis,
        totalTrades: sourceAggs.find((x) => x.source === s.source)!.totalTrades,
        monthsActive: sourceAggs.find((x) => x.source === s.source)!.monthsActive,
      })),
      deterministicPortfolio: detPortfolio,
    };

    const prompt = `Si AI "Deal Source Trend Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Analiziraš TREND PATTERNS per deal source — kateri viri pridobivajo momentum in kateri upadajo, ter napoveš future source performance z lifecycle stage in recommended action.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sourcesPatch: array of { source (max 60), trendAnalysis (max 600, slovenski), predictedPerformance30d (max 400, slovenski), trendConfidence: 0-100, sourceLifecycleStage: EMERGING|GROWING|MATURE|DECLINING, recommendedSourceAction: SCALE_UP|MAINTAIN|DIVERSIFY|SCALE_DOWN|EXIT }
   - Za vsak vir izboljšaj trendAnalysis z AI vpogledom (glede na momentum + lifecycle + history).
   - predictedPerformance30d: opis pričakovane performance v naslednjih 30 dneh (z utemeljitvijo trend-a).
   - trendConfidence: ±15 od deterministične, clamped [0, 100].
   - sourceLifecycleStage: validiraj proti enum (EMERGING = <3m + gaining, GROWING = gaining + young, MATURE = stable + established, DECLINING = losing momentum).
   - recommendedSourceAction: validiraj proti enum (SCALE_UP = gaining + high momentum, MAINTAIN = stable + mature, DIVERSIFY = stable + needs diversification, SCALE_DOWN = losing, EXIT = declining + very low).
2. portfolio: {
   - sourceDiversificationScore: 0-100, ±10 od deterministične, clamped [0, 100]
   - dominantSource: string | null (ime dominantnega vira če je ≥50% trgovin, drugače null)
   - concentrationRisk: LOW|MEDIUM|HIGH (LOW = score≥65, MEDIUM = 40-65, HIGH = <40)
   - diversificationAdvice: slovenski nasvet (max 500 znakov) — kateri vire dodati/zmanjšati za boljši portfolio balance
   - sourceRiskAssessment: slovenski assessment (max 500 znakov) — ali vir postaja preveč dominanten ali prešibek, kaj tveganj obstajajo
}
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične.

VRNI LE JSON:
{
  "sourcesPatch": [
    {
      "source": "bolha",
      "trendAnalysis": "Bolha: GAINING_MOMENTUM (78/100). Profit +150€/mo, ROI +2.5%/mo, volume +1.2/mo. Lifecycle: GROWING...",
      "predictedPerformance30d": "30d projection: profit +150€, ROI +2.5%, volume +1.2. Trend naj bi se nadaljeval...",
      "trendConfidence": 75,
      "sourceLifecycleStage": "GROWING",
      "recommendedSourceAction": "SCALE_UP"
    }
  ],
  "portfolio": {
    "sourceDiversificationScore": 65,
    "dominantSource": "Bolha",
    "concentrationRisk": "MEDIUM",
    "diversificationAdvice": "Premakni del kapitala v Vinted in Avtonet za zmanjšanje odvisnosti od Bolha...",
    "sourceRiskAssessment": "Bolha postaja dominanten (55% trgovin) — preveri ali je rast vzdržna ali driven by anomalije..."
  },
  "summary": "Analiziranih 4 virov. Bolha: GROWING (78). Vinted: DECLINING (-8%/mo). Action: scale up Bolha, diversify."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiTrendResponse | null;

      if (parsed && typeof parsed === 'object') {
        // 1) sourcesPatch — apply AI analysis with anti-hallucination
        if (Array.isArray(parsed.sourcesPatch)) {
          const patchMap = new Map<string, {
            trendAnalysis: string;
            predictedPerformance30d: string;
            trendConfidence: number;
            sourceLifecycleStage: LifecycleStage;
            recommendedSourceAction: SourceAction;
          }>();
          for (const p of parsed.sourcesPatch as unknown[]) {
            const pr = p as Record<string, unknown>;
            if (!pr || typeof pr !== 'object') continue;
            const src = clampString(pr.source, 60, '');
            if (!src) continue;
            const existing = sources.find((s) => s.source === src);
            if (!existing) continue;

            const trendAnalysis = clampString(pr.trendAnalysis, 600, existing.analysis.trendAnalysis);
            const predictedPerformance30d = clampString(
              pr.predictedPerformance30d,
              400,
              existing.analysis.predictedPerformance30d,
            );
            const detConfidence = existing.analysis.trendConfidence;
            const confRaw = clampNumber(
              pr.trendConfidence,
              CONFIDENCE_MIN,
              CONFIDENCE_MAX,
              detConfidence,
            );
            // ±15 from deterministic
            const trendConfidence = round0(
              Math.max(
                CONFIDENCE_MIN,
                Math.min(
                  CONFIDENCE_MAX,
                  detConfidence + Math.max(-15, Math.min(15, confRaw - detConfidence)),
                ),
              ),
            );
            const sourceLifecycleStage = clampEnum(
              pr.sourceLifecycleStage,
              VALID_LIFECYCLE,
              existing.analysis.sourceLifecycleStage,
            );
            const recommendedSourceAction = clampEnum(
              pr.recommendedSourceAction,
              VALID_ACTION,
              existing.analysis.recommendedSourceAction,
            );

            patchMap.set(src, {
              trendAnalysis,
              predictedPerformance30d,
              trendConfidence,
              sourceLifecycleStage,
              recommendedSourceAction,
            });
          }
          for (const s of sources) {
            const p = patchMap.get(s.source);
            if (p) {
              s.analysis.trendAnalysis = p.trendAnalysis;
              s.analysis.predictedPerformance30d = p.predictedPerformance30d;
              s.analysis.trendConfidence = p.trendConfidence;
              s.analysis.sourceLifecycleStage = p.sourceLifecycleStage;
              s.analysis.recommendedSourceAction = p.recommendedSourceAction;
            }
          }
        }

        // 2) portfolio override (with anti-hallucination)
        if (parsed.portfolio && typeof parsed.portfolio === 'object') {
          const p = parsed.portfolio as Record<string, unknown>;
          const detScore = detPortfolio.sourceDiversificationScore;
          const aiScore = clampNumber(
            p.sourceDiversificationScore,
            DIVERSIFICATION_MIN,
            DIVERSIFICATION_MAX,
            detScore,
          );
          portfolio.sourceDiversificationScore = round0(
            Math.max(
              DIVERSIFICATION_MIN,
              Math.min(
                DIVERSIFICATION_MAX,
                detScore + Math.max(-10, Math.min(10, aiScore - detScore)),
              ),
            ),
          );

          if (typeof p.dominantSource === 'string' && p.dominantSource.trim()) {
            portfolio.dominantSource = clampString(p.dominantSource, 60, detPortfolio.dominantSource ?? '');
            if (!portfolio.dominantSource) portfolio.dominantSource = detPortfolio.dominantSource;
          } else if (p.dominantSource === null) {
            portfolio.dominantSource = null;
          }

          portfolio.concentrationRisk = clampEnum(
            p.concentrationRisk,
            VALID_RISK,
            detPortfolio.concentrationRisk,
          );
          // Re-evaluate concentration risk if score changed significantly
          if (portfolio.sourceDiversificationScore < 40 && sources.length > 1) {
            portfolio.concentrationRisk = 'HIGH';
          } else if (portfolio.sourceDiversificationScore >= 65) {
            portfolio.concentrationRisk = 'LOW';
          }

          portfolio.diversificationAdvice = clampString(
            p.diversificationAdvice,
            500,
            detPortfolio.diversificationAdvice,
          );
          portfolio.sourceRiskAssessment = clampString(
            p.sourceRiskAssessment,
            500,
            detPortfolio.sourceRiskAssessment,
          );
        }

        // 3) summary
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, buildDeterministicSummary(sources, portfolio));
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-trend-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        sourcesPatch: sources.map((s) => ({
          source: s.source,
          trendAnalysis: s.analysis.trendAnalysis,
          predictedPerformance30d: s.analysis.predictedPerformance30d,
          trendConfidence: s.analysis.trendConfidence,
          sourceLifecycleStage: s.analysis.sourceLifecycleStage,
          recommendedSourceAction: s.analysis.recommendedSourceAction,
        })),
        portfolio,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      sources,
      portfolio,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-trend-analyzer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// Deterministic summary
function buildDeterministicSummary(
  sources: SourceTrendEntry[],
  portfolio: PortfolioAssessment,
): string {
  if (sources.length === 0) {
    return 'Ni SOLD trgovin z linked listing v zadnjih 12 mesecih — Deal Source Trend Analyzer ni mogoč.';
  }
  const top = sources[0]!;
  const gaining = sources.filter((s) => s.trends.sourceMomentum === 'GAINING_MOMENTUM').length;
  const losing = sources.filter((s) => s.trends.sourceMomentum === 'LOSING_MOMENTUM').length;
  const parts: string[] = [
    `Analiziranih ${sources.length} virov.`,
    `Top: ${top.displayName} (${top.trends.momentumScore}/100, ${top.analysis.sourceLifecycleStage}).`,
    `${gaining} gaining, ${losing} losing momentum.`,
    `Diversifikacija ${portfolio.sourceDiversificationScore}/100 (${portfolio.concentrationRisk} risk).`,
  ];
  return parts.join(' ').slice(0, 400);
}
