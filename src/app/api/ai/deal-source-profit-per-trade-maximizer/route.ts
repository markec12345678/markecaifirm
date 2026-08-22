// v8.04: AI Deal Source Profit Per Trade Maximizer — AI MAXIMIZIRA PROFIT
// PER TRADE za vsak source — kateri source-i dajejo najvišji profit PER
// INDIVIDUAL DEAL in kako povečati. Razlika od deal-source-margin-maximizer
// (v8.03 ki maksimizira margin % per source) — ta MAKSIMIZIRA PROFIT PER TRADE
// € (absolutni profit, ne %), z profitPerTradeAction
// (TARGET_HIGHER_VALUE/NEGOTIATE_BETTER/REDUCE_FEES/IMPROVE_QUALITY/SHIFT_TO_PREMIUM).
// Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) —
// ta maksimizira PER-TRADE absolutni profit z bestTradeProfile. Razlika od
// deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source)
// — ta maksimizira PER-TRADE profit (povprečje per deal, ne vsota). Razlika od
// deal-source-volume-maximizer (v8.02 ki maksimizira VOLUME per source) — ta
// maksimizira PROFIT PER TRADE (kvaliteta, ne kvantiteta). Razlika od
// deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per HELD item) — ta
// maksimizira profit per trade PER SOURCE (zgodovinski sold). Razlika od
// profit-scale-engine (v8.02 ki scale-a cel business) — ta daje PER-SOURCE
// per-trade maximization z bestTradeProfile in sourceRanking. Razlika od
// profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ta
// fokusira na PROFIT PER TRADE € per source z profitPerTradeLevers. Razlika od
// revenue-growth-maximizer (v8.01 ki maksimizira revenue growth) — ta
// maksimizira PROFIT PER TRADE (ne revenue), z profitPerTradeUplift per source.
//
// "Sources: Bolha avgProfitPerTrade 167€ (best 480€, worst 25€), trend
// INCREASING. Vinted avgProfitPerTrade 35€ (best 80€, worst -10€), trend
// FLAT. Avtonet avgProfitPerTrade 220€ (best 850€, worst 90€), trend
// INCREASING. Maximization: Bolha TARGET_HIGHER_VALUE → projected 210€/trade
// (+43€). Vinted SHIFT_TO_PREMIUM → projected 75€/trade (+40€). Avtonet
// NEGOTIATE_BETTER → projected 280€/trade (+60€). Portfolio: avg 167€ → 245€
// (+78€ uplift per trade, +47% improvement). Source ranking: Avtonet (1),
// Bolha (2), Vinted (3)."

// GET+POST /api/ai/deal-source-profit-per-trade-maximizer
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
interface DealSourceProfitPerTradeMaximizerInput {}

// --- Types ---------------------------------------------------------------

type ProfitPerTradeAction =
  | 'TARGET_HIGHER_VALUE'
  | 'NEGOTIATE_BETTER'
  | 'REDUCE_FEES'
  | 'IMPROVE_QUALITY'
  | 'SHIFT_TO_PREMIUM';
type ProfitTrend = 'INCREASING' | 'STABLE' | 'DECREASING' | 'FLAT';

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
  avgProfitPerTrade: number; // €
  avgRevenuePerTrade: number; // €
  avgCostPerTrade: number; // €
  profitPerTradeTrend: ProfitTrend;
  bestTradeEver: number; // €
  worstTradeEver: number; // €
  tradeCount: number;
}

interface ProfitPerTradeLever {
  lever: string;
  currentProfit: number; // €
  upliftPotential: number; // €
  action: string;
}

interface BestTradeProfile {
  categoryHint: string;
  priceRangeLow: number;
  priceRangeHigh: number;
  characteristics: string[];
}

interface SourceMaximization {
  profitPerTradeAction: ProfitPerTradeAction;
  projectedProfitPerTrade: number; // €
  profitPerTradeUplift: number; // €
  profitPerTradeLevers: ProfitPerTradeLever[];
  bestTradeProfile: BestTradeProfile;
  sourceRanking: number;
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  avgProfitPerTrade: number;
  maximizedAvgProfitPerTrade: number;
  totalUpliftPerTrade: number;
  sourceRanking: Array<{
    source: string;
    avgProfitPerTrade: number;
    projectedProfitPerTrade: number;
    rank: number;
  }>;
}

