// v8.66: Smart Pricing Recommender — data-driven sell price suggestion.
// "I have Sony A7III bought for 800€. What price should I list it for?"
//
// Inputs:
//   - Held trade (cost, days held, category, tags)
//   - Comparable sold trades (same category, similar price range)
//   - Monthly profit goal progress (behind = more aggressive)
//
// Output:
//   - suggestedMin / suggestedMax / suggestedOptimal (EUR)
//   - confidence (0-100)
//   - reasoning[] (Slovenian explanations)
//   - comparables[] (the sold trades used for reference)

import { db } from '@/lib/db';
import { parseTags } from '@/app/api/trades/route';

export interface ComparableSale {
  title: string;
  category: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  roiPercent: number;
  daysHeld: number;
  sellDate: string | null;
}

export interface SmartPriceReason {
  kind: 'category_avg_roi' | 'comparable_avg' | 'days_held_discount' | 'tag_star_premium' | 'tag_underperformer_discount' | 'goal_pressure' | 'recent_market_trend' | 'insufficient_data';
  label: string;
  impact: number; // EUR delta applied to base
}

export interface SmartPriceResult {
  tradeId: string;
  title: string;
  category: string;
  cost: number; // buyPrice + buyFees
  daysHeld: number;
  tags: string[];
  // The suggested price range
  suggestedMin: number;       // floor — below this = loss or below target ROI
  suggestedMax: number;       // ceiling — above this = unrealistic, won't sell
  suggestedOptimal: number;   // sweet spot — best balance of profit + sell-through probability
  // Expected outcomes at optimal
  expectedProfit: number;
  expectedROI: number; // %
  // Confidence
  confidence: number; // 0-100 — based on # of comparables + data quality
  confidenceLabel: 'HIGH' | 'MEDIUM' | 'LOW';
  // Explanation
  reasoning: SmartPriceReason[];
  comparables: ComparableSale[]; // sold trades used as reference (max 5)
  // Goal context
  monthlyGoalProgress: number | null; // % — null if no goal set
  source: 'v8.66-smart-pricing';
}

export interface SmartPriceList {
  ok: true;
  count: number;
  results: SmartPriceResult[];
  source: 'v8.66-smart-pricing';
}

/**
 * Compute a smart sell price suggestion for a single held trade.
 *
 * Strategy:
 *   1. Base price = cost × (1 + targetROI/100), where targetROI = max(15%, categoryAvgROI - 5%)
 *      (slightly below category avg to ensure sell-through)
 *   2. Adjust for days held: >30d = -3% per additional 10 days (max -15%)
 *   3. STAR tag → +5% premium
 *   4. UNDERPERFORMER tag → -10% (sell fast)
 *   5. Goal pressure: if behind monthly goal <50% → -5% (price to sell)
 *   6. Clamp to [cost × 1.05, cost × 2.0] — never suggest below 5% profit, never suggest >100% ROI
 *
 * suggestedMin = cost × 1.05 (minimum acceptable — 5% profit)
 * suggestedMax = cost × 2.0 (max realistic)
 * suggestedOptimal = base + adjustments, clamped to [min, max]
 */
