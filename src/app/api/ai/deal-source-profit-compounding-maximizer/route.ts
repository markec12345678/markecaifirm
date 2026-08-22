// v8.14 / v8.96.2-batch2: AI Deal Source Profit Compounding Maximizer — MAKSIMIZIRA
// COMPOUNDING profit growth čez deal sources — reinvestira profit iz enega
// source-a v višji-yield source-ih. Compound growth rate maximizer. "Tvoj
// compounding rate je 30€/mo/source. Z prioritizacijo high-yield source-ov
// lahko dosežeš 4140€ annual compounded (×1.15)." Razlika od
// profit-compounding-maximizer (v8.04 ki maksimizira compounding reinvest
// rate na nivoju portfolio) — ta MAKSIMIZIRA COMPOUNDING čez DEAL SOURCES
// (per-source compounding + source prioritization, ne portfolio-level
// reinvest rate). Razlika od profit-density-maximizer (v8.14 ki maksimizira
// profit density per ura/per kategorijo) — ta MAKSIMIZIRA COMPOUNDING annual
// profit growth čez sources (ne profit per unit aktivnosti snapshot).
// Razlika od inventory-working-capital-maximizer (v8.14 ki maksimizira
// working capital efficiency med fast in slow movers) — ta MAKSIMIZIRA
// COMPOUNDING profit growth (reinvestment × source count × growth rate, ne
// capital turnover × margin). Razlika od capital-growth-maximizer (ki
// maksimizira capital growth z reinvestment rate) — ta MAKSIMIZIRA COMPOUNDING
// PROFIT čez deal sources (source prioritization + exponential growth curve,
// ne generic capital growth). Razlika od profit-growth-rate-maximizer (v8.11
// ki maksimizira growth rate skupnega profit-a v %/mo MoM) — ta MAKSIMIZIRA
// COMPOUNDING annual profit z reinvestRate × sourceCount × growthRate
// exponent (compounding math, ne linear MoM growth).
//
// Refaktoriran z withAiRoute helperjem (v8.96.2-batch2) + enforceBudget guard.
// SHARED handler za GET in POST (obe metodi kličeta isto logiko — match-a
// brain/accuracy/backfill vzorec z method: 'GET' bypass POST-only check).
// DETERMINISTIC — endpoint ne kliče AI direktno; enforceBudget: true je
// non-breaking (konsistentno z vsemi v8.96.x migracijami).
//
// GET+POST /api/ai/deal-source-profit-compounding-maximizer
// (Deterministic formula-based maximizer — no AI call, no DB query.)

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type CompoundingGrade = 'A' | 'B' | 'C' | 'D';
type OptimalStrategy =
  | 'PRIORITIZE_HIGH_YIELD_SOURCES'
  | 'INCREASE_REINVESTMENT'
  | 'DIVERSIFY_SOURCES';
type ProjectedGrowthCurve = 'EXPONENTIAL';

interface CompoundingResponse {
  ok: true;
  current: {
    monthlyCompoundingRate: number; // €/mo per source [0, 100000]
    compoundedAnnualProfit: number; // € [0, 10000000]
    compoundingScore: number; // [0, 100]
    reinvestRate: number; // [0, 1]
  };
  maximization: {
    maximizedCompoundedProfit: number; // € [0, 10000000]
    sourcePrioritization: number; // 1.15 (constant uplift factor)
    compoundingGrade: CompoundingGrade;
    optimalStrategy: OptimalStrategy;
    projectedGrowthCurve: ProjectedGrowthCurve;
  };
  aiUsed: boolean;
  source: string;
}

// --- Constants ----------------------------------------------------------

const SOURCE_PRIORITIZATION = 1.15; // optimization via source prioritization
const PROJECTED_GROWTH_CURVE: ProjectedGrowthCurve = 'EXPONENTIAL';

const MONTHLY_COMPOUNDING_MIN = 0;
const MONTHLY_COMPOUNDING_MAX = 100_000;
const ANNUAL_PROFIT_MIN = 0;
const ANNUAL_PROFIT_MAX = 10_000_000;
const MAXIMIZED_PROFIT_MIN = 0;
const MAXIMIZED_PROFIT_MAX = 10_000_000;
const REINVEST_RATE_MIN = 0;
const REINVEST_RATE_MAX = 1;
const SOURCE_COUNT_MIN = 1;
const SOURCE_COUNT_MAX = 100;
const GROWTH_RATE_MIN = -100;
const GROWTH_RATE_MAX = 1000;
const AVG_MONTHLY_PROFIT_MIN = 0;
const AVG_MONTHLY_PROFIT_MAX = 1_000_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

// --- Inputs -------------------------------------------------------------

interface CompoundingInputs {
  avgMonthlyProfit: number; // €
  reinvestRate: number; // [0, 1]
  sourceCount: number;
  avgProfitGrowthRate: number; // %
}

// --- Helpers ------------------------------------------------------------

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, v));
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

