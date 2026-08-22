// v8.02 / v8.96.7-batch3: AI Inventory Profit Per Day Maximizer — AI MAXIMIZIRA PROFIT PER DAY
// — ultimate efficiency metric. Kombinira profit per trade s turnover speed
// za najti optimalno strategijo ki maksimizira daily profit generation.
// "Your current profit per day is 45€. The optimal is 85€/day by adjusting
// inventory mix and turnover speed."
//
// Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity)
// — ta MAXIMIZIRA PROFIT PER DAY preko 4 optimization levers (profitPerTrade,
// turnoverSpeed, tradeFrequency, capitalEfficiency) z optimalInventoryMix in
// optimalHoldTime. Razlika od inventory-turnover-profit-maximizer (v8.00 ki
// maksimizira turnover-profit balance) — ta maksimizira DAILY profit z
// bottleneck analizo in 7/14/30 day projection. Razlika od inventory-capital-
// efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item) — ta
// maksimizira DAILY profit (kombinacija profit × frequency × holdTime) z
// optimalInventoryMix. Razlika od profit-scale-engine (v8.02 ki scale-a cel
// business z phased plan) — ta maksimizira DAILY profit z immediate optimization
// levers (ne phased scaling). Razlika from deal-profit-accelerator-pro (v7.99
// ki accelera profit per item) — ta daje GLOBAL daily profit maximization z
// optimal hold time in inventory mix.

// GET+POST /api/ai/inventory-profit-per-day-maximizer
// (AI-enhanced + grounding + anti-hallucination + 6h cache + deterministic fallback)
// Refaktoriran z withAiRoute helperjem (v8.96.7) + enforceBudget guard.

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { GROUNDING_PROMPT_SUFFIX } from '@/lib/anti-hallucination';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Types ---------------------------------------------------------------

type ProfitPerDayGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface SoldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
}

interface ProfitPerDayBreakdown {
  profitPerTradeImpact: number;
  holdTimeImpact: number;
  frequencyImpact: number;
  capitalEfficiencyImpact: number;
}

interface CurrentState {
  currentDailyProfit: number;
  avgProfitPerTrade: number;
  avgHoldDaysPerTrade: number;
  profitPerHoldDay: number;
  tradeFrequencyPerWeek: number;
  profitPerDayBreakdown: ProfitPerDayBreakdown;
}

interface LeverDetail {
  currentGap: number;
  potentialGain: number;
  action: string;
}

interface OptimizationLevers {
  profitPerTradeLever: LeverDetail;
  turnoverSpeedLever: LeverDetail;
  tradeFrequencyLever: LeverDetail;
  capitalEfficiencyLever: LeverDetail;
}

interface OptimalInventoryMixItem {
  category: string;
  priceRange: string;
  profitPerDay: number;
}

interface ProfitPerDayProjectionPoint {
  day: number;
  currentProfit: number;
  maximizedProfit: number;
}

interface Maximization {
  maximizedDailyProfit: number;
  profitPerDayUplift: number;
  optimizationLevers: OptimizationLevers;
  optimalInventoryMix: OptimalInventoryMixItem[];
  optimalHoldTime: number;
  profitPerDayProjection: ProfitPerDayProjectionPoint[];
  profitPerDayGrade: ProfitPerDayGrade;
  bottleneckAnalysis: string;
}

interface ProfitPerDayResponse {
  ok: true;
  current: CurrentState;
  maximization: Maximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  optimizationLevers?: {
    profitPerTradeLever?: { currentGap?: number; potentialGain?: number; action?: string };
    turnoverSpeedLever?: { currentGap?: number; potentialGain?: number; action?: string };
    tradeFrequencyLever?: { currentGap?: number; potentialGain?: number; action?: string };
    capitalEfficiencyLever?: { currentGap?: number; potentialGain?: number; action?: string };
  };
  optimalInventoryMix?: Array<{
    category?: string;
    priceRange?: string;
    profitPerDay?: number;
  }>;
  optimalHoldTime?: number;
  bottleneckAnalysis?: string;
  profitPerDayGrade?: ProfitPerDayGrade;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const DAILY_PROFIT_MIN = 0;
const DAILY_PROFIT_MAX = 10_000; // 10k/day ceiling
const PROFIT_PER_TRADE_MIN = 0;
const PROFIT_PER_TRADE_MAX = 100_000;
const HOLD_DAYS_MIN = 0;
const HOLD_DAYS_MAX = 730;
const PROFIT_PER_HOLD_DAY_MIN = -100;
const PROFIT_PER_HOLD_DAY_MAX = 1000;
const FREQUENCY_MIN = 0;
const FREQUENCY_MAX = 100; // trades/week ceiling
const GAP_MIN = 0;
const GAP_MAX = 10_000;
const GAIN_MIN = 0;
const GAIN_MAX = 10_000;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

const VALID_GRADE: readonly ProfitPerDayGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const MAX_OPTIMAL_MIX = 6;
const MAX_PROJECTION_POINTS = 4; // 7/14/30/90 days
const MAX_HELD_FOR_ANALYSIS = 500;

const FEE_PCT = 0.05;

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
  profit: number;
  holdDays: number;
  within12m: boolean;
  sellDateMs: number;
  category: string;
  buyPrice: number;
  buyFees: number;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const sellPrice = t.sellPrice ?? 0;
  const sellFees = t.sellFees ?? 0;
  if (sellPrice <= 0) return null;
  const sellMs = toMs(t.sellDate);
  if (sellMs <= 0) return null;
  const buyMs = toMs(t.buyDate);
  const holdDays = buyMs > 0 ? Math.max(0, Math.round((sellMs - buyMs) / DAY_MS)) : 0;
  const cost = buyPrice + buyFees;
  const net = sellPrice - sellFees;
  const profit = net - cost;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return {
    profit, holdDays, within12m,
    sellDateMs: sellMs,
    category: (t.category ?? 'unknown').trim().toLowerCase(),
    buyPrice, buyFees,
  };
}

