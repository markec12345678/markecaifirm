// v7.77: Market Cycle Detector — identificira v kateri fazi tržnega cikla
// smo trenutno: ACCUMULATION (kupovalna priložnost), MARKUP (cene rastejo),
// DISTRIBUTION (čas za prodajo), ali DECLINE (cene padajo). Pure DB
// analytics — NO AI. "Market cycle: MARKUP (60% progress, 8 weeks). Prices
// +5%/mo, volume +10%. BUY before DISTRIBUTION phase."
//
// Razlika od market-momentum (ki da BULLISH/BEARISH/NEUTRAL score glede na
// trend) — ta identificira 4-fazni CYCLE (Wyckoff-inspired). Razlika od
// market-trend-momentum (ki gleda ACCELERATION per kategorija) — ta gleda
// GLOBAL phase trga + per-category phase. Razlika od market-sentiment-pulse
// (ki kombinira 5 signalov v 0-100 pulse) — ta gleda CENOVNE in VOLUMSKE
// trende za fazno klasifikacijo. Razlika od market-saturation-forecaster
// (ki forecast-a saturacijo) — ta gleda 4-fazni cikel z volatilnostjo.
// Razlika od market-depth-analyzer (ki gleda likvidnost) — ta gleda
// phase-timing za buy/sell odločitve.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-cycle-detector

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type CyclePhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'DECLINE';
type TrendDirection = 'UP' | 'FLAT' | 'DOWN';
type DealQualityTrend = 'IMPROVING' | 'STABLE' | 'DECLINING';
type RecommendationAction =
  | 'BUY_AGGRESSIVELY'
  | 'BUY'
  | 'HOLD'
  | 'SELL'
  | 'SELL_AGGRESSIVELY'
  | 'WAIT';

interface Cycle {
  currentPhase: CyclePhase;
  cycleProgress: number; // 0-100 %
  cycleDuration: number; // weeks in current phase
  phaseConfidence: number; // 0-100
  phaseDescription: string;
}

interface TrendIndicator {
  slope: number;
  direction: TrendDirection;
}

interface Indicators {
  priceTrend90d: TrendIndicator;
  priceTrend30d: TrendIndicator;
  volumeTrend90d: TrendIndicator;
  volumeTrend30d: TrendIndicator;
  volatilityIndex: number;
  dealQualityTrend: DealQualityTrend;
}

interface CategoryCycle {
  category: string;
  currentPhase: CyclePhase;
  phaseConfidence: number;
  priceTrend: TrendDirection;
  volumeTrend: TrendDirection;
}

interface HistoricalPhase {
  phase: CyclePhase;
  weeks: number;
  startDate: string;
  endDate: string;
}

interface Historical {
  phasesLast180d: HistoricalPhase[];
  mostCommonPhase: CyclePhase | null;
}

