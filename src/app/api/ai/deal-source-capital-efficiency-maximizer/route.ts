// v8.05: AI Deal Source Capital Efficiency Maximizer — AI MAXIMIZIRA CAPITAL
// EFFICIENCY per source — kateri source-i uporabljajo kapital najbolj učinkovito
// (profit per euro deployed per day). "Bolha daje 0.85€ profit per euro per
// day, Vinted 0.42€ — prestavi 500€ iz Vinted v Bolha za +35% efficiency."
// Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit
// per trade €) — ta MAKSIMIZIRA CAPITAL EFFICIENCY (profit per euro per day).
// Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta
// maksimizira CAPITAL EFFICIENCY z capitalReallocation. Razlika od
// deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta
// maksimizira profit-per-euro-per-day (časovno-tehtan ROI). Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital
// efficiency per HELD item) — ta maksimizira CAPITAL EFFICIENCY per SOURCE
// (zgodovinski sold). Razlika od inventory-cash-yield-maximizer (v8.04 ki
// maksimizira cash yield čez portfolio) — ta maksimizira per-source capital
// efficiency z capitalReallocation plan-om. Razlika od
// inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per
// item) — ta maksimizira DAILY PROFIT PER EURO per source. Razlika od
// deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source)
// — ta maksimizira EFFICIENCY (profit/capital/day), ne absolutni profit.
// Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira VOLUME per
// source) — ta maksimizira CAPITAL EFFICIENCY (kvaliteta kapitala, ne
// kvantiteta trade-ov). Razlika od profit-compounding-maximizer (v8.04 ki
// maksimizira compounding reinvest rate) — ta daje per-source capital
// efficiency z efficiencyMaximizationAction in capitalReallocation.

// GET+POST /api/ai/deal-source-capital-efficiency-maximizer
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

type EfficiencyMaximizationAction =
  | 'INCREASE_CAPITAL'
  | 'REDUCE_HOLD_TIME'
  | 'IMPROVE_PROFIT_MARGIN'
  | 'DIVERSIFY_WITHIN'
  | 'REDUCE_CAPITAL';

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
  totalInvested: number; // €
  totalProfit: number; // €
  avgHoldDays: number;
  tradeCount: number;
  profitPerEuroDeployed: number; // € (total profit / total invested)
  profitPerEuroPerDay: number; // € (profit per euro per day = profitPerEuro / avgHoldDays)
  capitalEfficiencyScore: number; // 0-100
}

interface SourceMaximization {
  efficiencyMaximizationAction: EfficiencyMaximizationAction;
  projectedEfficiency: number; // forecasted profit per euro per day
  efficiencyUplift: number; // improvement in €/€/day
  capitalReallocation: number; // € (positive = shift TO this source, negative = shift FROM)
}

interface SourceEntry {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  maximization: SourceMaximization;
}

interface CapitalReallocationPlanItem {
  fromSource: string;
  toSource: string;
  amount: number; // €
  rationale: string;
  projectedEfficiencyGain: number; // €/€/day
}

interface PortfolioSummary {
  currentCapitalEfficiency: number; // weighted avg profit per euro per day
  maximizedCapitalEfficiency: number; // projected after reallocation
  totalEfficiencyUplift: number; // pp
  capitalReallocationPlan: CapitalReallocationPlanItem[];
  totalCapital: number; // €
}

interface DealSourceCapitalEfficiencyResponse {
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
      efficiencyMaximizationAction?: EfficiencyMaximizationAction;
      projectedEfficiency?: number;
      efficiencyUplift?: number;
      capitalReallocation?: number;
    };
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = -10_000;
const PROFIT_MAX = 100_000;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 500_000;
const HOLD_MIN = 1;
const HOLD_MAX = 365;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const EFFICIENCY_MIN = 0;
const EFFICIENCY_MAX = 10; // profit per euro per day, capped
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 5; // max uplift in €/€/day
const REALLOC_MIN = -50_000;
const REALLOC_MAX = 50_000;

const MAX_REALLOC_ITEMS = 5;

const VALID_ACTION: readonly EfficiencyMaximizationAction[] = [
  'INCREASE_CAPITAL',
  'REDUCE_HOLD_TIME',
  'IMPROVE_PROFIT_MARGIN',
  'DIVERSIFY_WITHIN',
  'REDUCE_CAPITAL',
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

function round4(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10000) / 10000;
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
  invested: number; // capital deployed = buyPrice + buyFees
  profit: number;
  holdDays: number;
}

