// v7.48: Deal Timing Predictor — "kdaj se pojavijo novi deal-i?"
//
// Analizira kdaj (dan v tednu + ura) se pojavijo največ novih priložnosti.
// "Vsak torek ob 14h pridejo novi oglasi na Bolho — najboljši čas za check"
//
// GET /api/analytics/deal-timing

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];

export async function GET() {
  try {
    // Get all PRILIKA listings from last 90 days
    const listings = await db.listing.findMany({
      where: {
        aiVerdict: 'PRILIKA',
        isHidden: false,
        firstSeenAt: { gte: new Date(Date.now() - 90 * 86400000) },
      },
      select: {
        id: true, title: true, price: true, dealScore: true,
        firstSeenAt: true, monitor: { select: { source: true, name: true } },
      },
      take: 3000,
    });

    if (listings.length < 10) {
      return NextResponse.json({ ok: true, message: 'Ni dovolj deal-ov za timing analizo (min 10 v 90 dneh).' });
    }

    // Build day×hour matrix
    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const scoreMatrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const l of listings) {
      const d = new Date(l.firstSeenAt);
      const day = d.getDay();
      const hour = d.getHours();
      matrix[day][hour] += 1;
      scoreMatrix[day][hour] += l.dealScore ?? 0;
    }

    // Find best time slots
    const slots: Array<{ day: number; dayName: string; hour: number; dealCount: number; avgScore: number }> = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (matrix[d][h] > 0) {
          slots.push({
            day: d,
            dayName: DAY_NAMES[d],
            hour: h,
            dealCount: matrix[d][h],
            avgScore: Math.round(scoreMatrix[d][h] / matrix[d][h]),
          });
        }
      }
    }

    // Sort by deal count
    slots.sort((a, b) => b.dealCount - a.dealCount);

    // Day totals
    const dayTotals = Array.from({ length: 7 }, (_, d) => ({
      day: DAY_NAMES[d],
      dayIndex: d,
      totalDeals: matrix[d].reduce((s, x) => s + x, 0),
      bestHour: matrix[d].indexOf(Math.max(...matrix[d])),
    })).sort((a, b) => b.totalDeals - a.totalDeals);

    // Hour totals (across all days)
    const hourTotals = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      totalDeals: matrix.reduce((s, day) => s + day[h], 0),
    })).sort((a, b) => b.totalDeals - a.totalDeals);

    // Best day + best hour
    const bestDay = dayTotals[0];
    const bestHour = hourTotals[0];
    const bestSlot = slots[0];

    // Per-source timing
    const sourceTiming = new Map<string, { bestDay: string; bestHour: number; totalDeals: number }>();
    for (const l of listings) {
      const src = l.monitor?.source || 'unknown';
      if (!sourceTiming.has(src)) sourceTiming.set(src, { bestDay: '', bestHour: 0, totalDeals: 0 });
      sourceTiming.get(src)!.totalDeals += 1;
    }

    // Compute best day/hour per source
    for (const [src] of sourceTiming) {
      const srcListings = listings.filter(l => (l.monitor?.source || 'unknown') === src);
      const srcMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const l of srcListings) {
        const d = new Date(l.firstSeenAt);
        srcMatrix[d.getDay()][d.getHours()] += 1;
      }
      let maxD = 0, maxH = 0, maxCount = 0;
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          if (srcMatrix[d][h] > maxCount) { maxCount = srcMatrix[d][h]; maxD = d; maxH = h; }
        }
      }
      sourceTiming.set(src, { bestDay: DAY_NAMES[maxD], bestHour: maxH, totalDeals: srcListings.length });
    }

    // Recommendation
    let recommendation = '';
    if (bestDay && bestHour) {
      recommendation = `📊 Največ deal-ov se pojavi ob ${bestDay.day} (${bestDay.totalDeals} v 90d), posebej ob ${bestHour.hour}:00 (${bestHour.totalDeals} deal-ov).`;
      if (bestSlot) {
        recommendation += `\n🎯 TOP slot: ${bestSlot.dayName} ${bestSlot.hour}:00–${bestSlot.hour + 1}:00 (${bestSlot.dealCount} deal-ov, avg score ${bestSlot.avgScore}).`;
      }
      recommendation += `\n💡 Nastavi monitor check na te čase za max coverage!`;
    }

    // Next best upcoming slot (relative to now)
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    let nextSlot: { dayName: string; hour: number; dealsExpected: number; hoursUntil: number } | null = null;
    for (let i = 0; i < 7 * 24; i++) {
      const checkDay = (currentDay + Math.floor((currentHour + i + 1) / 24)) % 7;
      const checkHour = (currentHour + i + 1) % 24;
      if (matrix[checkDay][checkHour] >= 3) {
        nextSlot = {
          dayName: DAY_NAMES[checkDay],
          hour: checkHour,
          dealsExpected: matrix[checkDay][checkHour],
          hoursUntil: i + 1,
        };
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      bestDay: bestDay ? { day: bestDay.day, deals: bestDay.totalDeals, bestHour: bestDay.bestHour } : null,
      bestHour: bestHour ? { hour: bestHour.hour, deals: bestHour.totalDeals } : null,
      bestSlot: bestSlot ? { day: bestSlot.dayName, hour: bestSlot.hour, deals: bestSlot.dealCount, avgScore: bestSlot.avgScore } : null,
      topSlots: slots.slice(0, 10),
      dayTotals,
      hourTotals: hourTotals.slice(0, 12),
      sourceTiming: Array.from(sourceTiming.entries()).map(([source, d]) => ({ source, ...d })),
      nextSlot,
      recommendation,
      totalDeals: listings.length,
    });
  } catch (err: any) {
    logger.error('/api/analytics/deal-timing', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
