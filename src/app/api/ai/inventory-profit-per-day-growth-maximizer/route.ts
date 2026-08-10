// v8.09: AI Inventory Profit Per Day Growth Maximizer — AI MAKSIMIZIRA
// GROWTH RATE daily profit-a iz inventory-ja — ne samo trenutni daily profit,
// ampak koliko hitro raste in kako pospešiti to rast. "Tvoj daily profit
// growth je +2%/teden, ampak bi lahko bil +5%/teden z 4 akcijami." Razlika od
// profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira DAILY
// PROFIT z scalingPath phases) — ta MAKSIMIZIRA GROWTH RATE daily profit-a
// (%/teden kako hitro raste, ne absolutni €/dan). Razlika od
// profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration)
// — ta MAKSIMIZIRA GROWTH RATE daily profit-a iz INVENTORY-ja z
// growthAccelerationActions in doublingTime (ne sam acceleration). Razlika od
// profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier
// z 6 dimensions) — ta MAKSIMIZIRA GROWTH RATE (koliko %/teden, ne × koliko-krat).
// Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized
// cash yield) — ta maksimizira GROWTH RATE daily profit-a (ne annualized yield).
// Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z
// yieldCurve) — ta MAKSIMIZIRA GROWTH RATE z growthTrajectory in doublingTime.
// Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item)
// — ta MAKSIMIZIRA GROWTH RATE daily profit-a z growthGrade in growthBottlenecks.
// Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item)
// — ta MAKSIMIZIRA GROWTH RATE daily profit-a iz inventory-ja (ne ROI per item).
// Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira
// capital efficiency per item) — ta MAKSIMIZIRA GROWTH RATE daily profit-a
// z growthTrajectory (ne capital efficiency per item). Razlika od
// inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF
// inventory) — ta MAKSIMIZIRA GROWTH RATE daily profit-a (return ON profit
// growth, ne capital returned). Razlika od inventory-profit-per-day-maximizer
// (v8.02 ki maksimizira daily profit per item) — ta MAKSIMIZIRA GROWTH RATE
// daily profit-a (koliko %/teden raste, ne absolutni €/dan per item). Razlika
// od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized %
// return na held inventory) — ta MAKSIMIZIRA GROWTH RATE daily profit-a z
// doublingTime (ne annualized return).

// GET+POST /api/ai/inventory-profit-per-day-growth-maximizer
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

type GrowthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
}

interface HeldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
}

interface CurrentState {
  weeklyProfitGrowthRate: number; // %/week
  dailyProfitGrowthRate: number; // %/day
  profitGrowthAcceleration: number; // pp (acceleration of growth rate itself)
  profitGrowthVolatility: number; // 0-100 (variance of weekly profit)
  currentDailyProfit: number; // €/day (= totalProfit12m / 365)
  totalProfit12m: number; // €
  soldCount12m: number;
  heldCount: number;
  heldCapital: number; // €
}

