// v8.68: Buy Opportunity Score — data-driven "should I buy this listing?" analysis.
// Complement to v8.65-67 (sell intelligence) → completes the buy/sell cycle.
//
// "I see iPhone 13 Pro 256GB for 450€ on Bolha. Should I buy it?"
// Score 0-100 based on: price vs AI estimated value, category history, AI score/risk.

import { db } from '@/lib/db';

export interface BuyOpportunityReason {
  kind: 'below_estimated_value' | 'above_estimated_value' | 'below_market_avg' | 'above_market_avg' | 'ai_score_high' | 'ai_score_low' | 'ai_risk_high' | 'category_star' | 'category_underperformer' | 'price_drop' | 'no_price' | 'insufficient_data';
  label: string;
  impact: number;
}

export interface BuyOpportunityResult {
  listingId: string;
  title: string;
  price: number | null;
  priceText: string;
  category: string;
  // AI context
  aiScore: number | null;       // 1-10
  aiRisk: number | null;        // 1-10
  aiVerdict: string | null;     // PRILIKA/SUMNJIVO/NEZANIMIVO
  aiEstimatedValue: number | null;
  // Market context (from sold trades in same category)
  marketAvgSellPrice: number | null;
  marketAvgROI: number | null;
  comparableCount: number;
  // The buy analysis
  score: number;                 // 0-100
  verdict: 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'AVOID';
  expectedROI: number | null;    // % — if bought at current price, sold at market avg
  expectedProfit: number | null; // EUR
  suggestedMaxBuyPrice: number | null; // max price to pay for 15% target ROI
  discountPercent: number | null;     // % below AI estimated value (positive = good deal)
  confidence: number;            // 0-100
  confidenceLabel: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: BuyOpportunityReason[];
  recommendation: string;        // Slovenian actionable
  source: 'v8.68-buy-opportunity';
}

export interface BuyOpportunityList {
  ok: true;
  total: number;
  strongBuys: BuyOpportunityResult[];
  buys: BuyOpportunityResult[];
  considers: BuyOpportunityResult[];
  avoids: BuyOpportunityResult[];
  top5: BuyOpportunityResult[];   // top opportunities across all
  source: 'v8.68-buy-opportunity';
}

/**
 * Compute buy opportunity score for a single listing.
 * Pure compute — no AI/LLM calls (uses cached AI evaluation).
 *
 * Scoring breakdown (0-100):
 *   Base: 25
 *   + Price vs AI estimated value: discount% × 1.5 (max +30)
 *   - Above estimated value: penalty
 *   + Price vs market avg sell: if below → + (margin / marketAvg) × 100 (max +25)
 *   + AI score (1-10): × 2.5 (max +25)
 *   - AI risk (1-10): × 2 (max -20)
 *   + Category STAR verdict: +10
 *   - Category UNDERPERFORMER: -10
 *   + Price drop detected: +5
 */
