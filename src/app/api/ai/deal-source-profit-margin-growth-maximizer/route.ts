// v8.12: AI Deal Source Profit Margin Growth Maximizer — AI MAKSIMIZIRA
// GROWTH profit margin-e PER SOURCE — ne trenutno margin, ampak kako hitro
// margin raste per source month-over-month. "Bolha margin raste +1.5%/mo,
// Vinted +0.5%/mo — ampak bi lahko bilo +3%/mo in +2%/mo." Razlika od
// deal-source-margin-maximizer (v8.03 ki maksimizira margin % per source) —
// ta MAKSIMIZIRA MARGIN GROWTH RATE per source (%/mo kako hitro margin raste,
// ne absolutna margin %). Razlika od deal-source-profit-per-day-maximizer
// (v8.11 ki maksimizira profit per day per source €/dan) — ta MAKSIMIZIRA
// MARGIN GROWTH per source (%/mo margin growth, ne €/dan profit). Razlika od
// deal-source-annual-return-maximizer (v8.10 ki maksimizira annualized return
// per source z benchmark) — ta MAKSIMIZIRA MARGIN GROWTH RATE per source
// (%/mo, ne % annual return). Razlika od deal-source-profit-velocity-
// maximizer (v8.08 ki maksimizira velocity profit-a per source €/teden) —
// ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo, ne €/teden). Razlika od
// profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega
// profit-a v %/mo) — ta MAKSIMIZIRA MARGIN GROWTH per source (per-source
// margin % growth, ne skupni profit € growth). Razlika od inventory-annual-
// yield-maximizer (v8.11 ki maksimizira annual yield inventory-ja) — ta
// MAKSIMIZIRA MARGIN GROWTH per source (%/mo source margin growth, ne letni
// yield %). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira
// profit per cycle €/cycle) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo
// margin growth rate, ne €/cycle profit). Razlika od inventory-capital-
// velocity-maximizer (v8.10 ki maksimizira velocity kapitala skozi inventory
// — koliko cycle-ov/leto) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo
// margin growth, ne cycle count). Razlika od profit-margin-acceleration-
// tracker (v8.03 ki trakira acceleration margin-a) — ta MAKSIMIZIRA MARGIN
// GROWTH RATE per source z maximizedMarginGrowthRate in marginGrowthLevers.
// Razlika od deal-source-profitability-analyzer (v8.06 ki analizira
// profitability per source) — ta MAKSIMIZIRA MARGIN GROWTH per source
// (%/mo growth, ne profitability snapshot). Razlika od deal-source-profit-
// per-trade-maximizer (v8.04 ki maksimizira profit per trade per source €)
// — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo margin growth, ne €/trade
// profit). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira
// net cash flow per source) — ta MAKSIMIZIRA MARGIN GROWTH per source
// (%/mo margin growth rate, ne € net cash flow). Razlika od inventory-
// capital-efficiency-growth-maximizer (v8.12 ki maksimizira capital
// efficiency growth čez inventory) — ta MAKSIMIZIRA MARGIN GROWTH PER SOURCE
// (per-source margin growth, ne capital efficiency growth).

// GET+POST /api/ai/deal-source-profit-margin-growth-maximizer
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

type MarginGrowthAction =
  | 'IMPROVE_SOURCING'
  | 'RAISE_PRICES'
  | 'REDUCE_FEES'
  | 'OPTIMIZE_CATEGORY_MIX';
type MarginGrowthTrend =
  | 'ACCELERATING'
  | 'STABLE'
  | 'DECLINING'
  | 'VOLATILE'
  | 'INSUFFICIENT_DATA';
type MarginGrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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

interface MonthlyMarginBucket {
  month: number; // 0-11 (oldest → newest)
  monthLabel: string; // YYYY-MM
  totalProfit: number; // €
  totalCapital: number; // € = buyPrice + buyFees
  tradeCount: number;
  avgMargin: number; // % = totalProfit / totalCapital × 100
}

