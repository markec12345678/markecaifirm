// v7.92: AI Inventory Turnover Momentum Tracker — AI track-a MOMENTUM
// (acceleration) inventory turnover-a — ali turnover pospešuje ali upada?
// Compute-a acceleration of turnover rate in napove future turnover
// trajectory. Razlika od inventory-turnover-forecast (v7.78 ki projicira
// turnover rate) — ta track-a MOMENTUM (2nd derivative — pospešek turnover-a).
// "Turnover momentum: ACCELERATING (strength 72, +0.5/mo²). 30d forecast:
// 3.8x turnover, 22d hold. Sustainable for 4 months."
//
// Razlika od inventory-turnover-accelerator-pro (v7.85 ki daje
// acceleration actions) — ta track-a HISTORICAL momentum čez 12 mesecev z
// projected trajectory in sustainability. Razlika od inventory-turnover-
// optimizer (ki optimizira turnover) — ta gleda momentum direction (ACCEL
// /STEADY/DECEL) z drivers/inhibitors/actions. Razlika od inventory-
// performance-trend-tracker (v7.91 ki track-a performance trends) — ta
// gleda TURNOVER specifično (turnover rate + hold days + sell-through +
// capital turnover) z 2nd-derivative momentum. Razlika od inventory-aging-
// trend-analyzer (v7.88 ki track-a aging trends) — ta gleda TURNOVER
// momentum ne aging.
//
// GET+POST /api/ai/inventory-turnover-momentum-tracker
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

type MomentumDirection = 'ACCELERATING' | 'STEADY' | 'DECELERATING';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

interface TurnoverMomentum {
  turnoverRateTrend: number; // slope per month
  holdDaysTrend: number; // slope per month (negative = improving)
  turnoverMomentum: number; // 2nd derivative (acceleration)
  momentumDirection: MomentumDirection;
  momentumStrength: number; // 0-100
}

interface MonthlyTurnover {
  month: string;
  turnoverRate: number;
  avgHoldDays: number;
  sellThroughRate: number; // %
  capitalTurnover: number;
}

interface MomentumForecast {
  projectedTurnoverRate30d: number;
  projectedHoldDays30d: number;
  momentumSustainability: number; // 0-100
  momentumAssessment: string;
  momentumRiskLevel: RiskLevel;
}

interface MomentumDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface MomentumInhibitor {
  inhibitor: string;
  impact: string;
  solution: string;
}

interface MomentumAction {
  action: string;
  priority: ActionPriority;
  expectedMomentumLift: string;
}

interface MomentumAnalysis {
  momentumDrivers: MomentumDriver[];
  momentumInhibitors: MomentumInhibitor[];
  momentumActions: MomentumAction[];
}

