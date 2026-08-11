// v8.12: AI Profit Per Cycle Maximizer — AI MAKSIMIZIRA PROFIT PER CYCLE
// — vsak cikel je komplet buy-to-sell turnaround. "Tvoj profit per cycle je
// 45€, ampak bi lahko bil 85€ z better sourcing in higher sell prices."
// Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira
// VELOCITY kapitala skozi inventory — koliko cycle-ov/leto capital ciklira)
// — ta MAKSIMIZIRA PROFIT PER CYCLE (€/cycle extracted per individual cycle,
// ne število ciklov). Razlika od profit-growth-rate-maximizer (v8.11 ki
// maksimizira GROWTH RATE skupnega profit-a v %/mo MoM) — ta MAKSIMIZIRA PROFIT
// PER CYCLE v absolutnem €/cycle (per-cycle extraction, ne %/mo growth).
// Razlika od inventory-annual-yield-maximizer (v8.11 ki maksimizira annual
// yield held inventory-ja) — ta MAKSIMIZIRA PROFIT PER CYCLE (per-cycle €,
// ne letni yield %). Razlika od deal-source-profit-per-day-maximizer (v8.11
// ki maksimizira profit per day per source €/dan) — ta MAKSIMIZIRA PROFIT
// PER CYCLE čez celoten portfolio (€/cycle, ne €/dan per source). Razlika od
// profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier
// z 6 dimensions) — ta MAKSIMIZIRA PROFIT PER CYCLE z maximizationLevers
// (BETTER_SOURCING/HIGHER_SELL_PRICE/LOWER_FEES/BUNDLE_UPSELL/REFURBISHMENT)
// in cycleVsVolumeTradeoff. Razlika od profit-velocity-maximizer (v7.98 ki
// maksimizira €/day velocity) — ta MAKSIMIZIRA PROFIT PER CYCLE (€/cycle, ne
// €/dan). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira
// in skalira daily profit z scalingPath) — ta MAKSIMIZIRA PROFIT PER CYCLE
// z cycleEfficiencyScore in optimalCycleStrategy (HIGH_MARGIN_LOW_VOLUME vs
// LOW_MARGIN_HIGH_VOLUME). Razlika od profit-per-trade-growth-maximizer
// (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo) — ta
// MAKSIMIZIRA PROFIT PER CYCLE (absolute €/cycle, ne growth rate €/mo).
// Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily
// profit per item) — ta MAKSIMIZIRA PROFIT PER CYCLE (€/cycle absolute, ne
// €/dan per item). Razlika from profit-per-euro-maximizer (v8.07 ki
// maksimizira profit per € deployed) — ta MAKSIMIZIRA PROFIT PER CYCLE (€
// extracted per cycle, ne € profit per € capital).

// GET+POST /api/ai/profit-per-cycle-maximizer
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

type CycleLeverType =
  | 'BETTER_SOURCING'
  | 'HIGHER_SELL_PRICE'
  | 'LOWER_FEES'
  | 'BUNDLE_UPSELL'
  | 'REFURBISHMENT';
type CycleGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type CycleStrategy = 'HIGH_MARGIN_LOW_VOLUME' | 'LOW_MARGIN_HIGH_VOLUME' | 'BALANCED';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface CurrentState {
  avgProfitPerCycle: number; // €/cycle = avg((sellPrice − sellFees) − (buyPrice + buyFees)) over SOLD 12m
  avgCycleTime: number; // days = avg(sellDate − buyDate)
  cyclesPerYear: number; // = 365 / avgCycleTime (capped)
  totalAnnualProfit: number; // € = avgProfitPerCycle × cyclesPerYear
  soldCount12m: number;
  totalProfit12m: number; // €
  avgSellPrice: number; // € = avg(sellPrice)
  avgBuyCost: number; // € = avg(buyPrice + buyFees)
  avgFeesRatio: number; // % = (avg(buyFees + sellFees) / avg(buyPrice + sellPrice)) × 100
  bestCycleProfit: number; // € = max single-cycle profit (top decile avg)
  worstCycleProfit: number; // € = min single-cycle profit (bottom decile avg)
}

interface CycleLeverEntry {
  lever: CycleLeverType;
  currentGap: number; // € [0, 5000] — how much potential is left unrealized on this lever
  potentialGain: number; // € [0, 5000] — max €/cycle gain possible from this lever
  action: string; // slovenski, max 200
}

interface CycleMaximization {
  maximizedProfitPerCycle: number; // €/cycle [0, 5000] (≥ current, ≤ current × 3, ≤ 5000 — anti-hallucination)
  cycleUplift: number; // €/cycle [0, 5000] = maximized − current
  maximizationLevers: CycleLeverEntry[]; // 5 entries
  cycleEfficiencyScore: number; // [0, 100]
  projectedAnnualProfit: number; // € = maximizedProfitPerCycle × cyclesPerYear
  cycleVsVolumeTradeoff: string; // slovenski, max 300
  cycleGrade: CycleGrade;
  optimalCycleStrategy: CycleStrategy;
}

