// v8.65: Sell Priority Score — "Which held trade should I sell first?"
// Heuristic compute of urgency 0-100 per held trade.
// Higher score = more urgent to sell (free up cash, avoid further depreciation).

import { db } from '@/lib/db';
import { parseTags } from '@/app/api/trades/route';

export interface SellPriorityReason {
  kind: 'days_held' | 'high_roi_potential' | 'tag_star' | 'tag_underperformer' | 'stale_category' | 'above_avg_hold' | 'low_margin' | 'recently_listed';
  label: string;          // Slovenian human-readable explanation
  impact: number;         // +/- points contributed
}

export interface SellPriorityResult {
  tradeId: string;
  title: string;
  category: string;
  tags: string[];
  daysHeld: number;
  expectedROI: number | null;    // % — based on similar sold trades (same category)
  avgHoldDaysForCategory: number | null;
  score: number;                // 0-100
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: SellPriorityReason[];
  recommendedAction: string;    // Slovenian actionable recommendation
}

export interface SellPriorityList {
  ok: true;
  heldCount: number;
  highPriority: SellPriorityResult[];
  mediumPriority: SellPriorityResult[];
  lowPriority: SellPriorityResult[];
  top3: SellPriorityResult[];   // top 3 across all
  source: 'v8.65-sell-priority';
}

/**
 * Compute sell priority score for a single held trade.
 * Pure compute — no AI/LLM calls.
 *
 * Scoring breakdown (0-100):
 *   Base: 30
 *   + Days held: +1.5 per day (max +35)
 *   + Tag UNDERPERFORMER: +20
 *   - Tag STAR: -15 (keep, performing well)
 *   - Expected ROI potential: -0.5 per 10% (max -25)
 *   + Above avg hold days for category: +15
 *   + Stale category (no sales in 30d): +10
 *   + Low margin potential (expected ROI < 15%): +10
 *   - Recently listed (days held < 3): -10
 */
