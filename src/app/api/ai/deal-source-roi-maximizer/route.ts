// v8.00: AI Deal Source ROI Maximizer — AI maksimizira ROI PERCENTAGE per
// deal source — kateri source-i dajejo najvišji ROI in kako iz njih izvleči
// MAXIMUM ROI %. Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira
// TOTAL PROFIT per source) — ta maksimizira ROI PERCENTAGE per source (koliko %
// return na investiran kapital). Razlika od deal-source-trend-analyzer (ki
// track-a trend) — ta MAXIMIZIRA ROI z actionable levers (negotiate prices,
// target higher-value, reduce fees). Razlika od deal-source-intelligence (ki
// primerja sources) — ta daje PER-SOURCE ROI maximization plan z capital
// reallocation advice. Razlika od deal-source-momentum-analyzer (ki gleda
// momentum) — ta KOMBINIRA momentum z ROI za maximization. Razlika od
// capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ta maksimizira
// ROI PER SOURCE (ne compounding growth). Razlika od profit-multiplier-engine
// (v8.00 ki multiplicira profit z 8 levers) — ta fokusira na PER-SOURCE ROI
// maximization. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI
// per held item) — ta maksimizira ROI per SOURCE (ne per item).
//
// "Bolha: ROI 145%, totalInvested 2,800€, totalReturned 6,860€, margin 59%,
// efficiency 84/100, INCREASING trend. Action: IMPROVE_MARGIN → projected ROI
// 175% (+30% uplift). Levers: negotiate better prices (+15%), reduce fees
// (+5%), target higher-value items (+10%). Vinted: ROI 85%, action
// INCREASE_VOLUME → projected 105% (+20% uplift). Portfolio: current 110% →
// maximized 145% (+35% uplift, shift 800€ to Bolha)."

// GET+POST /api/ai/deal-source-roi-maximizer
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

type RoiMaximizationAction =
  | 'INCREASE_VOLUME'
  | 'IMPROVE_MARGIN'
  | 'REDUCE_COSTS'
  | 'EXIT';
type RoiGrowthTrend = 'INCREASING' | 'STABLE' | 'DECREASING';

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
  avgROI: number;
  totalInvested: number;
  totalReturned: number;
  profitMargin: number;
  roiEfficiencyScore: number;
  roiGrowthTrend: RoiGrowthTrend;
  tradeCount: number;
}

interface RoiMaximizationLever {
  lever: string;
  currentGap: number;
  potentialGain: number;
  action: string;
}

interface SourceMaximization {
  roiMaximizationAction: RoiMaximizationAction;
  projectedROI: number;
  roiUplift: number;
  roiMaximizationLevers: RoiMaximizationLever[];
  capitalEfficiencyAdvice: string;
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  currentPortfolioROI: number;
  maximizedPortfolioROI: number;
  totalROIUplift: number;
  capitalReallocationAdvice: string;
  sourceROIRanking: Array<{
    source: string;
    currentROI: number;
    projectedROI: number;
    rank: number;
  }>;
}

interface DealSourceRoiResponse {
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
      roiMaximizationAction?: RoiMaximizationAction;
      projectedROI?: number;
      roiMaximizationLevers?: Array<{
        lever?: string;
        currentGap?: number;
        potentialGain?: number;
        action?: string;
      }>;
      capitalEfficiencyAdvice?: string;
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

const ROI_MIN = -50;
const ROI_MAX = 300;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000;
const GAP_MIN = 0;
const GAP_MAX = 100;
const GAIN_MIN = 0;
const GAIN_MAX = 50;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 200;
const MAX_LEVERS_PER_SOURCE = 4;

const VALID_ACTION: readonly RoiMaximizationAction[] = [
  'INCREASE_VOLUME',
  'IMPROVE_MARGIN',
  'REDUCE_COSTS',
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
  netReturn: number;
  profit: number;
  roi: number;
  date: number;
}

function computeTrade(t: SoldTradeRow): TradeComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const cost = buyPrice + buyFees;
  const netReturn = sellPrice - sellFees;
  const profit = netReturn - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  const date = toMs(t.sellDate) || toMs(t.buyDate);
  const source = detectSource(t);
  return { source, cost, netReturn, profit, roi, date };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalInvested: number;
  totalReturned: number;
  totalProfit: number;
  rois: number[];
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
        totalInvested: 0,
        totalReturned: 0,
        totalProfit: 0,
        rois: [],
        dates: [],
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalInvested += tr.cost;
    agg.totalReturned += tr.netReturn;
    agg.totalProfit += tr.profit;
    agg.rois.push(tr.roi);
    agg.dates.push(tr.date);
  }
  return map;
}

