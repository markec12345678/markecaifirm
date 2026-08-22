// v7.94 / v8.96.7-batch2: AI Revenue Stream Optimizer — AI optimizira REVENUE
// streams — identificira kateri viri prihodka (kategorije, platforme,
// deal tipi) so najbolj profitabilni in priporoča kako rebalancirati
// za maksimalni revenue. Fokus na REVENUE (ne le profit) — volume ×
// margin optimizacija.
//
// "Revenue: 15,000€/yr from 8 streams. Optimization score: 62/100.
// Scale elektronika×Bolha (+2,400€/yr). Enter moda×Vinted (+800€/yr).
// Diversify from 65% concentration."
//
// Razlika od buyer-revenue-forecaster (ki napove revenue per buyer)
// — ta optimizira REVENUE STREAMS per category × source. Razlika od
// capital-allocation-optimizer (v7.63 ki alocira capital per kategorija)
// — ta optimizira REVENUE preko stream rebalancing. Razlika od profit-
// stream-predictor (v7.70 ki napove profit stream pattern) — ta
// identificira KATERI revenue streams so najbolj profitabilni in
// kako rebalancirati. Razlika od deal-source-roi (ki gleda ROI per
// vir) — ta gleda REVENUE + margin + growth za optimalno diversifikacijo.
// Razlika od deal-source-profitability-analyzer (v7.89 ki gleda
// profitability per source) — ta optimizira REVENUE streams z
// diversifikacijo in concentration risk assessment. Razlika od
// portfolio-concentration-risk-analyzer (v7.65 ki gleda concentration
// risk) — ta optimizira REVENUE z diverzifikacijskim planom. Razlika
// od reinvestment-advisor (v7.57 ki svetuje reinvestment) — ta
// optimizira REVENUE preko stream rebalancing in scaling.
//
// GET+POST /api/ai/revenue-stream-optimizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RevenueStreamOptimizerInput {}

// --- Types ---------------------------------------------------------------

type StreamType = 'TOP_REVENUE' | 'HIGH_MARGIN' | 'HIGH_GROWTH' | 'DECLINING' | 'UNDERUTILIZED';
type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface Stream {
  category: string;
  source: string;
  revenue: number; // EUR
  profit: number; // EUR
  margin: number; // %
  volume: number; // trade count
  avgRevenuePerTrade: number; // EUR
  revenueGrowthRate: number; // % month-over-month
  streamType: StreamType;
}

interface CurrentRevenue {
  totalRevenue: number; // EUR
  totalProfit: number; // EUR
  avgMargin: number; // %
  revenueConcentration: number; // Herfindahl 0-10000
  streamCount: number;
}

interface StreamSummary {
  stream: string;
  revenue: number;
  share: number; // %
}

interface MarginStream {
  stream: string;
  margin: number;
  revenue: number;
}

interface GrowthStream {
  stream: string;
  growthRate: number;
  revenue: number;
}

interface DecliningStream {
  stream: string;
  declineRate: number;
  revenue: number;
}

interface UnderutilizedStream {
  stream: string;
  margin: number;
  volume: number;
  scalingPotential: string;
}

interface StreamAnalysis {
  topRevenueStreams: StreamSummary[];
  highMarginStreams: MarginStream[];
  highGrowthStreams: GrowthStream[];
  decliningStreams: DecliningStream[];
  underutilizedStreams: UnderutilizedStream[];
}

interface RevenueAction {
  action: string;
  stream: string;
  priority: ActionPriority;
  expectedRevenueLift: number; // EUR
  timeline: string;
}

interface StreamPriority {
  stream: string;
  rank: number;
  reason: string;
  expectedRevenue: number;
}

interface RevenueRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface Optimization {
  revenueOptimizationScore: number; // 0-100
  revenueMaximizationActions: RevenueAction[];
  projectedRevenue30d: number; // EUR
  projectedRevenue60d: number; // EUR
  projectedRevenue90d: number; // EUR
  revenueDiversificationPlan: string;
  revenueStreamPriorities: StreamPriority[];
  revenueRiskAssessment: RevenueRisk[];
  confidenceLevel: number; // 0-100
}

