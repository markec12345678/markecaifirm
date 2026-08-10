// v7.97: AI Deal Source Profit Maximizer — AI identifies which deal sources
// (Bolha, Vinted, Avtonet, mobile.de, ...) generate the MOST PROFIT in zadnjih
// 12 mesecih in priporoči kako MAXIMIZIRATI profit iz vsakega source-a posebej.
// Kombinira source ROI, volume, momentum in consistency v actionable profit-
// maximization plan per source. The "ultimate source-level profit maximizer."
//
// Razlika od deal-source-trend-analyzer (ki track-a source trend) — ta
// MAXIMIZIRA profit per source z actionable SCALE_UP/OPTIMIZE/EXIT plan.
// Razlika od deal-source-intelligence (ki primerja sources) — ta generira
// PER-SOURCE capital reallocation + profit uplift projection. Razlika od
// deal-source-momentum-analyzer (ki gleda momentum) — ta KOMBINIRA momentum
// z ROI, volume in win-rate za ultimate profit score. Razlika od deal-
// profitability-forecaster (ki napove deal profitability) — ta fokusira na
// SOURCE-LEVEL profitability (ne deal-level). Razlika od revenue-stream-
// optimizer (v7.94 ki optimizira revenue streams) — ta fokusira izključno
// na DEAL SOURCES (platforme kje kupuješ) z capital reallocation advice.
// Razlika od profit-maximizer-pro (v7.94 ki maksimizira profit preko 7
// levers) — ta fokusira na PER-SOURCE profit maximization z capital shift.
//
// "Bolha: totalProfit 4,200€ (ROI 145%, winRate 78%, 12 trades). Action:
// SCALE_UP → projected 5,800€ (+1,600€ uplift). Levers: volume +3 trades,
// winRate +5pp (470€ lift), margin +5% (380€ lift). Capital reallocation:
// +1,200€ to Bolha. Best source: Bolha (efficiency 84/100)."
//
// GET+POST /api/ai/deal-source-profit-maximizer
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

type ProfitMaximizationAction =
  | 'SCALE_UP'
  | 'MAINTAIN'
  | 'OPTIMIZE'
  | 'SCALE_DOWN'
  | 'EXIT';
type ProfitGrowthTrend = 'INCREASING' | 'STABLE' | 'DECREASING';

interface SoldTradeRow {
  id: string;
  title: string;
  category: string;
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
  totalProfit: number;
  avgProfitPerTrade: number;
  avgROI: number; // %
  winRate: number; // 0-100 %
  tradeCount: number;
  profitPerWeek: number;
  profitEfficiencyScore: number; // 0-100
  profitGrowthTrend: ProfitGrowthTrend;
}

interface ProfitMaximizationLever {
  lever: string;
  currentGap: number; // how far from optimal
  potentialLift: number; // € uplift
  action: string;
}

interface SourceMaximization {
  profitMaximizationAction: ProfitMaximizationAction;
  projectedProfitWithAction: number;
  profitMaximizationLevers: ProfitMaximizationLever[];
  sourceOptimizationStrategy: string;
  capitalReallocation: number; // € (positive = add capital, negative = withdraw)
  expectedProfitUplift: number; // €
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  totalCurrentProfit: number;
  totalProjectedProfit: number;
  profitUpliftPotential: number;
  sourceRebalancingAdvice: string;
  bestProfitSource: string | null;
}

