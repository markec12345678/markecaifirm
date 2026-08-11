// v8.11: AI Deal Source Profit Per Day Maximizer — AI MAKSIMIZIRA PROFIT
// PER DAY per source — koliko €/dan vsak source generira. "Bolha generira
// 15€/dan v profit, Vinted generira 8€/dan — ampak bi lahko bilo 25€/dan in
// 14€/dan." Razlika od deal-source-profit-velocity-maximizer (v8.08 ki
// maksimizira velocity profit-a per source — €/teden kako hitro profit kopiči)
// — ta MAKSIMIZIRA PROFIT PER DAY per source (€/dan = totalProfit/365, ne
// €/teden velocity). Razlika od deal-source-annual-return-maximizer (v8.10 ki
// maksimizira annualized return per source z benchmark primerjavo) — ta
// MAKSIMIZIRA PROFIT PER DAY per source (€/dan absolute, ne % annual return).
// Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit
// per source) — ta MAKSIMIZIRA PROFIT PER DAY per source (€/dan normalized
// za čas, ne € total). Razlika od deal-source-cash-flow-maximizer (v8.06 ki
// maksimizira NET CASH FLOW per source) — ta MAKSIMIZIRA PROFIT PER DAY
// (€/dan profit rate, ne € net cash flow). Razlika od
// deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per
// trade per source €) — ta MAKSIMIZIRA PROFIT PER DAY per source (€/dan
// normalized, ne €/trade). Razlika od deal-source-margin-maximizer (v8.03 ki
// maksimizira margin %) — ta MAKSIMIZIRA PROFIT PER DAY per source z
// dailyProfitMaximizationAction (INCREASE_TRADE_FREQUENCY/INCREASE_PROFIT_
// PER_TRADE/REDUCE_HOLD_TIME/OPTIMIZE_PRICING) in dailyProfitProjection.
// Razlika od deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira
// capital efficiency per source) — ta MAKSIMIZIRA PROFIT PER DAY per source
// (€/dan, ne profit per euro per day). Razlika od deal-source-volume-
// maximizer (v8.02 ki maksimizira trade volume per source) — ta MAKSIMIZIRA
// PROFIT PER DAY per source (€/dan normalized, ne trade volume). Razlika od
// deal-source-revenue-maximizer (v8.07 ki maksimizira total revenue per
// source) — ta MAKSIMIZIRA PROFIT PER DAY (profit/365, ne top-line revenue).
// Razlika od deal-source-capital-return-maximizer (v8.09 ki maksimizira
// capital return rate per source) — ta MAKSIMIZIRA PROFIT PER DAY per source
// (€/dan absolute, ne % capital returned). Razlika od
// profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira daily
// profit z scalingPath) — ta MAKSIMIZIRA PROFIT PER DAY PER SOURCE z
// profitPerDayRanking in dailyProfitProjection (7/14/30 dan). Razlika od
// inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per
// item) — ta MAKSIMIZIRA PROFIT PER DAY per SOLD SOURCE (per source daily
// profit, ne per item daily profit). Razlika od profit-velocity-maximizer
// (v7.98 ki maksimizira €/day velocity čez portfolio) — ta MAKSIMIZIRA
// PROFIT PER DAY PER SOURCE (per source ranking, ne portfolio velocity).

// GET+POST /api/ai/deal-source-profit-per-day-maximizer
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

type DailyProfitAction =
  | 'INCREASE_TRADE_FREQUENCY'
  | 'INCREASE_PROFIT_PER_TRADE'
  | 'REDUCE_HOLD_TIME'
  | 'OPTIMIZE_PRICING';
type ProfitPerDayTrend =
  | 'ACCELERATING'
  | 'STABLE'
  | 'DECLINING'
  | 'INSUFFICIENT_DATA';

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
  totalProfit: number; // € = sum(sellPrice − sellFees − buyPrice − buyFees)
  profitPerDay: number; // €/day = totalProfit / 365
  tradesPerDay: number; // trades/day = tradeCount / 365
  avgProfitPerTrade: number; // € = totalProfit / tradeCount
  tradeCount: number;
  avgHoldDays: number;
  profitPerDayTrend: ProfitPerDayTrend;
}

