// v6.8: Deal Velocity Tracker — kdaj se pojavljajo najboljše priložnosti (ure, dnevi)
// GET /api/stats/deal-velocity
// Returns: { ok, byHour, byDayOfWeek, bySource, bestWindow, insights }

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const listings = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: thirtyDaysAgo },
        isHidden: false,
        OR: [
          { aiVerdict: 'PRILIKA' },
          { dealScore: { gte: 60 } },
        ],
      },
      select: {
        id: true, title: true, price: true, firstSeenAt: true,
        aiVerdict: true, aiScore: true, dealScore: true,
        monitor: { select: { source: true, name: true } },
      },
      take: 2000,
    });

    if (listings.length === 0) {
      return NextResponse.json({ ok: true, byHour: [], byDayOfWeek: [], bySource: [], bestWindow: null, insights: [], message: 'Ni priložnosti v zadnjih 30 dneh.' });
    }

    // By hour of day
    const byHour: Array<{ hour: number; count: number; avgDealScore: number; label: string }> = [];
    for (let h = 0; h < 24; h++) {
      const items = listings.filter(l => l.firstSeenAt.getHours() === h);
      byHour.push({
        hour: h,
        count: items.length,
        avgDealScore: items.length > 0 ? Math.round(items.reduce((s, l) => s + (l.dealScore ?? 0), 0) / items.length) : 0,
        label: `${String(h).padStart(2, '0')}:00`,
      });
    }

    // By day of week
    const dayNames = ['Nedelja', 'Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota'];
    const byDayOfWeek: Array<{ day: number; dayName: string; count: number; avgDealScore: number }> = [];
    for (let d = 0; d < 7; d++) {
      const items = listings.filter(l => l.firstSeenAt.getDay() === d);
      byDayOfWeek.push({
        day: d,
        dayName: dayNames[d],
        count: items.length,
        avgDealScore: items.length > 0 ? Math.round(items.reduce((s, l) => s + (l.dealScore ?? 0), 0) / items.length) : 0,
      });
    }

    // By source
    const sourceMap: Record<string, { count: number; avgDealScore: number }> = {};
    for (const l of listings) {
      const src = l.monitor?.source ?? 'neznan';
      if (!sourceMap[src]) sourceMap[src] = { count: 0, avgDealScore: 0 };
      sourceMap[src].count++;
      sourceMap[src].avgDealScore += l.dealScore ?? 0;
    }
    const bySource = Object.entries(sourceMap).map(([source, s]) => ({
      source, count: s.count, avgDealScore: s.count > 0 ? Math.round(s.avgDealScore / s.count) : 0,
    })).sort((a, b) => b.count - a.count);

    // Find best window (hour with most + highest avg deal score)
    const bestHour = [...byHour].sort((a, b) => (b.count * b.avgDealScore) - (a.count * a.avgDealScore))[0];
    const bestDay = [...byDayOfWeek].sort((a, b) => (b.count * b.avgDealScore) - (a.count * a.avgDealScore))[0];

    // Peak hours (top 3)
    const peakHours = [...byHour].sort((a, b) => b.count - a.count).slice(0, 3).filter(h => h.count > 0);

    // Insights
    const insights: string[] = [];
    if (bestHour && bestHour.count > 0) {
      insights.push(`⏰ Najboljša ura za nove priložnosti: ${bestHour.label} (${bestHour.count} oglasov, povp. deal score ${bestHour.avgDealScore})`);
    }
    if (bestDay && bestDay.count > 0) {
      insights.push(`📅 Najboljši dan: ${bestDay.dayName} (${bestDay.count} oglasov, povp. deal score ${bestDay.avgDealScore})`);
    }
    if (peakHours.length > 0) {
      insights.push(`🔥 Peak ure: ${peakHours.map(h => h.label).join(', ')}`);
    }
    if (bySource.length > 0) {
      insights.push(`📊 Najbolj produktiven vir: ${bySource[0].source} (${bySource[0].count} oglasov)`);
    }

    // Best window recommendation
    let bestWindow: string | null = null;
    if (bestHour && bestDay) {
      bestWindow = `${bestDay.dayName} ob ${bestHour.label}`;
    }

    return NextResponse.json({
      ok: true,
      byHour,
      byDayOfWeek,
      bySource,
      bestWindow,
      insights,
      totalOpportunities: listings.length,
      avgDealScore: listings.length > 0 ? Math.round(listings.reduce((s, l) => s + (l.dealScore ?? 0), 0) / listings.length) : 0,
    });

  } catch (err) {
    logger.error("/api/stats/deal-velocity", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