interface AiRevenueResponse {
  revenueDiversificationPlan?: string;
  revenueMaximizationActions?: Array<{
    action?: string;
    stream?: string;
    priority?: ActionPriority;
    expectedRevenueLift?: number;
    timeline?: string;
  }>;
  revenueStreamPriorities?: Array<{
    stream?: string;
    rank?: number;
    reason?: string;
    expectedRevenue?: number;
  }>;
  revenueRiskAssessment?: Array<{
    risk?: string;
    severity?: RiskSeverity;
    mitigation?: string;
  }>;
  projectedRevenue30d?: number;
  projectedRevenue60d?: number;
  projectedRevenue90d?: number;
  revenueOptimizationScore?: number;
  confidenceLevel?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const REVENUE_MIN_EUR = 0;
const REVENUE_MAX_EUR = 10_000_000;
const GROWTH_MIN = -100;
const GROWTH_MAX = 1000;
const MARGIN_MIN = -100;
const MARGIN_MAX = 200;
const CONCENTRATION_MIN = 0;
const CONCENTRATION_MAX = 10000;
const CONF_MIN = 0;
const CONF_MAX = 100;
const PROJECTION_MAX_FACTOR = 2.5; // max 2.5× current monthly revenue

const VALID_STREAM_TYPE: readonly StreamType[] = [
  'TOP_REVENUE', 'HIGH_MARGIN', 'HIGH_GROWTH', 'DECLINING', 'UNDERUTILIZED',
];
const VALID_PRIORITY: readonly ActionPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

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

// --- Trade row types ----------------------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  sellLocation: string;
  category: string;
}

// --- Stream aggregation -------------------------------------------------

interface StreamAgg {
  revenueSum: number;
  profitSum: number;
  costSum: number;
  count: number;
  monthlyRevenue: number[]; // 12 buckets
}

function newStreamAgg(): StreamAgg {
  return {
    revenueSum: 0,
    profitSum: 0,
    costSum: 0,
    count: 0,
    monthlyRevenue: Array.from({ length: MONTHS_12 }, () => 0),
  };
}

function streamKey(category: string, source: string): string {
  return `${category} × ${source}`;
}

function computeStreams(
  soldTrades: SoldTradeRow[],
  now: number,
): Map<string, StreamAgg> {
  const cutoff12m = now - HORIZON_12M;
  const monthStartMs = (t: number): number => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  const thisMonthStart = monthStartMs(now);
  const streams = new Map<string, StreamAgg>();

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0 || sellMs < cutoff12m) continue;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const revenue = sellPrice - sellFees;
    const cost = buyPrice + buyFees;
    const profit = revenue - cost;

    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    const src = (t.sellLocation || 'neznano').trim().toLowerCase() || 'neznano';
    const key = streamKey(cat, src);
    const s = streams.get(key) ?? newStreamAgg();
    s.revenueSum += revenue;
    s.profitSum += profit;
    s.costSum += cost;
    s.count += 1;

    // Monthly revenue bucket
    const sellMonthStart = monthStartMs(sellMs);
    const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
    const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
    if (bucketIdx >= 0 && bucketIdx <= 11) {
      s.monthlyRevenue[bucketIdx]! += revenue;
    }
    streams.set(key, s);
  }
  return streams;
}

function classifyStreamType(
  revenue: number,
  margin: number,
  growthRate: number,
  volume: number,
  thresholds: {
    topRevenuePct: number; // share % threshold for TOP_REVENUE
    highMarginPct: number; // margin % for HIGH_MARGIN
    highGrowthPct: number; // growth % for HIGH_GROWTH
    decliningPct: number; // growth % for DECLINING
    underutilizedMaxVol: number; // max volume for UNDERUTILIZED
  },
): StreamType {
  // Priority: DECLINING > HIGH_GROWTH > HIGH_MARGIN > TOP_REVENUE > UNDERUTILIZED
  // (worst signal first, then best signals)
  if (growthRate < thresholds.decliningPct) return 'DECLINING';
  if (growthRate > thresholds.highGrowthPct) return 'HIGH_GROWTH';
  if (margin > thresholds.highMarginPct && volume > 0) return 'HIGH_MARGIN';
  if (volume >= 3) return 'TOP_REVENUE';
  if (margin > thresholds.highMarginPct / 2 && volume <= thresholds.underutilizedMaxVol) return 'UNDERUTILIZED';
  return 'TOP_REVENUE';
}

