/**
 * Integration test for /api/cron/run-buy-requests.
 *
 * Regression guard: the cron previously created BuyRequestMatch rows with
 * matchBuyScore: null (a // TODO marker). This test proves the cron now
 * computes and stores a real buy score, and that re-running does not create
 * duplicate matches.
 *
 * Calls the route handler directly against the real SQLite DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '../../src/lib/db';
import { GET } from '../../src/app/api/cron/run-buy-requests/route';

const PREFIX = 'TEST-BUYSCORE-';
const listingTitle = `${PREFIX}VW Golf 5`;

function mockReq(): NextRequest {
  const url = new URL('http://localhost:3000/api/cron/run-buy-requests');
  return new NextRequest(url, { method: 'GET' });
}

describe('/api/cron/run-buy-requests — buy score stored on match', () => {
  let monitorId: string;
  let listingId: string;
  let buyRequestId: string;
  const matchIds: string[] = [];

  beforeAll(async () => {
    // Clean any leftover from a previous run.
    await db.buyRequestMatch.deleteMany({ where: { listing: { title: { startsWith: PREFIX } } } });
    await db.buyRequest.deleteMany({ where: { title: { startsWith: PREFIX } } });
    await db.listing.deleteMany({ where: { title: { startsWith: PREFIX } } });

    // Monitor (tags left empty so the category filter is skipped).
    const monitor = await db.monitor.create({
      data: { name: `${PREFIX}Monitor`, source: 'bolha', sourceUrl: 'https://www.bolha.com/test' },
    });
    monitorId = monitor.id;

    // Listing priced well below AI estimated value -> strong discount -> high score.
    const listing = await db.listing.create({
      data: {
        monitorId,
        externalId: `${PREFIX}-ext-1`,
        title: listingTitle,
        priceText: '100 €',
        price: 100,
        url: 'https://example.com/buyscore-test',
        location: 'Ljubljana',
        aiScore: 9,
        aiRisk: 1,
        aiVerdict: 'PRILIKA',
        aiEstimatedValue: 200,
        previousPrice: 130,
        priceDroppedAt: new Date(),
      },
    });
    listingId = listing.id;

    // Active buy request whose title matches the listing.
    const buyRequest = await db.buyRequest.create({
      data: { title: listingTitle, category: '', isActive: true },
    });
    buyRequestId = buyRequest.id;
  });

  afterAll(async () => {
    await db.buyRequestMatch.deleteMany({ where: { id: { in: matchIds } } }).catch(() => {});
    await db.buyRequestMatch.deleteMany({ where: { buyRequestId } }).catch(() => {});
    if (buyRequestId) await db.buyRequest.delete({ where: { id: buyRequestId } }).catch(() => {});
    if (listingId) await db.listing.delete({ where: { id: listingId } }).catch(() => {});
    if (monitorId) await db.monitor.delete({ where: { id: monitorId } }).catch(() => {});
    await db.$disconnect();
  });

  it('runs the cron and returns 200 with a positive match count', async () => {
    const res = await GET(mockReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalNewMatches).toBeGreaterThanOrEqual(1);
  });

  it('stores a BuyRequestMatch with a non-null, positive buy score', async () => {
    const match = await db.buyRequestMatch.findUnique({
      where: { buyRequestId_listingId: { buyRequestId, listingId } },
    });
    expect(match).not.toBeNull();
    if (match) {
      matchIds.push(match.id);
      expect(match.matchBuyScore).not.toBeNull();
      expect(match.matchBuyScore).toBeGreaterThan(0);
      expect(match.matchPrice).toBe(100);
    }
  });

  it('does not create a duplicate match on a second run (dedup)', async () => {
    const before = await db.buyRequestMatch.count({ where: { buyRequestId, listingId } });
    await GET(mockReq()); // second run
    const after = await db.buyRequestMatch.count({ where: { buyRequestId, listingId } });
    expect(after).toBe(before);
  });
});
