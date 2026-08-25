// v8.44: Smart Restock Recommendations — combines v8.40 Trade Insights + current
// inventory to generate actionable "buy next" recommendations.
// "KAJ naj kupim naslednje za maksimalen profit?"
//
// Pure compute reading from Trade table — no AI/LLM SDK.
// Reuses v8.40 `getTradeInsights(365)` for historical performance per category
// and source platform, then layers on top of currently-held inventory:
//
//   1. For each historical category, compute:
//        - historical ROI / win rate / avg hold / total trades / total profit
//        - current heldCount + heldValue (status='held')
//        - action: RESTOCK | MAINTAIN | REDUCE | AVOID | NEW
//        - projected profit / ROI / hold days (based on historical avg per trade)
//        - best source for this category + best source ROI
//        - suggested buy price range = [min buyPrice, max buyPrice] of historical trades
//   2. Generate top 5 "buy next" recommendations (RESTOCK + NEW only),
//      sorted by projectedProfit × confidence weight
//   3. Identify inventory gaps (profitable categories with 0 held items)
//   4. Identify overstock warnings (categories with >3 held items → aging risk)
//
// Used by:
//   - GET /api/ai/restock-smart → RestockResult
//   - Dashboard RestockRecommendationsCard (top 5 cards + category table +
//     inventory gaps + overstock warnings + auto-refresh 60s)

import { db } from '@/lib/db';
import { getTradeInsights } from './trade-insights';

// ─── Public types ───────────────────────────────────────────────────────────

export interface CategoryRecommendation {
  category: string;
  // Historical performance (from v8.40 Trade Insights)
  historicalROI: number;
  historicalWinRate: number;
  avgHoldDays: number;
  totalTrades: number;
  totalProfit: number;
  // Current inventory
  heldCount: number;
  heldValue: number;
  // Recommendation
  action: 'RESTOCK' | 'MAINTAIN' | 'REDUCE' | 'AVOID' | 'NEW';
  reason: string;
  // Projected metrics if restocked (based on historical avg per trade)
  projectedProfit: number;
  projectedROI: number;
  projectedHoldDays: number;
  // Best source for this category (source with highest ROI among trades in this category)
  bestSource: string;
  bestSourceROI: number;
  // Suggested buy price range (min–max of historical buy prices in this category)
  suggestedBuyPriceRange: { min: number; max: number };
}

export interface RestockRecommendation {
  rank: number;
  category: string;
  action: 'RESTOCK' | 'NEW';
  title: string; // human-readable, e.g. "🟢 RESTOCK: elektronika"
  reason: string;
  suggestedBuyPriceRange: { min: number; max: number };
  projectedProfit: number;
  projectedROI: number;
  projectedHoldDays: number;
  bestSource: string;
  historicalWinRate: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface RestockResult {
  ok: true;
  recommendations: RestockRecommendation[]; // top 5
  categoryStatus: CategoryRecommendation[]; // all categories (sorted by action priority then ROI)
  inventoryGaps: string[]; // categories with 0 held but profitable
  overstockWarnings: string[]; // categories with too many held (aging risk)
  summary: {
    totalCategories: number;
    restockRecommended: number;
    maintainCount: number;
    reduceCount: number;
    avoidCount: number;
    newOpportunities: number;
  };
  source: 'v8.44-restock-recommendations';
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Round to 2 decimal places (EUR precision). */
function r2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Action priority for sorting categoryStatus (lower = higher priority)
const ACTION_PRIORITY: Record<CategoryRecommendation['action'], number> = {
  RESTOCK: 0,
  NEW: 1,
  MAINTAIN: 2,
  REDUCE: 3,
  AVOID: 4,
};

// Confidence weight for top-N ranking (multiplies projectedProfit)
const CONFIDENCE_WEIGHT: Record<RestockRecommendation['confidence'], number> = {
  HIGH: 1.0,
  MEDIUM: 0.7,
  LOW: 0.4,
};

// ─── Main ──────────────────────────────────────────────────────────────────

/**
 * Generate "buy next" recommendations by combining v8.40 Trade Insights +
 * current held inventory.
 *
 * Decision matrix per category:
 *   - RESTOCK: heldCount === 0 AND historicalROI > 15% AND winRate > 70%
 *   - MAINTAIN: heldCount 1–3 AND historicalROI > 15%
 *   - REDUCE: heldCount > 3 (overstock risk — aging inventory)
 *   - AVOID: historicalROI < 0 OR winRate < 40%
 *   - NEW: profitable category with no historical trades in scope (skip —
 *          no signal yet; reserved for future "explore new category" feature)
 *
 * Confidence:
 *   - HIGH: ≥5 trades AND winRate ≥80%
 *   - MEDIUM: ≥3 trades AND winRate ≥60%
 *   - LOW: <3 trades OR winRate <60%
 *
 * Top 5 ranking: recommendations sorted by projectedProfit × confidence weight.
 */
export async function getRestockRecommendations(): Promise<RestockResult> {
  // 1. v8.40 Trade Insights (365-day lookback for solid historical signal)
  const insights = await getTradeInsights(365);

  // 2. Currently-held trades (current inventory per category)
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: {
      id: true,
      category: true,
      buyPrice: true,
      buyFees: true,
      buyDate: true,
    },
  });

