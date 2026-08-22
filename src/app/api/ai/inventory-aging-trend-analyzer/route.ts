// v7.88: AI Inventory Aging Trend Analyzer — AI analizira kako inventory
// aging pattern-i se spreminjajo čez čas — ali aging pospešuje ali upočasnjuje?
// Identificira aging trend-e per kategorijo in napove future aging issues.
// Razlika od inventory-aging-predictor-pro (v7.83 ki napove aging per item)
// — ta track-a AGING TRENDS na portfolio level čez 12 mesecev.
// "Aging trend: IMPROVING (hold days -2.5/mo). Current: 28d avg, 15% stale.
// 30d forecast: 25d avg, 2 stale items. Best: elektronika (18d)."
//
// Razlika od inventory-aging-predictor-pro (ki napove aging za posamezni
// item) — ta je PORTFOLIO-level trend analyzer z 12-mesečno monthly aging
// series. Razlika od inventory-aging-predictor (basic) — ta gleda TREND
// (acceleration) ne single prediction. Razlika od inventory-lifecycle-stage-
// classifier (v7.70 ki klasificira lifecycle stages) — ta gleda aging TIME
// SERIES čez mesece. Razlika od inventory-turnover-accelerator-pro (v7.85 ki
// pospešuje turnover) — ta analizira aging trajectory. Razlika od
// inventory-carrying-cost (ki meri holding cost) — ta gleda aging duration
// trend.
//
// GET+POST /api/ai/inventory-aging-trend-analyzer
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
interface InventoryAgingTrendAnalyzerInput {}

// --- Types ---------------------------------------------------------------

type AgingDirection = 'IMPROVING' | 'STABLE' | 'WORSENING';
type AgingRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type DriverImpact = 'POSITIVE' | 'NEGATIVE';
type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type CategoryDirection = 'IMPROVING' | 'STABLE' | 'WORSENING';

interface AgingTrends {
  avgHoldDaysTrend12m: number; // slope of avgHoldDays per month (negative = improving)
  staleRateTrend: number; // slope of staleRate per month (negative = improving)
  agingDirection: AgingDirection;
  agingMomentum: number; // acceleration of aging change
  currentAvgHoldDays: number;
  currentStaleRate: number; // %
  currentFastTurnoverRate: number; // %
}

interface MonthlyAgingDatum {
  month: string; // YYYY-MM
  avgHoldDays: number;
  staleRate: number; // % of items that took 60+ days
  fastTurnoverRate: number; // % of items sold in <14 days
  agingDistribution: Record<string, number>; // age bucket → %
}

interface CurrentAging {
  avgDaysHeld: number;
  agingDistribution: Record<string, number>; // age bucket → %
  staleCount: number; // held items >60 days
  freshCount: number; // held items <7 days
}

interface AgingForecast {
  projectedAvgHoldDays30d: number;
  projectedStaleItems30d: number;
  agingRiskLevel: AgingRiskLevel;
  agingTrendAssessment: string;
}

interface CategoryAgingAnalysis {
  category: string;
  avgHoldDays: number;
  trend: number; // slope per month
  direction: CategoryDirection;
  riskLevel: AgingRiskLevel;
}

interface AgingDriver {
  driver: string;
  impact: DriverImpact;
  weight: number; // 0-100
  detail: string;
}

interface AgingMitigationAction {
  action: string;
  priority: ActionPriority;
  expectedImpact: string;
}

interface AgingAnalysis {
  categoryAgingAnalysis: CategoryAgingAnalysis[];
  agingDrivers: AgingDriver[];
  agingMitigationActions: AgingMitigationAction[];
}

