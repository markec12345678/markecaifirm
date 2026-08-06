// v7.62: Cash Conversion Cycle Analyzer — finančna metrika ki meri kako
// učinkovito kapital teče skozi business. CCC = DIO + DSO - DPO.
// Za cash flipping: DSO=0 (cash sales), DPO=0 (cash purchases), CCC = avg hold.
//
// "CCC: 28 dni (GOOD). Elektronika 22d, avto 45d. Letni turnover: 13x.
//  Če skrajšaš CCC za 10d → +15% profit"
//
// Pure DB analytics (NO AI). GET /api/analytics/cash-conversion-cycle

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CCCClassification =
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'SLOW'
  | 'VERY_SLOW';

interface MonthlyEntry {
  month: string; // "Jan", "Feb", ...
  ccc: number;
  itemsSold: number;
  trend: 'IMPROVING' | 'STABLE' | 'WORSENING';
}

interface CategoryEntry {
  category: string;
  avgCCC: number;
  itemsSold: number;
  classification: CCCClassification;
  capitalEfficiency: number; // 1/ccc × 365 (cycles per year)
}

function classifyCCC(ccc: number): CCCClassification {
  if (ccc < 15) return 'EXCELLENT';
  if (ccc <= 30) return 'GOOD';
  if (ccc <= 45) return 'AVERAGE';
  if (ccc <= 60) return 'SLOW';
  return 'VERY_SLOW';
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
  'Jul', 'Avg', 'Sep', 'Okt', 'Nov', 'Dec',
];

