// v7.76: Deal Pipeline Forecaster — napoved KOLIKO deal-ov bo prešlo skozi
// vsako stopnjo pipeline-a (discovery → analysis → contact → negotiation →
// purchase → listing → sale) v naslednjih 30 dneh. Pure DB analytics — NO AI.
// "Pipeline: 100 discovery → 5 sales (5% overall). Bottleneck: contact (30%
//  conversion). Fix: boljše outreach. Projected: 120 discovery → 6 sales →
//  1800€."
//
// Razlika od deal-funnel (v7.33, ki gleda statičen konverzijski lijak zadnjih
// 90 dni) — ta FORECAST-a naslednje 30 dni glede na recent discovery rate +
// conversion rates. Razlika od deal-source-roi (ki gleda ROI po viru) — ta
// gleda konverzijo čez pipeline STAG-E. Razlika od deal-quality-distribution
// (ki gleda distribucijo score-ov) — ta gleda KOLIKO deal-ov teče skozi
// stopnje. Razlika od deal-source-comparison-matrix (ki primerja vire) — ta
// gleda celoten PIPELINE flow. Razlika od deal-velocity (ki meri market
// temperature) — ta gleda internal pipeline conversion.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-pipeline-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface CurrentPipeline {
  discovery: number;
  analysis: number;
  contact: number;
  negotiation: number;
  purchase: number;
  listing: number;
  sale: number;
}

interface ConversionRates {
  analysisRate: number; // %
  contactRate: number;
  negotiationRate: number;
  purchaseRate: number;
  listingRate: number;
  saleRate: number;
  overallConversion: number; // %
}

interface StageMetric {
  stage: string;
  count: number;
  avgTimeDays: number;
  conversionRate: number; // % conversion from previous stage
  conversionFromPrevious: number; // % conversion from first stage (overall)
}

interface Forecast {
  projectedDiscovery30d: number;
  projectedSales30d: number;
  projectedRevenue30d: number;
  projectedProfit30d: number;
  confidence: number; // 0-100
}

interface Bottleneck {
  stage: string | null;
  conversionRate: number;
  impact: string;
  fixRecommendation: string;
}

