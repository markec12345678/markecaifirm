// v7.80: Seller Reliability Scorecard — celovit scorecard za vsakega
// prodajalca, s katerim si posloval — oceni 5 dimenzij (deal quality,
// pricing, consistency, value, reliability) z grade A+ do F. Pure DB.
// "Top seller: Elektro Marjan (A grade, 88/100). Best dimension:
// reliability (95). Buy more from: Marjan, Modna Kraljica."
//
// Razlika od seller-reliability-v2 (AI seller reliability v2) — ta je
// descriptivna analiza ZGODOVINSKIH trade-ov z 5-dimenzionalnim scorecard
// in grade per seller. Razlika od seller-trust-score-v2 (AI trust score) —
// ta da SCORECARD z 5 dimenzijami in grade distribucijo. Razlika od
// vendor-reliability (vendor reliability) — ta gleda POSAMEZNE sellerje
// z dimensional scoring. Razlika od seller-performance-analytics (v7.77,
// seller analytics) — ta da 5-DIMENZIONALNI scorecard z A+ do F grade in
// buyMoreFrom/avoidSellers priporočila. Razlika od deal-quality-scorecard
// (v7.79, ki oceni TRADE-e) — ta oceni SELLERJE z 5 dimenzijami in
// recommendations. Razlika od deal-source-comparison-matrix (v7.70, ki
// primerja vire) — ta gleda POSAMEZNE sellerje z dimensional scoring.
// Razlika od deal-source-roi (ki gleda ROI po viru) — ta da
// 5-DIMENZIONALNI scorecard per seller z grade in recommendations.
//
// Pure DB analytics (NO AI). GET /api/analytics/seller-reliability-scorecard

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

interface ScorecardDimensions {
  dealQualityScore: number; // 0-100
  pricingScore: number;
  consistencyScore: number;
  valueScore: number;
  reliabilityScore: number;
}

interface SellerScorecard {
  sellerName: string;
  totalDeals: number;
  dimensions: ScorecardDimensions;
  overallScore: number; // 0-100
  grade: Grade;
  insights: string[];
  improvementAreas: string[];
}

interface GradeDistribution {
  'A+': number;
  'A': number;
  'B': number;
  'C': number;
  'D': number;
  'F': number;
}

interface PortfolioScorecard {
  avgOverallScore: number;
  gradeDistribution: GradeDistribution;
  bestDimension: string | null;
  weakestDimension: string | null;
  totalSellers: number;
}

interface CategorySellerScorecard {
  category: string;
  bestSeller: string | null;
  avgSellerScore: number;
  dealCount: number;
}

interface SellerRecommendations {
  buyMoreFrom: Array<{ sellerName: string; reasoning: string }>;
  avoidSellers: Array<{ sellerName: string; reasoning: string }>;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
}

function clamp0_100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

// Variance of an array (for consistency scoring)
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / values.length;
}

// --- Seller aggregation --------------------------------------------------

interface SellerTradeAgg {
  dealScores: number[]; // listing.dealScore
  profits: number[]; // for sold trades
  dealScoreVariance: number;
  // Counters
  soldCount: number;
  profitableCount: number; // profit > 0
  heldCount: number;
  cancelledCount: number;
  totalCount: number;
  // Sums for averaging
  dealScoreSum: number;
  profitSum: number;
  // Per category breakdown
  categories: Set<string>;
}

