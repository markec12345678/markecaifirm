// v7.50: Quick Sell Price Ladder — 3 price tiers for instant listing.
//
// Generira 3 cene za takojšnjo objavo:
// - FAST (7d, 70% sell prob) — hitra prodaja, manjši profit
// - BALANCED (14d, 50% sell prob) — optimalno
// - PATIENT (30d, 30% sell prob) — max profit, dlje čaka
//
// POST /api/ai/quick-sell-ladder
// Body: { tradeId: string }
// Returns: { ok, ladder: { fast, balanced, patient }, recommendation }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { tradeId } = body;
    if (!tradeId) return NextResponse.json({ error: 'tradeId je obvezen' }, { status: 400 });

    const trade = await db.trade.findUnique({
      where: { id: String(tradeId) },
      select: {
        id: true, title: true, category: true, buyPrice: true, buyFees: true, buyDate: true, status: true,
        listing: { select: { aiEstimatedValue: true, dealScore: true } },
      },
    });
    if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
    if (trade.status !== 'held') return NextResponse.json({ error: 'Trade ni held — ni za prodajo' }, { status: 400 });

    const totalCost = trade.buyPrice + (trade.buyFees ?? 0);
    const estValue = trade.listing?.aiEstimatedValue ?? Math.round(totalCost * 1.25);
    const daysHeld = Math.floor((Date.now() - new Date(trade.buyDate).getTime()) / 86400000);

    // Get category avg sell price + avg hold from history
    const soldInCategory = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null }, sellDate: { not: null }, category: trade.category || undefined },
      select: { buyPrice: true, sellPrice: true, buyDate: true, sellDate: true },
      take: 30,
    });

    const catAvgMarkup = soldInCategory.length > 0
      ? soldInCategory.reduce((s, t) => s + ((t.sellPrice! - t.buyPrice) / t.buyPrice), 0) / soldInCategory.length
      : 0.25; // default 25% markup
    const catAvgHoldDays = soldInCategory.length > 0
      ? Math.round(soldInCategory.reduce((s, t) => s + ((new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86400000), 0) / soldInCategory.length)
      : 21;

    // Build 3-tier ladder
    const fastPrice = Math.round(estValue * 0.85); // 15% under est
    const balancedPrice = Math.round(estValue * 0.95); // 5% under est
    const patientPrice = Math.round(estValue * 1.05); // 5% over est

    const ladder = {
      fast: {
        priceEur: fastPrice,
        profitEur: fastPrice - totalCost,
        profitPct: totalCost > 0 ? Math.round(((fastPrice - totalCost) / totalCost) * 100) : 0,
        expectedDays: 7,
        sellProbabilityPct: 75,
        strategy: 'Hitra prodaja — nizka cena, visoka verjetnost',
        bestFor: '急需 cash / zastara',
      },
      balanced: {
        priceEur: balancedPrice,
        profitEur: balancedPrice - totalCost,
        profitPct: totalCost > 0 ? Math.round(((balancedPrice - totalCost) / totalCost) * 100) : 0,
        expectedDays: 14,
        sellProbabilityPct: 50,
        strategy: 'Optimalno — ravnovesje cena/čas',
        bestFor: 'Default — večina item-ov',
      },
      patient: {
        priceEur: patientPrice,
        profitEur: patientPrice - totalCost,
        profitPct: totalCost > 0 ? Math.round(((patientPrice - totalCost) / totalCost) * 100) : 0,
        expectedDays: 30,
        sellProbabilityPct: 30,
        strategy: 'Maksimalni profit — daljši čakalni čas',
        bestFor: 'Redki item-i, visoka povpraševanja',
      },
    };

    // Recommendation based on days held + category
    let recommendedTier: 'fast' | 'balanced' | 'patient' = 'balanced';
    let reason = '';
    if (daysHeld > 45) {
      recommendedTier = 'fast';
      reason = `${daysHeld}d v inventarju — prodajaj HITRO (FAST ${fastPrice}€) za sprostitev capital.`;
    } else if (daysHeld > 30) {
      recommendedTier = 'balanced';
      reason = `${daysHeld}d — BALANCED (${balancedPrice}€) je optimalno. Ne čakaj predolgo.`;
    } else if (daysHeld <= 7 && trade.listing?.dealScore && trade.listing.dealScore > 80) {
      recommendedTier = 'patient';
      reason = `Fresh + visok deal score — PATIENT (${patientPrice}€) za max profit. Lahko čakaš.`;
    } else {
      recommendedTier = 'balanced';
      reason = `BALANCED (${balancedPrice}€) — optimalno za ${daysHeld}d hold. Avg kategorija: ${catAvgHoldDays}d, markup ${Math.round(catAvgMarkup * 100)}%.`;
    }

    return NextResponse.json({
      ok: true,
      trade: { id: trade.id, title: trade.title, buyPrice: totalCost, estValue, daysHeld, category: trade.category },
      ladder,
      recommendedTier,
      reason,
      categoryStats: { avgHoldDays: catAvgHoldDays, avgMarkupPct: Math.round(catAvgMarkup * 100), sampleSize: soldInCategory.length },
    });
  } catch (err: any) {
    logger.error('/api/ai/quick-sell-ladder', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