interface Recommendations {
  bestStageToOptimize: string;
  expectedLift: string;
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const PIPELINE_WINDOW_DAYS = 30; // last 30d for stage counts
const DISCOVERY_RECENT_DAYS = 14; // recent discovery rate (last 14d → weekly avg × 4)

// Slovenian stage labels
const STAGE_LABELS: Record<string, string> = {
  discovery: 'Discovery (novi oglasi)',
  analysis: 'Analysis (AI ocenjeni)',
  contact: 'Contact (kontaktirani)',
  negotiation: 'Negotiation (v pogajanju)',
  purchase: 'Purchase (kupljeni - held)',
  listing: 'Listing (relisted za prodajo)',
  sale: 'Sale (prodani)',
};

// --- Helpers -------------------------------------------------------------

function safeDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function pct(numerator: number, denominator: number): number {
  return Math.round(safeDiv(numerator, denominator) * 1000) / 10;
}

function mean(arr: number[]): number {
  const valid = arr.filter((v) => Number.isFinite(v) && v >= 0);
  if (valid.length === 0) return 0;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// Confidence in forecast (0-100) — based on data completeness & sample size
function computeConfidence(discovery30d: number, saleCount: number): number {
  // Confidence = 60 base + 25 discovery volume (max at 100 listings) + 15 sale volume (max at 20 sales)
  const discoveryBonus = Math.min(25, (discovery30d / 100) * 25);
  const saleBonus = Math.min(15, (saleCount / 20) * 15);
  return Math.round(Math.max(0, Math.min(100, 60 + discoveryBonus + saleBonus)));
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();
    const pipelineCutoff = new Date(now - PIPELINE_WINDOW_DAYS * DAY_MS);
    const discoveryCutoff = new Date(now - DISCOVERY_RECENT_DAYS * DAY_MS);

    // 1) Query listings for stages 1-3 (DISCOVERY, ANALYSIS, CONTACT)
    const pipelineListings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: pipelineCutoff },
        isHidden: false,
      },
      select: {
        id: true,
        firstSeenAt: true,
        aiScore: true,
        aiEvaluatedAt: true,
        contactStatus: true,
        contactedAt: true,
        isBookmarked: true,
        dealScore: true,
      },
      take: 100000,
    });

    const discovery = pipelineListings.length;
    const analysis = pipelineListings.filter((l) => l.aiScore != null && l.aiScore > 0).length;
    const contact = pipelineListings.filter(
      (l) =>
        l.contactStatus &&
        l.contactStatus !== 'none' &&
        l.contactStatus !== '' &&
        l.contactStatus !== 'new',
    ).length;

    // 2) Query trades for stages 4-7 (NEGOTIATION, PURCHASE, LISTING, SALE)
    // All trades (held + sold) bought in pipeline window
    const pipelineTrades = await db.trade.findMany({
      where: {
        buyDate: { gte: pipelineCutoff },
      },
      select: {
        id: true,
        status: true,
        buyDate: true,
        sellDate: true,
        buyPrice: true,
        sellPrice: true,
        buyFees: true,
        sellFees: true,
        flipChecklist: true,
        listingId: true,
      },
      take: 100000,
    });

    // Stage 5: PURCHASE = trades with status 'held' (bought, not sold)
    const purchase = pipelineTrades.filter((t) => t.status === 'held').length;
    // Stage 4: NEGOTIATION = listings linked to trades in 'held' status + listings with contactStatus='responded' (in negotiation)
    const respondedListings = pipelineListings.filter(
      (l) => l.contactStatus === 'responded' || l.contactStatus === 'closed',
    ).length;
    // Negotiation = max of held trades and responded listings (best estimate of "in negotiation")
    const negotiation = Math.max(purchase, respondedListings);
    // Stage 6: LISTING = held trades with flipChecklist progress (any step completed)
    const listing = pipelineTrades.filter((t) => {
      if (t.status !== 'held') return false;
      try {
        const checklist = JSON.parse(t.flipChecklist || '[]') as Array<{ step?: string; completedAt?: string }>;
        return Array.isArray(checklist) && checklist.some(
          (c) => c && typeof c === 'object' && (c.completedAt || c.step),
        );
      } catch {
        return false;
      }
    }).length;
    // Stage 7: SALE = trades with status 'sold'
    const soldTradesInWindow = pipelineTrades.filter((t) => t.status === 'sold');
    const sale = soldTradesInWindow.length;

    const currentPipeline: CurrentPipeline = {
      discovery,
      analysis,
      contact,
      negotiation,
      purchase,
      listing,
      sale,
    };

    // 3) Compute conversion rates
    const conversionRates: ConversionRates = {
      analysisRate: pct(analysis, discovery),
      contactRate: pct(contact, analysis),
      negotiationRate: pct(negotiation, contact),
      purchaseRate: pct(purchase, negotiation),
      listingRate: pct(listing, purchase),
      saleRate: pct(sale, listing),
      overallConversion: pct(sale, discovery),
    };

    // 4) Compute avg time per stage from historical data
    // For analysis stage: avg time from firstSeenAt to aiEvaluatedAt
    const analysisTimes: number[] = [];
    for (const l of pipelineListings) {
      if (l.aiEvaluatedAt && l.firstSeenAt) {
        const firstMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
        const evalMs = new Date(l.aiEvaluatedAt as unknown as Date | string).getTime();
        if (Number.isFinite(firstMs) && Number.isFinite(evalMs) && evalMs >= firstMs) {
          analysisTimes.push((evalMs - firstMs) / DAY_MS);
        }
      }
    }

    // For contact stage: avg time from firstSeenAt to contactedAt
    const contactTimes: number[] = [];
    for (const l of pipelineListings) {
      if (l.contactedAt && l.firstSeenAt) {
        const firstMs = new Date(l.firstSeenAt as unknown as Date | string).getTime();
        const contactMs = new Date(l.contactedAt as unknown as Date | string).getTime();
        if (Number.isFinite(firstMs) && Number.isFinite(contactMs) && contactMs >= firstMs) {
          contactTimes.push((contactMs - firstMs) / DAY_MS);
        }
      }
    }

    // For purchase→sale: avg hold time (buy to sell)
    const cycleTimes: number[] = [];
    for (const t of soldTradesInWindow) {
      if (t.buyDate && t.sellDate) {
        const buyMs = new Date(t.buyDate as unknown as Date | string).getTime();
        const sellMs = new Date(t.sellDate as unknown as Date | string).getTime();
        if (Number.isFinite(buyMs) && Number.isFinite(sellMs) && sellMs >= buyMs) {
          cycleTimes.push((sellMs - buyMs) / DAY_MS);
        }
      }
    }

    // Build stage metrics
    const stageMetrics: StageMetric[] = [
      {
        stage: 'discovery',
        count: discovery,
        avgTimeDays: 0,
        conversionRate: 100,
        conversionFromPrevious: 100,
      },
      {
        stage: 'analysis',
        count: analysis,
        avgTimeDays: Math.round(mean(analysisTimes) * 10) / 10,
        conversionRate: conversionRates.analysisRate,
        conversionFromPrevious: conversionRates.analysisRate,
      },
      {
        stage: 'contact',
        count: contact,
        avgTimeDays: Math.round(mean(contactTimes) * 10) / 10,
        conversionRate: conversionRates.contactRate,
        conversionFromPrevious: conversionRates.contactRate,
      },
      {
        stage: 'negotiation',
        count: negotiation,
        avgTimeDays: 0, // hard to compute without negotiation timestamps
        conversionRate: conversionRates.negotiationRate,
        conversionFromPrevious: conversionRates.negotiationRate,
      },
      {
        stage: 'purchase',
        count: purchase,
        avgTimeDays: 0,
        conversionRate: conversionRates.purchaseRate,
        conversionFromPrevious: conversionRates.purchaseRate,
      },
      {
        stage: 'listing',
        count: listing,
        avgTimeDays: 0,
        conversionRate: conversionRates.listingRate,
        conversionFromPrevious: conversionRates.listingRate,
      },
      {
        stage: 'sale',
        count: sale,
        avgTimeDays: Math.round(mean(cycleTimes) * 10) / 10,
        conversionRate: conversionRates.saleRate,
        conversionFromPrevious: conversionRates.saleRate,
      },
    ];

    // 5) Forecast next 30d pipeline
    // Discovery rate: avg listings/week from last 14 days × 4 (4 weeks in 30d)
    const recentListings = await db.listing.count({
      where: {
        firstSeenAt: { gte: discoveryCutoff },
        isHidden: false,
      },
    });
    const weeklyDiscoveryRate = recentListings / (DISCOVERY_RECENT_DAYS / 7);
    const projectedDiscovery30d = Math.round(weeklyDiscoveryRate * 4);

    // Apply overall conversion rate to project sales
    const overallConvDecimal = conversionRates.overallConversion / 100;
    const projectedSales30d = Math.round(projectedDiscovery30d * overallConvDecimal);

    // Project revenue: avg sell price × projected sales
    const soldWithPrice = soldTradesInWindow.filter((t) => t.sellPrice != null && t.sellPrice > 0);
    const avgSellPrice = soldWithPrice.length > 0
      ? soldWithPrice.reduce((s, t) => s + (t.sellPrice ?? 0), 0) / soldWithPrice.length
      : 0;
    const projectedRevenue30d = Math.round(projectedSales30d * avgSellPrice);

    // Project profit: avg profit per trade × projected sales
    const profitPerTrade = soldWithPrice.length > 0
      ? soldWithPrice.reduce(
          (s, t) =>
            s +
            ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)),
          0,
        ) / soldWithPrice.length
      : 0;
    const projectedProfit30d = Math.round(projectedSales30d * profitPerTrade);

    const confidence = computeConfidence(discovery, sale);

    const forecast: Forecast = {
      projectedDiscovery30d,
      projectedSales30d,
      projectedRevenue30d,
      projectedProfit30d,
      confidence,
    };

    // 6) Identify pipeline bottleneck (stage with lowest conversion rate, excluding discovery)
    const stageConvPairs: Array<{ stage: string; rate: number }> = [
      { stage: 'analysis', rate: conversionRates.analysisRate },
      { stage: 'contact', rate: conversionRates.contactRate },
      { stage: 'negotiation', rate: conversionRates.negotiationRate },
      { stage: 'purchase', rate: conversionRates.purchaseRate },
      { stage: 'listing', rate: conversionRates.listingRate },
      { stage: 'sale', rate: conversionRates.saleRate },
    ];
    // Filter out stages with 0 previous-stage count (avoid phantom bottleneck)
    const validBottleneckCandidates = stageConvPairs.filter((s, idx) => {
      // Previous stage must have >0 count
      const stages = [discovery, analysis, contact, negotiation, purchase, listing];
      const prevCount = stages[idx] ?? 0;
      return prevCount > 0;
    });

    let bottleneck: Bottleneck;
    if (validBottleneckCandidates.length === 0) {
      bottleneck = {
        stage: null,
        conversionRate: 0,
        impact: 'Ni dovolj podatkov za identifikacijo bottleneck-a.',
        fixRecommendation: 'Dodaj več listing-ov in trade-ov za analizo pipeline-a.',
      };
    } else {
      // Find min conversion rate
      const minStage = validBottleneckCandidates.reduce(
        (min, s) => (s.rate < min.rate ? s : min),
        validBottleneckCandidates[0]!,
      );
      // Compute impact: if conversion improved to 50%, how many more sales?
      const stageIndex = stageConvPairs.findIndex((s) => s.stage === minStage.stage);
      // Count at each stage to compute downstream impact
      const stageCounts: Record<string, number> = {
        analysis,
        contact,
        negotiation,
        purchase,
        listing,
        sale,
      };
      const currentStageCount = stageCounts[minStage.stage] ?? 0;
      const prevStageCount = [
        discovery,
        analysis,
        contact,
        negotiation,
        purchase,
        listing,
      ][stageIndex] ?? 0;
      const liftIf50 = Math.round((prevStageCount * 0.5) - currentStageCount);
      const downstreamConversion =
        conversionRates.overallConversion > 0 ? conversionRates.overallConversion / 100 : 0;
      const lostSales = Math.max(0, Math.round(liftIf50 * downstreamConversion));

      const fixMap: Record<string, string> = {
        analysis: 'Pospeši AI evaluacijo — zmanjšaj backlog neocenjenih oglasov (cron job, batch evaluator).',
        contact: 'Izboljšaj outreach — boljši message templates, hitrejši response, multi-platform kontakt.',
        negotiation: 'Izboljšaj pogajalske veščine — boljši opening offer, jasni walk-away pogoji, AI negotiation bot.',
        purchase: 'Optimiziraj buy decision — hitrejši buy workflow, cash reserve, boljša deal prioritizacija.',
        listing: 'Pospeši relisting — AI listing generator, multi-platform objava, foto pipeline.',
        sale: 'Izboljšaj prodajo — boljše cene, FOMO messaging, optimal listing time, seasonal timing.',
      };

      bottleneck = {
        stage: minStage.stage,
        conversionRate: minStage.rate,
        impact: lostSales > 0
          ? `Če izboljšaš "${STAGE_LABELS[minStage.stage] ?? minStage.stage}" na 50% konverzijo, bi pridobil ~${lostSales} dodatnih prodaj/mesec.`
          : `Bottleneck "${STAGE_LABELS[minStage.stage] ?? minStage.stage}" ima ${minStage.rate.toFixed(1)}% konverzijo.`,
        fixRecommendation: fixMap[minStage.stage] ?? 'Izboljšaj proces na tej stopnji pipeline-a.',
      };
    }

    // 7) Recommendations
    const bestStageToOptimize = bottleneck.stage ?? 'discovery';
    const expectedLift = bottleneck.stage
      ? `+${Math.max(1, Math.round((bottleneck.conversionRate < 50 ? 50 - bottleneck.conversionRate : 0) / 5))} prodaj/mesec ob 20% izboljšanju`
      : 'Ni podatkov';
    let advice: string;
    if (discovery === 0) {
      advice = 'Ni podatkov o discovery-ju v zadnjih 30 dneh — zaženi monitorje in dodaj listing-e za analizo pipeline-a.';
    } else if (sale === 0) {
      advice = `Discovery ${discovery} listing-ov, vendar 0 prodaj. Bottleneck: ${bottleneck.stage ?? 'neznan'}. Prioritiziraj izboljšanje te stopnje pred skaliranjem discovery-ja.`;
    } else if (conversionRates.overallConversion < 5) {
      advice = `Nizka konverzija (${conversionRates.overallConversion.toFixed(1)}%). Bottleneck: ${bottleneck.stage ?? 'neznan'} (${bottleneck.conversionRate.toFixed(1)}%). Pred skaliranjem discovery-ja popravi to stopnjo — drugače zgolj povečaš volume brez rezultata.`;
    } else if (conversionRates.overallConversion < 15) {
      advice = `Zmerna konverzija (${conversionRates.overallConversion.toFixed(1)}%). Bottleneck: ${bottleneck.stage ?? 'neznan'}. Izboljšaj to stopnjo + hkrati povečaj discovery rate za skaliranje.`;
    } else {
      advice = `Visoka konverzija (${conversionRates.overallConversion.toFixed(1)}%). Pipeline je zdrav — povečaj discovery rate (več monitorjev, širši keywords) za skaliranje profita.`;
    }

    const recommendations: Recommendations = {
      bestStageToOptimize,
      expectedLift,
      advice,
    };

    return NextResponse.json({
      ok: true,
      currentPipeline,
      conversionRates,
      stageMetrics,
      forecast,
      bottleneck,
      recommendations,
    });
  } catch (err: any) {
    logger.error('/api/analytics/deal-pipeline-forecaster', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