function computeTrade(t: SoldTradeRow): TradeComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const invested = buyPrice + buyFees;
  if (invested <= 0) return null; // can't compute efficiency without capital
  const revenue = sellPrice - sellFees;
  const profit = revenue - invested;
  const sellMs = toMs(t.sellDate);
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30; // default 30d if missing
  const source = detectSource(t);
  return { source, invested, profit, holdDays };
}

interface SourceAgg {
  source: string;
  trades: TradeComputed[];
  totalInvested: number;
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
        totalInvested: 0,
        totalProfit: 0,
        totalHoldDays: 0,
      };
      map.set(tr.source, agg);
    }
    agg.trades.push(tr);
    agg.totalInvested += tr.invested;
    agg.totalProfit += tr.profit;
    agg.totalHoldDays += tr.holdDays;
  }
  return map;
}

function computeSourceMetrics(agg: SourceAgg): SourceMetrics {
  const tradeCount = agg.trades.length;
  const totalInvested = round0(clampNum(agg.totalInvested, CAPITAL_MIN, CAPITAL_MAX, 0));
  const totalProfit = round0(clampNum(agg.totalProfit, PROFIT_MIN, PROFIT_MAX, 0));
  const avgHoldDays = round0(clampNum(
    agg.totalHoldDays / Math.max(1, tradeCount),
    HOLD_MIN, HOLD_MAX, 30,
  ));
  // profit per euro deployed (€/€) — total profit / total invested
  const profitPerEuroDeployed = round4(clampNum(
    totalInvested > 0 ? totalProfit / totalInvested : 0,
    -1, 10, 0,
  ));
  // profit per euro per day (€/€/day) = profitPerEuro / avgHoldDays
  const profitPerEuroPerDay = round4(clampNum(
    avgHoldDays > 0 ? profitPerEuroDeployed / avgHoldDays : 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));
  // capital efficiency score 0-100: combine profit-per-euro-per-day × weight
  // Typical good score: 0.5 €/€/day → 50; 1.0 → 80; 2.0 → 95
  // Use a sigmoid-like transformation
  const rawScore = profitPerEuroPerDay * 60; // 0.5 → 30, 1.0 → 60, 2.0 → 120
  const capitalEfficiencyScore = round0(clampNum(
    Math.min(100, rawScore),
    SCORE_MIN, SCORE_MAX, 0,
  ));
  return {
    totalInvested,
    totalProfit,
    avgHoldDays,
    tradeCount,
    profitPerEuroDeployed,
    profitPerEuroPerDay,
    capitalEfficiencyScore,
  };
}

function decideEfficiencyAction(metrics: SourceMetrics): EfficiencyMaximizationAction {
  // REDUCE_CAPITAL: negative profit — pull capital out
  if (metrics.totalProfit < 0 || metrics.profitPerEuroDeployed < 0) {
    return 'REDUCE_CAPITAL';
  }
  // REDUCE_HOLD_TIME: low efficiency due to long hold time
  if (metrics.avgHoldDays > 45 && metrics.profitPerEuroPerDay < 0.5) {
    return 'REDUCE_HOLD_TIME';
  }
  // IMPROVE_PROFIT_MARGIN: high capital, low profit per euro
  if (metrics.totalInvested > 2000 && metrics.profitPerEuroDeployed < 0.3) {
    return 'IMPROVE_PROFIT_MARGIN';
  }
  // DIVERSIFY_WITHIN: too few trades but good efficiency — diversify within source
  if (metrics.tradeCount < 5 && metrics.profitPerEuroPerDay > 0.5) {
    return 'DIVERSIFY_WITHIN';
  }
  // INCREASE_CAPITAL: high efficiency, room to scale
  if (metrics.profitPerEuroPerDay >= 0.7) {
    return 'INCREASE_CAPITAL';
  }
  // Default: improve margin
  return 'IMPROVE_PROFIT_MARGIN';
}