interface SourceMetrics {
  source: string;
  displayName: string;
  tradeCount12m: number;
  monthlyAvgMargin: number; // % avg over 12 months
  currentMonthlyMargin: number; // % (last month with data)
  marginGrowthRate: number; // %/mo (linear regression slope / mean × 100)
  marginGrowthTrend: MarginGrowthTrend;
  marginGrowthAcceleration: number; // %/mo² (slope of last half vs first half)
  monthsWithData: number;
  bestMonthlyMargin: number; // %
  worstMonthlyMargin: number; // %
  monthlyMargins: number[]; // 12 entries (% per month, oldest → newest)
}

interface MarginGrowthProjectionEntry {
  months: number; // 3, 6, 12
  projectedMargin: number; // % [-50, 100] (= current × (1 + months × maximizedMarginGrowthRate/100))
}

interface SourceMaximization {
  marginGrowthMaximizationAction: MarginGrowthAction;
  maximizedMarginGrowthRate: number; // %/mo [-10, 50] (≥ current, ≤ current + 10pp absolute uplift — anti-hallucination)
  marginGrowthUplift: number; // pp [0, 50] (improvement = maximized − current)
  marginGrowthLevers: string[]; // 3-5 slovenian max 200 each
  marginGrowthProjection: MarginGrowthProjectionEntry[]; // 3/6/12 month margin projection
  marginGrowthGrade: MarginGrowthGrade;
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  currentPortfolioMarginGrowth: number; // %/mo = weighted avg of source growth rates
  maximizedPortfolioMarginGrowth: number; // %/mo = weighted avg of maximized
  portfolioMarginGrowthUplift: number; // pp
  sourceMarginGrowthRanking: Array<{
    source: string;
    displayName: string;
    currentMarginGrowthRate: number; // %/mo
    maximizedMarginGrowthRate: number; // %/mo
    rank: number;
  }>;
  bestMarginGrowthSource: string;
}

interface DealSourceProfitMarginGrowthResponse {
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
      marginGrowthMaximizationAction?: MarginGrowthAction;
      maximizedMarginGrowthRate?: number;
      marginGrowthUplift?: number;
      marginGrowthLevers?: string[];
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const MARGIN_MIN = -50;
const MARGIN_MAX = 100;
const GROWTH_RATE_MIN = -10;
const GROWTH_RATE_MAX = 50;
const ACCELERATION_MIN = -10;
const ACCELERATION_MAX = 50;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50;
const PROJECTED_MARGIN_MIN = -50;
const PROJECTED_MARGIN_MAX = 100;
const MAX_LEVERS = 5;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;

// Per-action absolute uplift potential (pp — anti-hallucination cap)
// Maximised uplift = current + ACTION_GAIN_PP
const ACTION_GAIN_PP: Record<MarginGrowthAction, number> = {
  IMPROVE_SOURCING: 4.0, // +4pp by better sourcing → cheaper buys
  RAISE_PRICES: 5.0, // +5pp by AI pricing engine → premium sell prices
  REDUCE_FEES: 2.0, // +2pp by bundle deals, tax-aware selling, platform optimization
  OPTIMIZE_CATEGORY_MIX: 3.0, // +3pp by shifting to higher-margin categories
};

const ABSOLUTE_UPLIFT_CAP_PP = 10; // max +10pp absolute uplift — anti-hallucination

const VALID_ACTION: readonly MarginGrowthAction[] = [
  'IMPROVE_SOURCING',
  'RAISE_PRICES',
  'REDUCE_FEES',
  'OPTIMIZE_CATEGORY_MIX',
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
  capital: number; // € = buyPrice + buyFees
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
  return { source, profit, capital, sellMs, within12m };
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

// Bucket trades into 12 monthly buckets per source
// Returns array of 12 monthly margin buckets (oldest → newest)
function bucketMonthlyMargins(
  trades: TradeComputed[],
  now: number,
): MonthlyMarginBucket[] {
  const buckets: MonthlyMarginBucket[] = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    monthLabel: monthLabelForIndex(i, now),
    totalProfit: 0,
    totalCapital: 0,
    tradeCount: 0,
    avgMargin: 0,
  }));
  for (const t of trades) {
    const monthsAgo = Math.floor((now - t.sellMs) / MONTH_MS);
    if (monthsAgo >= 0 && monthsAgo < 12) {
      const idx = 11 - monthsAgo; // 0 = oldest, 11 = newest
      buckets[idx].totalProfit += t.profit;
      buckets[idx].totalCapital += t.capital;
      buckets[idx].tradeCount += 1;
    }
  }
  for (const b of buckets) {
    b.totalProfit = round0(clampNum(b.totalProfit, PROFIT_MIN, PROFIT_MAX, 0));
    b.totalCapital = round0(clampNum(b.totalCapital, CAPITAL_MIN, CAPITAL_MAX, 0));
    b.avgMargin = round2(clampNum(
      b.totalCapital > 0 ? (b.totalProfit / b.totalCapital) * 100 : 0,
      MARGIN_MIN, MARGIN_MAX, 0,
    ));
  }
  return buckets;
}

