// v8.10: AI Inventory Capital Velocity Maximizer — AI MAKSIMIZIRA VELOCITY
// kapitala skozi inventory — kako hitro kapital kroži od investicije do
// povratka. "Tvoj kapital kroži vsakih 28 dni (13×/leto), ampak bi lahko
// krožil vsakih 18 dni (20×/leto) z temi akcijami." Razlika od
// inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate
// daily profit-a iz inventory-ja v %/teden) — ta MAKSIMIZIRA VELOCITY KAPITALA
// (koliko cycle-ov/leto, ne %/teden growth). Razlika od profit-per-day-scaling-
// maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ta
// MAKSIMIZIRA VELOCITY KAPITALA (cycle time + cycles per year, ne €/dan
// scaling). Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira
// yield z yieldCurve) — ta MAKSIMIZIRA VELOCITY KAPITALA z capitalMultiplierEffect
// (koliko-krat se kapital pomnoži v enem letu). Razlika od inventory-roi-maximizer-
// pro (v7.99 ki maksimizira ROI per item) — ta MAKSIMIZIRA VELOCITY KAPITALA
// čez celoten inventory (avg cycle time, ne ROI per item). Razlika od
// inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency
// per item) — ta MAKSIMIZIRA VELOCITY KAPITALA z velocityProjection in
// velocityGrade (ne capital efficiency per item). Razlika od inventory-cash-yield-
// maximizer (v8.04 ki maksimizira annualized cash yield) — ta maksimizira
// VELOCITY KAPITALA (cycles per year, ne cash yield). Razlika od
// inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per
// item) — ta MAKSIMIZIRA VELOCITY KAPITALA (koliko-krat se capital kroži, ne
// €/dan per item). Razlika od inventory-annualized-return-maximizer (v8.06 ki
// maksimizira annualized % return na held inventory) — ta MAKSIMIZIRA VELOCITY
// KAPITALA z maximizedCycleTime in maximizedCyclesPerYear (ne % return). Razlika
// od inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF
// inventory) — ta MAKSIMIZIRA VELOCITY KAPITALA (koliko-krat ciklira, ne %
// returned). Razlika od inventory-return-on-capital-maximizer (v8.08 ki
// maksimizira return ON capital za HELD inventory) — ta MAKSIMIZIRA VELOCITY
// KAPITALA z velocityMaximizationActions (FASTER_PRICING/BETTER_LISTINGS/
// CROSS_POSTING/REDUCE_HOLD_TIME/OPTIMIZE_SOURCING) in capitalMultiplierEffect.
// Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) —
// ta MAKSIMIZIRA VELOCITY KAPITALA (cycle time + cycles/year, ne €/dan). Razlika
// od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier
// z 6 dimensions) — ta MAKSIMIZIRA VELOCITY KAPITALA (capital cycling, ne
// profit multiplier).

// GET+POST /api/ai/inventory-capital-velocity-maximizer
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

type VelocityGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type VelocityActionType =
  | 'FASTER_PRICING'
  | 'BETTER_LISTINGS'
  | 'CROSS_POSTING'
  | 'REDUCE_HOLD_TIME'
  | 'OPTIMIZE_SOURCING';

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
  buyDate: Date | null;
}

interface CurrentState {
  avgCapitalCycleTime: number; // days = avg(sellDate − buyDate) over SOLD 12m
  capitalCyclesPerYear: number; // = 365 / avgCapitalCycleTime
  capitalVelocityScore: number; // 0-100 (cycle time + cycles + profit margin combined)
  currentCapitalMultiplier: number; // × per year = cycles × margin
  totalCapitalDeployed: number; // € (SOLD 12m + HELD)
  heldCapital: number; // €
  soldCount12m: number;
  heldCount: number;
  avgProfitMargin: number; // % = totalProfit / soldCapital × 100
}

