// v8.06: AI Deal Source Cash Flow Maximizer — AI MAXIMIZIRA CASH FLOW per
// source (ne samo profit ampak dejanski cash generated per source — accounting
// za fees, carrying costs in time value of money). "Bolha generira 3200€
// cash flow/month ampak bi lahko bilo 4800€ z 3 akcijami — Vinted samo 800€."
// Razlika od deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira
// capital efficiency per source = profit per euro per day) — ta MAKSIMIZIRA
// CASH FLOW per source (cash generiran per mesec po fees + carrying costs).
// Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit
// per source) — ta maksimizira NET CASH FLOW (revenue − fees − carrying costs)
// z cashFlowEfficiency. Razlika od deal-source-profit-per-trade-maximizer
// (v8.04 ki maksimizira profit per trade €) — ta maksimizira CASH FLOW per
// source per month. Razlika od deal-source-margin-maximizer (v8.03 ki
// maksimizira margin %) — ta maksimizira CASH FLOW z feeOptimizationPlan in
// carryingCostReduction. Razlika od deal-source-roi-maximizer (v8.00 ki
// maksimizira ROI per source) — ta maksimizira cashFlowVelocityScore. Razlika
// od cashflow engine (v7.40 ki analyzia cashflow čez portfolio) — ta maksimizira
// per-source CASH FLOW z cashFlowMaximizationAction. Razlika od
// cash-recovery-accelerator (v7.97 ki accelerira cash recovery) — ta
// maksimizira CASH FLOW PER SOURCE z projectedCashFlow30d. Razlika od
// profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate)
// — ta daje per-source cash flow z feeOptimizationPlan in sourceCashFlowRanking.

// GET+POST /api/ai/deal-source-cash-flow-maximizer
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

type CashFlowAction =
  | 'REDUCE_FEES'
  | 'FASTER_TURNOVER'
  | 'HIGHER_PRICES'
  | 'MORE_VOLUME'
  | 'LOWER_CARRYING_COSTS';

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
  totalRevenue: number; // €
  totalFees: number; // € = buyFees + sellFees
  totalCarryingCosts: number; // € estimated = invested × (avgHoldDays/30) × 0.005 (0.5%/mo)
  netCashFlow: number; // € = revenue - fees - carryingCosts
  tradeCount: number;
  cashFlowPerMonth: number; // €/mo (over 12m window)
  cashFlowEfficiency: number; // 0-100 (netCashFlow / revenue × 100)
  avgHoldDays: number;
  totalInvested: number; // € (for carrying cost computation)
}

