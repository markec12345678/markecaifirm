// v9.65: Internal Scheduler — setInterval namesto zunanjega cron-a.
//
// Lokalni scheduler ki se zažene ob server startup (prek instrumentation.ts).
// Vsakih 30 minut klice runDueMonitors() + maybeSendHeartbeat() — isto kot zunanji cron.
//
// PREDNOSTI:
// - Uporabnik NE rabi registracije na cron-job.org
// - Brezplačno (ni limitov)
// - Samodejno (starta z aplikacijo)
// - Local-first (vse v aplikaciji)

import { logger } from '@/lib/logger';
import { db } from '@/lib/db';

const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440; // 24h

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;
let lastRunStatus: 'success' | 'error' | 'never' = 'never';
let lastRunError: string | null = null;
let totalRuns = 0;
let successfulRuns = 0;
let failedRuns = 0;
let startedAt: Date | null = null;

interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
}

async function getSchedulerConfig(): Promise<SchedulerConfig> {
  try {
    const s = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: {
        internalSchedulerEnabled: true,
        internalSchedulerIntervalMin: true,
      },
    });
    return {
      enabled: s?.internalSchedulerEnabled ?? true,
      intervalMinutes: Math.min(
        MAX_INTERVAL_MINUTES,
        Math.max(MIN_INTERVAL_MINUTES, s?.internalSchedulerIntervalMin ?? DEFAULT_INTERVAL_MINUTES)
      ),
    };
  } catch {
    return { enabled: true, intervalMinutes: DEFAULT_INTERVAL_MINUTES };
  }
}

async function runScheduledTask() {
  if (isRunning) {
    logger.info('internal-scheduler', 'Already running — skip');
    return;
  }

  isRunning = true;
  lastRunAt = new Date();
  totalRuns++;

  try {
    logger.info('internal-scheduler', 'Starting scheduled run...');

    const { runDueMonitors, maybeSendHeartbeat } = await import('@/lib/pipeline');

    const [monitorsResult, heartbeatResult] = await Promise.all([
      runDueMonitors(),
      maybeSendHeartbeat(),
    ]);

    successfulRuns++;
    lastRunStatus = 'success';
    lastRunError = null;

    logger.info('internal-scheduler', `Run completed: monitors ran=${monitorsResult.ran}, skipped=${monitorsResult.skipped}, heartbeat=${heartbeatResult.sent ? 'sent' : 'skip'}`);
  } catch (err: any) {
    failedRuns++;
    lastRunStatus = 'error';
    lastRunError = err?.message ?? 'Unknown error';
    logger.error('internal-scheduler', 'Scheduled run failed', err);
  } finally {
    isRunning = false;
  }
}

export async function startInternalScheduler() {
  if (schedulerInterval) {
    logger.info('internal-scheduler', 'Already running');
    return;
  }

  const config = await getSchedulerConfig();

  if (!config.enabled) {
    logger.info('internal-scheduler', 'Disabled in settings — skipping');
    return;
  }

  const intervalMs = config.intervalMinutes * 60 * 1000;
  startedAt = new Date();

  logger.info('internal-scheduler', `Started — interval: ${config.intervalMinutes} min`);

  setTimeout(() => {
    runScheduledTask();
  }, 5000);

  schedulerInterval = setInterval(() => {
    runScheduledTask();
  }, intervalMs);

  process.on('SIGTERM', () => {
    stopInternalScheduler();
  });
  process.on('SIGINT', () => {
    stopInternalScheduler();
  });
}

export function stopInternalScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('internal-scheduler', 'Stopped');
  }
}

export async function triggerManualRun() {
  logger.info('internal-scheduler', 'Manual trigger');
  await runScheduledTask();
  return getSchedulerStatus();
}

export function getSchedulerStatus() {
  return {
    running: schedulerInterval !== null,
    isExecuting: isRunning,
    startedAt: startedAt?.toISOString() ?? null,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunStatus,
    lastRunError,
    totalRuns,
    successfulRuns,
    failedRuns,
    uptimeSeconds: startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0,
  };
}

export async function restartScheduler() {
  logger.info('internal-scheduler', 'Restarting with new config...');
  stopInternalScheduler();
  await startInternalScheduler();
  return getSchedulerStatus();
}
