// v8.00: AI Profit Multiplier Engine — AI identificira VSE možne načine za
// MULTIPLICIRATI profit z enim samim unified multiplication engine-om. Kombinira
// 8 profit levers (pricing, timing, volume, sourcing, efficiency, channel,
// bundling, refurb) v en cumulativni multiplier. "Your current monthly profit
// is 2000€. With all multipliers applied, it could be 4800€ (2.4x)."
//
// Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding capital
// growth) — ta MULTIPLICIRA profit z UNIFIED multiplication engine (8 levers v
// en produkt), ne compounding growth rate. Razlika od deal-profit-accelerator-pro
// (v7.99 ki accelera profit per item) — ta daje GLOBAL profit multiplier (ne
// per-item). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI
// per item) — ta maksimizira MULTIPLICATION of monthly profit (ne ROI %).
// Razlika od profit-maximizer-pro (v7.94 ki maksimizira profit z 7 levers) — ta
// KOMBINIRA 8 levers v COMPOUNDING multiplication effect ( produkt vseh
// multiplier-jev). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira
// €/day velocity) — ta maksimizira TOTAL monthly profit multiplication (ne
// velocity). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira profit
// per source) — ta daje UNIFIED multiplication engine (ne per-source). Razlika od
// revenue-stream-optimizer (v7.94 ki optimira revenue streams) — ta maksimizira
// profit MULTIPLICATION z actionable quick wins.
//
// "Current: 2000€/mo, ROI 35%, hold 22 dni, winRate 70%. Multipliers:
// pricing 1.15x (EASY, +300€), timing 1.10x (EASY, +200€), volume 1.30x (MEDIUM,
// +600€), sourcing 1.12x (EASY, +240€), efficiency 1.20x (MEDIUM, +400€),
// channel 1.08x (HARD, +160€), bundle 1.15x (EASY, +300€), refurb 1.18x (MEDIUM,
// +360€). Cumulative: 2.4x → maximized 4800€/mo, +2800€ uplift, grade A.
// Quick wins: pricing, timing, sourcing, bundle (EASY + high impact).
// Projection 3m: 7800€, 6m: 15600€, 12m: 31200€."

// GET+POST /api/ai/profit-multiplier-engine
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

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type MultiplicationGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
  } | null;
}

interface Baseline {
  currentMonthlyProfit: number;
  currentAvgROI: number;
  currentAvgHoldDays: number;
  currentWinRate: number;
}

interface MultiplierEntry {
  lever: string;
  currentGap: number;
  potentialMultiplier: number;
  difficulty: Difficulty;
  expectedProfitGain: number;
  actions: string[];
}

interface QuickWin {
  lever: string;
  multiplier: number;
  action: string;
}

interface ProjectionEntry {
  month: number;
  currentProfit: number;
  multipliedProfit: number;
}

interface PrioritizedAction {
  action: string;
  multiplier: string;
  priority: Priority;
  expectedGain: number;
}

interface Engine {
  cumulativeMultiplier: number;
  maximizedMonthlyProfit: number;
  totalProfitUplift: number;
  multiplicationGrade: MultiplicationGrade;
  quickWins: QuickWin[];
  multiplicationProjection: ProjectionEntry[];
  prioritizedActions: PrioritizedAction[];
}

