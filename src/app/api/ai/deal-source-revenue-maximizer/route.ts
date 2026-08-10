// v8.07: AI Deal Source Revenue Maximizer — AI MAKSIMIZIRA TOTAL REVENUE per
// source — top-line revenue (ne profit, ne margin). Kateri source-i generirajo
// največ revenue in kako ga maksimizirati. "Bolha generira 4200€/mesec revenue,
// ampak bi lahko bilo 5800€ z EXPAND_VOLUME — Vinted 1800€ → 2400€ z RAISE_PRICES."
// Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW
// per source = revenue − fees − carrying costs) — ta MAKSIMIZIRA TOTAL REVENUE
// per source (top-line, brez fees in carrying). Razlika od deal-source-profit-maximizer
// (v7.97 ki maksimizira profit per source) — ta maksimizira REVENUE per source
// (top-line, pred costi). Razlika od deal-source-profit-per-trade-maximizer (v8.04
// ki maksimizira profit per trade € per source) — ta maksimizira TOTAL REVENUE per
// source per month. Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira
// margin % per source) — ta maksimizira REVENUE z revenueMaximizationLevers in
// pricingLeakageAnalysis. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira
// ROI per source) — ta maksimizira REVENUE z revenuePotentialScore in
// sourceRevenueRanking. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira
// growth rate revenue čez portfolio) — ta maksimizira REVENUE PER SOURCE z
// revenueMaximizationAction in projectedRevenue30d. Razlika od revenue-per-trade-maximizer
// (v8.06 ki maksimizira avg sell price per trade) — ta maksimizira TOTAL REVENUE per
// source per month (ne per-trade). Razlika od revenue-stream-optimizer (v7.96 ki
// optimizira multiple revenue streams) — ta daje per-source REVENUE MAXIMIZATION z
// revenueMaximizationAction in pricingLeakageAnalysis. Razlika od
// profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) —
// ta maksimizira REVENUE per source z revenueUplift in projectedRevenue30d.

// GET+POST /api/ai/deal-source-revenue-maximizer
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

type RevenueAction =
  | 'EXPAND_VOLUME'
  | 'RAISE_PRICES'
  | 'DIVERSIFY_WITHIN_SOURCE'
  | 'ADD_NEW_CATEGORIES'
  | 'FIX_PRICING_LEAKAGE';

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
  totalRevenue: number; // € = sum(sellPrice - sellFees) (top-line after fees for revenue accuracy)
  grossRevenue: number; // € = sum(sellPrice) (before fees)
  revenuePerMonth: number; // €/mo (over 12m window)
  revenuePerTrade: number; // € = avg revenue per trade
  revenueGrowthTrend: number; // % (slope of revenue over time, positive = growing)
  revenueMarketShare: number; // % (this source's revenue / total portfolio revenue)
  tradeCount: number;
  avgSellPrice: number; // €
}

interface SourceMaximization {
  revenueMaximizationAction: RevenueAction;
  projectedRevenue30d: number; // € forecasted revenue next 30 days with action
  revenueUplift: number; // €/mo improvement = projected − current revenuePerMonth
  revenueMaximizationLevers: string[]; // specific levers per source
  revenuePotentialScore: number; // 0-100 (how much more revenue is possible)
  pricingLeakageAnalysis: string; // where revenue is being lost
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  totalCurrentRevenue: number; // €/mo
  totalMaximizedRevenue: number; // €/mo
  totalRevenueUplift: number; // €/mo
  sourceRevenueRanking: Array<{
    source: string;
    displayName: string;
    currentRevenue: number;
    maximizedRevenue: number;
    rank: number;
  }>;
}

