// v7.33: AI Deal Score Threshold Optimizer — najdi optimalni threshold za max profit
//
// Analizira zgodovinske podatke: za vsak možni threshold (1-10) izračuna
// expected profit = (profitable count × avg profit) - (unprofitable count × avg loss).
// Threshold z najvišjim expected profit je optimalen.
//
// POST /api/ai/deal-score-threshold-optimizer
// Body: {} (uses all historical trades)
// Returns: {
//   ok,
//   current: { threshold, expectedProfit },
//   optimal: { threshold, expectedProfit, improvementPct },
//   analysis: [{ threshold, listingsPassed, profitableCount, unprofitableCount, expectedProfit }]
// }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Pridobi vse liste, ki imajo aiScore in so bile kupljene/prodane
    const listings = await db.listing.findMany({
      where: {
        aiScore: { not: null },
        isHidden: false,
        trades: { some: {} }, // ima vsaj en trade
      },
      select: {
        id: true,
        aiScore: true,
        trades: {
          select: {
            buyPrice: true,
            buyFees: true,
            sellPrice: true,
            sellFees: true,
            status: true,
          },
        },
      },
      take: 500,
    });

    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'Ni zgodovinskih trade-ov z AI score za analizo. Dodajaj trade in AI oceni oglase.',
        current: null,
        optimal: null,
        analysis: [],
      });
    }

    // Za vsak listing izračunaj profit (če je sold)
    type ScoredListing = { aiScore: number; profit: number | null; isSold: boolean };
    const scored: ScoredListing[] = listings.map(l => {
      const trade = l.trades[0];
      if (!trade) return { aiScore: l.aiScore ?? 0, profit: null, isSold: false };
      if (trade.status === 'sold' && trade.sellPrice != null) {
        const profit = trade.sellPrice - (trade.sellFees ?? 0) - trade.buyPrice - (trade.buyFees ?? 0);
        return { aiScore: l.aiScore ?? 0, profit, isSold: true };
      }
      return { aiScore: l.aiScore ?? 0, profit: null, isSold: false };
    });

    // Za vsak threshold 1-10 izračunaj expected profit
    const analysis: Array<{
      threshold: number;
      listingsPassed: number;
      profitableCount: number;
      unprofitableCount: number;
      avgProfit: number;
      avgLoss: number;
      expectedProfit: number;
    }> = [];

    for (let threshold = 1; threshold <= 10; threshold++) {
      const passed = scored.filter(l => l.aiScore >= threshold);
      const sold = passed.filter(l => l.isSold && l.profit !== null);
      const profitable = sold.filter(l => (l.profit ?? 0) > 0);
      const unprofitable = sold.filter(l => (l.profit ?? 0) <= 0);

      const totalProfit = profitable.reduce((s, l) => s + (l.profit ?? 0), 0);
      const totalLoss = unprofitable.reduce((s, l) => s + Math.abs(l.profit ?? 0), 0);

      const avgProfit = profitable.length > 0 ? totalProfit / profitable.length : 0;
      const avgLoss = unprofitable.length > 0 ? totalLoss / unprofitable.length : 0;

      // Expected profit = (profitable ratio × avgProfit) - (unprofitable ratio × avgLoss)
      // Scaled by total listings that pass (volume matters)
      const soldCount = sold.length;
      const expectedProfitPerDeal = soldCount > 0
        ? (profitable.length / soldCount) * avgProfit - (unprofitable.length / soldCount) * avgLoss
        : 0;
      // Total expected profit = per-deal × total listings passed (estimate)
      // Only count sold trades for accuracy, but estimate volume based on pass rate
      const passRate = scored.length > 0 ? passed.length / scored.length : 0;
      const expectedTotalProfit = expectedProfitPerDeal * passed.length * 0.3; // 30% conversion estimate

      analysis.push({
        threshold,
        listingsPassed: passed.length,
        profitableCount: profitable.length,
        unprofitableCount: unprofitable.length,
        avgProfit: Math.round(avgProfit * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        expectedProfit: Math.round(expectedTotalProfit * 100) / 100,
      });
    }

    // Najdi optimalen threshold (najvišji expected profit)
    const optimal = analysis.reduce((best, cur) => cur.expectedProfit > best.expectedProfit ? cur : best, analysis[0]);

    // Trenutni threshold iz Settings
    const settings = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: { minOpportunityScore: true },
    });
    const currentThreshold = settings?.minOpportunityScore ?? 7;
    const currentAnalysis = analysis.find(a => a.threshold === currentThreshold) ?? analysis[0];

    const improvementPct = currentAnalysis.expectedProfit > 0
      ? Math.round(((optimal.expectedProfit - currentAnalysis.expectedProfit) / Math.abs(currentAnalysis.expectedProfit)) * 100)
      : 0;

    return NextResponse.json({
      ok: true,
      current: {
        threshold: currentThreshold,
        expectedProfit: currentAnalysis.expectedProfit,
        profitableCount: currentAnalysis.profitableCount,
        unprofitableCount: currentAnalysis.unprofitableCount,
      },
      optimal: {
        threshold: optimal.threshold,
        expectedProfit: optimal.expectedProfit,
        profitableCount: optimal.profitableCount,
        unprofitableCount: optimal.unprofitableCount,
        improvementPct,
      },
      analysis,
      recommendation: optimal.threshold !== currentThreshold
        ? `Spremeni minOpportunityScore iz ${currentThreshold} na ${optimal.threshold}. Pričakovan dobiček: +${improvementPct}% (${currentAnalysis.expectedProfit}€ → ${optimal.expectedProfit}€).`
        : `Trenutni threshold (${currentThreshold}) je optimalen. Pričakovan dobiček: ${optimal.expectedProfit}€.`,
    });
  } catch (err: any) {
    logger.error('/api/ai/deal-score-threshold-optimizer', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