  // Aggregate held per category
  const heldByCat = new Map<
    string,
    { count: number; value: number; oldestBuyDateMs: number }
  >();
  const now = Date.now();
  for (const t of heldTrades) {
    const cat = (t.category ?? '').trim() || 'brez kategorije';
    const invested = t.buyPrice + (t.buyFees ?? 0);
    const buyMs = new Date(t.buyDate).getTime() || now;
    const prev = heldByCat.get(cat) ?? { count: 0, value: 0, oldestBuyDateMs: buyMs };
    prev.count += 1;
    prev.value += invested;
    prev.oldestBuyDateMs = Math.min(prev.oldestBuyDateMs, buyMs);
    heldByCat.set(cat, prev);
  }

  // 3. Fetch historical buy price range per category + best source per category
  //    (these aren't in v8.40 insights, so we run a focused query)
  const soldTrades = await db.trade.findMany({
    where: { status: 'sold' },
    select: {
      id: true,
      category: true,
      buyPrice: true,
      buyFees: true,
      buyLocation: true,
      sellPrice: true,
      sellFees: true,
      sellDate: true,
      buyDate: true,
    },
    orderBy: { sellDate: 'desc' },
    take: 500,
  });

  interface CatAgg {
    buyPrices: number[];
    sources: Map<string, { invested: number; profit: number }>;
  }
  const catAgg = new Map<string, CatAgg>();
  for (const t of soldTrades) {
    const cat = (t.category ?? '').trim() || 'brez kategorije';
    const buyPrice = t.buyPrice + (t.buyFees ?? 0);
    const profit =
      (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0);
    const agg = catAgg.get(cat) ?? {
      buyPrices: [],
      sources: new Map<string, { invested: number; profit: number }>(),
    };
    agg.buyPrices.push(buyPrice);
    const src = (t.buyLocation ?? '').trim() || 'Neznano';
    const prevSrc = agg.sources.get(src) ?? { invested: 0, profit: 0 };
    prevSrc.invested += buyPrice;
    prevSrc.profit += profit;
    agg.sources.set(src, prevSrc);
    catAgg.set(cat, agg);
  }

  // 4. Build category status list (one entry per historical category)
  const categoryStatus: CategoryRecommendation[] = [];

  for (const catIns of insights.categoryAnalysis) {
    const category = catIns.category;
    const held = heldByCat.get(category) ?? {
      count: 0,
      value: 0,
      oldestBuyDateMs: now,
    };

    // Historical metrics from v8.40 insights
    const historicalROI = catIns.avgROI;
    const historicalWinRate = catIns.winRate;
    const avgHoldDays = catIns.avgHoldDays;
    const totalTrades = catIns.tradeCount;
    const totalProfit = catIns.totalProfit;

    // Projected metrics (one new trade based on historical avg)
    const projectedProfit = catIns.avgProfit;
    const projectedROI = catIns.avgROI;
    const projectedHoldDays = catIns.avgHoldDays;

    // Buy price range from historical trades
    const agg = catAgg.get(category);
    let priceMin = 0;
    let priceMax = 0;
    if (agg && agg.buyPrices.length > 0) {
      priceMin = r2(Math.min(...agg.buyPrices));
      priceMax = r2(Math.max(...agg.buyPrices));
    }

    // Best source for this category (highest ROI among sources that sold in this cat)
    let bestSource = 'Neznano';
    let bestSourceROI = 0;
    if (agg && agg.sources.size > 0) {
      let bestProfit = -Infinity;
      for (const [src, s] of agg.sources) {
        const roi = s.invested > 0 ? r2((s.profit / s.invested) * 100) : 0;
        if (roi > bestSourceROI || bestProfit === -Infinity) {
          // Pick by ROI primarily; tie-break by absolute profit
          if (roi > bestSourceROI || (roi === bestSourceROI && s.profit > bestProfit)) {
            bestSourceROI = roi;
            bestSource = src;
            bestProfit = s.profit;
          }
        }
      }
    }

    // Determine action
    let action: CategoryRecommendation['action'];
    let reason: string;

    if (historicalROI < 0 || historicalWinRate < 40) {
      action = 'AVOID';
      reason = `ROI ${historicalROI.toFixed(0)}%, win rate ${historicalWinRate.toFixed(0)}% — izgublja denar ali preveč tveganja.`;
    } else if (held.count > 3) {
      action = 'REDUCE';
      const ageDays = Math.floor((now - held.oldestBuyDateMs) / 86_400_000);
      reason = `${held.count} held items — aging risk (najstarejši ${ageDays}d). Najprej prodaj obstoječi stock.`;
    } else if (held.count === 0 && historicalROI > 15 && historicalWinRate > 70) {
      action = 'RESTOCK';
      reason = `0 held + ${historicalROI.toFixed(0)}% ROI + ${historicalWinRate.toFixed(0)}% win rate — primerna kategorija za ponovni nakup.`;
    } else if (held.count >= 1 && held.count <= 3 && historicalROI > 15) {
      action = 'MAINTAIN';
      reason = `${held.count} held, ${historicalROI.toFixed(0)}% ROI — vzdržuj trenutni nivo stocka.`;
    } else {
      // Fallback: not enough signal for restock but not actively losing money
      action = 'MAINTAIN';
      reason = `${held.count} held, ${historicalROI.toFixed(0)}% ROI — spremljaj in dopolnjuj po potrebi.`;
    }

    categoryStatus.push({
      category,
      historicalROI,
      historicalWinRate,
      avgHoldDays,
      totalTrades,
      totalProfit,
      heldCount: held.count,
      heldValue: r2(held.value),
      action,
      reason,
      projectedProfit,
      projectedROI,
      projectedHoldDays,
      bestSource,
      bestSourceROI,
      suggestedBuyPriceRange: { min: priceMin, max: priceMax },
    });
  }

