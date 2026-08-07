// v7.64: Deal Fatigue Detector — detektira kdaj trader dela slabe odločitve
// zaradi overtradinga/utrujenosti. Analizira recent trade velocity, win rate
// decline in decision quality metrike ter opozori "deal-fatigued si — vzemi premor".
//
// Razlika od market-momentum (ki gleda TRG kot celoto) — ta gleda TRADERJA in
// njegovo odločanje. Razlika od inventory-aging-predictor (ki gleda held
// inventar) — ta gleda traderjevo POTEKAVANJO v 3 časovnih oknih.
//
// "Fatigue 68/100 (FATIGUED) — frequency +180%, win rate -20%. Vzemi 7-dnevni premor."
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-fatigue-detector

import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Classification =
  | 'FRESH'
  | 'NORMAL'
  | 'MILD_FATIGUE'
  | 'FATIGUED'
  | 'BURNOUT';

type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface WindowMetrics {
  tradeCount: number;
  tradeFrequency: number; // trades per week
  winRate: number; // %
  avgDealScore: number;
  avgBuyPrice: number; // EUR
  cancellationRate: number; // %
}

interface Indicators {
  frequencyIncrease: number; // recent / previous (1.0 = no change)
  winRateDecline: number; // previous - recent (in pp, positive = decline)
  dealScoreDecline: number; // previous - recent (positive = decline)
  cancellationIncrease: number; // recent - previous (pp)
}

interface Recommendation {
  action: 'CONTINUE' | 'SLOW_DOWN' | 'TAKE_BREAK' | 'STOP_TRADING';
  reasoning: string;
  suggestedBreakDays: number;
}

