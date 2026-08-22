// v5.1 / v8.96.1-refactor: AI Scheduler — AI predlaga optimalne čase za poganjanje monitorjev
// Refaktoriran z withAiRoute helperjem (v8.96.1) + enforceBudget guard.
//
// POST /api/ai/suggest-schedule
// Body: { monitorId: string } — analiza specificnega monitorja
// Body: {} — analiza vseh monitorjev
// Returns: { ok, suggestions: Array<{ monitorId, name, currentInterval, suggestedInterval, currentWindow, suggestedWindow, reasoning, expectedNewListingsPerDay, aiCallsPerDay }> }

import { withAiRoute, AI_ROUTE_DEFAULTS, ApiRouteError, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface SuggestScheduleInput {
  monitorId?: string;
}

export const POST = withAiRoute<SuggestScheduleInput>({
  endpoint: '/api/ai/suggest-schedule',
  maxDuration: 60,
  enforceBudget: true, // AI klic — preveri budget

  parseBody: async (req) => {
    const body = await req.json().catch(() => ({}));
    const monitorId = body?.monitorId;
    return { monitorId: monitorId ? String(monitorId) : undefined };
  },

  // No validateInput — monitorId je opcijski

  handler: async (input, ctx: AiRouteContext) => {
    const { db, callAi, parseAi } = ctx;
    const { monitorId } = input;

    // Gather run logs for analysis (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let monitors: any[] = [];
    if (monitorId) {
      const m = await db.monitor.findUnique({ where: { id: monitorId } });
      if (!m) {
        throw new ApiRouteError('Monitor ne obstaja', 404);
      }
      monitors = [m];
    } else {
      monitors = await db.monitor.findMany({ where: { isActive: true } });
    }

    if (monitors.length === 0) {
      return apiOk({ ok: true, suggestions: [], message: 'Ni aktivnih monitorjev za analizo.' });
    }

    const suggestions: any[] = [];

    for (const monitor of monitors) {
      // Gather stats for this monitor
      const runLogs = await db.runLog.findMany({
        where: {
          monitorId: monitor.id,
          startedAt: { gte: thirtyDaysAgo },
        },
        orderBy: { startedAt: 'asc' },
        select: {
          startedAt: true,
          status: true,
          newListings: true,
          alertsSent: true,
          durationMs: true,
        },
        take: 500,
      });

      // Aggregate by hour of day
      const byHour: Record<number, { runs: number; newListings: number; alerts: number; successes: number }> = {};
      for (let h = 0; h < 24; h++) byHour[h] = { runs: 0, newListings: 0, alerts: 0, successes: 0 };
      for (const r of runLogs) {
        const h = r.startedAt.getHours();
        byHour[h].runs++;
        byHour[h].newListings += r.newListings ?? 0;
        byHour[h].alerts += r.alertsSent ?? 0;
        if (r.status === 'ok') byHour[h].successes++;
      }

      // Find peak hours (top 3 by newListings)
      const peakHours = Object.entries(byHour)
        .map(([h, v]) => ({ hour: parseInt(h, 10), ...v }))
        .sort((a, b) => b.newListings - a.newListings || b.alerts - a.alerts)
        .slice(0, 5);

      // Total stats
      const totalRuns = runLogs.length;
      const totalNew = runLogs.reduce((s, r) => s + (r.newListings ?? 0), 0);
      const totalAlerts = runLogs.reduce((s, r) => s + (r.alertsSent ?? 0), 0);
      const successRate = totalRuns > 0 ? Math.round((runLogs.filter(r => r.status === 'ok').length / totalRuns) * 100) : 0;
      const avgDuration = totalRuns > 0 ? Math.round(runLogs.reduce((s, r) => s + (r.durationMs ?? 0), 0) / totalRuns) : 0;

      // Listings count for this monitor
      const listingsCount = await db.listing.count({ where: { monitorId: monitor.id } });

      // Skip if no data
      if (totalRuns < 5) {
        suggestions.push({
          monitorId: monitor.id,
          name: monitor.name,
          source: monitor.source,
          currentInterval: monitor.intervalMinutes,
          suggestedInterval: monitor.intervalMinutes,
          currentWindow: monitor.runStartHour != null && monitor.runEndHour != null ? `${monitor.runStartHour}-${monitor.runEndHour}` : '24/7',
          suggestedWindow: monitor.runStartHour != null && monitor.runEndHour != null ? `${monitor.runStartHour}-${monitor.runEndHour}` : '24/7',
          reasoning: 'Premalo podatkov za analizo (manj kot 5 poganjanj v zadnjih 30 dneh). Počakaj na več podatkov.',
          expectedNewListingsPerDay: 0,
          aiCallsPerDay: Math.round((24 * 60) / monitor.intervalMinutes),
          confidence: 0,
        });
        continue;
      }

      // Build AI prompt
      const prompt = buildSchedulePrompt(monitor, {
        runLogs: runLogs.slice(-50),
        byHour,
        peakHours,
        totalRuns,
        totalNew,
        totalAlerts,
        successRate,
        avgDuration,
        listingsCount,
      });

      const raw = await callAi(prompt);
      const parsed: any = parseAi(raw);
      suggestions.push({
        monitorId: monitor.id,
        name: monitor.name,
        source: monitor.source,
        currentInterval: monitor.intervalMinutes,
        suggestedInterval: clampInt(parsed?.suggested_interval, 5, 1440) ?? monitor.intervalMinutes,
        currentWindow: monitor.runStartHour != null && monitor.runEndHour != null ? `${monitor.runStartHour}-${monitor.runEndHour}` : '24/7',
        suggestedWindow: typeof parsed?.suggested_window === 'string' ? parsed.suggested_window : (monitor.runStartHour != null && monitor.runEndHour != null ? `${monitor.runStartHour}-${monitor.runEndHour}` : '24/7'),
        reasoning: String(parsed?.reasoning ?? parsed?.razlog ?? '').slice(0, 1000),
        expectedNewListingsPerDay: clampInt(parsed?.expected_new_listings_per_day, 0, 1000) ?? 0,
        aiCallsPerDay: clampInt(parsed?.ai_calls_per_day, 0, 1000) ?? Math.round((24 * 60) / monitor.intervalMinutes),
        confidence: clampInt(parsed?.confidence, 0, 100) ?? 50,
      });
    }

    return apiOk({
      ok: true,
      suggestions,
      analyzedAt: new Date().toISOString(),
      analyzedMonitors: monitors.length,
    });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

function buildSchedulePrompt(monitor: any, data: any): string {
  const hourStats = data.peakHours.map((h: any) =>
    `${h.hour.toString().padStart(2, '0')}:00 — ${h.newListings} novih, ${h.alerts} alertov, ${h.runs} runov (${h.runs > 0 ? Math.round((h.successes / h.runs) * 100) : 0}% uspeh)`
  ).join('\n');

  return `Si ekspert za optimizacijo scrape schedule za slovenske spletne oglase.

Analiziraj naslednji monitor in predlagaj optimalen schedule:

*Monitor:* ${monitor.name}
*Vir:* ${monitor.source}
*Trenutni interval:* ${monitor.intervalMinutes} minut
*Trenutni urnik:* ${monitor.runStartHour != null && monitor.runEndHour != null ? `${monitor.runStartHour}-${monitor.runEndHour}` : '24/7 (vedno)'}

*Statistika (zadnjih 30 dni):*
- Skupaj poganjanj: ${data.totalRuns}
- Novih oglasov: ${data.totalNew}
- Alertov poslanih: ${data.totalAlerts}
- Success rate: ${data.successRate}%
- Povprečni čas poganjanja: ${data.avgDuration}ms
- Skupaj oglasov v bazi: ${data.listingsCount}

*Aktivnost po urah (top 5):*
${hourStats}

Pravila:
1. Če so novi oglasi koncentrirani v določenih urah, predlagaj ožji schedule window
2. Če je success rate < 50%, predlagaj daljši interval (manj obremenitve)
3. Če je 0 novih oglasov v zadnjih 30 dneh, predlagaj daljši interval (vsakih 2-4 ure)
4. Če je veliko novih oglasov (>5 na dan), predlagaj krajšši interval (vsakih 10-15 min)
5. Upoštevaj AI klice — vsako poganjanje z AI analizo = 1 AI klic na nov oglas

Odgovori LE z JSON v tej obliki:
{
  "suggested_interval": <number minut, 5-1440>,
  "suggested_window": "<"6-23" ali "24/7">,
  "reasoning": "<kratek razlog v slovenščini, max 300 znakov>",
  "expected_new_listings_per_day": <number>,
  "ai_calls_per_day": <number>,
  "confidence": <0-100>
}`;
}

function clampInt(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
