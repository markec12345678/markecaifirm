import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') ?? '';
const BACKUP_DIR = path.join(process.cwd(), 'backups');

/**
 * GET /api/backup
 * Returns current database size + info, or downloads the .db file with ?download=1
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const download = url.searchParams.get('download') === '1';

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
}

/**
 * POST /api/backup
 * Restore from uploaded .db file (multipart form data: field "db")
 *
 * Safety: writes to a backup of current db first, then replaces.
 * After restore, the user must restart the app (or it will use cached Prisma client).
 */
export async function POST(req: NextRequest) {
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
    return NextResponse.json({ error: e?.message ?? 'Napaka pri brisanju' }, { status: 500 });
  }
}
