// v8.15: Profit Brain — synthesizes 6 profit signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the FIRST Brain layer that sits ABOVE the 404
// specialist endpoints (e.g. profit-growth-rate-maximizer, profit-multiplier-
// maximizer, profit-density-maximizer). Each specialist measures ONE profit
// dimension. The Profit Brain reads trade history + capital context and
// synthesizes 6 profit signals (growth, scale, efficiency, velocity,
// compounding, horizon) into:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d profit projections
//   - overall profit grade (weighted across 6 signals)
//   - one-line summary that names the single biggest lever
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via ProfitBrainInput). It is
// fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

export interface ProfitBrainInput {
  // Recent trade history (optional — Brain degrades gracefully if missing)
  monthlyProfits?: number[]; // last 12 months, oldest → newest (EUR/mo)
  avgProfitPerTrade?: number; // EUR
  tradesPerMonth?: number;
  capitalDeployed?: number; // EUR
}

export type ProfitSignalName =
  | 'growth'
  | 'scale'
  | 'efficiency'
  | 'velocity'
  | 'compounding'
  | 'horizon';

export type ProfitGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProfitSignal {
  name: ProfitSignalName;
  score: number; // 0-100 normalized
  grade: ProfitGrade;
  upliftEURPerMonth: number; // normalized expected €/month uplift if this signal is maximized
  topLever: string; // human-readable action lever
}

export interface ProfitBrainAction {
  rank: number;
  domain: string; // 'profit' for v8.15
  signal: ProfitSignalName;
  action: string; // human-readable, e.g. "Dodaj 2 monitorja za PS5 < 350€"
  expectedUpliftEUR: number; // €/month
  confidence: Confidence;
}

