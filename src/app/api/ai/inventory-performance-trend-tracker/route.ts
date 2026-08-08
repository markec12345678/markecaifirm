// v7.91: AI Inventory Performance Trend Tracker — AI track-a kako PERFORMANCE
// inventarja spreminja čez čas — so tvoje trgovine vedno bolj profitabilne,
// hitrejše, ali boljše kvalitete? Identificira performance trajektorijo in
// napove future performance. Razlika od inventory-performance-forecaster
// (v7.86 ki forecast-a CURRENT inventory performance 30/60/90d) — ta track-a
// HISTORICAL performance TRENDS čez 12 mesecev z drivers/risks/actions.
// "Performance: IMPROVING (profit +8%/mo, ROI +2%/mo, hold days -1.5/mo).
// Grade: B+. 30d forecast: +1800€. Best month: Jul (2200€)."
//
// Razlika od inventory-performance-forecaster (v7.86 ki forecast-a current
// portfolio 30/60/90d z grade) — ta gleda HISTORICAL trends čez 12 mesecev
// z momentum (acceleration). Razlika od inventory-roi-trend-tracker (v7.87
// ki track-a ROI trends) — ta gleda PERFORMANCE composite (profit + ROI +
// hold days + win rate + capital efficiency). Razlika od inventory-aging-
// trend-analyzer (v7.88 ki track-a aging trends) — ta gleda PROFITABILITY
// + efficiency trends ne aging. Razlika od inventory-value-appreciation-
// tracker (v7.90 ki track-a value appreciation) — ta gleda REALIZED
// performance (SOLD trades) z monthly trajectory in grade.
//
// GET+POST /api/ai/inventory-performance-trend-tracker
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

type PerformanceDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';
type PerformanceGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface PerformanceTrends {
  profitTrend12m: number; // slope per month
  roiTrend12m: number; // slope per month
  holdDaysTrend12m: number; // slope per month (negative = better)
  winRateTrend12m: number; // slope per month
  performanceDirection: PerformanceDirection;
  performanceMomentum: number; // acceleration
  performanceVolatility: number; // stddev of monthly profit
}

interface MonthlyData {
  month: string; // ISO date (month start)
  profit: number;
  avgROI: number;
  avgHoldDays: number;
  avgDealScore: number;
  winRate: number; // %
  volume: number;
  capitalEfficiency: number; // profit / capital deployed × 100 (%)
}

interface PerformanceForecast {
  performanceTrajectory: string;
  projectedProfit30d: number;
  projectedProfit60d: number;
  projectedProfit90d: number;
  projectedROI30d: number;
  performanceGrade: PerformanceGrade;
  performanceConsistencyScore: number; // 0-100
}

interface PerformanceDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface PerformanceRisk {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface OptimizationAction {
  action: string;
  priority: ActionPriority;
  expectedImpact: string;
}

interface BestPerformingMonth {
  month: string;
  profit: number;
  reason: string;
}

interface PerformanceAnalysis {
  performanceDrivers: PerformanceDriver[];
  performanceRisks: PerformanceRisk[];
  performanceOptimizationActions: OptimizationAction[];
  bestPerformingMonth: BestPerformingMonth | null;
}

interface AiPerformanceResponse {
  performanceTrajectory?: string;
  projectedProfit30d?: number;
  projectedProfit60d?: number;
  projectedProfit90d?: number;
  projectedROI30d?: number;
  performanceGrade?: PerformanceGrade;
  performanceConsistencyScore?: number;
  performanceDrivers?: Array<{
    driver?: string;
    impact?: DriverImpact;
    weight?: number;
    detail?: string;
  }>;
  performanceRisks?: Array<{
    risk?: string;
    severity?: RiskSeverity;
    mitigation?: string;
  }>;
  performanceOptimizationActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    expectedImpact?: string;
  }>;
  bestPerformingMonth?: {
    month?: string;
    profit?: number;
    reason?: string;
  } | null;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const PROFIT_MIN = 0;
const PROFIT_MAX_MULTIPLE = 3; // clamp to historical max × multiple (max 3×)
const ROI_MIN = -50;
const ROI_MAX = 200;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;

const VALID_GRADE: readonly PerformanceGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / values.length);
}

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

function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
}

function gradeFromScore(score: number): PerformanceGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// --- Trade row with linked listing ---------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  listing: {
    dealScore: number | null;
  } | null;
}

