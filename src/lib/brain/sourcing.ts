// v8.18: Sourcing Brain — synthesizes 6 sourcing signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the FOURTH Brain layer (after Profit Brain v8.15,
// Inventory Brain v8.16, Market Brain v8.17) that sits ABOVE the ~21
// sourcing/deal-source specialist endpoints. Each specialist measures ONE
// sourcing dimension (ROI per source, volume per source, margin per source,
// momentum, trend). The Sourcing Brain reads source-level context and
// synthesizes 6 sourcing signals (roi, volume, margin, momentum,
// diversification, concentration) into:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d sourcing projections per source
//   - overall sourcing grade (weighted across 6 signals)
//   - one-line summary that names the single biggest sourcing lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Sourcing Brain reads PER-SOURCE BREAKDOWN
//    (capitalDeployed, monthlyProfit, margin per source) → synthesizes
//    sourcing-allocation signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Sourcing Brain's projections are STRUCTURED objects with
//    recommendedSourceToScale + recommendedSourceToReduce + projectedConcentrationPct
//    + recommendedNewSource — because sourcing is per-source, not aggregate.
//  - Profit Brain = "how much money are you making overall?".
//    Sourcing Brain = "which SOURCE should you scale / cut / add?".
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Sourcing Brain answers "where should you ALLOCATE your next euro of
//    capital across Bolha/Vinted/Avtonet/.../Kleinanzeigen?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Sourcing Brain projects source count + concentration % + which new
//    source to add (e.g. Kleinanzeigen for Slovenian flippers).
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT (active listings, price changes,
//    inquiries, sell-through) → synthesizes market-cycle signals.
//    Sourcing Brain reads SOURCE PERFORMANCE BREAKDOWN (which Bolha/Vinted/
//    mobile.de/etc. delivers the best ROI / volume / margin) → synthesizes
//    sourcing-allocation signals.
//  - Market Brain answers "where in the market cycle are we RIGHT NOW?".
//    Sourcing Brain answers "which source is winning, and where do we
//    rebalance our capital next month?".
//
// DIFFERENCES from the ~21 sourcing specialists:
//  - Specialists measure ONE dimension (e.g. deal-source-profit-maximizer,
//    deal-source-roi-maximizer, deal-source-volume-maximizer,
//    deal-source-momentum-analyzer, deal-source-trend-analyzer, sourcing,
//    inventory-supplier-evaluator). Brain SYNTHESIZES 6 dimensions into one
//    decision.
//  - Specialists are flat endpoints. Brain sits ABOVE them.
//  - In v8.18 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via SourcingBrainInput). It is
// fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

import type { ProfitGrade, Confidence } from './profit';

// Per-source data — array of sources (Bolha, Vinted, Avtonet, mobile.de, etc.)
export interface SourceDatum {
  name: string; // 'Bolha' | 'Vinted' | 'Avtonet' | 'mobile.de' | ...
  monthlyVolume: number; // items bought from this source per month
  avgProfitMarginPct: number; // avg profit margin % on items sourced from here
  avgDaysToSell: number; // avg days to sell items sourced from here
  capitalDeployedEUR: number; // capital deployed into this source's inventory
  monthlyProfitEUR: number; // profit earned from this source's inventory per month
}

export interface SourcingBrainInput {
  sources?: SourceDatum[]; // per-source breakdown (defaults to 4 sources)
  totalCapitalDeployed?: number; // sum across sources (auto-computed if missing)
  totalMonthlyProfit?: number; // sum across sources (auto-computed if missing)
}

export type SourcingSignalName =
  | 'roi' // return on investment per source (aggregate)
  | 'volume' // sourcing volume per source
  | 'margin' // profit margin per source
  | 'momentum' // is this source growing or shrinking
  | 'diversification' // spread of capital across sources
  | 'concentration'; // risk: too much in one source

export interface SourcingSignal {
  name: SourcingSignalName;
  score: number; // 0-100 normalized
  grade: ProfitGrade;
  upliftEURPerMonth: number; // normalized expected €/month uplift if this signal is maximized
  topLever: string; // human-readable action lever (in Slovenian)
}

export interface SourcingBrainAction {
  rank: number;
  domain: 'sourcing'; // 'sourcing' for v8.18
  signal: SourcingSignalName;
  action: string; // human-readable, e.g. "Povečaj Bolha capital za 50%"
  expectedUpliftEUR: number; // €/month
  confidence: Confidence;
}

export interface SourcingBrainResult {
  ok: true;
  signals: SourcingSignal[]; // exactly 6 entries
  current: {
    sourceCount: number;
    sources: SourceDatum[];
    totalCapitalDeployed: number;
    totalMonthlyProfit: number;
    bestSource: string; // source with highest monthlyProfitEUR
    worstSource: string; // source with lowest monthlyProfitEUR
    avgMarginPct: number; // weighted across sources
    concentrationPct: number; // % of capital in top source
  };
  maximization: {
    topActions: SourcingBrainAction[]; // up to 3 actions, ranked by uplift × confidence
    projection30d: {
      recommendedSourceToScale: string; // source to invest MORE capital
      recommendedSourceToReduce: string; // source to reduce capital
      projectedTotalMonthlyProfit: number;
      projectedConcentrationPct: number;
    };
    projection90d: {
      projectedTotalMonthlyProfit: number;
      projectedSourceCount: number;
      projectedConcentrationPct: number;
      recommendedNewSource?: string; // suggest adding a new source
    };
    sourcingGrade: ProfitGrade; // weighted across 6 signals
    bestOpportunity: SourcingSignalName; // signal with highest upliftEURPerMonth
    oneLineSummary: string;
  };
  aiUsed: false;
  source: 'v8.18-sourcing-brain';
  cachedAt?: number; // set by caller when served from cache
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_SOURCES: SourceDatum[] = [
  { name: 'Bolha', monthlyVolume: 6, avgProfitMarginPct: 28, avgDaysToSell: 10, capitalDeployedEUR: 600, monthlyProfitEUR: 168 },
  { name: 'Vinted', monthlyVolume: 4, avgProfitMarginPct: 22, avgDaysToSell: 18, capitalDeployedEUR: 400, monthlyProfitEUR: 88 },
  { name: 'Avtonet', monthlyVolume: 1, avgProfitMarginPct: 35, avgDaysToSell: 30, capitalDeployedEUR: 300, monthlyProfitEUR: 105 },
  { name: 'mobile.de', monthlyVolume: 1, avgProfitMarginPct: 30, avgDaysToSell: 25, capitalDeployedEUR: 200, monthlyProfitEUR: 60 },
];

const DEFAULT_TOTAL_CAPITAL_DEPLOYED = 1500;
const DEFAULT_TOTAL_MONTHLY_PROFIT = 421;

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

// --- Signal formulas ------------------------------------------------------

interface NormalizedInput {
  sources: SourceDatum[];
  totalCapitalDeployed: number;
  totalMonthlyProfit: number;
  totalVolume: number;
  weightedMarginPct: number;
  concentrationPct: number;
  topSourceName: string;
  bestSourceName: string;
  worstSourceName: string;
  bestSourceProfit: number;
  worstSourceProfit: number;
  bestSourceMarginPct: number;
}

function normalizeInput(
  input: SourcingBrainInput | undefined | null,
): NormalizedInput {
  // Sources — fallback to defaults if missing/empty
  let sources: SourceDatum[];
  if (input?.sources && Array.isArray(input.sources) && input.sources.length > 0) {
    // Sanitize each source: clamp numeric fields, ensure name is a string
    sources = input.sources
      .filter((s) => s && typeof s === 'object' && typeof s.name === 'string' && s.name.length > 0)
      .map((s) => ({
        name: s.name,
        monthlyVolume: clamp(typeof s.monthlyVolume === 'number' ? s.monthlyVolume : 0, 0, 1e6),
        avgProfitMarginPct: clamp(
          typeof s.avgProfitMarginPct === 'number' ? s.avgProfitMarginPct : 0,
          -100,
          500,
        ),
        avgDaysToSell: clamp(typeof s.avgDaysToSell === 'number' ? s.avgDaysToSell : 0, 0, 3650),
        capitalDeployedEUR: clamp(
          typeof s.capitalDeployedEUR === 'number' ? s.capitalDeployedEUR : 0,
          0,
          1e9,
        ),
        monthlyProfitEUR: typeof s.monthlyProfitEUR === 'number' ? s.monthlyProfitEUR : 0,
      }));
    if (sources.length === 0) {
      sources = DEFAULT_SOURCES;
    }
  } else {
    sources = DEFAULT_SOURCES;
  }

  // Totals — auto-computed from sources unless caller overrides
  const sumCapital = sources.reduce((a, s) => a + s.capitalDeployedEUR, 0);
  const sumProfit = sources.reduce((a, s) => a + s.monthlyProfitEUR, 0);
  const totalCapitalDeployed =
    input?.totalCapitalDeployed != null && Number.isFinite(input.totalCapitalDeployed)
      ? input.totalCapitalDeployed
      : sumCapital > 0
        ? sumCapital
        : DEFAULT_TOTAL_CAPITAL_DEPLOYED;
  const totalMonthlyProfit =
    input?.totalMonthlyProfit != null && Number.isFinite(input.totalMonthlyProfit)
      ? input.totalMonthlyProfit
      : sumProfit > 0
        ? sumProfit
        : DEFAULT_TOTAL_MONTHLY_PROFIT;

  const totalVolume = sources.reduce((a, s) => a + s.monthlyVolume, 0);

  // Weighted avg margin (weighted by capitalDeployed per source)
  const totalCap = Math.max(sumCapital, 1);
  const weightedMarginPct =
    sources.reduce((a, s) => a + s.avgProfitMarginPct * s.capitalDeployedEUR, 0) / totalCap;

  // Top source by capital (for concentration)
  let topSourceName = sources[0].name;
  let maxCap = -Infinity;
  for (const s of sources) {
    if (s.capitalDeployedEUR > maxCap) {
      maxCap = s.capitalDeployedEUR;
      topSourceName = s.name;
    }
  }
  const concentrationPct = totalCapitalDeployed > 0
    ? (maxCap / totalCapitalDeployed) * 100
    : 0;

  // Best/worst source by monthly profit
  let bestSourceName = sources[0].name;
  let worstSourceName = sources[0].name;
  let bestSourceProfit = -Infinity;
  let worstSourceProfit = Infinity;
  let bestSourceMarginPct = 0;
  for (const s of sources) {
    if (s.monthlyProfitEUR > bestSourceProfit) {
      bestSourceProfit = s.monthlyProfitEUR;
      bestSourceName = s.name;
      bestSourceMarginPct = s.avgProfitMarginPct;
    }
    if (s.monthlyProfitEUR < worstSourceProfit) {
      worstSourceProfit = s.monthlyProfitEUR;
      worstSourceName = s.name;
    }
  }
  // Guard against single-source inputs
  if (!Number.isFinite(bestSourceProfit)) bestSourceProfit = 0;
  if (!Number.isFinite(worstSourceProfit)) worstSourceProfit = 0;

  return {
    sources,
    totalCapitalDeployed,
    totalMonthlyProfit,
    totalVolume,
    weightedMarginPct,
    concentrationPct,
    topSourceName,
    bestSourceName,
    worstSourceName,
    bestSourceProfit,
    worstSourceProfit,
    bestSourceMarginPct,
  };
}

/**
 * 1. roi — aggregate return on investment across all sources.
 *    totalROI = (totalMonthlyProfit / max(totalCapitalDeployed, 1)) × 100 (%/mo).
 *    Score = clamp(totalROI × 8, 0, 100)  (12.5%/mo ROI = 100).
 *    Uplift = totalCapitalDeployed × 0.05  (5% ROI improvement via rebalancing).
 */
function computeRoiSignal(norm: NormalizedInput): SourcingSignal {
  const totalROI = (norm.totalMonthlyProfit / Math.max(norm.totalCapitalDeployed, 1)) * 100;
  const score = clamp(totalROI * 8, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.totalCapitalDeployed * 0.05));
  return {
    name: 'roi',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `ROI ${totalROI.toFixed(1)}%/mo — prestavi 20% capital iz low-ROI v high-ROI vire`,
  };
}

/**
 * 2. volume — total sourcing volume across all sources.
 *    totalVolume = sum of monthlyVolume across sources.
 *    Score = clamp(totalVolume × 2, 0, 100)  (50 items/mo = 100).
 *    Uplift = totalVolume × 2  (€2/item uplift via volume optimization).
 */
function computeVolumeSignal(norm: NormalizedInput): SourcingSignal {
  const score = clamp(norm.totalVolume * 2, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.totalVolume * 2));
  const action =
    norm.totalVolume < 20
      ? 'povečaj nabavo za 50%'
      : 'ohrani sedanjo frekvenco';
  return {
    name: 'volume',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Volume ${norm.totalVolume} itemov/mo — ${action}`,
  };
}

/**
 * 3. margin — weighted average profit margin across sources.
 *    weightedMargin = sum(monthlyProfitEUR) / sum(monthlyVolume × avgProfitMarginPct/100 × capitalDeployedEUR/totalCapitalDeployed)
 *      (simplified: weighted avg of avgProfitMarginPct by capitalDeployed).
 *    Score = clamp(weightedMargin × 3, 0, 100)  (33% margin = 100).
 *    Uplift = totalCapitalDeployed × 0.03  (3% margin uplift via shifting to higher-margin sources).
 */
function computeMarginSignal(norm: NormalizedInput): SourcingSignal {
  const weightedMargin = norm.weightedMarginPct;
  const score = clamp(weightedMargin * 3, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.totalCapitalDeployed * 0.03));
  return {
    name: 'margin',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Povprečna margin ${weightedMargin.toFixed(1)}% — prestavi 30% capital v vire z margin >30%`,
  };
}