export function computeBuyScore(
  listing: {
    id: string;
    title: string;
    price: number | null;
    priceText: string;
    aiScore?: number | null;
    aiRisk?: number | null;
    aiVerdict?: string | null;
    aiEstimatedValue?: number | null;
    previousPrice?: number | null;
    priceDroppedAt?: Date | null;
  },
  context: {
    category?: string;
    marketAvgSellPrice?: number | null;
    marketAvgROI?: number | null;
    comparableCount?: number;
    categoryVerdict?: 'STAR' | 'SOLID' | 'MIXED' | 'UNDERPERFORMER' | 'INSUFFICIENT_DATA' | null;
  } = {}
): BuyOpportunityResult {
  const reasoning: BuyOpportunityReason[] = [];
  let score = 25; // base
  let expectedROI: number | null = null;
  let expectedProfit: number | null = null;
  let suggestedMaxBuyPrice: number | null = null;
  let discountPercent: number | null = null;

  const aiScore = listing.aiScore ?? null;
  const aiRisk = listing.aiRisk ?? null;
  const aiVerdict = listing.aiVerdict ?? null;
  const aiEstimatedValue = listing.aiEstimatedValue ?? null;
  const marketAvgSellPrice = context.marketAvgSellPrice ?? null;
  const marketAvgROI = context.marketAvgROI ?? null;
  const comparableCount = context.comparableCount ?? 0;
  const category = context.category || 'drugo';

  // No price — can't compute
  if (listing.price == null || listing.price <= 0) {
    reasoning.push({
      kind: 'no_price',
      label: 'Brez cene — brez analize',
      impact: 0,
    });
    return {
      listingId: listing.id,
      title: listing.title,
      price: null,
      priceText: listing.priceText,
      category,
      aiScore, aiRisk, aiVerdict, aiEstimatedValue,
      marketAvgSellPrice, marketAvgROI, comparableCount,
      score: 0,
      verdict: 'AVOID',
      expectedROI: null,
      expectedProfit: null,
      suggestedMaxBuyPrice: null,
      discountPercent: null,
      confidence: 0,
      confidenceLabel: 'LOW',
      reasoning,
      recommendation: 'Brez cene — ne morem analizirati. Počakaj na podatek o ceni.',
      source: 'v8.68-buy-opportunity',
    };
  }

  // --- Step 1: Price vs AI estimated value ---
  if (aiEstimatedValue != null && aiEstimatedValue > 0) {
    discountPercent = ((aiEstimatedValue - listing.price) / aiEstimatedValue) * 100;
    if (discountPercent > 0) {
      // Below estimated value — good deal
      const impact = Math.min(30, discountPercent * 1.5);
      score += impact;
      reasoning.push({
        kind: 'below_estimated_value',
        label: `${discountPercent.toFixed(0)}% pod AI oceno vrednosti (${aiEstimatedValue}€)`,
        impact: Math.round(impact),
      });
    } else {
      // Above estimated value — bad deal
      const penalty = Math.min(20, Math.abs(discountPercent) * 1.5);
      score -= penalty;
      reasoning.push({
        kind: 'above_estimated_value',
        label: `${Math.abs(discountPercent).toFixed(0)}% nad AI oceno vrednosti (${aiEstimatedValue}€)`,
        impact: -Math.round(penalty),
      });
    }
  }

  // --- Step 2: Price vs market average sell price ---
  if (marketAvgSellPrice != null && marketAvgSellPrice > 0) {
    const margin = marketAvgSellPrice - listing.price;
    const marginPct = (margin / marketAvgSellPrice) * 100;
    if (margin > 0) {
      // Below market — can profit
      const impact = Math.min(25, marginPct * 0.8);
      score += impact;
      expectedProfit = margin;
      expectedROI = (margin / listing.price) * 100;
      reasoning.push({
        kind: 'below_market_avg',
        label: `${marginPct.toFixed(0)}% pod tržnim povprečjem prodaj (${marketAvgSellPrice.toFixed(0)}€) → pričakovan +${margin.toFixed(0)}€`,
        impact: Math.round(impact),
      });
    } else {
      // Above market — overpaying
      const penalty = Math.min(15, Math.abs(marginPct) * 0.8);
      score -= penalty;
      reasoning.push({
        kind: 'above_market_avg',
        label: `${Math.abs(marginPct).toFixed(0)}% nad tržnim povprečjem (${marketAvgSellPrice.toFixed(0)}€)`,
        impact: -Math.round(penalty),
      });
    }
    // Suggested max buy price for 15% target ROI
    suggestedMaxBuyPrice = Math.round(marketAvgSellPrice / 1.15);
  } else if (marketAvgROI != null) {
    // No comparables but have category avg ROI — estimate
    expectedROI = marketAvgROI;
    expectedProfit = listing.price * (marketAvgROI / 100);
  }

  // --- Step 3: AI score ---
  if (aiScore != null) {
    if (aiScore >= 7) {
      const impact = aiScore * 2.5;
      score += impact;
      reasoning.push({
        kind: 'ai_score_high',
        label: `AI ocena ${aiScore}/10 — visoka priložnost`,
        impact: Math.round(impact),
      });
    } else if (aiScore <= 4) {
      const penalty = (10 - aiScore) * 2;
      score -= penalty;
      reasoning.push({
        kind: 'ai_score_low',
        label: `AI ocena ${aiScore}/10 — nizka priložnost`,
        impact: -Math.round(penalty),
      });
    } else {
      score += aiScore * 1.5;
    }
  }

  // --- Step 4: AI risk ---
  if (aiRisk != null) {
    if (aiRisk >= 7) {
      const penalty = aiRisk * 2;
      score -= penalty;
      reasoning.push({
        kind: 'ai_risk_high',
        label: `AI tveganje ${aiRisk}/10 — visoko tveganje`,
        impact: -Math.round(penalty),
      });
    } else if (aiRisk <= 3) {
      score += (5 - aiRisk) * 2;
    }
  }

  // --- Step 5: Category verdict ---
  if (context.categoryVerdict === 'STAR') {
    score += 10;
    reasoning.push({
      kind: 'category_star',
      label: 'STAR kategorija — visoka donosnost zgodovinsko',
      impact: 10,
    });
  } else if (context.categoryVerdict === 'UNDERPERFORMER') {
    score -= 10;
    reasoning.push({
      kind: 'category_underperformer',
      label: 'UNDERPERFORMER kategorija — šibka donosnost zgodovinsko',
      impact: -10,
    });
  }

  // --- Step 6: Price drop ---
  if (listing.previousPrice != null && listing.priceDroppedAt) {
    const dropAmount = listing.previousPrice - listing.price;
    if (dropAmount > 0) {
      score += 5;
      reasoning.push({
        kind: 'price_drop',
        label: `Padec cene za ${dropAmount}€ (z ${listing.previousPrice}€)`,
        impact: 5,
      });
    }
  }

  // --- Clamp ---
  score = Math.max(0, Math.min(100, Math.round(score)));

  // --- Verdict ---
  let verdict: BuyOpportunityResult['verdict'];
  if (score >= 75) verdict = 'STRONG_BUY';
  else if (score >= 55) verdict = 'BUY';
  else if (score >= 35) verdict = 'CONSIDER';
  else verdict = 'AVOID';

  // --- Confidence ---
  let confidence = 25;
  if (aiEstimatedValue != null) confidence += 25;
  if (comparableCount >= 5) confidence += 30;
  else if (comparableCount >= 3) confidence += 20;
  else if (comparableCount >= 1) confidence += 10;
  if (aiScore != null) confidence += 15;
  confidence = Math.min(100, confidence);

  const confidenceLabel: BuyOpportunityResult['confidenceLabel'] =
    confidence >= 70 ? 'HIGH' : confidence >= 40 ? 'MEDIUM' : 'LOW';

  // --- Recommendation ---
  let recommendation: string;
  if (verdict === 'STRONG_BUY') {
    recommendation = `🟢 Močna kupnina! Kupi čim prej — pričakovan ${expectedROI?.toFixed(0) ?? '?'}% ROI.`;
  } else if (verdict === 'BUY') {
    recommendation = `✓ Dober nakup. Pričakovan ${expectedROI?.toFixed(0) ?? '?'}% ROI.`;
  } else if (verdict === 'CONSIDER') {
    if (aiRisk != null && aiRisk >= 6) {
      recommendation = `🟡 Premislek — visoko tveganje (${aiRisk}/10). Preveri artikel podrobno.`;
    } else if (marketAvgSellPrice != null && listing.price > marketAvgSellPrice) {
      recommendation = `🟡 Premislek — cena nad tržnim povprečjem. Pogajaj se za nižjo.`;
    } else {
      recommendation = `🟡 Premislek — primanjkuje podatkov za močno priporočilo.`;
    }
  } else {
    recommendation = `✗ Izogibaj se — nizka pričakovana donosnost ali visoko tveganje.`;
  }

  return {
    listingId: listing.id,
    title: listing.title,
    price: listing.price,
    priceText: listing.priceText,
    category,
    aiScore, aiRisk, aiVerdict, aiEstimatedValue,
    marketAvgSellPrice, marketAvgROI, comparableCount,
    score,
    verdict,
    expectedROI,
    expectedProfit: expectedProfit != null ? Math.round(expectedProfit * 100) / 100 : null,
    suggestedMaxBuyPrice,
    discountPercent: discountPercent != null ? Math.round(discountPercent * 100) / 100 : null,
    confidence,
    confidenceLabel,
    reasoning,
    recommendation,
    source: 'v8.68-buy-opportunity',
  };
}