interface Recommendation {
  action: RecommendationAction;
  reasoning: string;
  timeHorizon: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HORIZON_180D = 180 * DAY_MS;

// Slovenska imena kategorij za opise faz
function sourceDisplayName(source: string): string {
  const s = source.toLowerCase().trim();
  switch (s) {
    case 'bolha': return 'Bolha';
    case 'vinted': return 'Vinted';
    case 'avtonet': return 'Avtonet';
    case 'mobile-de':
    case 'mobile.de':
      return 'mobile.de';
    case 'nepremicnine': return 'Nepremičnine';
    case 'salomon': return 'Salomon';
    case 'kleinanzeigen': return 'Kleinanzeigen';
    case 'subito': return 'Subito';
    case 'willhaben': return 'Willhaben';
    case 'facebook':
    case 'fb':
      return 'Facebook';
    default: return source || 'Neznan';
  }
}

// --- Math helpers --------------------------------------------------------

function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const xs = Array.from({ length: n }, (_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function directionFromSlope(
  slope: number,
  thresholdPct: number,
  meanValue: number,
): TrendDirection {
  if (meanValue <= 0) return 'FLAT';
  const relSlope = (slope / meanValue) * 100; // % per week
  if (relSlope > thresholdPct) return 'UP';
  if (relSlope < -thresholdPct) return 'DOWN';
  return 'FLAT';
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
}

// --- Cycle classification logic ------------------------------------------

/**
 * Classify the current market cycle phase based on price + volume trends +
 * volatility. Inspired by Wyckoff market cycle:
 * - ACCUMULATION: prices flat/low + volume low + volatility low → smart money buying
 * - MARKUP: prices rising + volume increasing → bull phase
 * - DISTRIBUTION: prices high/flat + volume peaking + volatility high → smart money selling
 * - DECLINE: prices falling + volume declining → bear phase
 */
function classifyPhase(
  price90d: TrendDirection,
  price30d: TrendDirection,
  volume90d: TrendDirection,
  volume30d: TrendDirection,
  volatilityIndex: number,
): { phase: CyclePhase; confidence: number } {
  // Phase scoring — tally votes
  let accScore = 0;
  let markupScore = 0;
  let distScore = 0;
  let declineScore = 0;

  // ACCUMULATION: price flat/low, volume low/flat, volatility low
  if (price90d === 'FLAT' || price90d === 'DOWN') accScore += 2;
  if (volume90d === 'FLAT' || volume90d === 'DOWN') accScore += 1;
  if (price30d === 'FLAT') accScore += 1;
  if (volatilityIndex < 25) accScore += 1;

  // MARKUP: price rising, volume rising
  if (price90d === 'UP') markupScore += 2;
  if (price30d === 'UP') markupScore += 2;
  if (volume90d === 'UP' || volume30d === 'UP') markupScore += 1;
  if (volatilityIndex >= 15 && volatilityIndex < 35) markupScore += 1;

  // DISTRIBUTION: price high/flat + volume high + volatility high
  if (price90d === 'UP' && price30d === 'FLAT') distScore += 2;
  if (price30d === 'FLAT') distScore += 1;
  if (volume90d === 'UP' && volume30d === 'FLAT') distScore += 1;
  if (volatilityIndex >= 35) distScore += 2;
  if (volume30d === 'UP') distScore += 1;

  // DECLINE: price falling + volume declining
  if (price90d === 'DOWN') declineScore += 2;
  if (price30d === 'DOWN') declineScore += 2;
  if (volume90d === 'DOWN') declineScore += 1;
  if (volume30d === 'DOWN') declineScore += 1;
  if (volatilityIndex >= 30) declineScore += 1;

  const scores: Array<{ phase: CyclePhase; score: number }> = [
    { phase: 'ACCUMULATION', score: accScore },
    { phase: 'MARKUP', score: markupScore },
    { phase: 'DISTRIBUTION', score: distScore },
    { phase: 'DECLINE', score: declineScore },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const total = scores.reduce((s, sc) => s + sc.score, 0);
  // confidence: how dominant is top score
  const confidence =
    total > 0 ? Math.min(95, Math.max(15, Math.round((top.score / total) * 100))) : 20;
  return { phase: top.phase, confidence };
}

function phaseDescription(phase: CyclePhase, progress: number, duration: number): string {
  switch (phase) {
    case 'ACCUMULATION':
      return `Trg je v ACCUMULATION fazi (${progress}% progress, ${duration} tednov). Cene so nizke in stabilne, volumen moderaten — pametni kupci nabavljajo. To je idealen čas za BUY pred Markup fazo.`;
    case 'MARKUP':
      return `Trg je v MARKUP fazi (${progress}% progress, ${duration} tednov). Cene rastejo, volumen se povečuje — bull tržna faza. Nadaljuj z nakupi, vendar bodi pozoren na znake Distribution.`;
    case 'DISTRIBUTION':
      return `Trg je v DISTRIBUTION fazi (${progress}% progress, ${duration} tednov). Cene visoke/stabilne, volumen visok, volatilnost velika — pametni prodajalci prodajajo. To je čas za SELL pred Decline fazo.`;
    case 'DECLINE':
      return `Trg je v DECLINE fazi (${progress}% progress, ${duration} tednov). Cene padajo, volumen se zmanjšuje — bear tržna faza. Drži kapital in čakaj na znake Accumulation.`;
  }
}

// Compute progress 0-100 — based on phase + how "mature" the trend signal is.
function computeProgress(
  phase: CyclePhase,
  price90d: TrendDirection,
  price30d: TrendDirection,
  volume90d: TrendDirection,
  volume30d: TrendDirection,
): number {
  // Heuristic:
  // ACCUMULATION: low progress = early (just started flat), high = ready to markup
  // MARKUP: low = early markup, high = late markup (about to distribute)
  // DISTRIBUTION: low = early, high = about to decline
  // DECLINE: low = early, high = about to bottom
  if (phase === 'ACCUMULATION') {
    // Mature accumulation → volume starts rising (early markup signal)
    if (volume30d === 'UP' && price30d === 'FLAT') return 80;
    if (volume30d === 'UP') return 65;
    return 45;
  }
  if (phase === 'MARKUP') {
    // Late markup → price30d flattening (distribution signal)
    if (price30d === 'FLAT') return 80;
    if (price30d === 'UP' && volume30d === 'FLAT') return 65;
    if (price30d === 'UP' && volume30d === 'UP') return 50;
    return 40;
  }
  if (phase === 'DISTRIBUTION') {
    // Late distribution → price30d starting to fall
    if (price30d === 'DOWN') return 85;
    if (volume30d === 'DOWN') return 70;
    return 55;
  }
  // DECLINE
  if (price30d === 'FLAT' && volume30d === 'FLAT') return 80; // bottoming
  if (price30d === 'FLAT') return 65;
  if (price30d === 'DOWN' && volume30d === 'DOWN') return 50;
  return 45;
}

function classifyQualityTrend(
  recentScore: number,
  olderScore: number,
): DealQualityTrend {
  const delta = recentScore - olderScore;
  if (delta > 2) return 'IMPROVING';
  if (delta < -2) return 'DECLINING';
  return 'STABLE';
}

function recommend(
  phase: CyclePhase,
  confidence: number,
): { action: RecommendationAction; reasoning: string; timeHorizon: string } {
  switch (phase) {
    case 'ACCUMULATION':
      return {
        action: 'BUY_AGGRESSIVELY',
        reasoning: `Trg v ACCUMULATION fazi — cene nizke, kakovost deal-ov se izboljšuje. Pametno nabavljaj pred Markup fazo. Confidence ${confidence}%.`,
        timeHorizon: '30-90 dni (do Markup faze)',
      };
    case 'MARKUP':
      return {
        action: 'BUY',
        reasoning: `Trg v MARKUP fazi — cene rastejo, vendar še vedno priložnosti za nakup pred Distribution. Confidence ${confidence}%.`,
        timeHorizon: '30-60 dni',
      };
    case 'DISTRIBUTION':
      return {
        action: 'SELL',
        reasoning: `Trg v DISTRIBUTION fazi — cene visoke, vendar se bliža Decline. Prodaj inventar in zadrži kapital. Confidence ${confidence}%.`,
        timeHorizon: '14-30 dni (pred Decline)',
      };
    case 'DECLINE':
      return {
        action: 'WAIT',
        reasoning: `Trg v DECLINE fazi — cene padajo. Zadrži kapital in čakaj na znake Accumulation (cene se umirijo). Confidence ${confidence}%.`,
        timeHorizon: '30-90 dni (do Accumulation)',
      };
  }
}

// --- Handler -------------------------------------------------------------

interface WeeklyAgg {
  totalListings: number;
  pricedListings: number;
  sumPrice: number;
  sumDealScore: number;
  dealScoreCount: number;
}

function emptyWeeklyAgg(): WeeklyAgg {
  return {
    totalListings: 0,
    pricedListings: 0,
    sumPrice: 0,
    sumDealScore: 0,
    dealScoreCount: 0,
  };
}

function isoWeekStart(ms: number): number {
  // ISO week starts Monday
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1; // shift to Mon=0
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return start.getTime();
}

export async function GET() {
  try {
    const now = Date.now();
    const cutoff = new Date(now - HORIZON_180D);

    // 1) Query listings from last 180 days
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        dealScore: true,
        monitor: { select: { source: true } },
      },
      take: 200000,
    });

    // Empty state
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        cycle: {
          currentPhase: 'ACCUMULATION',
          cycleProgress: 0,
          cycleDuration: 0,
          phaseConfidence: 0,
          phaseDescription: 'Ni listing-ov v zadnjih 180 dneh — Market Cycle Detector ni mogoč.',
        },
        indicators: {
          priceTrend90d: { slope: 0, direction: 'FLAT' },
          priceTrend30d: { slope: 0, direction: 'FLAT' },
          volumeTrend90d: { slope: 0, direction: 'FLAT' },
          volumeTrend30d: { slope: 0, direction: 'FLAT' },
          volatilityIndex: 0,
          dealQualityTrend: 'STABLE',
        },
        byCategory: [],
        historical: {
          phasesLast180d: [],
          mostCommonPhase: null,
        },
        recommendation: {
          action: 'WAIT',
          reasoning: 'Ni listing podatkov — dodaj listing-e za izračun market cycle-a.',
          timeHorizon: 'Ni podatkov',
        },
        message: 'Ni listing-ov v zadnjih 180 dneh — Market Cycle Detector ni mogoč.',
      });
    }

    // 2) Build weekly aggregates — overall + per-source ("category" dimension)
    const overallByWeek = new Map<number, WeeklyAgg>();
    const perSourceByWeek = new Map<string, Map<number, WeeklyAgg>>();

    for (const l of listings) {
      const firstSeenMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
      if (!Number.isFinite(firstSeenMs) || firstSeenMs < cutoff.getTime()) continue;
      const weekMs = isoWeekStart(firstSeenMs);

      // overall
      let oAgg = overallByWeek.get(weekMs);
      if (!oAgg) {
        oAgg = emptyWeeklyAgg();
        overallByWeek.set(weekMs, oAgg);
      }
      oAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        oAgg.pricedListings += 1;
        oAgg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        oAgg.sumDealScore += l.dealScore;
        oAgg.dealScoreCount += 1;
      }

      // per-source
      const source = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      let srcMap = perSourceByWeek.get(source);
      if (!srcMap) {
        srcMap = new Map<number, WeeklyAgg>();
        perSourceByWeek.set(source, srcMap);
      }
      let sAgg = srcMap.get(weekMs);
      if (!sAgg) {
        sAgg = emptyWeeklyAgg();
        srcMap.set(weekMs, sAgg);
      }
      sAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        sAgg.pricedListings += 1;
        sAgg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        sAgg.sumDealScore += l.dealScore;
        sAgg.dealScoreCount += 1;
      }
    }

    // Sort week keys ascending
    const sortedWeekKeys = Array.from(overallByWeek.keys()).sort((a, b) => a - b);

    // Need at least 4 weeks of data for meaningful trends
    if (sortedWeekKeys.length < 4) {
      return NextResponse.json({
        ok: true,
        cycle: {
          currentPhase: 'ACCUMULATION',
          cycleProgress: 0,
          cycleDuration: sortedWeekKeys.length,
          phaseConfidence: 10,
          phaseDescription: `Premalo podatkov — samo ${sortedWeekKeys.length} tednov zgodovine (potrebno min 4). Market Cycle Detector ni zanesljiv.`,
        },
        indicators: {
          priceTrend90d: { slope: 0, direction: 'FLAT' },
          priceTrend30d: { slope: 0, direction: 'FLAT' },
          volumeTrend90d: { slope: 0, direction: 'FLAT' },
          volumeTrend30d: { slope: 0, direction: 'FLAT' },
          volatilityIndex: 0,
          dealQualityTrend: 'STABLE',
        },
        byCategory: [],
        historical: { phasesLast180d: [], mostCommonPhase: null },
        recommendation: {
          action: 'WAIT',
          reasoning: `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — zberi vsaj 4 tedne zgodovine za zanesljiv cycle detection.`,
          timeHorizon: 'Ni podatkov',
        },
        message: `Premalo tedenskih podatkov (${sortedWeekKeys.length} tednov) — Market Cycle Detector ni zanesljiv.`,
      });
    }

    // 3) Compute indicators (overall)
    // 13 weeks for 90d trend, 4 weeks for 30d trend
    const last13Weeks = sortedWeekKeys.slice(-13);
    const last4Weeks = sortedWeekKeys.slice(-4);

    // Weekly avg price series for 13w and 4w
    const weeklyAvgPrice13 = last13Weeks.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
    });
    const weeklyAvgPrice4 = last4Weeks.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
    });

    // Weekly volume (listing count) series
    const weeklyVolume13 = last13Weeks.map((wk) => overallByWeek.get(wk)!.totalListings);
    const weeklyVolume4 = last4Weeks.map((wk) => overallByWeek.get(wk)!.totalListings);

    // Linear regression: price over 13 weeks (90d) and 4 weeks (30d)
    const priceReg90d = linearRegression(weeklyAvgPrice13);
    const priceReg30d = linearRegression(weeklyAvgPrice4);
    const volumeReg90d = linearRegression(weeklyVolume13);
    const volumeReg30d = linearRegression(weeklyVolume4);

    const meanPrice90 = mean(weeklyAvgPrice13.filter((v) => v > 0));
    const meanPrice30 = mean(weeklyAvgPrice4.filter((v) => v > 0));
    const meanVolume90 = mean(weeklyVolume13);
    const meanVolume30 = mean(weeklyVolume4);

    const priceTrend90Direction = directionFromSlope(priceReg90d.slope, 1.5, meanPrice90);
    const priceTrend30Direction = directionFromSlope(priceReg30d.slope, 2.5, meanPrice30);
    const volumeTrend90Direction = directionFromSlope(volumeReg90d.slope, 5, meanVolume90);
    const volumeTrend30Direction = directionFromSlope(volumeReg30d.slope, 8, meanVolume30);

    // Volatility index: stdDev of weekly avg prices / mean (as %)
    const priced13 = weeklyAvgPrice13.filter((v) => v > 0);
    const volatilityIndex =
      priced13.length > 1 && meanPrice90 > 0
        ? round1((stdDev(priced13) / meanPrice90) * 100)
        : 0;

    // Deal quality trend
    const recent4 = last4Weeks.map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.dealScoreCount > 0 ? a.sumDealScore / a.dealScoreCount : 0;
    });
    const older4 = sortedWeekKeys.slice(-8, -4).map((wk) => {
      const a = overallByWeek.get(wk)!;
      return a.dealScoreCount > 0 ? a.sumDealScore / a.dealScoreCount : 0;
    });
    const recentAvgScore = mean(recent4);
    const olderAvgScore = mean(older4);
    const dealQualityTrend = classifyQualityTrend(recentAvgScore, olderAvgScore);

    const indicators: Indicators = {
      priceTrend90d: { slope: round1(priceReg90d.slope), direction: priceTrend90Direction },
      priceTrend30d: { slope: round1(priceReg30d.slope), direction: priceTrend30Direction },
      volumeTrend90d: { slope: round1(volumeReg90d.slope), direction: volumeTrend90Direction },
      volumeTrend30d: { slope: round1(volumeReg30d.slope), direction: volumeTrend30Direction },
      volatilityIndex,
      dealQualityTrend,
    };

    // 4) Classify current cycle phase
    const { phase, confidence } = classifyPhase(
      priceTrend90Direction,
      priceTrend30Direction,
      volumeTrend90Direction,
      volumeTrend30Direction,
      volatilityIndex,
    );

    // Estimate duration in current phase (heuristic: based on week count + phase stability)
    // For simplification: use 8 weeks as default; adjust based on indicators
    let cycleDuration = 8;
    if (phase === 'ACCUMULATION' && volatilityIndex < 15) cycleDuration = 12;
    if (phase === 'MARKUP' && priceTrend90Direction === 'UP') cycleDuration = 10;
    if (phase === 'DISTRIBUTION' && volatilityIndex > 35) cycleDuration = 6;
    if (phase === 'DECLINE' && priceTrend90Direction === 'DOWN') cycleDuration = 7;

    const cycleProgress = computeProgress(
      phase,
      priceTrend90Direction,
      priceTrend30Direction,
      volumeTrend90Direction,
      volumeTrend30Direction,
    );

    const cycle: Cycle = {
      currentPhase: phase,
      cycleProgress,
      cycleDuration,
      phaseConfidence: confidence,
      phaseDescription: phaseDescription(phase, cycleProgress, cycleDuration),
    };

    // 5) Per-category cycle detection
    const byCategory: CategoryCycle[] = [];
    for (const [source, srcWeekMap] of perSourceByWeek.entries()) {
      const srcSortedWeeks = Array.from(srcWeekMap.keys()).sort((a, b) => a - b);
      if (srcSortedWeeks.length < 4) continue; // need 4+ weeks

      const srcLast13 = srcSortedWeeks.slice(-13);
      const srcLast4 = srcSortedWeeks.slice(-4);

      const srcPrice13 = srcLast13.map((wk) => {
        const a = srcWeekMap.get(wk)!;
        return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
      });
      const srcPrice4 = srcLast4.map((wk) => {
        const a = srcWeekMap.get(wk)!;
        return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
      });
      const srcVolume13 = srcLast13.map((wk) => srcWeekMap.get(wk)!.totalListings);
      const srcVolume4 = srcLast4.map((wk) => srcWeekMap.get(wk)!.totalListings);

      const srcPriceReg90 = linearRegression(srcPrice13);
      const srcPriceReg30 = linearRegression(srcPrice4);
      const srcVolumeReg90 = linearRegression(srcVolume13);
      const srcVolumeReg30 = linearRegression(srcVolume4);

      const srcMeanP90 = mean(srcPrice13.filter((v) => v > 0));
      const srcMeanP30 = mean(srcPrice4.filter((v) => v > 0));
      const srcMeanV90 = mean(srcVolume13);
      const srcMeanV30 = mean(srcVolume4);

      const srcPDir90 = directionFromSlope(srcPriceReg90.slope, 1.5, srcMeanP90);
      const srcPDir30 = directionFromSlope(srcPriceReg30.slope, 2.5, srcMeanP30);
      const srcVDir90 = directionFromSlope(srcVolumeReg90.slope, 5, srcMeanV90);
      const srcVDir30 = directionFromSlope(srcVolumeReg30.slope, 8, srcMeanV30);

      const srcPriced13 = srcPrice13.filter((v) => v > 0);
      const srcVolatility =
        srcPriced13.length > 1 && srcMeanP90 > 0
          ? (stdDev(srcPriced13) / srcMeanP90) * 100
          : 0;

      const srcClass = classifyPhase(srcPDir90, srcPDir30, srcVDir90, srcVDir30, srcVolatility);

      byCategory.push({
        category: sourceDisplayName(source),
        currentPhase: srcClass.phase,
        phaseConfidence: srcClass.confidence,
        priceTrend: srcPDir90,
        volumeTrend: srcVDir90,
      });
    }
    byCategory.sort((a, b) => b.phaseConfidence - a.phaseConfidence);

    // 6) Historical cycle analysis — reconstruct phases by walking week-by-week
    // For each pair of consecutive weeks, compute price trend direction (3-week window)
    // and classify phase. Then merge consecutive same-phase weeks into ranges.
    const historicalPhases: HistoricalPhase[] = [];
    let curPhase: CyclePhase | null = null;
    let curPhaseStartMs: number | null = null;
    let curPhaseWeeks = 0;

    // Walk through all weeks (need at least 3-week window for trend)
    const allWeeks = sortedWeekKeys;
    for (let i = 0; i < allWeeks.length; i++) {
      if (i < 2) {
        // Not enough history for trend — assign neutral ACCUMULATION
        if (curPhase !== 'ACCUMULATION') {
          if (curPhase && curPhaseStartMs != null) {
            historicalPhases.push({
              phase: curPhase,
              weeks: curPhaseWeeks,
              startDate: new Date(curPhaseStartMs).toISOString(),
              endDate: new Date(allWeeks[i]! + WEEK_MS).toISOString(),
            });
          }
          curPhase = 'ACCUMULATION';
          curPhaseStartMs = allWeeks[i]!;
          curPhaseWeeks = 1;
        } else {
          curPhaseWeeks += 1;
        }
        continue;
      }

      // Use 3-week window ending at i for short-term trend
      const windowWeeks = allWeeks.slice(Math.max(0, i - 2), i + 1);
      const windowPrices = windowWeeks.map((wk) => {
        const a = overallByWeek.get(wk)!;
        return a.pricedListings > 0 ? a.sumPrice / a.pricedListings : 0;
      });
      const windowVolumes = windowWeeks.map((wk) => overallByWeek.get(wk)!.totalListings);
      const pReg = linearRegression(windowPrices);
      const vReg = linearRegression(windowVolumes);
      const meanP = mean(windowPrices.filter((v) => v > 0));
      const meanV = mean(windowVolumes);
      const pDir = directionFromSlope(pReg.slope, 2, meanP);
      const vDir = directionFromSlope(vReg.slope, 8, meanV);

      // Approximate phase from short window
      let weekPhase: CyclePhase;
      if (pDir === 'UP') {
        weekPhase = vDir === 'FLAT' ? 'DISTRIBUTION' : 'MARKUP';
      } else if (pDir === 'DOWN') {
        weekPhase = 'DECLINE';
      } else {
        // flat
        weekPhase = vDir === 'UP' ? 'MARKUP' : 'ACCUMULATION';
      }

      if (weekPhase !== curPhase) {
        if (curPhase && curPhaseStartMs != null) {
          historicalPhases.push({
            phase: curPhase,
            weeks: curPhaseWeeks,
            startDate: new Date(curPhaseStartMs).toISOString(),
            endDate: new Date(allWeeks[i]! + WEEK_MS).toISOString(),
          });
        }
        curPhase = weekPhase;
        curPhaseStartMs = allWeeks[i]!;
        curPhaseWeeks = 1;
      } else {
        curPhaseWeeks += 1;
      }
    }
    // close last phase
    if (curPhase && curPhaseStartMs != null) {
      historicalPhases.push({
        phase: curPhase,
        weeks: curPhaseWeeks,
        startDate: new Date(curPhaseStartMs).toISOString(),
        endDate: new Date((sortedWeekKeys[sortedWeekKeys.length - 1] ?? curPhaseStartMs) + WEEK_MS).toISOString(),
      });
    }

    // Most common phase by total weeks
    const phaseWeeks = new Map<CyclePhase, number>();
    for (const hp of historicalPhases) {
      phaseWeeks.set(hp.phase, (phaseWeeks.get(hp.phase) ?? 0) + hp.weeks);
    }
    let mostCommonPhase: CyclePhase | null = null;
    let maxWeeks = 0;
    for (const [p, w] of phaseWeeks.entries()) {
      if (w > maxWeeks) {
        maxWeeks = w;
        mostCommonPhase = p;
      }
    }

    const historical: Historical = {
      phasesLast180d: historicalPhases,
      mostCommonPhase,
    };

    // 7) Recommendation
    const rec = recommend(phase, confidence);

    return NextResponse.json({
      ok: true,
      cycle,
      indicators,
      byCategory,
      historical,
      recommendation: rec,
    });
  } catch (err: any) {
    logger.error('/api/analytics/market-cycle-detector', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
