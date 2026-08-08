// v7.87: AI Inventory ROI Trend Tracker — AI track-a ROI TRENDS čez čas —
// ali se ROI izboljšuje, upada ali je stabilen? Identificira kaj driver-ja
// spremembe ROI in napove future ROI trajectory. Razlika od inventory-roi-optimizer
// (v7.79 ki optimira current ROI) — ta track-a ROI TRENDS čez čas.
// "ROI trend: IMPROVING (+1.5%/mo, momentum +0.4). 30d projection: 28%.
// Driver: price increases. Best: elektronika."
//
// Razlika od inventory-roi-optimizer (ki optimira current ROI za posamezne
// items) — ta je PORTFOLIO-level trend tracker z 12-mesečno monthly ROI series.
// Razlika od profit-margin-forecaster-pro (v7.85 ki forecast-a margin) — ta
// gleda ROI (% profit / invested) ne margin (% profit / revenue). Razlika od
// profit-margin-trend-analyzer (v7.82 ki analizira margin trends) — ta gleda
// ROI trends z drivers (price/cost/efficiency/category). Razlika od
// profit-efficiency-analyzer (ki meri profit per day) — ta gleda ROI %
// trend trajectory. Razlika od profit-margin-forecaster (basic ki da single
// margin forecast) — ta je TREND tracker z drivers + projections + sustainability.
// Razlika od inventory-performance-forecaster (v7.86 ki forecast-a portfolio
// profit/turnover) — ta gleda ROI specifically (z category-level drivers).
//
// GET+POST /api/ai/inventory-roi-trend-tracker
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

type RoiDirection = 'IMPROVING' | 'STABLE' | 'DECLINING';
type DriverImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

interface RoiTrends {
  currentROI: number; // %
  avgROI12m: number;
  bestROI12m: number;
  roiTrend12m: number; // slope %/mo
  roiTrend3m: number; // slope over last 3 months
  roiDirection: RoiDirection;
  roiVolatility: number; // stddev monthly ROI
  roiMomentum: number; // acceleration of ROI change
  roiPercentile: number; // 0-100 (how does current compare to 12m history)
}

interface MonthlyDatum {
  month: string; // YYYY-MM
  avgROI: number; // %
  totalProfit: number; // EUR
  avgProfitPerTrade: number; // EUR
  capitalDeployed: number; // EUR (total invested)
  capitalReturned: number; // EUR (total revenue)
}

interface DriverDetail {
  trend: number;
  impact: DriverImpact;
  detail: string;
}

interface CategoryDriver {
  bestCategory: string;
  worstCategory: string;
}

interface RoiDrivers {
  priceDriver: DriverDetail;
  costDriver: DriverDetail;
  efficiencyDriver: DriverDetail;
  categoryDriver: CategoryDriver;
}

interface ImprovementAction {
  action: string;
  priority: ActionPriority;
  expectedROILift: number; // percentage points
}

interface RiskFactor {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface RoiAnalysis {
  roiTrendAssessment: string;
  projectedROI30d: number;
  projectedROI60d: number;
  projectedROI90d: number;
  roiSustainabilityScore: number; // 0-100
  roiImprovementActions: ImprovementAction[];
  roiRiskFactors: RiskFactor[];
}

interface AiRoiResponse {
  analysis?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const ROI_MIN = -50;
const ROI_MAX = 200;
const SUSTAINABILITY_MIN = 0;
const SUSTAINABILITY_MAX = 100;
const PERCENTILE_MIN = 0;
const PERCENTILE_MAX = 100;
const ROI_LIFT_MIN = 0;
const ROI_LIFT_MAX = 30;

const VALID_DIRECTION: readonly RoiDirection[] = ['IMPROVING', 'STABLE', 'DECLINING'];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

// --- Helpers -------------------------------------------------------------

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return Math.max(min, Math.min(max, fallback));
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, v));
}

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
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
  for (const v of valid) {
    if (s === v.toUpperCase()) return v;
  }
  return fallback;
}

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
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

// Acceleration: slope of last half - slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  return trendSlope(secondHalf) - trendSlope(firstHalf);
}

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function classifyRoiDirection(
  trend12m: number,
  trend3m: number,
): RoiDirection {
  // Use 3m slope (more sensitive to recent changes) with 12m confirmation
  const composite = (trend3m * 0.6 + trend12m * 0.4);
  if (composite > 0.5) return 'IMPROVING';
  if (composite < -0.5) return 'DECLINING';
  return 'STABLE';
}

