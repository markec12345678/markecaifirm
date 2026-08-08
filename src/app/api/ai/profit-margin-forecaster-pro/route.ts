// v7.85: AI Profit Margin Forecaster Pro — AI-powered PRO verzija ki
// forecast-a profit marže 30/60/90 dni naprej z SCENARIO analizo
// (BEST/BASE/WORST case marže) in confidence intervalsi. "Margin: 22% →
// base 20% v 30d, best 25%, worst 15%. Risk: cost increases. Action:
// negotiate lower prices."
//
// Razlika od profit-margin-forecaster (basic ki da single margin
// forecast) — ta PRO verzija da SCENARIO-based margin forecasting z
// confidence intervals in scenarioProbability weights. Razlika od
// profit-margin-optimizer-v2 (ki optimira margin) — ta FORECAST-a future
// marže z base/best/worst scenariji. Razlika od
// profit-margin-trend-analyzer (v7.82 pure DB ki analizira historical margin
// trend) — ta je AI PRO ki forecast-a FUTURE margin z scenariji. Razlika od
// profit-margin-heatmap (ki prikaže category × price matrix) — ta projicira
// dinamične margin scenarije 30/60/90 dni. Razlika od
// profit-margin-predictor (basic ki da single margin prediction) — ta da
// scenario-based forecast z keyMarginDrivers in marginRiskFactors.
//
// GET+POST /api/ai/profit-margin-forecaster-pro
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

type TrendDirection = 'UP' | 'FLAT' | 'DOWN';
type MarginTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface MarginCurrent {
  currentMargin: number; // % (last 30d)
  avgMargin3m: number;
  avgMargin12m: number;
  marginVolatility: number; // stddev of monthly margins
  marginTrend: number; // slope (% per month)
}

interface InfluencerInfo {
  direction: TrendDirection;
  impact: string;
}

interface MarginInfluencers {
  priceTrend: InfluencerInfo;
  costTrend: InfluencerInfo;
  feeTrend: InfluencerInfo;
  categoryMixShift: InfluencerInfo;
}

interface ScenarioForecast {
  margin30d: number;
  margin60d: number;
  margin90d: number;
}

interface MarginForecast {
  baseCase: ScenarioForecast;
  bestCase: ScenarioForecast;
  worstCase: ScenarioForecast;
  confidenceInterval: { low: number; high: number };
  scenarioProbability: { base: number; best: number; worst: number };
  projectedMarginTrend: MarginTrend;
}

interface MarginDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface MarginRiskFactor {
  risk: string;
  severity: RiskSeverity;
  mitigation: string;
}

interface MarginProtectionAction {
  action: string;
  priority: ActionPriority;
  expectedMarginLift: number; // percentage points
}

interface MarginAnalysis {
  keyMarginDrivers: MarginDriver[];
  marginRiskFactors: MarginRiskFactor[];
  marginProtectionActions: MarginProtectionAction[];
}

interface AiMarginProResponse {
  forecast?: unknown;
  analysis?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const HORIZON_3M = 90 * DAY_MS;
const HORIZON_30D = 30 * DAY_MS;
const MARGIN_MIN = -50; // realistic floor
const MARGIN_MAX = 100; // realistic ceiling

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

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const v = clampNumber(raw, min, max, fallback);
  return Math.round(v);
}

const VALID_MARGIN_TREND: readonly MarginTrend[] = [
  'IMPROVING',
  'STABLE',
  'DECLINING',
];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_SEVERITY: readonly RiskSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

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

function stdDev(values: number[]): number {
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

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function trendDirectionFromSlope(
  slope: number,
  threshold: number,
): TrendDirection {
  if (slope > threshold) return 'UP';
  if (slope < -threshold) return 'DOWN';
  return 'FLAT';
}

function marginTrendFromSlope(
  slope: number,
  threshold: number,
): MarginTrend {
  if (slope > threshold) return 'IMPROVING';
  if (slope < -threshold) return 'DECLINING';
  return 'STABLE';
}

// --- Sold trade rows ----------------------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string;
}

interface MonthlyMarginAgg {
  monthKey: string;
  monthMs: number;
  totalInvested: number;
  totalProfit: number;
  tradeCount: number;
  avgSellPrice: number;
  avgBuyPrice: number;
  avgFeePct: number;
  categorySet: Set<string>;
  margin: number;
}

