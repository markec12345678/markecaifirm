// v7.98: AI Inventory Cash Conversion Maximizer — AI maksimizira cash conversion
// rate of held inventorija — kako hitro in profitably lahko ALL held items se
// convert-a v cash? Identificira optimal sell order in pricing za maximum cash
// recovery. The "ultimate cash conversion maximizer."
//
// Razlika od inventory-value-maximizer (v7.97 ki maksimizira value) — ta
// maksimizira CASH conversion (koliko cash dobiš iz inventorija po fees). Razlika
// od cash-recovery-accelerator (v7.96 ki accelerira cash recovery) — ta
// maksimizira CASH RATE per item (koliko €/dan iz vsakega itema) + optimal sell
// order. Razlika od inventory-profit-maximizer (ki maksimizira profit) — ta
// maksimizira cash conversion (ne profit) — koliko cash dobiš iz inventorija v
// katerem vrstnem redu. Razlika od inventory-liquidation-strategist (ki
// likvidira) — ta daje OPTIMAL SELL ORDER za max cash flow (ne immediate
// liquidation). Razlika od inventory-aging-strategist (ki strategizes aging) —
// ta daje CASH CONVERSION TIMELINE + capital recycling plan. Razlika od
// inventory-roi-optimizer (ki optimira ROI) — ta optimira cash conversion rate
// (koliko € cash se sprosti iz buyPrice capital). Razlika od profit-velocity-
// maximizer (v7.98 ki maksimizira velocity) — ta maksimizira per-item cash
// conversion inventorija. Razlika od deal-quality-profit-optimizer (v7.98 ki
// optimira quality-profit) — ta maksimizira cash conversion held inventorija.
// Razlika from inventory-cash-flow-optimizer (ki optimira cash flow timing) — ta
// maksimizira CASH RECOVERY v optimalnem sell order + capital recycling plan.
//
// "iPhone 13: netCashIfSoldNow 412€ (rate 137%, urgency 85), sell first.
// PS5: netCashIfSoldNow 345€ (rate 92%, urgency 70), sell second. Old laptop:
// netCashIfSoldNow 95€ (rate 63%, urgency 95 — declining fast), sell third.
// Total cash recovery: 852€ (grade B). Timeline: 14 days. Capital recycling:
// reinvest 500€ v Bolha, 350€ v Vinted (expected ROI 78%/85%)."
//
// GET+POST /api/ai/inventory-cash-conversion-maximizer
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

type ActionPriority = 'HIGH' | 'MEDIUM' | 'LOW';
type CashConversionGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface HeldItemRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    price: number | null;
    aiScore: number | null;
    dealScore: number | null;
    monitor: { source: string; tags: string } | null;
  } | null;
}

interface CashConversionItem {
  tradeId: string;
  title: string;
  buyPrice: number;
  aiEstimatedValue: number | null;
  carryingCostAccrued: number;
  netCashIfSoldNow: number;
  cashConversionRate: number; // %
  conversionUrgency: number; // 0-100
  conversionEfficiency: number; // €/day
  optimalPrice: number;
  sellOrderRank: number;
}

interface OptimalSellOrderEntry {
  tradeId: string;
  rank: number;
  reason: string;
}

interface CashFlowOptimizationAction {
  action: string;
  priority: ActionPriority;
  cashImpact: number; // €
}

interface CapitalRecyclingEntry {
  category: string;
  amount: number; // €
  expectedROI: number; // %
}

interface CashConversionMaximization {
  optimalSellOrder: OptimalSellOrderEntry[];
  projectedCashRecovery: number;
  cashConversionTimeline: number; // days
  cashFlowOptimizationActions: CashFlowOptimizationAction[];
  capitalRecyclingPlan: CapitalRecyclingEntry[];
  cashConversionGrade: CashConversionGrade;
  totalProfitIfConverted: number;
}

interface InventoryCashConversionResponse {
  ok: true;
  items: CashConversionItem[];
  maximization: CashConversionMaximization;
  summary: string;
  aiUsed: boolean;
  cached?: boolean;
  message?: string;
}