interface ProfitMultiplierResponse {
  ok: true;
  baseline: Baseline;
  multipliers: MultiplierEntry[];
  engine: Engine;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  multipliers?: Array<{
    lever?: string;
    currentGap?: number;
    potentialMultiplier?: number;
    difficulty?: Difficulty;
    actions?: string[];
  }>;
  engine?: {
    multiplicationGrade?: MultiplicationGrade;
    prioritizedActions?: Array<{
      action?: string;
      multiplier?: string;
      priority?: Priority;
      expectedGain?: number;
    }>;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;
const THREE_MONTHS_MS = 90 * DAY_MS;

const PROFIT_MIN = 0;
const PROFIT_MAX = 100_000; // 100k ceiling per month
const MULT_MIN = 1.0;
const MULT_MAX = 3.0;
const GAP_MIN = 0;
const GAP_MAX = 100;
const GAIN_MIN = 0;
const GAIN_MAX = 50_000;
const ROI_MIN = -100;
const ROI_MAX = 500;
const WINRATE_MIN = 0;
const WINRATE_MAX = 100;
const HOLDDAYS_MIN = 0;
const HOLDDAYS_MAX = 730;
const MAX_ACTIONS_PER_LEVER = 4;
const MONTHS_PROJECTION = 12; // 12-month projection

const VALID_DIFFICULTY: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const VALID_PRIORITY: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_GRADE: readonly MultiplicationGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const DEFAULT_BASELINE_PROFIT = 100; // €/mo fallback baseline (anti-hallucination)

// 8 profit levers
const LEVERS = [
  'pricing',
  'timing',
  'volume',
  'sourcing',
  'efficiency',
  'channel',
  'bundle',
  'refurb',
] as const;
type LeverKey = (typeof LEVERS)[number];

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

interface SoldTradeComputed {
  profit: number;
  cost: number;
  roi: number; // %
  holdDays: number;
  sellMs: number;
  within3m: boolean;
  within12m: boolean;
  isWin: boolean;
}

function computeSoldTrade(t: SoldTradeRow, now: number): SoldTradeComputed | null {
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
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  const within3m = (now - sellMs) <= THREE_MONTHS_MS;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return {
    profit,
    cost,
    roi,
    holdDays,
    sellMs,
    within3m,
    within12m,
    isWin: profit > 0,
  };
}

interface SoldAgg {
  profit3m: number;
  count3m: number;
  profit12m: number;
  count12m: number;
  totalRoi: number;
  totalHoldDays: number;
  winCount12m: number;
}

function aggregateSold(trades: SoldTradeComputed[]): SoldAgg {
  let profit3m = 0;
  let count3m = 0;
  let profit12m = 0;
  let count12m = 0;
  let totalRoi = 0;
  let totalHoldDays = 0;
  let winCount12m = 0;
  for (const t of trades) {
    if (t.within3m) {
      profit3m += t.profit;
      count3m += 1;
    }
    if (t.within12m) {
      profit12m += t.profit;
      count12m += 1;
      totalRoi += t.roi;
      totalHoldDays += t.holdDays;
      if (t.isWin) winCount12m += 1;
    }
  }
  return {
    profit3m,
    count3m,
    profit12m,
    count12m,
    totalRoi,
    totalHoldDays,
    winCount12m,
  };
}

function computeBaseline(agg: SoldAgg, heldCount: number): Baseline {
  // currentMonthlyProfit = avg monthly profit last 3 months (profit3m / 3)
  // If no 3m data, fall back to 12m avg
  let currentMonthlyProfit: number;
  if (agg.count3m > 0) {
    currentMonthlyProfit = agg.profit3m / 3;
  } else if (agg.count12m > 0) {
    currentMonthlyProfit = agg.profit12m / 12;
  } else {
    currentMonthlyProfit = 0;
  }
  currentMonthlyProfit = round0(clampNum(
    currentMonthlyProfit, PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const currentAvgROI = round2(clampNum(
    agg.count12m > 0 ? agg.totalRoi / agg.count12m : 0,
    ROI_MIN, ROI_MAX, 0,
  ));

  const currentAvgHoldDays = round0(clampNum(
    agg.count12m > 0 ? agg.totalHoldDays / agg.count12m : 0,
    HOLDDAYS_MIN, HOLDDAYS_MAX, 0,
  ));

  const currentWinRate = round0(clampNum(
    agg.count12m > 0 ? (agg.winCount12m / agg.count12m) * 100 : 0,
    WINRATE_MIN, WINRATE_MAX, 0,
  ));

  return {
    currentMonthlyProfit,
    currentAvgROI,
    currentAvgHoldDays,
    currentWinRate,
  };
}

interface LeverSpec {
  lever: string;
  currentGap: number;
  potentialMultiplier: number;
  difficulty: Difficulty;
  actions: string[];
}

function buildLeverSpec(
  key: LeverKey,
  baseline: Baseline,
  agg: SoldAgg,
  heldCount: number,
): LeverSpec {
  switch (key) {
    case 'pricing': {
      // Gap: 100 - winRate (low winRate → pricing issue)
      const gap = round0(clampNum(
        Math.max(0, 100 - baseline.currentWinRate),
        GAP_MIN, GAP_MAX, 30,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.5,
        MULT_MIN, MULT_MAX, 1.1,
      ));
      const difficulty: Difficulty = baseline.currentAvgROI < 20 ? 'EASY' : 'MEDIUM';
      return {
        lever: 'Pricing',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Optimiraj prodajne cene glede na tržno povprečje (Bolha + Vinted + Avtonet primerjava).',
          'Postavi ceno 5-10% nad P50 za premium pozicioniranje pri high-dealScore itemih.',
          'Dodaj "limited time offer" za urgency pri počasnih listing-ih.',
        ],
      };
    }
    case 'timing': {
      // Gap: based on holdDays (longer hold → more timing room)
      const gap = round0(clampNum(
        Math.min(100, baseline.currentAvgHoldDays * 1.5),
        GAP_MIN, GAP_MAX, 25,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.4,
        MULT_MIN, MULT_MAX, 1.1,
      ));
      const difficulty: Difficulty = baseline.currentAvgHoldDays > 35 ? 'MEDIUM' : 'EASY';
      return {
        lever: 'Timing',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Postavi listing v weekend peak time (petek 18-20h) za max visibility.',
          'Premakni sezonske item-e v pravo obdobje (zimske gume pozimi, kopalke poleti).',
          'Osveži listing datum tedensko za vrh search-a.',
        ],
      };
    }
    case 'volume': {
      // Gap: based on trade count (low volume → high gap)
      const targetTrades = 24; // 24 trades/3m = 8/mo target
      const gap = round0(clampNum(
        Math.max(0, Math.min(100, ((targetTrades - agg.count3m) / targetTrades) * 100)),
        GAP_MIN, GAP_MAX, 50,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.8,
        MULT_MIN, MULT_MAX, 1.3,
      ));
      const difficulty: Difficulty = agg.count3m < 8 ? 'MEDIUM' : 'HARD';
      return {
        lever: 'Volume',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Povečaj sourcing aktivnost za 50% (več deal-ov v pipeline-u).',
          'Avtomatiziraj monitor alert-e za hitrejše odzivanje na nove listinge.',
          'Batch sourcing ob vikendih za višji volume.',
        ],
      };
    }
    case 'sourcing': {
      // Gap: based on ROI (low ROI → sourcing issue)
      const gap = round0(clampNum(
        Math.max(0, Math.min(100, 60 - baseline.currentAvgROI)),
        GAP_MIN, GAP_MAX, 30,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.4,
        MULT_MIN, MULT_MAX, 1.1,
      ));
      const difficulty: Difficulty = baseline.currentAvgROI < 30 ? 'EASY' : 'MEDIUM';
      return {
        lever: 'Sourcing',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Ciljaj nižje nabavne cene (negotiate -10% pri buy-ih nad 100€).',
          'Dodaj nove source platforme (mobile.de, Kleinanzeigen) za boljše pogoje.',
          'Filter: dealScore ≥ 70 samo — izpusti nizko-kvalitetne deal-e.',
        ],
      };
    }
    case 'efficiency': {
      // Gap: based on holdDays (longer hold → efficiency room)
      const gap = round0(clampNum(
        Math.min(100, baseline.currentAvgHoldDays * 1.8),
        GAP_MIN, GAP_MAX, 30,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.5,
        MULT_MIN, MULT_MAX, 1.2,
      ));
      const difficulty: Difficulty = baseline.currentAvgHoldDays > 30 ? 'MEDIUM' : 'HARD';
      return {
        lever: 'Efficiency',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Skrajšaj hold time z agresivno pricing strategy pri stagnantnih itemih (>30 dni).',
          'Auto-discount -5% po 14 dneh, -10% po 30 dneh za hitrejši turnover.',
          'Bundle stagnant iteme za hitrejšo prodajo.',
        ],
      };
    }
    case 'channel': {
      // Gap: based on # of unique sources used (1 source → max room)
      // Without monitor data in sold trades, assume moderate gap (35)
      const gap = round0(clampNum(35, GAP_MIN, GAP_MAX, 35));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.3,
        MULT_MIN, MULT_MAX, 1.1,
      ));
      const difficulty: Difficulty = 'HARD';
      return {
        lever: 'Channel',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Cross-post item-e na 3+ platforme (Bolha + Vinted + Facebook Marketplace).',
          'Prilagodi naslov/SEO za vsako platformo posebej.',
          'Postavi premium ceno (+5-10%) na premium platformah (Vinted, Avtonet).',
        ],
      };
    }
    case 'bundle': {
      // Gap: based on held inventory size (more held → more bundle opps)
      const gap = round0(clampNum(
        Math.min(100, heldCount * 8),
        GAP_MIN, GAP_MAX, 25,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.4,
        MULT_MIN, MULT_MAX, 1.15,
      ));
      const difficulty: Difficulty = 'EASY';
      return {
        lever: 'Bundle',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Identificiraj komplementarne item-e v inventoriju za bundle (iPhone + case + cable).',
          'Ustvari bundle listing z 10-15% popustom za urgency.',
          'Promoviraj bundle v opisu vsakega individualnega item-a.',
        ],
      };
    }
    case 'refurb': {
      // Gap: based on avg ROI (low ROI → refurb headroom to add value)
      const gap = round0(clampNum(
        Math.max(0, Math.min(100, 50 - baseline.currentAvgROI * 0.5)),
        GAP_MIN, GAP_MAX, 20,
      ));
      const mult = round2(clampNum(
        1 + (gap / 100) * 0.4,
        MULT_MIN, MULT_MAX, 1.15,
      ));
      const difficulty: Difficulty = 'MEDIUM';
      return {
        lever: 'Refurb',
        currentGap: gap,
        potentialMultiplier: mult,
        difficulty,
        actions: [
          'Očisti in restavriraj item-e (1-2 uri dela) za premium perception.',
          'Naredi nove foto z boljšo osvetlitvijo za +15% konverzijo.',
          'Posodobi opis z "restored / like-new" angle za premium cena.',
        ],
      };
    }
    default: {
      return {
        lever: key,
        currentGap: 0,
        potentialMultiplier: 1,
        difficulty: 'MEDIUM',
        actions: [],
      };
    }
  }
}

