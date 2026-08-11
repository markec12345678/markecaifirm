// v8.19: Risk Brain — synthesizes 6 risk signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the FIFTH Brain layer (after Profit Brain v8.15,
// Inventory Brain v8.16, Market Brain v8.17, Sourcing Brain v8.18) that sits
// ABOVE the ~7 risk specialist endpoints (fraud-detection,
// inventory-risk-assessor, portfolio-risk-forecaster, risk-hedging,
// risk-parity, risk-reward-calculator, risk-spread-calculator). Each specialist
// measures ONE risk dimension (concentration, aging, market, liquidity, fraud,
// hedging). The Risk Brain reads risk context and synthesizes 6 risk signals
// (concentration, aging, liquidity, market, fraud, portfolio) into:
//   - 3 top risk mitigation actions for today, ranked by
//     riskReductionEUR × confidence
//   - 30d / 90d risk projections (projectedRiskScore + projectedConcentrationPct
//     + projectedAgedPct + recommendedRiskBudget)
//   - overall risk grade (weighted across 6 signals)
//   - one-line summary that names the single biggest risk lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE HISTORY (monthlyProfits[]) → synthesizes
//    profit-growth signals. Risk Brain reads RISK CONTEXT (capital
//    concentration, aged inventory, fraud suspicions, market volatility) →
//    synthesizes risk-mitigation signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Risk Brain's projections are STRUCTURED objects with projectedRiskScore
//    + projectedConcentrationPct + projectedAgedPct + recommendedRiskBudget —
//    because risk mitigation is multi-dimensional (rebalance concentration,
//    liquidate aged, hedge market exposure).
//  - Profit Brain = "how much money are you making?".
//    Risk Brain = "what is your biggest risk, and how much capital can you
//    safely deploy given current risk?".
//
// DIFFERENCES from Inventory Brain (v8.16):
//  - Inventory Brain answers "how well is your stock performing as capital?".
//    Risk Brain answers "what could go WRONG, and how do we mitigate it?".
//  - Inventory Brain projects inventory value + aged stock %.
//    Risk Brain projects risk SCORE + concentration % + aged % + risk budget.
//
// DIFFERENCES from Market Brain (v8.17):
//  - Market Brain reads MARKET CONTEXT (active listings, price changes,
//    inquiries, sell-through) → synthesizes market-cycle signals.
//    Risk Brain reads RISK EXPOSURE (concentration, fraud, volatility, aged
//    stock) → synthesizes risk-mitigation signals.
//  - Market Brain answers "where in the market cycle are we RIGHT NOW?".
//    Risk Brain answers "what is our single biggest risk lever, and what is
//    the max capital we can deploy without breaching our risk budget?".
//
// DIFFERENCES from Sourcing Brain (v8.18):
//  - Sourcing Brain reads PER-SOURCE BREAKDOWN (capitalDeployed, monthlyProfit,
//    margin per source) → synthesizes sourcing-allocation signals.
//    Risk Brain reads AGGREGATE RISK EXPOSURE (concentrationPct,
//    agedInventoryValue, fraudSuspicions, marketVolatility) → synthesizes
//    risk-mitigation signals.
//  - Sourcing Brain answers "which source should we scale / cut / add?".
//    Risk Brain answers "which risk dimension should we mitigate first?".
//
// DIFFERENCES from the ~7 risk specialists:
//  - Specialists measure ONE dimension (e.g. fraud-detection,
//    inventory-risk-assessor, portfolio-risk-forecaster, risk-hedging,
//    risk-parity, risk-reward-calculator, risk-spread-calculator). Brain
//    SYNTHESIZES 6 dimensions into one decision.
//  - Specialists are flat endpoints. Brain sits ABOVE them.
//  - In v8.19 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via RiskBrainInput). It is
// fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

import type { ProfitGrade, Confidence } from './profit';

