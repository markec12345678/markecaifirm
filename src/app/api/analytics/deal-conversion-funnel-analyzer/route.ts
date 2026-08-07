// v7.78: Deal Conversion Funnel Analyzer — analizira celoten deal conversion
// funnel od odkritja listing-a do finalne prodaje in identificira kje
// izgubljaš deal-e. Pure DB analytics — NO AI. "Funnel: 500 odkritih → 25
// prodanih (5%). Največji padec: contact stage (70% izgube). Fix: boljši
// outreach → +12 prodaj, +3600€."
//
// Razlika od buyer-conversion-funnel-v2 (ki gleda buyer-side conversion) —
// ta gleda TVOJ full deal funnel od discovery do sold z 8 fazami. Razlika
// od listing-conversion-funnel-optimizer (AI optimization nasveti) — ta je
// descriptivna analiza z bottleneck identification in optimization potential.
// Razlika od listing-conversion-optimizer (AI optimization) — ta gleda
// conversion RATE med fazami z bottleneck analysis. Razlika od
// deal-pipeline-forecaster (v7.76 pipeline stages) — ta gleda conversion
// funnel z bottleneck in optimization potential (projected additional sales).
// Razlika od deal-velocity (market temperature) — ta gleda WHERE deals are
// lost v funnel-u z stage-level conversion rates.
//
// Pure DB analytics (NO AI). GET /api/analytics/deal-conversion-funnel-analyzer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface FunnelStage {
  stage: string;
  count: number;
  cumulativeConversion: number; // % from start
  stageConversion: number; // % from previous stage
  avgTimeDays: number;
}

interface ConversionRates {
  analysisRate: number;
  qualityRate: number;
  contactRate: number;
  negotiationRate: number;
  purchaseRate: number;
  listingRate: number;
  saleRate: number;
  overallConversion: number;
}

interface StageDropoff {
  stage: string;
  dropoffPercent: number;
  impact: string;
}

interface FunnelAnalysis {
  biggestDropoff: StageDropoff;
  weakestStage: { stage: string; conversionRate: number; recommendation: string };
  strongestStage: { stage: string; conversionRate: number };
}

interface CategoryFunnel {
  category: string;
  discovered: number;
  sold: number;
  conversionRate: number;
  weakestStage: string;
  rank: number;
}

interface FunnelOptimization {
  weakestStageImprovement: number; // % if improved to avg
  projectedAdditionalSales: number;
  projectedAdditionalRevenue: number;
  recommendation: string;
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
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

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return round1((part / total) * 100);
}

