// v7.90: Inventory Value Appreciation Tracker — track-a kako VREDNOST
// HELD inventarja APRECIRA ali DEPRECIRA čez čas — ali inventar pridobiva
// vrednost (dobre investicije) ali izgublja vrednost (slabe investicije)?
// Pure DB analytics (NO AI). "Portfolio: +15.6% appreciation (5200€ vs
// 4500€). Elektronika: +22% (collectible). Avto: -5% (depreciating).
// 65% of items appreciating."
//
// Razlika od inventory-value-tracker (v7.81 ki da current snapshot
// unrealized gain/loss) — ta track-a VALUE CHANGES čez čas z monthly
// appreciation rate in byAgeBucket analysis. Razlika od inventory-value-
// predictor (v7.73 ki napove future value) — ta je CURRENT appreciation
// tracking z aging buckets. Razlika od inventory-roi-optimizer (v7.79 ki
// optimira ROI) — ta gleda VALUE appreciation/depreciation ne ROI.
// Razlika od inventory-depreciation-tracker (ki track-a depreciation) —
// ta gleda APPRECIATION + DEPRECIATION z unrealized gain/loss. Razlika od
// inventory-aging-trend-analyzer (v7.88 ki track-a aging trends) — ta gleda
// VALUE trends z collectible/liquidation identification. Razlika od
// profit-margin-trend-analyzer (v7.82 ki track-a margin trends) — ta gleda
// UNREALIZED value changes per HELD item.
//
// GET /api/analytics/inventory-value-appreciation-tracker (Pure DB — NO AI)

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type AppreciationStatus = 'APPRECIATING' | 'FLAT' | 'DEPRECIATING';
type AgeBucketTrend = 'APPRECIATING_MORE' | 'STABLE' | 'DEPRECIATING_MORE';
type AppreciationTrend = 'ACCELERATING' | 'STABLE' | 'DECELERATING';

interface PortfolioAppreciation {
  totalBuyPrice: number;
  totalCurrentEstValue: number;
  totalUnrealizedGain: number;
  portfolioAppreciationPercent: number;
  avgAppreciationRate: number; // monthly %
  appreciatingItemCount: number;
  depreciatingItemCount: number;
  flatItemCount: number;
  appreciationRatio: number; // %
}

interface ItemAppreciation {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  currentEstValue: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
  daysHeld: number;
  appreciationRate: number; // monthly %
  appreciationStatus: AppreciationStatus;
}

interface CategoryAppreciation {
  category: string;
  itemCount: number;
  totalBuyPrice: number;
  totalEstValue: number;
  avgAppreciationPercent: number;
  appreciationRank: number; // 1 = best appreciating
}

interface AgeBucketAppreciation {
  ageBucket: string;
  itemCount: number;
  avgAppreciationPercent: number;
  trend: AgeBucketTrend;
}

interface AppreciationTrendAnalysis {
  recentItemsAppreciation: number; // <30d items avg appreciation %
  olderItemsAppreciation: number; // >60d items avg appreciation %
  appreciationTrend: AppreciationTrend;
}

interface AppreciationInsights {
  bestAppreciatingCategory: string | null;
  worstDepreciatingCategory: string | null;
  collectibleCandidates: string[]; // items appreciating with age
  liquidationCandidates: string[]; // items depreciating
  advice: string;
}

// --- Constants -----------------------------------------------------------

const DAY_MS = 86_400_000;
const APPRECIATION_THRESHOLD = 2; // ±2% = FLAT

// --- Helpers -------------------------------------------------------------

