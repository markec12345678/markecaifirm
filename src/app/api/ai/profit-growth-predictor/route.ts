// v7.81: AI Profit Growth Predictor — AI napove profit GROWTH rate za naslednjih
// 6 mesecev — kako hitro bo profit rastel in kateri faktorji bodo to gnali ali
// zavirali. "Growth: ACCELERATING (+15%/mo, accel +5%). 6m projection: 3,200€.
// Driver: volume (+3 trades/mo). Hit 2x in 5 months."
//
// Razlika od profit-trajectory-forecaster (v7.72, ki napove growth trajectory
// scenarije) — ta identificira GROWTH DRIVERS in inhibitors (kaj gnali rast)
// z growth stage classification (EARLY/ACCELERATING/MATURING/SATURATING).
// Razlika od profit-forecast (ki napove absolutni profit) — ta gleda GROWTH
// RATE in growth potential 0-100. Razlika od profit-stream-predictor (v7.70,
// ki napove profit streams) — ta gleda COMPOUND growth rate in milestones.
// Razlika od profit-momentum-tracker (v7.75, ki track-a momentum) — ta
// forecast-a future growth rate z drivers/inhibitors in milestone projections.
// Razlika od profit-accelerator (v7.71, ki pospeši profit) — ta PREDICT-a
// growth rate in growth potential (how much headroom). Razlika od
// profit-leakage-detector (v7.69, ki detektira leakage) — ta gleda GROWTH
// (positive direction) z drivers + inhibitors in growth stage.
// Razlika od inventory-roi-optimizer (v7.79, ki optimira ROI) — ta gleda
// PROFIT GROWTH RATE prek 6 mesecev z drivers/inhibitors in milestone
// projections (2x, 3x, 5x). Razlika od trade-performance-forecaster (v7.80,
// ki forecast-a individual trades) — ta gleda AGGREGATE profit growth
// trajectory z drivers + actions.
//
// GET+POST /api/ai/profit-growth-predictor
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input ----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ProfitGrowthPredictorInput {}

// --- Types ---------------------------------------------------------------

type GrowthStage = 'EARLY' | 'ACCELERATING' | 'MATURING' | 'SATURATING';
type ImpactType = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

interface DriverInfo {
  trend: number;
  impact: ImpactType;
  detail: string;
}

interface TopGrowthCategory {
  category: string;
  growthRate: number;
}

interface GrowthDrivers {
  volumeGrowth: DriverInfo;
  priceGrowth: DriverInfo;
  efficiencyGrowth: DriverInfo;
  topGrowthCategory: TopGrowthCategory | null;
}

interface ProjectedMilestone {
  target: string;
  monthsToReach: number;
  projectedDate: string;
}

interface GrowthPrediction {
  growthPrediction6m: number;
  growthRate6m: number;
  compoundGrowthRate: number;
  growthPotential: number; // 0-100
  growthStage: GrowthStage;
  projectedMilestones: ProjectedMilestone[];
}

interface GrowthDriverItem {
  driver: string;
  weight: number;
  detail: string;
}

interface GrowthInhibitor {
  inhibitor: string;
  impact: string;
  mitigation: string;
}

interface GrowthAction {
  action: string;
  priority: Priority;
  expectedGrowthLift: string;
}

interface GrowthAnalysis {
  growthDrivers: GrowthDriverItem[];
  growthInhibitors: GrowthInhibitor[];
  growthActions: GrowthAction[];
}

interface CurrentGrowthState {
  currentMonthlyProfit: number;
  currentMonthlyGrowth: number;
  avgMonthlyGrowth6m: number;
  growthAcceleration: number;
  growthVolatility: number;
}

interface AiGrowthResponse {
  prediction?: unknown;
  analysis?: unknown;
  summary?: unknown;
}

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

const VALID_STAGE: readonly GrowthStage[] = [
  'EARLY',
  'ACCELERATING',
  'MATURING',
  'SATURATING',
];

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

function round1(v: number): number {
  return Math.round(v * 10) / 10;
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

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / 86_400_000));
}

