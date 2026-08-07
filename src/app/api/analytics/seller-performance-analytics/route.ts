// v7.77: Seller Performance Analytics — celovita analiza prodajalcev, s
// katerimi si posloval — njihova zanesljivost, cenovni vzorci, kakovost
// deal-ov in tvoja profit zgodovina z njimi. Pure DB analytics — NO AI.
// "Top seller: Elektro Marjan (PLATINUM, 12 deals, 85% success, 3200€
// profit). Most generous: Modna Kraljica (18% avg discount)."
//
// Razlika od supplier-crm (ki je CRM za stalne dobavitelje z osnovnimi
// metrikami) — ta da RELIABILITY TIERS (PLATINUM/GOLD/SILVER/BRONZE) +
// PRICING BEHAVIOR (FIRM/FLEXIBLE/GENEROUS) + PROFITABILITY SCORE 0-100.
// Razlika od reseller-blackbook (ki gleda top sellerje per listing) — ta
// gleda TVOJE deal-e s sellerji in success rate. Razlika od
// competitor-tracker (ki sledi supplier-jem kot konkurenci) — ta analizira
// TVOJE odnose s prodajalci. Razlika od seller-trust-score-v2 (AI score
// zaupanja posameznemu sellerju) — ta je AGGREGATE analytics čez vse
// prodajalce z ranked tiers. Razlika od seller-reliability-v2 (AI
// napoved zanesljivosti) — ta je descriptivna analiza zgodovine deal-ov.
//
// Pure DB analytics (NO AI). GET /api/analytics/seller-performance-analytics

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

type ReliabilityTier = 'PLATINUM' | 'GOLD' | 'SILVER' | 'BRONZE';
type PricingBehavior = 'FIRM' | 'FLEXIBLE' | 'GENEROUS';

interface SellerStats {
  sellerName: string;
  totalDeals: number;
  totalSpent: number;
  totalProfit: number;
  avgDealScore: number;
  avgDiscount: number; // %
  avgHoldDays: number;
  successRate: number; // %
  firstDealDate: string; // ISO
  lastDealDate: string; // ISO
  categories: string[];
  reliabilityTier: ReliabilityTier;
  profitabilityScore: number; // 0-100
  pricingBehavior: PricingBehavior;
}

interface SellerComparison {
  bestSeller: { name: string; score: number } | null;
  mostReliableSeller: { name: string; rate: number } | null;
  mostGenerousSeller: { name: string; discount: number } | null;
}

interface SellerSummary {
  totalSellers: number;
  platinumCount: number;
  goldCount: number;
  silverCount: number;
  bronzeCount: number;
  totalSpentAll: number;
  totalProfitAll: number;
  advice: string;
}

interface CategorySeller {
  category: string;
  sellerCount: number;
  topSeller: string | null;
  totalProfit: number;
  avgSuccessRate: number;
}

// --- Helpers -------------------------------------------------------------

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round0(v: number): number {
  return Math.round(v);
}

