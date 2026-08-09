// v7.95: AI Profit Margin Maximizer — AI identificira specifične akcije
// za MAKSIMIZACIJO profitnih marž. Najde MAXIMUM dosegljivo maržo in
// da plan za dosego. Razlika od profit-margin-forecaster-pro (v7.85 ki
// forecast-a margin) — ta MAKSIMIZIRA margin z actionable plan.
// Razlika od profit-margin-optimizer-v2 (ki optimizira margin) — ta
// najde MAXIMUM in da plan za dosego. Razlika od profit-margin-
// acceleration-tracker (v7.93 ki track-a margin acceleration) — ta
// maksimizira FUTURE margin z maximization actions. Razlika od
// profit-maximizer-pro (v7.94 ki maksimizira profit preko 7 levers)
// — ta fokusira izključno na MARGIN maximization. Razlika od
// profit-margin-heatmap (ki prikazuje margin distribution) — ta daje
// MAXIMIZATION PLAN. Razlika od profit-margin-trend-analyzer (v7.82
// ki track-a margin trend) — ta maksimizira future margin.
//
// "Current margin: 22%, max achievable: 35% (gap: 13%). Quick win:
// raise elektronika prices +5% → +3% margin. Action: negotiate Bolha
// fees → +2% margin."
//
// GET+POST /api/ai/profit-margin-maximizer
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

type ActionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface MarginBaseline {
  currentAvgMargin: number; // % — clamped [-50, 100]
  bestMarginEver: number; // % — clamped [-50, 100]
  worstMarginEver: number; // % — clamped [-50, 100]
  maxAchievableMargin: number; // % — clamped [-50, 100]
  currentMarginGap: number; // % — clamped [0, 50]
}

interface MarginOpportunities {
  priceOptimizationPotential: number; // pp [0, 50]
  costReductionPotential: number; // pp [0, 50]
  feeReductionPotential: number; // pp [0, 50]
  categoryMixOptimization: number; // pp [0, 50]
  efficiencyOptimization: number; // pp [0, 50]
}

interface MaximizationAction {
  action: string;
  marginImpact: number; // pp [0, 50]
  profitImpact: number; // € [-50000, 50000]
  difficulty: ActionDifficulty;
  timeframe: string;
  category: string;
}

interface PrioritizedAction {
  action: string;
  marginImpact: number;
  ease: number; // 0-100 (EASY=90, MEDIUM=50, HARD=20)
  priorityScore: number; // 0-100
}

interface QuickWin {
  action: string;
  marginImpact: number;
  profitImpact: number;
}

