// v7.68: Market Depth Analyzer — meri "globino" trga per kategorija: koliko
// oglasov obstaja pri posamezni ceni. Tanki trgi (malooglasov) = tvegani
// (težko določiti ceno, težko prodati). Globoki trgi (veliko oglasov) =
// varni (likvidni, enostavno ceniti). Pure DB analytics — NO AI.
//
// "Elektronika: deep market (85 listings, depth 90/100, HIGH liquidity).
//  Avto: thin (5 listings, depth 20/100, VERY_LOW liquidity)."
//
// Razlika od market-saturation (ki gleda volumen oglasov per kategorija) —
// ta gleda DISTRIBUCIJO cen znotraj kategorije (10 cenovnih bucketov,
// priceStdDev, depthScore 0-100, liquidityAssessment HIGH/MEDIUM/LOW/VERY_LOW,
// pricingConfidence, priceGap, sweetSpot, outlierCount). Razlika od
// price-history-forecaster (ki napoveduje cene) — ta gleda KAKO GLOBOH je
// trg danes (koliko podatkov imamo za zanesljivo ceno). Razlika od
// deal-velocity (ki meri hitrost prodaje) — ta meri GLOBINO in likvidnost.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-depth-analyzer

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type LiquidityAssessment = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

interface PriceBucket {
  bucket: string;
  count: number;
  percentage: number;
}

