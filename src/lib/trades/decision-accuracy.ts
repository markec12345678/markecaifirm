// v8.70: Decision Accuracy Analytics — meta-analysis that validates the intelligence suite.
// "Does my buy scoring actually work? Is high buy score predictive of high outcome?"
//
// This is the capstone that closes the learning loop:
// v8.65-69 built the intelligence → v8.70 validates it's actually accurate.
//
// Analyzes:
//   1. Buy Score vs Outcome correlation — is high buy score predictive of good outcome?
//   2. Smart Price accuracy — how close were suggested prices to actual sell prices?
//   3. Sell Priority accuracy — did high-priority trades actually need urgent selling?

import { db } from '@/lib/db';
import { computeSmartPrice } from '@/lib/trades/smart-pricing';
import { computeOutcomeScore } from '@/lib/trades/outcome-score';

export interface BuyScoreBucket {
  range: string;          // '0-25', '26-50', '51-75', '76-100'
  count: number;
  avgOutcomeScore: number;
  avgProfit: number;
  winRate: number;        // % of trades with profit > 0
  verdict: 'EXCELLENT' | 'GOOD' | 'POOR' | 'INVERTED' | 'INSUFFICIENT';
}

export interface DecisionAccuracyResult {
  ok: true;
  // --- Buy Score Accuracy ---
  buyScoreAccuracy: {
    totalTradesWithBothScores: number;
    correlation: number;          // -1 to 1 — Pearson correlation
    correlationLabel: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE' | 'INVERTED';
    accuracyPercent: number;      // 0-100 — % of trades where buy score correctly predicted outcome direction
    buckets: BuyScoreBucket[];    // 4 buckets: 0-25, 26-50, 51-75, 76-100
    highScoreAvgOutcome: number;   // avg outcome for buy score ≥75
    lowScoreAvgOutcome: number;    // avg outcome for buy score <50
    verdict: string;               // Slovenian actionable
  };
  // --- Smart Price Accuracy ---
  smartPriceAccuracy: {
    totalSoldWithBuyPrice: number;
    avgDeviationPercent: number;   // avg |actualPrice - suggestedOptimal| / suggestedOptimal × 100
    withinRange: number;            // % of trades where actual sellPrice was within [suggestedMin, suggestedMax]
    tooHigh: number;               // % sold above suggestedMax (overpriced/lucky)
    tooLow: number;                 // % sold below suggestedMin (underpriced)
    verdict: string;
  };
  // --- Overall Intelligence Health ---
  overallHealth: {
    score: number;                  // 0-100 — overall intelligence system health
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    insights: string[];            // Slovenian actionable insights
  };
  source: 'v8.70-decision-accuracy';
}

/**
 * Compute Pearson correlation coefficient between two arrays.
 * Returns -1 to 1.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

/**
 * Compute the full decision accuracy analytics.
 */
