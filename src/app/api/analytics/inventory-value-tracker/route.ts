// v7.81: Inventory Value Tracker — track-a VREDNOTE HELD inventarja skozi
// čas — ali inventar aprecira, deprecira ali je stabilen. Monitor-a
// unrealized gains/losses in value trends. "Inventory value: 4500€ invested,
// 5200€ estValue (+15.6% unrealized). Elektronika appreciating +22%. Avto
// depreciating -5%."
//
// Razlika od inventory-value-predictor (v7.73, ki napove future value) — ta
// track-a CURRENT value z unrealized gains in appreciation status per item.
// Razlika od inventory-roi-optimizer (v7.79, ki optimira ROI) — ta gleda
// VREDNOST inventarja (appreciation/depreciation) z value aging buckets.
// Razlika od inventory-profitability-analyzer (ki gleda profitabilnost
// kategorij) — ta track-a VALUE HELD inventarja z valueChangeRate €/day.
// Razlika od inventory-profit-maximizer (ki maksimizira profit) — ta gleda
// UNREALIZED VALUE spremembe in appreciation rate. Razlika od
// inventory-profit-margin-tracker (ki track-a margin) — ta gleda VALUE
// appreciations z aging buckets. Razlika od inventory-lifecycle-stage-
// classifier (v7.70, ki klasificira lifecycle stage) — ta track-a VALUE
// change rate €/day in appreciation status. Razlika od
// inventory-insurance-calculator (ki računa insurance) — ta gleda VALUE
// TREND z unrealized gain/loss in byCategory appreciation rank. Razlika od
// inventory-aging-tracker (ki gleda aging) — ta gleda VALUE spremembe v
// aging buckets z appreciation rate. Razlika od
// inventory-depreciation-tracker (ki track-a depreciation) — ta gleda
// APPRECIATION + DEPRECIATION z unrealized gain/loss in byCategory.
//
// Pure DB analytics (NO AI). GET /api/analytics/inventory-value-tracker

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type AppreciationStatus = 'APPRECIATING' | 'FLAT' | 'DEPRECIATING';

interface PortfolioValue {
  totalItems: number;
  totalBuyPrice: number;
  totalEstValue: number;
  totalUnrealizedGain: number;
  totalUnrealizedGainPercent: number;
  avgDaysHeld: number;
  avgValueChangeRate: number; // €/day
}

interface ItemValue {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  currentEstValue: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
  daysHeld: number;
  valueChangeRate: number; // €/day
  appreciationStatus: AppreciationStatus;
}

interface CategoryValue {
  category: string;
  itemCount: number;
  totalBuyPrice: number;
  totalEstValue: number;
  avgUnrealizedGainPercent: number;
  appreciationRank: number; // 1 = best appreciating
}

interface ValueTrend {
  appreciatingItems: number;
  depreciatingItems: number;
  flatItems: number;
  appreciationRate: number; // %
}

interface AgeBucketValue {
  ageBucket: string;
  itemCount: number;
  totalEstValue: number;
  avgUnrealizedGainPercent: number;
}

