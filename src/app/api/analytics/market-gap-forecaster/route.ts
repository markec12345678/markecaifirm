// v7.71: Market Gap Forecaster — projektira katere market gap-ovi
// (nedosljedno pokrite kategorije/cena razponi) se bodo POJAVILI v naslednjih
// 30-60 dneh. Razlika od market-gap-finder (ki najde TRENUTNE gap-ove) — ta
// NAPOVE prihodnje gap-ove glede na rast povpraševanja vs. trend oskrbe.
// Pure DB analytics — NO AI.
//
// "Elektronika 250-500€: EMERGING gap (demand +15%/wk, supply -5%/wk).
//  30d projection: gap 85. BUY opportunity."
//
// Razlika od market-gap-finder (ki najde trenutne prazne niše) — ta PROJICIRA
// kdaj bodo nove niše postale prazne v prihodnosti (forecast). Razlika od
// market-saturation-forecaster (ki napoveduje nasičenost trga) — ta gleda
// DEMAND vs SUPPLY razliko v kategorijah in cenovnih razponih. Razlika od
// market-depth-analyzer (ki meri globino trga) — ta napoveduje prihodnje
// priložnosti kjer bo povprašanje preseglo oskrbo. Razlika od
// profit-margin-heatmap (ki prikazuje margine) — ta napoveduje EMERGING
// priložnosti v katerih je najbolj vredno vstopiti.
//
// Pure DB analytics (NO AI). GET /api/analytics/market-gap-forecaster

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type TrendType = 'INCREASING' | 'STABLE' | 'DECREASING';
type GapStatus = 'EMERGING' | 'STABLE' | 'CLOSING';

interface CurrentGap {
  demandScore: number;
  supplyScore: number;
  gapScore: number;
  weeklyDemand: number;
  weeklySupply: number;
}

interface TrendInfo {
  demandTrend: TrendType;
  supplyTrend: TrendType;
  gapTrend: number; // positive = growing, negative = shrinking
}

interface Forecast {
  projected30dGapScore: number;
  projected60dGapScore: number;
  gapStatus: GapStatus;
  timeToEmergingGap: number | null; // weeks until gap > threshold
}

interface PriceRangeGap {
  range: string;
  demandCount: number;
  supplyCount: number;
  gapScore: number;
}

interface CategoryForecast {
  category: string;
  current: CurrentGap;
  trends: TrendInfo;
  forecast: Forecast;
  priceRangeGaps: PriceRangeGap[];
}

interface Summary {
  totalCategories: number;
  emergingGaps: number;
  closingGaps: number;
  bestEmergingGap: string | null;
  advice: string;
}

// --- Helpers -------------------------------------------------------------

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 90;
const HISTORY_WEEKS = 13; // ~90 days
const GAP_THRESHOLD = 50; // gapScore above which a market is considered an opportunity

// Price range buckets
const PRICE_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: '0-50€', min: 0, max: 50 },
  { name: '50-100€', min: 50, max: 100 },
  { name: '100-250€', min: 100, max: 250 },
  { name: '250-500€', min: 250, max: 500 },
  { name: '500-1000€', min: 500, max: 1000 },
  { name: '1000-2500€', min: 1000, max: 2500 },
  { name: '2500€+', min: 2500, max: Number.MAX_SAFE_INTEGER },
];

function deriveTrend(slope: number): TrendType {
  if (slope > 0.5) return 'INCREASING';
  if (slope < -0.5) return 'DECREASING';
  return 'STABLE';
}