interface DailyProfitProjection {
  days: number; // 7, 14, 30
  projectedProfit: number; // € = maximizedProfitPerDay × days
}

interface SourceMaximization {
  dailyProfitMaximizationAction: DailyProfitAction;
  maximizedProfitPerDay: number; // €/day optimal achievable
  dailyProfitUplift: number; // €/day improvement = maximized − current
  maximizationLevers: string[]; // 3-5 specific levers per source (slovenski)
  dailyProfitProjection: DailyProfitProjection[]; // 7/14/30 day forecast
  profitPerDayRank: number; // rank among sources
  profitPerDayScore: number; // [0, 100] normalized score
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  totalCurrentDailyProfit: number; // €/day = sum(profitPerDay)
  totalMaximizedDailyProfit: number; // €/day = sum(maximizedProfitPerDay)
  totalDailyProfitUplift: number; // €/day = maximized − current
  profitPerDayRanking: Array<{
    source: string;
    displayName: string;
    currentProfitPerDay: number; // €/day
    maximizedProfitPerDay: number; // €/day
    rank: number;
  }>;
  bestDailyProfitSource: string;
}

interface DealSourceProfitPerDayResponse {
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
      dailyProfitMaximizationAction?: DailyProfitAction;
      maximizedProfitPerDay?: number;
      dailyProfitUplift?: number;
      maximizationLevers?: string[];
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const DAYS_PER_YEAR = 365;

const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const DAILY_PROFIT_MIN = 0;
const DAILY_PROFIT_MAX = 5000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 5000;
const HOLD_MIN = 1;
const HOLD_MAX = 730;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const AVG_PROFIT_PER_TRADE_MIN = 0;
const AVG_PROFIT_PER_TRADE_MAX = 5000;
const TRADES_PER_DAY_MIN = 0;
const TRADES_PER_DAY_MAX = 100;

// Per-action uplift % gain (relative improvement to current profit per day)
// Anti-hallucination: maximized ∈ [current, current × 3] and ≤ 5000 €/day
const ACTION_GAIN_PCT: Record<DailyProfitAction, number> = {
  INCREASE_TRADE_FREQUENCY: 50, // +50% by more trades per day
  INCREASE_PROFIT_PER_TRADE: 40, // +40% by higher profit per trade
  REDUCE_HOLD_TIME: 30, // +30% by faster cycle
  OPTIMIZE_PRICING: 25, // +25% by optimal pricing
};

const MAX_LEVERS = 5;
const MAX_PROJECTIONS = 3;
const MAX_TRADES_FOR_AI = 250;

const VALID_ACTION: readonly DailyProfitAction[] = [
  'INCREASE_TRADE_FREQUENCY',
  'INCREASE_PROFIT_PER_TRADE',
  'REDUCE_HOLD_TIME',
  'OPTIMIZE_PRICING',
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
  holdDays: number;
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
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  const source = detectSource(t);
  return { source, profit, holdDays, sellMs, within12m };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalProfit: number;
  totalHoldDays: number;
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
        totalHoldDays: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalProfit += tr.profit;
    agg.totalHoldDays += tr.holdDays;
  }
  return map;
}

