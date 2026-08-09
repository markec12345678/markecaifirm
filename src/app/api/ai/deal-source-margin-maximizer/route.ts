// v8.03: AI Deal Source Margin Maximizer — AI MAXIMIZIRA PROFIT MARGINS PER
// SOURCE — kateri source-i imajo najboljše margins in kako izboljšati margins
// iz vsakega. "Bolha margin 45% → projected 58% (+13pp uplift z IMPROVE_PRICING),
// Vinted margin 22% → projected 35% (+13pp z REDUCE_COSTS)." Razlika od
// deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta
// MAKSIMIZIRA MARGIN % per source (ne ROI %), z marginMaximizationLevers in
// marginMaximizationAction. Razlika od deal-source-profit-maximizer (v7.97 ki
// maksimizira total profit per source) — ta maksimizira MARGIN % z
// IMPROVE_PRICING/REDUCE_COSTS/OPTIMIZE_FEES/SHIFT_CATEGORY_MIX/EXIT actions.
// Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira VOLUME per
// source) — ta maksimizira MARGIN % (ne število trades). Razlika od
// deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per HELD item) —
// ta maksimizira margin PER SOURCE (ne per item). Razlika od profit-scale-
// engine (v8.02 ki scale-a cel business) — ta daje PER-SOURCE margin
// maximization z marginUplift in sourceMarginRanking. Razlika od
// profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ta
// fokusira na MARGIN % per source z marginMaximizationLevers. Razlika od
// revenue-growth-maximizer (v8.01 ki maksimizira revenue growth) — ta
// maksimizira MARGIN % (ne revenue), z margin uplift per source.
//
// "Sources: Bolha avgMargin 45%, avgMarkup 82%, profit 2400€, trend INCREASING.
// Vinted avgMargin 22%, avgMarkup 28%, profit 380€, trend DECREASING. Avtonet
// avgMargin 38%, avgMarkup 61%, profit 1800€, trend STABLE. Maximization:
// Bolha IMPROVE_PRICING → projected margin 58% (+13pp uplift) z levers
// (premium pricing +8pp, refurb enhancement +3pp, bundle pricing +2pp).
// Vinted REDUCE_COSTS → projected margin 35% (+13pp uplift). Avtonet
// OPTIMIZE_FEES → projected margin 42% (+4pp uplift). Portfolio: current
// 38% → maximized 47% (+9pp uplift), shift 600€ iz Vinted v Bolha."

// GET+POST /api/ai/deal-source-margin-maximizer
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

type MarginMaximizationAction =
  | 'IMPROVE_PRICING'
  | 'REDUCE_COSTS'
  | 'OPTIMIZE_FEES'
  | 'SHIFT_CATEGORY_MIX'
  | 'EXIT';
type MarginTrend = 'INCREASING' | 'STABLE' | 'DECREASING';

interface SoldTradeRow {
  id: string;
  title: string;
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
  avgMargin: number; // %
  avgMarkup: number; // %
  totalProfit: number; // €
  totalRevenue: number; // €
  marginTrend: MarginTrend;
  tradeCount: number;
}

interface MarginMaximizationLever {
  lever: string;
  currentGap: number; // pp
  potentialGain: number; // pp
  action: string;
}

interface SourceMaximization {
  marginMaximizationAction: MarginMaximizationAction;
  projectedMargin: number; // %
  marginUplift: number; // pp
  marginMaximizationLevers: MarginMaximizationLever[];
  sourceMarginRanking: number;
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  currentPortfolioMargin: number;
  maximizedPortfolioMargin: number;
  totalMarginUplift: number;
  capitalReallocationAdvice: string;
  sourceMarginRanking: Array<{
    source: string;
    currentMargin: number;
    projectedMargin: number;
    rank: number;
  }>;
}

