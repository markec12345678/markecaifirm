// v7.72: Deal Profitability Matrix — 2D matrika ki prikazuje dobičkonosnost
// (profitability) po kategoriji × hold-time-range. Razkrije katere kombinacije
// kategorija + hold-time so najbolj dobičkonosne. "Elektronika × 14-30d:
// HIGHLY_PROFITABLE (score 85, 35% ROI). Moda × 60-90d: UNPROFITABLE (score 2)."
// Pure DB analytics — NO AI.
//
// Razlika od profit-margin-heatmap (ki prikazuje margine po kategorija × cenovni
// razpon) — ta gleda kategorija × HOLD-TIME (čakalna doba). Razlika od
// deal-source-comparison-matrix (ki primerja vire čez metrike) — ta primerja
// hold-time range-e znotraj vsake kategorije. Razlika od profit-heatmap (ki
// prikazuje dneve/ure prodaje) — ta prikazuje hold-time intervale. Razlika od
// time-to-profit (ki meri čas do profit na posameznem trade-u) — ta
// klasificira profitability celotnih kategorij × hold-time celic.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-profitability-matrix

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type Classification =
  | 'HIGHLY_PROFITABLE'
  | 'PROFITABLE'
  | 'MARGINAL'
  | 'UNPROFITABLE';

interface HoldTimeCell {
  range: string; // "0-7d", "7-14d", etc.
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
  avgROI: number; // %
  winRate: number; // %
  profitabilityScore: number;
  classification: Classification;
}

interface MatrixRow {
  category: string;
  holdTimeRanges: HoldTimeCell[];
}

interface BestWorstCombination {
  category: string;
  holdTime: string;
  score: number;
}

interface SweetSpot {
  category: string;
  bestHoldTime: string;
  avgProfit: number;
}

interface Insights {
  bestCombination: BestWorstCombination | null;
  worstCombination: BestWorstCombination | null;
  sweetSpots: SweetSpot[];
  advice: string;
}

interface Summary {
  totalCategories: number;
  totalCombinations: number;
  highlyProfitableCells: number;
  unprofitableCells: number;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

// Hold-time ranges (in days): [min, max)
const HOLD_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: '0-7d', min: 0, max: 7 },
  { name: '7-14d', min: 7, max: 14 },
  { name: '14-30d', min: 14, max: 30 },
  { name: '30-60d', min: 30, max: 60 },
  { name: '60-90d', min: 60, max: 90 },
  { name: '90d+', min: 90, max: Number.MAX_SAFE_INTEGER },
];

function holdRangeOf(days: number): string | null {
  if (!Number.isFinite(days) || days < 0) return null;
  for (const r of HOLD_RANGES) {
    if (days >= r.min && days < r.max) return r.name;
  }
  return '90d+';
}

function classifyCell(score: number): Classification {
  if (score >= 50) return 'HIGHLY_PROFITABLE';
  if (score >= 20) return 'PROFITABLE';
  if (score >= 5) return 'MARGINAL';
  return 'UNPROFITABLE';
}