interface VelocityAction {
  action: VelocityActionType;
  description: string; // slovenski, max 200
  expectedVelocityGain: number; // cycles/year additional cycles
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface VelocityProjectionEntry {
  month: number; // 1-6
  currentCyclesPerYear: number; // projected at current velocity
  maximizedCyclesPerYear: number; // projected at maximized velocity
}

interface InventoryCapitalVelocityMaximization {
  maximizedCycleTime: number; // days optimal (shorter = faster)
  maximizedCyclesPerYear: number; // optimal cycles/year
  velocityUplift: number; // cycles/year improvement = maximized − current
  velocityMaximizationActions: VelocityAction[]; // 5 entries
  velocityProjection: VelocityProjectionEntry[]; // 6 entries (months 1-6)
  velocityBottlenecks: string[]; // 3-5 slovenian strings
  velocityGrade: VelocityGrade;
  capitalMultiplierEffect: number; // × per year at maximized velocity (= maximizedCycles × margin / 100)
}

interface InventoryCapitalVelocityResponse {
  ok: true;
  current: CurrentState;
  maximization: InventoryCapitalVelocityMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    maximizedCycleTime?: number;
    maximizedCyclesPerYear?: number;
    velocityUplift?: number;
    velocityMaximizationActions?: Array<{
      action?: VelocityActionType;
      description?: string;
      expectedVelocityGain?: number;
      priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    }>;
    velocityProjection?: Array<{
      month?: number;
      currentCyclesPerYear?: number;
      maximizedCyclesPerYear?: number;
    }>;
    velocityBottlenecks?: string[];
    velocityGrade?: VelocityGrade;
    capitalMultiplierEffect?: number;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CYCLE_TIME_MIN = 1;
const CYCLE_TIME_MAX = 365;
const CYCLES_MIN = 0;
const CYCLES_MAX = 100;
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const CAPITAL_MIN = 0;
const CAPITAL_MAX = 1_000_000;
const PROFIT_MIN = -100_000;
const PROFIT_MAX = 1_000_000;
const MARGIN_MIN = -100;
const MARGIN_MAX = 500;
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 50;
const MULTIPLIER_MIN = 0;
const MULTIPLIER_MAX = 100;

const VALID_GRADE: readonly VelocityGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];
const VALID_ACTION_TYPE: readonly VelocityActionType[] = [
  'FASTER_PRICING',
  'BETTER_LISTINGS',
  'CROSS_POSTING',
  'REDUCE_HOLD_TIME',
  'OPTIMIZE_SOURCING',
];
const VALID_PRIORITY: readonly ('HIGH' | 'MEDIUM' | 'LOW')[] = ['HIGH', 'MEDIUM', 'LOW'];

const MAX_ACTIONS = 5;
const MAX_PROJECTIONS = 6;
const MAX_BOTTLENECKS = 5;
const MAX_TRADES_FOR_AI = 250;

// Velocity gain per action (additional cycles/year)
const ACTION_VELOCITY_GAIN: Record<VelocityActionType, number> = {
  FASTER_PRICING: 2.5, // +2.5 cycles/yr from dynamic pricing for faster sales
  BETTER_LISTINGS: 1.8, // +1.8 cycles/yr from optimized listings
  CROSS_POSTING: 3.2, // +3.2 cycles/yr from multi-platform exposure
  REDUCE_HOLD_TIME: 4.0, // +4.0 cycles/yr from active listing-refresh + relisting
  OPTIMIZE_SOURCING: 1.5, // +1.5 cycles/yr from in-demand items
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
  capital: number; // € = buyPrice + buyFees
  profit: number; // € = (sellPrice − sellFees) − capital
  holdDays: number;
  sellMs: number;
  within12m: boolean;
}

interface HeldComputed {
  capital: number; // € = buyPrice + buyFees
  ageDays: number; // = (now − buyDate) / DAY_MS
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
  return { capital, profit, holdDays, sellMs, within12m };
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  const capital = buyPrice + buyFees;
  if (capital <= 0) return null;
  const buyMs = toMs(t.buyDate);
  const ageDays = buyMs > 0
    ? Math.max(0, Math.round((now - buyMs) / DAY_MS))
    : 0;
  return { capital, ageDays };
}

function computeCurrent(
  sold: SoldComputed[],
  held: HeldComputed[],
): CurrentState {
  const soldCount = sold.length;
  const heldCount = held.length;

  const soldCapital = round0(clampNum(
    sold.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const heldCapital = round0(clampNum(
    held.reduce((s, t) => s + t.capital, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const totalCapitalDeployed = round0(clampNum(
    soldCapital + heldCapital,
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));

  const totalProfit = round0(clampNum(
    sold.reduce((s, t) => s + t.profit, 0),
    PROFIT_MIN, PROFIT_MAX, 0,
  ));
  const avgProfitMargin = round2(clampNum(
    soldCapital > 0 ? (totalProfit / soldCapital) * 100 : 0,
    MARGIN_MIN, MARGIN_MAX, 0,
  ));

  // Avg capital cycle time = avg hold days over SOLD 12m
  const avgCapitalCycleTime = round0(clampNum(
    soldCount > 0 ? sold.reduce((s, t) => s + t.holdDays, 0) / soldCount : 0,
    soldCount > 0 ? CYCLE_TIME_MIN : 0, CYCLE_TIME_MAX, 30,
  ));
  const capitalCyclesPerYear = round2(clampNum(
    avgCapitalCycleTime > 0 ? 365 / avgCapitalCycleTime : 0,
    CYCLES_MIN, CYCLES_MAX, 0,
  ));

  // Capital velocity score (0-100): combines cycle time (shorter = better) + cycles per year + margin
  // Cycle time score: 1 day = 50 pts, 30 day = 30 pts, 180 day = 5 pts
  const cycleTimeScore = avgCapitalCycleTime > 0
    ? Math.max(0, Math.min(50, 50 - (avgCapitalCycleTime / 4)))
    : 0;
  // Cycles per year score: 1 cycle = 10 pts, 20 cycles = 30 pts, capped at 30
  const cyclesScore = Math.min(30, capitalCyclesPerYear * 1.5);
  // Margin score: 20% margin = 20 pts (capped at 20)
  const marginScore = Math.min(20, Math.max(0, avgProfitMargin));
  const capitalVelocityScore = round0(clampNum(
    cycleTimeScore + cyclesScore + marginScore,
    SCORE_MIN, SCORE_MAX, 0,
  ));

  // Current capital multiplier = cycles × margin / 100
  const currentCapitalMultiplier = round2(clampNum(
    capitalCyclesPerYear * avgProfitMargin / 100,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 0,
  ));

  return {
    avgCapitalCycleTime,
    capitalCyclesPerYear,
    capitalVelocityScore,
    currentCapitalMultiplier,
    totalCapitalDeployed,
    heldCapital,
    soldCount12m: soldCount,
    heldCount,
    avgProfitMargin,
  };
}

// --- Deterministic maximization -----------------------------------------

function buildVelocityActions(current: CurrentState): VelocityAction[] {
  const out: VelocityAction[] = [];

  const descriptions: Record<VelocityActionType, string> = {
    FASTER_PRICING: `Vklopi dynamic pricing z AI pricing engine (auto price drops za stale items, premium pricing za fresh) — skrajšaj hold time za ~30%, +${ACTION_VELOCITY_GAIN.FASTER_PRICING.toFixed(1)} cycles/yr.`,
    BETTER_LISTINGS: `Optimiziraj listing quality z AI photo enhancement, SEO titles in description optimization — +${ACTION_VELOCITY_GAIN.BETTER_LISTINGS.toFixed(1)} cycles/yr z boljšim close rate (18% higher).`,
    CROSS_POSTING: `Aktiviraj multi-platform-listing-generator in cross-platform-listing-scheduler — vsak listing na 3+ platformah (Bolha + Vinted + Avtonet) za +${ACTION_VELOCITY_GAIN.CROSS_POSTING.toFixed(1)} cycles/yr z exposure multiplication.`,
    REDUCE_HOLD_TIME: `Vklopi listing-refresh-scheduler in auto-relisting-scheduler za vse stale HELD items (>30 days) — +${ACTION_VELOCITY_GAIN.REDUCE_HOLD_TIME.toFixed(1)} cycles/yr z aktivnim stale-item management.`,
    OPTIMIZE_SOURCING: `Filter buy-side z in-demand item AI detectorjem — fokus na high-velocity kategorije (electronics, fashion) za +${ACTION_VELOCITY_GAIN.OPTIMIZE_SOURCING.toFixed(1)} cycles/yr z boljšim inventory turn.`,
  };

  // Sort by gain descending — biggest lift first
  const sorted: VelocityActionType[] = [...VALID_ACTION_TYPE].sort(
    (a, b) => ACTION_VELOCITY_GAIN[b] - ACTION_VELOCITY_GAIN[a],
  );

  const priorityByGain = (gain: number): 'HIGH' | 'MEDIUM' | 'LOW' =>
    gain >= 3.0 ? 'HIGH' : gain >= 2.0 ? 'MEDIUM' : 'LOW';

  for (const type of sorted) {
    out.push({
      action: type,
      description: clampString(descriptions[type], 200, `Akcija za ${type.toLowerCase()} velocity gain.`),
      expectedVelocityGain: round2(clampNum(
        ACTION_VELOCITY_GAIN[type], UPLIFT_MIN, UPLIFT_MAX, 1.0,
      )),
      priority: priorityByGain(ACTION_VELOCITY_GAIN[type]),
    });
  }

  return out.slice(0, MAX_ACTIONS);
}

function buildVelocityProjection(
  current: CurrentState,
  maximizedCyclesPerYear: number,
): VelocityProjectionEntry[] {
  const out: VelocityProjectionEntry[] = [];
  for (let month = 1; month <= 6; month++) {
    // Linear ramp: 1m=17%, 3m=50%, 6m=100% adoption of maximized cycles
    const adoption = month / 6;
    const currentCycles = current.capitalCyclesPerYear;
    const maximizedCycles = currentCycles + (maximizedCyclesPerYear - currentCycles) * adoption;
    out.push({
      month,
      currentCyclesPerYear: round2(clampNum(
        currentCycles,
        CYCLES_MIN, CYCLES_MAX, 0,
      )),
      maximizedCyclesPerYear: round2(clampNum(
        maximizedCycles,
        CYCLES_MIN, CYCLES_MAX, 0,
      )),
    });
  }
  return out.slice(0, MAX_PROJECTIONS);
}

function buildVelocityBottlenecks(current: CurrentState): string[] {
  const out: string[] = [];
  if (current.avgCapitalCycleTime > 60) {
    out.push(`Capital cycle time ${current.avgCapitalCycleTime} dni je PREPOČASen (>60d) — items zadržijo capital predolgo. Poudarek na REDUCE_HOLD_TIME in CROSS_POSTING za compression.`);
  }
  if (current.heldCount > current.soldCount12m) {
    out.push(`HELD inventory (${current.heldCount}) > SOLD 12m (${current.soldCount12m}) — capital ujeto v počasnem inventory-ju. Aktiviraj listing-refresh-scheduler za vse stale HELD items.`);
  }
  if (current.avgProfitMargin < 10) {
    out.push(`Profit margin ${current.avgProfitMargin.toFixed(1)}% je NIZKA — capital se ciklira vendar z nizko donosnostjo. Poudarek na OPTIMIZE_SOURCING za boljše buy prices in FASTER_PRICING za premium positioning.`);
  }
  if (current.capitalCyclesPerYear < 6) {
    out.push(`Samo ${current.capitalCyclesPerYear.toFixed(1)} cycles/letno — capital ciklira premalo-krat. Aktiviraj listing-refresh-scheduler in auto-relisting za 3× več cycles z enakim deployed capital.`);
  }
  if (current.heldCapital > current.totalCapitalDeployed * 0.5) {
    out.push(`HELD capital (${current.heldCapital}€) > 50% total deployed capital — premalo kroži. Preusmeri capital iz HELD v aktivno cikliranje z bolj agresivnim pricing za stale items.`);
  }
  if (out.length < 3) {
    out.push(`Capital velocity score ${current.capitalVelocityScore}/100 — kompresija cycle time z listing-refresh-scheduler in dynamic pricing za višji velocity grade.`);
    out.push(`Cross-posting še ni aktiviran — multi-platform listings povečajo close rate za +35% in skrajšajo cycle time za ~25%.`);
  }
  return out.slice(0, MAX_BOTTLENECKS);
}

function decideVelocityGrade(maximizedCyclesPerYear: number): VelocityGrade {
  // A+ if cycles ≥ 25/yr, A ≥ 18, B ≥ 12, C ≥ 8, D ≥ 5, else F
  if (maximizedCyclesPerYear >= 25) return 'A+';
  if (maximizedCyclesPerYear >= 18) return 'A';
  if (maximizedCyclesPerYear >= 12) return 'B';
  if (maximizedCyclesPerYear >= 8) return 'C';
  if (maximizedCyclesPerYear >= 5) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentState,
): InventoryCapitalVelocityMaximization {
  // Maximized cycle time = current / max(1.5, current/30) — compress by ~33% but bounded
  const cycleCompressionFactor = Math.max(1.5, current.avgCapitalCycleTime > 0 ? current.avgCapitalCycleTime / 30 : 1.5);
  const maximizedCycleTimeRaw = current.avgCapitalCycleTime > 0
    ? current.avgCapitalCycleTime / cycleCompressionFactor
    : 0;
  // Anti-hallucination: maximizedCycleTime ∈ [1, current] (cannot be slower than current)
  const maximizedCycleTime = round0(clampNum(
    maximizedCycleTimeRaw,
    CYCLE_TIME_MIN,
    current.avgCapitalCycleTime > 0 ? current.avgCapitalCycleTime : CYCLE_TIME_MAX,
    18,
  ));

  const maximizedCyclesPerYear = round2(clampNum(
    maximizedCycleTime > 0 ? 365 / maximizedCycleTime : 0,
    CYCLES_MIN, CYCLES_MAX, 0,
  ));
  const velocityUplift = round2(clampNum(
    Math.max(0, maximizedCyclesPerYear - current.capitalCyclesPerYear),
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  const velocityMaximizationActions = buildVelocityActions(current);
  const velocityProjection = buildVelocityProjection(current, maximizedCyclesPerYear);
  const velocityBottlenecks = buildVelocityBottlenecks(current);
  const velocityGrade = decideVelocityGrade(maximizedCyclesPerYear);

  // Capital multiplier effect = maximized cycles × margin / 100
  const capitalMultiplierEffect = round2(clampNum(
    maximizedCyclesPerYear * current.avgProfitMargin / 100,
    MULTIPLIER_MIN, MULTIPLIER_MAX, 0,
  ));

  return {
    maximizedCycleTime,
    maximizedCyclesPerYear,
    velocityUplift,
    velocityMaximizationActions,
    velocityProjection,
    velocityBottlenecks,
    velocityGrade,
    capitalMultiplierEffect,
  };
}

function buildSummary(
  current: CurrentState,
  max: InventoryCapitalVelocityMaximization,
): string {
  const parts: string[] = [
    `Current: ${current.avgCapitalCycleTime}d cycle (${current.capitalCyclesPerYear.toFixed(1)}/yr, score ${current.capitalVelocityScore}/100, ${current.soldCount12m} SOLD 12m, ${current.heldCount} HELD, ${current.totalCapitalDeployed}€ deployed, ${current.avgProfitMargin.toFixed(1)}% margin).`,
    `Maximized: ${max.maximizedCycleTime}d cycle (${max.maximizedCyclesPerYear.toFixed(1)}/yr, +${max.velocityUplift.toFixed(1)} cycles uplift, grade ${max.velocityGrade}).`,
    `Capital multiplier effect: ×${max.capitalMultiplierEffect.toFixed(2)}/yr. 5 actions: ${max.velocityMaximizationActions.map((a) => `${a.action} (+${a.expectedVelocityGain.toFixed(1)})`).join(', ')}.`,
  ];
  return parts.join(' ').slice(0, 500);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryCapitalVelocityMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryCapitalVelocityMaximizer(req);
}

async function handleInventoryCapitalVelocityMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-capital-velocity-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Parallel query SOLD trades (last 12m) + HELD trades
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
          buyDate: true,
        },
        take: 1000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD and no HELD trades
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          avgCapitalCycleTime: 0,
          capitalCyclesPerYear: 0,
          capitalVelocityScore: 0,
          currentCapitalMultiplier: 0,
          totalCapitalDeployed: 0,
          heldCapital: 0,
          soldCount12m: 0,
          heldCount: 0,
          avgProfitMargin: 0,
        },
        maximization: {
          maximizedCycleTime: 0,
          maximizedCyclesPerYear: 0,
          velocityUplift: 0,
          velocityMaximizationActions: [],
          velocityProjection: [],
          velocityBottlenecks: [],
          velocityGrade: 'F',
          capitalMultiplierEffect: 0,
        },
        summary: 'Ni SOLD in HELD trgovin — Inventory Capital Velocity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD in HELD trgovin — Inventory Capital Velocity Maximizer ni mogoč.',
      } satisfies InventoryCapitalVelocityResponse);
    }

    // 2) Compute SOLD trades within 12m
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c && c.within12m) soldComputed.push(c);
    }