// Linear slope of values (week-over-week).
function computeSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = values.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (values[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function deriveGapStatus(
  gapTrend: number,
  projected30dGapScore: number,
): GapStatus {
  // EMERGING: gap is growing AND projected to exceed threshold
  if (gapTrend > 0.5 && projected30dGapScore > GAP_THRESHOLD) return 'EMERGING';
  // CLOSING: gap is shrinking
  if (gapTrend < -0.5) return 'CLOSING';
  return 'STABLE';
}

// Compute weeks until gap exceeds threshold (linear extrapolation).
function computeTimeToEmerging(
  currentGap: number,
  gapTrend: number,
): number | null {
  if (currentGap >= GAP_THRESHOLD) return 0; // already emerging
  if (gapTrend <= 0) return null; // never reaches threshold
  const remaining = GAP_THRESHOLD - currentGap;
  return Math.max(1, Math.ceil(remaining / gapTrend));
}

interface WeeklyAgg {
  supply: number;
  demand: number;
}

function priceRangeOf(price: number | null | undefined): string {
  if (price == null || price <= 0) return 'neznan';
  for (const r of PRICE_RANGES) {
    if (price >= r.min && price < r.max) {
      return r.name;
    }
  }
  return 'neznan';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query listings from last 90 days, with demand signals
    const cutoff = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: cutoff },
        isHidden: false,
      },
      select: {
        id: true,
        title: true,
        price: true,
        firstSeenAt: true,
        isBookmarked: true,
        contactStatus: true,
        monitor: { select: { source: true } },
      },
      take: 50000,
    });

    // Empty state
    if (listings.length === 0) {
      return NextResponse.json({
        ok: true,
        categories: [],
        summary: {
          totalCategories: 0,
          emergingGaps: 0,
          closingGaps: 0,
          bestEmergingGap: null,
          advice:
            'Ni listing-ov v zadnjih 90 dneh — Market Gap Forecast ni mogoč. Aktiviraj monitorje za začetek nabave podatkov.',
        },
        message:
          'Ni listing-ov v zadnjih 90 dneh — Market Gap Forecast ni mogoč.',
      });
    }

    const nowMs = Date.now();

    // 2) Map listings to categories — listings don't have a category, so we use
    //    linked trades' categories (best-fit) and fall back to monitor source.
    const tradesForCats = await db.trade.findMany({
      where: { category: { not: '' } },
      select: {
        listingId: true,
        category: true,
      },
      take: 10000,
    });
    const listingCatMap = new Map<string, string>();
    for (const t of tradesForCats) {
      if (t.listingId && t.category) {
        // First-write wins; category is unlikely to differ across trades of same listing
        if (!listingCatMap.has(t.listingId)) {
          listingCatMap.set(t.listingId, t.category.toLowerCase());
        }
      }
    }

    // 3) Group listings by category × week + per price-range demand signals
    const byCatWeek = new Map<string, WeeklyAgg[]>();
    const byCatPrice = new Map<
      string,
      Map<string, { supply: number; demand: number }>
    >();

    for (const l of listings) {
      const tradeCat = l.id ? listingCatMap.get(l.id) : undefined;
      const monSource =
        (l.monitor?.source || '').trim().toLowerCase() || 'neznan';
      const category = tradeCat || `vir:${monSource}`;

      const seenMs = new Date(l.firstSeenAt).getTime();
      if (!Number.isFinite(seenMs)) continue;
      const ageDays = (nowMs - seenMs) / DAY_MS;
      if (ageDays < 0) continue;
      const weekIdx = Math.min(
        HISTORY_WEEKS - 1,
        Math.max(0, Math.floor(ageDays / 7)),
      );
      const reverseWeek = HISTORY_WEEKS - 1 - weekIdx; // 0 = oldest, 12 = newest

      let arr = byCatWeek.get(category);
      if (!arr) {
        arr = Array.from({ length: HISTORY_WEEKS }, () => ({
          supply: 0,
          demand: 0,
        }));
        byCatWeek.set(category, arr);
      }
      const slot = arr[reverseWeek];
      if (slot) {
        slot.supply += 1;
        if (l.isBookmarked || (l.contactStatus && l.contactStatus !== 'none')) {
          slot.demand += 1;
        }
      }

      // Per price range
      const rangeName = priceRangeOf(l.price);
      let priceMap = byCatPrice.get(category);
      if (!priceMap) {
        priceMap = new Map();
        byCatPrice.set(category, priceMap);
      }
      const cur = priceMap.get(rangeName) || { supply: 0, demand: 0 };
      cur.supply += 1;
      if (l.isBookmarked || (l.contactStatus && l.contactStatus !== 'none')) {
        cur.demand += 1;
      }
      priceMap.set(rangeName, cur);
    }

    // 4) For each category: compute current gap, trends, forecast
    const categoryForecasts: CategoryForecast[] = [];

    for (const [category, weeklyArr] of byCatWeek.entries()) {
      const supplyArr = weeklyArr.map(w => w.supply);
      const demandArr = weeklyArr.map(w => w.demand);

      const demandSlope = computeSlope(demandArr);
      const supplySlope = computeSlope(supplyArr);

      const demandTrend = deriveTrend(demandSlope);
      const supplyTrend = deriveTrend(supplySlope);
      const gapTrend = demandSlope - supplySlope;

      // Current weekly avg (last 4 weeks)
      const recentDemand =
        demandArr.slice(-4).reduce((s, v) => s + v, 0) / 4;
      const recentSupply =
        supplyArr.slice(-4).reduce((s, v) => s + v, 0) / 4;

      const currentDemandScore = Math.round(recentDemand * 10) / 10;
      const currentSupplyScore = Math.round(recentSupply * 10) / 10;
      const currentGapScore =
        Math.round((recentDemand / (recentSupply + 1)) * 10 * 10) / 10;

      // Forecast: 4 weeks out (30d) and 8 weeks out (60d)
      const projected30dDemand = Math.max(0, recentDemand + demandSlope * 4);
      const projected30dSupply = Math.max(0, recentSupply + supplySlope * 4);
      const projected30dGapScore =
        Math.round(
          (projected30dDemand / (projected30dSupply + 1)) * 10 * 10,
        ) / 10;

      const projected60dDemand = Math.max(0, recentDemand + demandSlope * 8);
      const projected60dSupply = Math.max(0, recentSupply + supplySlope * 8);
      const projected60dGapScore =
        Math.round(
          (projected60dDemand / (projected60dSupply + 1)) * 10 * 10,
        ) / 10;
      // Suppress unused warnings (projected60d demand/supply are inputs to gapScore)
      void projected60dDemand;
      void projected60dSupply;

      const gapStatus = deriveGapStatus(gapTrend, projected30dGapScore);
      const timeToEmergingGap = computeTimeToEmerging(
        currentGapScore,
        gapTrend,
      );

      // Per price-range gaps within this category
      const priceMap = byCatPrice.get(category);
      const priceRangeGaps: PriceRangeGap[] = [];
      if (priceMap) {
        for (const r of PRICE_RANGES) {
          const d = priceMap.get(r.name);
          if (!d) continue;
          const gapScore =
            Math.round((d.demand / (d.supply + 1)) * 10 * 10) / 10;
          if (d.supply > 0 || d.demand > 0) {
            priceRangeGaps.push({
              range: r.name,
              demandCount: d.demand,
              supplyCount: d.supply,
              gapScore,
            });
          }
        }
        priceRangeGaps.sort((a, b) => b.gapScore - a.gapScore);
      }

      categoryForecasts.push({
        category,
        current: {
          demandScore: currentDemandScore,
          supplyScore: currentSupplyScore,
          gapScore: currentGapScore,
          weeklyDemand: currentDemandScore,
          weeklySupply: currentSupplyScore,
        },
        trends: {
          demandTrend,
          supplyTrend,
          gapTrend: Math.round(gapTrend * 100) / 100,
        },
        forecast: {
          projected30dGapScore,
          projected60dGapScore,
          gapStatus,
          timeToEmergingGap,
        },
        priceRangeGaps: priceRangeGaps.slice(0, 7),
      });
    }

    // Sort: best emerging gaps first (EMERGING first, then highest projected30dGapScore)
    categoryForecasts.sort((a, b) => {
      const statusOrder: Record<GapStatus, number> = {
        EMERGING: 0,
        STABLE: 1,
        CLOSING: 2,
      };
      const sa = statusOrder[a.forecast.gapStatus];
      const sb = statusOrder[b.forecast.gapStatus];
      if (sa !== sb) return sa - sb;
      return b.forecast.projected30dGapScore - a.forecast.projected30dGapScore;
    });

    // Summary
    const emergingGaps = categoryForecasts.filter(
      c => c.forecast.gapStatus === 'EMERGING',
    ).length;
    const closingGaps = categoryForecasts.filter(
      c => c.forecast.gapStatus === 'CLOSING',
    ).length;
    const bestEmergingGap =
      emergingGaps > 0 ? categoryForecasts[0]?.category ?? null : null;

    let advice: string;
    if (categoryForecasts.length === 0) {
      advice =
        'Ni dovolj podatkov za napoved market gap-ov. Aktiviraj monitorje in dodaj trade-e s kategorijami za boljšo analizo.';
    } else if (emergingGaps === 0) {
      advice =
        'Trenutno ni emerging gap-ov. Vse kategorije so stabilne ali se zapirajo — počakaj na spremembo trenda ali diverzificiraj v nove vire.';
    } else {
      const top = categoryForecasts[0];
      advice = top
        ? `Top priložnost: "${top.category}" — projected 30d gap score ${top.forecast.projected30dGapScore}, status ${top.forecast.gapStatus}. Demand trend: ${top.trends.demandTrend}, supply trend: ${top.trends.supplyTrend}. Preusmeri kapital v to kategorijo za izkoristek emerging gap-a.`
        : 'Ni emerging gap-ov.';
    }

    const summary: Summary = {
      totalCategories: categoryForecasts.length,
      emergingGaps,
      closingGaps,
      bestEmergingGap,
      advice,
    };

    return NextResponse.json({
      ok: true,
      categories: categoryForecasts,
      summary,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/market-gap-forecaster',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
