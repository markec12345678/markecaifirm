// v8.16: Inventory Brain — synthesizes 6 inventory signals into ONE decision.
// Pure deterministic compute — no AI, no DB, no side effects.
//
// Architectural role: this is the SECOND Brain layer (after Profit Brain in
// v8.15) that sits ABOVE the 72 inventory specialist endpoints. Each
// specialist measures ONE inventory dimension (aging, turnover, yield,
// capital efficiency, liquidation, health). The Inventory Brain reads
// inventory state + capital context and synthesizes 6 inventory signals
// (turnover, aging, yield, capitalEfficiency, liquidation, health) into:
//   - 3 top actions for today, ranked by expectedUpliftEUR × confidence
//   - 30d / 90d inventory health projections
//   - overall inventory grade (weighted across 6 signals)
//   - one-line summary that names the single biggest lever
//
// DIFFERENCES from Profit Brain (v8.15):
//  - Profit Brain reads TRADE history (monthlyProfits[]) and synthesizes
//    profit-growth signals. Inventory Brain reads INVENTORY STATE (itemCount,
//    agedItemsCount, capitalDeployed) and synthesizes inventory-health signals.
//  - Profit Brain's projection30d/projection90d are scalars (EUR/mo).
//    Inventory Brain's projections are STRUCTURED objects with multiple
//    fields (recommendedItemsToSell/Buy, projectedInventoryValue,
//    projectedAgedPct, projectedTurnoverRate) — because inventory optimization
//    is multi-dimensional (volume + composition + capital + aged stock).
//  - Profit Brain = "how much money are you making?".
//    Inventory Brain = "how well is your stock performing as capital?".
//
// DIFFERENCES from the 72 inventory specialists:
//  - Specialists measure ONE dimension (e.g. inventory-aging,
//    inventory-turnover-weekly, inventory-yield-margin). Brain SYNTHESIZES
//    6 dimensions into one decision.
//  - Specialists are flat endpoints. Brain sits ABOVE them.
//  - In v8.16 the Brain computes the 6 signals itself (pure deterministic
//    TypeScript — no AI, no HTTP fan-out). This keeps the Brain fast (<5ms)
//    and fully testable.
//
// This module is a PURE TypeScript function — no `next/server` import, no
// Prisma calls (state is injected by the caller via InventoryBrainInput). It
// is fully testable in isolation and deterministic given the same input.

// --- Types ----------------------------------------------------------------

import type { ProfitGrade, Confidence } from './profit';

export interface InventoryBrainInput {
  itemCount?: number; // total SKUs in inventory
  totalInventoryValue?: number; // EUR (sum of buy prices of unsold items)
  avgDaysToSell?: number; // weighted average days from buy to sell
  agedItemsCount?: number; // items held > 30 days (stale inventory)
  agedItemsValue?: number; // EUR value of stale items
  avgProfitMarginPct?: number; // average profit margin % (sell-buy)/buy × 100
  capitalDeployed?: number; // total capital in inventory right now
  monthlySalesCount?: number; // items sold in last 30 days
  monthlyRevenue?: number; // EUR sold in last 30 days
}

export type InventorySignalName =
  | 'turnover' // how fast inventory sells (days-to-sell)
  | 'aging' // stale inventory health (aged items %)
  | 'yield' // profit per inventory € deployed
  | 'capitalEfficiency' // capital deployed vs return
  | 'liquidation' // how well you exit slow movers
  | 'health'; // overall inventory composition

export interface InventorySignal {
  name: InventorySignalName;
  score: number; // 0-100 normalized
  grade: ProfitGrade;
  upliftEURPerMonth: number; // normalized expected €/month uplift if this signal is maximized
  topLever: string; // human-readable action lever
}

export interface InventoryBrainAction {
  rank: number;
  domain: 'inventory'; // 'inventory' for v8.16
  signal: InventorySignalName;
  action: string; // human-readable, e.g. "Likvidiraj 3 stale item-e z 15% popustom"
  expectedUpliftEUR: number; // €/month
  confidence: Confidence;
}

