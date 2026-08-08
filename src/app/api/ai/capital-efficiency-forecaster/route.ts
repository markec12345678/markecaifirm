// v7.84: AI Capital Efficiency Forecaster — AI napove kako učinkovito bo
// kapital uporabljen v naslednjih 30/60/90 dneh — projected utilization rate,
// idle capital in ROI per euro deployed. "Capital efficiency: 72% utilization,
// projected 65% v 30d (declining). Bottleneck: 3 items >60d. Action:
// liquidate → +8% efficiency."
//
// Razlika od inventory-capital-efficiency-optimizer (ki optimira CURRENT
// capital allocation) — ta FORECAST-a future capital efficiency 30/60/90 dni.
// Razlika od capital-allocation-optimizer (ki statično alocira kapital čez
// kategorije) — ta projicira DINAMIČNO capital efficiency (utilization rate,
// idle capital, ROI per euro) v prihodnost. Razlika od cash-flow-velocity
// (ki meri cash flow hitrost) — ta gleda CAPITAL EFFICIENCY z utilization
// in idle capital projekcijami. Razlika od cash-conversion-cycle (ki meri
// CCC) — ta forecast-a capital efficiency score 0-100 in drivers/bottlenecks.
// Razlika od profit-efficiency-analyzer (ki meri profit per dan) — ta gleda
// capital DEPLOYMENT efficiency z ROI per euro deployed.
//
// GET+POST /api/ai/capital-efficiency-forecaster
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

type EfficiencyTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

interface CapitalCurrent {
  avgCapitalUtilization: number; // 0-100
  avgROIperEuroDeployed: number; // % (-50 to 200)
  avgCapitalCycleTime: number; // days
  idleCapitalRate: number; // 0-100 %
  heldCapital: number; // EUR
  availableCapital: number; // EUR (net proceeds last 30d)
}

interface CapitalForecast {
  projectedUtilization30d: number;
  projectedUtilization60d: number;
  projectedUtilization90d: number;
  projectedROIperEuro30d: number;
  projectedROIperEuro60d: number;
  projectedROIperEuro90d: number;
  projectedIdleCapital: number; // EUR
  capitalEfficiencyTrend: EfficiencyTrend;
  projectedEfficiencyScore: number; // 0-100
}

interface EfficiencyDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface CapitalBottleneck {
  bottleneck: string;
  impact: string;
  mitigation: string;
}

interface OptimizationAction {
  action: string;
  priority: Priority;
  expectedEfficiencyGain: string;
}

interface EfficiencyAnalysis {
  efficiencyDrivers: EfficiencyDriver[];
  capitalBottlenecks: CapitalBottleneck[];
  optimizationActions: OptimizationAction[];
}

interface AiCapitalResponse {
  forecast?: unknown;
  analysis?: unknown;
  summary?: unknown;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_90D = 90 * DAY_MS;
const HORIZON_30D = 30 * DAY_MS;

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

const VALID_TREND: readonly EfficiencyTrend[] = [
  'IMPROVING',
  'STABLE',
  'DECLINING',
];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_PRIORITY: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'];

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

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / DAY_MS));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// --- Capital efficiency metrics -----------------------------------------

interface SoldTradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  status: string;
}

interface HeldTradeRow {
  buyPrice: number;
  buyDate: Date | null;
}

interface CapitalMetrics {
  totalInvested: number; // sum buyPrice + buyFees (SOLD in last 90d)
  totalProfit: number; // sum profit (SOLD in last 90d)
  totalCycleDays: number; // sum days buy→sell
  soldCount: number;
  avgCapitalUtilization: number; // 0-100
  avgROIperEuroDeployed: number; // %
  avgCapitalCycleTime: number; // days
  idleCapitalRate: number; // 0-100
  heldCapital: number; // EUR
  availableCapital: number; // EUR (net proceeds last 30d)
}

