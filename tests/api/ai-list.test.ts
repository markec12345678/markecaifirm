import { describe, it, expect } from 'vitest';
import { GET } from '../../src/app/api/ai-list/route';

describe('/api/ai-list', () => {
  it('returns a list of AI endpoints', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.total).toBeGreaterThan(100);
    expect(Array.isArray(data.endpoints)).toBe(true);
  });

  it('includes category counts', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.categories).toBeDefined();
    expect(typeof data.categories.buyer).toBe('number');
  });

  it('serves from cache on second call', async () => {
    await GET();
    const res = await GET();
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