function toISO(d: Date | null | undefined): string {
  if (!d) return '';
  try {
    return new Date(d as unknown as Date | string).toISOString();
  } catch {
    return '';
  }
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

// Classify reliability tier based on deals count + success rate
function classifyTier(
  totalDeals: number,
  successRate: number,
): ReliabilityTier {
  if (totalDeals >= 5 && successRate >= 80) return 'PLATINUM';
  if (totalDeals >= 3 && successRate >= 60) return 'GOLD';
  if (totalDeals >= 2) return 'SILVER';
  return 'BRONZE';
}

// Classify pricing behavior based on avg discount %
function classifyPricingBehavior(avgDiscount: number): PricingBehavior {
  if (avgDiscount >= 15) return 'GENEROUS';
  if (avgDiscount >= 5) return 'FLEXIBLE';
  return 'FIRM';
}

// Compute profitability score 0-100 based on profit + success rate
function profitabilityScore(
  totalProfit: number,
  successRate: number,
  totalDeals: number,
): number {
  if (totalDeals === 0) return 0;
  // Profit component: log scale, 1000€ profit → 50pts, 100€ → 30, 0 → 0, -100 → 0
  const profitComponent =
    totalProfit > 0
      ? Math.min(50, Math.max(0, Math.log10(totalProfit + 1) * 15))
      : 0;
  // Success rate component: 0..50 pts
  const successComponent = (successRate / 100) * 50;
  return round0(profitComponent + successComponent);
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all SOLD + HELD trades with linked Listing (for sellerName)
    const trades = await db.trade.findMany({
      where: {
        status: { in: ['sold', 'held'] },
        listing: { isNot: null },
      },
      select: {
        id: true,
        status: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellDate: true,
        sellFees: true,
        listing: {
          select: {
            sellerName: true,
            dealScore: true,
            price: true,
          },
        },
      },
      take: 100000,
    });

    // Filter to trades where we can identify sellerName
    const tradesWithSeller = trades.filter(
      (t) =>
        t.listing?.sellerName &&
        typeof t.listing.sellerName === 'string' &&
        t.listing.sellerName.trim().length > 0,
    );

    // Empty state
    if (tradesWithSeller.length === 0) {
      return NextResponse.json({
        ok: true,
        sellers: [],
        comparison: {
          bestSeller: null,
          mostReliableSeller: null,
          mostGenerousSeller: null,
        },
        summary: {
          totalSellers: 0,
          platinumCount: 0,
          goldCount: 0,
          silverCount: 0,
          bronzeCount: 0,
          totalSpentAll: 0,
          totalProfitAll: 0,
          advice:
            'Ni trade-ov z vezanimi Listing-i (z sellerName) — Seller Performance Analytics ni mogoč. Dodaj Listing-e z izpolnjenim sellerName poljem in jih poveži s Trade-i prek listingId.',
        },
        message:
          'Ni trade-ov z vezanimi Listing-i (z sellerName) — Seller Performance Analytics ni mogoč.',
      });
    }

    // 2) Group by sellerName, compute per-seller aggregates
    interface SellerAgg {
      totalDeals: number;
      totalSpent: number;
      totalProfit: number;
      dealScoreSum: number;
      dealScoreCount: number;
      discountSum: number; // sum of discount %
      discountCount: number;
      holdDaysSum: number;
      holdDaysCount: number;
      successCount: number;
      soldCount: number;
      firstDealMs: number;
      lastDealMs: number;
      categories: Set<string>;
    }

    const sellerAgg = new Map<string, SellerAgg>();

    for (const t of tradesWithSeller) {
      const sellerName = t.listing!.sellerName!.trim();
      const askingPrice = t.listing?.price ?? null;
      const dealScore = t.listing?.dealScore ?? null;
      const buyPrice = t.buyPrice ?? 0;
      const buyFees = t.buyFees ?? 0;
      const sellPrice = t.sellPrice ?? 0;
      const sellFees = t.sellFees ?? 0;
      const buyMs = toMs(t.buyDate);
      const sellMs = toMs(t.sellDate);
      const category = (t.category || '').trim().toLowerCase() || 'neznan';

      let agg = sellerAgg.get(sellerName);
      if (!agg) {
        agg = {
          totalDeals: 0,
          totalSpent: 0,
          totalProfit: 0,
          dealScoreSum: 0,
          dealScoreCount: 0,
          discountSum: 0,
          discountCount: 0,
          holdDaysSum: 0,
          holdDaysCount: 0,
          successCount: 0,
          soldCount: 0,
          firstDealMs: 0,
          lastDealMs: 0,
          categories: new Set<string>(),
        };
        sellerAgg.set(sellerName, agg);
      }

      agg.totalDeals += 1;
      agg.totalSpent += buyPrice + buyFees;
      agg.categories.add(category);

      // Track date range
      if (buyMs > 0) {
        if (agg.firstDealMs === 0 || buyMs < agg.firstDealMs) {
          agg.firstDealMs = buyMs;
        }
        if (agg.lastDealMs === 0 || buyMs > agg.lastDealMs) {
          agg.lastDealMs = buyMs;
        }
      }

      // Profit + success + holdDays (only for SOLD)
      if (t.status === 'sold') {
        agg.soldCount += 1;
        const profit = sellPrice - sellFees - buyPrice - buyFees;
        agg.totalProfit += profit;
        if (profit > 0) agg.successCount += 1;
        if (buyMs > 0 && sellMs > 0) {
          const holdDays = daysBetween(buyMs, sellMs);
          agg.holdDaysSum += holdDays;
          agg.holdDaysCount += 1;
        }
      }

      // DealScore aggregate
      if (dealScore != null && dealScore > 0) {
        agg.dealScoreSum += dealScore;
        agg.dealScoreCount += 1;
      }

      // Discount % = (asking - buy) / asking × 100
      if (askingPrice != null && askingPrice > 0 && buyPrice > 0) {
        const discount = ((askingPrice - buyPrice) / askingPrice) * 100;
        agg.discountSum += discount;
        agg.discountCount += 1;
      }
    }

    // 3) Compute SellerStats array
    const sellers: SellerStats[] = [];
    for (const [sellerName, agg] of sellerAgg.entries()) {
      const successRate =
        agg.soldCount > 0 ? (agg.successCount / agg.soldCount) * 100 : 0;
      const avgDealScore =
        agg.dealScoreCount > 0 ? agg.dealScoreSum / agg.dealScoreCount : 0;
      const avgDiscount =
        agg.discountCount > 0 ? agg.discountSum / agg.discountCount : 0;
      const avgHoldDays =
        agg.holdDaysCount > 0 ? agg.holdDaysSum / agg.holdDaysCount : 0;

      const reliabilityTier = classifyTier(agg.totalDeals, successRate);
      const pricingBehavior = classifyPricingBehavior(avgDiscount);
      const score = profitabilityScore(
        agg.totalProfit,
        successRate,
        agg.totalDeals,
      );

      sellers.push({
        sellerName,
        totalDeals: agg.totalDeals,
        totalSpent: round0(agg.totalSpent),
        totalProfit: round0(agg.totalProfit),
        avgDealScore: round1(avgDealScore),
        avgDiscount: round1(avgDiscount),
        avgHoldDays: round0(avgHoldDays),
        successRate: round1(successRate),
        firstDealDate: agg.firstDealMs > 0 ? new Date(agg.firstDealMs).toISOString() : '',
        lastDealDate: agg.lastDealMs > 0 ? new Date(agg.lastDealMs).toISOString() : '',
        categories: Array.from(agg.categories).sort(),
        reliabilityTier,
        profitabilityScore: score,
        pricingBehavior,
      });
    }

    // Sort sellers by profitabilityScore desc
    sellers.sort((a, b) => b.profitabilityScore - a.profitabilityScore);

    // 4) Comparison metrics
    const bestSeller =
      sellers.length > 0 && sellers[0]!.profitabilityScore > 0
        ? {
            name: sellers[0]!.sellerName,
            score: sellers[0]!.profitabilityScore,
          }
        : null;

    const mostReliableSellers = sellers.filter((s) => s.totalDeals >= 3);
    const mostReliableSeller =
      mostReliableSellers.length > 0
        ? mostReliableSellers.reduce(
            (best, cur) => (cur.successRate > best.successRate ? cur : best),
            mostReliableSellers[0]!,
          )
        : null;
    const mostReliableFormatted = mostReliableSeller
      ? {
          name: mostReliableSeller.sellerName,
          rate: mostReliableSeller.successRate,
        }
      : null;

    const mostGenerousSellers = sellers.filter((s) => s.totalDeals >= 1 && s.avgDiscount > 0);
    const mostGenerousSeller =
      mostGenerousSellers.length > 0
        ? mostGenerousSellers.reduce(
            (best, cur) => (cur.avgDiscount > best.avgDiscount ? cur : best),
            mostGenerousSellers[0]!,
          )
        : null;
    const mostGenerousFormatted = mostGenerousSeller
      ? {
          name: mostGenerousSeller.sellerName,
          discount: mostGenerousSeller.avgDiscount,
        }
      : null;

    const comparison: SellerComparison = {
      bestSeller,
      mostReliableSeller: mostReliableFormatted,
      mostGenerousSeller: mostGenerousFormatted,
    };

    // 5) Per-category seller performance
    const catAgg = new Map<
      string,
      {
        sellerSet: Set<string>;
        totalProfit: number;
        successRateSum: number;
        sellerCountForSuccess: number;
        topSellerName: string | null;
        topSellerProfit: number;
      }
    >();

    for (const s of sellers) {
      for (const cat of s.categories) {
        let c = catAgg.get(cat);
        if (!c) {
          c = {
            sellerSet: new Set<string>(),
            totalProfit: 0,
            successRateSum: 0,
            sellerCountForSuccess: 0,
            topSellerName: null,
            topSellerProfit: -Infinity,
          };
          catAgg.set(cat, c);
        }
        c.sellerSet.add(s.sellerName);
        c.totalProfit += s.totalProfit;
        if (s.totalDeals > 0) {
          c.successRateSum += s.successRate;
          c.sellerCountForSuccess += 1;
        }
        if (s.totalProfit > c.topSellerProfit) {
          c.topSellerProfit = s.totalProfit;
          c.topSellerName = s.sellerName;
        }
      }
    }

    const byCategory: CategorySeller[] = [];
    for (const [category, c] of catAgg.entries()) {
      byCategory.push({
        category,
        sellerCount: c.sellerSet.size,
        topSeller: c.topSellerName,
        totalProfit: round0(c.totalProfit),
        avgSuccessRate:
          c.sellerCountForSuccess > 0
            ? round1(c.successRateSum / c.sellerCountForSuccess)
            : 0,
      });
    }
    byCategory.sort((a, b) => b.totalProfit - a.totalProfit);

    // 6) Summary
    const platinumCount = sellers.filter((s) => s.reliabilityTier === 'PLATINUM').length;
    const goldCount = sellers.filter((s) => s.reliabilityTier === 'GOLD').length;
    const silverCount = sellers.filter((s) => s.reliabilityTier === 'SILVER').length;
    const bronzeCount = sellers.filter((s) => s.reliabilityTier === 'BRONZE').length;
    const totalSpentAll = sellers.reduce((sum, s) => sum + s.totalSpent, 0);
    const totalProfitAll = sellers.reduce((sum, s) => sum + s.totalProfit, 0);

    let advice: string;
    if (sellers.length === 0) {
      advice = 'Ni podatkov o prodajalcih — poveži Trade-e z Listing-i (prek listingId) z izpolnjenim sellerName.';
    } else if (platinumCount > 0) {
      advice = `Imaš ${platinumCount} PLATINUM prodajalcev — prioritiziraj ponovne kupčije pri njih. ${bestSeller ? `Top seller: ${bestSeller.name} (${bestSeller.score}/100 profitability).` : ''}`;
    } else if (goldCount > 0) {
      advice = `Imaš ${goldCount} GOLD prodajalcev — razvij odnose z njimi za PLATINUM tier. ${mostReliableFormatted ? `Najbolj zanesljiv: ${mostReliableFormatted.name} (${mostReliableFormatted.rate}% success).` : ''}`;
    } else if (sellers.length > 0) {
      advice = `Imaš ${sellers.length} prodajalcev, vendar nobenega v PLATINUM/GOLD tier-u. Razmisli o pogostejšem sodelovanju z najboljšimi: ${bestSeller ? `${bestSeller.name} (${bestSeller.score}/100)` : 'ni podatkov'}.`;
    } else {
      advice = 'Dodaj več trade-ov z vezanimi Listing-i z sellerName za boljše analitike.';
    }

    const summary: SellerSummary = {
      totalSellers: sellers.length,
      platinumCount,
      goldCount,
      silverCount,
      bronzeCount,
      totalSpentAll: round0(totalSpentAll),
      totalProfitAll: round0(totalProfitAll),
      advice,
    };

    return NextResponse.json({
      ok: true,
      sellers,
      comparison,
      byCategory,
      summary,
    });
  } catch (err: any) {
    logger.error('/api/analytics/seller-performance-analytics', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