function buildMultipliers(
  baseline: Baseline,
  agg: SoldAgg,
  heldCount: number,
): MultiplierEntry[] {
  const entries: MultiplierEntry[] = [];
  for (const key of LEVERS) {
    const spec = buildLeverSpec(key, baseline, agg, heldCount);
    const expectedProfitGain = round0(clampNum(
      baseline.currentMonthlyProfit * (spec.potentialMultiplier - 1),
      GAIN_MIN, GAIN_MAX, 0,
    ));
    const actions = spec.actions
      .slice(0, MAX_ACTIONS_PER_LEVER)
      .map((s) => clampString(s, 200, 'Akcija.'));
    entries.push({
      lever: spec.lever,
      currentGap: spec.currentGap,
      potentialMultiplier: spec.potentialMultiplier,
      difficulty: spec.difficulty,
      expectedProfitGain,
      actions,
    });
  }
  return entries;
}

function decideGrade(cumulative: number): MultiplicationGrade {
  // cumulativeMultiplier [1.0, 3.0]
  // A+ if >= 2.5, A if >= 2.0, B if >= 1.6, C if >= 1.3, D if >= 1.1, else F
  if (cumulative >= 2.5) return 'A+';
  if (cumulative >= 2.0) return 'A';
  if (cumulative >= 1.6) return 'B';
  if (cumulative >= 1.3) return 'C';
  if (cumulative >= 1.1) return 'D';
  return 'F';
}

