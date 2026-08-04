// v6.7: AI Inventory Aging Alert — opozori ko itemi v skladišču starajo in izgubljajo vrednost
// GET /api/trades/aging-alerts
// Returns: { ok, alerts: Array<{ tradeId, title, daysHeld, buyPrice, estimatedCurrentValue, valueLoss, urgency, recommendation }> }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      include: {
        listing: { select: { aiEstimatedValue: true, dealScore: true, priceDroppedAt: true, previousPrice: true, title: true } },
      },
      orderBy: { buyDate: 'asc' },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, alerts: [], message: 'Ni tradeov v skladišču.' });
    }

    const now = new Date();
    const alerts = heldTrades.map(t => {
      const daysHeld = Math.round((now.getTime() - t.buyDate.getTime()) / (24 * 60 * 60 * 1000));
      const buyPrice = t.buyPrice;

      // Estimate current value (items depreciate ~2% per week)
      const weeksHeld = daysHeld / 7;
      const depreciationPct = Math.min(60, weeksHeld * 2); // max 60% loss
      const aiValue = t.listing?.aiEstimatedValue ?? buyPrice;
      const estimatedCurrentValue = Math.round(aiValue * (1 - depreciationPct / 100));
      const valueLoss = buyPrice - estimatedCurrentValue;
      const valueLossPct = buyPrice > 0 ? Math.round((valueLoss / buyPrice) * 100) : 0;

      // Urgency levels
      let urgency: 'critical' | 'high' | 'medium' | 'low';
      let urgencyLabel: string;
      let color: string;
      let recommendation: string;

      if (daysHeld > 90) {
        urgency = 'critical';
        urgencyLabel = '🚨 KRITIČNO';
        color = 'text-red-500';
        recommendation = `PRODAJ TAKOJ! ${daysHeld} dni v skladišču, izguba vrednosti ${valueLossPct}%. Predlagana cena: ${Math.round(buyPrice * 0.85)}€`;
      } else if (daysHeld > 60) {
        urgency = 'high';
        urgencyLabel = '🔴 VISOKA';
        color = 'text-red-500';
        recommendation = `Znižaj ceno za 10-15% za hitro prodajo. ${daysHeld} dni v skladišču.`;
      } else if (daysHeld > 30) {
        urgency = 'medium';
        urgencyLabel = '🟡 SREDNJA';
        color = 'text-amber-400';
        recommendation = `Spremljaj — po 30 dneh začni razmišljati o znižanju cene.`;
      } else if (daysHeld > 14) {
        urgency = 'low';
        urgencyLabel = '🟢 NIZKA';
        color = 'text-primary';
        recommendation = `Še vedno sveže — počakaj na boljšo ponudbo.`;
      } else {
        urgency = 'low';
        urgencyLabel = '✅ NOVO';
        color = 'text-primary';
        recommendation = `Pravkar kupljeno — počakaj vsaj 7 dni pred prodajo.`;
      }

      // Daily holding cost (opportunity cost: 0.05% per day)
      const dailyHoldingCost = Math.round(buyPrice * 0.0005 * 100) / 100;
      const totalHoldingCost = Math.round(dailyHoldingCost * daysHeld * 100) / 100;

      return {
        tradeId: t.id,
        title: t.title,
        category: t.category,
        daysHeld,
        buyPrice,
        aiEstimatedValue: aiValue,
        estimatedCurrentValue,
        valueLoss,
        valueLossPct,
        urgency,
        urgencyLabel,
        color,
        recommendation,
        dailyHoldingCost,
        totalHoldingCost,
        dealScore: t.listing?.dealScore ?? null,
      };
    }).sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.urgency as keyof typeof order] - order[b.urgency as keyof typeof order] || b.valueLoss - a.valueLoss;
    });

    const summary = {
      totalItems: heldTrades.length,
      critical: alerts.filter(a => a.urgency === 'critical').length,
      high: alerts.filter(a => a.urgency === 'high').length,
      medium: alerts.filter(a => a.urgency === 'medium').length,
      low: alerts.filter(a => a.urgency === 'low').length,
      totalValueLoss: alerts.reduce((s, a) => s + a.valueLoss, 0),
      totalHoldingCost: alerts.reduce((s, a) => s + a.totalHoldingCost, 0),
      totalInvested: heldTrades.reduce((s, t) => s + t.buyPrice, 0),
    };

    return NextResponse.json({ ok: true, alerts, summary });

  } catch (err) {
    logger.error("/api/trades/aging-alerts", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
