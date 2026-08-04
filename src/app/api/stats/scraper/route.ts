// v6.0: Scraper Stats Dashboard — detailed stats about scraping performance
// GET /api/stats/scraper
// Returns: success rate, avg duration, blocks, captcha hits, proxy usage, per-source breakdown

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Overall stats for different time windows
    const [runs24h, runs7d, runs30d] = await Promise.all([
      db.runLog.findMany({
        where: { startedAt: { gte: last24h } },
        select: { status: true, durationMs: true, newListings: true, alertsSent: true, monitorId: true, startedAt: true, error: true },
        take: 500,
        orderBy: { startedAt: 'desc' },
      }),
      db.runLog.findMany({
        where: { startedAt: { gte: last7d } },
        select: { status: true, durationMs: true, newListings: true, alertsSent: true, monitorId: true, startedAt: true },
        take: 2000,
        orderBy: { startedAt: 'desc' },
      }),
      db.runLog.findMany({
        where: { startedAt: { gte: last30d } },
        select: { status: true, durationMs: true, newListings: true, alertsSent: true, monitorId: true, startedAt: true },
        take: 5000,
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    // Get monitor names
    const monitors = await db.monitor.findMany({ select: { id: true, name: true, source: true } });
    const monitorMap = new Map(monitors.map(m => [m.id, m]));

    // Calculate stats for a set of runs
    function calcStats(runs: any[]) {
      const total = runs.length;
      const ok = runs.filter(r => r.status === 'ok').length;
      const error = runs.filter(r => r.status === 'error').length;
      const empty = runs.filter(r => r.status === 'empty').length;
      const successRate = total > 0 ? Math.round((ok / total) * 100) : 0;
      const avgDuration = total > 0 ? Math.round(runs.reduce((s, r) => s + (r.durationMs ?? 0), 0) / total) : 0;
      const totalNew = runs.reduce((s, r) => s + (r.newListings ?? 0), 0);
      const totalAlerts = runs.reduce((s, r) => s + (r.alertsSent ?? 0), 0);
      const errors = runs.filter(r => r.status === 'error').map(r => r.error).filter(Boolean).slice(0, 10);
      return { total, ok, error, empty, successRate, avgDuration, totalNew, totalAlerts, errors };
    }

    // Per-source breakdown (last 7 days)
    const bySource: Record<string, any> = {};
    for (const r of runs7d) {
      const m = monitorMap.get(r.monitorId);
      if (!m) continue;
      const src = m.source;
      if (!bySource[src]) bySource[src] = { total: 0, ok: 0, error: 0, empty: 0, newListings: 0, avgDuration: 0, monitorName: m.name };
      bySource[src].total++;
      if (r.status === 'ok') bySource[src].ok++;
      else if (r.status === 'error') bySource[src].error++;
      else if (r.status === 'empty') bySource[src].empty++;
      bySource[src].newListings += r.newListings ?? 0;
      bySource[src].avgDuration += r.durationMs ?? 0;
    }
    for (const src of Object.keys(bySource)) {
      bySource[src].successRate = bySource[src].total > 0 ? Math.round((bySource[src].ok / bySource[src].total) * 100) : 0;
      bySource[src].avgDuration = bySource[src].total > 0 ? Math.round(bySource[src].avgDuration / bySource[src].total) : 0;
    }

    // Per-monitor breakdown (last 7 days)
    const byMonitor: Record<string, any> = {};
    for (const r of runs7d) {
      const m = monitorMap.get(r.monitorId);
      if (!m) continue;
      if (!byMonitor[m.id]) byMonitor[m.id] = { name: m.name, source: m.source, total: 0, ok: 0, error: 0, empty: 0, newListings: 0, avgDuration: 0, lastRun: r.startedAt };
      byMonitor[m.id].total++;
      if (r.status === 'ok') byMonitor[m.id].ok++;
      else if (r.status === 'error') byMonitor[m.id].error++;
      else if (r.status === 'empty') byMonitor[m.id].empty++;
      byMonitor[m.id].newListings += r.newListings ?? 0;
      byMonitor[m.id].avgDuration += r.durationMs ?? 0;
    }
    for (const id of Object.keys(byMonitor)) {
      byMonitor[id].successRate = byMonitor[id].total > 0 ? Math.round((byMonitor[id].ok / byMonitor[id].total) * 100) : 0;
      byMonitor[id].avgDuration = byMonitor[id].total > 0 ? Math.round(byMonitor[id].avgDuration / byMonitor[id].total) : 0;
    }

    // Hourly breakdown (last 24h) — for detecting patterns
    const byHour: Array<{ hour: number; total: number; ok: number; newListings: number }> = [];
    for (let h = 0; h < 24; h++) byHour.push({ hour: h, total: 0, ok: 0, newListings: 0 });
    for (const r of runs24h) {
      const h = r.startedAt.getHours();
      byHour[h].total++;
      if (r.status === 'ok') byHour[h].ok++;
      byHour[h].newListings += r.newListings ?? 0;
    }

    // Recent errors (last 24h)
    const recentErrors = runs24h
      .filter(r => r.status === 'error' && r.error)
      .slice(0, 15)
      .map(r => ({
        monitorName: monitorMap.get(r.monitorId)?.name ?? '?',
        error: r.error,
        time: r.startedAt,
      }));

    return NextResponse.json({
      ok: true,
      stats24h: calcStats(runs24h),
      stats7d: calcStats(runs7d),
      stats30d: calcStats(runs30d),
      bySource: Object.entries(bySource).map(([source, v]) => ({ source, ...v })),
      byMonitor: Object.values(byMonitor).sort((a: any, b: any) => b.total - a.total),
      byHour,
      recentErrors,
      generatedAt: now.toISOString(),
    });

  } catch (err) {
    logger.error("/api/stats/scraper", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