// ROI percentile: how does current ROI compare to 12-month history?
// 100 = best month ever, 0 = worst month ever
function computeRoiPercentile(currentROI: number, monthlyRois: number[]): number {
  if (monthlyRois.length === 0) return 50;
  const sorted = [...monthlyRois].sort((a, b) => a - b);
  let belowCount = 0;
  for (const r of sorted) {
    if (currentROI > r) belowCount += 1;
    else if (currentROI === r) belowCount += 0.5;
  }
  return round0((belowCount / sorted.length) * 100);
}

// --- Sold trade row -----------------------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
  buyDate: Date | null;
  sellDate: Date | null;
  category: string;
}

// Per-month aggregation
interface MonthAgg {
  monthKey: string;
  monthMs: number;
  invested: number;
  profit: number;
  proceeds: number;
  trades: number;
  buyPriceSum: number; // for cost driver analysis
  sellPriceSum: number; // for price driver analysis
  holdDaysSum: number;
  holdDaysCount: number;
}

// Per-category per-month (for category driver analysis)
interface CatMonthAgg {
  invested: number;
  profit: number;
  trades: number;
}

// --- Deterministic analysis ---------------------------------------------

function buildDeterministicTrendAssessment(
  trends: RoiTrends,
  drivers: RoiDrivers,
): string {
  const { currentROI, avgROI12m, bestROI12m, roiTrend12m, roiDirection, roiVolatility, roiPercentile } = trends;
  const parts: string[] = [];
  parts.push(`ROI trend: ${roiDirection} (trend12m ${roiTrend12m >= 0 ? '+' : ''}${round2(roiTrend12m)}%/mo, current ${round1(currentROI)}% vs 12m avg ${round1(avgROI12m)}%).`);
  parts.push(`Best 12m ROI: ${round1(bestROI12m)}%, current percentile: ${roiPercentile}/100.`);
  parts.push(`Volatility: ${round1(roiVolatility)}% (stddev monthly ROI).`);
  // Driver summary
  parts.push(`Drivers: price ${drivers.priceDriver.impact} (${round2(drivers.priceDriver.trend)}), cost ${drivers.costDriver.impact} (${round2(drivers.costDriver.trend)}), efficiency ${drivers.efficiencyDriver.impact} (${round2(drivers.efficiencyDriver.trend)}).`);
  parts.push(`Category driver: best=${drivers.categoryDriver.bestCategory}, worst=${drivers.categoryDriver.worstCategory}.`);
  if (roiDirection === 'IMPROVING') {
    parts.push('Trend je pozitiven — ROI raste. Preveri ali je rast driver-ana s strateškimi izboljšavami (pricing/quality) ali market timing-a ( Markup phase cikla).');
  } else if (roiDirection === 'DECLINING') {
    parts.push('Trend je negativen — ROI pada. Identificiraj ali je vzrok cost inflation, price compression ali efficiency drop in ukrepaj takoj.');
  } else {
    parts.push('Trend je stabilen — ROI je v ravnovesju. Diversifikacija ali optimization lahko dvigneta ROI percentile.');
  }
  return parts.join(' ').slice(0, 800);
}

function buildDeterministicProjectedROI(
  trends: RoiTrends,
): { projected30d: number; projected60d: number; projected90d: number } {
  // Projection = currentROI + trend × months, with diminishing returns for 60d/90d
  const { currentROI, roiTrend12m } = trends;
  // 30d projection: current + 1 month slope (full weight)
  // 60d: + 2 months × 0.85 weight (diminishing)
  // 90d: + 3 months × 0.7 weight
  const proj30 = currentROI + roiTrend12m * 1.0;
  const proj60 = currentROI + roiTrend12m * 2 * 0.85;
  const proj90 = currentROI + roiTrend12m * 3 * 0.7;

  return {
    projected30d: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, proj30))),
    projected60d: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, proj60))),
    projected90d: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, proj90))),
  };
}

