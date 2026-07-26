// v6.8: AI Risk Score per Trade — AI oceni tveganje posameznega tradea
// POST /api/trades/risk-score
// Body: { tradeId?: string } — single trade, or {} for all held trades
// Returns: { ok, risks: Array<{ tradeId, title, riskScore, riskFactors, recommendation }> }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tradeId = body?.tradeId;

    const where: any = { status: 'held' };
    if (tradeId) where.id = tradeId;

    const heldTrades = await db.trade.findMany({
      where,
      include: {
        listing: { select: { aiEstimatedValue: true, dealScore: true, aiVerdict: true, aiRisk: true, title: true, url: true, sellerName: true, priceDroppedAt: true } },
      },
      orderBy: { buyDate: 'asc' },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, risks: [], message: 'Ni tradeov v skladišču.' });
    }

    const now = new Date();
    const risks = heldTrades.map(t => {
      const daysHeld = Math.round((now.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const factors: string[] = [];
      let riskScore = 30; // baseline

      // Time risk: items held longer = higher risk
      if (daysHeld > 90) { riskScore += 30; factors.push('🚨 90+ dni v skladišču'); }
      else if (daysHeld > 60) { riskScore += 20; factors.push('🔴 60+ dni v skladišču'); }
      else if (daysHeld > 30) { riskScore += 10; factors.push('🟡 30+ dni v skladišču'); }
      else if (daysHeld < 7) { riskScore -= 5; factors.push('✅ Sveže kupljeno'); }

      // Market risk: AI estimate vs buy price
      const aiValue = t.listing?.aiEstimatedValue;
      if (aiValue && aiValue < t.buyPrice) {
        const lossPct = Math.round(((t.buyPrice - aiValue) / t.buyPrice) * 100);
        riskScore += Math.min(25, lossPct);
        factors.push(`📉 AI vrednost ${lossPct}% pod kupno ceno`);
      } else if (aiValue && aiValue > t.buyPrice * 1.2) {
        riskScore -= 10;
        factors.push('📈 AI vrednost 20%+ nad kupno ceno');
      }

      // AI verdict risk
      if (t.listing?.aiRisk != null) {
        if (t.listing.aiRisk >= 7) { riskScore += 15; factors.push(`⚠️ AI tveganje ${t.listing.aiRisk}/10`); }
        else if (t.listing.aiRisk <= 3) { riskScore -= 5; factors.push(`✅ AI tveganje ${t.listing.aiRisk}/10 (nizko)`); }
      }

      // Deal score risk
      if (t.listing?.dealScore != null) {
        if (t.listing.dealScore < 40) { riskScore += 10; factors.push(`Deal score ${t.listing.dealScore} (nizek)`); }
        else if (t.listing.dealScore >= 70) { riskScore -= 5; factors.push(`Deal score ${t.listing.dealScore} (visok)`); }
      }

      // Price drop after purchase
      if (t.listing?.priceDroppedAt) {
        riskScore += 10;
        factors.push('📉 Cena je padla po nakupu');
      }

      // Category risk (some categories are harder to sell)
      const cat = (t.category || '').toLowerCase();
      if (cat === 'nepremicnine' || cat === 'avto') {
        riskScore += 5; factors.push('🏗️ Nizko-likvidna kategorija');
      } else if (cat === 'elektronika' || cat === 'moda') {
        riskScore -= 5; factors.push('⚡ Visoko-likvidna kategorija');
      }

      // Price level risk (high-value items = more risk)
      if (t.buyPrice > 1000) { riskScore += 10; factors.push('💰 Visoka vrednost (>1000€)'); }
      else if (t.buyPrice < 50) { riskScore -= 5; factors.push('🪙 Nizka vrednost (<50€)'); }

      riskScore = Math.max(0, Math.min(100, riskScore));

      // Risk level
      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      let riskLabel: string;
      let color: string;
      let recommendation: string;

      if (riskScore >= 70) {
        riskLevel = 'critical';
        riskLabel = '🚨 KRITIČNO';
        color = 'text-red-500';
        recommendation = 'PRODAJ TAKOJ — visoko tveganje izgube. Znižaj ceno za 15-20%.';
      } else if (riskScore >= 50) {
        riskLevel = 'high';
        riskLabel = '🔴 VISOKO';
        color = 'text-red-500';
        recommendation = 'Znižaj ceno za 10% in pospeši prodajo.';
      } else if (riskScore >= 35) {
        riskLevel = 'medium';
        riskLabel = '🟡 ZMERNO';
        color = 'text-amber-400';
        recommendation = 'Spremljaj trg, pripravi se na morebitno znižanje.';
      } else {
        riskLevel = 'low';
        riskLabel = '🟢 NIZKO';
        color = 'text-primary';
        recommendation = 'Tveganje je nizko — počakaj na optimalno ceno.';
      }

      return {
        tradeId: t.id,
        title: t.title,
        category: t.category,
        buyPrice: t.buyPrice,
        daysHeld,
        riskScore,
        riskLevel,
        riskLabel,
        color,
        riskFactors: factors,
        recommendation,
        aiEstimatedValue: aiValue ?? null,
        dealScore: t.listing?.dealScore ?? null,
      };
    }).sort((a, b) => b.riskScore - a.riskScore);

    const summary = {
      totalItems: heldTrades.length,
      critical: risks.filter(r => r.riskLevel === 'critical').length,
      high: risks.filter(r => r.riskLevel === 'high').length,
      medium: risks.filter(r => r.riskLevel === 'medium').length,
      low: risks.filter(r => r.riskLevel === 'low').length,
      avgRiskScore: Math.round(risks.reduce((s, r) => s + r.riskScore, 0) / risks.length),
    };

    return NextResponse.json({ ok: true, risks, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}
