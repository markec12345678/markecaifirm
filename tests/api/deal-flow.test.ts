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

  it('calculates ROI correctly', async () => {
    const data = await (await GET()).json();
    // invested 300, returned 330, profit 30, ROI 10%
    expect(data.metrics.roi).toBe(10);
    expect(data.totals.totalProfit).toBe(30);
  });

  it('calculates win rate (1/2 = 50%)', async () => {
    const data = await (await GET()).json();
    expect(data.metrics.winRate).toBe(50);
  });

  it('calculates avg margin (30/2 = 15)', async () => {
    const data = await (await GET()).json();
    expect(data.metrics.avgMargin).toBe(15);
  });
});