// ROI sustainability score 0-100: how sustainable is current ROI trend?
// Higher = more sustainable (low volatility + positive direction + good consistency)
function computeRoiSustainability(
  trends: RoiTrends,
  monthsWithData: number,
): number {
  let score = 50;
  // Positive direction adds, negative subtracts
  if (trends.roiDirection === 'IMPROVING') score += 15;
  else if (trends.roiDirection === 'DECLINING') score -= 10;
  // Low volatility = more sustainable (volatility 0-20 maps to 0-15 bonus)
  if (trends.roiVolatility < 5) score += 15;
  else if (trends.roiVolatility < 10) score += 10;
  else if (trends.roiVolatility < 20) score += 5;
  else if (trends.roiVolatility > 30) score -= 10;
  // High percentile = harder to sustain (regression to mean)
  if (trends.roiPercentile > 80) score -= 10; // likely to revert
  else if (trends.roiPercentile < 20) score += 5; // likely to recover
  // Long history = more reliable
  if (monthsWithData >= 12) score += 10;
  else if (monthsWithData >= 6) score += 5;
  else score -= 5;
  return round0(Math.max(SUSTAINABILITY_MIN, Math.min(SUSTAINABILITY_MAX, score)));
}

function classifyImpact(slope: number, threshold: number): DriverImpact {
  if (slope > threshold) return 'POSITIVE';
  if (slope < -threshold) return 'NEGATIVE';
  return 'NEUTRAL';
}

function buildDeterministicDrivers(
  monthlyData: MonthlyDatum[],
  categoryAggs: Map<string, { invested: number; profit: number; trades: number }>,
): RoiDrivers {
  // Price driver: trend of avg sell price per trade = capitalReturned / trades
  // Cost driver: trend of avg buy price per trade = capitalDeployed / trades
  // Efficiency driver: trend of avg profit per trade (already per-trade)
  // Note: MonthlyDatum doesn't have `trades`, so we derive it from
  //   trades = totalProfit / avgProfitPerTrade (when avgProfitPerTrade != 0)
  const deriveTrades = (m: MonthlyDatum): number => {
    if (m.avgProfitPerTrade === 0) return 1;
    return Math.max(1, Math.round(m.totalProfit / m.avgProfitPerTrade));
  };

  const priceSeries = monthlyData.map((m) => m.capitalReturned / deriveTrades(m));
  const costSeries = monthlyData.map((m) => m.capitalDeployed / deriveTrades(m));
  const efficiencySeries = monthlyData.map((m) => m.avgProfitPerTrade);

  const priceTrend = trendSlope(priceSeries);
  const costTrend = trendSlope(costSeries);
  const efficiencyTrend = trendSlope(efficiencySeries);

  // Price driver: positive trend = prices rising = POSITIVE for ROI
  // (unless cost is rising faster)
  const priceImpact = classifyImpact(priceTrend, 5); // ±5 EUR/mo significant
  const costImpact = classifyImpact(-costTrend, 5); // NEGATIVE cost = POSITIVE for ROI (invert)
  const efficiencyImpact = classifyImpact(efficiencyTrend, 2); // ±2 EUR/mo significant

  // Category driver: best/worst category by ROI
  let bestCategory = 'neznan';
  let worstCategory = 'neznan';
  let bestROI = Number.NEGATIVE_INFINITY;
  let worstROI = Number.POSITIVE_INFINITY;
  for (const [cat, agg] of categoryAggs.entries()) {
    if (agg.trades < 1) continue; // skip categories with no trades
    const roi = agg.invested > 0 ? (agg.profit / agg.invested) * 100 : 0;
    if (roi > bestROI) {
      bestROI = roi;
      bestCategory = cat;
    }
    if (roi < worstROI) {
      worstROI = roi;
      worstCategory = cat;
    }
  }

  return {
    priceDriver: {
      trend: round2(priceTrend),
      impact: priceImpact,
      detail: buildDriverDetail('price', priceTrend, priceImpact),
    },
    costDriver: {
      trend: round2(costTrend),
      impact: costImpact,
      detail: buildDriverDetail('cost', costTrend, costImpact),
    },
    efficiencyDriver: {
      trend: round2(efficiencyTrend),
      impact: efficiencyImpact,
      detail: buildDriverDetail('efficiency', efficiencyTrend, efficiencyImpact),
    },
    categoryDriver: {
      bestCategory,
      worstCategory,
    },
  };
}