interface DealSourceRevenueResponse {
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
      revenueMaximizationAction?: RevenueAction;
      projectedRevenue30d?: number;
      revenueUplift?: number;
      revenueMaximizationLevers?: string[];
      revenuePotentialScore?: number;
      pricingLeakageAnalysis?: string;
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTHS_IN_WINDOW = 12;

const REVENUE_MIN = 0;
const REVENUE_MAX = 100_000;
const REVENUE_PER_MONTH_MIN = 0;
const REVENUE_PER_MONTH_MAX = 100_000;
const REVENUE_PER_TRADE_MIN = 0;
const REVENUE_PER_TRADE_MAX = 50_000;
const GROSS_REVENUE_MIN = 0;
const GROSS_REVENUE_MAX = 100_000;
const TREND_MIN = -100;
const TREND_MAX = 200;
const MARKET_SHARE_MIN = 0;
const MARKET_SHARE_MAX = 100;
const SELL_PRICE_MIN = 0;
const SELL_PRICE_MAX = 50_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50_000;
const PROJECTED_30D_MIN = 0;
const PROJECTED_30D_MAX = 100_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

const VALID_ACTION: readonly RevenueAction[] = [
  'EXPAND_VOLUME',
  'RAISE_PRICES',
  'DIVERSIFY_WITHIN_SOURCE',
  'ADD_NEW_CATEGORIES',
  'FIX_PRICING_LEAKAGE',
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

const ACTION_MULTIPLIER: Record<RevenueAction, number> = {
  EXPAND_VOLUME: 1.30, // +30% revenue via more volume
  RAISE_PRICES: 1.18, // +18% via higher prices
  DIVERSIFY_WITHIN_SOURCE: 1.15, // +15% via diversification within source
  ADD_NEW_CATEGORIES: 1.22, // +22% via new categories
  FIX_PRICING_LEAKAGE: 1.12, // +12% via fixing leakage
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
  grossRevenue: number; // € = sellPrice (top-line)
  revenue: number; // € = sellPrice - sellFees (revenue after fees)
  sellPrice: number; // €
  sellFees: number; // €
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
  const sellFees = t.sellFees ?? 0;
  const revenue = sellPrice - sellFees;
  const source = detectSource(t);
  return { source, grossRevenue: sellPrice, revenue, sellPrice, sellFees, sellMs, within12m };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalRevenue: number;
  totalGrossRevenue: number;
  totalSellPrice: number;
}

function aggregateBySource(trades: TradeComputed[]): Map<string, SourceAgg> {
  const map = new Map<string, SourceAgg>();
  for (const tr of trades) {
    let agg = map.get(tr.source);
    if (!agg) {
      agg = {
        source: tr.source,
        trades: [],
        totalRevenue: 0,
        totalGrossRevenue: 0,
        totalSellPrice: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalRevenue += tr.revenue;
    agg.totalGrossRevenue += tr.grossRevenue;
    agg.totalSellPrice += tr.sellPrice;
  }
  return map;
}

function computeSourceMetrics(
  agg: SourceAgg,
  totalPortfolioRevenue: number,
): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalRevenue = round0(clampNum(
    agg.totalRevenue, REVENUE_MIN, REVENUE_MAX, 0,
  ));
  const grossRevenue = round0(clampNum(
    agg.totalGrossRevenue, GROSS_REVENUE_MIN, GROSS_REVENUE_MAX, 0,
  ));
  const revenuePerMonth = round0(clampNum(
    totalRevenue / MONTHS_IN_WINDOW,
    REVENUE_PER_MONTH_MIN, REVENUE_PER_MONTH_MAX, 0,
  ));
  const revenuePerTrade = round0(clampNum(
    tradeCount > 0 ? totalRevenue / tradeCount : 0,
    REVENUE_PER_TRADE_MIN, REVENUE_PER_TRADE_MAX, 0,
  ));
  const avgSellPrice = round0(clampNum(
    tradeCount > 0 ? agg.totalSellPrice / tradeCount : 0,
    SELL_PRICE_MIN, SELL_PRICE_MAX, 0,
  ));

  // Trend: split sorted trades into 2 halves (by sell time), compute avg revenue
  // per trade in each, then trend% = (recent - older) / older × 100
  let revenueGrowthTrend = 0;
  if (tradeCount >= 4) {
    const sorted = [...agg.trades].sort((a, b) => a.sellMs - b.sellMs);
    const mid = Math.floor(tradeCount / 2);
    const older = sorted.slice(0, mid);
    const recent = sorted.slice(mid);
    const olderAvg = older.reduce((s, t) => s + t.revenue, 0) / older.length;
    const recentAvg = recent.reduce((s, t) => s + t.revenue, 0) / recent.length;
    if (olderAvg > 0) {
      revenueGrowthTrend = round2(clampNum(
        ((recentAvg - olderAvg) / olderAvg) * 100,
        TREND_MIN, TREND_MAX, 0,
      ));
    }
  }

  const revenueMarketShare = round2(clampNum(
    totalPortfolioRevenue > 0 ? (totalRevenue / totalPortfolioRevenue) * 100 : 0,
    MARKET_SHARE_MIN, MARKET_SHARE_MAX, 0,
  ));

  return {
    totalRevenue,
    grossRevenue,
    revenuePerMonth,
    revenuePerTrade,
    revenueGrowthTrend,
    revenueMarketShare,
    tradeCount,
    avgSellPrice,
  };
}

function decideAction(metrics: SourceMetrics): RevenueAction {
  // If revenueGrowthTrend negative → FIX_PRICING_LEAKAGE (something is leaking)
  if (metrics.revenueGrowthTrend < -5) {
    return 'FIX_PRICING_LEAKAGE';
  }
  // If revenuePerTrade low but tradeCount high → RAISE_PRICES
  if (metrics.revenuePerTrade < 200 && metrics.tradeCount >= 5) {
    return 'RAISE_PRICES';
  }
  // If revenuePerTrade high but tradeCount low → EXPAND_VOLUME
  if (metrics.revenuePerTrade >= 200 && metrics.tradeCount < 10) {
    return 'EXPAND_VOLUME';
  }
  // If revenueMarketShare > 50% (concentrated in one source) → ADD_NEW_CATEGORIES
  if (metrics.revenueMarketShare > 50) {
    return 'ADD_NEW_CATEGORIES';
  }
  // If tradeCount decent but revenuePerMonth < threshold → DIVERSIFY_WITHIN_SOURCE
  if (metrics.tradeCount >= 5 && metrics.revenuePerMonth < 300) {
    return 'DIVERSIFY_WITHIN_SOURCE';
  }
  // Default
  return 'EXPAND_VOLUME';
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideAction(metrics);
  const upliftMultiplier = ACTION_MULTIPLIER[action];

  const projectedMonthlyRaw = metrics.revenuePerMonth * upliftMultiplier;
  const projectedRevenue30d = round0(clampNum(
    Math.max(0, projectedMonthlyRaw),
    PROJECTED_30D_MIN, PROJECTED_30D_MAX, metrics.revenuePerMonth,
  ));
  const revenueUplift = round0(clampNum(
    Math.max(0, projectedRevenue30d - metrics.revenuePerMonth),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Revenue potential score: combines upside potential (uplift relative to current)
  // and trade count (more trades = more granular control)
  const upliftPct = metrics.revenuePerMonth > 0
    ? (revenueUplift / metrics.revenuePerMonth) * 100
    : 0;
  const volumeFactor = Math.min(100, metrics.tradeCount * 5);
  const potentialScore = (upliftPct * 0.6) + (volumeFactor * 0.4);
  const revenuePotentialScore = round0(clampNum(
    potentialScore, SCORE_MIN, SCORE_MAX, 0,
  ));

  // Revenue maximization levers per source (3 specific to this source)
  const levers: string[] = [];
  switch (action) {
    case 'EXPAND_VOLUME':
      levers.push(
        `Povečaj trade volume za 30% — postavi ${Math.round(metrics.tradeCount * 0.3)} dodatnih oglasov v naslednjih 30 dneh v tej platformi.`,
        `Aktiviraj AI monitor alerts za ${metrics.tradeCount > 5 ? 'premium' : 'high-velocity'} segment te platforme.`,
        `Cross-list 20% inventory na to platformo (če je Bolha/Vinted z visoko market share).`,
      );
      break;
    case 'RAISE_PRICES':
      levers.push(
        `Dvigni avg sell price z ${metrics.avgSellPrice}€ na ${Math.round(metrics.avgSellPrice * 1.18)}€ (premium fotografija + boljši opis).`,
        `Testiraj A/B pricing na 30% novih oglasov (premično +15-20% ask price).`,
        `Premakni top 20% listings v premium pozicioniranje (Bolha Top insertion, Vinted+).`,
      );
      break;
    case 'DIVERSIFY_WITHIN_SOURCE':
      levers.push(
        `Dodaj 2-3 nove sub-kategorije v tej platformi (npr. če Bolha mobilni → dodaj Bolha računalniki).`,
        `Testiraj cross-segment: če dominiraš mobilni, dodaj accessories (cover, polnilci).`,
        `AI monitor za nove trend kategorije (Google Trends + platforma search volume).`,
      );
      break;
    case 'ADD_NEW_CATEGORIES':
      levers.push(
        `Market share presežen >50% — diversifikacija nujna. Dodaj 3 nove kategorije (hardware, accessories, services).`,
        `Cross-platform: če dominiraš Bolha, vzpostavi prisotnost na Vinted/mobile.de za new buyer base.`,
        `AI niche finder za iskanje pod-popolnjenih kategorij (deal score >70 z nizko konkurenco).`,
      );
      break;
    case 'FIX_PRICING_LEAKAGE':
      levers.push(
        `Revenue trend pada (${metrics.revenueGrowthTrend}%) — identifikiraj leakage: underpricing, fees, discounts.`,
        `AI pricing audit: preveri zadnjih 30 dni — kateri listings so se prodali <70% aiEstimatedValue.`,
        `Bolha/Vinted fee structure audit: premakni low-margin items na platforme z nižjimi fees (Subito/Kleinanzeigen).`,
      );
      break;
  }

  // Pricing leakage analysis
  const feesPctOfRevenue = metrics.grossRevenue > 0
    ? ((metrics.grossRevenue - metrics.totalRevenue) / metrics.grossRevenue) * 100
    : 0;
  const pricingLeakageAnalysis = `Fees ${round2(feesPctOfRevenue)}% gross revenue. ` +
    `Avg sell price ${metrics.avgSellPrice}€, avg revenue/trade ${metrics.revenuePerTrade}€ (after fees). ` +
    `Trend ${metrics.revenueGrowthTrend}%. ` +
    `Leakage viri: (1) underpricing (sales <70% estValue), (2) fees (${round2(feesPctOfRevenue)}% gross), ` +
    `(3) discounts (negotiation >10% off ask), (4) stale listings z repricing čez 30 dni. ` +
    `Akcijski plan: pricing audit + repricing ladder + fee optimization (bundle, premik na low-fee platforme).`;

  return {
    revenueMaximizationAction: action,
    projectedRevenue30d,
    revenueUplift,
    revenueMaximizationLevers: levers.slice(0, 3),
    revenuePotentialScore,
    pricingLeakageAnalysis: pricingLeakageAnalysis.slice(0, 500),
  };
}

function buildSourceEntries(
  aggMap: Map<string, SourceAgg>,
  totalPortfolioRevenue: number,
): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg, totalPortfolioRevenue);
    const maximization = buildSourceMaximization(metrics);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by revenuePerMonth desc (best revenue source first)
  entries.sort((a, b) => b.metrics.revenuePerMonth - a.metrics.revenuePerMonth);
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  const totalCurrentRevenue = round0(clampNum(
    entries.reduce((s, e) => s + e.metrics.revenuePerMonth, 0),
    REVENUE_PER_MONTH_MIN, REVENUE_PER_MONTH_MAX, 0,
  ));
  const totalMaximizedRevenue = round0(clampNum(
    entries.reduce((s, e) => s + e.maximization.projectedRevenue30d, 0),
    REVENUE_PER_MONTH_MIN, REVENUE_PER_MONTH_MAX, 0,
  ));
  const totalRevenueUplift = round0(clampNum(
    totalMaximizedRevenue - totalCurrentRevenue,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const sourceRevenueRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentRevenue: e.metrics.revenuePerMonth,
    maximizedRevenue: e.maximization.projectedRevenue30d,
    rank: idx + 1,
  }));

  return {
    totalCurrentRevenue,
    totalMaximizedRevenue,
    totalRevenueUplift,
    sourceRevenueRanking,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Revenue Maximizer ni mogoč.';
  }
  const best = entries[0];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio revenue: ${portfolio.totalCurrentRevenue}€/mo → ${portfolio.totalMaximizedRevenue}€/mo (+${portfolio.totalRevenueUplift}€).`,
    `Best: ${best.displayName} (${best.metrics.revenuePerMonth}€/mo, share ${best.metrics.revenueMarketShare}%).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceRevenueMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceRevenueMaximizer(req);
}

async function handleDealSourceRevenueMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-revenue-maximizer', 20);
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
          totalCurrentRevenue: 0,
          totalMaximizedRevenue: 0,
          totalRevenueUplift: 0,
          sourceRevenueRanking: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Revenue Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Revenue Maximizer ni mogoč.',
      } satisfies DealSourceRevenueResponse);
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
          totalCurrentRevenue: 0,
          totalMaximizedRevenue: 0,
          totalRevenueUplift: 0,
          sourceRevenueRanking: [],
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Revenue Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Revenue Maximizer ni mogoč.',
      } satisfies DealSourceRevenueResponse);
    }

    const aggMap = aggregateBySource(computed);
    const totalPortfolioRevenue = round0(clampNum(
      computed.reduce((s, t) => s + t.revenue, 0),
      REVENUE_MIN, REVENUE_MAX, 0,
    ));

    let entries = buildSourceEntries(aggMap, totalPortfolioRevenue);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-revenue-maximizer:${currentMonth}`;
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
      } satisfies DealSourceRevenueResponse);
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

    // Compact context for AI
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
        totalCurrentRevenue: portfolio.totalCurrentRevenue,
        totalMaximizedRevenue: portfolio.totalMaximizedRevenue,
        totalRevenueUplift: portfolio.totalRevenueUplift,
        sourceRevenueRanking: portfolio.sourceRevenueRanking,
      },
      caps: {
        revenueMin: REVENUE_MIN, revenueMax: REVENUE_MAX,
        revenuePerMonthMin: REVENUE_PER_MONTH_MIN, revenuePerMonthMax: REVENUE_PER_MONTH_MAX,
        revenuePerTradeMin: REVENUE_PER_TRADE_MIN, revenuePerTradeMax: REVENUE_PER_TRADE_MAX,
        grossRevenueMin: GROSS_REVENUE_MIN, grossRevenueMax: GROSS_REVENUE_MAX,
        trendMin: TREND_MIN, trendMax: TREND_MAX,
        marketShareMin: MARKET_SHARE_MIN, marketShareMax: MARKET_SHARE_MAX,
        sellPriceMin: SELL_PRICE_MIN, sellPriceMax: SELL_PRICE_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        projected30dMin: PROJECTED_30D_MIN, projected30dMax: PROJECTED_30D_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Revenue Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za TOTAL REVENUE MAXIMIZATION per source — kako maksimizirati TOP-LINE REVENUE (ne profit, ne margin) per source per month. Tvoj cilj je "Bolha generira 4200€/mesec revenue, ampak bi lahko bilo 5800€ z EXPAND_VOLUME — Vinted 1800€ → 2400€ z RAISE_PRICES." Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per source = revenue − fees − carrying costs) — ti MAKSIMIZIRAŠ TOTAL REVENUE per source (top-line, brez fees in carrying). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira profit per source) — ta maksimizira REVENUE per source (top-line, pred costi). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade € per source) — ta maksimizira TOTAL REVENUE per source per month. Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin % per source) — ta maksimizira REVENUE z revenueMaximizationLevers in pricingLeakageAnalysis. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta maksimizira REVENUE z revenuePotentialScore in sourceRevenueRanking. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira growth rate revenue čez portfolio) — ta maksimizira REVENUE PER SOURCE z revenueMaximizationAction in projectedRevenue30d. Razlika od revenue-per-trade-maximizer (v8.06 ki maksimizira avg sell price per trade) — ta maksimizira TOTAL REVENUE per source per month (ne per-trade). Razlika od revenue-stream-optimizer (v7.96 ki optimizira multiple revenue streams) — ta daje per-source REVENUE MAXIMIZATION z revenueMaximizationAction in pricingLeakageAnalysis. Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta maksimizira REVENUE per source z revenueUplift in projectedRevenue30d.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.revenueMaximizationAction: EXPAND_VOLUME | RAISE_PRICES | DIVERSIFY_WITHIN_SOURCE | ADD_NEW_CATEGORIES | FIX_PRICING_LEAKAGE,
   - maximization.projectedRevenue30d € [0, 100000] (forecasted revenue next 30 days z action — ≥ current revenuePerMonth, ≤ current × 1.5 ali +5000€),
   - maximization.revenueUplift €/mo [0, 50000] (improvement = projected − current revenuePerMonth),
   - maximization.revenueMaximizationLevers: 3 string-i (max 200 vsak, slovenski — specifični levers za ta source),
   - maximization.revenuePotentialScore [0, 100] (koliko % več revenue je možno iz tega source — higher = more upside),
   - maximization.pricingLeakageAnalysis (max 500, slovenski — kje se izgublja revenue: underpricing, fees, discounts),
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "revenueMaximizationAction": "EXPAND_VOLUME",
        "projectedRevenue30d": 5800,
        "revenueUplift": 1600,
        "revenueMaximizationLevers": [
          "Povečaj trade volume za 30% v naslednjih 30 dneh.",
          "Aktiviraj AI monitor alerts za premium segment.",
          "Cross-list 20% inventory na to platformo."
        ],
        "revenuePotentialScore": 78,
        "pricingLeakageAnalysis": "Fees 8% gross revenue. Avg sell 280€, revenue/trade 258€. Leakage: underpricing, fees, discounts."
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "revenueMaximizationAction": "RAISE_PRICES",
        "projectedRevenue30d": 2400,
        "revenueUplift": 600,
        "revenueMaximizationLevers": [
          "Dvigni avg sell price z 150€ na 177€.",
          "A/B testing na 30% novih oglasov.",
          "Premakni top 20% listings v premium pozicioniranje."
        ],
        "revenuePotentialScore": 55,
        "pricingLeakageAnalysis": "Fees 12% gross revenue. Avg sell 150€. Leakage: underpricing + discounts."
      }
    }
  ],
  "summary": "2 source-a. Bolha 4200€/mo → 5800€/mo (+1600€, EXPAND_VOLUME). Vinted 1800€/mo → 2400€/mo (+600€, RAISE_PRICES). Portfolio: 6000€ → 8200€/mo (+2200€)."
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
            aiMax.revenueMaximizationAction,
            VALID_ACTION,
            det.maximization.revenueMaximizationAction,
          );

          // Anti-hallucination: projectedRevenue30d ∈ [current, current × 1.5 ali +5000€]
          const maxBound = Math.min(
            PROJECTED_30D_MAX,
            Math.max(
              det.metrics.revenuePerMonth + 100,
              Math.min(det.metrics.revenuePerMonth * 1.5 + 500, det.metrics.revenuePerMonth + 5000),
            ),
          );
          const minBound = Math.max(PROJECTED_30D_MIN, det.metrics.revenuePerMonth);
          const projectedRevenue30d = round0(clampNum(
            aiMax.projectedRevenue30d,
            minBound, maxBound,
            det.maximization.projectedRevenue30d,
          ));
          const revenueUplift = round0(clampNum(
            Math.max(0, projectedRevenue30d - det.metrics.revenuePerMonth),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          const revenuePotentialScore = round0(clampNum(
            aiMax.revenuePotentialScore,
            SCORE_MIN, SCORE_MAX,
            det.maximization.revenuePotentialScore,
          ));

          // Levers (max 3, each clamped to 200 chars)
          let revenueMaximizationLevers = det.maximization.revenueMaximizationLevers;
          if (Array.isArray(aiMax.revenueMaximizationLevers) &&
              aiMax.revenueMaximizationLevers.length >= 3) {
            const aiLevers = aiMax.revenueMaximizationLevers
              .slice(0, 3)
              .map((l) => clampString(l, 200, ''))
              .filter((l) => l.length > 0);
            if (aiLevers.length >= 3) {
              revenueMaximizationLevers = aiLevers;
            }
          }

          const pricingLeakageAnalysis = clampString(
            aiMax.pricingLeakageAnalysis, 500, det.maximization.pricingLeakageAnalysis,
          );

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              revenueMaximizationAction: action,
              projectedRevenue30d,
              revenueUplift,
              revenueMaximizationLevers,
              revenuePotentialScore,
              pricingLeakageAnalysis,
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
        '/api/ai/deal-source-revenue-maximizer',
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
    } satisfies DealSourceRevenueResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-revenue-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