interface DealSourceProfitResponse {
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
      profitMaximizationAction?: ProfitMaximizationAction;
      projectedProfitWithAction?: number;
      profitMaximizationLevers?: Array<{
        lever?: string;
        currentGap?: number;
        potentialLift?: number;
        action?: string;
      }>;
      sourceOptimizationStrategy?: string;
      capitalReallocation?: number;
      expectedProfitUplift?: number;
    };
  }>;
  portfolio?: {
    sourceRebalancingAdvice?: string;
    bestProfitSource?: string | null;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const ROI_MIN = -100;
const ROI_MAX = 500;
const WINRATE_MIN = 0;
const WINRATE_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100_000;
const REALLOC_MIN = -100_000;
const REALLOC_MAX = 100_000;
const LEVER_GAP_MIN = 0;
const LEVER_GAP_MAX = 100;
const LEVER_LIFT_MIN = 0;
const LEVER_LIFT_MAX = 50_000;

const VALID_ACTION: readonly ProfitMaximizationAction[] = [
  'SCALE_UP',
  'MAINTAIN',
  'OPTIMIZE',
  'SCALE_DOWN',
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

interface TradeProfit {
  source: string;
  profit: number;
  cost: number;
  date: number; // sellDate ms (or buyDate if no sellDate)
  isWin: boolean;
}

function computeTradeProfit(t: SoldTradeRow): TradeProfit | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null; // not sold properly
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const isWin = profit > 0;
  const date = toMs(t.sellDate) || toMs(t.buyDate);
  const source = detectSource(t);
  return { source, profit, cost, date, isWin };
}

interface SourceAgg {
  source: string;
  trades: TradeProfit[];
  totalProfit: number;
  totalCost: number;
  winCount: number;
  rois: number[];
  dates: number[];
}

function aggregateBySource(
  trades: TradeProfit[],
): Map<string, SourceAgg> {
  const map = new Map<string, SourceAgg>();
  for (const tr of trades) {
    let agg = map.get(tr.source);
    if (!agg) {
      agg = {
        source: tr.source,
        trades: [],
        totalProfit: 0,
        totalCost: 0,
        winCount: 0,
        rois: [],
        dates: [],
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalProfit += tr.profit;
    agg.totalCost += tr.cost;
    if (tr.isWin) agg.winCount += 1;
    if (tr.cost > 0) agg.rois.push((tr.profit / tr.cost) * 100);
    agg.dates.push(tr.date);
  }
  return map;
}

function computeTrend(trades: TradeProfit[]): ProfitGrowthTrend {
  if (trades.length < 4) return 'STABLE'; // not enough data
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const avgFirst = avg(first.map((t) => t.profit));
  const avgSecond = avg(second.map((t) => t.profit));
  if (avgFirst === 0) return avgSecond > 0 ? 'INCREASING' : 'STABLE';
  const ratio = avgSecond / avgFirst;
  if (ratio >= 1.10) return 'INCREASING';
  if (ratio <= 0.90) return 'DECREASING';
  return 'STABLE';
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalProfit = round0(Math.max(0, agg.totalProfit));
  const avgProfitPerTrade = round0(tradeCount > 0 ? agg.totalProfit / tradeCount : 0);
  const avgROI = round2(
    clampNum(avg(agg.rois), ROI_MIN, ROI_MAX, 0),
  );
  const winRate = round0(
    clampNum((agg.winCount / Math.max(1, tradeCount)) * 100, WINRATE_MIN, WINRATE_MAX, 0),
  );
  const profitPerWeek = round0(totalProfit / 52);
  // profitEfficiencyScore: 40% profit norm + 30% volume norm + 30% consistency (winRate)
  const profitNorm = Math.min(100, (totalProfit / 100)); // €100/week ~= 100 (scaled)
  const volumeNorm = Math.min(100, tradeCount * 4); // 25 trades = 100%
  const consistencyNorm = winRate;
  const profitEfficiencyScore = round0(
    clampNum(
      profitNorm * 0.4 + volumeNorm * 0.3 + consistencyNorm * 0.3,
      SCORE_MIN, SCORE_MAX, 0,
    ),
  );
  const profitGrowthTrend = computeTrend(agg.trades);
  return {
    totalProfit,
    avgProfitPerTrade,
    avgROI,
    winRate,
    tradeCount,
    profitPerWeek,
    profitEfficiencyScore,
    profitGrowthTrend,
  };
}

function decideAction(metrics: SourceMetrics): ProfitMaximizationAction {
  if (
    metrics.profitGrowthTrend === 'INCREASING' &&
    metrics.winRate >= 60 &&
    metrics.profitEfficiencyScore >= 60 &&
    metrics.avgROI > 0
  ) {
    return 'SCALE_UP';
  }
  if (metrics.totalProfit <= 0 && metrics.winRate < 30 && metrics.avgROI < 0) {
    return 'EXIT';
  }
  if (metrics.profitEfficiencyScore < 20 || metrics.winRate < 35) {
    return 'SCALE_DOWN';
  }
  if (
    metrics.profitEfficiencyScore < 50 ||
    metrics.winRate < 50 ||
    metrics.avgROI < 30
  ) {
    return 'OPTIMIZE';
  }
  return 'MAINTAIN';
}

function buildLevers(
  metrics: SourceMetrics,
  avgCapitalPerTrade: number,
  sourceName: string,
): ProfitMaximizationLever[] {
  const levers: ProfitMaximizationLever[] = [];

  // Volume lever: gap = how many more trades possible (cap 100), lift = gap% × avgProfit
  const volumeGap = round0(
    clampNum(100 - Math.min(100, metrics.tradeCount * 4), LEVER_GAP_MIN, LEVER_GAP_MAX, 0),
  );
  const volumeLift = round0(
    clampNum(
      (volumeGap / 100) * metrics.tradeCount * metrics.avgProfitPerTrade * 0.5,
      LEVER_LIFT_MIN, LEVER_LIFT_MAX, 0,
    ),
  );
  levers.push({
    lever: 'Trade Volume',
    currentGap: volumeGap,
    potentialLift: volumeLift,
    action: clampString(
      `Povečaj število tradeov iz ${metrics.tradeCount} na ${Math.round(metrics.tradeCount * 1.5)} z dodatnim sourcing-om.`,
      200,
      'Povečaj volume z več sourcing-a.',
    ),
  });

  // WinRate lever: gap = 100 - winRate, lift = gap × avgProfit × 0.2
  const winGap = round0(
    clampNum(100 - metrics.winRate, LEVER_GAP_MIN, LEVER_GAP_MAX, 0),
  );
  const winLift = round0(
    clampNum(
      (winGap / 100) * metrics.tradeCount * metrics.avgProfitPerTrade * 0.2,
      LEVER_LIFT_MIN, LEVER_LIFT_MAX, 0,
    ),
  );
  levers.push({
    lever: 'Win Rate',
    currentGap: winGap,
    potentialLift: winLift,
    action: clampString(
      `Izboljšaj win rate iz ${metrics.winRate}% z boljšo deal selection (filter low-dealScore).`,
      200,
      'Izboljšaj win rate z boljšo deal selection.',
    ),
  });

  // Margin lever: gap = max(0, 80 - avgROI), lift = gap% × avgCapitalPerTrade × tradeCount × 0.3
  const marginGap = round0(
    clampNum(
      Math.max(0, 80 - metrics.avgROI),
      LEVER_GAP_MIN, LEVER_GAP_MAX, 0,
    ),
  );
  const marginLift = round0(
    clampNum(
      (marginGap / 100) * avgCapitalPerTrade * metrics.tradeCount * 0.3,
      LEVER_LIFT_MIN, LEVER_LIFT_MAX, 0,
    ),
  );
  levers.push({
    lever: 'Profit Margin',
    currentGap: marginGap,
    potentialLift: marginLift,
    action: clampString(
      `Povečaj margin iz ${metrics.avgROI}% z boljšo pricing strategy (negotiate lower buy, list higher sell).`,
      200,
      'Povečaj margin z boljšo pricing strategy.',
    ),
  });

  // Source mix lever: gap = 30 (constant), lift = 5% of totalProfit
  const mixGap = 30;
  const mixLift = round0(
    clampNum(metrics.totalProfit * 0.05, LEVER_LIFT_MIN, LEVER_LIFT_MAX, 0),
  );
  levers.push({
    lever: 'Source Diversification',
    currentGap: mixGap,
    potentialLift: mixLift,
    action: clampString(
      `Diverzificiraj source mix z dodatnimi ${sourceName} podobnimi platform-ami.`,
      200,
      'Diverzificiraj source mix.',
    ),
  });

  return levers;
}

function buildSourceMaximization(
  metrics: SourceMetrics,
  totalCapitalInvested: number,
  sourceName: string,
): SourceMaximization {
  const action = decideAction(metrics);
  const avgCapitalPerTrade = metrics.tradeCount > 0
    ? totalCapitalInvested / metrics.tradeCount
    : 0;
  const levers = buildLevers(metrics, avgCapitalPerTrade, sourceName);

  // Expected profit uplift = sum of potentialLift × action factor
  const actionFactor: Record<ProfitMaximizationAction, number> = {
    SCALE_UP: 0.8,
    MAINTAIN: 0.3,
    OPTIMIZE: 0.6,
    SCALE_DOWN: 0.1,
    EXIT: 0,
  };
  const rawUplift = levers.reduce((s, l) => s + l.potentialLift, 0) * actionFactor[action];
  const expectedProfitUplift = round0(
    clampNum(rawUplift, UPLIFT_MIN, UPLIFT_MAX, 0),
  );

  // Projected profit with action
  const projectedProfitWithAction = round0(
    clampNum(
      metrics.totalProfit + expectedProfitUplift,
      PROFIT_MIN, PROFIT_MAX, metrics.totalProfit,
    ),
  );

  // Capital reallocation
  const reallocationRate: Record<ProfitMaximizationAction, number> = {
    SCALE_UP: 0.25,
    MAINTAIN: 0,
    OPTIMIZE: 0,
    SCALE_DOWN: -0.25,
    EXIT: -1,
  };
  const capitalReallocation = round0(
    clampNum(
      totalCapitalInvested * reallocationRate[action],
      REALLOC_MIN, REALLOC_MAX, 0,
    ),
  );

  const strategyByAction: Record<ProfitMaximizationAction, string> = {
    SCALE_UP: clampString(
      `SCALE_UP: ${metrics.profitEfficiencyScore}/100 efficiency, winRate ${metrics.winRate}%, ${metrics.profitGrowthTrend} trend — povečaj kapital in volume za 25% da izkoristiš momentum.`,
      400,
      'Povečaj kapital in volume.',
    ),
    MAINTAIN: clampString(
      `MAINTAIN: stabilno profitabilen (efficiency ${metrics.profitEfficiencyScore}/100) — ohrani trenutni volumen in pricing strategy.`,
      400,
      'Ohrani trenutno strategijo.',
    ),
    OPTIMIZE: clampString(
      `OPTIMIZE: prostor za izboljšave (winRate ${metrics.winRate}%, ROI ${metrics.avgROI}%) — izboljšaj deal selection in pricing za +${expectedProfitUplift}€ uplift.`,
      400,
      'Izboljšaj deal selection in pricing.',
    ),
    SCALE_DOWN: clampString(
      `SCALE_DOWN: nizka profitabilnost (efficiency ${metrics.profitEfficiencyScore}/100, winRate ${metrics.winRate}%) — zmanjšaj kapital za 25% in ga preusmeri v boljše source-e.`,
      400,
      'Zmanjšaj kapital za 25%.',
    ),
    EXIT: clampString(
      `EXIT: negativen (profit ${metrics.totalProfit}€, winRate ${metrics.winRate}%) — zapusti ta source in preusmeri ves kapital drugam.`,
      400,
      'Zapusti ta source.',
    ),
  };

  return {
    profitMaximizationAction: action,
    projectedProfitWithAction,
    profitMaximizationLevers: levers,
    sourceOptimizationStrategy: strategyByAction[action],
    capitalReallocation,
    expectedProfitUplift,
  };
}

function buildSourceEntries(
  aggMap: Map<string, SourceAgg>,
): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    const totalCapital = agg.totalCost;
    const maximization = buildSourceMaximization(metrics, totalCapital, agg.source);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by profitEfficiencyScore desc
  entries.sort((a, b) => b.metrics.profitEfficiencyScore - a.metrics.profitEfficiencyScore);
  return entries;
}

function buildPortfolio(
  entries: SourceEntry[],
): PortfolioSummary {
  if (entries.length === 0) {
    return {
      totalCurrentProfit: 0,
      totalProjectedProfit: 0,
      profitUpliftPotential: 0,
      sourceRebalancingAdvice: 'Ni podatkov o source-ih za portfolio advice.',
      bestProfitSource: null,
    };
  }
  const totalCurrentProfit = round0(
    entries.reduce((s, e) => s + e.metrics.totalProfit, 0),
  );
  const totalProjectedProfit = round0(
    clampNum(
      entries.reduce((s, e) => s + e.maximization.projectedProfitWithAction, 0),
      PROFIT_MIN, PROFIT_MAX, totalCurrentProfit,
    ),
  );
  const profitUpliftPotential = round0(
    clampNum(totalProjectedProfit - totalCurrentProfit, 0, UPLIFT_MAX, 0),
  );
  const bestEntry = entries[0]; // already sorted by efficiency desc
  const bestProfitSource = bestEntry ? bestEntry.source : null;

  // Source rebalancing advice
  const scaleUp = entries.filter((e) => e.maximization.profitMaximizationAction === 'SCALE_UP');
  const scaleDown = entries.filter((e) => e.maximization.profitMaximizationAction === 'SCALE_DOWN');
  const exit_ = entries.filter((e) => e.maximization.profitMaximizationAction === 'EXIT');
  const parts: string[] = [];
  if (scaleUp.length > 0) {
    parts.push(`Povečaj kapital v: ${scaleUp.map((e) => e.source).join(', ')}.`);
  }
  if (scaleDown.length > 0) {
    parts.push(`Zmanjšaj kapital v: ${scaleDown.map((e) => e.source).join(', ')}.`);
  }
  if (exit_.length > 0) {
    parts.push(`Zapusti: ${exit_.map((e) => e.source).join(', ')}.`);
  }
  if (parts.length === 0) {
    parts.push('Vsi source-i v MAINTAIN ali OPTIMIZE — gradualne prilagoditve.');
  }
  const sourceRebalancingAdvice = parts.join(' ').slice(0, 400);

  return {
    totalCurrentProfit,
    totalProjectedProfit,
    profitUpliftPotential,
    sourceRebalancingAdvice,
    bestProfitSource,
  };
}

function buildSummary(
  entries: SourceEntry[],
  portfolio: PortfolioSummary,
): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin z linked Listing v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.';
  }
  const parts: string[] = [
    `${entries.length} source-ov analiziranih.`,
    `Current profit: ${portfolio.totalCurrentProfit}€ → projected ${portfolio.totalProjectedProfit}€ (+${portfolio.profitUpliftPotential}€ uplift).`,
  ];
  if (portfolio.bestProfitSource) {
    parts.push(`Best source: ${portfolio.bestProfitSource}.`);
  }
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceProfitMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceProfitMaximizer(req);
}

