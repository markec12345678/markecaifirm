// v7.67: Profit Efficiency Analyzer — meri kako učinkovito pretvarjaš čas +
// kapital v profit. Računa profit-per-day, profit-per-hold-day, capital
// efficiency ratio in time-weighted ROI. Čist analytics brez AI.
//
// "Profit 2000€ v 90 dneh = 22€/dan. Najbolj učinkovita: elektronika
//  (1.5€/hold-day). Letna projekcija: 8030€."
//
// Razlika od profit-dashboard (ki prikazuje splošen profit presek) — ta
// meri EFFICIENCY (profit per dan/hold-day/trade) in letno projekcijo.
// Razlika od roi-leaderboard (ki rank-a kategorije po ROI) — ta gleda
// profit-per-hold-day (€ earned per dan vezave kapitala) in annualized.
// Razlika od cash-conversion-cycle (ki meri koliko dni od nakupa do
// prodaje) — ta računa € earned per dan aktivnosti + per dan vezanega
// kapitala, z 0-100 time/capital efficiency score.
//
// Pure DB analytics (NO AI). GET /api/analytics/profit-efficiency-analyzer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface EfficiencyMetrics {
  totalProfit: number;
  totalInvested: number;
  totalHoldDays: number;
  totalTradingDays: number;
  tradeCount: number;
  profitPerDay: number;
  profitPerTrade: number;
  profitPerHoldDay: number;
  capitalEfficiencyRatio: number; // %
  annualizedProfitPerDay: number;
  timeEfficiencyScore: number; // 0-100
  capitalUtilizationScore: number; // 0-100
}

interface CategoryEfficiencyRow {
  category: string;
  tradeCount: number;
  totalProfit: number;
  avgHoldDays: number;
  profitPerHoldDay: number;
  efficiencyRank: number;
}

interface PriceRangeEfficiencyRow {
  range: string;
  tradeCount: number;
  totalProfit: number;
  avgHoldDays: number;
  profitPerHoldDay: number;
}

interface EfficiencyRecommendations {
  mostEfficientCategory: string | null;
  leastEfficientCategory: string | null;
  efficiencyAdvice: string;
  targetImprovements: string[];
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;

const PRICE_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-100€', min: 0, max: 100 },
  { label: '100-500€', min: 100, max: 500 },
  { label: '500€+', min: 500, max: Number.POSITIVE_INFINITY },
];

