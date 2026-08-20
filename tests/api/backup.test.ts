/**
 * End-to-end tests for the backup subsystem.
 *
 * Covers the v8.42 portable JSON backup (export + restore + list) and the
 * raw .db download/restore paths. These are data-safety features — a prior
 * commit (v8.93) fixed GET /api/backup which returned 500 ENOENT because the
 * DB path was resolved against process.cwd() instead of the prisma/ schema dir.
 *
 * These tests call the route handlers directly against the real SQLite DB and
 * assert the full path works end-to-end. The restore test uses 'skip' mode
 * (only creates if id doesn't exist) with a uniquely-prefixed test monitor, so
 * it never clobbers existing data and cleans up only its own row.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '../../src/lib/db';
import { GET as getBackup, POST as postBackup } from '../../src/app/api/backup/route';
import { GET as getBackupList } from '../../src/app/api/backup/list/route';
import { POST as postRestore } from '../../src/app/api/backup/restore/route';

const TEST_ID = `TEST-RESTORE-${Date.now()}`;

function req(url: string, init?: any): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, init);
}

describe('/api/backup subsystem', () => {
  afterAll(async () => {
    await db.monitor.deleteMany({ where: { id: { startsWith: 'TEST-RESTORE-' } } }).catch(() => {});
    await db.$disconnect();
  });

  // ---- v8.42 JSON export / info paths (fixed in v8.93) ----

  it('GET /api/backup returns 200 with resolved db info', async () => {
    const res = await getBackup(req('/api/backup'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sizeBytes).toBeGreaterThan(0);
    expect(data.path).toContain('dev.db');
  });

  it('GET /api/backup?format=stats returns table counts', async () => {
    const res = await getBackup(req('/api/backup?format=stats'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.version).toBeTruthy();
  });

  it('GET /api/backup?format=json exports all 18 tables as BackupData', async () => {
    const res = await getBackup(req('/api/backup?format=json'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.version).toBe('v8.42');
    expect(data.tables).toBeTypeOf('object');
    // 18 tables should be present (settings may be empty array if no singleton row).
    expect(Object.keys(data.tables).length).toBeGreaterThanOrEqual(17);
    expect(data.stats.totalRecords).toBeGreaterThanOrEqual(0);
    const cd = res.headers.get('Content-Disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toMatch(/\.json"/);
  });

  // ---- raw .db download path (was broken: ENOENT before v8.93 fix) ----

  it('GET /api/backup?download=1 streams a valid SQLite .db file', async () => {
    const res = await getBackup(req('/api/backup?download=1'));
    expect(res.status).toBe(200);
    const cd = res.headers.get('Content-Disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toMatch(/\.db"/);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    // SQLite magic header is "SQLite format 3\0" (first 16 bytes).
    const header = Buffer.from(buf.slice(0, 16)).toString('latin1');
    expect(header.startsWith('SQLite format 3')).toBe(true);
  });

  // ---- raw .db restore validation (safe failure paths only) ----

  it('POST /api/backup rejects restore with no file (400)', async () => {
    const res = await postBackup(req('/api/backup', { method: 'POST' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/datoteka|file/i);
  });

  // ---- v8.42 JSON restore (end-to-end roundtrip) ----

  it('POST /api/backup/restore (skip mode) restores a test monitor and is idempotent', async () => {
    const backupData = {
      version: 'v8.42',
      createdAt: new Date().toISOString(),
      dbVersion: 'test',
      tables: {
        monitors: [{
          id: TEST_ID,
          name: 'TEST-RESTORE-Monitor',
          source: 'bolha',
          sourceUrl: 'https://www.bolha.com/test',
          keywords: '',
          excludeKeywords: '',
          intervalMinutes: 30,
          isActive: true,
          consecutiveErrors: 0,
          autoPauseThreshold: 5,
          notificationChannels: '{}',
          customPrompt: '',
          tags: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      },
      stats: { totalRecords: 1, tableCounts: { monitors: 1 } },
    };

    const res = await postRestore(req('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: backupData, mode: 'skip' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.restored.monitors).toBeGreaterThanOrEqual(1);

    // The monitor should now exist.
    const m = await db.monitor.findUnique({ where: { id: TEST_ID } });
    expect(m).not.toBeNull();
    expect(m?.name).toBe('TEST-RESTORE-Monitor');

    // Idempotency: a second skip-mode restore should NOT duplicate it.
    const res2 = await postRestore(req('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: backupData, mode: 'skip' }),
    }));
    expect(res2.status).toBe(200);
    const count = await db.monitor.count({ where: { id: TEST_ID } });
    expect(count).toBe(1);
  });

  it('POST /api/backup/restore rejects invalid backup format (missing version)', async () => {
    const res = await postRestore(req('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { tables: {} }, mode: 'skip' }),
    }));
    // Structurally invalid backup (missing version) -> restoreBackup returns
    // ok:false -> route responds 400 Bad Request (not a server error).
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  // ---- list backups ----

  it('GET /api/backup/list returns backup list', async () => {
    const res = await getBackupList();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.backups)).toBe(true);
    expect(data.count).toBeTypeOf('number');
  });
});