// Determine trend based on monthly profit per source (last 6m vs first 6m)
function decideTrend(agg: SourceAgg): ProfitPerDayTrend {
  if (agg.trades.length < 6) return 'INSUFFICIENT_DATA';
  const now = Date.now();
  const sixMonthsAgo = now - (180 * DAY_MS);
  const recent = agg.trades.filter((t) => t.sellMs >= sixMonthsAgo);
  const older = agg.trades.filter((t) => t.sellMs < sixMonthsAgo);
  if (recent.length === 0 || older.length === 0) return 'INSUFFICIENT_DATA';
  const recentAvg = recent.reduce((s, t) => s + t.profit, 0) / recent.length;
  const olderAvg = older.reduce((s, t) => s + t.profit, 0) / older.length;
  if (recentAvg > olderAvg * 1.15) return 'ACCELERATING';
  if (recentAvg < olderAvg * 0.85) return 'DECLINING';
  return 'STABLE';
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalProfit = round0(clampNum(
    agg.totalProfit, PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const profitPerDay = round2(clampNum(
    totalProfit / DAYS_PER_YEAR,
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, 0,
  ));
  const tradesPerDay = round4(clampNum(
    tradeCount / DAYS_PER_YEAR,
    TRADES_PER_DAY_MIN, TRADES_PER_DAY_MAX, 0,
  ));
  const avgProfitPerTrade = round2(clampNum(
    tradeCount > 0 ? totalProfit / tradeCount : 0,
    AVG_PROFIT_PER_TRADE_MIN, AVG_PROFIT_PER_TRADE_MAX, 0,
  ));
  const avgHoldDays = round0(clampNum(
    tradeCount > 0 ? agg.totalHoldDays / tradeCount : 0,
    tradeCount > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
  ));
  const profitPerDayTrend = decideTrend(agg);

  return {
    totalProfit,
    profitPerDay,
    tradesPerDay,
    avgProfitPerTrade,
    tradeCount,
    avgHoldDays,
    profitPerDayTrend,
  };
}

function round4(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10000) / 10000;
}

function decideAction(metrics: SourceMetrics): DailyProfitAction {
  // Low trade frequency → INCREASE_TRADE_FREQUENCY
  if (metrics.tradesPerDay < 0.05) return 'INCREASE_TRADE_FREQUENCY';
  // Low profit per trade → INCREASE_PROFIT_PER_TRADE
  if (metrics.avgProfitPerTrade < 20) return 'INCREASE_PROFIT_PER_TRADE';
  // Slow turnover (>45 days) → REDUCE_HOLD_TIME
  if (metrics.avgHoldDays > 45) return 'REDUCE_HOLD_TIME';
  // Default → OPTIMIZE_PRICING
  return 'OPTIMIZE_PRICING';
}

function buildLevers(metrics: SourceMetrics, action: DailyProfitAction): string[] {
  const levers: string[] = [];
  levers.push(`Trenutno ${metrics.profitPerDay.toFixed(2)}€/dan (${metrics.totalProfit}€ profit / 365 dni, ${metrics.tradeCount} trades, ${metrics.avgProfitPerTrade.toFixed(2)}€/trade, ${metrics.avgHoldDays}d hold, ${metrics.tradesPerDay.toFixed(4)} trades/dan, trend ${metrics.profitPerDayTrend}).`);
  switch (action) {
    case 'INCREASE_TRADE_FREQUENCY':
      levers.push(`Povečaj trade frequency z ${metrics.tradesPerDay.toFixed(4)} na ${(metrics.tradesPerDay * 1.5).toFixed(4)} trades/dan — dodaj 3 nove monitorje, znižaj deal score threshold z 70 na 60, omogoči auto-buy za deal score > 85 (+50% daily profit).`);
      levers.push('Aktiviraj cross-border sourcing (Kleinanzeigen, Subito, Willhaben) za 15-25% višji deal flow in več trades/dan.');
      levers.push('Vklopi AI deal flow priority queue — najboljši deals procesiraj najprej za hitrejši turnover.');
      break;
    case 'INCREASE_PROFIT_PER_TRADE':
      levers.push(`Dvigni profit per trade z ${metrics.avgProfitPerTrade.toFixed(2)}€ na ${(metrics.avgProfitPerTrade * 1.4).toFixed(2)}€ z AI pricing engine, premium fotografijo in dynamic pricing (+40% daily profit z istim volume).`);
      levers.push('Negotiate harder z AI negotiation-playbook — +10% close rate z boljšim offer timing in premium listing.');
      levers.push('Prestavi se v premium niche kategorije (luxury watches, designer bags) z višjim absolute margin.');
      break;
    case 'REDUCE_HOLD_TIME':
      levers.push(`Skrajšaj avg hold time z ${metrics.avgHoldDays} na ${Math.round(metrics.avgHoldDays * 0.6)} dni z listing-refresh-scheduler, auto-relisting in dynamic pricing — +30% daily profit z faster capital recycling.`);
      levers.push('Vklopi optimal-time AI za najboljše listing windows (petek 18h, nedelja 20h) — +18% close rate in hitrejša prodaja.');
      levers.push('Bundle slow-movers z best-sellers za hitrejšo celotno prodajo inventory.');
      break;
    case 'OPTIMIZE_PRICING':
      levers.push('Vklopi AI pricing engine in dynamic pricing — optimal pricing za vsak listing glede na demand, supply in seasonal trend (+25% daily profit z istim volume).');
      levers.push('Implementiraj price-elasticity model per kategorijo — premium niche višje cene, commodity nižje cene z večjim volume.');
      levers.push('A/B test listing prices za optimal close rate in maximum profit per trade.');
      break;
  }
  return levers.slice(0, MAX_LEVERS);
}

function buildProjection(maximizedProfitPerDay: number): DailyProfitProjection[] {
  const projections: DailyProfitProjection[] = [];
  for (const days of [7, 14, 30]) {
    projections.push({
      days,
      projectedProfit: round0(clampNum(
        maximizedProfitPerDay * days,
        0, 200_000, 0,
      )),
    });
  }
  return projections.slice(0, MAX_PROJECTIONS);
}

function computeProfitPerDayScore(
  profitPerDay: number,
  maxProfitPerDay: number,
): number {
  if (maxProfitPerDay <= 0) return 0;
  const score = (profitPerDay / maxProfitPerDay) * 100;
  return round0(clampNum(score, SCORE_MIN, SCORE_MAX, 0));
}

function buildSourceMaximization(
  metrics: SourceMetrics,
  rank: number,
  maxProfitPerDay: number,
): SourceMaximization {
  const action = decideAction(metrics);
  const gainPct = ACTION_GAIN_PCT[action];

  // Anti-hallucination: maximized ∈ [current, min(current × 3, 5000)]
  const minBound = Math.max(DAILY_PROFIT_MIN, metrics.profitPerDay);
  const maxBound = Math.min(
    DAILY_PROFIT_MAX,
    Math.max(metrics.profitPerDay * 3, metrics.profitPerDay + 100),
  );
  const maximizedProfitPerDay = round2(clampNum(
    metrics.profitPerDay * (1 + gainPct / 100),
    minBound, maxBound,
    metrics.profitPerDay,
  ));
  const dailyProfitUplift = round2(clampNum(
    Math.max(0, maximizedProfitPerDay - metrics.profitPerDay),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const maximizationLevers = buildLevers(metrics, action);
  const dailyProfitProjection = buildProjection(maximizedProfitPerDay);
  const profitPerDayScore = computeProfitPerDayScore(
    metrics.profitPerDay, maxProfitPerDay,
  );

  return {
    dailyProfitMaximizationAction: action,
    maximizedProfitPerDay,
    dailyProfitUplift,
    maximizationLevers,
    dailyProfitProjection,
    profitPerDayRank: rank,
    profitPerDayScore,
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization: {} as SourceMaximization, // filled in 2nd pass
    });
  }
  // Sort by profitPerDay desc (best source first)
  entries.sort((a, b) => b.metrics.profitPerDay - a.metrics.profitPerDay);
  const maxProfitPerDay = entries.length > 0 ? entries[0].metrics.profitPerDay : 0;
  // 2nd pass: fill in maximization with rank
  for (let i = 0; i < entries.length; i++) {
    entries[i].maximization = buildSourceMaximization(
      entries[i].metrics, i + 1, maxProfitPerDay,
    );
  }
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  const totalCurrentDailyProfit = round2(clampNum(
    entries.reduce((s, e) => s + e.metrics.profitPerDay, 0),
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX * entries.length, 0,
  ));
  const totalMaximizedDailyProfit = round2(clampNum(
    entries.reduce((s, e) => s + e.maximization.maximizedProfitPerDay, 0),
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX * entries.length, 0,
  ));
  const totalDailyProfitUplift = round2(clampNum(
    Math.max(0, totalMaximizedDailyProfit - totalCurrentDailyProfit),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const profitPerDayRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentProfitPerDay: e.metrics.profitPerDay,
    maximizedProfitPerDay: e.maximization.maximizedProfitPerDay,
    rank: idx + 1,
  }));

  const bestEntry = entries[0];
  const bestDailyProfitSource = bestEntry ? bestEntry.source : '';

  return {
    totalCurrentDailyProfit,
    totalMaximizedDailyProfit,
    totalDailyProfitUplift,
    profitPerDayRanking,
    bestDailyProfitSource,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Profit Per Day Maximizer ni mogoč.';
  }
  const best = entries[0];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio daily profit: ${portfolio.totalCurrentDailyProfit.toFixed(2)}€/dan → ${portfolio.totalMaximizedDailyProfit.toFixed(2)}€/dan (+${portfolio.totalDailyProfitUplift.toFixed(2)}€/dan uplift).`,
    `Best: ${best.displayName} (${best.metrics.profitPerDay.toFixed(2)}€/dan → ${best.maximization.maximizedProfitPerDay.toFixed(2)}€/dan).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceProfitPerDayMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceProfitPerDayMaximizer(req);
}

async function handleDealSourceProfitPerDayMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-profit-per-day-maximizer', 20);
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
          totalCurrentDailyProfit: 0,
          totalMaximizedDailyProfit: 0,
          totalDailyProfitUplift: 0,
          profitPerDayRanking: [],
          bestDailyProfitSource: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Per Day Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Per Day Maximizer ni mogoč.',
      } satisfies DealSourceProfitPerDayResponse);
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
          totalCurrentDailyProfit: 0,
          totalMaximizedDailyProfit: 0,
          totalDailyProfitUplift: 0,
          profitPerDayRanking: [],
          bestDailyProfitSource: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Profit Per Day Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Profit Per Day Maximizer ni mogoč.',
      } satisfies DealSourceProfitPerDayResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-profit-per-day-maximizer:${currentMonth}`;
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
      } satisfies DealSourceProfitPerDayResponse);
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
        totalCurrentDailyProfit: portfolio.totalCurrentDailyProfit,
        totalMaximizedDailyProfit: portfolio.totalMaximizedDailyProfit,
        totalDailyProfitUplift: portfolio.totalDailyProfitUplift,
        profitPerDayRanking: portfolio.profitPerDayRanking,
        bestDailyProfitSource: portfolio.bestDailyProfitSource,
      },
      caps: {
        dailyProfitMin: DAILY_PROFIT_MIN, dailyProfitMax: DAILY_PROFIT_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        avgProfitPerTradeMin: AVG_PROFIT_PER_TRADE_MIN,
        avgProfitPerTradeMax: AVG_PROFIT_PER_TRADE_MAX,
        tradesPerDayMin: TRADES_PER_DAY_MIN, tradesPerDayMax: TRADES_PER_DAY_MAX,
      },
      actionGainPct: ACTION_GAIN_PCT,
    };

    const prompt = `Si AI "Deal Source Profit Per Day Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER DAY MAXIMIZATION per source — kako maksimizirati PROFIT PER DAY per source (koliko €/dan vsak source generira). Tvoj cilj je "Bolha generira 15€/dan v profit, Vinted generira 8€/dan — ampak bi lahko bilo 25€/dan in 14€/dan." Razlika od deal-source-profit-velocity-maximizer (v8.08 ki maksimizira velocity profit-a per source — €/teden kako hitro profit kopiči) — ti MAKSIMIZIRAŠ PROFIT PER DAY per source (€/dan = totalProfit/365, ne €/teden velocity). Razlika od deal-source-annual-return-maximizer (v8.10 ki maksimizira annualized return per source z benchmark primerjavo) — ti MAKSIMIZIRAŠ PROFIT PER DAY per source (€/dan absolute, ne % annual return). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ti MAKSIMIZIRAŠ PROFIT PER DAY per source (€/dan normalized za čas, ne € total). Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per source) — ti MAKSIMIZIRAŠ PROFIT PER DAY (€/dan profit rate, ne € net cash flow). Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade per source €) — ti MAKSIMIZIRAŠ PROFIT PER DAY per source (€/dan normalized, ne €/trade). Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ti MAKSIMIZIRAŠ PROFIT PER DAY per source z dailyProfitMaximizationAction (INCREASE_TRADE_FREQUENCY/INCREASE_PROFIT_PER_TRADE/REDUCE_HOLD_TIME/OPTIMIZE_PRICING) in dailyProfitProjection. Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira trade volume per source) — ti MAKSIMIZIRAŠ PROFIT PER DAY per source (€/dan normalized, ne trade volume). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ti MAKSIMIZIRAŠ PROFIT PER DAY PER SOURCE z profitPerDayRanking in dailyProfitProjection (7/14/30 dan). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ti MAKSIMIZIRAŠ PROFIT PER DAY per SOLD SOURCE (per source daily profit, ne per item daily profit).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.dailyProfitMaximizationAction: INCREASE_TRADE_FREQUENCY | INCREASE_PROFIT_PER_TRADE | REDUCE_HOLD_TIME | OPTIMIZE_PRICING,
   - maximization.maximizedProfitPerDay €/day [0, 5000] (≥ current profitPerDay, ≤ min(current × 3, 5000) — anti-hallucination),
   - maximization.dailyProfitUplift €/day [0, 5000] (improvement = maximized − current),
   - maximization.maximizationLevers: 3-5 stringov (max 200 vsak, slovenski — specific daily profit levers per source),
   - (dailyProfitProjection 7/14/30 dan in profitPerDayRank in profitPerDayScore se avtomatsko izračunajo v backend-u — AI ne vrača teh),
