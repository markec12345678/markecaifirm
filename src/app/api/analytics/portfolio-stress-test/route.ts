// v7.59: Portfolio Stress Test — simulacija kako portfolio preživi
// različne tržne scenarije (mild/moderate/severe market drop).
//
// "Pri -25% padcu trga izgubiš 450€ (18% kapitala). Najbolj ranljiva:
//  elektronika. Prodi PS5 zdaj."
//
// Pure DB analytics (NO AI). Stresni testi:
//   MILD    -10% drop (×0.90)
//   MODERATE -25% drop (×0.75)
//   SEVERE  -40% drop (×0.60)
//
// GET /api/analytics/portfolio-stress-test

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ScenarioName = 'MILD' | 'MODERATE' | 'SEVERE';

interface StressScenario {
  name: ScenarioName;
  marketDropPercent: number; // -10, -25, -40
  stressFactor: number; // 0.90, 0.75, 0.60
  stressedValue: number;
  capitalLoss: number; // could be negative (loss)
  lossPercent: number;
  itemsUnderwater: number;
  worstCategory: string;
  bestCategory: string;
}

interface CategoryVulnerability {
  category: string;
  itemCount: number;
  invested: number;
  currentValue: number;
  mildStressValue: number;
  moderateStressValue: number;
  severeStressValue: number;
  vulnerabilityScore: number; // higher = more vulnerable
}

interface Recommendation {
  immediateLiquidate: string[]; // trade IDs
  holdStrong: string[]; // trade IDs
  hedgingAdvice: string;
}

const SCENARIO_DEFS: Array<{
  name: ScenarioName;
  marketDropPercent: number;
  stressFactor: number;
}> = [
  { name: 'MILD', marketDropPercent: -10, stressFactor: 0.90 },
  { name: 'MODERATE', marketDropPercent: -25, stressFactor: 0.75 },
  { name: 'SEVERE', marketDropPercent: -40, stressFactor: 0.60 },
];