interface RiskTradeoff {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface MarginPlan {
  maximizationActions: MaximizationAction[];
  maximizationStrategy: string;
  prioritizedActions: PrioritizedAction[];
  quickWins: QuickWin[];
  projectedMarginAfterActions: number; // % clamped [-50, 100]
  marginMaximizationScore: number; // 0-100
  riskTradeoffs: RiskTradeoff[];
}

interface ProfitMarginMaxResponse {
  ok: true;
  baseline: MarginBaseline;
  opportunities: MarginOpportunities;
  plan: MarginPlan;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  plan?: {
    maximizationActions?: Array<{
      action?: string;
      marginImpact?: number;
      profitImpact?: number;
      difficulty?: ActionDifficulty;
      timeframe?: string;
      category?: string;
    }>;
    maximizationStrategy?: string;
    prioritizedActions?: Array<{
      action?: string;
      marginImpact?: number;
      ease?: number;
      priorityScore?: number;
    }>;
    quickWins?: Array<{ action?: string; marginImpact?: number; profitImpact?: number }>;
    projectedMarginAfterActions?: number;
    marginMaximizationScore?: number;
    riskTradeoffs?: Array<{ risk?: string; severity?: RiskSeverity; mitigation?: string }>;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const MARGIN_MIN = -50;
const MARGIN_MAX = 100;
const MARGIN_IMPACT_MIN = 0;
const MARGIN_IMPACT_MAX = 50;
const PROFIT_IMPACT_MIN = -50000;
const PROFIT_IMPACT_MAX = 50000;
const EASE_MIN = 0;
const EASE_MAX = 100;
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 100;

const VALID_DIFFICULTY: readonly ActionDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

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

// Linear regression slope
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

// --- DB row types --------------------------------------------------------

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  buyDate: Date | null;
  sellLocation: string;
  category: string;
}

// --- Margin computation -------------------------------------------------

interface MarginContext {
  currentAvgMargin: number;
  bestMarginEver: number;
  worstMarginEver: number;
  monthlyMargins: number[]; // last 12 months, oldest→newest
  marginByCategory: Map<string, { margin: number; count: number; profit: number; revenue: number; cost: number }>;
  marginByPriceRange: Map<string, { margin: number; count: number }>;
  marginBySource: Map<string, { margin: number; count: number; profit: number; revenue: number; cost: number }>;
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  totalFees: number;
  totalTrades: number;
  avgProfitPerTrade: number;
  avgHoldDays: number;
}

function computeMarginContext(soldTrades: SoldTradeRow[], now: number): MarginContext {
  const cutoff12m = now - HORIZON_12M;
  const monthStartMs = (t: number): number => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  const thisMonthStart = monthStartMs(now);
  const monthlyProfitBuckets: number[] = Array.from({ length: MONTHS_12 }, () => 0);
  const monthlyRevenueBuckets: number[] = Array.from({ length: MONTHS_12 }, () => 0);

  const marginByCategory = new Map<string, { margin: number; count: number; profit: number; revenue: number; cost: number }>();
  const marginByPriceRange = new Map<string, { margin: number; count: number; profit: number; revenue: number; cost: number }>();
  const marginBySource = new Map<string, { margin: number; count: number; profit: number; revenue: number; cost: number }>();

  let totalProfit = 0;
  let totalRevenue = 0;
  let totalCost = 0;
  let totalFees = 0;
  let holdDaysSum = 0;
  let holdDayCount = 0;
  let bestMargin = -50;
  let worstMargin = 100;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0 || sellMs < cutoff12m) continue;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const revenue = sellPrice - sellFees;
    const cost = buyPrice + buyFees;
    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const buyMs = toMs(t.buyDate);

    totalProfit += profit;
    totalRevenue += revenue;
    totalCost += cost;
    totalFees += sellFees + buyFees;

    if (buyMs > 0) {
      holdDaysSum += (sellMs - buyMs) / DAY_MS;
      holdDayCount += 1;
    }

    // Monthly buckets
    const sellMonthStart = monthStartMs(sellMs);
    const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
    const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
    if (bucketIdx >= 0 && bucketIdx <= 11) {
      monthlyProfitBuckets[bucketIdx]! += profit;
      monthlyRevenueBuckets[bucketIdx]! += revenue;
    }

    // Best/worst monthly margin
    if (revenue > 0) {
      if (margin > bestMargin) bestMargin = margin;
      if (margin < worstMargin) worstMargin = margin;
    }

    // By category
    const cat = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
    const cEntry = marginByCategory.get(cat) || { margin: 0, count: 0, profit: 0, revenue: 0, cost: 0 };
    cEntry.count += 1;
    cEntry.profit += profit;
    cEntry.revenue += revenue;
    cEntry.cost += cost;
    marginByCategory.set(cat, cEntry);

    // By price range
    let range = '0-50€';
    if (buyPrice >= 500) range = '500€+';
    else if (buyPrice >= 200) range = '200-500€';
    else if (buyPrice >= 100) range = '100-200€';
    else if (buyPrice >= 50) range = '50-100€';
    const pEntry = marginByPriceRange.get(range) || { margin: 0, count: 0, profit: 0, revenue: 0, cost: 0 };
    pEntry.count += 1;
    pEntry.profit += profit;
    pEntry.revenue += revenue;
    pEntry.cost += cost;
    marginByPriceRange.set(range, pEntry);

    // By source
    const src = (t.sellLocation || 'neznano').trim().toLowerCase() || 'neznano';
    const sEntry = marginBySource.get(src) || { margin: 0, count: 0, profit: 0, revenue: 0, cost: 0 };
    sEntry.count += 1;
    sEntry.profit += profit;
    sEntry.revenue += revenue;
    sEntry.cost += cost;
    marginBySource.set(src, sEntry);
  }

  // Compute averages for category/source
  for (const [, c] of marginByCategory) {
    c.margin = c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0;
  }
  for (const [, p] of marginByPriceRange) {
    p.margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
  }
  for (const [, s] of marginBySource) {
    s.margin = s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0;
  }

  const currentAvgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const monthlyMargins = monthlyProfitBuckets.map((p, i) => {
    const r = monthlyRevenueBuckets[i] ?? 0;
    return r > 0 ? (p / r) * 100 : 0;
  });