export interface InventoryBrainResult {
  ok: true;
  signals: InventorySignal[]; // exactly 6 entries
  current: {
    itemCount: number;
    totalInventoryValue: number;
    avgDaysToSell: number;
    agedItemsCount: number;
    agedItemsPct: number; // agedItemsCount / itemCount × 100
    avgProfitMarginPct: number;
    capitalDeployed: number;
    monthlySalesCount: number;
    monthlyRevenue: number;
    inventoryTurnoverRate: number; // monthlySalesCount / itemCount
  };
  maximization: {
    topActions: InventoryBrainAction[]; // up to 3 actions, ranked by uplift × confidence
    projection30d: {
      recommendedItemsToSell: number;
      recommendedItemsToBuy: number;
      projectedInventoryValue: number;
      projectedAgedPct: number;
    };
    projection90d: {
      projectedInventoryValue: number;
      projectedAgedPct: number;
      projectedTurnoverRate: number;
    };
    inventoryGrade: ProfitGrade; // weighted across 6 signals
    bestOpportunity: InventorySignalName; // signal with highest upliftEURPerMonth
    oneLineSummary: string;
  };
  aiUsed: false;
  source: 'v8.16-inventory-brain';
  cachedAt?: number; // set by caller when served from cache
}

// --- Defaults -------------------------------------------------------------

const DEFAULT_ITEM_COUNT = 18;
const DEFAULT_TOTAL_INVENTORY_VALUE = 1500;
const DEFAULT_AVG_DAYS_TO_SELL = 14;
const DEFAULT_AGED_ITEMS_COUNT = 3;
const DEFAULT_AGED_ITEMS_VALUE = 280;
const DEFAULT_AVG_PROFIT_MARGIN_PCT = 25;
const DEFAULT_CAPITAL_DEPLOYED = 1500;
const DEFAULT_MONTHLY_SALES_COUNT = 10;
const DEFAULT_MONTHLY_REVENUE = 350;

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
  itemCount: number;
  totalInventoryValue: number;
  avgDaysToSell: number;
  agedItemsCount: number;
  agedItemsValue: number;
  avgProfitMarginPct: number;
  capitalDeployed: number;
  monthlySalesCount: number;
  monthlyRevenue: number;
  agedPct: number; // agedItemsCount / max(itemCount,1) × 100
  turnoverRate: number; // monthlySalesCount / max(itemCount,1)
}

function normalizeInput(
  input: InventoryBrainInput | undefined | null,
): NormalizedInput {
  const itemCount =
    input?.itemCount != null && Number.isFinite(input.itemCount)
      ? input.itemCount
      : DEFAULT_ITEM_COUNT;
  const totalInventoryValue =
    input?.totalInventoryValue != null && Number.isFinite(input.totalInventoryValue)
      ? input.totalInventoryValue
      : DEFAULT_TOTAL_INVENTORY_VALUE;
  const avgDaysToSell =
    input?.avgDaysToSell != null && Number.isFinite(input.avgDaysToSell)
      ? input.avgDaysToSell
      : DEFAULT_AVG_DAYS_TO_SELL;
  const agedItemsCount =
    input?.agedItemsCount != null && Number.isFinite(input.agedItemsCount)
      ? input.agedItemsCount
      : DEFAULT_AGED_ITEMS_COUNT;
  const agedItemsValue =
    input?.agedItemsValue != null && Number.isFinite(input.agedItemsValue)
      ? input.agedItemsValue
      : DEFAULT_AGED_ITEMS_VALUE;
  const avgProfitMarginPct =
    input?.avgProfitMarginPct != null && Number.isFinite(input.avgProfitMarginPct)
      ? input.avgProfitMarginPct
      : DEFAULT_AVG_PROFIT_MARGIN_PCT;
  const capitalDeployed =
    input?.capitalDeployed != null && Number.isFinite(input.capitalDeployed)
      ? input.capitalDeployed
      : DEFAULT_CAPITAL_DEPLOYED;
  const monthlySalesCount =
    input?.monthlySalesCount != null && Number.isFinite(input.monthlySalesCount)
      ? input.monthlySalesCount
      : DEFAULT_MONTHLY_SALES_COUNT;
  const monthlyRevenue =
    input?.monthlyRevenue != null && Number.isFinite(input.monthlyRevenue)
      ? input.monthlyRevenue
      : DEFAULT_MONTHLY_REVENUE;

  const safeItems = Math.max(itemCount, 1);
  const agedPct = (agedItemsCount / safeItems) * 100;
  const turnoverRate = monthlySalesCount / safeItems;

  return {
    itemCount,
    totalInventoryValue,
    avgDaysToSell,
    agedItemsCount,
    agedItemsValue,
    avgProfitMarginPct,
    capitalDeployed,
    monthlySalesCount,
    monthlyRevenue,
    agedPct,
    turnoverRate,
  };
}