function buildStreams(streamsAgg: Map<string, StreamAgg>): Stream[] {
  const totalRevenue = Array.from(streamsAgg.values()).reduce((s, x) => s + x.revenueSum, 0);
  const result: Stream[] = [];
  for (const [key, agg] of streamsAgg) {
    const [category, source] = key.split(' × ');
    const revenue = round0(agg.revenueSum);
    const profit = round0(agg.profitSum);
    const margin = agg.revenueSum > 0 ? (agg.profitSum / agg.revenueSum) * 100 : 0;
    const volume = agg.count;
    const avgRevenue = volume > 0 ? revenue / volume : 0;
    // Growth rate = slope of monthly revenue × 12 / avg monthly (annualized %)
    const monthlySlope = trendSlope(agg.monthlyRevenue);
    const avgMonthly = avg(agg.monthlyRevenue);
    const growthRate = avgMonthly > 0 ? (monthlySlope / avgMonthly) * 100 : 0;

    const share = totalRevenue > 0 ? revenue / totalRevenue : 0;
    const streamType = classifyStreamType(
      revenue,
      margin,
      growthRate,
      volume,
      {
        topRevenuePct: 0.10, // top 10%+ share
        highMarginPct: 25, // > 25% margin
        highGrowthPct: 10, // > 10%/mo growth
        decliningPct: -10, // < -10%/mo = declining
        underutilizedMaxVol: 3, // ≤ 3 trades = underutilized
      },
    );

    result.push({
      category,
      source,
      revenue,
      profit,
      margin: round0(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, margin))),
      volume,
      avgRevenuePerTrade: round0(avgRevenue),
      revenueGrowthRate: round0(Math.max(GROWTH_MIN, Math.min(GROWTH_MAX, growthRate))),
      streamType,
    });
  }

  // Sort by revenue descending
  result.sort((a, b) => b.revenue - a.revenue);
  return result;
}

// --- Current revenue + concentration -----------------------------------

function buildCurrent(streams: Stream[]): CurrentRevenue {
  const totalRevenue = streams.reduce((s, x) => s + x.revenue, 0);
  const totalProfit = streams.reduce((s, x) => s + x.profit, 0);
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  // Herfindahl index — sum of squared market shares × 10000
  let hhi = 0;
  for (const s of streams) {
    const share = totalRevenue > 0 ? s.revenue / totalRevenue : 0;
    hhi += Math.pow(share, 2);
  }
  hhi = round0(hhi * 10000);
  return {
    totalRevenue: round0(totalRevenue),
    totalProfit: round0(totalProfit),
    avgMargin: round0(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, avgMargin))),
    revenueConcentration: Math.max(CONCENTRATION_MIN, Math.min(CONCENTRATION_MAX, hhi)),
    streamCount: streams.length,
  };
}

// --- Stream analysis ----------------------------------------------------

