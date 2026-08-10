/**
 * Smoke tests for /api/analytics/deal-funnel.
 * Verifies funnel stages, conversion rates, and bottleneck detection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/db';
import { GET } from '../../src/app/api/analytics/deal-funnel/route';

function mockReq(days: number = 90): any {
  const url = new URL(`http://localhost:3000/api/analytics/deal-funnel?days=${days}`);
  return { url, method: 'GET', nextUrl: url, headers: new Headers(), cookies: { get: () => undefined } };
}

describe('/api/analytics/deal-funnel', () => {
  const testListingIds: string[] = [];
  const testTradeIds: string[] = [];
  let testMonitorId: string;

  beforeAll(async () => {
    await db.listing.deleteMany({ where: { title: { startsWith: 'TEST-FUNNEL-' } } });
    await db.trade.deleteMany({ where: { title: { startsWith: 'TEST-FUNNEL-' } } });

    // Create a test monitor
    const monitor = await db.monitor.create({
      data: { name: 'TEST-FUNNEL-Monitor', source: 'bolha', sourceUrl: 'https://www.bolha.com/test' },
    });
    testMonitorId = monitor.id;

    // Stage 1: Discovered (PRILIKA listings)
    for (let i = 0; i < 10; i++) {
      const l = await db.listing.create({
        data: {
          monitorId: testMonitorId,
          externalId: `funnel-test-${i}`,
          title: `TEST-FUNNEL-Listing-${i}`,
          priceText: '100€',
          price: 100,
          url: `https://example.com/${i}`,
          aiVerdict: 'PRILIKA',
          aiScore: 8,
          isBookmarked: i < 5, // Stage 2: 5 interested
          contactStatus: i < 3 ? 'contacted' : 'none', // Stage 3: 3 contacted
        },
      });
      testListingIds.push(l.id);
    }

    // Stage 4+5: Bought + Sold trades
    const t1 = await db.trade.create({
      data: { title: 'TEST-FUNNEL-Trade-Profit', buyPrice: 100, buyDate: new Date(Date.now() - 10 * 86400000), sellPrice: 200, sellDate: new Date(), status: 'sold', category: 'test' },
    });
    const t2 = await db.trade.create({
      data: { title: 'TEST-FUNNEL-Trade-Loss', buyPrice: 100, buyDate: new Date(Date.now() - 20 * 86400000), sellPrice: 80, sellDate: new Date(), status: 'sold', category: 'test' },
    });
    testTradeIds.push(t1.id, t2.id);
  });

  afterAll(async () => {
    await db.trade.deleteMany({ where: { id: { in: testTradeIds } } });
    await db.listing.deleteMany({ where: { id: { in: testListingIds } } });
    if (testMonitorId) await db.monitor.delete({ where: { id: testMonitorId } }).catch(() => {});
    await db.$disconnect();
  });

  it('returns 200 with funnel stages', async () => {
    const res = await GET(mockReq(90));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.stages)).toBe(true);
    expect(data.stages.length).toBe(6);
  });

  it('stage 1 (discovered) has count >= 10', async () => {
    const data = await (await GET(mockReq(90))).json();
    const discovered = data.stages[0];
    expect(discovered.key).toBe('discovered');
    expect(discovered.count).toBeGreaterThanOrEqual(10);
    expect(discovered.conversion).toBe(100);
  });

  it('stage 2 (interested) has lower count than discovered', async () => {
    const data = await (await GET(mockReq(90))).json();
    expect(data.stages[1].count).toBeLessThanOrEqual(data.stages[0].count);
    expect(data.stages[1].conversion).toBeLessThanOrEqual(100);
  });

  it('stage 5 (sold) has count 2', async () => {
    const data = await (await GET(mockReq(90))).json();
    const sold = data.stages[4];
    expect(sold.count).toBeGreaterThanOrEqual(2);
  });

  it('stage 6 (profitable) has count >= 1', async () => {
    const data = await (await GET(mockReq(90))).json();
    const profitable = data.stages[5];
    expect(profitable.count).toBeGreaterThanOrEqual(1);
  });

  it('identifies a bottleneck', async () => {
    const data = await (await GET(mockReq(90))).json();
    expect(data.summary.bottleneck).toBeDefined();
    expect(data.summary.bottleneck.stage).toBeDefined();
    expect(data.summary.bottleneck.suggestion).toBeDefined();
  });

  it('returns overall conversion and avg hold days', async () => {
    const data = await (await GET(mockReq(90))).json();
    expect(data.summary.overallConversion).toBeGreaterThanOrEqual(0);
    expect(data.summary.avgHoldDays).toBeGreaterThanOrEqual(0);
    expect(data.summary.totalProfitEur).toBeDefined();
  });
});
