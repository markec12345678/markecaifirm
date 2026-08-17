// v8.87: Reusable in-memory analytics cache.
// Professional pattern: TTL-based cache with automatic pruning.
// Use for analytics endpoints that compute expensive aggregations.

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // prune every 10 minutes
const cache = new Map<string, CacheEntry<unknown>>();
let lastPruneAt = 0;

/**
 * Get cached analytics result, or null if missing/expired.
 */
export function getCached<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const now = Date.now();

  // Prune expired entries periodically
  if (now - lastPruneAt > PRUNE_INTERVAL_MS) {
    lastPruneAt = now;
    for (const [k, e] of cache) {
      if (now - e.ts > ttlMs * 2) {
        cache.delete(k);
      }
    }
  }

  const entry = cache.get(key);
  if (entry && now - entry.ts < ttlMs) {
    return entry.data as T;
  }
  return null;
}

/**
 * Set analytics result in cache.
 */
export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, ts: Date.now() });
}

/**
 * Wrapper: get from cache, or compute, cache, and return.
 * Usage:
 *   const result = await withCache('sell-priority', () => getSellPriority());
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const cached = getCached<T>(key, ttlMs);
  if (cached !== null) {
    return cached;
  }
  const result = await compute();
  setCached(key, result);
  return result;
}

/**
 * Invalidate cache entries matching a prefix.
 * Use when underlying data changes (e.g., after trade sold).
 */
export function invalidateCache(prefix: string): number {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Clear all cache.
 */
export function clearAllCache(): void {
  cache.clear();
}
