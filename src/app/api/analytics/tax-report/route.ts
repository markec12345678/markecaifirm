// v7.57: Tax Report Generator — letno davčno poročilo za FURS (slovenska davčna uprava).
//
// "Letno davčno poročilo 2026: 8.500€ dobiček, 5.000€ neoporečno,
//  1.400€ davek (40%) — pripravljeno za predajo FURS-u."
//
// Slovenian tax law (preprodaja / capital gains):
// - 5.000€ neoporečno dobička na leto (tax-free allowance)
// - Nad 5.000€: 40% dohodnina (income tax)
// - Izgube se prenašajo do 3 leta (loss carryforward 3 years)
// - Držanje >3 leta (1095 dni): 1/3 znižanja davka → efektivno 26,67%
//
// GET /api/analytics/tax-report?year=2026
// Returns: formal structured tax report in Slovenian (printable).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAX_FREE_ALLOWANCE = 5000;
const TAX_RATE_STANDARD = 0.40;
const TAX_RATE_LONG_TERM = 0.2667; // 1/3 reduction of 40% (effective 26.67%)
const LONG_TERM_HOLD_DAYS = 1095; // 3 years
const LOSS_CARRYFORWARD_YEARS = 3;
const DAY_MS = 86_400_000;

const MONTH_NAMES_SI = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec'];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const year = Number(url.searchParams.get('year')) || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    // 1) All SOLD trades in the specified year
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { gte: yearStart, lte: yearEnd, not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        buyDate: true,
        sellPrice: true,
        sellFees: true,
        sellDate: true,
      },
      orderBy: { sellDate: 'asc' },
      take: 2000,
    });

    // 2) Per-trade computation
    interface TradeRow {
      id: string;
      naslov: string;
      kategorija: string;
      datumNakupa: string;
      datumProdaje: string;
      dniZadrzevanja: number;
      nabavnaCena: number;
      prodajnaCena: number;
      stroški: number;
      dobicek: number;
      dolgorocnoDrzanje: boolean;
    }

    const trgovine: TradeRow[] = [];
    let grossProfit = 0; // sum of positive profits
    let grossLoss = 0; // sum of negative profits (as positive number)
    let longTermCount = 0;

    for (const t of soldTrades) {
      const costBasis = t.buyPrice + (t.buyFees ?? 0);
      const netProceeds = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      const profit = netProceeds - costBasis;
      const fees = (t.buyFees ?? 0) + (t.sellFees ?? 0);

      const buyDateMs = new Date(t.buyDate).getTime();
      const sellDateMs = new Date(t.sellDate!).getTime();
      const holdDays = Math.max(0, Math.round((sellDateMs - buyDateMs) / DAY_MS));
      const isLongTerm = holdDays > LONG_TERM_HOLD_DAYS;

      if (isLongTerm) longTermCount += 1;
      if (profit > 0) grossProfit += profit;
      else if (profit < 0) grossLoss += Math.abs(profit);

      trgovine.push({
        id: t.id,
        naslov: t.title,
        kategorija: t.category || 'drugo',
        datumNakupa: new Date(t.buyDate).toISOString(),
        datumProdaje: new Date(t.sellDate!).toISOString(),
        dniZadrzevanja: holdDays,
        nabavnaCena: Math.round(t.buyPrice),
        prodajnaCena: Math.round(t.sellPrice ?? 0),
        stroški: Math.round(fees),
        dobicek: Math.round(profit),
        dolgorocnoDrzanje: isLongTerm,
      });
    }

    const netProfit = grossProfit - grossLoss;

    // 3) Loss carryforward: query previous 3 years for net losses
    const prevLosses: Array<{ year: number; loss: number }> = [];
    for (let y = year - 1; y >= year - LOSS_CARRYFORWARD_YEARS; y--) {
      const prevSold = await db.trade.findMany({
        where: {
          status: 'sold',
          sellDate: {
            gte: new Date(y, 0, 1),
            lte: new Date(y, 11, 31, 23, 59, 59),
            not: null,
          },
        },
        select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
        take: 2000,
      });
      const prevProfit = prevSold.reduce(
        (s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)),
        0,
      );
      if (prevProfit < 0) {
        prevLosses.push({ year: y, loss: Math.abs(Math.round(prevProfit)) });
      }
    }
    const lossCarryforward = prevLosses.reduce((s, l) => s + l.loss, 0);

    // 4) Tax calculation
    // taxableBase = max(0, netProfit - 5000 - lossCarryforward)
    let taxableBase = netProfit - TAX_FREE_ALLOWANCE - lossCarryforward;
    if (taxableBase < 0) taxableBase = 0;

    // Tax rate: if ALL trades are long-term holdings, use reduced rate.
    // Otherwise use standard 40% (mixed — strict reading of SL law says reduction applies
    // to qualifying assets only; we apply standard rate unless 100% long-term).
    const allLongTerm = trgovine.length > 0 && longTermCount === trgovine.length;
    const taxRate = allLongTerm ? TAX_RATE_LONG_TERM : TAX_RATE_STANDARD;
    const taxAmount = Math.round(taxableBase * taxRate);
    const effectiveRate = netProfit > 0 ? Math.round((taxAmount / netProfit) * 10000) / 100 : 0; // 2 decimals

    // 5) Monthly breakdown (Jan-Dec)
    const mesecniPregled: Array<{
      mesec: string;
      steviloTrgovin: number;
      dobicek: number;
      kumulativniDobicek: number;
      kumulativniDavek: number;
    }> = [];
    let cumulativeProfit = 0;

    for (let m = 0; m < 12; m++) {
      const monthSold = soldTrades.filter(t => new Date(t.sellDate!).getMonth() === m);
      const monthProfit = monthSold.reduce(
        (s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)),
        0,
      );
      cumulativeProfit += monthProfit;

      // Cumulative tax: re-compute from start of year up to this month
      let cumTaxable = cumulativeProfit - TAX_FREE_ALLOWANCE - lossCarryforward;
      if (cumTaxable < 0) cumTaxable = 0;
      const cumTax = Math.round(cumTaxable * taxRate);

      mesecniPregled.push({
        mesec: MONTH_NAMES_SI[m],
        steviloTrgovin: monthSold.length,
        dobicek: Math.round(monthProfit),
        kumulativniDobicek: Math.round(cumulativeProfit),
        kumulativniDavek: cumTax,
      });
    }

    // 6) Per-category breakdown
    const catMap = new Map<string, { count: number; profit: number }>();
    for (const t of trgovine) {
      const cat = t.kategorija || 'drugo';
      const cur = catMap.get(cat) || { count: 0, profit: 0 };
      cur.count += 1;
      cur.profit += t.dobicek;
      catMap.set(cat, cur);
    }
    const totalProfitForShare = Math.abs(netProfit) || 1; // avoid /0
    const poKategorijah = Array.from(catMap.entries())
      .map(([kategorija, d]) => ({
        kategorija,
        steviloTrgovin: d.count,
        dobicek: Math.round(d.profit),
        delezDobicka: Math.round((d.profit / totalProfitForShare) * 1000) / 10, // 1 decimal %
        davek: Math.round(Math.max(0, d.profit) * taxRate),
      }))
      .sort((a, b) => b.dobicek - a.dobicek);

    // 7) Notes (opombe) for the taxpayer
    const opombe: string[] = [];
    opombe.push(
      `Letno poročilo zajema ${soldTrades.length} prodaj v letu ${year}.`,
    );
    if (netProfit <= TAX_FREE_ALLOWANCE && netProfit >= 0) {
      opombe.push(
        `Dobiček ${Math.round(netProfit)}€ je znotraj neoporečnega limita (${TAX_FREE_ALLOWANCE}€) — davek znaša 0€.`,
      );
    } else if (netProfit < 0) {
      opombe.push(
        `Leto se zaključuje z izgubo ${Math.round(Math.abs(netProfit))}€ — izgubo lahko prenesete v naslednje leto (do ${LOSS_CARRYFORWARD_YEARS} let).`,
      );
    } else {
      opombe.push(
        `Dobiček ${Math.round(netProfit)}€ presega neoporečni limit ${TAX_FREE_ALLOWANCE}€ — davčna osnova: ${Math.round(taxableBase)}€, davek ${(taxRate * 100).toFixed(2)}% = ${taxAmount}€.`,
      );
    }
    if (lossCarryforward > 0) {
      opombe.push(
        `Prenesene izgube iz prejšnjih ${LOSS_CARRYFORWARD_YEARS} let: ${lossCarryforward}€ (zmanjšujejo davčno osnovo).`,
      );
    }
    if (longTermCount > 0) {
      if (allLongTerm) {
        opombe.push(
          `Vse prodaje so bile dolgoročno držanje (>${LONG_TERM_HOLD_DAYS} dni) — uporabljena je znižana stopnja ${(TAX_RATE_LONG_TERM * 100).toFixed(2)}% (1/3 znižanja).`,
        );
      } else {
        opombe.push(
          `${longTermCount} od ${soldTrades.length} prodaj je dolgoročno držanje (>${LONG_TERM_HOLD_DAYS} dni) — pri posameznih kvalificirajočih sredstvih se lahko uporabi 1/3 znižanja davka.`,
        );
      }
    }
    opombe.push(
      `Poročilo je generirano avtomatsko in služi kot osnutek za pripravo davčne napovedi (eDavki). Ob predaji preverite pri FURS-u.`,
    );

    // 8) Build the formal report
    const report = {
      davcniZavezanec: {
        leto: year,
        opis: 'Letno poročilo o dobičku iz preprodaje',
      },
      povzetek: {
        skupniDobicek: Math.round(grossProfit),
        skupnaIzguba: Math.round(grossLoss),
        netoDobicek: Math.round(netProfit),
        neoporeznaKvota: TAX_FREE_ALLOWANCE,
        izgubeIzPrejsnjihLet: lossCarryforward,
        davcnaOsnova: Math.round(taxableBase),
        davcnaStopnja: taxRate,
        davek: taxAmount,
        efektivnaStopnja: effectiveRate,
        detaljiIzgubPrenos: prevLosses,
      },
      mesecniPregled,
      poKategorijah,
      trgovine,
      opombe,
    };

    return NextResponse.json({
      ok: true,
      year,
      generatedAt: new Date().toISOString(),
      report,
    });
  } catch (err: any) {
    logger.error('/api/analytics/tax-report', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