interface SourceMaximization {
  cashFlowMaximizationAction: CashFlowAction;
  projectedCashFlow30d: number; // € forecasted next 30 days with action
  cashFlowUplift: number; // €/mo improvement
  feeOptimizationPlan: string;
  carryingCostReduction: string;
  cashFlowVelocityScore: number; // 0-100 (how fast cash flows)
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface PortfolioSummary {
  totalCurrentCashFlow: number; // €/mo
  totalMaximizedCashFlow: number; // €/mo
  totalCashFlowUplift: number; // €/mo
  sourceCashFlowRanking: Array<{
    source: string;
    displayName: string;
    currentCashFlow: number;
    maximizedCashFlow: number;
    rank: number;
  }>;
}

interface DealSourceCashFlowResponse {
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
      cashFlowMaximizationAction?: CashFlowAction;
      projectedCashFlow30d?: number;
      cashFlowUplift?: number;
      feeOptimizationPlan?: string;
      carryingCostReduction?: string;
      cashFlowVelocityScore?: number;
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const MONTHS_IN_WINDOW = 12;
const CARRYING_COST_RATE = 0.005; // 0.5% per month of invested capital

const REVENUE_MIN = 0;
const REVENUE_MAX = 100_000;
const FEES_MIN = 0;
const FEES_MAX = 50_000;
const CARRYING_MIN = 0;
const CARRYING_MAX = 50_000;
const CASH_FLOW_MIN = -10_000;
const CASH_FLOW_MAX = 100_000;
const CASH_FLOW_PER_MONTH_MIN = -10_000;
const CASH_FLOW_PER_MONTH_MAX = 100_000;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 500_000;
const HOLD_MIN = 1;
const HOLD_MAX = 365;
const PROJECTED_30D_MIN = -10_000;
const PROJECTED_30D_MAX = 100_000;

const VALID_ACTION: readonly CashFlowAction[] = [
  'REDUCE_FEES',
  'FASTER_TURNOVER',
  'HIGHER_PRICES',
  'MORE_VOLUME',
  'LOWER_CARRYING_COSTS',
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
  revenue: number; // € = sellPrice
  fees: number; // € = buyFees + sellFees
  invested: number; // € = buyPrice + buyFees
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
  const revenue = sellPrice;
  const fees = buyFees + sellFees;
  const invested = buyPrice + buyFees;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  const source = detectSource(t);
  return { source, revenue, fees, invested, holdDays, sellMs, within12m };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalRevenue: number;
  totalFees: number;
  totalInvested: number;
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
        totalRevenue: 0,
        totalFees: 0,
        totalInvested: 0,
        totalHoldDays: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalRevenue += tr.revenue;
    agg.totalFees += tr.fees;
    agg.totalInvested += tr.invested;
    agg.totalHoldDays += tr.holdDays;
  }
  return map;
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalRevenue = round0(clampNum(agg.totalRevenue, REVENUE_MIN, REVENUE_MAX, 0));
  const totalFees = round0(clampNum(agg.totalFees, FEES_MIN, FEES_MAX, 0));
  const totalInvested = round0(clampNum(agg.totalInvested, CAPITAL_MIN, CAPITAL_MAX, 0));
  const avgHoldDays = round0(clampNum(
    agg.totalHoldDays / Math.max(1, tradeCount),
    HOLD_MIN, HOLD_MAX, 30,
  ));
  // Carrying cost = invested × (avgHoldDays/30) × 0.5%/mo
  const totalCarryingCosts = round0(clampNum(
    totalInvested * (avgHoldDays / 30) * CARRYING_COST_RATE,
    CARRYING_MIN, CARRYING_MAX, 0,
  ));
  const netCashFlow = round0(clampNum(
    totalRevenue - totalFees - totalCarryingCosts,
    CASH_FLOW_MIN, CASH_FLOW_MAX, 0,
  ));
  // Per-month over 12m window
  const cashFlowPerMonth = round0(clampNum(
    netCashFlow / MONTHS_IN_WINDOW,
    CASH_FLOW_PER_MONTH_MIN, CASH_FLOW_PER_MONTH_MAX, 0,
  ));
  // Efficiency = netCashFlow / revenue × 100
  const cashFlowEfficiency = round0(clampNum(
    totalRevenue > 0 ? (netCashFlow / totalRevenue) * 100 : 0,
    SCORE_MIN, SCORE_MAX, 0,
  ));

