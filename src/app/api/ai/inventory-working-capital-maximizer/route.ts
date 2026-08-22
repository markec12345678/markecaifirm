// v8.14 / v8.96.2-batch3: AI Inventory Working Capital Maximizer — MAKSIMIZIRA WORKING
// CAPITAL EFFICIENCY — minimizira kapital vezan v slow-moving inventory,
// maksimizira kapital v fast-movers. "Tvoj working capital turnover je 32×/leto
// z 28% weighted margin. Capital efficiency score 18/100. Z shiftanjem 70%
// kapitala v fast movers lahko dosežeš 22/100 (×1.22)." Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital
// efficiency per item z reallocation) — ta MAKSIMIZIRA WORKING CAPITAL
// EFFICIENCY (turnover × margin combined score, ne per-item capital
// efficiency). Razlika od inventory-capital-efficiency-growth-maximizer (v8.12
// ki maksimizira capital efficiency growth %/mo) — ta MAKSIMIZIRA WORKING
// CAPITAL EFFICIENCY snapshot (turnover × margin × fast/slow mix, ne %/mo
// growth rate). Razlika od inventory-cash-conversion-maximizer (ki
// maksimizira cash conversion cycle) — ta MAKSIMIZIRA WORKING CAPITAL
// EFFICIENCY (turnover × margin × fast/slow mix, ne cash conversion cycle
// days). Razlika od profit-density-maximizer (v8.14 ki maksimizira profit
// density per ura/per kategorijo) — ta MAKSIMIZIRA WORKING CAPITAL
// EFFICIENCY (turnover × weighted margin, ne profit per unit aktivnosti).
// Razlika od deal-source-profit-compounding-maximizer (v8.14 ki maksimizira
// compounding profit growth čez deal sources) — ta MAKSIMIZIRA WORKING
// CAPITAL EFFICIENCY med fast in slow movers (capital turnover × margin,
// ne compounding annual profit growth). Razlika od inventory-annual-yield-
// maximizer (v8.11 ki maksimizira annual yield inventory-ja) — ta
// MAKSIMIZIRA WORKING CAPITAL EFFICIENCY (turnover × weighted margin z
// fast/slow mix, ne letni yield %).
//
// GET+POST /api/ai/inventory-working-capital-maximizer
// (Deterministic formula-based maximizer — no AI call, no DB query.)
//
// Refaktoriran z withAiRoute helperjem (v8.96.2-batch3) — enforceBudget: true
// (konsistentno z vsemi AI route-i vključno z deterministic endpoint-i ki so
// bile migrirane v v8.96.2-batch1 profit-density-maximizer in v8.96.2-batch2
// deal-source-profit-compounding-maximizer — vse z method: 'GET' za dual-handler
// support in enforceBudget: true za budget guard konsistentnost).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type CapitalGrade = 'A' | 'B' | 'C' | 'D';
type OptimalStrategy =
  | 'SHIFT_CAPITAL_TO_FAST_MOVERS'
  | 'LIQUIDATE_SLOW_MOVERS'
  | 'BALANCE_PORTFOLIO';

interface WorkingCapitalResponse {
  ok: true;
  current: {
    workingCapitalTurnover: number; // ×/year [0, 500]
    weightedProfitMargin: number; // % [0, 100]
    capitalEfficiencyScore: number; // [0, 100]
    fastMoverCapitalPct: number; // [0, 1]
  };
  maximization: {
    maximizedCapitalEfficiency: number; // [0, 100]
    maximizationFactor: number; // 1.22 (constant uplift)
    capitalGrade: CapitalGrade;
    optimalStrategy: OptimalStrategy;
    recommendedFastMoverPct: number; // 0.7 (constant target)
  };
  aiUsed: boolean;
  source: string;
}

// --- Constants ----------------------------------------------------------

const MAXIMIZATION_FACTOR = 1.22; // shift more capital to fast movers
const RECOMMENDED_FAST_MOVER_PCT = 0.7; // target fast-mover capital share

const TURNOVER_MIN = 0;
const TURNOVER_MAX = 500;
const MARGIN_MIN = 0;
const MARGIN_MAX = 100;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const CAPITAL_DEPLOYED_MIN = 0;
const CAPITAL_DEPLOYED_MAX = 100_000_000;
const FAST_MOVER_PCT_MIN = 0;
const FAST_MOVER_PCT_MAX = 1;
const DAYS_TO_SELL_MIN = 1;
const DAYS_TO_SELL_MAX = 730;
const PROFIT_MARGIN_MIN = 0;
const PROFIT_MARGIN_MAX = 100;

// --- Inputs -------------------------------------------------------------

