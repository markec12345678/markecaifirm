// v8.10: AI Deal Source Annual Return Maximizer — AI MAKSIMIZIRA ANNUALIZED
// RETURN per source — konvertira per-source profit v annualized return rate za
// primerjavo z drugimi investicijami. "Bolha annualized return: 85%, Vinted:
// 42%, ampak bi lahko bila 120% in 68%." Razlika od deal-source-capital-return-
// maximizer (v8.09 ki maksimizira capital return rate per source — % capital
// returned) — ta MAKSIMIZIRA ANNUALIZED RETURN per source (profit / capital ×
// 365 / holdDays, ne % capital returned). Razlika od deal-source-profit-
// velocity-maximizer (v8.08 ki maksimizira velocity profit-a per source —
// €/teden kako hitro profit kopiči) — ta MAKSIMIZIRA ANNUALIZED RETURN per
// source (% annual return primerljiv z stocks/real estate, ne €/teden). Razlika
// od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta
// MAKSIMIZIRA ANNUALIZED RETURN (ROI × 365 / holdDays, time-weighted) z
// returnVsBenchmark in capitalEfficiencyAdvice. Razlika od
// deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per
// source) — ta maksimizira ANNUALIZED RETURN RATE per source (% return, ne €
// cash flow). Razlika od deal-source-revenue-maximizer (v8.07 ki maksimizira
// total revenue per source) — ta maksimizira ANNUALIZED RETURN (profit/capital
// annualized, ne top-line revenue). Razlika od deal-source-profit-maximizer
// (v7.97 ki maksimizira total profit per source) — ta maksimizira ANNUALIZED
// RETURN RATE per source (% annual, ne € profit). Razlika od
// deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade
// €) — ta maksimizira ANNUALIZED RETURN per source (time-weighted %, ne €/trade).
// Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta
// maksimizira ANNUALIZED RETURN per source z returnMaximizationAction in
// returnVsBenchmark. Razlika od deal-source-capital-efficiency-maximizer (v8.05
// ki maksimizira capital efficiency per source = profit per euro per day) — ta
// maksimizira ANNUALIZED RETURN per source (annual %, ne profit per euro per
// day). Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira trade
// volume per source) — ta maksimizira ANNUALIZED RETURN per source (%
// annualized return, ne trade volume). Razlika od inventory-annualized-return-
// maximizer (v8.06 ki maksimizira annualized return na HELD inventory) — ta
// MAKSIMIZIRA ANNUALIZED RETURN per SOLD SOURCE (realized trades, ne held
// inventory). Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit
// per euro deployed čez portfolio) — ta maksimizira ANNUALIZED RETURN per
// source z benchmark primerjavo (stocks 8%, real estate 5%, bonds 3%).

// GET+POST /api/ai/deal-source-annual-return-maximizer
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

type ReturnAction =
  | 'INCREASE_PROFIT'
  | 'REDUCE_CAPITAL'
  | 'FASTER_TURNOVER'
  | 'BETTER_SOURCING';

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
  totalCapitalDeployed: number; // € = sum(buyPrice + buyFees)
  avgHoldDays: number; // days = avg(sellDate − buyDate)
  annualizedReturn: number; // % = (totalProfit / totalCapitalDeployed) × (365 / avgHoldDays) × 100
  tradeCount: number;
  profitMargin: number; // % = totalProfit / totalCapitalDeployed × 100
}

interface ReturnVsBenchmark {
  stocks: number; // % benchmark (~8%)
  realEstate: number; // % benchmark (~5%)
  bonds: number; // % benchmark (~3%)
  yourCurrentReturn: number; // % source's current annualized return
  yourMaximizedReturn: number; // % source's maximized annualized return
  maximizedVsStocks: number; // pp = yourMaximized − stocks
  maximizedVsRealEstate: number; // pp = yourMaximized − realEstate
  maximizedVsBonds: number; // pp = yourMaximized − bonds
}

interface SourceMaximization {
  returnMaximizationAction: ReturnAction;
  maximizedAnnualReturn: number; // % optimal annual return achievable
  returnUplift: number; // pp improvement in annualized return %
  returnMaximizationLevers: string[]; // specific levers per source (slovenski)
  returnVsBenchmark: ReturnVsBenchmark;
  capitalEfficiencyAdvice: string; // how to deploy capital more efficiently (slovenski)
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  currentPortfolioAnnualReturn: number; // %
  maximizedPortfolioAnnualReturn: number; // %
  totalReturnUplift: number; // pp
  sourceReturnRanking: Array<{
    source: string;
    displayName: string;
    currentAnnualReturn: number; // %
    maximizedAnnualReturn: number; // %
    rank: number;
  }>;
  bestReturnSource: string;
}

