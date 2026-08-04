import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/monitors/sparkline
 * Returns last 14 days of run data per monitor for sparkline visualization.
 */
export async function GET() {
  try {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const monitors = await db.monitor.findMany({
      select: {
        id: true, name: true,
        runLogs: {
          where: { startedAt: { gte: since } },
          orderBy: { startedAt: 'asc' },
          select: { status: true, startedAt: true, newListings: true, alertsSent: true },
        },
      },
    });

    const sparklines = monitors.map(m => {
      const byDay: Record<string, { runs: number; ok: number; newListings: number; alerts: number }> = {};
      for (const log of m.runLogs) {
        const dayKey = log.startedAt.toISOString().slice(0, 10);
        if (!byDay[dayKey]) byDay[dayKey] = { runs: 0, ok: 0, newListings: 0, alerts: 0 };
        byDay[dayKey].runs++;
        if (log.status === 'ok') byDay[dayKey].ok++;
        byDay[dayKey].newListings += log.newListings;
        byDay[dayKey].alerts += log.alertsSent;
      }

      const days: Array<{ date: string; runs: number; ok: number; newListings: number; alerts: number }> = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        days.push(byDay[key] ? { date: key, ...byDay[key] } : { date: key, runs: 0, ok: 0, newListings: 0, alerts: 0 });
      }

      return {
        id: m.id, name: m.name,
        sparkline: days.map(d => d.newListings),
        totalRuns: days.reduce((s, d) => s + d.runs, 0),
        totalNew: days.reduce((s, d) => s + d.newListings, 0),
        totalAlerts: days.reduce((s, d) => s + d.alerts, 0),
        successRate: days.reduce((s, d) => s + d.runs, 0) > 0
          ? days.reduce((s, d) => s + d.ok, 0) / days.reduce((s, d) => s + d.runs, 0) : 0,
      };
    });

    return NextResponse.json({ sparklines });

  } catch (err) {
    logger.error("/api/monitors/sparkline", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
