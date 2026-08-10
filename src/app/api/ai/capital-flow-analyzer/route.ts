// v7.92: AI Capital Flow Analyzer — AI analizira kako kapital FLOW-a skozi
// business — tracks inflow (sales), outflow (purchases), in net flow patterns.
// Identificira capital flow bottlenecks in optimizira cash flow timing.
// "Capital flow: POSITIVE (+350€/mo, ratio 1.4). Bottleneck: 3 items >60d.
// Reserve: 700€. Efficiency: 72%."
//
// Razlika od cash-flow-velocity (v7.74 ki meri hitrost cash flow-a) — ta
// gleda FLOW PATTERN in direction (POSITIVE/NEGATIVE/BALANCED) z
// bottlenecks in cash reserve recommendation. Razlika od cash-flow-forecast
// (ki forecast-a cash position) — ta analizira flow pattern + bottlenecks.
// Razlika od cash-conversion-cycle (v7.74 ki meri CCC) — ta gleda net flow
// direction in capital efficiency. Razlika od capital-allocation-optimizer
// (v7.63 ki optimizira allocacijo) — ta analizira flow health in reserve.
// Razlika od capital-deployment-planner (v7.76 ki planira deployment) — ta
// gleda flow bottlenecks in cash runway. Razlika od capital-efficiency-
// forecaster (v7.84 ki forecast-a efficiency) — ta analizira flow pattern
// direction in reserve sizing.
//
// GET+POST /api/ai/capital-flow-analyzer
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

type FlowDirection = 'POSITIVE' | 'NEGATIVE' | 'BALANCED';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface FlowMetrics {
  avgMonthlyInflow: number;
  avgMonthlyOutflow: number;
  avgNetFlow: number;
  flowRatio: number;
  flowConsistency: number; // 0-100
  flowVolatility: number; // stddev of net flow
  flowTrend: number; // linear regression slope
  flowDirection: FlowDirection;
}

interface MonthlyFlow {
  month: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  flowRatio: number;
  accumulatedCapital: number;
}

interface Bottleneck {
  bottleneck: string;
  impact: string;
  severity: Severity;
  solution: string;
}

interface FlowOptimizationAction {
  action: string;
  priority: ActionPriority;
  expectedFlowImprovement: string;
}

interface FlowRiskAssessment {
  riskLevel: RiskLevel;
  riskFactors: string[];
  daysOfCashRunway: number;
}

interface FlowAnalysis {
  flowAssessment: string;
  bottlenecks: Bottleneck[];
  flowOptimizationActions: FlowOptimizationAction[];
  projectedFlow30d: number;
  capitalEfficiency: number; // 0-100
  flowRiskAssessment: FlowRiskAssessment;
  recommendedCashReserve: number;
}

interface AiFlowResponse {
  flowAssessment?: string;
  bottlenecks?: Array<{
    bottleneck?: string;
    impact?: string;
    severity?: Severity;
    solution?: string;
  }>;
  flowOptimizationActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    expectedFlowImprovement?: string;
  }>;
  projectedFlow30d?: number;
  capitalEfficiency?: number;
  flowRiskAssessment?: {
    riskLevel?: RiskLevel;
    riskFactors?: string[];
    daysOfCashRunway?: number;
  };
  recommendedCashReserve?: number;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const PROJ_FLOW_MIN = -10000;
const PROJ_FLOW_MAX = 10000;
const EFFICIENCY_MIN = 0;
const EFFICIENCY_MAX = 100;
const RUNWAY_MIN = 0;
const RUNWAY_MAX = 365;