export interface RiskBrainInput {
  totalCapitalDeployed?: number;     // EUR across all inventory + active listings
  inventoryValue?: number;           // EUR in unsold inventory
  agedInventoryValue?: number;       // EUR in items held > 30 days
  capitalConcentrationPct?: number;  // % of capital in single largest position/source
  monthlyRevenue?: number;           // EUR (last 30 days sales)
  monthlyProfit?: number;            // EUR (last 30 days profit)
  activeSources?: number;            // count of distinct deal sources (Bolha, Vinted, ...)
  fraudSuspicionsCount?: number;     // listings flagged as suspicious
  totalListingsCount?: number;       // total active listings
  avgDaysToSell?: number;            // weighted avg days to sell
  marketVolatilityPct?: number;      // inferred market volatility (abs avg price change %)
}

export type RiskSignalName =
  | 'concentration' // single-position/source concentration risk
  | 'aging'         // stale inventory risk
  | 'liquidity'     // can-you-exit-fast risk
  | 'market'        // external market risk (volatility/cycle)
  | 'fraud'         // fraud/scam exposure
  | 'portfolio';    // overall portfolio balance risk

export interface RiskSignal {
  name: RiskSignalName;
  score: number;           // 0-100 (HIGHER score = LOWER risk, i.e. better)
  grade: ProfitGrade;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';  // inverse of score
  riskReductionEUR: number;  // EUR/month risk reduction if this signal is mitigated
  topLever: string;          // human-readable mitigation action (in Slovenian)
}

export interface RiskBrainAction {
  rank: number;
  domain: 'risk';
  signal: RiskSignalName;
  action: string;
  expectedUpliftEUR: number;  // in risk context = riskReductionEUR
  confidence: Confidence;
}