/**
 * Compute buy opportunity for a single listing by ID.
 */
export async function getBuyOpportunityForListing(listingId: string): Promise<BuyOpportunityResult | null> {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true, title: true, price: true, priceText: true,
      aiScore: true, aiRisk: true, aiVerdict: true, aiEstimatedValue: true,
      previousPrice: true, priceDroppedAt: true,
      monitor: { select: { name: true, tags: true } },
    },
  });
  if (!listing) return null;

  // v8.68: Derive category from monitor.tags (first tag) or fallback to 'drugo'
  const monitorTags = (listing.monitor?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const category = monitorTags[0] || 'drugo';
  const soldInCategory = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, category },
    select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
  });

  let marketAvgSellPrice: number | null = null;
  let marketAvgROI: number | null = null;
  if (soldInCategory.length > 0) {
    const sellPrices = soldInCategory.map(t => t.sellPrice ?? 0);
    marketAvgSellPrice = sellPrices.reduce((s, p) => s + p, 0) / soldInCategory.length;
    const rois = soldInCategory.map(t => {
      const c = t.buyPrice + (t.buyFees ?? 0);
      const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return c > 0 ? ((r - c) / c) * 100 : 0;
    });
    marketAvgROI = rois.reduce((s, r) => s + r, 0) / rois.length;
  }

  // Determine category verdict from tag performance
  const categoryTrades = await db.trade.findMany({
    where: { category, tags: { not: '' } },
    select: { tags: true, status: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
  });
  let categoryVerdict: 'STAR' | 'SOLID' | 'MIXED' | 'UNDERPERFORMER' | 'INSUFFICIENT_DATA' | null = null;
  const sold = categoryTrades.filter(t => t.status === 'sold' && t.sellPrice != null);
  if (sold.length >= 3) {
    const rois = sold.map(t => {
      const c = t.buyPrice + (t.buyFees ?? 0);
      const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return c > 0 ? ((r - c) / c) * 100 : 0;
    });
    const avgROI = rois.reduce((s, r) => s + r, 0) / rois.length;
    const winRate = (sold.filter((t, i) => rois[i] > 0).length / sold.length) * 100;
    if (avgROI >= 30 && winRate >= 70) categoryVerdict = 'STAR';
    else if (avgROI >= 15 && winRate >= 60) categoryVerdict = 'SOLID';
    else if (avgROI >= 0) categoryVerdict = 'MIXED';
    else categoryVerdict = 'UNDERPERFORMER';
  } else {
    categoryVerdict = 'INSUFFICIENT_DATA';
  }

  return computeBuyScore(
    {
      id: listing.id,
      title: listing.title,
      price: listing.price,
      priceText: listing.priceText,
      aiScore: listing.aiScore,
      aiRisk: listing.aiRisk,
      aiVerdict: listing.aiVerdict,
      aiEstimatedValue: listing.aiEstimatedValue,
      previousPrice: listing.previousPrice,
      priceDroppedAt: listing.priceDroppedAt,
    },
    {
      category,
      marketAvgSellPrice,
      marketAvgROI,
      comparableCount: soldInCategory.length,
      categoryVerdict,
    }
  );
}

