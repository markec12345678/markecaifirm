// v7.79: Deal Quality Scorecard — generira celovit "scorecard" za vsak
// deal (pretekli in potencialni) — oceni 6 dimenzij (cena, timing, risk,
// tržne razmere, prodajalec, rezultat). Pure DB analytics — NO AI.
// "Portfolio scorecard: povprečno 72/100 (B). Najboljša dimenzija: cena
// (85). Najšibkejša: timing (58). Trend: IZBOLJŠUJOČ ( +8)."
//
// Razlika od deal-scoring-model-v2 (v7.x, AI weighted multi-factor score
// za posamezni deal) — ta je descriptivna analiza ZGODOVINSKIH deal-ov z
// 6-dimenzionalnim scorecard-om in portfolio grading. Razlika od
// deal-quality-forecaster (v7.x, AI napove quality po dnevih v tednu) —
// ta oceni PROŠLE deals čez 6 dimenzij z grade A+ do F. Razlika od
// deal-quality-distribution (v7.74, ki prikaže distribucijo dealScore) —
// ta da SCORECARD z 6 dimenzijami in grade per trade. Razlika od
// deal-winning-streak-analyzer (v7.77, AI analiza streak-e) — ta gleda
// POSAMEZNE deal-e z multi-dimenzionalnim scorecard-om. Razlika od
// deal-conversion-funnel-analyzer (v7.78, ki gleda funnel fazami) — ta
// gleda KVALITETO deal-ov z 6 dimenzijami in grade distribucijo. Razlika
// od deal-anatomy-analyzer (v7.x, AI anatomija winnerjev) — ta je
// descriptivna analiza zgodovine deal-ov z byCategory in trend. Razlika
// od deal-source-comparison-matrix (v7.70, ki primerja vire) — ta gleda
// POSAMEZNE deals z dimensional scoring. Razlika od deal-profitability-
// matrix (v7.72, ki da 2D matrika kategorija × hold-time) — ta da 6-
// dimenzionalni scorecard per trade z grade.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-quality-scorecard

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
type Trend = 'IMPROVING' | 'STABLE' | 'DECLINING';

interface ScorecardDimensions {
  priceScore: number; // 0-100
  timingScore: number;
  riskScore: number;
  marketScore: number;
  sellerScore: number;
  outcomeScore: number;
}

interface TradeScorecard {
  tradeId: string;
  title: string;
  category: string;
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
  totalTrades: number;
}

interface CategoryScorecard {
  category: string;
  avgOverallScore: number;
  avgGrade: string;
  bestDimension: string;
  rank: number;
}

interface ScorecardTrend {
  recentScore: number; // last 30d
  previousScore: number; // 30-60d ago
  trend: Trend;
}