interface DealSourceProfitPerTradeResponse {
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
      profitPerTradeAction?: ProfitPerTradeAction;
      projectedProfitPerTrade?: number;
      profitPerTradeLevers?: Array<{
        lever?: string;
        currentProfit?: number;
        upliftPotential?: number;
        action?: string;
      }>;
      bestTradeProfile?: {
        categoryHint?: string;
        priceRangeLow?: number;
        priceRangeHigh?: number;
        characteristics?: string[];
      };
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 10_000; // per-trade cap
const REVENUE_MIN = 0;
const REVENUE_MAX = 50_000;
const COST_MIN = 0;
const COST_MAX = 50_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 5000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const MAX_LEVERS_PER_SOURCE = 4;
const MAX_TRADE_PROFILE_CHARS = 5;

const VALID_ACTION: readonly ProfitPerTradeAction[] = [
  'TARGET_HIGHER_VALUE',
  'NEGOTIATE_BETTER',
  'REDUCE_FEES',
  'IMPROVE_QUALITY',
  'SHIFT_TO_PREMIUM',
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
  revenue: number;
  profit: number;
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
  const date = toMs(t.sellDate) || toMs(t.buyDate);
  const source = detectSource(t);
  return { source, cost, revenue, profit, date };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  profits: number[];
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
        profits: [],
        dates: [],
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalProfit += tr.profit;
    agg.totalRevenue += Math.max(0, tr.revenue);
    agg.totalCost += tr.cost;
    agg.profits.push(tr.profit);
    agg.dates.push(tr.date);
  }
  return map;
}