function computeCapitalMetrics(
  soldTrades: SoldTradeRow[],
  heldTrades: HeldTradeRow[],
  now: number,
): CapitalMetrics {
  // SOLD trades in last 90 days — capital efficiency baseline
  const cutoff90 = now - HORIZON_90D;
  const cutoff30 = now - HORIZON_30D;
  let totalInvested = 0;
  let totalProfit = 0;
  let totalCycleDays = 0;
  let soldCount = 0;
  let recentNetProceeds = 0;

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0 || sellMs < cutoff90) continue;
    const buyMs = toMs(t.buyDate);
    const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
    const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = proceeds - invested;
    totalInvested += invested;
    totalProfit += profit;
    soldCount += 1;
    if (buyMs > 0) totalCycleDays += daysBetween(buyMs, sellMs);
    // Available capital = net proceeds from last 30 days
    if (sellMs >= cutoff30) {
      recentNetProceeds += Math.max(0, proceeds);
    }
  }

  const heldCapital = heldTrades.reduce(
    (s, t) => s + (t.buyPrice ?? 0),
    0,
  );

  // avgCapitalUtilization = invested / (invested + held) × 100
  // High = capital actively deployed, Low = idle capital sitting in held
  const denomUtil = totalInvested + heldCapital;
  const avgCapitalUtilization =
    denomUtil > 0
      ? round1((totalInvested / denomUtil) * 100)
      : 0;

  // avgROIperEuroDeployed = totalProfit / totalInvested × 100
  const avgROIperEuroDeployed =
    totalInvested > 0 ? round1((totalProfit / totalInvested) * 100) : 0;

  // avgCapitalCycleTime = avg days from buy to sell (capital locked)
  const avgCapitalCycleTime =
    soldCount > 0 ? round1(totalCycleDays / soldCount) : 0;

  // idleCapitalRate = % of time capital sits idle (not deployed)
  // Heuristic: heldCapital / (heldCapital + totalInvested) × 100
  // High heldCapital relative to invested = idle capital
  const idleCapitalRate =
    denomUtil > 0 ? round1((heldCapital / denomUtil) * 100) : 0;

  const availableCapital = round0(recentNetProceeds);

  return {
    totalInvested: round0(totalInvested),
    totalProfit: round0(totalProfit),
    totalCycleDays,
    soldCount,
    avgCapitalUtilization,
    avgROIperEuroDeployed,
    avgCapitalCycleTime,
    idleCapitalRate,
    heldCapital: round0(heldCapital),
    availableCapital,
  };
}

// --- Deterministic forecast ---------------------------------------------

interface DeterministicForecast {
  forecast: CapitalForecast;
  analysis: EfficiencyAnalysis;
  summary: string;
}

function trendFromSlope(
  slope: number,
  threshold: number,
): EfficiencyTrend {
  if (slope > threshold) return 'IMPROVING';
  if (slope < -threshold) return 'DECLINING';
  return 'STABLE';
}

// Compute efficiency score 0-100 from utilization + ROI + cycle time
function efficiencyScoreFromMetrics(m: CapitalMetrics): number {
  // Weighted: utilization 35% + ROI (capped 100) 35% + cycle time 30%
  // Cycle time: shorter = better. 0 days = 100, 90+ days = 0.
  const utilizationScore = Math.max(0, Math.min(100, m.avgCapitalUtilization));
  const roiScore = Math.max(0, Math.min(100, m.avgROIperEuroDeployed));
  const cycleScore =
    m.avgCapitalCycleTime > 0
      ? Math.max(0, Math.min(100, 100 - (m.avgCapitalCycleTime / 90) * 100))
      : 50;
  const score =
    utilizationScore * 0.35 + roiScore * 0.35 + cycleScore * 0.3;
  return round0(Math.max(0, Math.min(100, score)));
}

