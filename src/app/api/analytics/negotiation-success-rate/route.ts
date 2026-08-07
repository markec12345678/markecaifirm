// v7.65: Negotiation Success Rate Analyzer — analizira zgodovinske izide
// pogajanj in izračuna success rate glede na kategorijo, cenovni razpon,
// offer depth in vrsto prodajalca.
//
// "Elektronika: 65% success rate pri 10% popusta. Avto: 30% success rate.
//  Optimal offer: 5-15% below asking — 72% accept rate."
//
// Razlika od negotiation-outcome-predictor (ki pred pošiljanjem ponudbe AI
// napove ACCEPT/COUNTER/REJECT verjetnosti za EN oglas) — ta ANALIZIRA
// ZGODOVINO vseh tvojih pogajanj in izračuna aggregate success rate po
// kategorijah, cenovnih razponih in offer depth-ih. Razlika od negotiation-
// playbook (ki generira strategijo za eno pogajanje) — ta da DATA-DRIVEN
// insight o tem, kje tvoja pogajanja dejansko delujejo.
//
// Pure DB analytics (NO AI). GET /api/analytics/negotiation-success-rate

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Types ---------------------------------------------------------------

interface ByCategoryRow {
  category: string;
  totalNegotiated: number;
  successRate: number; // %
  avgDiscount: number; // %
  avgSavingsEur: number;
}

interface ByPriceRangeRow {
  range: string; // "0-100€", "100-500€", "500€+"
  totalNegotiated: number;
  successRate: number;
  avgDiscount: number;
}

interface ByOfferDepthRow {
  depth: string; // "0-5%", "5-15%", "15-30%", "30%+"
  totalOffered: number;
  successRate: number;
  avgCounterPrice: number | null;
}

interface BySellerTypeRow {
  type: 'RECURRING' | 'ONE_TIME';
  totalNegotiated: number;
  successRate: number;
  avgDiscount: number;
}

// --- Helpers -------------------------------------------------------------

const PRICE_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-100€', min: 0, max: 100 },
  { label: '100-500€', min: 100, max: 500 },
  { label: '500€+', min: 500, max: Number.POSITIVE_INFINITY },
];

const OFFER_DEPTHS: Array<{ label: string; min: number; max: number }> = [
  { label: '0-5%', min: 0, max: 5 },
  { label: '5-15%', min: 5, max: 15 },
  { label: '15-30%', min: 15, max: 30 },
  { label: '30%+', min: 30, max: Number.POSITIVE_INFINITY },
];

function priceRangeLabel(buyPrice: number): string | null {
  for (const r of PRICE_RANGES) {
    if (buyPrice >= r.min && buyPrice < r.max) return r.label;
  }
  return null;
}

function offerDepthLabel(discountPct: number): string | null {
  for (const d of OFFER_DEPTHS) {
    if (discountPct >= d.min && discountPct < d.max) return d.label;
  }
  return null;
}

// --- Handler -------------------------------------------------------------

