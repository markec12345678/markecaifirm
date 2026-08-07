// v7.63: Profit Margin Heatmap — 2D matrica (kategorija × cenovni razpon)
// ki prikazuje kombinacije z najvišjim profitnim margin-om. Pomaga identificirati
// "sweet spot" segmente (npr. "Elektronika 250-500€ = HOT, 35% margin, 12 prodaj").
//
// Razlika od profit-heatmap (ki gleda dneve/ure z največ dobička) — ta gleda
// KATEGORIJO × CENO. Razlika od roi-leaderboard (ki rank-a kategorije) — ta
// gleda 2D mrežo s klasifikacijo HOT/WARM/COOL/COLD.
//
// "Elektronika 250-500€ = HOT (35% margin, 12 trades). Moda 0-50€ = COLD (3%)"
//
// Pure DB analytics (NO AI). GET /api/analytics/profit-margin-heatmap

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HeatClass = 'HOT' | 'WARM' | 'COOL' | 'COLD';

interface PriceRangeCell {
  range: string;
  tradeCount: number;
  avgMargin: number; // %
  avgProfit: number; // EUR
  winRate: number; // %
  heatScore: number;
  classification: HeatClass;
}

interface CategoryRow {
  category: string;
  priceRanges: PriceRangeCell[];
}

interface TopCell {
  category: string;
  priceRange: string;
  tradeCount: number;
  avgMargin: number;
  heatScore: number;
  classification: HeatClass;
  insight: string;
}

// 6 cenovnih razponov (€)
const PRICE_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-50€', min: 0, max: 50 },
  { label: '50-100€', min: 50, max: 100 },
  { label: '100-250€', min: 100, max: 250 },
  { label: '250-500€', min: 250, max: 500 },
  { label: '500-1000€', min: 500, max: 1000 },
  { label: '1000€+', min: 1000, max: Number.POSITIVE_INFINITY },
];

function classifyHeat(heatScore: number): HeatClass {
  if (heatScore > 50) return 'HOT';
  if (heatScore >= 20) return 'WARM';
  if (heatScore >= 5) return 'COOL';
  return 'COLD';
}

function priceRangeLabel(buyPrice: number): string | null {
  for (const r of PRICE_RANGES) {
    if (buyPrice >= r.min && buyPrice < r.max) return r.label;
  }
  return null;
}