interface CategoryDepthRow {
  category: string;
  totalListings: number;
  priceRange: { min: number; max: number; median: number };
  avgPrice: number;
  priceStdDev: number;
  depthScore: number; // 0-100
  liquidityAssessment: LiquidityAssessment;
  pricingConfidence: number; // 0-100
  priceDistribution: PriceBucket[];
  priceGap: { range: string; count: 0 };
  sweetSpot: { range: string; count: number };
  outlierCount: number;
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function computeMedian(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function computeStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function assessLiquidity(totalListings: number): LiquidityAssessment {
  if (totalListings > 100) return 'HIGH';
  if (totalListings >= 30) return 'MEDIUM';
  if (totalListings >= 10) return 'LOW';
  return 'VERY_LOW';
}

// depthScore = listing count score (0-50) + distribution evenness score (0-50)
function computeDepthScore(
  totalListings: number,
  distribution: PriceBucket[],
): number {
  // Listing count component: max 50 at >=50 listings
  let countScore: number;
  if (totalListings >= 50) countScore = 50;
  else if (totalListings >= 30) countScore = 40;
  else if (totalListings >= 20) countScore = 30;
  else if (totalListings >= 10) countScore = 20;
  else if (totalListings >= 5) countScore = 10;
  else countScore = 5;

  // Distribution evenness: based on coefficient of variation of bucket counts
  // Lower CV = more even = higher score (max 50)
  const counts = distribution.map(d => d.count);
  const sum = counts.reduce((s, c) => s + c, 0);
  let evennessScore = 0;
  if (sum > 0 && counts.length > 0) {
    const mean = sum / counts.length;
    if (mean > 0) {
      const stdDev = computeStdDev(counts, mean);
      const cv = stdDev / mean;
      // CV 0 = perfectly even (50), CV >=2 = highly skewed (0)
      const evenness = Math.max(0, 1 - cv / 2);
      evennessScore = Math.round(evenness * 50);
    }
  }

  return Math.max(0, Math.min(100, countScore + evennessScore));
}

// pricingConfidence: higher when more listings AND lower std dev relative to mean
function computePricingConfidence(
  totalListings: number,
  stdDev: number,
  mean: number,
): number {
  let conf = 0;
  // Listing count component (max 60)
  if (totalListings >= 100) conf += 60;
  else if (totalListings >= 50) conf += 50;
  else if (totalListings >= 30) conf += 40;
  else if (totalListings >= 15) conf += 25;
  else if (totalListings >= 5) conf += 10;
  else conf += 5;

  // Coefficient of variation component (max 40)
  if (mean > 0) {
    const cv = stdDev / mean;
    let cvScore = 0;
    if (cv < 0.2) cvScore = 40;
    else if (cv < 0.4) cvScore = 30;
    else if (cv < 0.6) cvScore = 20;
    else if (cv < 1.0) cvScore = 10;
    else cvScore = 5;
    conf += cvScore;
  }
  return Math.max(0, Math.min(100, conf));
}

function formatPrice(n: number): string {
  return `${Math.round(n)}€`;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all active listings with a price
    const listings = await db.listing.findMany({
      where: {
        isHidden: false,
        price: { gt: 0 },
      },
      select: {
        id: true,
        price: true,
        monitor: { select: { tags: true } },
      },
      take: 20000,
    });

    // 2) Empty state
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          deepMarkets: 0,
          thinMarkets: 0,
          safestCategory: null,
          riskiestCategory: null,
          advice: 'Ni oglasov z veljavno ceno — Market Depth analiza ni mogoča.',
        },
        message:
          'Ni oglasov z veljavno ceno — Market Depth analiza ni mogoča.',
      });
    }

    // 3) Group listings by category (from monitor.tags)
    const byCategory = new Map<string, number[]>();
    for (const l of listings) {
      const tagsRaw = (l.monitor?.tags as string | undefined) || '';
      const firstTag = tagsRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)[0];
      const cat = (firstTag || 'drugo').trim() || 'drugo';
      const price = l.price ?? 0;
      if (price <= 0) continue;
      const arr = byCategory.get(cat) || [];
      arr.push(price);
      byCategory.set(cat, arr);
    }

    // 4) Build per-category depth analysis
    const rows: CategoryDepthRow[] = [];
    for (const [category, prices] of byCategory.entries()) {
      const totalListings = prices.length;
      const sorted = [...prices].sort((a, b) => a - b);
      const min = sorted[0] ?? 0;
      const max = sorted[sorted.length - 1] ?? 0;
      const median = computeMedian(sorted);
      const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
      const stdDev = computeStdDev(prices, avgPrice);

      // Build 10 price buckets
      const range = max - min;
      const bucketCount = 10;
      const bucketSize = range > 0 ? range / bucketCount : 1;
      const buckets: PriceBucket[] = [];
      for (let i = 0; i < bucketCount; i++) {
        const lo = min + i * bucketSize;
        const hi = i === bucketCount - 1 ? max : lo + bucketSize;
        const count = sorted.filter(p =>
          i === bucketCount - 1 ? p >= lo && p <= hi : p >= lo && p < hi,
        ).length;
        buckets.push({
          bucket: `${formatPrice(lo)}-${formatPrice(hi)}`,
          count,
          percentage:
            totalListings > 0
              ? Math.round((count / totalListings) * 1000) / 10
              : 0,
        });
      }

      // priceGap = largest empty bucket (count === 0)
      let priceGap: { range: string; count: 0 } | null = null;
      for (const b of buckets) {
        if (b.count === 0) {
          priceGap = { range: b.bucket, count: 0 };
          break; // first empty bucket (lowest price)
        }
      }
      if (!priceGap) {
        priceGap = { range: '—', count: 0 };
      }

      // sweetSpot = bucket with most listings
      let sweetSpot: { range: string; count: number } = {
        range: buckets[0]?.bucket ?? '—',
        count: buckets[0]?.count ?? 0,
      };
      for (const b of buckets) {
        if (b.count > sweetSpot.count) {
          sweetSpot = { range: b.bucket, count: b.count };
        }
      }

      // outliers = listings priced >2 std dev from mean
      const outlierCount = prices.filter(
        p => Math.abs(p - avgPrice) > 2 * stdDev,
      ).length;

      const depthScore = computeDepthScore(totalListings, buckets);
      const liquidityAssessment = assessLiquidity(totalListings);
      const pricingConfidence = computePricingConfidence(
        totalListings,
        stdDev,
        avgPrice,
      );

      rows.push({
        category,
        totalListings,
        priceRange: {
          min: Math.round(min),
          max: Math.round(max),
          median: Math.round(median),
        },
        avgPrice: Math.round(avgPrice),
        priceStdDev: Math.round(stdDev),
        depthScore,
        liquidityAssessment,
        pricingConfidence,
        priceDistribution: buckets,
        priceGap,
        sweetSpot,
        outlierCount,
      });
    }

    // Sort by depthScore desc (deepest first)
    rows.sort((a, b) => b.depthScore - a.depthScore);

    // 5) Summary
    const totalCategories = rows.length;
    const deepMarkets = rows.filter(r => r.depthScore >= 70).length;
    const thinMarkets = rows.filter(r => r.depthScore < 40).length;
    const safestCategory = rows[0]?.category ?? null;
    const riskiestCategory = rows[rows.length - 1]?.category ?? null;

    let advice: string;
    if (totalCategories === 0) {
      advice =
        'Ni kategorij za analizo — dodaš oglase z veljavno ceno za začetek.';
    } else if (deepMarkets > thinMarkets) {
      advice = `Trg je GLOBALNO GLOBOK — ${deepMarkets} od ${totalCategories} kategorij z visoko likvidnostjo. Varno trguj v "${safestCategory}" (depth ${rows[0]?.depthScore}/100).`;
    } else if (thinMarkets > deepMarkets) {
      advice = `Trg je GLOBALNO TANKO — ${thinMarkets} od ${totalCategories} kategorij z nizko likvidnostjo. Bodi previden pri cenah v "${riskiestCategory}" (depth ${rows[rows.length - 1]?.depthScore}/100).`;
    } else {
      advice = `Trg je MEŠAN — ${deepMarkets} globokih, ${thinMarkets} tankih od ${totalCategories} kategorij. Fokusiraj na "${safestCategory}" za najbolj zanesljivo ceno.`;
    }

    return NextResponse.json({
      ok: true,
      categories: rows,
      summary: {
        totalCategories,
        deepMarkets,
        thinMarkets,
        safestCategory,
        riskiestCategory,
        advice,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-depth-analyzer',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
