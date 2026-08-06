// v7.50: AI Risk Spread Calculator — portfolio diversification analysis.
//
// "Imaš 80% capital v elektroniki — preveč koncentrirano.
//  Razprši: 40% elektronika, 30% avto, 20% orodje, 10% cash."
//
// GET /api/ai/risk-spread-calculator

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, buyPrice: true, category: true, buyDate: true, listing: { select: { aiEstimatedValue: true, aiRisk: true } } },
    });

    const soldTrades = await db.trade.findMany({
      where: { status: 'sold', sellPrice: { not: null } },
      select: { category: true, buyPrice: true, sellPrice: true, buyFees: true, sellFees: true },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, message: 'Skladišče je prazno — nič za analizo.' });
    }

    // Current allocation
    const totalValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const catMap = new Map<string, { count: number; value: number; estValue: number; avgRisk: number }>();
    for (const t of heldTrades) {
      const cat = (t.category || 'drugo').trim();
      const cur = catMap.get(cat) || { count: 0, value: 0, estValue: 0, avgRisk: 0 };
      cur.count += 1;
      cur.value += t.buyPrice;
      cur.estValue += t.listing?.aiEstimatedValue ?? t.buyPrice * 1.2;
      cur.avgRisk += t.listing?.aiRisk ?? 5;
      catMap.set(cat, cur);
    }

    const currentAllocation = Array.from(catMap.entries()).map(([cat, d]) => ({
      category: cat,
      count: d.count,
      valueEur: Math.round(d.value),
      estValueEur: Math.round(d.estValue),
      pct: Math.round((d.value / totalValue) * 100),
      avgRisk: Math.round(d.avgRisk / d.count),
    })).sort((a, b) => b.valueEur - a.valueEur);

    // Risk metrics
    const concentrationRisk = Math.max(...currentAllocation.map(a => a.pct)); // highest single category %
    const diversificationScore = Math.round(100 - concentrationRisk); // higher = more diversified
    const weightedAvgRisk = Math.round(currentAllocation.reduce((s, a) => s + a.avgRisk * (a.pct / 100), 0));

    // Category ROI from sold history
    const soldCatMap = new Map<string, { invested: number; returned: number; count: number }>();
    for (const t of soldTrades) {
      const cat = (t.category || 'drugo').trim();
      const cur = soldCatMap.get(cat) || { invested: 0, returned: 0, count: 0 };
      cur.invested += t.buyPrice + (t.buyFees ?? 0);
      cur.returned += (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      cur.count += 1;
      soldCatMap.set(cat, cur);
    }

    const categoryRoi = Array.from(soldCatMap.entries()).map(([cat, d]) => ({
      category: cat,
      roi: d.invested > 0 ? Math.round(((d.returned - d.invested) / d.invested) * 100) : 0,
      count: d.count,
    })).sort((a, b) => b.roi - a.roi);

    // Recommended allocation (based on ROI + diversification)
    const topCategories = categoryRoi.filter(c => c.roi > 0).slice(0, 5);
    let recommendedAllocation: Array<{ category: string; pct: number; reason: string }> = [];

    if (topCategories.length > 0) {
      const totalRoi = topCategories.reduce((s, c) => s + c.roi, 0);
      recommendedAllocation = topCategories.map((c, i) => {
        let pct = Math.round((c.roi / totalRoi) * 80); // 80% in top ROI categories
        // Cap at 40% per category
        pct = Math.min(40, pct);
        return {
          category: c.category,
          pct,
          reason: `ROI ${c.roi}% iz ${c.count} prodaj`,
        };
      });
      // Add cash reserve
      const allocated = recommendedAllocation.reduce((s, a) => s + a.pct, 0);
      recommendedAllocation.push({ category: 'Cash reserve', pct: 100 - allocated, reason: 'Likvidnost za nove priložnosti' });
    }

    // Risk assessment
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    let riskReason = '';
    if (concentrationRisk > 60) {
      riskLevel = 'HIGH';
      riskReason = `Preveč koncentrirano — ${concentrationRisk}% v eni kategoriji. Razprši!`;
    } else if (concentrationRisk > 40 || weightedAvgRisk > 5) {
      riskLevel = 'MEDIUM';
      riskReason = `Zmerna koncentracija (${concentrationRisk}%), povprečno tveganje ${weightedAvgRisk}/10.`;
    } else {
      riskLevel = 'LOW';
      riskReason = `Dobra diverzifikacija — najvišja kategorija ${concentrationRisk}%.`;
    }

    return NextResponse.json({
      ok: true,
      totalValueEur: Math.round(totalValue),
      totalItems: heldTrades.length,
      currentAllocation,
      recommendedAllocation,
      risk: {
        level: riskLevel,
        concentrationRisk,
        diversificationScore,
        weightedAvgRisk,
        reason: riskReason,
      },
      categoryRoi,
      recommendation: riskLevel === 'HIGH'
        ? `🔴 Razprši portfelj! ${concentrationRisk}% v eni kategoriji je preveč. Cilj: max 40% per kategorija.`
        : riskLevel === 'MEDIUM'
        ? `🟡 Zmerno tveganje. Razmisli o diverzifikaciji v kategorije z višjim ROI.`
        : `🟢 Dobra diverzifikacija. Nadaljuj s trenutno strategijo.`,
    });
  } catch (err: any) {
    logger.error('/api/ai/risk-spread-calculator', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