export async function GET() {
  try {
    // 1) HELD trades with linked Listing (for aiEstimatedValue, category, dealScore)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            dealScore: true,
          },
        },
      },
      take: 1000,
    });

    // Graceful handling: empty portfolio
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        currentPortfolio: {
          totalHeldCapital: 0,
          totalEstimatedValue: 0,
          unrealizedProfit: 0,
          itemCount: 0,
          avgDealScore: 0,
        },
        scenarios: [],
        categoryVulnerability: [],
        recommendation: {
          immediateLiquidate: [],
          holdStrong: [],
          hedgingAdvice:
            'Skladišče je prazno — ni inventarja za stresni test.',
        },
        message: 'Ni held inventarja — stresni test ni mogoč.',
      });
    }

    // 2) Pre-compute per-item: estimatedValue (fallback to buyPrice*1.2 like liquidation-strategist)
    interface HeldItem {
      id: string;
      title: string;
      category: string;
      buyPrice: number;
      estValue: number; // resolved
      dealScore: number | null;
    }
    const items: HeldItem[] = heldTrades.map(t => {
      const estValue =
        t.listing?.aiEstimatedValue && t.listing.aiEstimatedValue > 0
          ? t.listing.aiEstimatedValue
          : Math.round(t.buyPrice * 1.2);
      return {
        id: t.id,
        title: t.title,
        category: (t.category || 'drugo').trim().toLowerCase(),
        buyPrice: t.buyPrice,
        estValue,
        dealScore: t.listing?.dealScore ?? null,
      };
    });

    // 3) Current portfolio totals
    const totalHeldCapital = items.reduce((s, i) => s + i.buyPrice, 0);
    const totalEstimatedValue = items.reduce((s, i) => s + i.estValue, 0);
    const unrealizedProfit = totalEstimatedValue - totalHeldCapital;
    const dealScoreValues = items
      .map(i => i.dealScore)
      .filter((v): v is number => v != null);
    const avgDealScore =
      dealScoreValues.length > 0
        ? Math.round(
            dealScoreValues.reduce((s, v) => s + v, 0) / dealScoreValues.length,
          )
        : 0;

    // 4) Query SOLD trades for historical win/loss pattern (informational)
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellPrice: { not: null },
      },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      take: 1000,
    });
    let historicalWinRate = 0;
    if (soldTrades.length > 0) {
      const profitable = soldTrades.filter(t => {
        const buy = t.buyPrice + (t.buyFees ?? 0);
        const sell = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        return sell - buy > 0;
      }).length;
      historicalWinRate = Math.round((profitable / soldTrades.length) * 100);
    }

    // 5) Run 3 stress scenarios
    const scenarios: StressScenario[] = SCENARIO_DEFS.map(def => {
      const stressedValue = items.reduce(
        (s, i) => s + i.estValue * def.stressFactor,
        0,
      );
      const capitalLoss = stressedValue - totalHeldCapital; // negative = loss
      const lossPercent =
        totalHeldCapital > 0
          ? Math.round((capitalLoss / totalHeldCapital) * 1000) / 10
          : 0;
      const itemsUnderwater = items.filter(
        i => i.estValue * def.stressFactor < i.buyPrice,
      ).length;

      // Per-category loss for this scenario
      const catLossMap = new Map<string, number>();
      const catInvestedMap = new Map<string, number>();
      for (const i of items) {
        const stressed = i.estValue * def.stressFactor;
        const loss = stressed - i.buyPrice;
        catLossMap.set(i.category, (catLossMap.get(i.category) ?? 0) + loss);
        catInvestedMap.set(
          i.category,
          (catInvestedMap.get(i.category) ?? 0) + i.buyPrice,
        );
      }
      // Normalize loss per € invested so we can compare categories fairly
      let worstCategory = '—';
      let bestCategory = '—';
      let worstNorm = -Infinity;
      let bestNorm = Infinity;
      for (const [cat, loss] of catLossMap.entries()) {
        const invested = catInvestedMap.get(cat) ?? 1;
        const norm = loss / invested; // negative = worse
        if (norm < worstNorm) {
          worstNorm = norm;
          worstCategory = cat;
        }
        if (norm < bestNorm) {
          bestNorm = norm;
          bestCategory = cat;
        } else if (worstCategory === bestCategory) {
          // only one category — best == worst; that's fine
        }
      }
      // If only 1 category, bestCategory should remain "—" (no comparison)
      if (catLossMap.size === 1) {
        bestCategory = '—';
      } else {
        // Re-find best by looking for the LEAST-negative normalized loss
        // (different from worst)
        bestNorm = Infinity;
        bestCategory = '—';
        const worstCat = worstCategory;
        for (const [cat, loss] of catLossMap.entries()) {
          if (cat === worstCat) continue;
          const invested = catInvestedMap.get(cat) ?? 1;
          const norm = loss / invested;
          if (norm < bestNorm) {
            bestNorm = norm;
            bestCategory = cat;
          }
        }
      }

      return {
        name: def.name,
        marketDropPercent: def.marketDropPercent,
        stressFactor: def.stressFactor,
        stressedValue: Math.round(stressedValue),
        capitalLoss: Math.round(capitalLoss),
        lossPercent,
        itemsUnderwater,
        worstCategory,
        bestCategory,
      };
    });

    // 6) Per-category vulnerability breakdown
    const catMap = new Map<
      string,
      {
        itemCount: number;
        invested: number;
        currentValue: number;
        mild: number;
        moderate: number;
        severe: number;
      }
    >();
    for (const i of items) {
      const cur = catMap.get(i.category) || {
        itemCount: 0,
        invested: 0,
        currentValue: 0,
        mild: 0,
        moderate: 0,
        severe: 0,
      };
      cur.itemCount += 1;
      cur.invested += i.buyPrice;
      cur.currentValue += i.estValue;
      cur.mild += i.estValue * 0.90;
      cur.moderate += i.estValue * 0.75;
      cur.severe += i.estValue * 0.60;
      catMap.set(i.category, cur);
    }
    const categoryVulnerability: CategoryVulnerability[] = Array.from(
      catMap.entries(),
    ).map(([category, d]) => {
      // vulnerabilityScore = how much % lost under SEVERE stress (0-100 scale)
      const severeLossPct =
        d.invested > 0
          ? Math.max(0, ((d.invested - d.severe) / d.invested) * 100)
          : 0;
      // Boost vulnerability if category has many items (concentration risk)
      const concentrationBoost = Math.min(20, d.itemCount * 4);
      const vulnerabilityScore = Math.round(
        Math.min(100, severeLossPct * 0.8 + concentrationBoost),
      );
      return {
        category,
        itemCount: d.itemCount,
        invested: Math.round(d.invested),
        currentValue: Math.round(d.currentValue),
        mildStressValue: Math.round(d.mild),
        moderateStressValue: Math.round(d.moderate),
        severeStressValue: Math.round(d.severe),
        vulnerabilityScore,
      };
    });
    categoryVulnerability.sort((a, b) => b.vulnerabilityScore - a.vulnerabilityScore);

    // 7) Recommendation: which items to liquidate NOW vs hold strong
    // immediateLiquidate: items already underwater under MILD stress
    //   (i.e., items that lose money even with just a -10% market dip)
    const immediateLiquidate = items
      .filter(i => i.estValue * 0.90 < i.buyPrice)
      .sort((a, b) => a.estValue * 0.90 - a.buyPrice - (b.estValue * 0.90 - b.buyPrice))
      .map(i => i.id);

    // holdStrong: items still profitable under SEVERE stress
    //   (i.e., estValue * 0.60 - buyPrice > 0)
    const holdStrong = items
      .filter(i => i.estValue * 0.60 - i.buyPrice > 0)
      .sort((a, b) => b.estValue * 0.60 - b.buyPrice - (a.estValue * 0.60 - a.buyPrice))
      .map(i => i.id);

    // Hedging advice — based on which scenarios show losses
    const severeScenario = scenarios.find(s => s.name === 'SEVERE')!;
    const moderateScenario = scenarios.find(s => s.name === 'MODERATE')!;
    let hedgingAdvice: string;
    if (severeScenario.capitalLoss < 0 && moderateScenario.capitalLoss < 0) {
      const worstCat = severeScenario.worstCategory;
      hedgingAdvice = `Pri -25% padcu trga izgubiš ${Math.abs(
        moderateScenario.capitalLoss,
      )}€ (${Math.abs(moderateScenario.lossPercent)}% kapitala). Najbolj ranljiva: ${worstCat}. ${
        immediateLiquidate.length > 0
          ? `Prodi ${immediateLiquidate.length} item-e zdaj da zmanjšaš izpostavljenost.`
          : 'Diversificiraj kategorije.'
      }`;
    } else if (moderateScenario.capitalLoss < 0) {
      hedgingAdvice = `Pri -25% padcu bi izgubil ${Math.abs(
        moderateScenario.capitalLoss,
      )}€, a pri -10% si še v plusu. Diversificiraj v manj volatile kategorije.`;
    } else {
      hedgingAdvice = `Portfolio je odporen tudi na -25% padec (${moderateScenario.capitalLoss >= 0 ? '+' : ''}${moderateScenario.capitalLoss}€). Drži pozicije.`;
    }

    const recommendation: Recommendation = {
      immediateLiquidate,
      holdStrong,
      hedgingAdvice,
    };

    return NextResponse.json({
      ok: true,
      currentPortfolio: {
        totalHeldCapital: Math.round(totalHeldCapital),
        totalEstimatedValue: Math.round(totalEstimatedValue),
        unrealizedProfit: Math.round(unrealizedProfit),
        itemCount: items.length,
        avgDealScore,
      },
      scenarios,
      categoryVulnerability,
      recommendation,
      historicalContext: {
        soldTradesAnalyzed: soldTrades.length,
        historicalWinRate,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/portfolio-stress-test', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