export interface RiskBrainResult {
  ok: true;
  signals: RiskSignal[];  // exactly 6
  current: {
    totalCapitalDeployed: number;
    inventoryValue: number;
    agedInventoryValue: number;
    agedPct: number;           // agedInventoryValue / inventoryValue × 100
    capitalConcentrationPct: number;
    monthlyRevenue: number;
    monthlyProfit: number;
    activeSources: number;
    fraudSuspicionsPct: number;  // fraudSuspicions / totalListings × 100
    avgDaysToSell: number;
    marketVolatilityPct: number;
    overallRiskScore: number;     // 0-100 (lower = more risk)
  };
  maximization: {
    topActions: RiskBrainAction[];  // 3, ranked by riskReduction × confidence
    projection30d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;  // EUR — max capital to deploy given risk
    };
    projection90d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    riskGrade: ProfitGrade;
    biggestRisk: RiskSignalName;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: 'v8.19-risk-brain';
  cachedAt?: number;
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_TOTAL_CAPITAL_DEPLOYED = 1500;
const DEFAULT_INVENTORY_VALUE = 1500;
const DEFAULT_AGED_INVENTORY_VALUE = 280;
const DEFAULT_CAPITAL_CONCENTRATION_PCT = 40;
const DEFAULT_MONTHLY_REVENUE = 350;
const DEFAULT_MONTHLY_PROFIT = 100;
const DEFAULT_ACTIVE_SOURCES = 4;
const DEFAULT_FRAUD_SUSPICIONS_COUNT = 2;
const DEFAULT_TOTAL_LISTINGS_COUNT = 150;
const DEFAULT_AVG_DAYS_TO_SELL = 14;
const DEFAULT_MARKET_VOLATILITY_PCT = 25;

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

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Confidence = HIGH if riskLevel is HIGH or CRITICAL (urgent — mitigate now),
 * MEDIUM if riskLevel is MEDIUM (watch), LOW otherwise.
 *
 * This is INVERTED from the profit/inventory/market/sourcing brains where
 * higher score → higher confidence. Here LOWER score (= higher risk) →
 * HIGHER confidence in the mitigation action (urgent risks deserve urgent
 * action).
 */
function confidenceFromRiskLevel(level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): Confidence {
  switch (level) {
    case 'CRITICAL':
    case 'HIGH':
      return 'HIGH';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'LOW':
    default:
      return 'LOW';
  }
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

// --- Signal formulas ------------------------------------------------------

interface NormalizedInput {
  totalCapitalDeployed: number;
  inventoryValue: number;
  agedInventoryValue: number;
  capitalConcentrationPct: number;
  monthlyRevenue: number;
  monthlyProfit: number;
  activeSources: number;
  fraudSuspicionsCount: number;
  totalListingsCount: number;
  avgDaysToSell: number;
  marketVolatilityPct: number;
  agedPct: number;
  fraudSuspicionsPct: number;
}

function normalizeInput(input: RiskBrainInput | undefined | null): NormalizedInput {
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def;

  const totalCapitalDeployed = num(input?.totalCapitalDeployed, DEFAULT_TOTAL_CAPITAL_DEPLOYED);
  const inventoryValue = num(input?.inventoryValue, DEFAULT_INVENTORY_VALUE);
  const agedInventoryValue = num(input?.agedInventoryValue, DEFAULT_AGED_INVENTORY_VALUE);
  const capitalConcentrationPct = clamp(
    num(input?.capitalConcentrationPct, DEFAULT_CAPITAL_CONCENTRATION_PCT),
    0,
    100,
  );
  const monthlyRevenue = num(input?.monthlyRevenue, DEFAULT_MONTHLY_REVENUE);
  const monthlyProfit = num(input?.monthlyProfit, DEFAULT_MONTHLY_PROFIT);
  const activeSources = clamp(
    num(input?.activeSources, DEFAULT_ACTIVE_SOURCES),
    1,
    1000,
  );
  const fraudSuspicionsCount = clamp(
    num(input?.fraudSuspicionsCount, DEFAULT_FRAUD_SUSPICIONS_COUNT),
    0,
    1e6,
  );
  const totalListingsCount = clamp(
    num(input?.totalListingsCount, DEFAULT_TOTAL_LISTINGS_COUNT),
    1,
    1e6,
  );
  const avgDaysToSell = clamp(num(input?.avgDaysToSell, DEFAULT_AVG_DAYS_TO_SELL), 0, 3650);
  const marketVolatilityPct = clamp(
    num(input?.marketVolatilityPct, DEFAULT_MARKET_VOLATILITY_PCT),
    0,
    100,
  );

  const agedPct = (agedInventoryValue / Math.max(inventoryValue, 1)) * 100;
  const fraudSuspicionsPct = (fraudSuspicionsCount / Math.max(totalListingsCount, 1)) * 100;

  return {
    totalCapitalDeployed,
    inventoryValue,
    agedInventoryValue,
    capitalConcentrationPct,
    monthlyRevenue,
    monthlyProfit,
    activeSources,
    fraudSuspicionsCount,
    totalListingsCount,
    avgDaysToSell,
    marketVolatilityPct,
    agedPct,
    fraudSuspicionsPct,
  };
}

/**
 * 1. concentration — single-position/source concentration risk.
 *    Score = clamp(100 - capitalConcentrationPct, 0, 100).  (65% concentration = 35 score)
 *    riskLevel: HIGH if concentration > 60, MEDIUM if > 40, LOW otherwise.
 *    riskReductionEUR = totalCapitalDeployed × (concentration > 60 ? 0.04 : 0.015).
 */
function computeConcentrationSignal(norm: NormalizedInput): RiskSignal {
  const score = clamp(100 - norm.capitalConcentrationPct, 0, 100);
  const riskLevel: RiskSignal['riskLevel'] =
    norm.capitalConcentrationPct > 60
      ? 'HIGH'
      : norm.capitalConcentrationPct > 40
        ? 'MEDIUM'
        : 'LOW';
  const riskReductionEUR = norm.totalCapitalDeployed *
    (norm.capitalConcentrationPct > 60 ? 0.04 : 0.015);
  const topLever = `Koncentracija ${norm.capitalConcentrationPct.toFixed(0)}% v enem viru — ${norm.capitalConcentrationPct > 60 ? 'PREVEČ tveganja: razprši 30% capital-a v 2 nova vira' : 'sprejemljiva koncentracija'}`;
  return {
    name: 'concentration',
    score: round2(score),
    grade: gradeFromScore(score),
    riskLevel,
    riskReductionEUR: round2(Math.max(0, riskReductionEUR)),
    topLever,
  };
}

/**
 * 2. aging — stale inventory risk.
 *    agedPct = agedInventoryValue / max(inventoryValue, 1) × 100.
 *    Score = clamp(100 - agedPct × 2, 0, 100).  (30% aged = 40 score)
 *    riskLevel: HIGH if agedPct > 40, MEDIUM if > 20, LOW otherwise.
 *    riskReductionEUR = agedInventoryValue × 0.2.
 */
function computeAgingSignal(norm: NormalizedInput): RiskSignal {
  const score = clamp(100 - norm.agedPct * 2, 0, 100);
  const riskLevel: RiskSignal['riskLevel'] =
    norm.agedPct > 40 ? 'HIGH' : norm.agedPct > 20 ? 'MEDIUM' : 'LOW';
  const riskReductionEUR = norm.agedInventoryValue * 0.2;
  const topLever = `Stari inventar ${norm.agedPct.toFixed(0)}% (${Math.round(norm.agedInventoryValue)}€) — ${norm.agedPct > 40 ? 'CRITICAL: likvidiraj v 14 dneh z 15-20% popustom' : norm.agedPct > 20 ? 'likvidiraj postopoma' : 'sprejemljivo'}`;
  return {
    name: 'aging',
    score: round2(score),
    grade: gradeFromScore(score),
    riskLevel,
    riskReductionEUR: round2(Math.max(0, riskReductionEUR)),
    topLever,
  };
}

/**
 * 3. liquidity — can-you-exit-fast risk.
 *    liquidityScore = clamp((monthlyRevenue / max(inventoryValue, 1)) × 50, 0, 100).
 *      (2×/mo turnover = 100)
 *    riskLevel: HIGH if score < 30, MEDIUM if < 60, LOW otherwise.
 *    riskReductionEUR = inventoryValue × 0.05.
 */
function computeLiquiditySignal(norm: NormalizedInput): RiskSignal {
  const score = clamp((norm.monthlyRevenue / Math.max(norm.inventoryValue, 1)) * 50, 0, 100);
  const riskLevel: RiskSignal['riskLevel'] =
    score < 30 ? 'HIGH' : score < 60 ? 'MEDIUM' : 'LOW';
  const riskReductionEUR = norm.inventoryValue * 0.05;
  const topLever = `Likvidnost ${score.toFixed(0)}/100 — ${score < 30 ? 'NIZKA: znižaj cene 10% za hitro prodajo, sprosti capital' : score < 60 ? 'zmanjšaj avgDaysToSell za 30%' : 'zdrava likvidnost'}`;
  return {
    name: 'liquidity',
    score: round2(score),
    grade: gradeFromScore(score),
    riskLevel,
    riskReductionEUR: round2(Math.max(0, riskReductionEUR)),
    topLever,
  };
}

/**
 * 4. market — external market risk (volatility).
 *    Score = clamp(100 - marketVolatilityPct × 2, 0, 100).  (30% volatility = 40 score)
 *    riskLevel: HIGH if marketVolatilityPct > 35, MEDIUM if > 20, LOW otherwise.
 *    riskReductionEUR = totalCapitalDeployed × 0.025.
 */
function computeMarketSignal(norm: NormalizedInput): RiskSignal {
  const score = clamp(100 - norm.marketVolatilityPct * 2, 0, 100);
  const riskLevel: RiskSignal['riskLevel'] =
    norm.marketVolatilityPct > 35
      ? 'HIGH'
      : norm.marketVolatilityPct > 20
        ? 'MEDIUM'
        : 'LOW';
  const riskReductionEUR = norm.totalCapitalDeployed * 0.025;
  const topLever = `Tržna volatilnost ${norm.marketVolatilityPct.toFixed(0)}% — ${norm.marketVolatilityPct > 35 ? 'VISOKA: hedge-aj z limit orders ali cash position 30%' : norm.marketVolatilityPct > 20 ? 'zmerna: spremljaj trende' : 'nizka: normalna aktivnost'}`;
  return {
    name: 'market',
    score: round2(score),
    grade: gradeFromScore(score),
    riskLevel,
    riskReductionEUR: round2(Math.max(0, riskReductionEUR)),
    topLever,
  };
}

/**
 * 5. fraud — fraud/scam exposure.
 *    fraudSuspicionsPct = fraudSuspicionsCount / max(totalListingsCount, 1) × 100.
 *    Score = clamp(100 - fraudSuspicionsPct × 5, 0, 100).  (10% fraud = 50 score)
 *    riskLevel: HIGH if fraudSuspicionsPct > 10, MEDIUM if > 5, LOW otherwise.
 *    riskReductionEUR = totalCapitalDeployed × 0.01 × (fraudSuspicionsPct / 5).
 */
function computeFraudSignal(norm: NormalizedInput): RiskSignal {
  const score = clamp(100 - norm.fraudSuspicionsPct * 5, 0, 100);
  const riskLevel: RiskSignal['riskLevel'] =
    norm.fraudSuspicionsPct > 10
      ? 'HIGH'
      : norm.fraudSuspicionsPct > 5
        ? 'MEDIUM'
        : 'LOW';
  const riskReductionEUR =
    norm.totalCapitalDeployed * 0.01 * (norm.fraudSuspicionsPct / 5);
  const topLever = `Fraud sumnje ${norm.fraudSuspicionsPct.toFixed(1)}% (${norm.fraudSuspicionsCount} oglasov) — ${norm.fraudSuspicionsPct > 10 ? 'CRITICAL: prekini posle z sumljivimi, kreiraj blacklist' : 'spremljaj in filtriraj'}`;
  return {
    name: 'fraud',
    score: round2(score),
    grade: gradeFromScore(score),
    riskLevel,
    riskReductionEUR: round2(Math.max(0, riskReductionEUR)),
    topLever,
  };
}

/**
 * 6. portfolio — overall portfolio balance risk (composite).
 *    portfolioScore = concentration × 0.25 + aging × 0.25 + liquidity × 0.20
 *                    + market × 0.15 + fraud × 0.15.
 *    Score = clamp(portfolioScore, 0, 100).
 *    riskLevel: HIGH if score < 40, MEDIUM if < 60, LOW otherwise.
 *    riskReductionEUR = average of other 5 riskReductionEUR × 0.5.
 */
function computePortfolioSignal(
  norm: NormalizedInput,
  baseSignals: RiskSignal[],
): RiskSignal {
  const concentrationScore = baseSignals.find((s) => s.name === 'concentration')?.score ?? 0;
  const agingScore = baseSignals.find((s) => s.name === 'aging')?.score ?? 0;
  const liquidityScore = baseSignals.find((s) => s.name === 'liquidity')?.score ?? 0;
  const marketScore = baseSignals.find((s) => s.name === 'market')?.score ?? 0;
  const fraudScore = baseSignals.find((s) => s.name === 'fraud')?.score ?? 0;

  const portfolioScore =
    concentrationScore * 0.25 +
    agingScore * 0.25 +
    liquidityScore * 0.20 +
    marketScore * 0.15 +
    fraudScore * 0.15;
  const score = clamp(portfolioScore, 0, 100);
  const riskLevel: RiskSignal['riskLevel'] =
    score < 40 ? 'HIGH' : score < 60 ? 'MEDIUM' : 'LOW';

  const avgReduction =
    baseSignals.reduce((a, s) => a + s.riskReductionEUR, 0) /
    Math.max(baseSignals.length, 1);
  const riskReductionEUR = avgReduction * 0.5;
  const topLever = `Portfolio tveganje ${score.toFixed(0)}/100 — ${score < 40 ? 'rebalanciraj: zmanjšaj koncentracijo, likvidiraj stare, diverzificiraj vire' : score < 60 ? 'optimiziraj top 2 tveganji' : 'zdrav portfolio'}`;
  return {
    name: 'portfolio',
    score: round2(score),
    grade: gradeFromScore(score),
    riskLevel,
    riskReductionEUR: round2(Math.max(0, riskReductionEUR)),
    topLever,
  };
}

// --- Synthesis ------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<RiskSignalName, number> = {
  concentration: 0.20,
  aging: 0.20,
  liquidity: 0.20,
  market: 0.15,
  fraud: 0.10,
  portfolio: 0.15,
};

function overallRiskLevelFromScore(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 70) return 'LOW';
  if (score >= 50) return 'MEDIUM';
  if (score >= 30) return 'HIGH';
  return 'CRITICAL';
}

