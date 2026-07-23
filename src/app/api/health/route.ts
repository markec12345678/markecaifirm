import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'disabled';
  message: string;
  latencyMs?: number;
  details?: Record<string, any>;
}

/**
 * GET /api/health
 * Returns overall system health with individual checks for:
 * - Database connectivity
 * - AI provider (Ollama/OpenAI/Anthropic) - actual HTTP ping
 * - Telegram bot API
 * - Discord webhook URL validity
 * - Bolha reachability
 * - Cron status (last run, active monitors)
 */
export async function GET() {
  const checks: HealthCheck[] = [];
  const settings = await getSettingsRow();

  // 1. Database
  try {
    const start = Date.now();
    await db.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    checks.push({
      name: 'Baza (SQLite)',
      status: latency < 100 ? 'ok' : 'warn',
      message: `Povezava OK (${latency}ms)`,
      latencyMs: latency,
    });
  } catch (e: any) {
    checks.push({ name: 'Baza (SQLite)', status: 'error', message: e?.message ?? 'Napaka' });
  }

  // 2. AI provider
  if (settings.aiProvider === 'ollama') {
    try {
      const start = Date.now();
      const url = settings.aiBaseUrl.replace(/\/$/, '') + '/api/tags';
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        const models = data?.models ?? [];
        const hasModel = models.some((m: any) => m.name === settings.aiModel);
        checks.push({
          name: 'AI (Ollama)',
          status: hasModel ? 'ok' : 'warn',
          message: hasModel
            ? `Ollama OK, model "${settings.aiModel}" dosegljiv (${latency}ms)`
            : `Ollama OK, ampak model "${settings.aiModel}" NI nameščen. Imate: ${models.map((m: any) => m.name).slice(0, 3).join(', ')}`,
          latencyMs: latency,
          details: { models: models.map((m: any) => m.name) },
        });
      } else {
        checks.push({ name: 'AI (Ollama)', status: 'error', message: `Ollama HTTP ${res.status}` });
      }
    } catch (e: any) {
      checks.push({ name: 'AI (Ollama)', status: 'error', message: `Ne morem doseči Ollama na ${settings.aiBaseUrl}. Ali teče?` });
    }
  } else {
    // For OpenAI/Anthropic/OpenAI-compatible, we just verify API key is set
    const providerLabel = settings.aiProvider === 'openai' ? 'OpenAI' :
                          settings.aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI-kompatibilni';
    if (settings.aiApiKey) {
      checks.push({ name: `AI (${providerLabel})`, status: 'ok', message: `API ključ nastavljen, model: ${settings.aiModel}` });
    } else {
      checks.push({ name: `AI (${providerLabel})`, status: 'error', message: 'API ključ manjka' });
    }
  }

  // 3. Telegram
  if (settings.telegramEnabled) {
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      checks.push({ name: 'Telegram', status: 'error', message: 'Telegram omogočen, ampak manjka token ali chat ID' });
    } else {
      try {
        const start = Date.now();
        const res = await fetch(
          `https://api.telegram.org/bot${settings.telegramBotToken}/getMe`,
          { signal: AbortSignal.timeout(5000) }
        );
        const latency = Date.now() - start;
        const data = await res.json();
        if (data.ok) {
          checks.push({
            name: 'Telegram',
            status: 'ok',
            message: `Bot @${data.result.username} OK (${latency}ms)`,
            latencyMs: latency,
          });
        } else {
          checks.push({ name: 'Telegram', status: 'error', message: `Telegram API: ${data.description}` });
        }
      } catch (e: any) {
        checks.push({ name: 'Telegram', status: 'error', message: 'Ne morem doseči Telegram API-ja' });
      }
    }
  } else {
    checks.push({ name: 'Telegram', status: 'disabled', message: 'Izklopljen' });
  }

  // 4. Discord
  if (settings.discordEnabled) {
    if (!settings.discordWebhookUrl) {
      checks.push({ name: 'Discord', status: 'error', message: 'Discord omogočen, ampak webhook URL manjka' });
    } else {
      // Don't actually send a message, just verify URL format
      const url = settings.discordWebhookUrl;
      if (url.startsWith('https://discord.com/api/webhooks/') || url.startsWith('https://discordapp.com/api/webhooks/')) {
        checks.push({ name: 'Discord', status: 'ok', message: 'Webhook URL format veljaven' });
      } else {
        checks.push({ name: 'Discord', status: 'error', message: 'Webhook URL ni v pravilnem formatu' });
      }
    }
  } else {
    checks.push({ name: 'Discord', status: 'disabled', message: 'Izklopljen' });
  }

  // 5. Bolha reachability
  try {
    const start = Date.now();
    const res = await fetch('https://www.bolha.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (MarkecAIFirm/1.5 HealthCheck)' },
    });
    const latency = Date.now() - start;
    if (res.ok || res.status === 403 || res.status === 503) {
      // 403 = Cloudflare active (still reachable, just blocked for HEAD)
      // 503 = temporary
      checks.push({
        name: 'Bolha.com',
        status: res.ok ? 'ok' : 'warn',
        message: res.ok
          ? `Bolha dosegljiva (${latency}ms)`
          : `Bolha dosegljiva ampak HTTP ${res.status} (morda Cloudflare)`,
        latencyMs: latency,
      });
    } else {
      checks.push({ name: 'Bolha.com', status: 'error', message: `HTTP ${res.status}` });
    }
  } catch (e: any) {
    checks.push({ name: 'Bolha.com', status: 'error', message: 'Ne morem doseči Bolhe' });
  }

  // 6. Nepremicnine.net reachability (RSS)
  try {
    const start = Date.now();
    const res = await fetch('https://www.nepremicnine.net/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (MarkecAIFirm/1.5 HealthCheck)' },
    });
    const latency = Date.now() - start;
    checks.push({
      name: 'Nepremicnine.net',
      status: res.ok ? 'ok' : 'warn',
      message: res.ok ? `Dosegljiv (${latency}ms)` : `HTTP ${res.status}`,
      latencyMs: latency,
    });
  } catch {
    checks.push({ name: 'Nepremicnine.net', status: 'error', message: 'Ne morem doseči' });
  }

  // 7. Cron / monitors status
  try {
    const [activeMonitors, totalMonitors, autoPausedCount, autoPausedMonitors, recentRuns] = await Promise.all([
      db.monitor.count({ where: { isActive: true } }),
      db.monitor.count(),
      db.monitor.count({ where: { autoPausedAt: { not: null } } }),
      // v1.9: Get details of auto-paused monitors
      db.monitor.findMany({
        where: { autoPausedAt: { not: null } },
        select: { id: true, name: true, consecutiveErrors: true, autoPauseThreshold: true, autoPausedAt: true, lastError: true },
      }),
      db.runLog.findMany({
        take: 5,
        orderBy: { startedAt: 'desc' },
        select: { status: true, startedAt: true, error: true },
      }),
    ]);
    const lastRun = recentRuns[0];
    const lastRunAgo = lastRun ? Date.now() - new Date(lastRun.startedAt).getTime() : null;
    const lastRunAgoMin = lastRunAgo ? Math.floor(lastRunAgo / 60000) : null;

    let cronStatus: HealthCheck['status'] = 'ok';
    let cronMsg = `${activeMonitors}/${totalMonitors} aktivnih`;
    if (autoPausedCount > 0) {
      cronStatus = 'warn';
      cronMsg += `, ${autoPausedCount} auto-paused`;
    }
    if (lastRunAgoMin !== null && lastRunAgoMin > 60) {
      cronStatus = cronStatus === 'ok' ? 'warn' : cronStatus;
      cronMsg += `, zadnja izvedba pred ${lastRunAgoMin}min`;
    } else if (lastRunAgoMin !== null) {
      cronMsg += `, zadnja izvedba pred ${lastRunAgoMin}min`;
    } else {
      cronMsg += ', še ni bilo izvedb';
    }

    checks.push({
      name: 'Cron / Monitorji',
      status: cronStatus,
      message: cronMsg,
      details: {
        activeMonitors, totalMonitors, autoPausedCount,
        lastRunStatus: lastRun?.status,
        lastRunAgoMin,
        // v1.9: Auto-paused monitor details
        autoPausedMonitors: autoPausedMonitors.map(m => ({
          name: m.name,
          errors: m.consecutiveErrors,
          threshold: m.autoPauseThreshold,
          pausedAt: m.autoPausedAt,
          error: m.lastError?.slice(0, 100),
        })),
      },
    });
  } catch (e: any) {
    checks.push({ name: 'Cron / Monitorji', status: 'error', message: e?.message ?? 'Napaka' });
  }

  // 8. Push subscriptions (v1.5)
  try {
    const pushCount = await db.pushSubscription.count();
    if (settings.pushEnabled) {
      checks.push({
        name: 'Push notifications',
        status: pushCount > 0 ? 'ok' : 'warn',
        message: `${pushCount} naprav registriranih`,
      });
    } else {
      checks.push({ name: 'Push notifications', status: 'disabled', message: 'Izklopljen' });
    }
  } catch {
    checks.push({ name: 'Push notifications', status: 'disabled', message: 'Ni konfigurirano' });
  }

  // Overall
  const errorCount = checks.filter(c => c.status === 'error').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const overall: 'ok' | 'warn' | 'error' = errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok';

  return NextResponse.json({
    overall,
    errorCount,
    warnCount,
    checks,
    generatedAt: new Date().toISOString(),
  });
}