interface WorkingCapitalInputs {
  capitalDeployed: number; // €
  fastMoverCapitalPct: number; // [0, 1]
  avgDaysToSellFast: number;
  avgDaysToSellSlow: number;
  avgProfitMarginFast: number; // %
  avgProfitMarginSlow: number; // %
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryWorkingCapitalMaximizerInput extends WorkingCapitalInputs {}

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
async function resolveInputs(req: NextRequest): Promise<InventoryWorkingCapitalMaximizerInput> {
  const defaults: WorkingCapitalInputs = {
    capitalDeployed: 1500,
    fastMoverCapitalPct: 0.55,
    avgDaysToSellFast: 7,
    avgDaysToSellSlow: 45,
    avgProfitMarginFast: 25,
    avgProfitMarginSlow: 35,
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
    capitalDeployed: pickNum(
      'capitalDeployed',
      CAPITAL_DEPLOYED_MIN,
      CAPITAL_DEPLOYED_MAX,
      defaults.capitalDeployed,
    ),
    fastMoverCapitalPct: pickNum(
      'fastMoverCapitalPct',
      FAST_MOVER_PCT_MIN,
      FAST_MOVER_PCT_MAX,
      defaults.fastMoverCapitalPct,
    ),
    avgDaysToSellFast: pickNum(
      'avgDaysToSellFast',
      DAYS_TO_SELL_MIN,
      DAYS_TO_SELL_MAX,
      defaults.avgDaysToSellFast,
    ),
    avgDaysToSellSlow: pickNum(
      'avgDaysToSellSlow',
      DAYS_TO_SELL_MIN,
      DAYS_TO_SELL_MAX,
      defaults.avgDaysToSellSlow,
    ),
    avgProfitMarginFast: pickNum(
      'avgProfitMarginFast',
      PROFIT_MARGIN_MIN,
      PROFIT_MARGIN_MAX,
      defaults.avgProfitMarginFast,
    ),
    avgProfitMarginSlow: pickNum(
      'avgProfitMarginSlow',
      PROFIT_MARGIN_MIN,
      PROFIT_MARGIN_MAX,
      defaults.avgProfitMarginSlow,
    ),
  };
}

// --- Deterministic computation ------------------------------------------

function decideCapitalGrade(score: number): CapitalGrade {
  if (score >= 70) return 'A';
  if (score >= 50) return 'B';
  if (score >= 30) return 'C';
  return 'D';
}

function decideOptimalStrategy(
  score: number,
  fastMoverCapitalPct: number,
): OptimalStrategy {
  // Heuristic: low fast-mover share → shift capital; very low score →
  // liquidate slow movers; balanced → maintain portfolio mix.
  if (fastMoverCapitalPct < 0.4) return 'SHIFT_CAPITAL_TO_FAST_MOVERS';
  if (score < 30) return 'LIQUIDATE_SLOW_MOVERS';
  if (score >= 70) return 'BALANCE_PORTFOLIO';
  return 'SHIFT_CAPITAL_TO_FAST_MOVERS';
}

function computeMaximization(inputs: WorkingCapitalInputs): {
  current: WorkingCapitalResponse['current'];
  maximization: WorkingCapitalResponse['maximization'];
} {
  const {
    fastMoverCapitalPct,
    avgDaysToSellFast,
    avgDaysToSellSlow,
    avgProfitMarginFast,
    avgProfitMarginSlow,
  } = inputs;

  // capitalDeployed is accepted as input but does not change the efficiency
  // score (efficiency is turnover × margin, capital-independent). Kept for
  // API symmetry / future per-€ normalization.
  void inputs.capitalDeployed;

  const fastTurnover = 365 / Math.max(1, avgDaysToSellFast);
  const slowTurnover = 365 / Math.max(1, avgDaysToSellSlow);

  // workingCapitalTurnover = fast% × (365/daysFast) + slow% × (365/daysSlow)
  const workingCapitalTurnover = round2(clampNum(
    fastMoverCapitalPct * fastTurnover + (1 - fastMoverCapitalPct) * slowTurnover,
    TURNOVER_MIN,
    TURNOVER_MAX,
    0,
  ));

  // weightedProfitMargin = fast% × marginFast + slow% × marginSlow
  const weightedProfitMargin = round2(clampNum(
    fastMoverCapitalPct * avgProfitMarginFast +
      (1 - fastMoverCapitalPct) * avgProfitMarginSlow,
    MARGIN_MIN,
    MARGIN_MAX,
    0,
  ));

  // capitalEfficiencyScore = clamp((turnover × margin) / 50, 0, 100)
  const rawScore = (workingCapitalTurnover * weightedProfitMargin) / 50;
  const capitalEfficiencyScore = round2(clampScore(rawScore));

  // maximizedCapitalEfficiency = score × 1.22
  const maximizedCapitalEfficiency = round2(
    clampScore(capitalEfficiencyScore * MAXIMIZATION_FACTOR),
  );

  const capitalGrade = decideCapitalGrade(capitalEfficiencyScore);
  const optimalStrategy = decideOptimalStrategy(
    capitalEfficiencyScore,
    fastMoverCapitalPct,
  );

  return {
    current: {
      workingCapitalTurnover,
      weightedProfitMargin,
      capitalEfficiencyScore,
      fastMoverCapitalPct,
    },
    maximization: {
      maximizedCapitalEfficiency,
      maximizationFactor: MAXIMIZATION_FACTOR,
      capitalGrade,
      optimalStrategy,
      recommendedFastMoverPct: RECOMMENDED_FAST_MOVER_PCT,
    },
  };
}

// --- Handler -------------------------------------------------------------

const inventoryWorkingCapitalMaximizerHandler = withAiRoute<InventoryWorkingCapitalMaximizerInput>({
  endpoint: '/api/ai/inventory-working-capital-maximizer',
  maxDuration: 60,
  enforceBudget: true, // v8.96.2-batch3: budget guard (konsistentno z vsemi AI route-i)
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => {
    return await resolveInputs(req);
  },

  // No validateInput — vsi input-i imajo defaults

  handler: async (input, _ctx: AiRouteContext) => {
    const { current, maximization } = computeMaximization(input);

    const response: WorkingCapitalResponse = {
      ok: true,
      current,
      maximization,
      aiUsed: false,
      source: 'v8.14-inventory-working-capital-maximizer',
    };
    return apiOk(response);
  },
});

// AI Hub runner compatibility — body is ignored, identical logic.
export const GET = inventoryWorkingCapitalMaximizerHandler;
export const POST = inventoryWorkingCapitalMaximizerHandler;
