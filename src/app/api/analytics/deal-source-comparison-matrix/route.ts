// v7.70: Deal Source Comparison Matrix — 2D matrika ki primerja vire (Bolha,
// Vinted, Facebook, mobile.de) čez več metrik (ROI, win rate, avg hold days,
// deal score, volume). Pomaga odločati katere vire prioritetizirati. Pure DB
// analytics — NO AI.
//
// "Bolha: #1 (score 85, ROI 32%, win 70%). Vinted: #2 (score 72, ROI 18%).
//  Best for elektronika: Bolha. Best for moda: Vinted."
//
// Razlika od deal-source-roi (ki meri ROI per vir — eno metriko) — ta
// primerja vire čez 5+ metrik z normalizacijo in overall score. Razlika od
// source-quality (ki ocenjuje listing quality per vir) — ta gleda FINANČNE
// metrike (ROI, win rate, profit per day, capital efficiency). Razlika od
// listing-performance (ki spremlja listing aktivnost) — ta gleda sales
// performance per vir.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-source-comparison-matrix

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface SourceMetrics {
  totalTrades: number;
  totalInvested: number;
  totalProfit: number;
  avgROI: number; // %
  winRate: number; // %
  avgHoldDays: number;
  avgDealScore: number;
  avgProfitPerTrade: number;
  profitPerDay: number;
  capitalEfficiency: number; // totalProfit / totalInvested
  riskScore: number; // 0-10, lower = safer
}

interface NormalizedScores {
  roiScore: number; // 0-100
  winRateScore: number;
  holdDaysScore: number;
  dealScoreScore: number;
  riskScore: number; // 0-100 (higher = safer)
}

interface MatrixRow {
  source: string;
  displayName: string;
  metrics: SourceMetrics;
  normalizedScores: NormalizedScores;
  overallScore: number; // 0-100
  rank: number; // 1 = best
}

interface CategoryBreakdown {
  source: string;
  category: string;
  trades: number;
  profit: number;
  roi: number;
}

interface BestSourceByMetric {
  roi: string | null;
  winRate: string | null;
  speed: string | null;
  safety: string | null;
}

interface CategorySourceMatch {
  category: string;
  bestSource: string;
  reasoning: string;
}

interface Recommendations {
  bestSourceOverall: string | null;
  bestSourceByMetric: BestSourceByMetric;
  sourcePriorityAdvice: string;
  categorySourceMatch: CategorySourceMatch[];
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

// Mapping source (monitor.source / buyLocation normalized) → display name
const SOURCE_DISPLAY: Record<string, string> = {
  bolha: 'Bolha',
  vinted: 'Vinted',
  facebook: 'Facebook',
  avtonet: 'Avtonet',
  mobilede: 'mobile.de',
  'mobile-de': 'mobile.de',
  kleinanzeigen: 'Kleinanzeigen',
  subito: 'Subito',
  willhaben: 'Willhaben',
  nepremicnine: 'Nepremičnine',
  salomon: 'Salomon',
  'custom-rss': 'Custom RSS',
  unknown: 'Neznan',
};

function displayName(source: string): string {
  if (SOURCE_DISPLAY[source]) return SOURCE_DISPLAY[source];
  return source.charAt(0).toUpperCase() + source.slice(1);
}

// Normalize buyLocation string to a known source key.
// buyLocation is free-form ("Bolha", "FB", "Vinted", "Facebook Marketplace", ...)
function normalizeSource(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('bolha')) return 'bolha';
  if (s.includes('vinted')) return 'vinted';
  if (s.includes('face') || s === 'fb' || s.includes('marketplace')) return 'facebook';
  if (s.includes('avtonet')) return 'avtonet';
  if (s.includes('mobile.de') || s.includes('mobilede')) return 'mobilede';
  if (s.includes('kleinan')) return 'kleinanzeigen';
  if (s.includes('subito')) return 'subito';
  if (s.includes('willhaben')) return 'willhaben';
  if (s.includes('nepremicn')) return 'nepremicnine';
  if (s.includes('salomon')) return 'salomon';
  if (s.includes('rss')) return 'custom-rss';
  return 'unknown';
}