function newSellerAgg(): SellerTradeAgg {
  return {
    dealScores: [],
    profits: [],
    dealScoreVariance: 0,
    soldCount: 0,
    profitableCount: 0,
    heldCount: 0,
    cancelledCount: 0,
    totalCount: 0,
    dealScoreSum: 0,
    profitSum: 0,
    categories: new Set(),
  };
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all SOLD and HELD trades with linked Listing (for sellerName)
    const trades = await db.trade.findMany({
      where: {
        status: { in: ['sold', 'held'] },
      },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            dealScore: true,
            sellerName: true,
            sellerListingCount: true,
          },
        },
      },
      orderBy: { buyDate: 'desc' },
      take: 100000,
    });

    // 2) Aggregate per seller
    const sellers = new Map<string, SellerTradeAgg>();
    for (const t of trades) {
      const sellerName = (t.listing?.sellerName || '').trim();
      if (!sellerName) continue; // skip trades without seller
      let agg = sellers.get(sellerName);
      if (!agg) {
        agg = newSellerAgg();
        sellers.set(sellerName, agg);
      }
      agg.totalCount += 1;
      const category = (t.category || '').trim().toLowerCase() || 'neznan';
      agg.categories.add(category);

      if (t.status === 'sold') {
        agg.soldCount += 1;
        const buyPrice = t.buyPrice ?? 0;
        const buyFees = t.buyFees ?? 0;
        const sellPrice = t.sellPrice ?? 0;
        const sellFees = t.sellFees ?? 0;
        const profit = sellPrice - sellFees - buyPrice - buyFees;
        agg.profits.push(profit);
        agg.profitSum += profit;
        if (profit > 0) agg.profitableCount += 1;
      } else if (t.status === 'held') {
        agg.heldCount += 1;
      } else if (t.status === 'cancelled') {
        agg.cancelledCount += 1;
      }

      // DealScore (if available)
      const dealScore = t.listing?.dealScore;
      if (dealScore != null && dealScore > 0) {
        agg.dealScores.push(dealScore);
        agg.dealScoreSum += dealScore;
      }
    }

    // Finalize seller aggregates (compute variance)
    for (const agg of sellers.values()) {
      agg.dealScoreVariance = variance(agg.dealScores);
    }

    // 3) Compute scorecards per seller
    const scorecards: SellerScorecard[] = [];

    for (const [sellerName, agg] of sellers.entries()) {
      // Skip sellers with no actual deals
      if (agg.totalCount === 0) continue;

      // --- Dimension 1: Deal Quality Score ---
      // Avg dealScore of their listings (higher = better quality deals)
      let dealQualityScore = 50; // default if no dealScores
      if (agg.dealScores.length > 0) {
        dealQualityScore = clamp0_100(
          round1(agg.dealScoreSum / agg.dealScores.length),
        );
      }

      // --- Dimension 2: Pricing Score ---
      // Avg discount achieved (aiEstimatedValue - buyPrice) / aiEstimatedValue × 100
      // We don't have per-trade aiEstimatedValue aggregation — derive from sold profits
      // Pricing score: how good was the buy price compared to sell price?
      // ROI proxy: if seller's items sold profitably, pricing was good
      let pricingScore = 50;
      if (agg.soldCount > 0 && agg.profits.length > 0) {
        // avg ROI as proxy for pricing
        const avgProfit = agg.profitSum / agg.soldCount;
        // Higher avg profit = better pricing
        // Map profit range to 0-100: profit -100€ = 0, 0€ = 50, +200€ = 100
        const normalized = 50 + (avgProfit / 200) * 50;
        pricingScore = clamp0_100(round1(normalized));
      }

      // --- Dimension 3: Consistency Score ---
      // Low variance in dealScore = consistent
      // variance 0 = 100, variance 500+ = 0
      let consistencyScore = 50;
      if (agg.dealScores.length >= 2) {
        const varScore = 100 - Math.min(100, (agg.dealScoreVariance / 500) * 100);
        consistencyScore = clamp0_100(round1(varScore));
      } else if (agg.dealScores.length === 1) {
        consistencyScore = 60; // single deal — moderate consistency
      }

      // --- Dimension 4: Value Score ---
      // Avg profit from their items
      let valueScore = 50;
      if (agg.soldCount > 0 && agg.profits.length > 0) {
        const avgProfit = agg.profitSum / agg.soldCount;
        // Map profit to 0-100: -100€ = 0, 0€ = 50, +500€ = 100
        const normalized = 50 + (avgProfit / 500) * 50;
        valueScore = clamp0_100(round1(normalized));
      } else if (agg.heldCount > 0) {
        valueScore = 50; // no sold trades — neutral
      }

      // --- Dimension 5: Reliability Score ---
      // Success rate: % of their items you sold profitably
      let reliabilityScore = 50;
      if (agg.soldCount > 0) {
        const successRate = (agg.profitableCount / agg.soldCount) * 100;
        reliabilityScore = clamp0_100(round1(successRate));
      } else if (agg.heldCount > 0) {
        reliabilityScore = 40; // held but not yet sold — lower reliability
      }

      const dimensions: ScorecardDimensions = {
        dealQualityScore,
        pricingScore,
        consistencyScore,
        valueScore,
        reliabilityScore,
      };

      // Overall score: weighted average (each 20%)
      const overallScore = round1(
        dealQualityScore * 0.20 +
          pricingScore * 0.20 +
          consistencyScore * 0.20 +
          valueScore * 0.20 +
          reliabilityScore * 0.20,
      );
      const grade = gradeFromScore(overallScore);

      // Insights (2-3 key insights)
      const insights: string[] = [];
      const dimEntries = Object.entries(dimensions) as Array<
        [keyof ScorecardDimensions, number]
      >;
      const sortedDims = [...dimEntries].sort((a, b) => b[1] - a[1]);
      const topDim = sortedDims[0];
      const lowDim = sortedDims[sortedDims.length - 1];
      if (topDim) {
        insights.push(
          `Najmočnejša dimenzija: ${dimensionName(topDim[0])} (${round0(topDim[1])}/100).`,
        );
      }
      if (lowDim) {
        insights.push(
          `Najšibkejša dimenzija: ${dimensionName(lowDim[0])} (${round0(lowDim[1])}/100).`,
        );
      }
      insights.push(
        `Skupno ${agg.totalCount} deal-ov (${agg.soldCount} sold, ${agg.heldCount} held).`,
      );

      // Improvement areas
      const improvementAreas: string[] = [];
      if (dimensions.dealQualityScore < 60) {
        improvementAreas.push(
          'Deal quality — preverjaj dealScore pred nakupom od tega sellerja.',
        );
      }
      if (dimensions.pricingScore < 60) {
        improvementAreas.push(
          'Pricing — pogajaj se za boljše cene pri tem sellerju.',
        );
      }
      if (dimensions.consistencyScore < 60) {
        improvementAreas.push(
          'Consistency — sellerjeve ponudbe so nepredvidljive — preverjaj vsak deal.',
        );
      }
      if (dimensions.valueScore < 60) {
        improvementAreas.push(
          'Value — iskati višje-value item-e od tega sellerja.',
        );
      }
      if (dimensions.reliabilityScore < 60) {
        improvementAreas.push(
          'Reliability — nizka stopnja profitabilnih prodaj — zmanjšaj obseg posla.',
        );
      }
      if (improvementAreas.length === 0) {
        improvementAreas.push('Seller je zanesljiv — ohrani poslovno razmerje.');
      }

      scorecards.push({
        sellerName: sellerName.slice(0, 100),
        totalDeals: agg.totalCount,
        dimensions,
        overallScore,
        grade,
        insights: insights.slice(0, 3),
        improvementAreas: improvementAreas.slice(0, 3),
      });
    }

    // Sort by overallScore desc
    scorecards.sort((a, b) => b.overallScore - a.overallScore);

    const totalSellers = scorecards.length;

    // Empty state
    if (totalSellers === 0) {
      return NextResponse.json({
        ok: true,
        scorecards: [],
        portfolio: {
          avgOverallScore: 0,
          gradeDistribution: {
            'A+': 0,
            'A': 0,
            'B': 0,
            'C': 0,
            'D': 0,
            'F': 0,
          },
          bestDimension: null,
          weakestDimension: null,
          totalSellers: 0,
        },
        byCategory: [],
        recommendations: {
          buyMoreFrom: [],
          avoidSellers: [],
          advice:
            'Ni trade-ov z znanim sellerName — Seller Reliability Scorecard ni mogoč.',
        },
        message:
          'Ni trade-ov z znanim sellerName — Seller Reliability Scorecard ni mogoč.',
      });
    }

    // 4) Portfolio scorecard summary
    const avgOverallScore =
      totalSellers > 0
        ? round1(
            scorecards.reduce((s, sc) => s + sc.overallScore, 0) / totalSellers,
          )
        : 0;
    const gradeDistribution: GradeDistribution = {
      'A+': 0,
      'A': 0,
      'B': 0,
      'C': 0,
      'D': 0,
      'F': 0,
    };
    for (const sc of scorecards) {
      gradeDistribution[sc.grade] += 1;
    }

    // Best/weakest dimension across portfolio
    const dimSums = {
      dealQualityScore: 0,
      pricingScore: 0,
      consistencyScore: 0,
      valueScore: 0,
      reliabilityScore: 0,
    };
    for (const sc of scorecards) {
      dimSums.dealQualityScore += sc.dimensions.dealQualityScore;
      dimSums.pricingScore += sc.dimensions.pricingScore;
      dimSums.consistencyScore += sc.dimensions.consistencyScore;
      dimSums.valueScore += sc.dimensions.valueScore;
      dimSums.reliabilityScore += sc.dimensions.reliabilityScore;
    }
    const dimAvgs = Object.entries(dimSums).map(([k, v]) => ({
      key: k as keyof ScorecardDimensions,
      avg: round1(v / totalSellers),
    }));
    const sortedDimsDesc = [...dimAvgs].sort((a, b) => b.avg - a.avg);
    const sortedDimsAsc = [...dimAvgs].sort((a, b) => a.avg - b.avg);
    const bestDimension = sortedDimsDesc[0]?.key ?? null;
    const weakestDimension = sortedDimsAsc[0]?.key ?? null;

    const portfolio: PortfolioScorecard = {
      avgOverallScore,
      gradeDistribution,
      bestDimension: bestDimension ? dimensionName(bestDimension) : null,
      weakestDimension: weakestDimension ? dimensionName(weakestDimension) : null,
      totalSellers,
    };

    // 5) Per-category seller comparison
    // For each category, find the best seller (highest avg score in that category)
    interface CatAgg {
      dealCount: number;
      sellerScores: Map<string, { total: number; count: number }>;
    }
    const catAgg = new Map<string, CatAgg>();
    for (const t of trades) {
      const sellerName = (t.listing?.sellerName || '').trim();
      if (!sellerName) continue;
      const category = (t.category || '').trim().toLowerCase() || 'neznan';
      let c = catAgg.get(category);
      if (!c) {
        c = { dealCount: 0, sellerScores: new Map() };
        catAgg.set(category, c);
      }
      c.dealCount += 1;
      // Find seller scorecard (by name)
      const sc = scorecards.find((s) => s.sellerName === sellerName);
      if (sc) {
        let s = c.sellerScores.get(sellerName);
        if (!s) {
          s = { total: 0, count: 0 };
          c.sellerScores.set(sellerName, s);
        }
        s.total += sc.overallScore;
        s.count += 1;
      }
    }
    const byCategory: CategorySellerScorecard[] = [];
    for (const [category, c] of catAgg.entries()) {
      let bestSeller: string | null = null;
      let bestAvg = -1;
      let totalAvg = 0;
      let sellerCount = 0;
      for (const [sellerName, s] of c.sellerScores.entries()) {
        const avg = s.count > 0 ? s.total / s.count : 0;
        totalAvg += avg;
        sellerCount += 1;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestSeller = sellerName;
        }
      }
      byCategory.push({
        category,
        bestSeller,
        avgSellerScore:
          sellerCount > 0 ? round1(totalAvg / sellerCount) : 0,
        dealCount: c.dealCount,
      });
    }
    byCategory.sort((a, b) => b.dealCount - a.dealCount);

    // 6) Recommendations
    // buyMoreFrom: top 3 sellers with grade A+ or A (overall >= 80)
    const buyMoreFrom = scorecards
      .filter((sc) => sc.overallScore >= 80)
      .slice(0, 3)
      .map((sc) => ({
        sellerName: sc.sellerName,
        reasoning: `Score ${sc.overallScore}/100 (grade ${sc.grade}). ${sc.insights[0] ?? 'Zanesljiv seller.'}`,
      }));

    // avoidSellers: bottom 3 sellers with grade D or F (overall < 60)
    const avoidSellers = scorecards
      .filter((sc) => sc.overallScore < 60)
      .slice(-3)
      .reverse()
      .map((sc) => ({
        sellerName: sc.sellerName,
        reasoning: `Score ${sc.overallScore}/100 (grade ${sc.grade}). ${sc.improvementAreas[0] ?? 'Tvegan seller.'}`,
      }));

    const advice = (() => {
      const parts: string[] = [];
      parts.push(
        `Portfolio scorecard: ${totalSellers} seller-jev, povprečno ${avgOverallScore}/100.`,
      );
      if (bestDimension) {
        parts.push(
          `Najmočnejša dimenzija: ${dimensionName(bestDimension)} (${sortedDimsDesc[0]!.avg}/100).`,
        );
      }
      if (weakestDimension) {
        parts.push(
          `Najšibkejša dimenzija: ${dimensionName(weakestDimension)} (${sortedDimsAsc[0]!.avg}/100).`,
        );
      }
      const gradeA = gradeDistribution['A+'] + gradeDistribution['A'];
      const gradeF = gradeDistribution['F'];
      parts.push(
        `${gradeA} seller-jev z A+/A grade, ${gradeF} z F grade.`,
      );
      if (buyMoreFrom.length > 0) {
        parts.push(
          `Buy more from: ${buyMoreFrom.map((b) => b.sellerName).join(', ')}.`,
        );
      }
      if (avoidSellers.length > 0) {
        parts.push(
          `Avoid: ${avoidSellers.map((b) => b.sellerName).join(', ')}.`,
        );
      }
      return parts.join(' ');
    })();

    const recommendations: SellerRecommendations = {
      buyMoreFrom,
      avoidSellers,
      advice,
    };

    return NextResponse.json({
      ok: true,
      scorecards: scorecards.slice(0, 100), // top 100 sellers
      portfolio,
      byCategory: byCategory.slice(0, 20),
      recommendations,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/seller-reliability-scorecard',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- Helpers (dimension names) ------------------------------------------

function dimensionName(key: keyof ScorecardDimensions | string): string {
  switch (key) {
    case 'dealQualityScore':
      return 'Deal quality';
    case 'pricingScore':
      return 'Pricing';
    case 'consistencyScore':
      return 'Consistency';
    case 'valueScore':
      return 'Value';
    case 'reliabilityScore':
      return 'Reliability';
    default:
      return key;
  }
}