// --- Month aggregation ---------------------------------------------------

interface MonthAgg {
  monthMs: number;
  profitSum: number;
  costSum: number;
  tradeCount: number;
  profitableCount: number;
  holdDaysSum: number;
  holdDaysCount: number;
  dealScoreSum: number;
  dealScoreCount: number;
}

function newMonthAgg(monthMs: number): MonthAgg {
  return {
    monthMs,
    profitSum: 0,
    costSum: 0,
    tradeCount: 0,
    profitableCount: 0,
    holdDaysSum: 0,
    holdDaysCount: 0,
    dealScoreSum: 0,
    dealScoreCount: 0,
  };
}

// --- Deterministic trends + forecast + analysis ------------------------

function buildMonthlyData(
  monthMap: Map<number, MonthAgg>,
  sortedMonths: number[],
): MonthlyData[] {
  return sortedMonths.map((mMs) => {
    const m = monthMap.get(mMs)!;
    return {
      month: new Date(mMs).toISOString().slice(0, 10),
      profit: round0(m.profitSum),
      avgROI: m.costSum > 0 ? round1((m.profitSum / m.costSum) * 100) : 0,
      avgHoldDays: m.holdDaysCount > 0 ? round1(m.holdDaysSum / m.holdDaysCount) : 0,
      avgDealScore: m.dealScoreCount > 0 ? round1(m.dealScoreSum / m.dealScoreCount) : 0,
      winRate: m.tradeCount > 0 ? round1((m.profitableCount / m.tradeCount) * 100) : 0,
      volume: m.tradeCount,
      capitalEfficiency: m.costSum > 0 ? round1((m.profitSum / m.costSum) * 100) : 0,
    };
  });
}

function computeTrends(monthly: MonthlyData[]): PerformanceTrends {
  if (monthly.length < 2) {
    return {
      profitTrend12m: 0,
      roiTrend12m: 0,
      holdDaysTrend12m: 0,
      winRateTrend12m: 0,
      performanceDirection: 'STABLE',
      performanceMomentum: 0,
      performanceVolatility: 0,
    };
  }
  const profits = monthly.map((m) => m.profit);
  const rois = monthly.map((m) => m.avgROI);
  const holds = monthly.map((m) => m.avgHoldDays);
  const winRates = monthly.map((m) => m.winRate);

  const profitTrend12m = round1(trendSlope(profits));
  const roiTrend12m = round1(trendSlope(rois));
  const holdDaysTrend12m = round1(trendSlope(holds));
  const winRateTrend12m = round1(trendSlope(winRates));

  // Performance momentum: acceleration of profit trend
  const performanceMomentum = round1(computeAcceleration(profits));
  // Performance volatility: stddev of monthly profits (normalized)
  const performanceVolatility = round1(stddev(profits));

  // Direction: combine profit trend + ROI trend + winRate trend
  const positiveSignals = (profitTrend12m > 0 ? 1 : 0) + (roiTrend12m > 0 ? 1 : 0) + (winRateTrend12m > 0 ? 1 : 0);
  const negativeSignals = (profitTrend12m < 0 ? 1 : 0) + (roiTrend12m < 0 ? 1 : 0) + (winRateTrend12m < 0 ? 1 : 0);
  let performanceDirection: PerformanceDirection = 'STABLE';
  if (positiveSignals >= 2 && negativeSignals === 0) performanceDirection = 'IMPROVING';
  else if (negativeSignals >= 2 && positiveSignals === 0) performanceDirection = 'DECLINING';

  return {
    profitTrend12m,
    roiTrend12m,
    holdDaysTrend12m,
    winRateTrend12m,
    performanceDirection,
    performanceMomentum,
    performanceVolatility,
  };
}