function buildSourceMaximization(
  metrics: SourceMetrics,
  portfolioAvg: number, // portfolio avg profit-per-euro-per-day
): SourceMaximization {
  const action = decideEfficiencyAction(metrics);

  // Projected efficiency based on action
  let projectedEfficiency = metrics.profitPerEuroPerDay;
  let efficiencyUplift = 0;
  let capitalReallocation = 0;

  switch (action) {
    case 'INCREASE_CAPITAL': {
      // Boost efficiency by improving volume (15% uplift to rate)
      projectedEfficiency = round4(clampNum(
        metrics.profitPerEuroPerDay * 1.15,
        EFFICIENCY_MIN, EFFICIENCY_MAX, metrics.profitPerEuroPerDay,
      ));
      // Reallocate +30% of current invested TO this source
      capitalReallocation = round0(clampNum(
        Math.max(500, metrics.totalInvested * 0.3),
        0, REALLOC_MAX, 500,
      ));
      break;
    }
    case 'REDUCE_HOLD_TIME': {
      // Reduce hold time → efficiency × 1.4 (since hold is in denominator)
      const newHold = Math.max(7, Math.round(metrics.avgHoldDays * 0.65));
      projectedEfficiency = round4(clampNum(
        metrics.profitPerEuroPerDay * (metrics.avgHoldDays / newHold),
        EFFICIENCY_MIN, EFFICIENCY_MAX, metrics.profitPerEuroPerDay,
      ));
      // Small reallocation (test)
      capitalReallocation = round0(clampNum(
        metrics.totalInvested * 0.1,
        0, REALLOC_MAX, 0,
      ));
      break;
    }
    case 'IMPROVE_PROFIT_MARGIN': {
      // Boost margin by 20% → efficiency × 1.2
      projectedEfficiency = round4(clampNum(
        metrics.profitPerEuroPerDay * 1.2,
        EFFICIENCY_MIN, EFFICIENCY_MAX, metrics.profitPerEuroPerDay,
      ));
      // Neutral reallocation
      capitalReallocation = 0;
      break;
    }
    case 'DIVERSIFY_WITHIN': {
      // Diversify → moderate boost (10%)
      projectedEfficiency = round4(clampNum(
        metrics.profitPerEuroPerDay * 1.1,
        EFFICIENCY_MIN, EFFICIENCY_MAX, metrics.profitPerEuroPerDay,
      ));
      capitalReallocation = round0(clampNum(
        Math.max(300, metrics.totalInvested * 0.2),
        0, REALLOC_MAX, 300,
      ));
      break;
    }
    case 'REDUCE_CAPITAL': {
      // Negative profit — pull capital out
      projectedEfficiency = round4(clampNum(
        Math.max(0, metrics.profitPerEuroPerDay * 0.5),
        EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
      ));
      // Pull capital OUT of this source (negative reallocation)
      capitalReallocation = round0(clampNum(
        -Math.max(500, metrics.totalInvested * 0.5),
        REALLOC_MIN, 0, -500,
      ));
      break;
    }
  }

  efficiencyUplift = round4(clampNum(
    Math.max(0, projectedEfficiency - metrics.profitPerEuroPerDay),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // If source is below portfolio avg → consider reducing capital
  if (metrics.profitPerEuroPerDay < portfolioAvg * 0.5 && action !== 'REDUCE_CAPITAL') {
    capitalReallocation = Math.min(capitalReallocation, 0);
  }

  return {
    efficiencyMaximizationAction: action,
    projectedEfficiency,
    efficiencyUplift,
    capitalReallocation,
  };
}

function buildSourceEntries(aggMap: Map<string, SourceAgg>): SourceEntry[] {
  const entries: SourceEntry[] = [];
  // First compute portfolio avg so each source maximization can use it
  const allMetrics: SourceMetrics[] = [];
  for (const [, agg] of aggMap) {
    allMetrics.push(computeSourceMetrics(agg));
  }
  const totalInvested = allMetrics.reduce((s, m) => s + m.totalInvested, 0);
  const totalProfit = allMetrics.reduce((s, m) => s + m.totalProfit, 0);
  const portfolioAvg = totalInvested > 0
    ? clampNum(totalProfit / totalInvested / 30, 0, EFFICIENCY_MAX, 0.3) // approx 30d avg
    : 0.3;

  for (const [, agg] of aggMap) {
    const metrics = computeSourceMetrics(agg);
    const maximization = buildSourceMaximization(metrics, portfolioAvg);
    entries.push({
      source: agg.source,
      displayName: displayName(agg.source),
      metrics,
      maximization,
    });
  }
  // Sort by capitalEfficiencyScore desc (best source first)
  entries.sort((a, b) => b.metrics.capitalEfficiencyScore - a.metrics.capitalEfficiencyScore);
  return entries;
}

function buildPortfolio(entries: SourceEntry[]): PortfolioSummary {
  // currentCapitalEfficiency = weighted avg profit-per-euro-per-day by invested
  const totalCapital = entries.reduce((s, e) => s + e.metrics.totalInvested, 0);
  const currentCapitalEfficiency = round4(clampNum(
    totalCapital > 0
      ? entries.reduce((s, e) => s + e.metrics.profitPerEuroPerDay * e.metrics.totalInvested, 0) / totalCapital
      : 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));

  // Maximizing: apply reallocation — shift capital from REDUCE_CAPITAL sources to INCREASE_CAPITAL sources
  // Project the new weighted efficiency
  const reallocEntries = entries.filter((e) => e.maximization.capitalReallocation !== 0);
  const totalReallocIn = reallocEntries
    .filter((e) => e.maximization.capitalReallocation > 0)
    .reduce((s, e) => s + e.maximization.capitalReallocation, 0);
  const totalReallocOut = reallocEntries
    .filter((e) => e.maximization.capitalReallocation < 0)
    .reduce((s, e) => s + Math.abs(e.maximization.capitalReallocation), 0);
  // Cap: totalReallocIn ≤ totalReallocOut (we can only shift what's pulled out)
  const reallocationCap = Math.min(totalReallocIn, totalReallocOut);

  // Build reallocation plan: shift from lowest-efficiency source to highest-efficiency
  const outSources = entries
    .filter((e) => e.maximization.capitalReallocation < 0)
    .sort((a, b) => a.metrics.profitPerEuroPerDay - b.metrics.profitPerEuroPerDay);
  const inSources = entries
    .filter((e) => e.maximization.capitalReallocation > 0)
    .sort((a, b) => b.metrics.profitPerEuroPerDay - a.metrics.profitPerEuroPerDay);

  const reallocationPlan: CapitalReallocationPlanItem[] = [];
  let remainingOut = reallocationCap;
  let remainingIn = reallocationCap;
  let outIdx = 0;
  let inIdx = 0;
  while (remainingOut > 0 && remainingIn > 0 && outIdx < outSources.length && inIdx < inSources.length) {
    const outSrc = outSources[outIdx];
    const inSrc = inSources[inIdx];
    const outAmt = Math.min(remainingOut, Math.abs(outSrc.maximization.capitalReallocation));
    const inAmt = Math.min(remainingIn, inSrc.maximization.capitalReallocation);
    const amount = Math.min(outAmt, inAmt);
    if (amount <= 0) break;
    const efficiencyGain = round4(clampNum(
      inSrc.metrics.profitPerEuroPerDay - outSrc.metrics.profitPerEuroPerDay,
      0, EFFICIENCY_MAX, 0,
    ));
    reallocationPlan.push({
      fromSource: outSrc.source,
      toSource: inSrc.source,
      amount: round0(amount),
      rationale: `${outSrc.displayName} (${round4(outSrc.metrics.profitPerEuroPerDay)}€/€/d) → ${inSrc.displayName} (${round4(inSrc.metrics.profitPerEuroPerDay)}€/€/d) za +${round4(efficiencyGain)} efficiency.`,
      projectedEfficiencyGain: efficiencyGain,
    });
    remainingOut -= amount;
    remainingIn -= amount;
    if (Math.abs(outSrc.maximization.capitalReallocation) - amount <= 0) outIdx++;
    if (inSrc.maximization.capitalReallocation - amount <= 0) inIdx++;
  }

  // maximizedCapitalEfficiency: current + avg efficiency gain × reallocation fraction
  const totalGain = reallocationPlan.reduce((s, p) => s + p.projectedEfficiencyGain * p.amount, 0);
  const totalCapitalAdj = Math.max(1, totalCapital);
  const upliftRaw = totalGain / totalCapitalAdj;
  const maximizedCapitalEfficiency = round4(clampNum(
    currentCapitalEfficiency + upliftRaw,
    EFFICIENCY_MIN, EFFICIENCY_MAX, currentCapitalEfficiency,
  ));
  const totalEfficiencyUplift = round4(clampNum(
    upliftRaw,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  return {
    currentCapitalEfficiency,
    maximizedCapitalEfficiency,
    totalEfficiencyUplift,
    capitalReallocationPlan: reallocationPlan.slice(0, MAX_REALLOC_ITEMS),
    totalCapital: round0(clampNum(totalCapital, CAPITAL_MIN, CAPITAL_MAX, 0)),
  };
}

function buildSummary(entries: SourceEntry[], portfolio: PortfolioSummary): string {
  if (entries.length === 0) {
    return 'Ni SOLD trgovin — Deal Source Capital Efficiency Maximizer ni mogoč.';
  }
  const best = entries[0];
  const worst = entries[entries.length - 1];
  const parts: string[] = [
    `${entries.length} source-ov.`,
    `Portfolio efficiency: ${portfolio.currentCapitalEfficiency}€/€/d → ${portfolio.maximizedCapitalEfficiency}€/€/d (+${portfolio.totalEfficiencyUplift}).`,
    `Best: ${best.displayName} (${round4(best.metrics.profitPerEuroPerDay)}€/€/d). Worst: ${worst.displayName} (${round4(worst.metrics.profitPerEuroPerDay)}€/€/d).`,
    `Reallocation plan: ${portfolio.capitalReallocationPlan.length} shift-ov čez ${portfolio.totalCapital}€ kapitala.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleDealSourceCapitalEfficiencyMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleDealSourceCapitalEfficiencyMaximizer(req);
}

async function handleDealSourceCapitalEfficiencyMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-deal-source-capital-efficiency-maximizer', 20);
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
          currentCapitalEfficiency: 0,
          maximizedCapitalEfficiency: 0,
          totalEfficiencyUplift: 0,
          capitalReallocationPlan: [],
          totalCapital: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Capital Efficiency Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Deal Source Capital Efficiency Maximizer ni mogoč.',
      } satisfies DealSourceCapitalEfficiencyResponse);
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
          currentCapitalEfficiency: 0,
          maximizedCapitalEfficiency: 0,
          totalEfficiencyUplift: 0,
          capitalReallocationPlan: [],
          totalCapital: 0,
        },
        summary: 'Ni veljavnih SOLD trgovin — Deal Source Capital Efficiency Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Deal Source Capital Efficiency Maximizer ni mogoč.',
      } satisfies DealSourceCapitalEfficiencyResponse);
    }

    const aggMap = aggregateBySource(computed);
    let entries = buildSourceEntries(aggMap);

    let portfolio = buildPortfolio(entries);
    let summary = buildSummary(entries, portfolio);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `deal-source-capital-efficiency-maximizer:${currentMonth}`;
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
      } satisfies DealSourceCapitalEfficiencyResponse);
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
        currentCapitalEfficiency: portfolio.currentCapitalEfficiency,
        maximizedCapitalEfficiency: portfolio.maximizedCapitalEfficiency,
        totalEfficiencyUplift: portfolio.totalEfficiencyUplift,
        totalCapital: portfolio.totalCapital,
        capitalReallocationPlan: portfolio.capitalReallocationPlan,
      },
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        holdMin: HOLD_MIN, holdMax: HOLD_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        efficiencyMin: EFFICIENCY_MIN, efficiencyMax: EFFICIENCY_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        reallocMin: REALLOC_MIN, reallocMax: REALLOC_MAX,
      },
    };

    const prompt = `Si AI "Deal Source Capital Efficiency Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL EFFICIENCY MAXIMIZATION per source — kateri source-i uporabljajo kapital najbolj učinkovito (profit per euro deployed per day). Tvoj cilj je "Bolha daje 0.85€ profit per euro per day, Vinted 0.42€ — prestavi 500€ iz Vinted v Bolha za +35% efficiency". Razlika od deal-source-profit-per-trade-maximizer (v8.04 ki maksimizira profit per trade €) — ti MAKSIMIZIRAŠ CAPITAL EFFICIENCY (profit per euro per day). Razlika od deal-source-margin-maximizer (v8.03 ki maksimizira margin %) — ta maksimizira CAPITAL EFFICIENCY z capitalReallocation. Razlika od deal-source-roi-maximizer (v8.00 ki maksimizira ROI per source) — ta maksimizira profit-per-euro-per-day (časovno-tehtan ROI). Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per HELD item) — ta maksimizira CAPITAL EFFICIENCY per SOURCE (zgodovinski sold). Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira cash yield čez portfolio) — ta maksimizira per-source capital efficiency z capitalReallocation plan-om. Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ta maksimizira DAILY PROFIT PER EURO per source. Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira total profit per source) — ta maksimizira EFFICIENCY (profit/capital/day), ne absolutni profit. Razlika od deal-source-volume-maximizer (v8.02 ki maksimizira VOLUME per source) — ta maksimizira CAPITAL EFFICIENCY (kvaliteta kapitala, ne kvantiteta trade-ov). Razlika od profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest rate) — ta daje per-source capital efficiency z efficiencyMaximizationAction in capitalReallocation.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih z linked Listing za source):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. sources: za vsak source iz sources, daj:
   - source (string, MORA match-at enega iz deterministic sources — anti-hallucination),
   - maximization.efficiencyMaximizationAction: INCREASE_CAPITAL | REDUCE_HOLD_TIME | IMPROVE_PROFIT_MARGIN | DIVERSIFY_WITHIN | REDUCE_CAPITAL (lahko se razlikuje od deterministic),
   - maximization.projectedEfficiency €/€/d [0, 10] (forecasted profit per euro per day — ≥ current profitPerEuroPerDay, ≤ current × 1.5 ali +2.0),
   - maximization.efficiencyUplift €/€/d [0, 5] (improvement = projected − current),
   - maximization.capitalReallocation € [-50000, 50000] (positive = shift TO this source, negative = shift FROM this source),
2. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "sources": [
    {
      "source": "bolha",
      "maximization": {
        "efficiencyMaximizationAction": "INCREASE_CAPITAL",
        "projectedEfficiency": 0.98,
        "efficiencyUplift": 0.13,
        "capitalReallocation": 800
      }
    },
    {
      "source": "vinted",
      "maximization": {
        "efficiencyMaximizationAction": "REDUCE_CAPITAL",
        "projectedEfficiency": 0.21,
        "efficiencyUplift": 0,
        "capitalReallocation": -500
      }
    }
  ],
  "summary": "2 source-a. Bolha 0.85€/€/d → 0.98 (+0.13, INCREASE_CAPITAL). Vinted 0.42€/€/d → 0.21 (REDUCE_CAPITAL, -500€). Portfolio: 0.65 → 0.78 (+0.13)."
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
            aiMax.efficiencyMaximizationAction,
            VALID_ACTION,
            det.maximization.efficiencyMaximizationAction,
          );

          // Anti-hallucination: projectedEfficiency ∈ [current, current × 1.5 ali +2.0]
          const maxEffBound = Math.min(
            EFFICIENCY_MAX,
            Math.max(
              det.metrics.profitPerEuroPerDay + 0.1,
              Math.min(det.metrics.profitPerEuroPerDay * 1.5 + 0.2, det.metrics.profitPerEuroPerDay + 2.0),
            ),
          );
          const minEffBound = Math.max(0, det.metrics.profitPerEuroPerDay);
          const projectedEfficiency = round4(clampNum(
            aiMax.projectedEfficiency,
            minEffBound, maxEffBound,
            det.maximization.projectedEfficiency,
          ));
          const efficiencyUplift = round4(clampNum(
            Math.max(0, projectedEfficiency - det.metrics.profitPerEuroPerDay),
            UPLIFT_MIN, UPLIFT_MAX, 0,
          ));
          const capitalReallocation = round0(clampNum(
            aiMax.capitalReallocation,
            REALLOC_MIN, REALLOC_MAX, det.maximization.capitalReallocation,
          ));

          newEntries.push({
            source: det.source,
            displayName: det.displayName,
            metrics: det.metrics,
            maximization: {
              efficiencyMaximizationAction: action,
              projectedEfficiency,
              efficiencyUplift,
              capitalReallocation,
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
        '/api/ai/deal-source-capital-efficiency-maximizer',
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
    } satisfies DealSourceCapitalEfficiencyResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/deal-source-capital-efficiency-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