function buildEngine(
  baseline: Baseline,
  multipliers: MultiplierEntry[],
): Engine {
  // Cumulative multiplier = product of all multipliers (compounding effect)
  // Anti-hallucination: clamp to [1.0, 3.0]
  let product = 1;
  for (const m of multipliers) {
    product *= m.potentialMultiplier;
  }
  const cumulativeMultiplier = round2(clampNum(
    product, MULT_MIN, MULT_MAX, 1,
  ));

  const maximizedMonthlyProfit = round0(clampNum(
    baseline.currentMonthlyProfit * cumulativeMultiplier,
    PROFIT_MIN, PROFIT_MAX, baseline.currentMonthlyProfit,
  ));

  const totalProfitUplift = round0(clampNum(
    maximizedMonthlyProfit - baseline.currentMonthlyProfit,
    PROFIT_MIN, PROFIT_MAX, 0,
  ));

  const multiplicationGrade = decideGrade(cumulativeMultiplier);

  // Quick wins: multipliers with EASY difficulty + high impact (top 4)
  const quickWins: QuickWin[] = multipliers
    .filter((m) => m.difficulty === 'EASY')
    .sort((a, b) => b.expectedProfitGain - a.expectedProfitGain)
    .slice(0, 4)
    .map((m) => ({
      lever: clampString(m.lever, 50, m.lever),
      multiplier: m.potentialMultiplier,
      action: clampString(m.actions[0] ?? 'Izvedi akcijo.', 200, 'Akcija.'),
    }));

  // Projection: 3/6/12 month with multipliers applied (use 12 monthly points)
  const projection: ProjectionEntry[] = [];
  for (let month = 1; month <= MONTHS_PROJECTION; month++) {
    const currentProfit = round0(clampNum(
      baseline.currentMonthlyProfit * month, PROFIT_MIN, PROFIT_MAX, 0,
    ));
    const multipliedProfit = round0(clampNum(
      maximizedMonthlyProfit * month, PROFIT_MIN, PROFIT_MAX, 0,
    ));
    projection.push({ month, currentProfit, multipliedProfit });
  }

  // Prioritized actions: all multiplier actions ranked by expected gain
  const prioritizedActions: PrioritizedAction[] = multipliers
    .map((m) => ({
      action: clampString(m.actions[0] ?? `${m.lever} optimization.`, 200, 'Optimiraj.'),
      multiplier: m.lever,
      priority: (m.difficulty === 'EASY' && m.expectedProfitGain > 100
        ? 'HIGH'
        : m.difficulty === 'EASY' || m.expectedProfitGain > 200
          ? 'MEDIUM'
          : 'LOW') as Priority,
      expectedGain: m.expectedProfitGain,
    }))
    .sort((a, b) => {
      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (order[a.priority] !== order[b.priority]) {
        return order[a.priority] - order[b.priority];
      }
      return b.expectedGain - a.expectedGain;
    })
    .slice(0, 10);

  return {
    cumulativeMultiplier,
    maximizedMonthlyProfit,
    totalProfitUplift,
    multiplicationGrade,
    quickWins,
    multiplicationProjection: projection,
    prioritizedActions,
  };
}