// Compute monthly margin aggregation from SOLD trades (12 months)
function computeMonthlyMargins(
  soldTrades: SoldTradeRow[],
  now: number,
): {
  monthly: MonthlyMarginAgg[];
  currentMargin: number;
  avgMargin3m: number;
  avgMargin12m: number;
  marginVolatility: number;
  marginTrend: number;
  priceTrendSlope: number;
  costTrendSlope: number;
  feeTrendSlope: number;
} {
  const cutoff12m = now - HORIZON_12M;
  const cutoff3m = now - HORIZON_3M;
  const cutoff30d = now - HORIZON_30D;

  const monthMap = new Map<string, MonthlyMarginAgg>();

  let cur30Invested = 0;
  let cur30Profit = 0;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0 || sellMs < cutoff12m) continue;
    const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
    const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = proceeds - invested;
    const d = new Date(sellMs);
    const key = monthKeyOf(d);
    let m = monthMap.get(key);
    if (!m) {
      m = {
        monthKey: key,
        monthMs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        totalInvested: 0,
        totalProfit: 0,
        tradeCount: 0,
        avgSellPrice: 0,
        avgBuyPrice: 0,
        avgFeePct: 0,
        categorySet: new Set<string>(),
        margin: 0,
      };
      monthMap.set(key, m);
    }
    m.totalInvested += invested;
    m.totalProfit += profit;
    m.tradeCount += 1;
    m.avgSellPrice += proceeds;
    m.avgBuyPrice += invested;
    const feePct = invested > 0 ? ((t.buyFees ?? 0) + (t.sellFees ?? 0)) / invested * 100 : 0;
    m.avgFeePct += feePct;
    if (t.category) m.categorySet.add(t.category);

    if (sellMs >= cutoff30d) {
      cur30Invested += invested;
      cur30Profit += profit;
    }
  }

  // Compute per-month margin and finalize averages
  const monthly: MonthlyMarginAgg[] = [];
  for (const m of monthMap.values()) {
    const margin =
      m.totalInvested > 0 ? (m.totalProfit / m.totalInvested) * 100 : 0;
    m.avgSellPrice = m.tradeCount > 0 ? m.avgSellPrice / m.tradeCount : 0;
    m.avgBuyPrice = m.tradeCount > 0 ? m.avgBuyPrice / m.tradeCount : 0;
    m.avgFeePct = m.tradeCount > 0 ? m.avgFeePct / m.tradeCount : 0;
    m.margin = round1(margin);
    monthly.push(m);
  }
  monthly.sort((a, b) => a.monthMs - b.monthMs);

  // Current margin = last 30d
  const currentMargin =
    cur30Invested > 0 ? round1((cur30Profit / cur30Invested) * 100) : 0;

  // 3m avg
  const threeM = monthly.filter(
    (m) => m.monthMs >= cutoff3m - 31 * DAY_MS,
  );
  const avgMargin3m = threeM.length > 0
    ? round1(avg(threeM.map((m) => m.margin)))
    : 0;

  // 12m avg
  const margins12m = monthly.map((m) => m.margin);
  const avgMargin12m = margins12m.length > 0 ? round1(avg(margins12m)) : 0;
  const marginVolatility =
    margins12m.length > 1 ? round1(stdDev(margins12m)) : 0;
  const marginTrend = round2(trendSlope(margins12m));

  // Influencers
  const priceTrendSlope = round2(trendSlope(monthly.map((m) => m.avgSellPrice)));
  const costTrendSlope = round2(trendSlope(monthly.map((m) => m.avgBuyPrice)));
  const feeTrendSlope = round2(trendSlope(monthly.map((m) => m.avgFeePct)));

  return {
    monthly,
    currentMargin,
    avgMargin3m,
    avgMargin12m,
    marginVolatility,
    marginTrend,
    priceTrendSlope,
    costTrendSlope,
    feeTrendSlope,
  };
}

// --- Influencers --------------------------------------------------------