export async function GET(_req: NextRequest) {
  try {
    const now = Date.now();
    const dayMs = 86_400_000;

    // 3 windows: recent30 (0-30d), previous30 (30-60d), older30 (60-90d)
    const recent30Start = new Date(now - 30 * dayMs);
    const previous30Start = new Date(now - 60 * dayMs);
    const older30Start = new Date(now - 90 * dayMs);

    // 1) Query trades from last 90 days, split by buyDate
    const recentTrades = await db.trade.findMany({
      where: {
        buyDate: { gte: recent30Start },
      },
      select: {
        id: true,
        status: true,
        buyPrice: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        buyFees: true,
        sellDate: true,
        listing: { select: { dealScore: true } },
      },
      take: 5000,
    });

    const previousTrades = await db.trade.findMany({
      where: {
        buyDate: { gte: previous30Start, lt: recent30Start },
      },
      select: {
        id: true,
        status: true,
        buyPrice: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        buyFees: true,
        sellDate: true,
        listing: { select: { dealScore: true } },
      },
      take: 5000,
    });

    const olderTrades = await db.trade.findMany({
      where: {
        buyDate: { gte: older30Start, lt: previous30Start },
      },
      select: {
        id: true,
        status: true,
        buyPrice: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        buyFees: true,
        sellDate: true,
        listing: { select: { dealScore: true } },
      },
      take: 5000,
    });

    if (recentTrades.length === 0 && previousTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        fatigueScore: 0,
        classification: 'FRESH',
        indicators: {
          frequencyIncrease: 1,
          winRateDecline: 0,
          dealScoreDecline: 0,
          cancellationIncrease: 0,
        },
        windows: {
          recent30: emptyWindow(),
          previous30: emptyWindow(),
          older30: emptyWindow(),
        },
        warnings: [],
        recommendation: {
          action: 'CONTINUE',
          reasoning:
            'Ni dovolj zgodovine trade-ov v zadnjih 90 dneh za analizo utrujenosti.',
          suggestedBreakDays: 0,
        },
        trend: 'STABLE',
        message:
          'Ni trade-ov v zadnjih 90 dneh — Deal Fatigue Detector potrebuje vsaj 1 trade v tem obdobju.',
      });
    }

    // 2) Compute per-window metrics
    function computeWindow(
      trades: typeof recentTrades,
      windowDays: number,
    ): WindowMetrics {
      const tradeCount = trades.length;
      // Trades per week = (count / windowDays) × 7
      const tradeFrequency =
        tradeCount > 0
          ? Math.round((tradeCount / windowDays) * 7 * 10) / 10
          : 0;

      // Win rate based on SOLD trades (sold + non-cancelled in window, isWin = profit > 0)
      const soldInWindow = trades.filter(
        t => t.status === 'sold' && t.sellPrice != null && t.buyPrice > 0,
      );
      let winCount = 0;
      for (const t of soldInWindow) {
        const buy = t.buyPrice + (t.buyFees ?? 0);
        const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        if (sell - buy > 0) winCount += 1;
      }
      const winRate =
        soldInWindow.length > 0
          ? Math.round((winCount / soldInWindow.length) * 100)
          : 0;

      // avg dealScore from linked listings
      const dealScores = trades
        .map(t => t.listing?.dealScore)
        .filter((v): v is number => v != null && v > 0);
      const avgDealScore =
        dealScores.length > 0
          ? Math.round(
              dealScores.reduce((s, v) => s + v, 0) / dealScores.length,
            )
          : 0;

      const avgBuyPrice =
        tradeCount > 0 && trades.some(t => t.buyPrice > 0)
          ? Math.round(
              trades
                .filter(t => t.buyPrice > 0)
                .reduce((s, t) => s + t.buyPrice, 0) /
                Math.max(1, trades.filter(t => t.buyPrice > 0).length),
            )
          : 0;

      const cancellationRate =
        tradeCount > 0
          ? Math.round(
              (trades.filter(t => t.status === 'cancelled').length /
                tradeCount) *
                100,
            )
          : 0;

      return {
        tradeCount,
        tradeFrequency,
        winRate,
        avgDealScore,
        avgBuyPrice,
        cancellationRate,
      };
    }

    const recent30 = computeWindow(recentTrades, 30);
    const previous30 = computeWindow(previousTrades, 30);
    const older30 = computeWindow(olderTrades, 30);

    // 3) Compute fatigue indicators
    // frequencyIncrease: recent / previous (1.0 = no change)
    const frequencyIncrease =
      previous30.tradeFrequency > 0
        ? Math.round(
            (recent30.tradeFrequency / previous30.tradeFrequency) * 100,
          ) / 100
        : recent30.tradeFrequency > 0
          ? 2.5 // severe — recent has frequency but previous doesn't
          : 1;

    // winRateDecline: previous - recent (positive = decline)
    const winRateDecline =
      previous30.winRate > 0 || recent30.winRate > 0
        ? Math.round(previous30.winRate - recent30.winRate)
        : 0;

    // dealScoreDecline: previous - recent (positive = decline)
    const dealScoreDecline =
      previous30.avgDealScore > 0 || recent30.avgDealScore > 0
        ? Math.round(previous30.avgDealScore - recent30.avgDealScore)
        : 0;

    // cancellationIncrease: recent - previous (pp)
    const cancellationIncrease = Math.round(
      recent30.cancellationRate - previous30.cancellationRate,
    );

    const indicators: Indicators = {
      frequencyIncrease,
      winRateDecline,
      dealScoreDecline,
      cancellationIncrease,
    };

    // 4) Compute fatigue score (0-100)
    let fatigueScore = 0;
    const warnings: string[] = [];

    // Frequency increase indicators
    if (frequencyIncrease >= 2.0) {
      fatigueScore += 25;
      warnings.push(
        `Overtrading: trade frequency +${Math.round(
          (frequencyIncrease - 1) * 100,
        )}% (recent ${recent30.tradeFrequency}/teden vs previous ${previous30.tradeFrequency}/teden).`,
      );
    } else if (frequencyIncrease >= 1.5) {
      fatigueScore += 15;
      warnings.push(
        `Povečan trade volume: +${Math.round(
          (frequencyIncrease - 1) * 100,
        )}% (recent ${recent30.tradeFrequency}/teden vs previous ${previous30.tradeFrequency}/teden).`,
      );
    }

    // Win rate decline indicators
    if (winRateDecline >= 15) {
      fatigueScore += 25;
      warnings.push(
        `Win rate padel za ${winRateDecline}pp (previous ${previous30.winRate}% → recent ${recent30.winRate}%).`,
      );
    } else if (winRateDecline >= 5) {
      fatigueScore += 15;
      warnings.push(
        `Win rate nekoliko nižji: -${winRateDecline}pp (previous ${previous30.winRate}% → recent ${recent30.winRate}%).`,
      );
    }

    // Deal score decline indicators
    if (dealScoreDecline >= 10) {
      fatigueScore += 20;
      warnings.push(
        `Kvaliteta nakupov se znižuje: avg dealScore -${dealScoreDecline} (previous ${previous30.avgDealScore} → recent ${recent30.avgDealScore}).`,
      );
    } else if (dealScoreDecline >= 5) {
      fatigueScore += 10;
      warnings.push(
        `Rahlo nižji dealScore: -${dealScoreDecline} (previous ${previous30.avgDealScore} → recent ${recent30.avgDealScore}).`,
      );
    }

    // Cancellation increase indicators
    if (cancellationIncrease >= 10) {
      fatigueScore += 15;
      warnings.push(
        `Stopnja preklicev narasla za +${cancellationIncrease}pp (previous ${previous30.cancellationRate}% → recent ${recent30.cancellationRate}%).`,
      );
    } else if (cancellationIncrease >= 5) {
      fatigueScore += 8;
      warnings.push(
        `Rahlo več preklicev: +${cancellationIncrease}pp (previous ${previous30.cancellationRate}% → recent ${recent30.cancellationRate}%).`,
      );
    }

    fatigueScore = Math.max(0, Math.min(100, fatigueScore));

    // 5) Classify
    let classification: Classification;
    if (fatigueScore <= 20) classification = 'FRESH';
    else if (fatigueScore <= 40) classification = 'NORMAL';
    else if (fatigueScore <= 60) classification = 'MILD_FATIGUE';
    else if (fatigueScore <= 80) classification = 'FATIGUED';
    else classification = 'BURNOUT';

    // 6) Compute trend (last 30 vs previous 30 win rate)
    let trend: Trend = 'STABLE';
    const winRateDelta = recent30.winRate - previous30.winRate;
    if (winRateDelta >= 10) trend = 'IMPROVING';
    else if (winRateDelta <= -10) trend = 'DECLINING';

    // 7) Recommendation based on classification
    let action: Recommendation['action'];
    let reasoning: string;
    let suggestedBreakDays: number;

    if (classification === 'FRESH' || classification === 'NORMAL') {
      action = 'CONTINUE';
      reasoning = `Fatigue ${fatigueScore}/100 (${classification}) — nadaljuj z normalnim tempom. Sledi disciplini in monitoring.`;
      suggestedBreakDays = 0;
    } else if (classification === 'MILD_FATIGUE') {
      action = 'SLOW_DOWN';
      reasoning = `Fatigue ${fatigueScore}/100 (MILD_FATIGUE) — zmanjšaj volumen za 30-50% naslednji teden in pregledaj zadnje odločitve.`;
      suggestedBreakDays = 3;
    } else if (classification === 'FATIGUED') {
      action = 'TAKE_BREAK';
      reasoning = `Fatigue ${fatigueScore}/100 (FATIGUED) — vzemi ${7}-dnevni premor od nakupov. Prodaj in zabeleži le obstoječi inventar. Premor bo resetiral odločitveno ostrino.`;
      suggestedBreakDays = 7;
    } else {
      // BURNOUT
      action = 'STOP_TRADING';
      reasoning = `Fatigue ${fatigueScore}/100 (BURNOUT) — kritično. Ustavi vse nove nakupe za ${30} dni. Pregledaj strategijo, morda potrebujReset ali pomoč. Skoncentriraj se na likvidacijo obstoječega inventarja.`;
      suggestedBreakDays = 30;
    }

    // 8) Build final response
    const response = {
      ok: true,
      fatigueScore,
      classification,
      indicators,
      windows: {
        recent30,
        previous30,
        older30,
      },
      warnings,
      recommendation: {
        action,
        reasoning,
        suggestedBreakDays,
      } as Recommendation,
      trend,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    logger.error('/api/analytics/deal-fatigue-detector', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}

function emptyWindow(): WindowMetrics {
  return {
    tradeCount: 0,
    tradeFrequency: 0,
    winRate: 0,
    avgDealScore: 0,
    avgBuyPrice: 0,
    cancellationRate: 0,
  };
}
