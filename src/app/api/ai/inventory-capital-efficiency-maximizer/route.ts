// v8.01: AI Inventory Capital Efficiency Maximizer — AI MAXIMIZIRA CAPITAL
// EFFICIENCY — kako eficientno vsak evro kapitala deluje. Identificira kapital
// ujet v low-efficiency item-ih in priporoča reallokacijo v high-efficiency
// priložnosti. "Your capital efficiency is 1.8x, but could be 3.2x if you
// shift 1500€ from slow items to fast-moving categories."
//
// Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding
// capital growth) — ta MAXIMIZIRA capital efficiency (kapital deployment
// efficiency per item, ne compounding growth rate). Razlika od capital-
// allocation-optimizer (ki alokira kapital po kategorijah) — ta daje PER-ITEM
// capital efficiency analizo + reallocation plan iz low → high efficiency
// items. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI
// per item) — ta maksimizira CAPITAL EFFICIENCY (value multiplier +
// profitPerEuroDeployed + efficiencyLossPerDay), ne samo ROI %. Razlika od
// inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion)
// — ta maksimizira CAPITAL VELOCITY preko reallocation, ne cash conversion
// speed. Razlika od deal-profit-accelerator-pro (v7.99 ki accelera profit
// per item) — ta daje CAPITAL REALLOCATION plan iz low → high efficiency
// items z efficiencyUplift forecast. Razlika od profit-multiplier-engine
// (v8.00 ki multiplicira profit z 8 levers) — ta fokusira na CAPITAL
// EFFICIENCY per item + reallocation strategy. Razlika od inventory-turnover-
// profit-maximizer (v8.00 ki maksimizira turnover-profit balance) — ta
// maksimizira CAPITAL DEPLOYMENT efficiency (koliko evrov je ujetih v
// low-return itemih in kako jih prestaviti v high-return).
//
// "Current: 8,500€ deployed, portfolio efficiency 1.8x (1€ → 1.8€ value),
// avg profit/euro 0.45€, avg trapped 32 days, score 62/100 (grade C). Item
// analysis: iPhone 13 2.4x (high), PS5 1.5x (medium), old TV 0.8x (LOW —
// trapped 65d). Maximization: liquidate TV + 2 other low items (1500€ freed),
// reinvest in electronics (high velocity, 2.8x projected). Projected
// efficiency 3.2x (+1.4 uplift), expected profit uplift 680€. Grade B → A.
// Capital velocity: cycle cash every 18d instead of 32d."

// GET+POST /api/ai/inventory-capital-efficiency-maximizer
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

type EfficiencyGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface HeldTradeRow {
  id: string;
  title: string;
  category: string | null;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
  } | null;
}

interface SoldTradeRow {
  id: string;
  buyPrice: number;
  buyFees: number;
  buyDate: Date | null;
  sellPrice: number | null;
  sellFees: number;
  sellDate: Date | null;
  category: string | null;
}

interface CurrentState {
  totalCapitalDeployed: number;
  portfolioCapitalEfficiency: number;
  avgProfitPerEuroDeployed: number;
  avgCapitalTrappedDuration: number;
  portfolioEfficiencyScore: number;
}

interface PerItemEfficiency {
  tradeId: string;
  title: string;
  capitalDeployed: number;
  capitalEfficiency: number;
  profitPerEuroDeployed: number;
  efficiencyScore: number;
  capitalTrappedDuration: number;
  efficiencyLossPerDay: number;
}

interface LowEfficiencyItem {
  tradeId: string;
  title: string;
  efficiencyScore: number;
  recommendedAction: string;
}

interface HighEfficiencyOpportunity {
  category: string;
  expectedEfficiency: number;
  expectedROI: number;
}

interface CapitalReallocation {
  fromTradeId: string;
  toCategory: string;
  amount: number;
  reasoning: string;
}

interface Maximization {
  lowEfficiencyItems: LowEfficiencyItem[];
  highEfficiencyOpportunities: HighEfficiencyOpportunity[];
  capitalReallocationPlan: CapitalReallocation[];
  projectedEfficiency: number;
  efficiencyUplift: number;
  capitalVelocityOptimization: string;
  efficiencyGrade: EfficiencyGrade;
  totalCapitalToReallocate: number;
  expectedProfitUplift: number;
}