  return {
    totalRevenue,
    totalFees,
    totalCarryingCosts,
    netCashFlow,
    tradeCount,
    cashFlowPerMonth,
    cashFlowEfficiency,
    avgHoldDays,
    totalInvested,
  };
}

function decideAction(metrics: SourceMetrics): CashFlowAction {
  // If carrying costs high relative to revenue → LOWER_CARRYING_COSTS
  if (metrics.totalRevenue > 0 && metrics.totalCarryingCosts / metrics.totalRevenue > 0.10) {
    return 'LOWER_CARRYING_COSTS';
  }
  // If fees high relative to revenue (> 15%) → REDUCE_FEES
  if (metrics.totalRevenue > 0 && metrics.totalFees / metrics.totalRevenue > 0.15) {
    return 'REDUCE_FEES';
  }
  // If avgHoldDays > 45 → FASTER_TURNOVER
  if (metrics.avgHoldDays > 45) {
    return 'FASTER_TURNOVER';
  }
  // If cashFlowEfficiency < 30 but tradeCount low → MORE_VOLUME
  if (metrics.cashFlowEfficiency < 30 && metrics.tradeCount < 10) {
    return 'MORE_VOLUME';
  }
  // If efficiency OK but cash flow per month low → HIGHER_PRICES
  if (metrics.cashFlowEfficiency >= 30 && metrics.cashFlowPerMonth < 500) {
    return 'HIGHER_PRICES';
  }
  // Default
  return 'MORE_VOLUME';
}

function buildSourceMaximization(metrics: SourceMetrics): SourceMaximization {
  const action = decideAction(metrics);

  let upliftMultiplier = 1.10; // baseline 10% uplift
  switch (action) {
    case 'REDUCE_FEES': upliftMultiplier = 1.18; break; // 18% boost by fee reduction
    case 'FASTER_TURNOVER': upliftMultiplier = 1.25; break; // 25% by faster cycles
    case 'HIGHER_PRICES': upliftMultiplier = 1.15; break; // 15% by higher prices
    case 'MORE_VOLUME': upliftMultiplier = 1.30; break; // 30% by more volume
    case 'LOWER_CARRYING_COSTS': upliftMultiplier = 1.12; break; // 12% by reducing holding
  }

  const projectedMonthlyRaw = metrics.cashFlowPerMonth * upliftMultiplier;
  const projectedCashFlow30d = round0(clampNum(
    Math.max(0, projectedMonthlyRaw),
    PROJECTED_30D_MIN, PROJECTED_30D_MAX, metrics.cashFlowPerMonth,
  ));
  const cashFlowUplift = round0(clampNum(
    Math.max(0, projectedCashFlow30d - metrics.cashFlowPerMonth),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Velocity score: combine cashFlowPerMonth × cashFlowEfficiency
  // Higher score = faster & more efficient cash flow
  const velocityRaw = (metrics.cashFlowPerMonth / 50) * 0.5 + metrics.cashFlowEfficiency * 0.5;
  const cashFlowVelocityScore = round0(clampNum(
    velocityRaw,
    SCORE_MIN, SCORE_MAX, 0,
  ));

  // Fee optimization plan — Slovenian
  const feePct = metrics.totalRevenue > 0
    ? (metrics.totalFees / metrics.totalRevenue) * 100
    : 0;
  const feeOptimizationPlan = `Fees ${round2(feePct)}% revenue. ` +
    `Strategije: bundle multiple items v enem shipping-u, izberi Bolha Top insertion samo za premium items, ` +
    `pogajaj se za bulk listing fees pri >10 active, uporabi Vinted free listing window (weekends), ` +
    `premakni low-margin items na platforme z nižjimi fees (Subito/Kleinanzeigen).`;

  // Carrying cost reduction
  const carryPct = metrics.totalRevenue > 0
    ? (metrics.totalCarryingCosts / metrics.totalRevenue) * 100
    : 0;
  const carryingCostReduction = `Carrying ${round2(carryPct)}% revenue (avg ${metrics.avgHoldDays}d hold). ` +
    `Strategije: skrajšaj avg hold za ${Math.round(metrics.avgHoldDays * 0.3)} dni z aggressive pricing in auto-refresh, ` +
    `bundle stagnirajoče items v discounted bundle, ` +
    `premakni dolgo-held items na platforme z nižjimi carrying costs ali prodaj na debelo.`;

  return {
    cashFlowMaximizationAction: action,
    projectedCashFlow30d,
    cashFlowUplift,
    feeOptimizationPlan: feeOptimizationPlan.slice(0, 400),
    carryingCostReduction: carryingCostReduction.slice(0, 400),
    cashFlowVelocityScore,
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
  // Sort by cashFlowPerMonth desc (best cash flow source first)
  entries.sort((a, b) => b.metrics.cashFlowPerMonth - a.metrics.cashFlowPerMonth);
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  const totalCurrentCashFlow = round0(clampNum(
    entries.reduce((s, e) => s + e.metrics.cashFlowPerMonth, 0),
    CASH_FLOW_PER_MONTH_MIN, CASH_FLOW_PER_MONTH_MAX, 0,
  ));
  const totalMaximizedCashFlow = round0(clampNum(
    entries.reduce((s, e) => s + e.maximization.projectedCashFlow30d, 0),
    CASH_FLOW_PER_MONTH_MIN, CASH_FLOW_PER_MONTH_MAX, 0,
  ));
  const totalCashFlowUplift = round0(clampNum(
    totalMaximizedCashFlow - totalCurrentCashFlow,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const sourceCashFlowRanking = entries.map((e, idx) => ({
    source: e.source,
    displayName: e.displayName,
    currentCashFlow: e.metrics.cashFlowPerMonth,
    maximizedCashFlow: e.maximization.projectedCashFlow30d,
    rank: idx + 1,
  }));

  return {
    totalCurrentCashFlow,
    totalMaximizedCashFlow,
    totalCashFlowUplift,
    sourceCashFlowRanking,
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Cash Flow Maximizer ni mogoč.';
  }
  const best = entries[0];
  const worst = entries[entries.length - 1];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio cash flow: ${portfolio.totalCurrentCashFlow}€/mo → ${portfolio.totalMaximizedCashFlow}€/mo (+${portfolio.totalCashFlowUplift}€).`,
    `Best: ${best.displayName} (${best.metrics.cashFlowPerMonth}€/mo). Worst: ${worst.displayName} (${worst.metrics.cashFlowPerMonth}€/mo).`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceCashFlowMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceCashFlowMaximizer(req);
}

async function handleDealSourceCashFlowMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-cash-flow-maximizer', 20);
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
          totalCurrentCashFlow: 0,
          totalMaximizedCashFlow: 0,
          totalCashFlowUplift: 0,
          sourceCashFlowRanking: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Cash Flow Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Cash Flow Maximizer ni mogoč.',
      } satisfies DealSourceCashFlowResponse);
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
          totalCurrentCashFlow: 0,
          totalMaximizedCashFlow: 0,
          totalCashFlowUplift: 0,
          sourceCashFlowRanking: [],
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Cash Flow Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Cash Flow Maximizer ni mogoč.',
      } satisfies DealSourceCashFlowResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);
    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-cash-flow-maximizer:${currentMonth}`;
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
      } satisfies DealSourceCashFlowResponse);
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
        totalCurrentCashFlow: portfolio.totalCurrentCashFlow,
        totalMaximizedCashFlow: portfolio.totalMaximizedCashFlow,
        totalCashFlowUplift: portfolio.totalCashFlowUplift,
        sourceCashFlowRanking: portfolio.sourceCashFlowRanking,
      },
      caps: {
        revenueMin: REVENUE_MIN, revenueMax: REVENUE_MAX,
        feesMin: FEES_MIN, feesMax: FEES_MAX,
        carryingMin: CARRYING_MIN, carryingMax: CARRYING_MAX,
        cashFlowMin: CASH_FLOW_MIN, cashFlowMax: CASH_FLOW_MAX,
        cashFlowPerMonthMin: CASH_FLOW_PER_MONTH_MIN, cashFlowPerMonthMax: CASH_FLOW_PER_MONTH_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        projected30dMin: PROJECTED_30D_MIN, projected30dMax: PROJECTED_30D_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Cash Flow Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CASH FLOW MAXIMIZATION per source — kako maksimizirati NET CASH FLOW (revenue − fees − carrying costs) per source per month. Tvoj cilj je "Bolha generira 3200€ cash flow/mesec ampak bi lahko bilo 4800€ z 3 akcijami — Vinted samo 800€". Razlika od deal-source-capital-efficiency-maximizer (v8.05 ki maksimizira capital efficiency per source = profit per euro per day) — ti MAKSIMIZIRAŠ CASH FLOW per source (cash generiran per mesec po fees + carrying costs). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ta maksimizira NET CASH FLOW (revenue − fees − carrying costs) z cashFlowEfficiency. Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade €) — ta maksimizira CASH FLOW per source per month. Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta maksimizira CASH FLOW z feeOptimizationPlan in carryingCostReduction. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta maksimizira cashFlowVelocityScore. Razlika od cashflow engine (v7.40 ki analyzia cashflow čez portfolio) — ta maksimizira per-source CASH FLOW z cashFlowMaximizationAction. Razlika od cash-recovery-accelerator (v7.97 ki accelerira cash recovery) — ta maksimizira CASH FLOW PER SOURCE z projectedCashFlow30d. Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta daje per-source cash flow z feeOptimizationPlan in sourceCashFlowRanking.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.cashFlowMaximizationAction: REDUCE_FEES | FASTER_TURNOVER | HIGHER_PRICES | MORE_VOLUME | LOWER_CARRYING_COSTS,
   - maximization.projectedCashFlow30d € [-10000, 100000] (forecasted next 30 days z action — ≥ current cashFlowPerMonth, ≤ current × 1.5 ali +5000€),
   - maximization.cashFlowUplift €/mo [0, 50000] (improvement = projected − current),
   - maximization.feeOptimizationPlan (max 400, slovenski — specifične fee reduction strategije za ta source),
   - maximization.carryingCostReduction (max 400, slovenski — kako zmanjšati holding costs),
   - maximization.cashFlowVelocityScore [0, 100] (koliko hitro cash teče iz tega source — higher = faster),
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "cashFlowMaximizationAction": "MORE_VOLUME",
        "projectedCashFlow30d": 4800,
        "cashFlowUplift": 1600,
        "feeOptimizationPlan": "Fees 8% revenue. Bundle multiple items v enem shipping-u...",
        "carryingCostReduction": "Carrying 5% revenue. Skrajšaj avg hold za 10 dni...",
        "cashFlowVelocityScore": 72
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "cashFlowMaximizationAction": "REDUCE_FEES",
        "projectedCashFlow30d": 1100,
        "cashFlowUplift": 300,
        "feeOptimizationPlan": "Fees 18% revenue. Uporabi Vinted free listing window...",
        "carryingCostReduction": "Carrying 3% revenue. Premakni na Subito...",
        "cashFlowVelocityScore": 45
      }
    }
  ],
  "summary": "2 source-a. Bolha 3200€/mo → 4800€/mo (+1600€, MORE_VOLUME). Vinted 800€/mo → 1100€/mo (+300€, REDUCE_FEES). Portfolio: 4000€ → 5900€/mo (+1900€)."
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
            aiMax.cashFlowMaximizationAction,
            VALID_ACTION,
            det.maximization.cashFlowMaximizationAction,
          );

          // Anti-hallucination: projectedCashFlow30d ∈ [current, current × 1.5 ali +5000€]
          const maxBound = Math.min(
            PROJECTED_30D_MAX,
            Math.max(
              det.metrics.cashFlowPerMonth + 100,
              Math.min(det.metrics.cashFlowPerMonth * 1.5 + 500, det.metrics.cashFlowPerMonth + 5000),
            ),
          );
          const minBound = Math.max(PROJECTED_30D_MIN, det.metrics.cashFlowPerMonth);
          const projectedCashFlow30d = round0(clampNum(
            aiMax.projectedCashFlow30d,
            minBound, maxBound,
            det.maximization.projectedCashFlow30d,
          ));
          const cashFlowUplift = round0(clampNum(
            Math.max(0, projectedCashFlow30d - det.metrics.cashFlowPerMonth),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          const cashFlowVelocityScore = round0(clampNum(
            aiMax.cashFlowVelocityScore,
            SCORE_MIN, SCORE_MAX,
            det.maximization.cashFlowVelocityScore,
          ));
          const feeOptimizationPlan = clampString(
            aiMax.feeOptimizationPlan, 400, det.maximization.feeOptimizationPlan,
          );
          const carryingCostReduction = clampString(
            aiMax.carryingCostReduction, 400, det.maximization.carryingCostReduction,
          );

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              cashFlowMaximizationAction: action,
              projectedCashFlow30d,
              cashFlowUplift,
              feeOptimizationPlan,
              carryingCostReduction,
              cashFlowVelocityScore,
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
        '/api/ai/deal-source-cash-flow-maximizer',
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
    } satisfies DealSourceCashFlowResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-cash-flow-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