async function handleDealSourceProfitMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-profit-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for monitor.source)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        sellPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
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
          totalCurrentProfit: 0,
          totalProjectedProfit: 0,
          profitUpliftPotential: 0,
          sourceRebalancingAdvice: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.',
          bestProfitSource: null,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.',
      } satisfies DealSourceProfitResponse);
    }

    // 2) Compute per-source metrics
    const tradeProfits: TradeProfit[] = [];
    for (const t of soldTrades) {
      const tp = computeTradeProfit(t);
      if (tp) tradeProfits.push(tp);
    }
    const aggMap = aggregateBySource(tradeProfits);
    let sources = buildSourceEntries(aggMap);
    let portfolio = buildPortfolio(sources);
    let summary = buildSummary(sources, portfolio);

    // Empty-state: 0 sources with trades (shouldn't happen since soldTrades > 0)
    if (sources.length === 0) {
      return NextResponse.json({
        ok: true,
        sources: [],
        portfolio: {
          totalCurrentProfit: 0,
          totalProjectedProfit: 0,
          profitUpliftPotential: 0,
          sourceRebalancingAdvice: 'Ni SOLD trgovin z linked Listing v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.',
          bestProfitSource: null,
        },
        summary: 'Ni SOLD trgovin z linked Listing v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin z linked Listing v zadnjih 12 mesecih — Deal Source Profit Maximizer ni mogoč.',
      } satisfies DealSourceProfitResponse);
    }

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-profit-maximizer:${currentMonth}`;
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
      } satisfies DealSourceProfitResponse);
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

    // Compact context for AI (top 15 sources by efficiency)
    const topSourcesForAI = sources.slice(0, 15).map((s) => ({
      source: s.source,
      displayName: s.displayName,
      metrics: s.metrics,
      detMaximization: s.maximization,
    }));

    const promptData = {
      portfolio,
      sources: topSourcesForAI,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        winRateMin: WINRATE_MIN, winRateMax: WINRATE_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        reallocMin: REALLOC_MIN, reallocMax: REALLOC_MAX,
        leverGapMin: LEVER_GAP_MIN, leverGapMax: LEVER_GAP_MAX,
        leverLiftMin: LEVER_LIFT_MIN, leverLiftMax: LEVER_LIFT_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Profit Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za SOURCE-LEVEL profit maximization — identificiraš KATERI source-i (platforme kje kupuješ) generirajo največ profit-a in kako MAXIMIZIRATI profit iz vsakega posebej. Razlika od deal-source-trend-analyzer (ki track-a source trend) — ti MAXIMIZIRAŠ profit per source z actionable SCALE_UP/OPTIMIZE/EXIT plan. Razlika od deal-source-intelligence (ki primerja sources) — ti generiraš PER-SOURCE capital reallocation + profit uplift projection. Razlika od deal-source-momentum-analyzer (ki gleda momentum) — ti KOMBINIRAŠ momentum z ROI, volume in win-rate za ultimate profit score. Razlika od revenue-stream-optimizer (v7.94 ki optimizira revenue streams) — ti fokusiraš izključno na DEAL SOURCES (platforme kje kupuješ) z capital reallocation advice. Razlika od profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers) — ti fokusiraš na PER-SOURCE profit maximization z capital shift.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za monitor.source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz topSources, daj profit maximization plan:
   - source (string, MORA biti ena iz topSources — anti-hallucination),
   - maximization.profitMaximizationAction: SCALE_UP | MAINTAIN | OPTIMIZE | SCALE_DOWN | EXIT (lahko se razlikuje od detMaximization če imaš boljšo idejo),
   - maximization.projectedProfitWithAction € [0, 100000] (≥ totalProfit, ≤ totalProfit × 3 anti-hallucination),
   - maximization.profitMaximizationLevers: 3-5 levers { lever (max 80, EN), currentGap [0, 100], potentialLift € [0, 50000], action (max 200, slovenski) },
   - maximization.sourceOptimizationStrategy (max 400, slovenski — kako izvleči več profit-a iz tega source-a),
   - maximization.capitalReallocation € [-100000, 100000] (positive = dodaj kapital, negative = umakni),
   - maximization.expectedProfitUplift € [0, 100000] (≤ projectedProfitWithAction - totalProfit anti-hallucination).
2. portfolio.sourceRebalancingAdvice (max 400, slovenski — kako rebalancirati capital med source-i).
3. portfolio.bestProfitSource (string, MORA biti ena iz topSources ali null).
4. summary: slovenski povzetek (max 400 znakov). NE izmišljuj source-ov — uporabi samo iz topSources.

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "profitMaximizationAction": "SCALE_UP",
        "projectedProfitWithAction": 5800,
        "profitMaximizationLevers": [
          { "lever": "Trade Volume", "currentGap": 52, "potentialLift": 800, "action": "Povečaj število tradeov z dodatnim sourcing-om." }
        ],
        "sourceOptimizationStrategy": "Bolha ima visok efficiency — povečaj kapital in volume za 25%.",
        "capitalReallocation": 1200,
        "expectedProfitUplift": 1600
      }
    }
  ],
  "portfolio": {
    "sourceRebalancingAdvice": "Povečaj kapital v: bolha, vinted. Zmanjšaj: nepremicnine.",
    "bestProfitSource": "bolha"
  },
  "summary": "3 source-i analizirani. Current profit: 4200€ → projected 5800€ (+1600€ uplift). Best source: bolha."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const knownSources = new Set(sources.map((s) => s.source));
        const detBySource = new Map<string, SourceEntry>();
        for (const s of sources) detBySource.set(s.source, s);

        const aiSources: SourceEntry[] = [];
        if (Array.isArray(parsed.sources)) {
          for (const r of parsed.sources) {
            if (!r || typeof r !== 'object') continue;
            const src = clampString(r.source, 50, '').toLowerCase().trim();
            if (!src || !knownSources.has(src)) continue; // skip unknown — anti-hallucination
            const det = detBySource.get(src)!;
            const aiMax = r.maximization ?? {};

            const action = clampEnum(
              aiMax.profitMaximizationAction,
              VALID_ACTION,
              det.maximization.profitMaximizationAction,
            );

            const expectedProfitUplift = round0(clampNum(
              aiMax.expectedProfitUplift,
              UPLIFT_MIN, UPLIFT_MAX,
              det.maximization.expectedProfitUplift,
            ));

            // Anti-hallucination: projectedProfitWithAction must be in [totalProfit, totalProfit × 3]
            const profitLowBound = det.metrics.totalProfit;
            const profitHighBound = Math.min(
              PROFIT_MAX,
              Math.max(det.metrics.totalProfit * 3, det.metrics.totalProfit + expectedProfitUplift),
            );
            const aiProjected = round0(clampNum(
              aiMax.projectedProfitWithAction,
              PROFIT_MIN, PROFIT_MAX,
              det.maximization.projectedProfitWithAction,
            ));
            const projectedProfitWithAction = round0(
              Math.max(profitLowBound, Math.min(profitHighBound, aiProjected)),
            );

            // Levers
            const levers: ProfitMaximizationLever[] = [];
            if (Array.isArray(aiMax.profitMaximizationLevers)) {
              for (const l of aiMax.profitMaximizationLevers.slice(0, 5)) {
                if (!l || typeof l !== 'object') continue;
                levers.push({
                  lever: clampString(l.lever, 80, det.maximization.profitMaximizationLevers[0]?.lever ?? 'Lever'),
                  currentGap: round0(clampNum(
                    l.currentGap,
                    LEVER_GAP_MIN, LEVER_GAP_MAX,
                    det.maximization.profitMaximizationLevers[0]?.currentGap ?? 0,
                  )),
                  potentialLift: round0(clampNum(
                    l.potentialLift,
                    LEVER_LIFT_MIN, LEVER_LIFT_MAX,
                    det.maximization.profitMaximizationLevers[0]?.potentialLift ?? 0,
                  )),
                  action: clampString(l.action, 200, det.maximization.profitMaximizationLevers[0]?.action ?? 'Izboljšaj lever.'),
                });
              }
            }
            if (levers.length === 0) {
              for (const l of det.maximization.profitMaximizationLevers) levers.push(l);
            }

            const sourceOptimizationStrategy = clampString(
              aiMax.sourceOptimizationStrategy,
              400,
              det.maximization.sourceOptimizationStrategy,
            );
            const capitalReallocation = round0(clampNum(
              aiMax.capitalReallocation,
              REALLOC_MIN, REALLOC_MAX,
              det.maximization.capitalReallocation,
            ));

            aiSources.push({
              ...det,
              maximization: {
                profitMaximizationAction: action,
                projectedProfitWithAction,
                profitMaximizationLevers: levers,
                sourceOptimizationStrategy,
                capitalReallocation,
                expectedProfitUplift,
              },
            });
          }
        }
        // Fallback to deterministic if AI returned nothing useful
        if (aiSources.length === 0) {
          for (const s of sources) aiSources.push(s);
        } else {
          // For sources AI didn't return, keep deterministic values
          const aiSourceSet = new Set(aiSources.map((s) => s.source));
          for (const s of sources) {
            if (!aiSourceSet.has(s.source)) aiSources.push(s);
          }
        }
        // Sort by profitEfficiencyScore desc
        aiSources.sort((a, b) => b.metrics.profitEfficiencyScore - a.metrics.profitEfficiencyScore);
        sources = aiSources;

        // Rebuild portfolio with AI sources
        const aiPortfolio = buildPortfolio(aiSources);
        // Override with AI advice if valid
        const aiPortfolioAdvice = clampString(
          parsed.portfolio?.sourceRebalancingAdvice,
          400,
          aiPortfolio.sourceRebalancingAdvice,
        );
        const aiBestRaw = clampString(parsed.portfolio?.bestProfitSource ?? '', 50, '').toLowerCase().trim();
        const bestProfitSource = aiBestRaw && knownSources.has(aiBestRaw)
          ? aiBestRaw
          : aiPortfolio.bestProfitSource;
        portfolio = {
          ...aiPortfolio,
          sourceRebalancingAdvice: aiPortfolioAdvice,
          bestProfitSource,
        };

        summary = clampString(parsed.summary, 400, buildSummary(sources, portfolio));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/deal-source-profit-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { sources, portfolio, summary });
    }

    return NextResponse.json({
      ok: true,
      sources,
      portfolio,
      summary,
      aiUsed,
    } satisfies DealSourceProfitResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-profit-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