function priceRangeLabel(buyPrice: number): string {
  for (const r of PRICE_RANGES) {
    if (buyPrice >= r.min && buyPrice < r.max) return r.label;
  }
  return '0-100€';
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function computeTimeEfficiencyScore(avgHoldDays: number): number {
  if (avgHoldDays < 15) return 100;
  if (avgHoldDays < 30) return 80;
  if (avgHoldDays < 45) return 60;
  if (avgHoldDays < 60) return 40;
  return 20;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all SOLD trades with buy+sell dates for efficiency analysis
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
        sellDate: { not: null },
        buyPrice: { gt: 0 },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      take: 5000,
    });

    // Empty state
    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        efficiency: {
          totalProfit: 0,
          totalInvested: 0,
          totalHoldDays: 0,
          totalTradingDays: 0,
          tradeCount: 0,
          profitPerDay: 0,
          profitPerTrade: 0,
          profitPerHoldDay: 0,
          capitalEfficiencyRatio: 0,
          annualizedProfitPerDay: 0,
          timeEfficiencyScore: 0,
          capitalUtilizationScore: 0,
        },
        byCategory: [],
        byPriceRange: [],
        recommendations: {
          mostEfficientCategory: null,
          leastEfficientCategory: null,
          efficiencyAdvice:
            'Ni prodanih trade-ov — Profit Efficiency analiza ni mogoča. Začni z nakupom in prodajo.',
          targetImprovements: [
            'Dodaj prvi sold trade z buyDate in sellDate za začetek efficiency analize.',
          ],
        },
        message:
          'Ni prodanih trade-ov z veljavnimi datumi — Profit Efficiency analiza ni mogoča.',
      });
    }

    // 2) Compute per-trade profit + hold-days
    const tradesWithMetrics = soldTrades
      .map(t => {
        const buy = t.buyPrice + (t.buyFees ?? 0);
        const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        const profit = sell - buy;
        const buyDate = t.buyDate ? new Date(t.buyDate) : null;
        const sellDate = t.sellDate ? new Date(t.sellDate) : null;
        if (!buyDate || !sellDate) return null;
        const holdMs = sellDate.getTime() - buyDate.getTime();
        if (!Number.isFinite(holdMs) || holdMs < 0) return null;
        const holdDays = holdMs / DAY_MS;
        return {
          id: t.id,
          category: (t.category || 'drugo').trim().toLowerCase() || 'drugo',
          buyPrice: t.buyPrice,
          buy,
          profit,
          holdDays,
          buyDate,
          sellDate,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    if (tradesWithMetrics.length === 0) {
      return NextResponse.json({
        ok: true,
        efficiency: {
          totalProfit: 0,
          totalInvested: 0,
          totalHoldDays: 0,
          totalTradingDays: 0,
          tradeCount: 0,
          profitPerDay: 0,
          profitPerTrade: 0,
          profitPerHoldDay: 0,
          capitalEfficiencyRatio: 0,
          annualizedProfitPerDay: 0,
          timeEfficiencyScore: 0,
          capitalUtilizationScore: 0,
        },
        byCategory: [],
        byPriceRange: [],
        recommendations: {
          mostEfficientCategory: null,
          leastEfficientCategory: null,
          efficiencyAdvice:
            'Vsak sold trade potrebuje veljaven buyDate in sellDate za efficiency analizo.',
          targetImprovements: [
            'Popravi datume na sold trade-ih (buyDate < sellDate) za efficiency analizo.',
          ],
        },
        message:
          'Ni prodanih trade-ov z veljavnimi datumi (buyDate < sellDate) — Profit Efficiency analiza ni mogoča.',
      });
    }

    // 3) Aggregate totals
    const totalProfit = tradesWithMetrics.reduce((s, t) => s + t.profit, 0);
    const totalInvested = tradesWithMetrics.reduce((s, t) => s + t.buy, 0);
    const totalHoldDays = tradesWithMetrics.reduce(
      (s, t) => s + t.holdDays,
      0,
    );
    const tradeCount = tradesWithMetrics.length;

    // totalTradingDays = days from first buyDate to last sellDate
    const firstBuy = tradesWithMetrics.reduce(
      (min, t) => (t.buyDate < min ? t.buyDate : min),
      tradesWithMetrics[0].buyDate,
    );
    const lastSell = tradesWithMetrics.reduce(
      (max, t) => (t.sellDate > max ? t.sellDate : max),
      tradesWithMetrics[0].sellDate,
    );
    const totalTradingDays = Math.max(
      1,
      Math.round((lastSell.getTime() - firstBuy.getTime()) / DAY_MS),
    );

    const avgHoldDays = totalHoldDays / tradeCount;

    // 4) Compute efficiency metrics
    const profitPerDay = round2(totalProfit / totalTradingDays);
    const profitPerTrade = round2(totalProfit / tradeCount);
    const profitPerHoldDay =
      totalHoldDays > 0 ? round2(totalProfit / totalHoldDays) : 0;
    const capitalEfficiencyRatio =
      totalInvested > 0
        ? Math.round((totalProfit / totalInvested) * 1000) / 10
        : 0;
    const annualizedProfitPerDay = round2(profitPerDay * 365);

    const timeEfficiencyScore = computeTimeEfficiencyScore(avgHoldDays);

    // capitalUtilizationScore = % kapitala aktivno deploy-anega (vs idle).
    // Formula: totalInvested / (totalInvested + currentHeldCapital) × 100
    // (held capital = capital currently locked in unsold inventory)
    let heldCapital = 0;
    try {
      const heldTrades = await db.trade.findMany({
        where: { status: 'held' },
        select: { buyPrice: true, buyFees: true },
        take: 2000,
      });
      heldCapital = heldTrades.reduce(
        (s, t) => s + (t.buyPrice + (t.buyFees ?? 0)),
        0,
      );
    } catch {
      heldCapital = 0;
    }
    const totalCapital = totalInvested + heldCapital;
    const capitalUtilizationScore =
      totalCapital > 0
        ? Math.round((totalInvested / totalCapital) * 100)
        : 0;

    const efficiency: EfficiencyMetrics = {
      totalProfit: Math.round(totalProfit),
      totalInvested: Math.round(totalInvested),
      totalHoldDays: Math.round(totalHoldDays),
      totalTradingDays,
      tradeCount,
      profitPerDay,
      profitPerTrade,
      profitPerHoldDay,
      capitalEfficiencyRatio,
      annualizedProfitPerDay,
      timeEfficiencyScore,
      capitalUtilizationScore,
    };

    // 5) Per-category efficiency
    const catMap = new Map<
      string,
      {
        count: number;
        profit: number;
        holdDays: number;
      }
    >();
    for (const t of tradesWithMetrics) {
      const cur =
        catMap.get(t.category) || { count: 0, profit: 0, holdDays: 0 };
      cur.count += 1;
      cur.profit += t.profit;
      cur.holdDays += t.holdDays;
      catMap.set(t.category, cur);
    }
    let byCategory: CategoryEfficiencyRow[] = Array.from(
      catMap.entries(),
    ).map(([category, d]) => ({
      category,
      tradeCount: d.count,
      totalProfit: Math.round(d.profit),
      avgHoldDays: Math.round((d.holdDays / d.count) * 10) / 10,
      profitPerHoldDay:
        d.holdDays > 0 ? round2(d.profit / d.holdDays) : 0,
      efficiencyRank: 0,
    }));
    // Rank by profitPerHoldDay desc (higher = more efficient)
    byCategory.sort((a, b) => b.profitPerHoldDay - a.profitPerHoldDay);
    byCategory = byCategory.map((row, idx) => ({
      ...row,
      efficiencyRank: idx + 1,
    }));

    // 6) Per-price-range efficiency
    const rangeMap = new Map<
      string,
      {
        count: number;
        profit: number;
        holdDays: number;
      }
    >();
    for (const t of tradesWithMetrics) {
      const range = priceRangeLabel(t.buyPrice);
      const cur =
        rangeMap.get(range) || { count: 0, profit: 0, holdDays: 0 };
      cur.count += 1;
      cur.profit += t.profit;
      cur.holdDays += t.holdDays;
      rangeMap.set(range, cur);
    }
    const byPriceRange: PriceRangeEfficiencyRow[] = Array.from(
      rangeMap.entries(),
    ).map(([range, d]) => ({
      range,
      tradeCount: d.count,
      totalProfit: Math.round(d.profit),
      avgHoldDays: Math.round((d.holdDays / d.count) * 10) / 10,
      profitPerHoldDay:
        d.holdDays > 0 ? round2(d.profit / d.holdDays) : 0,
    }));

    // 7) Recommendations
    const mostEfficientCategory =
      byCategory.length > 0 && byCategory[0].profitPerHoldDay > 0
        ? byCategory[0].category
        : null;
    const leastEfficientCategory =
      byCategory.length > 1
        ? byCategory[byCategory.length - 1].category
        : null;

    let efficiencyAdvice: string;
    if (timeEfficiencyScore >= 80 && capitalUtilizationScore >= 70) {
      efficiencyAdvice = `Odlična učinkovitost: ${profitPerDay}€/dan, ${profitPerHoldDay}€/hold-day, time score ${timeEfficiencyScore}/100, capital utilization ${capitalUtilizationScore}%. Vzdržuj tempo in povečaj volumen v "${mostEfficientCategory ?? 'najboljši kategoriji'}".`;
    } else if (timeEfficiencyScore >= 60) {
      efficiencyAdvice = `Dobra učinkovitost: ${profitPerDay}€/dan (letna projekcija ${annualizedProfitPerDay}€). Time score ${timeEfficiencyScore}/100 — skrajšaj hold time za +20/100. Najbolj učinkovita kategorija: "${mostEfficientCategory ?? '—'}".`;
    } else if (timeEfficiencyScore >= 40) {
      efficiencyAdvice = `Povprečna učinkovitost: ${profitPerDay}€/dan, avg hold ${Math.round(avgHoldDays)} dni. Time score ${timeEfficiencyScore}/100 — pospeši prodajo (hitrejše cene, boljše slike) za +20 točk. Fokusiraj nakupe v "${mostEfficientCategory ?? '—'}" (${byCategory[0]?.profitPerHoldDay ?? 0}€/hold-day).`;
    } else {
      efficiencyAdvice = `Nizka učinkovitost: ${profitPerDay}€/dan z avg hold ${Math.round(avgHoldDays)} dni. Time score ${timeEfficiencyScore}/100 — kritično skrajšaj hold time. Mogoče nakupe premakni v "${mostEfficientCategory ?? '—'}" kjer je profit/hold-day višji.`;
    }

    const targetImprovements: string[] = [];
    if (mostEfficientCategory) {
      targetImprovements.push(
        `Povečaj volumen v "${mostEfficientCategory}" (${byCategory[0]?.profitPerHoldDay ?? 0}€/hold-day, rank #1) za 30-50% v naslednjih 2-3 kupih.`,
      );
    }
    if (
      leastEfficientCategory &&
      leastEfficientCategory !== mostEfficientCategory
    ) {
      targetImprovements.push(
        `Zmanjšaj aktivnost v "${leastEfficientCategory}" (rank #${byCategory.length}, ${byCategory[byCategory.length - 1]?.profitPerHoldDay ?? 0}€/hold-day) — premakni kapital v boljše kategorije.`,
      );
    }
    if (timeEfficiencyScore < 80) {
      targetImprovements.push(
        `Skrajšaj avg hold time iz ${Math.round(avgHoldDays)} na <30 dni (time score ${timeEfficiencyScore} → 80+) z agresivnejšim pricing-om in boljšo prezentacijo.`,
      );
    }
    if (capitalUtilizationScore < 60) {
      targetImprovements.push(
        `Povečaj capital utilization iz ${capitalUtilizationScore}% na 70%+ — zmanjšaj idle capital v held inventarju (trenutno ${Math.round(heldCapital)}€ vezano).`,
      );
    }
    targetImprovements.push(
      `Letna projekcija pri trenutnem tempu: ${annualizedProfitPerDay}€ — za +20% povečaj profitPerTrade iz ${profitPerTrade}€ na ${round2(profitPerTrade * 1.2)}€.`,
    );

    const recommendations: EfficiencyRecommendations = {
      mostEfficientCategory,
      leastEfficientCategory,
      efficiencyAdvice,
      targetImprovements,
    };

    return NextResponse.json({
      ok: true,
      efficiency,
      byCategory,
      byPriceRange,
      recommendations,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/profit-efficiency-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