function buildInfluencers(
  priceSlope: number,
  costSlope: number,
  feeSlope: number,
  monthly: MonthlyMarginAgg[],
): MarginInfluencers {
  // Price trend — UP positive (sell prices rising = good for margin)
  const priceDir = trendDirectionFromSlope(priceSlope, 2);
  const priceImpact =
    priceDir === 'UP'
      ? 'POZITIVNO — rast prodajnih cen dviguje marže.'
      : priceDir === 'DOWN'
        ? 'NEGATIVNO — padajoče prodajne cene zmanjšujejo marže.'
        : 'NEVTRALNO — prodajne cene stabilne.';

  // Cost trend — UP negative (buy prices rising = bad for margin)
  const costDir = trendDirectionFromSlope(costSlope, 2);
  const costImpact =
    costDir === 'UP'
      ? 'NEGATIVNO — rast nabavnih cen obremenjuje marže.'
      : costDir === 'DOWN'
        ? 'POZITIVNO — padajoče nabavne cene povečujejo marže.'
        : 'NEVTRALNO — nabavne cene stabilne.';

  // Fee trend — UP negative
  const feeDir = trendDirectionFromSlope(feeSlope, 0.3);
  const feeImpact =
    feeDir === 'UP'
      ? 'NEGATIVNO — naraščajoči pristojbine % obremenjujejo marže.'
      : feeDir === 'DOWN'
        ? 'POZITIVNO — padajoči pristojbine % povečujejo marže.'
        : 'NEVTRALNO — pristojbine stabilne.';

  // Category mix shift — compare first-half vs second-half category distribution
  const mid = Math.floor(monthly.length / 2);
  const firstHalf = monthly.slice(0, mid);
  const secondHalf = monthly.slice(mid);
  const firstCats = new Set<string>();
  const secondCats = new Set<string>();
  firstHalf.forEach((m) =>
    m.categorySet.forEach((c) => firstCats.add(c)),
  );
  secondHalf.forEach((m) =>
    m.categorySet.forEach((c) => secondCats.add(c)),
  );
  const onlySecond = Array.from(secondCats).filter(
    (c) => !firstCats.has(c),
  );
  const onlyFirst = Array.from(firstCats).filter(
    (c) => !secondCats.has(c),
  );
  let mixDir: TrendDirection = 'FLAT';
  if (onlySecond.length >= 2 && onlySecond.length > onlyFirst.length) {
    mixDir = 'UP';
  } else if (onlyFirst.length >= 2 && onlyFirst.length > onlySecond.length) {
    mixDir = 'DOWN';
  }
  const catImpact =
    mixDir === 'UP'
      ? `POZITIVNO — portfolio se širi v nove kategorije (${onlySecond.slice(0, 3).join(', ')}).`
      : mixDir === 'DOWN'
        ? `NEGATIVNO — portfolio se zožuje (${onlyFirst.slice(0, 3).join(', ')} izginjajo).`
        : 'NEVTRALNO — kategorije stabilne.';

  return {
    priceTrend: { direction: priceDir, impact: priceImpact },
    costTrend: { direction: costDir, impact: costImpact },
    feeTrend: { direction: feeDir, impact: feeImpact },
    categoryMixShift: { direction: mixDir, impact: catImpact },
  };
}

// --- Deterministic forecast ---------------------------------------------

interface DeterministicResult {
  forecast: MarginForecast;
  analysis: MarginAnalysis;
  summary: string;
}