// Async helper — reads body once if POST + JSON, then merges with query.
async function resolveInputs(req: import('next/server').NextRequest): Promise<CompoundingInputs> {
  const defaults: CompoundingInputs = {
    avgMonthlyProfit: 200,
    reinvestRate: 0.6,
    sourceCount: 4,
    avgProfitGrowthRate: 5,
  };

  let queryParams: URLSearchParams | null = null;
  try {
    const url = new URL(req.url);
    queryParams = url.searchParams;
  } catch {
    queryParams = null;
  }

  let bodyParams: Record<string, unknown> | null = null;
  if (req.method === 'POST') {
    try {
      const ct = req.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const cloned = req.clone();
        const parsed = (await cloned.json()) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          bodyParams = parsed;
        }
      }
    } catch {
      bodyParams = null;
    }
  }

  const pickNum = (
    key: string,
    min: number,
    max: number,
    fallback: number,
  ): number => {
    if (bodyParams && key in bodyParams) {
      return clampNum(bodyParams[key], min, max, fallback);
    }
    if (queryParams) {
      const qv = queryParams.get(key);
      if (qv != null && qv !== '') {
        return clampNum(qv, min, max, fallback);
      }
    }
    return fallback;
  };

  return {
    avgMonthlyProfit: pickNum(
      'avgMonthlyProfit',
      AVG_MONTHLY_PROFIT_MIN,
      AVG_MONTHLY_PROFIT_MAX,
      defaults.avgMonthlyProfit,
    ),
    reinvestRate: pickNum(
      'reinvestRate',
      REINVEST_RATE_MIN,
      REINVEST_RATE_MAX,
      defaults.reinvestRate,
    ),
    sourceCount: pickNum(
      'sourceCount',
      SOURCE_COUNT_MIN,
      SOURCE_COUNT_MAX,
      defaults.sourceCount,
    ),
    avgProfitGrowthRate: pickNum(
      'avgProfitGrowthRate',
      GROWTH_RATE_MIN,
      GROWTH_RATE_MAX,
      defaults.avgProfitGrowthRate,
    ),
  };
}

// --- Deterministic computation ------------------------------------------

function decideCompoundingGrade(score: number): CompoundingGrade {
  if (score >= 70) return 'A';
  if (score >= 50) return 'B';
  if (score >= 30) return 'C';
  return 'D';
}

function decideOptimalStrategy(
  score: number,
  reinvestRate: number,
  sourceCount: number,
): OptimalStrategy {
  // Heuristic: low reinvest → increase it; few sources → diversify;
  // otherwise prioritize high-yield.
  if (reinvestRate < 0.4) return 'INCREASE_REINVESTMENT';
  if (sourceCount < 3) return 'DIVERSIFY_SOURCES';
  if (score >= 50) return 'PRIORITIZE_HIGH_YIELD_SOURCES';
  return 'INCREASE_REINVESTMENT';
}

function computeMaximization(inputs: CompoundingInputs): {
  current: CompoundingResponse['current'];
  maximization: CompoundingResponse['maximization'];
} {
  const { avgMonthlyProfit, reinvestRate, sourceCount, avgProfitGrowthRate } = inputs;

  const safeSourceCount = Math.max(1, sourceCount);

  // monthlyCompoundingRate = (avgMonthlyProfit * reinvestRate) / sourceCount
  const monthlyCompoundingRate = round2(clampNum(
    (avgMonthlyProfit * reinvestRate) / safeSourceCount,
    MONTHLY_COMPOUNDING_MIN,
    MONTHLY_COMPOUNDING_MAX,
    0,
  ));

  // compoundedAnnualProfit = avgMonthlyProfit * 12 * (1 + (growth/100) * reinvestRate)^sourceCount
  const growthFraction = (avgProfitGrowthRate / 100) * reinvestRate;
  const compoundFactor = Math.pow(1 + growthFraction, safeSourceCount);
  const compoundedAnnualProfit = round2(clampNum(
    avgMonthlyProfit * 12 * compoundFactor,
    ANNUAL_PROFIT_MIN,
    ANNUAL_PROFIT_MAX,
    0,
  ));

  // compoundingScore = clamp((compoundedAnnualProfit / 5000) * 100, 0, 100)
  const rawScore = (compoundedAnnualProfit / 5000) * 100;
  const compoundingScore = round2(clampScore(rawScore));

  // maximizedCompoundedProfit = compoundedAnnualProfit * 1.15
  const maximizedCompoundedProfit = round2(clampNum(
    compoundedAnnualProfit * SOURCE_PRIORITIZATION,
    MAXIMIZED_PROFIT_MIN,
    MAXIMIZED_PROFIT_MAX,
    0,
  ));

  const compoundingGrade = decideCompoundingGrade(compoundingScore);
  const optimalStrategy = decideOptimalStrategy(
    compoundingScore,
    reinvestRate,
    sourceCount,
  );

  return {
    current: {
      monthlyCompoundingRate,
      compoundedAnnualProfit,
      compoundingScore,
      reinvestRate,
    },
    maximization: {
      maximizedCompoundedProfit,
      sourcePrioritization: SOURCE_PRIORITIZATION,
      compoundingGrade,
      optimalStrategy,
      projectedGrowthCurve: PROJECTED_GROWTH_CURVE,
    },
  };
}

// --- Handler -------------------------------------------------------------

const compoundingHandler = withAiRoute<CompoundingInputs>({
  endpoint: '/api/ai/deal-source-profit-compounding-maximizer',
  maxDuration: 60,
  enforceBudget: true, // v8.96.2-batch2: budget guard (konsistentno z vsemi AI route-i)
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  // GET + POST — parse iz query string-a (GET) ali POST body-ja
  parseBody: async (req) => resolveInputs(req),

  // Brez validateInput — vsa polja so optional, defaults se uporabijo
  handler: async (inputs, _ctx: AiRouteContext) => {
    const { current, maximization } = computeMaximization(inputs);

    return apiOk({
      ok: true,
      current,
      maximization,
      aiUsed: false,
      source: 'v8.14-deal-source-profit-compounding-maximizer',
    } satisfies CompoundingResponse);
  },
});

export const GET = compoundingHandler;
export const POST = compoundingHandler;