function actionForSignal(signal: RiskSignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'concentration':
      return `Zmanjšaj koncentracijo: ${signal.topLever}`;
    case 'aging':
      return `Likvidiraj stari inventar: ${signal.topLever}`;
    case 'liquidity':
      return `Povečaj likvidnost: ${signal.topLever}`;
    case 'market':
      return `Hedge-aj tržno tveganje: ${signal.topLever}`;
    case 'fraud':
      return `Zmanjšaj fraud exposure: ${signal.topLever}`;
    case 'portfolio':
      return `Rebalanciraj portfolio: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

function buildOneLineSummary(
  overallRiskScore: number,
  overallRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  biggestRisk: RiskSignalName,
  biggestRiskValue: string,
  grade: ProfitGrade,
  topActions: RiskBrainAction[],
): string {
  const a0 = topActions[0]?.action ?? '';
  return `Tveganje ${overallRiskScore.toFixed(0)}/100 (${overallRiskLevel}). Največje: ${biggestRisk.toUpperCase()} ${biggestRiskValue}. ${a0}. Grade ${grade}.`;
}

function biggestRiskValueFor(
  signal: RiskSignal,
  norm: NormalizedInput,
): string {
  switch (signal.name) {
    case 'concentration':
      return `${norm.capitalConcentrationPct.toFixed(0)}%`;
    case 'aging':
      return `${norm.agedPct.toFixed(0)}%`;
    case 'liquidity':
      return `${signal.score.toFixed(0)}/100`;
    case 'market':
      return `${norm.marketVolatilityPct.toFixed(0)}% vol`;
    case 'fraud':
      return `${norm.fraudSuspicionsPct.toFixed(1)}%`;
    case 'portfolio':
      return `${signal.score.toFixed(0)}/100`;
    default:
      return '';
  }
}

/**
 * Risk Brain — pure deterministic compute.
 * Takes optional RiskBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 risk signals, top 3 mitigation actions, 30d/90d risk
 * projections (projectedRiskScore + recommendedRiskBudget), overall risk grade,
 * and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function riskBrain(input: RiskBrainInput = {}): RiskBrainResult {
  const norm = normalizeInput(input);

  // --- Compute 5 of 6 signals first (portfolio depends on others) ----------
  const concentration = computeConcentrationSignal(norm);
  const aging = computeAgingSignal(norm);
  const liquidity = computeLiquiditySignal(norm);
  const market = computeMarketSignal(norm);
  const fraud = computeFraudSignal(norm);

  const baseSignals: RiskSignal[] = [concentration, aging, liquidity, market, fraud];

  // --- Portfolio signal (depends on the other 5) ----------------------------
  const portfolio = computePortfolioSignal(norm, baseSignals);

  const signals: RiskSignal[] = [...baseSignals, portfolio];

  // --- Weighted overall risk score -----------------------------------------
  const overallRiskScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const riskGrade = gradeFromScore(overallRiskScore);
  const overallRiskLevel = overallRiskLevelFromScore(overallRiskScore);

  // --- Top 3 actions (sorted by riskReduction × confidence weight) -------
  // Confidence = HIGH if riskLevel is HIGH/CRITICAL (urgent), MEDIUM if MEDIUM,
  // LOW otherwise. Lower score (= higher risk) → higher confidence → action
  // ranks higher.
  const ranked = signals
    .map((s) => {
      const confidence = confidenceFromRiskLevel(s.riskLevel);
      return {
        signal: s,
        confidence,
        rankScore: s.riskReductionEUR * confidenceWeight(confidence),
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  const top3 = ranked.slice(0, 3);
  const topActions: RiskBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'risk',
    signal: entry.signal.name,
    action: actionForSignal(entry.signal),
    expectedUpliftEUR: round2(entry.signal.riskReductionEUR),
    confidence: entry.confidence,
  }));

  // --- Biggest risk = signal with LOWEST score (highest risk) ------------
  const biggestRiskSignal = signals.reduce(
    (worst, s) => (s.score < worst.score ? s : worst),
    signals[0],
  );
  const biggestRisk = biggestRiskSignal.name;
  const biggestRiskValue = biggestRiskValueFor(biggestRiskSignal, norm);

  // --- 30d projection (15-point risk improvement) -------------------------
  const projection30d = {
    projectedRiskScore: round2(clamp(overallRiskScore + 15, 0, 100)),
    projectedConcentrationPct: round2(
      Math.max(35, norm.capitalConcentrationPct - 20),
    ),
    projectedAgedPct: round2(Math.max(5, norm.agedPct - 30)),
    recommendedRiskBudget: round2(
      norm.totalCapitalDeployed * (clamp(overallRiskScore + 15, 0, 100) / 100),
    ),
  };

  // --- 90d projection (30-point risk improvement, 20% growth allowed) -----
  const projectedRiskScore90 = clamp(overallRiskScore + 30, 0, 100);
  const projection90d = {
    projectedRiskScore: round2(projectedRiskScore90),
    projectedConcentrationPct: round2(
      Math.max(30, norm.capitalConcentrationPct - 30),
    ),
    projectedAgedPct: round2(Math.max(2, norm.agedPct - 50)),
    recommendedRiskBudget: round2(
      norm.totalCapitalDeployed * (projectedRiskScore90 / 100) * 1.2,
    ),
  };

  // --- One-line summary ---------------------------------------------------
  const oneLineSummary = buildOneLineSummary(
    overallRiskScore,
    overallRiskLevel,
    biggestRisk,
    biggestRiskValue,
    riskGrade,
    topActions,
  );

  return {
    ok: true,
    signals,
    current: {
      totalCapitalDeployed: round2(norm.totalCapitalDeployed),
      inventoryValue: round2(norm.inventoryValue),
      agedInventoryValue: round2(norm.agedInventoryValue),
      agedPct: round2(norm.agedPct),
      capitalConcentrationPct: round2(norm.capitalConcentrationPct),
      monthlyRevenue: round2(norm.monthlyRevenue),
      monthlyProfit: round2(norm.monthlyProfit),
      activeSources: norm.activeSources,
      fraudSuspicionsPct: round2(norm.fraudSuspicionsPct),
      avgDaysToSell: round2(norm.avgDaysToSell),
      marketVolatilityPct: round2(norm.marketVolatilityPct),
      overallRiskScore: round2(overallRiskScore),
    },
    maximization: {
      topActions,
      projection30d,
      projection90d,
      riskGrade,
      biggestRisk,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.19-risk-brain',
  };
}