interface AiResponse {
  maximization?: {
    optimalSellOrder?: Array<{ tradeId?: string; rank?: number; reason?: string }>;
    cashConversionTimeline?: number;
    cashFlowOptimizationActions?: Array<{
      action?: string;
      priority?: ActionPriority;
      cashImpact?: number;
    }>;
    capitalRecyclingPlan?: Array<{
      category?: string;
      amount?: number;
      expectedROI?: number;
    }>;
    cashConversionGrade?: CashConversionGrade;
  };
  summary?: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const EST_FEE_RATE = 0.05; // 5% est. selling fees (Bolha + cross-post — lighter than 8% because we focus on cash recovery not max value)
const CARRYING_COST_PER_DAY = 0.10; // €/day carrying cost (storage, capital opportunity)
const PRICE_LOW_MULTIPLIER = 0.5; // min 0.5× buyPrice anti-hallucination
const PRICE_HIGH_MULTIPLIER = 1.2; // max 1.2× buyPrice anti-hallucination
const URGENCY_DAILY_INC = 1.5; // urgency increases 1.5/day held
const URGENCY_DECLINE_MULT = 1.8; // urgency multiplier for declining-value items
const HIGH_URGENCY_THRESHOLD = 70;
const TARGET_TIMELINE_DAYS = 14; // target: convert all inventory to cash in 14 days

const PRICE_MIN = 0;
const PRICE_MAX = 50_000;
const RATE_MIN = 0;
const RATE_MAX = 500; // cashConversionRate cap
const URGENCY_MIN = 0;
const URGENCY_MAX = 100;
const EFFICIENCY_MIN = 0;
const EFFICIENCY_MAX = 5_000;
const RECOVERY_MIN = 0;
const RECOVERY_MAX = 100_000;
const PROFIT_MIN = -50_000;
const PROFIT_MAX = 100_000;
const IMPACT_MIN = 0;
const IMPACT_MAX = 50_000;
const TIMELINE_MIN = 1;
const TIMELINE_MAX = 365;
const ROI_MIN = -100;
const ROI_MAX = 500;
const AMOUNT_MIN = 0;
const AMOUNT_MAX = 100_000;

const VALID_PRIORITY: readonly ActionPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_GRADE: readonly CashConversionGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

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

interface DetCashItem {
  item: CashConversionItem;
  daysHeld: number;
  isDeclining: boolean;
}

function computeCashConversionItem(t: HeldItemRow, now: number): DetCashItem {
  const buyPrice = t.buyPrice ?? 0;
  const buyMs = toMs(t.buyDate);
  const daysHeld = buyMs > 0 ? Math.max(0, Math.round((now - buyMs) / DAY_MS)) : 0;

  // Estimated value: listing.aiEstimatedValue, fallback to listing.price, then buyPrice × 1.1
  const listingEst = t.listing?.aiEstimatedValue ?? null;
  const listingPrice = t.listing?.price ?? null;
  const estValue =
    listingEst && listingEst > 0 ? listingEst
      : listingPrice && listingPrice > 0 ? listingPrice
        : Math.round(buyPrice * 1.1);

  // Carrying cost accrued (capital opportunity cost)
  const carryingCostAccrued = round2(daysHeld * CARRYING_COST_PER_DAY);

  // Net cash if sold now = estValue - carryingCost - estFees (5%)
  const estFees = Math.round(estValue * EST_FEE_RATE);
  const netCashIfSoldNow = round0(
    Math.max(0, estValue - carryingCostAccrued - estFees),
  );

  // Cash conversion rate = netCashIfSoldNow / buyPrice × 100 (ROI on capital)
  const cashConversionRate = buyPrice > 0
    ? round2(clampNum((netCashIfSoldNow / buyPrice) * 100, RATE_MIN, RATE_MAX, 0))
    : 0;

  // Determine if declining: estValue < buyPrice (depreciating)
  const isDeclining = estValue < buyPrice;

  // Conversion urgency 0-100 (higher = convert to cash faster)
  // - increases with days held
  // - higher if declining
  let urgency = daysHeld * URGENCY_DAILY_INC;
  if (isDeclining) urgency *= URGENCY_DECLINE_MULT;
  // Higher urgency if cash conversion rate is low (capital tied up)
  if (cashConversionRate < 100) {
    urgency += (100 - Math.max(0, cashConversionRate)) * 0.3;
  }
  const conversionUrgency = round0(clampNum(urgency, URGENCY_MIN, URGENCY_MAX, 50));

  // Conversion efficiency = netCashIfSoldNow / daysHeld (cash per day held)
  const conversionEfficiency = daysHeld > 0
    ? round2(clampNum(netCashIfSoldNow / daysHeld, EFFICIENCY_MIN, EFFICIENCY_MAX, 0))
    : round2(clampNum(netCashIfSoldNow, EFFICIENCY_MIN, EFFICIENCY_MAX, 0));

  // Optimal price = price that maximizes cash recovery
  // If urgent (declining or low rate): price slightly below estValue to sell fast
  // If not urgent: price at estValue for max cash
  const optimalPriceRaw = conversionUrgency > HIGH_URGENCY_THRESHOLD || isDeclining
    ? estValue * 0.95 // 5% discount for quick sale
    : estValue;
  // Anti-hallucination: clamp to [0.5×, 1.2×] buyPrice
  const priceLowBound = Math.round(buyPrice * PRICE_LOW_MULTIPLIER);
  const priceHighBound = Math.round(buyPrice * PRICE_HIGH_MULTIPLIER);
  const optimalPrice = round0(
    Math.max(priceLowBound, Math.min(priceHighBound, optimalPriceRaw)),
  );

  return {
    item: {
      tradeId: t.id,
      title: clampString(t.title, 200, 'Item'),
      buyPrice: round0(buyPrice),
      aiEstimatedValue: listingEst && listingEst > 0 ? round0(listingEst) : null,
      carryingCostAccrued,
      netCashIfSoldNow,
      cashConversionRate,
      conversionUrgency,
      conversionEfficiency,
      optimalPrice,
      sellOrderRank: 0, // set later
    },
    daysHeld,
    isDeclining,
  };
}

function assignSellOrderRanks(detItems: DetCashItem[]): void {
  // Sort by conversion urgency DESC (most urgent = sell first = rank 1)
  const sorted = [...detItems].sort(
    (a, b) => b.item.conversionUrgency - a.item.conversionUrgency,
  );
  sorted.forEach((d, idx) => {
    d.item.sellOrderRank = idx + 1;
  });
}

function computeTotalProfitIfConverted(detItems: DetCashItem[]): number {
  let total = 0;
  for (const d of detItems) {
    total += d.item.netCashIfSoldNow - d.item.buyPrice;
  }
  return round0(clampNum(total, PROFIT_MIN, PROFIT_MAX, 0));
}

function computeProjectedCashRecovery(detItems: DetCashItem[]): number {
  let total = 0;
  for (const d of detItems) {
    // Cash recovery at optimalPrice (after fees)
    const fees = Math.round(d.item.optimalPrice * EST_FEE_RATE);
    const cash = Math.max(0, d.item.optimalPrice - fees - d.item.carryingCostAccrued);
    total += cash;
  }
  return round0(clampNum(total, RECOVERY_MIN, RECOVERY_MAX, 0));
}

function decideGrade(totalBuyCapital: number, projectedRecovery: number): CashConversionGrade {
  if (totalBuyCapital <= 0) return 'F';
  const recoveryRatio = projectedRecovery / totalBuyCapital;
  if (recoveryRatio >= 1.20) return 'A+';
  if (recoveryRatio >= 1.10) return 'A';
  if (recoveryRatio >= 1.00) return 'B';
  if (recoveryRatio >= 0.90) return 'C';
  if (recoveryRatio >= 0.75) return 'D';
  return 'F';
}

function buildDeterministicMaximization(detItems: DetCashItem[]): CashConversionMaximization {
  // Optimal sell order: ranked by urgency
  const optimalSellOrder: OptimalSellOrderEntry[] = detItems
    .slice()
    .sort((a, b) => a.item.sellOrderRank - b.item.sellOrderRank)
    .map((d) => ({
      tradeId: d.item.tradeId,
      rank: d.item.sellOrderRank,
      reason: clampString(
        `Sell #${d.item.sellOrderRank}: urgency ${d.item.conversionUrgency}/100, netCash ${d.item.netCashIfSoldNow}€ (rate ${d.item.cashConversionRate}%). ${d.isDeclining ? 'Declining — convert hitro.' : 'Stable — optimal timing.'}`,
        200,
        `Sell #${d.item.sellOrderRank}: urgency ${d.item.conversionUrgency}.`,
      ),
    }));

  const projectedCashRecovery = computeProjectedCashRecovery(detItems);
  const totalProfitIfConverted = computeTotalProfitIfConverted(detItems);

  // Cash conversion timeline = average days to sell all items
  // Assume avg 7 days per item if urgent (high urgency), 14 days if moderate, 21 days if low
  let totalDays = 0;
  for (const d of detItems) {
    if (d.item.conversionUrgency > 70) totalDays += 7;
    else if (d.item.conversionUrgency > 40) totalDays += 14;
    else totalDays += 21;
  }
  const cashConversionTimeline = detItems.length > 0
    ? round0(clampNum(Math.round(totalDays / detItems.length), TIMELINE_MIN, TIMELINE_MAX, TARGET_TIMELINE_DAYS))
    : TARGET_TIMELINE_DAYS;

  const totalBuyCapital = detItems.reduce((s, d) => s + d.item.buyPrice, 0);
  const cashConversionGrade = decideGrade(totalBuyCapital, projectedCashRecovery);

  // Cash flow optimization actions
  const urgentCount = detItems.filter((d) => d.item.conversionUrgency > HIGH_URGENCY_THRESHOLD).length;
  const decliningCount = detItems.filter((d) => d.isDeclining).length;
  const lowRateCount = detItems.filter((d) => d.item.cashConversionRate < 100).length;

  const actions: CashFlowOptimizationAction[] = [];
  if (urgentCount > 0) {
    actions.push({
      action: clampString(
        `Prodaj ${urgentCount} urgent item-ov (urgency > 70) v 7 dneh za hitro cash recovery.`,
        200,
        `Prodaj ${urgentCount} urgent item-ov v 7 dneh.`,
      ),
      priority: 'HIGH',
      cashImpact: round0(clampNum(
        detItems
          .filter((d) => d.item.conversionUrgency > HIGH_URGENCY_THRESHOLD)
          .reduce((s, d) => s + d.item.netCashIfSoldNow, 0),
        IMPACT_MIN, IMPACT_MAX, 0,
      )),
    });
  }
  if (decliningCount > 0) {
    actions.push({
      action: clampString(
        `Likvidiraj ${decliningCount} declining item-ov hitro — prepreči nadaljnji loss.`,
        200,
        `Likvidiraj ${decliningCount} declining item-ov.`,
      ),
      priority: 'HIGH',
      cashImpact: round0(clampNum(
        detItems
          .filter((d) => d.isDeclining)
          .reduce((s, d) => s + d.item.netCashIfSoldNow, 0),
        IMPACT_MIN, IMPACT_MAX, 0,
      )),
    });
  }
  if (lowRateCount > 0) {
    actions.push({
      action: clampString(
        `Premakni ${lowRateCount} item-ov z low cash rate (< 100%) v hitro prodajo — sprosti kapital.`,
        200,
        `Premakni ${lowRateCount} low-rate item-ov v prodajo.`,
      ),
      priority: 'MEDIUM',
      cashImpact: round0(clampNum(
        detItems
          .filter((d) => d.item.cashConversionRate < 100)
          .reduce((s, d) => s + d.item.buyPrice, 0),
        IMPACT_MIN, IMPACT_MAX, 0,
      )),
    });
  }
  // Always add at least one capital recycling action
  if (actions.length === 0 && detItems.length > 0) {
    actions.push({
      action: clampString(
        `Ciljaj prodajo vseh ${detItems.length} item-ov v ${TARGET_TIMELINE_DAYS} dneh za optimal cash flow.`,
        200,
        `Prodaj vse item-e v ${TARGET_TIMELINE_DAYS} dneh.`,
      ),
      priority: 'LOW',
      cashImpact: projectedCashRecovery,
    });
  }

  // Capital recycling plan: distribute freed capital across categories
  const sourceCount: Map<string, number> = new Map();
  for (const d of detItems) {
    // We don't have category per trade in DetCashItem — derive from raw
    // Use "Reinvest" generic categories since tradeId category not exposed
  }
  const capitalRecyclingPlan: CapitalRecyclingEntry[] = [];
  // Distribute projected cash recovery across 3 recycling categories
  const bolhaAmount = round0(clampNum(projectedCashRecovery * 0.4, AMOUNT_MIN, AMOUNT_MAX, 0));
  const vintedAmount = round0(clampNum(projectedCashRecovery * 0.35, AMOUNT_MIN, AMOUNT_MAX, 0));
  const avtonetAmount = round0(clampNum(projectedCashRecovery * 0.25, AMOUNT_MIN, AMOUNT_MAX, 0));
  if (bolhaAmount > 0) {
    capitalRecyclingPlan.push({
      category: 'Bolha',
      amount: bolhaAmount,
      expectedROI: round0(clampNum(78, ROI_MIN, ROI_MAX, 50)),
    });
  }
  if (vintedAmount > 0) {
    capitalRecyclingPlan.push({
      category: 'Vinted',
      amount: vintedAmount,
      expectedROI: round0(clampNum(85, ROI_MIN, ROI_MAX, 50)),
    });
  }
  if (avtonetAmount > 0) {
    capitalRecyclingPlan.push({
      category: 'Avtonet',
      amount: avtonetAmount,
      expectedROI: round0(clampNum(65, ROI_MIN, ROI_MAX, 50)),
    });
  }

  return {
    optimalSellOrder,
    projectedCashRecovery,
    cashConversionTimeline,
    cashFlowOptimizationActions: actions.slice(0, 5),
    capitalRecyclingPlan,
    cashConversionGrade,
    totalProfitIfConverted,
  };
}

function buildSummary(
  detItems: DetCashItem[],
  maximization: CashConversionMaximization,
): string {
  const parts: string[] = [
    `${detItems.length} held item-ov.`,
    `Cash recovery: ${maximization.projectedCashRecovery}€ (grade ${maximization.cashConversionGrade}).`,
    `Timeline: ${maximization.cashConversionTimeline} dni.`,
    `Profit if converted: ${maximization.totalProfitIfConverted}€.`,
    `${maximization.capitalRecyclingPlan.length} recycling kategorij.`,
  ];
  return parts.join(' ').slice(0, 400);
}

// --- Handler -------------------------------------------------------------

export async function GET(req: NextRequest) {
  return handleInventoryCashConversionMaximizer(req);
}
export async function POST(req: NextRequest) {
  return handleInventoryCashConversionMaximizer(req);
}

async function handleInventoryCashConversionMaximizer(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, 'ai-inventory-cash-conversion-maximizer', 20);
    if (!rl.allowed) return rateLimitResponse(rl);

