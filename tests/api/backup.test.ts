/**
 * Integration test for /api/backup.
 *
 * Regression guard for the v8.93 path-resolution fix: the route computed
 * DB_PATH as `DATABASE_URL.replace('file:', '')` -> `./dev.db`, which Node's
 * fs resolves against process.cwd() (ENOENT) because the real db lives at
 * prisma/dev.db (Prisma resolves relative file: paths against the schema dir).
 *
 * This test calls the route handler directly and asserts the GET info + stats
 * endpoints return 200 with the resolved path, proving the fix holds.
 * If someone reverts resolveDbPath(), these tests fail with ENOENT -> 500.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '../../src/lib/db';
import { GET } from '../../src/app/api/backup/route';

function mockReq(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/backup${query}`);
}

describe('/api/backup — DB path resolution', () => {
  // Note: GET /api/backup reads the DB *file* (fs.stat) and table counts
  // (Prisma count = read). It does not write rows, so no setup/cleanup is
  // needed — and importantly no write-lock contention with the other DB-backed
  // test files that run concurrently against the same SQLite dev.db.

  afterAll(async () => {
    await db.$disconnect();
  });

  it('GET /api/backup returns 200 with resolved db info (not ENOENT)', async () => {
    const res = await GET(mockReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sizeBytes).toBeGreaterThan(0);
    expect(data.path).toContain('dev.db');
  });

  it('GET /api/backup?format=stats returns 200 with table counts', async () => {
    const res = await GET(mockReq('?format=stats'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.version).toBeTruthy();
  });
});
