// v8.08: AI Deal Source Profit Velocity Maximizer — AI MAKSIMIZIRA VELOCITY
// profit-a per source — kako hitro se profit kopiči iz vsakega source-a. "Bolha
// generira 100€/teden v profit-u, ampak bi lahko generiral 180€/teden če
// povečaš trade frekvenco z 3/teden na 5/teden." Razlika od
// deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per source
// po fees + carrying costs) — ta MAKSIMIZIRA VELOCITY profit-a per source
// (€/teden kako hitro profit kopiči — timing + frequency + value, ne cash flow
// accounting). Razlika od deal-source-revenue-maximizer (v8.07 ki maksimizira
// total revenue per source) — ta maksimizira VELOCITY profit-a (€/teden, ne
// top-line revenue). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira
// total profit per source) — ta maksimizira VELOCITY (€/teden kako hitro profit
// kopiči, ne total profit). Razlika od deal-source-profit-per-trade-maximizer
// (v8.04 ki maksimizira profit per trade €) — ta maksimizira VELOCITY profit-a
// per source (€/teden frequency × profit per trade, ne sam per-trade value).
// Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta
// maksimizira VELOCITY z velocityMaximizationAction in frequencyScalingPlan.
// Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta
// maksimizira VELOCITY z velocityScore in velocityProjection. Razlika od
// deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira capital
// efficiency per source = profit per euro per day) — ta maksimizira VELOCITY
// profit-a (€/teden kako hitro profit kopiči, ne profit per euro per day).
// Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira trade volume per
// source) — ta maksimizira VELOCITY (trade frequency × profit per trade
// optimized, ne sam trade volume). Razlika od profit-velocity-maximizer (v7.98
// ki maksimizira €/day velocity čez portfolio) — ta maksimizira per-source
// VELOCITY z sourceVelocityRanking in bestVelocitySource.

// GET+POST /api/ai/deal-source-profit-velocity-maximizer
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