interface GrowthAction {
  action: string; // slovenski, max 200
  expectedGrowthLift: number; // pp improvement in weekly growth rate
  timeline: string; // slovenski, max 100
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

interface GrowthTrajectoryEntry {
  week: number; // 1-8
  currentProjectedProfit: number; // €/day projected at current growth
  maximizedProjectedProfit: number; // €/day projected at maximized growth
}

interface ProfitPerDayGrowthMaximization {
  currentGrowthRate: number; // %/week (echoes current)
  maximizedGrowthRate: number; // %/week optimal
  growthUplift: number; // pp improvement
  growthAccelerationActions: GrowthAction[]; // 4-6 entries
  growthTrajectory: GrowthTrajectoryEntry[]; // 8 entries
  growthBottlenecks: string[]; // 3-5 slovenski strings, max 200 each
  growthSustainability: number; // 0-100
  growthGrade: GrowthGrade;
  doublingTime: number; // days to double daily profit at maximized growth rate
}

interface ProfitPerDayGrowthResponse {
  ok: true;
  current: CurrentState;
  maximization: ProfitPerDayGrowthMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    currentGrowthRate?: number;
    maximizedGrowthRate?: number;
    growthUplift?: number;
    growthAccelerationActions?: Array<{
      action?: string;
      expectedGrowthLift?: number;
      timeline?: string;
      difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    }>;
    growthTrajectory?: Array<{
      week?: number;
      currentProjectedProfit?: number;
      maximizedProjectedProfit?: number;
    }>;
    growthBottlenecks?: string[];
    growthSustainability?: number;
    growthGrade?: GrowthGrade;
    doublingTime?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const WEEKS_IN_WINDOW = 52;

const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const DAILY_PROFIT_MIN = 0;
const DAILY_PROFIT_MAX = 10_000;
const GROWTH_RATE_MIN = -50;
const GROWTH_RATE_MAX = 100;
const ACCELERATION_MIN = -50;
const ACCELERATION_MAX = 100;
const VOLATILITY_MIN = 0;
const VOLATILITY_MAX = 100;
const SUSTAINABILITY_MIN = 0;
const SUSTAINABILITY_MAX = 100;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 100;
const TRAJECTORY_MIN = 0;
const TRAJECTORY_MAX = 10_000;
const DOUBLING_MIN = 1;
const DOUBLING_MAX = 3650;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const HOLD_MIN = 1;
const HOLD_MAX = 730;

const VALID_GRADE: readonly GrowthGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_DIFFICULTY: readonly ('EASY' | 'MEDIUM' | 'HARD')[] = ['EASY', 'MEDIUM', 'HARD'];

const MAX_ACTIONS = 6;
const MAX_TRAJECTORY = 8;
const MAX_BOTTLENECKS = 5;
const MAX_TRADES_FOR_AI = 250;

// Default deterministic maximized growth rate = current × 2.5 (anti-hallucination cap at +200%)
const GROWTH_MAXIMIZATION_FACTOR = 2.5;
// Default doubling time at maximized growth rate (in days)
// double = ln(2) / ln(1 + g/100) / 7  (g = weekly growth %)
const LN2 = Math.log(2);

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
  sellMs: number;
  holdDays: number;
  within12m: boolean;
}

interface HeldComputed {
  capital: number;
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
  return { profit, sellMs, holdDays, within12m };
}

function computeHeldTrade(t: HeldTradeRow): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  return { capital };
}

// Compute weekly profit buckets for growth analysis
interface WeeklyProfitBucket {
  weekIndex: number; // 0..51
  profit: number;
  tradeCount: number;
}

function bucketWeeklyProfit(trades: SoldComputed[], now: number): WeeklyProfitBucket[] {
  if (trades.length === 0) return [];
  const buckets: WeeklyProfitBucket[] = [];
  for (let i = 0; i < WEEKS_IN_WINDOW; i++) {
    buckets.push({ weekIndex: i, profit: 0, tradeCount: 0 });
  }
  const minSellMs = now - TWELVE_MONTHS_MS;
  for (const t of trades) {
    if (t.sellMs <= 0) continue;
    if (t.sellMs < minSellMs || t.sellMs > now) continue;
    const weekIdx = Math.min(
      WEEKS_IN_WINDOW - 1,
      Math.max(0, Math.floor((t.sellMs - minSellMs) / WEEK_MS)),
    );
    buckets[weekIdx].profit += t.profit;
    buckets[weekIdx].tradeCount += 1;
  }
  return buckets;
}

// Compute slope of weekly profit (linear regression) → weekly growth rate %
function computeWeeklyGrowthRate(buckets: WeeklyProfitBucket[]): number {
  if (buckets.length < 4) return 0;
  const n = buckets.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = buckets.reduce((s, b) => s + b.profit, 0);
  const sumXY = buckets.reduce((s, b, i) => s + i * b.profit, 0);
  const sumX2 = buckets.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const base = sumY / n;
  if (base === 0) return 0;
  // Weekly growth rate % = slope / base × 100
  return (slope / base) * 100;
}

// Compute acceleration: difference between slope of last half vs first half
function computeGrowthAcceleration(buckets: WeeklyProfitBucket[]): number {
  if (buckets.length < 8) return 0;
  const mid = Math.floor(buckets.length / 2);
  const firstHalf = buckets.slice(0, mid);
  const secondHalf = buckets.slice(mid);
  const firstSlope = computeWeeklyGrowthRate(firstHalf);
  const secondSlope = computeWeeklyGrowthRate(secondHalf);
  return secondSlope - firstSlope;
}