interface ProfitPerCycleMaximizerResponse {
  ok: true;
  current: CurrentState;
  maximization: CycleMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedProfitPerCycle?: number;
    cycleUplift?: number;
    maximizationLevers?: Array<{
      lever?: CycleLeverType;
      currentGap?: number;
      potentialGain?: number;
      action?: string;
    }>;
    cycleEfficiencyScore?: number;
    cycleVsVolumeTradeoff?: string;
    cycleGrade?: CycleGrade;
    optimalCycleStrategy?: CycleStrategy;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 5000; // per-cycle profit cap
const CYCLE_TIME_MIN = 1;
const CYCLE_TIME_MAX = 730;
const CYCLES_MIN = 0;
const CYCLES_MAX = 365;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 5000;
const GAIN_MIN = 0;
const GAIN_MAX = 5000;
const GAP_MIN = 0;
const GAP_MAX = 5000;
const FEES_RATIO_MIN = 0;
const FEES_RATIO_MAX = 100;
const ANNUAL_PROFIT_MIN = 0;
const ANNUAL_PROFIT_MAX = 1_000_000;
const MAX_TRADES_FOR_AI = 250;
const ABSOLUTE_UPLIFT_CAP_PCT = 200; // max +200% relative uplift (3× current)
const MAX_LEVERS = 5;

const VALID_GRADE: readonly CycleGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_LEVER: readonly CycleLeverType[] = [
  'BETTER_SOURCING',
  'HIGHER_SELL_PRICE',
  'LOWER_FEES',
  'BUNDLE_UPSELL',
  'REFURBISHMENT',
];
const VALID_STRATEGY: readonly CycleStrategy[] = [
  'HIGH_MARGIN_LOW_VOLUME',
  'LOW_MARGIN_HIGH_VOLUME',
  'BALANCED',
];

// Per-lever relative uplift potential (% improvement to current per-cycle profit)
// Sum = 105% (with realistic discount for independence → ~70-80% achievable)
const LEVER_GAIN_PCT: Record<CycleLeverType, number> = {
  BETTER_SOURCING: 25, // +25% by sourcing cheaper deals (better buy prices)
  HIGHER_SELL_PRICE: 35, // +35% by AI pricing engine (premium sell prices)
  LOWER_FEES: 10, // +10% by reducing platform fees, bundle deals, tax-aware selling
  BUNDLE_UPSELL: 15, // +15% by bundling complementary items
  REFURBISHMENT: 20, // +20% by refurbishing/cleaning items before sale
};

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
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}
function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
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

// --- Deterministic computation ------------------------------------------

interface SoldComputed {
  profit: number; // € = (sellPrice − sellFees) − (buyPrice + buyFees)
  capital: number; // € = buyPrice + buyFees
  sellPrice: number; // €
  buyCost: number; // € = buyPrice + buyFees
  fees: number; // € = buyFees + sellFees
  holdDays: number;
  sellMs: number;
  within12m: boolean;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const sellPrice = t.sellPrice ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  if (!within12m) return null;
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellFees = t.sellFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const profit = (sellPrice - sellFees) - capital;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 && sellMs > 0
    ? Math.max(1, Math.round((sellMs - buyMs) / DAY_MS))
    : 30;
  return {
    profit,
    capital,
    sellPrice,
    buyCost: capital,
    fees: buyFees + sellFees,
    holdDays,
    sellMs,
    within12m,
  };
}