  // 5. Determine confidence per category
  function confidenceOf(
    trades: number,
    winRate: number,
  ): RestockRecommendation['confidence'] {
    if (trades >= 5 && winRate >= 80) return 'HIGH';
    if (trades >= 3 && winRate >= 60) return 'MEDIUM';
    return 'LOW';
  }

  // 6. Generate top 5 RESTOCK + NEW recommendations
  //    (Only RESTOCK actionable here — NEW category would need external market
  //    signal not in our DB. We include RESTOCK only, sorted by weighted
  //    projected profit.)
  const recommendations: RestockRecommendation[] = categoryStatus
    .filter((c) => c.action === 'RESTOCK')
    .map((c) => {
      const confidence = confidenceOf(c.totalTrades, c.historicalWinRate);
      const actionLabel: 'RESTOCK' | 'NEW' = 'RESTOCK';
      return {
        rank: 0, // assigned after sort
        category: c.category,
        action: actionLabel,
        title: `🟢 RESTOCK: ${c.category}`,
        reason: c.reason,
        suggestedBuyPriceRange: c.suggestedBuyPriceRange,
        projectedProfit: c.projectedProfit,
        projectedROI: c.projectedROI,
        projectedHoldDays: c.projectedHoldDays,
        bestSource: c.bestSource,
        historicalWinRate: c.historicalWinRate,
        confidence,
      };
    })
    .sort((a, b) => {
      const wa = a.projectedProfit * CONFIDENCE_WEIGHT[a.confidence];
      const wb = b.projectedProfit * CONFIDENCE_WEIGHT[b.confidence];
      if (wb !== wa) return wb - wa;
      // Tie-break: higher ROI
      return b.projectedROI - a.projectedROI;
    })
    .slice(0, 5)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // 7. Inventory gaps: profitable categories with 0 held items
  const inventoryGaps = categoryStatus
    .filter(
      (c) =>
        c.heldCount === 0 &&
        c.historicalROI > 0 &&
        c.action !== 'AVOID',
    )
    .map((c) => c.category);

  // 8. Overstock warnings: categories with >3 held items (aging risk)
  const overstockWarnings = categoryStatus
    .filter((c) => c.heldCount > 3)
    .map((c) => `${c.category} (${c.heldCount} items, aging risk)`);

  // 9. Summary
  const summary = {
    totalCategories: categoryStatus.length,
    restockRecommended: categoryStatus.filter((c) => c.action === 'RESTOCK').length,
    maintainCount: categoryStatus.filter((c) => c.action === 'MAINTAIN').length,
    reduceCount: categoryStatus.filter((c) => c.action === 'REDUCE').length,
    avoidCount: categoryStatus.filter((c) => c.action === 'AVOID').length,
    newOpportunities: categoryStatus.filter((c) => c.action === 'NEW').length,
  };

  // Sort categoryStatus: action priority first, then ROI desc
  categoryStatus.sort((a, b) => {
    const pa = ACTION_PRIORITY[a.action];
    const pb = ACTION_PRIORITY[b.action];
    if (pa !== pb) return pa - pb;
    return b.historicalROI - a.historicalROI;
  });

  return {
    ok: true,
    recommendations,
    categoryStatus,
    inventoryGaps,
    overstockWarnings,
    summary,
    source: 'v8.44-restock-recommendations',
  };
}
