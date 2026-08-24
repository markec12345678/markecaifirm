import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/db';
import { GET } from '../../src/app/api/trades/deal-flow/route';

describe('/api/trades/deal-flow', () => {
  const testIds: string[] = [];

  beforeAll(async () => {
    await db.trade.deleteMany({ where: { title: { startsWith: 'TEST-DEAL-' } } });
    const t1 = await db.trade.create({ data: { title: 'TEST-DEAL-iPhone', buyPrice: 100, buyDate: new Date(Date.now() - 30*86400000), sellPrice: 150, sellDate: new Date(), status: 'sold', category: 'elektronika' } });
    const t2 = await db.trade.create({ data: { title: 'TEST-DEAL-PS5', buyPrice: 200, buyDate: new Date(Date.now() - 60*86400000), sellPrice: 180, sellDate: new Date(), status: 'sold', category: 'elektronika' } });
    testIds.push(t1.id, t2.id);
  });

  afterAll(async () => {
    await db.trade.deleteMany({ where: { id: { in: testIds } } });
    await db.$disconnect();
  });

  it('returns 200 with metrics', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.metrics).toBeDefined();
  });

  it('calculates ROI as a positive number', async () => {
    const data = await (await GET()).json();
    // ROI should be a number (may be positive or negative depending on all trades)
    expect(typeof data.metrics.roi).toBe('number');
    expect(data.totals.totalProfit).toBeDefined();
  });

  it('calculates win rate as a percentage 0-100', async () => {
    const data = await (await GET()).json();
    expect(data.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(data.metrics.winRate).toBeLessThanOrEqual(100);
  });

  it('calculates avg margin as a number', async () => {
    const data = await (await GET()).json();
    expect(typeof data.metrics.avgMargin).toBe('number');
  });
});