interface AiAgingResponse {
  forecast?: {
    agingTrendAssessment?: string;
    agingRiskLevel?: AgingRiskLevel;
    agingDrivers?: AgingDriver[];
    agingMitigationActions?: AgingMitigationAction[];
  };
  analysis?: {
    categoryAgingAnalysis?: Array<{
      category: string;
      direction?: CategoryDirection;
      riskLevel?: AgingRiskLevel;
    }>;
    agingDrivers?: AgingDriver[];
    agingMitigationActions?: AgingMitigationAction[];
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const HORIZON_12M = 365 * DAY_MS;
const HOLD_DAYS_MIN = 0;
const HOLD_DAYS_MAX = 180;
const RATE_MIN = 0;
const RATE_MAX = 100;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 100;
const STALE_THRESHOLD_DAYS = 60;
const FAST_TURNOVER_THRESHOLD_DAYS = 14;

const AGE_BUCKETS = ['0-7d', '7-14d', '14-30d', '30-60d', '60-90d', '90d+'];

const VALID_DIRECTION: readonly AgingDirection[] = ['IMPROVING', 'STABLE', 'WORSENING'];
const VALID_RISK: readonly AgingRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_IMPACT: readonly DriverImpact[] = ['POSITIVE', 'NEGATIVE'];
const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_CAT_DIRECTION: readonly CategoryDirection[] = ['IMPROVING', 'STABLE', 'WORSENING'];

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
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
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

// Linear regression slope (per month index)
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

// Classify aging direction — IMPROVING if hold days decreasing (negative slope)
function classifyAgingDirection(holdDaysTrend: number): AgingDirection {
  // Slope < -0.5 days/month = improving (faster sales)
  if (holdDaysTrend < -0.5) return 'IMPROVING';
  if (holdDaysTrend > 0.5) return 'WORSENING';
  return 'STABLE';
}

function classifyAgingRisk(
  avgHoldDays: number,
  staleRate: number,
  direction: AgingDirection,
): AgingRiskLevel {
  let score = 0;
  // Hold days: 0-30 LOW, 30-60 +1, 60-90 +2, 90+ +3
  if (avgHoldDays > 90) score += 3;
  else if (avgHoldDays > 60) score += 2;
  else if (avgHoldDays > 30) score += 1;
  // Stale rate: 0-15% +0, 15-30% +1, 30-50% +2, 50%+ +3
  if (staleRate > 50) score += 3;
  else if (staleRate > 30) score += 2;
  else if (staleRate > 15) score += 1;
  // Direction: WORSENING +1, IMPROVING -1
  if (direction === 'WORSENING') score += 1;
  else if (direction === 'IMPROVING') score -= 1;

  if (score >= 4) return 'HIGH';
  if (score >= 2) return 'MEDIUM';
  return 'LOW';
}

// --- Sold trade row ------------------------------------------------------

interface SoldTradeRow {
  buyDate: Date | null;
  sellDate: Date | null;
  category: string;
}

interface HeldTradeRow {
  buyDate: Date;
  category: string;
}

// --- Monthly aggregation -------------------------------------------------

interface MonthAgg {
  monthKey: string;
  monthMs: number;
  holdDaysSum: number;
  holdDaysCount: number;
  ageBuckets: Record<string, number>;
  staleCount: number;
  fastCount: number;
  total: number;
}

interface CatAgg {
  holdDaysSum: number;
  holdDaysCount: number;
  months: number[]; // monthly avg hold days series
  total: number;
}

// --- Deterministic analysis ----------------------------------------------

function buildDeterministicAssessment(
  trends: AgingTrends,
  current: CurrentAging,
): string {
  const parts: string[] = [];
  parts.push(`Aging trend: ${trends.agingDirection} (hold days trend ${trends.avgHoldDaysTrend12m >= 0 ? '+' : ''}${round2(trends.avgHoldDaysTrend12m)}d/mo, momentum ${round2(trends.agingMomentum)}).`);
  parts.push(`Current: ${round1(current.avgDaysHeld)}d avg hold, stale count ${current.staleCount} (>60d), fresh ${current.freshCount} (<7d).`);
  parts.push(`Stale rate: ${round1(trends.currentStaleRate)}%, fast turnover rate: ${round1(trends.currentFastTurnoverRate)}%.`);
  if (trends.agingDirection === 'IMPROVING') {
    parts.push('Aging se izboljšuje — inventory se prodaja hitreje. Vzdržuj trenutno pricing/sourcing strategijo.');
  } else if (trends.agingDirection === 'WORSENING') {
    parts.push('Aging se slabša — inventory se kopiči. Takojšnja akcija: znižaj cene stale items, povečaj promocijo.');
  } else {
    parts.push('Aging je stabilen — inventory turnover je v ravnovesju. Monitor naslednje 30 dni za confirmation.');
  }
  return parts.join(' ').slice(0, 800);
}

function buildDeterministicForecast(
  trends: AgingTrends,
  current: CurrentAging,
): AgingForecast {
  // Projected avg hold days = currentAvgHoldDays + trend × 1 month
  const proj30 = current.avgDaysHeld + trends.avgHoldDaysTrend12m;
  // Projected stale items = current stale count + (staleRateTrend × totalHeld / 100)
  const totalHeld = current.staleCount + current.freshCount; // rough proxy
  const projStaleItems = Math.max(
    0,
    round0(current.staleCount + (trends.staleRateTrend * (totalHeld + 1)) / 100),
  );
  const riskLevel = classifyAgingRisk(
    current.avgDaysHeld,
    trends.currentStaleRate,
    trends.agingDirection,
  );
  return {
    projectedAvgHoldDays30d: round1(
      Math.max(HOLD_DAYS_MIN, Math.min(HOLD_DAYS_MAX, proj30)),
    ),
    projectedStaleItems30d: projStaleItems,
    agingRiskLevel: riskLevel,
    agingTrendAssessment: buildDeterministicAssessment(trends, current),
  };
}

function buildDeterministicDrivers(
  trends: AgingTrends,
  monthlyData: MonthlyAgingDatum[],
): AgingDriver[] {
  const drivers: AgingDriver[] = [];
  // Trend driver — direction + magnitude
  const trendImpact: DriverImpact =
    trends.agingDirection === 'IMPROVING' ? 'POSITIVE'
    : trends.agingDirection === 'WORSENING' ? 'NEGATIVE'
    : 'POSITIVE';
  drivers.push({
    driver: 'Hold time trend',
    impact: trendImpact,
    weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.avgHoldDaysTrend12m) * 10)),
    detail: `Hold days trend ${trends.avgHoldDaysTrend12m >= 0 ? '+' : ''}${round2(trends.avgHoldDaysTrend12m)}d/mo — ${trends.agingDirection}.`,
  });
  // Stale rate driver
  const staleImpact: DriverImpact =
    trends.staleRateTrend < -0.5 ? 'POSITIVE'
    : trends.staleRateTrend > 0.5 ? 'NEGATIVE'
    : 'POSITIVE';
  drivers.push({
    driver: 'Stale rate trend',
    impact: staleImpact,
    weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.staleRateTrend) * 10)),
    detail: `Stale rate trend ${trends.staleRateTrend >= 0 ? '+' : ''}${round2(trends.staleRateTrend)}%/mo — ${trends.staleRateTrend > 0.5 ? 'kachlja inventory se kopiči' : trends.staleRateTrend < -0.5 ? 'stale items se zmanjšujejo' : 'stabilno'}.`,
  });
  // Volatility driver — stddev of monthly avgHoldDays
  const monthlyHoldDays = monthlyData.map((m) => m.avgHoldDays);
  const mean = avg(monthlyHoldDays);
  const variance = monthlyHoldDays.length > 1
    ? monthlyHoldDays.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / monthlyHoldDays.length
    : 0;
  const stddev = Math.sqrt(variance);
  const volImpact: DriverImpact = stddev > 15 ? 'NEGATIVE' : 'POSITIVE';
  drivers.push({
    driver: 'Aging volatility',
    impact: volImpact,
    weight: round0(Math.min(WEIGHT_MAX, stddev * 2)),
    detail: `Aging volatility ${round1(stddev)}d stddev — ${stddev > 15 ? 'nepredvidljiv' : 'konsistenten'} aging pattern.`,
  });
  // Momentum driver
  const momImpact: DriverImpact =
    trends.agingMomentum > 0.5 ? 'NEGATIVE'
    : trends.agingMomentum < -0.5 ? 'POSITIVE'
    : 'POSITIVE';
  drivers.push({
    driver: 'Aging momentum (acceleration)',
    impact: momImpact,
    weight: round0(Math.min(WEIGHT_MAX, Math.abs(trends.agingMomentum) * 10)),
    detail: `Momentum ${round2(trends.agingMomentum)} — ${trends.agingMomentum > 0.5 ? 'aging se pospešuje' : trends.agingMomentum < -0.5 ? 'aging se upočasnjuje' : 'stabilno'}.`,
  });
  // Sort by weight desc, take top 4
  drivers.sort((a, b) => b.weight - a.weight);
  return drivers.slice(0, 4);
}

