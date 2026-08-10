// v7.43: Scraper Auto-Recovery — avtomatski Playwright fallback ko fetch odpove.
//
// Ko fetchWithAntiDetection vrne Cloudflare challenge ali 0 rezultatov,
// ta cron avtomatsko ponovi z Playwright (headless browser).
//
// Pregleda zadnje 10 runLog-ov z status='error':
// 1. Preveri ali je napaka Cloudflare/timeout povezana
// 2. Če ja in je Playwright omogočen, ponovi monitor z PW fallback-om
// 3. Spremlja vzorec napak — če monitor pada 3x zapored, priporoči PW
//
// GET /api/cron/scraper-recovery?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { runMonitor } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RECOVERABLE_ERRORS = [
  'cloudflare',
  'cf-challenge',
  'just a moment',
  'timeout',
  'econnreset',
  'enotfound',
  'socket hang up',
  '429',
  '503',
  'prekratko', // 'too short' — Bolha scraper detects this
];

export async function GET(req: NextRequest) {
  try {
    const expectedKey = process.env.MONITOR_CRON_KEY;
    if (expectedKey) {
      const url = new URL(req.url);
      if (url.searchParams.get('key') !== expectedKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const settings = await getSettingsRow();

    // Find monitors with recent errors
    const recentErrors = await db.runLog.findMany({
      where: {
        status: 'error',
        startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last 1h
      },
      include: {
        monitor: { select: { id: true, name: true, source: true, isActive: true, lastError: true, consecutiveErrors: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    if (recentErrors.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No recent scraper errors' });
    }

    // Group by monitor
    const errorByMonitor = new Map<string, { monitor: any; errors: typeof recentErrors; recoverable: boolean }>();
    for (const log of recentErrors) {
      const m = log.monitor;
      if (!m) continue;
      const key = m.id;
      if (!errorByMonitor.has(key)) {
        const error = log.error || m.lastError || '';
        const isRecoverable = RECOVERABLE_ERRORS.some(e => error.toLowerCase().includes(e));
        errorByMonitor.set(key, { monitor: m, errors: [], recoverable: isRecoverable });
      }
      errorByMonitor.get(key)!.errors.push(log);
    }

    // Check which monitors need recovery
    const recoveryCandidates = Array.from(errorByMonitor.values())
      .filter(x => x.recoverable && x.monitor.isActive && x.monitor.consecutiveErrors >= 2)
      .slice(0, 5); // max 5 recovery attempts per run

    if (recoveryCandidates.length === 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'No recoverable errors detected',
        summary: {
          totalErrors: recentErrors.length,
          monitorsWithErrors: errorByMonitor.size,
          recoverable: 0,
        },
      });
    }

    // Attempt recovery via Playwright retry
    const results: any[] = [];

    for (const candidate of recoveryCandidates) {
      const m = candidate.monitor;
      logger.info('/api/cron/scraper-recovery', `Attempting recovery for ${m.name} (${m.consecutiveErrors} consecutive errors)`);

      try {
        // Re-run the monitor — pipeline will try fetchWithAntiDetection first,
        // and if that fails with Cloudflare, it falls back to scrapeBolhaWithPlaywright
        // if playwrightEnabled is true in settings.
        const result = await runMonitor(m.id);

        results.push({
          monitorId: m.id,
          monitorName: m.name,
          source: m.source,
          recovered: result.status === 'ok' || result.status === 'empty',
          status: result.status,
          newListings: result.newListings,
          error: result.error,
        });

        // If recovery successful, reset consecutive errors
        if (result.status === 'ok' || result.status === 'empty') {
          await db.monitor.update({
            where: { id: m.id },
            data: { consecutiveErrors: 0, autoPausedAt: null, lastError: null },
          });
          logger.info('/api/cron/scraper-recovery', `✅ Recovered ${m.name}`);
        }
      } catch (e: any) {
        results.push({
          monitorId: m.id,
          monitorName: m.name,
          recovered: false,
          error: e?.message ?? 'Unknown',
        });
      }
    }

    // Alert if recovery failed for any monitor
    const failedRecoveries = results.filter(r => !r.recovered);
    if (failedRecoveries.length > 0 && settings.telegramEnabled && settings.telegramBotToken) {
      let alert = `🔧 *SCRAPER RECOVERY* — ${failedRecoveries.length} monitor(jev) ne deluje\n\n`;
      for (const f of failedRecoveries) {
        alert += `❌ *${f.monitorName}* (${f.source})\n`;
        alert += `   Napaka: ${f.error?.slice(0, 80) ?? 'neznan'}\n\n`;
      }
      alert += `_Preveri URL ali omogoci Playwright fallback v Nastavitvah_`;

      try {
        await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          alert,
        );
      } catch { /* ignore */ }
    }

    const recoveredCount = results.filter(r => r.recovered).length;

    logger.info('/api/cron/scraper-recovery', `Recovery complete: ${recoveredCount}/${results.length} recovered`);

    return NextResponse.json({
      ok: true,
      summary: {
        totalErrors: recentErrors.length,
        monitorsWithErrors: errorByMonitor.size,
        recoveryCandidates: recoveryCandidates.length,
        recovered: recoveredCount,
        failed: failedRecoveries.length,
      },
      results,
    });
  } catch (err: any) {
    logger.error('/api/cron/scraper-recovery', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