interface ScorecardRecommendations {
  bestCategory: string | null;
  improvementFocus: string;
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

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function daysBetween(aMs: number, bMs: number): number {
  if (aMs <= 0 || bMs <= 0) return 0;
  return Math.max(0, Math.round((bMs - aMs) / 86_400_000));
}

function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

// Numeric grade value for averaging
function gradeValue(g: Grade): number {
  switch (g) {
    case 'A+': return 95;
    case 'A': return 85;
    case 'B': return 75;
    case 'C': return 65;
    case 'D': return 55;
    case 'F': return 25;
  }
}

function gradeFromValue(v: number): Grade {
  return gradeFromScore(v);
}

// Day-of-week timing score: weekends (Sat/Sun) and evenings historically
// have better engagement on classifieds; Monday is worst
function dayOfWeekTimingScore(buyMs: number): number {
  if (buyMs <= 0) return 50;
  const day = new Date(buyMs).getUTCDay(); // 0=Sun, 6=Sat
  // Higher score = better timing
  // Sun(0)=70, Mon(1)=45, Tue(2)=55, Wed(3)=60, Thu(4)=65, Fri(5)=75, Sat(6)=80
  const map: Record<number, number> = {
    0: 70, 1: 45, 2: 55, 3: 60, 4: 65, 5: 75, 6: 80,
  };
  return map[day] ?? 50;
}

// --- Scoring functions --------------------------------------------------

// Price Score: how good was the buy price vs AI estValue?
// Higher discount = higher score
function scorePrice(
  buyPrice: number,
  aiEstimatedValue: number | null,
): number {
  if (buyPrice <= 0) return 50;
  if (aiEstimatedValue == null || aiEstimatedValue <= 0) return 50;
  const discount = ((aiEstimatedValue - buyPrice) / aiEstimatedValue) * 100;
  // 0% discount = 50, 30%+ discount = 100, -10% (overpaid) = 30
  const score = 50 + discount * 1.6;
  return clamp0_100(round1(score));
}

// Timing Score: day of week + how long it took to sell (faster = better)
function scoreTiming(
  buyMs: number,
  sellMs: number,
): number {
  const dowScore = dayOfWeekTimingScore(buyMs);
  if (sellMs <= 0 || buyMs <= 0) return dowScore; // unsold — just dow
  const holdDays = daysBetween(buyMs, sellMs);
  // 0-7d = 100, 7-14d = 80, 14-30d = 65, 30-60d = 50, >60d = 30
  let holdScore = 100;
  if (holdDays > 60) holdScore = 30;
  else if (holdDays > 30) holdScore = 50;
  else if (holdDays > 14) holdScore = 65;
  else if (holdDays > 7) holdScore = 80;
  return round1(dowScore * 0.4 + holdScore * 0.6);
}

// Risk Score: based on aiRisk + category volatility proxy
function scoreRisk(
  aiRisk: number | null,
  dealScore: number | null,
): number {
  // aiRisk is 1-10 (10 = high risk); invert so higher score = safer
  const aiRiskScore = aiRisk != null && aiRisk > 0
    ? clamp0_100(100 - aiRisk * 9)
    : 60;
  // dealScore 0-100 already inverted in terms of risk (higher = better)
  const dealScoreComponent = dealScore != null && dealScore > 0
    ? clamp0_100(dealScore)
    : 60;
  return round1(aiRiskScore * 0.5 + dealScoreComponent * 0.5);
}

// Market Score: based on AI estValue signal strength + dealScore (proxy for market fit)
function scoreMarket(
  aiEstimatedValue: number | null,
  buyPrice: number,
  dealScore: number | null,
): number {
  // Higher estValue compared to buy price = market undervalues this item (good buy in market)
  let marketFitScore = 50;
  if (aiEstimatedValue != null && aiEstimatedValue > 0 && buyPrice > 0) {
    const ratio = aiEstimatedValue / buyPrice;
    // ratio 1.0 = market fair (50), ratio 1.5 = market undervalues (90), ratio 0.8 = market overvalues (20)
    marketFitScore = clamp0_100(50 + (ratio - 1) * 100);
  }
  const dealScoreComponent = dealScore != null && dealScore > 0
    ? clamp0_100(dealScore)
    : 50;
  return round1(marketFitScore * 0.6 + dealScoreComponent * 0.4);
}

// Seller Score: based on seller listing count (proxy for reliability)
function scoreSeller(
  sellerListingCount: number | null,
  sellerName: string | null,
): number {
  if (!sellerName) return 50; // unknown seller — neutral
  if (sellerListingCount == null || sellerListingCount <= 0) return 55;
  // More listings = more established seller (safer)
  // 1 listing = 30, 5+ = 60, 20+ = 80, 50+ = 95
  let score = 30;
  if (sellerListingCount >= 50) score = 95;
  else if (sellerListingCount >= 20) score = 80;
  else if (sellerListingCount >= 10) score = 70;
  else if (sellerListingCount >= 5) score = 60;
  else if (sellerListingCount >= 2) score = 45;
  return round1(score);
}

// Outcome Score: how did it turn out? (profit, ROI, hold time)
function scoreOutcome(
  buyPrice: number,
  buyFees: number,
  sellPrice: number | null,
  sellFees: number,
  sellMs: number,
  buyMs: number,
): number {
  if (sellPrice == null || sellPrice <= 0) {
    // Unsold — neutral, slightly worse because capital tied up
    const holdDays = buyMs > 0 ? daysBetween(buyMs, Date.now()) : 0;
    if (holdDays > 60) return 35;
    if (holdDays > 30) return 50;
    return 60;
  }
  const totalCost = buyPrice + buyFees;
  const totalRevenue = sellPrice - sellFees;
  const profit = totalRevenue - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  // ROI mapping: -50% = 0, 0% = 50, +50% = 90, +100%+ = 100
  let score = 50 + roi * 0.8;
  if (sellMs > 0 && buyMs > 0) {
    const holdDays = daysBetween(buyMs, sellMs);
    // Penalty for slow sell
    if (holdDays > 60) score -= 15;
    else if (holdDays > 30) score -= 8;
    else if (holdDays <= 7) score += 5;
  }
  return clamp0_100(round1(score));
}

// Overall score = weighted average of 6 dimensions
function overallScore(d: ScorecardDimensions): number {
  return round1(
    d.priceScore * 0.20 +
    d.timingScore * 0.15 +
    d.riskScore * 0.20 +
    d.marketScore * 0.15 +
    d.sellerScore * 0.10 +
    d.outcomeScore * 0.20,
  );
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const cutoff30d = new Date(now - 30 * 86_400_000);
    const cutoff60d = new Date(now - 60 * 86_400_000);

    // 1) Query all SOLD trades with linked Listing
    const trades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
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
        listing: {
          select: {
            aiEstimatedValue: true,
            aiRisk: true,
            dealScore: true,
            sellerName: true,
            sellerListingCount: true,
          },
        },
      },
      orderBy: { sellDate: 'desc' },
      take: 100000,
    });

    const totalTrades = trades.length;

    // Empty state
    if (totalTrades === 0) {
      return NextResponse.json({
        ok: true,
        scorecards: [],
        portfolio: {
          avgOverallScore: 0,
          gradeDistribution: { 'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0 },
          bestDimension: null,
          weakestDimension: null,
          totalTrades: 0,
        },
        byCategory: [],
        trend: {
          recentScore: 0,
          previousScore: 0,
          trend: 'STABLE',
        },
        recommendations: {
          bestCategory: null,
          improvementFocus: 'Dodaj SOLD trade-e za scorecard analizo.',
          advice:
            'Ni SOLD trade-ov — Deal Quality Scorecard ni mogoč.',
        },
        message:
          'Ni SOLD trade-ov — Deal Quality Scorecard ni mogoč.',
      });
    }

    // 2) Compute scorecards
    const scorecards: TradeScorecard[] = trades.map((t) => {
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? null;
      const sellFees = t.sellFees ?? 0;
      const buyMs = toMs(t.buyDate);
      const sellMs = toMs(t.sellDate);
      const aiEstimatedValue = t.listing?.aiEstimatedValue ?? null;
      const aiRisk = t.listing?.aiRisk ?? null;
      const dealScore = t.listing?.dealScore ?? null;
      const sellerName = t.listing?.sellerName ?? null;
      const sellerListingCount = t.listing?.sellerListingCount ?? null;

      const dimensions: ScorecardDimensions = {
        priceScore: scorePrice(buyPrice, aiEstimatedValue),
        timingScore: scoreTiming(buyMs, sellMs),
        riskScore: scoreRisk(aiRisk, dealScore),
        marketScore: scoreMarket(aiEstimatedValue, buyPrice, dealScore),
        sellerScore: scoreSeller(sellerListingCount, sellerName),
        outcomeScore: scoreOutcome(
          buyPrice,
          buyFees,
          sellPrice,
          sellFees,
          sellMs,
          buyMs,
        ),
      };
      const overall = overallScore(dimensions);
      const grade = gradeFromScore(overall);

      // Insights (2-3 key insights about this deal)
      const insights: string[] = [];
      const topDim = Object.entries(dimensions).sort(
        (a, b) => b[1] - a[1],
      )[0];
      const lowDim = Object.entries(dimensions).sort(
        (a, b) => a[1] - b[1],
      )[0];
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
      if (sellPrice != null && sellPrice > 0 && buyPrice > 0) {
        const profit = sellPrice - sellFees - buyPrice - buyFees;
        const roi = ((profit / Math.max(1, buyPrice + buyFees)) * 100).toFixed(1);
        insights.push(
          `ROI: ${roi}% (${profit >= 0 ? '+' : ''}${round0(profit)}€).`,
        );
      }
      if (insights.length === 0) {
        insights.push('Deal brez posebnosti — povprečna kvaliteta.');
      }

      // Improvement areas
      const improvementAreas: string[] = [];
      if (dimensions.timingScore < 60) {
        improvementAreas.push(
          'Timing — kupuj ob koncu tedna (petek/sobota) in pospeši prodajo.',
        );
      }
      if (dimensions.priceScore < 60) {
        improvementAreas.push(
          'Cena — pogajaj se za večji popust ali počakaj na boljšo priložnost.',
        );
      }
      if (dimensions.riskScore < 60) {
        improvementAreas.push(
          'Risk — preveri seller reputation in izogibaj se visokorizičnim kategorijam.',
        );
      }
      if (dimensions.marketScore < 60) {
        improvementAreas.push(
          'Market fit — boljše raziskuj tržne razmere pred nakupom.',
        );
      }
      if (dimensions.sellerScore < 60) {
        improvementAreas.push(
          'Seller — preferiraj prodajalce z več listingi (bolj zanesljivi).',
        );
      }
      if (dimensions.outcomeScore < 60) {
        improvementAreas.push(
          'Outcome — izboljšaj pricing strategijo in pospeši prodajo.',
        );
      }
      if (improvementAreas.length === 0) {
        improvementAreas.push('Deal je dober — ohrani disciplino.');
      }

      const category = (t.category || '').trim() || 'neznan';

      return {
        tradeId: t.id,
        title: t.title.slice(0, 100),
        category,
        dimensions,
        overallScore: overall,
        grade,
        insights: insights.slice(0, 3),
        improvementAreas: improvementAreas.slice(0, 3),
      };
    });

    // 3) Portfolio scorecard summary
    const avgOverallScore =
      scorecards.length > 0
        ? round1(
            scorecards.reduce((s, sc) => s + sc.overallScore, 0) /
              scorecards.length,
          )
        : 0;
    const gradeDistribution: GradeDistribution = {
      'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0,
    };
    for (const sc of scorecards) {
      gradeDistribution[sc.grade] += 1;
    }

    // Find best/weakest dimension (avg across portfolio)
    const dimSums = { priceScore: 0, timingScore: 0, riskScore: 0, marketScore: 0, sellerScore: 0, outcomeScore: 0 };
    for (const sc of scorecards) {
      dimSums.priceScore += sc.dimensions.priceScore;
      dimSums.timingScore += sc.dimensions.timingScore;
      dimSums.riskScore += sc.dimensions.riskScore;
      dimSums.marketScore += sc.dimensions.marketScore;
      dimSums.sellerScore += sc.dimensions.sellerScore;
      dimSums.outcomeScore += sc.dimensions.outcomeScore;
    }
    const dimAvgs = Object.entries(dimSums).map(([k, v]) => ({
      key: k,
      avg: round1(v / scorecards.length),
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
      totalTrades,
    };

    // 4) Per-category scorecard
    interface CatAgg {
      total: number;
      scoreSum: number;
      dims: Record<string, number>;
      gradeValues: number[];
    }
    const catAgg = new Map<string, CatAgg>();
    for (const sc of scorecards) {
      let c = catAgg.get(sc.category);
      if (!c) {
        c = {
          total: 0,
          scoreSum: 0,
          dims: { priceScore: 0, timingScore: 0, riskScore: 0, marketScore: 0, sellerScore: 0, outcomeScore: 0 },
          gradeValues: [],
        };
        catAgg.set(sc.category, c);
      }
      c.total += 1;
      c.scoreSum += sc.overallScore;
      c.dims.priceScore += sc.dimensions.priceScore;
      c.dims.timingScore += sc.dimensions.timingScore;
      c.dims.riskScore += sc.dimensions.riskScore;
      c.dims.marketScore += sc.dimensions.marketScore;
      c.dims.sellerScore += sc.dimensions.sellerScore;
      c.dims.outcomeScore += sc.dimensions.outcomeScore;
      c.gradeValues.push(gradeValue(sc.grade));
    }
    const byCategory: CategoryScorecard[] = [];
    for (const [category, c] of catAgg.entries()) {
      const avgScore = round1(c.scoreSum / c.total);
      const avgGradeValue = c.gradeValues.reduce((s, v) => s + v, 0) / c.gradeValues.length;
      // Find best dimension per category
      const dimAvgsCat = Object.entries(c.dims).map(([k, v]) => ({
        key: k,
        avg: round1(v / c.total),
      }));
      dimAvgsCat.sort((a, b) => b.avg - a.avg);
      byCategory.push({
        category,
        avgOverallScore: avgScore,
        avgGrade: gradeFromValue(avgGradeValue),
        bestDimension: dimAvgsCat[0] ? dimensionName(dimAvgsCat[0].key) : 'neznan',
        rank: 0,
      });
    }
    byCategory.sort((a, b) => b.avgOverallScore - a.avgOverallScore);
    byCategory.forEach((c, i) => {
      c.rank = i + 1;
    });

    // 5) Historical trend (last 30d vs 30-60d ago)
    interface TrendAgg { count: number; scoreSum: number; }
    const recent: TrendAgg = { count: 0, scoreSum: 0 };
    const previous: TrendAgg = { count: 0, scoreSum: 0 };
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      const sc = scorecards[i]!;
      const sellMs = toMs(t.sellDate);
      if (sellMs <= 0) continue;
      if (sellMs >= cutoff30d.getTime()) {
        recent.count += 1;
        recent.scoreSum += sc.overallScore;
      } else if (sellMs >= cutoff60d.getTime() && sellMs < cutoff30d.getTime()) {
        previous.count += 1;
        previous.scoreSum += sc.overallScore;
      }
    }
    const recentScore = recent.count > 0 ? round1(recent.scoreSum / recent.count) : 0;
    const previousScore = previous.count > 0 ? round1(previous.scoreSum / previous.count) : 0;
    let trend: Trend = 'STABLE';
    const trendDelta = recentScore - previousScore;
    if (trendDelta > 5) trend = 'IMPROVING';
    else if (trendDelta < -5) trend = 'DECLINING';

    const trendResult: ScorecardTrend = {
      recentScore,
      previousScore,
      trend,
    };

    // 6) Recommendations
    const bestCat = byCategory[0] ?? null;
    const improvementFocus = weakestDimension
      ? `${dimensionName(weakestDimension)} (povprečno ${sortedDimsAsc[0]!.avg}/100) — fokusiraj izboljšave na to dimenzijo.`
      : 'Ni specifičnih izboljšav — ohrani disciplino.';
    const advice = (() => {
      const trendLabel =
        trend === 'IMPROVING'
          ? `trend scorecard-a se IZBOLJŠUJE (+${Math.abs(trendDelta).toFixed(1)})`
          : trend === 'DECLINING'
            ? `trend scorecard-a PADA (${trendDelta.toFixed(1)})`
            : 'trend scorecard-a je stabilen';
      const gradeLabel = gradeFromScore(avgOverallScore);
      return `Portfolio scorecard: povprečno ${avgOverallScore}/100 (grade ${gradeLabel}). ${trendLabel}. ${
        bestDimension ? `Najmočnejša dimenzija: ${dimensionName(bestDimension)} (${sortedDimsDesc[0]!.avg}).` : ''
      } ${weakestDimension ? `Najšibkejša: ${dimensionName(weakestDimension)} (${sortedDimsAsc[0]!.avg}).` : ''} ${
        bestCat ? `Najboljša kategorija: ${bestCat.category} (${bestCat.avgOverallScore}).` : ''
      }`;
    })();

    const recommendations: ScorecardRecommendations = {
      bestCategory: bestCat?.category ?? null,
      improvementFocus,
      advice,
    };

    return NextResponse.json({
      ok: true,
      scorecards: scorecards.slice(0, 100), // top 100 scorecards (most recent)
      portfolio,
      byCategory: byCategory.slice(0, 20),
      trend: trendResult,
      recommendations,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-quality-scorecard',
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

function dimensionName(key: string): string {
  switch (key) {
    case 'priceScore': return 'Cena';
    case 'timingScore': return 'Timing';
    case 'riskScore': return 'Risk';
    case 'marketScore': return 'Market fit';
    case 'sellerScore': return 'Seller';
    case 'outcomeScore': return 'Outcome';
    default: return key;
  }
}