function buildDeterministicForecast(
  current: MarginCurrent,
  influencers: MarginInfluencers,
): DeterministicResult {
  const { currentMargin, marginTrend, marginVolatility, avgMargin3m, avgMargin12m } = current;

  // Project base/best/worst case for 30/60/90d
  // Base = currentMargin + trend × N months (1/2/3)
  const baseCase: ScenarioForecast = {
    margin30d: round1(
      clampNumber(
        currentMargin + marginTrend * 1,
        MARGIN_MIN,
        MARGIN_MAX,
        currentMargin,
      ),
    ),
    margin60d: round1(
      clampNumber(
        currentMargin + marginTrend * 2,
        MARGIN_MIN,
        MARGIN_MAX,
        currentMargin,
      ),
    ),
    margin90d: round1(
      clampNumber(
        currentMargin + marginTrend * 3,
        MARGIN_MIN,
        MARGIN_MAX,
        currentMargin,
      ),
    ),
  };

  // Best case = base + volatility (optimistic)
  const vol = Math.max(2, marginVolatility);
  const bestCase: ScenarioForecast = {
    margin30d: round1(
      clampNumber(baseCase.margin30d + vol, MARGIN_MIN, MARGIN_MAX, baseCase.margin30d),
    ),
    margin60d: round1(
      clampNumber(baseCase.margin60d + vol * 1.5, MARGIN_MIN, MARGIN_MAX, baseCase.margin60d),
    ),
    margin90d: round1(
      clampNumber(baseCase.margin90d + vol * 2, MARGIN_MIN, MARGIN_MAX, baseCase.margin90d),
    ),
  };

  // Worst case = base - volatility (pessimistic)
  const worstCase: ScenarioForecast = {
    margin30d: round1(
      clampNumber(baseCase.margin30d - vol, MARGIN_MIN, MARGIN_MAX, baseCase.margin30d),
    ),
    margin60d: round1(
      clampNumber(baseCase.margin60d - vol * 1.5, MARGIN_MIN, MARGIN_MAX, baseCase.margin60d),
    ),
    margin90d: round1(
      clampNumber(baseCase.margin90d - vol * 2, MARGIN_MIN, MARGIN_MAX, baseCase.margin90d),
    ),
  };

  // Confidence interval for 30d: base ± 0.7 stddev
  const confidenceInterval = {
    low: round1(clampNumber(baseCase.margin30d - vol * 0.7, MARGIN_MIN, MARGIN_MAX, baseCase.margin30d)),
    high: round1(clampNumber(baseCase.margin30d + vol * 0.7, MARGIN_MIN, MARGIN_MAX, baseCase.margin30d)),
  };

  // Scenario probability — base dominant, best/worst weighted by trend
  let baseProb = 60;
  let bestProb = 20;
  let worstProb = 20;
  if (marginTrend > 1) {
    baseProb = 55;
    bestProb = 30;
    worstProb = 15;
  } else if (marginTrend < -1) {
    baseProb = 55;
    bestProb = 15;
    worstProb = 30;
  }
  const probSum = baseProb + bestProb + worstProb;
  const scenarioProbability = {
    base: round0((baseProb / probSum) * 100),
    best: round0((bestProb / probSum) * 100),
    worst: round0((worstProb / probSum) * 100),
  };

  const projectedMarginTrend = marginTrendFromSlope(marginTrend, 0.5);

  // Key margin drivers — top 3
  const drivers: MarginDriver[] = [];
  if (influencers.priceTrend.direction === 'UP') {
    drivers.push({
      driver: 'Rast prodajnih cen',
      impact: 'POSITIVE',
      weight: 80,
      detail: 'Prodajne cene naraščajo — podpora margin ekspanziji.',
    });
  } else if (influencers.priceTrend.direction === 'DOWN') {
    drivers.push({
      driver: 'Padajoče prodajne cene',
      impact: 'NEGATIVE',
      weight: 75,
      detail: 'Prodajne cene padajo — pritisk na marže.',
    });
  }
  if (influencers.costTrend.direction === 'UP') {
    drivers.push({
      driver: 'Rast nabavnih cen',
      impact: 'NEGATIVE',
      weight: 80,
      detail: 'Nabavne cene naraščajo — obremenitev marže.',
    });
  } else if (influencers.costTrend.direction === 'DOWN') {
    drivers.push({
      driver: 'Padajoče nabavne cene',
      impact: 'POSITIVE',
      weight: 70,
      detail: 'Nabavne cene padajo — povečana marža možna.',
    });
  }
  if (influencers.feeTrend.direction === 'UP') {
    drivers.push({
      driver: 'Naraščajoči pristojbine %',
      impact: 'NEGATIVE',
      weight: 60,
      detail: 'Pristojbine kot % naraščajo — neposredno obremenjuje marže.',
    });
  }
  if (marginVolatility > 8) {
    drivers.push({
      driver: 'Visoka margin volatilnost',
      impact: 'NEGATIVE',
      weight: 55,
      detail: `Marže nihajo (±${marginVolatility}%) — težko predvidljive.`,
    });
  }
  if (currentMargin > avgMargin3m && currentMargin > avgMargin12m) {
    drivers.push({
      driver: 'Margin izboljšanje',
      impact: 'POSITIVE',
      weight: 65,
      detail: `Trenutna marža ${currentMargin}% > 3m (${avgMargin3m}%) in 12m (${avgMargin12m}%) povprečje.`,
    });
  } else if (currentMargin < avgMargin3m && currentMargin < avgMargin12m) {
    drivers.push({
      driver: 'Margin poslabšanje',
      impact: 'NEGATIVE',
      weight: 65,
      detail: `Trenutna marža ${currentMargin}% < 3m (${avgMargin3m}%) in 12m (${avgMargin12m}%) povprečje.`,
    });
  }
  if (drivers.length === 0) {
    drivers.push({
      driver: 'Stabilna marža',
      impact: 'POSITIVE',
      weight: 50,
      detail: 'Brez izrazitih pozitivnih ali negativnih dejavnikov.',
    });
  }
  drivers.sort((a, b) => b.weight - a.weight);

  // Margin risk factors
  const risks: MarginRiskFactor[] = [];
  if (influencers.costTrend.direction === 'UP') {
    risks.push({
      risk: 'Naraščajoče nabavne cene',
      severity: 'HIGH',
      mitigation: 'Pogajaj se z dobavitelji o nižjih cenah ali išči alternative.',
    });
  }
  if (influencers.feeTrend.direction === 'UP') {
    risks.push({
      risk: 'Naraščajoče platform pristojbine',
      severity: 'MEDIUM',
      mitigation: 'Diversificiraj na platforme z nižjimi pristojbinami ali povečaj cene.',
    });
  }
  if (marginVolatility > 10) {
    risks.push({
      risk: 'Visoka margin volatilnost',
      severity: 'MEDIUM',
      mitigation: 'Standardiziraj pricing strategijo in kategorije z nizko volatilnostjo.',
    });
  }
  if (projectedMarginTrend === 'DECLINING') {
    risks.push({
      risk: 'Margin trend DECLINING',
      severity: 'HIGH',
      mitigation: 'Takojšnja revizija pricing in sourcing strategije.',
    });
  }
  if (influencers.priceTrend.direction === 'DOWN') {
    risks.push({
      risk: 'Padajoče prodajne cene',
      severity: 'HIGH',
      mitigation: 'Premakni fokus na višje-margin kategorije ali premium pozicioniranje.',
    });
  }
  if (risks.length === 0) {
    risks.push({
      risk: 'Brez izrazitih tveganj',
      severity: 'LOW',
      mitigation: 'Vzdržuj trenutno strategijo in monitor trende.',
    });
  }

  // Margin protection actions
  const actions: MarginProtectionAction[] = [];
  if (influencers.costTrend.direction === 'UP') {
    actions.push({
      action: 'Pogajaj se o nižjih nabavnih cenah z glavnimi dobavitelji',
      priority: 'HIGH',
      expectedMarginLift: 3,
    });
  }
  if (influencers.priceTrend.direction === 'DOWN') {
    actions.push({
      action: 'Premakni fokus na višje-margin kategorije (premium segment)',
      priority: 'HIGH',
      expectedMarginLift: 4,
    });
  }
  if (influencers.feeTrend.direction === 'UP') {
    actions.push({
      action: 'Diversificiraj prodajne kanale za zmanjšanje odvisnosti od ene platforme',
      priority: 'MEDIUM',
      expectedMarginLift: 2,
    });
  }
  if (marginVolatility > 8) {
    actions.push({
      action: 'Standardiziraj pricing in izogibaj visoko-volatilnim kategorijam',
      priority: 'MEDIUM',
      expectedMarginLift: 2,
    });
  }
  if (projectedMarginTrend === 'IMPROVING') {
    actions.push({
      action: 'Izkoristi trenutno pozitivno trend — povečaj volumen v višje-margin segmentih',
      priority: 'MEDIUM',
      expectedMarginLift: 3,
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo in monitor margin trende čez naslednje 30 dni',
      priority: 'LOW',
      expectedMarginLift: 0,
    });
  }

  const forecast: MarginForecast = {
    baseCase,
    bestCase,
    worstCase,
    confidenceInterval,
    scenarioProbability,
    projectedMarginTrend,
  };

  const analysis: MarginAnalysis = {
    keyMarginDrivers: drivers.slice(0, 3),
    marginRiskFactors: risks.slice(0, 4),
    marginProtectionActions: actions.slice(0, 4),
  };

  const summary =
    current.currentMargin === 0 && current.avgMargin12m === 0
      ? 'Ni SOLD zgodovine v zadnjih 12 mesecih — Profit Margin Forecaster Pro ni mogoč.'
      : `Marža: ${currentMargin}% → base ${baseCase.margin30d}% v 30d, best ${bestCase.margin30d}%, worst ${worstCase.margin30d}%. Trend: ${projectedMarginTrend}. Glavni dejavnik: ${drivers[0]?.driver ?? 'brez'}.`;

  return { forecast, analysis, summary };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitMarginForecasterPro(req);
}
export async function POST(req: NextRequest) {
  return handleProfitMarginForecasterPro(req);
}

