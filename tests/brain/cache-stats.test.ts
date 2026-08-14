import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCachedAIWithStats,
  setCachedAIWithStats,
  getCacheStats,
  getAllCacheStats,
  resetCacheStats,
  getCacheStoreSize,
} from '@/lib/ai-cache';

/**
 * v8.34: Cache Stats test — hit/miss/set tracking for the AI cache layer.
 *
 * Source: v8.33 ai-cache.ts extensions. Memory-only — process restart clears
 * stats (acceptable for monitoring).
 *
 * Functions:
 *   - setCachedAIWithStats(ns, key, value, ttlMs) — tracks sets
 *   - getCachedAIWithStats(ns, key) — tracks hits/misses
 *   - getCacheStats(ns) — returns { hits, misses, sets, evictions, hitRate, total }
 *   - getAllCacheStats() — array of per-namespace stats
 *   - resetCacheStats(ns?) — clears specific namespace or all
 *   - getCacheStoreSize() — number of cached entries currently in memory
 *
 * NOTE: tests use unique namespaces per test to avoid cross-test pollution
 * (the cache store itself is shared across tests in the same vitest process).
 */
describe('Cache Stats', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  it('tracks hits and misses', () => {
    setCachedAIWithStats('test-ns', 'key1', { data: 'value' }, 60000);

    // First read = hit
    const hit = getCachedAIWithStats('test-ns', 'key1');
    expect(hit).not.toBeNull();

    // Second key = miss
    const miss = getCachedAIWithStats('test-ns', 'key2');
    expect(miss).toBeNull();

    const stats = getCacheStats('test-ns');
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(50);
  });

  it('tracks sets', () => {
    setCachedAIWithStats('test-ns', 'key1', 'value1', 60000);
    setCachedAIWithStats('test-ns', 'key2', 'value2', 60000);
    const stats = getCacheStats('test-ns');
    expect(stats.sets).toBe(2);
  });

  it('getAllCacheStats returns all namespaces', () => {
    setCachedAIWithStats('ns1', 'k', 'v', 60000);
    setCachedAIWithStats('ns2', 'k', 'v', 60000);
    const all = getAllCacheStats();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const namespaces = all.map((s) => s.namespace);
    expect(namespaces).toContain('ns1');
    expect(namespaces).toContain('ns2');
  });

  it('resetCacheStats clears specific namespace', () => {
    setCachedAIWithStats('ns1', 'k', 'v', 60000);
    setCachedAIWithStats('ns2', 'k', 'v', 60000);
    resetCacheStats('ns1');
    const all = getAllCacheStats();
    expect(all.find((s) => s.namespace === 'ns1')).toBeUndefined();
    expect(all.find((s) => s.namespace === 'ns2')).toBeDefined();
  });

  it('resetCacheStats() with no args clears all', () => {
    setCachedAIWithStats('ns1', 'k', 'v', 60000);
    setCachedAIWithStats('ns2', 'k', 'v', 60000);
    resetCacheStats();
    const all = getAllCacheStats();
    expect(all).toHaveLength(0);
  });

  it('getCacheStats returns 0 hitRate for unknown namespace', () => {
    const stats = getCacheStats('never-seen');
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.sets).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.total).toBe(0);
  });

  it('hitRate is 100 when only hits', () => {
    setCachedAIWithStats('perfect-ns', 'k', 'v', 60000);
    getCachedAIWithStats('perfect-ns', 'k');
    const stats = getCacheStats('perfect-ns');
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(100);
  });

  it('hitRate is 0 when only misses', () => {
    getCachedAIWithStats('all-miss', 'missing');
    getCachedAIWithStats('all-miss', 'another-missing');
    const stats = getCacheStats('all-miss');
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBe(0);
  });

  it('getCacheStoreSize returns number of cached entries', () => {
    setCachedAIWithStats('size-ns', 'k1', 'v1', 60000);
    setCachedAIWithStats('size-ns', 'k2', 'v2', 60000);
    const size = getCacheStoreSize();
    expect(size).toBeGreaterThanOrEqual(2);
  });

  it('cached value round-trips through get/set', () => {
    const payload = { foo: 'bar', count: 42, nested: { a: 1 } };
    setCachedAIWithStats('roundtrip-ns', 'key', payload, 60000);
    const retrieved = getCachedAIWithStats<typeof payload>('roundtrip-ns', 'key');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.foo).toBe('bar');
    expect(retrieved!.count).toBe(42);
    expect(retrieved!.nested.a).toBe(1);
  });

  it('expired entries return null and count as miss', () => {
    setCachedAIWithStats('expire-ns', 'k', 'v', 1); // 1ms TTL
    // Wait briefly so the entry expires
    const start = Date.now();
    while (Date.now() - start < 10) {
      // busy-wait 10ms
    }
    const result = getCachedAIWithStats('expire-ns', 'k');
    expect(result).toBeNull();
    const stats = getCacheStats('expire-ns');
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });
});