function buildDriverDetail(
  kind: string,
  trend: number,
  impact: DriverImpact,
): string {
  if (kind === 'price') {
    if (impact === 'POSITIVE') return `Povprečna prodajna cena narašča (+${round2(trend)}€/mo) — pozitiven vpliv na ROI. Ohranjaj pricing power.`;
    if (impact === 'NEGATIVE') return `Povprečna prodajna cena pada (${round2(trend)}€/mo) — negativen vpliv na ROI. Premisli premium listing ali boljše fotografije.`;
    return `Povprečna prodajna cena stabilna (${round2(trend)}€/mo) — nevtralen vpliv na ROI.`;
  }
  if (kind === 'cost') {
    if (impact === 'POSITIVE') return `Povprečna nabavna cena pada (${round2(trend)}€/mo) — pozitiven vpliv na ROI (lower cost). Izkoristi ugodne nabavne cene.`;
    if (impact === 'NEGATIVE') return `Povprečna nabavna cena narašča (+${round2(trend)}€/mo) — negativen vpliv na ROI. Preglej sourcing strategijo.`;
    return `Povprečna nabavna cena stabilna (${round2(trend)}€/mo) — nevtralen vpliv na ROI.`;
  }
  // efficiency
  if (impact === 'POSITIVE') return `Profit per trade narašča (+${round2(trend)}€/mo) — pozitiven vpliv na ROI. Strategy je uspešna, vzdržuj jo.`;
  if (impact === 'NEGATIVE') return `Profit per trade pada (${round2(trend)}€/mo) — negativen vpliv na ROI. Revizija pricing/quality/sourcing strategije.`;
  return `Profit per trade stabilen (${round2(trend)}€/mo) — nevtralen vpliv na ROI.`;
}

function buildDeterministicImprovementActions(
  trends: RoiTrends,
  drivers: RoiDrivers,
): ImprovementAction[] {
  const actions: ImprovementAction[] = [];
  const { roiDirection, currentROI, roiPercentile } = trends;

  if (drivers.costDriver.impact === 'NEGATIVE') {
    actions.push({
      action: 'Renegotiate nabavne cene ali diversificiraj suppliers',
      priority: 'HIGH',
      expectedROILift: 3,
    });
  }
  if (drivers.priceDriver.impact === 'NEGATIVE') {
    actions.push({
      action: 'Izboljšaj listing kvaliteto (fotografije, opis) za višje sell cene',
      priority: 'HIGH',
      expectedROILift: 4,
    });
  }
  if (drivers.efficiencyDriver.impact === 'NEGATIVE') {
    actions.push({
      action: 'Optimiziraj hold time — prodaj hitreje za boljši profit per trade',
      priority: 'MEDIUM',
      expectedROILift: 2,
    });
  }
  if (roiDirection === 'DECLINING' && currentROI < 10) {
    actions.push({
      action: 'Revizija pricing strategije — ROI je prenizek in pada',
      priority: 'HIGH',
      expectedROILift: 5,
    });
  }
  if (drivers.categoryDriver.bestCategory && drivers.categoryDriver.bestCategory !== 'neznan') {
    actions.push({
      action: `Povečaj volumen v kategoriji z najboljšim ROI: ${drivers.categoryDriver.bestCategory}`,
      priority: 'MEDIUM',
      expectedROILift: 3,
    });
  }
  if (drivers.categoryDriver.worstCategory && drivers.categoryDriver.worstCategory !== 'neznan') {
    actions.push({
      action: `Zmanjšaj izpostavljenost kategoriji z najslabšim ROI: ${drivers.categoryDriver.worstCategory}`,
      priority: 'MEDIUM',
      expectedROILift: 2,
    });
  }
  if (roiPercentile < 30) {
    actions.push({
      action: 'ROI je v bottom 30% history — strateški reset pricing + sourcing',
      priority: 'HIGH',
      expectedROILift: 4,
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo — ROI trend je zdrav',
      priority: 'LOW',
      expectedROILift: 0,
    });
  }
  return actions.slice(0, 5);
}