function computeTrend(trades: TradeComputed[]): ProfitTrend {
  if (trades.length < 4) return 'FLAT';
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const avgFirst = avg(first.map((t) => t.profit));
  const avgSecond = avg(second.map((t) => t.profit));
  if (avgFirst === 0) return avgSecond > 0 ? 'INCREASING' : 'FLAT';
  const ratio = avgSecond / avgFirst;
  if (ratio >= 1.15) return 'INCREASING';
  if (ratio <= 0.85) return 'DECREASING';
  if (ratio >= 1.05) return 'STABLE';
  return 'FLAT';
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const avgProfitPerTrade = round0(clampNum(avg(agg.profits), -PROFIT_MAX, PROFIT_MAX, 0));
  const avgRevenuePerTrade = round0(clampNum(
    avgRevenueForAgg(agg),
    REVENUE_MIN, REVENUE_MAX, 0,
  ));
  const avgCostPerTrade = round0(clampNum(
    agg.totalCost / Math.max(1, tradeCount),
    COST_MIN, COST_MAX, 0,
  ));
  const profitPerTradeTrend = computeTrend(agg.trades);
  const bestTradeEver = round0(clampNum(
    Math.max(...agg.profits, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const worstTradeEver = round0(clampNum(
    Math.min(...agg.profits, 0),
    -PROFIT_MAX, PROFIT_MAX, 0,
  ));
  return {
    avgProfitPerTrade,
    avgRevenuePerTrade,
    avgCostPerTrade,
    profitPerTradeTrend,
    bestTradeEver,
    worstTradeEver,
    tradeCount,
  };
}

function avgRevenueForAgg(agg: SourceAgg): number {
  if (agg.trades.length === 0) return 0;
  return agg.trades.reduce((s, t) => s + Math.max(0, t.revenue), 0) / agg.trades.length;
}

function decideProfitPerTradeAction(metrics: SourceMetrics): ProfitPerTradeAction {
  // SHIFT_TO_PREMIUM: very low avg profit per trade (<30€) — need premium shift
  if (metrics.avgProfitPerTrade < 30) {
    return 'SHIFT_TO_PREMIUM';
  }
  // NEGOTIATE_BETTER: low cost but low profit — need better buying
  if (metrics.avgCostPerTrade < 100 && metrics.avgProfitPerTrade < 75) {
    return 'NEGOTIATE_BETTER';
  }
  // REDUCE_FEES: high revenue but low profit margin in € (fees eating profit)
  if (metrics.avgRevenuePerTrade > 200 && metrics.avgProfitPerTrade < metrics.avgRevenuePerTrade * 0.2) {
    return 'REDUCE_FEES';
  }
  // TARGET_HIGHER_VALUE: high cost items with mid profit — go higher value
  if (metrics.avgCostPerTrade > 200 && metrics.avgProfitPerTrade < metrics.avgCostPerTrade * 0.4) {
    return 'TARGET_HIGHER_VALUE';
  }
  // IMPROVE_QUALITY: default — improve refurb/quality
  return 'IMPROVE_QUALITY';
}

function buildProfitPerTradeLevers(metrics: SourceMetrics): ProfitPerTradeLever[] {
  const levers: ProfitPerTradeLever[] = [];

  // Sourcing lever — negotiate lower buy price
  const sourcingUplift = round0(clampNum(
    metrics.avgCostPerTrade * 0.1,
    UPLIFT_MIN, UPLIFT_MAX, 5,
  ));
  levers.push({
    lever: 'Sourcing Negotiation',
    currentProfit: Math.max(0, metrics.avgProfitPerTrade),
    upliftPotential: sourcingUplift,
    action: clampString(
      `Negotiate nižje nabavne cene (-10%) pri buy-ih nad ${round0(metrics.avgCostPerTrade)}€ — target ${round0(metrics.avgCostPerTrade * 0.9)}€.`,
      200,
      'Negotiate nižje nabavne cene.',
    ),
  });

  // Pricing lever — sell higher
  const pricingUplift = round0(clampNum(
    metrics.avgRevenuePerTrade * 0.08,
    UPLIFT_MIN, UPLIFT_MAX, 5,
  ));
  levers.push({
    lever: 'Premium Pricing',
    currentProfit: Math.max(0, metrics.avgProfitPerTrade),
    upliftPotential: pricingUplift,
    action: clampString(
      `Dvigni prodajne cene za 8% z premium pozicioniranjem (boljše fotografije, certifikati, refurbished enhancement).`,
      200,
      'Dvigni prodajne cene z premium strategy.',
    ),
  });

  // Fees lever — reduce platform fees
  const feesUplift = round0(clampNum(
    metrics.avgRevenuePerTrade * 0.05,
    UPLIFT_MIN, UPLIFT_MAX, 3,
  ));
  levers.push({
    lever: 'Platform Fees',
    currentProfit: Math.max(0, metrics.avgProfitPerTrade),
    upliftPotential: feesUplift,
    action: clampString(
      `Cross-post na platforme z nižjimi fees (Vinted 0€ listing, Bolha direktno) ali direktna prodaja (cash) za +5% fee savings.`,
      200,
      'Zmanjšaj platform fees.',
    ),
  });

  // Value shift lever — target higher-value items
  const valueUplift = round0(clampNum(
    Math.max(20, metrics.avgProfitPerTrade * 0.3),
    UPLIFT_MIN, UPLIFT_MAX, 20,
  ));
  levers.push({
    lever: 'Higher-Value Items',
    currentProfit: Math.max(0, metrics.avgProfitPerTrade),
    upliftPotential: valueUplift,
    action: clampString(
      `Premakni sourcing v višje-vrednostne iteme (${round0(metrics.avgRevenuePerTrade * 1.5)}-2000€ range) za večji absolutni profit per trade.`,
      200,
      'Premakni se v višje-vrednostne iteme.',
    ),
  });

  return levers.slice(0, MAX_LEVERS_PER_SOURCE);
}

function buildBestTradeProfile(metrics: SourceMetrics, agg: SourceAgg): BestTradeProfile {
  // Find best trade to profile
  const sorted = [...agg.trades].sort((a, b) => b.profit - a.profit);
  const best = sorted[0];
  const bestRevenue = best ? best.revenue : metrics.avgRevenuePerTrade;
  const priceRangeLow = round0(clampNum(
    bestRevenue * 0.7,
    COST_MIN, COST_MAX, 0,
  ));
  const priceRangeHigh = round0(clampNum(
    bestRevenue * 1.3,
    COST_MIN, COST_MAX, 0,
  ));
  // Category hint from best trade
  const categoryHint = best
    ? 'high-margin premium item'
    : 'standard mid-range item';
  const characteristics: string[] = [
    `Profit ${round0(metrics.bestTradeEver)}€ (${round0(metrics.bestTradeEver / Math.max(1, metrics.avgCostPerTrade) * 100)}% ROI).`,
    `Revenue range ${priceRangeLow}-${priceRangeHigh}€.`,
    `Cost ratio: ${round2(metrics.avgCostPerTrade / Math.max(1, metrics.avgRevenuePerTrade) * 100)}% of revenue.`,
  ];
  if (metrics.bestTradeEver > metrics.avgProfitPerTrade * 3) {
    characteristics.push('Outlier — 3x+ boljši od povprečja (ponovljiv vzorec).');
  } else {
    characteristics.push('Konzistenten z avg perfomance.');
  }
  return {
    categoryHint: clampString(categoryHint, 100, 'high-margin item'),
    priceRangeLow,
    priceRangeHigh,
    characteristics: characteristics
      .slice(0, MAX_TRADE_PROFILE_CHARS)
      .map((c) => clampString(c, 200, 'Specifična lastnost.')),
  };
}

function buildSourceMaximization(metrics: SourceMetrics, agg: SourceAgg): SourceMaximization {
  const action = decideProfitPerTradeAction(metrics);
  const levers = buildProfitPerTradeLevers(metrics);
  const bestTradeProfile = buildBestTradeProfile(metrics, agg);

  // Total uplift = sum of lever upliftPotentials × action factor
  const actionFactor: Record<ProfitPerTradeAction, number> = {
    TARGET_HIGHER_VALUE: 0.6,
    NEGOTIATE_BETTER: 0.7,
    REDUCE_FEES: 0.5,
    IMPROVE_QUALITY: 0.55,
    SHIFT_TO_PREMIUM: 0.5,
  };
  const totalRawUplift = levers.reduce((s, l) => s + l.upliftPotential, 0);

  let profitPerTradeUplift = round0(clampNum(
    totalRawUplift * actionFactor[action],
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Anti-hallucination: uplift can't exceed 100% of current profit (or 500€ absolute)
  if (metrics.avgProfitPerTrade > 0) {
    profitPerTradeUplift = round0(Math.min(
      profitPerTradeUplift,
      Math.max(50, metrics.avgProfitPerTrade * 1.0),
    ));
  } else {
    profitPerTradeUplift = round0(Math.min(profitPerTradeUplift, 500));
  }

  // Trend adjustment: DECREASING → less uplift
  if (metrics.profitPerTradeTrend === 'DECREASING') {
    profitPerTradeUplift = round0(profitPerTradeUplift * 0.7);
  }

  const projectedProfitPerTrade = round0(clampNum(
    Math.max(metrics.avgProfitPerTrade, metrics.avgProfitPerTrade + profitPerTradeUplift),
    PROFIT_MIN, PROFIT_MAX, metrics.avgProfitPerTrade,
  ));

  return {
    profitPerTradeAction: action,
    projectedProfitPerTrade,
    profitPerTradeUplift,
    profitPerTradeLevers: levers,
    bestTradeProfile,
    sourceRanking: 0, // will be set in buildSourceEntries
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    const maximization = buildSourceMaximization(metrics, agg);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by projectedProfitPerTrade desc
  entries.sort((a, b) => b.maximization.projectedProfitPerTrade - a.maximization.projectedProfitPerTrade);
  // Assign sourceRanking (1 = best)
  for (let i = 0; i < entries.length; i++) {
    entries[i].maximization.sourceRanking = i + 1;
  }
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  // avgProfitPerTrade = avg across sources weighted by tradeCount
  const totalTrades = entries.reduce((s, e) => s + e.metrics.tradeCount, 0);
  const avgProfitPerTrade = totalTrades > 0
    ? round0(clampNum(
      entries.reduce((s, e) => s + e.metrics.avgProfitPerTrade * e.metrics.tradeCount, 0) / totalTrades,
      -PROFIT_MAX, PROFIT_MAX, 0,
    ))
    : 0;
  const maximizedAvgProfitPerTrade = totalTrades > 0
    ? round0(clampNum(
      entries.reduce((s, e) => s + e.maximization.projectedProfitPerTrade * e.metrics.tradeCount, 0) / totalTrades,
      PROFIT_MIN, PROFIT_MAX, 0,
    ))
    : 0;
  const totalUpliftPerTrade = round0(clampNum(
    maximizedAvgProfitPerTrade - avgProfitPerTrade,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Source ranking by projected profit per trade
  const sourceRanking = entries
    .map((e, idx) => ({
      source: e.source,
      avgProfitPerTrade: e.metrics.avgProfitPerTrade,
      projectedProfitPerTrade: e.maximization.projectedProfitPerTrade,
      rank: idx + 1,
    }))
    .sort((a, b) => b.projectedProfitPerTrade - a.projectedProfitPerTrade)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  return {
    avgProfitPerTrade,
    maximizedAvgProfitPerTrade,
    totalUpliftPerTrade,
    sourceRanking,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio avg profit/trade: ${portfolio.avgProfitPerTrade}€ → ${portfolio.maximizedAvgProfitPerTrade}€ (+${portfolio.totalUpliftPerTrade}€ uplift).`,
    `Top: ${portfolio.sourceRanking[0]?.source ?? 'n/a'} (projected ${portfolio.sourceRanking[0]?.projectedProfitPerTrade ?? 0}€/trade).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Extracted prompt helpers (pure, testable) ---------------------------

function buildPromptData(
  entries: SourceEntry[],
  computed: TradeComputed[],
  portfolio: PortfolioSummary,
): unknown {
  // Compact context for AI
  const sourcesForAI = entries.map((e) => ({
    source: e.source,
    displayName: e.displayName,
    metrics: e.metrics,
    deterministicMaximization: {
      profitPerTradeAction: e.maximization.profitPerTradeAction,
      projectedProfitPerTrade: e.maximization.projectedProfitPerTrade,
      profitPerTradeUplift: e.maximization.profitPerTradeUplift,
      profitPerTradeLevers: e.maximization.profitPerTradeLevers,
      bestTradeProfile: e.maximization.bestTradeProfile,
    },
  }));

  return {
    totalTrades: computed.length,
    totalSources: entries.length,
    sources: sourcesForAI,
    deterministicPortfolio: {
      avgProfitPerTrade: portfolio.avgProfitPerTrade,
      maximizedAvgProfitPerTrade: portfolio.maximizedAvgProfitPerTrade,
      totalUpliftPerTrade: portfolio.totalUpliftPerTrade,
    },
    caps: {
      profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
      revenueMin: REVENUE_MIN, revenueMax: REVENUE_MAX,
      costMin: COST_MIN, costMax: COST_MAX,
      upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
    },
  };
}

function buildPrompt(promptData: unknown): string {
  return `Si AI "Deal Source Profit Per Trade Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER TRADE MAXIMIZATION — kako maksimizirati ABSOLUTNI PROFIT € per individual deal za vsak source. Tvoj cilj je "kateri source-i dajejo najvišji profit PER DEAL in kako povečati". Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin % per source) — ti MAKSIMIZIRAŠ PROFIT PER TRADE € (absolutni profit, ne %), z profitPerTradeAction (TARGET_HIGHER_VALUE/NEGOTIATE_BETTER/REDUCE_FEES/IMPROVE_QUALITY/SHIFT_TO_PREMIUM) in bestTradeProfile. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ti maksimiziraš PER-TRADE absolutni profit z bestTradeProfile. Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ti maksimiziraš PER-TRADE profit (povprečje per deal, ne vsota). Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira VOLUME per source) — ti maksimiziraš PROFIT PER TRADE (kvaliteta, ne kvantiteta). Razlika od deal-profit-margin-enhancer-pro (v8.01 ki enhanca margin per HELD item) — ti maksimiziraš profit per trade PER SOURCE (zgodovinski sold). Razlika od profit-scale-engine (v8.02 ki scale-a cel business) — ti daje PER-SOURCE per-trade maximization z bestTradeProfile in sourceRanking. Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na PROFIT PER TRADE € per source z profitPerTradeLevers. Razlika od revenue-growth-maximizer (v8.01 ki maksimizira revenue growth) — ti maksimiziraš PROFIT PER TRADE (ne revenue), z profitPerTradeUplift per source.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.profitPerTradeAction: TARGET_HIGHER_VALUE | NEGOTIATE_BETTER | REDUCE_FEES | IMPROVE_QUALITY | SHIFT_TO_PREMIUM (lahko se razlikuje od deterministic),
   - maximization.projectedProfitPerTrade € [0, 10000] (≥ avgProfitPerTrade, ≤ avgProfitPerTrade × 2 ali +500€ absolute — anti-hallucination),
   - maximization.profitPerTradeLevers: 2-4 levers { lever (max 50), currentProfit € [0, 10000], upliftPotential € [0, 5000], action (max 200, slovenski) },
   - maximization.bestTradeProfile: { categoryHint (max 100), priceRangeLow € [0, 50000], priceRangeHigh € [0, 50000], characteristics 3-5 stringov (max 200 vsak, slovenski) },
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "profitPerTradeAction": "TARGET_HIGHER_VALUE",
        "projectedProfitPerTrade": 210,
        "profitPerTradeLevers": [
          { "lever": "Sourcing Negotiation", "currentProfit": 167, "upliftPotential": 17, "action": "Negotiate nižje nabavne cene." },
          { "lever": "Premium Pricing", "currentProfit": 167, "upliftPotential": 13, "action": "Dvigni cene za 8%." }
        ],
        "bestTradeProfile": {
          "categoryHint": "premium electronics",
          "priceRangeLow": 350,
          "priceRangeHigh": 650,
          "characteristics": ["Profit 480€ (287% ROI).", "Revenue range 350-650€.", "Outlier — 3x+ boljši od povprečja."]
        }
      }
    }
  ],
  "summary": "3 source-i. Portfolio avg profit/trade: 167€ → 245€ (+78€ uplift). Top: Avtonet (280€/trade)."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeAiResult {
  entries: SourceEntry[];
  portfolio: PortfolioSummary;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoSources(
  parsed: AiResponse | null,
  detEntries: SourceEntry[],
  detPortfolio: PortfolioSummary,
  detSummary: string,
): MergeAiResult {
  const result: MergeAiResult = {
    entries: detEntries,
    portfolio: detPortfolio,
    summary: detSummary,
    aiUsed: false,
  };

  if (!parsed || typeof parsed !== 'object') return result;

  const aiSourcesMap = new Map<string, NonNullable<AiResponse['sources']>[number]>();
  if (Array.isArray(parsed.sources)) {
    for (const ai of parsed.sources) {
      if (ai && typeof ai === 'object' && typeof ai.source === 'string') {
        aiSourcesMap.set(ai.source, ai);
      }
    }
  }

  const newEntries: SourceEntry[] = [];
  for (const det of detEntries) {
    const ai = aiSourcesMap.get(det.source);
    if (!ai || !ai.maximization) {
      newEntries.push(det);
      continue;
    }

    const aiMax = ai.maximization;
    const action = clampEnum(
      aiMax.profitPerTradeAction,
      VALID_ACTION,
      det.maximization.profitPerTradeAction,
    );

    // Anti-hallucination: projectedProfitPerTrade ∈ [avgProfitPerTrade, avgProfitPerTrade × 2 ali +500€]
    const maxProfitBound = Math.min(
      PROFIT_MAX,
      Math.max(
        det.metrics.avgProfitPerTrade + 25,
        Math.min(det.metrics.avgProfitPerTrade * 2 + 50, det.metrics.avgProfitPerTrade + 500),
      ),
    );
    const minProfitBound = Math.max(0, det.metrics.avgProfitPerTrade);
    const projectedProfitPerTrade = round0(clampNum(
      aiMax.projectedProfitPerTrade,
      minProfitBound, maxProfitBound,
      det.maximization.projectedProfitPerTrade,
    ));
    const profitPerTradeUplift = round0(clampNum(
      projectedProfitPerTrade - det.metrics.avgProfitPerTrade,
      UPLIFT_MIN, UPLIFT_MAX, 0,
    ));

    // Levers
    const levers: ProfitPerTradeLever[] = [];
    if (Array.isArray(aiMax.profitPerTradeLevers)) {
      for (const l of aiMax.profitPerTradeLevers.slice(0, MAX_LEVERS_PER_SOURCE)) {
        if (!l || typeof l !== 'object') continue;
        levers.push({
          lever: clampString(l.lever, 50, 'Lever'),
          currentProfit: round0(clampNum(
            l.currentProfit, 0, PROFIT_MAX, Math.max(0, det.metrics.avgProfitPerTrade),
          )),
          upliftPotential: round0(clampNum(
            l.upliftPotential, UPLIFT_MIN, UPLIFT_MAX, 0,
          )),
          action: clampString(l.action, 200, 'Akcija.'),
        });
      }
    }
    if (levers.length === 0) {
      for (const l of det.maximization.profitPerTradeLevers) levers.push(l);
    }

    // Best trade profile
    let bestTradeProfile = det.maximization.bestTradeProfile;
    if (aiMax.bestTradeProfile && typeof aiMax.bestTradeProfile === 'object') {
      const btp = aiMax.bestTradeProfile;
      const priceRangeLow = round0(clampNum(
        btp.priceRangeLow,
        COST_MIN, COST_MAX, det.maximization.bestTradeProfile.priceRangeLow,
      ));
      const priceRangeHigh = round0(clampNum(
        btp.priceRangeHigh,
        priceRangeLow, COST_MAX, det.maximization.bestTradeProfile.priceRangeHigh,
      ));
      const characteristics: string[] = Array.isArray(btp.characteristics)
        ? btp.characteristics.slice(0, MAX_TRADE_PROFILE_CHARS).map((c) =>
            clampString(c, 200, 'Specifična lastnost.'),
          ).filter((s) => s.length > 0)
        : det.maximization.bestTradeProfile.characteristics;
      bestTradeProfile = {
        categoryHint: clampString(
          btp.categoryHint,
          100,
          det.maximization.bestTradeProfile.categoryHint,
        ),
        priceRangeLow,
        priceRangeHigh,
        characteristics: characteristics.length >= 1
          ? characteristics
          : det.maximization.bestTradeProfile.characteristics,
      };
    }

    newEntries.push({
      source: det.source,
      displayName: det.displayName,
      metrics: det.metrics,
      maximization: {
        profitPerTradeAction: action,
        projectedProfitPerTrade,
        profitPerTradeUplift,
        profitPerTradeLevers: levers,
        bestTradeProfile,
        sourceRanking: det.maximization.sourceRanking,
      },
    });
  }

  if (newEntries.length === detEntries.length) {
    result.entries = newEntries;
  }

  // Rebuild portfolio with new entries
  result.portfolio = buildPortfolio(result.entries);
  result.summary = clampString(parsed.summary, 400, buildSummary(result.entries, result.portfolio));
  result.aiUsed = true;
  return result;
}

// --- Handler -------------------------------------------------------------

const dealSourceProfitPerTradeMaximizerHandler = withAiRoute<DealSourceProfitPerTradeMaximizerInput>({
  endpoint: '/api/ai/deal-source-profit-per-trade-maximizer',
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
      return apiOk({
        ok: true,
        sources: [],
        portfolio: {
          avgProfitPerTrade: 0,
          maximizedAvgProfitPerTrade: 0,
          totalUpliftPerTrade: 0,
          sourceRanking: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Per Trade Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Per Trade Maximizer ni mogoč.',
      } satisfies DealSourceProfitPerTradeResponse);
    }

    // 2) Compute per-trade metrics and aggregate by source
    const computed: TradeComputed[] = [];
    for (const t of soldTrades) {
      const c = computeTrade(t);
      if (c) computed.push(c);
    }

    if (computed.length === 0) {
      return apiOk({
        ok: true,
        sources: [],
        portfolio: {
          avgProfitPerTrade: 0,
          maximizedAvgProfitPerTrade: 0,
          totalUpliftPerTrade: 0,
          sourceRanking: [],
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Profit Per Trade Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Profit Per Trade Maximizer ni mogoč.',
      } satisfies DealSourceProfitPerTradeResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);

    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-profit-per-trade-maximizer:${currentMonth}`;
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
      } satisfies DealSourceProfitPerTradeResponse);
    }

    // 4) AI prompt with grounding
    const promptData = buildPromptData(entries, computed, portfolio);
    const prompt = buildPrompt(promptData);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      const merged = mergeAiIntoSources(parsed, entries, portfolio, summary);
      entries = merged.entries;
      portfolio = merged.portfolio;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-profit-per-trade-maximizer',
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
    } satisfies DealSourceProfitPerTradeResponse);
  },
});

export const GET = dealSourceProfitPerTradeMaximizerHandler;
export const POST = dealSourceProfitPerTradeMaximizerHandler;
