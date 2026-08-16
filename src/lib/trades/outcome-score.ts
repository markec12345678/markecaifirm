// v8.67: Trade Outcome Scorecard — post-sale quality analysis for sold trades.
// "Did I sell at the right price and the right time? How much did I leave on the table?"
//
// Closes the sell decision loop:
//   v8.65 (WHEN to sell) + v8.66 (HOW MUCH) + v8.67 (was it right?) = complete intelligence.
//
// Scores each completed sale on 3 dimensions (0-100 each):
//   - pricingScore: actual sellPrice vs. what smart-pricing would have suggested
//   - timingScore:  actual hold days vs. category optimal hold window
//   - outcomeScore: profit + ROI + win/loss
//
// Verdict: PERFECT / GOOD / ACCEPTABLE / SUBOPTIMAL / LOSS

import { db } from '@/lib/db';
import { parseTags } from '@/app/api/trades/route';
import { computeSmartPrice } from '@/lib/trades/smart-pricing';

export interface OutcomeReason {
  kind: 'priced_above_smart' | 'priced_below_smart' | 'priced_in_range' | 'timing_optimal' | 'timing_too_fast' | 'timing_too_slow' | 'high_profit' | 'low_margin' | 'loss' | 'beat_market' | 'below_market';
  label: string;
  impact: number;
}

export interface OutcomeResult {
  tradeId: string;
  title: string;
  category: string;
  tags: string[];
  // Actual outcome
  buyPrice: number;
  buyFees: number;
  sellPrice: number;
  sellFees: number;
  cost: number;
  revenue: number;
  profit: number;
  roiPercent: number;
  daysHeld: number;
  sellDate: string | null;
  // Smart price context (what v8.66 would have suggested)
  smartPriceOptimal: number | null;
  smartPriceRange: { min: number; max: number } | null;
  // Scores 0-100
  pricingScore: number;      // actual sellPrice vs smart price range
  timingScore: number;       // hold days vs category optimal
  outcomeScore: number;      // profit/ROI quality
  overallScore: number;      // weighted average
  // Verdict
  verdict: 'PERFECT' | 'GOOD' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'LOSS';
  // Money left on table (positive = underpriced, negative = overpriced/lucky)
  leftOnTable: number;
  // Explanation
  reasoning: OutcomeReason[];
  // Lessons learned (Slovenian actionable)
  lessons: string[];
  source: 'v8.67-outcome-score';
}

export interface OutcomeSummary {
  ok: true;
  totalSold: number;
  perfect: number;
  good: number;
  acceptable: number;
  suboptimal: number;
  loss: number;
  // Aggregate stats
  avgPricingScore: number;
  avgTimingScore: number;
  avgOutcomeScore: number;
  avgOverallScore: number;
  totalLeftOnTable: number;       // EUR — sum of underpricing
  totalExtraGained: number;        // EUR — sum of overpricing (lucky)
  avgLeftOnTable: number;
  bestOutcome: OutcomeResult | null;
  worstOutcome: OutcomeResult | null;
  // Top lessons (most common patterns)
  topLessons: string[];
  source: 'v8.67-outcome-score';
}

/**
 * Compute outcome score for a single sold trade.
 * Pure compute — uses computeSmartPrice from v8.66 for pricing reference.
 */