// Normalize a value to 0-100 score relative to min/max in the cohort.
// For "higher is better" metrics: score = (value - min) / (max - min) × 100.
// For "lower is better" metrics: score = (max - value) / (max - min) × 100.
function normalize(
  values: number[],
  higherIsBetter: boolean,
): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    // All same — give 50 to everyone (neutral)
    return values.map(() => 50);
  }
  return values.map(v => {
    const raw = higherIsBetter
      ? (v - min) / (max - min)
      : (max - v) / (max - min);
    return Math.round(Math.max(0, Math.min(1, raw)) * 100);
  });
}

// Overall score = weighted average of normalized metrics.
// Weights: ROI 30%, winRate 25%, holdDays 15%, dealScore 15%, risk 15%.
const WEIGHTS = {
  roi: 0.3,
  winRate: 0.25,
  holdDays: 0.15,
  dealScore: 0.15,
  risk: 0.15,
};

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all SOLD trades with linked Listing (for monitor.source, aiRisk, dealScore)
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
        buyDate: true,
        buyLocation: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            id: true,
            dealScore: true,
            aiRisk: true,
            monitor: { select: { source: true } },
          },
        },
      },
      take: 10000,
    });

    // Empty state
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        matrix: [],
        sourceCategoryBreakdown: [],
        recommendations: {
          bestSourceOverall: null,
          bestSourceByMetric: {
            roi: null,
            winRate: null,
            speed: null,
            safety: null,
          },
          sourcePriorityAdvice:
            'Ni prodanih trade-ov — Deal Source Comparison Matrix ni mogoč. Dodaš trades z buyLocation ali poveži listing-e z monitorji.',
          categorySourceMatch: [],
        },
        message: 'Ni prodanih trade-ov — Deal Source Comparison Matrix ni mogoč.',
      });
    }

    // 2) Group by source
    interface TradeAgg {
      source: string;
      trades: Array<{
        profit: number;
        buyPrice: number;
        buyFees: number;
        sellPrice: number;
        sellFees: number;
        holdDays: number;
        dealScore: number | null;
        aiRisk: number | null;
        category: string;
      }>;
    }
    const bySource = new Map<string, TradeAgg>();

    for (const t of soldTrades) {
      // Determine source: prefer buyLocation (free-form) → fall back to monitor.source
      const buyLocRaw = (t.buyLocation || '').trim();
      let source: string;
      if (buyLocRaw) {
        source = normalizeSource(buyLocRaw);
      } else {
        const monSrc = (t.listing?.monitor?.source || '').trim().toLowerCase();
        source = monSrc ? normalizeSource(monSrc) : 'unknown';
      }
      if (source === 'unknown' && t.listing?.monitor?.source) {
        // If buyLocation is empty, fall back to monitor.source normalized key
        source = normalizeSource(t.listing.monitor.source);
      }

      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const profit = sellPrice - sellFees - buyPrice - buyFees;

      let holdDays = 0;
      if (t.buyDate && t.sellDate) {
        const holdMs =
          new Date(t.sellDate).getTime() - new Date(t.buyDate).getTime();
        if (Number.isFinite(holdMs) && holdMs > 0) {
          holdDays = Math.round(holdMs / DAY_MS);
        }
      }

      const dealScore = t.listing?.dealScore ?? null;
      const aiRisk = t.listing?.aiRisk ?? null;
      const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';

      let agg = bySource.get(source);
      if (!agg) {
        agg = { source, trades: [] };
        bySource.set(source, agg);
      }
      agg.trades.push({
        profit,
        buyPrice,
        buyFees,
        sellPrice,
        sellFees,
        holdDays,
        dealScore,
        aiRisk,
        category,
      });
    }

    // 3) Compute metrics per source
    interface SourceAgg {
      source: string;
      metrics: SourceMetrics;
    }
    const sourceAggs: SourceAgg[] = [];

    for (const [source, agg] of bySource.entries()) {
      const trades = agg.trades;
      const totalTrades = trades.length;
      const totalInvested = trades.reduce((s, t) => s + t.buyPrice + t.buyFees, 0);
      const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
      const avgROI =
        totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
      const wins = trades.filter(t => t.profit > 0).length;
      const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const avgHoldDays =
        totalTrades > 0
          ? trades.reduce((s, t) => s + t.holdDays, 0) / totalTrades
          : 0;
      const dealScoreValues = trades
        .map(t => t.dealScore)
        .filter((v): v is number => v != null && v >= 0);
      const avgDealScore =
        dealScoreValues.length > 0
          ? dealScoreValues.reduce((s, v) => s + v, 0) / dealScoreValues.length
          : 0;
      const avgProfitPerTrade =
        totalTrades > 0 ? totalProfit / totalTrades : 0;
      const profitPerDay =
        avgHoldDays > 0 ? avgProfitPerTrade / avgHoldDays : 0;
      const capitalEfficiency =
        totalInvested > 0 ? totalProfit / totalInvested : 0;
      const riskValues = trades
        .map(t => t.aiRisk)
        .filter((v): v is number => v != null && v >= 0 && v <= 10);
      const riskScore =
        riskValues.length > 0
          ? riskValues.reduce((s, v) => s + v, 0) / riskValues.length
          : 5; // neutral 5/10 if no data

      sourceAggs.push({
        source,
        metrics: {
          totalTrades,
          totalInvested: Math.round(totalInvested * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100,
          avgROI: Math.round(avgROI * 10) / 10,
          winRate: Math.round(winRate * 10) / 10,
          avgHoldDays: Math.round(avgHoldDays * 10) / 10,
          avgDealScore: Math.round(avgDealScore * 10) / 10,
          avgProfitPerTrade: Math.round(avgProfitPerTrade * 100) / 100,
          profitPerDay: Math.round(profitPerDay * 100) / 100,
          capitalEfficiency: Math.round(capitalEfficiency * 1000) / 1000,
          riskScore: Math.round(riskScore * 10) / 10,
        },
      });
    }

    // 4) Normalize metrics across sources (0-100)
    const roiScores = normalize(
      sourceAggs.map(s => s.metrics.avgROI),
      true,
    );
    const winRateScores = normalize(
      sourceAggs.map(s => s.metrics.winRate),
      true,
    );
    const holdDaysScores = normalize(
      sourceAggs.map(s => s.metrics.avgHoldDays),
      false, // lower = better (faster)
    );
    const dealScoreScores = normalize(
      sourceAggs.map(s => s.metrics.avgDealScore),
      true,
    );
    const riskScores = normalize(
      sourceAggs.map(s => 10 - s.metrics.riskScore), // invert: lower risk = higher score
      true,
    );

    // 5) Compute overall score + rank
    const matrix: MatrixRow[] = sourceAggs.map((s, i) => {
      const ns: NormalizedScores = {
        roiScore: roiScores[i] ?? 0,
        winRateScore: winRateScores[i] ?? 0,
        holdDaysScore: holdDaysScores[i] ?? 0,
        dealScoreScore: dealScoreScores[i] ?? 0,
        riskScore: riskScores[i] ?? 0,
      };
      const overall = Math.round(
        ns.roiScore * WEIGHTS.roi +
          ns.winRateScore * WEIGHTS.winRate +
          ns.holdDaysScore * WEIGHTS.holdDays +
          ns.dealScoreScore * WEIGHTS.dealScore +
          ns.riskScore * WEIGHTS.risk,
      );
      return {
        source: s.source,
        displayName: displayName(s.source),
        metrics: s.metrics,
        normalizedScores: ns,
        overallScore: overall,
        rank: 0, // assigned after sort
      };
    });

    // Sort by overallScore desc, assign rank
    matrix.sort((a, b) => b.overallScore - a.overallScore);
    matrix.forEach((m, i) => {
      m.rank = i + 1;
    });

    // 6) Per-source × per-category breakdown
    const sourceCategoryBreakdown: CategoryBreakdown[] = [];
    const bySourceCat = new Map<string, Map<string, { trades: number; profit: number; invested: number }>>();

    for (const [source, agg] of bySource.entries()) {
      for (const tr of agg.trades) {
        let catMap = bySourceCat.get(source);
        if (!catMap) {
          catMap = new Map();
          bySourceCat.set(source, catMap);
        }
        const cur = catMap.get(tr.category) || {
          trades: 0,
          profit: 0,
          invested: 0,
        };
        cur.trades += 1;
        cur.profit += tr.profit;
        cur.invested += tr.buyPrice + tr.buyFees;
        catMap.set(tr.category, cur);
      }
    }

    for (const [source, catMap] of bySourceCat.entries()) {
      for (const [category, d] of catMap.entries()) {
        const roi = d.invested > 0 ? (d.profit / d.invested) * 100 : 0;
        sourceCategoryBreakdown.push({
          source,
          category,
          trades: d.trades,
          profit: Math.round(d.profit * 100) / 100,
          roi: Math.round(roi * 10) / 10,
        });
      }
    }

    // Sort breakdown: source → roi desc
    sourceCategoryBreakdown.sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return b.roi - a.roi;
    });

    // 7) Recommendations
    // Best source overall = rank 1
    const bestSourceOverall =
      matrix.length > 0 && matrix[0] ? matrix[0].source : null;

    // Best source by metric
    const findByMaxMetric = (key: keyof SourceMetrics): string | null => {
      if (sourceAggs.length === 0) return null;
      let best: SourceAgg | null = null;
      for (const s of sourceAggs) {
        if (!best || (s.metrics[key] as number) > (best.metrics[key] as number)) {
          best = s;
        }
      }
      return best ? best.source : null;
    };
    const findByMinMetric = (key: keyof SourceMetrics): string | null => {
      if (sourceAggs.length === 0) return null;
      let best: SourceAgg | null = null;
      for (const s of sourceAggs) {
        if (!best || (s.metrics[key] as number) < (best.metrics[key] as number)) {
          best = s;
        }
      }
      return best ? best.source : null;
    };

    const bestSourceByMetric: BestSourceByMetric = {
      roi: findByMaxMetric('avgROI'),
      winRate: findByMaxMetric('winRate'),
      speed: findByMinMetric('avgHoldDays'),
      safety: findByMinMetric('riskScore'),
    };

    // Source priority advice
    let sourcePriorityAdvice: string;
    if (matrix.length === 0) {
      sourcePriorityAdvice = 'Ni podatkov o virih — dodaj buyLocation ali poveži listing-e z monitorji.';
    } else if (matrix.length === 1) {
      const m = matrix[0]!;
      sourcePriorityAdvice = `Samo en vir (${m.displayName}). Overall score: ${m.overallScore}/100. Diverzificiraj v druge vire za zmanjšanje tveganja.`;
    } else {
      const top = matrix[0]!;
      const worst = matrix[matrix.length - 1]!;
      sourcePriorityAdvice = `Prioriteta #1: ${top.displayName} (score ${top.overallScore}/100, ROI ${top.metrics.avgROI}%). Zmanjšaj aktivnost v ${worst.displayName} (score ${worst.overallScore}/100, ROI ${worst.metrics.avgROI}%). Premakni kapital v ${top.displayName} za večji ROI.`;
    }

    // Category-source match: for each category, which source has best ROI (with ≥3 trades)
    const categorySourceMatch: CategorySourceMatch[] = [];
    const byCategory = new Map<string, Array<{ source: string; trades: number; roi: number; profit: number }>>();
    for (const b of sourceCategoryBreakdown) {
      let arr = byCategory.get(b.category);
      if (!arr) {
        arr = [];
        byCategory.set(b.category, arr);
      }
      arr.push({
        source: b.source,
        trades: b.trades,
        roi: b.roi,
        profit: b.profit,
      });
    }
    for (const [category, arr] of byCategory.entries()) {
      // Filter: only consider sources with ≥3 trades in this category
      const eligible = arr.filter(a => a.trades >= 3);
      if (eligible.length === 0) continue;
      eligible.sort((a, b) => b.roi - a.roi);
      const best = eligible[0];
      if (!best) continue;
      categorySourceMatch.push({
        category,
        bestSource: best.source,
        reasoning: `Najboljši vir za "${category}": ${displayName(best.source)} (ROI ${best.roi}%, ${best.trades} prodaj, ${best.profit}€ profit).`,
      });
    }
    // Sort by category name
    categorySourceMatch.sort((a, b) => a.category.localeCompare(b.category));

    const recommendations: Recommendations = {
      bestSourceOverall,
      bestSourceByMetric,
      sourcePriorityAdvice,
      categorySourceMatch,
    };

    return NextResponse.json({
      ok: true,
      matrix,
      sourceCategoryBreakdown,
      recommendations,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-source-comparison-matrix',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