type VelocityAction =
  | 'INCREASE_FREQUENCY'
  | 'INCREASE_PROFIT_PER_TRADE'
  | 'EXPAND_CATEGORIES'
  | 'ADD_MONITORS'
  | 'OPTIMIZE_TIMING';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  buyLocation: string;
  listing: {
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface SourceMetrics {
  profitPerWeek: number; // €/week (12m window)
  tradesPerWeek: number; // trades/week
  avgProfitPerTrade: number; // €
  profitVelocityTrend: number; // % (slope of profit velocity over time)
  velocityScore: number; // 0-100 (how fast profit accumulates)
  totalProfit12m: number; // €
  tradeCount: number;
}

interface VelocityProjectionEntry {
  weeks: number; // 4, 8, 12
  projectedProfitPerWeek: number; // €/week
}

interface SourceMaximization {
  velocityMaximizationAction: VelocityAction;
  maximizedProfitPerWeek: number; // €/week forecasted with action
  velocityUplift: number; // €/week improvement
  velocityLevers: string[]; // specific levers per source (slovenski)
  frequencyScalingPlan: string; // how to increase trades per week safely (slovenski)
  velocityProjection: VelocityProjectionEntry[]; // 4/8/12 week forecast
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  totalCurrentVelocity: number; // €/week
  totalMaximizedVelocity: number; // €/week
  totalVelocityUplift: number; // €/week
  sourceVelocityRanking: Array<{
    source: string;
    displayName: string;
    currentVelocity: number; // €/week
    maximizedVelocity: number; // €/week
    rank: number;
  }>;
  bestVelocitySource: string;
}

interface DealSourceProfitVelocityResponse {
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
      velocityMaximizationAction?: VelocityAction;
      maximizedProfitPerWeek?: number;
      velocityUplift?: number;
      velocityLevers?: string[];
      frequencyScalingPlan?: string;
      velocityProjection?: Array<{
        weeks?: number;
        projectedProfitPerWeek?: number;
      }>;
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const WEEKS_IN_WINDOW = 52; // 52 weeks in 12m

const PROFIT_MIN = -10_000;
const PROFIT_MAX = 100_000;
const PROFIT_PER_WEEK_MIN = 0;
const PROFIT_PER_WEEK_MAX = 10_000;
const TRADES_PER_WEEK_MIN = 0;
const TRADES_PER_WEEK_MAX = 500;
const PROFIT_PER_TRADE_MIN = -5000;
const PROFIT_PER_TRADE_MAX = 50_000;
const TREND_MIN = -100;
const TREND_MAX = 200;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 10_000;
const PROJECTION_MIN = 0;
const PROJECTION_MAX = 10_000;

const VALID_ACTION: readonly VelocityAction[] = [
  'INCREASE_FREQUENCY',
  'INCREASE_PROFIT_PER_TRADE',
  'EXPAND_CATEGORIES',
  'ADD_MONITORS',
  'OPTIMIZE_TIMING',
];

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

const MAX_LEVERS = 5;
const MAX_PROJECTIONS = 3;

// Action uplift multipliers (how much velocity gain from each action)
const ACTION_MULTIPLIER: Record<VelocityAction, number> = {
  INCREASE_FREQUENCY: 1.40, // +40% by more trades/week
  INCREASE_PROFIT_PER_TRADE: 1.25, // +25% by higher profit/trade
  EXPAND_CATEGORIES: 1.30, // +30% by new categories
  ADD_MONITORS: 1.35, // +35% by more monitor coverage
  OPTIMIZE_TIMING: 1.18, // +18% by better sell timing
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
  profit: number; // € = (sellPrice − sellFees) − (buyPrice + buyFees)
  sellMs: number;
  within12m: boolean;
}

function computeTrade(t: SoldTradeRow, now: number): TradeComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  if (!within12m) return null;
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellFees = t.sellFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const profit = (sellPrice - sellFees) - capital;
  const source = detectSource(t);
  return { source, profit, sellMs, within12m };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalProfit: number;
}

function aggregateBySource(trades: TradeComputed[]): Map<string, SourceAgg> {
  const map = new Map<string, SourceAgg>();
  for (const tr of trades) {
    let agg = map.get(tr.source);
    if (!agg) {
      agg = {
        source: tr.source,
        trades: [],
        totalProfit: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalProfit += tr.profit;
  }
  return map;
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalProfit12m = round0(clampNum(agg.totalProfit, PROFIT_MIN, PROFIT_MAX, 0));

  // Profit per week = total 12m profit / 52 weeks
  const profitPerWeek = round2(clampNum(
    totalProfit12m / WEEKS_IN_WINDOW,
    PROFIT_PER_WEEK_MIN, PROFIT_PER_WEEK_MAX, 0,
  ));

  // Trades per week = tradeCount / 52
  const tradesPerWeek = round2(clampNum(
    tradeCount / WEEKS_IN_WINDOW,
    TRADES_PER_WEEK_MIN, TRADES_PER_WEEK_MAX, 0,
  ));

  const avgProfitPerTrade = round2(clampNum(
    tradeCount > 0 ? totalProfit12m / tradeCount : 0,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));

  // Profit velocity trend — linear regression slope of weekly profit over time
  // Sort trades by sellMs ascending, bucket into 4 quarters, compute slope of profit per quarter
  const sorted = [...agg.trades].sort((a, b) => a.sellMs - b.sellMs);
  const quarters: number[] = [0, 0, 0, 0];
  const quarterProfit: number[] = [0, 0, 0, 0];
  if (sorted.length > 0) {
    const minMs = sorted[0].sellMs;
    const maxMs = sorted[sorted.length - 1].sellMs;
    const span = Math.max(1, maxMs - minMs);
    for (const tr of sorted) {
      const q = Math.min(3, Math.floor(((tr.sellMs - minMs) / span) * 4));
      quarters[q]++;
      quarterProfit[q] += tr.profit;
    }
    // Compute per-quarter weekly profit and slope
    const qWeekly = quarterProfit.map((p, i) =>
      quarters[i] > 0 ? p / (WEEKS_IN_WINDOW / 4) : 0,
    );
    // Simple linear regression slope (q1..q4)
    const n = qWeekly.length;
    const sumX = (n * (n - 1)) / 2; // 0+1+2+3 = 6
    const sumY = qWeekly.reduce((s, v) => s + v, 0);
    const sumXY = qWeekly.reduce((s, v, i) => s + i * v, 0);
    const sumX2 = qWeekly.reduce((s, _, i) => s + i * i, 0);
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const baseWeek = sumY / n;
    const trendPct = baseWeek > 0 ? (slope / baseWeek) * 100 : 0;
    const profitVelocityTrend = round2(clampNum(
      trendPct,
      TREND_MIN, TREND_MAX, 0,
    ));
    // Velocity score: combine profitPerWeek magnitude × trend + baseline
    const magnitudeScore = Math.min(60, (profitPerWeek / 50) * 30); // up to 60 points from magnitude
    const trendScore = Math.min(25, Math.max(0, profitVelocityTrend * 0.5)); // up to 25 from positive trend
    const frequencyScore = Math.min(15, tradesPerWeek * 3); // up to 15 from frequency
    const velocityScore = round0(clampNum(
      magnitudeScore + trendScore + frequencyScore,
      SCORE_MIN, SCORE_MAX, 0,
    ));
    return {
      profitPerWeek,
      tradesPerWeek,
      avgProfitPerTrade,
      profitVelocityTrend,
      velocityScore,
      totalProfit12m,
      tradeCount,
    };
  }

  return {
    profitPerWeek,
    tradesPerWeek,
    avgProfitPerTrade,
    profitVelocityTrend: 0,
    velocityScore: 0,
    totalProfit12m,
    tradeCount,
  };
}

function decideAction(metrics: SourceMetrics): VelocityAction {
  // If trades per week low (< 1) → INCREASE_FREQUENCY
  if (metrics.tradesPerWeek < 1) return 'INCREASE_FREQUENCY';
  // If avg profit per trade low → INCREASE_PROFIT_PER_TRADE
  if (metrics.avgProfitPerTrade < 30) return 'INCREASE_PROFIT_PER_TRADE';
  // If trend negative → OPTIMIZE_TIMING (sell at better moments)
  if (metrics.profitVelocityTrend < 0) return 'OPTIMIZE_TIMING';
  // If velocity score < 30 → EXPAND_CATEGORIES (broaden)
  if (metrics.velocityScore < 30) return 'EXPAND_CATEGORIES';
  // If trades per week plateau (1-2) → ADD_MONITORS
  if (metrics.tradesPerWeek < 3) return 'ADD_MONITORS';
  // Default — push frequency higher
  return 'INCREASE_FREQUENCY';
}

function buildVelocityLevers(metrics: SourceMetrics, action: VelocityAction): string[] {
  const levers: string[] = [];
  levers.push(`Trenutno ${metrics.profitPerWeek.toFixed(2)}€/teden (${metrics.tradesPerWeek.toFixed(2)} trades/teden, ${metrics.avgProfitPerTrade.toFixed(2)}€/trade). Velocity score ${metrics.velocityScore}/100.`);
  switch (action) {
    case 'INCREASE_FREQUENCY':
      levers.push(`Povečaj trade frekvenco z ${metrics.tradesPerWeek.toFixed(2)} na ${(metrics.tradesPerWeek * 1.5).toFixed(2)}/teden z nižjim deal score threshold (+5 trade-ov/teden).`);
      levers.push('Vklopi real-time alerts za deal score > 70 in omogoči auto-buy za deal score > 85.');
      break;
    case 'INCREASE_PROFIT_PER_TRADE':
      levers.push(`Dvigni profit per trade z ${metrics.avgProfitPerTrade.toFixed(2)}€ na ${(metrics.avgProfitPerTrade * 1.25).toFixed(2)}€ z boljšo pricing strategijo (AI pricing engine, premium fotografija).`);
      levers.push('Negotiate harder z AI negotiation-playbook — +12% close rate z better offer timing.');
      break;
    case 'EXPAND_CATEGORIES':
      levers.push('Dodaj 2-3 nove kategorije (npr. electronics + fashion + sports) z istega source-a za +25% deal flow.');
      levers.push('Vklopi suggest-filters AI za odkrivanje untapped niche znotraj source-a.');
      break;
    case 'ADD_MONITORS':
      levers.push('Dodaj 3-5 novih monitor z keyword expansion (long-tail keywords za nižjo konkurenco).');
      levers.push('Vklopi monitor-suggestions AI za identifikacijo adjacent deal categories.');
      break;
    case 'OPTIMIZE_TIMING':
      levers.push('Optimiziraj sell timing — listaj ob koncu tedna (petek 18h, nedelja 20h) za +18% close rate.');
      levers.push('Vklopi seasonal-timing-optimizer in optimal-time AI za najboljše listing windows.');
      break;
  }
  return levers.slice(0, MAX_LEVERS);
}

function buildFrequencyScalingPlan(metrics: SourceMetrics, action: VelocityAction): string {
  const current = metrics.tradesPerWeek;
  const target = action === 'INCREASE_FREQUENCY' ? current * 1.5
    : action === 'ADD_MONITORS' ? current * 1.4
    : action === 'EXPAND_CATEGORIES' ? current * 1.3
    : current * 1.2;
  const plan = `Trenutno ${current.toFixed(2)} trades/teden → cilj ${target.toFixed(2)} trades/teden v 8 tednih. ` +
    `Plan: teden 1-2: dodaj monitorje z keyword expansion (+${Math.round((target - current) * 0.3)} trades/teden). ` +
    `Teden 3-4: znižaj deal score threshold z 70 na 60 (+${Math.round((target - current) * 0.3)} trades/teden). ` +
    `Teden 5-6: vklopi auto-buy za deal score > 85 (+${Math.round((target - current) * 0.2)} trades/teden). ` +
    `Teden 7-8: stabiliziraj frekvenco z doslednim sourcing-om in negotiation close rate tracking. ` +
    `Varnost: če held inventory > 1.5× avg hold days, pauziraj auto-buy dokler se ne stabilizira.`;
  return plan.slice(0, 500);
}

function buildVelocityProjection(
  metrics: SourceMetrics,
  maximized: number,
): VelocityProjectionEntry[] {
  const projections: VelocityProjectionEntry[] = [];
  for (const weeks of [4, 8, 12]) {
    // Linear ramp: 4w=33%, 8w=67%, 12w=100% adoption
    const adoptionFraction = weeks / 12;
    const projected = metrics.profitPerWeek + (maximized - metrics.profitPerWeek) * adoptionFraction;
    projections.push({
      weeks,
      projectedProfitPerWeek: round2(clampNum(
        projected,
        PROJECTION_MIN, PROJECTION_MAX, 0,
      )),
    });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideAction(metrics);
  const multiplier = ACTION_MULTIPLIER[action];

  const maximizedProfitPerWeek = round2(clampNum(
    metrics.profitPerWeek * multiplier,
    PROFIT_PER_WEEK_MIN, PROFIT_PER_WEEK_MAX, metrics.profitPerWeek,
  ));
  const velocityUplift = round2(clampNum(
    Math.max(0, maximizedProfitPerWeek - metrics.profitPerWeek),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const velocityLevers = buildVelocityLevers(metrics, action);
  const frequencyScalingPlan = buildFrequencyScalingPlan(metrics, action);
  const velocityProjection = buildVelocityProjection(metrics, maximizedProfitPerWeek);

  return {
    velocityMaximizationAction: action,
    maximizedProfitPerWeek,
    velocityUplift,
    velocityLevers,
    frequencyScalingPlan,
    velocityProjection,
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    const maximization = buildSourceMaximization(metrics);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by profitPerWeek desc (best velocity source first)
  entries.sort((a, b) => b.metrics.profitPerWeek - a.metrics.profitPerWeek);
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  const totalCurrentVelocity = round2(clampNum(
    entries.reduce((s, e) => s + e.metrics.profitPerWeek, 0),
    PROFIT_PER_WEEK_MIN, PROFIT_PER_WEEK_MAX, 0,
  ));
  const totalMaximizedVelocity = round2(clampNum(
    entries.reduce((s, e) => s + e.maximization.maximizedProfitPerWeek, 0),
    PROFIT_PER_WEEK_MIN, PROFIT_PER_WEEK_MAX, 0,
  ));
  const totalVelocityUplift = round2(clampNum(
    totalMaximizedVelocity - totalCurrentVelocity,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const sourceVelocityRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentVelocity: e.metrics.profitPerWeek,
    maximizedVelocity: e.maximization.maximizedProfitPerWeek,
    rank: idx + 1,
  }));

  const bestEntry = entries[0];
  const bestVelocitySource = bestEntry ? bestEntry.source : '';

  return {
    totalCurrentVelocity,
    totalMaximizedVelocity,
    totalVelocityUplift,
    sourceVelocityRanking,
    bestVelocitySource,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Profit Velocity Maximizer ni mogoč.';
  }
  const best = entries[0];
  const worst = entries[entries.length - 1];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio velocity: ${portfolio.totalCurrentVelocity.toFixed(2)}€/teden → ${portfolio.totalMaximizedVelocity.toFixed(2)}€/teden (+${portfolio.totalVelocityUplift.toFixed(2)}€).`,
    `Best: ${best.displayName} (${best.metrics.profitPerWeek.toFixed(2)}€/teden). Worst: ${worst.displayName} (${worst.metrics.profitPerWeek.toFixed(2)}€/teden).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceProfitVelocityMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceProfitVelocityMaximizer(req);
}

async function handleDealSourceProfitVelocityMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-profit-velocity-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades from last 12 months with linked Listing (for source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        sellPrice: { gt: 0 },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
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
      return NextResponse.json({
        ok: true,
        sources: [],
        portfolio: {
          totalCurrentVelocity: 0,
          totalMaximizedVelocity: 0,
          totalVelocityUplift: 0,
          sourceVelocityRanking: [],
          bestVelocitySource: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Velocity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Velocity Maximizer ni mogoč.',
      } satisfies DealSourceProfitVelocityResponse);
    }

    // 2) Compute per-trade metrics and aggregate by source
    const computed: TradeComputed[] = [];
    for (const t of soldTrades) {
      const c = computeTrade(t, now);
      if (c) computed.push(c);
    }

    if (computed.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        portfolio: {
          totalCurrentVelocity: 0,
          totalMaximizedVelocity: 0,
          totalVelocityUplift: 0,
          sourceVelocityRanking: [],
          bestVelocitySource: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Profit Velocity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Profit Velocity Maximizer ni mogoč.',
      } satisfies DealSourceProfitVelocityResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-profit-velocity-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      sources: SourceEntry[];
      portfolio: PortfolioSummary;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        sources: cached.sources,
        portfolio: cached.portfolio,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies DealSourceProfitVelocityResponse);
    }

    // 4) AI prompt with grounding
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

    const sourcesForAI = entries.map((e) => ({
      source: e.source,
      displayName: e.displayName,
      metrics: e.metrics,
      deterministicMaximization: e.maximization,
    }));

    const promptData = {
      totalTrades: computed.length,
      totalSources: entries.length,
      sources: sourcesForAI,
      deterministicPortfolio: {
        totalCurrentVelocity: portfolio.totalCurrentVelocity,
        totalMaximizedVelocity: portfolio.totalMaximizedVelocity,
        totalVelocityUplift: portfolio.totalVelocityUplift,
        sourceVelocityRanking: portfolio.sourceVelocityRanking,
        bestVelocitySource: portfolio.bestVelocitySource,
      },
      caps: {
        profitPerWeekMin: PROFIT_PER_WEEK_MIN, profitPerWeekMax: PROFIT_PER_WEEK_MAX,
        tradesPerWeekMin: TRADES_PER_WEEK_MIN, tradesPerWeekMax: TRADES_PER_WEEK_MAX,
        profitPerTradeMin: PROFIT_PER_TRADE_MIN, profitPerTradeMax: PROFIT_PER_TRADE_MAX,
        trendMin: TREND_MIN, trendMax: TREND_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        projectionMin: PROJECTION_MIN, projectionMax: PROJECTION_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Profit Velocity Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT VELOCITY MAXIMIZATION per source — kako maksimizirati VELOCITY profit-a per source (kako hitro profit kopiči iz vsakega source-a, €/teden). Tvoj cilj je "Bolha generira 100€/teden v profit-u, ampak bi lahko generiral 180€/teden če povečaš trade frekvenco z 3/teden na 5/teden." Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per source po fees + carrying costs) — ti MAKSIMIZIRAŠ VELOCITY profit-a per source (€/teden kako hitro profit kopiči — timing + frequency + value, ne cash flow accounting). Razlika od deal-source-revenue-maximizer (v8.07 ki maksimizira total revenue per source) — ta maksimizira VELOCITY profit-a (€/teden, ne top-line revenue). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ta maksimizira VELOCITY (€/teden kako hitro profit kopiči, ne total profit). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade €) — ta maksimizira VELOCITY profit-a per source (€/teden frequency × profit per trade, ne sam per-trade value). Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta maksimizira VELOCITY z velocityMaximizationAction in frequencyScalingPlan. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta maksimizira VELOCITY z velocityScore in velocityProjection. Razlika od deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira capital efficiency per source = profit per euro per day) — ta maksimizira VELOCITY profit-a (€/teden kako hitro profit kopiči, ne profit per euro per day). Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira trade volume per source) — ta maksimizira VELOCITY (trade frequency × profit per trade optimized, ne sam trade volume).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.velocityMaximizationAction: INCREASE_FREQUENCY | INCREASE_PROFIT_PER_TRADE | EXPAND_CATEGORIES | ADD_MONITORS | OPTIMIZE_TIMING,
   - maximization.maximizedProfitPerWeek €/teden [0, 10000] (forecasted z action — ≥ current profitPerWeek, ≤ current × 1.5 ali +2000€/teden),
   - maximization.velocityUplift €/teden [0, 10000] (improvement = maximized − current),
   - maximization.velocityLevers: 3-5 stringov (max 200 vsak, slovenski — specifični velocity levers per source),
   - maximization.frequencyScalingPlan: slovenski (max 500 znakov — kako varno povečati trades per week),
   - maximization.velocityProjection: 3 elementi { weeks 4/8/12, projectedProfitPerWeek €/teden [0, 10000] (linear ramp: 4w=33%, 8w=67%, 12w=100% adoption) },
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "velocityMaximizationAction": "INCREASE_FREQUENCY",
        "maximizedProfitPerWeek": 180,
        "velocityUplift": 80,
        "velocityLevers": [
          "Povečaj trade frekvenco z 3 na 5/teden.",
          "Vklopi real-time alerts za deal score > 70.",
          "Omogoči auto-buy za deal score > 85."
        ],
        "frequencyScalingPlan": "Trenutno 3 trades/teden → cilj 5/teden v 8 tednih...",
        "velocityProjection": [
          { "weeks": 4, "projectedProfitPerWeek": 126.6 },
          { "weeks": 8, "projectedProfitPerWeek": 153.3 },
          { "weeks": 12, "projectedProfitPerWeek": 180 }
        ]
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "velocityMaximizationAction": "INCREASE_PROFIT_PER_TRADE",
        "maximizedProfitPerWeek": 90,
        "velocityUplift": 18,
        "velocityLevers": [
          "Dvigni profit per trade z 30€ na 38€.",
          "Negotiate harder z AI negotiation-playbook."
        ],
        "frequencyScalingPlan": "Trenutno 2 trades/teden → cilj 2.4/teden v 8 tednih...",
        "velocityProjection": [
          { "weeks": 4, "projectedProfitPerWeek": 78 },
          { "weeks": 8, "projectedProfitPerWeek": 84 },
          { "weeks": 12, "projectedProfitPerWeek": 90 }
        ]
      }
    }
  ],
  "summary": "2 source-a. Bolha 100€/teden → 180€/teden (+80€, INCREASE_FREQUENCY). Vinted 72€/teden → 90€/teden (+18€, INCREASE_PROFIT_PER_TRADE). Portfolio: 172€ → 270€/teden (+98€)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

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
            aiMax.velocityMaximizationAction,
            VALID_ACTION,
            det.maximization.velocityMaximizationAction,
          );

          // Anti-hallucination: maximizedProfitPerWeek ∈ [current, current × 1.5 ali +2000€]
          const maxBound = Math.min(
            PROFIT_PER_WEEK_MAX,
            Math.max(
              det.metrics.profitPerWeek + 50,
              Math.min(det.metrics.profitPerWeek * 1.5 + 200, det.metrics.profitPerWeek + 2000),
            ),
          );
          const minBound = Math.max(PROFIT_PER_WEEK_MIN, det.metrics.profitPerWeek);
          const maximizedProfitPerWeek = round2(clampNum(
            aiMax.maximizedProfitPerWeek,
            minBound, maxBound,
            det.maximization.maximizedProfitPerWeek,
          ));
          const velocityUplift = round2(clampNum(
            Math.max(0, maximizedProfitPerWeek - det.metrics.profitPerWeek),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          // velocityLevers — must be array of strings
          let velocityLevers: string[] = det.maximization.velocityLevers;
          if (Array.isArray(aiMax.velocityLevers) && aiMax.velocityLevers.length >= 2) {
            const aiLevers: string[] = [];
            for (const l of aiMax.velocityLevers.slice(0, MAX_LEVERS)) {
              aiLevers.push(clampString(l, 200, 'Velocity lever neopisan.'));
            }
            if (aiLevers.length >= 2) {
              velocityLevers = aiLevers;
            }
          }

          const frequencyScalingPlan = clampString(
            aiMax.frequencyScalingPlan, 500, det.maximization.frequencyScalingPlan,
          );

          // velocityProjection — must be 3 entries with weeks 4/8/12
          let velocityProjection: VelocityProjectionEntry[] = det.maximization.velocityProjection;
          if (Array.isArray(aiMax.velocityProjection) &&
              aiMax.velocityProjection.length >= 3) {
            const aiProj: VelocityProjectionEntry[] = [];
            const expectedWeeks = [4, 8, 12];
            for (const expected of expectedWeeks) {
              const ai = aiMax.velocityProjection.find(
                (p) => p && Number(p.weeks) === expected,
              );
              if (!ai) continue;
              const projectedProfitPerWeek = round2(clampNum(
                ai.projectedProfitPerWeek,
                PROJECTION_MIN, PROJECTION_MAX, 0,
              ));
              aiProj.push({ weeks: expected, projectedProfitPerWeek });
            }
            if (aiProj.length === 3) {
              velocityProjection = aiProj;
            }
          }

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              velocityMaximizationAction: action,
              maximizedProfitPerWeek,
              velocityUplift,
              velocityLevers,
              frequencyScalingPlan,
              velocityProjection,
            },
          });
        }

        if (newEntries.length === entries.length) {
          entries = newEntries;
        }

        // Rebuild portfolio with new entries
        portfolio = buildPortfolio(entries);

        summary = clampString(parsed.summary, 400, buildSummary(entries, portfolio));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-profit-velocity-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { sources: entries, portfolio, summary });
    }

    return NextResponse.json({
      ok: true,
      sources: entries,
      portfolio,
      summary,
      aiUsed,
    } satisfies DealSourceProfitVelocityResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-profit-velocity-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