export interface ProfitBrainResult {
  ok: true;
  signals: ProfitSignal[]; // exactly 6 entries
  current: {
    monthlyProfit: number; // €/mo (most recent)
    profitGrowthRate: number; // % MoM
    avgProfitPerTrade: number;
    tradesPerMonth: number;
    capitalDeployed: number;
  };
  maximization: {
    topActions: ProfitBrainAction[]; // up to 3 actions, ranked by expectedUpliftEUR × confidence
    projection30d: number; // EUR/mo projected after 30d of executing top actions
    projection90d: number; // EUR/mo projected after 90d
    profitGrade: ProfitGrade; // weighted across 6 signals
    bestOpportunity: ProfitSignalName; // signal with highest upliftEURPerMonth
    oneLineSummary: string;
  };
  aiUsed: false;
  source: 'v8.15-profit-brain';
  cachedAt?: number; // set by caller when served from cache
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_MONTHLY_PROFITS: number[] = [
  200, 220, 250, 240, 280, 300, 320, 350, 380, 400, 420, 450,
];
const DEFAULT_AVG_PROFIT_PER_TRADE = 30;
const DEFAULT_TRADES_PER_MONTH = 10;
const DEFAULT_CAPITAL_DEPLOYED = 1500;

// --- Helpers --------------------------------------------------------------

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function gradeFromScore(score: number): ProfitGrade {
  if (!Number.isFinite(score)) return 'F';
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function confidenceWeight(c: Confidence): number {
  switch (c) {
    case 'HIGH':
      return 1.0;
    case 'MEDIUM':
      return 0.7;
    case 'LOW':
      return 0.4;
  }
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Linear regression slope (Δy per step) of a numeric series.
 * Returns 0 if fewer than 2 points. Used for MoM growth-rate computation.
 */
function linearRegressionSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  if (den === 0) return 0;
  return num / den;
}

// --- Signal formulas ------------------------------------------------------

interface NormalizedInput {
  monthlyProfits: number[];
  avgProfitPerTrade: number;
  tradesPerMonth: number;
  capitalDeployed: number;
  monthlyProfit: number; // most recent month
  profitGrowthRate: number; // % MoM (linear-regression based)
}

function normalizeInput(input: ProfitBrainInput | undefined | null): NormalizedInput {
  const monthlyProfits =
    input?.monthlyProfits && Array.isArray(input.monthlyProfits) && input.monthlyProfits.length > 0
      ? input.monthlyProfits.filter((v) => Number.isFinite(v)).map((v) => v)
      : DEFAULT_MONTHLY_PROFITS.slice();

  const avgProfitPerTrade =
    input?.avgProfitPerTrade != null && Number.isFinite(input.avgProfitPerTrade)
      ? input.avgProfitPerTrade
      : DEFAULT_AVG_PROFIT_PER_TRADE;

  const tradesPerMonth =
    input?.tradesPerMonth != null && Number.isFinite(input.tradesPerMonth)
      ? input.tradesPerMonth
      : DEFAULT_TRADES_PER_MONTH;

  const capitalDeployed =
    input?.capitalDeployed != null && Number.isFinite(input.capitalDeployed)
      ? input.capitalDeployed
      : DEFAULT_CAPITAL_DEPLOYED;

  const monthlyProfit = monthlyProfits[monthlyProfits.length - 1] ?? 0;

  // MoM growth rate from linear regression: slope / mean × 100 (in %).
  const meanProfit = monthlyProfits.length > 0
    ? monthlyProfits.reduce((a, b) => a + b, 0) / monthlyProfits.length
    : 0;
  const slope = linearRegressionSlope(monthlyProfits);
  const profitGrowthRate = meanProfit > 0 ? (slope / meanProfit) * 100 : 0;

  return {
    monthlyProfits,
    avgProfitPerTrade,
    tradesPerMonth,
    capitalDeployed,
    monthlyProfit,
    profitGrowthRate,
  };
}

/**
 * 1. growth — % MoM growth rate (linear regression on monthlyProfits).
 *    Score = clamp(growth% × 8, 0, 100). Uplift = monthlyProfit × growth% × 1.5.
 */
function computeGrowthSignal(norm: NormalizedInput): ProfitSignal {
  const growthPct = norm.profitGrowthRate; // already in %
  const score = clamp(growthPct * 8, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.monthlyProfit * (growthPct / 100) * 1.5));
  return {
    name: 'growth',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: 'Pospeši MoM growth — dodaj 2 monitorja za PS5 < 350€ in povečaj re-listing frekvenco',
  };
}

/**
 * 2. scale — profit multiplier potential.
 *    Score = clamp(tradesPerMonth × avgProfitPerTrade / 100, 0, 100).
 *    Uplift = tradesPerMonth × avgProfitPerTrade × 0.3.
 */
function computeScaleSignal(norm: NormalizedInput): ProfitSignal {
  const score = clamp((norm.tradesPerMonth * norm.avgProfitPerTrade) / 100, 0, 100);
  const upliftEURPerMonth = round2(norm.tradesPerMonth * norm.avgProfitPerTrade * 0.3);
  return {
    name: 'scale',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: 'Skaliraj volume — dodaj še 1 aktiven Bolha/Vinted listing dnevno (5 novih/mesec)',
  };
}

/**
 * 3. efficiency — profit per euro deployed.
 *    Score = clamp((avgProfitPerTrade / max(capitalDeployed, 1)) × 100 × 5, 0, 100).
 *    Uplift = capitalDeployed × 0.05.
 */
function computeEfficiencySignal(norm: NormalizedInput): ProfitSignal {
  const safeCapital = Math.max(norm.capitalDeployed, 1);
  const score = clamp((norm.avgProfitPerTrade / safeCapital) * 100 * 5, 0, 100);
  const upliftEURPerMonth = round2(norm.capitalDeployed * 0.05);
  return {
    name: 'efficiency',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: 'Povečaj efficiency — zvišaj cene 5 najbolj iskanih itemov za 8–12 %',
  };
}

/**
 * 4. velocity — profit per day = tradesPerMonth × avgProfitPerTrade / 30.
 *    Score = clamp(profitPerDay × 5, 0, 100).
 *    Uplift = profitPerDay × 30 × 0.2.
 */
function computeVelocitySignal(norm: NormalizedInput): ProfitSignal {
  const profitPerDay = (norm.tradesPerMonth * norm.avgProfitPerTrade) / 30;
  const score = clamp(profitPerDay * 5, 0, 100);
  const upliftEURPerMonth = round2(profitPerDay * 30 * 0.2);
  return {
    name: 'velocity',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: 'Povečaj velocity — skrajšaj povprečno prodajno iz 14 na 9 dni z boljšo fotko + ceno',
  };
}

/**
 * 5. compounding — reinvest rate impact.
 *    Score = clamp((monthlyProfit × 0.6 / max(capitalDeployed, 1)) × 100, 0, 100).
 *    Uplift = monthlyProfit × 0.18.
 */
function computeCompoundingSignal(norm: NormalizedInput): ProfitSignal {
  const safeCapital = Math.max(norm.capitalDeployed, 1);
  const score = clamp(((norm.monthlyProfit * 0.6) / safeCapital) * 100, 0, 100);
  const upliftEURPerMonth = round2(norm.monthlyProfit * 0.18);
  return {
    name: 'compounding',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: 'Reinvestiraj 80 % mesečnega profit-a v 2 nova high-yield lota (PS5 + iPhone)',
  };
}

/**
 * 6. horizon — 30/90d projection trajectory.
 *    Projection30d is computed in synthesis. For the standalone signal we use
 *    a preliminary estimate: currentMonthlyProfit + sumOfAllOtherUplifts × (1/3).
 *    Score = clamp(projection30d / max(monthlyProfit, 1) × 50, 0, 100).
 *    Uplift = projection90d - monthlyProfit.
 *
 * Note: this signal is computed AFTER the other 5 because it depends on their
 * uplifts. The synthesis function passes a precomputed projection30d here.
 */
function computeHorizonSignal(
  norm: NormalizedInput,
  projection30d: number,
  projection90d: number,
): ProfitSignal {
  const safeMonthly = Math.max(norm.monthlyProfit, 1);
  const score = clamp((projection30d / safeMonthly) * 50, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, projection90d - norm.monthlyProfit));
  return {
    name: 'horizon',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: 'Postavi 90d cilj — 90 dni z vsemi akcijami izvedenimi → +projection dosežen',
  };
}