function monthLabelForIndex(idx: number, now: number): string {
  // idx 0 = oldest, idx 11 = newest = current month
  const targetMs = now - (11 - idx) * MONTH_MS;
  return new Date(targetMs).toISOString().slice(0, 7);
}

// Linear regression slope over monthly margin array
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

function computeGrowthRate(monthlyMargins: number[]): number {
  if (monthlyMargins.length < 2) return 0;
  const slope = linearRegressionSlope(monthlyMargins);
  const mean = monthlyMargins.reduce((s, v) => s + v, 0) / monthlyMargins.length;
  if (Math.abs(mean) < 0.01) return 0;
  return (slope / mean) * 100;
}

function computeAcceleration(monthlyMargins: number[]): number {
  const n = monthlyMargins.length;
  if (n < 4) return 0;
  const half = Math.floor(n / 2);
  const firstHalf = monthlyMargins.slice(0, half);
  const secondHalf = monthlyMargins.slice(n - half);
  const slopeFirst = linearRegressionSlope(firstHalf);
  const slopeSecond = linearRegressionSlope(secondHalf);
  const mean = monthlyMargins.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 0.01) return 0;
  return ((slopeSecond - slopeFirst) / mean) * 100;
}

function decideTrend(
  growthRate: number,
  acceleration: number,
  monthsWithData: number,
): MarginGrowthTrend {
  if (monthsWithData < 4) return 'INSUFFICIENT_DATA';
  if (growthRate >= 2 && acceleration >= 0.5) return 'ACCELERATING';
  if (growthRate <= -1 && acceleration <= -0.5) return 'DECLINING';
  if (Math.abs(acceleration) > 5 || growthRate > 10) return 'VOLATILE';
  return 'STABLE';
}