/**
 * 1. turnover — how fast inventory sells.
 *    turnoverRate = monthlySalesCount / max(itemCount, 1).
 *    Score = clamp(turnoverRate × 30, 0, 100).  (turnoverRate 3.33/mo = 100)
 *    Uplift = (turnoverRate × totalInventoryValue × avgProfitMarginPct/100) × 0.2
 *             (20 % headroom from faster turnover)
 */
function computeTurnoverSignal(norm: NormalizedInput): InventorySignal {
  const score = clamp(norm.turnoverRate * 30, 0, 100);
  const profitPool =
    norm.turnoverRate * norm.totalInventoryValue * (norm.avgProfitMarginPct / 100);
  const upliftEURPerMonth = round2(Math.max(0, profitPool * 0.2));
  const targetDays = Math.max(3, Math.round(norm.avgDaysToSell * 0.6));
  return {
    name: 'turnover',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Pospeši turnover — skrajšaj povprečni čas prodaje iz ${Math.round(
      norm.avgDaysToSell,
    )} na ${targetDays} dni z boljšo fotko in ceno`,
  };
}

/**
 * 2. aging — stale inventory % health.
 *    agedPct = agedItemsCount / max(itemCount, 1) × 100.
 *    Score = clamp(100 - agedPct × 2, 0, 100).  (0 % aged = 100, 50 % aged = 0)
 *    Uplift = agedItemsValue × 0.15  (recover 15 % of stale value via liquidation)
 */
function computeAgingSignal(norm: NormalizedInput): InventorySignal {
  const score = clamp(100 - norm.agedPct * 2, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.agedItemsValue * 0.15));
  return {
    name: 'aging',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever: `Likvidiraj ${norm.agedItemsCount} starih itemov (>30d) z 10–15 % popustom preden postanejo dead stock`,
  };
}

/**
 * 3. yield — profit per inventory € deployed.
 *    yieldPct = (monthlyRevenue × avgProfitMarginPct/100) / max(totalInventoryValue, 1) × 100.
 *    Score = clamp(yieldPct × 5, 0, 100).  (20 %/mo yield = 100)
 *    Uplift = totalInventoryValue × 0.03  (3 % yield improvement)
 */
function computeYieldSignal(norm: NormalizedInput): InventorySignal {
  const safeInv = Math.max(norm.totalInventoryValue, 1);
  const yieldPct =
    ((norm.monthlyRevenue * (norm.avgProfitMarginPct / 100)) / safeInv) * 100;
  const score = clamp(yieldPct * 5, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.totalInventoryValue * 0.03));
  return {
    name: 'yield',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever:
      'Povečaj yield — prestavi capital iz low-yield (margin <15 %) v high-yield kategorije (margin >30 %)',
  };
}

/**
 * 4. capitalEfficiency — capital deployed vs return.
 *    capitalEfficiency = monthlyRevenue / max(capitalDeployed, 1) (× per month).
 *    Score = clamp(capitalEfficiency × 20, 0, 100).  (5×/mo = 100)
 *    Uplift = capitalDeployed × 0.04  (4 % capital efficiency gain)
 */
function computeCapitalEfficiencySignal(norm: NormalizedInput): InventorySignal {
  const safeCap = Math.max(norm.capitalDeployed, 1);
  const capitalEfficiency = norm.monthlyRevenue / safeCap;
  const score = clamp(capitalEfficiency * 20, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.capitalDeployed * 0.04));
  return {
    name: 'capitalEfficiency',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever:
      'Optimiziraj capital efficiency — zmanjšaj capital tied up v slow movers za 20 %',
  };
}

/**
 * 5. liquidation — how well you exit slow movers.
 *    liquidationRate = monthlySalesCount / max(itemCount, 1)  (exit velocity).
 *    Score = clamp(liquidationRate × 25, 0, 100).  (4×/mo = 100)
 *    Uplift = agedItemsValue × 0.3  (recover 30 % of stale value via aggressive liquidation)
 */
function computeLiquidationSignal(norm: NormalizedInput): InventorySignal {
  const liquidationRate = norm.turnoverRate; // same base ratio, exit-velocity framing
  const score = clamp(liquidationRate * 25, 0, 100);
  const upliftEURPerMonth = round2(Math.max(0, norm.agedItemsValue * 0.3));
  return {
    name: 'liquidation',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever:
      'Aktiviraj likvidacijo — postavi 3 stare iteme na Bolha auction z 15 % popustom in relist na Vinted',
  };
}

/**
 * 6. health — overall inventory composition (weighted blend of the other 5).
 *    healthScore = turnover × 0.25 + (100 - agedPct × 2) × 0.25 + yield × 0.20
 *                  + capitalEfficiency × 0.15 + liquidation × 0.15.
 *    Uplift = average of other 5 uplifts × 0.5  (rebalancing compounds all signals).
 *
 * Note: this signal is computed AFTER the other 5 because it depends on their
 * scores. The synthesis function passes a precomputed set of base signals.
 */
function computeHealthSignal(
  norm: NormalizedInput,
  baseSignals: InventorySignal[],
): InventorySignal {
  const turnoverScore = baseSignals.find((s) => s.name === 'turnover')?.score ?? 0;
  const yieldScore = baseSignals.find((s) => s.name === 'yield')?.score ?? 0;
  const capEffScore =
    baseSignals.find((s) => s.name === 'capitalEfficiency')?.score ?? 0;
  const liquidationScore =
    baseSignals.find((s) => s.name === 'liquidation')?.score ?? 0;

  const healthScore =
    turnoverScore * 0.25 +
    (100 - norm.agedPct * 2) * 0.25 +
    yieldScore * 0.2 +
    capEffScore * 0.15 +
    liquidationScore * 0.15;
  const score = clamp(healthScore, 0, 100);

  const avgUplift =
    baseSignals.reduce((a, s) => a + s.upliftEURPerMonth, 0) /
    Math.max(baseSignals.length, 1);
  const upliftEURPerMonth = round2(Math.max(0, avgUplift * 0.5));

  return {
    name: 'health',
    score: round2(score),
    grade: gradeFromScore(score),
    upliftEURPerMonth,
    topLever:
      'Rebalanciraj inventar — 60 % fast movers, 30 % medium, 10 % speculative',
  };
}

// --- Synthesis ------------------------------------------------------------

const SIGNAL_WEIGHTS: Record<InventorySignalName, number> = {
  turnover: 0.2,
  aging: 0.2,
  yield: 0.2,
  capitalEfficiency: 0.15,
  liquidation: 0.15,
  health: 0.1,
};

function actionForSignal(signal: InventorySignal): string {
  // Templated human-readable action derived from the signal's topLever.
  switch (signal.name) {
    case 'turnover':
      return `Pospeši turnover: ${signal.topLever}`;
    case 'aging':
      return `Zmanjšaj aging: ${signal.topLever}`;
    case 'yield':
      return `Povečaj yield: ${signal.topLever}`;
    case 'capitalEfficiency':
      return `Optimiziraj capital: ${signal.topLever}`;
    case 'liquidation':
      return `Aktiviraj likvidacijo: ${signal.topLever}`;
    case 'health':
      return `Rebalanciraj inventar: ${signal.topLever}`;
    default:
      return signal.topLever;
  }
}

function buildOneLineSummary(
  itemCount: number,
  totalInventoryValue: number,
  agedItemsCount: number,
  grade: ProfitGrade,
  topActions: InventoryBrainAction[],
): string {
  const a0 = topActions[0]?.action ?? '';
  return `Inventar ${itemCount} itemov (${Math.round(
    totalInventoryValue,
  )}€), ${agedItemsCount} stari. ${a0}. Grade ${grade}.`;
}

/**
 * Inventory Brain — pure deterministic compute.
 * Takes optional InventoryBrainInput (with sensible defaults) and returns a
 * synthesized decision: 6 inventory signals, top 3 actions, 30d/90d inventory
 * projections, overall inventory grade, and a one-line summary.
 *
 * No side effects. No external calls. No DB. No AI.
 */
export function inventoryBrain(
  input?: InventoryBrainInput,
): InventoryBrainResult {
  const norm = normalizeInput(input);

  // --- Compute 5 of 6 signals first (health depends on others) -----------
  const turnover = computeTurnoverSignal(norm);
  const aging = computeAgingSignal(norm);
  const yieldSignal = computeYieldSignal(norm);
  const capitalEfficiency = computeCapitalEfficiencySignal(norm);
  const liquidation = computeLiquidationSignal(norm);

  const baseSignals: InventorySignal[] = [
    turnover,
    aging,
    yieldSignal,
    capitalEfficiency,
    liquidation,
  ];

  // --- Health signal (depends on the other 5) ----------------------------
  const health = computeHealthSignal(norm, baseSignals);

  const signals: InventorySignal[] = [...baseSignals, health];

  // --- Weighted overall inventory grade ----------------------------------
  const weightedScore = signals.reduce(
    (acc, s) => acc + s.score * SIGNAL_WEIGHTS[s.name],
    0,
  );
  const inventoryGrade = gradeFromScore(weightedScore);

  // --- Top 3 actions (sorted by uplift × confidence weight) -------------
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
  const topActions: InventoryBrainAction[] = top3.map((entry, i) => ({
    rank: i + 1,
    domain: 'inventory',
    signal: entry.signal.name,
    action: actionForSignal(entry.signal),
    expectedUpliftEUR: round2(entry.signal.upliftEURPerMonth),
    confidence: entry.confidence,
  }));

  // --- 30d projection (liquidation-focused) -------------------------------
  const projection30d = {
    recommendedItemsToSell: Math.max(0, norm.agedItemsCount), // sell all stale items in 30d
    recommendedItemsToBuy: Math.max(2, Math.floor(norm.monthlySalesCount * 0.3)), // replenish 30 % of sold volume
    projectedInventoryValue: round2(norm.totalInventoryValue * 0.85), // 15 % reduction via liquidation
    projectedAgedPct: round2(Math.max(0, norm.agedPct - 50)), // halve aged %
  };

  // --- 90d projection (smart-replenishment growth) -----------------------
  const projection90d = {
    projectedInventoryValue: round2(norm.totalInventoryValue * 1.1), // 10 % growth via smart replenishment
    projectedAgedPct: round2(Math.max(0, norm.agedPct - 70)), // 70 % reduction in aged items
    projectedTurnoverRate: round2(norm.turnoverRate * 1.4), // 40 % faster turnover
  };

  // --- Best opportunity (highest uplift signal) -------------------------
  const bestOpportunity = signals.reduce(
    (best, s) => (s.upliftEURPerMonth > best.upliftEURPerMonth ? s : best),
    signals[0],
  ).name;

  // --- One-line summary --------------------------------------------------
  const oneLineSummary = buildOneLineSummary(
    norm.itemCount,
    norm.totalInventoryValue,
    norm.agedItemsCount,
    inventoryGrade,
    topActions,
  );

  return {
    ok: true,
    signals,
    current: {
      itemCount: norm.itemCount,
      totalInventoryValue: round2(norm.totalInventoryValue),
      avgDaysToSell: round2(norm.avgDaysToSell),
      agedItemsCount: norm.agedItemsCount,
      agedItemsPct: round2(norm.agedPct),
      avgProfitMarginPct: round2(norm.avgProfitMarginPct),
      capitalDeployed: round2(norm.capitalDeployed),
      monthlySalesCount: round2(norm.monthlySalesCount),
      monthlyRevenue: round2(norm.monthlyRevenue),
      inventoryTurnoverRate: round2(norm.turnoverRate),
    },
    maximization: {
      topActions,
      projection30d,
      projection90d,
      inventoryGrade,
      bestOpportunity,
      oneLineSummary,
    },
    aiUsed: false,
    source: 'v8.16-inventory-brain',
  };
}