/**
 * Compute buy opportunities for all recent listings (top N).
 */
export async function getTopBuyOpportunities(limit = 20): Promise<BuyOpportunityList> {
  // Fetch recent listings with AI evaluation
  const listings = await db.listing.findMany({
    where: { isHidden: false },
    select: {
      id: true, title: true, price: true, priceText: true,
      aiScore: true, aiRisk: true, aiVerdict: true, aiEstimatedValue: true,
      previousPrice: true, priceDroppedAt: true,
      monitor: { select: { name: true, tags: true } },
    },
    orderBy: { firstSeenAt: 'desc' },
    take: limit,
  });

  // Group by monitor category (derived from monitor.tags) for batch context fetch
  const categorySet = new Set<string>();
  listings.forEach(l => {
    const tags = (l.monitor?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const cat = tags[0] || 'drugo';
    categorySet.add(cat);
  });

  // Fetch market context per category
  const categoryContext: Record<string, { avgSell: number | null; avgROI: number | null; count: number; verdict: string | null }> = {};
  for (const cat of Array.from(categorySet)) {
    const sold = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, category: cat },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, tags: true },
    });
    if (sold.length > 0) {
      const sellPrices = sold.map(t => t.sellPrice ?? 0);
      const avgSell = sellPrices.reduce((s, p) => s + p, 0) / sold.length;
      const rois = sold.map(t => {
        const c = t.buyPrice + (t.buyFees ?? 0);
        const r = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        return c > 0 ? ((r - c) / c) * 100 : 0;
      });
      const avgROI = rois.reduce((s, r) => s + r, 0) / rois.length;
      const winRate = (sold.filter((t, i) => rois[i] > 0).length / sold.length) * 100;
      let verdict: string | null = null;
      if (sold.length >= 3) {
        if (avgROI >= 30 && winRate >= 70) verdict = 'STAR';
        else if (avgROI >= 15 && winRate >= 60) verdict = 'SOLID';
        else if (avgROI >= 0) verdict = 'MIXED';
        else verdict = 'UNDERPERFORMER';
      } else {
        verdict = 'INSUFFICIENT_DATA';
      }
      categoryContext[cat] = { avgSell, avgROI, count: sold.length, verdict };
    } else {
      categoryContext[cat] = { avgSell: null, avgROI: null, count: 0, verdict: 'INSUFFICIENT_DATA' };
    }
  }

  const results: BuyOpportunityResult[] = listings.map(l => {
    const tags = (l.monitor?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const cat = tags[0] || 'drugo';
    const ctx = categoryContext[cat] || { avgSell: null, avgROI: null, count: 0, verdict: null };
    return computeBuyScore(
      {
        id: l.id,
        title: l.title,
        price: l.price,
        priceText: l.priceText,
        aiScore: l.aiScore,
        aiRisk: l.aiRisk,
        aiVerdict: l.aiVerdict,
        aiEstimatedValue: l.aiEstimatedValue,
        previousPrice: l.previousPrice,
        priceDroppedAt: l.priceDroppedAt,
      },
      {
        category: cat,
        marketAvgSellPrice: ctx.avgSell,
        marketAvgROI: ctx.avgROI,
        comparableCount: ctx.count,
        categoryVerdict: ctx.verdict as any,
      }
    );
  });

  const strongBuys = results.filter(r => r.verdict === 'STRONG_BUY');
  const buys = results.filter(r => r.verdict === 'BUY');
  const considers = results.filter(r => r.verdict === 'CONSIDER');
  const avoids = results.filter(r => r.verdict === 'AVOID');

  return {
    ok: true,
    total: results.length,
    strongBuys: strongBuys.sort((a, b) => b.score - a.score),
    buys: buys.sort((a, b) => b.score - a.score),
    considers: considers.sort((a, b) => b.score - a.score),
    avoids: avoids.sort((a, b) => b.score - a.score),
    top5: results.sort((a, b) => b.score - a.score).slice(0, 5),
    source: 'v8.68-buy-opportunity',
  };
}