// Compute volatility: standard deviation of weekly profit / mean × 100
function computeVolatility(buckets: WeeklyProfitBucket[]): number {
  if (buckets.length < 4) return 0;
  const profits = buckets.map((b) => b.profit);
  const mean = profits.reduce((s, p) => s + p, 0) / profits.length;
  if (mean === 0) return 50;
  const variance = profits.reduce((s, p) => s + (p - mean) ** 2, 0) / profits.length;
  const stdDev = Math.sqrt(variance);
  const cv = Math.abs(stdDev / mean) * 100; // coefficient of variation
  return Math.min(100, cv);
}

function computeCurrent(
  sold: SoldComputed[],
  held: HeldComputed[],
  now: number,
): CurrentState {
  const soldCount = sold.length;
  const heldCount = held.length;

  const totalProfit12m = round0(clampNum(
    sold.reduce((s, t) => s + t.profit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const currentDailyProfit = round2(clampNum(
    totalProfit12m / 365,
    DAILY_PROFIT_MIN, DAILY_PROFIT_MAX, 0,
  ));

  const heldCapital = round0(clampNum(
    held.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  const buckets = bucketWeeklyProfit(sold, now);
  const weeklyProfitGrowthRate = round2(clampNum(
    computeWeeklyGrowthRate(buckets),
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const dailyProfitGrowthRate = round2(clampNum(
    weeklyProfitGrowthRate / 7,
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, 0,
  ));
  const profitGrowthAcceleration = round2(clampNum(
    computeGrowthAcceleration(buckets),
    ACCELERATION_MIN, ACCELERATION_MAX, 0,
  ));
  const profitGrowthVolatility = round0(clampNum(
    computeVolatility(buckets),
    VOLATILITY_MIN, VOLATILITY_MAX, 30,
  ));

  return {
    weeklyProfitGrowthRate,
    dailyProfitGrowthRate,
    profitGrowthAcceleration,
    profitGrowthVolatility,
    currentDailyProfit,
    totalProfit12m,
    soldCount12m: soldCount,
    heldCount,
    heldCapital,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildGrowthActions(current: CurrentState): GrowthAction[] {
  const out: GrowthAction[] = [];

  out.push({
    action: 'Vklopi 3 nove monitorje z keyword expansion in znižaj deal score threshold z 70 na 60 — povečan deal flow pospeši growth.',
    expectedGrowthLift: round2(clampNum(2.5, UPLIFT_MIN, UPLIFT_MAX, 2.0)),
    timeline: '2-4 tedne',
    difficulty: 'EASY',
  });

  out.push({
    action: 'Aktiviraj auto-buy za deal score > 85 in real-time alerts za deal score > 70 — +30% trade frequency v 30 dneh.',
    expectedGrowthLift: round2(clampNum(2.0, UPLIFT_MIN, UPLIFT_MAX, 1.5)),
    timeline: '1-2 tedna',
    difficulty: 'EASY',
  });

  out.push({
    action: 'Vklopi multi-platform-listing-generator in cross-platform-listing-generator — vsak listing na 3+ platformah za +40% exposure.',
    expectedGrowthLift: round2(clampNum(1.8, UPLIFT_MIN, UPLIFT_MAX, 1.2)),
    timeline: '3-6 tednov',
    difficulty: 'MEDIUM',
  });

  out.push({
    action: 'Reinvest 70% realized profit v high-ROI sourcing (Bolha + Vinted premium z deal score > 80) — compounding capital deployment.',
    expectedGrowthLift: round2(clampNum(1.5, UPLIFT_MIN, UPLIFT_MAX, 1.0)),
    timeline: '4-8 tednov',
    difficulty: 'MEDIUM',
  });

  out.push({
    action: 'Aktiviraj AI pricing engine in dynamic pricing — višji profit per trade pospeši cumulative growth rate.',
    expectedGrowthLift: round2(clampNum(1.2, UPLIFT_MIN, UPLIFT_MAX, 0.8)),
    timeline: '2-3 tedne',
    difficulty: 'MEDIUM',
  });

  out.push({
    action: 'Ekspanzija na 5+ platform (mobile.de, Kleinanzeigen, Subito, Willhaben) z multi-language listings — long-term growth multiplier.',
    expectedGrowthLift: round2(clampNum(1.0, UPLIFT_MIN, UPLIFT_MAX, 0.5)),
    timeline: '8-16 tednov',
    difficulty: 'HARD',
  });

  return out.slice(0, MAX_ACTIONS);
}

function buildGrowthTrajectory(
  current: CurrentState,
  maximizedGrowthRate: number,
): GrowthTrajectoryEntry[] {
  const trajectory: GrowthTrajectoryEntry[] = [];
  const currentWeeklyRate = current.weeklyProfitGrowthRate / 100;
  const maxWeeklyRate = maximizedGrowthRate / 100;

  for (let week = 1; week <= 8; week++) {
    // Compound growth: profit × (1 + rate)^week
    // Convert weekly profit (currentDailyProfit × 7) at growth rate
    const baseWeekly = current.currentDailyProfit * 7;
    const currentProjected = baseWeekly * Math.pow(1 + currentWeeklyRate, week);
    const maximizedProjected = baseWeekly * Math.pow(1 + maxWeeklyRate, week);
    trajectory.push({
      week,
      currentProjectedProfit: round2(clampNum(
        currentProjected / 7,
        TRAJECTORY_MIN, TRAJECTORY_MAX, current.currentDailyProfit,
      )),
      maximizedProjectedProfit: round2(clampNum(
        maximizedProjected / 7,
        TRAJECTORY_MIN, TRAJECTORY_MAX, current.currentDailyProfit,
      )),
    });
  }
  return trajectory.slice(0, MAX_TRAJECTORY);
}

function buildGrowthBottlenecks(current: CurrentState): string[] {
  const bottlenecks: string[] = [];

  if (current.profitGrowthVolatility > 60) {
    bottlenecks.push(`Visoka volatilnost profit growth-a (${current.profitGrowthVolatility}/100) — profit ni stabilen, growth je nepredvidljiv. Stabiliziraj z doslednim sourcing-om in negotiation close rate tracking.`);
  } else {
    bottlenecks.push(`Profit growth volatilnost (${current.profitGrowthVolatility}/100) — sprejemljiva a še vedno spremenljiva. Nadaljuj z doslednim sourcing-om in pricing strategijo.`);
  }

  if (current.heldCount < 5) {
    bottlenecks.push(`Nizka inventory pipeline (${current.heldCount} HELD) — premalo inventory za vzdrževanje growth rate. Povečaj buy rate za kontinuiteto profita.`);
  } else {
    bottlenecks.push(`Inventory pipeline (${current.heldCount} HELD, ${current.heldCapital}€ deployed) — zadosten za current growth rate a omejuje acceleration.`);
  }

  if (current.soldCount12m < 50) {
    bottlenecks.push(`Nizka trade frequency (${current.soldCount12m} SOLD 12m) — premalo trade-ov za robusten growth signal. Povečaj deal flow z več monitorji in nižjim deal score threshold.`);
  } else {
    bottlenecks.push(`Trade frequency (${current.soldCount12m} SOLD 12m) — zadostna a plateau pri current rate. Diverzificiraj kategorije in source.`);
  }

  bottlenecks.push('Capital deployment rate — reinvest rate trenutno omejuje compounding. Reinvest 70-80% realized profit za optimal compounding effect.');

  if (current.profitGrowthAcceleration < 0) {
    bottlenecks.push(`Growth rate upada (acceleration ${current.profitGrowthAcceleration}pp) — growth se upočasni. Aktiviraj AI growth engine za reversal trend-a.`);
  }

  return bottlenecks.slice(0, MAX_BOTTLENECKS);
}

function computeGrowthSustainability(current: CurrentState): number {
  // High volatility + low inventory + low trade frequency = low sustainability
  const volScore = Math.max(0, 100 - current.profitGrowthVolatility);
  const inventoryScore = Math.min(40, current.heldCount * 4);
  const tradeFreqScore = Math.min(30, current.soldCount12m / 2);
  const accelScore = current.profitGrowthAcceleration > 0 ? 20 : 10;
  return round0(clampNum(
    (volScore * 0.4) + (inventoryScore * 0.3) + (tradeFreqScore * 0.2) + (accelScore * 0.1),
    SUSTAINABILITY_MIN, SUSTAINABILITY_MAX, 50,
  ));
}

function decideGrowthGrade(maximizedRate: number, sustainability: number): GrowthGrade {
  // Combined: maximized growth × sustainability
  const score = maximizedRate * (sustainability / 100);
  if (score >= 15) return 'A+';
  if (score >= 8) return 'A';
  if (score >= 4) return 'B';
  if (score >= 2) return 'C';
  if (score >= 0.5) return 'D';
  return 'F';
}

function computeDoublingTime(maximizedGrowthRate: number): number {
  // doubling time in days = ln(2) / ln(1 + g/100) / 7  (g = weekly %)
  if (maximizedGrowthRate <= 0) return DOUBLING_MAX;
  const rate = maximizedGrowthRate / 100;
  if (rate >= 1) return 7; // >100% per week → doubles in ~1 week
  const weeklyDoubling = LN2 / Math.log(1 + rate);
  const daysDoubling = weeklyDoubling * 7;
  return round0(clampNum(
    daysDoubling,
    DOUBLING_MIN, DOUBLING_MAX, 365,
  ));
}

function buildDeterministicMaximization(
  current: CurrentState,
): ProfitPerDayGrowthMaximization {
  const currentGrowthRate = current.weeklyProfitGrowthRate;
  // Maximized growth rate = current × 2.5 (anti-hallucination: capped at +100% absolute)
  const maximizedGrowthRate = round2(clampNum(
    currentGrowthRate * GROWTH_MAXIMIZATION_FACTOR,
    GROWTH_RATE_MIN, GROWTH_RATE_MAX, Math.max(2.0, currentGrowthRate + 2.0),
  ));
  const growthUplift = round2(clampNum(
    Math.max(0, maximizedGrowthRate - currentGrowthRate),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const growthAccelerationActions = buildGrowthActions(current);
  const growthTrajectory = buildGrowthTrajectory(current, maximizedGrowthRate);
  const growthBottlenecks = buildGrowthBottlenecks(current);
  const growthSustainability = computeGrowthSustainability(current);
  const growthGrade = decideGrowthGrade(maximizedGrowthRate, growthSustainability);
  const doublingTime = computeDoublingTime(maximizedGrowthRate);

  return {
    currentGrowthRate,
    maximizedGrowthRate,
    growthUplift,
    growthAccelerationActions,
    growthTrajectory,
    growthBottlenecks,
    growthSustainability,
    growthGrade,
    doublingTime,
  };
}

function buildSummary(
  current: CurrentState,
  max: ProfitPerDayGrowthMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.weeklyProfitGrowthRate.toFixed(2)}%/teden growth (${current.currentDailyProfit.toFixed(2)}€/dan, ${current.soldCount12m} SOLD 12m, ${current.heldCount} HELD, ${current.profitGrowthVolatility}/100 volatilnost).`,
    `Maximized: ${max.maximizedGrowthRate.toFixed(2)}%/teden (+${max.growthUplift.toFixed(2)}pp uplift, grade ${max.growthGrade}).`,
    `Doubling time: ${max.doublingTime} dni. Sustainability: ${max.growthSustainability}/100.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryProfitPerDayGrowthMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryProfitPerDayGrowthMaximizer(req);
}

async function handleInventoryProfitPerDayGrowthMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-profit-per-day-growth-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query SOLD trades (last 12m) + HELD trades (inventory pipeline)
    const [soldTrades, heldTrades] = await Promise.all([
      db.trade.findMany({
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
      }) as unknown as SoldTradeRow[],
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          buyPrice: true,
          buyFees: true,
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD and no HELD trades
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          weeklyProfitGrowthRate: 0,
          dailyProfitGrowthRate: 0,
          profitGrowthAcceleration: 0,
          profitGrowthVolatility: 0,
          currentDailyProfit: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          heldCount: 0,
          heldCapital: 0,
        },
        maximization: {
          currentGrowthRate: 0,
          maximizedGrowthRate: 0,
          growthUplift: 0,
          growthAccelerationActions: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthSustainability: 0,
          growthGrade: 'F',
          doublingTime: 0,
        },
        summary: 'Ni SOLD in HELD trgovin — Inventory Profit Per Day Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Inventory Profit Per Day Growth Maximizer ni mogoč.',
      } satisfies ProfitPerDayGrowthResponse);
    }

    // 2) Compute SOLD trades within 12m
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    // 3) Compute HELD trades (inventory pipeline)
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t);
      if (c) heldComputed.push(c);
    }

    // If no SOLD trades, can't compute growth rate
    if (soldComputed.length === 0) {
      const heldCap = heldComputed.reduce((s, h) => s + h.capital, 0);
      return NextResponse.json({
        ok: true,
        current: {
          weeklyProfitGrowthRate: 0,
          dailyProfitGrowthRate: 0,
          profitGrowthAcceleration: 0,
          profitGrowthVolatility: 0,
          currentDailyProfit: 0,
          totalProfit12m: 0,
          soldCount12m: 0,
          heldCount: heldComputed.length,
          heldCapital: heldCap,
        },
        maximization: {
          currentGrowthRate: 0,
          maximizedGrowthRate: 0,
          growthUplift: 0,
          growthAccelerationActions: [],
          growthTrajectory: [],
          growthBottlenecks: [],
          growthSustainability: 0,
          growthGrade: 'F',
          doublingTime: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Profit Per Day Growth Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Profit Per Day Growth Maximizer ni mogoč.',
      } satisfies ProfitPerDayGrowthResponse);
    }

    const current = computeCurrent(soldComputed, heldComputed, now);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-profit-per-day-growth-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: ProfitPerDayGrowthMaximization;
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
      } satisfies ProfitPerDayGrowthResponse);
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
        holdDays: t.holdDays,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      heldCount: heldComputed.length,
      current,
      deterministicMaximization: {
        currentGrowthRate: maximization.currentGrowthRate,
        maximizedGrowthRate: maximization.maximizedGrowthRate,
        growthUplift: maximization.growthUplift,
        growthAccelerationActions: maximization.growthAccelerationActions,
        growthTrajectory: maximization.growthTrajectory,
        growthBottlenecks: maximization.growthBottlenecks,
        growthSustainability: maximization.growthSustainability,
        growthGrade: maximization.growthGrade,
        doublingTime: maximization.doublingTime,
      },
      soldSample: soldSampleForAI,
      caps: {
        dailyProfitMin: DAILY_PROFIT_MIN, dailyProfitMax: DAILY_PROFIT_MAX,
        growthRateMin: GROWTH_RATE_MIN, growthRateMax: GROWTH_RATE_MAX,
        accelerationMin: ACCELERATION_MIN, accelerationMax: ACCELERATION_MAX,
        volatilityMin: VOLATILITY_MIN, volatilityMax: VOLATILITY_MAX,
        sustainabilityMin: SUSTAINABILITY_MIN, sustainabilityMax: SUSTAINABILITY_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        trajectoryMin: TRAJECTORY_MIN, trajectoryMax: TRAJECTORY_MAX,
        doublingMin: DOUBLING_MIN, doublingMax: DOUBLING_MAX,
      },
    };

    const prompt = `Si AI "Inventory Profit Per Day Growth Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT PER DAY GROWTH MAXIMIZATION — kako maksimizirati GROWTH RATE daily profit-a iz inventory-ja (koliko %/teden raste daily profit, ne sam absolutni €/dan). Tvoj cilj je "Tvoj daily profit growth je +2%/teden, ampak bi lahko bil +5%/teden z 4 akcijami." Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira DAILY PROFIT z scalingPath phases) — ti MAKSIMIZIRAŠ GROWTH RATE daily profit-a (%/teden kako hitro raste, ne absolutni €/dan). Razlika od profit-acceleration-maximizer (v8.05 ki maksimizira growth rate acceleration) — ta MAKSIMIZIRA GROWTH RATE daily profit-a iz INVENTORY-ja z growthAccelerationActions in doublingTime (ne sam acceleration). Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ta MAKSIMIZIRA GROWTH RATE (koliko %/teden, ne × koliko-krat). Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) — ta maksimizira GROWTH RATE daily profit-a (ne annualized yield). Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ta MAKSIMIZIRA GROWTH RATE z growthTrajectory in doublingTime. Razlika od inventory-yield-maximizer (v8.03 ki maksimizira yield % per item) — ta MAKSIMIZIRA GROWTH RATE daily profit-a z growthGrade in growthBottlenecks. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ta MAKSIMIZIRA GROWTH RATE daily profit-a iz inventory-ja (ne ROI per item). Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item) — ta MAKSIMIZIRA GROWTH RATE daily profit-a z growthTrajectory (ne capital efficiency per item). Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF inventory) — ta MAKSIMIZIRA GROWTH RATE daily profit-a (return ON profit growth, ne capital returned). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ta MAKSIMIZIRA GROWTH RATE daily profit-a (koliko %/teden raste, ne absolutni €/dan per item). Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ta MAKSIMIZIRA GROWTH RATE daily profit-a z doublingTime (ne annualized return).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD trgovine):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.currentGrowthRate %/teden [-50, 100] (echoes current weeklyProfitGrowthRate),
2. maximization.maximizedGrowthRate %/teden [-50, 100] (optimal achievable growth rate, ≥ current, ≤ current × 2.5 ali +50pp absolute uplift — anti-hallucination),
3. maximization.growthUplift pp [0, 100] (improvement = maximized − current),
4. maximization.growthAccelerationActions: 4-6 elementov { action (slovenski, max 200 — specifična akcija za pospešitev growth rate), expectedGrowthLift pp [0, 100] (koliko pp bo dodana k growth rate), timeline (slovenski, max 100 — kdaj implementirati), difficulty EASY/MEDIUM/HARD },
5. maximization.growthTrajectory: 8 elementov { week 1-8, currentProjectedProfit €/dan [0, 10000] (profit čez X tednov pri current growth rate, compound: base × (1 + rate)^week), maximizedProjectedProfit €/dan [0, 10000] (profit pri maximized growth rate) },
6. maximization.growthBottlenecks: 3-5 stringov (max 200 vsak, slovenski — kaj limitira growth rate acceleration),
7. maximization.growthSustainability [0, 100] (ali je trenutni growth vzdržen — kombinacija volatilnost × inventory × trade frequency × acceleration),
8. maximization.growthGrade: A+ | A | B | C | D | F (A+ če maximized × sustainability/100 ≥ 15, A ≥ 8, B ≥ 4, C ≥ 2, D ≥ 0.5, else F),
9. maximization.doublingTime days [1, 3650] (dni do double daily profit pri maximized growth rate — = ln(2) / ln(1 + g/100) / 7 × 7 = ln(2) / ln(1 + g/100) dnevi kjer g = maximizedGrowthRate %),
10. summary: slovenski povzetek (max 500 znakov — poudari current growth rate, maximized growth rate, uplift, grade, doubling time, sustainability).

VRNI LE JSON:
{
  "maximization": {
    "currentGrowthRate": 2.0,
    "maximizedGrowthRate": 5.0,
    "growthUplift": 3.0,
    "growthAccelerationActions": [
      { "action": "Vklopi 3 nove monitorje z keyword expansion.", "expectedGrowthLift": 2.5, "timeline": "2-4 tedne", "difficulty": "EASY" },
      { "action": "Aktiviraj auto-buy za deal score > 85.", "expectedGrowthLift": 2.0, "timeline": "1-2 tedna", "difficulty": "EASY" },
      { "action": "Multi-platform listings za 3+ platform.", "expectedGrowthLift": 1.8, "timeline": "3-6 tednov", "difficulty": "MEDIUM" },
      { "action": "Reinvest 70% profit v high-ROI sourcing.", "expectedGrowthLift": 1.5, "timeline": "4-8 tednov", "difficulty": "MEDIUM" }
    ],
    "growthTrajectory": [
      { "week": 1, "currentProjectedProfit": 45.6, "maximizedProjectedProfit": 46.4 },
      { "week": 2, "currentProjectedProfit": 46.5, "maximizedProjectedProfit": 48.7 },
      { "week": 3, "currentProjectedProfit": 47.4, "maximizedProjectedProfit": 51.1 },
      { "week": 4, "currentProjectedProfit": 48.4, "maximizedProjectedProfit": 53.7 },
      { "week": 5, "currentProjectedProfit": 49.3, "maximizedProjectedProfit": 56.4 },
      { "week": 6, "currentProjectedProfit": 50.3, "maximizedProjectedProfit": 59.3 },
      { "week": 7, "currentProjectedProfit": 51.3, "maximizedProjectedProfit": 62.3 },
      { "week": 8, "currentProjectedProfit": 52.4, "maximizedProjectedProfit": 65.4 }
    ],
    "growthBottlenecks": [
      "Visoka volatilnost profit growth-a (60/100) — profit ni stabilen.",
      "Nizka inventory pipeline (3 HELD) — premalo za vzdrževanje growth.",
      "Capital deployment rate omejuje compounding."
    ],
    "growthSustainability": 65,
    "growthGrade": "B",
    "doublingTime": 98
  },
  "summary": "Current: 2.00%/teden growth (45.00€/dan, 50 SOLD 12m, 3 HELD, 60/100 volatilnost). Maximized: 5.00%/teden (+3.00pp uplift, grade B). Doubling time: 98 dni. Sustainability: 65/100."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Override maximizedGrowthRate — anti-hallucination: ≥ current, ≤ current × 2.5 + 50
        const maxBound = Math.min(
          GROWTH_RATE_MAX,
          Math.max(
            current.weeklyProfitGrowthRate + 5,
            current.weeklyProfitGrowthRate * GROWTH_MAXIMIZATION_FACTOR + 10,
          ),
        );
        const minBound = Math.max(GROWTH_RATE_MIN, current.weeklyProfitGrowthRate);
        const maximizedGrowthRate = round2(clampNum(
          aiMax.maximizedGrowthRate,
          minBound, maxBound,
          maximization.maximizedGrowthRate,
        ));
        const growthUplift = round2(clampNum(
          Math.max(0, maximizedGrowthRate - current.weeklyProfitGrowthRate),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override growthAccelerationActions
        let growthAccelerationActions = maximization.growthAccelerationActions;
        if (Array.isArray(aiMax.growthAccelerationActions) &&
            aiMax.growthAccelerationActions.length >= 4) {
          const aiAct: GrowthAction[] = [];
          for (const a of aiMax.growthAccelerationActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            aiAct.push({
              action: clampString(a.action, 200, 'Akcija za growth acceleration.'),
              expectedGrowthLift: round2(clampNum(
                a.expectedGrowthLift, UPLIFT_MIN, UPLIFT_MAX, 1.0,
              )),
              timeline: clampString(a.timeline, 100, '2-4 tedne'),
              difficulty: clampEnum(a.difficulty, VALID_DIFFICULTY, 'MEDIUM'),
            });
          }
          if (aiAct.length >= 4) {
            growthAccelerationActions = aiAct;
          }
        }

        // Override growthTrajectory — must be 8 entries with weeks 1-8
        let growthTrajectory = maximization.growthTrajectory;
        if (Array.isArray(aiMax.growthTrajectory) &&
            aiMax.growthTrajectory.length >= 8) {
          const aiTraj: GrowthTrajectoryEntry[] = [];
          for (const expected of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const ai = aiMax.growthTrajectory.find(
              (p) => p && Number(p.week) === expected,
            );
            if (!ai) continue;
            aiTraj.push({
              week: expected,
              currentProjectedProfit: round2(clampNum(
                ai.currentProjectedProfit,
                TRAJECTORY_MIN, TRAJECTORY_MAX, current.currentDailyProfit,
              )),
              maximizedProjectedProfit: round2(clampNum(
                ai.maximizedProjectedProfit,
                TRAJECTORY_MIN, TRAJECTORY_MAX, current.currentDailyProfit,
              )),
            });
          }
          if (aiTraj.length === 8) {
            growthTrajectory = aiTraj;
          }
        }

        // Override growthBottlenecks
        let growthBottlenecks = maximization.growthBottlenecks;
        if (Array.isArray(aiMax.growthBottlenecks) &&
            aiMax.growthBottlenecks.length >= 3) {
          const aiBn: string[] = [];
          for (const b of aiMax.growthBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            aiBn.push(clampString(b, 200, 'Growth bottleneck neopisan.'));
          }
          if (aiBn.length >= 3) {
            growthBottlenecks = aiBn;
          }
        }

        // Override growthSustainability
        const growthSustainability = round0(clampNum(
          aiMax.growthSustainability,
          SUSTAINABILITY_MIN, SUSTAINABILITY_MAX,
          maximization.growthSustainability,
        ));

        // Override growthGrade
        const growthGrade = aiMax.growthGrade
          ? clampEnum(aiMax.growthGrade, VALID_GRADE, decideGrowthGrade(maximizedGrowthRate, growthSustainability))
          : decideGrowthGrade(maximizedGrowthRate, growthSustainability);

        // Override doublingTime
        const doublingTime = round0(clampNum(
          aiMax.doublingTime ?? computeDoublingTime(maximizedGrowthRate),
          DOUBLING_MIN, DOUBLING_MAX, computeDoublingTime(maximizedGrowthRate),
        ));

        maximization = {
          currentGrowthRate: current.weeklyProfitGrowthRate,
          maximizedGrowthRate,
          growthUplift,
          growthAccelerationActions,
          growthTrajectory,
          growthBottlenecks,
          growthSustainability,
          growthGrade,
          doublingTime,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-profit-per-day-growth-maximizer',
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
    } satisfies ProfitPerDayGrowthResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-profit-per-day-growth-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