function buildDeterministicForecast(
  monthly: MonthlyData[],
  trends: PerformanceTrends,
): PerformanceForecast {
  if (monthly.length === 0) {
    return {
      performanceTrajectory: 'Ni podatkov za napoved.',
      projectedProfit30d: 0,
      projectedProfit60d: 0,
      projectedProfit90d: 0,
      projectedROI30d: 0,
      performanceGrade: 'F',
      performanceConsistencyScore: 0,
    };
  }
  const last = monthly[monthly.length - 1]!;
  const historicalMaxProfit = Math.max(...monthly.map((m) => m.profit), 1);
  const profitCap = historicalMaxProfit * PROFIT_MAX_MULTIPLE;

  // Projected profit: last month's profit + trend × months ahead (clamped to [0, profitCap])
  // Apply momentum factor (positive momentum = accelerating growth)
  const momFactor = Math.max(0.7, Math.min(1.3, 1 + trends.performanceMomentum * 0.005));
  const proj30d = round0(
    Math.max(PROFIT_MIN, Math.min(profitCap, last.profit + trends.profitTrend12m * 1 * momFactor)),
  );
  const proj60d = round0(
    Math.max(PROFIT_MIN, Math.min(profitCap, last.profit + trends.profitTrend12m * 2 * momFactor)),
  );
  const proj90d = round0(
    Math.max(PROFIT_MIN, Math.min(profitCap, last.profit + trends.profitTrend12m * 3 * momFactor)),
  );

  // Projected ROI 30d: last month's ROI + ROI trend
  const projROI30d = round1(
    Math.max(ROI_MIN, Math.min(ROI_MAX, last.avgROI + trends.roiTrend12m)),
  );

  // Performance trajectory
  const trajectory =
    trends.performanceDirection === 'IMPROVING'
      ? `Performance se izboljšuje — profit ${trends.profitTrend12m >= 0 ? '+' : ''}${trends.profitTrend12m}€/mesec, ROI ${trends.roiTrend12m >= 0 ? '+' : ''}${trends.roiTrend12m}%/mesec, hold days ${trends.holdDaysTrend12m >= 0 ? '+' : ''}${trends.holdDaysTrend12m}/mesec. Napoved: ${proj90d}€ v 90d.`
      : trends.performanceDirection === 'DECLINING'
        ? `Performance upada — profit ${trends.profitTrend12m}€/mesec, ROI ${trends.roiTrend12m}%/mesec. Napoved: ${proj90d}€ v 90d. Potrebne korektivne akcije.`
        : `Performance stabilna — profit ${trends.profitTrend12m}€/mesec, ROI ${trends.roiTrend12m}%/mesec. Napoved: ${proj90d}€ v 90d.`;

  // Performance grade: based on avg profit, ROI, win rate, direction
  const avgProfit = avg(monthly.map((m) => m.profit));
  const avgWinRate = avg(monthly.map((m) => m.winRate));
  const avgROI = avg(monthly.map((m) => m.avgROI));
  // Normalize each to 0-100
  const profitScore = Math.max(0, Math.min(100, (avgProfit / Math.max(1, historicalMaxProfit)) * 100));
  const roiScore = Math.max(0, Math.min(100, 50 + avgROI * 0.5));
  const winRateScore = Math.max(0, Math.min(100, avgWinRate));
  const directionBonus = trends.performanceDirection === 'IMPROVING' ? 10 :
    trends.performanceDirection === 'DECLINING' ? -10 : 0;
  const compositeScore = Math.max(SCORE_MIN, Math.min(SCORE_MAX,
    profitScore * 0.35 + roiScore * 0.30 + winRateScore * 0.25 + 50 * 0.10 + directionBonus));
  const performanceGrade = gradeFromScore(round0(compositeScore));

  // Consistency score: lower volatility = higher consistency
  const avgProfitAbs = Math.max(1, Math.abs(avgProfit));
  const cv = trends.performanceVolatility / avgProfitAbs;
  let consistency = round0(Math.max(SCORE_MIN, Math.min(SCORE_MAX, 100 - cv * 30)));
  // Bonus for STEADY direction (consistent + stable)
  if (trends.performanceDirection === 'STABLE') consistency = Math.min(SCORE_MAX, consistency + 5);
  if (monthly.length >= 6) consistency = Math.min(SCORE_MAX, consistency + 5);

  return {
    performanceTrajectory: trajectory.slice(0, 500),
    projectedProfit30d: proj30d,
    projectedProfit60d: proj60d,
    projectedProfit90d: proj90d,
    projectedROI30d: projROI30d,
    performanceGrade,
    performanceConsistencyScore: consistency,
  };
}