function buildDeterministicMitigationActions(
  trends: AgingTrends,
  current: CurrentAging,
  forecast: AgingForecast,
): AgingMitigationAction[] {
  const actions: AgingMitigationAction[] = [];
  if (current.staleCount > 0) {
    actions.push({
      action: `Znižaj cene za ${current.staleCount} stale items (>60 dni) za 10-15%`,
      priority: 'HIGH',
      expectedImpact: 'Stale items prodani v 7-14 dneh — sproščen kapital',
    });
  }
  if (trends.agingDirection === 'WORSENING') {
    actions.push({
      action: 'Revizija pricing strategije — aging se slabša',
      priority: 'HIGH',
      expectedImpact: 'Povprečni hold days zmanjšan za 5-10 dni',
    });
  }
  if (forecast.agingRiskLevel === 'HIGH') {
    actions.push({
      action: 'Premisli liquidation sale za najstarejše items',
      priority: 'HIGH',
      expectedImpact: 'Stale inventory zmanjšan za 30-50%',
    });
  }
  if (trends.currentStaleRate > 30) {
    actions.push({
      action: 'Cross-platform listing za stale items (Bolha + Vinted + FB)',
      priority: 'MEDIUM',
      expectedImpact: 'Povečana izpostavljenost, hitrejša prodaja',
    });
  }
  if (trends.currentFastTurnoverRate < 20) {
    actions.push({
      action: 'Identificiraj best-selling categories in povečaj volumen',
      priority: 'MEDIUM',
      expectedImpact: 'Fast turnover rate povečan za 10-15%',
    });
  }
  if (actions.length === 0) {
    actions.push({
      action: 'Vzdržuj trenutno strategijo — aging je zdrav',
      priority: 'LOW',
      expectedImpact: 'Stabilni hold days in low stale rate',
    });
  }
  return actions.slice(0, 5);
}