function buildSummary(
  baseline: Baseline,
  engine: Engine,
): string {
  const parts: string[] = [
    `Current: ${baseline.currentMonthlyProfit}€/mo (ROI ${baseline.currentAvgROI}%, hold ${baseline.currentAvgHoldDays} dni, winRate ${baseline.currentWinRate}%).`,
    `Multipliers: ${engine.cumulativeMultiplier}x → maximized ${engine.maximizedMonthlyProfit}€/mo (+${engine.totalProfitUplift}€ uplift).`,
    `Grade: ${engine.multiplicationGrade}. Quick wins: ${engine.quickWins.length}.`,
    `12m projection: ${engine.multiplicationProjection[11]?.multipliedProfit ?? 0}€.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleProfitMultiplierEngine(req);
}
export async function POST(req: NextRequest) {
  return handleProfitMultiplierEngine(req);
}

async function handleProfitMultiplierEngine(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-profit-multiplier-engine', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query SOLD trades from last 12 months + HELD trades (parallel)
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
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
            },
          },
        },
        take: 100000,
      }) as unknown as HeldTradeRow[],
    ]);

    // Empty-state: no SOLD trades and no HELD inventory
    if (soldTrades.length === 0 && heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        baseline: {
          currentMonthlyProfit: 0,
          currentAvgROI: 0,
          currentAvgHoldDays: 0,
          currentWinRate: 0,
        },
        multipliers: [],
        engine: {
          cumulativeMultiplier: 1,
          maximizedMonthlyProfit: 0,
          totalProfitUplift: 0,
          multiplicationGrade: 'F',
          quickWins: [],
          multiplicationProjection: [],
          prioritizedActions: [],
        },
        summary: 'Ni SOLD trgovin in HELD inventorija — Profit Multiplier Engine ni mogoč.',
        aiUsed: false,
        message: 'Ni SOLD trgovin in HELD inventorija — Profit Multiplier Engine ni mogoč.',
      } satisfies ProfitMultiplierResponse);
    }

    // 2) Compute sold trade aggregates
    const soldComputed: SoldTradeComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }

    const agg = aggregateSold(soldComputed);
    const baseline = computeBaseline(agg, heldTrades.length);

    // If baseline is 0 but we have data (edge case), apply fallback
    if (baseline.currentMonthlyProfit === 0 && agg.count12m === 0 && heldTrades.length > 0) {
      // Use held inventory as proxy
      let heldValue = 0;
      for (const h of heldTrades) {
        const bp = h.buyPrice ?? 0;
        const est = h.listing?.aiEstimatedValue ?? null;
        const lp = h.listing?.price ?? null;
        const v = est && est > 0 ? est : lp && lp > 0 ? lp : bp * 1.1;
        heldValue += v;
      }
      baseline.currentMonthlyProfit = round0(clampNum(
        heldValue * 0.05, PROFIT_MIN, PROFIT_MAX, DEFAULT_BASELINE_PROFIT,
      ));
    }

    let multipliers = buildMultipliers(baseline, agg, heldTrades.length);
    let engine = buildEngine(baseline, multipliers);
    let summary = buildSummary(baseline, engine);

    // 3) AI cache check (6h TTL) — key by current month
    const currentMonth = new Date(now).toISOString().slice(0, 7); // YYYY-MM
    const cacheKey = `profit-multiplier-engine:${currentMonth}`;
    const cached = getCachedAI<{
      multipliers: MultiplierEntry[];
      engine: Engine;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        baseline,
        multipliers: cached.multipliers,
        engine: cached.engine,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies ProfitMultiplierResponse);
    }

    // 4) AI prompt with grounding
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

    const promptData = {
      soldCount12m: agg.count12m,
      soldCount3m: agg.count3m,
      profit3m: agg.profit3m,
      profit12m: agg.profit12m,
      heldCount: heldTrades.length,
      baseline,
      deterministicMultipliers: multipliers.map((m) => ({
        lever: m.lever,
        currentGap: m.currentGap,
        potentialMultiplier: m.potentialMultiplier,
        difficulty: m.difficulty,
        expectedProfitGain: m.expectedProfitGain,
      })),
      deterministicEngine: {
        cumulativeMultiplier: engine.cumulativeMultiplier,
        maximizedMonthlyProfit: engine.maximizedMonthlyProfit,
        totalProfitUplift: engine.totalProfitUplift,
        multiplicationGrade: engine.multiplicationGrade,
      },
      caps: {
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        multMin: MULT_MIN, multMax: MULT_MAX,
        gapMin: GAP_MIN, gapMax: GAP_MAX,
        gainMin: GAIN_MIN, gainMax: GAIN_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        winrateMin: WINRATE_MIN, winrateMax: WINRATE_MAX,
        holdDaysMin: HOLDDAYS_MIN, holdDaysMax: HOLDDAYS_MAX,
      },
    };

    const prompt = `Si AI "Profit Multiplier Engine" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za PROFIT MULTIPLICATION — identificiraš VSE možne načine za MULTIPLICIRATI profit z enim UNIFIED multiplication engine-om. Kombiniraš 8 profit levers (pricing, timing, volume, sourcing, efficiency, channel, bundle, refurb) v en COMPOUNDING cumulativni multiplier. Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding capital growth) — ti MULTIPLICIRAŠ profit z UNIFIED multiplication engine (8 levers v en produkt), ne compounding growth rate. Razlika od deal-profit-accelerator-pro (v7.99 ki accelera profit per item) — ti daje GLOBAL profit multiplier (ne per-item). Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti maksimiziraš MULTIPLICATION of monthly profit (ne ROI %). Razlika od profit-maximizer-pro (v7.94 ki maksimizira profit z 7 levers) — ti KOMBINIRAŠ 8 levers v COMPOUNDING multiplication effect (produkt vseh multiplier-jev). Razlika od profit-velocity-maximizer (v7.98 ki maksimizira €/day velocity) — ti maksimiziraš TOTAL monthly profit multiplication (ne velocity). Razlika od deal-source-profit-maximizer (v7.97 ki maksimizira profit per source) — ti daje UNIFIED multiplication engine (ne per-source).

DETERMINISTIČNI PODATKI (izračunano iz DB — SOLD trgovin v zadnjih 12 mesecih + HELD inventorij):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. multipliers: za vsak od 8 levers (pricing, timing, volume, sourcing, efficiency, channel, bundle, refurb), daj:
   - lever (string, max 50, MORA biti ena izmed 8 vrednosti),
   - currentGap % [0, 100] (koliko prostora je za izboljšavo),
   - potentialMultiplier [1.0, 3.0] (koliko x profit se lahko poveča — anti-hallucination),
   - difficulty: EASY | MEDIUM | HARD,
   - actions: 2-4 specifične akcije (max 200 znakov vsaka, slovenski).
2. engine.multiplicationGrade: A+ | A | B | C | D | F (A+ če cumulativeMultiplier ≥ 2.5, A ≥ 2.0, B ≥ 1.6, C ≥ 1.3, D ≥ 1.1, else F),
3. engine.prioritizedActions: 5-10 akcij { action (max 200, slovenski), multiplier (lever name), priority HIGH | MEDIUM | LOW, expectedGain € [0, 50000] },
4. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "multipliers": [
    { "lever": "Pricing", "currentGap": 30, "potentialMultiplier": 1.15, "difficulty": "EASY", "actions": ["Optimiraj ceno.", "Dodaj urgency."] },
    { "lever": "Timing", "currentGap": 25, "potentialMultiplier": 1.10, "difficulty": "EASY", "actions": ["Postavi v weekend peak."] },
    { "lever": "Volume", "currentGap": 50, "potentialMultiplier": 1.30, "difficulty": "MEDIUM", "actions": ["Povečaj sourcing."] },
    { "lever": "Sourcing", "currentGap": 30, "potentialMultiplier": 1.12, "difficulty": "EASY", "actions": ["Negotiate nižje cene."] },
    { "lever": "Efficiency", "currentGap": 30, "potentialMultiplier": 1.20, "difficulty": "MEDIUM", "actions": ["Skrajšaj hold time."] },
    { "lever": "Channel", "currentGap": 35, "potentialMultiplier": 1.08, "difficulty": "HARD", "actions": ["Cross-post na 3 platforme."] },
    { "lever": "Bundle", "currentGap": 25, "potentialMultiplier": 1.15, "difficulty": "EASY", "actions": ["Ustvari bundle listing."] },
    { "lever": "Refurb", "currentGap": 20, "potentialMultiplier": 1.18, "difficulty": "MEDIUM", "actions": ["Restavriraj item."] }
  ],
  "engine": {
    "multiplicationGrade": "A",
    "prioritizedActions": [
      { "action": "Optimiraj cene za +5%.", "multiplier": "Pricing", "priority": "HIGH", "expectedGain": 300 },
      { "action": "Povečaj sourcing.", "multiplier": "Volume", "priority": "HIGH", "expectedGain": 600 }
    ]
  },
  "summary": "Current: 2000€/mo. Multipliers: 2.4x → maximized 4800€/mo (+2800€ uplift). Grade A. Quick wins: pricing, timing, sourcing, bundle."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const aiMultipliersMap = new Map<string, NonNullable<AiResponse['multipliers']>[number]>();
        if (Array.isArray(parsed.multipliers)) {
          for (const m of parsed.multipliers) {
            if (m && typeof m === 'object' && typeof m.lever === 'string') {
              // Match by lever name (case-insensitive)
              const key = m.lever.toLowerCase().trim();
              aiMultipliersMap.set(key, m);
            }
          }
        }

        // Build new multipliers: keep deterministic baseline, override with AI where matched
        const newMultipliers: MultiplierEntry[] = [];
        for (const det of multipliers) {
          const key = det.lever.toLowerCase().trim();
          const ai = aiMultipliersMap.get(key);
          if (!ai) {
            newMultipliers.push(det);
            continue;
          }

          const potentialMultiplier = round2(clampNum(
            ai.potentialMultiplier,
            MULT_MIN, MULT_MAX,
            det.potentialMultiplier,
          ));
          const currentGap = round0(clampNum(
            ai.currentGap,
            GAP_MIN, GAP_MAX,
            det.currentGap,
          ));
          const difficulty = clampEnum(
            ai.difficulty,
            VALID_DIFFICULTY,
            det.difficulty,
          );
          const expectedProfitGain = round0(clampNum(
            baseline.currentMonthlyProfit * (potentialMultiplier - 1),
            GAIN_MIN, GAIN_MAX,
            det.expectedProfitGain,
          ));

          // Actions
          const actions: string[] = [];
          if (Array.isArray(ai.actions)) {
            for (const s of ai.actions.slice(0, MAX_ACTIONS_PER_LEVER)) {
              if (typeof s !== 'string') continue;
              actions.push(clampString(s, 200, 'Akcija.'));
            }
          }
          if (actions.length === 0) {
            for (const s of det.actions) actions.push(s);
          }

          newMultipliers.push({
            lever: det.lever,
            currentGap,
            potentialMultiplier,
            difficulty,
            expectedProfitGain,
            actions: actions.slice(0, MAX_ACTIONS_PER_LEVER),
          });
        }

        // If AI provided extra levers we didn't know, ignore (anti-hallucination: only 8 deterministic levers)
        if (newMultipliers.length === 8) {
          multipliers = newMultipliers;
        }

        // Rebuild engine with new multipliers
        engine = buildEngine(baseline, multipliers);

        // Override grade + prioritizedActions if AI provided them
        if (parsed.engine) {
          if (parsed.engine.multiplicationGrade) {
            engine = {
              ...engine,
              multiplicationGrade: clampEnum(
                parsed.engine.multiplicationGrade,
                VALID_GRADE,
                engine.multiplicationGrade,
              ),
            };
          }
          if (Array.isArray(parsed.engine.prioritizedActions)) {
            const aiActions: PrioritizedAction[] = [];
            for (const a of parsed.engine.prioritizedActions.slice(0, 10)) {
              if (!a || typeof a !== 'object') continue;
              aiActions.push({
                action: clampString(a.action, 200, 'Akcija.'),
                multiplier: clampString(a.multiplier, 50, 'Lever'),
                priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
                expectedGain: round0(clampNum(
                  a.expectedGain,
                  GAIN_MIN, GAIN_MAX, 0,
                )),
              });
            }
            if (aiActions.length > 0) {
              engine = {
                ...engine,
                prioritizedActions: aiActions,
              };
            }
          }
        }

        summary = clampString(parsed.summary, 400, buildSummary(baseline, engine));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/profit-multiplier-engine',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { multipliers, engine, summary });
    }

    return NextResponse.json({
      ok: true,
      baseline,
      multipliers,
      engine,
      summary,
      aiUsed,
    } satisfies ProfitMultiplierResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/profit-multiplier-engine',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
