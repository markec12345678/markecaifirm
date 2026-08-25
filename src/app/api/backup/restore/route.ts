// v8.42: Restore database from JSON backup.
// POST /api/backup/restore
//
// Body: { data: BackupData, mode: 'replace'|'merge'|'skip', tables?: string[] }
//   - data:     full BackupData object (must have version + tables)
//   - mode:     replace = delete all + insert (DANGEROUS — wipes existing data)
//               merge   = upsert by id (create if missing, update if exists)
//               skip    = only create if id doesn't exist (preserve current rows)
//   - tables:   optional array of plural table keys (e.g. ['trades', 'settings'])
//               to restore only those tables. Empty/undefined = all tables in backup.
//
// Returns: RestoreResult {
//   ok: boolean,
//   mode: string,
//   restored: Record<string, number>,  // per-table count
//   skipped: Record<string, number>,  // per-table count (skip mode)
//   errors: Array<{ table, error }>,
//   source: 'v8.42-restore',
// }
//
// Settings special: sensitive fields (API keys, tokens) are NEVER overwritten
// with the '***REDACTED***' sentinel — preserves the user's real keys across restore.
//
// Per-row + per-table try/catch — failures don't abort the whole restore.
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60s

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { restoreBackup, type BackupData, type RestoreOptions } from '@/lib/backup/backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Neveljaven JSON body' },
        { status: 400 }
      );
    }

    const data: BackupData | undefined = body?.data ?? body?.backup;
    if (!data) {
      return NextResponse.json(
        { error: 'Manjka "data" polje (BackupData objekt)' },
        { status: 400 }
      );
    }

    const mode = body?.mode ?? 'merge'; // default to safe merge mode
    if (!['replace', 'merge', 'skip'].includes(mode)) {
      return NextResponse.json(
        { error: `Neveljaven mode: "${mode}". Dovoljeni: replace | merge | skip` },
        { status: 400 }
      );
    }

    const tables: string[] | undefined = Array.isArray(body?.tables)
      ? body.tables.filter((t: any) => typeof t === 'string')
      : undefined;

    const options: RestoreOptions = { mode: mode as RestoreOptions['mode'], tables };

    logger.info('/api/backup/restore', 'starting restore', {
      mode,
      tablesCount: tables?.length ?? 0,
      backupVersion: data.version,
      backupCreatedAt: data.createdAt,
    });

    const result = await restoreBackup(data, options);

    logger.info('/api/backup/restore', 'restore complete', {
      ok: result.ok,
      mode: result.mode,
      errorsCount: result.errors.length,
    });

    // 200 even if some tables failed — the result body has the per-table
    // breakdown so the UI can show what worked and what didn't.
    // Only 500 if the whole restore was structurally invalid (handled inside restoreBackup).
    const status = result.ok ? 200 : 400;

    return NextResponse.json(result, { status });
  } catch (err: any) {
    logger.error('/api/backup/restore', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka pri restore', source: 'v8.42-restore' },
      { status: 500 }
    );
  }
}