    const now = Date.now();

    // 1) Query all HELD trades with their linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        buyPrice: true,
        buyDate: true,
        category: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            price: true,
            aiScore: true,
            dealScore: true,
            monitor: { select: { source: true, tags: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as HeldItemRow[];

    // Empty-state: no HELD trades
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        items: [],
        maximization: {
          optimalSellOrder: [],
          projectedCashRecovery: 0,
          cashConversionTimeline: TARGET_TIMELINE_DAYS,
          cashFlowOptimizationActions: [],
          capitalRecyclingPlan: [],
          cashConversionGrade: 'F',
          totalProfitIfConverted: 0,
        },
        summary: 'Ni HELD trgovin v inventarju — Inventory Cash Conversion Maximizer ni mogoč.',
        aiUsed: false,
        message: 'Ni HELD trgovin v inventarju — Inventory Cash Conversion Maximizer ni mogoč.',
      } satisfies InventoryCashConversionResponse);
    }

    // 2) Compute per-item cash conversion metrics (deterministic baseline)
    const detItems = heldTrades.map((t) => computeCashConversionItem(t, now));
    assignSellOrderRanks(detItems);

    let maximization = buildDeterministicMaximization(detItems);
    let items: CashConversionItem[] = detItems.map((d) => d.item);
    let summary = buildSummary(detItems, maximization);

    // 3) AI cache check (6h TTL) — key by held item ids
    const heldItemIds = heldTrades.map((t) => t.id).sort();
    const cacheKey = `inventory-cash-conversion-maximizer:${JSON.stringify(heldItemIds)}`;
    const cached = getCachedAI<{
      maximization: CashConversionMaximization;
      summary: string;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ok: true,
        items,
        maximization: cached.maximization,
        summary: cached.summary,
        cached: true,
        aiUsed: true,
      } satisfies InventoryCashConversionResponse);
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

    // Compact context for AI (top 40 items by urgency)
    const topItemsForAI = [...detItems]
      .sort((a, b) => b.item.conversionUrgency - a.item.conversionUrgency)
      .slice(0, 40)
      .map((d) => ({
        tradeId: d.item.tradeId,
        title: d.item.title,
        buyPrice: d.item.buyPrice,
        aiEstimatedValue: d.item.aiEstimatedValue,
        carryingCostAccrued: d.item.carryingCostAccrued,
        netCashIfSoldNow: d.item.netCashIfSoldNow,
        cashConversionRate: d.item.cashConversionRate,
        conversionUrgency: d.item.conversionUrgency,
        conversionEfficiency: d.item.conversionEfficiency,
        detOptimalPrice: d.item.optimalPrice,
        detSellOrderRank: d.item.sellOrderRank,
        daysHeld: d.daysHeld,
        isDeclining: d.isDeclining,
      }));

    const promptData = {
      heldItemsCount: detItems.length,
      heldItems: topItemsForAI,
      deterministicMaximization: maximization,
      caps: {
        priceMin: PRICE_MIN, priceMax: PRICE_MAX,
        rateMin: RATE_MIN, rateMax: RATE_MAX,
        recoveryMin: RECOVERY_MIN, recoveryMax: RECOVERY_MAX,
        profitMin: PROFIT_MIN, profitMax: PROFIT_MAX,
        impactMin: IMPACT_MIN, impactMax: IMPACT_MAX,
        timelineMin: TIMELINE_MIN, timelineMax: TIMELINE_MAX,
        roiMin: ROI_MIN, roiMax: ROI_MAX,
        amountMin: AMOUNT_MIN, amountMax: AMOUNT_MAX,
      },
    };

    const prompt = `Si AI "Inventory Cash Conversion Maximizer" za slovenske in srednjeevropske oglasne platforme (Bolha, Vinted, Avtonet, mobile.de).
Si strokovnjak za CASH CONVERSION maximization — identificiraš kako MAXIMIZIRATI cash conversion rate of HELD inventorija. Razlika od inventory-value-maximizer (v7.97 ki maksimizira value) — ti maksimiziraš CASH conversion (koliko cash dobiš po fees). Razlika od cash-recovery-accelerator (v7.96 ki accelerira cash recovery) — ti maksimiziraš CASH RATE per item + optimal sell order. Razlika od inventory-profit-maximizer (ki maksimizira profit) — ti maksimiziraš cash conversion (koliko cash se sprosti iz buyPrice capital). Razlika od inventory-liquidation-strategist (ki likvidira) — ti daje OPTIMAL SELL ORDER za max cash flow. Razlika od inventory-aging-strategist (ki strategizes aging) — ti daje CASH CONVERSION TIMELINE + capital recycling plan. Razlika od inventory-roi-optimizer (ki optimira ROI) — ti optimiraš cash conversion rate. Razlika od profit-velocity-maximizer (ki maksimizira velocity) — ti maksimiziraš per-item cash conversion.

DETERMINISTIČNI PODATKI (izračunano iz DB — HELD trgovin z linked Listing):
${JSON.stringify(promptData, null, 2)}

PRAVILA ZA AI ODGOVOR:
1. maximization.optimalSellOrder: za vsak tradeId iz heldItems (top 40), daj:
   - tradeId (string, MORA match-at enega iz heldItems — anti-hallucination),
   - rank (1-based, 1 = sell first; lahko se razlikuje od detSellOrderRank),
   - reason (max 200, slovenski — zakaj ta rank).
   Ostali field-i (optimalPrice, netCashIfSoldNow, cashConversionRate, conversionUrgency, conversionEfficiency) se avtomatsko izračunajo v backendu.
2. maximization.cashConversionTimeline dni [1, 365] (koliko dni da convert-aš ALL inventory v cash),
3. maximization.cashFlowOptimizationActions: 3-5 akcij { action (max 200, slovenski), priority HIGH | MEDIUM | LOW, cashImpact € [0, 50000] },
4. maximization.capitalRecyclingPlan: 2-4 entries { category (max 80, slovenski — Bolha/Vinted/Avtonet/...), amount € [0, 100000], expectedROI % [−100, 500] } (kam reinvestirati sproščen kapital),
5. maximization.cashConversionGrade: A+ | A | B | C | D | F (A+ če projectedRecovery/buyCapital ≥ 1.20, F če < 0.75),
6. summary: slovenski povzetek (max 400 znakov).

VRNI LE JSON:
{
  "maximization": {
    "optimalSellOrder": [
      { "tradeId": "ckxxxxx", "rank": 1, "reason": "Declining + urgency 85 — sell hitro." },
      { "tradeId": "ckyyyyy", "rank": 2, "reason": "Stable, urgency 70 — sell drugi." }
    ],
    "cashConversionTimeline": 14,
    "cashFlowOptimizationActions": [
      { "action": "Prodaj 3 urgent item-e v 7 dneh.", "priority": "HIGH", "cashImpact": 850 }
    ],
    "capitalRecyclingPlan": [
      { "category": "Bolha", "amount": 500, "expectedROI": 78 },
      { "category": "Vinted", "amount": 350, "expectedROI": 85 }
    ],
    "cashConversionGrade": "B"
  },
  "summary": "8 held item-ov. Cash recovery: 852€ (grade B). Timeline: 14 dni. Profit if converted: 320€."
}${GROUNDING_PROMPT_SUFFIX}`;

    let aiUsed = false;

    try {
      const raw = await callProviderForRaw(aiSettings, prompt);
      const parsed = parseJsonLooseExported(raw) as AiResponse | null;

      if (parsed && typeof parsed === 'object') {
        const aiMax = parsed.maximization ?? {};

        const detByTradeId = new Map<string, DetCashItem>();
        for (const d of detItems) detByTradeId.set(d.item.tradeId, d);

        // optimalSellOrder: AI may re-rank items
        const optimalSellOrder: OptimalSellOrderEntry[] = [];
        if (Array.isArray(aiMax.optimalSellOrder) && aiMax.optimalSellOrder.length > 0) {
          const validTradeIds = new Set(detItems.map((d) => d.item.tradeId));
          const seenTradeIds = new Set<string>();
          for (const r of aiMax.optimalSellOrder) {
            if (!r || typeof r !== 'object') continue;
            const tradeId = String(r.tradeId ?? '');
            if (!validTradeIds.has(tradeId) || seenTradeIds.has(tradeId)) continue;
            seenTradeIds.add(tradeId);
            const det = detByTradeId.get(tradeId);
            if (!det) continue;
            const rank = round0(clampNum(
              r.rank,
              1, detItems.length,
              det.item.sellOrderRank,
            ));
            const reason = clampString(r.reason, 200, `Sell #${rank}: urgency ${det.item.conversionUrgency}.`);
            optimalSellOrder.push({ tradeId, rank, reason });
          }
        }
        // Fallback: use deterministic sell order
        if (optimalSellOrder.length === 0) {
          for (const d of detItems) {
            optimalSellOrder.push({
              tradeId: d.item.tradeId,
              rank: d.item.sellOrderRank,
              reason: `Sell #${d.item.sellOrderRank}: urgency ${d.item.conversionUrgency}.`,
            });
          }
        } else {
          // For items AI didn't return, append with remaining ranks
          const seenTradeIds = new Set(optimalSellOrder.map((r) => r.tradeId));
          let nextRank = optimalSellOrder.length + 1;
          for (const d of detItems) {
            if (!seenTradeIds.has(d.item.tradeId)) {
              optimalSellOrder.push({
                tradeId: d.item.tradeId,
                rank: nextRank,
                reason: `Sell #${nextRank}: urgency ${d.item.conversionUrgency}.`,
              });
              nextRank += 1;
            }
          }
        }
        // Sort by rank ascending
        optimalSellOrder.sort((a, b) => a.rank - b.rank);
        // Re-assign sellOrderRank in items based on AI optimalSellOrder
        const rankByTradeId = new Map<string, number>();
        optimalSellOrder.forEach((r) => rankByTradeId.set(r.tradeId, r.rank));
        items = items.map((it) => ({
          ...it,
          sellOrderRank: rankByTradeId.get(it.tradeId) ?? it.sellOrderRank,
        }));

        const cashConversionTimeline = round0(clampNum(
          aiMax.cashConversionTimeline,
          TIMELINE_MIN, TIMELINE_MAX,
          maximization.cashConversionTimeline,
        ));

        // cashFlowOptimizationActions
        const cashFlowOptimizationActions: CashFlowOptimizationAction[] = [];
        if (Array.isArray(aiMax.cashFlowOptimizationActions)) {
          for (const a of aiMax.cashFlowOptimizationActions.slice(0, 5)) {
            if (!a || typeof a !== 'object') continue;
            cashFlowOptimizationActions.push({
              action: clampString(a.action, 200, 'Cash flow akcija.'),
              priority: clampEnum(a.priority, VALID_PRIORITY, 'MEDIUM'),
              cashImpact: round0(clampNum(
                a.cashImpact,
                IMPACT_MIN, IMPACT_MAX, 0,
              )),
            });
          }
        }
        if (cashFlowOptimizationActions.length === 0) {
          for (const a of maximization.cashFlowOptimizationActions) cashFlowOptimizationActions.push(a);
        }

        // capitalRecyclingPlan
        const capitalRecyclingPlan: CapitalRecyclingEntry[] = [];
        if (Array.isArray(aiMax.capitalRecyclingPlan)) {
          for (const r of aiMax.capitalRecyclingPlan.slice(0, 4)) {
            if (!r || typeof r !== 'object') continue;
            capitalRecyclingPlan.push({
              category: clampString(r.category, 80, 'Drugo'),
              amount: round0(clampNum(
                r.amount,
                AMOUNT_MIN, AMOUNT_MAX, 0,
              )),
              expectedROI: round0(clampNum(
                r.expectedROI,
                ROI_MIN, ROI_MAX, 50,
              )),
            });
          }
        }
        if (capitalRecyclingPlan.length === 0) {
          for (const c of maximization.capitalRecyclingPlan) capitalRecyclingPlan.push(c);
        }

        const cashConversionGrade = clampEnum(
          aiMax.cashConversionGrade,
          VALID_GRADE,
          maximization.cashConversionGrade,
        );

        // Recompute projectedCashRecovery and totalProfitIfConverted from items
        const projectedCashRecovery = computeProjectedCashRecovery(
          items.map((it) => ({
            item: it,
            daysHeld: detByTradeId.get(it.tradeId)?.daysHeld ?? 0,
            isDeclining: detByTradeId.get(it.tradeId)?.isDeclining ?? false,
          })),
        );
        const totalProfitIfConverted = computeTotalProfitIfConverted(
          items.map((it) => ({
            item: it,
            daysHeld: detByTradeId.get(it.tradeId)?.daysHeld ?? 0,
            isDeclining: detByTradeId.get(it.tradeId)?.isDeclining ?? false,
          })),
        );

        maximization = {
          optimalSellOrder,
          projectedCashRecovery,
          cashConversionTimeline,
          cashFlowOptimizationActions,
          capitalRecyclingPlan,
          cashConversionGrade,
          totalProfitIfConverted,
        };

        summary = clampString(parsed.summary, 400, buildSummary(detItems, maximization));
        aiUsed = true;
      }
    } catch (err) {
      logger.warn(
        '/api/ai/inventory-cash-conversion-maximizer',
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
      items,
      maximization,
      summary,
      aiUsed,
    } satisfies InventoryCashConversionResponse);
  } catch (err: any) {
    logger.error(
      '/api/ai/inventory-cash-conversion-maximizer',
      'handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