function computeTrend(trades: TradeComputed[]): RoiGrowthTrend {
  if (trades.length < 4) return 'STABLE';
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const avgFirst = avg(first.map((t) => t.roi));
  const avgSecond = avg(second.map((t) => t.roi));
  if (avgFirst === 0) return avgSecond > 0 ? 'INCREASING' : 'STABLE';
  const ratio = avgSecond / avgFirst;
  if (ratio >= 1.10) return 'INCREASING';
  if (ratio <= 0.90) return 'DECREASING';
  return 'STABLE';
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const avgROI = round2(clampNum(avg(agg.rois), ROI_MIN, ROI_MAX, 0));
  const totalInvested = round0(clampNum(
    Math.max(0, agg.totalInvested),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const totalReturned = round0(clampNum(
    Math.max(0, agg.totalReturned),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const profitMargin = totalReturned > 0
    ? round2(clampNum(
      (Math.max(0, agg.totalProfit) / totalReturned) * 100,
      0, 100, 0,
    ))
    : 0;

  // roiEfficiencyScore: 40% ROI norm + 30% volume norm + 30% consistency (margin)
  const roiNorm = clampNum(
    Math.min(100, Math.max(0, avgROI * 0.7)),
    SCORE_MIN, SCORE_MAX, 0,
  );
  const volumeNorm = clampNum(
    Math.min(100, tradeCount * 5),
    SCORE_MIN, SCORE_MAX, 0,
  );
  const consistencyNorm = profitMargin;
  const roiEfficiencyScore = round0(clampNum(
    roiNorm * 0.4 + volumeNorm * 0.3 + consistencyNorm * 0.3,
    SCORE_MIN, SCORE_MAX, 0,
  ));

  const roiGrowthTrend = computeTrend(agg.trades);

  return {
    avgROI,
    totalInvested,
    totalReturned,
    profitMargin,
    roiEfficiencyScore,
    roiGrowthTrend,
    tradeCount,
  };
}

function decideRoiAction(metrics: SourceMetrics): RoiMaximizationAction {
  // EXIT: negative ROI consistently
  if (metrics.avgROI < 0 && metrics.profitMargin < 30) {
    return 'EXIT';
  }
  // INCREASE_VOLUME: high ROI but low volume → scale
  if (
    metrics.avgROI > 60 &&
    metrics.tradeCount < 10 &&
    metrics.roiGrowthTrend !== 'DECREASING'
  ) {
    return 'INCREASE_VOLUME';
  }
  // REDUCE_COSTS: low margin → cut costs
  if (metrics.profitMargin < 40 || metrics.avgROI < 30) {
    return 'REDUCE_COSTS';
  }
  // IMPROVE_MARGIN: default — improve pricing/fees
  return 'IMPROVE_MARGIN';
}

function buildRoiLevers(metrics: SourceMetrics): RoiMaximizationLever[] {
  const levers: RoiMaximizationLever[] = [];

  // Pricing / margin lever
  const marginGap = round0(clampNum(
    Math.max(0, 70 - metrics.profitMargin),
    GAP_MIN, GAP_MAX, 30,
  ));
  const marginGain = round2(clampNum(
    marginGap * 0.15,
    GAIN_MIN, GAIN_MAX, 5,
  ));
  levers.push({
    lever: 'Profit Margin',
    currentGap: marginGap,
    potentialGain: marginGain,
    action: clampString(
      `Povečaj margin iz ${metrics.profitMargin}% z višjimi prodajnimi cenami (premium pozicioniranje).`,
      200,
      'Povečaj margin z boljšo pricing strategy.',
    ),
  });

  // Sourcing cost lever (lower buy price)
  const costGap = round0(clampNum(
    Math.max(0, 50 - metrics.avgROI),
    GAP_MIN, GAP_MAX, 25,
  ));
  const costGain = round2(clampNum(
    costGap * 0.2,
    GAIN_MIN, GAIN_MAX, 5,
  ));
  levers.push({
    lever: 'Sourcing Cost',
    currentGap: costGap,
    potentialGain: costGain,
    action: clampString(
      `Negotiate nižje nabavne cene (target -10% pri buy-ih nad 100€).`,
      200,
      'Negotiate nižje nabavne cene.',
    ),
  });

  // Fees lever (reduce selling fees)
  const feesGap = round0(clampNum(
    15, // fees typically 5-15%, gap to 0
    GAP_MIN, GAP_MAX, 15,
  ));
  const feesGain = round2(clampNum(
    feesGap * 0.1,
    GAIN_MIN, GAIN_MAX, 3,
  ));
  levers.push({
    lever: 'Selling Fees',
    currentGap: feesGap,
    potentialGain: feesGain,
    action: clampString(
      `Zmanjšaj fees z direktno prodajo ali premium platform-ami z nižjimi fees.`,
      200,
      'Zmanjšaj selling fees.',
    ),
  });

  // Volume lever (more high-ROI trades)
  const volumeGap = round0(clampNum(
    Math.max(0, Math.min(100, (20 - metrics.tradeCount) * 5)),
    GAP_MIN, GAP_MAX, 50,
  ));
  const volumeGain = round2(clampNum(
    volumeGap * 0.1,
    GAIN_MIN, GAIN_MAX, 5,
  ));
  levers.push({
    lever: 'Trade Volume',
    currentGap: volumeGap,
    potentialGain: volumeGain,
    action: clampString(
      `Povečaj volume z dodatnim sourcing-om v ${displayName('')} podobnih kategorijah.`,
      200,
      'Povečaj trade volume.',
    ),
  });

  return levers.slice(0, MAX_LEVERS_PER_SOURCE);
}

function buildSourceMaximization(
  metrics: SourceMetrics,
  source: string,
): SourceMaximization {
  const action = decideRoiAction(metrics);
  const levers = buildRoiLevers(metrics);

  // ROI uplift = sum of lever potentialGains (capped at 50)
  const totalGain = Math.min(GAIN_MAX, levers.reduce((s, l) => s + l.potentialGain, 0));

  // Action factor: how much of the gap can be realized
  const actionFactor: Record<RoiMaximizationAction, number> = {
    INCREASE_VOLUME: 0.6,
    IMPROVE_MARGIN: 0.7,
    REDUCE_COSTS: 0.5,
    EXIT: 0,
  };

  let roiUplift = round2(clampNum(
    totalGain * actionFactor[action],
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Anti-hallucination: uplift can't exceed 50% of current ROI (max 50pp absolute)
  if (metrics.avgROI > 0) {
    roiUplift = round2(Math.min(roiUplift, Math.max(10, metrics.avgROI * 0.5)));
  } else {
    roiUplift = round2(Math.min(roiUplift, 30));
  }

  const projectedROI = round2(clampNum(
    Math.max(metrics.avgROI, metrics.avgROI + roiUplift),
    ROI_MIN, ROI_MAX, metrics.avgROI,
  ));

  // Capital efficiency advice per action
  const adviceByAction: Record<RoiMaximizationAction, string> = {
    INCREASE_VOLUME: clampString(
      `INCREASE_VOLUME: ROI ${metrics.avgROI}% je visok, vendar samo ${metrics.tradeCount} trade-ov — povečaj kapital za 50% in volume za maksimiranje total return. Ciljaj ${metrics.tradeCount + Math.ceil(metrics.tradeCount * 0.5)} trades/12m.`,
      400,
      `Povečaj kapital in volume za maksimiranje ROI.`,
    ),
    IMPROVE_MARGIN: clampString(
      `IMPROVE_MARGIN: ROI ${metrics.avgROI}% je dober, vendar margin ${metrics.profitMargin}% ima prostor — izboljšaj pricing strategy (premium +5-10%) in zmanjšaj fees za višji net ROI. Ciljaj ${projectedROI}%.`,
      400,
      `Izboljšaj margin z boljšo pricing strategy.`,
    ),
    REDUCE_COSTS: clampString(
      `REDUCE_COSTS: margin ${metrics.profitMargin}% je nizka — zmanjšaj nabavne cene (negotiate -10%) in fees (cross-platform). Vsak -1% cost = +${Math.round(metrics.avgROI * 0.1)}% ROI.`,
      400,
      `Zmanjšaj stroške za višji ROI.`,
    ),
    EXIT: clampString(
      `EXIT: ROI ${metrics.avgROI}% negativen in margin ${metrics.profitMargin}% nizka — zapusti ${displayName(source)} in preusmeri ves kapital v boljše source-e.`,
      400,
      `Zapusti ta source in preusmeri kapital.`,
    ),
  };

  return {
    roiMaximizationAction: action,
    projectedROI,
    roiUplift,
    roiMaximizationLevers: levers,
    capitalEfficiencyAdvice: adviceByAction[action],
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>): SourceEntry[] {
  const entries: SourceEntry[] = [];
  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    const maximization = buildSourceMaximization(metrics, agg.source);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by roiEfficiencyScore desc
  entries.sort((a, b) => b.metrics.roiEfficiencyScore - a.metrics.roiEfficiencyScore);
  return entries;
}

function buildPortfolio(
  entries: SourceEntry[],
  totalInvestedAll: number,
): PortfolioSummary {
  // Weighted avg ROI by totalInvested
  const currentPortfolioROI = totalInvestedAll > 0
    ? round2(clampNum(
      entries.reduce(
        (s, e) => s + e.metrics.avgROI * e.metrics.totalInvested,
        0,
      ) / totalInvestedAll,
      ROI_MIN, ROI_MAX, 0,
    ))
    : 0;

  const maximizedPortfolioROI = totalInvestedAll > 0
    ? round2(clampNum(
      entries.reduce(
        (s, e) => s + e.maximization.projectedROI * e.metrics.totalInvested,
        0,
      ) / totalInvestedAll,
      ROI_MIN, ROI_MAX, 0,
    ))
    : 0;

  const totalROIUplift = round2(clampNum(
    maximizedPortfolioROI - currentPortfolioROI,
    ROI_MIN, UPLIFT_MAX, 0,
  ));

  // Source ROI ranking by projected ROI
  const sourceROIRanking = entries
    .map((e, idx) => ({
      source: e.source,
      currentROI: e.metrics.avgROI,
      projectedROI: e.maximization.projectedROI,
      rank: idx + 1,
    }))
    .sort((a, b) => b.projectedROI - a.projectedROI)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  // Capital reallocation advice
  const topSource = sourceROIRanking[0];
  const bottomSource = sourceROIRanking[sourceROIRanking.length - 1];
  const capitalReallocationAdvice = topSource && bottomSource && topSource.source !== bottomSource.source
    ? clampString(
      `Premakni kapital iz ${displayName(bottomSource.source)} (ROI ${bottomSource.currentROI}% → projected ${bottomSource.projectedROI}%) v ${displayName(topSource.source)} (ROI ${topSource.currentROI}% → projected ${topSource.projectedROI}%). Realokacija +20% kapitala v ${displayName(topSource.source)} poveča portfolio ROI za ~${round0(totalROIUplift * 0.3)}%.`,
      400,
      `Premakni kapital v višje-ROI source.`,
    )
    : clampString(
      `Ohrani kapital distribucijo — vsi source-i imajo podobno projekcijo ROI.`,
      400,
      `Ohrani kapital distribucijo.`,
    );

  return {
    currentPortfolioROI,
    maximizedPortfolioROI,
    totalROIUplift,
    capitalReallocationAdvice,
    sourceROIRanking,
  };
}

function buildSummary(
  entries: SourceEntry[],
  portfolio: PortfolioSummary,
): string {
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio ROI: ${portfolio.currentPortfolioROI}% → ${portfolio.maximizedPortfolioROI}% (+${portfolio.totalROIUplift}% uplift).`,
    `Top: ${portfolio.sourceROIRanking[0]?.source ?? 'n/a'} (projected ${portfolio.sourceROIRanking[0]?.projectedROI ?? 0}%).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceRoiMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceRoiMaximizer(req);
}

async function handleDealSourceRoiMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-roi-maximizer', 20);
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
          currentPortfolioROI: 0,
          maximizedPortfolioROI: 0,
          totalROIUplift: 0,
          capitalReallocationAdvice: 'Ni SOLD trgovin — Deal Source ROI Maximizer ni mogoč.',
          sourceROIRanking: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source ROI Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source ROI Maximizer ni mogoč.',
      } satisfies DealSourceRoiResponse);
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
          currentPortfolioROI: 0,
          maximizedPortfolioROI: 0,
          totalROIUplift: 0,
          capitalReallocationAdvice: 'Ni veljavnih SOLD trgovin — Deal Source ROI Maximizer ni mogoč.',
          sourceROIRanking: [],
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source ROI Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source ROI Maximizer ni mogoč.',
      } satisfies DealSourceRoiResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);

    const totalInvestedAll = computed.reduce((s, c) => s + c.cost, 0);
    let portfolio = buildPortfolio(entries, totalInvestedAll);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-roi-maximizer:${currentMonth}`;
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
      } satisfies DealSourceRoiResponse);
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
        roiMaximizationAction: e.maximization.roiMaximizationAction,
        projectedROI: e.maximization.projectedROI,
        roiUplift: e.maximization.roiUplift,
        roiMaximizationLevers: e.maximization.roiMaximizationLevers,
      },
    }));

    const promptData = {
      totalTrades: computed.length,
      totalSources: entries.length,
      sources: sourcesForAI,
      deterministicPortfolio: {
        currentPortfolioROI: portfolio.currentPortfolioROI,
        maximizedPortfolioROI: portfolio.maximizedPortfolioROI,
        totalROIUplift: portfolio.totalROIUplift,
      },
      caps: {
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        gapMin: GAP_MIN, gapMax: GAP_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
      },
    };

    const prompt = `Si AI "Deal Source ROI Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za ROI PERCENTAGE MAXIMIZATION per deal source — identificiraš kateri source-i dajejo najvišji ROI in kako iz njih izvleči MAXIMUM ROI %. Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira TOTAL PROFIT per source) — ti maksimiziraš ROI PERCENTAGE per source (koliko % return na investiran kapital). Razlika od deal-source-trend-analyzer (ki track-a trend) — ti MAXIMIZIRAŠ ROI z actionable levers. Razlika od deal-source-intelligence (ki primerja sources) — ti daje PER-SOURCE ROI maximization plan z capital reallocation advice. Razlika od deal-source-momentum-analyzer (ki gleda momentum) — ti KOMBINIRAŠ momentum z ROI za maximization. Razlika od capital-growth-maximizer (v7.99 ki maksimizira capital growth) — ti maksimiziraš ROI PER SOURCE (ne compounding growth). Razlika od profit-multiplier-engine (v8.00 ki multiplicira profit z 8 levers) — ti fokusiraš na PER-SOURCE ROI maximization.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.roiMaximizationAction: INCREASE_VOLUME | IMPROVE_MARGIN | REDUCE_COSTS | EXIT (lahko se razlikuje od deterministic),
   - maximization.projectedROI % [-50, 300] (≥ currentROI, ≤ currentROI × 1.5 ali +50 absolute — anti-hallucination),
   - maximization.roiMaximizationLevers: 2-4 levers { lever (max 50), currentGap % [0, 100], potentialGain % [0, 50], action (max 200, slovenski) },
   - maximization.capitalEfficiencyAdvice (max 400, slovenski).
2. portfolio.capitalReallocationAdvice (max 400, slovenski).
3. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "roiMaximizationAction": "IMPROVE_MARGIN",
        "projectedROI": 175,
        "roiMaximizationLevers": [
          { "lever": "Profit Margin", "currentGap": 30, "potentialGain": 12, "action": "Povečaj cene za 5%." },
          { "lever": "Sourcing Cost", "currentGap": 25, "potentialGain": 8, "action": "Negotiate -10% pri buy-ih." }
        ],
        "capitalEfficiencyAdvice": "IMPROVE_MARGIN: Bolha ROI 145% je dober, vendar margin 59% ima prostor — izboljšaj pricing za višji net ROI."
      }
    }
  ],
  "portfolio": {
    "capitalReallocationAdvice": "Premakni kapital iz Vinted (ROI 85%) v Bolha (ROI 145%)."
  },
  "summary": "3 source-i. Portfolio ROI: 110% → 145% (+35% uplift). Top: Bolha (175%)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const detBySource = new Map<string, SourceEntry>();
        for (const e of entries) detBySource.set(e.source, e);

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
            aiMax.roiMaximizationAction,
            VALID_ACTION,
            det.maximization.roiMaximizationAction,
          );

          // Anti-hallucination: projectedROI ∈ [currentROI, currentROI × 1.5 or +50]
          const maxROIDound = Math.min(
            ROI_MAX,
            Math.max(
              det.metrics.avgROI + 10,
              Math.min(det.metrics.avgROI * 1.5 + 20, det.metrics.avgROI + 50),
            ),
          );
          const projectedROI = round2(clampNum(
            aiMax.projectedROI,
            det.metrics.avgROI, maxROIDound,
            det.maximization.projectedROI,
          ));
          const roiUplift = round2(clampNum(
            projectedROI - det.metrics.avgROI,
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));

          // Levers
          const levers: RoiMaximizationLever[] = [];
          if (Array.isArray(aiMax.roiMaximizationLevers)) {
            for (const l of aiMax.roiMaximizationLevers.slice(0, MAX_LEVERS_PER_SOURCE)) {
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
            for (const l of det.maximization.roiMaximizationLevers) levers.push(l);
          }

          const capitalEfficiencyAdvice = clampString(
            aiMax.capitalEfficiencyAdvice,
            400,
            det.maximization.capitalEfficiencyAdvice,
          );

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              roiMaximizationAction: action,
              projectedROI,
              roiUplift,
              roiMaximizationLevers: levers,
              capitalEfficiencyAdvice,
            },
          });
        }

        if (newEntries.length === entries.length) {
          entries = newEntries;
        }

        // Rebuild portfolio with new entries
        portfolio = buildPortfolio(entries, totalInvestedAll);

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
        '/api/ai/deal-source-roi-maximizer',
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
    } satisfies DealSourceRoiResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-roi-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