export function computeSmartPrice(
  trade: {
    id: string;
    title: string;
    category: string;
    tags?: string | null;
    buyPrice: number;
    buyFees?: number | null;
    buyDate: string | Date;
  },
  context: {
    categoryAvgROI?: number | null;     // % — from sold trades in same category
    comparables?: ComparableSale[];      // similar sold trades
    monthlyGoalProgress?: number | null; // % — 0-100, current month vs goal
  } = {}
): SmartPriceResult {
  const tags = parseTags(trade.tags);
  const cost = trade.buyPrice + (trade.buyFees ?? 0);
  const now = new Date();
  const buyDate = new Date(trade.buyDate);
  const daysHeld = Math.max(0, Math.floor((now.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));

  const reasoning: SmartPriceReason[] = [];
  const comparables = (context.comparables ?? []).slice(0, 5);

  // --- Step 1: Base price from target ROI ---
  // Target ROI: slightly below category avg to ensure sell-through
  const categoryAvgROI = context.categoryAvgROI ?? null;
  const targetROI = categoryAvgROI != null
    ? Math.max(15, categoryAvgROI - 5)
    : 25; // fallback: 25% baseline ROI for reselling

  let basePrice = cost * (1 + targetROI / 100);

  if (categoryAvgROI != null) {
    reasoning.push({
      kind: 'category_avg_roi',
      label: `Ciljni ROI ${targetROI.toFixed(0)}% (kategorija povprečje ${categoryAvgROI.toFixed(0)}% − 5% za hitro prodajo)`,
      impact: 0, // base
    });
  } else {
    reasoning.push({
      kind: 'insufficient_data',
      label: `Brez podatkov za kategorijo — uporabljam privzeti 25% ROI`,
      impact: 0,
    });
  }

  // --- Step 2: Comparable sales anchor ---
  if (comparables.length > 0) {
    const avgSellPrice = comparables.reduce((s, c) => s + c.sellPrice, 0) / comparables.length;
    const avgROI = comparables.reduce((s, c) => s + c.roiPercent, 0) / comparables.length;
    // Blend: 60% base (target ROI), 40% comparable avg
    const blended = basePrice * 0.6 + avgSellPrice * 0.4;
    const delta = blended - basePrice;
    basePrice = blended;
    reasoning.push({
      kind: 'comparable_avg',
      label: `${comparables.length} podobnih prodaj (avg ${avgSellPrice.toFixed(0)}€, ${avgROI.toFixed(0)}% ROI)`,
      impact: Math.round(delta),
    });
  }

  // --- Step 3: Days held discount ---
  // After 30 days, discount 3% per additional 10 days (max 15%)
  if (daysHeld > 30) {
    const extraDays = daysHeld - 30;
    const discountPct = Math.min(15, Math.floor(extraDays / 10) * 3);
    const discount = basePrice * (discountPct / 100);
    basePrice -= discount;
    reasoning.push({
      kind: 'days_held_discount',
      label: `${daysHeld} dni v skladišču → ${discountPct}% popust za hitro prodajo`,
      impact: -Math.round(discount),
    });
  }

  // --- Step 4: Tag adjustments ---
  if (tags.includes('hitri-flip') || tags.includes('star')) {
    const premium = basePrice * 0.05;
    basePrice += premium;
    reasoning.push({
      kind: 'tag_star_premium',
      label: 'STAR tag → +5% premium (visoka donosnost kategorije)',
      impact: Math.round(premium),
    });
  }
  if (tags.includes('izguba') || tags.includes('underperformer')) {
    const discount = basePrice * 0.10;
    basePrice -= discount;
    reasoning.push({
      kind: 'tag_underperformer_discount',
      label: 'UNDERPERFORMER tag → -10% (prodaj hitro, omeji izgubo)',
      impact: -Math.round(discount),
    });
  }

  // --- Step 5: Goal pressure ---
  const goalProgress = context.monthlyGoalProgress ?? null;
  if (goalProgress != null && goalProgress < 50) {
    const discount = basePrice * 0.05;
    basePrice -= discount;
    reasoning.push({
      kind: 'goal_pressure',
      label: `Za ciljem (${goalProgress.toFixed(0)}% mesečnega cilja) → -5% za hitro sprostitev casha`,
      impact: -Math.round(discount),
    });
  }

  // --- Clamp ---
  const minPrice = cost * 1.05;
  const maxPrice = cost * 2.0;
  const optimal = Math.max(minPrice, Math.min(maxPrice, Math.round(basePrice)));

  const expectedProfit = optimal - cost;
  const expectedROI = cost > 0 ? (expectedProfit / cost) * 100 : 0;

  // --- Confidence ---
  let confidence = 30; // base
  if (comparables.length >= 5) confidence += 40;
  else if (comparables.length >= 3) confidence += 30;
  else if (comparables.length >= 1) confidence += 15;
  if (categoryAvgROI != null) confidence += 20;
  if (tags.length > 0) confidence += 10;
  confidence = Math.min(100, confidence);

  const confidenceLabel: SmartPriceResult['confidenceLabel'] =
    confidence >= 70 ? 'HIGH' : confidence >= 40 ? 'MEDIUM' : 'LOW';

  return {
    tradeId: trade.id,
    title: trade.title,
    category: trade.category,
    cost,
    daysHeld,
    tags,
    suggestedMin: Math.round(minPrice),
    suggestedMax: Math.round(maxPrice),
    suggestedOptimal: optimal,
    expectedProfit: Math.round(expectedProfit * 100) / 100,
    expectedROI: Math.round(expectedROI * 100) / 100,
    confidence,
    confidenceLabel,
    reasoning,
    comparables,
    monthlyGoalProgress: goalProgress,
    source: 'v8.66-smart-pricing',
  };
}

/**
 * Compute smart price for a single held trade by ID.
 * Fetches context (comparables, category avg ROI, goal progress).
 */
export async function getSmartPriceForTrade(tradeId: string): Promise<SmartPriceResult | null> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true, title: true, category: true, tags: true,
      buyPrice: true, buyFees: true, buyDate: true, status: true,
    },
  });
  if (!trade) return null;

  // Fetch comparable sold trades: same category, similar price range (±50%)
  const cost = trade.buyPrice + (trade.buyFees ?? 0);
  const comparablesRaw = await db.trade.findMany({
    where: {
      status: 'sold',
      sellPrice: { not: null },
      category: trade.category,
      buyPrice: { gte: cost * 0.5, lte: cost * 2.0 },
    },
    select: {
      title: true, category: true, buyPrice: true, buyFees: true,
      sellPrice: true, sellFees: true, buyDate: true, sellDate: true,
    },
    orderBy: { sellDate: 'desc' },
    take: 10,
  });

  const comparables: ComparableSale[] = comparablesRaw.map(t => {
    const tCost = t.buyPrice + (t.buyFees ?? 0);
    const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    const profit = revenue - tCost;
    const roi = tCost > 0 ? (profit / tCost) * 100 : 0;
    const daysHeld = t.sellDate && t.buyDate
      ? Math.max(0, Math.floor((new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    return {
      title: t.title,
      category: t.category,
      buyPrice: t.buyPrice,
      sellPrice: t.sellPrice ?? 0,
      profit: Math.round(profit * 100) / 100,
      roiPercent: Math.round(roi * 100) / 100,
      daysHeld,
      sellDate: t.sellDate ? t.sellDate.toISOString() : null,
    };
  });

  // Compute category avg ROI
  const allCategorySold = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, category: trade.category },
    select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
  });
  let categoryAvgROI: number | null = null;
  if (allCategorySold.length > 0) {
    const rois = allCategorySold.map(t => {
      const c = t.buyPrice + (t.buyFees ?? 0);
      const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return c > 0 ? ((r - c) / c) * 100 : 0;
    });
    categoryAvgROI = rois.reduce((s, r) => s + r, 0) / rois.length;
  }

  // Goal progress
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { monthlyProfitGoal: true },
  });
  let goalProgress: number | null = null;
  if (settings?.monthlyProfitGoal && settings.monthlyProfitGoal > 0) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const soldThisMonth = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: monthStart } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
    });
    const realized = soldThisMonth.reduce((s, t) => {
      const c = t.buyPrice + (t.buyFees ?? 0);
      const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return s + (r - c);
    }, 0);
    goalProgress = (realized / settings.monthlyProfitGoal) * 100;
  }

  return computeSmartPrice(
    {
      id: trade.id,
      title: trade.title,
      category: trade.category || 'drugo',
      tags: trade.tags,
      buyPrice: trade.buyPrice,
      buyFees: trade.buyFees ?? 0,
      buyDate: trade.buyDate,
    },
    {
      categoryAvgROI,
      comparables,
      monthlyGoalProgress: goalProgress,
    }
  );
}

/**
 * Compute smart prices for all held trades (batch).
 */
export async function getSmartPricesForAllHeld(): Promise<SmartPriceList> {
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: { id: true },
  });

  const results: SmartPriceResult[] = [];
  for (const t of heldTrades) {
    const r = await getSmartPriceForTrade(t.id);
    if (r) results.push(r);
  }

  return {
    ok: true,
    count: results.length,
    results,
    source: 'v8.66-smart-pricing',
  };
}
