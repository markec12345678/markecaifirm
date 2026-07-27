// v6.4: Refurbishment ROI Calculator — ali se splača investirati v popravilo?
// POST /api/trades/refurb-roi
// Body: { tradeId?: string, buyPrice?, estimatedRefurbCost, refurbDescription?, estimatedPostRefurbValue? }
// Returns: { ok, roi: { refurbCost, postRefurbValue, profitWithoutRefurb, profitWithRefurb, refurbROI, recommendation } }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let buyPrice: number;
    let currentEstimatedValue: number | null = null;
    let title = '';
    let category = '';

    if (body?.tradeId) {
      const trade = await db.trade.findUnique({
        where: { id: body.tradeId },
        select: { buyPrice: true, title: true, category: true,
          listing: { select: { aiEstimatedValue: true } } },
      });
      if (!trade) return NextResponse.json({ error: 'Trade ne obstaja' }, { status: 404 });
      buyPrice = trade.buyPrice;
      title = trade.title;
      category = trade.category || '';
      currentEstimatedValue = trade.listing?.aiEstimatedValue ?? null;
    } else {
      buyPrice = Number(body?.buyPrice) || 0;
      title = body?.title || '';
      category = body?.category || '';
    }

    const refurbCost = Number(body?.refurbCost) || 0;
    const refurbDescription = body?.refurbDescription || '';
    const postRefurbValue = Number(body?.postRefurbValue) || 0;
    const sellWithoutRefurb = Number(body?.sellWithoutRefurb) || (currentEstimatedValue ?? Math.round(buyPrice * 1.15));

    if (buyPrice <= 0) return NextResponse.json({ error: 'Kupna cena mora biti > 0' }, { status: 400 });
    if (refurbCost <= 0) return NextResponse.json({ error: 'Strošek popravila mora biti > 0' }, { status: 400 });

    // Platform fees (Bolha: 5% + 0.50€)
    const platformFee = (price: number) => price > 50 ? price * 0.05 + 0.5 : price * 0.05;
    const shipping = 5;
    const packaging = 1;

    // Without refurb
    const totalCostWithout = buyPrice + platformFee(buyPrice) + shipping + packaging;
    const revenueWithout = sellWithoutRefurb - platformFee(sellWithoutRefurb);
    const profitWithout = revenueWithout - totalCostWithout;
    const marginWithoutPct = buyPrice > 0 ? Math.round((profitWithout / buyPrice) * 100) : 0;

    // With refurb
    const totalCostWith = totalCostWithout + refurbCost;
    const revenueWith = postRefurbValue - platformFee(postRefurbValue);
    const profitWith = revenueWith - totalCostWith;
    const marginWithPct = buyPrice > 0 ? Math.round((profitWith / buyPrice) * 100) : 0;

    // Refurb ROI
    const additionalProfit = profitWith - profitWithout;
    const refurbROI = refurbCost > 0 ? Math.round((additionalProfit / refurbCost) * 100) : 0;
    const valueIncrease = postRefurbValue - sellWithoutRefurb;
    const valueIncreasePct = sellWithoutRefurb > 0 ? Math.round((valueIncrease / sellWithoutRefurb) * 100) : 0;

    // Tax (40% dohodnina)
    const tax = Math.max(0, profitWith * 0.40);
    const netAfterTax = profitWith - tax;

    // Recommendation
    let recommendation: string;
    let recommendationLevel: 'good' | 'marginal' | 'bad';
    if (refurbROI > 100 && additionalProfit > 0) {
      recommendation = `🔥 ODLIČNO — investicija ${refurbCost}€ prinaša ${additionalProfit.toFixed(0)}€ dodatnega dobička (ROI ${refurbROI}%)`;
      recommendationLevel = 'good';
    } else if (refurbROI > 50 && additionalProfit > 0) {
      recommendation = `✅ DOBRO — popravilo se splača (${refurbROI}% ROI, +${additionalProfit.toFixed(0)}€ dobička)`;
      recommendationLevel = 'good';
    } else if (additionalProfit > 0) {
      recommendation = `⚠️ MARGINALNO — majhen dodatni dobiček (${additionalProfit.toFixed(0)}€, ROI ${refurbROI}%)`;
      recommendationLevel = 'marginal';
    } else {
      recommendation = `🔴 NE SE SPLAČA — popravilo zniža dobiček za ${Math.abs(additionalProfit).toFixed(0)}€`;
      recommendationLevel = 'bad';
    }

    // Common refurbishment scenarios
    const scenarios = [
      { type: 'Baterija (telefon)', cost: 30, desc: 'Zamenjava baterije pri telefonu' },
      { type: 'Zaslon (telefon)', cost: 80, desc: 'Zamenjava zaslona' },
      { type: 'Čiščenje+kosmetika', cost: 15, desc: 'Profesionalno čiščenje in kozmetika' },
      { type: 'Servis (avto)', cost: 200, desc: 'Redni servis vozila' },
      { type: 'Obnova pohištva', cost: 50, desc: 'Brušenje in lakiranje' },
      { type: 'Popravilo elektronike', cost: 25, desc: 'Zamenjava kondenzatorjev/DC jack' },
    ];

    return NextResponse.json({
      ok: true,
      roi: {
        title,
        category,
        buyPrice,
        refurbCost,
        refurbDescription,
        sellWithoutRefurb,
        postRefurbValue,
        valueIncrease,
        valueIncreasePct,
        profitWithout: Math.round(profitWithout),
        profitWith: Math.round(profitWith),
        additionalProfit: Math.round(additionalProfit),
        marginWithoutPct,
        marginWithPct,
        refurbROI,
        netAfterTax: Math.round(netAfterTax),
        tax: Math.round(tax),
        recommendation,
        recommendationLevel,
        costs: {
          platformFeeBuy: Math.round(platformFee(buyPrice) * 100) / 100,
          platformFeeSell: Math.round(platformFee(postRefurbValue) * 100) / 100,
          shipping,
          packaging,
          refurbCost,
          totalWithout: Math.round(totalCostWithout * 100) / 100,
          totalWith: Math.round(totalCostWith * 100) / 100,
        },
        scenarios,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