const VALID_SEVERITY: readonly Severity[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_RISK_LEVEL: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

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

function round0(v: number): number {
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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = avg(values);
  const variance = values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Linear regression slope per index
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

// --- Deterministic flow metrics ------------------------------------------

function monthStartMs(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function monthLabel(t: number): string {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function classifyDirection(
  avgNet: number,
  avgInflow: number,
  avgOutflow: number,
): FlowDirection {
  if (avgInflow <= 0 && avgOutflow <= 0) return 'BALANCED';
  const ratio = avgOutflow > 0 ? avgInflow / avgOutflow : (avgInflow > 0 ? 2 : 0);
  if (ratio >= 1.15) return 'POSITIVE';
  if (ratio <= 0.85) return 'NEGATIVE';
  return 'BALANCED';
}

function computeFlowMetrics(monthly: MonthlyFlow[]): FlowMetrics {
  const activeMonths = monthly.filter((m) => m.inflow > 0 || m.outflow > 0);
  if (activeMonths.length === 0) {
    return {
      avgMonthlyInflow: 0,
      avgMonthlyOutflow: 0,
      avgNetFlow: 0,
      flowRatio: 0,
      flowConsistency: 0,
      flowVolatility: 0,
      flowTrend: 0,
      flowDirection: 'BALANCED',
    };
  }

  const inflows = activeMonths.map((m) => m.inflow);
  const outflows = activeMonths.map((m) => m.outflow);
  const netFlows = activeMonths.map((m) => m.netFlow);

  const avgInflow = avg(inflows);
  const avgOutflow = avg(outflows);
  const avgNet = avg(netFlows);

  // Flow ratio: avg inflow / avg outflow (or 2 if no outflow but has inflow)
  const ratio = avgOutflow > 0 ? avgInflow / avgOutflow : (avgInflow > 0 ? 2 : 0);

  // Flow consistency: how consistent monthly flows are (lower CV = higher consistency)
  const cv = avgNet !== 0 ? stddev(netFlows) / Math.abs(avgNet) : (stddev(netFlows) > 0 ? 1 : 0);
  const consistency = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, 100 - cv * 50)),
  );

  const vol = stddev(netFlows);
  const trend = trendSlope(netFlows);

  return {
    avgMonthlyInflow: round0(avgInflow),
    avgMonthlyOutflow: round0(avgOutflow),
    avgNetFlow: round0(avgNet),
    flowRatio: Math.round(ratio * 100) / 100,
    flowConsistency: consistency,
    flowVolatility: round0(vol),
    flowTrend: round0(trend),
    flowDirection: classifyDirection(avgNet, avgInflow, avgOutflow),
  };
}

// --- Trade row -----------------------------------------------------------

interface TradeRow {
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  status: string;
  listing: {
    monitor: { source: string | null } | null;
  } | null;
}

// --- Deterministic analysis ----------------------------------------------

function buildDeterministicFlowAnalysis(
  metrics: FlowMetrics,
  monthly: MonthlyFlow[],
  heldItemsCount: number,
  heldItemsLongCount: number,
  avgHeldDaysOfSold: number,
): FlowAnalysis {
  const dir = metrics.flowDirection;
  const verb = dir === 'POSITIVE' ? 'pozitiven' : dir === 'NEGATIVE' ? 'negativen' : 'uravnotežen';
  const assessment =
    `Capital flow ${verb} — povprečni neto tok ${metrics.avgNetFlow}€/mesc ` +
    `(inflow ${metrics.avgMonthlyInflow}€, outflow ${metrics.avgMonthlyOutflow}€, ` +
    `ratio ${metrics.flowRatio}). Konsistenca ${metrics.flowConsistency}/100, ` +
    `volatilnost ${metrics.flowVolatility}€, trend ${metrics.flowTrend}€/mesc. ` +
    `${heldItemsCount} držanih artiklov (${heldItemsLongCount} > 60 dni).`.slice(0, 500);

  // Bottlenecks
  const bottlenecks: Bottleneck[] = [];
  if (heldItemsLongCount > 0) {
    bottlenecks.push({
      bottleneck: `${heldItemsLongCount} artiklov držanih več kot 60 dni — kapital ujet v neprometnem inventarju.`,
      impact: `Zmanjša razpoložljivi kapital za ~${round0(heldItemsLongCount * 100)}€ povprečno.`,
      severity: heldItemsLongCount >= 5 ? 'HIGH' : 'MEDIUM',
      solution: 'Aktivno znižaj cene ali ustvari bundle za >60d artikle da sprostiš kapital.',
    });
  }
  if (dir === 'NEGATIVE') {
    bottlenecks.push({
      bottleneck: 'Mesečni neto tok je negativen — outflow presega inflow.',
      impact: `Posledično izguba ~${Math.abs(metrics.avgNetFlow)}€/mesc.`,
      severity: Math.abs(metrics.avgNetFlow) > 500 ? 'HIGH' : 'MEDIUM',
      solution: 'Zmanjšaj nabavno frekvenco ali povečaj sell-through rate (hitrejša prodaja).',
    });
  }
  if (metrics.flowConsistency < 50) {
    bottlenecks.push({
      bottleneck: 'Nizka konsistenca mesečnih tokov — nepredvidljiv cash flow.',
      impact: `Volatilnost ${metrics.flowVolatility}€ otežuje načrtovanje.`,
      severity: metrics.flowVolatility > 500 ? 'MEDIUM' : 'LOW',
      solution: 'Diversificiraj vire prihodka in vzpostavi konsistentno sell kadenco.',
    });
  }
  if (heldItemsCount > 0 && avgHeldDaysOfSold > 45) {
    bottlenecks.push({
      bottleneck: `Povprečni hold time ${round0(avgHeldDaysOfSold)} dni — kapital počasi krovi.`,
      impact: 'Nižja capital efficiency z visokim held inventory.',
      severity: avgHeldDaysOfSold > 60 ? 'HIGH' : 'MEDIUM',
      solution: 'Fokusiraj se na hitreje obratujoče kategorije dokler se hold time ne zmanjša.',
    });
  }
  if (bottlenecks.length === 0) {
    bottlenecks.push({
      bottleneck: 'Ni specifičnih bottleneckov — flow je zdrav in konsistenten.',
      impact: 'Capital ciklira učinkovito brez zastajanja.',
      severity: 'LOW',
      solution: 'Vzdržuj trenutno strategijo in redno preverjaj flow signale.',
    });
  }

  // Optimization actions
  const actions: FlowOptimizationAction[] = [];
  if (heldItemsLongCount > 0) {
    actions.push({
      action: `Likvidiraj ${heldItemsLongCount} artiklov > 60 dni (price drop 10-15%).`,
      priority: 'HIGH',
      expectedFlowImprovement: `Sprosti ~${round0(heldItemsLongCount * 100)}€ kapitala v 14 dneh.`,
    });
  }
  if (dir === 'NEGATIVE' || dir === 'BALANCED') {
    actions.push({
      action: 'Povečaj sell-through rate z bolj agresivno pricing strategijo.',
      priority: 'HIGH',
      expectedFlowImprovement: `Poveča inflow za ~${round0(metrics.avgMonthlyOutflow * 0.2)}€/mesc.`,
    });
  }
  if (metrics.flowConsistency < 60) {
    actions.push({
      action: 'Vzpostavi consistent listing cadence (npr. 5 novih artiklov/teden).',
      priority: 'MEDIUM',
      expectedFlowImprovement: 'Zmanjša flow volatilnost za ~30% v 2 mesecih.',
    });
  }
  if (dir === 'POSITIVE') {
    actions.push({
      action: 'Reinvestiraj surplus v nove nabavke z višjim ROI potencialom.',
      priority: 'MEDIUM',
      expectedFlowImprovement: `Poveča future inflow za ~${round0(metrics.avgNetFlow * 0.5)}€/mesc.`,
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo in spremljaj flow trend.',
      priority: 'LOW',
      expectedFlowImprovement: 'Ohrani trenutno pozitivno flow stanje.',
    });
  }

  // Projected flow 30d — based on last month + trend
  const lastMonth = monthly[monthly.length - 1];
  const lastNet = lastMonth ? lastMonth.netFlow : metrics.avgNetFlow;
  let projected = lastNet + metrics.flowTrend * 0.5; // half month of trend
  projected = round0(Math.max(PROJ_FLOW_MIN, Math.min(PROJ_FLOW_MAX, projected)));

  // Capital efficiency: ratio of avg net flow to avg inflow + consistency bonus
  let efficiency = 0;
  if (metrics.avgMonthlyInflow > 0) {
    const netToInflow = Math.max(0, metrics.avgNetFlow) / metrics.avgMonthlyInflow;
    efficiency = round0(netToInflow * 60 + metrics.flowConsistency * 0.4);
  }
  efficiency = Math.max(EFFICIENCY_MIN, Math.min(EFFICIENCY_MAX, efficiency));

  // Risk assessment
  let riskLevel: RiskLevel = 'LOW';
  const riskFactors: string[] = [];
  let runwayDays = 90; // default safe

  if (dir === 'NEGATIVE') {
    riskLevel = Math.abs(metrics.avgNetFlow) > 500 ? 'HIGH' : 'MEDIUM';
    riskFactors.push('Negativen neto tok zmanjšuje rezerve kapitala.');
  }
  if (metrics.flowConsistency < 40) {
    riskLevel = riskLevel === 'LOW' ? 'MEDIUM' : riskLevel;
    riskFactors.push('Nizka konsistenca flow-a otežuje predvidevanje.');
  }
  if (heldItemsLongCount >= 5) {
    riskLevel = riskLevel === 'LOW' ? 'MEDIUM' : riskLevel;
    riskFactors.push(`${heldItemsLongCount} artiklov > 60 dni — ujet kapital.`);
  }
  // Cash runway: how many days can we survive on net flow if inflow stops?
  // Approximate: assume current avg monthly inflow as monthly "burnable" reserve
  if (metrics.avgMonthlyInflow > 0) {
    // If outflow > inflow → runway shrinks; if positive, runway extends
    const netBurn = metrics.avgMonthlyOutflow - metrics.avgMonthlyInflow;
    if (netBurn > 0) {
      // Burning reserves; assume reserves ~ 2 months of inflow
      const reserves = metrics.avgMonthlyInflow * 2;
      runwayDays = round0(Math.max(0, Math.min(RUNWAY_MAX, (reserves / netBurn) * 30)));
    } else {
      // Positive cash flow → runway is "indefinite" (cap at 365)
      runwayDays = RUNWAY_MAX;
    }
  } else if (metrics.avgMonthlyOutflow > 0) {
    // No inflow, only outflow → runway 0
    runwayDays = 0;
    riskLevel = 'HIGH';
    riskFactors.push('Brez inflow-a — kapital se izsušuje.');
  }
  if (riskFactors.length === 0) {
    riskFactors.push('Brez specifičnih tveganj — flow je zdrav.');
  }

  // Recommended cash reserve — typically 1-2x monthly outflow
  let reserve = round0(metrics.avgMonthlyOutflow * 1.5);
  if (dir === 'NEGATIVE') reserve = round0(metrics.avgMonthlyOutflow * 2);
  if (dir === 'POSITIVE' && metrics.flowConsistency >= 70) {
    reserve = round0(metrics.avgMonthlyOutflow * 1.0);
  }
  if (reserve < 0) reserve = 0;

  return {
    flowAssessment: assessment,
    bottlenecks: bottlenecks.slice(0, 4),
    flowOptimizationActions: actions.slice(0, 4),
    projectedFlow30d: projected,
    capitalEfficiency: efficiency,
    flowRiskAssessment: {
      riskLevel,
      riskFactors: riskFactors.slice(0, 4),
      daysOfCashRunway: runwayDays,
    },
    recommendedCashReserve: reserve,
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleCapitalFlowAnalyzer(req);
}
export async function POST(req: NextRequest) {
  return handleCapitalFlowAnalyzer(req);
}

async function handleCapitalFlowAnalyzer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-capital-flow-analyzer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades + all trades with buyDate (inflows AND outflows)
    const trades = await db.trade.findMany({
      where: {
        OR: [
          { status: 'sold', sellDate: { not: null, gte: cutoff12m } },
          { buyDate: { gte: cutoff12m } },
        ],
      },
      select: {
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        status: true,
        listing: {
          select: {
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as TradeRow[];

    // 2) Build 12-month buckets (index 0 = oldest, 11 = newest)
    const thisMonthStart = monthStartMs(now);
    const months: MonthlyFlow[] = Array.from({ length: MONTHS_12 }, (_, i) => {
      const monthMs = thisMonthStart - (MONTHS_12 - 1 - i) * 30 * DAY_MS;
      return {
        month: monthLabel(monthMs),
        inflow: 0,
        outflow: 0,
        netFlow: 0,
        flowRatio: 0,
        accumulatedCapital: 0,
      };
    });

    // For computing hold time / held inventory
    let heldItemsCount = 0;
    let heldItemsLongCount = 0;
    let soldHoldDaysSum = 0;
    let soldCount = 0;

    for (const t of trades) {
      const buyMs = toMs(t.buyDate);
      const sellMs = toMs(t.sellDate);

      // OUTFLOW: any trade with buyDate in last 12m → counts as outflow in buy month
      if (buyMs > 0 && buyMs >= now - HORIZON_12M) {
        const buyPrice = t.buyPrice ?? 0;
        const buyFees = t.buyFees ?? 0;
        const outflow = buyPrice + buyFees;
        const buyMonthStart = monthStartMs(buyMs);
        const monthsAgo = Math.round((thisMonthStart - buyMonthStart) / (30 * DAY_MS));
        const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
        if (bucketIdx >= 0 && bucketIdx <= 11) {
          months[bucketIdx]!.outflow += outflow;
        }
      }

      // INFLOW: SOLD trades with sellDate → counts as inflow in sell month
      if (t.status === 'sold' && sellMs > 0 && sellMs >= now - HORIZON_12M) {
        const sellPrice = t.sellPrice ?? 0;
        const sellFees = t.sellFees ?? 0;
        const inflow = sellPrice - sellFees;
        const sellMonthStart = monthStartMs(sellMs);
        const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
        const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
        if (bucketIdx >= 0 && bucketIdx <= 11) {
          months[bucketIdx]!.inflow += inflow;
        }
      }

      // Hold time for sold trades
      if (t.status === 'sold' && buyMs > 0 && sellMs > 0 && sellMs >= buyMs) {
        soldHoldDaysSum += (sellMs - buyMs) / DAY_MS;
        soldCount += 1;
      }

      // Held items (status === 'held')
      if (t.status === 'held' && buyMs > 0) {
        heldItemsCount += 1;
        const daysHeld = (now - buyMs) / DAY_MS;
        if (daysHeld > 60) heldItemsLongCount += 1;
      }
    }

    // 3) Compute per-month netFlow, flowRatio, accumulatedCapital
    let runningTotal = 0;
    for (const m of months) {
      m.netFlow = round0(m.inflow - m.outflow);
      m.flowRatio = m.outflow > 0 ? Math.round((m.inflow / m.outflow) * 100) / 100 : (m.inflow > 0 ? 2 : 0);
      runningTotal += m.netFlow;
      m.accumulatedCapital = round0(runningTotal);
      m.inflow = round0(m.inflow);
      m.outflow = round0(m.outflow);
    }

    const activeMonthCount = months.filter((m) => m.inflow > 0 || m.outflow > 0).length;

    // Empty state — no trades at all
    if (activeMonthCount === 0) {
      return NextResponse.json({
        ok: true,
        flow: {
          avgMonthlyInflow: 0,
          avgMonthlyOutflow: 0,
          avgNetFlow: 0,
          flowRatio: 0,
          flowConsistency: 0,
          flowVolatility: 0,
          flowTrend: 0,
          flowDirection: 'BALANCED',
        },
        monthlyData: months,
        analysis: {
          flowAssessment: 'Ni trgovin v zadnjih 12 mesecih — Capital Flow Analyzer ni mogoč.',
          bottlenecks: [],
          flowOptimizationActions: [
            {
              action: 'Dodaj trgovine v bazo z buyDate in sellDate da omogočiš flow analizo.',
              priority: 'LOW',
              expectedFlowImprovement: 'Omogoči tracking inflow/outflow pattern-ov in cash reserve sizing.',
            },
          ],
          projectedFlow30d: 0,
          capitalEfficiency: 0,
          flowRiskAssessment: {
            riskLevel: 'LOW',
            riskFactors: ['Brez podatkov — flow analiza ni mogoča.'],
            daysOfCashRunway: 0,
          },
          recommendedCashReserve: 0,
        },
        summary: 'Ni trgovin v zadnjih 12 mesecih — Capital Flow Analyzer ni mogoč.',
        aiUsed: false,
        message: 'Ni trgovin v zadnjih 12 mesecih — Capital Flow Analyzer ni mogoč.',
      });
    }

    // 4) Compute flow metrics
    const metrics = computeFlowMetrics(months);
    const avgHeldDaysOfSold = soldCount > 0 ? soldHoldDaysSum / soldCount : 0;

    // 5) Build deterministic baseline analysis
    const deterministicAnalysis = buildDeterministicFlowAnalysis(
      metrics,
      months,
      heldItemsCount,
      heldItemsLongCount,
      avgHeldDaysOfSold,
    );

    let analysis: FlowAnalysis = deterministicAnalysis;
    let summary = buildDeterministicSummary(metrics, deterministicAnalysis);

    // 6) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `capital-flow-analyzer:${currentMonth}`;
    const cached = getCachedAI<{ analysis: FlowAnalysis; summary: string }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        flow: metrics,
        monthlyData: months,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
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

    const reserveMax = metrics.avgMonthlyInflow * 2;

    const promptData = {
      flow: metrics,
      monthlyData: months,
      context: {
        heldItemsCount,
        heldItemsLongCount,
        avgHeldDaysOfSold: round0(avgHeldDaysOfSold),
      },
      deterministicBaseline: {
        projectedFlow30d: deterministicAnalysis.projectedFlow30d,
        capitalEfficiency: deterministicAnalysis.capitalEfficiency,
        recommendedCashReserve: deterministicAnalysis.recommendedCashReserve,
        daysOfCashRunway: deterministicAnalysis.flowRiskAssessment.daysOfCashRunway,
      },
      caps: {
        projFlowMin: PROJ_FLOW_MIN, projFlowMax: PROJ_FLOW_MAX,
        efficiencyMin: EFFICIENCY_MIN, efficiencyMax: EFFICIENCY_MAX,
        runwayMin: RUNWAY_MIN, runwayMax: RUNWAY_MAX,
        reserveMax, // = avgMonthlyInflow × 2
      },
    };

    const prompt = `Si AI "Capital Flow Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Analiziraš kako kapital FLOW-a skozi business — inflow (sales), outflow (purchases), in net flow patterns. Identificiraš bottlenecks (kje se kapital zatakne) in optimiziraš cash flow timing. Razlika od cash-flow-velocity (ki meri hitrost) — ti gledaš FLOW PATTERN in direction (POSITIVE/NEGATIVE/BALANCED) z bottlenecks in reserve recommendation.

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD trades + trades z buyDate):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. flowAssessment: slovensko, max 500 znakov — opis capital flow health (POSITIVE/NEGATIVE/BALANCED + bottleneck povzetek).
2. bottlenecks: 1-4 { bottleneck (max 200 chars slovensko), impact (max 200 chars — kaj to stane), severity LOW | MEDIUM | HIGH, solution (max 200 chars) }.
3. flowOptimizationActions: 1-4 { action (max 200 chars), priority HIGH | MEDIUM | LOW, expectedFlowImprovement (max 200 chars) }.
4. projectedFlow30d: number, clamped [-10000, 10000], ±50% od deterministične (kakšna bo net flow v 30 dneh).
5. capitalEfficiency: 0-100, ±15 od deterministične (kako učinkovito kapital ciklira).
6. flowRiskAssessment: { riskLevel LOW | MEDIUM | HIGH, riskFactors 1-4 (max 200 chars vsak), daysOfCashRunway 0-365 (koliko dni lahko preživi če inflow ustavi) }.
7. recommendedCashReserve: number, clamped [0, avgMonthlyInflow × 2 = ${reserveMax}] (koliko gotovine držati kot buffer).
8. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "flowAssessment": "Capital flow POSITIVE — povprečni neto tok +350€/mesc, ratio 1.4...",
  "bottlenecks": [
    { "bottleneck": "3 artikli držani >60 dni — kapital ujet.", "impact": "~300€ ujetega kapitala.", "severity": "MEDIUM", "solution": "Price drop 10-15% za >60d artikle." }
  ],
  "flowOptimizationActions": [
    { "action": "Likvidiraj 3 >60d artikle.", "priority": "HIGH", "expectedFlowImprovement": "Sprosti ~300€ v 14 dneh." }
  ],
  "projectedFlow30d": 400,
  "capitalEfficiency": 72,
  "flowRiskAssessment": { "riskLevel": "LOW", "riskFactors": ["Brez specifičnih tveganj."], "daysOfCashRunway": 180 },
  "recommendedCashReserve": 700,
  "summary": "Capital flow POSITIVE (+350€/mo, ratio 1.4). Bottleneck: 3 items >60d. Reserve: 700€. Efficiency: 72%."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiFlowResponse | null;

      if (parsed && typeof parsed === 'object') {
        const det = deterministicAnalysis;
        const projFlow = round0(
          Math.max(PROJ_FLOW_MIN, Math.min(PROJ_FLOW_MAX,
            det.projectedFlow30d + Math.max(-Math.abs(det.projectedFlow30d) * 0.5, Math.min(Math.abs(det.projectedFlow30d) * 0.5,
              (Number(parsed.projectedFlow30d ?? det.projectedFlow30d)) - det.projectedFlow30d)))),
        );
        const efficiency = round0(
          Math.max(EFFICIENCY_MIN, Math.min(EFFICIENCY_MAX,
            det.capitalEfficiency + Math.max(-15, Math.min(15,
              (Number(parsed.capitalEfficiency ?? det.capitalEfficiency)) - det.capitalEfficiency)))),
        );
        const runway = round0(
          Math.max(RUNWAY_MIN, Math.min(RUNWAY_MAX,
            det.flowRiskAssessment.daysOfCashRunway + Math.max(-30, Math.min(30,
              (Number(parsed.flowRiskAssessment?.daysOfCashRunway ?? det.flowRiskAssessment.daysOfCashRunway)) - det.flowRiskAssessment.daysOfCashRunway)))),
        );
        const reserve = round0(
          Math.max(0, Math.min(reserveMax,
            Number(parsed.recommendedCashReserve ?? det.recommendedCashReserve))),
        );

        // Bottlenecks validation
        const bottlenecks: Bottleneck[] = [];
        if (Array.isArray(parsed.bottlenecks)) {
          for (const b of parsed.bottlenecks.slice(0, 4)) {
            if (!b || typeof b !== 'object') continue;
            bottlenecks.push({
              bottleneck: clampString(b.bottleneck, 200, det.bottlenecks[0]?.bottleneck ?? 'Bottleneck.'),
              impact: clampString(b.impact, 200, det.bottlenecks[0]?.impact ?? 'Vpliv na cash flow.'),
              severity: clampEnum(b.severity, VALID_SEVERITY, det.bottlenecks[0]?.severity ?? 'LOW'),
              solution: clampString(b.solution, 200, det.bottlenecks[0]?.solution ?? 'Rešitev.'),
            });
          }
        }
        if (bottlenecks.length === 0) {
          for (const b of det.bottlenecks) bottlenecks.push(b);
        }

        // Actions validation
        const actions: FlowOptimizationAction[] = [];
        if (Array.isArray(parsed.flowOptimizationActions)) {
          for (const a of parsed.flowOptimizationActions.slice(0, 4)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, det.flowOptimizationActions[0]?.action ?? 'Akcija.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, det.flowOptimizationActions[0]?.priority ?? 'MEDIUM'),
              expectedFlowImprovement: clampString(a.expectedFlowImprovement, 200, det.flowOptimizationActions[0]?.expectedFlowImprovement ?? 'Izboljšava flow-a.'),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of det.flowOptimizationActions) actions.push(a);
        }

        // Risk factors validation
        let riskFactors = det.flowRiskAssessment.riskFactors;
        if (Array.isArray(parsed.flowRiskAssessment?.riskFactors)) {
          const cleaned = parsed.flowRiskAssessment!.riskFactors
            .filter((r) => typeof r === 'string' && r.trim().length > 0)
            .slice(0, 4)
            .map((r) => (r as string).trim().slice(0, 200));
          if (cleaned.length > 0) riskFactors = cleaned;
        }

        const riskLevel = clampEnum(
          parsed.flowRiskAssessment?.riskLevel,
          VALID_RISK_LEVEL,
          det.flowRiskAssessment.riskLevel,
        );

        analysis = {
          flowAssessment: clampString(parsed.flowAssessment, 500, det.flowAssessment),
          bottlenecks: bottlenecks.slice(0, 4),
          flowOptimizationActions: actions.slice(0, 4),
          projectedFlow30d: projFlow,
          capitalEfficiency: efficiency,
          flowRiskAssessment: {
            riskLevel,
            riskFactors,
            daysOfCashRunway: runway,
          },
          recommendedCashReserve: reserve,
        };
        summary = clampString(parsed.summary, 400, buildDeterministicSummary(metrics, analysis));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/capital-flow-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { analysis, summary });
    }

    return NextResponse.json({
      ok: true,
      flow: metrics,
      monthlyData: months,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/capital-flow-analyzer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

function buildDeterministicSummary(
  metrics: FlowMetrics,
  analysis: FlowAnalysis,
): string {
  const parts: string[] = [
    `Capital flow: ${metrics.flowDirection} (${metrics.avgNetFlow >= 0 ? '+' : ''}${metrics.avgNetFlow}€/mo, ratio ${metrics.flowRatio}).`,
  ];
  const bn = analysis.bottlenecks[0];
  if (bn) {
    parts.push(`Bottleneck: ${bn.bottleneck.slice(0, 60)}.`);
  }
  parts.push(`Reserve: ${analysis.recommendedCashReserve}€.`);
  parts.push(`Efficiency: ${analysis.capitalEfficiency}%.`);
  return parts.join(' ').slice(0, 400);
}