export async function GET() {
  try {
    // 1) Query all SOLD trades with buy+sell prices
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
      },
      take: 5000,
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        matrix: [],
        topCells: [],
        summary: {
          totalCategories: 0,
          totalCells: 0,
          hotCells: 0,
          coldCells: 0,
          bestCombination: null,
          worstCombination: null,
          advice: 'Ni prodanih trade-ov — Heatmap analiza ni mogoča.',
        },
        message: 'Ni prodanih trade-ov — Profit Margin Heatmap analiza ni mogoča.',
      });
    }

    // 2) Group trades by (category, priceRange)
    interface CellAgg {
      count: number;
      marginSum: number;
      profitSum: number;
      winCount: number;
    }
    const cellMap = new Map<string, CellAgg>(); // key = `${category}|${range}`

    for (const t of soldTrades) {
      const buyPrice = t.buyPrice;
      const rangeLabel = priceRangeLabel(buyPrice);
      if (!rangeLabel) continue;
      const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const key = `${category}|${rangeLabel}`;

      const buy = t.buyPrice + (t.buyFees ?? 0);
      const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = sell - buy;
      const margin = buy > 0 ? (profit / buy) * 100 : 0;

      const cur = cellMap.get(key) || { count: 0, marginSum: 0, profitSum: 0, winCount: 0 };
      cur.count += 1;
      cur.marginSum += margin;
      cur.profitSum += profit;
      if (profit > 0) cur.winCount += 1;
      cellMap.set(key, cur);
    }

    if (cellMap.size === 0) {
      return NextResponse.json({
        ok: true,
        matrix: [],
        topCells: [],
        summary: {
          totalCategories: 0,
          totalCells: 0,
          hotCells: 0,
          coldCells: 0,
          bestCombination: null,
          worstCombination: null,
          advice: 'Vsak trade potrebuje veljaven buyPrice > 0.',
        },
        message: 'Ni veljavnih prodaj za Heatmap analizo.',
      });
    }

    // 3) Collect all categories (sorted alphabetically) — include categories
    //    that have at least one sold trade.
    const categoriesSet = new Set<string>();
    for (const key of cellMap.keys()) {
      const [cat] = key.split('|');
      categoriesSet.add(cat);
    }
    const categories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));

    // 4) Build matrix rows
    const matrix: CategoryRow[] = categories.map(category => {
      const priceRanges: PriceRangeCell[] = PRICE_RANGES.map(r => {
        const key = `${category}|${r.label}`;
        const agg = cellMap.get(key);
        if (!agg || agg.count === 0) {
          return {
            range: r.label,
            tradeCount: 0,
            avgMargin: 0,
            avgProfit: 0,
            winRate: 0,
            heatScore: 0,
            classification: 'COLD' as HeatClass,
          };
        }
        const avgMargin = Math.round((agg.marginSum / agg.count) * 10) / 10;
        const avgProfit = Math.round(agg.profitSum / agg.count);
        const winRate = Math.round((agg.winCount / agg.count) * 100);
        // heatScore = avgMargin × log(tradeCount + 1) — rewards both high margin AND volume
        const heatScore = Math.round((avgMargin * Math.log10(agg.count + 1)) * 10) / 10;
        const classification = classifyHeat(heatScore);
        return {
          range: r.label,
          tradeCount: agg.count,
          avgMargin,
          avgProfit,
          winRate,
          heatScore,
          classification,
        };
      });
      return { category, priceRanges };
    });

    // 5) Compute top 5 hottest cells (only cells with tradeCount > 0)
    const allCells: Array<{
      category: string;
      priceRange: string;
      tradeCount: number;
      avgMargin: number;
      avgProfit: number;
      winRate: number;
      heatScore: number;
      classification: HeatClass;
    }> = [];
    for (const row of matrix) {
      for (const cell of row.priceRanges) {
        if (cell.tradeCount > 0) {
          allCells.push({
            category: row.category,
            priceRange: cell.range,
            tradeCount: cell.tradeCount,
            avgMargin: cell.avgMargin,
            avgProfit: cell.avgProfit,
            winRate: cell.winRate,
            heatScore: cell.heatScore,
            classification: cell.classification,
          });
        }
      }
    }

    // Top 5 by heatScore (hottest)
    const topSorted = [...allCells].sort((a, b) => b.heatScore - a.heatScore).slice(0, 5);

    const topCells: TopCell[] = topSorted.map(c => {
      let insight: string;
      if (c.classification === 'HOT') {
        insight = `${c.category} ${c.priceRange} = HOT (${c.avgMargin}% margin, ${c.tradeCount} prodaj, ${c.winRate}% win-rate). Fokusiraj nakupe tukaj.`;
      } else if (c.classification === 'WARM') {
        insight = `${c.category} ${c.priceRange} = WARM (${c.avgMargin}% margin, ${c.tradeCount} prodaj). Dober segment, vendar ne najboljši.`;
      } else if (c.classification === 'COOL') {
        insight = `${c.category} ${c.priceRange} = COOL (${c.avgMargin}% margin, ${c.tradeCount} prodaj). Nizka donosnost — premisli alternative.`;
      } else {
        insight = `${c.category} ${c.priceRange} = COLD (${c.avgMargin}% margin, ${c.tradeCount} prodaj). Izogibaj se tega segmenta.`;
      }
      return {
        category: c.category,
        priceRange: c.priceRange,
        tradeCount: c.tradeCount,
        avgMargin: c.avgMargin,
        heatScore: c.heatScore,
        classification: c.classification,
        insight,
      };
    });

    // 6) Summary
    const totalCategories = categories.length;
    const totalCells = allCells.length;
    const hotCells = allCells.filter(c => c.classification === 'HOT').length;
    const coldCells = allCells.filter(c => c.classification === 'COLD').length;
    const best = topSorted[0] ?? null;
    const worst = [...allCells].sort((a, b) => a.heatScore - b.heatScore)[0] ?? null;
    const bestCombination = best
      ? `${best.category} ${best.priceRange} (${best.avgMargin}% margin, ${best.tradeCount} prodaj)`
      : null;
    const worstCombination = worst
      ? `${worst.category} ${worst.priceRange} (${worst.avgMargin}% margin, ${worst.tradeCount} prodaj)`
      : null;

    let advice: string;
    if (hotCells > 0) {
      advice = `${hotCells} HOT celic${hotCells === 1 ? 'a' : 'e'} — fokusiraj kapital na ${bestCombination}. ${coldCells} COLD celic${coldCells === 1 ? 'a' : 'e'} — izogibaj se ${worstCombination}.`;
    } else if (totalCells > 0) {
      const bestWarm = allCells.filter(c => c.classification === 'WARM').length;
      advice = `Ni HOT celic. ${bestWarm} WARM celic${bestWarm === 1 ? 'a' : 'e'} — najboljši segment: ${bestCombination}. Premisli povečanje volumna v tem segmentu da aktiviraš HOT klasifikacijo (heatScore = margin × log(volume)).`;
    } else {
      advice = 'Premalo podatkov za Heatmap analizo.';
    }

    return NextResponse.json({
      ok: true,
      matrix,
      topCells,
      summary: {
        totalCategories,
        totalCells,
        hotCells,
        coldCells,
        bestCombination,
        worstCombination,
        advice,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/profit-margin-heatmap', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