2. summary: slovenski povzetek (max 500 znakov — poudari total current daily profit, total maximized daily profit, total uplift, best source).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "dailyProfitMaximizationAction": "INCREASE_TRADE_FREQUENCY",
        "maximizedProfitPerDay": 25.0,
        "dailyProfitUplift": 10.0,
        "maximizationLevers": [
          "Povečaj trade frequency z 0.05 na 0.075 trades/dan — dodaj 3 nove monitorje.",
          "Aktiviraj cross-border sourcing za višji deal flow.",
          "Vklopi AI deal flow priority queue."
        ]
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "dailyProfitMaximizationAction": "INCREASE_PROFIT_PER_TRADE",
        "maximizedProfitPerDay": 14.0,
        "dailyProfitUplift": 6.0,
        "maximizationLevers": [
          "Dvigni profit per trade z AI pricing engine.",
          "Negotiate harder z AI negotiation-playbook.",
          "Prestavi se v premium niche kategorije."
        ]
      }
    }
  ],
  "summary": "2 source-a. Portfolio daily profit: 23.00€/dan → 39.00€/dan (+16.00€/dan uplift). Best: Bolha (15.00€/dan → 25.00€/dan)."
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
            aiMax.dailyProfitMaximizationAction,
            VALID_ACTION,
            det.maximization.dailyProfitMaximizationAction,
          );

          // Anti-hallucination: maximized ∈ [current, min(current × 3, 5000)]
          const minBound = Math.max(DAILY_PROFIT_MIN, det.metrics.profitPerDay);
          const maxBound = Math.min(
            DAILY_PROFIT_MAX,
            Math.max(det.metrics.profitPerDay * 3, det.metrics.profitPerDay + 100),
          );
          const maximizedProfitPerDay = round2(clampNum(
            aiMax.maximizedProfitPerDay,
            minBound, maxBound,
            det.maximization.maximizedProfitPerDay,
          ));
          const dailyProfitUplift = round2(clampNum(
            Math.max(0, maximizedProfitPerDay - det.metrics.profitPerDay),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          // maximizationLevers — must be array of strings
          let maximizationLevers = det.maximization.maximizationLevers;
          if (Array.isArray(aiMax.maximizationLevers) &&
              aiMax.maximizationLevers.length >= 2) {
            const aiLevers: string[] = [];
            for (const l of aiMax.maximizationLevers.slice(0, MAX_LEVERS)) {
              aiLevers.push(clampString(l, 200, 'Daily profit lever neopisan.'));
            }
            if (aiLevers.length >= 2) {
              maximizationLevers = aiLevers;
            }
          }

          // Rebuild projection with new maximizedProfitPerDay
          const dailyProfitProjection = buildProjection(maximizedProfitPerDay);

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              dailyProfitMaximizationAction: action,
              maximizedProfitPerDay,
              dailyProfitUplift,
              maximizationLevers,
              dailyProfitProjection,
              profitPerDayRank: det.maximization.profitPerDayRank,
              profitPerDayScore: det.maximization.profitPerDayScore,
            },
          });
        }

        if (newEntries.length === entries.length) {
          entries = newEntries;
        }

        // Rebuild portfolio with new entries
        portfolio = buildPortfolio(entries);

        summary = clampString(parsed.summary, 500, buildSummary(entries, portfolio));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-profit-per-day-maximizer',
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
    } satisfies DealSourceProfitPerDayResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-profit-per-day-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