  return {
    currentAvgMargin: round0(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, currentAvgMargin)) * 100) / 100,
    bestMarginEver: round0(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, bestMargin === -50 ? 0 : bestMargin)) * 100) / 100,
    worstMarginEver: round0(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, worstMargin === 100 ? 0 : worstMargin)) * 100) / 100,
    monthlyMargins,
    marginByCategory,
    marginByPriceRange,
    marginBySource,
    totalProfit: round0(totalProfit),
    totalRevenue: round0(totalRevenue),
    totalCost: round0(totalCost),
    totalFees: round0(totalFees),
    totalTrades: soldTrades.length,
    avgProfitPerTrade: soldTrades.length > 0 ? round0(totalProfit / soldTrades.length) : 0,
    avgHoldDays: holdDayCount > 0 ? round0(holdDaysSum / holdDayCount) : 0,
  };
}

// --- Opportunities -------------------------------------------------------

function computeOpportunities(ctx: MarginContext): MarginOpportunities {
  // Price optimization potential: gap between current margin and best historical month
  const priceOpt = Math.max(0, ctx.bestMarginEver - ctx.currentAvgMargin);
  const priceOptimizationPotential = round0(
    clampNum(priceOpt * 0.4, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0), // 40% achievable
  );

  // Cost reduction: 10-15% of current cost
  const costOpt = ctx.totalCost > 0 ? (ctx.totalCost * 0.12 / ctx.totalRevenue) * 100 : 0;
  const costReductionPotential = round0(clampNum(costOpt, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0));

  // Fee reduction: 30% of fees if fee rate > 5%
  const feeRate = ctx.totalRevenue > 0 ? ctx.totalFees / ctx.totalRevenue : 0;
  const feeOpt = feeRate > 0.05 ? (ctx.totalFees * 0.3 / ctx.totalRevenue) * 100 : (ctx.totalFees * 0.1 / ctx.totalRevenue) * 100;
  const feeReductionPotential = round0(clampNum(feeOpt, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0));

  // Category mix optimization: difference between best category margin and overall avg
  let bestCatMargin = 0;
  for (const [, c] of ctx.marginByCategory) {
    if (c.count >= 2 && c.margin > bestCatMargin) bestCatMargin = c.margin;
  }
  const mixOpt = Math.max(0, bestCatMargin - ctx.currentAvgMargin);
  const categoryMixOptimization = round0(
    clampNum(mixOpt * 0.5, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0), // 50% achievable via 20% shift
  );

  // Efficiency optimization: faster turnover → more cycles
  const avgHold = ctx.avgHoldDays;
  const efficiencyPotential = avgHold > 30 ? 3 : avgHold > 14 ? 2 : 1;
  const efficiencyOptimization = round0(clampNum(efficiencyPotential, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0));

  return {
    priceOptimizationPotential,
    costReductionPotential,
    feeReductionPotential,
    categoryMixOptimization,
    efficiencyOptimization,
  };
}

// --- Baseline ------------------------------------------------------------

function computeBaseline(ctx: MarginContext, opps: MarginOpportunities): MarginBaseline {
  const currentAvgMargin = ctx.currentAvgMargin;
  // Max = current + sum of opportunities × 0.7 (overlap factor)
  const sumOpps = opps.priceOptimizationPotential
    + opps.costReductionPotential
    + opps.feeReductionPotential
    + opps.categoryMixOptimization
    + opps.efficiencyOptimization;
  const maxAchievableMargin = round0(
    clampNum(
      currentAvgMargin + sumOpps * 0.7,
      MARGIN_MIN, MARGIN_MAX,
      currentAvgMargin,
    ) * 100,
  ) / 100;
  const currentMarginGap = round0(Math.max(0, maxAchievableMargin - currentAvgMargin));
  return {
    currentAvgMargin,
    bestMarginEver: ctx.bestMarginEver,
    worstMarginEver: ctx.worstMarginEver,
    maxAchievableMargin,
    currentMarginGap,
  };
}

// --- Deterministic plan --------------------------------------------------