export async function GET() {
  try {
    // 1) Query all SOLD trades with sellDate + buyDate
    const soldTrades = await db.trade.findMany({
      where: {
        status: 'sold',
        sellDate: { not: null },
      },
      select: {
        id: true,
        title: true,
        category: true,
        buyPrice: true,
        buyFees: true,
        sellPrice: true,
        sellFees: true,
        buyDate: true,
        sellDate: true,
      },
      take: 5000,
    });

    if (soldTrades.length === 0) {
      return NextResponse.json({
        ok: true,
        currentCCC: {
          dio: 0,
          dso: 0,
          dpo: 0,
          ccc: 0,
          classification: 'EXCELLENT',
          benchmark: 30,
        },
        monthlyTrend: [],
        categoryBreakdown: [],
        capitalEfficiency: {
          avgInventory: 0,
          annualRevenue: 0,
          capitalTurnoverRatio: 0,
          avgROI: 0,
          annualizedROI: 0,
          cashRecoveryTime: 0,
        },
        recommendations: {
          fastestCategories: [],
          slowestCategories: [],
          improvementPotential: 0,
          advice: 'Ni prodanih trade-ov — CCC analiza ni mogoča.',
        },
        message: 'Ni prodanih trade-ov — Cash Conversion Cycle analiza ni mogoča.',
      });
    }

    // 2) Compute hold days per trade
    interface TradeRow {
      id: string;
      title: string;
      category: string;
      buyPrice: number;
      buyFees: number;
      sellPrice: number;
      sellFees: number;
      buyDate: Date;
      sellDate: Date;
      holdDays: number;
      profit: number;
      invested: number;
      revenue: number;
    }
    const rows: TradeRow[] = soldTrades
      .map(t => {
        const holdDays = Math.max(
          0,
          Math.round(
            (new Date(t.sellDate!).getTime() - new Date(t.buyDate).getTime()) / 86_400_000,
          ),
        );
        const invested = t.buyPrice + (t.buyFees ?? 0);
        const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        const profit = revenue - invested;
        return {
          id: t.id,
          title: t.title,
          category: (t.category || 'drugo').trim().toLowerCase(),
          buyPrice: t.buyPrice,
          buyFees: t.buyFees ?? 0,
          sellPrice: t.sellPrice ?? 0,
          sellFees: t.sellFees ?? 0,
          buyDate: new Date(t.buyDate),
          sellDate: new Date(t.sellDate!),
          holdDays,
          profit,
          invested,
          revenue,
        };
      })
      // Filter out invalid rows (zero invested etc.)
      .filter(r => r.invested > 0);

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        currentCCC: {
          dio: 0,
          dso: 0,
          dpo: 0,
          ccc: 0,
          classification: 'EXCELLENT',
          benchmark: 30,
        },
        monthlyTrend: [],
        categoryBreakdown: [],
        capitalEfficiency: {
          avgInventory: 0,
          annualRevenue: 0,
          capitalTurnoverRatio: 0,
          avgROI: 0,
          annualizedROI: 0,
          cashRecoveryTime: 0,
        },
        recommendations: {
          fastestCategories: [],
          slowestCategories: [],
          improvementPotential: 0,
          advice: 'Vsak trade potrebuje veljaven buyPrice > 0.',
        },
        message: 'Ni veljavnih prodaj za CCC analizo.',
      });
    }

    // 3) Current CCC (overall average hold days)
    const dio = Math.round(
      rows.reduce((s, r) => s + r.holdDays, 0) / rows.length,
    );
    const dso = 0; // cash sales — no credit given
    const dpo = 0; // cash purchases — no supplier credit
    const ccc = dio + dso - dpo;
    const classification = classifyCCC(ccc);

    // 4) Monthly trend (last 6 months) — group by sellDate month
    const now = new Date();
    const monthlyMap = new Map<
      string, // "YYYY-MM"
      { totalDays: number; count: number }
    >();

    for (const r of rows) {
      const sellDate = r.sellDate;
      // Skip rows older than 6 months
      const monthDiff =
        (now.getFullYear() - sellDate.getFullYear()) * 12 +
        (now.getMonth() - sellDate.getMonth());
      if (monthDiff < 0 || monthDiff > 5) continue;
      const key = `${sellDate.getFullYear()}-${String(sellDate.getMonth() + 1).padStart(2, '0')}`;
      const cur = monthlyMap.get(key) || { totalDays: 0, count: 0 };
      cur.totalDays += r.holdDays;
      cur.count += 1;
      monthlyMap.set(key, cur);
    }

    // Build 6-month trend (oldest → newest)
    const monthlyTrend: MonthlyEntry[] = [];
    let prevCcc: number | null = null;
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthlyMap.get(key);
      const monthCcc = entry && entry.count > 0 ? Math.round(entry.totalDays / entry.count) : 0;
      let trend: 'IMPROVING' | 'STABLE' | 'WORSENING' = 'STABLE';
      if (prevCcc != null && entry && entry.count > 0) {
        if (monthCcc < prevCcc - 2) trend = 'IMPROVING';
        else if (monthCcc > prevCcc + 2) trend = 'WORSENING';
      }
      monthlyTrend.push({
        month: MONTH_NAMES[d.getMonth()],
        ccc: entry && entry.count > 0 ? monthCcc : 0,
        itemsSold: entry?.count ?? 0,
        trend,
      });
      if (entry && entry.count > 0) prevCcc = monthCcc;
    }

    // 5) Per-category CCC breakdown
    const catMap = new Map<
      string,
      { totalDays: number; count: number; totalInvested: number; totalRevenue: number }
    >();
    for (const r of rows) {
      const cur =
        catMap.get(r.category) || {
          totalDays: 0,
          count: 0,
          totalInvested: 0,
          totalRevenue: 0,
        };
      cur.totalDays += r.holdDays;
      cur.count += 1;
      cur.totalInvested += r.invested;
      cur.totalRevenue += r.revenue;
      catMap.set(r.category, cur);
    }

    const categoryBreakdown: CategoryEntry[] = Array.from(catMap.entries())
      .map(([category, d]) => {
        const avgCCC = Math.round(d.totalDays / d.count);
        const capitalEfficiency = Math.round((365 / Math.max(1, avgCCC)) * 10) / 10;
        return {
          category,
          avgCCC,
          itemsSold: d.count,
          classification: classifyCCC(avgCCC),
          capitalEfficiency,
        };
      })
      .sort((a, b) => a.avgCCC - b.avgCCC); // fastest first

    // 6) Capital efficiency metrics
    // avgInventory: average capital tied up at any moment (approx = avg invested
    // per trade × avg CCC / 30 — i.e., how many items held simultaneously)
    const avgInvestedPerTrade =
      rows.reduce((s, r) => s + r.invested, 0) / rows.length;
    const avgInventory = Math.round(avgInvestedPerTrade * (ccc / 30));

    // annualRevenue: extrapolate from total revenue (last 12 months roughly)
    // Use last 365 days of sales
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
    const recentSales = rows.filter(r => r.sellDate >= yearAgo);
    const annualRevenue = Math.round(
      recentSales.reduce((s, r) => s + r.revenue, 0),
    );

    const capitalTurnoverRatio =
      avgInventory > 0 ? Math.round((annualRevenue / avgInventory) * 10) / 10 : 0;

    // avgROI across all sold trades (percent)
    const avgROI = Math.round(
      (rows.reduce((s, r) => s + r.profit / r.invested, 0) / rows.length) * 100,
    );
    // annualizedROI = avgROI × capitalTurnoverRatio (compounding effect)
    const annualizedROI = Math.round(avgROI * capitalTurnoverRatio);

    // cashRecoveryTime = avg days from buy to cash in hand (= CCC for cash)
    const cashRecoveryTime = ccc;

    // 7) Recommendations
    const fastestCategories = categoryBreakdown
      .slice(0, 3)
      .filter(c => c.itemsSold >= 1)
      .map(c => `${c.category} (${c.avgCCC}d, ${c.capitalEfficiency}x/leto)`);

    const slowestCategories = [...categoryBreakdown]
      .sort((a, b) => b.avgCCC - a.avgCCC)
      .slice(0, 3)
      .filter(c => c.itemsSold >= 1)
      .map(c => `${c.category} (${c.avgCCC}d)`);

    // improvementPotential: if we reduced CCC by 10 days, how much extra profit
    // per year? Extra cycles = 10/30 of annualRevenue/avgInventory turnover,
    // at avgROI per cycle.
    const improvementPotential =
      avgInventory > 0 && capitalTurnoverRatio > 0
        ? Math.round(
            (10 / 30) * // 10 fewer days = 1/3 of a cycle
              capitalTurnoverRatio *
              avgInventory *
              (avgROI / 100),
          )
        : 0;

    let advice: string;
    if (ccc < 15) {
      advice = `CCC ${ccc} dni (EXCELLENT) — kapital se obrača zelo hitro (${capitalTurnoverRatio}x/leto). Letni anualiziran ROI: ${annualizedROI}%. Ohrani tempo, morda povečaj volumen.`;
    } else if (ccc <= 30) {
      advice = `CCC ${ccc} dni (GOOD). Letni turnover: ${capitalTurnoverRatio}x, anualiziran ROI: ${annualizedROI}%. Če skrajšaš CCC za 10 dni → +${improvementPotential}€ letno. Fokus na: ${fastestCategories.join(', ') || '—'}.`;
    } else if (ccc <= 45) {
      advice = `CCC ${ccc} dni (AVERAGE) — kapital je vezan ${ccc} dni. Letni turnover: ${capitalTurnoverRatio}x. Če skrajšaš CCC za 10 dni → +${improvementPotential}€ letno. Fokus na ${fastestCategories[0] ?? 'hitrejše kategorije'}.`;
    } else if (ccc <= 60) {
      advice = `CCC ${ccc} dni (SLOW) — kapital se obrača počasi (${capitalTurnoverRatio}x/leto). Premakni se v ${fastestCategories[0] ?? 'hitrejše kategorije'}. Če skrajšaš CCC za 10 dni → +${improvementPotential}€ letno.`;
    } else {
      advice = `CCC ${ccc} dni (VERY_SLOW) — kapital je vezan ${ccc} dni. Nujno zmanjšaj hold time. ${fastestCategories[0] ? `Fokus na ${fastestCategories[0]}.` : ''} Če skrajšaš CCC za 10 dni → +${improvementPotential}€ letno.`;
    }

    return NextResponse.json({
      ok: true,
      currentCCC: {
        dio,
        dso,
        dpo,
        ccc,
        classification,
        benchmark: 30,
      },
      monthlyTrend,
      categoryBreakdown,
      capitalEfficiency: {
        avgInventory,
        annualRevenue,
        capitalTurnoverRatio,
        avgROI,
        annualizedROI,
        cashRecoveryTime,
      },
      recommendations: {
        fastestCategories,
        slowestCategories,
        improvementPotential,
        advice,
      },
    });
  } catch (err: any) {
    logger.error('/api/analytics/cash-conversion-cycle', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