interface SoldAgg {
  totalProfit: number;
  count: number;
  totalHoldDays: number;
  totalProfitPerHoldDay: number;
  perCategory: Map<string, { profit: number; holdDays: number; count: number; avgBuy: number }>;
}

function aggregateSold(trades: SoldComputed[]): SoldAgg {
  let totalProfit = 0;
  let count = 0;
  let totalHoldDays = 0;
  let totalProfitPerHoldDay = 0;
  const perCategory = new Map<string, { profit: number; holdDays: number; count: number; avgBuy: number }>();
  for (const t of trades) {
    if (!t.within12m) continue;
    totalProfit += t.profit;
    count += 1;
    totalHoldDays += t.holdDays;
    if (t.holdDays > 0) {
      totalProfitPerHoldDay += t.profit / t.holdDays;
    }
    let c = perCategory.get(t.category);
    if (!c) {
      c = { profit: 0, holdDays: 0, count: 0, avgBuy: 0 };
      perCategory.set(t.category, c);
    }
    c.profit += t.profit;
    c.holdDays += t.holdDays;
    c.count += 1;
    c.avgBuy += t.buyPrice + t.buyFees;
  }
  return { totalProfit, count, totalHoldDays, totalProfitPerHoldDay, perCategory };
}

interface HeldComputed {
  capitalDeployed: number;
  daysHeld: number;
  category: string;
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  if (buyPrice <= 0) return null;
  const capitalDeployed = buyPrice + buyFees;
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;
  return {
    capitalDeployed, daysHeld,
    category: (t.category ?? 'unknown').trim().toLowerCase(),
  };
}

function computeCurrent(agg: SoldAgg, heldComputed: HeldComputed[]): CurrentState {
  const count12m = agg.count;
  const currentDailyProfit = round2(clampNum(
    count12m > 0 ? agg.totalProfit / 365 : 0,
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, 0,
  ));
  const avgProfitPerTrade = round0(clampNum(
    count12m > 0 ? agg.totalProfit / count12m : 0,
    PROFIT_PER_TRADE_MIN, PROFIT_PER_TRADE_MAX, 0,
  ));
  const avgHoldDaysPerTrade = round0(clampNum(
    count12m > 0 ? agg.totalHoldDays / count12m : 0,
    HOLD_DAYS_MIN, HOLD_DAYS_MAX, 0,
  ));
  const profitPerHoldDay = round2(clampNum(
    count12m > 0 ? agg.totalProfitPerHoldDay / count12m : 0,
    PROFIT_PER_HOLD_DAY_MIN, PROFIT_PER_HOLD_DAY_MAX, 0,
  ));
  const tradeFrequencyPerWeek = round2(clampNum(
    count12m > 0 ? (count12m / 365) * 7 : 0,
    FREQUENCY_MIN, FREQUENCY_MAX, 0,
  ));

  // Breakdown — relative impact of each lever (0-100 normalized)
  // profitPerTradeImpact: how much profit/trade contributes to daily profit
  const profitPerTradeImpact = round0(clampNum(
    avgProfitPerTrade > 0 ? Math.min(100, (avgProfitPerTrade / 200) * 100) : 0,
    SCORE_MIN, SCORE_MAX, 0,
  ));
  // holdTimeImpact: inverse — shorter hold = higher impact (positive)
  const holdTimeImpact = round0(clampNum(
    avgHoldDaysPerTrade > 0 ? Math.max(0, 100 - (avgHoldDaysPerTrade / 60) * 100) : 50,
    SCORE_MIN, SCORE_MAX, 0,
  ));
  // frequencyImpact: more trades/week = higher impact
  const frequencyImpact = round0(clampNum(
    Math.min(100, tradeFrequencyPerWeek * 20), SCORE_MIN, SCORE_MAX, 0,
  ));
  // capitalEfficiencyImpact: based on profit per euro deployed
  // Compute avg capital deployed in held inventory
  const totalHeldCapital = heldComputed.reduce((s, h) => s + h.capitalDeployed, 0);
  const avgHeldCapital = heldComputed.length > 0 ? totalHeldCapital / heldComputed.length : 0;
  const capitalEfficiencyImpact = round0(clampNum(
    avgHeldCapital > 0 ? Math.min(100, (avgProfitPerTrade / avgHeldCapital) * 100 * 2) : 30,
    SCORE_MIN, SCORE_MAX, 0,
  ));

  return {
    currentDailyProfit,
    avgProfitPerTrade,
    avgHoldDaysPerTrade,
    profitPerHoldDay,
    tradeFrequencyPerWeek,
    profitPerDayBreakdown: {
      profitPerTradeImpact,
      holdTimeImpact,
      frequencyImpact,
      capitalEfficiencyImpact,
    },
  };
}