function computeCurrent(sold: SoldComputed[]): CurrentState {
  const n = sold.length;
  const totalProfit = sold.reduce((s, t) => s + t.profit, 0);
  const totalCapital = sold.reduce((s, t) => s + t.capital, 0);
  const totalSellPrice = sold.reduce((s, t) => s + t.sellPrice, 0);
  const totalBuyCost = sold.reduce((s, t) => s + t.buyCost, 0);
  const totalFees = sold.reduce((s, t) => s + t.fees, 0);
  const totalHoldDays = sold.reduce((s, t) => s + t.holdDays, 0);

  const avgProfitPerCycle = round2(clampNum(
    n > 0 ? totalProfit / n : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const avgCycleTime = round0(clampNum(
    n > 0 ? totalHoldDays / n : 0,
    n > 0 ? CYCLE_TIME_MIN : 0, CYCLE_TIME_MAX, 30,
  ));
  const cyclesPerYear = round2(clampNum(
    avgCycleTime > 0 ? 365 / avgCycleTime : 0,
    CYCLES_MIN, CYCLES_MAX, 0,
  ));
  const totalAnnualProfit = round0(clampNum(
    avgProfitPerCycle * cyclesPerYear,
    ANNUAL_PROFIT_MIN, ANNUAL_PROFIT_MAX, 0,
  ));
  const avgSellPrice = round2(clampNum(
    n > 0 ? totalSellPrice / n : 0,
    PROFIT_MIN, PROFIT_MAX * 10, 0,
  ));
  const avgBuyCost = round2(clampNum(
    n > 0 ? totalBuyCost / n : 0,
    PROFIT_MIN, PROFIT_MAX * 10, 0,
  ));
  const avgFeesRatio = round2(clampNum(
    (totalBuyCost + totalSellPrice) > 0
      ? (totalFees / (totalBuyCost + totalSellPrice)) * 100
      : 0,
    FEES_RATIO_MIN, FEES_RATIO_MAX, 0,
  ));

  // Best/worst cycle profit — top/bottom decile averages (fallback to max/min)
  const sortedByProfit = [...sold].sort((a, b) => a.profit - b.profit);
  const decileSize = Math.max(1, Math.floor(n / 10));
  const bottomSlice = sortedByProfit.slice(0, decileSize);
  const topSlice = sortedByProfit.slice(-decileSize);
  const bestCycleProfit = round2(clampNum(
    topSlice.length > 0 ? topSlice.reduce((s, t) => s + t.profit, 0) / topSlice.length : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const worstCycleProfit = round2(clampNum(
    bottomSlice.length > 0 ? bottomSlice.reduce((s, t) => s + t.profit, 0) / bottomSlice.length : 0,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  return {
    avgProfitPerCycle,
    avgCycleTime,
    cyclesPerYear,
    totalAnnualProfit,
    soldCount12m: n,
    totalProfit12m: round0(clampNum(totalProfit, -100_000, 1_000_000, 0)),
    avgSellPrice,
    avgBuyCost,
    avgFeesRatio,
    bestCycleProfit,
    worstCycleProfit,
  };
}

// --- Deterministic maximization -----------------------------------------

function computeCycleEfficiencyScore(current: CurrentState): number {
  // Margin per cycle: max 40 pts at 200€/cycle, scaled linearly
  const marginScore = Math.min(40, Math.max(0, current.avgProfitPerCycle / 5));
  // Cycle time: max 30 pts at 1d, 0 at 300d
  const cycleTimeScore = current.avgCycleTime > 0
    ? Math.max(0, 30 - current.avgCycleTime / 10)
    : 0;
  // Fee ratio: max 20 pts at 0%, 0 at 10%
  const feeScore = Math.max(0, 20 - current.avgFeesRatio * 2);
  // Cycle velocity: max 10 pts at 10+ cycles/year
  const velocityScore = Math.min(10, current.cyclesPerYear);
  const total = marginScore + cycleTimeScore + feeScore + velocityScore;
  return round0(clampNum(total, SCORE_MIN, SCORE_MAX, 0));
}

function decideCycleGrade(maximizedProfitPerCycle: number): CycleGrade {
  if (maximizedProfitPerCycle >= 200) return 'A+';
  if (maximizedProfitPerCycle >= 100) return 'A';
  if (maximizedProfitPerCycle >= 50) return 'B';
  if (maximizedProfitPerCycle >= 25) return 'C';
  if (maximizedProfitPerCycle >= 10) return 'D';
  return 'F';
}

function decideOptimalCycleStrategy(
  current: CurrentState,
  maximizedProfitPerCycle: number,
): CycleStrategy {
  // HIGH_MARGIN_LOW_VOLUME: when current cycle profit is low and per-cycle improvement is the bigger lever
  // LOW_MARGIN_HIGH_VOLUME: when current cycles/year is low and per-cycle profit is already high
  // BALANCED: when both are within healthy ranges
  if (current.avgProfitPerCycle < 25 && current.cyclesPerYear >= 8) {
    return 'LOW_MARGIN_HIGH_VOLUME';
  }
  if (current.avgProfitPerCycle >= 50 && current.cyclesPerYear < 8) {
    return 'HIGH_MARGIN_LOW_VOLUME';
  }
  if (maximizedProfitPerCycle >= 100 && current.cyclesPerYear < 10) {
    return 'HIGH_MARGIN_LOW_VOLUME';
  }
  if (maximizedProfitPerCycle < 30 && current.cyclesPerYear >= 12) {
    return 'LOW_MARGIN_HIGH_VOLUME';
  }
  return 'BALANCED';
}

function buildCycleVsVolumeTradeoff(
  current: CurrentState,
  maximizedProfitPerCycle: number,
  strategy: CycleStrategy,
): string {
  const currentAnnual = current.avgProfitPerCycle * current.cyclesPerYear;
  const maximizedAnnual = maximizedProfitPerCycle * current.cyclesPerYear;
  // Hypothetical: 2× volume with 0.5× margin
  const doubledVolumeAnnual = (maximizedProfitPerCycle * 0.5) * (current.cyclesPerYear * 2);
  // Hypothetical: 0.5× volume with 1.5× margin
  const halvedVolumeAnnual = (maximizedProfitPerCycle * 1.5) * (current.cyclesPerYear * 0.5);
  const bestAlt = Math.max(doubledVolumeAnnual, halvedVolumeAnnual);

  const parts: string[] = [
    `Trenutno: ${current.avgProfitPerCycle.toFixed(2)}€/cycle × ${current.cyclesPerYear.toFixed(1)} cycles/yr = ${currentAnnual.toFixed(0)}€/yr.`,
    `Maximizirano per-cycle: ${maximizedProfitPerCycle.toFixed(2)}€/cycle × ${current.cyclesPerYear.toFixed(1)} cycles/yr = ${maximizedAnnual.toFixed(0)}€/yr.`,
    `Alternativa 2× volume / 0.5× margin: ${doubledVolumeAnnual.toFixed(0)}€/yr.`,
    `Alternativa 0.5× volume / 1.5× margin: ${halvedVolumeAnnual.toFixed(0)}€/yr.`,
    `Optimalna strategija: ${strategy}.`,
  ];
  if (bestAlt > maximizedAnnual * 1.05) {
    parts.push(`Opomba: volume-first approach (${bestAlt.toFixed(0)}€/yr) je +${((bestAlt / maximizedAnnual - 1) * 100).toFixed(0)}% boljši od margin-first — razmisli o LOW_MARGIN_HIGH_VOLUME scaling.`);
  } else if (maximizedAnnual > bestAlt * 1.05) {
    parts.push(`Opomba: margin-first approach (${maximizedAnnual.toFixed(0)}€/yr) je +${((maximizedAnnual / bestAlt - 1) * 100).toFixed(0)}% boljši od volume-first — ostani pri HIGH_MARGIN_LOW_VOLUME.`);
  } else {
    parts.push('Opomba: margin-first in volume-first sta znotraj 5% — BALANCED approach je optimalen.');
  }
  return parts.join(' ').slice(0, 500);
}

function buildLevers(current: CurrentState, maximizedProfitPerCycle: number): CycleLeverEntry[] {
  const baseUplift = Math.max(0, maximizedProfitPerCycle - current.avgProfitPerCycle);
  const leverData: Array<{
    lever: CycleLeverType;
    potentialGainPct: number;
    currentGap: number;
    potentialGain: number;
    action: string;
  }> = [];

  // BETTER_SOURCING — reduce buy cost
  const sourcingGain = round2((baseUplift * LEVER_GAIN_PCT.BETTER_SOURCING) / 100);
  leverData.push({
    lever: 'BETTER_SOURCING',
    potentialGainPct: LEVER_GAIN_PCT.BETTER_SOURCING,
    currentGap: round2(clampNum(
      (current.avgBuyCost * LEVER_GAIN_PCT.BETTER_SOURCING) / 100,
      GAP_MIN, GAP_MAX, 0,
    )),
    potentialGain: sourcingGain,
    action: `Aktiviraj AI sourcing z cross-border (Kleinanzeigen, Subito, Willhaben) in deal score threshold > 85 — znižaj buy cost z ${current.avgBuyCost.toFixed(2)}€ na ${Math.max(0, current.avgBuyCost * 0.85).toFixed(2)}€ (−15%) za +${sourcingGain.toFixed(2)}€/cycle.`,
  });

  // HIGHER_SELL_PRICE — premium positioning + AI pricing
  const sellGain = round2((baseUplift * LEVER_GAIN_PCT.HIGHER_SELL_PRICE) / 100);
  leverData.push({
    lever: 'HIGHER_SELL_PRICE',
    potentialGainPct: LEVER_GAIN_PCT.HIGHER_SELL_PRICE,
    currentGap: round2(clampNum(
      (current.avgSellPrice * LEVER_GAIN_PCT.HIGHER_SELL_PRICE) / 100,
      GAP_MIN, GAP_MAX, 0,
    )),
    potentialGain: sellGain,
    action: `Vklopi AI pricing engine in dynamic pricing — dvigni sell price z ${current.avgSellPrice.toFixed(2)}€ na ${(current.avgSellPrice * 1.25).toFixed(2)}€ (+25%) z AI premium fotografijo in SEO naslovi za +${sellGain.toFixed(2)}€/cycle.`,
  });

  // LOWER_FEES — bundle deals, tax-aware selling, fee optimization
  const feesGain = round2((baseUplift * LEVER_GAIN_PCT.LOWER_FEES) / 100);
  leverData.push({
    lever: 'LOWER_FEES',
    potentialGainPct: LEVER_GAIN_PCT.LOWER_FEES,
    currentGap: round2(clampNum(
      (current.avgFeesRatio * current.avgBuyCost / 100) * 0.5,
      GAP_MIN, GAP_MAX, 0,
    )),
    potentialGain: feesGain,
    action: `Optimiziraj fee structure z bundle deals (Bolha bundle discount), tax-aware selling in platform fee minimization — znižaj fee ratio z ${current.avgFeesRatio.toFixed(2)}% na ${Math.max(0, current.avgFeesRatio * 0.7).toFixed(2)}% (−30%) za +${feesGain.toFixed(2)}€/cycle.`,
  });

  // BUNDLE_UPSELL — bundle complementary items
  const bundleGain = round2((baseUplift * LEVER_GAIN_PCT.BUNDLE_UPSELL) / 100);
  leverData.push({
    lever: 'BUNDLE_UPSELL',
    potentialGainPct: LEVER_GAIN_PCT.BUNDLE_UPSELL,
    currentGap: round2(clampNum(
      current.avgSellPrice * 0.10,
      GAP_MIN, GAP_MAX, 0,
    )),
    potentialGain: bundleGain,
    action: `Bundle complementary items (npr. telefon + polnilnik + case) za +10-15% upsell na vsakem ciklu — implementiraj AI bundle-detector in bundle-pricing za +${bundleGain.toFixed(2)}€/cycle.`,
  });

  // REFURBISHMENT — clean/repair items before sale
  const refurbGain = round2((baseUplift * LEVER_GAIN_PCT.REFURBISHMENT) / 100);
  leverData.push({
    lever: 'REFURBISHMENT',
    potentialGainPct: LEVER_GAIN_PCT.REFURBISHMENT,
    currentGap: round2(clampNum(
      current.avgSellPrice * 0.15,
      GAP_MIN, GAP_MAX, 0,
    )),
    potentialGain: refurbGain,
    action: `Vzpostavi refurbishment pipeline (cleaning, minor repair, premium foto) — dvigni perceived value za +15-20% na vsakem ciklu z minimalnim input cost (~5€/trade) za +${refurbGain.toFixed(2)}€/cycle.`,
  });

  return leverData.map((d) => ({
    lever: d.lever,
    currentGap: round2(clampNum(d.currentGap, GAP_MIN, GAP_MAX, 0)),
    potentialGain: round2(clampNum(d.potentialGain, GAIN_MIN, GAIN_MAX, 0)),
    action: clampString(d.action, 200, `Maximiziraj ${d.lever.toLowerCase().replace('_', ' ')} za višji profit per cycle.`),
  })).slice(0, MAX_LEVERS);
}

function buildDeterministicMaximization(
  current: CurrentState,
): CycleMaximization {
  // Total relative uplift potential (sum of LEVER_GAIN_PCT, with realistic 0.7 independence discount)
  const totalGainPctRaw = Object.values(LEVER_GAIN_PCT).reduce((s, v) => s + v, 0);
  const totalGainPctDiscounted = totalGainPctRaw * 0.7; // 70% of theoretical max

  // Anti-hallucination: maximized ∈ [current, min(current × 3, 5000)]
  const minBound = Math.max(PROFIT_MIN, current.avgProfitPerCycle);
  const maxBoundRelative = current.avgProfitPerCycle * (1 + ABSOLUTE_UPLIFT_CAP_PCT / 100);
  const maxBound = Math.min(PROFIT_MAX, maxBoundRelative);
  const maximizedProfitPerCycle = round2(clampNum(
    current.avgProfitPerCycle * (1 + totalGainPctDiscounted / 100),
    minBound, maxBound,
    current.avgProfitPerCycle,
  ));
  const cycleUplift = round2(clampNum(
    Math.max(0, maximizedProfitPerCycle - current.avgProfitPerCycle),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const maximizationLevers = buildLevers(current, maximizedProfitPerCycle);
  const cycleEfficiencyScore = computeCycleEfficiencyScore(current);
  const projectedAnnualProfit = round0(clampNum(
    maximizedProfitPerCycle * current.cyclesPerYear,
    ANNUAL_PROFIT_MIN, ANNUAL_PROFIT_MAX, 0,
  ));
  const cycleGrade = decideCycleGrade(maximizedProfitPerCycle);
  const optimalCycleStrategy = decideOptimalCycleStrategy(current, maximizedProfitPerCycle);
  const cycleVsVolumeTradeoff = buildCycleVsVolumeTradeoff(
    current, maximizedProfitPerCycle, optimalCycleStrategy,
  );

  return {
    maximizedProfitPerCycle,
    cycleUplift,
    maximizationLevers,
    cycleEfficiencyScore,
    projectedAnnualProfit,
    cycleVsVolumeTradeoff,
    cycleGrade,
    optimalCycleStrategy,
  };
}

function buildSummary(current: CurrentState, max: CycleMaximization): string {
  const parts: string[] = [
    `Current: ${current.avgProfitPerCycle.toFixed(2)}€/cycle (${current.avgCycleTime}d hold, ${current.cyclesPerYear.toFixed(1)} cycles/yr, ${current.totalAnnualProfit.toFixed(0)}€/yr, ${current.soldCount12m} SOLD 12m, fees ${current.avgFeesRatio.toFixed(1)}%).`,
    `Maximized: ${max.maximizedProfitPerCycle.toFixed(2)}€/cycle (+${max.cycleUplift.toFixed(2)}€ uplift, grade ${max.cycleGrade}, efficiency ${max.cycleEfficiencyScore}/100).`,
    `Projected annual: ${max.projectedAnnualProfit.toFixed(0)}€/yr. Strategy: ${max.optimalCycleStrategy}.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitPerCycleMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleProfitPerCycleMaximizer(req);
}

async function handleProfitPerCycleMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-per-cycle-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades last 12 months
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: twelveMonthsAgo },
        sellPrice: { gt: 0 },
      },
      select: {
        id: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 100000,
    }) as unknown as SoldTradeRow[];

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          avgProfitPerCycle: 0,
          avgCycleTime: 0,
          cyclesPerYear: 0,
          totalAnnualProfit: 0,
          soldCount12m: 0,
          totalProfit12m: 0,
          avgSellPrice: 0,
          avgBuyCost: 0,
          avgFeesRatio: 0,
          bestCycleProfit: 0,
          worstCycleProfit: 0,
        },
        maximization: {
          maximizedProfitPerCycle: 0,
          cycleUplift: 0,
          maximizationLevers: [],
          cycleEfficiencyScore: 0,
          projectedAnnualProfit: 0,
          cycleVsVolumeTradeoff: 'Ni SOLD trgovin — Profit Per Cycle Maximizer ni mogoč.',
          cycleGrade: 'F',
          optimalCycleStrategy: 'BALANCED',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Cycle Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Profit Per Cycle Maximizer ni mogoč.',
      } satisfies ProfitPerCycleMaximizerResponse);
    }

    // 2) Compute SOLD trades within 12m
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    if (soldComputed.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          avgProfitPerCycle: 0,
          avgCycleTime: 0,
          cyclesPerYear: 0,
          totalAnnualProfit: 0,
          soldCount12m: 0,
          totalProfit12m: 0,
          avgSellPrice: 0,
          avgBuyCost: 0,
          avgFeesRatio: 0,
          bestCycleProfit: 0,
          worstCycleProfit: 0,
        },
        maximization: {
          maximizedProfitPerCycle: 0,
          cycleUplift: 0,
          maximizationLevers: [],
          cycleEfficiencyScore: 0,
          projectedAnnualProfit: 0,
          cycleVsVolumeTradeoff: 'Ni veljavnih SOLD trgovin — Profit Per Cycle Maximizer ni mogoč.',
          cycleGrade: 'F',
          optimalCycleStrategy: 'BALANCED',
        },
        summary: 'Ni veljavnih SOLD trgovin — Profit Per Cycle Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni veljavnih SOLD trgovin — Profit Per Cycle Maximizer ni mogoč.',
      } satisfies ProfitPerCycleMaximizerResponse);
    }

    // 3) Compute current state
    const current = computeCurrent(soldComputed);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-per-cycle-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: CycleMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitPerCycleMaximizerResponse);
    }

    // 5) AI prompt with grounding
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

    const soldSampleForAI = soldComputed
      .slice(-MAX_TRADES_FOR_AI)
      .map((t) => ({
        profit: t.profit,
        sellPrice: t.sellPrice,
        buyCost: t.buyCost,
        fees: t.fees,
        holdDays: t.holdDays,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      current,
      deterministicMaximization: {
        maximizedProfitPerCycle: maximization.maximizedProfitPerCycle,
        cycleUplift: maximization.cycleUplift,
        maximizationLevers: maximization.maximizationLevers,
        cycleEfficiencyScore: maximization.cycleEfficiencyScore,
        projectedAnnualProfit: maximization.projectedAnnualProfit,
        cycleVsVolumeTradeoff: maximization.cycleVsVolumeTradeoff,
        cycleGrade: maximization.cycleGrade,
        optimalCycleStrategy: maximization.optimalCycleStrategy,
      },
      soldSample: soldSampleForAI,
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        cycleTimeMin: CYCLE_TIME_MIN, cycleTimeMax: CYCLE_TIME_MAX,
        cyclesMin: CYCLES_MIN, cyclesMax: CYCLES_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        gapMin: GAP_MIN, gapMax: GAP_MAX,
        annualProfitMin: ANNUAL_PROFIT_MIN, annualProfitMax: ANNUAL_PROFIT_MAX,
        absoluteUpliftCapPct: ABSOLUTE_UPLIFT_CAP_PCT,
      },
      leverGainPct: LEVER_GAIN_PCT,
    };

    const prompt = `Si AI "Profit Per Cycle Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER CYCLE MAXIMIZATION — kako maksimizirati PROFIT PER CYCLE (koliko € se ekstrahira iz vsakega individualnega buy-to-sell cikla). Tvoj cilj je "Tvoj profit per cycle je 45€, ampak bi lahko bil 85€ z better sourcing in higher sell prices." Razlika od inventory-capital-velocity-maximizer (v8.10 ki maksimizira VELOCITY kapitala skozi inventory — koliko cycle-ov/leto capital ciklira) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE (€/cycle extracted per individual cycle, ne število ciklov). Razlika od profit-growth-rate-maximizer (v8.11 ki maksimizira GROWTH RATE skupnega profit-a v %/mo MoM) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE v absolutnem €/cycle (per-cycle extraction, ne %/mo growth). Razlika od inventory-annual-yield-maximizer (v8.11 ki maksimizira annual yield held inventory-ja) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE (per-cycle €, ne letni yield %). Razlika od deal-source-profit-per-day-maximizer (v8.11 ki maksimizira profit per day per source €/dan) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE čez celoten portfolio (€/cycle, ne €/dan per source). Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE z maximizationLevers (BETTER_SOURCING/HIGHER_SELL_PRICE/LOWER_FEES/BUNDLE_UPSELL/REFURBISHMENT) in cycleVsVolumeTradeoff. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE (€/cycle, ne €/dan). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE z cycleEfficiencyScore in optimalCycleStrategy (HIGH_MARGIN_LOW_VOLUME vs LOW_MARGIN_HIGH_VOLUME). Razlika od profit-per-trade-growth-maximizer (v8.10 ki maksimizira growth rate profit-a PER TRADE v €/mo) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE (absolute €/cycle, ne growth rate €/mo). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE (€/cycle absolute, ne €/dan per item). Razlika od profit-per-euro-maximizer (v8.07 ki maksimizira profit per € deployed) — ti MAKSIMIZIRAŠ PROFIT PER CYCLE (€ extracted per cycle, ne € profit per € capital).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedProfitPerCycle €/cycle [0, 5000] (optimal achievable, ≥ current.avgProfitPerCycle, ≤ min(current × 3, 5000) — anti-hallucination),
2. maximization.cycleUplift €/cycle [0, 5000] (improvement = maximized − current),
3. maximization.maximizationLevers: 5 elementov { lever BETTER_SOURCING/HIGHER_SELL_PRICE/LOWER_FEES/BUNDLE_UPSELL/REFURBISHMENT, currentGap € [0, 5000] (koliko potential-a je še unrealized na tem lever-ju — heuristic iz current gap), potentialGain € [0, 5000] (koliko €/cycle bo dodan z aktivacijo tega lever-a), action (slovenski, max 200 — specifična akcija za ta lever) },
4. maximization.cycleEfficiencyScore [0, 100] (heuristic: margin per cycle / cycle time / fee ratio / cycle velocity — kombinirana ocena kako eficientno je vsak cikel),
5. maximization.projectedAnnualProfit € [0, 1000000] (= maximizedProfitPerCycle × cyclesPerYear — bo izračunano v backend-u, AI ne vrača tega),
6. maximization.cycleVsVolumeTradeoff: slovenski string (max 500 znakov — analiza ali je bolje povečati profit per cycle ali povečati število ciklov, s primerjavo margin-first vs volume-first approach),
7. maximization.cycleGrade: A+ | A | B | C | D | F (A+ če maximized ≥ 200, A ≥ 100, B ≥ 50, C ≥ 25, D ≥ 10, else F),
8. maximization.optimalCycleStrategy: HIGH_MARGIN_LOW_VOLUME | LOW_MARGIN_HIGH_VOLUME | BALANCED (katera strategija je optimalna za max annual profit),
9. summary: slovenski povzetek (max 500 znakov — poudari current profit/cycle, maximized profit/cycle, uplift, grade, projected annual, optimal strategy).

VRNI LE JSON:
{
  "maximization": {
    "maximizedProfitPerCycle": 85.0,
    "cycleUplift": 40.0,
    "maximizationLevers": [
      { "lever": "BETTER_SOURCING", "currentGap": 7.5, "potentialGain": 10.0, "action": "Aktiviraj AI sourcing z cross-border in deal score > 85." },
      { "lever": "HIGHER_SELL_PRICE", "currentGap": 15.0, "potentialGain": 14.0, "action": "Vklopi AI pricing engine in dynamic pricing za +25% sell price." },
      { "lever": "LOWER_FEES", "currentGap": 3.0, "potentialGain": 4.0, "action": "Optimiziraj fee structure z bundle deals in tax-aware selling." },
      { "lever": "BUNDLE_UPSELL", "currentGap": 5.0, "potentialGain": 6.0, "action": "Bundle complementary items za +10-15% upsell per cycle." },
      { "lever": "REFURBISHMENT", "currentGap": 8.0, "potentialGain": 6.0, "action": "Vzpostavi refurbishment pipeline za +15-20% perceived value." }
    ],
    "cycleEfficiencyScore": 72,
    "cycleVsVolumeTradeoff": "Trenutno: 45€/cycle × 13 cycles/yr = 585€/yr. Maximizirano: 85€/cycle × 13 cycles/yr = 1105€/yr. Alternativa 2× volume / 0.5× margin: 1105€/yr. Strategija: BALANCED.",
    "cycleGrade": "B",
    "optimalCycleStrategy": "BALANCED"
  },
  "summary": "Current: 45.00€/cycle (28d hold, 13.0 cycles/yr, 585€/yr, 50 SOLD 12m, fees 5.0%). Maximized: 85.00€/cycle (+40.00€ uplift, grade B, efficiency 72/100). Projected annual: 1105€/yr. Strategy: BALANCED."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Anti-hallucination: maximized ∈ [current, min(current × 3, 5000)]
        const minBound = Math.max(PROFIT_MIN, current.avgProfitPerCycle);
        const maxBoundRelative = current.avgProfitPerCycle * (1 + ABSOLUTE_UPLIFT_CAP_PCT / 100);
        const maxBound = Math.min(PROFIT_MAX, maxBoundRelative);
        const maximizedProfitPerCycle = round2(clampNum(
          aiMax.maximizedProfitPerCycle,
          minBound, maxBound,
          maximization.maximizedProfitPerCycle,
        ));
        const cycleUplift = round2(clampNum(
          Math.max(0, maximizedProfitPerCycle - current.avgProfitPerCycle),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override maximizationLevers — must have 5 entries
        let maximizationLevers = maximization.maximizationLevers;
        if (Array.isArray(aiMax.maximizationLevers) && aiMax.maximizationLevers.length >= 4) {
          const aiLevers: CycleLeverEntry[] = [];
          for (const l of aiMax.maximizationLevers.slice(0, MAX_LEVERS)) {
            if (!l || typeof l !== 'object') continue;
            const lever = clampEnum(l.lever, VALID_LEVER, 'BETTER_SOURCING');
            aiLevers.push({
              lever,
              currentGap: round2(clampNum(
                l.currentGap, GAP_MIN, GAP_MAX, 0,
              )),
              potentialGain: round2(clampNum(
                l.potentialGain, GAIN_MIN, GAIN_MAX, 0,
              )),
              action: clampString(l.action, 200, `Maximiziraj ${lever.toLowerCase().replace('_', ' ')} za višji profit per cycle.`),
            });
          }
          if (aiLevers.length >= 4) {
            maximizationLevers = aiLevers.slice(0, MAX_LEVERS);
          }
        }

        // Override cycleEfficiencyScore
        const cycleEfficiencyScore = round0(clampNum(
          aiMax.cycleEfficiencyScore,
          SCORE_MIN, SCORE_MAX,
          maximization.cycleEfficiencyScore,
        ));

        // Override cycleGrade
        const cycleGrade = aiMax.cycleGrade
          ? clampEnum(aiMax.cycleGrade, VALID_GRADE, decideCycleGrade(maximizedProfitPerCycle))
          : decideCycleGrade(maximizedProfitPerCycle);

        // Override optimalCycleStrategy
        const optimalCycleStrategy = aiMax.optimalCycleStrategy
          ? clampEnum(aiMax.optimalCycleStrategy, VALID_STRATEGY, decideOptimalCycleStrategy(current, maximizedProfitPerCycle))
          : decideOptimalCycleStrategy(current, maximizedProfitPerCycle);

        // Override cycleVsVolumeTradeoff
        const cycleVsVolumeTradeoff = clampString(
          aiMax.cycleVsVolumeTradeoff,
          500,
          buildCycleVsVolumeTradeoff(current, maximizedProfitPerCycle, optimalCycleStrategy),
        );

        // Recompute projectedAnnualProfit
        const projectedAnnualProfit = round0(clampNum(
          maximizedProfitPerCycle * current.cyclesPerYear,
          ANNUAL_PROFIT_MIN, ANNUAL_PROFIT_MAX, 0,
        ));

        maximization = {
          maximizedProfitPerCycle,
          cycleUplift,
          maximizationLevers,
          cycleEfficiencyScore,
          projectedAnnualProfit,
          cycleVsVolumeTradeoff,
          cycleGrade,
          optimalCycleStrategy,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-per-cycle-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 6) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return NextResponse.json({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies ProfitPerCycleMaximizerResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-per-cycle-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