function buildDeterministicForecast(
  m: CapitalMetrics,
  recentMonthlySlopes: { utilization: number; roi: number },
): DeterministicForecast {
  // Project utilization: current ± slope × 1/2/3 months
  // Slope is % change per month (heuristic from recent history)
  const utilSlope = recentMonthlySlopes.utilization; // %/month
  const roiSlope = recentMonthlySlopes.roi; // %/month

  // Projected utilization at 30/60/90 days
  const projectedUtilization30d = clampNumber(
    m.avgCapitalUtilization + utilSlope * 1,
    0,
    100,
    m.avgCapitalUtilization,
  );
  const projectedUtilization60d = clampNumber(
    m.avgCapitalUtilization + utilSlope * 2,
    0,
    100,
    m.avgCapitalUtilization,
  );
  const projectedUtilization90d = clampNumber(
    m.avgCapitalUtilization + utilSlope * 3,
    0,
    100,
    m.avgCapitalUtilization,
  );

  // Projected ROI per euro
  const projectedROIperEuro30d = clampNumber(
    m.avgROIperEuroDeployed + roiSlope * 1,
    -50,
    200,
    m.avgROIperEuroDeployed,
  );
  const projectedROIperEuro60d = clampNumber(
    m.avgROIperEuroDeployed + roiSlope * 2,
    -50,
    200,
    m.avgROIperEuroDeployed,
  );
  const projectedROIperEuro90d = clampNumber(
    m.avgROIperEuroDeployed + roiSlope * 3,
    -50,
    200,
    m.avgROIperEuroDeployed,
  );

  // Projected idle capital = heldCapital × (1 - projectedUtilization90d/100)
  // i.e., as utilization drops, more capital sits idle
  const projectedIdleCapital = round0(
    m.heldCapital * (1 - projectedUtilization90d / 100),
  );

  // Trend: from slope of utilization
  const capitalEfficiencyTrend = trendFromSlope(utilSlope, 2);

  // Projected efficiency score 0-100
  const cycleScore90d =
    m.avgCapitalCycleTime > 0
      ? Math.max(
          0,
          Math.min(100, 100 - (m.avgCapitalCycleTime / 90) * 100),
        )
      : 50;
  const projectedEfficiencyScore = round0(
    Math.max(
      0,
      Math.min(
        100,
        projectedUtilization90d * 0.35 +
          Math.max(0, Math.min(100, projectedROIperEuro90d)) * 0.35 +
          cycleScore90d * 0.3,
      ),
    ),
  );

  // Drivers
  const efficiencyDrivers: EfficiencyDriver[] = [];
  if (m.avgCapitalUtilization >= 70) {
    efficiencyDrivers.push({
      driver: 'Visoka capital utilization',
      impact: 'POSITIVE',
      weight: 80,
      detail: `${m.avgCapitalUtilization}% kapitala je aktivno deployed — minimalen idle capital.`,
    });
  } else if (m.avgCapitalUtilization < 40) {
    efficiencyDrivers.push({
      driver: 'Nizka capital utilization',
      impact: 'NEGATIVE',
      weight: 75,
      detail: `Samo ${m.avgCapitalUtilization}% kapitala aktivno deployed — ${m.idleCapitalRate}% sedi v HELD inventarju.`,
    });
  }
  if (m.avgROIperEuroDeployed >= 30) {
    efficiencyDrivers.push({
      driver: 'Visok ROI per euro deployed',
      impact: 'POSITIVE',
      weight: 70,
      detail: `${m.avgROIperEuroDeployed}% ROI — vsak deployed euro generira ${round2(m.avgROIperEuroDeployed / 100)}€ profita.`,
    });
  } else if (m.avgROIperEuroDeployed < 10) {
    efficiencyDrivers.push({
      driver: 'Nizek ROI per euro deployed',
      impact: 'NEGATIVE',
      weight: 65,
      detail: `${m.avgROIperEuroDeployed}% ROI — kapital se nevrača učinkovito.`,
    });
  }
  if (m.avgCapitalCycleTime > 0 && m.avgCapitalCycleTime <= 21) {
    efficiencyDrivers.push({
      driver: 'Hiter capital cycle time',
      impact: 'POSITIVE',
      weight: 60,
      detail: `Povprečno ${m.avgCapitalCycleTime} dni od buy→sell — kapital hitro vrača v obtok.`,
    });
  } else if (m.avgCapitalCycleTime > 45) {
    efficiencyDrivers.push({
      driver: 'Počasen capital cycle time',
      impact: 'NEGATIVE',
      weight: 70,
      detail: `Povprečno ${m.avgCapitalCycleTime} dni — kapital je predolgo zaklenjen.`,
    });
  }
  if (m.heldCapital === 0) {
    efficiencyDrivers.push({
      driver: 'Brez HELD inventarja',
      impact: 'POSITIVE',
      weight: 50,
      detail: 'Ves kapital je sproščen — visoka likvidnost.',
    });
  } else if (m.heldCapital > m.totalInvested) {
    efficiencyDrivers.push({
      driver: 'Preveč kapitala v HELD inventarju',
      impact: 'NEGATIVE',
      weight: 75,
      detail: `${m.heldCapital}€ zaklenjenih v HELD — več kot ${m.totalInvested}€ aktivno deployed.`,
    });
  }
  if (efficiencyDrivers.length === 0) {
    efficiencyDrivers.push({
      driver: 'Stabilna capital efficiency',
      impact: 'POSITIVE',
      weight: 50,
      detail: 'Brez izrazitih pozitivnih ali negativnih dejavnikov.',
    });
  }

  // Bottlenecks
  const capitalBottlenecks: CapitalBottleneck[] = [];
  if (m.heldCapital > 0 && m.idleCapitalRate > 30) {
    capitalBottlenecks.push({
      bottleneck: 'Idle capital v HELD inventarju',
      impact: `${round0(m.heldCapital * (m.idleCapitalRate / 100))}€ neučinkovito vezanega kapitala`,
      mitigation: 'Identificiraj HELD item-e starejše od 30 dni in jih aktivno likvidiraj ali reprice.',
    });
  }
  if (m.avgCapitalCycleTime > 45) {
    capitalBottlenecks.push({
      bottleneck: 'Dolg capital cycle time',
      impact: `${m.avgCapitalCycleTime} dni povprečno — zmanjša throughput`,
      mitigation: 'Optimiraj pricing strategijo za hitrejšo prodajo (lower ask price, bundle deals).',
    });
  }
  if (m.avgROIperEuroDeployed < 10 && m.totalInvested > 0) {
    capitalBottlenecks.push({
      bottleneck: 'Nizek ROI per euro deployed',
      impact: `${m.avgROIperEuroDeployed}% ROI — suboptimal deploy`,
      mitigation: 'Premakni kapital v višje-margin kategorije (glej deal-source-intelligence za prioritete).',
    });
  }
  if (m.avgCapitalUtilization < 50 && m.heldCapital > 0) {
    capitalBottlenecks.push({
      bottleneck: 'Nizka capital utilization',
      impact: `${m.avgCapitalUtilization}% — večina kapitala ne dela`,
      mitigation: 'Razmisli o hitri re-deployment strategiji (reinvest proceeds v nove deals).',
    });
  }
  if (capitalBottlenecks.length === 0) {
    capitalBottlenecks.push({
      bottleneck: 'Brez zaznanih bottlenecks',
      impact: 'Capital efficiency je v dobri formi',
      mitigation: 'Vzdržuj trenutno strategijo in monitor trende.',
    });
  }

  // Optimization actions
  const optimizationActions: OptimizationAction[] = [];
  if (m.idleCapitalRate > 30) {
    optimizationActions.push({
      action: 'Likvidiraj stale HELD item-e (>30 dni) za sprostitev kapitala',
      priority: 'HIGH',
      expectedEfficiencyGain: `+${Math.min(20, Math.round(m.idleCapitalRate / 3))}% utilization`,
    });
  }
  if (m.avgCapitalCycleTime > 45) {
    optimizationActions.push({
      action: 'Optimiraj pricing za hitrejšo prodajo (-5-10% na starejše iteme)',
      priority: m.avgCapitalCycleTime > 60 ? 'HIGH' : 'MEDIUM',
      expectedEfficiencyGain: `-${Math.round(m.avgCapitalCycleTime / 6)} dni cycle time`,
    });
  }
  if (m.avgROIperEuroDeployed < 15 && m.totalInvested > 0) {
    optimizationActions.push({
      action: 'Premakni kapital v višje-margin kategorije',
      priority: 'MEDIUM',
      expectedEfficiencyGain: `+${Math.round((20 - m.avgROIperEuroDeployed) / 2)}% ROI per euro`,
    });
  }
  if (m.heldCapital === 0 && m.availableCapital > 0) {
    optimizationActions.push({
      action: `Reinvestiraj ${m.availableCapital}€ razpoložljivega kapitala v nove deals`,
      priority: 'HIGH',
      expectedEfficiencyGain: `+${Math.min(30, Math.round(m.availableCapital / 100))}% utilization`,
    });
  }
  if (m.avgCapitalUtilization >= 80 && m.avgROIperEuroDeployed >= 25) {
    optimizationActions.push({
      action: 'Vzdržuj trenutno capital allocation strategijo — visoka efficiency',
      priority: 'LOW',
      expectedEfficiencyGain: 'Ohrani >80% utilization + >25% ROI',
    });
  }
  if (optimizationActions.length === 0) {
    optimizationActions.push({
      action: 'Monitor capital efficiency čez naslednje 30 dni za trend potrditev',
      priority: 'LOW',
      expectedEfficiencyGain: 'Boljši forecast confidence',
    });
  }

  const forecast: CapitalForecast = {
    projectedUtilization30d: round1(projectedUtilization30d),
    projectedUtilization60d: round1(projectedUtilization60d),
    projectedUtilization90d: round1(projectedUtilization90d),
    projectedROIperEuro30d: round1(projectedROIperEuro30d),
    projectedROIperEuro60d: round1(projectedROIperEuro60d),
    projectedROIperEuro90d: round1(projectedROIperEuro90d),
    projectedIdleCapital,
    capitalEfficiencyTrend,
    projectedEfficiencyScore,
  };

  const analysis: EfficiencyAnalysis = {
    efficiencyDrivers: efficiencyDrivers.slice(0, 5),
    capitalBottlenecks: capitalBottlenecks.slice(0, 4),
    optimizationActions: optimizationActions.slice(0, 5),
  };

  const summary =
    m.soldCount === 0
      ? 'Ni SOLD zgodovine v zadnjih 90 dneh — capital efficiency forecast temelji na current HELD stanju.'
      : `Capital efficiency: ${m.avgCapitalUtilization}% utilization, projected ${forecast.projectedUtilization90d}% v 90d (${capitalEfficiencyTrend.toLowerCase()}). ROI/euro: ${m.avgROIperEuroDeployed}% → ${forecast.projectedROIperEuro90d}%. Bottleneck: ${capitalBottlenecks[0]?.bottleneck ?? 'brez'}. Score: ${projectedEfficiencyScore}/100.`;

  return { forecast, analysis, summary };
}