// Standard deviation of a numeric array
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Monthly aggregation ------------------------------------------------

interface MonthBucket {
  monthKey: string; // YYYY-MM
  year: number;
  month: number; // 0-11
  profit: number;
  tradeCount: number;
  avgHoldDays: number;
  holdDaysSum: number;
  holdCount: number;
}

interface MonthlyAgg {
  buckets: MonthBucket[]; // sorted asc by monthKey
  last12: MonthBucket[]; // last 12 months (or fewer)
  last6: MonthBucket[]; // last 6 months
}

function monthKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function buildMonthlyAgg(
  soldTrades: Array<{
    sellPrice: number | null;
    sellFees: number | null;
    buyPrice: number | null;
    buyFees: number | null;
    category: string;
    buyDate: Date | null;
    sellDate: Date | null;
  }>,
): MonthlyAgg {
  const map = new Map<string, MonthBucket>();

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;
    const sellDate = new Date(sellMs);
    const key = monthKeyOf(sellDate);

    let b = map.get(key);
    if (!b) {
      b = {
        monthKey: key,
        year: sellDate.getFullYear(),
        month: sellDate.getMonth(),
        profit: 0,
        tradeCount: 0,
        avgHoldDays: 0,
        holdDaysSum: 0,
        holdCount: 0,
      };
      map.set(key, b);
    }

    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const profit = sellPrice - sellFees - buyPrice - buyFees;
    b.profit += profit;
    b.tradeCount += 1;

    const buyMs = toMs(t.buyDate);
    if (buyMs > 0 && sellMs > 0) {
      const holdDays = daysBetween(buyMs, sellMs);
      b.holdDaysSum += holdDays;
      b.holdCount += 1;
    }
  }

  // Finalize averages
  for (const b of map.values()) {
    b.profit = round0(b.profit);
    b.avgHoldDays =
      b.holdCount > 0 ? round1(b.holdDaysSum / b.holdCount) : 0;
  }

  const buckets = Array.from(map.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );

  const last12 = buckets.slice(-12);
  const last6 = last12.slice(-6);

  return { buckets, last12, last6 };
}

// Compute month-over-month growth rate (%) for each pair
function monthlyGrowthRates(months: MonthBucket[]): number[] {
  const rates: number[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1].profit;
    const cur = months[i].profit;
    if (prev > 0) {
      rates.push(((cur - prev) / Math.abs(prev)) * 100);
    } else if (cur > 0) {
      rates.push(100);
    } else {
      rates.push(0);
    }
  }
  return rates;
}

// --- Drivers -------------------------------------------------------------

// Build a trend (slope) from a numeric series — positive = increasing
function trendSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += Math.pow(i - xMean, 2);
  }
  if (den === 0) return 0;
  return num / den;
}

function classifyImpact(slope: number, threshold: number): ImpactType {
  if (slope > threshold) return 'POSITIVE';
  if (slope < -threshold) return 'NEGATIVE';
  return 'NEUTRAL';
}

// Per-category growth analysis (last 6 months vs prior 6 months)
interface CategoryGrowth {
  category: string;
  growthRate: number;
  recentProfit: number;
  recentCount: number;
}