/**
 * 4. momentum — which sources are growing (use best vs worst source profit as proxy
 *    since we don't have historical data per source).
 *    momentumSpread = (bestSourceProfit - worstSourceProfit) / max(bestSourceProfit, 1) × 100.
 *    Score = clamp(momentumSpread × 0.8, 0, 100)  (large spread = clear winner to scale).
 *    Uplift = bestSourceProfit × 0.3  (30% uplift by doubling down on best source).
 */
function computeMomentumSignal(norm: NormalizedInput): SourcingSignal {
  const momentumSpread =
    ((norm.bestSourceProfit - norm.worstSourceProfit) /
      Math.max(norm.bestSourceProfit, 1)) *
    100;
  const score = clamp(Math.abs(momentumSpread) * 0.8, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.bestSourceProfit * 0.3));
  return {
    name: 'momentum',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `${norm.bestSourceName} najboljši vir (${norm.bestSourceProfit.toFixed(0)}€/mo) — povečaj capital za 50%`,
  };
}

/**
 * 5. diversification — how spread is capital across sources.
 *    concentrationPct = (max source capitalDeployed) / totalCapitalDeployed × 100.
 *    Score = clamp(100 - concentrationPct, 0, 100).
 *    Uplift = totalCapitalDeployed × 0.02  (2% uplift from better diversification).
 */