// profitabilityScore = avgProfit × log(tradeCount + 1) (rewards both margin and volume)
function computeScore(avgProfit: number, tradeCount: number): number {
  if (avgProfit <= 0 || tradeCount <= 0) return 0;
  return Math.round(avgProfit * Math.log10(tradeCount + 1) * 10) / 10;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query SOLD trades with dates + profit fields
    // NOTE: Prisma 6 DateTime filter does not accept `not: null`; using `gte`
    // implicitly excludes nulls for the sellDate field.
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: new Date(0) },
        buyPrice: { gt: 0 },
        sellPrice: { not: null },
      },
      select: {
        id: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      take: 20000,
    });

    // Empty state
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        matrix: [],
        insights: {
          bestCombination: null,
          worstCombination: null,
          sweetSpots: [],
          advice:
            'Ni prodanih trade-ov — Profitability Matrix ni mogoče izračunati. Dodaš trades z buyDate, sellDate, buyPrice in sellPrice za začetek.',
        },
        summary: {
          totalCategories: 0,
          totalCombinations: 0,
          highlyProfitableCells: 0,
          unprofitableCells: 0,
        },
        message:
          'Ni prodanih trade-ov — Profitability Matrix ni mogoče izračunati.',
      });
    }

    // 2) Bucket trades by category × hold-time-range
    type CellAgg = {
      tradeCount: number;
      totalProfit: number;
      wins: number;
      totalCost: number; // for ROI calculation
    };

    const byCatRange = new Map<string, Map<string, CellAgg>>();

    for (const t of soldTrades) {
      const cat = (t.category || '').trim().toLowerCase() || 'neznan';
      const sellDateMs = new Date(t.sellDate as unknown as Date | string).getTime();
      const buyDateMs = new Date(t.buyDate as unknown as Date | string).getTime();
      if (!Number.isFinite(sellDateMs) || !Number.isFinite(buyDateMs)) continue;
      const holdDays = Math.max(0, (sellDateMs - buyDateMs) / DAY_MS);
      const rangeName = holdRangeOf(holdDays);
      if (!rangeName) continue;

      const cost = (t.buyPrice ?? 0) + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = revenue - cost;

      let rangeMap = byCatRange.get(cat);
      if (!rangeMap) {
        rangeMap = new Map();
        byCatRange.set(cat, rangeMap);
      }
      let cell = rangeMap.get(rangeName);
      if (!cell) {
        cell = { tradeCount: 0, totalProfit: 0, wins: 0, totalCost: 0 };
        rangeMap.set(rangeName, cell);
      }
      cell.tradeCount += 1;
      cell.totalProfit += profit;
      cell.totalCost += cost;
      if (profit > 0) cell.wins += 1;
    }

    // 3) Build matrix rows
    const matrix: MatrixRow[] = [];
    let bestCell: { category: string; holdTime: string; score: number } | null = null;
    let worstCell: { category: string; holdTime: string; score: number } | null = null;
    let highlyProfitableCells = 0;
    let unprofitableCells = 0;
    let totalCombinations = 0;

    for (const [cat, rangeMap] of byCatRange.entries()) {
      const row: MatrixRow = { category: cat, holdTimeRanges: [] };
      for (const r of HOLD_RANGES) {
        const cell = rangeMap.get(r.name);
        if (!cell || cell.tradeCount === 0) {
          // Include empty cells for full matrix structure (count 0, score 0)
          row.holdTimeRanges.push({
            range: r.name,
            tradeCount: 0,
            totalProfit: 0,
            avgProfit: 0,
            avgROI: 0,
            winRate: 0,
            profitabilityScore: 0,
            classification: 'UNPROFITABLE',
          });
          continue;
        }
        totalCombinations += 1;
        const avgProfit = cell.totalProfit / cell.tradeCount;
        const avgROI =
          cell.totalCost > 0 ? (cell.totalProfit / cell.totalCost) * 100 : 0;
        const winRate = (cell.wins / cell.tradeCount) * 100;
        const score = computeScore(avgProfit, cell.tradeCount);
        const classification = classifyCell(score);

        if (classification === 'HIGHLY_PROFITABLE') highlyProfitableCells += 1;
        if (classification === 'UNPROFITABLE') unprofitableCells += 1;

        // Track best/worst (only cells with trades)
        if (!bestCell || score > bestCell.score) {
          bestCell = { category: cat, holdTime: r.name, score };
        }
        if (!worstCell || score < worstCell.score) {
          worstCell = { category: cat, holdTime: r.name, score };
        }

        row.holdTimeRanges.push({
          range: r.name,
          tradeCount: cell.tradeCount,
          totalProfit: Math.round(cell.totalProfit * 100) / 100,
          avgProfit: Math.round(avgProfit * 100) / 100,
          avgROI: Math.round(avgROI * 10) / 10,
          winRate: Math.round(winRate * 10) / 10,
          profitabilityScore: score,
          classification,
        });
      }
      matrix.push(row);
    }

    // 4) Sort categories: by total profit (desc) across all hold-times
    matrix.sort((a, b) => {
      const sa = a.holdTimeRanges.reduce((s, r) => s + r.totalProfit, 0);
      const sb = b.holdTimeRanges.reduce((s, r) => s + r.totalProfit, 0);
      return sb - sa;
    });

    // 5) Identify sweet spots — best hold-time per category (only if has trades)
    const sweetSpots: SweetSpot[] = [];
    for (const row of matrix) {
      let best: HoldTimeCell | null = null;
      for (const cell of row.holdTimeRanges) {
        if (cell.tradeCount === 0) continue;
        if (!best || cell.profitabilityScore > best.profitabilityScore) {
          best = cell;
        }
      }
      if (best && best.tradeCount > 0) {
        sweetSpots.push({
          category: row.category,
          bestHoldTime: best.range,
          avgProfit: best.avgProfit,
        });
      }
    }

    // 6) Generate advice
    let advice: string;
    if (!bestCell) {
      advice =
        'Ni dovolj podatkov za izračun profitability matrike. Dodaj več prodanih trade-ov z datumskom nakupa in prodaje.';
    } else {
      const bestRow = matrix.find(r => r.category === bestCell!.category);
      const bestCellData = bestRow?.holdTimeRanges.find(c => c.range === bestCell!.holdTime);
      const roiStr = bestCellData ? `, ${bestCellData.avgROI}% ROI` : '';
      advice = `Najbolj dobičkonosna kombinacija: "${bestCell.category}" × ${bestCell.holdTime} (score ${bestCell.score}${roiStr}). ${
        sweetSpots.length > 0
          ? `Top sweet spot: "${sweetSpots[0]!.category}" pri ${sweetSpots[0]!.bestHoldTime} (avg ${sweetSpots[0]!.avgProfit}€). `
          : ''
      }Fokusiraj nabavo na te kombinacije za maksimalno profitabilnost.`;
    }

    const insights: Insights = {
      bestCombination: bestCell,
      worstCombination: worstCell,
      sweetSpots: sweetSpots.slice(0, 10),
      advice,
    };

    const summary: Summary = {
      totalCategories: matrix.length,
      totalCombinations,
      highlyProfitableCells,
      unprofitableCells,
    };

    return NextResponse.json({
      ok: true,
      matrix,
      insights,
      summary,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-profitability-matrix',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