export function computeOutcomeScore(
  trade: {
    id: string;
    title: string;
    category: string;
    tags?: string | null;
    buyPrice: number;
    buyFees?: number | null;
    buyDate: string | Date;
    sellPrice: number;
    sellFees?: number | null;
    sellDate: string | Date;
  },
  context: {
    categoryAvgROI?: number | null;
    categoryAvgHoldDays?: number | null;
    comparables?: Array<{ sellPrice: number; roiPercent: number }>;
  } = {}
): OutcomeResult {
  const tags = parseTags(trade.tags);
  const cost = trade.buyPrice + (trade.buyFees ?? 0);
  const revenue = trade.sellPrice - (trade.sellFees ?? 0);
  const profit = revenue - cost;
  const roiPercent = cost > 0 ? (profit / cost) * 100 : 0;
  const daysHeld = Math.max(0, Math.floor((new Date(trade.sellDate).getTime() - new Date(trade.buyDate).getTime()) / (1000 * 60 * 60 * 24)));

  const reasoning: OutcomeReason[] = [];

  // --- Compute smart price (what v8.66 would have suggested) ---
  const smart = computeSmartPrice(
    {
      id: trade.id,
      title: trade.title,
      category: trade.category,
      tags: trade.tags,
      buyPrice: trade.buyPrice,
      buyFees: trade.buyFees ?? 0,
      buyDate: trade.buyDate,
    },
    {
      categoryAvgROI: context.categoryAvgROI,
      comparables: context.comparables?.map(c => ({
        title: '', category: trade.category, buyPrice: 0, sellPrice: c.sellPrice,
        profit: 0, roiPercent: c.roiPercent, daysHeld: 0, sellDate: null,
      })),
    }
  );

  const smartPriceOptimal = smart.suggestedOptimal;
  const smartPriceRange = { min: smart.suggestedMin, max: smart.suggestedMax };

  // --- Pricing Score (0-100) ---
  // How well did the actual sell price match the smart price?
  let pricingScore: number;
  let leftOnTable: number;
  if (trade.sellPrice >= smartPriceRange.max) {
    // Sold at or above max — excellent pricing (or lucky)
    pricingScore = 100;
    leftOnTable = -(trade.sellPrice - smartPriceOptimal); // negative = extra gained
    reasoning.push({
      kind: 'priced_above_smart',
      label: `Prodano ${trade.sellPrice}€ ≥ max pametno ceno ${smartPriceRange.max}€ (+${(trade.sellPrice - smartPriceOptimal).toFixed(0)}€ nad optimalno)`,
      impact: 0,
    });
  } else if (trade.sellPrice >= smartPriceOptimal) {
    // Sold between optimal and max — good pricing
    const ratio = (trade.sellPrice - smartPriceOptimal) / Math.max(1, smartPriceRange.max - smartPriceOptimal);
    pricingScore = 75 + Math.round(ratio * 25);
    leftOnTable = -(trade.sellPrice - smartPriceOptimal);
    reasoning.push({
      kind: 'priced_in_range',
      label: `Prodano ${trade.sellPrice}€ v optimalnem obsegu (${smartPriceOptimal}-${smartPriceRange.max}€)`,
      impact: 0,
    });
  } else if (trade.sellPrice >= smartPriceRange.min) {
    // Sold between min and optimal — acceptable but left money on table
    const ratio = (trade.sellPrice - smartPriceRange.min) / Math.max(1, smartPriceOptimal - smartPriceRange.min);
    pricingScore = 50 + Math.round(ratio * 25);
    leftOnTable = smartPriceOptimal - trade.sellPrice;
    reasoning.push({
      kind: 'priced_in_range',
      label: `Prodano ${trade.sellPrice}€ pod optimalno ${smartPriceOptimal}€ (pustil ${leftOnTable.toFixed(0)}€ na mizi)`,
      impact: -Math.round(leftOnTable),
    });
  } else {
    // Sold below min — underpriced
    pricingScore = Math.max(0, 50 - Math.round((smartPriceRange.min - trade.sellPrice) / Math.max(1, smartPriceRange.min) * 100));
    leftOnTable = smartPriceOptimal - trade.sellPrice;
    reasoning.push({
      kind: 'priced_below_smart',
      label: `Prodano ${trade.sellPrice}€ < min pametno ceno ${smartPriceRange.min}€ (pustil ${leftOnTable.toFixed(0)}€ na mizi)`,
      impact: -Math.round(leftOnTable),
    });
  }

  // --- Timing Score (0-100) ---
  // Compare hold days to category average
  const avgHold = context.categoryAvgHoldDays ?? null;
  let timingScore: number;
  if (avgHold != null && avgHold > 0) {
    const ratio = daysHeld / avgHold;
    if (ratio <= 1.5 && ratio >= 0.5) {
      // Within optimal window (50%-150% of avg)
      timingScore = 100;
      reasoning.push({
        kind: 'timing_optimal',
        label: `Hold ${daysHeld}d v optimalnem oknu (avg ${avgHold.toFixed(0)}d za kategorijo)`,
        impact: 0,
      });
    } else if (ratio < 0.5) {
      // Sold too fast (might have left profit on table)
      timingScore = 60;
      reasoning.push({
        kind: 'timing_too_fast',
        label: `Hold ${daysHeld}d prekratek (avg ${avgHold.toFixed(0)}d) — morda prehitro prodano`,
        impact: -10,
      });
    } else if (ratio <= 2.0) {
      // Slightly too slow
      timingScore = 70;
      reasoning.push({
        kind: 'timing_too_slow',
        label: `Hold ${daysHeld}d nekoliko predolg (avg ${avgHold.toFixed(0)}d)`,
        impact: -5,
      });
    } else {
      // Much too slow — capital was tied up
      timingScore = Math.max(20, 70 - Math.round((ratio - 2) * 15));
      reasoning.push({
        kind: 'timing_too_slow',
        label: `Hold ${daysHeld}d preveč predolg (${ratio.toFixed(1)}x povprečja ${avgHold.toFixed(0)}d)`,
        impact: -20,
      });
    }
  } else {
    timingScore = 50; // no data
  }

  // --- Outcome Score (0-100) ---
  // Based on profit + ROI quality
  let outcomeScore: number;
  if (profit < 0) {
    // Loss
    outcomeScore = Math.max(0, 30 + Math.round(roiPercent / 2)); // closer to 0 = worse
    reasoning.push({
      kind: 'loss',
      label: `Izguba ${profit.toFixed(0)}€ (${roiPercent.toFixed(0)}% ROI)`,
      impact: -30,
    });
  } else if (roiPercent < 15) {
    // Low margin
    outcomeScore = 50 + Math.round(roiPercent);
    reasoning.push({
      kind: 'low_margin',
      label: `Nizek dobiček ${profit.toFixed(0)}€ (${roiPercent.toFixed(0)}% ROI)`,
      impact: -10,
    });
  } else if (roiPercent >= 50) {
    // Excellent profit
    outcomeScore = 100;
    reasoning.push({
      kind: 'high_profit',
      label: `Odličen dobiček +${profit.toFixed(0)}€ (${roiPercent.toFixed(0)}% ROI)`,
      impact: 20,
    });
  } else {
    // Good profit (15-50% ROI)
    outcomeScore = 70 + Math.round((roiPercent - 15) * 0.9);
    reasoning.push({
      kind: 'high_profit',
      label: `Dober dobiček +${profit.toFixed(0)}€ (${roiPercent.toFixed(0)}% ROI)`,
      impact: 10,
    });
  }

  // --- Market comparison ---
  if (context.comparables && context.comparables.length > 0) {
    const avgMarketSell = context.comparables.reduce((s, c) => s + c.sellPrice, 0) / context.comparables.length;
    if (trade.sellPrice > avgMarketSell * 1.05) {
      reasoning.push({
        kind: 'beat_market',
        label: `Presegel tržno povprečje (${avgMarketSell.toFixed(0)}€) za ${((trade.sellPrice / avgMarketSell - 1) * 100).toFixed(0)}%`,
        impact: 10,
      });
    } else if (trade.sellPrice < avgMarketSell * 0.95) {
      reasoning.push({
        kind: 'below_market',
        label: `Pod tržnim povprečjem (${avgMarketSell.toFixed(0)}€) za ${((1 - trade.sellPrice / avgMarketSell) * 100).toFixed(0)}%`,
        impact: -10,
      });
    }
  }

  // --- Overall Score (weighted) ---
  const overallScore = Math.round(pricingScore * 0.4 + timingScore * 0.25 + outcomeScore * 0.35);

  // --- Verdict ---
  let verdict: OutcomeResult['verdict'];
  if (profit < 0) {
    verdict = 'LOSS';
  } else if (overallScore >= 85) {
    verdict = 'PERFECT';
  } else if (overallScore >= 70) {
    verdict = 'GOOD';
  } else if (overallScore >= 55) {
    verdict = 'ACCEPTABLE';
  } else {
    verdict = 'SUBOPTIMAL';
  }

  // --- Lessons ---
  const lessons: string[] = [];
  if (leftOnTable > 0) {
    lessons.push(`Prihodnjič razmisli o višji ceni — pustil si ${leftOnTable.toFixed(0)}€ na mizi.`);
  }
  if (avgHold != null && daysHeld > avgHold * 1.5) {
    lessons.push(`Predolg hold — optimiraj ceno prej za hitrejšo prodajo.`);
  }
  if (avgHold != null && daysHeld < avgHold * 0.5 && roiPercent < 30) {
    lessons.push(`Prehitro prodano — če bi čakal ${Math.round(avgHold - daysHeld)}d več, bi lahko dosegel višji ROI.`);
  }
  if (roiPercent >= 50) {
    lessons.push(`Odlična prodaja — ponovi strategijo za podobne artikle.`);
  }
  if (profit < 0) {
    lessons.push(`Izguba — preverjaj smart price pred nakupom in izogibaj se šibkih kategorij.`);
  }
  if (context.comparables && context.comparables.length > 0) {
    const avgMarketSell = context.comparables.reduce((s, c) => s + c.sellPrice, 0) / context.comparables.length;
    if (trade.sellPrice > avgMarketSell * 1.1) {
      lessons.push(`Presegel tržno povprečje — dobra pogajalska strategija.`);
    }
  }
  if (lessons.length === 0) {
    lessons.push('Konsistentna prodaja — nadaljuj z enako strategijo.');
  }

  return {
    tradeId: trade.id,
    title: trade.title,
    category: trade.category,
    tags,
    buyPrice: trade.buyPrice,
    buyFees: trade.buyFees ?? 0,
    sellPrice: trade.sellPrice,
    sellFees: trade.sellFees ?? 0,
    cost,
    revenue,
    profit: Math.round(profit * 100) / 100,
    roiPercent: Math.round(roiPercent * 100) / 100,
    daysHeld,
    sellDate: new Date(trade.sellDate).toISOString(),
    smartPriceOptimal,
    smartPriceRange,
    pricingScore,
    timingScore,
    outcomeScore,
    overallScore,
    verdict,
    leftOnTable: Math.round(leftOnTable * 100) / 100,
    reasoning,
    lessons,
    source: 'v8.67-outcome-score',
  };
}

