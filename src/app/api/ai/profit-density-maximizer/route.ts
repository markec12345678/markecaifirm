// v8.14: AI Profit Density Maximizer — MAKSIMIZIRA PROFIT DENSITY — profit
// pridobljen na enoto aktivnosti (per listing, per kategorijo, per uro
// vlaganja v sourcing). Višja gostota = več profit-a z manj truda. "Tvoj
// profit density je 12€/h. Z fokuso na high-density niches lahko dosežeš
// 14€/h (×1.18)." Razlika od profit-per-cycle-maximizer (v8.12 ki
// maksimizira profit per cycle €/cycle z maximizationLevers in
// cycleVsVolumeTradeoff) — ta MAKSIMIZIRA PROFIT DENSITY (profit per ura +
// per kategorija + per listing, ne per-cycle €). Razlika od
// profit-per-trade-scaling-maximizer (v8.13 ki skalira profit per trade skozi
// 4-fazno pot CURRENT→OPTIMIZED→PREMIUM→ELITE) — ta MAKSIMIZIRA PROFIT
// DENSITY (profit per unit aktivnosti, ne per-trade € scaling). Razlika od
// deal-source-profit-compounding-maximizer (v8.14 ki maksimizira compounding
// profit growth čez deal sources z reinvestment prioritizacijo) — ta
// MAKSIMIZIRA PROFIT DENSITY (profit per ura/per kategorijo snapshot, ne
// compounding annual profit growth). Razlika od inventory-working-capital-
// maximizer (v8.14 ki maksimizira working capital efficiency med fast in
// slow movers) — ta MAKSIMIZIRA PROFIT DENSITY (profit per unit aktivnosti,
// ne capital turnover × margin). Razlika od profit-per-euro-maximizer (v8.07
// ki maksimizira profit per € deployed) — ta MAKSIMIZIRA PROFIT DENSITY
// (profit per ura + per kategorijo + per listing, ne € profit / € capital).

// GET+POST /api/ai/profit-density-maximizer
// (Deterministic formula-based maximizer — no AI call, no DB query.)

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type DensityGrade = 'A' | 'B' | 'C' | 'D';
type OptimalStrategy =
  | 'FOCUS_HIGH_DENSITY_NICHES'
  | 'REDUCE_LOW_DENSITY_TRADING'
  | 'MAINTAIN_CURRENT_MIX';

interface ProfitDensityResponse {
  ok: true;
  current: {
    profitPerHour: number; // €/h [0, 10000]
    profitPerCategory: number; // € [0, 100000]
    profitPerListing: number; // € [0, 10000]
    densityScore: number; // [0, 100]
  };
  maximization: {
    maximizedDensity: number; // [0, 100]
    maximizationFactor: number; // 1.18 (constant uplift)
    densityGrade: DensityGrade;
    optimalStrategy: OptimalStrategy;
    focusNiches: string[];
  };
  aiUsed: boolean;
  source: string;
}

// --- Constants ----------------------------------------------------------

const MAXIMIZATION_FACTOR = 1.18; // typical density uplift when focusing on high-density niches
const FOCUS_NICHES = ['electronics', 'sneakers', 'tools'];

const PROFIT_HOUR_MIN = 0;
const PROFIT_HOUR_MAX = 10_000;
const PROFIT_CATEGORY_MIN = 0;
const PROFIT_CATEGORY_MAX = 100_000;
const PROFIT_LISTING_MIN = 0;
const PROFIT_LISTING_MAX = 10_000;
const TRADES_PER_MONTH_MIN = 0;
const TRADES_PER_MONTH_MAX = 1_000;
const HOURS_PER_TRADE_MIN = 0.1;
const HOURS_PER_TRADE_MAX = 500;
const CATEGORY_COUNT_MIN = 1;
const CATEGORY_COUNT_MAX = 100;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

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

// --- Inputs -------------------------------------------------------------

interface ProfitDensityInputs {
  avgProfitPerTrade: number; // €
  tradesPerMonth: number;
  hoursInvestedPerTrade: number;
  categoryCount: number;
}