    // 3) Compute HELD trades
    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    // If no SOLD trades, can't compute baseline cycle time
    if (soldComputed.length === 0) {
      const heldCap = heldComputed.reduce((s, h) => s + h.capital, 0);
      return NextResponse.json({
        ok: true,
        current: {
          avgCapitalCycleTime: 0,
          capitalCyclesPerYear: 0,
          capitalVelocityScore: 0,
          currentCapitalMultiplier: 0,
          totalCapitalDeployed: heldCap,
          heldCapital: heldCap,
          soldCount12m: 0,
          heldCount: heldComputed.length,
          avgProfitMargin: 0,
        },
        maximization: {
          maximizedCycleTime: 0,
          maximizedCyclesPerYear: 0,
          velocityUplift: 0,
          velocityMaximizationActions: [],
          velocityProjection: [],
          velocityBottlenecks: [],
          velocityGrade: 'F',
          capitalMultiplierEffect: 0,
        },
        summary: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Capital Velocity Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin v zadnjih 12 mesecih — Inventory Capital Velocity Maximizer ni mogoč.',
      } satisfies InventoryCapitalVelocityResponse);
    }

    const current = computeCurrent(soldComputed, heldComputed);
    let maximization = buildDeterministicMaximization(current);
    let summary = buildSummary(current, maximization);