function buildStreamAnalysis(streams: Stream[], current: CurrentRevenue): StreamAnalysis {
  const totalRevenue = current.totalRevenue;
  // Top revenue streams — by revenue (already sorted)
  const topRevenue: StreamSummary[] = streams.slice(0, 5).map((s) => ({
    stream: streamKey(s.category, s.source),
    revenue: s.revenue,
    share: round0(totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0),
  }));

  // High margin streams (with volume > 0) — sort by margin desc
  const highMargin: MarginStream[] = streams
    .filter((s) => s.volume > 0 && s.margin > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 5)
    .map((s) => ({
      stream: streamKey(s.category, s.source),
      margin: s.margin,
      revenue: s.revenue,
    }));

  // High growth streams — sort by growthRate desc
  const highGrowth: GrowthStream[] = streams
    .filter((s) => s.revenueGrowthRate > 0)
    .sort((a, b) => b.revenueGrowthRate - a.revenueGrowthRate)
    .slice(0, 5)
    .map((s) => ({
      stream: streamKey(s.category, s.source),
      growthRate: s.revenueGrowthRate,
      revenue: s.revenue,
    }));

  // Declining streams — sort by declineRate (most negative first)
  const declining: DecliningStream[] = streams
    .filter((s) => s.revenueGrowthRate < 0)
    .sort((a, b) => a.revenueGrowthRate - b.revenueGrowthRate)
    .slice(0, 5)
    .map((s) => ({
      stream: streamKey(s.category, s.source),
      declineRate: s.revenueGrowthRate,
      revenue: s.revenue,
    }));

  // Underutilized streams — high margin but low volume (scaling opportunity)
  const underutilized: UnderutilizedStream[] = streams
    .filter((s) => s.margin > 15 && s.volume <= 3)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 5)
    .map((s) => ({
      stream: streamKey(s.category, s.source),
      margin: s.margin,
      volume: s.volume,
      scalingPotential: `Skaliraj iz ${s.volume} na 5+ trgov/mesec → +${round0(s.avgRevenuePerTrade * 5)}€/mo`,
    }));

  return {
    topRevenueStreams: topRevenue,
    highMarginStreams: highMargin,
    highGrowthStreams: highGrowth,
    decliningStreams: declining,
    underutilizedStreams: underutilized,
  };
}

// --- Deterministic optimization ----------------------------------------