function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toMs(d: Date | null | undefined): number {
  if (!d) return 0;
  try {
    return new Date(d as unknown as Date | string).getTime();
  } catch {
    return 0;
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function classifyAppreciation(gainPercent: number): AppreciationStatus {
  if (gainPercent > APPRECIATION_THRESHOLD) return 'APPRECIATING';
  if (gainPercent < -APPRECIATION_THRESHOLD) return 'DEPRECIATING';
  return 'FLAT';
}

// --- Trade row with linked listing --------------------------------------

interface HeldTradeRow {
  id: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date | null;
  listing: {
    aiEstimatedValue: number | null;
    monitor: { source: string | null } | null;
  } | null;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();

    // 1) Query all HELD trades with linked Listing
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyDate: true,
        listing: {
          select: {
            aiEstimatedValue: true,
            monitor: { select: { source: true } },
          },
        },
      },
      orderBy: { buyDate: 'asc' },
      take: 100000,
    }) as unknown as HeldTradeRow[];

    // 2) Empty state
    if (heldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        portfolio: {
          totalBuyPrice: 0,
          totalCurrentEstValue: 0,
          totalUnrealizedGain: 0,
          portfolioAppreciationPercent: 0,
          avgAppreciationRate: 0,
          appreciatingItemCount: 0,
          depreciatingItemCount: 0,
          flatItemCount: 0,
          appreciationRatio: 0,
        },
        perItem: [],
        byCategory: [],
        byAgeBucket: [],
        trend: {
          recentItemsAppreciation: 0,
          olderItemsAppreciation: 0,
          appreciationTrend: 'STABLE' as AppreciationTrend,
        },
        insights: {
          bestAppreciatingCategory: null,
          worstDepreciatingCategory: null,
          collectibleCandidates: [],
          liquidationCandidates: [],
          advice: 'Ni HELD inventarja — Inventory Value Appreciation Tracker ni mogoč.',
        },
        message: 'Ni HELD inventarja — Inventory Value Appreciation Tracker ni mogoč.',
      });
    }

    // 3) Compute per-item appreciation metrics
    const items: ItemAppreciation[] = [];
    let totalBuyPrice = 0;
    let totalCurrentEstValue = 0;

    for (const t of heldTrades) {
      const buyPrice = t.buyPrice ?? 0;
      const estValue = t.listing?.aiEstimatedValue ?? null;
      // Fallback to buyPrice if no AI estValue
      const currentEstValue = estValue != null && estValue > 0 ? estValue : buyPrice;
      const unrealizedGain = currentEstValue - buyPrice;
      const unrealizedGainPercent = buyPrice > 0 ? (unrealizedGain / buyPrice) * 100 : 0;

      const buyMs = toMs(t.buyDate);
      const daysHeld = buyMs > 0 ? Math.max(1, (now - buyMs) / DAY_MS) : 1;
      // Monthly appreciation rate = unrealizedGainPercent / daysHeld × 30
      const appreciationRate = (unrealizedGainPercent / daysHeld) * 30;

      totalBuyPrice += buyPrice;
      totalCurrentEstValue += currentEstValue;

      items.push({
        tradeId: t.id,
        title: t.title.slice(0, 80),
        category: (t.category || 'neznan').slice(0, 40),
        buyPrice: round2(buyPrice),
        currentEstValue: round2(currentEstValue),
        unrealizedGain: round2(unrealizedGain),
        unrealizedGainPercent: round2(unrealizedGainPercent),
        daysHeld: round0(daysHeld),
        appreciationRate: round2(appreciationRate),
        appreciationStatus: classifyAppreciation(unrealizedGainPercent),
      });
    }

    // 4) Portfolio appreciation metrics
    const totalUnrealizedGain = totalCurrentEstValue - totalBuyPrice;
    const portfolioAppreciationPercent = totalBuyPrice > 0
      ? (totalUnrealizedGain / totalBuyPrice) * 100
      : 0;
    const avgAppreciationRate = avg(items.map((i) => i.appreciationRate));
    const appreciatingItemCount = items.filter((i) => i.appreciationStatus === 'APPRECIATING').length;
    const depreciatingItemCount = items.filter((i) => i.appreciationStatus === 'DEPRECIATING').length;
    const flatItemCount = items.filter((i) => i.appreciationStatus === 'FLAT').length;
    const appreciationRatio = items.length > 0
      ? (appreciatingItemCount / items.length) * 100
      : 0;

    // 5) Per-category appreciation analysis
    const catMap = new Map<string, {
      itemCount: number;
      totalBuyPrice: number;
      totalEstValue: number;
      appreciationPercents: number[];
    }>();
    for (const it of items) {
      const cur = catMap.get(it.category) ?? {
        itemCount: 0,
        totalBuyPrice: 0,
        totalEstValue: 0,
        appreciationPercents: [],
      };
      cur.itemCount += 1;
      cur.totalBuyPrice += it.buyPrice;
      cur.totalEstValue += it.currentEstValue;
      cur.appreciationPercents.push(it.unrealizedGainPercent);
      catMap.set(it.category, cur);
    }

    const byCategory: CategoryAppreciation[] = [];
    for (const [cat, d] of catMap.entries()) {
      byCategory.push({
        category: cat,
        itemCount: d.itemCount,
        totalBuyPrice: round2(d.totalBuyPrice),
        totalEstValue: round2(d.totalEstValue),
        avgAppreciationPercent: round2(avg(d.appreciationPercents)),
        appreciationRank: 0, // set later
      });
    }
    byCategory.sort((a, b) => b.avgAppreciationPercent - a.avgAppreciationPercent);
    byCategory.forEach((c, i) => { c.appreciationRank = i + 1; });

    const bestAppreciatingCategory = byCategory.length > 0 && byCategory[0]!.avgAppreciationPercent > 0
      ? byCategory[0]!.category
      : null;
    // Worst depreciating = last (lowest avgAppreciationPercent, must be negative)
    const worstDepreciatingCategory = byCategory.length > 0 && byCategory[byCategory.length - 1]!.avgAppreciationPercent < 0
      ? byCategory[byCategory.length - 1]!.category
      : null;

    // 6) Appreciation by age bucket
    // Buckets: 0-7d, 7-14d, 14-30d, 30-60d, 60-90d, 90d+
    const ageBuckets = [
      { name: '0-7d', min: 0, max: 7 },
      { name: '7-14d', min: 7, max: 14 },
      { name: '14-30d', min: 14, max: 30 },
      { name: '30-60d', min: 30, max: 60 },
      { name: '60-90d', min: 60, max: 90 },
      { name: '90d+', min: 90, max: Infinity },
    ];
    const byAgeBucket: AgeBucketAppreciation[] = [];
    for (const bucket of ageBuckets) {
      const bucketItems = items.filter((i) => i.daysHeld > bucket.min && i.daysHeld <= bucket.max);
      if (bucketItems.length === 0) continue;
      const avgApprec = avg(bucketItems.map((i) => i.unrealizedGainPercent));
      // trend: are older items appreciating more or less than younger?
      // we'll compute after all buckets are populated
      byAgeBucket.push({
        ageBucket: bucket.name,
        itemCount: bucketItems.length,
        avgAppreciationPercent: round2(avgApprec),
        trend: 'STABLE', // set later
      });
    }

    // Compute bucket trends: do older items appreciate more than younger?
    if (byAgeBucket.length >= 2) {
      const firstBucketApprec = byAgeBucket[0]!.avgAppreciationPercent;
      const lastBucketApprec = byAgeBucket[byAgeBucket.length - 1]!.avgAppreciationPercent;
      for (const b of byAgeBucket) {
        // Compare to first bucket — if older items (this) appreciate more → APPRECIATING_MORE
        if (b.avgAppreciationPercent > firstBucketApprec + 5) b.trend = 'APPRECIATING_MORE';
        else if (b.avgAppreciationPercent < firstBucketApprec - 5) b.trend = 'DEPRECIATING_MORE';
        else b.trend = 'STABLE';
      }
      void lastBucketApprec;
    }

    // 7) Appreciation trend — recent (<30d) vs older (>60d)
    const recentItems = items.filter((i) => i.daysHeld < 30);
    const olderItems = items.filter((i) => i.daysHeld > 60);
    const recentItemsAppreciation = recentItems.length > 0
      ? avg(recentItems.map((i) => i.unrealizedGainPercent))
      : 0;
    const olderItemsAppreciation = olderItems.length > 0
      ? avg(olderItems.map((i) => i.unrealizedGainPercent))
      : recentItemsAppreciation; // fallback if no older items

    let appreciationTrend: AppreciationTrend = 'STABLE';
    const trendDelta = recentItemsAppreciation - olderItemsAppreciation;
    if (trendDelta > 5) appreciationTrend = 'ACCELERATING'; // recent items appreciate more
    else if (trendDelta < -5) appreciationTrend = 'DECELERATING';

    // 8) Insights
    // Collectible candidates: items appreciating with age (>60d AND appreciating)
    const collectibleCandidates: string[] = items
      .filter((i) => i.daysHeld > 60 && i.appreciationStatus === 'APPRECIATING')
      .sort((a, b) => b.unrealizedGainPercent - a.unrealizedGainPercent)
      .slice(0, 5)
      .map((i) => i.title);

    // Liquidation candidates: items depreciating (regardless of age, but flagged if >30d)
    const liquidationCandidates: string[] = items
      .filter((i) => i.appreciationStatus === 'DEPRECIATING' && i.daysHeld > 30)
      .sort((a, b) => a.unrealizedGainPercent - b.unrealizedGainPercent) // most depreciating first
      .slice(0, 5)
      .map((i) => i.title);

    // Sort perItem by unrealizedGainPercent desc
    items.sort((a, b) => b.unrealizedGainPercent - a.unrealizedGainPercent);

    // Advice
    let advice = '';
    if (portfolioAppreciationPercent > 5) {
      advice = `Portfolio APPRECIATING +${round1(portfolioAppreciationPercent)}% (${round0(totalCurrentEstValue)}€ vs ${round0(totalBuyPrice)}€ investiranega). ${round0(appreciationRatio)}% item-ov aprecira`;
      if (bestAppreciatingCategory) advice += `, najboljša kategorija: ${bestAppreciatingCategory}`;
      if (collectibleCandidates.length > 0) advice += `. Collectible kandidati: ${collectibleCandidates.slice(0, 2).join(', ')}`;
      advice += `. Vzdržuj strategijo — portfolio pridobiva vrednost.`;
    } else if (portfolioAppreciationPercent < -5) {
      advice = `Portfolio DEPRECIATING ${round1(portfolioAppreciationPercent)}% (${round0(totalCurrentEstValue)}€ vs ${round0(totalBuyPrice)}€ investiranega). ${round0((depreciatingItemCount / items.length) * 100)}% item-ov izgublja vrednost`;
      if (worstDepreciatingCategory) advice += `, najslabša kategorija: ${worstDepreciatingCategory}`;
      if (liquidationCandidates.length > 0) advice += `. Liquidation kandidati: ${liquidationCandidates.slice(0, 2).join(', ')}`;
      advice += `. Razmisli o prodaji depreciation kandidatov.`;
    } else {
      advice = `Portfolio stabilen: ${round1(portfolioAppreciationPercent)}% appreciation (${round0(totalCurrentEstValue)}€ vs ${round0(totalBuyPrice)}€). ${appreciatingItemCount} aprecira, ${depreciatingItemCount} depreciira. Vzdržuj trenutno strategijo in monitoring.`;
    }

    return NextResponse.json({
      ok: true,
      portfolio: {
        totalBuyPrice: round2(totalBuyPrice),
        totalCurrentEstValue: round2(totalCurrentEstValue),
        totalUnrealizedGain: round2(totalUnrealizedGain),
        portfolioAppreciationPercent: round2(portfolioAppreciationPercent),
        avgAppreciationRate: round2(avgAppreciationRate),
        appreciatingItemCount,
        depreciatingItemCount,
        flatItemCount,
        appreciationRatio: round1(appreciationRatio),
      },
      perItem: items,
      byCategory,
      byAgeBucket,
      trend: {
        recentItemsAppreciation: round2(recentItemsAppreciation),
        olderItemsAppreciation: round2(olderItemsAppreciation),
        appreciationTrend,
      },
      insights: {
        bestAppreciatingCategory,
        worstDepreciatingCategory,
        collectibleCandidates,
        liquidationCandidates,
        advice: advice.slice(0, 500),
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/inventory-value-appreciation-tracker',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