// Compute recent monthly slopes (utilization + ROI) from sold trades grouped by month
function computeMonthlySlopes(
  soldTrades: SoldTradeRow[],
  heldCapital: number,
  now: number,
): { utilization: number; roi: number } {
  // Group sold trades by month for last 6 months (with buyDate)
  const cutoff180 = now - 180 * DAY_MS;
  interface MonthAgg {
    invested: number;
    profit: number;
  }
  const monthMap = new Map<string, MonthAgg>();
  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0 || sellMs < cutoff180) continue;
    const d = new Date(sellMs);
    const key = `${d.getFullYear()}-${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const invested = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
    const proceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = proceeds - invested;
    let m = monthMap.get(key);
    if (!m) {
      m = { invested: 0, profit: 0 };
      monthMap.set(key, m);
    }
    m.invested += invested;
    m.profit += profit;
  }
  const sortedMonths = Array.from(monthMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  if (sortedMonths.length < 2) {
    return { utilization: 0, roi: 0 };
  }
  // Per month utilization = invested / (invested + heldCapital)
  const utilSeries = sortedMonths.map(([, m]) =>
    m.invested + heldCapital > 0
      ? (m.invested / (m.invested + heldCapital)) * 100
      : 0,
  );
  const roiSeries = sortedMonths.map(([, m]) =>
    m.invested > 0 ? (m.profit / m.invested) * 100 : 0,
  );

  // Linear regression slope per month
  const n = utilSeries.length;
  const xMean = (n - 1) / 2;
  const utilYMean = avg(utilSeries);
  const roiYMean = avg(roiSeries);
  let utilNum = 0;
  let utilDen = 0;
  let roiNum = 0;
  let roiDen = 0;
  for (let i = 0; i < n; i++) {
    utilNum += (i - xMean) * (utilSeries[i]! - utilYMean);
    utilDen += Math.pow(i - xMean, 2);
    roiNum += (i - xMean) * (roiSeries[i]! - roiYMean);
    roiDen += Math.pow(i - xMean, 2);
  }
  const utilSlope = utilDen === 0 ? 0 : utilNum / utilDen;
  const roiSlope = roiDen === 0 ? 0 : roiNum / roiDen;
  return {
    utilization: round2(utilSlope),
    roi: round2(roiSlope),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleCapitalEfficiencyForecaster(req);
}
export async function POST(req: NextRequest) {
  return handleCapitalEfficiencyForecaster(req);
}

async function handleCapitalEfficiencyForecaster(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-capital-efficiency-forecaster', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query SOLD trades from last 90 days for capital efficiency baseline
    const cutoff90 = new Date(now - HORIZON_90D);
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff90 },
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        status: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    // 2) Query HELD trades for current capital state
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        buyPrice: true,
        buyDate: true,
      },
      take: 100000,
    });

    const metrics = computeCapitalMetrics(
      soldTrades as SoldTradeRow[],
      heldTrades as HeldTradeRow[],
      now,
    );

    const current: CapitalCurrent = {
      avgCapitalUtilization: metrics.avgCapitalUtilization,
      avgROIperEuroDeployed: metrics.avgROIperEuroDeployed,
      avgCapitalCycleTime: metrics.avgCapitalCycleTime,
      idleCapitalRate: metrics.idleCapitalRate,
      heldCapital: metrics.heldCapital,
      availableCapital: metrics.availableCapital,
    };

    // Compute monthly slopes for forecast
    const monthlySlopes = computeMonthlySlopes(
      soldTrades as SoldTradeRow[],
      metrics.heldCapital,
      now,
    );

    // Deterministic forecast (fallback)
    const det = buildDeterministicForecast(metrics, monthlySlopes);
    let forecast = det.forecast;
    let analysis = det.analysis;
    let finalSummary = det.summary;

    // Empty state: no SOLD history AND no HELD trades → no capital at all
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current,
        forecast,
        analysis,
        summary:
          'Ni SOLD zgodovine in HELD inventarja — Capital Efficiency Forecaster ni mogoč.',
        aiUsed: false,
        message:
          'Ni SOLD zgodovine in HELD inventarja — Capital Efficiency Forecaster ni mogoč.',
      });
    }

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonthKey = monthKeyOf(new Date(now));
    const cacheKey = `capital-efficiency-forecaster:${currentMonthKey}`;
    const cached = getCachedAI<{
      forecast: CapitalForecast;
      analysis: EfficiencyAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        forecast: cached.forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
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

    const promptData = {
      current: {
        avgCapitalUtilization: metrics.avgCapitalUtilization,
        avgROIperEuroDeployed: metrics.avgROIperEuroDeployed,
        avgCapitalCycleTime: metrics.avgCapitalCycleTime,
        idleCapitalRate: metrics.idleCapitalRate,
        heldCapital: metrics.heldCapital,
        availableCapital: metrics.availableCapital,
        totalInvested: metrics.totalInvested,
        totalProfit: metrics.totalProfit,
        soldCount: metrics.soldCount,
      },
      monthlySlopes: {
        utilizationSlope: monthlySlopes.utilization,
        roiSlope: monthlySlopes.roi,
      },
      deterministicForecast: det.forecast,
      deterministicDrivers: det.analysis.efficiencyDrivers,
    };

    const prompt = `Si AI "Capital Efficiency Forecaster" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Napoveš kako učinkovito bo kapital uporabljen v naslednjih 30/60/90 dneh — projected utilization rate, idle capital in ROI per euro deployed.