function decideGrade(dailyProfit: number, uplift: number): ProfitPerDayGrade {
  // maximizedDailyProfit / optimal ratio
  // A+ if uplift / current ≥ 2.0 (i.e., 3x improvement) OR daily ≥ 200€
  // A if uplift / current ≥ 1.5 OR daily ≥ 100€
  // B if uplift / current ≥ 0.8 OR daily ≥ 50€
  // C if uplift / current ≥ 0.4 OR daily ≥ 20€
  // D if uplift / current ≥ 0.15 OR daily ≥ 5€
  // else F
  const ratio = dailyProfit > 0 ? uplift / dailyProfit : 0;
  if (dailyProfit >= 200 || ratio >= 2.0) return 'A+';
  if (dailyProfit >= 100 || ratio >= 1.5) return 'A';
  if (dailyProfit >= 50 || ratio >= 0.8) return 'B';
  if (dailyProfit >= 20 || ratio >= 0.4) return 'C';
  if (dailyProfit >= 5 || ratio >= 0.15) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentState,
  agg: SoldAgg,
  heldComputed: HeldComputed[],
): Maximization {
  // 4 levers with potential gains (daily profit contributions):
  // 1. profitPerTradeLever — increase avgProfitPerTrade by 30% (premium pricing + better sourcing)
  const pptGain = round2(clampNum(
    current.avgProfitPerTrade * 0.30, GAIN_MIN, GAIN_MAX, 0,
  ));
  const pptGap = round2(clampNum(
    current.avgProfitPerTrade, GAP_MIN, GAP_MAX, 0,
  ));

  // 2. turnoverSpeedLever — reduce hold time by 40% (faster turnover)
  // Current hold impact on daily profit: longer hold = lower frequency
  const optimalHoldTime = round0(clampNum(
    Math.max(7, current.avgHoldDaysPerTrade * 0.6),
    HOLD_DAYS_MIN, HOLD_DAYS_MAX, 7,
  ));
  const turnoverGainPct = current.avgHoldDaysPerTrade > 0
    ? Math.min(0.6, (current.avgHoldDaysPerTrade - optimalHoldTime) / current.avgHoldDaysPerTrade)
    : 0;
  const turnoverGain = round2(clampNum(
    current.currentDailyProfit * turnoverGainPct, GAIN_MIN, GAIN_MAX, 0,
  ));
  const turnoverGap = round2(clampNum(
    current.avgHoldDaysPerTrade - optimalHoldTime, GAP_MIN, GAP_MAX, 0,
  ));

  // 3. tradeFrequencyLever — 2x more trades (more inventory + sourcing)
  const freqGain = round2(clampNum(
    current.currentDailyProfit * 0.5, GAIN_MIN, GAIN_MAX, 0,
  ));
  const freqGap = round2(clampNum(
    current.tradeFrequencyPerWeek, GAP_MIN, GAP_MAX, 0,
  ));

  // 4. capitalEfficiencyLever — 25% better capital efficiency (less idle capital)
  const totalHeldCapital = heldComputed.reduce((s, h) => s + h.capitalDeployed, 0);
  const capitalEffGain = round2(clampNum(
    current.currentDailyProfit * 0.15, GAIN_MIN, GAIN_MAX, 0,
  ));
  const capitalEffGap = round0(clampNum(
    totalHeldCapital, GAP_MIN, GAP_MAX, 0,
  ));

  const totalGain = pptGain + turnoverGain + freqGain + capitalEffGain;
  const maximizedDailyProfit = round2(clampNum(
    current.currentDailyProfit + totalGain,
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, current.currentDailyProfit,
  ));
  const profitPerDayUplift = round2(clampNum(
    totalGain, GAIN_MIN, GAIN_MAX, 0,
  ));

  const optimizationLevers: OptimizationLevers = {
    profitPerTradeLever: {
      currentGap: pptGap,
      potentialGain: pptGain,
      action: clampString(
        `Premium pricing z boljšo fotografijo in certifikati authenticity (+15%), ` +
        `boljši sourcing z dealScore ≥70 threshold (+10% margin), ` +
        `bundle z accessori za +12% margin uplift.`,
        200,
        'Premium pricing + boljši sourcing + bundle.',
      ),
    },
    turnoverSpeedLever: {
      currentGap: turnoverGap,
      potentialGain: turnoverGain,
      action: clampString(
        `Auto-discount -10% po 14 dneh, cross-post na 3 platforme, ` +
        `boljša listing kvaliteta ( profesionalna fotografija) za 2x hitrejšo prodajo, ` +
        `optimal hold time: ${optimalHoldTime} dni (trenutno ${current.avgHoldDaysPerTrade}).`,
        200,
        `Auto-discount + cross-post + optimal hold ${optimalHoldTime} dni.`,
      ),
    },
    tradeFrequencyLever: {
      currentGap: freqGap,
      potentialGain: freqGain,
      action: clampString(
        `2x več inventory (dodaj +${Math.round(heldComputed.length)} items), ` +
        `avtomatiziraj monitor alert-e za 24/7 sourcing, ` +
        `batch sourcing ob vikendih za +50% deal coverage, ` +
        `setup auto-listing draft za hitrejši pipeline throughput.`,
        200,
        '2x inventory + avtomatiziran sourcing + batch operations.',
      ),
    },
    capitalEfficiencyLever: {
      currentGap: capitalEffGap,
      potentialGain: capitalEffGain,
      action: clampString(
        `Reallociraj kapital iz low-efficiency items (hold >60 dni) v high-velocity kategorije, ` +
        `avtomatski discount za trapped inventory, ` +
        `drop-ship model za high-value items (manj capital tied up).`,
        200,
        'Reallociraj capital + auto-discount trapped inventory.',
      ),
    },
  };

  // Optimal inventory mix — from perCategory aggregated
  const optimalInventoryMix: OptimalInventoryMixItem[] = [];
  const categoryStats = Array.from(agg.perCategory.entries())
    .map(([cat, s]) => ({
      category: cat,
      avgProfit: s.count > 0 ? s.profit / s.count : 0,
      avgHold: s.count > 0 ? s.holdDays / s.count : 0,
      avgBuy: s.count > 0 ? s.avgBuy / s.count : 0,
      count: s.count,
      profitPerDay: s.count > 0 && s.holdDays > 0
        ? (s.profit / s.count) / (s.holdDays / s.count)
        : 0,
    }))
    .sort((a, b) => b.profitPerDay - a.profitPerDay);

  // If we have historical category data, use it; otherwise add defaults
  if (categoryStats.length > 0) {
    for (const c of categoryStats.slice(0, MAX_OPTIMAL_MIX)) {
      const priceRange = c.avgBuy < 100 ? '0-100€'
        : c.avgBuy < 500 ? '100-500€'
        : c.avgBuy < 1500 ? '500-1500€'
        : '1500€+';
      const profitPerDay = c.profitPerDay > 0
        ? round2(clampNum(c.profitPerDay, 0, DAILY_PROFIT_MAX, 0))
        : round2(clampNum(c.avgProfit / Math.max(7, c.avgHold), 0, DAILY_PROFIT_MAX, 0));
      optimalInventoryMix.push({
        category: c.category.charAt(0).toUpperCase() + c.category.slice(1),
        priceRange,
        profitPerDay,
      });
    }
  }
  // Pad with defaults if not enough data
  const defaults: OptimalInventoryMixItem[] = [
    { category: 'Elektronika', priceRange: '100-500€', profitPerDay: 15 },
    { category: 'Telefoni', priceRange: '200-800€', profitPerDay: 12 },
    { category: 'Gaming', priceRange: '100-400€', profitPerDay: 10 },
    { category: 'Avtomobilski deli', priceRange: '50-300€', profitPerDay: 8 },
    { category: 'Fashion', priceRange: '20-200€', profitPerDay: 5 },
  ];
  for (const d of defaults) {
    if (optimalInventoryMix.length >= MAX_OPTIMAL_MIX) break;
      const exists = optimalInventoryMix.some((m) =>
        m.category.toLowerCase() === d.category.toLowerCase(),
      );
      if (!exists) optimalInventoryMix.push(d);
  }

  // Projection (7/14/30/90 days) — current vs maximized
  const projection: ProfitPerDayProjectionPoint[] = [];
  const projDays = [7, 14, 30, 90];
  for (const d of projDays) {
    projection.push({
      day: d,
      currentProfit: round0(clampNum(
        current.currentDailyProfit * d,
        DAILY_PROFIT_MIN, DAILY_PROFIT_MAX * 100, 0,
      )),
      maximizedProfit: round0(clampNum(
        maximizedDailyProfit * d,
        DAILY_PROFIT_MIN, DAILY_PROFIT_MAX * 100, 0,
      )),
    });
  }

  // Bottleneck analysis — identify the biggest gap lever
  const leverGaps = [
    { name: 'profitPerTrade', gap: pptGap, gain: pptGain },
    { name: 'turnoverSpeed', gap: turnoverGap, gain: turnoverGain },
    { name: 'tradeFrequency', gap: freqGap, gain: freqGain },
    { name: 'capitalEfficiency', gap: capitalEffGap, gain: capitalEffGain },
  ];
  leverGaps.sort((a, b) => b.gain - a.gain);
  const topLever = leverGaps[0];
  let bottleneck = '';
  if (topLever.name === 'profitPerTrade') {
    bottleneck = clampString(
      `BOTTLENECK: Profit per trade prenizak (${current.avgProfitPerTrade}€). ` +
      `Z največjim gain potential ${topLever.gain}€/dan. ` +
      `Rešitev: premium pricing + bundle + better sourcing.`,
      400,
      `Bottleneck: profitPerTrade (${current.avgProfitPerTrade}€).`,
    );
  } else if (topLever.name === 'turnoverSpeed') {
    bottleneck = clampString(
      `BOTTLENECK: Hold time previsok (${current.avgHoldDaysPerTrade} dni, optimal ${optimalHoldTime}). ` +
      `Z največjim gain potential ${topLever.gain}€/dan. ` +
      `Rešitev: auto-discount + cross-post + boljša listing kvaliteta.`,
      400,
      `Bottleneck: holdTime (${current.avgHoldDaysPerTrade} dni).`,
    );
  } else if (topLever.name === 'tradeFrequency') {
    bottleneck = clampString(
      `BOTTLENECK: Trade frequency prenizka (${current.tradeFrequencyPerWeek}/teden). ` +
      `Z največjim gain potential ${topLever.gain}€/dan. ` +
      `Rešitev: 2x inventory + avtomatiziran sourcing + batch operations.`,
      400,
      `Bottleneck: tradeFrequency (${current.tradeFrequencyPerWeek}/teden).`,
    );
  } else {
    bottleneck = clampString(
      `BOTTLENECK: Capital efficiency — ${round0(capitalEffGap)}€ trapped v inventarju. ` +
      `Z največjim gain potential ${topLever.gain}€/dan. ` +
      `Rešitev: realokacija kapitala + drop-ship model za high-value items.`,
      400,
      `Bottleneck: capitalEfficiency (${round0(capitalEffGap)}€ trapped).`,
    );
  }

  const profitPerDayGrade = decideGrade(
    current.currentDailyProfit, profitPerDayUplift,
  );

  return {
    maximizedDailyProfit,
    profitPerDayUplift,
    optimizationLevers,
    optimalInventoryMix: optimalInventoryMix.slice(0, MAX_OPTIMAL_MIX),
    optimalHoldTime,
    profitPerDayProjection: projection.slice(0, MAX_PROJECTION_POINTS),
    profitPerDayGrade,
    bottleneckAnalysis: bottleneck,
  };
}