interface CapitalEfficiencyResponse {
  ok: true;
  current: CurrentState;
  perItem: PerItemEfficiency[];
  maximization: Maximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  lowEfficiencyItems?: Array<{
    tradeId?: string;
    recommendedAction?: string;
  }>;
  highEfficiencyOpportunities?: Array<{
    category?: string;
    expectedEfficiency?: number;
    expectedROI?: number;
  }>;
  capitalReallocationPlan?: Array<{
    fromTradeId?: string;
    toCategory?: string;
    amount?: number;
    reasoning?: string;
  }>;
  capitalVelocityOptimization?: string;
  efficiencyGrade?: EfficiencyGrade;
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const TWELVE_MONTHS_MS = 365 * DAY_MS;

const CAPITAL_MIN = 0;
const CAPITAL_MAX = 100_000;
const EFFICIENCY_MIN = 0;
const EFFICIENCY_MAX = 10; // 0 to 10x
const PROFIT_PER_EURO_MIN = -2;
const PROFIT_PER_EURO_MAX = 5; // -200% to +500%
const SCORE_MIN = 0;
const SCORE_MAX = 100;
const DAYS_MIN = 0;
const DAYS_MAX = 730; // 2 years
const LOSS_PER_DAY_MIN = 0;
const LOSS_PER_DAY_MAX = 5; // % per day
const UPLIFT_MIN = 0;
const UPLIFT_MAX = 10;
const PROFIT_UPLIFT_MIN = 0;
const PROFIT_UPLIFT_MAX = 50_000;
const FEE_PCT = 0.05;

const VALID_GRADE: readonly EfficiencyGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

const MAX_ITEMS_TO_PROCESS = 40;
const MAX_LOW_EFFICIENCY = 8;
const MAX_HIGH_OPPORTUNITIES = 5;
const MAX_REALLOCATIONS = 8;

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

function round4(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10000) / 10000;
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

interface HeldComputed {
  tradeId: string;
  title: string;
  category: string;
  capitalDeployed: number; // buyPrice + buyFees
  estValue: number;
  daysHeld: number;
  profit: number; // estValue - cost - 5% fees
  capitalEfficiency: number; // estValue / capitalDeployed
  profitPerEuroDeployed: number; // profit / capitalDeployed
}

function computeHeldTrade(t: HeldTradeRow, now: number): HeldComputed | null {
  const buyPrice = t.buyPrice ?? 0;
  const buyFees = t.buyFees ?? 0;
  if (buyPrice <= 0) return null;
  const capitalDeployed = buyPrice + buyFees;
  const aiEst = t.listing?.aiEstimatedValue ?? null;
  const lp = t.listing?.price ?? null;
  let estValue: number;
  if (aiEst && aiEst > 0) {
    estValue = aiEst;
  } else if (lp && lp > 0) {
    estValue = lp;
  } else {
    estValue = buyPrice * 1.1;
  }
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;
  const profit = estValue - capitalDeployed - (estValue * FEE_PCT);
  const capitalEfficiency = capitalDeployed > 0 ? estValue / capitalDeployed : 0;
  const profitPerEuroDeployed = capitalDeployed > 0 ? profit / capitalDeployed : 0;
  return {
    tradeId: t.id,
    title: t.title || 'Untitled',
    category: t.category || 'Unknown',
    capitalDeployed,
    estValue,
    daysHeld,
    profit,
    capitalEfficiency,
    profitPerEuroDeployed,
  };
}

interface SoldComputed {
  roi: number; // %
  holdDays: number;
  within12m: boolean;
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
  const roi = cost > 0 ? (profit / cost) * 100 : 0;
  const within12m = (now - sellMs) <= TWELVE_MONTHS_MS;
  return { roi, holdDays, within12m };
}

interface SoldAgg {
  avgROI: number;
  avgHoldDays: number;
  count12m: number;
}

function aggregateSold(trades: SoldComputed[]): SoldAgg {
  let totalROI = 0;
  let totalHoldDays = 0;
  let count12m = 0;
  for (const t of trades) {
    if (t.within12m) {
      totalROI += t.roi;
      totalHoldDays += t.holdDays;
      count12m += 1;
    }
  }
  return {
    avgROI: count12m > 0 ? totalROI / count12m : 0,
    avgHoldDays: count12m > 0 ? totalHoldDays / count12m : 0,
    count12m,
  };
}

// Efficiency score: 0-100 based on ROI × turnover speed
function computeEfficiencyScore(
  capitalEfficiency: number,
  profitPerEuroDeployed: number,
  daysHeld: number,
  soldAgg: SoldAgg,
): number {
  // Components:
  // 1. Capital efficiency (0-10) → 0-50 points
  const effScore = clampNum(capitalEfficiency * 5, 0, 50, 0);
  // 2. Profit per euro (0-1 typical) → 0-30 points
  const ppeScore = clampNum(Math.max(0, profitPerEuroDeployed) * 30, 0, 30, 0);
  // 3. Speed — penalize long-held items
  const speedScore = clampNum(20 - (daysHeld / 730) * 20, 0, 20, 0);
  // Bonus: historical ROI from sold trades (if positive)
  const histBonus = soldAgg.avgROI > 30 ? 5 : 0;
  const total = effScore + ppeScore + speedScore + histBonus;
  return round0(clampNum(total, SCORE_MIN, SCORE_MAX, 50));
}

function computePerItem(c: HeldComputed, soldAgg: SoldAgg): PerItemEfficiency {
  const efficiencyScore = computeEfficiencyScore(
    c.capitalEfficiency,
    c.profitPerEuroDeployed,
    c.daysHeld,
    soldAgg,
  );
  // Carrying cost = opportunity cost of trapped capital
  // Assume 1.5% per month opportunity cost
  const monthlyOpportunityCost = c.capitalDeployed * 0.015;
  const dailyOpportunityCost = monthlyOpportunityCost / 30;
  const efficiencyLossPerDay = c.capitalDeployed > 0
    ? (dailyOpportunityCost / c.capitalDeployed) * 100
    : 0;
  return {
    tradeId: c.tradeId,
    title: c.title,
    capitalDeployed: round0(clampNum(c.capitalDeployed, CAPITAL_MIN, CAPITAL_MAX, 0)),
    capitalEfficiency: round2(clampNum(
      c.capitalEfficiency, EFFICIENCY_MIN, EFFICIENCY_MAX, 1,
    )),
    profitPerEuroDeployed: round4(clampNum(
      c.profitPerEuroDeployed, PROFIT_PER_EURO_MIN, PROFIT_PER_EURO_MAX, 0,
    )),
    efficiencyScore,
    capitalTrappedDuration: round0(clampNum(
      c.daysHeld, DAYS_MIN, DAYS_MAX, 0,
    )),
    efficiencyLossPerDay: round4(clampNum(
      efficiencyLossPerDay, LOSS_PER_DAY_MIN, LOSS_PER_DAY_MAX, 0,
    )),
  };
}

function computeCurrent(perItem: PerItemEfficiency[]): CurrentState {
  const totalCapitalDeployed = round0(clampNum(
    perItem.reduce((s, i) => s + i.capitalDeployed, 0),
    CAPITAL_MIN, CAPITAL_MAX, 0,
  ));
  const portfolioCapitalEfficiency = round2(clampNum(
    totalCapitalDeployed > 0
      ? perItem.reduce((s, i) => s + i.capitalEfficiency * i.capitalDeployed, 0) / totalCapitalDeployed
      : 0,
    EFFICIENCY_MIN, EFFICIENCY_MAX, 0,
  ));
  const avgProfitPerEuroDeployed = round4(clampNum(
    totalCapitalDeployed > 0
      ? perItem.reduce((s, i) => s + i.profitPerEuroDeployed * i.capitalDeployed, 0) / totalCapitalDeployed
      : 0,
    PROFIT_PER_EURO_MIN, PROFIT_PER_EURO_MAX, 0,
  ));
  const avgCapitalTrappedDuration = round0(clampNum(
    perItem.length > 0
      ? perItem.reduce((s, i) => s + i.capitalTrappedDuration, 0) / perItem.length
      : 0,
    DAYS_MIN, DAYS_MAX, 0,
  ));
  const portfolioEfficiencyScore = round0(clampNum(
    perItem.length > 0
      ? perItem.reduce((s, i) => s + i.efficiencyScore, 0) / perItem.length
      : 0,
    SCORE_MIN, SCORE_MAX, 0,
  ));
  return {
    totalCapitalDeployed,
    portfolioCapitalEfficiency,
    avgProfitPerEuroDeployed,
    avgCapitalTrappedDuration,
    portfolioEfficiencyScore,
  };
}

function decideGrade(score: number, efficiency: number): EfficiencyGrade {
  // A+ if score ≥ 85 and efficiency ≥ 2.5
  // A if score ≥ 75 and efficiency ≥ 2.0
  // B if score ≥ 60 and efficiency ≥ 1.5
  // C if score ≥ 45 and efficiency ≥ 1.2
  // D if score ≥ 30 and efficiency ≥ 1.0
  // else F
  if (score >= 85 && efficiency >= 2.5) return 'A+';
  if (score >= 75 && efficiency >= 2.0) return 'A';
  if (score >= 60 && efficiency >= 1.5) return 'B';
  if (score >= 45 && efficiency >= 1.2) return 'C';
  if (score >= 30 && efficiency >= 1.0) return 'D';
  return 'F';
}

function buildDeterministicMaximization(
  current: CurrentState,
  perItem: PerItemEfficiency[],
  computed: HeldComputed[],
): Maximization {
  // 1) Low efficiency items: efficiencyScore < 40 → recommend action
  const lowEfficiencyItems: LowEfficiencyItem[] = perItem
    .filter((i) => i.efficiencyScore < 40)
    .sort((a, b) => a.efficiencyScore - b.efficiencyScore)
    .slice(0, MAX_LOW_EFFICIENCY)
    .map((i) => {
      let action = 'LIKVIDIRAJ in preusmeri kapital v high-efficiency kategorijo.';
      if (i.capitalTrappedDuration > 60) {
        action = 'Avtomatski discount -15% za hitro sprostitev kapitala.';
      } else if (i.efficiencyScore < 25) {
        action = 'Bundle z drugim item-om za hitrejšo prodajo in sprostitev kapitala.';
      } else {
        action = 'Cross-post na 3 platforme za hitrejšo prodajo.';
      }
      return {
        tradeId: i.tradeId,
        title: i.title,
        efficiencyScore: i.efficiencyScore,
        recommendedAction: clampString(action, 200, 'Preusmeri kapital.'),
      };
    });

  // 2) High efficiency opportunities — new categories to redeploy freed capital
  const highEfficiencyOpportunities: HighEfficiencyOpportunity[] = [
    {
      category: 'Elektronika',
      expectedEfficiency: round2(clampNum(2.8, EFFICIENCY_MIN, EFFICIENCY_MAX, 2.5)),
      expectedROI: round2(clampNum(45, -50, 300, 40)),
    },
    {
      category: 'Mobilni telefoni',
      expectedEfficiency: round2(clampNum(2.4, EFFICIENCY_MIN, EFFICIENCY_MAX, 2.2)),
      expectedROI: round2(clampNum(38, -50, 300, 35)),
    },
    {
      category: 'Gaming konzole',
      expectedEfficiency: round2(clampNum(2.2, EFFICIENCY_MIN, EFFICIENCY_MAX, 2.0)),
      expectedROI: round2(clampNum(32, -50, 300, 30)),
    },
  ];

  // 3) Capital reallocation plan: from low-eff items to high-eff categories
  const capitalReallocationPlan: CapitalReallocation[] = [];
  const lowItemsForRealloc = perItem
    .filter((i) => i.efficiencyScore < 50)
    .sort((a, b) => a.efficiencyScore - b.efficiencyScore)
    .slice(0, MAX_REALLOCATIONS);

  for (let idx = 0; idx < lowItemsForRealloc.length; idx++) {
    const item = lowItemsForRealloc[idx];
    const opportunity = highEfficiencyOpportunities[idx % highEfficiencyOpportunities.length];
    capitalReallocationPlan.push({
      fromTradeId: item.tradeId,
      toCategory: opportunity.category,
      amount: round0(clampNum(
        item.capitalDeployed, CAPITAL_MIN, CAPITAL_MAX, 0,
      )),
      reasoning: clampString(
        `${item.title}: efficiency ${item.efficiencyScore}/100, trapped ${item.capitalTrappedDuration}d. ` +
        `Premakni ${item.capitalDeployed}€ v ${opportunity.category} (exp efficiency ${opportunity.expectedEfficiency}x, ` +
        `ROI ${opportunity.expectedROI}%) za ${Math.round((opportunity.expectedEfficiency - item.capitalEfficiency) * 100) / 100}x uplift.`,
        400,
        `Premakni ${item.capitalDeployed}€ iz ${item.title} v ${opportunity.category}.`,
      ),
    });
  }

  // 4) Projected efficiency = weighted avg of remaining + reallocated items
  const totalCapital = current.totalCapitalDeployed;
  const reallocAmount = capitalReallocationPlan.reduce((s, r) => s + r.amount, 0);
  const remainingCapital = Math.max(0, totalCapital - reallocAmount);
  // Reallocated items expected efficiency
  const reallocatedEfficiency = highEfficiencyOpportunities.length > 0
    ? highEfficiencyOpportunities.reduce((s, o) => s + o.expectedEfficiency, 0) / highEfficiencyOpportunities.length
    : current.portfolioCapitalEfficiency;
  // Projected efficiency = (remaining × current eff + reallocAmount × reallocatedEfficiency) / totalCapital
  const projectedEfficiency = round2(clampNum(
    totalCapital > 0
      ? (remainingCapital * current.portfolioCapitalEfficiency + reallocAmount * reallocatedEfficiency) / totalCapital
      : current.portfolioCapitalEfficiency,
    EFFICIENCY_MIN, EFFICIENCY_MAX, current.portfolioCapitalEfficiency,
  ));

  const efficiencyUplift = round2(clampNum(
    projectedEfficiency - current.portfolioCapitalEfficiency,
    UPLIFT_MIN, UPLIFT_MAX, 0,
  ));

  // Expected profit uplift = reallocated amount × (expected efficiency uplift × avg profit/euro)
  const expectedProfitUplift = round0(clampNum(
    reallocAmount * Math.max(0, (reallocatedEfficiency - current.portfolioCapitalEfficiency)) * Math.max(0, current.avgProfitPerEuroDeployed),
    PROFIT_UPLIFT_MIN, PROFIT_UPLIFT_MAX, 0,
  ));

  const efficiencyGrade = decideGrade(
    current.portfolioEfficiencyScore + efficiencyUplift * 10,
    projectedEfficiency,
  );

  // Capital velocity optimization
  const capitalVelocityOptimization = clampString(
    `Trenutno avg trapped ${current.avgCapitalTrappedDuration}d, cycle = ${365 / Math.max(1, current.avgCapitalTrappedDuration)}x/leto. ` +
    `Cilj: cycle vsakih 18 dni (20x/leto). Strategija: ` +
    `1) Avtomatski discount -10% po 30d, -20% po 60d za hitro sproščanje. ` +
    `2) Cross-post na 3 platforme (Bolha + Vinted + mobile.de) za 2x večji reach. ` +
    `3) Bundle komplementarne item-e za hitrejšo prodajo. ` +
    `4) Sproščen kapital reinvestiraj takoj v high-efficiency kategorije.`,
    400,
    'Pospeši capital velocity z avtomatskim discount-om in cross-posting.',
  );

  return {
    lowEfficiencyItems,
    highEfficiencyOpportunities,
    capitalReallocationPlan,
    projectedEfficiency,
    efficiencyUplift,
    capitalVelocityOptimization,
    efficiencyGrade,
    totalCapitalToReallocate: round0(clampNum(
      reallocAmount, CAPITAL_MIN, CAPITAL_MAX, 0,
    )),
    expectedProfitUplift,
  };
}

function buildSummary(current: CurrentState, max: Maximization): string {
  const parts: string[] = [
    `Current: ${current.totalCapitalDeployed}€ deployed, efficiency ${current.portfolioCapitalEfficiency}x, score ${current.portfolioEfficiencyScore}/100.`,
    `Maximization: ${max.projectedEfficiency}x (+${max.efficiencyUplift} uplift), grade ${max.efficiencyGrade}.`,
    `Reallocate ${max.totalCapitalToReallocate}€ iz ${max.lowEfficiencyItems.length} low-eff items → +${max.expectedProfitUplift}€ profit uplift.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryCapitalEfficiencyMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryCapitalEfficiencyMaximizer(req);
}

async function handleInventoryCapitalEfficiencyMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-capital-efficiency-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();
    const twelveMonthsAgo = new Date(now - TWELVE_MONTHS_MS);

    // 1) Query HELD trades + SOLD trades for historical baseline (parallel)
    const [heldTrades, soldTrades] = await Promise.all([
      db.trade.findMany({
        where: { status: 'held' },
        select: {
          id: true,
          title: true,
          category: true,
          buyPrice: true,
          buyFees: true,
          buyDate: true,
          listing: {
            select: {
              aiEstimatedValue: true,
              price: true,
              aiScore: true,
              dealScore: true,
            },
          },
        },
        orderBy: { buyDate: 'asc' },
        take: 100000,
      }) as unknown as HeldTradeRow[],
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
          category: true,
        },
        orderBy: { sellDate: 'asc' },
        take: 100000,
      }) as unknown as SoldTradeRow[],
    ]);

    // Empty-state: no HELD trades
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        current: {
          totalCapitalDeployed: 0,
          portfolioCapitalEfficiency: 0,
          avgProfitPerEuroDeployed: 0,
          avgCapitalTrappedDuration: 0,
          portfolioEfficiencyScore: 0,
        },
        perItem: [],
        maximization: {
          lowEfficiencyItems: [],
          highEfficiencyOpportunities: [],
          capitalReallocationPlan: [],
          projectedEfficiency: 0,
          efficiencyUplift: 0,
          capitalVelocityOptimization: 'Ni HELD trgovin v inventarju — Inventory Capital Efficiency Maximizer ni mogoč.',
          efficiencyGrade: 'F',
          totalCapitalToReallocate: 0,
          expectedProfitUplift: 0,
        },
        summary: 'Ni HELD trgovin v inventarju — Inventory Capital Efficiency Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Inventory Capital Efficiency Maximizer ni mogoč.',
      } satisfies CapitalEfficiencyResponse);
    }

    // 2) Compute aggregates
    const soldComputed: SoldComputed[] = [];
    for (const t of soldTrades) {
      const c = computeSoldTrade(t, now);
      if (c) soldComputed.push(c);
    }
    const soldAgg = aggregateSold(soldComputed);

    const heldComputed: HeldComputed[] = [];
    for (const t of heldTrades) {
      const c = computeHeldTrade(t, now);
      if (c) heldComputed.push(c);
    }

    const perItem: PerItemEfficiency[] = heldComputed.map((c) => computePerItem(c, soldAgg));
    const current = computeCurrent(perItem);

    let maximization = buildDeterministicMaximization(current, perItem, heldComputed);
    let summary = buildSummary(current, maximization);

    // 3) AI cache check (6h TTL) — key by held item IDs
    const heldItemIds = heldComputed.map((c) => c.tradeId).sort();
    const cacheKey = `inventory-capital-efficiency-maximizer:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      maximization: Maximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        current,
        perItem,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies CapitalEfficiencyResponse);
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

    // Sort perItem by efficiencyScore ASC (worst first) for AI prompt
    const sortedPerItem = [...perItem].sort((a, b) => a.efficiencyScore - b.efficiencyScore);
    const topForPrompt = sortedPerItem.slice(0, MAX_ITEMS_TO_PROCESS);

    const promptData = {
      heldCount: heldComputed.length,
      soldCount12m: soldAgg.count12m,
      avgROIHistorical: round2(soldAgg.avgROI),
      avgHoldDaysHistorical: round0(soldAgg.avgHoldDays),
      current,
      topItems: topForPrompt.map((i) => ({
        tradeId: i.tradeId,
        title: i.title,
        capitalDeployed: i.capitalDeployed,
        capitalEfficiency: i.capitalEfficiency,
        profitPerEuroDeployed: i.profitPerEuroDeployed,
        efficiencyScore: i.efficiencyScore,
        capitalTrappedDuration: i.capitalTrappedDuration,
        efficiencyLossPerDay: i.efficiencyLossPerDay,
      })),
      deterministicMaximization: {
        projectedEfficiency: maximization.projectedEfficiency,
        efficiencyUplift: maximization.efficiencyUplift,
        efficiencyGrade: maximization.efficiencyGrade,
        totalCapitalToReallocate: maximization.totalCapitalToReallocate,
        expectedProfitUplift: maximization.expectedProfitUplift,
      },
      caps: {
        capitalMin: CAPITAL_MIN, capitalMax: CAPITAL_MAX,
        effMin: EFFICIENCY_MIN, effMax: EFFICIENCY_MAX,
        scoreMin: SCORE_MIN, scoreMax: SCORE_MAX,
        daysMin: DAYS_MIN, daysMax: DAYS_MAX,
        upliftMin: UPLIFT_MIN, upliftMax: UPLIFT_MAX,
        profitUpliftMin: PROFIT_UPLIFT_MIN, profitUpliftMax: PROFIT_UPLIFT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Capital Efficiency Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CAPITAL EFFICIENCY — kako eficientno vsak evro kapitala deluje. Identificiraš kapital ujet v low-efficiency item-ih in priporočaš reallokacijo v high-efficiency priložnosti. Razlika od capital-growth-maximizer (v7.99 ki maksimizira compounding capital growth) — ti MAXIMIZIRAŠ capital efficiency (kapital deployment efficiency per item, ne compounding growth rate). Razlika od capital-allocation-optimizer (ki alokira kapital po kategorijah) — ti daje PER-ITEM capital efficiency analizo + reallocation plan iz low → high efficiency items. Razlika od inventory-roi-maximizer-pro (v7.99 ki maksimizira ROI per item) — ti maksimiziraš CAPITAL EFFICIENCY (value multiplier + profitPerEuroDeployed + efficiencyLossPerDay), ne samo ROI %. Razlika od inventory-cash-conversion-maximizer (v7.98 ki maksimizira cash conversion) — ti maksimiziraš CAPITAL VELOCITY preko reallocation, ne cash conversion speed.

DETERMINISTIČNI PODATKI (top ${topForPrompt.length} HELD item-ov z najnižjim efficiency score):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. lowEfficiencyItems: za items z efficiencyScore < 50 — tradeId MORA match-at topItems, recommendedAction (max 200, slovenski — kako sprostiti kapital),
2. highEfficiencyOpportunities: 3-5 kategorij za reinvest { category (max 50), expectedEfficiency [1.0, 10.0], expectedROI % [-50, 300] },
3. capitalReallocationPlan: za vsak low-eff item { fromTradeId (MORA match-at topItems), toCategory (max 50), amount € [0, 100000], reasoning (max 400, slovenski) },
4. capitalVelocityOptimization: slovenski opis kako pospešiti capital velocity (max 400),
5. efficiencyGrade: A+ | A | B | C | D | F,
6. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "lowEfficiencyItems": [
    { "tradeId": "abc123", "recommendedAction": "Avtomatski discount -15% za sprostitev kapitala." }
  ],
  "highEfficiencyOpportunities": [
    { "category": "Elektronika", "expectedEfficiency": 2.8, "expectedROI": 45 }
  ],
  "capitalReallocationPlan": [
    { "fromTradeId": "abc123", "toCategory": "Elektronika", "amount": 250, "reasoning": "Premakni 250€ v elektroniko za 2x uplift." }
  ],
  "capitalVelocityOptimization": "Pospeši cycle z avtomatskim discount-om in cross-posting.",
  "efficiencyGrade": "B",
  "summary": "Current: 8500€ deployed, 1.8x. Max: 3.2x (+1.4 uplift). Reallocate 1500€ → +680€ profit."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        // Override low efficiency items (must match tradeIds)
        if (Array.isArray(parsed.lowEfficiencyItems) && parsed.lowEfficiencyItems.length >= 1) {
          const validIds = new Set(perItem.map((i) => i.tradeId));
          const aiLow: LowEfficiencyItem[] = [];
          for (const li of parsed.lowEfficiencyItems.slice(0, MAX_LOW_EFFICIENCY)) {
            if (!li || typeof li !== 'object' || typeof li.tradeId !== 'string') continue;
            if (!validIds.has(li.tradeId)) continue; // anti-hallucination
            const item = perItem.find((i) => i.tradeId === li.tradeId);
            if (!item) continue;
            aiLow.push({
              tradeId: li.tradeId,
              title: item.title,
              efficiencyScore: item.efficiencyScore,
              recommendedAction: clampString(li.recommendedAction, 200, 'Preusmeri kapital.'),
            });
          }
          if (aiLow.length >= 1) {
            maximization = { ...maximization, lowEfficiencyItems: aiLow };
          }
        }

        // Override high efficiency opportunities
        if (Array.isArray(parsed.highEfficiencyOpportunities) &&
            parsed.highEfficiencyOpportunities.length >= 2) {
          const aiOpps: HighEfficiencyOpportunity[] = [];
          for (const o of parsed.highEfficiencyOpportunities.slice(0, MAX_HIGH_OPPORTUNITIES)) {
            if (!o || typeof o !== 'object') continue;
            aiOpps.push({
              category: clampString(o.category, 50, 'Kategorija'),
              expectedEfficiency: round2(clampNum(
                o.expectedEfficiency, EFFICIENCY_MIN, EFFICIENCY_MAX, 2.0,
              )),
              expectedROI: round2(clampNum(
                o.expectedROI, -50, 300, 30,
              )),
            });
          }
          if (aiOpps.length >= 2) {
            maximization = { ...maximization, highEfficiencyOpportunities: aiOpps };
          }
        }

        // Override capital reallocation plan (must match tradeIds)
        if (Array.isArray(parsed.capitalReallocationPlan) &&
            parsed.capitalReallocationPlan.length >= 1) {
          const validIds = new Set(perItem.map((i) => i.tradeId));
          const aiPlan: CapitalReallocation[] = [];
          for (const r of parsed.capitalReallocationPlan.slice(0, MAX_REALLOCATIONS)) {
            if (!r || typeof r !== 'object' || typeof r.fromTradeId !== 'string') continue;
            if (!validIds.has(r.fromTradeId)) continue; // anti-hallucination
            const item = perItem.find((i) => i.tradeId === r.fromTradeId);
            if (!item) continue;
            aiPlan.push({
              fromTradeId: r.fromTradeId,
              toCategory: clampString(r.toCategory, 50, 'Kategorija'),
              amount: round0(clampNum(
                r.amount, CAPITAL_MIN, item.capitalDeployed, item.capitalDeployed,
              )),
              reasoning: clampString(r.reasoning, 400, `Premakni ${item.capitalDeployed}€ v drugo kategorijo.`),
            });
          }
          if (aiPlan.length >= 1) {
            // Recompute projected efficiency + uplift with AI plan
            const reallocAmount = aiPlan.reduce((s, r) => s + r.amount, 0);
            const remainingCapital = Math.max(0, current.totalCapitalDeployed - reallocAmount);
            const reallocatedEff = maximization.highEfficiencyOpportunities.length > 0
              ? maximization.highEfficiencyOpportunities.reduce((s, o) => s + o.expectedEfficiency, 0) /
                maximization.highEfficiencyOpportunities.length
              : current.portfolioCapitalEfficiency;
            const projectedEfficiency = round2(clampNum(
              current.totalCapitalDeployed > 0
                ? (remainingCapital * current.portfolioCapitalEfficiency + reallocAmount * reallocatedEff) /
                  current.totalCapitalDeployed
                : current.portfolioCapitalEfficiency,
              EFFICIENCY_MIN, EFFICIENCY_MAX, current.portfolioCapitalEfficiency,
            ));
            const efficiencyUplift = round2(clampNum(
              projectedEfficiency - current.portfolioCapitalEfficiency,
              UPLIFT_MIN, UPLIFT_MAX, 0,
            ));
            const expectedProfitUplift = round0(clampNum(
              reallocAmount * Math.max(0, reallocatedEff - current.portfolioCapitalEfficiency) *
                Math.max(0, current.avgProfitPerEuroDeployed),
              PROFIT_UPLIFT_MIN, PROFIT_UPLIFT_MAX, 0,
            ));
            const efficiencyGrade = decideGrade(
              current.portfolioEfficiencyScore + efficiencyUplift * 10,
              projectedEfficiency,
            );
            maximization = {
              ...maximization,
              capitalReallocationPlan: aiPlan,
              projectedEfficiency,
              efficiencyUplift,
              expectedProfitUplift,
              efficiencyGrade,
              totalCapitalToReallocate: round0(clampNum(
                reallocAmount, CAPITAL_MIN, CAPITAL_MAX, 0,
              )),
            };
          }
        }

        // Override capital velocity optimization
        if (typeof parsed.capitalVelocityOptimization === 'string' &&
            parsed.capitalVelocityOptimization.trim()) {
          maximization = {
            ...maximization,
            capitalVelocityOptimization: clampString(
              parsed.capitalVelocityOptimization, 400, maximization.capitalVelocityOptimization,
            ),
          };
        }

        // Override grade
        if (parsed.efficiencyGrade) {
          maximization = {
            ...maximization,
            efficiencyGrade: clampEnum(
              parsed.efficiencyGrade,
              VALID_GRADE,
              maximization.efficiencyGrade,
            ),
          };
        }

        summary = clampString(parsed.summary, 400, buildSummary(current, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-capital-efficiency-maximizer',
        'AI call failed — using deterministic fallback',
        err,
      );
    }

    // 5) Cache (6h TTL) — only when AI was used
    if (aiUsed) {
      setCachedAI(cacheKey, { maximization, summary });
    }

    return NextResponse.json({
      ok: true,
      current,
      perItem,
      maximization,
      summary,
      aiUsed,
    } satisfies CapitalEfficiencyResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-capital-efficiency-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