export function computeSellPriority(
  trade: {
    id: string;
    title: string;
    category: string;
    tags?: string | null;
    buyDate: string | Date;
    buyPrice: number;
    buyFees?: number | number | null;
  },
  context: {
    expectedROIForCategory?: number | null;  // % — based on sold trades in same category
    avgHoldDaysForCategory?: number | null;
    lastSoldDateForCategory?: Date | null;   // last sellDate in this category
  } = {}
): SellPriorityResult {
  const tags = parseTags(trade.tags);
  const now = new Date();
  const buyDate = new Date(trade.buyDate);
  const daysHeld = Math.max(0, Math.floor((now.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));

  const reasons: SellPriorityReason[] = [];
  let score = 30; // base

  // Days held: older = more urgent
  const daysHeldImpact = Math.min(35, daysHeld * 1.5);
  if (daysHeldImpact > 0) {
    score += daysHeldImpact;
    reasons.push({
      kind: 'days_held',
      label: `${daysHeld} dni v skladišču`,
      impact: Math.round(daysHeldImpact),
    });
  }

  // Recently listed: just bought, don't push to sell
  if (daysHeld < 3) {
    score -= 10;
    reasons.push({
      kind: 'recently_listed',
      label: 'Na novo kupljeno (< 3 dni)',
      impact: -10,
    });
  }

  // Expected ROI potential (from similar sold trades in same category)
  const expectedROI = context.expectedROIForCategory ?? null;
  if (expectedROI != null) {
    if (expectedROI >= 30) {
      const impact = -Math.min(25, (expectedROI / 10) * 0.5);
      score += impact;
      reasons.push({
        kind: 'high_roi_potential',
        label: `Visok ROI potencial (${expectedROI.toFixed(0)}% v kategoriji)`,
        impact: Math.round(impact),
      });
    } else if (expectedROI < 15) {
      score += 10;
      reasons.push({
        kind: 'low_margin',
        label: `Nizek ROI potencial (${expectedROI.toFixed(0)}% v kategoriji)`,
        impact: 10,
      });
    }
  }

  // Tag verdict impact
  if (tags.includes('izguba') || tags.includes('underperformer')) {
    score += 20;
    reasons.push({
      kind: 'tag_underperformer',
      label: 'Označeno kot šibak tag',
      impact: 20,
    });
  }
  if (tags.includes('hitri-flip') || tags.includes('star')) {
    score -= 15;
    reasons.push({
      kind: 'tag_star',
      label: 'STAR tag — dobra kategorija, zadrži',
      impact: -15,
    });
  }

  // Above avg hold days for category
  const avgHold = context.avgHoldDaysForCategory;
  if (avgHold != null && daysHeld > avgHold * 1.5) {
    score += 15;
    reasons.push({
      kind: 'above_avg_hold',
      label: `Nad povprečjem za kategorijo (${avgHold.toFixed(0)} dni)`,
      impact: 15,
    });
  }

  // Stale category: no sales in last 30 days
  const lastSold = context.lastSoldDateForCategory;
  if (lastSold != null) {
    const daysSinceLastSale = Math.floor((now.getTime() - lastSold.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceLastSale > 30) {
      score += 10;
      reasons.push({
        kind: 'stale_category',
        label: `Kategorija stagnira (${daysSinceLastSale} dni od zadnje prodaje)`,
        impact: 10,
      });
    }
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Level
  const level: SellPriorityResult['level'] = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

  // Recommended action
  let recommendedAction: string;
  if (level === 'HIGH') {
    if (tags.includes('izguba') || (expectedROI != null && expectedROI < 0)) {
      recommendedAction = 'Znižaj ceno za 10-15% in prodaj hitro — omeji izgubo.';
    } else if (daysHeld > 60) {
      recommendedAction = 'Dolgo držiš — pošlji na drugo platformo (Vinted/Bolha) ali znižaj ceno.';
    } else {
      recommendedAction = 'Aktivno oglašuj in pripravi na prodajo.';
    }
  } else if (level === 'MEDIUM') {
    recommendedAction = 'Nadaljuj z oglaševanjem, spremljaj povpraševanje.';
  } else {
    recommendedAction = 'Lahko zadržiš — dober ROI potencial.';
  }

  return {
    tradeId: trade.id,
    title: trade.title,
    category: trade.category,
    tags,
    daysHeld,
    expectedROI,
    avgHoldDaysForCategory: avgHold ?? null,
    score,
    level,
    reasons,
    recommendedAction,
  };
}

/**
 * Compute sell priority for all held trades.
 * Fetches context (expected ROI per category, avg hold days, last sale date)
 * from sold trades.
 */
export async function getSellPriorityForHeldTrades(): Promise<SellPriorityList> {
  // Fetch all held trades
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: {
      id: true,
      title: true,
      category: true,
      tags: true,
      buyDate: true,
      buyPrice: true,
      buyFees: true,
    },
    orderBy: { buyDate: 'asc' },
  });

  if (heldTrades.length === 0) {
    return {
      ok: true,
      heldCount: 0,
      highPriority: [],
      mediumPriority: [],
      lowPriority: [],
      top3: [],
      source: 'v8.65-sell-priority',
    };
  }

  // Fetch sold trades for context (per-category stats)
  const soldTrades = await db.trade.findMany({
    where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null } },
    select: {
      category: true,
      buyPrice: true,
      buyFees: true,
      sellPrice: true,
      sellFees: true,
      buyDate: true,
      sellDate: true,
    },
  });

  // Compute per-category context
  const categoryContext: Record<string, {
    expectedROI: number;
    avgHoldDays: number;
    lastSoldDate: Date | null;
  }> = {};
  const categoryMap: Record<string, any[]> = {};
  for (const t of soldTrades) {
    const cat = t.category || 'drugo';
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(t);
  }
  for (const [cat, ts] of Object.entries(categoryMap)) {
    if (ts.length === 0) continue;
    const rois = ts.map(t => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return cost > 0 ? ((revenue - cost) / cost) * 100 : 0;
    });
    const holds = ts
      .filter(t => t.sellDate && t.buyDate)
      .map(t => Math.max(0, (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24)));
    const lastSoldDate = ts
      .map(t => t.sellDate ? new Date(t.sellDate) : null)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    categoryContext[cat] = {
      expectedROI: rois.reduce((s, r) => s + r, 0) / rois.length,
      avgHoldDays: holds.length > 0 ? holds.reduce((s, h) => s + h, 0) / holds.length : 0,
      lastSoldDate,
    };
  }

  // Compute score per held trade
  const results: SellPriorityResult[] = heldTrades.map(t => {
    const ctx = categoryContext[t.category || 'drugo'] || {};
    return computeSellPriority(
      {
        id: t.id,
        title: t.title,
        category: t.category || 'drugo',
        tags: t.tags,
        buyDate: t.buyDate,
        buyPrice: t.buyPrice,
        buyFees: t.buyFees ?? 0,
      },
      {
        expectedROIForCategory: ctx.expectedROI,
        avgHoldDaysForCategory: ctx.avgHoldDays,
        lastSoldDateForCategory: ctx.lastSoldDate,
      }
    );
  });

  // Sort by score desc
  results.sort((a, b) => b.score - a.score);

  const highPriority = results.filter(r => r.level === 'HIGH');
  const mediumPriority = results.filter(r => r.level === 'MEDIUM');
  const lowPriority = results.filter(r => r.level === 'LOW');

  return {
    ok: true,
    heldCount: heldTrades.length,
    highPriority,
    mediumPriority,
    lowPriority,
    top3: results.slice(0, 3),
    source: 'v8.65-sell-priority',
  };
}