/**
 * Compute outcome scores for all sold trades + aggregate summary.
 */
export async function getOutcomeSummary(): Promise<OutcomeSummary> {
  const soldTrades = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
    select: {
      id: true, title: true, category: true, tags: true,
      buyPrice: true, buyFees: true, buyDate: true,
      sellPrice: true, sellFees: true, sellDate: true,
    },
    orderBy: { sellDate: 'desc' },
  });

  if (soldTrades.length === 0) {
    return {
      ok: true,
      totalSold: 0,
      perfect: 0, good: 0, acceptable: 0, suboptimal: 0, loss: 0,
      avgPricingScore: 0, avgTimingScore: 0, avgOutcomeScore: 0, avgOverallScore: 0,
      totalLeftOnTable: 0, totalExtraGained: 0, avgLeftOnTable: 0,
      bestOutcome: null, worstOutcome: null,
      topLessons: [],
      source: 'v8.67-outcome-score',
    };
  }

  // Build per-category context from all sold trades
  const categoryMap: Record<string, any[]> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(t);
  }
  const categoryContext: Record<string, { avgROI: number; avgHoldDays: number; comparables: any[] }> = {};
  for (const [cat, ts] of Object.entries(categoryMap)) {
    const rois = ts.map(t => {
      const c = t.buyPrice + (t.buyFees ?? 0);
      const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return c > 0 ? ((r - c) / c) * 100 : 0;
    });
    const holds = ts
      .filter(t => t.sellDate && t.buyDate)
      .map(t => Math.max(0, (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)));
    const comparables = ts.map(t => {
      const c = t.buyPrice + (t.buyFees ?? 0);
      const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = r - c;
      return { sellPrice: t.sellPrice ?? 0, roiPercent: c > 0 ? (profit / c) * 100 : 0 };
    });
    categoryContext[cat] = {
      avgROI: rois.reduce((s, r) => s + r, 0) / rois.length,
      avgHoldDays: holds.length > 0 ? holds.reduce((s, h) => s + h, 0) / holds.length : 0,
      comparables,
    };
  }

  // Compute outcome per trade
  const results: OutcomeResult[] = soldTrades.map(t => {
    const cat = t.category || 'drugo';
    const ctx = categoryContext[cat] || {};
    return computeOutcomeScore(
      {
        id: t.id,
        title: t.title,
        category: cat,
        tags: t.tags,
        buyPrice: t.buyPrice,
        buyFees: t.buyFees ?? 0,
        buyDate: t.buyDate,
        sellPrice: t.sellPrice ?? 0,
        sellFees: t.sellFees ?? 0,
        sellDate: t.sellDate!,
      },
      {
        categoryAvgROI: ctx.avgROI,
        categoryAvgHoldDays: ctx.avgHoldDays,
        comparables: ctx.comparables,
      }
    );
  });

  // Aggregate
  const perfect = results.filter(r => r.verdict === 'PERFECT').length;
  const good = results.filter(r => r.verdict === 'GOOD').length;
  const acceptable = results.filter(r => r.verdict === 'ACCEPTABLE').length;
  const suboptimal = results.filter(r => r.verdict === 'SUBOPTIMAL').length;
  const loss = results.filter(r => r.verdict === 'LOSS').length;

  const avgPricingScore = results.reduce((s, r) => s + r.pricingScore, 0) / results.length;
  const avgTimingScore = results.reduce((s, r) => s + r.timingScore, 0) / results.length;
  const avgOutcomeScore = results.reduce((s, r) => s + r.outcomeScore, 0) / results.length;
  const avgOverallScore = results.reduce((s, r) => s + r.overallScore, 0) / results.length;

  const leftOnTableArr = results.map(r => r.leftOnTable);
  const totalLeftOnTable = leftOnTableArr.filter(v => v > 0).reduce((s, v) => s + v, 0);
  const totalExtraGained = leftOnTableArr.filter(v => v < 0).reduce((s, v) => s + Math.abs(v), 0);
  const avgLeftOnTable = totalLeftOnTable / results.length;

  // Best/worst by overall score
  const sorted = [...results].sort((a, b) => b.overallScore - a.overallScore);
  const bestOutcome = sorted[0] ?? null;
  const worstOutcome = sorted[sorted.length - 1] ?? null;

  // Top lessons (most common)
  const lessonCounts: Record<string, number> = {};
  for (const r of results) {
    for (const l of r.lessons) {
      lessonCounts[l] = (lessonCounts[l] || 0) + 1;
    }
  }
  const topLessons = Object.entries(lessonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l]) => l);

  return {
    ok: true,
    totalSold: soldTrades.length,
    perfect, good, acceptable, suboptimal, loss,
    avgPricingScore: Math.round(avgPricingScore),
    avgTimingScore: Math.round(avgTimingScore),
    avgOutcomeScore: Math.round(avgOutcomeScore),
    avgOverallScore: Math.round(avgOverallScore),
    totalLeftOnTable: Math.round(totalLeftOnTable),
    totalExtraGained: Math.round(totalExtraGained),
    avgLeftOnTable: Math.round(avgLeftOnTable),
    bestOutcome,
    worstOutcome,
    topLessons,
    source: 'v8.67-outcome-score',
  };
}