function computeCategoryGrowth(
  soldTrades: Array<{
    sellPrice: number | null;
    sellFees: number | null;
    buyPrice: number | null;
    buyFees: number | null;
    category: string;
    sellDate: Date | null;
  }>,
  now: number,
): CategoryGrowth[] {
  const cutoff6m = now - 6 * 30 * 86_400_000;
  const cutoff12m = now - 12 * 30 * 86_400_000;

  interface CatAgg {
    category: string;
    recentProfit: number;
    recentCount: number;
    priorProfit: number;
    priorCount: number;
  }
  const map = new Map<string, CatAgg>();

  for (const t of soldTrades) {
    const sellMs = toMs(t.sellDate);
    if (sellMs <= 0) continue;
    const category = (t.category || '').trim().toLowerCase() || 'neznan';
    const buyPrice = t.buyPrice ?? 0;
    const buyFees = t.buyFees ?? 0;
    const sellPrice = t.sellPrice ?? 0;
    const sellFees = t.sellFees ?? 0;
    const profit = sellPrice - sellFees - buyPrice - buyFees;

    let c = map.get(category);
    if (!c) {
      c = {
        category,
        recentProfit: 0,
        recentCount: 0,
        priorProfit: 0,
        priorCount: 0,
      };
      map.set(category, c);
    }
    if (sellMs >= cutoff6m) {
      c.recentProfit += profit;
      c.recentCount += 1;
    } else if (sellMs >= cutoff12m) {
      c.priorProfit += profit;
      c.priorCount += 1;
    }
  }

  const result: CategoryGrowth[] = [];
  for (const c of map.values()) {
    const recent = round0(c.recentProfit);
    const prior = round0(c.priorProfit);
    let growthRate = 0;
    if (prior > 0) {
      growthRate = ((recent - prior) / Math.abs(prior)) * 100;
    } else if (recent > 0) {
      growthRate = 100;
    }
    if (c.recentCount < 2) continue; // skip categories with too few recent sales
    result.push({
      category: c.category,
      growthRate: round1(growthRate),
      recentProfit: recent,
      recentCount: c.recentCount,
    });
  }

  result.sort((a, b) => b.growthRate - a.growthRate);
  return result;
}

// --- Deterministic growth computation -----------------------------------

function computeGrowthStage(
  avgGrowth6m: number,
  acceleration: number,
  growthVolatility: number,
  monthsWithData: number,
): GrowthStage {
  if (monthsWithData < 6) return 'EARLY';
  if (growthVolatility > 50 && avgGrowth6m < 5) return 'SATURATING';
  if (acceleration < -5 && avgGrowth6m < 10) return 'SATURATING';
  if (acceleration > 2 && avgGrowth6m > 0) return 'ACCELERATING';
  if (avgGrowth6m >= 0) return 'MATURING';
  return 'SATURATING';
}

// Compound growth rate (CAGR-style) over last N months
function computeCompoundRate(months: MonthBucket[]): number {
  if (months.length < 2) return 0;
  const first = months[0].profit;
  const last = months[months.length - 1].profit;
  const n = months.length - 1;
  if (first <= 0) {
    if (last > 0) return round1(Math.min(200, (last / Math.max(1, n)) * 1));
    return 0;
  }
  if (last <= 0) return -50; // contraction
  const ratio = last / first;
  const rate = (Math.pow(ratio, 1 / n) - 1) * 100;
  return round1(Math.max(-50, Math.min(200, rate)));
}

function projectProfit(
  currentMonthlyProfit: number,
  monthlyRatePct: number,
  monthsAhead: number,
): number {
  const r = monthlyRatePct / 100;
  return round0(currentMonthlyProfit * Math.pow(1 + r, monthsAhead));
}

function monthsToReach(
  currentMonthlyProfit: number,
  monthlyRatePct: number,
  targetMultiple: number,
): number | null {
  if (currentMonthlyProfit <= 0) return null;
  if (monthlyRatePct <= 0) return null;
  const r = monthlyRatePct / 100;
  const targetProfit = currentMonthlyProfit * targetMultiple;
  const monthsRaw = Math.log(targetProfit / currentMonthlyProfit) / Math.log(1 + r);
  return Math.max(1, Math.ceil(monthsRaw));
}

// --- Extracted prompt helpers (pure, testable) ---------------------------

interface PromptContext {
  currentMonthlyProfit: number;
  currentMonthlyGrowth: number;
  avgMonthlyGrowth6m: number;
  growthAcceleration: number;
  growthVolatility: number;
  monthsWithData: number;
  volumeGrowth: DriverInfo;
  priceGrowth: DriverInfo;
  efficiencyGrowth: DriverInfo;
  topGrowthCategory: TopGrowthCategory | null;
  growthPrediction6m: number;
  growthRate6m: number;
  compoundGrowthRate: number;
  growthPotential: number;
  growthStage: GrowthStage;
  projectedMilestones: ProjectedMilestone[];
  monthlyData: Array<{
    month: string;
    profit: number;
    tradeCount: number;
    avgHoldDays: number;
  }>;
  topCatsForPrompt: CategoryGrowth[];
}