function buildDeterministicPlan(
  ctx: MarginContext,
  baseline: MarginBaseline,
  opps: MarginOpportunities,
): MarginPlan {
  const totalRevenue = ctx.totalRevenue;
  const marginToRevenue = (pp: number) => round0(totalRevenue * pp / 100);

  const actions: MaximizationAction[] = [];

  // Pricing action
  if (opps.priceOptimizationPotential > 0) {
    actions.push({
      action: `Povišaj cene za 5-10% na top inventoriju — catch ${opps.priceOptimizationPotential}pp margin gap.`,
      marginImpact: opps.priceOptimizationPotential,
      profitImpact: marginToRevenue(opps.priceOptimizationPotential),
      difficulty: 'EASY',
      timeframe: '1-2 tedna',
      category: 'pricing',
    });
  }
  // Cost reduction
  if (opps.costReductionPotential > 0) {
    actions.push({
      action: `Pogajaj se z existing dobavitelji za 10-15% popust — ${opps.costReductionPotential}pp margin potential.`,
      marginImpact: opps.costReductionPotential,
      profitImpact: marginToRevenue(opps.costReductionPotential),
      difficulty: 'MEDIUM',
      timeframe: '2-4 tedne',
      category: 'sourcing',
    });
  }
  // Fee reduction
  if (opps.feeReductionPotential > 0) {
    actions.push({
      action: `Premakni listings na platforme z nižjimi fees (Vinted 0% buyer fee, Bolha free) — ${opps.feeReductionPotential}pp margin potential.`,
      marginImpact: opps.feeReductionPotential,
      profitImpact: marginToRevenue(opps.feeReductionPotential),
      difficulty: 'EASY',
      timeframe: '1-3 dni',
      category: 'fees',
    });
  }
  // Category mix
  if (opps.categoryMixOptimization > 0) {
    actions.push({
      action: `Premakni 20% kapitala v top-margin kategorijo — ${opps.categoryMixOptimization}pp margin potential.`,
      marginImpact: opps.categoryMixOptimization,
      profitImpact: marginToRevenue(opps.categoryMixOptimization),
      difficulty: 'HARD',
      timeframe: '1-3 mesece',
      category: 'category_mix',
    });
  }
  // Efficiency
  if (opps.efficiencyOptimization > 0) {
    actions.push({
      action: `Pospeši turnover (znižaj hold time za 30%) — ${opps.efficiencyOptimization}pp margin potential iz več ciklov/leto.`,
      marginImpact: opps.efficiencyOptimization,
      profitImpact: marginToRevenue(opps.efficiencyOptimization),
      difficulty: 'MEDIUM',
      timeframe: '2-4 tedne',
      category: 'efficiency',
    });
  }

  // Sort by marginImpact desc
  actions.sort((a, b) => b.marginImpact - a.marginImpact);
  const maximizationActions = actions.slice(0, 6);

  // Prioritized actions
  const easeWeight: Record<ActionDifficulty, number> = { EASY: 90, MEDIUM: 50, HARD: 20 };
  const prioritized: PrioritizedAction[] = maximizationActions.map((a) => {
    const ease = easeWeight[a.difficulty];
    const priorityScore = round0(
      clampNum(
        a.marginImpact * 0.7 + ease * 0.3,
        PRIORITY_MIN, PRIORITY_MAX,
        50,
      ),
    );
    return {
      action: a.action,
      marginImpact: a.marginImpact,
      ease,
      priorityScore,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  // Quick wins: EASY difficulty, top 3
  const quickWins: QuickWin[] = maximizationActions
    .filter((a) => a.difficulty === 'EASY')
    .slice(0, 3)
    .map((a) => ({
      action: a.action,
      marginImpact: a.marginImpact,
      profitImpact: a.profitImpact,
    }));

  // Projected margin after actions: ramp up over 6 months
  const totalMarginImpact = maximizationActions.reduce((s, a) => s + a.marginImpact, 0);
  const projectedMarginAfterActions = round0(
    clampNum(
      baseline.currentAvgMargin + totalMarginImpact * 0.6, // 60% capture
      MARGIN_MIN, MARGIN_MAX,
      baseline.currentAvgMargin,
    ) * 100,
  ) / 100;

  // Score: 100 - (gap / 2) — višji gap = nižji score (več prostora)
  const score = round0(
    clampNum(100 - baseline.currentMarginGap * 2, SCORE_MIN, SCORE_MAX, 50),
  );

  // Strategy
  const strategy = `Maximiziraj margin iz ${baseline.currentAvgMargin}% na ${baseline.maxAchievableMargin}% (gap ${baseline.currentMarginGap}pp) z ${maximizationActions.length} akcijami. Hitri quick wins (EASY) implementiraj v 1 tednu, MEDIUM v 30 dneh, HARD v 1-3 mesecih. Skupni pričakovan lift: +${round0(totalMarginImpact * 0.6)}pp margin.`;

  // Risks
  const risks: RiskTradeoff[] = [
    {
      risk: 'Agresivno povišanje cen lahko zmanjša sell-through rate.',
      severity: 'MEDIUM',
      mitigation: 'A/B test v 5-10% korakih, spremljaj konverzijo.',
    },
    {
      risk: 'Premik v top-margin kategorije lahko zahteva learning curve.',
      severity: 'MEDIUM',
      mitigation: 'Start small (10% capital), testiraj 30 dni pred scale.',
    },
    {
      risk: 'Premik na platforme z nižjimi fees lahko zmanjša volume (manjši reach).',
      severity: 'LOW',
      mitigation: 'Testiraj volume na novi platformi 14 dni pred premikom.',
    },
  ];

  return {
    maximizationActions,
    maximizationStrategy: strategy.slice(0, 500),
    prioritizedActions: prioritized,
    quickWins,
    projectedMarginAfterActions,
    marginMaximizationScore: score,
    riskTradeoffs: risks,
  };
}

function buildSummary(baseline: MarginBaseline, plan: MarginPlan): string {
  const quickWin = plan.quickWins[0];
  const parts: string[] = [
    `Current margin: ${baseline.currentAvgMargin}%, max achievable: ${baseline.maxAchievableMargin}% (gap: ${baseline.currentMarginGap}pp).`,
  ];
  if (quickWin) {
    parts.push(`Quick win: ${quickWin.action.slice(0, 60)} → +${quickWin.marginImpact}pp margin.`);
  }
  parts.push(`Score: ${plan.marginMaximizationScore}/100.`);
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitMarginMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleProfitMarginMaximizer(req);
}

async function handleProfitMarginMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-margin-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        buyDate: true,
        sellLocation: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        baseline: {
          currentAvgMargin: 0,
          bestMarginEver: 0,
          worstMarginEver: 0,
          maxAchievableMargin: 0,
          currentMarginGap: 0,
        },
        opportunities: {
          priceOptimizationPotential: 0,
          costReductionPotential: 0,
          feeReductionPotential: 0,
          categoryMixOptimization: 0,
          efficiencyOptimization: 0,
        },
        plan: {
          maximizationActions: [],
          maximizationStrategy: 'Ni SOLD trgovin za margin maximization plan.',
          prioritizedActions: [],
          quickWins: [],
          projectedMarginAfterActions: 0,
          marginMaximizationScore: 0,
          riskTradeoffs: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Margin Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Margin Maximizer ni mogoč.',
      } satisfies ProfitMarginMaxResponse);
    }

    // 2) Compute margin context
    const ctx = computeMarginContext(soldTrades, now);

    // 3) Compute opportunities
    const opportunities = computeOpportunities(ctx);

    // 4) Compute baseline
    const baseline = computeBaseline(ctx, opportunities);

    // 5) Build deterministic plan (fallback)
    let plan = buildDeterministicPlan(ctx, baseline, opportunities);
    let summary = buildSummary(baseline, plan);

    // 6) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `profit-margin-maximizer:${currentMonth}`;
    const cached = getCachedAI<{ plan: MarginPlan; summary: string }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        baseline,
        opportunities,
        plan: cached.plan,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitMarginMaxResponse);
    }

    // 7) AI prompt with grounding
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

    const promptData = {
      baseline,
      opportunities,
      marginContext: {
        currentAvgMargin: ctx.currentAvgMargin,
        bestMarginEver: ctx.bestMarginEver,
        worstMarginEver: ctx.worstMarginEver,
        monthlyMargins: ctx.monthlyMargins,
        marginByCategory: Array.from(ctx.marginByCategory.entries()).slice(0, 10).map(([cat, c]) => ({
          category: cat, margin: round0(c.margin * 100) / 100, count: c.count,
        })),
        marginBySource: Array.from(ctx.marginBySource.entries()).slice(0, 10).map(([src, s]) => ({
          source: src, margin: round0(s.margin * 100) / 100, count: s.count,
        })),
        totalTrades: ctx.totalTrades,
        totalRevenue: ctx.totalRevenue,
        totalProfit: ctx.totalProfit,
        avgProfitPerTrade: ctx.avgProfitPerTrade,
        avgHoldDays: ctx.avgHoldDays,
      },
      deterministicPlan: plan,
      caps: {
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
        marginImpactMin: MARGIN_IMPACT_MIN, marginImpactMax: MARGIN_IMPACT_MAX,
        profitImpactMin: PROFIT_IMPACT_MIN, profitImpactMax: PROFIT_IMPACT_MAX,
        easeMin: EASE_MIN, easeMax: EASE_MAX,
        priorityMin: PRIORITY_MIN, priorityMax: PRIORITY_MAX,
      },
    };

    const prompt = `Si AI "Profit Margin Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Ti identificiraš specifične akcije za MAKSIMIZACIJO profitnih marž — najdeš MAXIMUM dosegljivo maržo in daš plan za dosego. Razlika od profit-margin-forecaster-pro (v7.85 ki forecast-a margin) — ti MAKSIMIZIRAŠ margin z actionable plan. Razlika od profit-margin-optimizer-v2 (ki optimizira margin) — ti najdeš MAXIMUM in daš plan za dosego.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD 12m za margin baseline + opportunities):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. plan.maximizationActions: 4-6 akcij { action (max 250 chars, slovenski), marginImpact pp [0, 50] (koliko pp margin doda), profitImpact € [-50000, 50000] (= revenue × marginImpact / 100), difficulty EASY | MEDIUM | HARD, timeframe (max 50, npr. "1-2 tedna"), category (max 50 — pricing|sourcing|fees|category_mix|efficiency) }.
2. plan.maximizationStrategy: slovenski tekst (max 500) — kako doseči max margin z vsemi akcijami.
3. plan.prioritizedActions: 4-6 akcij ranked { action (max 250), marginImpact pp [0, 50], ease 0-100 (EASY=90, MEDIUM=50, HARD=20), priorityScore 0-100 (= marginImpact × 0.7 + ease × 0.3) }.
4. plan.quickWins: 2-3 EASY akcije za implementacijo DANES { action (max 250), marginImpact pp [0, 50], profitImpact € [-50000, 50000] }.
5. plan.projectedMarginAfterActions: % clamped [-50, 100] — pričakovana margin po implementaciji (capture rate ~60%).
6. plan.marginMaximizationScore: 0-100 (višji = bližje max margin; ±10 od deterministic).
7. plan.riskTradeoffs: 2-3 tveganja { risk (max 200, slovenski), severity LOW | MEDIUM | HIGH, mitigation (max 200) }.
8. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministic baseline. Primer: "Current margin: 22%, max achievable: 35% (gap: 13%). Quick win: raise elektronika prices +5% → +3% margin. Action: negotiate Bolha fees → +2% margin."

VRNI LE JSON:
{
  "plan": {
    "maximizationActions": [
      { "action": "Povišaj cene za 5-10% na top inventoriju.", "marginImpact": 5, "profitImpact": 750, "difficulty": "EASY", "timeframe": "1-2 tedna", "category": "pricing" }
    ],
    "maximizationStrategy": "Maximiziraj margin z 5 akcijami...",
    "prioritizedActions": [
      { "action": "Povišaj cene za 5-10%.", "marginImpact": 5, "ease": 90, "priorityScore": 65 }
    ],
    "quickWins": [
      { "action": "Povišaj cene na 3 top items.", "marginImpact": 3, "profitImpact": 450 }
    ],
    "projectedMarginAfterActions": 28,
    "marginMaximizationScore": 65,
    "riskTradeoffs": [
      { "risk": "Agresivno povišanje cen zmanjša sell-through.", "severity": "MEDIUM", "mitigation": "A/B test." }
    ]
  },
  "summary": "Current margin: 22%, max achievable: 35% (gap: 13%). Quick win: raise elektronika prices +5% → +3% margin."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && parsed.plan && typeof parsed.plan === 'object') {
        const ai = parsed.plan;
        const det = plan;

        // Maximization actions
        const maximizationActions: MaximizationAction[] = [];
        if (Array.isArray(ai.maximizationActions)) {
          for (const a of ai.maximizationActions.slice(0, 6)) {
            if (!a || typeof a !== 'object') continue;
            const difficulty = clampEnum(a.difficulty, VALID_DIFFICULTY, 'MEDIUM');
            const marginImpact = round0(clampNum(a.marginImpact, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0));
            const profitImpact = round0(clampNum(a.profitImpact, PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, ctx.totalRevenue * marginImpact / 100));
            maximizationActions.push({
              action: clampString(a.action, 250, det.maximizationActions[0]?.action ?? 'Margin maximization akcija.'),
              marginImpact,
              profitImpact,
              difficulty,
              timeframe: clampString(a.timeframe, 50, det.maximizationActions[0]?.timeframe ?? '1-2 tedna'),
              category: clampString(a.category, 50, det.maximizationActions[0]?.category ?? 'pricing'),
            });
          }
        }
        if (maximizationActions.length === 0) maximizationActions.push(...det.maximizationActions);

        // Prioritized
        const prioritizedActions: PrioritizedAction[] = [];
        if (Array.isArray(ai.prioritizedActions)) {
          for (const p of ai.prioritizedActions.slice(0, 6)) {
            if (!p || typeof p !== 'object') continue;
            const marginImpact = round0(clampNum(p.marginImpact, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0));
            const ease = round0(clampNum(p.ease, EASE_MIN, EASE_MAX, 50));
            const priorityScore = round0(clampNum(p.priorityScore, PRIORITY_MIN, PRIORITY_MAX, marginImpact * 0.7 + ease * 0.3));
            prioritizedActions.push({
              action: clampString(p.action, 250, det.prioritizedActions[0]?.action ?? 'Akcija.'),
              marginImpact,
              ease,
              priorityScore,
            });
          }
        }
        if (prioritizedActions.length === 0) prioritizedActions.push(...det.prioritizedActions);

        // Quick wins
        const quickWins: QuickWin[] = [];
        if (Array.isArray(ai.quickWins)) {
          for (const q of ai.quickWins.slice(0, 3)) {
            if (!q || typeof q !== 'object') continue;
            const marginImpact = round0(clampNum(q.marginImpact, MARGIN_IMPACT_MIN, MARGIN_IMPACT_MAX, 0));
            const profitImpact = round0(clampNum(q.profitImpact, PROFIT_IMPACT_MIN, PROFIT_IMPACT_MAX, ctx.totalRevenue * marginImpact / 100));
            quickWins.push({
              action: clampString(q.action, 250, det.quickWins[0]?.action ?? 'Quick win akcija.'),
              marginImpact,
              profitImpact,
            });
          }
        }
        if (quickWins.length === 0) quickWins.push(...det.quickWins);

        // Projected margin after actions
        const projectedMarginAfterActions = round0(
          clampNum(ai.projectedMarginAfterActions, MARGIN_MIN, MARGIN_MAX, det.projectedMarginAfterActions) * 100,
        ) / 100;

        // Score ±10
        const detScore = det.marginMaximizationScore;
        const marginMaximizationScore = round0(
          Math.max(SCORE_MIN, Math.min(SCORE_MAX,
            detScore + Math.max(-10, Math.min(10,
              (Number(ai.marginMaximizationScore ?? detScore)) - detScore)))),
        );

        // Risks
        const riskTradeoffs: RiskTradeoff[] = [];
        if (Array.isArray(ai.riskTradeoffs)) {
          for (const r of ai.riskTradeoffs.slice(0, 3)) {
            if (!r || typeof r !== 'object') continue;
            riskTradeoffs.push({
              risk: clampString(r.risk, 200, det.riskTradeoffs[0]?.risk ?? 'Margin maximization tveganje.'),
              severity: clampEnum(r.severity, VALID_SEVERITY, det.riskTradeoffs[0]?.severity ?? 'MEDIUM'),
              mitigation: clampString(r.mitigation, 200, det.riskTradeoffs[0]?.mitigation ?? 'Testiraj postopoma.'),
            });
          }
        }
        if (riskTradeoffs.length === 0) riskTradeoffs.push(...det.riskTradeoffs);

        const maximizationStrategy = clampString(ai.maximizationStrategy, 500, det.maximizationStrategy);

        plan = {
          maximizationActions,
          maximizationStrategy,
          prioritizedActions,
          quickWins,
          projectedMarginAfterActions,
          marginMaximizationScore,
          riskTradeoffs,
        };
        summary = clampString(parsed.summary, 400, buildSummary(baseline, plan));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-margin-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { plan, summary });
    }

    return NextResponse.json({
      ok: true,
      baseline,
      opportunities,
      plan,
      summary,
      aiUsed,
    } satisfies ProfitMarginMaxResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-margin-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