function buildDeterministicOptimization(
  streams: Stream[],
  analysis: StreamAnalysis,
  current: CurrentRevenue,
): { optimization: Optimization; summary: string } {
  // Revenue maximization actions
  const actions: RevenueAction[] = [];

  // Scale high-margin underutilized streams
  for (const u of analysis.underutilizedStreams.slice(0, 2)) {
    const lift = round0(Math.min(REVENUE_MAX_EUR, 200 + u.margin * 5));
    actions.push({
      action: `Skaliraj ${u.stream} — visoka marža (${u.margin}%) z nizkim volumenom (${u.volume}).`,
      stream: u.stream,
      priority: 'HIGH',
      expectedRevenueLift: lift,
      timeline: '2-4 tedne',
    });
  }

  // Enter high-growth streams
  for (const g of analysis.highGrowthStreams.slice(0, 2)) {
    const lift = round0(Math.min(REVENUE_MAX_EUR, 300 + g.growthRate * 20));
    actions.push({
      action: `Povečaj obseg v ${g.stream} — visoka growth rate (${g.growthRate}%/mo).`,
      stream: g.stream,
      priority: 'HIGH',
      expectedRevenueLift: lift,
      timeline: '1-3 mesece',
    });
  }

  // Exit declining streams
  for (const d of analysis.decliningStreams.slice(0, 1)) {
    actions.push({
      action: `Premakni kapital iz ${d.stream} — pada (${d.declineRate}%/mo).`,
      stream: d.stream,
      priority: 'CRITICAL',
      expectedRevenueLift: round0(Math.min(REVENUE_MAX_EUR, Math.abs(d.declineRate) * 30)),
      timeline: '1-2 tedna',
    });
  }

  // Optimize low-margin streams (pricing)
  const lowMarginStreams = streams.filter((s) => s.margin < 10 && s.volume > 2).slice(0, 2);
  for (const s of lowMarginStreams) {
    actions.push({
      action: `Optimiziraj pricing v ${streamKey(s.category, s.source)} — nizka marža (${s.margin}%).`,
      stream: streamKey(s.category, s.source),
      priority: 'MEDIUM',
      expectedRevenueLift: round0(Math.min(REVENUE_MAX_EUR, s.revenue * 0.05)),
      timeline: '2-4 tedne',
    });
  }

  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo — revenue streams so zdravi.',
      stream: 'all',
      priority: 'LOW',
      expectedRevenueLift: 0,
      timeline: 'tekoče',
    });
  }

  // Sort by expectedRevenueLift desc
  actions.sort((a, b) => b.expectedRevenueLift - a.expectedRevenueLift);

  // Revenue stream priorities — rank top 5
  const priorities: StreamPriority[] = streams.slice(0, 5).map((s, i) => {
    let reason = 'Top revenue stream.';
    if (s.streamType === 'HIGH_GROWTH') reason = 'Hitro rastoč stream — izkoriščaj momentum.';
    else if (s.streamType === 'HIGH_MARGIN') reason = 'Visoka marža — profitabilna kategorija.';
    else if (s.streamType === 'UNDERUTILIZED') reason = 'Visoka marža, nizek volumen — skaliraj.';
    else if (s.streamType === 'DECLINING') reason = 'Pada — premakni kapital.';
    return {
      stream: streamKey(s.category, s.source),
      rank: i + 1,
      reason,
      expectedRevenue: round0(s.revenue + s.avgRevenuePerTrade * 2),
    };
  });

  // Risk assessment
  const risks: RevenueRisk[] = [];
  if (current.revenueConcentration > 2500) {
    risks.push({
      risk: `Visoka revenue concentration (HHI ${current.revenueConcentration}) — preveč odvisen od enega stream-a.`,
      severity: 'HIGH',
      mitigation: 'Diverzificiraj v nove streams — zmanjšaj top share na <40%.',
    });
  } else if (current.revenueConcentration > 1800) {
    risks.push({
      risk: `Srednja revenue concentration (HHI ${current.revenueConcentration}).`,
      severity: 'MEDIUM',
      mitigation: 'Spremljaj trende in postopoma diverzificiraj.',
    });
  }
  if (analysis.decliningStreams.length > 0) {
    risks.push({
      risk: `${analysis.decliningStreams.length} revenue stream-ov pada — tveganje izgube prihodka.`,
      severity: 'HIGH',
      mitigation: 'Premakni kapital v rastoče streams.',
    });
  }
  if (current.streamCount < 3) {
    risks.push({
      risk: `Premajhno število revenue stream-ov (${current.streamCount}) — visoko koncentracijsko tveganje.`,
      severity: 'MEDIUM',
      mitigation: 'Vstopi v nove kategorije ali platforme.',
    });
  }
  if (risks.length === 0) {
    risks.push({
      risk: 'Brez specifičnih tveganj — revenue streams so dobro diverzificirani.',
      severity: 'LOW',
      mitigation: 'Vzdržuj monitoring in redno preverjaj stream trende.',
    });
  }

  // Revenue optimization score (0-100)
  // Higher = better optimized. Lower concentration + more streams + positive growth = higher
  let score = 50;
  // Lower concentration = higher score
  score += Math.max(-30, Math.min(20, (2500 - current.revenueConcentration) / 50));
  // More streams (up to 8) = higher score
  score += Math.min(15, Math.max(0, current.streamCount - 1) * 2);
  // No declining streams = higher
  if (analysis.decliningStreams.length === 0) score += 10;
  else score -= analysis.decliningStreams.length * 5;
  // Has underutilized opportunity = lower score (room to improve)
  if (analysis.underutilizedStreams.length > 0) score -= 5;
  score = round0(Math.max(SCORE_MIN, Math.min(SCORE_MAX, score)));

  // Projections (next 30/60/90 days) — clamp to [0, current × 2.5]
  const monthlyRevenue = current.totalRevenue / 12;
  const totalActionLift = actions.reduce((s, a) => s + a.expectedRevenueLift, 0);
  const projectedMonthlyMax = monthlyRevenue * PROJECTION_MAX_FACTOR;
  // Ramp up over 90 days — 30d gets 30% of lift, 60d gets 60%, 90d gets 100%
  const projectedRevenue30d = round0(
    Math.max(REVENUE_MIN_EUR, Math.min(projectedMonthlyMax, monthlyRevenue + (totalActionLift / 12) * 0.3)),
  );
  const projectedRevenue60d = round0(
    Math.max(REVENUE_MIN_EUR, Math.min(projectedMonthlyMax, monthlyRevenue + (totalActionLift / 12) * 0.6)),
  );
  const projectedRevenue90d = round0(
    Math.max(REVENUE_MIN_EUR, Math.min(projectedMonthlyMax, monthlyRevenue + (totalActionLift / 12) * 1.0)),
  );

  // Diversification plan
  const topShare = current.totalRevenue > 0 && streams.length > 0
    ? (streams[0]!.revenue / current.totalRevenue) * 100
    : 0;
  const diversificationPlan = topShare > 40
    ? `Trenutno top stream predstavlja ${round0(topShare)}% prihodka. Diverzificiraj v ${analysis.highGrowthStreams.length + analysis.underutilizedStreams.length} nove streams v naslednjih 90 dneh za zmanjšanje concentration risk.`
    : `Top stream predstavlja ${round0(topShare)}% — diverzifikacija je zdrava. Vzdržuj monitoring in iskanje novih streams.`;

  // Confidence
  let confidence = 30;
  confidence += Math.min(20, current.streamCount * 3);
  const totalTrades = streams.reduce((s, x) => s + x.volume, 0);
  confidence += Math.min(20, Math.min(50, totalTrades) * 0.4);
  if (analysis.highGrowthStreams.length > 0) confidence += 10;
  if (analysis.decliningStreams.length === 0) confidence += 5;
  confidence = round0(Math.max(CONF_MIN, Math.min(CONF_MAX, confidence)));

  const optimization: Optimization = {
    revenueOptimizationScore: score,
    revenueMaximizationActions: actions.slice(0, 6),
    projectedRevenue30d,
    projectedRevenue60d,
    projectedRevenue90d,
    revenueDiversificationPlan: diversificationPlan.slice(0, 400),
    revenueStreamPriorities: priorities.slice(0, 5),
    revenueRiskAssessment: risks.slice(0, 3),
    confidenceLevel: confidence,
  };

  const summary = [
    `Revenue: ${current.totalRevenue}€/yr from ${current.streamCount} streams.`,
    `Optimization score: ${score}/100.`,
    analysis.underutilizedStreams[0]
      ? `Scale ${analysis.underutilizedStreams[0]!.stream} (+${analysis.underutilizedStreams[0]!.margin}% margin).`
      : '',
    analysis.decliningStreams[0]
      ? `Exit ${analysis.decliningStreams[0]!.stream} (${analysis.decliningStreams[0]!.declineRate}%/mo).`
      : '',
    `Diversify from HHI ${current.revenueConcentration}.`,
  ].filter(Boolean).join(' ').slice(0, 400);

  return { optimization, summary };
}

