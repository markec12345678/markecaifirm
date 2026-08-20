import { NextRequest, NextResponse } from 'next/server';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';
import { exportBackup, getDbStats, BACKUP_VERSION } from '@/lib/backup/backup';

const execAsync = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Resolve the SQLite file path from DATABASE_URL.
 *
 * Prisma resolves relative `file:` paths against the schema directory
 * (prisma/), but Node's fs resolves relative paths against process.cwd().
 * This normalizes the path so fs.stat/readFile/writeFile hit the real file.
 *
 * v8.93 FIX: previously DB_PATH was `DATABASE_URL.replace('file:', '')`,
 * which yielded e.g. `./dev.db` resolved against cwd -> ENOENT (the actual
 * db lives at prisma/dev.db). This broke GET /api/backup (info + download)
 * and POST /api/backup (restore) entirely — a data-safety feature was dead.
 */
function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL ?? '').replace(/^file:/, '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  // Try cwd-relative first (legacy setups), then prisma-relative (Prisma convention).
  const candidates = [
    path.join(process.cwd(), raw),
    path.join(process.cwd(), 'prisma', raw),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Not found yet (e.g. fresh install before db:push) — assume Prisma convention.
  return path.join(process.cwd(), 'prisma', raw);
}

const DB_PATH = resolveDbPath();
const BACKUP_DIR = path.join(process.cwd(), 'backups');

/**
 * GET /api/backup
 * Returns current database size + info, or downloads the .db file with ?download=1
 *
 * v8.42: NEW ?format=json mode — exports ALL 18 tables as a structured JSON
 * BackupData object (with version, createdAt, table counts, stats). This is
 * the portable human-readable backup. Existing ?download=1 raw .db mode
 * is preserved for binary backups. ?format=stats returns just table counts.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const download = url.searchParams.get('download') === '1';
    const format = url.searchParams.get('format');

    // v8.42: JSON backup mode — portable, human-readable, all 18 tables
    if (format === 'json') {
      try {
        const result = await exportBackup();
        const json = JSON.stringify(result.data, null, 2);
        const filename = `markec-ai-firm-backup-${new Date().toISOString().slice(0, 10)}.json`;
        logger.info('/api/backup', `format=json exported (v8.42)`, {
          sizeKB: result.sizeKB,
          totalRecords: result.data.stats.totalRecords,
        });
        return new NextResponse(json, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-cache',
            'X-Backup-Version': BACKUP_VERSION,
          },
        });
      } catch (e: any) {
        logger.error('/api/backup', 'format=json export failed', e);
        return NextResponse.json({ error: e?.message ?? 'Backup failed' }, { status: 500 });
      }
    }

    // v8.42: Stats mode — quick counts for UI preview (no full export)
    if (format === 'stats') {
      try {
        const stats = await getDbStats();
        return NextResponse.json({ ok: true, ...stats, version: BACKUP_VERSION });
      } catch (e: any) {
        logger.error('/api/backup', 'format=stats failed', e);
        return NextResponse.json({ error: e?.message ?? 'Stats failed' }, { status: 500 });
      }
    }

    if (!DB_PATH) {
      return NextResponse.json({ error: 'DATABASE_URL ni nastavljen' }, { status: 500 });
    }

    try {
      const stat = await fs.stat(DB_PATH);

      if (download) {
        const data = await fs.readFile(DB_PATH);
        const filename = `markec-ai-firm-${new Date().toISOString().slice(0, 10)}.db`;
        return new NextResponse(data, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(data.length),
          },
        });
      }

      return NextResponse.json({
        ok: true,
        path: DB_PATH,
        sizeBytes: stat.size,
        sizeMb: (stat.size / 1024 / 1024).toFixed(2),
        lastModified: stat.mtime.toISOString(),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Napaka pri dostopu do baze' }, { status: 500 });
    }

  } catch (err) {
    logger.error("/api/backup", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

/**
 * POST /api/backup
 * Restore from uploaded .db file (multipart form data: field "db")
 *
 * Safety: writes to a backup of current db first, then replaces.
 * After restore, the user must restart the app (or it will use cached Prisma client).
 */
export async function POST(req: NextRequest) {
  try {
    if (!DB_PATH) {
      return NextResponse.json({ error: 'DATABASE_URL ni nastavljen' }, { status: 500 });
    }

    try {
      const formData = await req.formData();
      const file = formData.get('db') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'Manjka datoteka (field: db)' }, { status: 400 });
      }
      if (file.size > 100 * 1024 * 1024) {
        return NextResponse.json({ error: 'Datoteka prevelika (max 100MB)' }, { status: 400 });
      }

      // Ensure backup dir exists
      await fs.mkdir(BACKUP_DIR, { recursive: true });

      // 1. Backup current db
      const backupPath = path.join(BACKUP_DIR, `pre-restore-${Date.now()}.db`);
      await fs.copyFile(DB_PATH, backupPath);

      // 2. Validate uploaded file is a SQLite db (magic header "SQLite format 3\0")
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const header = Buffer.from(bytes.slice(0, 16)).toString('latin1');
      if (!header.startsWith('SQLite format 3')) {
        // Restore current db (we already copied it)
        await fs.unlink(backupPath);
        return NextResponse.json({ error: 'Datoteka ni veljavna SQLite baza (header mismatch)' }, { status: 400 });
      }

      // 3. Replace current db
      await fs.writeFile(DB_PATH, bytes);

      // 4. Try to run prisma db push to ensure schema is in sync (best-effort)
      try {
        await execAsync('bun run db:push', { cwd: process.cwd(), timeout: 30_000 });
      } catch {
        // Ignore - schema validation can be done manually by user
      }

      return NextResponse.json({
        ok: true,
        message: 'Baza obnovljena. PONOVNO ZAGANJANJE aplikacije priporočeno (Prisma client cache).',
        backupPath,
        sizeBytes: bytes.length,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Napaka pri restore' }, { status: 500 });
    }

  } catch (err) {
    logger.error("/api/backup", "POST handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

/**
 * DELETE /api/backup
 * Clears all listings/alerts/runLogs/heartbeats but keeps monitors + settings.
 * Useful for fresh start without losing monitor config.
 */
export async function DELETE() {
  try {
    // Delete in order to respect FK constraints
    await Promise.all([
      // Delete all alerts first (they reference listings)
      (await import('@/lib/db')).db.alert.deleteMany({}),
    ]);
    const db = (await import('@/lib/db')).db;
    await db.listing.deleteMany({});
    await db.runLog.deleteMany({});
    await db.heartbeatLog.deleteMany({});
    return NextResponse.json({ ok: true, message: 'Vsi podatki izbrisani (monitorji in nastavitve ohranjeni).' });
  } catch (e: any) {
    logger.error("/api/backup", "DELETE handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka pri brisanju' }, { status: 500 });
  }
}