interface ValueInsights {
  bestAppreciatingCategory: string | null;
  worstDepreciatingCategory: string | null;
  valueAdvice: string;
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

// Classify appreciation status based on unrealized gain %
// Threshold: |gain %| < 2 = FLAT (within noise), else APPRECIATING/DEPRECIATING
function classifyAppreciation(gainPercent: number): AppreciationStatus {
  if (gainPercent > 2) return 'APPRECIATING';
  if (gainPercent < -2) return 'DEPRECIATING';
  return 'FLAT';
}

function ageBucketOf(daysHeld: number): string {
  if (daysHeld < 7) return '<7d';
  if (daysHeld < 30) return '7-30d';
  if (daysHeld < 60) return '30-60d';
  if (daysHeld < 90) return '60-90d';
  return '90d+';
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();

    // 1) Query all HELD trades with their linked Listing (for aiEstimatedValue)
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
    });

    // 2) Compute per-item value tracking
    const items: ItemValue[] = [];
    for (const t of heldTrades) {
      const buyPrice = t.buyPrice ?? 0;
      if (buyPrice <= 0) continue;

      const aiEstValue = t.listing?.aiEstimatedValue ?? null;
      // currentEstValue = aiEstimatedValue (or buyPrice fallback)
      const currentEstValue =
        aiEstValue != null && aiEstValue > 0 ? aiEstValue : buyPrice;

      const unrealizedGain = round0(currentEstValue - buyPrice);
      const unrealizedGainPercent =
        buyPrice > 0
          ? round1((unrealizedGain / buyPrice) * 100)
          : 0;

      const buyMs = toMs(t.buyDate);
      const daysHeld = buyMs > 0 ? daysBetween(buyMs, now) : 0;
      const valueChangeRate =
        daysHeld > 0 ? round1(unrealizedGain / daysHeld) : 0;
      const appreciationStatus = classifyAppreciation(unrealizedGainPercent);

      const category =
        (t.category || t.listing?.monitor?.source || '')
          .trim()
          .toLowerCase() || 'neznan';

      items.push({
        tradeId: t.id,
        title: t.title.slice(0, 100),
        category,
        buyPrice: round0(buyPrice),
        currentEstValue: round0(currentEstValue),
        unrealizedGain,
        unrealizedGainPercent,
        daysHeld,
        valueChangeRate,
        appreciationStatus,
      });
    }

    const totalItems = items.length;

    // Empty state
    if (totalItems === 0) {
      return NextResponse.json({
        ok: true,
        portfolio: {
          totalItems: 0,
          totalBuyPrice: 0,
          totalEstValue: 0,
          totalUnrealizedGain: 0,
          totalUnrealizedGainPercent: 0,
          avgDaysHeld: 0,
          avgValueChangeRate: 0,
        },
        perItem: [],
        byCategory: [],
        valueTrend: {
          appreciatingItems: 0,
          depreciatingItems: 0,
          flatItems: 0,
          appreciationRate: 0,
        },
        valueByAge: [],
        insights: {
          bestAppreciatingCategory: null,
          worstDepreciatingCategory: null,
          valueAdvice:
            'Ni HELD inventarja — Inventory Value Tracker ni mogoč.',
        },
        message:
          'Ni HELD inventarja — Inventory Value Tracker ni mogoč.',
      });
    }

    // 3) Portfolio value metrics
    const totalBuyPrice = round0(
      items.reduce((s, i) => s + i.buyPrice, 0),
    );
    const totalEstValue = round0(
      items.reduce((s, i) => s + i.currentEstValue, 0),
    );
    const totalUnrealizedGain = round0(totalEstValue - totalBuyPrice);
    const totalUnrealizedGainPercent =
      totalBuyPrice > 0
        ? round1((totalUnrealizedGain / totalBuyPrice) * 100)
        : 0;
    const avgDaysHeld =
      totalItems > 0
        ? round1(items.reduce((s, i) => s + i.daysHeld, 0) / totalItems)
        : 0;
    const avgValueChangeRate =
      totalItems > 0
        ? round1(items.reduce((s, i) => s + i.valueChangeRate, 0) / totalItems)
        : 0;

    const portfolio: PortfolioValue = {
      totalItems,
      totalBuyPrice,
      totalEstValue,
      totalUnrealizedGain,
      totalUnrealizedGainPercent,
      avgDaysHeld,
      avgValueChangeRate,
    };

    // 4) Per-category value tracking
    interface CatAgg {
      category: string;
      itemCount: number;
      totalBuyPrice: number;
      totalEstValue: number;
      gainPercentSum: number;
    }
    const catMap = new Map<string, CatAgg>();
    for (const it of items) {
      let c = catMap.get(it.category);
      if (!c) {
        c = {
          category: it.category,
          itemCount: 0,
          totalBuyPrice: 0,
          totalEstValue: 0,
          gainPercentSum: 0,
        };
        catMap.set(it.category, c);
      }
      c.itemCount += 1;
      c.totalBuyPrice += it.buyPrice;
      c.totalEstValue += it.currentEstValue;
      c.gainPercentSum += it.unrealizedGainPercent;
    }

    const byCategory: CategoryValue[] = Array.from(catMap.values()).map(
      (c) => ({
        category: c.category,
        itemCount: c.itemCount,
        totalBuyPrice: round0(c.totalBuyPrice),
        totalEstValue: round0(c.totalEstValue),
        avgUnrealizedGainPercent:
          c.itemCount > 0 ? round1(c.gainPercentSum / c.itemCount) : 0,
        appreciationRank: 0,
      }),
    );

    // Sort by avgUnrealizedGainPercent desc and assign rank
    byCategory.sort(
      (a, b) => b.avgUnrealizedGainPercent - a.avgUnrealizedGainPercent,
    );
    byCategory.forEach((c, i) => {
      c.appreciationRank = i + 1;
    });

    // 5) Value trend (appreciation vs depreciation counts)
    const appreciatingItems = items.filter(
      (i) => i.appreciationStatus === 'APPRECIATING',
    ).length;
    const depreciatingItems = items.filter(
      (i) => i.appreciationStatus === 'DEPRECIATING',
    ).length;
    const flatItems = items.filter(
      (i) => i.appreciationStatus === 'FLAT',
    ).length;
    const appreciationRate =
      totalItems > 0
        ? round1((appreciatingItems / totalItems) * 100)
        : 0;

    const valueTrend: ValueTrend = {
      appreciatingItems,
      depreciatingItems,
      flatItems,
      appreciationRate,
    };

    // 6) Value aging (by age bucket)
    const ageBuckets = ['<7d', '7-30d', '30-60d', '60-90d', '90d+'];
    const ageMap = new Map<
      string,
      {
        itemCount: number;
        totalEstValue: number;
        gainPercentSum: number;
      }
    >();
    for (const b of ageBuckets) {
      ageMap.set(b, { itemCount: 0, totalEstValue: 0, gainPercentSum: 0 });
    }
    for (const it of items) {
      const bucket = ageBucketOf(it.daysHeld);
      const a = ageMap.get(bucket);
      if (!a) continue;
      a.itemCount += 1;
      a.totalEstValue += it.currentEstValue;
      a.gainPercentSum += it.unrealizedGainPercent;
    }

    const valueByAge: AgeBucketValue[] = ageBuckets
      .map((bucket) => {
        const a = ageMap.get(bucket)!;
        return {
          ageBucket: bucket,
          itemCount: a.itemCount,
          totalEstValue: round0(a.totalEstValue),
          avgUnrealizedGainPercent:
            a.itemCount > 0 ? round1(a.gainPercentSum / a.itemCount) : 0,
        };
      })
      .filter((b) => b.itemCount > 0);

    // 7) Insights
    const bestAppreciatingCategory =
      byCategory.length > 0 &&
      byCategory[0].avgUnrealizedGainPercent > 0
        ? byCategory[0].category
        : null;
    const worstDepreciatingCategory =
      byCategory.length > 0 &&
      byCategory[byCategory.length - 1].avgUnrealizedGainPercent < 0
        ? byCategory[byCategory.length - 1].category
        : null;

    const valueAdvice = (() => {
      const parts: string[] = [];
      const gainSign = totalUnrealizedGain >= 0 ? '+' : '';
      parts.push(
        `Inventory value: ${totalBuyPrice}€ invested, ${totalEstValue}€ estValue (${gainSign}${totalUnrealizedGainPercent}% unrealized).`,
      );
      parts.push(
        `${appreciatingItems} aprecira, ${depreciatingItems} deprecira, ${flatItems} flat (appreciation rate ${appreciationRate}%).`,
      );
      if (bestAppreciatingCategory) {
        const best = byCategory.find(
          (c) => c.category === bestAppreciatingCategory,
        );
        if (best) {
          parts.push(
            `Best: ${bestAppreciatingCategory} (${best.avgUnrealizedGainPercent > 0 ? '+' : ''}${best.avgUnrealizedGainPercent}% unrealized).`,
          );
        }
      }
      if (worstDepreciatingCategory) {
        const worst = byCategory.find(
          (c) => c.category === worstDepreciatingCategory,
        );
        if (worst) {
          parts.push(
            `Worst: ${worstDepreciatingCategory} (${worst.avgUnrealizedGainPercent}% unrealized).`,
          );
        }
      }
      if (totalUnrealizedGain < 0) {
        parts.push(
          'Portfolio deprecira — razmisli o hitri prodaji ali rebalancingu.',
        );
      } else if (appreciationRate > 60) {
        parts.push(
          'Močna apreciacija — hold inventar za višje dobičke.',
        );
      } else if (avgDaysHeld > 60 && totalUnrealizedGainPercent < 5) {
        parts.push(
          'Dolgi hold time z nizko apreciacijo — razmisli o hitrejšem turnoverju.',
        );
      }
      return parts.join(' ');
    })();

    const insights: ValueInsights = {
      bestAppreciatingCategory,
      worstDepreciatingCategory,
      valueAdvice,
    };

    return NextResponse.json({
      ok: true,
      portfolio,
      perItem: items.slice(0, 100), // top 100 by value (all held items)
      byCategory,
      valueTrend,
      valueByAge,
      insights,
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/inventory-value-tracker',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