/**
 * Compute outcome for a single sold trade by ID.
 */
export async function getOutcomeForTrade(tradeId: string): Promise<OutcomeResult | null> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true, title: true, category: true, tags: true,
      buyPrice: true, buyFees: true, buyDate: true,
      sellPrice: true, sellFees: true, sellDate: true, status: true,
    },
  });
  if (!trade || trade.status !== 'sold' || !trade.sellPrice || !trade.sellDate) return null;

  // Fetch category context
  const cat = trade.category || 'drugo';
  const allCategorySold = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, category: trade.category },
    select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true },
  });
  const rois = allCategorySold.map(t => {
    const c = t.buyPrice + (t.buyFees ?? 0);
    const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    return c > 0 ? ((r - c) / c) * 100 : 0;
  });
  const holds = allCategorySold
    .filter(t => t.sellDate && t.buyDate)
    .map(t => Math.max(0, (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)));
  const comparables = allCategorySold.map(t => {
    const c = t.buyPrice + (t.buyFees ?? 0);
    const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
    return { sellPrice: t.sellPrice ?? 0, roiPercent: c > 0 ? ((r - c) / c) * 100 : 0 };
  });

  return computeOutcomeScore(
    {
      id: trade.id,
      title: trade.title,
      category: cat,
      tags: trade.tags,
      buyPrice: trade.buyPrice,
      buyFees: trade.buyFees ?? 0,
      buyDate: trade.buyDate,
      sellPrice: trade.sellPrice,
      sellFees: trade.sellFees ?? 0,
      sellDate: trade.sellDate,
    },
    {
      categoryAvgROI: rois.length > 0 ? rois.reduce((s, r) => s + r, 0) / rois.length : null,
      categoryAvgHoldDays: holds.length > 0 ? holds.reduce((s, h) => s + h, 0) / holds.length : null,
      comparables,
    }
  );
}
