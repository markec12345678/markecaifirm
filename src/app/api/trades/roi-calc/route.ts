// v6.2: ROI Calculator z vsemi stroški + slovenski davki
// POST /api/trades/roi-calc
// Body: { buyPrice, sellPrice, buyFees?, sellFees?, shipping?, packaging?, repairCosts?, platform: 'bolha'|'vinted'|'other' }
// Returns: { ok, roi: { gross, net, margin, costs, tax, netAfterTax } }

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RoiRequest {
  buyPrice: number;
  sellPrice: number;
  buyFees?: number;
  sellFees?: number;
  shipping?: number;
  packaging?: number;
  repairCosts?: number;
  platform?: 'bolha' | 'vinted' | 'other';
}

export async function POST(req: NextRequest) {
  try {
    const body: RoiRequest = await req.json();
    const buyPrice = Number(body.buyPrice) || 0;
    const sellPrice = Number(body.sellPrice) || 0;

    if (buyPrice <= 0) return NextResponse.json({ error: 'Kupna cena mora biti > 0' }, { status: 400 });
    if (sellPrice <= 0) return NextResponse.json({ error: 'Prodajna cena mora biti > 0' }, { status: 400 });

    // Platform fees
    const platform = body.platform || 'bolha';
    let platformSellFee = 0;
    let platformBuyFee = 0;

    if (platform === 'bolha') {
      // Bolha: 5% + 0.50€ (za items > 50€), brezplačno za < 50€ pri nakupu
      platformSellFee = sellPrice > 50 ? sellPrice * 0.05 + 0.5 : sellPrice * 0.05;
      platformBuyFee = buyPrice > 50 ? buyPrice * 0.05 + 0.5 : buyPrice * 0.05;
    } else if (platform === 'vinted') {
      // Vinted: brez provizije za kupca, prodajalec plača 5-8% (odvisno od kategorije)
      platformSellFee = sellPrice * 0.07; // povprečno
      platformBuyFee = 0;
    }

    const buyFees = body.buyFees ?? platformBuyFee;
    const sellFees = body.sellFees ?? platformSellFee;
    const shipping = body.shipping ?? 5; // default 5€ (Pošta Slovenije)
    const packaging = body.packaging ?? 1; // default 1€
    const repairCosts = body.repairCosts ?? 0;

    // Total costs
    const totalBuyCost = buyPrice + buyFees + shipping + packaging + repairCosts;
    const totalSellCost = sellPrice - sellFees - shipping; // buyer pays shipping, but we pay sell fee
    const grossProfit = sellPrice - buyPrice;
    const netProfit = totalSellCost - totalBuyCost;
    const totalCosts = buyFees + sellFees + shipping + packaging + repairCosts;
    const marginPct = buyPrice > 0 ? Math.round((netProfit / buyPrice) * 100) : 0;

    // Slovenian tax (dohodnina)
    // Pribitki (flipping) se obdavčijo kot drugi dohodek: 40% nad 5.000€ letno
    // Do 5.000€ letno: brez davka (neoporečni del)
    // Za poenostavitev: izračunamo po trenutni stopnji
    const TAX_FREE_ANNUAL = 5000; // letni neoporečni znesek
    const TAX_RATE_LOW = 0; // do 5000€
    const TAX_RATE_HIGH = 0.40; // nad 5000€

    // Predpostavimo: če je profit pozitiven, ga obdavčimo
    // (v realnosti bi morali slediti kumulativni dobiček v letu)
    const taxRate = netProfit > 0 ? TAX_RATE_HIGH : 0; // konservativno
    const tax = Math.max(0, netProfit * taxRate);
    const netAfterTax = netProfit - tax;

    // ROI %
    const roiPct = buyPrice > 0 ? Math.round((netAfterTax / buyPrice) * 100) : 0;

    // Speed indicator (rough estimate)
    const isFastFlip = marginPct < 25; // nizka marža = hitrejši flip
    const isHighMargin = marginPct > 50;

    return NextResponse.json({
      ok: true,
      roi: {
        buyPrice,
        sellPrice,
        grossProfit: Math.round(grossProfit * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        netAfterTax: Math.round(netAfterTax * 100) / 100,
        marginPct,
        roiPct,
        tax: Math.round(tax * 100) / 100,
        taxRate: taxRate * 100,
        costs: {
          buyFees: Math.round(buyFees * 100) / 100,
          sellFees: Math.round(sellFees * 100) / 100,
          shipping,
          packaging,
          repairCosts,
          total: Math.round(totalCosts * 100) / 100,
          totalBuyCost: Math.round(totalBuyCost * 100) / 100,
          totalSellRevenue: Math.round(totalSellCost * 100) / 100,
        },
        platform,
        flipType: isHighMargin ? 'high_margin' : isFastFlip ? 'fast_flip' : 'balanced',
        recommendation: netAfterTax > 0 && marginPct > 15
          ? 'DONOSNO — priporočeno za nakup'
          : netAfterTax > 0
            ? 'MARGINALNO — nizka marža, hitra prodaja potrebna'
            : 'NEDONOSNO — stroški presegajo dobiček',
      },
    });
  } catch (e: any) {
    logger.error("/api/trades/roi-calc", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