interface DealSourceMarginResponse {
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
      marginMaximizationAction?: MarginMaximizationAction;
      projectedMargin?: number;
      marginMaximizationLevers?: Array<{
        lever?: string;
        currentGap?: number;
        potentialGain?: number;
        action?: string;
      }>;
    };
  }>;
  portfolio?: {
    capitalReallocationAdvice?: string;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const MARGIN_MIN = -50;
const MARGIN_MAX = 100;
const MARKUP_MIN = -50;
const MARKUP_MAX = 500;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const GAP_MIN = 0;
const GAP_MAX = 100;
const GAIN_MIN = 0;
const GAIN_MAX = 50;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const MAX_LEVERS_PER_SOURCE = 4;

const VALID_ACTION: readonly MarginMaximizationAction[] = [
  'IMPROVE_PRICING',
  'REDUCE_COSTS',
  'OPTIMIZE_FEES',
  'SHIFT_CATEGORY_MIX',
  'EXIT',
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

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
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
  cost: number;
  revenue: number; // sellPrice - sellFees
  profit: number;
  margin: number; // profit / revenue * 100
  markup: number; // profit / cost * 100
  date: number;
}

function computeTrade(t: SoldTradeRow): TradeComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const cost = buyPrice + buyFees;
  const revenue = sellPrice - sellFees;
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const markup = cost > 0 ? (profit / cost) * 100 : 0;
  const date = toMs(t.sellDate) || toMs(t.buyDate);
  const source = detectSource(t);
  return { source, cost, revenue, profit, margin, markup, date };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  margins: number[];
  markups: number[];
  dates: number[];
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
        totalRevenue: 0,
        totalCost: 0,
        margins: [],
        markups: [],
        dates: [],
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalProfit += tr.profit;
    agg.totalRevenue += Math.max(0, tr.revenue);
    agg.totalCost += tr.cost;
    agg.margins.push(tr.margin);
    agg.markups.push(tr.markup);
    agg.dates.push(tr.date);
  }
  return map;
}