function buildDeterministicRiskFactors(
  trends: RoiTrends,
  drivers: RoiDrivers,
): RiskFactor[] {
  const risks: RiskFactor[] = [];
  if (trends.roiVolatility > 25) {
    risks.push({
      risk: `Visoka ROI volatilnost (${round1(trends.roiVolatility)}%) — trend je nepredvidljiv`,
      severity: 'HIGH',
      mitigation: 'Diversificiraj kategorije in suppliers za zmanjšanje variance.',
    });
  }
  if (trends.roiPercentile > 85 && trends.roiDirection !== 'IMPROVING') {
    risks.push({
      risk: `ROI v top ${100 - trends.roiPercentile}% history — tveganje reversion to mean`,
      severity: 'MEDIUM',
      mitigation: 'Zmanjšaj izpostavljenost — verjetno bo ROI padel nazaj k average.',
    });
  }
  if (drivers.costDriver.impact === 'NEGATIVE') {
    risks.push({
      risk: 'Nabavne cene naraščajo — margin compression tveganje',
      severity: 'HIGH',
      mitigation: 'Lock-in longer-term supplier contracts ali diversificiraj sourcing.',
    });
  }
  if (drivers.priceDriver.impact === 'NEGATIVE') {
    risks.push({
      risk: 'Sell cene padajo — pricing power se slabša',
      severity: 'MEDIUM',
      mitigation: 'Premisli premium listing strategijo ali drugačno kategorijo.',
    });
  }
  if (trends.roiDirection === 'DECLINING' && trends.currentROI < 5) {
    risks.push({
      risk: 'ROI blizu break-even in še pada — tveganje izgube',
      severity: 'HIGH',
      mitigation: 'Takojšnja akcija: zmanjšaj inventory in optimiraj pricing/sourcing.',
    });
  }
  if (risks.length === 0) {
    risks.push({
      risk: 'Brez izrazitih tveganj — ROI trend je zdrav',
      severity: 'LOW',
      mitigation: 'Vzdržuj trenutno strategijo in monitor naslednje 30 dni.',
    });
  }
  return risks.slice(0, 4);
}