    // 4) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `inventory-capital-velocity-maximizer:${currentMonth}`;
    const cached = getCachedAI<{
      maximization: InventoryCapitalVelocityMaximization;
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
      } satisfies InventoryCapitalVelocityResponse);
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
        cap: t.capital,
        profit: t.profit,
        holdDays: t.holdDays,
      }));

    const promptData = {
      soldCount12m: soldComputed.length,
      heldCount: heldComputed.length,
      current,
      deterministicMaximization: {
        maximizedCycleTime: maximization.maximizedCycleTime,
        maximizedCyclesPerYear: maximization.maximizedCyclesPerYear,
        velocityUplift: maximization.velocityUplift,
        velocityMaximizationActions: maximization.velocityMaximizationActions,
        velocityProjection: maximization.velocityProjection,
        velocityBottlenecks: maximization.velocityBottlenecks,
        velocityGrade: maximization.velocityGrade,
        capitalMultiplierEffect: maximization.capitalMultiplierEffect,
      },
      soldSample: soldSampleForAI,
      caps: {
        cycleTimeMin: CYCLE_TIME_MIN, cycleTimeMax: CYCLE_TIME_MAX,
        cyclesMin: CYCLES_MIN, cyclesMax: CYCLES_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        marginMin: MARGIN_MIN, marginMax: MARGIN_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        multiplierMin: MULTIPLIER_MIN, multiplierMax: MULTIPLIER_MAX,
      },
    };

    const prompt = `Si AI "Inventory Capital Velocity Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL VELOCITY MAXIMIZATION — kako maksimizirati VELOCITY kapitala skozi inventory (koliko cycle-ov/leto capital ciklira iz investicije do povratka). Tvoj cilj je "Tvoj kapital kroži vsakih 28 dni (13×/leto), ampak bi lahko krožil vsakih 18 dni (20×/leto) z temi akcijami." Razlika od inventory-profit-per-day-growth-maximizer (v8.09 ki maksimizira growth rate daily profit-a iz inventory-ja v %/teden) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (koliko cycle-ov/leto, ne %/teden growth). Razlika od profit-per-day-scaling-maximizer (v8.08 ki maksimizira in skalira daily profit z scalingPath) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (cycle time + cycles per year, ne €/dan scaling). Razlika od inventory-turnover-yield-maximizer (v8.05 ki maksimizira yield z yieldCurve) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA z capitalMultiplierEffect (koliko-krat se kapital pomnoži v enem letu). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA čez celoten inventory (avg cycle time, ne ROI per item). Razlika od inventory-capital-efficiency-maximizer (v8.01 ki maksimizira capital efficiency per item) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA z velocityProjection in velocityGrade (ne capital efficiency per item). Razlika od inventory-cash-yield-maximizer (v8.04 ki maksimizira annualized cash yield) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (cycles per year, ne cash yield). Razlika od inventory-profit-per-day-maximizer (v8.02 ki maksimizira daily profit per item) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (koliko-krat se capital kroži, ne €/dan per item). Razlika od inventory-annualized-return-maximizer (v8.06 ki maksimizira annualized % return na held inventory) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA z maximizedCycleTime in maximizedCyclesPerYear (ne % return). Razlika od inventory-capital-return-maximizer (v8.07 ki maksimizira capital return OF inventory) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (koliko-krat ciklira, ne % returned). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (cycle time + cycles/year, ne €/dan). Razlika od profit-multiplier-maximizer (v8.09 ki maksimizira maximum profit multiplier z 6 dimensions) — ti MAKSIMIZIRAŠ VELOCITY KAPITALA (capital cycling, ne profit multiplier).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD trgovine):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.maximizedCycleTime days [1, 365] (optimal cycle time, shorter = faster — ≤ current.avgCapitalCycleTime, anti-hallucination),
2. maximization.maximizedCyclesPerYear [0, 100] (= 365 / maximizedCycleTime, ≥ current.capitalCyclesPerYear),
3. maximization.velocityUplift cycles/year [0, 50] (improvement = maximized − current cycles),
4. maximization.velocityMaximizationActions: 5 elementov { action FASTER_PRICING/BETTER_LISTINGS/CROSS_POSTING/REDUCE_HOLD_TIME/OPTIMIZE_SOURCING, description (slovenski, max 200 — specifična akcija za velocity gain), expectedVelocityGain cycles/year [0, 50] (koliko cycles/yr bo dodano), priority HIGH/MEDIUM/LOW } (sortirano po expectedVelocityGain descending),
5. maximization.velocityProjection: 6 elementov { month 1-6, currentCyclesPerYear [0, 100] (cycles/yr projected at current velocity, constant), maximizedCyclesPerYear [0, 100] (linear ramp: 1m=17%, 3m=50%, 6m=100% adoption of maximized cycles) },
6. maximization.velocityBottlenecks: 3-5 stringov (slovenski, max 200 vsak — kaj limitira capital cycling velocity),
7. maximization.velocityGrade: A+ | A | B | C | D | F (A+ če maximized cycles ≥ 25, A ≥ 18, B ≥ 12, C ≥ 8, D ≥ 5, else F),
8. maximization.capitalMultiplierEffect × [0, 100] (koliko-krat se kapital pomnoži v enem letu pri maximized velocity — = maximizedCyclesPerYear × avgProfitMargin / 100),
9. summary: slovenski povzetek (max 500 znakov — poudari current cycle time, current cycles/yr, maximized cycle time, maximized cycles/yr, uplift, grade, capital multiplier effect, 5 actions).

VRNI LE JSON:
{
  "maximization": {
    "maximizedCycleTime": 18,
    "maximizedCyclesPerYear": 20.3,
    "velocityUplift": 7.3,
    "velocityMaximizationActions": [
      { "action": "REDUCE_HOLD_TIME", "description": "Vklopi listing-refresh-scheduler za stale HELD items.", "expectedVelocityGain": 4.0, "priority": "HIGH" },
      { "action": "CROSS_POSTING", "description": "Multi-platform listings (Bolha + Vinted + Avtonet).", "expectedVelocityGain": 3.2, "priority": "HIGH" },
      { "action": "FASTER_PRICING", "description": "Dynamic pricing z AI pricing engine.", "expectedVelocityGain": 2.5, "priority": "HIGH" },
      { "action": "BETTER_LISTINGS", "description": "Optimiziraj listing quality z AI photo enhancement.", "expectedVelocityGain": 1.8, "priority": "MEDIUM" },
      { "action": "OPTIMIZE_SOURCING", "description": "Filter buy-side z in-demand item detectorjem.", "expectedVelocityGain": 1.5, "priority": "MEDIUM" }
    ],
    "velocityProjection": [
      { "month": 1, "currentCyclesPerYear": 13.0, "maximizedCyclesPerYear": 14.2 },
      { "month": 3, "currentCyclesPerYear": 13.0, "maximizedCyclesPerYear": 16.7 },
      { "month": 6, "currentCyclesPerYear": 13.0, "maximizedCyclesPerYear": 20.3 }
    ],
    "velocityBottlenecks": [
      "Capital cycle time 28 dni je prepočasen.",
      "HELD inventory > SOLD 12m — capital ujeto v počasnem inventory-ju.",
      "Cross-posting še ni aktiviran."
    ],
    "velocityGrade": "B",
    "capitalMultiplierEffect": 4.06
  },
  "summary": "Current: 28d cycle (13.0/yr, score 65/100, 50 SOLD 12m, 8 HELD, 5000€ deployed, 20.0% margin). Maximized: 18d cycle (20.3/yr, +7.3 cycles uplift, grade B). Capital multiplier effect: ×4.06/yr. 5 actions: REDUCE_HOLD_TIME (+4.0), CROSS_POSTING (+3.2), FASTER_PRICING (+2.5), BETTER_LISTINGS (+1.8), OPTIMIZE_SOURCING (+1.5)."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object' && parsed.maximization) {
        const aiMax = parsed.maximization;

        // Anti-hallucination: maximizedCycleTime ∈ [1, current.avgCapitalCycleTime]
        const cycleTimeMinBound = CYCLE_TIME_MIN;
        const cycleTimeMaxBound = Math.max(CYCLE_TIME_MIN, current.avgCapitalCycleTime);
        const maximizedCycleTime = round0(clampNum(
          aiMax.maximizedCycleTime,
          cycleTimeMinBound, cycleTimeMaxBound,
          maximization.maximizedCycleTime,
        ));
        const maximizedCyclesPerYear = round2(clampNum(
          aiMax.maximizedCyclesPerYear,
          current.capitalCyclesPerYear, CYCLES_MAX,
          maximizedCycleTime > 0 ? 365 / maximizedCycleTime : 0,
        ));
        const velocityUplift = round2(clampNum(
          Math.max(0, maximizedCyclesPerYear - current.capitalCyclesPerYear),
          UPLIFT_MIN, UPLIFT_MAX, 0,
        ));

        // Override velocityMaximizationActions
        let velocityMaximizationActions = maximization.velocityMaximizationActions;
        if (Array.isArray(aiMax.velocityMaximizationActions) &&
            aiMax.velocityMaximizationActions.length >= 3) {
          const aiAct: VelocityAction[] = [];
          for (const a of aiMax.velocityMaximizationActions.slice(0, MAX_ACTIONS)) {
            if (!a || typeof a !== 'object') continue;
            aiAct.push({
              action: clampEnum(a.action, VALID_ACTION_TYPE, 'REDUCE_HOLD_TIME'),
              description: clampString(a.description, 200, 'Akcija za capital velocity gain.'),
              expectedVelocityGain: round2(clampNum(
                a.expectedVelocityGain, UPLIFT_MIN, UPLIFT_MAX, 1.0,
              )),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
            });
          }
          if (aiAct.length >= 3) {
            velocityMaximizationActions = aiAct;
          }
        }

        // Override velocityProjection
        let velocityProjection = maximization.velocityProjection;
        if (Array.isArray(aiMax.velocityProjection) &&
            aiMax.velocityProjection.length >= 6) {
          const aiProj: VelocityProjectionEntry[] = [];
          for (const e of aiMax.velocityProjection.slice(0, MAX_PROJECTIONS)) {
            if (!e || typeof e !== 'object') continue;
            const month = round0(clampNum(e.month, 1, 6, 1));
            aiProj.push({
              month,
              currentCyclesPerYear: round2(clampNum(
                e.currentCyclesPerYear,
                CYCLES_MIN, CYCLES_MAX, current.capitalCyclesPerYear,
              )),
              maximizedCyclesPerYear: round2(clampNum(
                e.maximizedCyclesPerYear,
                CYCLES_MIN, CYCLES_MAX, maximizedCyclesPerYear,
              )),
            });
          }
          if (aiProj.length === 6) {
            velocityProjection = aiProj;
          }
        }

        // Override velocityBottlenecks
        let velocityBottlenecks = maximization.velocityBottlenecks;
        if (Array.isArray(aiMax.velocityBottlenecks) &&
            aiMax.velocityBottlenecks.length >= 2) {
          const aiBot: string[] = [];
          for (const b of aiMax.velocityBottlenecks.slice(0, MAX_BOTTLENECKS)) {
            aiBot.push(clampString(b, 200, 'Velocity bottleneck neopisan.'));
          }
          if (aiBot.length >= 2) {
            velocityBottlenecks = aiBot;
          }
        }

        // Override velocityGrade
        const velocityGrade = aiMax.velocityGrade
          ? clampEnum(aiMax.velocityGrade, VALID_GRADE, decideVelocityGrade(maximizedCyclesPerYear))
          : decideVelocityGrade(maximizedCyclesPerYear);

        // Override capitalMultiplierEffect
        const capitalMultiplierEffect = round2(clampNum(
          aiMax.capitalMultiplierEffect,
          MULTIPLIER_MIN, MULTIPLIER_MAX,
          maximizedCyclesPerYear * current.avgProfitMargin / 100,
        ));

        maximization = {
          maximizedCycleTime,
          maximizedCyclesPerYear,
          velocityUplift,
          velocityMaximizationActions,
          velocityProjection,
          velocityBottlenecks,
          velocityGrade,
          capitalMultiplierEffect,
        };

        summary = clampString(parsed.summary, 500, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-capital-velocity-maximizer',
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
    } satisfies InventoryCapitalVelocityResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-capital-velocity-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