function buildPrompt(promptData: PromptContext): string {
  return `Si AI "Profit Growth Predictor" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Napoveš profit GROWTH rate za naslednjih 6 mesecev — kako hitro bo profit rastel in kateri faktorji bodo to gnali ali zavirali.

TRENUTNO STANJE (deterministično izračunano):
- currentMonthlyProfit: ${promptData.currentMonthlyProfit}€
- currentMonthlyGrowth: ${promptData.currentMonthlyGrowth}%
- avgMonthlyGrowth6m: ${promptData.avgMonthlyGrowth6m}%
- growthAcceleration: ${promptData.growthAcceleration > 0 ? '+' : ''}${promptData.growthAcceleration} (recent 3m vs prior 3m)
- growthVolatility: ${promptData.growthVolatility} (stddev mesečnih growth ratov)
- monthsWithData: ${promptData.monthsWithData}

GROWTH DRIVERS (deterministično izračunano):
- volumeGrowth: trend ${promptData.volumeGrowth.trend}/mo, impact ${promptData.volumeGrowth.impact}, detail: ${promptData.volumeGrowth.detail}
- priceGrowth: trend ${promptData.priceGrowth.trend}/mo, impact ${promptData.priceGrowth.impact}, detail: ${promptData.priceGrowth.detail}
- efficiencyGrowth: trend ${promptData.efficiencyGrowth.trend}/mo, impact ${promptData.efficiencyGrowth.impact}, detail: ${promptData.efficiencyGrowth.detail}
- topGrowthCategory: ${promptData.topGrowthCategory != null ? `${promptData.topGrowthCategory.category} (${promptData.topGrowthCategory.growthRate}%/6m)` : 'null'}

DETERMINISTIČNA PREDICTION (za referenco — AI lahko prilagodi znotraj anti-hallucination pravil):
- growthPrediction6m: ${promptData.growthPrediction6m}€
- growthRate6m: ${promptData.growthRate6m}% (clamped [-50, 200])
- compoundGrowthRate: ${promptData.compoundGrowthRate}%
- growthPotential: ${promptData.growthPotential}/100
- growthStage: ${promptData.growthStage}
- projectedMilestones: ${JSON.stringify(promptData.projectedMilestones)}

MESEČNI PODATKI (zadnjih ${promptData.monthsWithData} mesecev):
${JSON.stringify(promptData.monthlyData, null, 2)}

TOP GROWTH KATEGORIJE (zadnjih 6m vs prior 6m):
${JSON.stringify(promptData.topCatsForPrompt, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. prediction:
   - growthPrediction6m: pričakovani profit čez 6 mesecev (EUR, min 0)
   - growthRate6m: pričakovana mesečna growth rate za naslednjih 6m (clamped [-50, 200])
   - compoundGrowthRate: CAGR-style compound rate (clamped [-50, 200])
   - growthPotential: 0-100 (koliko headroom-a za rast obstaja)
   - growthStage: EARLY | ACCELERATING | MATURING | SATURATING (validiraj proti enum)
   - projectedMilestones: array z { target, monthsToReach, projectedDate (ISO date) } za 2x, 3x, 5x; prazni če growth ≤ 0
2. analysis:
   - growthDrivers: top 3 faktorji z driver, weight (0-100), detail
   - growthInhibitors: top 3 faktorji z inhibitor, impact, mitigation
   - growthActions: 3-5 konkretnih akcij z action, priority (HIGH/MEDIUM/LOW), expectedGrowthLift (npr. "+5%/mo")
3. summary: slovenski povzetek (max 500 znakov). NE izmišljuj številk — uporabi zgornje deterministične podatke.

VRNI LE JSON:
{
  "prediction": {
    "growthPrediction6m": 0,
    "growthRate6m": 0,
    "compoundGrowthRate": 0,
    "growthPotential": 0,
    "growthStage": "ACCELERATING",
    "projectedMilestones": [{ "target": "2x profit", "monthsToReach": 0, "projectedDate": "2026-01-01" }]
  },
  "analysis": {
    "growthDrivers": [{ "driver": "...", "weight": 50, "detail": "..." }],
    "growthInhibitors": [{ "inhibitor": "...", "impact": "...", "mitigation": "..." }],
    "growthActions": [{ "action": "...", "priority": "HIGH", "expectedGrowthLift": "+5%/mo" }]
  },
  "summary": "..."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeAiResult {
  prediction: GrowthPrediction;
  analysis: GrowthAnalysis;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoAnalysis(
  parsed: AiGrowthResponse | null,
  fallbackPrediction: GrowthPrediction,
  fallbackAnalysis: GrowthAnalysis,
  fallbackSummary: string,
  currentMonthlyProfit: number,
  growthRate6m: number,
  compoundGrowthRate: number,
  growthPotential: number,
  growthStage: GrowthStage,
  now: number,
): MergeAiResult {
  const result: MergeAiResult = {
    prediction: fallbackPrediction,
    analysis: fallbackAnalysis,
    summary: fallbackSummary,
    aiUsed: false,
  };

  if (!parsed || typeof parsed !== 'object') return result;

  if (parsed.prediction && typeof parsed.prediction === 'object') {
    const p = parsed.prediction as Record<string, unknown>;
    const aiGrowthRate6m = clampNumber(
      p.growthRate6m,
      -50,
      200,
      growthRate6m,
    );
    const aiCompound = clampNumber(
      p.compoundGrowthRate,
      -50,
      200,
      compoundGrowthRate,
    );
    const aiGrowthPrediction6m = Math.max(
      0,
      projectProfit(currentMonthlyProfit, aiGrowthRate6m, 6),
    );
    const aiPotential = clampNumber(
      p.growthPotential,
      0,
      100,
      growthPotential,
    );
    const aiStage = clampEnum(p.growthStage, VALID_STAGE, growthStage);

    const aiMilestones: ProjectedMilestone[] = [];
    for (const mult of [2, 3, 5]) {
      const months = monthsToReach(
        currentMonthlyProfit,
        aiGrowthRate6m,
        mult,
      );
      if (months == null) continue;
      const projectedDate = new Date(now + months * 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      aiMilestones.push({
        target: `${mult}x profit`,
        monthsToReach: months,
        projectedDate,
      });
    }

    result.prediction = {
      growthPrediction6m: aiGrowthPrediction6m,
      growthRate6m: round1(aiGrowthRate6m),
      compoundGrowthRate: round1(aiCompound),
      growthPotential: round0(aiPotential),
      growthStage: aiStage,
      projectedMilestones: aiMilestones,
    };
  }

  if (parsed.analysis && typeof parsed.analysis === 'object') {
    const a = parsed.analysis as Record<string, unknown>;

    if (Array.isArray(a.growthDrivers)) {
      result.analysis.growthDrivers = (a.growthDrivers as unknown[])
        .map((d: unknown) => {
          const dr = d as Record<string, unknown>;
          if (!dr || typeof dr !== 'object') return null;
          const driver = clampString(dr.driver, 100, '');
          if (!driver) return null;
          const weight = clampNumber(dr.weight, 0, 100, 50);
          const detail = clampString(dr.detail, 200, '');
          return { driver, weight: round0(weight), detail };
        })
        .filter((d): d is GrowthDriverItem => d !== null)
        .slice(0, 3);
    }

    if (Array.isArray(a.growthInhibitors)) {
      result.analysis.growthInhibitors = (a.growthInhibitors as unknown[])
        .map((d: unknown) => {
          const dr = d as Record<string, unknown>;
          if (!dr || typeof dr !== 'object') return null;
          const inhibitor = clampString(dr.inhibitor, 100, '');
          if (!inhibitor) return null;
          const impact = clampString(dr.impact, 200, '');
          const mitigation = clampString(dr.mitigation, 200, '');
          return { inhibitor, impact, mitigation };
        })
        .filter((d): d is GrowthInhibitor => d !== null)
        .slice(0, 3);
    }

    if (Array.isArray(a.growthActions)) {
      result.analysis.growthActions = (a.growthActions as unknown[])
        .map((d: unknown) => {
          const dr = d as Record<string, unknown>;
          if (!dr || typeof dr !== 'object') return null;
          const action = clampString(dr.action, 200, '');
          if (!action) return null;
          const priority = clampEnum(
            dr.priority,
            VALID_PRIORITY,
            'MEDIUM',
          );
          const expectedGrowthLift = clampString(
            dr.expectedGrowthLift,
            50,
            '',
          );
          return { action, priority, expectedGrowthLift };
        })
        .filter((d): d is GrowthAction => d !== null)
        .slice(0, 5);
    }
  }

  if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
    result.summary = clampString(parsed.summary, 500, fallbackSummary);
  }

  result.aiUsed = true;
  return result;
}

function buildDeterministicSummary(
  growthStage: GrowthStage,
  currentMonthlyProfit: number,
  growthRate6m: number,
  growthAcceleration: number,
  growthVolatility: number,
  growthPrediction6m: number,
  growthPotential: number,
  topGrowthCategory: TopGrowthCategory | null,
  projectedMilestones: ProjectedMilestone[],
): string {
  const driverSummary =
    topGrowthCategory != null
      ? ` Top category: ${topGrowthCategory.category} (${topGrowthCategory.growthRate}%/6m).`
      : '';
  const milestoneSummary =
    projectedMilestones.length > 0
      ? ` Milestones: ${projectedMilestones
          .map((m) => `${m.target} v ${m.monthsToReach} mo`)
          .join(', ')}.`
      : ' Ni dosegljivih milestone-ov pri trenutni rasti.';
  return (
    `Profit Growth: stage=${growthStage}, ` +
    `trenutni profit ${currentMonthlyProfit}€/mo, ` +
    `growth ${growthRate6m > 0 ? '+' : ''}${growthRate6m}%/mo ` +
    `(povprečno 6m), accel ${growthAcceleration > 0 ? '+' : ''}${growthAcceleration}, ` +
    `volatilnost ${growthVolatility}. ` +
    `6m projection: ${growthPrediction6m}€. ` +
    `Potential ${growthPotential}/100.` +
    driverSummary +
    milestoneSummary
  );
}

// --- Handler -------------------------------------------------------------

const profitGrowthPredictorHandler = withAiRoute<ProfitGrowthPredictorInput>({
  endpoint: '/api/ai/profit-growth-predictor',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored, identična logika za GET in POST
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const cutoff12m = new Date(now - 365 * 86_400_000);

    // 1) Query SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    });

    const agg = buildMonthlyAgg(soldTrades);
    const monthsWithData = agg.last12.length;

    // 2) Compute growth metrics
    const growthRates = monthlyGrowthRates(agg.last12);
    const lastGrowthRates = monthlyGrowthRates(agg.last6);

    const currentMonthlyProfit =
      agg.last12.length > 0 ? agg.last12[agg.last12.length - 1].profit : 0;

    const currentMonthlyGrowth =
      growthRates.length > 0 ? round1(growthRates[growthRates.length - 1]) : 0;

    const avgMonthlyGrowth6m =
      lastGrowthRates.length > 0 ? round1(avg(lastGrowthRates)) : 0;

    const recent3 = growthRates.slice(-3);
    const prior3 = growthRates.slice(-6, -3);
    const recent3Avg = recent3.length > 0 ? avg(recent3) : 0;
    const prior3Avg = prior3.length > 0 ? avg(prior3) : 0;
    const growthAcceleration = round1(recent3Avg - prior3Avg);

    const growthVolatility =
      growthRates.length > 1 ? round1(stdDev(growthRates)) : 0;

    const current: CurrentGrowthState = {
      currentMonthlyProfit,
      currentMonthlyGrowth,
      avgMonthlyGrowth6m,
      growthAcceleration,
      growthVolatility,
    };

    // Empty state — no historical sold trades
    if (monthsWithData === 0) {
      return apiOk({
        ok: true,
        current,
        drivers: {
          volumeGrowth: { trend: 0, impact: 'NEUTRAL', detail: '' },
          priceGrowth: { trend: 0, impact: 'NEUTRAL', detail: '' },
          efficiencyGrowth: { trend: 0, impact: 'NEUTRAL', detail: '' },
          topGrowthCategory: null,
        },
        prediction: {
          growthPrediction6m: 0,
          growthRate6m: 0,
          compoundGrowthRate: 0,
          growthPotential: 0,
          growthStage: 'EARLY',
          projectedMilestones: [],
        },
        analysis: {
          growthDrivers: [],
          growthInhibitors: [],
          growthActions: [],
        },
        summary:
          'Ni zgodovinskih prodaj (SOLD) v zadnjih 12 mesecih — Profit Growth Predictor ni mogoč.',
        aiUsed: false,
        message:
          'Ni zgodovinskih prodaj (SOLD) v zadnjih 12 mesecih — Profit Growth Predictor ni mogoč.',
      });
    }

    // 3) Build drivers
    const volumeSeries = agg.last12.map((b) => b.tradeCount);
    const volumeSlope = round1(trendSlope(volumeSeries));
    const volumeImpact = classifyImpact(volumeSlope, 0.5);
    const volumeGrowth: DriverInfo = {
      trend: volumeSlope,
      impact: volumeImpact,
      detail:
        volumeImpact === 'POSITIVE'
          ? `Trades/mesec rastejo (${volumeSlope > 0 ? '+' : ''}${volumeSlope}/mo)`
          : volumeImpact === 'NEGATIVE'
            ? `Trades/mesec padajo (${volumeSlope}/mo)`
            : `Trades/mesec stabilni (${volumeSlope}/mo)`,
    };

    const priceSeries = agg.last12.map((b) =>
      b.tradeCount > 0 ? b.profit / b.tradeCount : 0,
    );
    const priceSlope = round1(trendSlope(priceSeries));
    const priceImpact = classifyImpact(priceSlope, 1);
    const priceGrowth: DriverInfo = {
      trend: priceSlope,
      impact: priceImpact,
      detail:
        priceImpact === 'POSITIVE'
          ? `Profit/trade raste (${priceSlope > 0 ? '+' : ''}${priceSlope}€/trade/mo)`
          : priceImpact === 'NEGATIVE'
            ? `Profit/trade pada (${priceSlope}€/trade/mo)`
            : `Profit/trade stabilen (${priceSlope}€/trade/mo)`,
    };

    const efficiencySeries = agg.last12.map((b) => b.avgHoldDays);
    const efficiencySlope = round1(trendSlope(efficiencySeries));
    const efficiencyImpact = classifyImpact(-efficiencySlope, 0.5);
    const efficiencyGrowth: DriverInfo = {
      trend: efficiencySlope,
      impact: efficiencyImpact,
      detail:
        efficiencyImpact === 'POSITIVE'
          ? `Hold days se zmanjšujejo (${efficiencySlope}/mo — hitrejši turnover)`
          : efficiencyImpact === 'NEGATIVE'
            ? `Hold days se povečujejo (${efficiencySlope > 0 ? '+' : ''}${efficiencySlope}/mo — počasnejši turnover)`
            : `Hold days stabilni (${efficiencySlope}/mo)`,
    };

    const catGrowth = computeCategoryGrowth(soldTrades, now);
    const topGrowthCategory: TopGrowthCategory | null =
      catGrowth.length > 0 && catGrowth[0].growthRate > 0
        ? {
            category: catGrowth[0].category,
            growthRate: catGrowth[0].growthRate,
          }
        : null;

    const drivers: GrowthDrivers = {
      volumeGrowth,
      priceGrowth,
      efficiencyGrowth,
      topGrowthCategory,
    };

    // 4) Deterministic prediction (fallback / base)
    const baseGrowthRate = avgMonthlyGrowth6m;
    const growthRate6m = clampNumber(baseGrowthRate, -50, 200, 0);
    const compoundGrowthRate = clampNumber(
      computeCompoundRate(agg.last12),
      -50,
      200,
      0,
    );
    const growthPrediction6m = projectProfit(
      currentMonthlyProfit,
      growthRate6m,
      6,
    );

    let growthPotential = 50;
    growthPotential += Math.max(-30, Math.min(30, growthRate6m * 0.6));
    growthPotential += Math.max(-20, Math.min(20, growthAcceleration * 0.4));
    growthPotential -= Math.max(0, Math.min(15, growthVolatility * 0.3));
    if (monthsWithData < 6) growthPotential -= 15;
    growthPotential = Math.max(0, Math.min(100, round0(growthPotential)));

    const growthStage = computeGrowthStage(
      avgMonthlyGrowth6m,
      growthAcceleration,
      growthVolatility,
      monthsWithData,
    );

    const targets = [2, 3, 5];
    const projectedMilestones: ProjectedMilestone[] = [];
    for (const mult of targets) {
      const months = monthsToReach(currentMonthlyProfit, growthRate6m, mult);
      if (months == null) continue;
      const projectedDate = new Date(now + months * 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      projectedMilestones.push({
        target: `${mult}x profit`,
        monthsToReach: months,
        projectedDate,
      });
    }

    const prediction: GrowthPrediction = {
      growthPrediction6m,
      growthRate6m,
      compoundGrowthRate,
      growthPotential,
      growthStage,
      projectedMilestones,
    };

    // 5) AI cache check (6h TTL) — key by current month
    const currentMonthKey = monthKeyOf(new Date(now));
    const cacheKey = `profit-growth-predictor:${currentMonthKey}`;
    const cached = getCachedAI<{
      prediction: GrowthPrediction;
      analysis: GrowthAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        drivers,
        prediction: cached.prediction,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 6) Deterministic summary fallback
    const deterministicSummary = buildDeterministicSummary(
      growthStage,
      currentMonthlyProfit,
      growthRate6m,
      growthAcceleration,
      growthVolatility,
      growthPrediction6m,
      growthPotential,
      topGrowthCategory,
      projectedMilestones,
    );

    // 7) AI prompt with grounding
    const monthlyData = agg.last12.map((b) => ({
      month: b.monthKey,
      profit: b.profit,
      tradeCount: b.tradeCount,
      avgHoldDays: b.avgHoldDays,
    }));

    const topCatsForPrompt = catGrowth.slice(0, 10);

    const promptData: PromptContext = {
      currentMonthlyProfit,
      currentMonthlyGrowth,
      avgMonthlyGrowth6m,
      growthAcceleration,
      growthVolatility,
      monthsWithData,
      volumeGrowth,
      priceGrowth,
      efficiencyGrowth,
      topGrowthCategory,
      growthPrediction6m,
      growthRate6m,
      compoundGrowthRate,
      growthPotential,
      growthStage,
      projectedMilestones,
      monthlyData,
      topCatsForPrompt,
    };

    const prompt = buildPrompt(promptData);

    const fallbackAnalysis: GrowthAnalysis = {
      growthDrivers: [],
      growthInhibitors: [],
      growthActions: [],
    };

    let finalPrediction = prediction;
    let analysis: GrowthAnalysis = fallbackAnalysis;
    let summary = deterministicSummary;
    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiGrowthResponse | null;

      const merged = mergeAiIntoAnalysis(
        parsed,
        prediction,
        fallbackAnalysis,
        deterministicSummary,
        currentMonthlyProfit,
        growthRate6m,
        compoundGrowthRate,
        growthPotential,
        growthStage,
        now,
      );
      finalPrediction = merged.prediction;
      analysis = merged.analysis;
      summary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/profit-growth-predictor',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 8) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        prediction: finalPrediction,
        analysis,
        summary,
      });
    }

    return apiOk({
      ok: true,
      current,
      drivers,
      prediction: finalPrediction,
      analysis,
      summary,
      aiUsed,
    });
  },
});

export const GET = profitGrowthPredictorHandler;
export const POST = profitGrowthPredictorHandler;
