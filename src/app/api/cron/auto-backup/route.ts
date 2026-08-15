// v8.42: Auto-backup cron — daily JSON backup to /backups/ directory.
// GET /api/cron/auto-backup?key=<MONITOR_CRON_KEY>
// POST /api/cron/auto-backup?key=<MONITOR_CRON_KEY>  (same handler)
//
// Schedule (configure externally): daily at 02:00 (after daily-brain-snapshot
// at 00:00 and cleanup-drafts at 02:00 — slight overlap OK since these are
// independent jobs; auto-backup runs after brain snapshot to capture the
// latest BrainSnapshot row in the backup).
//
// Example crontab: 0 2 * * * curl -s "http://localhost:3000/api/cron/auto-backup?key=$MONITOR_CRON_KEY"
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset (dev mode), no auth required.
//
// What it does:
//   1. Calls exportBackup() — fetches all 18 tables, builds BackupData JSON
//   2. Calls saveBackupToFile() — writes to /backups/backup-<timestamp>.json
//   3. Calls cleanupOldBackups(30) — deletes backups older than the newest 30
//
// Returns: { ok, saved: { path, sizeKB, filename }, cleanup: { deleted, kept, total } }
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60s

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { exportBackup, saveBackupToFile, cleanupOldBackups } from '@/lib/backup/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as daily-brain-snapshot, cleanup-drafts, etc.
 * If MONITOR_CRON_KEY env var is set, the request's `key` query param must
 * match. If env var is unset (dev mode), no auth required.
 */
function checkCronAuth(req: NextRequest): boolean {
  const expectedKey = process.env.MONITOR_CRON_KEY;
  if (!expectedKey) return true; // dev mode — no auth required
  try {
    const url = new URL(req.url);
    return url.searchParams.get('key') === expectedKey;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  return handleAutoBackup(req);
}

export async function POST(req: NextRequest) {
  return handleAutoBackup(req);
}

async function handleAutoBackup(req: NextRequest) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/auto-backup', 'starting daily JSON auto-backup');

    // 1. Export all tables
    const backup = await exportBackup();
    logger.info('/api/cron/auto-backup', 'export complete', {
      totalRecords: backup.data.stats.totalRecords,
      sizeKB: backup.sizeKB,
    });

    // 2. Save to file
    const saved = await saveBackupToFile(backup);
    logger.info('/api/cron/auto-backup', `saved to ${saved.filename}`, {
      sizeKB: saved.sizeKB,
    });

    // 3. Cleanup old backups (keep last 30)
    const cleanup = await cleanupOldBackups(30);
    if (cleanup.deleted > 0) {
      logger.info('/api/cron/auto-backup', `cleaned up ${cleanup.deleted} old backups`, cleanup);
    }

    return NextResponse.json({
      ok: true,
      saved: {
        path: saved.path,
        filename: saved.filename,
        sizeKB: saved.sizeKB,
      },
      stats: backup.data.stats,
      cleanup,
      source: 'v8.42-auto-backup',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/cron/auto-backup', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka pri auto-backup', source: 'v8.42-auto-backup' },
      { status: 500 }
    );
  }
}