interface DealSourceAnnualReturnResponse {
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
      returnMaximizationAction?: ReturnAction;
      maximizedAnnualReturn?: number;
      returnUplift?: number;
      returnMaximizationLevers?: string[];
      capitalEfficiencyAdvice?: string;
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const RETURN_MIN = -100;
const RETURN_MAX = 1000;
const HOLD_MIN = 1;
const HOLD_MAX = 730;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 500;
const MARGIN_MIN = -100;
const MARGIN_MAX = 500;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

const BENCHMARK_STOCKS = 8; // % S&P 500 historical avg
const BENCHMARK_REAL_ESTATE = 5; // % avg rental yield
const BENCHMARK_BONDS = 3; // % gov bonds

const VALID_ACTION: readonly ReturnAction[] = [
  'INCREASE_PROFIT',
  'REDUCE_CAPITAL',
  'FASTER_TURNOVER',
  'BETTER_SOURCING',
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
const MAX_TRADES_FOR_AI = 250;

// Action uplift multipliers (how much annualized return gain from each action)
const ACTION_RETURN_GAIN: Record<ReturnAction, number> = {
  INCREASE_PROFIT: 25, // +25pp by higher profit per trade
  REDUCE_CAPITAL: 18, // +18pp by lower buy prices (capital reduction)
  FASTER_TURNOVER: 30, // +30pp by faster sales (higher cycles per year)
  BETTER_SOURCING: 22, // +22pp by cross-border sourcing premium
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
  capital: number; // € = buyPrice + buyFees
  profit: number; // € = (sellPrice − sellFees) − capital
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
  return { source, capital, profit, holdDays, sellMs, within12m };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalCapital: number;
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
        totalCapital: 0,
        totalProfit: 0,
        totalHoldDays: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalCapital += tr.capital;
    agg.totalProfit += tr.profit;
    agg.totalHoldDays += tr.holdDays;
  }
  return map;
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalCapitalDeployed = round0(clampNum(
    agg.totalCapital, CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const totalProfit = round0(clampNum(
    agg.totalProfit, PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const profitMargin = round2(clampNum(
    totalCapitalDeployed > 0 ? (totalProfit / totalCapitalDeployed) * 100 : 0,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));
  const avgHoldDays = round0(clampNum(
    tradeCount > 0 ? agg.totalHoldDays / tradeCount : 0,
    tradeCount > 0 ? HOLD_MIN : 0, HOLD_MAX, 30,
  ));

  // Annualized return = (totalProfit / totalCapital) × (365 / avgHoldDays) × 100
  // = profit margin × cycles per year
  const cyclesPerYear = avgHoldDays > 0 ? 365 / avgHoldDays : 0;
  const annualizedReturnRaw = totalCapitalDeployed > 0
    ? profitMargin * cyclesPerYear
    : 0;
  const annualizedReturn = round2(clampNum(
    annualizedReturnRaw,
    RETURN_MIN, RETURN_MAX, 0,
  ));

  return {
    totalProfit,
    totalCapitalDeployed,
    avgHoldDays,
    annualizedReturn,
    tradeCount,
    profitMargin,
  };
}

function decideAction(metrics: SourceMetrics): ReturnAction {
  // Low margin → INCREASE_PROFIT (sell higher)
  if (metrics.profitMargin < 15) return 'INCREASE_PROFIT';
  // Slow turnover (>45 days) → FASTER_TURNOVER (boost cycles per year)
  if (metrics.avgHoldDays > 45) return 'FASTER_TURNOVER';
  // High capital deployment with mediocre return → REDUCE_CAPITAL (lower buy price)
  if (metrics.totalCapitalDeployed > 2000 && metrics.annualizedReturn < 50) return 'REDUCE_CAPITAL';
  // Default → BETTER_SOURCING (cross-border, premium listings)
  return 'BETTER_SOURCING';
}

function buildReturnLevers(metrics: SourceMetrics, action: ReturnAction): string[] {
  const levers: string[] = [];
  levers.push(`Trenutno ${metrics.annualizedReturn.toFixed(2)}% annualized return (${metrics.totalProfit}€ profit / ${metrics.totalCapitalDeployed}€ capital, ${metrics.avgHoldDays}d hold = ${metrics.tradeCount} trades, ${metrics.profitMargin.toFixed(1)}% margin × ${(365 / Math.max(1, metrics.avgHoldDays)).toFixed(1)} cycles/yr).`);
  switch (action) {
    case 'INCREASE_PROFIT':
      levers.push(`Dvigni sell price z AI pricing engine za +${Math.round(metrics.totalCapitalDeployed * 0.15)}€ additional profit — +25pp annualized return (15% margin boost × unchanged cycles).`);
      levers.push('Negotiate harder z AI negotiation-playbook in premium fotografijo — +10% close rate z boljšim offer timing.');
      break;
    case 'REDUCE_CAPITAL':
      levers.push(`Znižaj buy price za 15-25% z Bolha/Vinted deal score > 80 filterjem in cross-border sourcing (Kleinanzeigen, Subito, Willhaben) — +18pp annualized return.`);
      levers.push('Optimiziraj fee structure z bundle deals, tax-aware selling in optimal listing tier — znižaj total fees za 20-30%.');
      break;
    case 'FASTER_TURNOVER':
      levers.push(`Skrajšaj avg hold time z ${metrics.avgHoldDays} na ${Math.round(metrics.avgHoldDays * 0.6)} dni z listing-refresh-scheduler, auto-relisting in dynamic pricing — +30pp annualized return (cycles/yr boost).`);
      levers.push('Vklopi optimal-time AI za najboljše listing windows (petek 18h, nedelja 20h) — +18% close rate in hitrejša prodaja.');
      break;
    case 'BETTER_SOURCING':
      levers.push('Vklopi cross-border sourcing (Kleinanzeigen, Subito, Willhaben) za 15-25% nižje buy prices in premium niche listings.');
      levers.push('Filter Bolha/Vinted premium listings z deal score > 80 — višji profit per trade in višji annualized return.');
      levers.push('Prestavi se v premium niche kategorije (luxury watches, designer bags) z višjim absolute margin za +22pp annual return.');
      break;
  }
  return levers.slice(0, MAX_LEVERS);
}

function buildReturnVsBenchmark(
  metrics: SourceMetrics,
  maximizedReturn: number,
): ReturnVsBenchmark {
  const yourCurrentReturn = round2(clampNum(
    metrics.annualizedReturn, RETURN_MIN, RETURN_MAX, 0,
  ));
  const yourMaximizedReturn = round2(clampNum(
    maximizedReturn, RETURN_MIN, RETURN_MAX, 0,
  ));
  return {
    stocks: BENCHMARK_STOCKS,
    realEstate: BENCHMARK_REAL_ESTATE,
    bonds: BENCHMARK_BONDS,
    yourCurrentReturn,
    yourMaximizedReturn,
    maximizedVsStocks: round2(clampNum(
      yourMaximizedReturn - BENCHMARK_STOCKS, -1000, 1000, 0,
    )),
    maximizedVsRealEstate: round2(clampNum(
      yourMaximizedReturn - BENCHMARK_REAL_ESTATE, -1000, 1000, 0,
    )),
    maximizedVsBonds: round2(clampNum(
      yourMaximizedReturn - BENCHMARK_BONDS, -1000, 1000, 0,
    )),
  };
}

function buildCapitalEfficiencyAdvice(
  metrics: SourceMetrics,
  action: ReturnAction,
): string {
  const cyclesPerYear = metrics.avgHoldDays > 0 ? 365 / metrics.avgHoldDays : 0;
  switch (action) {
    case 'INCREASE_PROFIT':
      return `Deploy capital bolj efficiently: poudarek na premium niche listings (${metrics.tradeCount} trades × ${metrics.avgHoldDays}d = ${cyclesPerYear.toFixed(1)} cycles/yr). Višji sell price → višji profit per cycle → višji annualized return na enako deployed capital.`;
    case 'REDUCE_CAPITAL':
      return `Zmanjšaj deployed capital za 15-25% z boljšim sourcing — isto število trades z nižjim capital potrebnim. Boljša capital efficiency = višji annualized return na € deployed. Razširi cross-border sourcing za nižje buy prices.`;
    case 'FASTER_TURNOVER':
      return `Capital efficiency boost preko faster turnover: cycles/yr z ${(365 / Math.max(1, metrics.avgHoldDays)).toFixed(1)} na ${(365 / Math.max(1, Math.round(metrics.avgHoldDays * 0.6))).toFixed(1)} z listing-refresh-scheduler. Več cycle-ov z enakim deployed capital = višji annualized return.`;
    case 'BETTER_SOURCING':
      return `Capital deployment optimization: focus na Bolha/Vinted premium listings (deal score > 80) in cross-border sourcing. Boljši buy prices zmanjšajo capital per trade in povečajo profit margin — oboje dvigne annualized return na deployed capital.`;
  }
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideAction(metrics);
  const gainPp = ACTION_RETURN_GAIN[action];

  // Anti-hallucination: maximizedReturn ∈ [current, current + 200pp absolute uplift]
  const minBound = Math.max(RETURN_MIN, metrics.annualizedReturn);
  const maxBound = Math.min(RETURN_MAX, metrics.annualizedReturn + 200);
  const maximizedAnnualReturn = round2(clampNum(
    metrics.annualizedReturn + gainPp,
    minBound, maxBound,
    metrics.annualizedReturn,
  ));
  const returnUplift = round2(clampNum(
    Math.max(0, maximizedAnnualReturn - metrics.annualizedReturn),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));
  const returnMaximizationLevers = buildReturnLevers(metrics, action);
  const returnVsBenchmark = buildReturnVsBenchmark(metrics, maximizedAnnualReturn);
  const capitalEfficiencyAdvice = clampString(
    buildCapitalEfficiencyAdvice(metrics, action),
    300,
    'Optimiziraj capital deployment za višji annualized return na € invested.',
  );

  return {
    returnMaximizationAction: action,
    maximizedAnnualReturn,
    returnUplift,
    returnMaximizationLevers,
    returnVsBenchmark,
    capitalEfficiencyAdvice,
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
  // Sort by annualizedReturn desc (best return source first)
  entries.sort((a, b) => b.metrics.annualizedReturn - a.metrics.annualizedReturn);
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  const totalCapitalDeployed = entries.reduce((s, e) => s + e.metrics.totalCapitalDeployed, 0);
  const totalProfit = entries.reduce((s, e) => s + e.metrics.totalProfit, 0);
  // Portfolio annualized return = sum(profit_i) / sum(capital_i) × (365 / weighted avg hold)
  const weightedHold = entries.reduce((s, e) => s + e.metrics.avgHoldDays * e.metrics.totalCapitalDeployed, 0);
  const portfolioAvgHold = totalCapitalDeployed > 0 ? weightedHold / totalCapitalDeployed : 0;
  const portfolioMargin = totalCapitalDeployed > 0 ? (totalProfit / totalCapitalDeployed) * 100 : 0;
  const portfolioCyclesPerYear = portfolioAvgHold > 0 ? 365 / portfolioAvgHold : 0;
  const currentPortfolioAnnualReturnRaw = portfolioMargin * portfolioCyclesPerYear;
  const currentPortfolioAnnualReturn = round2(clampNum(
    currentPortfolioAnnualReturnRaw, RETURN_MIN, RETURN_MAX, 0,
  ));

  // Maximized = weighted by capital deployment × maximized return
  const maximizedReturnWeighted = entries.reduce(
    (s, e) => s + (e.metrics.totalCapitalDeployed * e.maximization.maximizedAnnualReturn),
    0,
  );
  const maximizedPortfolioAnnualReturn = round2(clampNum(
    totalCapitalDeployed > 0 ? maximizedReturnWeighted / totalCapitalDeployed : 0,
    RETURN_MIN, RETURN_MAX, 0,
  ));
  const totalReturnUplift = round2(clampNum(
    Math.max(0, maximizedPortfolioAnnualReturn - currentPortfolioAnnualReturn),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const sourceReturnRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentAnnualReturn: e.metrics.annualizedReturn,
    maximizedAnnualReturn: e.maximization.maximizedAnnualReturn,
    rank: idx + 1,
  }));

  const bestEntry = entries[0];
  const bestReturnSource = bestEntry ? bestEntry.source : '';

  return {
    currentPortfolioAnnualReturn,
    maximizedPortfolioAnnualReturn,
    totalReturnUplift,
    sourceReturnRanking,
    bestReturnSource,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Annual Return Maximizer ni mogoč.';
  }
  const best = entries[0];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio annualized return: ${portfolio.currentPortfolioAnnualReturn.toFixed(2)}% → ${portfolio.maximizedPortfolioAnnualReturn.toFixed(2)}% (+${portfolio.totalReturnUplift.toFixed(2)}pp).`,
    `Vs stocks (8%): +${(portfolio.maximizedPortfolioAnnualReturn - BENCHMARK_STOCKS).toFixed(2)}pp. Vs real estate (5%): +${(portfolio.maximizedPortfolioAnnualReturn - BENCHMARK_REAL_ESTATE).toFixed(2)}pp.`,
    `Best: ${best.displayName} (${best.metrics.annualizedReturn.toFixed(2)}% annual return, ${best.metrics.avgHoldDays}d hold).`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceAnnualReturnMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceAnnualReturnMaximizer(req);
}

async function handleDealSourceAnnualReturnMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-annual-return-maximizer', 20);
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
          currentPortfolioAnnualReturn: 0,
          maximizedPortfolioAnnualReturn: 0,
          totalReturnUplift: 0,
          sourceReturnRanking: [],
          bestReturnSource: '',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Annual Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Annual Return Maximizer ni mogoč.',
      } satisfies DealSourceAnnualReturnResponse);
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
          currentPortfolioAnnualReturn: 0,
          maximizedPortfolioAnnualReturn: 0,
          totalReturnUplift: 0,
          sourceReturnRanking: [],
          bestReturnSource: '',
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Annual Return Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Annual Return Maximizer ni mogoč.',
      } satisfies DealSourceAnnualReturnResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-annual-return-maximizer:${currentMonth}`;
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
      } satisfies DealSourceAnnualReturnResponse);
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
      benchmarks: {
        stocks: BENCHMARK_STOCKS,
        realEstate: BENCHMARK_REAL_ESTATE,
        bonds: BENCHMARK_BONDS,
      },
      sources: sourcesForAI,
      deterministicPortfolio: {
        currentPortfolioAnnualReturn: portfolio.currentPortfolioAnnualReturn,
        maximizedPortfolioAnnualReturn: portfolio.maximizedPortfolioAnnualReturn,
        totalReturnUplift: portfolio.totalReturnUplift,
        sourceReturnRanking: portfolio.sourceReturnRanking,
        bestReturnSource: portfolio.bestReturnSource,
      },
      caps: {
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        returnMin: RETURN_MIN, returnMax: RETURN_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Annual Return Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za ANNUALIZED RETURN MAXIMIZATION per source — kako maksimizirati ANNUALIZED RETURN per source (profit / capital × 365 / holdDays × 100 — annual % return primerljiv z drugimi investicijami). Tvoj cilj je "Bolha annualized return: 85%, Vinted: 42%, ampak bi lahko bila 120% in 68%." Razlika od deal-source-capital-return-maximizer (v8.09 ki maksimizira capital return rate per source — % capital returned) — ti MAKSIMIZIRAŠ ANNUALIZED RETURN per source (profit / capital × 365 / holdDays × 100, ne % capital returned). Razlika od deal-source-profit-velocity-maximizer (v8.08 ki maksimizira velocity profit-a per source — €/teden kako hitro profit kopiči) — ti MAKSIMIZIRAŠ ANNUALIZED RETURN per source (% annual return primerljiv z stocks/real estate, ne €/teden). Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ti MAKSIMIZIRAŠ ANNUALIZED RETURN (ROI × 365 / holdDays, time-weighted) z returnVsBenchmark in capitalEfficiencyAdvice. Razlika od deal-source-cash-flow-maximizer (v8.06 ki maksimizira NET CASH FLOW per source) — ta maksimizira ANNUALIZED RETURN RATE per source (% return, ne € cash flow). Razlika od deal-source-revenue-maximizer (v8.07 ki maksimizira total revenue per source) — ta maksimizira ANNUALIZED RETURN (profit/capital annualized, ne top-line revenue). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ta maksimizira ANNUALIZED RETURN RATE per source (% annual, ne € profit). Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized return na HELD inventory) — ta MAKSIMIZIRA ANNUALIZED RETURN per SOLD SOURCE (realized trades, ne held inventory).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.returnMaximizationAction: INCREASE_PROFIT | REDUCE_CAPITAL | FASTER_TURNOVER | BETTER_SOURCING,
   - maximization.maximizedAnnualReturn % [-100, 1000] (≥ current annualizedReturn, ≤ current + 200pp absolute uplift — anti-hallucination),
   - maximization.returnUplift pp [0, 500] (improvement = maximized − current),
   - maximization.returnMaximizationLevers: 3-5 stringov (max 200 vsak, slovenski — specific annualized return levers per source),
   - maximization.capitalEfficiencyAdvice (slovenski, max 300 — kako deploy-at capital bolj efficiently per source za višji annualized return),
   - (returnVsBenchmark in maximizedVsStocks/RealEstate/Bonds se avtomatsko izračunajo iz maximizedAnnualReturn v backend-u — AI ne vrača teh),
2. summary: slovenski povzetek (max 500 znakov — poudari portfolio annualized return, maximized return, vs stocks/bonds benchmark, best source).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "returnMaximizationAction": "FASTER_TURNOVER",
        "maximizedAnnualReturn": 120,
        "returnUplift": 35,
        "returnMaximizationLevers": [
          "Skrajšaj avg hold time z 30 na 18 dni.",
          "Vklopi listing-refresh-scheduler in auto-relisting.",
          "Vklopi optimal-time AI za najboljše listing windows.",
          "Dynamic pricing za hitrejšo prodajo."
        ],
        "capitalEfficiencyAdvice": "Capital efficiency boost preko faster turnover: cycles/yr z 12.2 na 20.3 z listing-refresh-scheduler. Več cycle-ov z enakim deployed capital = višji annualized return."
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "returnMaximizationAction": "INCREASE_PROFIT",
        "maximizedAnnualReturn": 68,
        "returnUplift": 26,
        "returnMaximizationLevers": [
          "Dvigni sell price z AI pricing engine.",
          "Negotiate harder z AI negotiation-playbook.",
          "Premium fotografija za višji close rate.",
          "Optimiziraj listing tier za boljšo exposure."
        ],
        "capitalEfficiencyAdvice": "Deploy capital bolj efficiently: poudarek na premium niche listings. Višji sell price → višji profit per cycle → višji annualized return na enako deployed capital."
      }
    }
  ],
  "summary": "2 source-a. Portfolio annualized return: 60.5% → 92.0% (+31.5pp). Vs stocks (8%): +84.0pp. Vs real estate (5%): +87.0pp. Best: Bolha (85% annual return, 30d hold)."
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
            aiMax.returnMaximizationAction,
            VALID_ACTION,
            det.maximization.returnMaximizationAction,
          );

          // Anti-hallucination: maximizedAnnualReturn ∈ [current, current + 200pp]
          const minBound = Math.max(RETURN_MIN, det.metrics.annualizedReturn);
          const maxBound = Math.min(RETURN_MAX, det.metrics.annualizedReturn + 200);
          const maximizedAnnualReturn = round2(clampNum(
            aiMax.maximizedAnnualReturn,
            minBound, maxBound,
            det.maximization.maximizedAnnualReturn,
          ));
          const returnUplift = round2(clampNum(
            Math.max(0, maximizedAnnualReturn - det.metrics.annualizedReturn),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          // returnMaximizationLevers — must be array of strings
          let returnMaximizationLevers: string[] = det.maximization.returnMaximizationLevers;
          if (Array.isArray(aiMax.returnMaximizationLevers) &&
              aiMax.returnMaximizationLevers.length >= 2) {
            const aiLevers: string[] = [];
            for (const l of aiMax.returnMaximizationLevers.slice(0, MAX_LEVERS)) {
              aiLevers.push(clampString(l, 200, 'Annual return lever neopisan.'));
            }
            if (aiLevers.length >= 2) {
              returnMaximizationLevers = aiLevers;
            }
          }

          const capitalEfficiencyAdvice = clampString(
            aiMax.capitalEfficiencyAdvice,
            300,
            det.maximization.capitalEfficiencyAdvice,
          );

          // Rebuild returnVsBenchmark with new maximizedAnnualReturn
          const returnVsBenchmark = buildReturnVsBenchmark(det.metrics, maximizedAnnualReturn);

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              returnMaximizationAction: action,
              maximizedAnnualReturn,
              returnUplift,
              returnMaximizationLevers,
              returnVsBenchmark,
              capitalEfficiencyAdvice,
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
        '/api/ai/deal-source-annual-return-maximizer',
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
    } satisfies DealSourceAnnualReturnResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-annual-return-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