// Parse flipChecklist JSON to compute progress %
function flipChecklistProgress(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    if (parsed.length === 0) return 0;
    const completed = parsed.filter(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'completedAt' in item &&
        (item as Record<string, unknown>).completedAt != null,
    ).length;
    return Math.round((completed / parsed.length) * 100);
  } catch {
    return 0;
  }
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all listings with relevant fields
    const listings = await db.listing.findMany({
      where: { isHidden: false },
      select: {
        id: true,
        monitor: { select: { source: true } },
        aiScore: true,
        dealScore: true,
        contactStatus: true,
        firstSeenAt: true,
        contactedAt: true,
        aiEvaluatedAt: true,
        isBookmarked: true,
      },
      take: 200000,
    });

    // 2) Query all trades linked to listings
    const trades = await db.trade.findMany({
      where: {
        status: { in: ['held', 'sold', 'cancelled'] },
        listing: { isNot: null },
      },
      select: {
        id: true,
        status: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        sellDate: true,
        sellPrice: true,
        flipChecklist: true,
        listing: { select: { id: true, monitor: { select: { source: true } } } },
      },
      take: 200000,
    });

    // 3) Build funnel stages
    // Stage 1: DISCOVERED = total listings found
    const discoveredCount = listings.length;

    // Stage 2: AI_ANALYZED = listings with aiScore populated
    const aiAnalyzedCount = listings.filter(
      (l) => l.aiScore != null && l.aiScore > 0,
    ).length;

    // Stage 3: HIGH_QUALITY = listings with dealScore > 50
    const highQualityCount = listings.filter(
      (l) => l.dealScore != null && l.dealScore > 50,
    ).length;

    // Stage 4: CONTACTED = listings with contactStatus indicating contact
    const contactedCount = listings.filter(
      (l) =>
        l.contactStatus &&
        l.contactStatus !== 'none' &&
        l.contactStatus.trim().length > 0,
    ).length;

    // Stage 5: NEGOTIATED = listings linked to trades
    const listingsWithTrades = new Set(
      trades
        .filter((t) => t.listing?.id)
        .map((t) => t.listing!.id),
    );
    const negotiatedCount = listingsWithTrades.size;

    // Stage 6: PURCHASED = trades with status 'held' (or sold — bought)
    const purchasedTrades = trades.filter(
      (t) => t.status === 'held' || t.status === 'sold',
    );
    const purchasedCount = purchasedTrades.length;

    // Stage 7: LISTED_FOR_SALE = held/sold trades with flipChecklist progress > 50%
    const listedForSaleCount = purchasedTrades.filter((t) => {
      const progress = flipChecklistProgress(t.flipChecklist);
      return progress > 50;
    }).length;

    // Stage 8: SOLD = trades with status 'sold'
    const soldTrades = trades.filter((t) => t.status === 'sold');
    const soldCount = soldTrades.length;

    // 4) Compute avg time per stage (from timestamps)
    // DISCOVERED → AI_ANALYZED: firstSeenAt → aiEvaluatedAt
    let analyzeTimeSum = 0;
    let analyzeTimeCount = 0;
    for (const l of listings) {
      const seen = toMs(l.firstSeenAt);
      const evaluated = toMs(l.aiEvaluatedAt);
      if (seen > 0 && evaluated > 0) {
        analyzeTimeSum += daysBetween(seen, evaluated);
        analyzeTimeCount += 1;
      }
    }
    const avgAnalyzeDays = analyzeTimeCount > 0 ? round0(analyzeTimeSum / analyzeTimeCount) : 0;

    // AI_ANALYZED → CONTACTED: aiEvaluatedAt → contactedAt
    let contactTimeSum = 0;
    let contactTimeCount = 0;
    for (const l of listings) {
      const evaluated = toMs(l.aiEvaluatedAt);
      const contacted = toMs(l.contactedAt);
      if (evaluated > 0 && contacted > 0) {
        contactTimeSum += daysBetween(evaluated, contacted);
        contactTimeCount += 1;
      }
    }
    const avgContactDays = contactTimeCount > 0 ? round0(contactTimeSum / contactTimeCount) : 0;

    // CONTACTED → PURCHASED: contactedAt → buyDate (for trades with listing)
    let purchaseTimeSum = 0;
    let purchaseTimeCount = 0;
    for (const t of purchasedTrades) {
      if (!t.listing) continue;
      // Find listing for contact timestamp — use firstSeenAt of listing as fallback
      const listing = listings.find((l) => l.id === t.listing!.id);
      if (!listing) continue;
      const contact = toMs(listing.contactedAt) || toMs(listing.firstSeenAt);
      const buy = toMs(t.buyDate);
      if (contact > 0 && buy > 0) {
        purchaseTimeSum += daysBetween(contact, buy);
        purchaseTimeCount += 1;
      }
    }
    const avgPurchaseDays = purchaseTimeCount > 0 ? round0(purchaseTimeSum / purchaseTimeCount) : 0;

    // PURCHASED → SOLD: buyDate → sellDate
    let saleTimeSum = 0;
    let saleTimeCount = 0;
    for (const t of soldTrades) {
      const buy = toMs(t.buyDate);
      const sell = toMs(t.sellDate);
      if (buy > 0 && sell > 0) {
        saleTimeSum += daysBetween(buy, sell);
        saleTimeCount += 1;
      }
    }
    const avgSaleDays = saleTimeCount > 0 ? round0(saleTimeSum / saleTimeCount) : 0;

    // 5) Build funnel stages array with conversion rates
    const stages: FunnelStage[] = [
      {
        stage: 'DISCOVERED',
        count: discoveredCount,
        cumulativeConversion: 100,
        stageConversion: 100,
        avgTimeDays: 0,
      },
      {
        stage: 'AI_ANALYZED',
        count: aiAnalyzedCount,
        cumulativeConversion: pct(aiAnalyzedCount, discoveredCount),
        stageConversion: pct(aiAnalyzedCount, discoveredCount),
        avgTimeDays: avgAnalyzeDays,
      },
      {
        stage: 'HIGH_QUALITY',
        count: highQualityCount,
        cumulativeConversion: pct(highQualityCount, discoveredCount),
        stageConversion: pct(highQualityCount, aiAnalyzedCount),
        avgTimeDays: 0,
      },
      {
        stage: 'CONTACTED',
        count: contactedCount,
        cumulativeConversion: pct(contactedCount, discoveredCount),
        stageConversion: pct(contactedCount, highQualityCount),
        avgTimeDays: avgContactDays,
      },
      {
        stage: 'NEGOTIATED',
        count: negotiatedCount,
        cumulativeConversion: pct(negotiatedCount, discoveredCount),
        stageConversion: pct(negotiatedCount, contactedCount),
        avgTimeDays: 0,
      },
      {
        stage: 'PURCHASED',
        count: purchasedCount,
        cumulativeConversion: pct(purchasedCount, discoveredCount),
        stageConversion: pct(purchasedCount, negotiatedCount),
        avgTimeDays: avgPurchaseDays,
      },
      {
        stage: 'LISTED_FOR_SALE',
        count: listedForSaleCount,
        cumulativeConversion: pct(listedForSaleCount, discoveredCount),
        stageConversion: pct(listedForSaleCount, purchasedCount),
        avgTimeDays: 0,
      },
      {
        stage: 'SOLD',
        count: soldCount,
        cumulativeConversion: pct(soldCount, discoveredCount),
        stageConversion: pct(soldCount, listedForSaleCount),
        avgTimeDays: avgSaleDays,
      },
    ];

    // 6) Compute conversion rates
    const conversionRates: ConversionRates = {
      analysisRate: pct(aiAnalyzedCount, discoveredCount),
      qualityRate: pct(highQualityCount, aiAnalyzedCount),
      contactRate: pct(contactedCount, highQualityCount),
      negotiationRate: pct(negotiatedCount, contactedCount),
      purchaseRate: pct(purchasedCount, negotiatedCount),
      listingRate: pct(listedForSaleCount, purchasedCount),
      saleRate: pct(soldCount, listedForSaleCount),
      overallConversion: pct(soldCount, discoveredCount),
    };

    // 7) Identify bottlenecks
    // Dropoff per stage = 100 - stageConversion (only for stages with previous)
    const stageDropoffs: Array<{ stage: string; dropoffPercent: number; conversion: number }> = [];
    for (let i = 1; i < stages.length; i++) {
      const s = stages[i]!;
      stageDropoffs.push({
        stage: s.stage,
        dropoffPercent: round1(100 - s.stageConversion),
        conversion: s.stageConversion,
      });
    }

    // Sort dropoffs desc to find biggest
    const sortedDropoffs = [...stageDropoffs].sort(
      (a, b) => b.dropoffPercent - a.dropoffPercent,
    );
    const biggestDropoffStage = sortedDropoffs[0] ?? {
      stage: 'DISCOVERED',
      dropoffPercent: 0,
      conversion: 100,
    };

    // Weakest stage = lowest stageConversion (excluding stages with 0 input)
    const validStages = stageDropoffs.filter((s) => s.conversion > 0 && s.conversion < 100);
    const sortedByConversion = [...validStages].sort(
      (a, b) => a.conversion - b.conversion,
    );
    const weakestStageRaw = sortedByConversion[0] ?? {
      stage: 'DISCOVERED',
      dropoffPercent: 0,
      conversion: 100,
    };

    // Strongest stage = highest stageConversion (excluding 100% stages)
    const sortedByHighConversion = [...validStages].sort(
      (a, b) => b.conversion - a.conversion,
    );
    const strongestStageRaw = sortedByHighConversion[0] ?? {
      stage: 'DISCOVERED',
      dropoffPercent: 0,
      conversion: 100,
    };

    // Recommendation for weakest stage
    const weakestStageRecommendation: string = (() => {
      switch (weakestStageRaw.stage) {
        case 'AI_ANALYZED':
          return 'Povečaj AI analizo — nastavi monitoring in cron za samodejno aiScore.';
        case 'HIGH_QUALITY':
          return 'Izboljšaj AI deal scoring parametre ali povečaj volumen listing-ov za več high quality match-ov.';
        case 'CONTACTED':
          return 'Izboljšaj outreach — kontaktiraj več high quality listing-ov hitreje (avtomatiziraj kontakt).';
        case 'NEGOTIATED':
          return 'Izboljšajnegotiation strategijo — pošlji boljše ponudbe, bodi odziven.';
        case 'PURCHASED':
          return 'Izboljšaj closing rate — znižaj buying price, bodi fleksibilen za plačilo.';
        case 'LISTED_FOR_SALE':
          return 'Pospeši flip checklist — fotografiraj in objavi hitreje po nakupu.';
        case 'SOLD':
          return 'Izboljšaj selling strategijo — znižaj ceno ali razširi kanale prodaje.';
        default:
          return 'Analiziraj funnel za specifične optimizacije.';
      }
    })();

    const analysis: FunnelAnalysis = {
      biggestDropoff: {
        stage: biggestDropoffStage.stage,
        dropoffPercent: biggestDropoffStage.dropoffPercent,
        impact:
          biggestDropoffStage.dropoffPercent >= 50
            ? `Kritičen padec v ${biggestDropoffStage.stage} fazi — izgubljaš ${biggestDropoffStage.dropoffPercent}% deal-ov. Prioritetno optimiziraj to fazo.`
            : `Zmernen padec v ${biggestDropoffStage.stage} fazi (${biggestDropoffStage.dropoffPercent}% izgube).`,
      },
      weakestStage: {
        stage: weakestStageRaw.stage,
        conversionRate: weakestStageRaw.conversion,
        recommendation: weakestStageRecommendation,
      },
      strongestStage: {
        stage: strongestStageRaw.stage,
        conversionRate: strongestStageRaw.conversion,
      },
    };

    // 8) Per-category funnel analysis
    interface CatAgg {
      discovered: number;
      sold: number;
      aiAnalyzed: number;
      contacted: number;
    }
    const catAgg = new Map<string, CatAgg>();
    for (const l of listings) {
      const cat = (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      let c = catAgg.get(cat);
      if (!c) {
        c = { discovered: 0, sold: 0, aiAnalyzed: 0, contacted: 0 };
        catAgg.set(cat, c);
      }
      c.discovered += 1;
      if (l.aiScore != null && l.aiScore > 0) c.aiAnalyzed += 1;
      if (l.contactStatus && l.contactStatus !== 'none') c.contacted += 1;
    }
    for (const t of soldTrades) {
      if (!t.listing) continue;
      const listing = listings.find((l) => l.id === t.listing!.id);
      if (!listing) continue;
      const cat = (listing.monitor?.source || '').trim().toLowerCase() || 'neznan';
      const c = catAgg.get(cat);
      if (c) c.sold += 1;
    }

    const byCategory: CategoryFunnel[] = [];
    for (const [category, c] of catAgg.entries()) {
      const conversionRate = pct(c.sold, c.discovered);
      // Determine weakest stage per category
      let weakestStage = 'DISCOVERED';
      if (c.discovered > 0 && c.aiAnalyzed === 0) weakestStage = 'AI_ANALYZED';
      else if (c.aiAnalyzed > 0 && c.contacted === 0) weakestStage = 'CONTACTED';
      else if (c.contacted > 0 && c.sold === 0) weakestStage = 'PURCHASED';
      byCategory.push({
        category,
        discovered: c.discovered,
        sold: c.sold,
        conversionRate,
        weakestStage,
        rank: 0,
      });
    }
    byCategory.sort((a, b) => b.conversionRate - a.conversionRate);
    byCategory.forEach((c, i) => {
      c.rank = i + 1;
    });

    // 9) Compute optimization potential
    // If weakest stage improved to avg of other stages, how many more sales?
    const avgStageConversion =
      validStages.length > 0
        ? validStages.reduce((s, v) => s + v.conversion, 0) / validStages.length
        : 0;
    const weakestStageImprovement = weakestStageRaw.conversion > 0
      ? round1(Math.max(0, avgStageConversion - weakestStageRaw.conversion))
      : round1(avgStageConversion);

    // Projected additional sales: if weakest stage improved, it cascades down
    // Find stage index of weakest
    const weakestStageIdx = stages.findIndex(
      (s) => s.stage === weakestStageRaw.stage,
    );
    let projectedAdditionalSales = 0;
    if (weakestStageIdx > 0 && weakestStageIdx < stages.length) {
      // Input to weakest stage = previous stage count
      const inputCount = stages[weakestStageIdx - 1]!.count;
      const currentOutput = weakestStageRaw.conversion * inputCount / 100;
      const projectedOutput = avgStageConversion * inputCount / 100;
      const additionalFromStage = projectedOutput - currentOutput;
      // Cascade: how much of these reach the end?
      const remainingStageConversions = stages
        .slice(weakestStageIdx + 1)
        .map((s) => s.stageConversion / 100);
      const cascadeMultiplier =
        remainingStageConversions.length > 0
          ? remainingStageConversions.reduce((p, c) => p * c, 1)
          : 1;
      projectedAdditionalSales = round0(Math.max(0, additionalFromStage * cascadeMultiplier));
    }

    // Projected additional revenue: avg sellPrice × projected additional sales
    const avgSellPrice = soldTrades.length > 0
      ? soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0) / soldTrades.length
      : 0;
    const projectedAdditionalRevenue = round0(projectedAdditionalSales * avgSellPrice);

    const optimization: FunnelOptimization = {
      weakestStageImprovement,
      projectedAdditionalSales,
      projectedAdditionalRevenue,
      recommendation: `Če izboljšaš ${weakestStageRaw.stage} conversion iz ${weakestStageRaw.conversion}% na ${round1(avgStageConversion)}% (povprečje), bi pridobil ~${projectedAdditionalSales} dodatnih prodaj (${projectedAdditionalRevenue}€ prihodkov).`,
    };

    // 10) Summary
    const overallConversion = conversionRates.overallConversion;

    return NextResponse.json({
      ok: true,
      funnel: stages,
      conversionRates,
      analysis,
      byCategory: byCategory.slice(0, 20),
      optimization,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/deal-conversion-funnel-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