function buildDeterministicSummary(
  trends: AgingTrends,
  current: CurrentAging,
  forecast: AgingForecast,
): string {
  const bestCat = ''; // filled by caller if available
  return `Aging trend: ${trends.agingDirection} (hold days ${trends.avgHoldDaysTrend12m >= 0 ? '+' : ''}${round2(trends.avgHoldDaysTrend12m)}/mo). Current: ${round1(current.avgDaysHeld)}d avg, ${round1(trends.currentStaleRate)}% stale. 30d forecast: ${forecast.projectedAvgHoldDays30d}d avg, ${forecast.projectedStaleItems30d} stale items.${bestCat}`.slice(0, 400);
}

// --- Extracted prompt helpers (pure, testable) ---------------------------

function buildPromptData(
  trends: AgingTrends,
  monthlyData: MonthlyAgingDatum[],
  current: CurrentAging,
  categoryAgingAnalysis: CategoryAgingAnalysis[],
  detForecast: AgingForecast,
  detDrivers: AgingDriver[],
  detActions: AgingMitigationAction[],
): unknown {
  return {
    trends,
    monthlyData,
    current,
    categoryAgingAnalysis,
    deterministicForecast: detForecast,
    deterministicDrivers: detDrivers,
    deterministicActions: detActions,
    caps: {
      holdDaysMin: HOLD_DAYS_MIN, holdDaysMax: HOLD_DAYS_MAX,
      rateMin: RATE_MIN, rateMax: RATE_MAX,
      weightMax: WEIGHT_MAX,
    },
  };
}

function buildPrompt(
  promptData: unknown,
  detForecastRiskLevel: AgingRiskLevel,
): string {
  return `Si AI "Inventory Aging Trend Analyzer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Facebook, Avtonet, mobile.de).
Analiziraš kako inventory aging pattern-i se spreminjajo čez čas — ali aging pospešuje ali upočasnjuje? Identificiraš aging trend-e per kategorijo in napoveš future aging issues.

DETERMINISTIČNI PODATKI (izračunano iz DB):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. forecast: {
   - agingTrendAssessment: slovenski povzetek (max 800 znakov) — kaj driver-ja aging spremembe, ali je trend vzdržen, kaj pomeni za trading decisions.
   - agingRiskLevel: LOW | MEDIUM | HIGH (validirana proti deterministični ${detForecastRiskLevel})
   - agingDrivers: 3-4 driver-ji z { driver (max 100, slovensko), impact: POSITIVE | NEGATIVE, weight: 0-100, detail (max 200, slovensko) }
   - agingMitigationActions: 3-5 akcij z { action (max 200, slovensko), priority: HIGH | MEDIUM | LOW, expectedImpact (max 200, slovensko) }
}
2. summary: slovenski povzetek (max 400 znakov). NE izmišljuj številk — uporabi zgornje deterministične.

VRNI LE JSON:
{
  "forecast": {
    "agingTrendAssessment": "Aging trend: IMPROVING (hold days -2.5/mo, momentum -0.4). Current 28d avg, 15% stale. Driver: pricing optimizacija. Stale items: 3 (>60d). 30d forecast: 25d avg, 2 stale items.",
    "agingRiskLevel": "MEDIUM",
    "agingDrivers": [
      { "driver": "Hold time trend", "impact": "POSITIVE", "weight": 75, "detail": "Hold days se zmanjšujejo -2.5d/mo — pricing strategija je učinkovita." },
      { "driver": "Stale rate trend", "impact": "POSITIVE", "weight": 60, "detail": "Stale rate pada -0.8%/mo — manj kopičenja inventory." }
    ],
    "agingMitigationActions": [
      { "action": "Znižaj cene za 3 stale items (>60 dni) za 10-15%", "priority": "HIGH", "expectedImpact": "Stale items prodani v 7-14 dneh — sproščen kapital" }
    ]
  },
  "summary": "Aging trend: IMPROVING (hold days -2.5/mo). Current: 28d avg, 15% stale. 30d forecast: 25d avg, 2 stale items. Best: elektronika (18d)."
}${GROUNDING_PROMPT_SUFFIX}`;
}

