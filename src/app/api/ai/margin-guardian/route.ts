// v7.49: Profit Margin Guardian — preveri pred nakupom ali je margin dovolj.
//
// Preprečuje slabe nakupe: "margin samo 8% — ne kupi! Išči vsaj 20%."
// Preverja: estValue vs askingPrice, fees, shipping, tax, depreciation risk.
//
// POST /api/ai/margin-guardian
// Body: { listingId: string, offerPrice?: number }
// Returns: { ok, verdict: 'BUY' | 'CAUTION' | 'AVOID', margin, analysis }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MIN_MARGIN_PCT = 20; // minimum acceptable margin
const GOOD_MARGIN_PCT = 35; // good margin
const PLATFORM_FEES: Record<string, { buyFeePct: number; sellFeePct: number }> = {
  bolha: { buyFeePct: 0, sellFeePct: 2 },
  vinted: { buyFeePct: 0, sellFeePct: 5 },
  'mobile-de': { buyFeePct: 0, sellFeePct: 3 },
  kleinanzeigen: { buyFeePct: 0, sellFeePct: 0 },
  avtonet: { buyFeePct: 0, sellFeePct: 0 },
};
const SHIPPING_ESTIMATE = 10; // avg shipping EUR
const DEPRECIATION_RISK_MONTHLY = 3; // 3%/month default

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { listingId } = body;
    const offerPrice = body.offerPrice ? Number(body.offerPrice) : null;
    if (!listingId) return NextResponse.json({ error: 'listingId je obvezen' }, { status: 400 });

    const listing = await db.listing.findUnique({
      where: { id: String(listingId) },
      select: {
        id: true, title: true, price: true, priceText: true,
        aiEstimatedValue: true, aiVerdict: true, aiRisk: true, aiScore: true,
        dealScore: true, sellerName: true, location: true,
        monitor: { select: { source: true } },
      },
    });
    if (!listing) return NextResponse.json({ error: 'Listing ne obstaja' }, { status: 404 });

    const askingPrice = listing.price ?? 0;
    const buyPrice = offerPrice ?? askingPrice;
    if (buyPrice <= 0) return NextResponse.json({ error: 'Cena mora biti > 0' }, { status: 400 });

    const estValue = listing.aiEstimatedValue ?? Math.round(buyPrice * 1.2);
    const source = listing.monitor?.source || 'bolha';
    const fees = PLATFORM_FEES[source] ?? { buyFeePct: 0, sellFeePct: 2 };

    // Compute costs
    const buyFees = Math.round(buyPrice * (fees.buyFeePct / 100));
    const sellPrice = Math.round(estValue * 0.95); // 5% under est for fast sale
    const sellFees = Math.round(sellPrice * (fees.sellFeePct / 100));
    const shipping = SHIPPING_ESTIMATE;
    const totalCost = buyPrice + buyFees + shipping;
    const totalRevenue = sellPrice - sellFees;
    const grossProfit = totalRevenue - totalCost;
    const marginPct = totalCost > 0 ? Math.round((grossProfit / totalCost) * 100) : 0;

    // Risk adjustments
    const aiRisk = listing.aiRisk ?? 5;
    const riskDiscount = aiRisk >= 7 ? 0.85 : aiRisk >= 5 ? 0.92 : 1.0;
    const adjustedProfit = Math.round(grossProfit * riskDiscount);
    const adjustedMarginPct = totalCost > 0 ? Math.round((adjustedProfit / totalCost) * 100) : 0;

    // Verdict
    let verdict: 'BUY' | 'CAUTION' | 'AVOID';
    let reason = '';
    if (adjustedMarginPct >= GOOD_MARGIN_PCT && aiRisk <= 4) {
      verdict = 'BUY';
      reason = `✅ Odlična marge ${adjustedMarginPct}% (nizko tveganje ${aiRisk}/10). Kupi!`;
    } else if (adjustedMarginPct >= MIN_MARGIN_PCT) {
      verdict = 'CAUTION';
      reason = `⚠️ Marge ${adjustedMarginPct}% je nad minimum (${MIN_MARGIN_PCT}%), a tveganje ${aiRisk}/10. Preveri ročno.`;
    } else if (adjustedMarginPct > 0) {
      verdict = 'AVOID';
      reason = `❌ Marge samo ${adjustedMarginPct}% — pod minimum ${MIN_MARGIN_PCT}%. Ne kupi, išči boljše.`;
    } else {
      verdict = 'AVOID';
      reason = `🔴 NEGATIVNA marge (${adjustedMarginPct}%) — izguba! Definitivno ne kupi.`;
    }

    // Warnings
    const warnings: string[] = [];
    if (aiRisk >= 6) warnings.push(`Visoko tveganje (${aiRisk}/10) — morda prevara`);
    if (!listing.aiEstimatedValue) warnings.push('AI ni ocenil vrednosti — marge je groba');
    if (listing.aiVerdict === 'SUMNJIVO') warnings.push('AI je oglas označil kot SUMNJIVO');
    if (marginPct < MIN_MARGIN_PCT && adjustedMarginPct >= MIN_MARGIN_PCT) {
      warnings.push(`Bruto marge ${marginPct}% je pod minimum, a tveganje je nizko`);
    }
    if (estValue < buyPrice) {
      warnings.push(`AI vrednost (${estValue}€) je NIŽJA od cene (${buyPrice}€) — preplačilo!`);
    }

    return NextResponse.json({
      ok: true,
      verdict,
      margin: {
        gross: { profitEur: grossProfit, marginPct },
        adjusted: { profitEur: adjustedProfit, marginPct: adjustedMarginPct },
        breakdown: {
          buyPrice, buyFees, shipping, totalCost,
          sellPrice, sellFees, totalRevenue,
          estValue, askingPrice,
        },
      },
      risk: { aiRisk, aiVerdict: listing.aiVerdict, riskDiscount, dealScore: listing.dealScore },
      warnings,
      reason,
      minMarginPct: MIN_MARGIN_PCT,
      goodMarginPct: GOOD_MARGIN_PCT,
    });
  } catch (err: any) {
    logger.error('/api/ai/margin-guardian', 'POST handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