function buildDeterministicSummary(
  trends: RoiTrends,
  drivers: RoiDrivers,
): string {
  const { roiDirection, roiTrend12m, roiMomentum, currentROI } = trends;
  const proj = buildDeterministicProjectedROI(trends);
  const driverSummary = drivers.priceDriver.impact === 'POSITIVE'
    ? 'price increases'
    : drivers.costDriver.impact === 'NEGATIVE'
      ? 'cost inflation'
      : drivers.efficiencyDriver.impact === 'POSITIVE'
        ? 'efficiency gains'
        : 'mixed drivers';
  return `ROI trend: ${roiDirection} (${roiTrend12m >= 0 ? '+' : ''}${round2(roiTrend12m)}%/mo, momentum ${round2(roiMomentum)}). Current ${round1(currentROI)}%, 30d projection ${proj.projected30d}%. Driver: ${driverSummary}. Best: ${drivers.categoryDriver.bestCategory}.`.slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryRoiTrendTracker(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryRoiTrendTracker(req);
}

async function handleInventoryRoiTrendTracker(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-roi-trend-tracker', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const rows = soldTrades as unknown as SoldTradeRow[];

    // 2) Group by month + by category
    const monthlyMap = new Map<string, MonthAgg>();
    const categoryAggs = new Map<string, { invested: number; profit: number; trades: number }>();

    for (const t of rows) {
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      const d = new Date(sellMs);
      const monthKey = monthKeyOf(d);
      const monthMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

      const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
      const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = proceeds - invested;

      let mAgg = monthlyMap.get(monthKey);
      if (!mAgg) {
        mAgg = {
          monthKey,
          monthMs,
          invested: 0,
          profit: 0,
          proceeds: 0,
          trades: 0,
          buyPriceSum: 0,
          sellPriceSum: 0,
          holdDaysSum: 0,
          holdDaysCount: 0,
        };
        monthlyMap.set(monthKey, mAgg);
      }
      mAgg.invested += invested;
      mAgg.profit += profit;
      mAgg.proceeds += proceeds;
      mAgg.trades += 1;
      mAgg.buyPriceSum += t.buyPrice ?? 0;
      mAgg.sellPriceSum += t.sellPrice ?? 0;
      const buyMs = toMs(t.buyDate);
      if (buyMs > 0 && sellMs > buyMs) {
        const holdDays = (sellMs - buyMs) / DAY_MS;
        if (holdDays > 0 && holdDays < 3650) {
          mAgg.holdDaysSum += holdDays;
          mAgg.holdDaysCount += 1;
        }
      }

      // Category aggregation
      const cat = (t.category ?? '').trim().toLowerCase() || 'brez_kategorije';
      let cAgg = categoryAggs.get(cat);
      if (!cAgg) {
        cAgg = { invested: 0, profit: 0, trades: 0 };
        categoryAggs.set(cat, cAgg);
      }
      cAgg.invested += invested;
      cAgg.profit += profit;
      cAgg.trades += 1;
    }

    // Empty state
    if (monthlyMap.size === 0) {
      return NextResponse.json({
        ok: true,
        trends: {
          currentROI: 0,
          avgROI12m: 0,
          bestROI12m: 0,
          roiTrend12m: 0,
          roiTrend3m: 0,
          roiDirection: 'STABLE',
          roiVolatility: 0,
          roiMomentum: 0,
          roiPercentile: 50,
        },
        monthlyData: [],
        drivers: {
          priceDriver: { trend: 0, impact: 'NEUTRAL', detail: 'Ni SOLD trgovin v zadnjih 12 mesecih.' },
          costDriver: { trend: 0, impact: 'NEUTRAL', detail: 'Ni SOLD trgovin v zadnjih 12 mesecih.' },
          efficiencyDriver: { trend: 0, impact: 'NEUTRAL', detail: 'Ni SOLD trgovin v zadnjih 12 mesecih.' },
          categoryDriver: { bestCategory: 'neznan', worstCategory: 'neznan' },
        },
        analysis: {
          roiTrendAssessment: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory ROI Trend Tracker ni mogoč.',
          projectedROI30d: 0,
          projectedROI60d: 0,
          projectedROI90d: 0,
          roiSustainabilityScore: 0,
          roiImprovementActions: [],
          roiRiskFactors: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory ROI Trend Tracker ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory ROI Trend Tracker ni mogoč.',
      });
    }

    // 3) Build monthly data sorted by monthMs
    const sortedMonths = Array.from(monthlyMap.values()).sort((a, b) => a.monthMs - b.monthMs);
    const monthlyData: MonthlyDatum[] = sortedMonths.map((m) => {
      const avgROI = m.invested > 0 ? (m.profit / m.invested) * 100 : 0;
      const avgProfitPerTrade = m.trades > 0 ? m.profit / m.trades : 0;
      return {
        month: m.monthKey,
        avgROI: round1(avgROI),
        totalProfit: round0(m.profit),
        avgProfitPerTrade: round0(avgProfitPerTrade),
        capitalDeployed: round0(m.invested),
        capitalReturned: round0(m.proceeds),
      };
    });

    // 4) Compute ROI trends
    const monthlyRois = monthlyData.map((m) => m.avgROI);
    const monthlyProfits = monthlyData.map((m) => m.totalProfit);

    // Current month (or last available)
    const currentMonthKey = monthKeyOf(new Date(now));
    let currentMonth = monthlyMap.get(currentMonthKey);
    if (!currentMonth && sortedMonths.length > 0) {
      currentMonth = sortedMonths[sortedMonths.length - 1]!;
    }
    const currentROI = currentMonth && currentMonth.invested > 0
      ? (currentMonth.profit / currentMonth.invested) * 100
      : 0;

    const avgROI12m = avg(monthlyRois);
    const bestROI12m = Math.max(...monthlyRois);

    const roiTrend12m = trendSlope(monthlyRois);
    // 3m trend: slope of last 3 months (or all if fewer)
    const last3 = monthlyRois.slice(-3);
    const roiTrend3m = trendSlope(last3);

    const roiDirection = classifyRoiDirection(roiTrend12m, roiTrend3m);
    const roiVolatility = stddev(monthlyRois);
    const roiMomentum = computeAcceleration(monthlyRois);
    const roiPercentile = computeRoiPercentile(currentROI, monthlyRois);

    const trends: RoiTrends = {
      currentROI: round1(Math.max(ROI_MIN, Math.min(ROI_MAX, currentROI))),
      avgROI12m: round1(avgROI12m),
      bestROI12m: round1(bestROI12m),
      roiTrend12m: round2(roiTrend12m),
      roiTrend3m: round2(roiTrend3m),
      roiDirection,
      roiVolatility: round1(roiVolatility),
      roiMomentum: round2(roiMomentum),
      roiPercentile: round0(Math.max(PERCENTILE_MIN, Math.min(PERCENTILE_MAX, roiPercentile))),
    };

    // 5) Compute drivers (deterministic)
    const drivers = buildDeterministicDrivers(monthlyData, categoryAggs);

    // 6) Build deterministic analysis (fallback)
    const detProjections = buildDeterministicProjectedROI(trends);
    const detSustainability = computeRoiSustainability(trends, sortedMonths.length);
    const detActions = buildDeterministicImprovementActions(trends, drivers);
    const detRisks = buildDeterministicRiskFactors(trends, drivers);
    const detAssessment = buildDeterministicTrendAssessment(trends, drivers);

    let analysis: RoiAnalysis = {
      roiTrendAssessment: detAssessment,
      projectedROI30d: detProjections.projected30d,
      projectedROI60d: detProjections.projected60d,
      projectedROI90d: detProjections.projected90d,
      roiSustainabilityScore: detSustainability,
      roiImprovementActions: detActions,
      roiRiskFactors: detRisks,
    };

    let finalSummary = buildDeterministicSummary(trends, drivers);

    // 7) AI cache check (6h TTL) — key by current month
    const currentMonth2 = new Date(now);
    const monthKey = `${currentMonth2.getFullYear()}-${(currentMonth2.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const cacheKey = `inventory-roi-trend-tracker:${monthKey}`;
    const cached = getCachedAI<{
      analysis: RoiAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        trends,
        monthlyData,
        drivers,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 8) AI prompt with grounding
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
      trends,
      monthlyData,
      drivers,
      deterministicAnalysis: {
        roiTrendAssessment: detAssessment,
        projectedROI30d: detProjections.projected30d,
        projectedROI60d: detProjections.projected60d,
        projectedROI90d: detProjections.projected90d,
        roiSustainabilityScore: detSustainability,
        roiImprovementActions: detActions,
        roiRiskFactors: detRisks,
      },
      roiCaps: { min: ROI_MIN, max: ROI_MAX },
    };

    const prompt = `Si AI "Inventory ROI Trend Tracker" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Analiziraš ROI TRENDS čez čas — ali se ROI izboljšuje, upada ali je stabilen. Identificiraš kaj driver-ja spremembe ROI (price/cost/efficiency/category) in napoveš future ROI trajectory.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. analysis: {
   - roiTrendAssessment: slovenski povzetek (max 800 znakov) — kaj driver-ja ROI spremembe, ali je trend vzdržen, kaj pomeni za trading decisions. NE izmišljuj številk — uporabi zgornje deterministične.
   - projectedROI30d: % clamped [-50, 200], ±3 od deterministične (${detProjections.projected30d})
   - projectedROI60d: % clamped [-50, 200], ±5 od deterministične (${detProjections.projected60d})
   - projectedROI90d: % clamped [-50, 200], ±8 od deterministične (${detProjections.projected90d})
   - roiSustainabilityScore: 0-100, ±10 od deterministične (${detSustainability})
   - roiImprovementActions: 3-5 akcij z { action (max 200, slovensko), priority: HIGH|MEDIUM|LOW, expectedROILift: 0-30 percentage points }
     * Akcije ki izboljšajo ROI (npr. "Renegotiate nabavne cene", "Premium listing za višje sell cene", "Premik kapitala v best kategorijo").
   - roiRiskFactors: 2-4 tveganj z { risk (max 150, slovensko), severity: LOW|MEDIUM|HIGH, mitigation (max 250, slovensko) }
     * Tveganj ki lahko erodirajo ROI (npr. "cost inflation", "price compression", "volatility spike", "category decline").
}
2. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične.

VRNI LE JSON:
{
  "analysis": {
    "roiTrendAssessment": "ROI trend: IMPROVING (+1.5%/mo, momentum +0.4). Current 22% vs 12m avg 19%. Best month: Jun (28%). Driver: price increases (+5€/mo). Volatility 8% (low). Sustainability 75/100 — vzdržen trend.",
    "projectedROI30d": 23.5,
    "projectedROI60d": 25.1,
    "projectedROI90d": 26.5,
    "roiSustainabilityScore": 75,
    "roiImprovementActions": [
      { "action": "Renegotiate nabavne cene ali diversificiraj suppliers", "priority": "HIGH", "expectedROILift": 3 },
      { "action": "Povečaj volumen v kategoriji z najboljšim ROI: elektronika", "priority": "MEDIUM", "expectedROILift": 3 }
    ],
    "roiRiskFactors": [
      { "risk": "Nabavne cene naraščajo — margin compression tveganje", "severity": "HIGH", "mitigation": "Lock-in longer-term supplier contracts ali diversificiraj sourcing." }
    ]
  },
  "summary": "ROI trend: IMPROVING (+1.5%/mo, momentum +0.4). 30d projection: 23%. Driver: price increases. Best: elektronika."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiRoiResponse | null;

      if (parsed && typeof parsed === 'object') {
        if (parsed.analysis && typeof parsed.analysis === 'object') {
          const a = parsed.analysis as Record<string, unknown>;

          if (typeof a.roiTrendAssessment === 'string' && a.roiTrendAssessment.trim()) {
            analysis.roiTrendAssessment = clampString(
              a.roiTrendAssessment,
              800,
              detAssessment,
            );
          }

          // Projections ±3/5/8 from deterministic, clamped [-50, 200]
          if (a.projectedROI30d != null) {
            const adj = clampNumber(a.projectedROI30d, ROI_MIN, ROI_MAX, detProjections.projected30d);
            analysis.projectedROI30d = round1(
              Math.max(
                ROI_MIN,
                Math.min(
                  ROI_MAX,
                  detProjections.projected30d + Math.max(-3, Math.min(3, adj - detProjections.projected30d)),
                ),
              ),
            );
          }
          if (a.projectedROI60d != null) {
            const adj = clampNumber(a.projectedROI60d, ROI_MIN, ROI_MAX, detProjections.projected60d);
            analysis.projectedROI60d = round1(
              Math.max(
                ROI_MIN,
                Math.min(
                  ROI_MAX,
                  detProjections.projected60d + Math.max(-5, Math.min(5, adj - detProjections.projected60d)),
                ),
              ),
            );
          }
          if (a.projectedROI90d != null) {
            const adj = clampNumber(a.projectedROI90d, ROI_MIN, ROI_MAX, detProjections.projected90d);
            analysis.projectedROI90d = round1(
              Math.max(
                ROI_MIN,
                Math.min(
                  ROI_MAX,
                  detProjections.projected90d + Math.max(-8, Math.min(8, adj - detProjections.projected90d)),
                ),
              ),
            );
          }

          if (a.roiSustainabilityScore != null) {
            const adj = clampNumber(
              a.roiSustainabilityScore,
              SUSTAINABILITY_MIN,
              SUSTAINABILITY_MAX,
              detSustainability,
            );
            analysis.roiSustainabilityScore = round0(
              Math.max(
                SUSTAINABILITY_MIN,
                Math.min(
                  SUSTAINABILITY_MAX,
                  detSustainability + Math.max(-10, Math.min(10, adj - detSustainability)),
                ),
              ),
            );
          }

          if (Array.isArray(a.roiImprovementActions)) {
            const aiActions = (a.roiImprovementActions as unknown[])
              .map((ac: unknown) => {
                const a2 = ac as Record<string, unknown>;
                if (!a2 || typeof a2 !== 'object') return null;
                const action = clampString(a2.action, 200, '');
                if (!action) return null;
                const priority = clampEnum(a2.priority, VALID_PRIORITY, 'MEDIUM');
                const liftRaw = clampNumber(a2.expectedROILift, ROI_LIFT_MIN, ROI_LIFT_MAX, 2);
                return { action, priority, expectedROILift: round0(liftRaw) };
              })
              .filter((ac): ac is ImprovementAction => ac !== null)
              .slice(0, 5);
            if (aiActions.length > 0) analysis.roiImprovementActions = aiActions;
          }

          if (Array.isArray(a.roiRiskFactors)) {
            const aiRisks = (a.roiRiskFactors as unknown[])
              .map((r: unknown) => {
                const rr = r as Record<string, unknown>;
                if (!rr || typeof rr !== 'object') return null;
                const risk = clampString(rr.risk, 150, '');
                if (!risk) return null;
                const severity = clampEnum(rr.severity, VALID_SEVERITY, 'MEDIUM');
                const mitigation = clampString(rr.mitigation, 250, '');
                if (!mitigation) return null;
                return { risk, severity, mitigation };
              })
              .filter((r): r is RiskFactor => r !== null)
              .slice(0, 4);
            if (aiRisks.length > 0) analysis.roiRiskFactors = aiRisks;
          }
        }

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, buildDeterministicSummary(trends, drivers));
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-roi-trend-tracker',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 9) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        analysis,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      trends,
      monthlyData,
      drivers,
      analysis,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-roi-trend-tracker',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