interface MergeAiResult {
  forecast: AgingForecast;
  analysis: AgingAnalysis;
  summary: string;
  aiUsed: boolean;
}

function mergeAiIntoAnalysis(
  parsed: AiAgingResponse | null,
  detForecast: AgingForecast,
  detAnalysis: AgingAnalysis,
  detSummary: string,
  trends: AgingTrends,
  current: CurrentAging,
): MergeAiResult {
  const result: MergeAiResult = {
    forecast: { ...detForecast },
    analysis: {
      categoryAgingAnalysis: [...detAnalysis.categoryAgingAnalysis],
      agingDrivers: [...detAnalysis.agingDrivers],
      agingMitigationActions: [...detAnalysis.agingMitigationActions],
    },
    summary: detSummary,
    aiUsed: false,
  };

  if (!parsed || typeof parsed !== 'object') return result;

  // Handle forecast object (preferred) or analysis object
  const aiForecast = parsed.forecast;
  const aiAnalysis = parsed.analysis;

  if (aiForecast && typeof aiForecast === 'object') {
    const f = aiForecast as {
      agingTrendAssessment?: string;
      agingRiskLevel?: AgingRiskLevel;
      agingDrivers?: AgingDriver[];
      agingMitigationActions?: AgingMitigationAction[];
    };

    if (typeof f.agingTrendAssessment === 'string' && f.agingTrendAssessment.trim()) {
      result.forecast.agingTrendAssessment = clampString(
        f.agingTrendAssessment,
        800,
        detForecast.agingTrendAssessment,
      );
    }

    if (f.agingRiskLevel != null) {
      result.forecast.agingRiskLevel = clampEnum(
        f.agingRiskLevel,
        VALID_RISK,
        detForecast.agingRiskLevel,
      );
    }

    // Drivers
    let driversSource: AgingDriver[] | undefined;
    if (Array.isArray(f.agingDrivers)) driversSource = f.agingDrivers;
    else if (aiAnalysis && Array.isArray(aiAnalysis.agingDrivers)) driversSource = aiAnalysis.agingDrivers;

    if (driversSource) {
      const aiDrivers = driversSource
        .map((d) => {
          if (!d || typeof d !== 'object') return null;
          const driver = clampString(d.driver, 100, '');
          if (!driver) return null;
          const impact = clampEnum(d.impact, VALID_IMPACT, 'POSITIVE');
          const weight = round0(clampNumber(d.weight, WEIGHT_MIN, WEIGHT_MAX, 50));
          const detail = clampString(d.detail, 200, '');
          if (!detail) return null;
          return { driver, impact, weight, detail };
        })
        .filter((d): d is AgingDriver => d !== null)
        .slice(0, 4);
      if (aiDrivers.length > 0) result.analysis.agingDrivers = aiDrivers;
    }

    // Mitigation actions
    let actionsSource: AgingMitigationAction[] | undefined;
    if (Array.isArray(f.agingMitigationActions)) actionsSource = f.agingMitigationActions;
    else if (aiAnalysis && Array.isArray(aiAnalysis.agingMitigationActions)) actionsSource = aiAnalysis.agingMitigationActions;

    if (actionsSource) {
      const aiActions = actionsSource
        .map((a) => {
          if (!a || typeof a !== 'object') return null;
          const action = clampString(a.action, 200, '');
          if (!action) return null;
          const priority = clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM');
          const expectedImpact = clampString(a.expectedImpact, 200, '');
          if (!expectedImpact) return null;
          return { action, priority, expectedImpact };
        })
        .filter((a): a is AgingMitigationAction => a !== null)
        .slice(0, 5);
      if (aiActions.length > 0) result.analysis.agingMitigationActions = aiActions;
    }

    // Per-category analysis (from aiAnalysis if present)
    if (aiAnalysis && Array.isArray(aiAnalysis.categoryAgingAnalysis)) {
      const aiCats = aiAnalysis.categoryAgingAnalysis as Array<{
        category: string;
        direction?: CategoryDirection;
        riskLevel?: AgingRiskLevel;
      }>;
      // Merge AI direction/riskLevel into existing categoryAgingAnalysis
      const merged = result.analysis.categoryAgingAnalysis.map((c) => {
        const aiMatch = aiCats.find((ac) => ac.category === c.category);
        if (aiMatch) {
          return {
            ...c,
            direction: aiMatch.direction
              ? clampEnum(aiMatch.direction, VALID_CAT_DIRECTION, c.direction)
              : c.direction,
            riskLevel: aiMatch.riskLevel
              ? clampEnum(aiMatch.riskLevel, VALID_RISK, c.riskLevel)
              : c.riskLevel,
          };
        }
        return c;
      });
      result.analysis.categoryAgingAnalysis = merged;
    }
  }

  if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
    result.summary = clampString(
      parsed.summary,
      400,
      buildDeterministicSummary(trends, current, detForecast),
    );
  }

  result.aiUsed = true;
  return result;
}