interface AiMomentumResponse {
  projectedTurnoverRate30d?: number;
  projectedHoldDays30d?: number;
  momentumSustainability?: number;
  momentumAssessment?: string;
  momentumRiskLevel?: RiskLevel;
  momentumDrivers?: Array<{
    driver?: string;
    impact?: DriverImpact;
    weight?: number;
    detail?: string;
  }>;
  momentumInhibitors?: Array<{
    inhibitor?: string;
    impact?: string;
    solution?: string;
  }>;
  momentumActions?: Array<{
    action?: string;
    priority?: ActionPriority;
    expectedMomentumLift?: string;
  }>;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const MONTHS_12 = 12;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const TURNOVER_MIN = 0;
const TURNOVER_MAX = 20;
const HOLD_DAYS_MIN = 0;
const HOLD_DAYS_MAX = 180;
const SUSTAINABILITY_MIN = 0;
const SUSTAINABILITY_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;

const VALID_RISK_LEVEL: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
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

// 2nd derivative: slope of second half minus slope of first half
function computeAcceleration(values: number[]): number {
  if (values.length < 4) return 0;
  const mid = Math.floor(values.length / 2);
  const firstSlope = trendSlope(values.slice(0, mid));
  const secondSlope = trendSlope(values.slice(mid));
  return secondSlope - firstSlope;
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
}

// --- Monthly aggregation -------------------------------------------------

interface MonthAgg {
  soldCount: number;
  heldCount: number; // status='held' as of that month (approximation: trades bought in month still held)
  totalBuyCost: number;
  totalRevenue: number;
  holdDaysSum: number;
  holdDaysCnt: number;
}

function newMonthAgg(): MonthAgg {
  return { soldCount: 0, heldCount: 0, totalBuyCost: 0, totalRevenue: 0, holdDaysSum: 0, holdDaysCnt: 0 };
}

function monthStartMs(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function monthLabel(t: number): string {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// --- Momentum computation -----------------------------------------------

function computeMomentum(monthly: MonthlyTurnover[]): TurnoverMomentum {
  if (monthly.length === 0) {
    return {
      turnoverRateTrend: 0,
      holdDaysTrend: 0,
      turnoverMomentum: 0,
      momentumDirection: 'STEADY',
      momentumStrength: 0,
    };
  }

  const turnoverRates = monthly.map((m) => m.turnoverRate);
  const holdDays = monthly.map((m) => m.avgHoldDays);

  const turnoverRateTrend = round1(trendSlope(turnoverRates));
  const holdDaysTrend = round1(trendSlope(holdDays));
  const momentum = round1(computeAcceleration(turnoverRates));

  // Strength 0-100: combine absolute trend + |momentum|, normalized
  const trendMag = Math.abs(turnoverRateTrend);
  const momentumMag = Math.abs(momentum);
  // Normalize: typical turnover rate trend is small (e.g. 0.1-0.5/mo), momentum even smaller
  const trendScore = Math.min(50, trendMag * 100); // 0.5/mo = 50
  const momentumScore = Math.min(50, momentumMag * 200); // 0.25/mo² = 50
  // Direction bonus
  const directionAligned = (turnoverRateTrend > 0 && momentum > 0) || (turnoverRateTrend < 0 && momentum < 0) ? 10 : 0;
  const strength = round0(
    Math.max(SCORE_MIN, Math.min(SCORE_MAX, trendScore + momentumScore + directionAligned)),
  );

  // Direction: ACCELERATING if trend positive and momentum positive (or trend strongly positive)
  // DECELERATING if trend negative and momentum negative (or trend strongly negative)
  let direction: MomentumDirection = 'STEADY';
  if (turnoverRateTrend > 0.1 && momentum >= 0) direction = 'ACCELERATING';
  else if (turnoverRateTrend < -0.1 && momentum <= 0) direction = 'DECELERATING';
  else if (momentum > 0.1 && turnoverRateTrend >= 0) direction = 'ACCELERATING';
  else if (momentum < -0.1 && turnoverRateTrend <= 0) direction = 'DECELERATING';
  else if (strength >= 60 && turnoverRateTrend > 0) direction = 'ACCELERATING';
  else if (strength >= 60 && turnoverRateTrend < 0) direction = 'DECELERATING';

  return {
    turnoverRateTrend,
    holdDaysTrend,
    turnoverMomentum: momentum,
    momentumDirection: direction,
    momentumStrength: strength,
  };
}

// --- Deterministic forecast ---------------------------------------------

function buildDeterministicForecast(
  momentum: TurnoverMomentum,
  monthly: MonthlyTurnover[],
): MomentumForecast {
  // Project 30d: last month turnover rate + (trend + 0.5 × momentum) × ~1 month
  const lastMonth = monthly[monthly.length - 1];
  const lastRate = lastMonth ? lastMonth.turnoverRate : 0;
  const lastHold = lastMonth ? lastMonth.avgHoldDays : 0;

  let projectedRate = lastRate + (momentum.turnoverRateTrend + 0.5 * momentum.turnoverMomentum);
  projectedRate = round1(Math.max(TURNOVER_MIN, Math.min(TURNOVER_MAX, projectedRate)));

  let projectedHold = lastHold + momentum.holdDaysTrend; // hold days trend (negative = improving)
  projectedHold = round0(Math.max(HOLD_DAYS_MIN, Math.min(HOLD_DAYS_MAX, projectedHold)));

  // Sustainability: based on momentum strength + sample size + direction alignment
  const months = monthly.length;
  let sustainability = 30;
  sustainability += Math.min(30, months * 4); // more months = more reliable
  sustainability += Math.min(20, momentum.momentumStrength * 0.2);
  if (momentum.momentumDirection === 'STEADY') sustainability += 8;
  if (momentum.momentumDirection === 'ACCELERATING' && momentum.momentumStrength >= 75) sustainability -= 5; // extreme = less sustainable
  if (momentum.momentumDirection === 'DECELERATING' && momentum.momentumStrength >= 75) sustainability -= 5;
  sustainability = round0(Math.max(SUSTAINABILITY_MIN, Math.min(SUSTAINABILITY_MAX, sustainability)));

  // Risk level
  let riskLevel: RiskLevel = 'LOW';
  if (momentum.momentumDirection === 'DECELERATING' && momentum.momentumStrength >= 60) {
    riskLevel = 'HIGH';
  } else if (momentum.momentumDirection === 'DECELERATING') {
    riskLevel = 'MEDIUM';
  } else if (momentum.momentumDirection === 'STEADY' && momentum.momentumStrength < 30) {
    riskLevel = 'MEDIUM';
  }

  // Assessment
  const verb = momentum.momentumDirection === 'ACCELERATING'
    ? 'pospešuje'
    : momentum.momentumDirection === 'DECELERATING'
      ? 'upočasnjuje'
      : 'je stabilen';
  const assessment =
    `Turnover momentum ${verb} — strength ${momentum.momentumStrength}/100, ` +
    `trend ${momentum.turnoverRateTrend >= 0 ? '+' : ''}${momentum.turnoverRateTrend}/mesc, ` +
    `acceleration ${momentum.turnoverMomentum >= 0 ? '+' : ''}${momentum.turnoverMomentum}/mesc². ` +
    `Hold days trend ${momentum.holdDaysTrend}/mesc ${momentum.holdDaysTrend < 0 ? '(improving)' : '(worsening)'}. ` +
    `30d forecast: ${projectedRate}x turnover, ${projectedHold}d hold. `.slice(0, 500) +
    `Sustainable for ~${Math.max(1, Math.round(sustainability / 25))} months.`.slice(0, 200);

  return {
    projectedTurnoverRate30d: projectedRate,
    projectedHoldDays30d: projectedHold,
    momentumSustainability: sustainability,
    momentumAssessment: assessment.slice(0, 500),
    momentumRiskLevel: riskLevel,
  };
}

// --- Deterministic analysis ---------------------------------------------

function buildDeterministicAnalysis(
  momentum: TurnoverMomentum,
  monthly: MonthlyTurnover[],
  forecast: MomentumForecast,
): MomentumAnalysis {
  // Drivers: top 3 from trend components
  const drivers: MomentumDriver[] = [];
  const componentList: Array<{ name: string; score: number; kind: 'rate' | 'holdDays' | 'momentum' }> = [
    { name: 'Turnover rate trend', score: 50 + momentum.turnoverRateTrend * 50, kind: 'rate' },
    { name: 'Hold days trend', score: 50 - momentum.holdDaysTrend * 5, kind: 'holdDays' }, // negative trend = positive score
    { name: 'Turnover acceleration', score: 50 + momentum.turnoverMomentum * 100, kind: 'momentum' },
  ];
  componentList.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  for (const c of componentList.slice(0, 3)) {
    const impact: DriverImpact = c.score >= 50 ? 'POSITIVE' : 'NEGATIVE';
    const weight = round0(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Math.abs(c.score - 50) * 2)));
    const detail =
      c.kind === 'rate'
        ? `Mesečni turnover rate ${c.score >= 50 ? 'raste' : 'pada'} (${momentum.turnoverRateTrend}/mesc).`
        : c.kind === 'holdDays'
          ? `Hold days ${momentum.holdDaysTrend < 0 ? 'se krajšajo' : 'se podaljšujejo'} (${momentum.holdDaysTrend}/mesc).`
          : `Pospešek turnover-a ${momentum.turnoverMomentum >= 0 ? 'pozitiven' : 'negativen'} (${momentum.turnoverMomentum}/mesc²).`;
    drivers.push({
      driver: c.name,
      impact,
      weight,
      detail: detail.slice(0, 200),
    });
  }

  // Inhibitors
  const inhibitors: MomentumInhibitor[] = [];
  if (momentum.holdDaysTrend > 1) {
    inhibitors.push({
      inhibitor: `Hold days se podaljšujejo (+${momentum.holdDaysTrend}d/mesc) — inventory zastaja.`,
      impact: 'Nižji turnover rate in višji capital lock-up.',
      solution: 'Ciljaj na hitreje obratujoče kategorije in znižaj cene po 30 dneh hold-a.',
    });
  }
  if (momentum.momentumDirection === 'DECELERATING') {
    inhibitors.push({
      inhibitor: 'Turnover momentum upada — pozitivni trend se izgublja.',
      impact: `Sustainability ${forecast.momentumSustainability}/100, risk ${forecast.momentumRiskLevel}.`,
      solution: 'Analiziraj vzroke (category mix, seasonality, pricing) in prilagodi strategijo.',
    });
  }
  if (momentum.momentumStrength < 40) {
    inhibitors.push({
      inhibitor: 'Nizka momentum strength — inventory turnover je stagnanten.',
      impact: 'Brez jasnega pospeška je napoved negotova.',
      solution: 'Testiraj nove kategorije ali pricing strategije da sprožiš momentum.',
    });
  }
  if (monthly.length < 6) {
    inhibitors.push({
      inhibitor: `Majhna vzorčna osnova (${monthly.length} mesecev) — momentum ocena je negotljiva.`,
      impact: 'Manjša natančnost trend-a in acceleration.',
      solution: 'Počakaj na več mesecev podatkov (vsaj 6) za zanesljivejšo analizo.',
    });
  }
  if (inhibitors.length === 0) {
    inhibitors.push({
      inhibitor: 'Ni specifičnih inhibitorjev — turnover momentum je zdrav.',
      impact: 'Brez zaznanih ovir za vzdrževanje trenutnega trenda.',
      solution: 'Vzdržuj trenutno strategijo in redno preverjaj momentum signale.',
    });
  }

  // Actions
  const actions: MomentumAction[] = [];
  if (momentum.momentumDirection === 'ACCELERATING') {
    actions.push({
      action: 'Izkoristi trenutni momentum — povečaj inventory v najboljših kategorijah.',
      priority: 'HIGH',
      expectedMomentumLift: `Podaljša ACCELERATING fazo za ~${Math.max(1, Math.round(forecast.momentumSustainability / 30))} mesecev.`,
    });
  }
  if (momentum.momentumDirection === 'DECELERATING') {
    actions.push({
      action: 'Preveri category mix — preusmeri fokus na kategorije z višjim momentum-om.',
      priority: 'HIGH',
      expectedMomentumLift: 'Preobrne trend v 1-2 mesecih če so kategorije pravilno izbrane.',
    });
  }
  if (momentum.holdDaysTrend > 1) {
    actions.push({
      action: `Znižaj cene za items z hold > ${Math.round(30 + momentum.holdDaysTrend * 5)} dni.`,
      priority: 'HIGH',
      expectedMomentumLift: `Zmanjša hold days za ~${Math.round(momentum.holdDaysTrend)}d/mesc.`,
    });
  }
  if (forecast.momentumSustainability < 50) {
    actions.push({
      action: 'Diversificiraj sourcing vire za vzdrževanje consistent inflow-a.',
      priority: 'MEDIUM',
      expectedMomentumLift: 'Poveča sustainability za ~20 točk v 2 mesecih.',
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo in spremljaj momentum signale.',
      priority: 'LOW',
      expectedMomentumLift: 'Ohrani trenutno zdravo turnover stanje.',
    });
  }

  return {
    momentumDrivers: drivers.slice(0, 3),
    momentumInhibitors: inhibitors.slice(0, 4),
    momentumActions: actions.slice(0, 4),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryTurnoverMomentumTracker(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryTurnoverMomentumTracker(req);
}

async function handleInventoryTurnoverMomentumTracker(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-turnover-momentum-tracker', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades + all HELD trades from last 12 months
    const trades = await db.trade.findMany({
      where: {
        OR: [
          { status: 'sold', sellDate: { not: null, gte: cutoff12m } },
          { status: 'held', buyDate: { gte: cutoff12m } },
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
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as TradeRow[];

    // 2) Build 12-month buckets (index 0 = oldest, 11 = newest)
    const thisMonthStart = monthStartMs(now);
    const months: MonthAgg[] = Array.from({ length: MONTHS_12 }, () => newMonthAgg());

    // Also track total held trades (across all months) for sell-through calc
    let totalHeld = 0;

    for (const t of trades) {
      const buyMs = toMs(t.buyDate);
      const sellMs = toMs(t.sellDate);

      if (t.status === 'sold' && sellMs > 0 && sellMs >= now - HORIZON_12M) {
        const sellMonthStart = monthStartMs(sellMs);
        const monthsAgo = Math.round((thisMonthStart - sellMonthStart) / (30 * DAY_MS));
        const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
        if (bucketIdx >= 0 && bucketIdx <= 11) {
          const m = months[bucketIdx]!;
          m.soldCount += 1;
          m.totalRevenue += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
          // Hold days = sell - buy
          if (buyMs > 0 && sellMs >= buyMs) {
            m.holdDaysSum += (sellMs - buyMs) / DAY_MS;
            m.holdDaysCnt += 1;
          }
          // Buy cost if bought in same month (approximation)
          if (buyMs > 0) {
            m.totalBuyCost += (t.buyPrice ?? 0) + (t.buyFees ?? 0);
          } else {
            m.totalBuyCost += (t.buyPrice ?? 0) + (t.buyFees ?? 0); // approximate
          }
        }
      }

      if (t.status === 'held' && buyMs > 0 && buyMs >= now - HORIZON_12M) {
        totalHeld += 1;
        const buyMonthStart = monthStartMs(buyMs);
        const monthsAgo = Math.round((thisMonthStart - buyMonthStart) / (30 * DAY_MS));
        const bucketIdx = 11 - Math.max(0, Math.min(11, monthsAgo));
        if (bucketIdx >= 0 && bucketIdx <= 11) {
          const m = months[bucketIdx]!;
          m.heldCount += 1;
        }
      }
    }

    // 3) Compute per-month metrics
    const monthlyData: MonthlyTurnover[] = months.map((m, i) => {
      const monthMs = thisMonthStart - (MONTHS_12 - 1 - i) * 30 * DAY_MS;
      // Turnover rate: sold / (held + sold) — or just sold / max(1, avg held) approximation
      // Use sold count / (held + sold) as proxy if held > 0, else sold count (per month)
      const totalActive = m.soldCount + m.heldCount;
      const turnoverRate = totalActive > 0 ? round1(m.soldCount / totalActive) : 0;
      const avgHoldDays = m.holdDaysCnt > 0 ? round0(m.holdDaysSum / m.holdDaysCnt) : 0;
      const sellThroughRate = totalActive > 0 ? round0((m.soldCount / totalActive) * 100) : 0;
      // Capital turnover: revenue / invested capital
      const capitalTurnover = m.totalBuyCost > 0 ? round1(m.totalRevenue / m.totalBuyCost) : 0;
      return {
        month: monthLabel(monthMs),
        turnoverRate,
        avgHoldDays,
        sellThroughRate,
        capitalTurnover,
      };
    });

    // Filter to active months only (months with at least 1 sold or held)
    const activeMonths = monthlyData.filter((m) => m.turnoverRate > 0 || m.sellThroughRate > 0);

    // Empty state
    if (activeMonths.length === 0) {
      return NextResponse.json({
        ok: true,
        momentum: {
          turnoverRateTrend: 0,
          holdDaysTrend: 0,
          turnoverMomentum: 0,
          momentumDirection: 'STEADY',
          momentumStrength: 0,
        },
        monthlyData,
        forecast: {
          projectedTurnoverRate30d: 0,
          projectedHoldDays30d: 0,
          momentumSustainability: 0,
          momentumAssessment: 'Ni SOLD ali HELD trgovin v zadnjih 12 mesecih — Inventory Turnover Momentum Tracker ni mogoč.',
          momentumRiskLevel: 'LOW',
        },
        analysis: {
          momentumDrivers: [],
          momentumInhibitors: [],
          momentumActions: [
            {
              action: 'Dodaj SOLD ali HELD trgovine z buyDate in sellDate da omogočiš momentum analizo.',
              priority: 'LOW',
              expectedMomentumLift: 'Omogoči tracking turnover acceleration in projected trajectory.',
            },
          ],
        },
        summary: 'Ni SOLD ali HELD trgovin v zadnjih 12 mesecih — Inventory Turnover Momentum Tracker ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD ali HELD trgovin v zadnjih 12 mesecih — Inventory Turnover Momentum Tracker ni mogoč.',
      });
    }

    // 4) Compute momentum
    const momentum = computeMomentum(activeMonths);
    const deterministicForecast = buildDeterministicForecast(momentum, activeMonths);
    const deterministicAnalysis = buildDeterministicAnalysis(momentum, activeMonths, deterministicForecast);

    let forecast: MomentumForecast = deterministicForecast;
    let analysis: MomentumAnalysis = deterministicAnalysis;
    let summary = buildDeterministicSummary(momentum, deterministicForecast);

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const cacheKey = `inventory-turnover-momentum-tracker:${currentMonth}`;
    const cached = getCachedAI<{ forecast: MomentumForecast; analysis: MomentumAnalysis; summary: string }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        momentum,
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

    const promptData = {
      momentum,
      monthlyData: activeMonths,
      context: { totalHeld, activeMonths: activeMonths.length },
      deterministicBaseline: {
        projectedTurnoverRate30d: deterministicForecast.projectedTurnoverRate30d,
        projectedHoldDays30d: deterministicForecast.projectedHoldDays30d,
        momentumSustainability: deterministicForecast.momentumSustainability,
        momentumRiskLevel: deterministicForecast.momentumRiskLevel,
      },
      caps: {
        turnoverMin: TURNOVER_MIN, turnoverMax: TURNOVER_MAX,
        holdDaysMin: HOLD_DAYS_MIN, holdDaysMax: HOLD_DAYS_MAX,
        sustainabilityMin: SUSTAINABILITY_MIN, sustainabilityMax: SUSTAINABILITY_MAX,
        weightMin: WEIGHT_MIN, weightMax: WEIGHT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Turnover Momentum Tracker" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Track-aš MOMENTUM (acceleration = 2nd derivative) inventory turnover-a — ali turnover pospešuje ali upada? Compute-aš acceleration of turnover rate in napoveš future turnover trajectory. Razlika od inventory-turnover-forecast (ki projicira turnover rate) — ti gledaš MOMENTUM (2nd derivative — pospešek turnover-a).

DETERMINISTIČNI PODATKI (izračunano iz DB — zadnjih 12 mesecev SOLD + HELD trades):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. projectedTurnoverRate30d: number, clamped [0, 20], ±20% od deterministične (kakšna bo turnover rate v 30 dneh).
2. projectedHoldDays30d: number, clamped [0, 180], ±15 od deterministične (povprečni hold days v 30 dneh).
3. momentumSustainability: 0-100, ±15 od deterministične (kako dolgo bo trenutni momentum trajal).
4. momentumAssessment: slovensko, max 500 znakov — opis turnover momentum trajektorije (ACCELERATING/STEADY/DECELERATING + drivers).
5. momentumRiskLevel: LOW | MEDIUM | HIGH (risk da turnover ustavi).
6. momentumDrivers: 1-3 { driver (max 100 chars), impact POSITIVE | NEGATIVE, weight 0-100, detail (max 200 chars) }.
7. momentumInhibitors: 1-4 { inhibitor (max 200 chars), impact (max 200 chars), solution (max 200 chars) }.
8. momentumActions: 1-4 { action (max 200 chars), priority HIGH | MEDIUM | LOW, expectedMomentumLift (max 200 chars) }.
9. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi deterministične.

VRNI LE JSON:
{
  "projectedTurnoverRate30d": 3.8,
  "projectedHoldDays30d": 22,
  "momentumSustainability": 72,
  "momentumAssessment": "Turnover momentum ACCELERATING — strength 72, trend +0.5/mesc, acceleration +0.2/mesc². 30d forecast: 3.8x turnover, 22d hold. Sustainable for ~4 months.",
  "momentumRiskLevel": "LOW",
  "momentumDrivers": [
    { "driver": "Turnover rate trend", "impact": "POSITIVE", "weight": 85, "detail": "Mesečni turnover rate raste (+0.5/mesc)." }
  ],
  "momentumInhibitors": [
    { "inhibitor": "Hold days se podaljšujejo v kategoriji X.", "impact": "Nižji turnover rate.", "solution": "Znižaj cene po 30 dneh hold-a." }
  ],
  "momentumActions": [
    { "action": "Izkoristi momentum — povečaj inventory v najboljših kategorijah.", "priority": "HIGH", "expectedMomentumLift": "Podaljša ACCELERATING fazo za ~3 mesece." }
  ],
  "summary": "Turnover momentum: ACCELERATING (strength 72, +0.5/mo²). 30d forecast: 3.8x turnover, 22d hold. Sustainable for 4 months."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiMomentumResponse | null;

      if (parsed && typeof parsed === 'object') {
        const det = deterministicForecast;
        const detAnalysis = deterministicAnalysis;

        // Projected turnover rate — ±20% of deterministic
        const detRate = det.projectedTurnoverRate30d;
        const projRate = round1(
          Math.max(TURNOVER_MIN, Math.min(TURNOVER_MAX,
            detRate + Math.max(-Math.abs(detRate) * 0.2 - 0.2, Math.min(Math.abs(detRate) * 0.2 + 0.2,
              (Number(parsed.projectedTurnoverRate30d ?? detRate)) - detRate)))),
        );

        // Projected hold days — ±15 of deterministic
        const projHold = round0(
          Math.max(HOLD_DAYS_MIN, Math.min(HOLD_DAYS_MAX,
            det.projectedHoldDays30d + Math.max(-15, Math.min(15,
              (Number(parsed.projectedHoldDays30d ?? det.projectedHoldDays30d)) - det.projectedHoldDays30d)))),
        );

        // Sustainability — ±15 of deterministic
        const sustainability = round0(
          Math.max(SUSTAINABILITY_MIN, Math.min(SUSTAINABILITY_MAX,
            det.momentumSustainability + Math.max(-15, Math.min(15,
              (Number(parsed.momentumSustainability ?? det.momentumSustainability)) - det.momentumSustainability)))),
        );

        const riskLevel = clampEnum(parsed.momentumRiskLevel, VALID_RISK_LEVEL, det.momentumRiskLevel);

        // Drivers validation
        const drivers: MomentumDriver[] = [];
        if (Array.isArray(parsed.momentumDrivers)) {
          for (const d of parsed.momentumDrivers.slice(0, 3)) {
            if (!d || typeof d !== 'object') continue;
            drivers.push({
              driver: clampString(d.driver, 100, detAnalysis.momentumDrivers[0]?.driver ?? 'Driver'),
              impact: clampEnum(d.impact, VALID_IMPACT, detAnalysis.momentumDrivers[0]?.impact ?? 'POSITIVE'),
              weight: clampNum(d.weight, WEIGHT_MIN, WEIGHT_MAX, detAnalysis.momentumDrivers[0]?.weight ?? 50),
              detail: clampString(d.detail, 200, detAnalysis.momentumDrivers[0]?.detail ?? 'Detail.'),
            });
          }
        }
        if (drivers.length === 0) {
          for (const d of detAnalysis.momentumDrivers) drivers.push(d);
        }

        // Inhibitors validation
        const inhibitors: MomentumInhibitor[] = [];
        if (Array.isArray(parsed.momentumInhibitors)) {
          for (const inh of parsed.momentumInhibitors.slice(0, 4)) {
            if (!inh || typeof inh !== 'object') continue;
            inhibitors.push({
              inhibitor: clampString(inh.inhibitor, 200, detAnalysis.momentumInhibitors[0]?.inhibitor ?? 'Inhibitor'),
              impact: clampString(inh.impact, 200, detAnalysis.momentumInhibitors[0]?.impact ?? 'Vpliv na momentum.'),
              solution: clampString(inh.solution, 200, detAnalysis.momentumInhibitors[0]?.solution ?? 'Rešitev.'),
            });
          }
        }
        if (inhibitors.length === 0) {
          for (const inh of detAnalysis.momentumInhibitors) inhibitors.push(inh);
        }

        // Actions validation
        const actions: MomentumAction[] = [];
        if (Array.isArray(parsed.momentumActions)) {
          for (const a of parsed.momentumActions.slice(0, 4)) {
            if (!a || typeof a !== 'object') continue;
            actions.push({
              action: clampString(a.action, 200, detAnalysis.momentumActions[0]?.action ?? 'Akcija'),
              priority: clampEnum(a.priority, VALID_PRIORITY, detAnalysis.momentumActions[0]?.priority ?? 'MEDIUM'),
              expectedMomentumLift: clampString(a.expectedMomentumLift, 200, detAnalysis.momentumActions[0]?.expectedMomentumLift ?? 'Izboljšava momentum-a.'),
            });
          }
        }
        if (actions.length === 0) {
          for (const a of detAnalysis.momentumActions) actions.push(a);
        }

        forecast = {
          projectedTurnoverRate30d: projRate,
          projectedHoldDays30d: projHold,
          momentumSustainability: sustainability,
          momentumAssessment: clampString(parsed.momentumAssessment, 500, det.momentumAssessment),
          momentumRiskLevel: riskLevel,
        };
        analysis = {
          momentumDrivers: drivers.slice(0, 3),
          momentumInhibitors: inhibitors.slice(0, 4),
          momentumActions: actions.slice(0, 4),
        };
        summary = clampString(parsed.summary, 400, buildDeterministicSummary(momentum, forecast));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-turnover-momentum-tracker',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 7) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { forecast, analysis, summary });
    }

    return NextResponse.json({
      ok: true,
      momentum,
      monthlyData,
      forecast,
      analysis,
      summary,
      aiUsed,
    });
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-turnover-momentum-tracker',
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
  momentum: TurnoverMomentum,
  forecast: MomentumForecast,
): string {
  const parts: string[] = [
    `Turnover momentum: ${momentum.momentumDirection} (strength ${momentum.momentumStrength}, ${momentum.turnoverMomentum >= 0 ? '+' : ''}${momentum.turnoverMomentum}/mo²).`,
    `30d forecast: ${forecast.projectedTurnoverRate30d}x turnover, ${forecast.projectedHoldDays30d}d hold.`,
    `Sustainable for ~${Math.max(1, Math.round(forecast.momentumSustainability / 25))} months.`,
  ];
  return parts.join(' ').slice(0, 400);
}