async function handleProfitMarginForecasterPro(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-margin-forecaster-pro', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query SOLD trades from last 12 months for margin baseline
    const cutoff12m = new Date(now - HORIZON_12M);
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
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const rows = soldTrades as unknown as SoldTradeRow[];

    const agg = computeMonthlyMargins(rows, now);

    const current: MarginCurrent = {
      currentMargin: agg.currentMargin,
      avgMargin3m: agg.avgMargin3m,
      avgMargin12m: agg.avgMargin12m,
      marginVolatility: agg.marginVolatility,
      marginTrend: agg.marginTrend,
    };

    const influencers = buildInfluencers(
      agg.priceTrendSlope,
      agg.costTrendSlope,
      agg.feeTrendSlope,
      agg.monthly,
    );

    // Deterministic forecast (fallback)
    const det = buildDeterministicForecast(current, influencers);
    let forecast = det.forecast;
    let analysis = det.analysis;
    let finalSummary = det.summary;

    // Empty state: no SOLD history
    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        current,
        influencers,
        forecast,
        analysis,
        summary:
          'Ni SOLD zgodovine v zadnjih 12 mesecih — Profit Margin Forecaster Pro ni mogoč.',
        aiUsed: false,
        message:
          'Ni SOLD zgodovine v zadnjih 12 mesecih — Profit Margin Forecaster Pro ni mogoč.',
      });
    }

    // 2) AI cache check (6h TTL) — key by current month
    const currentMonthKey = monthKeyOf(new Date(now));
    const cacheKey = `profit-margin-forecaster-pro:${currentMonthKey}`;
    const cached = getCachedAI<{
      forecast: MarginForecast;
      analysis: MarginAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        influencers,
        forecast: cached.forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 3) AI prompt with grounding
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
      current,
      influencers,
      monthlyMargins: agg.monthly.map((m) => ({
        month: m.monthKey,
        margin: m.margin,
        tradeCount: m.tradeCount,
        avgSellPrice: round1(m.avgSellPrice),
        avgBuyPrice: round1(m.avgBuyPrice),
        avgFeePct: round2(m.avgFeePct),
      })),
      influencerSlopes: {
        price: agg.priceTrendSlope,
        cost: agg.costTrendSlope,
        fee: agg.feeTrendSlope,
      },
      deterministicForecast: det.forecast,
      deterministicDrivers: det.analysis.keyMarginDrivers,
    };

    const prompt = `Si AI "Profit Margin Forecaster Pro" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš profit marže 30/60/90 dni naprej z SCENARIO analizo (base/best/worst case) in confidence intervalsi.

CURRENT MARGIN METRICS (deterministično izračunano):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast: {
   - baseCase: { margin30d/60d/90d: % v [-50, 100] (lahko prilagodiš znotraj [-10, +10] od deterministične vrednosti — anti-hallucination)
   - bestCase: { margin30d/60d/90d: % (optimistični scenarij, >= baseCase, lahko prilagodiš ±5 od deterministične)
   - worstCase: { margin30d/60d/90d: % (pesimistični scenarij, <= baseCase, lahko prilagodiš ±5 od deterministične)
   - confidenceInterval: { low, high } v [-50, 100] za 30d forecast (±5 od deterministične)
   - scenarioProbability: { base: 0-100, best: 0-100, worst: 0-100 } (vsota = 100, ±15 od deterministične)
   - projectedMarginTrend: IMPROVING | STABLE | DECLINING (validiraj proti enum)
}
2. analysis: {
   - keyMarginDrivers: 3 drivers z { driver (max 80), impact: POSITIVE|NEGATIVE, weight: 0-100, detail (max 200) }
   - marginRiskFactors: 2-4 risks z { risk (max 100), severity: LOW|MEDIUM|HIGH, mitigation (max 250) }
   - marginProtectionActions: 3-4 actions z { action (max 200), priority: HIGH|MEDIUM|LOW, expectedMarginLift: 0-15 (percentage points) }
}
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "forecast": {
    "baseCase": { "margin30d": 20, "margin60d": 19, "margin90d": 18 },
    "bestCase": { "margin30d": 25, "margin60d": 27, "margin90d": 28 },
    "worstCase": { "margin30d": 15, "margin60d": 12, "margin90d": 10 },
    "confidenceInterval": { "low": 17, "high": 23 },
    "scenarioProbability": { "base": 60, "best": 25, "worst": 15 },
    "projectedMarginTrend": "DECLINING"
  },
  "analysis": {
    "keyMarginDrivers": [
      { "driver": "Rast nabavnih cen", "impact": "NEGATIVE", "weight": 80, "detail": "Nabavne cene naraščajo — obremenitev marže." }
    ],
    "marginRiskFactors": [
      { "risk": "Naraščajoče nabavne cene", "severity": "HIGH", "mitigation": "Pogajaj se z dobavitelji o nižjih cenah ali išči alternative." }
    ],
    "marginProtectionActions": [
      { "action": "Pogajaj se o nižjih nabavnih cenah z glavnimi dobavitelji", "priority": "HIGH", "expectedMarginLift": 3 }
    ]
  },
  "summary": "Marža: 22% → base 20% v 30d, best 25%, worst 15%. Trend: DECLINING. Glavni dejavnik: Rast nabavnih cen."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiMarginProResponse | null;

      if (parsed && typeof parsed === 'object') {
        // AI forecast override (with anti-hallucination clamping)
        if (parsed.forecast && typeof parsed.forecast === 'object') {
          const f = parsed.forecast as Record<string, unknown>;

          // baseCase: ±10 from deterministic
          const detBase30 = forecast.baseCase.margin30d;
          const detBase60 = forecast.baseCase.margin60d;
          const detBase90 = forecast.baseCase.margin90d;
          if (f.baseCase && typeof f.baseCase === 'object') {
            const bc = f.baseCase as Record<string, unknown>;
            const adjB30 = clampNumber(bc.margin30d, MARGIN_MIN, MARGIN_MAX, detBase30);
            const adjB60 = clampNumber(bc.margin60d, MARGIN_MIN, MARGIN_MAX, detBase60);
            const adjB90 = clampNumber(bc.margin90d, MARGIN_MIN, MARGIN_MAX, detBase90);
            forecast.baseCase.margin30d = round1(
              Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, detBase30 + Math.max(-10, Math.min(10, adjB30 - detBase30)))),
            );
            forecast.baseCase.margin60d = round1(
              Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, detBase60 + Math.max(-10, Math.min(10, adjB60 - detBase60)))),
            );
            forecast.baseCase.margin90d = round1(
              Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, detBase90 + Math.max(-10, Math.min(10, adjB90 - detBase90)))),
            );
          }

          // bestCase: >= baseCase, ±5 from deterministic
          if (f.bestCase && typeof f.bestCase === 'object') {
            const bc = f.bestCase as Record<string, unknown>;
            const adjBe30 = clampNumber(bc.margin30d, MARGIN_MIN, MARGIN_MAX, forecast.bestCase.margin30d);
            const adjBe60 = clampNumber(bc.margin60d, MARGIN_MIN, MARGIN_MAX, forecast.bestCase.margin60d);
            const adjBe90 = clampNumber(bc.margin90d, MARGIN_MIN, MARGIN_MAX, forecast.bestCase.margin90d);
            forecast.bestCase.margin30d = round1(
              Math.max(forecast.baseCase.margin30d, Math.min(MARGIN_MAX, forecast.bestCase.margin30d + Math.max(-5, Math.min(5, adjBe30 - forecast.bestCase.margin30d)))),
            );
            forecast.bestCase.margin60d = round1(
              Math.max(forecast.baseCase.margin60d, Math.min(MARGIN_MAX, forecast.bestCase.margin60d + Math.max(-5, Math.min(5, adjBe60 - forecast.bestCase.margin60d)))),
            );
            forecast.bestCase.margin90d = round1(
              Math.max(forecast.baseCase.margin90d, Math.min(MARGIN_MAX, forecast.bestCase.margin90d + Math.max(-5, Math.min(5, adjBe90 - forecast.bestCase.margin90d)))),
            );
          }

          // worstCase: <= baseCase, ±5 from deterministic
          if (f.worstCase && typeof f.worstCase === 'object') {
            const wc = f.worstCase as Record<string, unknown>;
            const adjW30 = clampNumber(wc.margin30d, MARGIN_MIN, MARGIN_MAX, forecast.worstCase.margin30d);
            const adjW60 = clampNumber(wc.margin60d, MARGIN_MIN, MARGIN_MAX, forecast.worstCase.margin60d);
            const adjW90 = clampNumber(wc.margin90d, MARGIN_MIN, MARGIN_MAX, forecast.worstCase.margin90d);
            forecast.worstCase.margin30d = round1(
              Math.max(MARGIN_MIN, Math.min(forecast.baseCase.margin30d, forecast.worstCase.margin30d + Math.max(-5, Math.min(5, adjW30 - forecast.worstCase.margin30d)))),
            );
            forecast.worstCase.margin60d = round1(
              Math.max(MARGIN_MIN, Math.min(forecast.baseCase.margin60d, forecast.worstCase.margin60d + Math.max(-5, Math.min(5, adjW60 - forecast.worstCase.margin60d)))),
            );
            forecast.worstCase.margin90d = round1(
              Math.max(MARGIN_MIN, Math.min(forecast.baseCase.margin90d, forecast.worstCase.margin90d + Math.max(-5, Math.min(5, adjW90 - forecast.worstCase.margin90d)))),
            );
          }

          // confidenceInterval: ±5 from deterministic
          if (f.confidenceInterval && typeof f.confidenceInterval === 'object') {
            const ci = f.confidenceInterval as Record<string, unknown>;
            const adjLow = clampNumber(ci.low, MARGIN_MIN, MARGIN_MAX, forecast.confidenceInterval.low);
            const adjHigh = clampNumber(ci.high, MARGIN_MIN, MARGIN_MAX, forecast.confidenceInterval.high);
            forecast.confidenceInterval.low = round1(
              Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, forecast.confidenceInterval.low + Math.max(-5, Math.min(5, adjLow - forecast.confidenceInterval.low)))),
            );
            forecast.confidenceInterval.high = round1(
              Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, forecast.confidenceInterval.high + Math.max(-5, Math.min(5, adjHigh - forecast.confidenceInterval.high)))),
            );
            if (forecast.confidenceInterval.low > forecast.confidenceInterval.high) {
              const tmp = forecast.confidenceInterval.low;
              forecast.confidenceInterval.low = forecast.confidenceInterval.high;
              forecast.confidenceInterval.high = tmp;
            }
          }

          // scenarioProbability: ±15 from deterministic, sum = 100
          if (f.scenarioProbability && typeof f.scenarioProbability === 'object') {
            const sp = f.scenarioProbability as Record<string, unknown>;
            const adjBase = clampNumber(sp.base, 0, 100, forecast.scenarioProbability.base);
            const adjBest = clampNumber(sp.best, 0, 100, forecast.scenarioProbability.best);
            const adjWorst = clampNumber(sp.worst, 0, 100, forecast.scenarioProbability.worst);
            const detBase = forecast.scenarioProbability.base;
            const detBest = forecast.scenarioProbability.best;
            const detWorst = forecast.scenarioProbability.worst;
            let newBase = round0(Math.max(0, Math.min(100, detBase + Math.max(-15, Math.min(15, adjBase - detBase)))));
            let newBest = round0(Math.max(0, Math.min(100, detBest + Math.max(-15, Math.min(15, adjBest - detBest)))));
            let newWorst = round0(Math.max(0, Math.min(100, detWorst + Math.max(-15, Math.min(15, adjWorst - detWorst)))));
            const sum = newBase + newBest + newWorst;
            if (sum > 0) {
              newBase = round0((newBase / sum) * 100);
              newBest = round0((newBest / sum) * 100);
              newWorst = 100 - newBase - newBest;
              if (newWorst < 0) {
                newWorst = 0;
                newBest = 100 - newBase;
              }
            }
            forecast.scenarioProbability = { base: newBase, best: newBest, worst: newWorst };
          }

          forecast.projectedMarginTrend = clampEnum(
            f.projectedMarginTrend,
            VALID_MARGIN_TREND,
            forecast.projectedMarginTrend,
          );
        }

        // Analysis override (with anti-hallucination)
        if (parsed.analysis && typeof parsed.analysis === 'object') {
          const a = parsed.analysis as Record<string, unknown>;

          if (Array.isArray(a.keyMarginDrivers)) {
            const aiDrivers = (a.keyMarginDrivers as unknown[])
              .map((d: unknown) => {
                const dr = d as Record<string, unknown>;
                if (!dr || typeof dr !== 'object') return null;
                const driver = clampString(dr.driver, 80, '');
                if (!driver) return null;
                const impact = clampEnum(dr.impact, VALID_IMPACT, 'POSITIVE');
                const weight = clampInt(dr.weight, 0, 100, 50);
                const detail = clampString(dr.detail, 200, '');
                if (!detail) return null;
                return { driver, impact, weight, detail };
              })
              .filter((d): d is MarginDriver => d !== null)
              .slice(0, 3);
            if (aiDrivers.length > 0) analysis.keyMarginDrivers = aiDrivers;
          }

          if (Array.isArray(a.marginRiskFactors)) {
            const aiRisks = (a.marginRiskFactors as unknown[])
              .map((r: unknown) => {
                const rr = r as Record<string, unknown>;
                if (!rr || typeof rr !== 'object') return null;
                const risk = clampString(rr.risk, 100, '');
                if (!risk) return null;
                const severity = clampEnum(rr.severity, VALID_SEVERITY, 'MEDIUM');
                const mitigation = clampString(rr.mitigation, 250, '');
                if (!mitigation) return null;
                return { risk, severity, mitigation };
              })
              .filter((r): r is MarginRiskFactor => r !== null)
              .slice(0, 4);
            if (aiRisks.length > 0) analysis.marginRiskFactors = aiRisks;
          }

          if (Array.isArray(a.marginProtectionActions)) {
            const aiActions = (a.marginProtectionActions as unknown[])
              .map((ac: unknown) => {
                const a2 = ac as Record<string, unknown>;
                if (!a2 || typeof a2 !== 'object') return null;
                const action = clampString(a2.action, 200, '');
                if (!action) return null;
                const priority = clampEnum(a2.priority, VALID_PRIORITY, 'MEDIUM');
                const expectedMarginLift = clampNumber(a2.expectedMarginLift, 0, 15, 1);
                return { action, priority, expectedMarginLift: round1(expectedMarginLift) };
              })
              .filter((ac): ac is MarginProtectionAction => ac !== null)
              .slice(0, 4);
            if (aiActions.length > 0) analysis.marginProtectionActions = aiActions;
          }
        }

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, det.summary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-margin-forecaster-pro',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 4) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        forecast,
        analysis,
        summary: finalSummary,
      });
    }

    return NextResponse.json({
      ok: true,
      current,
      influencers,
      forecast,
      analysis,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-margin-forecaster-pro',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