CURRENT CAPITAL METRICS (deterministično izračunano):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast: {
   - projectedUtilization30d/60d/90d: 0-100 (lahko prilagodiš znotraj [-15, +15] od deterministične vrednosti — anti-hallucination)
   - projectedROIperEuro30d/60d/90d: -50 do 200 (lahko prilagodiš znotraj [-20, +20] od deterministične vrednosti)
   - projectedIdleCapital: EUR (0-100000, realno na podlagi heldCapital × (1 - utilization90d/100))
   - capitalEfficiencyTrend: IMPROVING | STABLE | DECLINING (iz slopov utilization)
   - projectedEfficiencyScore: 0-100 (lahko prilagodiš znotraj [-10, +10] od deterministične vrednosti)
}
2. analysis: {
   - efficiencyDrivers: 3-5 drivers z { driver (max 80), impact: POSITIVE|NEGATIVE, weight: 0-100, detail (max 200) }
   - capitalBottlenecks: 2-4 bottlenecks z { bottleneck (max 100), impact (max 150), mitigation (max 250) }
   - optimizationActions: 3-5 actions z { action (max 200), priority: HIGH|MEDIUM|LOW, expectedEfficiencyGain (max 100) }
}
3. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "forecast": {
    "projectedUtilization30d": 68,
    "projectedUtilization60d": 65,
    "projectedUtilization90d": 62,
    "projectedROIperEuro30d": 28,
    "projectedROIperEuro60d": 26,
    "projectedROIperEuro90d": 24,
    "projectedIdleCapital": 1200,
    "capitalEfficiencyTrend": "DECLINING",
    "projectedEfficiencyScore": 62
  },
  "analysis": {
    "efficiencyDrivers": [
      { "driver": "Nizka capital utilization", "impact": "NEGATIVE", "weight": 75, "detail": "Samo 55% kapitala aktivno deployed — 45% sedi v HELD inventarju." }
    ],
    "capitalBottlenecks": [
      { "bottleneck": "Idle capital v HELD inventarju", "impact": "1200€ neučinkovito vezanega kapitala", "mitigation": "Identificiraj HELD item-e starejše od 30 dni in jih aktivno likvidiraj ali reprice." }
    ],
    "optimizationActions": [
      { "action": "Likvidiraj stale HELD item-e (>30 dni) za sprostitev kapitala", "priority": "HIGH", "expectedEfficiencyGain": "+15% utilization" }
    ]
  },
  "summary": "Capital efficiency: 55% utilization, projected 62% v 90d (declining). ROI/euro: 25% → 24%. Bottleneck: Idle capital v HELD inventarju. Score: 62/100."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(
        raw,
      ) as AiCapitalResponse | null;

      if (parsed && typeof parsed === 'object') {
        // AI forecast override (with anti-hallucination clamping)
        if (parsed.forecast && typeof parsed.forecast === 'object') {
          const f = parsed.forecast as Record<string, unknown>;

          // Utilization: clamp ±15 from deterministic
          const detUtil30 = forecast.projectedUtilization30d;
          const detUtil60 = forecast.projectedUtilization60d;
          const detUtil90 = forecast.projectedUtilization90d;

          const adjUtil30 = clampNumber(f.projectedUtilization30d, 0, 100, detUtil30);
          const adjUtil60 = clampNumber(f.projectedUtilization60d, 0, 100, detUtil60);
          const adjUtil90 = clampNumber(f.projectedUtilization90d, 0, 100, detUtil90);

          forecast.projectedUtilization30d = round1(
            Math.max(0, Math.min(100, detUtil30 + Math.max(-15, Math.min(15, adjUtil30 - detUtil30)))),
          );
          forecast.projectedUtilization60d = round1(
            Math.max(0, Math.min(100, detUtil60 + Math.max(-15, Math.min(15, adjUtil60 - detUtil60)))),
          );
          forecast.projectedUtilization90d = round1(
            Math.max(0, Math.min(100, detUtil90 + Math.max(-15, Math.min(15, adjUtil90 - detUtil90)))),
          );

          // ROI per euro: clamp ±20 from deterministic
          const detROI30 = forecast.projectedROIperEuro30d;
          const detROI60 = forecast.projectedROIperEuro60d;
          const detROI90 = forecast.projectedROIperEuro90d;

          const adjROI30 = clampNumber(f.projectedROIperEuro30d, -50, 200, detROI30);
          const adjROI60 = clampNumber(f.projectedROIperEuro60d, -50, 200, detROI60);
          const adjROI90 = clampNumber(f.projectedROIperEuro90d, -50, 200, detROI90);

          forecast.projectedROIperEuro30d = round1(
            Math.max(-50, Math.min(200, detROI30 + Math.max(-20, Math.min(20, adjROI30 - detROI30)))),
          );
          forecast.projectedROIperEuro60d = round1(
            Math.max(-50, Math.min(200, detROI60 + Math.max(-20, Math.min(20, adjROI60 - detROI60)))),
          );
          forecast.projectedROIperEuro90d = round1(
            Math.max(-50, Math.min(200, detROI90 + Math.max(-20, Math.min(20, adjROI90 - detROI90)))),
          );

          // Projected idle capital: clamp to [0, heldCapital]
          forecast.projectedIdleCapital = clampNumber(
            f.projectedIdleCapital,
            0,
            Math.max(0, metrics.heldCapital),
            forecast.projectedIdleCapital,
          );

          forecast.capitalEfficiencyTrend = clampEnum(
            f.capitalEfficiencyTrend,
            VALID_TREND,
            forecast.capitalEfficiencyTrend,
          );

          // Projected efficiency score: clamp ±10 from deterministic
          const detScore = forecast.projectedEfficiencyScore;
          const aiScore = clampNumber(
            f.projectedEfficiencyScore,
            0,
            100,
            detScore,
          );
          forecast.projectedEfficiencyScore = round0(
            Math.max(0, Math.min(100, detScore + Math.max(-10, Math.min(10, aiScore - detScore)))),
          );
        }

        // Analysis override (with anti-hallucination)
        if (parsed.analysis && typeof parsed.analysis === 'object') {
          const a = parsed.analysis as Record<string, unknown>;

          if (Array.isArray(a.efficiencyDrivers)) {
            const aiDrivers = (a.efficiencyDrivers as unknown[])
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
              .filter((d): d is EfficiencyDriver => d !== null)
              .slice(0, 5);
            if (aiDrivers.length > 0) analysis.efficiencyDrivers = aiDrivers;
          }

          if (Array.isArray(a.capitalBottlenecks)) {
            const aiBottlenecks = (a.capitalBottlenecks as unknown[])
              .map((b: unknown) => {
                const bo = b as Record<string, unknown>;
                if (!bo || typeof bo !== 'object') return null;
                const bottleneck = clampString(bo.bottleneck, 100, '');
                if (!bottleneck) return null;
                const impact = clampString(bo.impact, 150, '');
                const mitigation = clampString(bo.mitigation, 250, '');
                if (!impact || !mitigation) return null;
                return { bottleneck, impact, mitigation };
              })
              .filter((b): b is CapitalBottleneck => b !== null)
              .slice(0, 4);
            if (aiBottlenecks.length > 0) analysis.capitalBottlenecks = aiBottlenecks;
          }

          if (Array.isArray(a.optimizationActions)) {
            const aiActions = (a.optimizationActions as unknown[])
              .map((o: unknown) => {
                const ac = o as Record<string, unknown>;
                if (!ac || typeof ac !== 'object') return null;
                const action = clampString(ac.action, 200, '');
                if (!action) return null;
                const priority = clampEnum(ac.priority, VALID_PRIORITY, 'MEDIUM');
                const expectedEfficiencyGain = clampString(
                  ac.expectedEfficiencyGain,
                  100,
                  '',
                );
                if (!expectedEfficiencyGain) return null;
                return { action, priority, expectedEfficiencyGain };
              })
              .filter((o): o is OptimizationAction => o !== null)
              .slice(0, 5);
            if (aiActions.length > 0) analysis.optimizationActions = aiActions;
          }
        }

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          finalSummary = clampString(parsed.summary, 400, det.summary);
        }

        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/capital-efficiency-forecaster',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
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
      forecast,
      analysis,
      summary: finalSummary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/capital-efficiency-forecaster',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
