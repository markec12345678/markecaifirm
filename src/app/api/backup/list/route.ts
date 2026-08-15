// v8.42: List available JSON backup files in /backups/ directory.
// GET /api/backup/list
//
// Returns: { ok, backups: Array<{ filename, sizeKB, createdAt }> }
//
// Backups are stored as /backups/backup-YYYY-MM-DDTHH-MM-SS-mmmZ.json by
// the auto-backup cron (and the "Poženi auto-backup zdaj" UI button).
// The list is sorted newest-first by mtime.
//
// runtime='nodejs', dynamic='force-dynamic'

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { listBackups } from '@/lib/backup/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const backups = await listBackups();
    return NextResponse.json({
      ok: true,
      backups,
      count: backups.length,
    });
  } catch (err: any) {
    logger.error('/api/backup/list', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka pri listanju backupov' },
      { status: 500 }
    );
  }
}