function computeTrend(trades: TradeComputed[]): MarginTrend {
  if (trades.length < 4) return 'STABLE';
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const avgFirst = avg(first.map((t) => t.margin));
  const avgSecond = avg(second.map((t) => t.margin));
  if (avgFirst === 0) return avgSecond > 0 ? 'INCREASING' : 'STABLE';
  const ratio = avgSecond / avgFirst;
  if (ratio >= 1.10) return 'INCREASING';
  if (ratio <= 0.90) return 'DECREASING';
  return 'STABLE';
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const avgMargin = round2(clampNum(avg(agg.margins), MARGIN_MIN, MARGIN_MAX, 0));
  const avgMarkup = round2(clampNum(avg(agg.markups), MARKUP_MIN, MARKUP_MAX, 0));
  const totalProfit = round0(clampNum(
    Math.max(0, agg.totalProfit),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const totalRevenue = round0(clampNum(
    Math.max(0, agg.totalRevenue),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const marginTrend = computeTrend(agg.trades);
  return {
    avgMargin,
    avgMarkup,
    totalProfit,
    totalRevenue,
    marginTrend,
    tradeCount,
  };
}

function decideMarginAction(metrics: SourceMetrics): MarginMaximizationAction {
  // EXIT: negative margin consistently
  if (metrics.avgMargin < 0) {
    return 'EXIT';
  }
  // REDUCE_COSTS: low margin → cut sourcing costs
  if (metrics.avgMargin < 25) {
    return 'REDUCE_COSTS';
  }
  // SHIFT_CATEGORY_MIX: low markup despite decent margin → wrong categories
  if (metrics.avgMarkup < 30 && metrics.avgMargin >= 25) {
    return 'SHIFT_CATEGORY_MIX';
  }
  // OPTIMIZE_FEES: high margin but low markup → fees are eating profit
  if (metrics.avgMargin > 50 && metrics.avgMarkup < 60) {
    return 'OPTIMIZE_FEES';
  }
  // IMPROVE_PRICING: default — improve pricing strategy
  return 'IMPROVE_PRICING';
}

function buildMarginLevers(metrics: SourceMetrics): MarginMaximizationLever[] {
  const levers: MarginMaximizationLever[] = [];

  // Pricing lever — premium positioning
  const pricingGap = round0(clampNum(
    Math.max(0, 60 - metrics.avgMargin),
    GAP_MIN, GAP_MAX, 30,
  ));
  const pricingGain = round2(clampNum(
    pricingGap * 0.18,
    GAIN_MIN, GAIN_MAX, 5,
  ));
  levers.push({
    lever: 'Premium Pricing',
    currentGap: pricingGap,
    potentialGain: pricingGain,
    action: clampString(
      `Dvigni cene za 5-10% z premium pozicioniranjem (boljše fotografije, certifikati, refurbished enhancement).`,
      200,
      'Dvigni prodajne cene z premium strategy.',
    ),
  });

  // Sourcing cost lever
  const costGap = round0(clampNum(
    Math.max(0, 35 - metrics.avgMarkup),
    GAP_MIN, GAP_MAX, 20,
  ));
  const costGain = round2(clampNum(
    costGap * 0.22,
    GAIN_MIN, GAIN_MAX, 5,
  ));
  levers.push({
    lever: 'Sourcing Cost',
    currentGap: costGap,
    potentialGain: costGain,
    action: clampString(
      `Negotiate nižje nabavne cene (target -10% pri buy-ih nad 100€) in batch sourcing ob vikendih.`,
      200,
      'Negotiate nižje nabavne cene.',
    ),
  });

  // Fees lever
  const feesGap = round0(clampNum(
    12, // typical platform fees 5-12%
    GAP_MIN, GAP_MAX, 12,
  ));
  const feesGain = round2(clampNum(
    feesGap * 0.12,
    GAIN_MIN, GAIN_MAX, 3,
  ));
  levers.push({
    lever: 'Platform Fees',
    currentGap: feesGap,
    potentialGain: feesGain,
    action: clampString(
      `Cross-post na platforme z nižjimi fees (Vinted 0€ listing + Bolha direktno) ali direktna prodaja (cash).`,
      200,
      'Zmanjšaj platform fees.',
    ),
  });

  // Category mix lever
  const mixGap = round0(clampNum(
    Math.max(0, 25 - metrics.avgMargin),
    GAP_MIN, GAP_MAX, 15,
  ));
  const mixGain = round2(clampNum(
    mixGap * 0.15,
    GAIN_MIN, GAIN_MAX, 3,
  ));
  levers.push({
    lever: 'Category Mix',
    currentGap: mixGap,
    potentialGain: mixGain,
    action: clampString(
      `Premakni sourcing v high-margin kategorije (elektronika, premium fashion) iz low-margin (komoditete).`,
      200,
      'Premakni se v high-margin kategorije.',
    ),
  });

  return levers.slice(0, MAX_LEVERS_PER_SOURCE);
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideMarginAction(metrics);
  const levers = buildMarginLevers(metrics);

  // Total gain = sum of lever potentialGains
  const totalGain = Math.min(GAIN_MAX, levers.reduce((s, l) => s + l.potentialGain, 0));

  // Action factor: how much of the gap can be realized
  const actionFactor: Record<MarginMaximizationAction, number> = {
    IMPROVE_PRICING: 0.7,
    REDUCE_COSTS: 0.6,
    OPTIMIZE_FEES: 0.5,
    SHIFT_CATEGORY_MIX: 0.4,
    EXIT: 0,
  };

  let marginUplift = round2(clampNum(
    totalGain * actionFactor[action],
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Anti-hallucination: uplift can't exceed 50% of current margin (max 25pp absolute)
  if (metrics.avgMargin > 0) {
    marginUplift = round2(Math.min(marginUplift, Math.max(8, metrics.avgMargin * 0.5)));
  } else {
    marginUplift = round2(Math.min(marginUplift, 25));
  }

  // Trend adjustment: DECREASING sources get less uplift (need to stabilize first)
  if (metrics.marginTrend === 'DECREASING') {
    marginUplift = round2(marginUplift * 0.7);
  }

  const projectedMargin = round2(clampNum(
    Math.max(metrics.avgMargin, metrics.avgMargin + marginUplift),
    MARGIN_MIN, MARGIN_MAX, metrics.avgMargin,
  ));

  return {
    marginMaximizationAction: action,
    projectedMargin,
    marginUplift,
    marginMaximizationLevers: levers,
    sourceMarginRanking: 0, // will be set in buildSourceEntries
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
  // Sort by projectedMargin desc
  entries.sort((a, b) => b.maximization.projectedMargin - a.maximization.projectedMargin);
  // Assign sourceMarginRanking (1 = best)
  for (let i = 0; i < entries.length; i++) {
    entries[i].maximization.sourceMarginRanking = i + 1;
  }
  return entries;
}

function buildPortfolio(
  entries: SourceEntry[],
  totalRevenueAll: number,
): PortfolioSummary {
  // Weighted avg margin by totalRevenue
  const currentPortfolioMargin = totalRevenueAll > 0
    ? round2(clampNum(
      entries.reduce(
        (s, e) => s + e.metrics.avgMargin * e.metrics.totalRevenue,
        0,
      ) / totalRevenueAll,
      MARGIN_MIN, MARGIN_MAX, 0,
    ))
    : 0;

  const maximizedPortfolioMargin = totalRevenueAll > 0
    ? round2(clampNum(
      entries.reduce(
        (s, e) => s + e.maximization.projectedMargin * e.metrics.totalRevenue,
        0,
      ) / totalRevenueAll,
      MARGIN_MIN, MARGIN_MAX, 0,
    ))
    : 0;

  const totalMarginUplift = round2(clampNum(
    maximizedPortfolioMargin - currentPortfolioMargin,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Source margin ranking by projected margin
  const sourceMarginRanking = entries
    .map((e, idx) => ({
      source: e.source,
      currentMargin: e.metrics.avgMargin,
      projectedMargin: e.maximization.projectedMargin,
      rank: idx + 1,
    }))
    .sort((a, b) => b.projectedMargin - a.projectedMargin)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  // Capital reallocation advice
  const topSource = sourceMarginRanking[0];
  const bottomSource = sourceMarginRanking[sourceMarginRanking.length - 1];
  const capitalReallocationAdvice = topSource && bottomSource && topSource.source !== bottomSource.source
    ? clampString(
      `Premakni kapital iz ${displayName(bottomSource.source)} (margin ${bottomSource.currentMargin}% → projected ${bottomSource.projectedMargin}%) v ${displayName(topSource.source)} (margin ${topSource.currentMargin}% → projected ${topSource.projectedMargin}%). Realokacija +25% kapitala v ${displayName(topSource.source)} poveča portfolio margin za ~${round2(totalMarginUplift * 0.3)}pp.`,
      400,
      `Premakni kapital v višje-margin source.`,
    )
    : clampString(
      `Ohrani kapital distribucijo — vsi source-i imajo podobno projekcijo margin.`,
      400,
      `Ohrani kapital distribucijo.`,
    );

  return {
    currentPortfolioMargin,
    maximizedPortfolioMargin,
    totalMarginUplift,
    capitalReallocationAdvice,
    sourceMarginRanking,
  };
}

function buildSummary(
  entries: SourceEntry[],
  portfolio: PortfolioSummary,
): string {
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio margin: ${portfolio.currentPortfolioMargin}% → ${portfolio.maximizedPortfolioMargin}% (+${portfolio.totalMarginUplift}pp uplift).`,
    `Top: ${portfolio.sourceMarginRanking[0]?.source ?? 'n/a'} (projected ${portfolio.sourceMarginRanking[0]?.projectedMargin ?? 0}%).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceMarginMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceMarginMaximizer(req);
}

async function handleDealSourceMarginMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-margin-maximizer', 20);
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
        title: true,
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
          currentPortfolioMargin: 0,
          maximizedPortfolioMargin: 0,
          totalMarginUplift: 0,
          capitalReallocationAdvice: 'Ni SOLD trgovin — Deal Source Margin Maximizer ni mogoč.',
          sourceMarginRanking: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Margin Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Margin Maximizer ni mogoč.',
      } satisfies DealSourceMarginResponse);
    }

    // 2) Compute per-trade metrics and aggregate by source
    const computed: TradeComputed[] = [];
    for (const t of soldTrades) {
      const c = computeTrade(t);
      if (c) computed.push(c);
    }

    if (computed.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        portfolio: {
          currentPortfolioMargin: 0,
          maximizedPortfolioMargin: 0,
          totalMarginUplift: 0,
          capitalReallocationAdvice: 'Ni veljavnih SOLD trgovin — Deal Source Margin Maximizer ni mogoč.',
          sourceMarginRanking: [],
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Margin Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Margin Maximizer ni mogoč.',
      } satisfies DealSourceMarginResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);

    const totalRevenueAll = computed.reduce((s, c) => s + c.revenue, 0);
    let portfolio = buildPortfolio(entries, totalRevenueAll);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-margin-maximizer:${currentMonth}`;
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
      } satisfies DealSourceMarginResponse);
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
      deterministicMaximization: {
        marginMaximizationAction: e.maximization.marginMaximizationAction,
        projectedMargin: e.maximization.projectedMargin,
        marginUplift: e.maximization.marginUplift,
        marginMaximizationLevers: e.maximization.marginMaximizationLevers,
      },
    }));

    const promptData = {
      totalTrades: computed.length,
      totalSources: entries.length,
      sources: sourcesForAI,
      deterministicPortfolio: {
        currentPortfolioMargin: portfolio.currentPortfolioMargin,
        maximizedPortfolioMargin: portfolio.maximizedPortfolioMargin,
        totalMarginUplift: portfolio.totalMarginUplift,
      },
      caps: {
        marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
        markupMin: MARKUP_MIN, markupMax: MARKUP_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        gapMin: GAP_MIN, gapMax: GAP_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Margin Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT MARGIN % MAXIMIZATION per deal source — identificiraš kateri source-i imajo najvišje margins in kako iz njih izvleči MAXIMUM margin %. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ti MAKSIMIZIRAŠ MARGIN % per source (ne ROI %), z marginMaximizationAction (IMPROVE_PRICING/REDUCE_COSTS/OPTIMIZE_FEES/SHIFT_CATEGORY_MIX/EXIT) in marginMaximizationLevers. Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ti maksimiziraš MARGIN % z levers, ne total profit €. Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira VOLUME per source) — ti maksimiziraš MARGIN % (ne število trades). Razlika od deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per HELD item) — ti maksimiziraš margin PER SOURCE (ne per item). Razlika od profit-scale-engine (v8.02 ki scale-a cel business) — ti daje PER-SOURCE margin maximization z marginUplift in sourceMarginRanking. Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na MARGIN % per source z marginMaximizationLevers. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira revenue growth) — ti maksimiziraš MARGIN % (ne revenue), z margin uplift per source.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.marginMaximizationAction: IMPROVE_PRICING | REDUCE_COSTS | OPTIMIZE_FEES | SHIFT_CATEGORY_MIX | EXIT (lahko se razlikuje od deterministic),
   - maximization.projectedMargin % [-50, 100] (≥ currentMargin, ≤ currentMargin × 1.5 ali +25pp absolute — anti-hallucination),
   - maximization.marginMaximizationLevers: 2-4 levers { lever (max 50), currentGap pp [0, 100], potentialGain pp [0, 50], action (max 200, slovenski) },
2. portfolio.capitalReallocationAdvice (max 400, slovenski).
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "marginMaximizationAction": "IMPROVE_PRICING",
        "projectedMargin": 58,
        "marginMaximizationLevers": [
          { "lever": "Premium Pricing", "currentGap": 15, "potentialGain": 8, "action": "Dvigni cene za 5%." },
          { "lever": "Sourcing Cost", "currentGap": 20, "potentialGain": 5, "action": "Negotiate -10%." }
        ]
      }
    }
  ],
  "portfolio": {
    "capitalReallocationAdvice": "Premakni kapital iz Vinted (margin 22%) v Bolha (margin 45%)."
  },
  "summary": "3 source-i. Portfolio margin: 38% → 47% (+9pp uplift). Top: Bolha (58%)."
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
            aiMax.marginMaximizationAction,
            VALID_ACTION,
            det.maximization.marginMaximizationAction,
          );

          // Anti-hallucination: projectedMargin ∈ [currentMargin, currentMargin × 1.5 or +25pp]
          const maxMarginBound = Math.min(
            MARGIN_MAX,
            Math.max(
              det.metrics.avgMargin + 5,
              Math.min(det.metrics.avgMargin * 1.5 + 10, det.metrics.avgMargin + 25),
            ),
          );
          const projectedMargin = round2(clampNum(
            aiMax.projectedMargin,
            det.metrics.avgMargin, maxMarginBound,
            det.maximization.projectedMargin,
          ));
          const marginUplift = round2(clampNum(
            projectedMargin - det.metrics.avgMargin,
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          // Levers
          const levers: MarginMaximizationLever[] = [];
          if (Array.isArray(aiMax.marginMaximizationLevers)) {
            for (const l of aiMax.marginMaximizationLevers.slice(0, MAX_LEVERS_PER_SOURCE)) {
              if (!l || typeof l !== 'object') continue;
              levers.push({
                lever: clampString(l.lever, 50, 'Lever'),
                currentGap: round0(clampNum(
                  l.currentGap, GAP_MIN, GAP_MAX, 0,
                )),
                potentialGain: round2(clampNum(
                  l.potentialGain, GAIN_MIN, GAIN_MAX, 0,
                )),
                action: clampString(l.action, 200, 'Akcija.'),
              });
            }
          }
          if (levers.length === 0) {
            for (const l of det.maximization.marginMaximizationLevers) levers.push(l);
          }

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              marginMaximizationAction: action,
              projectedMargin,
              marginUplift,
              marginMaximizationLevers: levers,
              sourceMarginRanking: det.maximization.sourceMarginRanking,
            },
          });
        }

        if (newEntries.length === entries.length) {
          entries = newEntries;
        }

        // Rebuild portfolio with new entries
        portfolio = buildPortfolio(entries, totalRevenueAll);

        // Override capitalReallocationAdvice if AI provided
        if (parsed.portfolio?.capitalReallocationAdvice) {
          portfolio = {
            ...portfolio,
            capitalReallocationAdvice: clampString(
              parsed.portfolio.capitalReallocationAdvice,
              400,
              portfolio.capitalReallocationAdvice,
            ),
          };
        }

        summary = clampString(parsed.summary, 400, buildSummary(entries, portfolio));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-margin-maximizer',
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
    } satisfies DealSourceMarginResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-margin-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