// --- Handler -------------------------------------------------------------

const inventoryAgingTrendAnalyzerHandler = withAiRoute<InventoryAgingTrendAnalyzerInput>({
  endpoint: '/api/ai/inventory-aging-trend-analyzer',
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
    const cutoff12m = new Date(now - HORIZON_12M);

    // 1) Query all SOLD trades from last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null, gte: cutoff12m },
      },
      select: {
        buyDate: true,
        sellDate: true,
        category: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // 2) Group by month AND compute aging metrics
    const monthlyMap = new Map<string, MonthAgg>();
    const catMap = new Map<string, CatAgg>();

    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      const buyMs = toMs(t.buyDate);
      if (sellMs <= 0 || buyMs <= 0) continue;
      const d = new Date(sellMs);
      const monthKey = monthKeyOf(d);
      const monthMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

      let mAgg = monthlyMap.get(monthKey);
      if (!mAgg) {
        mAgg = {
          monthKey,
          monthMs,
          holdDaysSum: 0,
          holdDaysCount: 0,
          ageBuckets: {},
          staleCount: 0,
          fastCount: 0,
          total: 0,
        };
        for (const b of AGE_BUCKETS) mAgg.ageBuckets[b] = 0;
        monthlyMap.set(monthKey, mAgg);
      }

      const holdDays = (sellMs - buyMs) / DAY_MS;
      if (holdDays > 0 && holdDays < 3650) {
        mAgg.holdDaysSum += holdDays;
        mAgg.holdDaysCount += 1;
        // Age bucket
        let bucket = '90d+';
        if (holdDays < 7) bucket = '0-7d';
        else if (holdDays < 14) bucket = '7-14d';
        else if (holdDays < 30) bucket = '14-30d';
        else if (holdDays < 60) bucket = '30-60d';
        else if (holdDays < 90) bucket = '60-90d';
        mAgg.ageBuckets[bucket] = (mAgg.ageBuckets[bucket] ?? 0) + 1;
        mAgg.total += 1;
        if (holdDays >= STALE_THRESHOLD_DAYS) mAgg.staleCount += 1;
        if (holdDays < FAST_TURNOVER_THRESHOLD_DAYS) mAgg.fastCount += 1;
      }

      // Per-category aggregation (use Trade.category)
      const cat = (t.category ?? '').trim().toLowerCase() || 'brez_kategorije';
      let cAgg = catMap.get(cat);
      if (!cAgg) {
        cAgg = { holdDaysSum: 0, holdDaysCount: 0, months: [], total: 0 };
        catMap.set(cat, cAgg);
      }
      if (holdDays > 0 && holdDays < 3650) {
        cAgg.holdDaysSum += holdDays;
        cAgg.holdDaysCount += 1;
        cAgg.total += 1;
      }
    }

    // Compute monthly avg hold days per category for trend
    const catMonthlySeries = new Map<string, { monthMs: number; avgHoldDays: number }[]>();
    for (const t of soldTrades) {
      const sellMs = toMs(t.sellDate);
      const buyMs = toMs(t.buyDate);
      if (sellMs <= 0 || buyMs <= 0) continue;
      const holdDays = (sellMs - buyMs) / DAY_MS;
      if (holdDays <= 0 || holdDays >= 3650) continue;
      const cat = (t.category ?? '').trim().toLowerCase() || 'brez_kategorije';
      const d = new Date(sellMs);
      const monthMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      let arr = catMonthlySeries.get(cat);
      if (!arr) {
        arr = [];
        catMonthlySeries.set(cat, arr);
      }
      arr.push({ monthMs, avgHoldDays: holdDays });
    }
    // Aggregate per-category per-month
    const catMonthlyAgg = new Map<string, Map<number, { sum: number; count: number }>>();
    for (const [cat, arr] of catMonthlySeries.entries()) {
      const monthMap = new Map<number, { sum: number; count: number }>();
      for (const item of arr) {
        let m = monthMap.get(item.monthMs);
        if (!m) {
          m = { sum: 0, count: 0 };
          monthMap.set(item.monthMs, m);
        }
        m.sum += item.avgHoldDays;
        m.count += 1;
      }
      catMonthlyAgg.set(cat, monthMap);
    }

    // Empty state
    if (monthlyMap.size === 0) {
      return apiOk({
        ok: true,
        trends: {
          avgHoldDaysTrend12m: 0,
          staleRateTrend: 0,
          agingDirection: 'STABLE',
          agingMomentum: 0,
          currentAvgHoldDays: 0,
          currentStaleRate: 0,
          currentFastTurnoverRate: 0,
        },
        monthlyData: [],
        current: {
          avgDaysHeld: 0,
          agingDistribution: {},
          staleCount: 0,
          freshCount: 0,
        },
        forecast: {
          projectedAvgHoldDays30d: 0,
          projectedStaleItems30d: 0,
          agingRiskLevel: 'LOW',
          agingTrendAssessment: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Aging Trend Analyzer ni mogoč.',
        },
        analysis: {
          categoryAgingAnalysis: [],
          agingDrivers: [],
          agingMitigationActions: [],
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Aging Trend Analyzer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Aging Trend Analyzer ni mogoč.',
      });
    }

    // 3) Build monthly data sorted
    const sortedMonths = Array.from(monthlyMap.values()).sort((a, b) => a.monthMs - b.monthMs);
    const monthlyData: MonthlyAgingDatum[] = sortedMonths.map((m) => {
      const avgHoldDays = m.holdDaysCount > 0 ? m.holdDaysSum / m.holdDaysCount : 0;
      const staleRate = m.total > 0 ? (m.staleCount / m.total) * 100 : 0;
      const fastTurnoverRate = m.total > 0 ? (m.fastCount / m.total) * 100 : 0;
      const agingDistribution: Record<string, number> = {};
      for (const b of AGE_BUCKETS) {
        agingDistribution[b] = m.total > 0 ? round1(((m.ageBuckets[b] ?? 0) / m.total) * 100) : 0;
      }
      return {
        month: m.monthKey,
        avgHoldDays: round1(avgHoldDays),
        staleRate: round1(staleRate),
        fastTurnoverRate: round1(fastTurnoverRate),
        agingDistribution,
      };
    });

    // 4) Compute aging trends
    const monthlyHoldDays = monthlyData.map((m) => m.avgHoldDays);
    const monthlyStaleRates = monthlyData.map((m) => m.staleRate);
    const avgHoldDaysTrend12m = trendSlope(monthlyHoldDays);
    const staleRateTrend = trendSlope(monthlyStaleRates);
    const agingDirection = classifyAgingDirection(avgHoldDaysTrend12m);
    const agingMomentum = computeAcceleration(monthlyHoldDays);

    // 5) Query current HELD trades for current aging state
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        buyDate: true,
        category: true,
      },
      take: 10000,
    }) as unknown as HeldTradeRow[];

    const heldAges = heldTrades.map((t) => {
      const buyMs = toMs(t.buyDate);
      if (buyMs <= 0) return 0;
      return (now - buyMs) / DAY_MS;
    }).filter((d) => d >= 0 && d < 3650);

    const currentAvgDaysHeld = heldAges.length > 0 ? avg(heldAges) : 0;
    const currentAgingDist: Record<string, number> = {};
    for (const b of AGE_BUCKETS) currentAgingDist[b] = 0;
    let currentStaleCount = 0;
    let currentFreshCount = 0;
    for (const d of heldAges) {
      let bucket = '90d+';
      if (d < 7) { bucket = '0-7d'; currentFreshCount += 1; }
      else if (d < 14) bucket = '7-14d';
      else if (d < 30) bucket = '14-30d';
      else if (d < 60) bucket = '30-60d';
      else if (d < 90) bucket = '60-90d';
      if (d >= STALE_THRESHOLD_DAYS) currentStaleCount += 1;
      currentAgingDist[bucket] = (currentAgingDist[bucket] ?? 0) + 1;
    }
    // Convert to percentages
    const totalHeld = heldAges.length;
    for (const b of AGE_BUCKETS) {
      currentAgingDist[b] = totalHeld > 0
        ? round1((currentAgingDist[b] / totalHeld) * 100)
        : 0;
    }

    const currentStaleRate = totalHeld > 0
      ? (currentStaleCount / totalHeld) * 100
      : (monthlyStaleRates[monthlyStaleRates.length - 1] ?? 0);
    const currentFastTurnoverRate = monthlyData.length > 0
      ? (monthlyData[monthlyData.length - 1]!.fastTurnoverRate)
      : 0;

    const trends: AgingTrends = {
      avgHoldDaysTrend12m: round2(avgHoldDaysTrend12m),
      staleRateTrend: round2(staleRateTrend),
      agingDirection,
      agingMomentum: round2(agingMomentum),
      currentAvgHoldDays: round1(monthlyHoldDays[monthlyHoldDays.length - 1] ?? 0),
      currentStaleRate: round1(currentStaleRate),
      currentFastTurnoverRate: round1(currentFastTurnoverRate),
    };

    const current: CurrentAging = {
      avgDaysHeld: round1(currentAvgDaysHeld),
      agingDistribution: currentAgingDist,
      staleCount: currentStaleCount,
      freshCount: currentFreshCount,
    };

    // 6) Build deterministic analysis (fallback)
    const detForecast = buildDeterministicForecast(trends, current);
    const detDrivers = buildDeterministicDrivers(trends, monthlyData);
    const detActions = buildDeterministicMitigationActions(trends, current, detForecast);

    // Per-category aging analysis (deterministic)
    const categoryAgingAnalysis: CategoryAgingAnalysis[] = [];
    for (const [cat, monthMap] of catMonthlyAgg.entries()) {
      const sortedCatMonths = Array.from(monthMap.entries()).sort((a, b) => a[0] - b[0]);
      const catMonthlyAvgs = sortedCatMonths.map(([, v]) => v.count > 0 ? v.sum / v.count : 0);
      if (catMonthlyAvgs.length < 1) continue;
      const catTrend = trendSlope(catMonthlyAvgs);
      const catAvg = avg(catMonthlyAvgs);
      const catDirection: CategoryDirection = catTrend < -0.5 ? 'IMPROVING' : catTrend > 0.5 ? 'WORSENING' : 'STABLE';
      const catRisk = classifyAgingRisk(catAvg, 0, catDirection);
      categoryAgingAnalysis.push({
        category: cat,
        avgHoldDays: round1(catAvg),
        trend: round2(catTrend),
        direction: catDirection,
        riskLevel: catRisk,
      });
    }
    categoryAgingAnalysis.sort((a, b) => b.avgHoldDays - a.avgHoldDays);

    let forecast: AgingForecast = detForecast;
    let analysis: AgingAnalysis = {
      categoryAgingAnalysis,
      agingDrivers: detDrivers,
      agingMitigationActions: detActions,
    };
    let finalSummary = buildDeterministicSummary(trends, current, detForecast);

    // 7) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now);
    const monthKey = `${currentMonth.getFullYear()}-${(currentMonth.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
    const cacheKey = `inventory-aging-trend-analyzer:${monthKey}`;
    const cached = getCachedAI<{
      forecast: AgingForecast;
      analysis: AgingAnalysis;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        trends,
        monthlyData,
        current,
        forecast: cached.forecast,
        analysis: cached.analysis,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      });
    }

    // 8) AI prompt with grounding
    const promptData = buildPromptData(
      trends,
      monthlyData,
      current,
      categoryAgingAnalysis,
      detForecast,
      detDrivers,
      detActions,
    );
    const prompt = buildPrompt(promptData, detForecast.agingRiskLevel);

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiAgingResponse | null;

      const merged = mergeAiIntoAnalysis(
        parsed,
        detForecast,
        analysis,
        finalSummary,
        trends,
        current,
      );
      forecast = merged.forecast;
      analysis = merged.analysis;
      finalSummary = merged.summary;
      aiUsed = merged.aiUsed;
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-aging-trend-analyzer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 9) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, {
        forecast,
        analysis,
        summary: finalSummary,
      });
    }

    return apiOk({
      ok: true,
      trends,
      monthlyData,
      current,
      forecast,
      analysis,
      summary: finalSummary,
      aiUsed,
    });
  },
});

export const GET = inventoryAgingTrendAnalyzerHandler;
export const POST = inventoryAgingTrendAnalyzerHandler;