// Async helper — reads body once if POST + JSON, then merges with query.
async function resolveInputs(req: NextRequest): Promise<ProfitDensityInputs> {
  const defaults: ProfitDensityInputs = {
    avgProfitPerTrade: 25,
    tradesPerMonth: 8,
    hoursInvestedPerTrade: 2.5,
    categoryCount: 3,
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
        // Clone so we don't consume the body for downstream consumers (none here, but safe).
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
    // Body takes precedence over query (POST is more explicit intent)
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
    avgProfitPerTrade: pickNum(
      'avgProfitPerTrade',
      0,
      100_000,
      defaults.avgProfitPerTrade,
    ),
    tradesPerMonth: pickNum(
      'tradesPerMonth',
      TRADES_PER_MONTH_MIN,
      TRADES_PER_MONTH_MAX,
      defaults.tradesPerMonth,
    ),
    hoursInvestedPerTrade: pickNum(
      'hoursInvestedPerTrade',
      HOURS_PER_TRADE_MIN,
      HOURS_PER_TRADE_MAX,
      defaults.hoursInvestedPerTrade,
    ),
    categoryCount: pickNum(
      'categoryCount',
      CATEGORY_COUNT_MIN,
      CATEGORY_COUNT_MAX,
      defaults.categoryCount,
    ),
  };
}

// --- Deterministic computation ------------------------------------------

function decideDensityGrade(score: number): DensityGrade {
  if (score >= 70) return 'A';
  if (score >= 50) return 'B';
  if (score >= 30) return 'C';
  return 'D';
}

function decideOptimalStrategy(score: number): OptimalStrategy {
  if (score >= 70) return 'MAINTAIN_CURRENT_MIX';
  if (score >= 50) return 'FOCUS_HIGH_DENSITY_NICHES';
  if (score >= 30) return 'REDUCE_LOW_DENSITY_TRADING';
  return 'FOCUS_HIGH_DENSITY_NICHES';
}

function computeMaximization(inputs: ProfitDensityInputs): {
  current: ProfitDensityResponse['current'];
  maximization: ProfitDensityResponse['maximization'];
} {
  const { avgProfitPerTrade, tradesPerMonth, hoursInvestedPerTrade, categoryCount } = inputs;

  // profitPerHour = avgProfitPerTrade / hoursInvestedPerTrade
  const profitPerHour = round2(clampNum(
    hoursInvestedPerTrade > 0
      ? avgProfitPerTrade / hoursInvestedPerTrade
      : 0,
    PROFIT_HOUR_MIN,
    PROFIT_HOUR_MAX,
    0,
  ));

  // profitPerCategory = (avgProfitPerTrade * tradesPerMonth) / categoryCount
  const safeCategoryCount = Math.max(1, categoryCount);
  const profitPerCategory = round2(clampNum(
    (avgProfitPerTrade * tradesPerMonth) / safeCategoryCount,
    PROFIT_CATEGORY_MIN,
    PROFIT_CATEGORY_MAX,
    0,
  ));

  // profitPerListing — normalized by listings viewed.
  // Simplified: per-trade average equals per-listing (one trade ~ one listing).
  const profitPerListing = round2(clampNum(
    avgProfitPerTrade,
    PROFIT_LISTING_MIN,
    PROFIT_LISTING_MAX,
    0,
  ));

  // densityScore = clamp((profitPerHour * 0.5 + profitPerCategory * 0.3 + avgProfitPerTrade * 0.2) / 10, 0, 100)
  const rawScore =
    (profitPerHour * 0.5 + profitPerCategory * 0.3 + avgProfitPerTrade * 0.2) / 10;
  const densityScore = round2(clampScore(rawScore));

  // maximizedDensity = densityScore * 1.18 (maximization factor)
  const maximizedDensity = round2(clampScore(densityScore * MAXIMIZATION_FACTOR));

  const densityGrade = decideDensityGrade(densityScore);
  const optimalStrategy = decideOptimalStrategy(densityScore);

  return {
    current: {
      profitPerHour,
      profitPerCategory,
      profitPerListing,
      densityScore,
    },
    maximization: {
      maximizedDensity,
      maximizationFactor: MAXIMIZATION_FACTOR,
      densityGrade,
      optimalStrategy,
      focusNiches: FOCUS_NICHES,
    },
  };
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitDensityMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleProfitDensityMaximizer(req);
}

async function handleProfitDensityMaximizer(req: NextRequest) {
  try {
    const inputs = await resolveInputs(req);
    const { current, maximization } = computeMaximization(inputs);

    return NextResponse.json({
      ok: true,
      current,
      maximization,
      aiUsed: false,
      source: 'v8.14-profit-density-maximizer',
    } satisfies ProfitDensityResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-density-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
