import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings/:id/price-history
 * Returns all price changes for a listing, ordered by time.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const listing = await db.listing.findUnique({
      where: { id },
      select: { id: true, title: true, price: true, priceText: true },
    });
    if (!listing) return NextResponse.json({ error: 'Ne najdem' }, { status: 404 });

    const history = await db.priceHistory.findMany({
      where: { listingId: id },
      orderBy: { seenAt: 'asc' },
    });

    // v7.34: Compute analytics — drop velocity, predicted bottom, best time to buy
    const analytics = computeAnalytics(history, listing.price);

    return NextResponse.json({
      listing,
      history,
      priceChanges: history.length > 1 ? computeChanges(history) : [],
      analytics,
    });

  } catch (err) {
    logger.error("/api/listings/[id]/price-history", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

function computeChanges(history: any[]): Array<{ from: number | null; to: number | null; fromText: string; toText: string; diff: number | null; pctChange: number | null; seenAt: string }> {
  const changes: any[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (prev.price !== curr.price || prev.priceText !== curr.priceText) {
      const diff = (curr.price != null && prev.price != null) ? curr.price - prev.price : null;
      const pctChange = (diff != null && prev.price != null && prev.price !== 0) ? (diff / prev.price) * 100 : null;
      changes.push({
        from: prev.price,
        to: curr.price,
        fromText: prev.priceText,
        toText: curr.priceText,
        diff,
        pctChange,
        seenAt: curr.seenAt,
      });
    }
  }
  return changes;
}

/**
 * v7.34: Price analytics — velocity, predicted bottom, buy timing.
 * Helps the user decide: "Should I buy now or wait?"
 */
function computeAnalytics(history: any[], currentPrice: number | null): {
  totalDropPct: number | null;
  dropVelocityEurPerDay: number | null;
  daysSinceFirstSeen: number;
  isAtHistoricalLow: boolean;
  historicalLow: number | null;
  historicalHigh: number | null;
  avgPrice: number | null;
  predictedBottom: number | null;
  recommendation: string;
  urgency: 'buy_now' | 'wait' | 'stable' | 'no_data';
} {
  const pricedHistory = history.filter(h => h.price != null && h.price > 0);
  if (pricedHistory.length === 0 || currentPrice == null) {
    return {
      totalDropPct: null,
      dropVelocityEurPerDay: null,
      daysSinceFirstSeen: 0,
      isAtHistoricalLow: false,
      historicalLow: null,
      historicalHigh: null,
      avgPrice: null,
      predictedBottom: null,
      recommendation: 'Ni dovolj podatkov za analizo.',
      urgency: 'no_data',
    };
  }

  const prices = pricedHistory.map(h => h.price);
  const first = pricedHistory[0];
  const last = pricedHistory[pricedHistory.length - 1];
  const historicalLow = Math.min(...prices);
  const historicalHigh = Math.max(...prices);
  const avgPrice = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);

  // Days since first seen
  const now = Date.now();
  const daysSinceFirstSeen = Math.max(1, Math.round((now - new Date(first.seenAt).getTime()) / 86400000));

  // Total drop % since first seen
  const totalDropPct = first.price != null && first.price > 0
    ? Math.round(((currentPrice - first.price) / first.price) * 10000) / 100
    : null;

  // Drop velocity (EUR/day) — linear regression on priced points
  // Simple approach: (lastPrice - firstPrice) / daysBetween
  const daysBetween = Math.max(1, Math.round(
    (new Date(last.seenAt).getTime() - new Date(first.seenAt).getTime()) / 86400000
  ));
  const totalDropEur = currentPrice - (first.price ?? currentPrice);
  const dropVelocityEurPerDay = Math.round((totalDropEur / daysBetween) * 100) / 100;

  // Is at historical low?
  const isAtHistoricalLow = currentPrice <= historicalLow;

  // Predicted bottom — if velocity is negative (dropping), extrapolate 7 more days
  // If velocity is 0 or positive, price is stable/rising → no further drop expected
  let predictedBottom: number | null = null;
  if (dropVelocityEurPerDay < -0.5 && !isAtHistoricalLow) {
    // Price still dropping — predict 7 more days of trend
    predictedBottom = Math.max(1, Math.round(currentPrice + dropVelocityEurPerDay * 7));
  } else if (isAtHistoricalLow) {
    predictedBottom = currentPrice; // already at low
  } else {
    predictedBottom = historicalLow; // expect it to reach historical low
  }

  // Recommendation logic
  let recommendation = '';
  let urgency: 'buy_now' | 'wait' | 'stable' | 'no_data' = 'stable';

  if (isAtHistoricalLow) {
    recommendation = `🎯 Cena je na zgodovinskem minimumu (${currentPrice}€). To je najnižja cena doslej — kupi zdaj.`;
    urgency = 'buy_now';
  } else if (dropVelocityEurPerDay < -2) {
    // Dropping fast (>2€/day)
    const daysToLow = Math.ceil((historicalLow - currentPrice) / dropVelocityEurPerDay);
    recommendation = `⏳ Cena pada hitro (${Math.abs(dropVelocityEurPerDay)}€/dan). Pri zgodovinskem minimumu (${historicalLow}€) čez ~${daysToLow} dni. Počakaj še ${daysToLow}d, nato kupi.`;
    urgency = 'wait';
  } else if (dropVelocityEurPerDay < -0.5) {
    // Dropping slowly
    recommendation = `📉 Cena počasi pada (${Math.abs(dropVelocityEurPerDay)}€/dan). Trenutno ${currentPrice}€, zgodovinski minimum ${historicalLow}€. Ni nujno — cena je blizu minimuma.`;
    urgency = 'stable';
  } else if (dropVelocityEurPerDay > 0.5) {
    // Rising
    recommendation = `📈 Cena RASTE (+${dropVelocityEurPerDay}€/dan). Če želiš, kupi zdaj — ne bo ceneje.`;
    urgency = 'buy_now';
  } else {
    // Stable
    const pctAboveLow = Math.round(((currentPrice - historicalLow) / historicalLow) * 100);
    recommendation = `➡️ Cena je stabilna. ${pctAboveLow}% nad zgodovinskim minimumom (${historicalLow}€). Brez naglice.`;
    urgency = 'stable';
  }

  return {
    totalDropPct,
    dropVelocityEurPerDay,
    daysSinceFirstSeen,
    isAtHistoricalLow,
    historicalLow,
    historicalHigh,
    avgPrice,
    predictedBottom,
    recommendation,
    urgency,
  };
}
