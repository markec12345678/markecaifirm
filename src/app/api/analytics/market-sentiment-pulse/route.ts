// v7.75: Market Sentiment Pulse — real-time "pulse" tržnega sentimenta.
// Kombinira več signalov (listing velocity, price trend, deal quality,
// sell-through rate, volume) v en sam 0-100 sentiment score. Dnevno
// osvežen. "Market pulse: 72/100 (HOT, RISING +8). Sell-through 65%,
// prilika 40%. BUY_AGGRESSIVELY."
//
// Razlika od market-momentum (ki da BULLISH/BEARISH/NEUTRAL 0-100 score
// glede na trend) — ta je HOLISTIČNI PULSE, ki kombinira VEČ signalov
// (listing velocity, price trend, deal quality, sell-through, volume).
// Razlika od market-trend-momentum (ki gleda ACCELERATION per kategorija)
// — ta gleda CEL TRG kot eno številko (pulse). Razlika od weekly-trend-radar
// (ki gleda 7-dnevne trende) — ta gleda KOMBINACIJO signalov v realnem času.
// Razlika od market-trend (ki gleda cenovne trende) — ta gleda deal quality
// in sell-through rate poleg cen. Razlika od deal-velocity (ki meri market
// temperature per listing) — ta gleda holističen PULSE na nivoju trga.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-sentiment-pulse

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type PulseClassification =
  | 'VERY_HOT'
  | 'HOT'
  | 'WARM'
  | 'COOL'
  | 'COLD';

type PulseTrend = 'RISING' | 'STABLE' | 'FALLING';

type RecommendationAction =
  | 'BUY_AGGRESSIVELY'
  | 'BUY_NORMAL'
  | 'HOLD'
  | 'SELL_FAST'
  | 'WAIT';

interface Pulse {
  score: number; // 0-100
  classification: PulseClassification;
  interpretation: string;
  trend: PulseTrend;
  trendDelta: number; // change from previous 7d
}

interface SignalMetric {
  value: number;
  normalized: number; // 0-100
  interpretation: string;
}

interface Signals {
  listingVelocity: SignalMetric;
  priceTrend: SignalMetric;
  dealQualityTrend: SignalMetric;
  sellThroughRate: SignalMetric;
  prilikaRate: SignalMetric;
}

interface PerSource {
  source: string;
  displayName: string;
  pulseScore: number;
  classification: PulseClassification;
  listingCount: number;
}