function buildDeterministicAnalysis(
  monthly: MonthlyData[],
  trends: PerformanceTrends,
  forecast: PerformanceForecast,
): PerformanceAnalysis {
  // Drivers: top 3 trends (positive or negative)
  const driverList: Array<{ name: string; trend: number; kind: 'profit' | 'roi' | 'holdDays' | 'winRate' }> = [
    { name: 'Profit trend', trend: trends.profitTrend12m, kind: 'profit' },
    { name: 'ROI trend', trend: trends.roiTrend12m, kind: 'roi' },
    { name: 'Win rate trend', trend: trends.winRateTrend12m, kind: 'winRate' },
    { name: 'Hold days trend', trend: trends.holdDaysTrend12m, kind: 'holdDays' },
  ];
  // Sort by absolute magnitude
  driverList.sort((a, b) => Math.abs(b.trend) - Math.abs(a.trend));
  const performanceDrivers: PerformanceDriver[] = driverList.slice(0, 3).map((d) => {
    // Hold days: negative trend = POSITIVE (faster sales)
    const positiveImpact =
      d.kind === 'holdDays'
        ? d.trend < 0
        : d.trend > 0;
    const impact: DriverImpact = positiveImpact ? 'POSITIVE' : 'NEGATIVE';
    const weight = round0(Math.min(WEIGHT_MAX, Math.abs(d.trend) * 2));
    const detail =
      d.kind === 'profit'
        ? `Profit ${d.trend >= 0 ? 'raste' : 'pada'} za ${Math.abs(d.trend).toFixed(1)}€/mesec.`
        : d.kind === 'roi'
          ? `ROI ${d.trend >= 0 ? 'se izboljšuje' : 'se slabša'} za ${Math.abs(d.trend).toFixed(1)}%/mesec.`
          : d.kind === 'winRate'
            ? `Win rate ${d.trend >= 0 ? 'raste' : 'pada'} za ${Math.abs(d.trend).toFixed(1)}%/mesec.`
            : `Hold days ${d.trend < 0 ? 'se krajšajo' : 'se podaljšujejo'} za ${Math.abs(d.trend).toFixed(1)} dni/mesec.`;
    return {
      driver: d.name,
      impact,
      weight: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weight)),
      detail: detail.slice(0, 200),
    };
  });

  // Risks
  const performanceRisks: PerformanceRisk[] = [];
  if (trends.performanceDirection === 'DECLINING') {
    performanceRisks.push({
      risk: `Performance upada — profit trend ${trends.profitTrend12m}€/mesec, ROI trend ${trends.roiTrend12m}%/mesec.`,
      severity: trends.profitTrend12m < -50 ? 'HIGH' : 'MEDIUM',
      mitigation: 'Takoj pregledaj buying strategijo — fokusiraj se na kategorije z višjim ROI in zmanjšaj exposure na nizko-profitabilne nakupe.',
    });
  }
  if (trends.performanceVolatility > 0 && monthly.length > 0) {
    const avgProfit = avg(monthly.map((m) => m.profit));
    const cv = Math.abs(avgProfit) > 0 ? trends.performanceVolatility / Math.abs(avgProfit) : 0;
    if (cv > 1.0) {
      performanceRisks.push({
        risk: `Visoka profit volatilnost (CV=${cv.toFixed(2)}) — profit je nepredvidljiv iz meseca v mesec.`,
        severity: 'MEDIUM',
        mitigation: 'Stabiliziraj cash flow z bolj konsistentno buying strategijo in diversifikacijo kategorij.',
      });
    }
  }
  if (trends.holdDaysTrend12m > 2) {
    performanceRisks.push({
      risk: `Hold days se podaljšujejo za ${trends.holdDaysTrend12m.toFixed(1)} dni/mesec — inventar zastaruje.`,
      severity: 'MEDIUM',
      mitigation: 'Pospeši prodajo z bolj agresivno pricing strategijo ali bundle paketi za zastarele item-e.',
    });
  }
  if (forecast.performanceConsistencyScore < 40) {
    performanceRisks.push({
      risk: `Nizka konsistenca performance (${forecast.performanceConsistencyScore}/100) — težko predvideti future profit.`,
      severity: 'LOW',
      mitigation: 'Povečaj vzorčno osnovo z več trgovinami in bolj konsistentnim buying timing-om.',
    });
  }
  if (performanceRisks.length === 0) {
    performanceRisks.push({
      risk: 'Ni specifičnih tveganj — performance je stabilna z zadostno konsistenco.',
      severity: 'LOW',
      mitigation: 'Vzdržuj trenutno strategijo in redno preverjaj trend signale.',
    });
  }

  // Optimization actions
  const optimizationActions: OptimizationAction[] = [];
  if (trends.profitTrend12m < 0) {
    optimizationActions.push({
      action: 'Pregledaj buying strategijo — fokusiraj se na kategorije z višjim ROI',
      priority: 'HIGH',
      expectedImpact: 'Povečanje povprečnega profita za 15-25% v 60 dneh.',
    });
  }
  if (trends.holdDaysTrend12m > 2) {
    optimizationActions.push({
      action: 'Implementiraj aggressive pricing za zastarele item-e (>30 dni)',
      priority: 'HIGH',
      expectedImpact: 'Zmanjšanje povprečnega hold time za 5-10 dni v 30 dneh.',
    });
  }
  if (trends.roiTrend12m > 0 && trends.performanceDirection === 'IMPROVING') {
    optimizationActions.push({
      action: 'Povečaj obseg nabave v trenutno profitabilnih kategorijah',
      priority: 'MEDIUM',
      expectedImpact: 'Povečanje total profita za 20-30% v 60 dneh ob isti ROI.',
    });
  }
  if (trends.winRateTrend12m < 0) {
    optimizationActions.push({
      action: 'Izboljšaj deal scoring — zmanjšaj nakupe z nizkim dealScore',
      priority: 'MEDIUM',
      expectedImpact: 'Povečanje win rate za 5-10% v 60 dneh.',
    });
  }
  if (optimizationActions.length === 0) {
    optimizationActions.push({
      action: 'Vzdržuj trenutno strategijo z rednim monitoringom performance signalov',
      priority: 'LOW',
      expectedImpact: 'Ohranjanje trenutne performance trajektorije.',
    });
  }

  // Best performing month
  let bestPerformingMonth: BestPerformingMonth | null = null;
  if (monthly.length > 0) {
    const best = [...monthly].sort((a, b) => b.profit - a.profit)[0]!;
    const reason =
      `Najvišji profit ${best.profit}€ z win rate ${best.winRate}% in ROI ${best.avgROI}%. ` +
      `${best.volume} trgov z avg dealScore ${best.avgDealScore}.`.slice(0, 300);
    bestPerformingMonth = {
      month: best.month,
      profit: best.profit,
      reason,
    };
  }

  return {
    performanceDrivers: performanceDrivers.slice(0, 3),
    performanceRisks: performanceRisks.slice(0, 3),
    performanceOptimizationActions: optimizationActions.slice(0, 4),
    bestPerformingMonth,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryPerformanceTrendTracker(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryPerformanceTrendTracker(req);
}

async function handleInventoryPerformanceTrendTracker(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-performance-trend-tracker', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months with linked Listing (for dealScore)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            dealScore: true,
          },
        },
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        trends: {
          profitTrend12m: 0,
          roiTrend12m: 0,
          holdDaysTrend12m: 0,
          winRateTrend12m: 0,
          performanceDirection: 'STABLE' as PerformanceDirection,
          performanceMomentum: 0,
          performanceVolatility: 0,
        },
        monthlyData: [],
        forecast: {
          performanceTrajectory: 'Ni SOLD trgovin — Inventory Performance Trend Tracker ni mogoč.',
          projectedProfit30d: 0,
          projectedProfit60d: 0,
          projectedProfit90d: 0,
          projectedROI30d: 0,
          performanceGrade: 'F' as PerformanceGrade,
          performanceConsistencyScore: 0,
        },
        analysis: {
          performanceDrivers: [],
          performanceRisks: [],
          performanceOptimizationActions: [],
          bestPerformingMonth: null,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Performance Trend Tracker ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Performance Trend Tracker ni mogoč.',
      });
    }

    // 2) Group by month (12 months back)
    const monthStartMs = (t: number): number => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    const thisMonthStart = monthStartMs(now);

    const monthMap = new Map<number, MonthAgg>();
    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      const buyMs = toMs(t.buyDate);

      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;
      const cost = buyPrice + buyFees;

      const mMs = monthStartMs(sellMs);
      let m = monthMap.get(mMs);
      if (!m) {
        m = newMonthAgg(mMs);
        monthMap.set(mMs, m);
      }
      m.profitSum += profit;
      m.costSum += cost;
      m.tradeCount += 1;
      if (profit > 0) m.profitableCount += 1;
      if (buyMs > 0 && sellMs > buyMs) {
        const holdDays = (sellMs - buyMs) / DAY_MS;
        if (holdDays > 0 && holdDays < 3650) {
          m.holdDaysSum += holdDays;
          m.holdDaysCount += 1;
        }
      }
      const dealScore = t.listing?.dealScore;
      if (dealScore != null) {
        m.dealScoreSum += dealScore;
        m.dealScoreCount += 1;
      }
    }

    // Sort months and fill 12-month window (including empty months for trend continuity)
    const sortedMonthKeys = Array.from(monthMap.keys()).sort((a, b) => a - b);
    // Build a 12-month window from oldest active month to newest
    // For trend purposes, use only active months (months with at least 1 trade)
    const activeMonths = sortedMonthKeys.filter((mMs) => {
      const monthsAgo = Math.round((thisMonthStart - mMs) / (30 * DAY_MS));
      return monthsAgo >= 0 && monthsAgo < MONTHS_12;
    });

    if (activeMonths.length < 2) {
      return NextResponse.json({
        ok: true,
        trends: {
          profitTrend12m: 0,
          roiTrend12m: 0,
          holdDaysTrend12m: 0,
          winRateTrend12m: 0,
          performanceDirection: 'STABLE' as PerformanceDirection,
          performanceMomentum: 0,
          performanceVolatility: 0,
        },
        monthlyData: buildMonthlyData(monthMap, sortedMonthKeys),
        forecast: {
          performanceTrajectory: 'Ni dovolj mesecev s trgovinami (potrebnih ≥2) — Inventory Performance Trend Tracker ni mogoč.',
          projectedProfit30d: 0,
          projectedProfit60d: 0,
          projectedProfit90d: 0,
          projectedROI30d: 0,
          performanceGrade: 'F' as PerformanceGrade,
          performanceConsistencyScore: 0,
        },
        analysis: {
          performanceDrivers: [],
          performanceRisks: [],
          performanceOptimizationActions: [],
          bestPerformingMonth: null,
        },
        summary: 'Ni dovolj mesecev s trgovinami (potrebnih ≥2) — Inventory Performance Trend Tracker ni mogoč.',
        aiUsed: false,
        message: 'Ni dovolj mesecev s trgovinami (potrebnih ≥2) — Inventory Performance Trend Tracker ni mogoč.',
      });
    }

    // 3) Build monthly data + compute trends
    const monthlyData = buildMonthlyData(monthMap, activeMonths);
    const trends = computeTrends(monthlyData);

    // 4) Deterministic forecast + analysis
    const detForecast = buildDeterministicForecast(monthlyData, trends);
    const detAnalysis = buildDeterministicAnalysis(monthlyData, trends, detForecast);

    let forecast = detForecast;
    let analysis = detAnalysis;
    let summary = buildSummary(trends, detForecast);

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `inventory-performance-trend-tracker:${currentMonth}`;
    const cached = getCachedAI<{
      forecast: PerformanceForecast;
      analysis: PerformanceAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        trends,
        monthlyData,
        forecast: cached.forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) AI prompt with grounding
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

    const historicalMaxProfit = Math.max(...monthlyData.map((m) => m.profit), 1);
    const profitCap = historicalMaxProfit * PROFIT_MAX_MULTIPLE;

    const promptData = {
      trends,
      monthlyData,
      deterministicForecast: detForecast,
      deterministicAnalysis: detAnalysis,
      caps: {
        profitMin: PROFIT_MIN, profitCap,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        weightMin: WEIGHT_MIN, weightMax: WEIGHT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Performance Trend Tracker" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Track-aš kako PERFORMANCE inventarja spreminja čez čas — so tvoje trgovine vedno bolj profitabilne, hitrejše, ali boljše kvalitete? Razlika od inventory-performance-forecaster (ki forecast-a current inventory 30/60/90d) — ti gledaš HISTORICAL performance TRENDS čez 12 mesecev z drivers/risks/actions.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD trgovin, grouped by month):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast.performanceTrajectory: slovensko, max 500 znakov — opis kam performance pelje
2. forecast.projectedProfit30d/60d/90d: clamped [0, ${profitCap}], ±20% od deterministic
3. forecast.projectedROI30d: clamped [-50, 200], ±10 od deterministic
4. forecast.performanceGrade: A+ | A | B | C | D | F
5. forecast.performanceConsistencyScore: 0-100, ±15 od deterministic
6. analysis.performanceDrivers: 1-3 driverjev { driver (max 100 chars), impact POSITIVE | NEGATIVE, weight 0-100, detail (max 200 chars) }
7. analysis.performanceRisks: 1-3 riskov { risk (max 200 chars), severity LOW | MEDIUM | HIGH, mitigation (max 200 chars) }
8. analysis.performanceOptimizationActions: 1-4 akcij { action (max 200 chars), priority HIGH | MEDIUM | LOW, expectedImpact (max 200 chars) }
9. analysis.bestPerformingMonth: { month (ISO date), profit, reason (max 300 chars) } | null
10. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "performanceTrajectory": "Performance se izboljšuje — profit +8€/mo, ROI +2%/mo. 30d forecast: +1800€.",
  "projectedProfit30d": 1800,
  "projectedProfit60d": 2100,
  "projectedProfit90d": 2400,
  "projectedROI30d": 35,
  "performanceGrade": "B",
  "performanceConsistencyScore": 72,
  "performanceDrivers": [
    { "driver": "Profit trend", "impact": "POSITIVE", "weight": 85, "detail": "Profit raste za 8€/mesec." }
  ],
  "performanceRisks": [
    { "risk": "Visoka profit volatilnost", "severity": "MEDIUM", "mitigation": "Stabiliziraj cash flow." }
  ],
  "performanceOptimizationActions": [
    { "action": "Povečaj obseg v profitabilnih kategorijah", "priority": "MEDIUM", "expectedImpact": "Povečanje profita za 20-30%." }
  ],
  "bestPerformingMonth": { "month": "2026-07-01", "profit": 2200, "reason": "Najvišji profit z visokim ROI." },
  "summary": "Performance IMPROVING, grade B. 90d forecast +2400€. Best month: Jul."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiPerformanceResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Projected profit ±20% of deterministic, clamped [0, profitCap]
        const profitDelta30 = Math.max(-0.20, Math.min(0.20,
          (Number(parsed.projectedProfit30d ?? detForecast.projectedProfit30d) - detForecast.projectedProfit30d) / Math.max(1, Math.abs(detForecast.projectedProfit30d))));
        const profitDelta60 = Math.max(-0.20, Math.min(0.20,
          (Number(parsed.projectedProfit60d ?? detForecast.projectedProfit60d) - detForecast.projectedProfit60d) / Math.max(1, Math.abs(detForecast.projectedProfit60d))));
        const profitDelta90 = Math.max(-0.20, Math.min(0.20,
          (Number(parsed.projectedProfit90d ?? detForecast.projectedProfit90d) - detForecast.projectedProfit90d) / Math.max(1, Math.abs(detForecast.projectedProfit90d))));

        const projectedProfit30d = round0(
          Math.max(PROFIT_MIN, Math.min(profitCap, detForecast.projectedProfit30d * (1 + profitDelta30))),
        );
        const projectedProfit60d = round0(
          Math.max(PROFIT_MIN, Math.min(profitCap, detForecast.projectedProfit60d * (1 + profitDelta60))),
        );
        const projectedProfit90d = round0(
          Math.max(PROFIT_MIN, Math.min(profitCap, detForecast.projectedProfit90d * (1 + profitDelta90))),
        );

        const projectedROI30d = round1(
          Math.max(ROI_MIN, Math.min(ROI_MAX,
            detForecast.projectedROI30d + Math.max(-10, Math.min(10,
              (Number(parsed.projectedROI30d ?? detForecast.projectedROI30d)) - detForecast.projectedROI30d)))),
        );

        const performanceGrade = clampEnum(parsed.performanceGrade, VALID_GRADE, detForecast.performanceGrade);
        const performanceConsistencyScore = round0(
          Math.max(SCORE_MIN, Math.min(SCORE_MAX,
            detForecast.performanceConsistencyScore + Math.max(-15, Math.min(15,
              (Number(parsed.performanceConsistencyScore ?? detForecast.performanceConsistencyScore)) - detForecast.performanceConsistencyScore)))),
        );

        forecast = {
          performanceTrajectory: clampString(parsed.performanceTrajectory, 500, detForecast.performanceTrajectory),
          projectedProfit30d,
          projectedProfit60d,
          projectedProfit90d,
          projectedROI30d,
          performanceGrade,
          performanceConsistencyScore,
        };

        // Drivers validation
        const performanceDrivers: PerformanceDriver[] = [];
        if (Array.isArray(parsed.performanceDrivers)) {
          for (const d of parsed.performanceDrivers.slice(0, 3)) {
            if (!d || typeof d !== 'object') continue;
            performanceDrivers.push({
              driver: clampString(d.driver, 100, detAnalysis.performanceDrivers[0]?.driver ?? 'Trend'),
              impact: clampEnum(d.impact, VALID_IMPACT, detAnalysis.performanceDrivers[0]?.impact ?? 'POSITIVE'),
              weight: clampNum(d.weight, WEIGHT_MIN, WEIGHT_MAX, detAnalysis.performanceDrivers[0]?.weight ?? 50),
              detail: clampString(d.detail, 200, detAnalysis.performanceDrivers[0]?.detail ?? 'Trend signal.'),
            });
          }
        }
        if (performanceDrivers.length === 0) {
          for (const d of detAnalysis.performanceDrivers) performanceDrivers.push(d);
        }

        // Risks validation
        const performanceRisks: PerformanceRisk[] = [];
        if (Array.isArray(parsed.performanceRisks)) {
          for (const r of parsed.performanceRisks.slice(0, 3)) {
            if (!r || typeof r !== 'object') continue;
            performanceRisks.push({
              risk: clampString(r.risk, 200, detAnalysis.performanceRisks[0]?.risk ?? 'Brez specifičnega tveganja.'),
              severity: clampEnum(r.severity, VALID_SEVERITY, detAnalysis.performanceRisks[0]?.severity ?? 'LOW'),
              mitigation: clampString(r.mitigation, 200, detAnalysis.performanceRisks[0]?.mitigation ?? 'Vzdržuj strategijo.'),
            });
          }
        }
        if (performanceRisks.length === 0) {
          for (const r of detAnalysis.performanceRisks) performanceRisks.push(r);
        }

        // Optimization actions validation
        const optimizationActions: OptimizationAction[] = [];
        if (Array.isArray(parsed.performanceOptimizationActions)) {
          for (const a of parsed.performanceOptimizationActions.slice(0, 4)) {
            if (!a || typeof a !== 'object') continue;
            optimizationActions.push({
              action: clampString(a.action, 200, detAnalysis.performanceOptimizationActions[0]?.action ?? 'Vzdržuj strategijo.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, detAnalysis.performanceOptimizationActions[0]?.priority ?? 'LOW'),
              expectedImpact: clampString(a.expectedImpact, 200, detAnalysis.performanceOptimizationActions[0]?.expectedImpact ?? 'Ohranjanje performance.'),
            });
          }
        }
        if (optimizationActions.length === 0) {
          for (const a of detAnalysis.performanceOptimizationActions) optimizationActions.push(a);
        }

        // Best performing month validation
        let bestPerformingMonth: BestPerformingMonth | null = detAnalysis.bestPerformingMonth;
        if (parsed.bestPerformingMonth && typeof parsed.bestPerformingMonth === 'object') {
          const bpm = parsed.bestPerformingMonth;
          // Validate against monthly data — month must exist
          const matchedMonth = monthlyData.find((m) => m.month === String(bpm.month ?? '').slice(0, 10));
          if (matchedMonth) {
            bestPerformingMonth = {
              month: matchedMonth.month,
              profit: matchedMonth.profit,
              reason: clampString(bpm.reason, 300, detAnalysis.bestPerformingMonth?.reason ?? `Najvišji profit ${matchedMonth.profit}€.`),
            };
          }
        }

        analysis = {
          performanceDrivers,
          performanceRisks,
          performanceOptimizationActions: optimizationActions,
          bestPerformingMonth,
        };

        summary = clampString(parsed.summary, 400, buildSummary(trends, forecast));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-performance-trend-tracker',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        forecast,
        analysis,
        summary,
      });
    }

    return NextResponse.json({
      ok: true,
      trends,
      monthlyData,
      forecast,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-performance-trend-tracker',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

function buildSummary(
  trends: PerformanceTrends,
  forecast: PerformanceForecast,
): string {
  const parts: string[] = [
    `Performance: ${trends.performanceDirection} (profit ${trends.profitTrend12m >= 0 ? '+' : ''}${trends.profitTrend12m}€/mo, ROI ${trends.roiTrend12m >= 0 ? '+' : ''}${trends.roiTrend12m}%/mo, hold ${trends.holdDaysTrend12m >= 0 ? '+' : ''}${trends.holdDaysTrend12m}/mo).`,
    `Grade: ${forecast.performanceGrade}.`,
    `30d forecast: ${forecast.projectedProfit30d}€.`,
    `Consistency: ${forecast.performanceConsistencyScore}/100.`,
  ];
  return parts.join(' ').slice(0, 400);
}