export async function GET() {
  try {
    // 1) Query all trades with linked Listing (to access asking price + sellerName)
    const trades = await db.trade.findMany({
      where: {
        buyPrice: { gt: 0 },
        status: { in: ['sold', 'cancelled', 'held'] },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        status: true,
        listing: {
          select: {
            id: true,
            price: true,
            sellerName: true,
            contactStatus: true,
          },
        },
      },
      take: 5000,
    });

    // Empty state — no trades at all
    if (trades.length === 0) {
      return NextResponse.json({
        ok: true,
        overall: {
          totalNegotiations: 0,
          successRate: 0,
          avgDiscountAchieved: 0,
          avgSavingsEur: 0,
          bestCategory: null,
          bestPriceRange: null,
        },
        byCategory: [],
        byPriceRange: [],
        byOfferDepth: [],
        bySellerType: [],
        recommendations: {
          optimalOfferDepth: null,
          easiestCategory: null,
          hardestCategory: null,
          advice:
            'Ni trade-ov — dodaj nakupe z asking ceno (prek linked Listing) za analizo pogajanj.',
        },
        message:
          'Ni trade-ov — Negotiation Success Rate Analyzer potrebuje trades z linked Listing-om za asking ceno.',
      });
    }

    // 2) Build per-trade metrics
    // Asking price: prefer linked Listing.price, fallback to aiEstimatedValue,
    // if neither then we cannot classify as "negotiated" (treat asking = buyPrice).
    interface TradeMetric {
      tradeId: string;
      category: string;
      buyPrice: number;
      askingPrice: number | null;
      discountPct: number; // (asking - buy) / asking × 100, 0 if no asking
      savingsEur: number; // asking - buy
      isNegotiated: boolean; // asking > buy (i.e., we got discount)
      status: 'sold' | 'cancelled' | 'held';
      sellerName: string | null;
      success: boolean; // negotiated AND sold (held = in progress, not counted)
      failed: boolean; // negotiated AND cancelled
    }

    const metrics: TradeMetric[] = [];
    for (const t of trades) {
      const asking =
        t.listing?.price ??
        (t.buyPrice > 0 ? null : null); // null if no asking known
      // If no linked listing and no asking price known, askingPrice = null
      // (we'll skip these for discount calculations)
      const category = (t.category || 'drugo').trim().toLowerCase() || 'drugo';
      const buyPrice = t.buyPrice;
      const sellerName = t.listing?.sellerName ?? null;
      const contactStatus = t.listing?.contactStatus ?? 'none';

      // Asking price = linked listing price; if absent, skip (no negotiation data)
      if (asking == null || asking <= 0) {
        // No asking price available — skip from negotiated analysis
        // but include if contactStatus = 'contacted'/'responded'/'closed'
        if (contactStatus !== 'none') {
          metrics.push({
            tradeId: t.id,
            category,
            buyPrice,
            askingPrice: null,
            discountPct: 0,
            savingsEur: 0,
            isNegotiated: false,
            status: t.status as 'sold' | 'cancelled' | 'held',
            sellerName,
            success: false,
            failed: t.status === 'cancelled',
          });
        }
        continue;
      }

      const savingsEur = asking - buyPrice;
      const discountPct = asking > 0 ? (savingsEur / asking) * 100 : 0;
      const isNegotiated = savingsEur > 0; // strictly below asking
      const status = t.status as 'sold' | 'cancelled' | 'held';
      // "Success" = negotiated down AND eventually sold (held is in progress, doesn't count)
      const success = isNegotiated && status === 'sold';
      const failed = status === 'cancelled'; // any cancelled trade is a failure

      metrics.push({
        tradeId: t.id,
        category,
        buyPrice,
        askingPrice: asking,
        discountPct,
        savingsEur,
        isNegotiated,
        status,
        sellerName,
        success,
        failed,
      });
    }

    // 3) Overall metrics — only trades where asking price is known (negotiation possible)
    const negotiable = metrics.filter(m => m.askingPrice != null && m.askingPrice > 0);
    const negotiated = negotiable.filter(m => m.isNegotiated);
    const totalNegotiations = negotiated.length;

    if (totalNegotiations === 0) {
      // We have trades but none with linked listing (so no asking prices known)
      return NextResponse.json({
        ok: true,
        overall: {
          totalNegotiations: 0,
          successRate: 0,
          avgDiscountAchieved: 0,
          avgSavingsEur: 0,
          bestCategory: null,
          bestPriceRange: null,
        },
        byCategory: [],
        byPriceRange: [],
        byOfferDepth: [],
        bySellerType: [],
        recommendations: {
          optimalOfferDepth: null,
          easiestCategory: null,
          hardestCategory: null,
          advice:
            'Trades-ovi nimajo povezanih Listing-ov z asking ceno — poveži trades z originalnimi oglasi za analizo pogajanj.',
        },
        message:
          'Trades-ovi nimajo linked Listing-ov — asking cena ni znana, Negotiation Success Rate analiza ni mogoča.',
      });
    }

    const successes = negotiated.filter(m => m.success).length;
    const successRate = Math.round((successes / totalNegotiations) * 100);
    const avgDiscountAchieved = Math.round(
      (negotiated.reduce((s, m) => s + m.discountPct, 0) / totalNegotiations) * 10,
    ) / 10;
    const avgSavingsEur = Math.round(
      negotiated.reduce((s, m) => s + m.savingsEur, 0) / totalNegotiations,
    );

    // 4) By category — only categories with >= 2 negotiated trades
    const catAgg = new Map<
      string,
      { total: number; successes: number; discountSum: number; savingsSum: number }
    >();
    for (const m of negotiated) {
      const cur = catAgg.get(m.category) || {
        total: 0,
        successes: 0,
        discountSum: 0,
        savingsSum: 0,
      };
      cur.total += 1;
      if (m.success) cur.successes += 1;
      cur.discountSum += m.discountPct;
      cur.savingsSum += m.savingsEur;
      catAgg.set(m.category, cur);
    }
    const byCategory: ByCategoryRow[] = Array.from(catAgg.entries())
      .filter(([, d]) => d.total >= 1)
      .map(([category, d]) => ({
        category,
        totalNegotiated: d.total,
        successRate: Math.round((d.successes / d.total) * 100),
        avgDiscount: Math.round((d.discountSum / d.total) * 10) / 10,
        avgSavingsEur: Math.round(d.savingsSum / d.total),
      }))
      .sort((a, b) => b.successRate - a.successRate);

    const bestCategory =
      byCategory.length > 0 && byCategory[0].totalNegotiated >= 2
        ? byCategory[0].category
        : null;

    // 5) By price range
    const rangeAgg = new Map<
      string,
      { total: number; successes: number; discountSum: number }
    >();
    for (const m of negotiated) {
      const range = priceRangeLabel(m.buyPrice);
      if (!range) continue;
      const cur = rangeAgg.get(range) || {
        total: 0,
        successes: 0,
        discountSum: 0,
      };
      cur.total += 1;
      if (m.success) cur.successes += 1;
      cur.discountSum += m.discountPct;
      rangeAgg.set(range, cur);
    }
    const byPriceRange: ByPriceRangeRow[] = Array.from(rangeAgg.entries())
      .map(([range, d]) => ({
        range,
        totalNegotiated: d.total,
        successRate: Math.round((d.successes / d.total) * 100),
        avgDiscount: Math.round((d.discountSum / d.total) * 10) / 10,
      }))
      .sort((a, b) => b.successRate - a.successRate);
    const bestPriceRange =
      byPriceRange.length > 0 && byPriceRange[0].totalNegotiated >= 2
        ? byPriceRange[0].range
        : null;

    // 6) By offer depth (how much below asking the offer was)
    // For this we look at ALL negotiated trades (regardless of outcome)
    // since "offer depth" is what we offered, not whether it succeeded
    const depthAgg = new Map<
      string,
      { total: number; successes: number; counterPriceSum: number; counterCount: number }
    >();
    for (const m of negotiated) {
      const depth = offerDepthLabel(m.discountPct);
      if (!depth) continue;
      const cur = depthAgg.get(depth) || {
        total: 0,
        successes: 0,
        counterPriceSum: 0,
        counterCount: 0,
      };
      cur.total += 1;
      if (m.success) cur.successes += 1;
      // If sold, the buyPrice is effectively the "counter" or accepted price
      if (m.status === 'sold') {
        cur.counterPriceSum += m.buyPrice;
        cur.counterCount += 1;
      }
      depthAgg.set(depth, cur);
    }
    const byOfferDepth: ByOfferDepthRow[] = OFFER_DEPTHS.map(d => {
      const agg = depthAgg.get(d.label);
      if (!agg || agg.total === 0) {
        return {
          depth: d.label,
          totalOffered: 0,
          successRate: 0,
          avgCounterPrice: null,
        };
      }
      return {
        depth: d.label,
        totalOffered: agg.total,
        successRate: Math.round((agg.successes / agg.total) * 100),
        avgCounterPrice:
          agg.counterCount > 0
            ? Math.round(agg.counterPriceSum / agg.counterCount)
            : null,
      };
    });

    // 7) By seller type — sellers appearing 2+ times = RECURRING
    const sellerCount = new Map<string, number>();
    for (const m of negotiable) {
      if (!m.sellerName) continue;
      sellerCount.set(m.sellerName, (sellerCount.get(m.sellerName) ?? 0) + 1);
    }
    const sellerAgg = new Map<
      'RECURRING' | 'ONE_TIME',
      { total: number; successes: number; discountSum: number }
    >([
      ['RECURRING', { total: 0, successes: 0, discountSum: 0 }],
      ['ONE_TIME', { total: 0, successes: 0, discountSum: 0 }],
    ]);
    for (const m of negotiated) {
      if (!m.sellerName) continue;
      const type: 'RECURRING' | 'ONE_TIME' =
        (sellerCount.get(m.sellerName) ?? 0) >= 2 ? 'RECURRING' : 'ONE_TIME';
      const cur = sellerAgg.get(type)!;
      cur.total += 1;
      if (m.success) cur.successes += 1;
      cur.discountSum += m.discountPct;
    }
    const bySellerType: BySellerTypeRow[] = (
      ['RECURRING', 'ONE_TIME'] as const
    ).map(type => {
      const d = sellerAgg.get(type)!;
      if (d.total === 0) {
        return {
          type,
          totalNegotiated: 0,
          successRate: 0,
          avgDiscount: 0,
        };
      }
      return {
        type,
        totalNegotiated: d.total,
        successRate: Math.round((d.successes / d.total) * 100),
        avgDiscount: Math.round((d.discountSum / d.total) * 10) / 10,
      };
    });

    // 8) Recommendations
    // Optimal offer depth = highest success rate among depths with >= 2 total
    const depthWithStats = byOfferDepth.filter(d => d.totalOffered >= 2);
    const optimalDepth =
      depthWithStats.length > 0
        ? [...depthWithStats].sort((a, b) => b.successRate - a.successRate)[0].depth
        : null;
    const easiestCategory = bestCategory;
    // Hardest category = lowest success rate with >= 2 trades
    const hardestCategoryRow = byCategory
      .filter(c => c.totalNegotiated >= 2)
      .sort((a, b) => a.successRate - b.successRate)[0];
    const hardestCategory = hardestCategoryRow?.category ?? null;

    const adviceParts: string[] = [];
    if (optimalDepth) {
      const depthRow = byOfferDepth.find(d => d.depth === optimalDepth);
      adviceParts.push(
        `Optimal offer depth: ${optimalDepth} below asking (${depthRow?.successRate ?? 0}% accept rate, ${depthRow?.totalOffered ?? 0} trades).`,
      );
    }
    if (easiestCategory) {
      const catRow = byCategory.find(c => c.category === easiestCategory);
      adviceParts.push(
        `Najlažja kategorija za pogajanja: ${easiestCategory} (${catRow?.successRate ?? 0}% success rate).`,
      );
    }
    if (hardestCategory) {
      const catRow = byCategory.find(c => c.category === hardestCategory);
      adviceParts.push(
        `Najtežja kategorija: ${hardestCategory} (${catRow?.successRate ?? 0}% success rate) — ponudbe z nižjim popustom ali izogibaj se.`,
      );
    }
    if (adviceParts.length === 0) {
      adviceParts.push(
        `Skupno ${totalNegotiations} pogajanj, ${successRate}% success rate, avg popust ${avgDiscountAchieved}%.`,
      );
    }
    const advice = adviceParts.join(' ');

    return NextResponse.json({
      ok: true,
      overall: {
        totalNegotiations,
        successRate,
        avgDiscountAchieved,
        avgSavingsEur,
        bestCategory,
        bestPriceRange,
      },
      byCategory,
      byPriceRange,
      byOfferDepth,
      bySellerType,
      recommendations: {
        optimalOfferDepth: optimalDepth,
        easiestCategory,
        hardestCategory,
        advice,
      },
    });
  } catch (err: any) {
    logger.error(
      '/api/analytics/negotiation-success-rate',
      'GET handler failed',
      err,
    );
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
