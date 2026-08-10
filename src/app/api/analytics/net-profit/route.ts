// v7.43: Net Profit Calculator — dobiček po slovenskem davku.
//
// Slovenian tax law for capital gains (preprodaja):
// - 5.000€ neoporečno dobička na leto
// - Nad 5.000€: 40% dohodnina
// - Izgube se prenašajo do 3 let nazaj in naprej
// - Držanje >3 leta: 1/3 znižanja davka (za nekatera sredstva)
//
// GET /api/analytics/net-profit?year=2026
// Returns: { ok, gross: { profit, invested, revenue },
//   tax: { allowance, taxableBase, rate, amount, lossCarryforward },
//   net: { profit, effectiveRate },
//   monthly: [{ month, grossProfit, cumulativeTax, netProfit }],
//   recommendation }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAX_FREE_ALLOWANCE = 5000;
const TAX_RATE = 0.40;
const LOSS_CARRYFORWARD_YEARS = 3;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year')) || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    // Get all sold trades in the year
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: yearStart, lte: yearEnd, not: null },
      },
      select: {
        buyPrice: true, buyFees: true, sellPrice: true, sellFees: true,
        sellDate: true, title: true, category: true,
      },
    });

    // Get losses from previous years (for carryforward)
    const carryforwardStart = new Date(year - LOSS_CARRYFORWARD_YEARS, 0, 1);
    const prevLosses: Array<{ year: number; loss: number }> = [];
    for (let y = year - 1; y >= year - LOSS_CARRYFORWARD_YEARS; y--) {
      const prevSold = await db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: { gte: new Date(y, 0, 1), lte: new Date(y, 11, 31, 23, 59, 59), not: null },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
      });
      const prevProfit = prevSold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
      if (prevProfit < 0) {
        prevLosses.push({ year: y, loss: Math.abs(Math.round(prevProfit)) });
      }
    }

    const totalLossCarryforward = prevLosses.reduce((s, l) => s + l.loss, 0);

    // Compute gross profit
    const totalProfit = soldTrades.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const totalInvested = soldTrades.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0);

    // Tax calculation
    // 1. Subtract loss carryforward
    let taxableBase = totalProfit - totalLossCarryforward;
    if (taxableBase < 0) taxableBase = 0;

    // 2. Subtract tax-free allowance
    const allowanceUsed = Math.min(TAX_FREE_ALLOWANCE, taxableBase);
    const taxableAfterAllowance = Math.max(0, taxableBase - TAX_FREE_ALLOWANCE);

    // 3. Apply tax rate
    const taxAmount = Math.round(taxableAfterAllowance * TAX_RATE);
    const netProfit = Math.round(totalProfit - taxAmount);
    const effectiveRate = totalProfit > 0 ? Math.round((taxAmount / totalProfit) * 100) : 0;

    // Monthly breakdown
    const monthly: Array<{ month: number; monthName: string; grossProfit: number; cumulativeGross: number; cumulativeTax: number; netProfit: number }> = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];
    let cumulativeGross = 0;
    let cumulativeTaxable = 0;

    for (let m = 0; m < 12; m++) {
      const monthSold = soldTrades.filter(t => new Date(t.sellDate!).getMonth() === m);
      const monthProfit = monthSold.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
      cumulativeGross += monthProfit;

      // Recalculate tax up to this month
      let monthlyTaxable = cumulativeGross - totalLossCarryforward;
      if (monthlyTaxable < 0) monthlyTaxable = 0;
      const monthlyAllowance = Math.min(TAX_FREE_ALLOWANCE, monthlyTaxable);
      const monthlyTaxableAfter = Math.max(0, monthlyTaxable - TAX_FREE_ALLOWANCE);
      const monthlyTax = Math.round(monthlyTaxableAfter * TAX_RATE);

      monthly.push({
        month: m,
        monthName: monthNames[m],
        grossProfit: Math.round(monthProfit),
        cumulativeGross: Math.round(cumulativeGross),
        cumulativeTax: monthlyTax,
        netProfit: Math.round(cumulativeGross - monthlyTax),
      });
    }

    // Recommendation
    let recommendation = '';
    if (totalProfit < 0) {
      recommendation = `❌ Leto v izgubi (${totalProfit}€). Izgubo prenesi naprej — zmanjša dohodnino v naslednjih ${LOSS_CARRYFORWARD_YEARS} letih.`;
    } else if (totalProfit <= TAX_FREE_ALLOWANCE) {
      recommendation = `✅ Dobiček ${totalProfit}€ je znotraj neoporečnega limita (${TAX_FREE_ALLOWANCE}€). Brez davka! Net profit = gross profit.`;
    } else if (totalLossCarryforward > 0) {
      recommendation = `📊 Dobiček ${totalProfit}€, a prenesene izgube ${totalLossCarryforward}€ zmanjšujejo osnovo. Davčna osnova: ${taxableBase}€. Davek: ${taxAmount}€. Net: ${netProfit}€.`;
    } else {
      const remainingAllowance = TAX_FREE_ALLOWANCE - allowanceUsed;
      recommendation = `💰 Dobiček ${totalProfit}€ — nad neoporečnim limitom. Davek: ${taxAmount}€ (40% nad ${TAX_FREE_ALLOWANCE}€). Net profit: ${netProfit}€ (effective rate: ${effectiveRate}%).`;
      if (remainingAllowance > 0) {
        recommendation += ` Še ${remainingAllowance}€ neoporečnega prostora do konca leta.`;
      }
    }

    return NextResponse.json({
      ok: true,
      year,
      gross: {
        profit: Math.round(totalProfit),
        invested: Math.round(totalInvested),
        revenue: Math.round(totalRevenue),
        roiPct: totalInvested > 0 ? Math.round((totalProfit / totalInvested) * 100) : 0,
        soldCount: soldTrades.length,
      },
      tax: {
        allowance: TAX_FREE_ALLOWANCE,
        allowanceUsed: Math.round(allowanceUsed),
        lossCarryforward: totalLossCarryforward,
        lossCarryforwardYears: prevLosses,
        taxableBase: Math.round(taxableBase),
        taxableAfterAllowance: Math.round(taxableAfterAllowance),
        rate: TAX_RATE * 100,
        amount: taxAmount,
      },
      net: {
        profit: netProfit,
        effectiveRate: effectiveRate,
      },
      monthly,
      recommendation,
    });
  } catch (err: any) {
    logger.error('/api/analytics/net-profit', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