function buildSummary(current: CurrentState, max: Maximization): string {
  return clampString(
    `Current: ${current.currentDailyProfit}€/dan profit, ${current.avgProfitPerTrade}€/trade, ` +
    `${current.avgHoldDaysPerTrade}dni hold, ${current.tradeFrequencyPerWeek}/teden freq. ` +
    `Maximized: ${max.maximizedDailyProfit}€/dan (+${max.profitPerDayUplift} uplift). ` +
    `Optimal hold: ${max.optimalHoldTime}dni. Grade: ${max.profitPerDayGrade}. ` +
    `30d proj: ${Math.round(current.currentDailyProfit * 30)}€ → ${Math.round(max.maximizedDailyProfit * 30)}€.`,
    400,
    `Current ${current.currentDailyProfit}€/dan → ${max.maximizedDailyProfit}€/dan (+${max.profitPerDayUplift}). Grade ${max.profitPerDayGrade}.`,
  );
}

// --- Input ---------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InventoryProfitPerDayMaximizerInput {}

// --- Handler -------------------------------------------------------------

const inventoryProfitPerDayMaximizerHandler = withAiRoute<InventoryProfitPerDayMaximizerInput>({
  endpoint: '/api/ai/inventory-profit-per-day-maximizer',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget
  method: 'GET', // GET+POST — body ignored

  parseBody: async (req) => {
    await req.json().catch(() => ({}));
    return {};
  },

  // No validateInput — body ignored
  handler: async (_input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi, logger } = ctx;

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query SOLD trades 12m + HELD trades for current inventory state
    const [soldTrades, heldTrades] = await Promise.all([
      db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: { gte: twelveMonthsAgo },
          sellPrice: { gt: 0 },
        },
        select: {
          id: true,
          title: true,
          category: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
          sellPrice: true,
          sellFees: true,
          sellDate: true,
        },
        orderBy: { sellDate: 'asc' },
        take: 100000,
      }) as unknown as SoldTradeRow[],
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          title: true,
          category: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
        },
        take: MAX_HELD_FOR_ANALYSIS,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD trades
    if (soldTrades.length === 0) {
      return apiOk({
        ok: true,
        current: {
          currentDailyProfit: 0,
          avgProfitPerTrade: 0,
          avgHoldDaysPerTrade: 0,
          profitPerHoldDay: 0,
          tradeFrequencyPerWeek: 0,
          profitPerDayBreakdown: {
            profitPerTradeImpact: 0,
            holdTimeImpact: 0,
            frequencyImpact: 0,
            capitalEfficiencyImpact: 0,
          },
        },
        maximization: {
          maximizedDailyProfit: 0,
          profitPerDayUplift: 0,
          optimizationLevers: {
            profitPerTradeLever: { currentGap: 0, potentialGain: 0, action: '' },
            turnoverSpeedLever: { currentGap: 0, potentialGain: 0, action: '' },
            tradeFrequencyLever: { currentGap: 0, potentialGain: 0, action: '' },
            capitalEfficiencyLever: { currentGap: 0, potentialGain: 0, action: '' },
          },
          optimalInventoryMix: [],
          optimalHoldTime: 0,
          profitPerDayProjection: [],
          profitPerDayGrade: 'F',
          bottleneckAnalysis: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Profit Per Day Maximizer ni mogoč.',
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Profit Per Day Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Profit Per Day Maximizer ni mogoč.',
      } satisfies ProfitPerDayResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }
    const agg = aggregateSold(soldComputed);
    const current = computeCurrent(agg, heldComputed);

    let maximization = buildDeterministicMaximization(current, agg, heldComputed);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-profit-per-day-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: Maximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return apiOk({
        ok: true,
        current,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitPerDayResponse);
    }

    const promptData = {
      soldCount12m: agg.count,
      totalProfit12m: round0(agg.totalProfit),
      heldInventorySize: heldComputed.length,
      heldTotalCapital: round0(heldComputed.reduce((s, h) => s + h.capitalDeployed, 0)),
      avgDaysHeldHeldInventory: heldComputed.length > 0
        ? round0(heldComputed.reduce((s, h) => s + h.daysHeld, 0) / heldComputed.length)
        : 0,
      current,
      deterministicMaximization: {
        maximizedDailyProfit: maximization.maximizedDailyProfit,
        profitPerDayUplift: maximization.profitPerDayUplift,
        optimalHoldTime: maximization.optimalHoldTime,
        profitPerDayGrade: maximization.profitPerDayGrade,
        optimizationLevers: {
          profitPerTradeLever: {
            currentGap: maximization.optimizationLevers.profitPerTradeLever.currentGap,
            potentialGain: maximization.optimizationLevers.profitPerTradeLever.potentialGain,
          },
          turnoverSpeedLever: {
            currentGap: maximization.optimizationLevers.turnoverSpeedLever.currentGap,
            potentialGain: maximization.optimizationLevers.turnoverSpeedLever.potentialGain,
          },
          tradeFrequencyLever: {
            currentGap: maximization.optimizationLevers.tradeFrequencyLever.currentGap,
            potentialGain: maximization.optimizationLevers.tradeFrequencyLever.potentialGain,
          },
          capitalEfficiencyLever: {
            currentGap: maximization.optimizationLevers.capitalEfficiencyLever.currentGap,
            potentialGain: maximization.optimizationLevers.capitalEfficiencyLever.potentialGain,
          },
        },
      },
      caps: {
        dailyProfitMin: DAILY_PROFIT_MIN, dailyProfitMax: DAILY_PROFIT_MAX,
        profitPerTradeMin: PROFIT_PER_TRADE_MIN, profitPerTradeMax: PROFIT_PER_TRADE_MAX,
        holdDaysMin: HOLD_DAYS_MIN, holdDaysMax: HOLD_DAYS_MAX,
        profitPerHoldDayMin: PROFIT_PER_HOLD_DAY_MIN, profitPerHoldDayMax: PROFIT_PER_HOLD_DAY_MAX,
        frequencyMin: FREQUENCY_MIN, frequencyMax: FREQUENCY_MAX,
        gapMin: GAP_MIN, gapMax: GAP_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
      },
    };

    const prompt = `Si AI "Inventory Profit Per Day Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za MAXIMIZIRANJE PROFIT PER DAY — ultimate efficiency metric. Kombiniraš profit per trade s turnover speed za najti optimalno strategijo ki maksimizira daily profit generation. Tvoj cilj je povečati dnevni profit iz npr. 45€/dan na 85€/dan z 4 optimization levers (profitPerTrade, turnoverSpeed, tradeFrequency, capitalEfficiency) in optimalInventoryMix. Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti MAXIMIZIRAŠ profit/day preko 4 levers z optimalInventoryMix in optimalHoldTime. Razlika od inventory-turnover-profit-maximizer (v8.00 ki maksimizira turnover-profit balance) — ti maksimiziraš DAILY profit z bottleneck analizo in 7/14/30/90 day projection. Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item) — ti maksimiziraš DAILY profit (kombinacija profit × frequency × holdTime) z optimalInventoryMix. Razlika od profit-scale-engine (v8.02 ki scale-a cel business) — ti maksimiziraš DAILY profit z immediate optimization levers.

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventarja):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. optimizationLevers: 4 levers { currentGap € [0, 10000], potentialGain € [0, 10000], action (max 200, slovenski) },
   - profitPerTradeLever: kako povečati profit per trade (premium pricing, better sourcing),
   - turnoverSpeedLever: kako prodati hitreje (auto-discount, cross-post, listing quality),
   - tradeFrequencyLever: kako narediti več trade-ov (more inventory, better sourcing),
   - capitalEfficiencyLever: kako boljše izkoristiti kapital (less idle capital, drop-ship),
2. optimalInventoryMix: 3-6 { category (max 50, slovenski), priceRange (max 50, slovenski), profitPerDay € [0, 10000] },
3. optimalHoldTime: ideal hold time v dneh [0, 730],
4. bottleneckAnalysis: slovenski opis kaj najbolj omejuje daily profit (max 400),
5. profitPerDayGrade: A+ | A | B | C | D | F (A+ če uplift/current ≥ 2.0 ali daily ≥ 200€, A ≥ 1.5/100€, B ≥ 0.8/50€, C ≥ 0.4/20€, D ≥ 0.15/5€, else F),
6. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "optimizationLevers": {
    "profitPerTradeLever": { "currentGap": 50, "potentialGain": 15, "action": "Premium pricing." },
    "turnoverSpeedLever": { "currentGap": 30, "potentialGain": 10, "action": "Auto-discount + cross-post." },
    "tradeFrequencyLever": { "currentGap": 3, "potentialGain": 15, "action": "2x inventory." },
    "capitalEfficiencyLever": { "currentGap": 5000, "potentialGain": 5, "action": "Drop-ship model." }
  },
  "optimalInventoryMix": [
    { "category": "Elektronika", "priceRange": "100-500€", "profitPerDay": 15 }
  ],
  "optimalHoldTime": 14,
  "bottleneckAnalysis": "BOTTLENECK: profit per trade prenizak.",
  "profitPerDayGrade": "B",
  "summary": "Current 45€/dan → 85€/dan (+40 uplift). Optimal hold 14 dni. Grade B."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callAi(prompt);
      const parsed = parseAi(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Override optimization levers if AI provided all 4
        if (parsed.optimizationLevers && typeof parsed.optimizationLevers === 'object') {
          const ol = parsed.optimizationLevers;
          const newLevers: OptimizationLevers = {
            profitPerTradeLever: {
              currentGap: round2(clampNum(
                ol.profitPerTradeLever?.currentGap, GAP_MIN, GAP_MAX,
                maximization.optimizationLevers.profitPerTradeLever.currentGap,
              )),
              potentialGain: round2(clampNum(
                ol.profitPerTradeLever?.potentialGain, GAIN_MIN, GAIN_MAX,
                maximization.optimizationLevers.profitPerTradeLever.potentialGain,
              )),
              action: clampString(
                ol.profitPerTradeLever?.action, 200,
                maximization.optimizationLevers.profitPerTradeLever.action,
              ),
            },
            turnoverSpeedLever: {
              currentGap: round2(clampNum(
                ol.turnoverSpeedLever?.currentGap, GAP_MIN, GAP_MAX,
                maximization.optimizationLevers.turnoverSpeedLever.currentGap,
              )),
              potentialGain: round2(clampNum(
                ol.turnoverSpeedLever?.potentialGain, GAIN_MIN, GAIN_MAX,
                maximization.optimizationLevers.turnoverSpeedLever.potentialGain,
              )),
              action: clampString(
                ol.turnoverSpeedLever?.action, 200,
                maximization.optimizationLevers.turnoverSpeedLever.action,
              ),
            },
            tradeFrequencyLever: {
              currentGap: round2(clampNum(
                ol.tradeFrequencyLever?.currentGap, GAP_MIN, GAP_MAX,
                maximization.optimizationLevers.tradeFrequencyLever.currentGap,
              )),
              potentialGain: round2(clampNum(
                ol.tradeFrequencyLever?.potentialGain, GAIN_MIN, GAIN_MAX,
                maximization.optimizationLevers.tradeFrequencyLever.potentialGain,
              )),
              action: clampString(
                ol.tradeFrequencyLever?.action, 200,
                maximization.optimizationLevers.tradeFrequencyLever.action,
              ),
            },
            capitalEfficiencyLever: {
              currentGap: round2(clampNum(
                ol.capitalEfficiencyLever?.currentGap, GAP_MIN, GAP_MAX,
                maximization.optimizationLevers.capitalEfficiencyLever.currentGap,
              )),
              potentialGain: round2(clampNum(
                ol.capitalEfficiencyLever?.potentialGain, GAIN_MIN, GAIN_MAX,
                maximization.optimizationLevers.capitalEfficiencyLever.potentialGain,
              )),
              action: clampString(
                ol.capitalEfficiencyLever?.action, 200,
                maximization.optimizationLevers.capitalEfficiencyLever.action,
              ),
            },
          };
          // Recompute total gain and maximized daily profit
          const totalGain = newLevers.profitPerTradeLever.potentialGain
            + newLevers.turnoverSpeedLever.potentialGain
            + newLevers.tradeFrequencyLever.potentialGain
            + newLevers.capitalEfficiencyLever.potentialGain;
          const maximizedDailyProfit = round2(clampNum(
            current.currentDailyProfit + totalGain,
            DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, current.currentDailyProfit,
          ));
          maximization = {
            ...maximization,
            optimizationLevers: newLevers,
            maximizedDailyProfit,
            profitPerDayUplift: round2(clampNum(
              totalGain, GAIN_MIN, GAIN_MAX, 0,
            )),
          };
        }

        // Override optimal inventory mix
        if (Array.isArray(parsed.optimalInventoryMix) && parsed.optimalInventoryMix.length >= 2) {
          const mix: OptimalInventoryMixItem[] = [];
          for (const m of parsed.optimalInventoryMix.slice(0, MAX_OPTIMAL_MIX)) {
            if (!m || typeof m !== 'object') continue;
            mix.push({
              category: clampString(m.category, 50, 'Kategorija'),
              priceRange: clampString(m.priceRange, 50, '0-500€'),
              profitPerDay: round2(clampNum(
                m.profitPerDay, DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, 0,
              )),
            });
          }
          if (mix.length >= 2) {
            maximization = { ...maximization, optimalInventoryMix: mix };
          }
        }

        // Override optimal hold time
        if (parsed.optimalHoldTime !== undefined && parsed.optimalHoldTime !== null) {
          maximization = {
            ...maximization,
            optimalHoldTime: round0(clampNum(
              parsed.optimalHoldTime, HOLD_DAYS_MIN, HOLD_DAYS_MAX,
              maximization.optimalHoldTime,
            )),
          };
        }

        // Override bottleneck analysis
        if (typeof parsed.bottleneckAnalysis === 'string' && parsed.bottleneckAnalysis.trim()) {
          maximization = {
            ...maximization,
            bottleneckAnalysis: clampString(
              parsed.bottleneckAnalysis, 400, maximization.bottleneckAnalysis,
            ),
          };
        }

        // Override grade (re-decide based on new uplift)
        const finalGrade = parsed.profitPerDayGrade
          ? clampEnum(parsed.profitPerDayGrade, VALID_GRADE,
              decideGrade(current.currentDailyProfit, maximization.profitPerDayUplift))
          : decideGrade(current.currentDailyProfit, maximization.profitPerDayUplift);
        maximization = { ...maximization, profitPerDayGrade: finalGrade };

        // Recompute projection with new maximized daily profit
        const projection: ProfitPerDayProjectionPoint[] = [];
        const projDays = [7, 14, 30, 90];
        for (const d of projDays) {
          projection.push({
            day: d,
            currentProfit: round0(clampNum(
              current.currentDailyProfit * d,
              DAILY_PROFIT_MIN, DAILY_PROFIT_MAX * 100, 0,
            )),
            maximizedProfit: round0(clampNum(
              maximization.maximizedDailyProfit * d,
              DAILY_PROFIT_MIN, DAILY_PROFIT_MAX * 100, 0,
            )),
          });
        }
        maximization = { ...maximization, profitPerDayProjection: projection };

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-profit-per-day-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return apiOk({
      ok: true,
      current,
      maximization,
      summary,
      aiUsed,
    } satisfies ProfitPerDayResponse);
  },
});

export const GET = inventoryProfitPerDayMaximizerHandler;
export const POST = inventoryProfitPerDayMaximizerHandler;