// --- Handler -------------------------------------------------------------

const revenueStreamOptimizerHandler = withAiRoute<RevenueStreamOptimizerInput>({
  endpoint: '/api/ai/revenue-stream-optimizer',
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
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months
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
        sellLocation: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty state
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          totalRevenue: 0,
          totalProfit: 0,
          avgMargin: 0,
          revenueConcentration: 0,
          streamCount: 0,
        },
        streams: [],
        analysis: {
          topRevenueStreams: [],
          highMarginStreams: [],
          highGrowthStreams: [],
          decliningStreams: [],
          underutilizedStreams: [],
        },
        optimization: {
          revenueOptimizationScore: 0,
          revenueMaximizationActions: [],
          projectedRevenue30d: 0,
          projectedRevenue60d: 0,
          projectedRevenue90d: 0,
          revenueDiversificationPlan: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Stream Optimizer ni mogoč.',
          revenueStreamPriorities: [],
          revenueRiskAssessment: [],
          confidenceLevel: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Stream Optimizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Revenue Stream Optimizer ni mogoč.',
      });
    }

    // 2) Compute streams
    const streamsAgg = computeStreams(soldTrades, now);
    const streams = buildStreams(streamsAgg);

    // 3) Compute current revenue + concentration
    const current = buildCurrent(streams);

    // 4) Compute stream analysis
    const analysis = buildStreamAnalysis(streams, current);

    // 5) Build deterministic optimization (fallback)
    const det = buildDeterministicOptimization(streams, analysis, current);
    let optimization = det.optimization;
    let summary = det.summary;

    // 6) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `revenue-stream-optimizer:${currentMonth}`;
    const cached = getCachedAI<{ optimization: Optimization; summary: string }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        streams,
        analysis,
        optimization: cached.optimization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 7) AI prompt with grounding
    const promptData = {
      current,
      streams: streams.map((s) => ({
        ...s,
        stream: streamKey(s.category, s.source),
      })),
      analysis,
      deterministicBaseline: det.optimization,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        revenueMinEur: REVENUE_MIN_EUR, revenueMaxEur: REVENUE_MAX_EUR,
        growthMin: GROWTH_MIN, growthMax: GROWTH_MAX,
        marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
        confMin: CONF_MIN, confMax: CONF_MAX,
      },
    };

    const prompt = `Si AI "Revenue Stream Optimizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Optimiziraš REVENUE streams — identificiraš kateri viri prihodka (kategorije × platforme) so najbolj profitabilni in priporočaš kako rebalancirati za maksimalni revenue. Fokus na REVENUE (ne le profit) — volume × margin optimizacija. Razlika od buyer-revenue-forecaster (ki napove revenue per buyer) — ti optimiziraš REVENUE STREAMS per category × source.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD trgovin, grouped by category × source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. revenueOptimizationScore: 0-100 (kako dobro je revenue trenutno optimiziran — višji = bolje), ±10 od deterministic.
2. revenueMaximizationActions: 3-6 akcij { action (max 200), stream (max 100, format "kategorija × vir"), priority CRITICAL|HIGH|MEDIUM|LOW, expectedRevenueLift EUR [0, 10000000], timeline (max 50) }.
3. projectedRevenue30d/60d/90d: EUR, clamped [0, monthlyRevenue × 2.5], ramp up 30%/60%/100% of total action lift.
4. revenueDiversificationPlan: slovenski tekst (max 400 chars) — kako diverzificirati revenue streams.
5. revenueStreamPriorities: 3-5 ranked streams { stream, rank 1-5, reason (max 200), expectedRevenue EUR }.
6. revenueRiskAssessment: 2-3 tveganj { risk (max 200), severity LOW|MEDIUM|HIGH, mitigation (max 200) }.
7. confidenceLevel: 0-100, ±10 od deterministic.
8. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministic baseline.

VRNI LE JSON:
{
  "revenueOptimizationScore": 62,
  "revenueMaximizationActions": [
    { "action": "Skaliraj elektronika × Bolha — visoka marža.", "stream": "elektronika × bolha", "priority": "HIGH", "expectedRevenueLift": 2400, "timeline": "2-4 tedne" }
  ],
  "projectedRevenue30d": 1300,
  "projectedRevenue60d": 1450,
  "projectedRevenue90d": 1600,
  "revenueDiversificationPlan": "Diverzificiraj v 2 nove streams v 90 dneh za zmanjšanje concentration risk.",
  "revenueStreamPriorities": [
    { "stream": "elektronika × bolha", "rank": 1, "reason": "Top revenue stream z visoko maržo.", "expectedRevenue": 5000 }
  ],
  "revenueRiskAssessment": [
    { "risk": "Visoka concentration.", "severity": "HIGH", "mitigation": "Diverzificiraj v nove streams." }
  ],
  "confidenceLevel": 70,
  "summary": "Revenue: 15000€/yr from 8 streams. Optimization score: 62/100. Scale elektronika×Bolha (+2400€/yr). Diversify from 65% concentration."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiRevenueResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Revenue maximization actions
        const actions: RevenueAction[] = [];
        if (Array.isArray(parsed.revenueMaximizationActions)) {
          for (const a of parsed.revenueMaximizationActions.slice(0, 6)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, det.optimization.revenueMaximizationActions[0]?.action ?? 'Optimiziraj revenue stream.'),
              stream: clampString(a.stream, 100, det.optimization.revenueMaximizationActions[0]?.stream ?? 'all'),
              priority: clampEnum(a.priority, VALID_PRIORITY, det.optimization.revenueMaximizationActions[0]?.priority ?? 'MEDIUM'),
              expectedRevenueLift: round0(clampNum(a.expectedRevenueLift, REVENUE_MIN_EUR, REVENUE_MAX_EUR, det.optimization.revenueMaximizationActions[0]?.expectedRevenueLift ?? 0)),
              timeline: clampString(a.timeline, 50, det.optimization.revenueMaximizationActions[0]?.timeline ?? '2-4 tedne'),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of det.optimization.revenueMaximizationActions) actions.push(a);
        }

        // Revenue stream priorities
        const priorities: StreamPriority[] = [];
        if (Array.isArray(parsed.revenueStreamPriorities)) {
          for (const p of parsed.revenueStreamPriorities.slice(0, 5)) {
            if (!p || typeof p !== 'object') continue;
            priorities.push({
              stream: clampString(p.stream, 100, det.optimization.revenueStreamPriorities[0]?.stream ?? 'all'),
              rank: round0(clampNum(p.rank, 1, 10, det.optimization.revenueStreamPriorities[0]?.rank ?? 1)),
              reason: clampString(p.reason, 200, det.optimization.revenueStreamPriorities[0]?.reason ?? 'Top revenue stream.'),
              expectedRevenue: round0(clampNum(p.expectedRevenue, REVENUE_MIN_EUR, REVENUE_MAX_EUR, det.optimization.revenueStreamPriorities[0]?.expectedRevenue ?? 0)),
            });
          }
        }
        if (priorities.length === 0) {
          for (const p of det.optimization.revenueStreamPriorities) priorities.push(p);
        }

        // Risk assessment
        const risks: RevenueRisk[] = [];
        if (Array.isArray(parsed.revenueRiskAssessment)) {
          for (const r of parsed.revenueRiskAssessment.slice(0, 3)) {
            if (!r || typeof r !== 'object') continue;
            risks.push({
              risk: clampString(r.risk, 200, det.optimization.revenueRiskAssessment[0]?.risk ?? 'Revenue risk.'),
              severity: clampEnum(r.severity, VALID_SEVERITY, det.optimization.revenueRiskAssessment[0]?.severity ?? 'MEDIUM'),
              mitigation: clampString(r.mitigation, 200, det.optimization.revenueRiskAssessment[0]?.mitigation ?? 'Mitigiraj z diversifikacijo.'),
            });
          }
        }
        if (risks.length === 0) {
          for (const r of det.optimization.revenueRiskAssessment) risks.push(r);
        }

        // Score
        const detScore = det.optimization.revenueOptimizationScore;
        const revenueOptimizationScore = round0(
          Math.max(SCORE_MIN, Math.min(SCORE_MAX,
            detScore + Math.max(-10, Math.min(10,
              (Number(parsed.revenueOptimizationScore ?? detScore)) - detScore)))),
        );

        // Confidence
        const detConf = det.optimization.confidenceLevel;
        const confidenceLevel = round0(
          Math.max(CONF_MIN, Math.min(CONF_MAX,
            detConf + Math.max(-10, Math.min(10,
              (Number(parsed.confidenceLevel ?? detConf)) - detConf)))),
        );

        // Projections — clamp to [0, monthlyRevenue × 2.5]
        const monthlyRevenue = current.totalRevenue / 12;
        const projectionMax = monthlyRevenue * PROJECTION_MAX_FACTOR;
        const projectedRevenue30d = round0(
          clampNum(parsed.projectedRevenue30d, REVENUE_MIN_EUR, projectionMax, det.optimization.projectedRevenue30d),
        );
        const projectedRevenue60d = round0(
          clampNum(parsed.projectedRevenue60d, REVENUE_MIN_EUR, projectionMax, det.optimization.projectedRevenue60d),
        );
        const projectedRevenue90d = round0(
          clampNum(parsed.projectedRevenue90d, REVENUE_MIN_EUR, projectionMax, det.optimization.projectedRevenue90d),
        );

        // Diversification plan
        const revenueDiversificationPlan = clampString(
          parsed.revenueDiversificationPlan,
          400,
          det.optimization.revenueDiversificationPlan,
        );

        optimization = {
          revenueOptimizationScore,
          revenueMaximizationActions: actions.slice(0, 6),
          projectedRevenue30d,
          projectedRevenue60d,
          projectedRevenue90d,
          revenueDiversificationPlan,
          revenueStreamPriorities: priorities.slice(0, 5),
          revenueRiskAssessment: risks.slice(0, 3),
          confidenceLevel,
        };
        summary = clampString(parsed.summary, 400, det.summary);
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/revenue-stream-optimizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { optimization, summary });
    }

    return apiOk({
      ok: true,
      current,
      streams,
      analysis,
      optimization,
      summary,
      aiUsed,
    });
  },
});

export const GET = revenueStreamOptimizerHandler;
export const POST = revenueStreamOptimizerHandler;