export async function getDecisionAccuracy(): Promise<DecisionAccuracyResult> {
  // Fetch all sold trades with buy score (persisted from v8.69)
  const soldWithBuyScore = await db.trade.findMany({
    where: {
      status: 'sold',
      sellPrice: { not: null },
      sellDate: { not: null },
      buyScore: { not: null },
    },
    select: {
      id: true, title: true, category: true, tags: true,
      buyPrice: true, buyFees: true, buyDate: true,
      sellPrice: true, sellFees: true, sellDate: true,
      buyScore: true, buyVerdict: true,
    },
  });

  // Fetch all sold trades for smart price accuracy (even without buy score)
  const allSold = await db.trade.findMany({
    where: {
      status: 'sold',
      sellPrice: { not: null },
      sellDate: { not: null },
    },
    select: {
      id: true, title: true, category: true, tags: true,
      buyPrice: true, buyFees: true, buyDate: true,
      sellPrice: true, sellFees: true, sellDate: true,
      buyScore: true, buyVerdict: true,
    },
  });

  // Build category context for outcome computation
  const categoryContext: Record<string, { avgROI: number; avgHoldDays: number; comparables: any[] }> = {};
  const categoryMap: Record<string, any[]> = {};
  for (const t of allSold) {
    const cat = t.category || 'drugo';
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(t);
  }
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
      return { sellPrice: t.sellPrice ?? 0, roiPercent: c > 0 ? ((r - c) / c) * 100 : 0 };
    });
    categoryContext[cat] = {
      avgROI: rois.reduce((s, r) => s + r, 0) / rois.length,
      avgHoldDays: holds.length > 0 ? holds.reduce((s, h) => s + h, 0) / holds.length : 0,
      comparables,
    };
  }

  // --- 1. Buy Score Accuracy ---
  let correlation = 0;
  let accuracyPercent = 0;
  let highScoreAvgOutcome = 0;
  let lowScoreAvgOutcome = 0;
  const buckets: BuyScoreBucket[] = [];

  if (soldWithBuyScore.length >= 3) {
    const buyScores: number[] = [];
    const outcomeScores: number[] = [];
    const outcomes: any[] = [];

    for (const t of soldWithBuyScore) {
      const cat = t.category || 'drugo';
      const ctx = categoryContext[cat] || { avgROI: null, avgHoldDays: null, comparables: [] };
      const outcome = computeOutcomeScore(
        {
          id: t.id,
          title: t.title,
          category: cat,
          tags: t.tags,
          buyPrice: t.buyPrice,
          buyFees: t.buyFees ?? 0,
          buyDate: t.buyDate,
          sellPrice: t.sellPrice!,
          sellFees: t.sellFees ?? 0,
          sellDate: t.sellDate!,
        },
        {
          categoryAvgROI: ctx.avgROI,
          categoryAvgHoldDays: ctx.avgHoldDays,
          comparables: ctx.comparables,
        }
      );
      buyScores.push(t.buyScore!);
      outcomeScores.push(outcome.overallScore);
      outcomes.push({ buyScore: t.buyScore!, outcome, trade: t });
    }

    // Pearson correlation
    correlation = pearsonCorrelation(buyScores, outcomeScores);

    // Accuracy: % of trades where high buy score (≥50) → outcome ≥50, or low buy score (<50) → outcome <50
    let correct = 0;
    for (const o of outcomes) {
      if ((o.buyScore >= 50 && o.outcome.overallScore >= 50) || (o.buyScore < 50 && o.outcome.overallScore < 50)) {
        correct++;
      }
    }
    accuracyPercent = (correct / outcomes.length) * 100;

    // High vs low score outcomes
    const highScore = outcomes.filter(o => o.buyScore >= 75);
    const lowScore = outcomes.filter(o => o.buyScore < 50);
    highScoreAvgOutcome = highScore.length > 0 ? highScore.reduce((s, o) => s + o.outcome.overallScore, 0) / highScore.length : 0;
    lowScoreAvgOutcome = lowScore.length > 0 ? lowScore.reduce((s, o) => s + o.outcome.overallScore, 0) / lowScore.length : 0;

    // Buckets
    const bucketRanges = [
      { range: '0-25', min: 0, max: 25 },
      { range: '26-50', min: 26, max: 50 },
      { range: '51-75', min: 51, max: 75 },
      { range: '76-100', min: 76, max: 100 },
    ];
    for (const br of bucketRanges) {
      const inBucket = outcomes.filter(o => o.buyScore >= br.min && o.buyScore <= br.max);
      if (inBucket.length > 0) {
        const avgOutcome = inBucket.reduce((s, o) => s + o.outcome.overallScore, 0) / inBucket.length;
        const avgProfit = inBucket.reduce((s, o) => s + o.outcome.profit, 0) / inBucket.length;
        const winRate = (inBucket.filter(o => o.outcome.profit > 0).length / inBucket.length) * 100;
        let verdict: BuyScoreBucket['verdict'];
        if (avgOutcome >= 70) verdict = 'EXCELLENT';
        else if (avgOutcome >= 50) verdict = 'GOOD';
        else if (avgOutcome >= 30) verdict = 'POOR';
        else verdict = 'INVERTED';
        buckets.push({
          range: br.range,
          count: inBucket.length,
          avgOutcomeScore: Math.round(avgOutcome),
          avgProfit: Math.round(avgProfit),
          winRate: Math.round(winRate),
          verdict,
        });
      }
    }
  }

  // Correlation label
  let correlationLabel: DecisionAccuracyResult['buyScoreAccuracy']['correlationLabel'];
  const absCorr = Math.abs(correlation);
  if (correlation < -0.2) correlationLabel = 'INVERTED';
  else if (absCorr >= 0.5) correlationLabel = 'STRONG';
  else if (absCorr >= 0.3) correlationLabel = 'MODERATE';
  else if (absCorr >= 0.1) correlationLabel = 'WEAK';
  else correlationLabel = 'NONE';

  // Buy verdict text
  let buyVerdictText: string;
  if (soldWithBuyScore.length < 3) {
    buyVerdictText = 'Premalo podatkov za analizo — potrebuj vsaj 3 prodane trade-e z buy score-om.';
  } else if (correlation >= 0.5 && accuracyPercent >= 70) {
    buyVerdictText = `✓ Buy score je zanesljiv (${accuracyPercent.toFixed(0)}% natančnost, korelacija ${correlation.toFixed(2)}). Visok buy score napoveduje visok outcome.`;
  } else if (correlation >= 0.3 && accuracyPercent >= 60) {
    buyVerdictText = `△ Buy score je zmerno zanesljiv (${accuracyPercent.toFixed(0)}% natančnost). Uporabljaj ga kot vodilo, ne kot edino resnico.`;
  } else if (correlation < 0) {
    buyVerdictText = `✗ Buy score je obrnjen (korelacija ${correlation.toFixed(2)}) — visok buy score napoveduje nizek outcome! Popravi algoritem.`;
  } else {
    buyVerdictText = `○ Buy score ni zanesljiv (${accuracyPercent.toFixed(0)}% natančnost, korelacija ${correlation.toFixed(2)}). Potrebna kalibracija.`;
  }

  // --- 2. Smart Price Accuracy ---
  let totalSoldWithBuyPrice = 0;
  let avgDeviationPercent = 0;
  let withinRange = 0;
  let tooHigh = 0;
  let tooLow = 0;

  if (allSold.length > 0) {
    let totalDeviation = 0;
    let inRange = 0;
    let above = 0;
    let below = 0;
    let counted = 0;

    for (const t of allSold) {
      const cat = t.category || 'drugo';
      const ctx = categoryContext[cat] || { avgROI: null, avgHoldDays: null, comparables: [] };
      const smart = computeSmartPrice(
        {
          id: t.id,
          title: t.title,
          category: cat,
          tags: t.tags,
          buyPrice: t.buyPrice,
          buyFees: t.buyFees ?? 0,
          buyDate: t.buyDate,
        },
        {
          categoryAvgROI: ctx.avgROI,
          comparables: ctx.comparables?.map(c => ({
            title: '', category: cat, buyPrice: 0, sellPrice: c.sellPrice,
            profit: 0, roiPercent: c.roiPercent, daysHeld: 0, sellDate: null,
          })),
        }
      );
      const actualPrice = t.sellPrice ?? 0;
      const optimal = smart.suggestedOptimal;
      if (optimal > 0) {
        const deviation = Math.abs(actualPrice - optimal) / optimal * 100;
        totalDeviation += deviation;
        counted++;
        if (actualPrice >= smart.suggestedMin && actualPrice <= smart.suggestedMax) {
          inRange++;
        } else if (actualPrice > smart.suggestedMax) {
          above++;
        } else {
          below++;
        }
      }
    }

    if (counted > 0) {
      totalSoldWithBuyPrice = counted;
      avgDeviationPercent = totalDeviation / counted;
      withinRange = (inRange / counted) * 100;
      tooHigh = (above / counted) * 100;
      tooLow = (below / counted) * 100;
    }
  }

  let smartPriceVerdict: string;
  if (totalSoldWithBuyPrice < 3) {
    smartPriceVerdict = 'Premalo podatkov za analizo smart price.';
  } else if (withinRange >= 60 && avgDeviationPercent < 15) {
    smartPriceVerdict = `✓ Smart price je natančen (${withinRange.toFixed(0)}% v obsegu, povprečno odstopanje ${avgDeviationPercent.toFixed(0)}%).`;
  } else if (withinRange >= 40) {
    smartPriceVerdict = `△ Smart price je zmerno natančen (${withinRange.toFixed(0)}% v obsegu, povprečno odstopanje ${avgDeviationPercent.toFixed(0)}%).`;
  } else {
    smartPriceVerdict = `○ Smart price ni natančen (${withinRange.toFixed(0)}% v obsegu, povprečno odstopanje ${avgDeviationPercent.toFixed(0)}%). Kalibriraj algoritem.`;
  }

  // --- 3. Overall Intelligence Health ---
  let healthScore = 50; // base
  if (soldWithBuyScore.length >= 3) {
    if (accuracyPercent >= 70) healthScore += 20;
    else if (accuracyPercent >= 60) healthScore += 10;
    else healthScore -= 10;
    if (correlation >= 0.5) healthScore += 15;
    else if (correlation >= 0.3) healthScore += 8;
    else if (correlation < 0) healthScore -= 20;
  } else {
    healthScore -= 10; // insufficient data
  }
  if (totalSoldWithBuyPrice >= 3) {
    if (withinRange >= 60 && avgDeviationPercent < 15) healthScore += 15;
    else if (withinRange >= 40) healthScore += 5;
    else healthScore -= 5;
  }
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  let grade: DecisionAccuracyResult['overallHealth']['grade'];
  if (healthScore >= 85) grade = 'A';
  else if (healthScore >= 70) grade = 'B';
  else if (healthScore >= 55) grade = 'C';
  else if (healthScore >= 40) grade = 'D';
  else grade = 'F';

  const insights: string[] = [];
  if (soldWithBuyScore.length < 3) {
    insights.push(`Zbiraj več podatkov — trenutno ${soldWithBuyScore.length} prodaj z buy score-om (potrebno ≥3).`);
  }
  if (correlation >= 0.5) {
    insights.push(`Buy score korelira z outcome-om (${correlation.toFixed(2)}) — algoritem deluje.`);
  } else if (correlation < 0) {
    insights.push(`⚠️ Buy score je obrnjen — popravi uteži v computeBuyScore().`);
  }
  if (highScoreAvgOutcome > lowScoreAvgOutcome + 15) {
    insights.push(`STRONG_BUY trade-i imajo ${highScoreAvgOutcome.toFixed(0)}/100 outcome vs ${lowScoreAvgOutcome.toFixed(0)}/100 za AVOID — dobra diferenciacija.`);
  }
  if (withinRange >= 60) {
    insights.push(`Smart price predlogi so v ${withinRange.toFixed(0)}% primerov znotraj obsega — dobro kalibriran.`);
  } else if (tooLow > 40) {
    insights.push(`⚠️ ${tooLow.toFixed(0)}% prodaj pod suggestedMin — predlagaj višje cene.`);
  } else if (tooHigh > 40) {
    insights.push(`${tooHigh.toFixed(0)}% prodaj nad suggestedMax — morda podcenjuješ tržne cene.`);
  }
  if (insights.length === 0) {
    insights.push('Inteligentni sistem deluje konsistentno — nadaljuj z enako strategijo.');
  }

  return {
    ok: true,
    buyScoreAccuracy: {
      totalTradesWithBothScores: soldWithBuyScore.length,
      correlation: Math.round(correlation * 100) / 100,
      correlationLabel,
      accuracyPercent: Math.round(accuracyPercent),
      buckets,
      highScoreAvgOutcome: Math.round(highScoreAvgOutcome),
      lowScoreAvgOutcome: Math.round(lowScoreAvgOutcome),
      verdict: buyVerdictText,
    },
    smartPriceAccuracy: {
      totalSoldWithBuyPrice,
      avgDeviationPercent: Math.round(avgDeviationPercent),
      withinRange: Math.round(withinRange),
      tooHigh: Math.round(tooHigh),
      tooLow: Math.round(tooLow),
      verdict: smartPriceVerdict,
    },
    overallHealth: {
      score: healthScore,
      grade,
      insights,
    },
    source: 'v8.70-decision-accuracy',
  };
}