interface Recommendation {
  action: RecommendationAction;
  reasoning: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// Source display name mapping
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

// Classify pulse score into VERY_HOT/HOT/WARM/COOL/COLD
function classifyPulse(score: number): PulseClassification {
  if (score >= 80) return 'VERY_HOT';
  if (score >= 60) return 'HOT';
  if (score >= 40) return 'WARM';
  if (score >= 20) return 'COOL';
  return 'COLD';
}

// Interpret pulse classification in Slovenian
function interpretPulse(score: number, classification: PulseClassification): string {
  switch (classification) {
    case 'VERY_HOT':
      return `Trg je zelo vroč (${score}/100) — odlični pogoji za prodajo in nabavo. Visoka aktivnost kupcev in kakovostne ponudbe.`;
    case 'HOT':
      return `Trg je vroč (${score}/100) — dobri pogoji za poslovanje. Aktivni kupci in razumna izbira deal-ov.`;
    case 'WARM':
      return `Trg je moderatno topel (${score}/100) — normalno poslovanje, brez posebnih priložnosti ali tveganj.`;
    case 'COOL':
      return `Trg je ohlajen (${score}/100) — zmanjšana aktivnost. Bolj selektivna nabava, podaljšan cycle time.`;
    case 'COLD':
      return `Trg je hladen (${score}/100) — slabi pogoji. Nizka aktivnost kupcev, slaba kakovost deal-ov. Počakaj na回暖.`;
  }
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const currentCutoff = new Date(now - 7 * DAY_MS); // last 7 days
    const previousCutoff = new Date(now - 14 * DAY_MS); // previous 7 days

    // 1) Query listings from last 14 days for trend analysis
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: previousCutoff },
        isHidden: false,
      },
      select: {
        id: true,
        price: true,
        firstSeenAt: true,
        dealScore: true,
        aiVerdict: true,
        isBookmarked: true,
        contactStatus: true,
        monitor: { select: { source: true } },
      },
      take: 50000,
    });

    // Empty state — no listings
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        pulse: {
          score: 0,
          classification: 'COLD',
          interpretation: 'Ni listing-ov v zadnjih 14 dneh — Market Sentiment Pulse ni mogoč.',
          trend: 'STABLE',
          trendDelta: 0,
        },
        signals: {
          listingVelocity: { value: 0, normalized: 0, interpretation: 'Ni podatkov' },
          priceTrend: { value: 0, normalized: 0, interpretation: 'Ni podatkov' },
          dealQualityTrend: { value: 0, normalized: 0, interpretation: 'Ni podatkov' },
          sellThroughRate: { value: 0, normalized: 0, interpretation: 'Ni podatkov' },
          prilikaRate: { value: 0, normalized: 0, interpretation: 'Ni podatkov' },
        },
        perSource: [],
        recommendation: {
          action: 'WAIT',
          reasoning: 'Ni listing podatkov — dodaj listing-e za izračun pulza trga.',
        },
        message: 'Ni listing-ov v zadnjih 14 dneh — Market Sentiment Pulse ni mogoč.',
      });
    }

    // 2) Split listings into current (last 7d) and previous (7-14d)
    interface ListingAgg {
      totalListings: number;
      pricedListings: number;
      sumPrice: number;
      sumDealScore: number;
      dealScoreCount: number;
      prilikaCount: number;
      bookmarkedCount: number;
      contactedCount: number;
    }

    function emptyAgg(): ListingAgg {
      return {
        totalListings: 0,
        pricedListings: 0,
        sumPrice: 0,
        sumDealScore: 0,
        dealScoreCount: 0,
        prilikaCount: 0,
        bookmarkedCount: 0,
        contactedCount: 0,
      };
    }

    const currentAgg = emptyAgg();
    const previousAgg = emptyAgg();
    const currentBySource = new Map<string, ListingAgg>();
    const previousBySource = new Map<string, ListingAgg>();

    for (const l of listings) {
      const firstSeenMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
      if (!Number.isFinite(firstSeenMs)) continue;
      const isCurrent = firstSeenMs >= currentCutoff.getTime();
      const targetAgg = isCurrent ? currentAgg : previousAgg;
      const targetMap = isCurrent ? currentBySource : previousBySource;

      targetAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        targetAgg.pricedListings += 1;
        targetAgg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        targetAgg.sumDealScore += l.dealScore;
        targetAgg.dealScoreCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') {
        targetAgg.prilikaCount += 1;
      }
      if (l.isBookmarked) {
        targetAgg.bookmarkedCount += 1;
      }
      if (l.contactStatus && l.contactStatus !== 'none' && l.contactStatus !== '') {
        targetAgg.contactedCount += 1;
      }

      // Per-source
      const source = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      let srcAgg = targetMap.get(source);
      if (!srcAgg) {
        srcAgg = emptyAgg();
        targetMap.set(source, srcAgg);
      }
      srcAgg.totalListings += 1;
      if (l.price != null && l.price > 0) {
        srcAgg.pricedListings += 1;
        srcAgg.sumPrice += l.price;
      }
      if (l.dealScore != null && l.dealScore > 0) {
        srcAgg.sumDealScore += l.dealScore;
        srcAgg.dealScoreCount += 1;
      }
      if (l.aiVerdict === 'PRILIKA') {
        srcAgg.prilikaCount += 1;
      }
      if (l.isBookmarked) {
        srcAgg.bookmarkedCount += 1;
      }
      if (l.contactStatus && l.contactStatus !== 'none' && l.contactStatus !== '') {
        srcAgg.contactedCount += 1;
      }
    }

    // 3) Compute signal metrics

    // Signal A: listing velocity (new listings per day, last 7d)
    const listingVelocityValue = currentAgg.totalListings / 7;
    // Normalize: 0 listings/day = 0, 20+ listings/day = 100
    const listingVelocityNormalized = Math.max(0, Math.min(100, (listingVelocityValue / 20) * 100));
    const listingVelocityInterpretation =
      listingVelocityValue >= 15
        ? `Visoka aktivnost (${listingVelocityValue.toFixed(1)} novih listing-ov/dan)`
        : listingVelocityValue >= 5
          ? `Zmerna aktivnost (${listingVelocityValue.toFixed(1)} novih listing-ov/dan)`
          : `Nizka aktivnost (${listingVelocityValue.toFixed(1)} novih listing-ov/dan)`;

    // Signal B: price trend (% change avg price last 7d vs previous 7d)
    const currentAvgPrice = currentAgg.pricedListings > 0
      ? currentAgg.sumPrice / currentAgg.pricedListings
      : 0;
    const previousAvgPrice = previousAgg.pricedListings > 0
      ? previousAgg.sumPrice / previousAgg.pricedListings
      : 0;
    let priceTrendValue = 0;
    if (previousAvgPrice > 0) {
      priceTrendValue = ((currentAvgPrice - previousAvgPrice) / previousAvgPrice) * 100;
    }
    // Normalize: rising prices = positive for sellers (and indicates demand)
    // 0% = 50, +20% = 100, -20% = 0
    const priceTrendNormalized = Math.max(0, Math.min(100, 50 + priceTrendValue * 2.5));
    const priceTrendInterpretation =
      priceTrendValue > 5
        ? `Cene rastejo (+${priceTrendValue.toFixed(1)}%) — visoko povpraševanje`
        : priceTrendValue < -5
          ? `Cene padajo (${priceTrendValue.toFixed(1)}%) — nizko povpraševanje`
          : `Cene stabilne (${priceTrendValue.toFixed(1)}%)`;

    // Signal C: deal quality trend (change in avg dealScore)
    const currentAvgDealScore = currentAgg.dealScoreCount > 0
      ? currentAgg.sumDealScore / currentAgg.dealScoreCount
      : 0;
    const previousAvgDealScore = previousAgg.dealScoreCount > 0
      ? previousAgg.sumDealScore / previousAgg.dealScoreCount
      : 0;
    const dealQualityTrendValue = currentAvgDealScore - previousAvgDealScore;
    // Normalize: +10 = 100, -10 = 0, 0 = 50
    const dealQualityTrendNormalized = Math.max(0, Math.min(100, 50 + dealQualityTrendValue * 5));
    const dealQualityTrendInterpretation =
      dealQualityTrendValue > 2
        ? `Kakovost deal-ov se izboljšuje (+${dealQualityTrendValue.toFixed(1)} točk)`
        : dealQualityTrendValue < -2
          ? `Kakovost deal-ov se slabša (${dealQualityTrendValue.toFixed(1)} točk)`
          : `Kakovost deal-ov stabilna (${dealQualityTrendValue.toFixed(1)} točk)`;

    // Signal D: sell-through rate (sold/bookmarked + contacted % last 7d)
    // Approximation: contacted+bookmarked listings show buyer intent
    const activeInterestCount = currentAgg.bookmarkedCount + currentAgg.contactedCount;
    const sellThroughRateValue = currentAgg.totalListings > 0
      ? (activeInterestCount / currentAgg.totalListings) * 100
      : 0;
    // Normalize: 0% = 0, 50% = 100
    const sellThroughRateNormalized = Math.max(0, Math.min(100, sellThroughRateValue * 2));
    const sellThroughRateInterpretation =
      sellThroughRateValue >= 30
        ? `Visoka konverzija (${sellThroughRateValue.toFixed(1)}% aktivnih)`
        : sellThroughRateValue >= 10
          ? `Zmerna konverzija (${sellThroughRateValue.toFixed(1)}% aktivnih)`
          : `Nizka konverzija (${sellThroughRateValue.toFixed(1)}% aktivnih)`;

    // Signal E: prilika rate (% PRILIKA listings last 7d)
    const prilikaRateValue = currentAgg.totalListings > 0
      ? (currentAgg.prilikaCount / currentAgg.totalListings) * 100
      : 0;
    // Normalize: 0% = 0, 50% = 100
    const prilikaRateNormalized = Math.max(0, Math.min(100, prilikaRateValue * 2));
    const prilikaRateInterpretation =
      prilikaRateValue >= 30
        ? `Veliko priložnosti (${prilikaRateValue.toFixed(1)}% PRILIKA)`
        : prilikaRateValue >= 10
          ? `Zmerno priložnosti (${prilikaRateValue.toFixed(1)}% PRILIKA)`
          : `Malo priložnosti (${prilikaRateValue.toFixed(1)}% PRILIKA)`;

    const signals: Signals = {
      listingVelocity: {
        value: Math.round(listingVelocityValue * 100) / 100,
        normalized: Math.round(listingVelocityNormalized),
        interpretation: listingVelocityInterpretation,
      },
      priceTrend: {
        value: Math.round(priceTrendValue * 100) / 100,
        normalized: Math.round(priceTrendNormalized),
        interpretation: priceTrendInterpretation,
      },
      dealQualityTrend: {
        value: Math.round(dealQualityTrendValue * 100) / 100,
        normalized: Math.round(dealQualityTrendNormalized),
        interpretation: dealQualityTrendInterpretation,
      },
      sellThroughRate: {
        value: Math.round(sellThroughRateValue * 100) / 100,
        normalized: Math.round(sellThroughRateNormalized),
        interpretation: sellThroughRateInterpretation,
      },
      prilikaRate: {
        value: Math.round(prilikaRateValue * 100) / 100,
        normalized: Math.round(prilikaRateNormalized),
        interpretation: prilikaRateInterpretation,
      },
    };

    // 4) Compute pulse score (weighted average)
    // Weights: listingVelocity 20%, priceTrend 20%, dealQualityTrend 15%, sellThroughRate 25%, prilikaRate 20%
    const pulseScore = Math.round(
      signals.listingVelocity.normalized * 0.20 +
      signals.priceTrend.normalized * 0.20 +
      signals.dealQualityTrend.normalized * 0.15 +
      signals.sellThroughRate.normalized * 0.25 +
      signals.prilikaRate.normalized * 0.20,
    );
    const pulseClassification = classifyPulse(pulseScore);

    // 5) Compute pulse trend (last 7d vs previous 7d pulse)
    // Compute previous-period pulse using same weights
    const prevListingVelocityValue = previousAgg.totalListings / 7;
    const prevListingVelocityNormalized = Math.max(0, Math.min(100, (prevListingVelocityValue / 20) * 100));

    const prevPriceTrendValue = 0; // can't compute trend of trend with 2 weeks only; assume 0 baseline
    const prevPriceTrendNormalized = 50 + prevPriceTrendValue * 2.5;

    const prevDealQualityNormalized = 50; // baseline — no trend in previous period

    const prevActiveInterest = previousAgg.bookmarkedCount + previousAgg.contactedCount;
    const prevSellThroughValue = previousAgg.totalListings > 0
      ? (prevActiveInterest / previousAgg.totalListings) * 100
      : 0;
    const prevSellThroughNormalized = Math.max(0, Math.min(100, prevSellThroughValue * 2));

    const prevPrilikaValue = previousAgg.totalListings > 0
      ? (previousAgg.prilikaCount / previousAgg.totalListings) * 100
      : 0;
    const prevPrilikaNormalized = Math.max(0, Math.min(100, prevPrilikaValue * 2));

    const previousPulseScore = Math.round(
      prevListingVelocityNormalized * 0.20 +
      prevPriceTrendNormalized * 0.20 +
      prevDealQualityNormalized * 0.15 +
      prevSellThroughNormalized * 0.25 +
      prevPrilikaNormalized * 0.20,
    );

    const trendDelta = pulseScore - previousPulseScore;
    let pulseTrend: PulseTrend = 'STABLE';
    if (trendDelta > 3) pulseTrend = 'RISING';
    else if (trendDelta < -3) pulseTrend = 'FALLING';

    const pulse: Pulse = {
      score: pulseScore,
      classification: pulseClassification,
      interpretation: interpretPulse(pulseScore, pulseClassification),
      trend: pulseTrend,
      trendDelta,
    };

    // 6) Per-source pulse
    const perSource: PerSource[] = [];
    const allSources = new Set<string>([
      ...currentBySource.keys(),
      ...previousBySource.keys(),
    ]);
    for (const source of allSources) {
      const cur = currentBySource.get(source) || emptyAgg();
      // Skip sources with very few listings
      if (cur.totalListings < 1) continue;

      const srcListingVelocity = (cur.totalListings / 7);
      const srcListingVelocityNorm = Math.max(0, Math.min(100, (srcListingVelocity / 20) * 100));

      const srcAvgPrice = cur.pricedListings > 0 ? cur.sumPrice / cur.pricedListings : 0;
      const srcPrevAvgPrice = (previousBySource.get(source)?.pricedListings ?? 0) > 0
        ? (previousBySource.get(source)!.sumPrice / previousBySource.get(source)!.pricedListings)
        : srcAvgPrice;
      let srcPriceTrendValue = 0;
      if (srcPrevAvgPrice > 0) {
        srcPriceTrendValue = ((srcAvgPrice - srcPrevAvgPrice) / srcPrevAvgPrice) * 100;
      }
      const srcPriceTrendNorm = Math.max(0, Math.min(100, 50 + srcPriceTrendValue * 2.5));

      const srcAvgDealScore = cur.dealScoreCount > 0 ? cur.sumDealScore / cur.dealScoreCount : 50;
      const srcDealQualityNorm = Math.max(0, Math.min(100, srcAvgDealScore));

      const srcActiveInterest = cur.bookmarkedCount + cur.contactedCount;
      const srcSellThroughValue = cur.totalListings > 0 ? (srcActiveInterest / cur.totalListings) * 100 : 0;
      const srcSellThroughNorm = Math.max(0, Math.min(100, srcSellThroughValue * 2));

      const srcPrilikaValue = cur.totalListings > 0 ? (cur.prilikaCount / cur.totalListings) * 100 : 0;
      const srcPrilikaNorm = Math.max(0, Math.min(100, srcPrilikaValue * 2));

      const srcPulseScore = Math.round(
        srcListingVelocityNorm * 0.20 +
        srcPriceTrendNorm * 0.20 +
        srcDealQualityNorm * 0.15 +
        srcSellThroughNorm * 0.25 +
        srcPrilikaNorm * 0.20,
      );

      perSource.push({
        source,
        displayName: sourceDisplayName(source),
        pulseScore: srcPulseScore,
        classification: classifyPulse(srcPulseScore),
        listingCount: cur.totalListings,
      });
    }
    perSource.sort((a, b) => b.pulseScore - a.pulseScore);

    // 7) Recommendation
    let action: RecommendationAction;
    let reasoning: string;

    if (pulseScore >= 70 && (pulseTrend === 'RISING' || pulseTrend === 'STABLE')) {
      action = 'BUY_AGGRESSIVELY';
      reasoning = `Trg je vroč (${pulseScore}/100, ${pulseTrend}) — visoka aktivnost kupcev in kakovostne ponudbe. Aktivno nabavljaj in prodajaj, ker bodo hitro našli kupce.`;
    } else if (pulseScore >= 55) {
      action = 'BUY_NORMAL';
      reasoning = `Trg je ugoden (${pulseScore}/100, ${pulseTrend}) — normalna nabava, prednost visokokakovostnim deal-om (deal quality ${dealQualityTrendValue >= 0 ? 'izboljšuje se' : 'upada'}).`;
    } else if (pulseScore >= 35) {
      action = 'HOLD';
      reasoning = `Trg je moderaten (${pulseScore}/100, ${pulseTrend}) — drži zalogo in selektivno nabavljaj. Počakaj na izboljšanje pogojev.`;
    } else if (pulseTrend === 'FALLING' && pulseScore < 30) {
      action = 'SELL_FAST';
      reasoning = `Trg se ohlaja (${pulseScore}/100, ${pulseTrend}) — prioritiziraj hitro prodajo inventarja pred nadaljnjim padcem cene.`;
    } else {
      action = 'WAIT';
      reasoning = `Trg je hladen (${pulseScore}/100, ${pulseTrend}) — minimalna aktivnost. Počakaj na izboljšanje pogojev pred novo nabavo.`;
    }

    const recommendation: Recommendation = { action, reasoning };

    return NextResponse.json({
      ok: true,
      pulse,
      signals,
      perSource,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/market-sentiment-pulse', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