function computeSourceMetrics(
  agg: SourceAgg,
  now: number,
): SourceMetrics {
  const monthlyBuckets = bucketMonthlyMargins(agg.trades, now);
  const monthlyMargins = monthlyBuckets.map((b) => b.avgMargin);
  const monthsWithData = monthlyMargins.filter((v) => v !== 0).length;
  const tradeCount12m = agg.trades.length;
  const totalProfit = agg.trades.reduce((s, t) => s + t.profit, 0);
  const totalCapital = agg.trades.reduce((s, t) => s + t.capital, 0);
  const monthlyAvgMargin = round2(clampNum(
    totalCapital > 0 ? (totalProfit / totalCapital) * 100 : 0,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));
  const currentMonthlyMargin = round2(clampNum(
    monthlyMargins[monthlyMargins.length - 1] ?? 0,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));
  const marginGrowthRate = round2(clampNum(
    computeGrowthRate(monthlyMargins),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const marginGrowthAcceleration = round2(clampNum(
    computeAcceleration(monthlyMargins),
    ACCELERATION_MIN, ACCELERATION_MAX, 0,
  ));
  const marginGrowthTrend = decideTrend(marginGrowthRate, marginGrowthAcceleration, monthsWithData);
  const bestMonthlyMargin = round2(clampNum(
    monthlyMargins.length > 0 ? Math.max(...monthlyMargins) : 0,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));
  const worstMonthlyMargin = round2(clampNum(
    monthlyMargins.length > 0 ? Math.min(...monthlyMargins) : 0,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));
  return {
    source: agg.source,
    displayName: displayName(agg.source),
    tradeCount12m,
    monthlyAvgMargin,
    currentMonthlyMargin,
    marginGrowthRate,
    marginGrowthTrend,
    marginGrowthAcceleration,
    monthsWithData,
    bestMonthlyMargin,
    worstMonthlyMargin,
    monthlyMargins,
  };
}

// --- Deterministic maximization -----------------------------------------

function decideAction(metrics: SourceMetrics): MarginGrowthAction {
  // If current margin is low → IMPROVE_SOURCING (cheaper buys)
  if (metrics.monthlyAvgMargin < 15) return 'IMPROVE_SOURCING';
  // If margin is declining → RAISE_PRICES (recover via premium positioning)
  if (metrics.marginGrowthTrend === 'DECLINING') return 'RAISE_PRICES';
  // If margin growth is slow (below 1%/mo) but margin is healthy → OPTIMIZE_CATEGORY_MIX
  if (metrics.marginGrowthRate < 1 && metrics.monthlyAvgMargin >= 20) {
    return 'OPTIMIZE_CATEGORY_MIX';
  }
  // Default → REDUCE_FEES
  return 'REDUCE_FEES';
}

function buildLevers(metrics: SourceMetrics, action: MarginGrowthAction): string[] {
  const levers: string[] = [];
  levers.push(`Trenutno: ${metrics.monthlyAvgMargin.toFixed(2)}% povprečna margin (current ${metrics.currentMonthlyMargin.toFixed(2)}%, growth ${metrics.marginGrowthRate.toFixed(2)}%/mo, trend ${metrics.marginGrowthTrend}, ${metrics.tradeCount12m} trades, ${metrics.monthsWithData} mesecev z data).`);
  switch (action) {
    case 'IMPROVE_SOURCING':
      levers.push(`Aktiviraj AI sourcing z cross-border (Kleinanzeigen, Subito, Willhaben) in deal score > 85 — znižaj buy cost za 15-20% in dvigni margin za +4pp/mo z boljšim buy price discovery.`);
      levers.push('Filter buy-side z AI category detectorjem — fokus na high-margin kategorije (luxury watches, designer bags, electronics) z višjim inherent margin.');
      levers.push('Negotiate harder z AI negotiation-playbook — +10% close rate z boljšim offer timing in ai-pregovanje za boljši buy price.');
      break;
    case 'RAISE_PRICES':
      levers.push(`Vklopi AI pricing engine in dynamic pricing — dvigni sell price za +15-25% z AI premium fotografijo in SEO naslovi za +5pp/mo margin growth.`);
      levers.push('Prestavi se v premium niche kategorije z višjim absolute margin — luxury watches, designer bags, premium electronics.');
      levers.push('A/B test listing prices za optimal close rate in maximum profit per trade — vsak mesec optimiziraj pricing strategy za +1-2pp margin growth.');
      break;
    case 'OPTIMIZE_CATEGORY_MIX':
      levers.push(`Analiziraj category margin distribution in prestavi capital v top-3 highest-margin kategorije — +3pp/mo z boljšim category mix allocation.`);
      levers.push('Deaktiviraj nizko-margin kategorije (<10% margin) in preusmeri capital v high-margin niche z +5-10pp margin premium.');
      levers.push('AI Smart Reorder Advisor za kontinuirano category rebalancing — mesečna optimizacija inventory mix za +1-2pp margin growth.');
      break;
    case 'REDUCE_FEES':
      levers.push(`Optimiziraj fee structure z bundle deals (Bolha bundle discount), tax-aware selling in platform fee minimization — znižaj fee ratio za 30-50% in dvigni margin za +2pp/mo.`);
      levers.push('Implementiraj multi-platform listing strategy (Bolha + Vinted + Avtonet) — izberi platformo z lowest fee per category za +1-2pp margin growth.');
      levers.push('Tax-aware selling z AI tax-optimization — strukturiraj sales za minimal tax burden in maximal net margin.');
      break;
  }
  return levers.slice(0, MAX_LEVERS);
}

function buildMarginGrowthProjection(
  currentMonthlyMargin: number,
  maximizedMarginGrowthRate: number,
): MarginGrowthProjectionEntry[] {
  const out: MarginGrowthProjectionEntry[] = [];
  for (const months of [3, 6, 12]) {
    // Linear projection: currentMargin × (1 + months × growthRate/100)
    const projected = currentMonthlyMargin * (1 + (months * maximizedMarginGrowthRate) / 100);
    out.push({
      months,
      projectedMargin: round2(clampNum(
        projected, PROJECTED_MARGIN_MIN, PROJECTED_MARGIN_MAX, currentMonthlyMargin,
      )),
    });
  }
  return out.slice(0, MAX_PROJECTIONS);
}

function decideGrade(maximizedMarginGrowthRate: number): MarginGrowthGrade {
  if (maximizedMarginGrowthRate >= 8) return 'A+';
  if (maximizedMarginGrowthRate >= 5) return 'A';
  if (maximizedMarginGrowthRate >= 3) return 'B';
  if (maximizedMarginGrowthRate >= 1.5) return 'C';
  if (maximizedMarginGrowthRate >= 0.5) return 'D';
  return 'F';
}

function buildSourceMaximization(
  metrics: SourceMetrics,
  rank: number,
): SourceMaximization {
  const action = decideAction(metrics);
  const gainPp = ACTION_GAIN_PP[action];

  // Anti-hallucination: maximized ∈ [current, min(current + 10pp, 50%/mo)]
  const minBound = Math.max(GROWTH_RATE_MIN, metrics.marginGrowthRate);
  const maxBound = Math.min(GROWTH_RATE_MAX, metrics.marginGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
  const maximizedMarginGrowthRate = round2(clampNum(
    metrics.marginGrowthRate + gainPp,
    minBound, maxBound,
    metrics.marginGrowthRate,
  ));
  const marginGrowthUplift = round2(clampNum(
    Math.max(0, maximizedMarginGrowthRate - metrics.marginGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const marginGrowthLevers = buildLevers(metrics, action);
  const marginGrowthProjection = buildMarginGrowthProjection(
    metrics.currentMonthlyMargin,
    maximizedMarginGrowthRate,
  );
  const marginGrowthGrade = decideGrade(maximizedMarginGrowthRate);

  return {
    marginGrowthMaximizationAction: action,
    maximizedMarginGrowthRate,
    marginGrowthUplift,
    marginGrowthLevers,
    marginGrowthProjection,
    marginGrowthGrade,
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
  // Sort by marginGrowthRate desc (best source first)
  entries.sort((a, b) => b.metrics.marginGrowthRate - a.metrics.marginGrowthRate);
  for (let i = 0; i < entries.length; i++) {
    entries[i].maximization = buildSourceMaximization(entries[i].metrics, i + 1);
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
    currentPortfolio += e.metrics.marginGrowthRate * weight;
    maximizedPortfolio += e.maximization.maximizedMarginGrowthRate * weight;
  }
  currentPortfolio = round2(clampNum(
    currentPortfolio, GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  maximizedPortfolio = round2(clampNum(
    maximizedPortfolio, GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const portfolioMarginGrowthUplift = round2(clampNum(
    Math.max(0, maximizedPortfolio - currentPortfolio),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const sourceMarginGrowthRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentMarginGrowthRate: e.metrics.marginGrowthRate,
    maximizedMarginGrowthRate: e.maximization.maximizedMarginGrowthRate,
    rank: idx + 1,
  }));
  const bestEntry = entries[0];
  const bestMarginGrowthSource = bestEntry ? bestEntry.source : '';
  return {
    currentPortfolioMarginGrowth: currentPortfolio,
    maximizedPortfolioMarginGrowth: maximizedPortfolio,
    portfolioMarginGrowthUplift,
    sourceMarginGrowthRanking,
    bestMarginGrowthSource,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Profit Margin Growth Maximizer ni mogoč.';
  }
  const best = entries[0];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio margin growth: ${portfolio.currentPortfolioMarginGrowth.toFixed(2)}%/mo → ${portfolio.maximizedPortfolioMarginGrowth.toFixed(2)}%/mo (+${portfolio.portfolioMarginGrowthUplift.toFixed(2)}pp uplift).`,
    `Best: ${best.displayName} (${best.metrics.marginGrowthRate.toFixed(2)}%/mo → ${best.maximization.maximizedMarginGrowthRate.toFixed(2)}%/mo).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceProfitMarginGrowthMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceProfitMarginGrowthMaximizer(req);
}

async function handleDealSourceProfitMarginGrowthMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-profit-margin-growth-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades last 12 months with linked Listing for source
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
          currentPortfolioMarginGrowth: 0,
          maximizedPortfolioMarginGrowth: 0,
          portfolioMarginGrowthUplift: 0,
          sourceMarginGrowthRanking: [],
          bestMarginGrowthSource: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Margin Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Margin Growth Maximizer ni mogoč.',
      } satisfies DealSourceProfitMarginGrowthResponse);
    }

    // 2) Compute trades within 12m
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
          currentPortfolioMarginGrowth: 0,
          maximizedPortfolioMarginGrowth: 0,
          portfolioMarginGrowthUplift: 0,
          sourceMarginGrowthRanking: [],
          bestMarginGrowthSource: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Profit Margin Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Profit Margin Growth Maximizer ni mogoč.',
      } satisfies DealSourceProfitMarginGrowthResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap, now);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `deal-source-profit-margin-growth-maximizer:${currentMonth}`;
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
      } satisfies DealSourceProfitMarginGrowthResponse);
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
        currentPortfolioMarginGrowth: portfolio.currentPortfolioMarginGrowth,
        maximizedPortfolioMarginGrowth: portfolio.maximizedPortfolioMarginGrowth,
        portfolioMarginGrowthUplift: portfolio.portfolioMarginGrowthUplift,
        sourceMarginGrowthRanking: portfolio.sourceMarginGrowthRanking,
        bestMarginGrowthSource: portfolio.bestMarginGrowthSource,
      },
      caps: {
        marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        projectedMarginMin: PROJECTED_MARGIN_MIN, projectedMarginMax: PROJECTED_MARGIN_MAX,
        absoluteUpliftCapPp: ABSOLUTE_UPLIFT_CAP_PP,
      },
      actionGainPp: ACTION_GAIN_PP,
    };

    const prompt = `Si AI "Deal Source Profit Margin Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za MARGIN GROWTH RATE MAXIMIZATION per source — kako maksimizirati GROWTH RATE profit margin-e PER SOURCE (koliko hitro margin raste per source month-over-month). Tvoj cilj je "Bolha margin raste +1.5%/mo, Vinted +0.5%/mo — ampak bi lahko bilo +3%/mo in +2%/mo." Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin % per source) — ti MAKSIMIZIRAŠ MARGIN GROWTH RATE per source (%/mo kako hitro margin raste, ne absolutna margin %). Razlika od deal-source-profit-per-day-maximizer (v8.11 ki maksimizira profit per day per source €/dan) — ti MAKSIMIZIRAŠ MARGIN GROWTH per source (%/mo margin growth, ne €/dan profit). Razlika od deal-source-annual-return-maximizer (v8.10 ki maksimizira annualized return per source z benchmark) — ti MAKSIMIZIRAŠ MARGIN GROWTH RATE per source (%/mo, ne % annual return). Razlika od deal-source-profit-velocity-maximizer (v8.08 ki maksimizira velocity profit-a per source €/teden) — ti MAKSIMIZIRAŠ MARGIN GROWTH per source (%/mo, ne €/teden). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira growth rate skupnega profit-a v %/mo) — ti MAKSIMIZIRAŠ MARGIN GROWTH per source (per-source margin % growth, ne skupni profit € growth). Razlika od profit-per-cycle-maximizer (v8.12 ki maksimizira profit per cycle €/cycle) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo margin growth rate, ne €/cycle profit). Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira velocity kapitala skozi inventory — koliko cycle-ov/leto) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo margin growth, ne cycle count). Razlika od profit-margin-acceleration-tracker (v8.03 ki trakira acceleration margin-a) — ta MAKSIMIZIRA MARGIN GROWTH RATE per source z maximizedMarginGrowthRate in marginGrowthLevers. Razlika od deal-source-profitability-analyzer (v8.06 ki analizira profitability per source) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo growth, ne profitability snapshot). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade per source €) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo margin growth, ne €/trade profit). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira net cash flow per source) — ta MAKSIMIZIRA MARGIN GROWTH per source (%/mo margin growth rate, ne € net cash flow). Razlika od inventory-capital-efficiency-growth-maximizer (v8.12 ki maksimizira capital efficiency growth čez inventory) — ta MAKSIMIZIRA MARGIN GROWTH PER SOURCE (per-source margin growth, ne capital efficiency growth).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source, grouped by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.marginGrowthMaximizationAction: IMPROVE_SOURCING | RAISE_PRICES | REDUCE_FEES | OPTIMIZE_CATEGORY_MIX,
   - maximization.maximizedMarginGrowthRate %/mo [-10, 50] (≥ current marginGrowthRate, ≤ current + 10pp absolute uplift — anti-hallucination),
   - maximization.marginGrowthUplift pp [0, 50] (improvement = maximized − current),
   - maximization.marginGrowthLevers: 3-5 stringov (max 200 vsak, slovenski — specific margin growth levers per source),
   - (marginGrowthProjection 3/6/12 month in marginGrowthGrade se avtomatsko izračunata v backend-u — AI ne vrača teh),
2. summary: slovenski povzetek (max 500 znakov — poudari total current portfolio growth rate, total maximized portfolio growth rate, total uplift, best source).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "marginGrowthMaximizationAction": "RAISE_PRICES",
        "maximizedMarginGrowthRate": 3.0,
        "marginGrowthUplift": 1.5,
        "marginGrowthLevers": [
          "Vklopi AI pricing engine za +5pp/mo margin growth.",
          "Prestavi se v premium niche z višjim absolute margin.",
          "A/B test listing prices za optimal close rate."
        ]
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "marginGrowthMaximizationAction": "IMPROVE_SOURCING",
        "maximizedMarginGrowthRate": 2.0,
        "marginGrowthUplift": 1.5,
        "marginGrowthLevers": [
          "Aktiviraj cross-border sourcing za 15-20% nižji buy cost.",
          "Filter buy-side z AI category detectorjem.",
          "Negotiate harder z AI negotiation-playbook."
        ]
      }
    }
  ],
  "summary": "2 source-a. Portfolio margin growth: 1.00%/mo → 2.50%/mo (+1.50pp uplift). Best: Bolha (1.50%/mo → 3.00%/mo)."
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
            aiMax.marginGrowthMaximizationAction,
            VALID_ACTION,
            det.maximization.marginGrowthMaximizationAction,
          );

          // Anti-hallucination: maximized ∈ [current, min(current + 10pp, 50%/mo)]
          const minBound = Math.max(GROWTH_RATE_MIN, det.metrics.marginGrowthRate);
          const maxBound = Math.min(GROWTH_RATE_MAX, det.metrics.marginGrowthRate + ABSOLUTE_UPLIFT_CAP_PP);
          const maximizedMarginGrowthRate = round2(clampNum(
            aiMax.maximizedMarginGrowthRate,
            minBound, maxBound,
            det.maximization.maximizedMarginGrowthRate,
          ));
          const marginGrowthUplift = round2(clampNum(
            Math.max(0, maximizedMarginGrowthRate - det.metrics.marginGrowthRate),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          let marginGrowthLevers = det.maximization.marginGrowthLevers;
          if (Array.isArray(aiMax.marginGrowthLevers) &&
              aiMax.marginGrowthLevers.length >= 2) {
            const aiLevers: string[] = [];
            for (const l of aiMax.marginGrowthLevers.slice(0, MAX_LEVERS)) {
              aiLevers.push(clampString(l, 200, 'Margin growth lever neopisan.'));
            }
            if (aiLevers.length >= 2) {
              marginGrowthLevers = aiLevers;
            }
          }

          // Recompute projection with new maximizedMarginGrowthRate
          const marginGrowthProjection = buildMarginGrowthProjection(
            det.metrics.currentMonthlyMargin,
            maximizedMarginGrowthRate,
          );

          const marginGrowthGrade = decideGrade(maximizedMarginGrowthRate);

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              marginGrowthMaximizationAction: action,
              maximizedMarginGrowthRate,
              marginGrowthUplift,
              marginGrowthLevers,
              marginGrowthProjection,
              marginGrowthGrade,
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
        '/api/ai/deal-source-profit-margin-growth-maximizer',
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
    } satisfies DealSourceProfitMarginGrowthResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-profit-margin-growth-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