// --- Synthesis ------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<ProfitSignalName, number> = {
  growth: 0.20,
  scale: 0.20,
  efficiency: 0.15,
  velocity: 0.15,
  compounding: 0.15,
  horizon: 0.15,
};

function actionForSignal(signal: ProfitSignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'growth':
      return `Pospesi rast: ${signal.topLever}`;
    case 'scale':
      return `Skaliraj volume: ${signal.topLever}`;
    case 'efficiency':
      return `Zvišaj efficiency: ${signal.topLever}`;
    case 'velocity':
      return `Pospeši velocity: ${signal.topLever}`;
    case 'compounding':
      return `Vklopi compounding: ${signal.topLever}`;
    case 'horizon':
      return `Drži 90d horizont: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

function buildOneLineSummary(
  monthlyProfit: number,
  projection30d: number,
  bestLever: ProfitSignalName,
  topActions: ProfitBrainAction[],
): string {
  const pct = monthlyProfit > 0
    ? Math.round(((projection30d - monthlyProfit) / monthlyProfit) * 100)
    : 0;
  const leverLabel = bestLever.toUpperCase();
  const a0 = topActions[0]?.action ?? '';
  const a1 = topActions[1]?.action ?? '';
  const a2 = topActions[2]?.action ?? '';
  const actions = [a0, a1, a2].filter(Boolean).join(', ');
  return `Profit ${Math.round(monthlyProfit)}€/mo → ${Math.round(projection30d)}€/mo (+${pct}%) z ${leverLabel}; danes: ${actions}.`;
}

/**
 * Profit Brain — pure deterministic compute.
 * Takes optional ProfitBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 profit signals, top 3 actions, 30d/90d projection,
 * overall profit grade, and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function profitBrain(input?: ProfitBrainInput): ProfitBrainResult {
  const norm = normalizeInput(input);

  // --- Compute 5 of 6 signals first (horizon depends on others) -----------
  const growth = computeGrowthSignal(norm);
  const scale = computeScaleSignal(norm);
  const efficiency = computeEfficiencySignal(norm);
  const velocity = computeVelocitySignal(norm);
  const compounding = computeCompoundingSignal(norm);

  const preHorizonSignals: ProfitSignal[] = [
    growth,
    scale,
    efficiency,
    velocity,
    compounding,
  ];

  const sumUplifts = preHorizonSignals.reduce((a, s) => a + s.upliftEURPerMonth, 0);

  // --- Horizon signal (depends on preliminary 30d projection) -------------
  const preliminaryProjection30d =
    norm.monthlyProfit + (sumUplifts / Math.max(norm.monthlyProfit, 1) / 3) * norm.monthlyProfit;
  const preliminaryProjection90d =
    norm.monthlyProfit + (sumUplifts / Math.max(norm.monthlyProfit, 1) * 0.7) * norm.monthlyProfit;
  const horizon = computeHorizonSignal(
    norm,
    preliminaryProjection30d,
    preliminaryProjection90d,
  );

  const signals: ProfitSignal[] = [...preHorizonSignals, horizon];

  // --- Weighted overall profit grade ---------------------------------------
  const weightedScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const profitGrade = gradeFromScore(weightedScore);

  // --- Top 3 actions (sorted by uplift × confidence weight) ---------------
  const ranked = signals
    .map((s) => {
      const confidence = confidenceFromScore(s.score);
      return {
        signal: s,
        confidence,
        rankScore: s.upliftEURPerMonth * confidenceWeight(confidence),
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  const top3 = ranked.slice(0, 3);
  const topActions: ProfitBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'profit',
    signal: entry.signal.name,
    action: actionForSignal(entry.signal),
    expectedUpliftEUR: round2(entry.signal.upliftEURPerMonth),
    confidence: entry.confidence,
  }));

  // --- Final 30d/90d projections (conservative 1/3 at 30d, 70% at 90d) ----
  const totalUplift = signals.reduce((a, s) => a + s.upliftEURPerMonth, 0);
  const projection30d =
    norm.monthlyProfit +
    (norm.monthlyProfit > 0
      ? (totalUplift / norm.monthlyProfit / 3) * norm.monthlyProfit
      : totalUplift / 3);
  const projection90d =
    norm.monthlyProfit +
    (norm.monthlyProfit > 0
      ? (totalUplift / norm.monthlyProfit * 0.7) * norm.monthlyProfit
      : totalUplift * 0.7);

  // --- Best opportunity (highest uplift signal) ----------------------------
  const bestOpportunity = signals.reduce(
    (best, s) => (s.upliftEURPerMonth > best.upliftEURPerMonth ? s : best),
    signals[0],
  ).name;

  // --- One-line summary ----------------------------------------------------
  const oneLineSummary = buildOneLineSummary(
    norm.monthlyProfit,
    projection30d,
    bestOpportunity,
    topActions,
  );

  return {
    ok: true,
    signals,
    current: {
      monthlyProfit: round2(norm.monthlyProfit),
      profitGrowthRate: round2(norm.profitGrowthRate),
      avgProfitPerTrade: round2(norm.avgProfitPerTrade),
      tradesPerMonth: round2(norm.tradesPerMonth),
      capitalDeployed: round2(norm.capitalDeployed),
    },
    maximization: {
      topActions,
      projection30d: round2(projection30d),
      projection90d: round2(projection90d),
      profitGrade,
      bestOpportunity,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.15-profit-brain',
  };
}