function computeDiversificationSignal(norm: NormalizedInput): SourcingSignal {
  const diversificationScore = clamp(100 - norm.concentrationPct, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.totalCapitalDeployed * 0.02));
  const action =
    norm.concentrationPct > 60
      ? 'povečaj diverzifikacijo: dodaj 1 nov vir'
      : 'ohrani trenutni spread';
  return {
    name: 'diversification',
    score: round2(diversificationScore),
    grade: gradeFromScore(diversificationScore),
    upliftEURPerMonth,
    topLever: `Diverzifikacija ${norm.sources.length} virov, koncentracija ${norm.concentrationPct.toFixed(0)}% v top viru — ${action}`,
  };
}

/**
 * 6. concentration — risk: too much capital in one source (inverse of
 *    diversification, but scored as RISK).
 *    Score = clamp(100 - concentrationPct, 0, 100).
 *    Uplift = totalCapitalDeployed × 0.015  (1.5% risk-adjusted uplift from reducing concentration).
 */
function computeConcentrationSignal(norm: NormalizedInput): SourcingSignal {
  const score = clamp(100 - norm.concentrationPct, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.totalCapitalDeployed * 0.015));
  const action =
    norm.concentrationPct > 60
      ? 'preveč tveganja: zmanjšaj za 20%'
      : 'sprejemljiva koncentracija';
  return {
    name: 'concentration',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Koncentracija ${norm.concentrationPct.toFixed(0)}% v ${norm.topSourceName} — ${action}`,
  };
}

// --- Synthesis ------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<SourcingSignalName, number> = {
  roi: 0.2,
  volume: 0.15,
  margin: 0.2,
  momentum: 0.2,
  diversification: 0.15,
  concentration: 0.1,
};

function actionForSignal(signal: SourcingSignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'roi':
      return `Prestavi capital po ROI: ${signal.topLever}`;
    case 'volume':
      return `Optimiriraj volume: ${signal.topLever}`;
    case 'margin':
      return `Prestavi capital po margin: ${signal.topLever}`;
    case 'momentum':
      return `Izkoristi momentum: ${signal.topLever}`;
    case 'diversification':
      return `Izboljšaj diverzifikacijo: ${signal.topLever}`;
    case 'concentration':
      return `Zmanjšaj koncentracijo: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

function buildOneLineSummary(
  bestSource: string,
  bestSourceProfit: number,
  bestSourceMarginPct: number,
  grade: ProfitGrade,
  topActions: SourcingBrainAction[],
): string {
  const a0 = topActions[0]?.action ?? '';
  return `${bestSource} najboljši vir (${bestSourceProfit.toFixed(0)}€/mo, ${bestSourceMarginPct.toFixed(0)}% margin). ${a0}. Grade ${grade}.`;
}

/**
 * Sourcing Brain — pure deterministic compute.
 * Takes optional SourcingBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 sourcing signals, top 3 actions, 30d/90d sourcing
 * projections, overall sourcing grade, and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function sourcingBrain(input?: SourcingBrainInput): SourcingBrainResult {
  const norm = normalizeInput(input);

  // --- Compute all 6 signals ---------------------------------------------
  const roi = computeRoiSignal(norm);
  const volume = computeVolumeSignal(norm);
  const margin = computeMarginSignal(norm);
  const momentum = computeMomentumSignal(norm);
  const diversification = computeDiversificationSignal(norm);
  const concentration = computeConcentrationSignal(norm);

  const signals: SourcingSignal[] = [
    roi,
    volume,
    margin,
    momentum,
    diversification,
    concentration,
  ];

  // --- Weighted overall sourcing grade -----------------------------------
  const weightedScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const sourcingGrade = gradeFromScore(weightedScore);

  // --- Top 3 actions (sorted by uplift × confidence weight) --------------
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
  const topActions: SourcingBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'sourcing',
    signal: entry.signal.name,
    action: actionForSignal(entry.signal),
    expectedUpliftEUR: round2(entry.signal.upliftEURPerMonth),
    confidence: entry.confidence,
  }));

  // --- 30d projection -----------------------------------------------------
  const projection30d = {
    recommendedSourceToScale: norm.bestSourceName,
    recommendedSourceToReduce: norm.worstSourceName,
    projectedTotalMonthlyProfit: round2(norm.totalMonthlyProfit * 1.15),
    projectedConcentrationPct: round2(Math.max(40, norm.concentrationPct - 15)),
  };

  // --- 90d projection -----------------------------------------------------
  const projection90d = {
    projectedTotalMonthlyProfit: round2(norm.totalMonthlyProfit * 1.35),
    projectedSourceCount: norm.sources.length + (norm.concentrationPct > 60 ? 1 : 0),
    projectedConcentrationPct: round2(Math.max(30, norm.concentrationPct - 25)),
    recommendedNewSource:
      norm.concentrationPct > 60 ? 'Kleinanzeigen' : undefined,
  };

  // --- Best opportunity (highest uplift signal) -------------------------
  const bestOpportunity = signals.reduce(
    (best, s) => (s.upliftEURPerMonth > best.upliftEURPerMonth ? s : best),
    signals[0],
  ).name;

  // --- One-line summary --------------------------------------------------
  const oneLineSummary = buildOneLineSummary(
    norm.bestSourceName,
    norm.bestSourceProfit,
    norm.bestSourceMarginPct,
    sourcingGrade,
    topActions,
  );

  return {
    ok: true,
    signals,
    current: {
      sourceCount: norm.sources.length,
      sources: norm.sources,
      totalCapitalDeployed: round2(norm.totalCapitalDeployed),
      totalMonthlyProfit: round2(norm.totalMonthlyProfit),
      bestSource: norm.bestSourceName,
      worstSource: norm.worstSourceName,
      avgMarginPct: round2(norm.weightedMarginPct),
      concentrationPct: round2(norm.concentrationPct),
    },
    maximization: {
      topActions,
      projection30d,
      projection90d,
      sourcingGrade,
      bestOpportunity,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.18-sourcing-brain',
  };
}
