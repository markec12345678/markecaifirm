/**
 * v7.56: Generic in-memory AI output cache (6h TTL).
 *
 * Used by AI endpoints that take heavy input (e.g. profit-maximizer-v2,
 * listing-refresh-scheduler) to skip re-calling the LLM when the same input
 * shape was just seen. Keyed by a caller-supplied string (typically a hash
 * of the input ids / capital value).
 *
 * Memory-only — process restart clears the cache (acceptable for AI hints).
 */

interface AiCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const aiCacheStore = new Map<string, AiCacheEntry<unknown>>();
let aiCacheLastPruneAt = 0;

/** Get a cached AI output value, or null if missing/expired. */
export function getCachedAI<T>(key: string): T | null {
  const now = Date.now();
  if (now - aiCacheLastPruneAt > 300000) {
    aiCacheLastPruneAt = now;
    for (const [k, e] of aiCacheStore) {
      if (e.expiresAt < now) aiCacheStore.delete(k);
    }
  }
  const entry = aiCacheStore.get(key) as AiCacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt < now) {
    aiCacheStore.delete(key);
    return null;
  }
  return entry.value;
}

/** Store an AI output value with the default 6h TTL. */
export function setCachedAI<T>(key: string, value: T, ttlMs: number = AI_CACHE_TTL_MS): void {
  aiCacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Test helper: clear the in-memory AI cache. */
export function clearAICache(): void {
  aiCacheStore.clear();
}

/**
 * v7.53: AI Output Cache — skip re-evaluation of already-scored listings.
 *
 * Problem: When a monitor runs every 15 min, the same listing may appear
 * in multiple runs. Each AI evaluation costs money (API call).
 * If we've already evaluated a listing in the last 6 hours, skip it.
 *
 * Strategy:
 * 1. Check listing.aiEvaluatedAt — if < 6h ago AND listing hasn't changed
 *    (price/title same), skip AI evaluation
 * 2. If price dropped since last evaluation → re-evaluate (price changed context)
 * 3. Log skipped evaluations for transparency
 *
 * Integration: called from pipeline.ts before evaluateListing()
 */

import { db } from './db';
import { logger } from './logger';

const CACHE_TTL_HOURS = 6; // re-evaluate after 6 hours
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;

export interface CacheCheckResult {
  shouldEvaluate: boolean;
  reason: string;
  cachedEvaluation?: {
    aiScore: number | null;
    aiRisk: number | null;
    aiVerdict: string | null;
    aiReason: string | null;
    aiEstimatedValue: number | null;
    aiImageVerdict: string | null;
    aiEvaluatedAt: Date;
  };
}

/**
 * Check if a listing should be (re-)evaluated by AI or if cached result is still valid.
 */
export async function shouldEvaluateListing(
  listingId: string,
  currentPrice: number | null,
  currentTitle: string,
): Promise<CacheCheckResult> {
  try {
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        aiScore: true, aiRisk: true, aiVerdict: true, aiReason: true,
        aiEstimatedValue: true, aiImageVerdict: true, aiImageAnalysis: true,
        aiEvaluatedAt: true, price: true, title: true, previousPrice: true,
        priceDroppedAt: true,
      },
    });

    if (!listing) {
      return { shouldEvaluate: true, reason: 'Listing not found — evaluate' };
    }

    // Never evaluated → evaluate
    if (!listing.aiEvaluatedAt) {
      return { shouldEvaluate: true, reason: 'Never evaluated — first evaluation' };
    }

    const ageMs = Date.now() - listing.aiEvaluatedAt.getTime();

    // Price dropped since last evaluation → re-evaluate (important context change)
    if (listing.priceDroppedAt && listing.priceDroppedAt > listing.aiEvaluatedAt) {
      return { shouldEvaluate: true, reason: 'Price dropped since last evaluation — re-evaluate' };
    }

    // Price changed → re-evaluate
    if (currentPrice !== null && listing.price !== null && currentPrice !== listing.price) {
      return { shouldEvaluate: true, reason: `Price changed (${listing.price}€ → ${currentPrice}€) — re-evaluate` };
    }

    // Title changed → re-evaluate
    if (currentTitle !== listing.title) {
      return { shouldEvaluate: true, reason: 'Title changed — re-evaluate' };
    }

    // Cache still fresh → skip
    if (ageMs < CACHE_TTL_MS) {
      return {
        shouldEvaluate: false,
        reason: `Cached (${Math.round(ageMs / 3600000)}h old, TTL ${CACHE_TTL_HOURS}h) — skip`,
        cachedEvaluation: {
          aiScore: listing.aiScore,
          aiRisk: listing.aiRisk,
          aiVerdict: listing.aiVerdict,
          aiReason: listing.aiReason,
          aiEstimatedValue: listing.aiEstimatedValue,
          aiImageVerdict: listing.aiImageVerdict,
          aiEvaluatedAt: listing.aiEvaluatedAt,
        },
      };
    }

    // Cache expired → re-evaluate
    return { shouldEvaluate: true, reason: `Cache expired (${Math.round(ageMs / 3600000)}h > ${CACHE_TTL_HOURS}h) — re-evaluate` };
  } catch (err) {
    logger.error('ai-cache', 'Cache check failed — defaulting to evaluate', err);
    return { shouldEvaluate: true, reason: 'Cache check error — evaluate (safe default)' };
  }
}

/**
 * Batch check: filter out listings that don't need re-evaluation.
 * Returns only the ones that need AI evaluation.
 */
export async function filterForEvaluation(
  listings: Array<{ id: string; price: number | null; title: string }>,
): Promise<{
  toEvaluate: typeof listings;
  cached: Array<{ id: string; reason: string }>;
  savedCalls: number;
}> {
  const toEvaluate: typeof listings = [];
  const cached: Array<{ id: string; reason: string }> = [];

  for (const l of listings) {
    const check = await shouldEvaluateListing(l.id, l.price, l.title);
    if (check.shouldEvaluate) {
      toEvaluate.push(l);
    } else {
      cached.push({ id: l.id, reason: check.reason });
    }
  }

  return {
    toEvaluate,
    cached,
    savedCalls: cached.length,
  };
}

/**
 * Get cache statistics for monitoring.
 *
 * v8.33 RENAMED from `getCacheStats` → `getListingCacheStats` to free up the
 * `getCacheStats` name for the new (synchronous, in-memory) per-namespace
 * Brain cache stats tracker. This DB-backed function is unchanged in
 * behavior — only the export name changed. Not called anywhere else in the
 * codebase at time of rename (verified via project-wide grep).
 */
export async function getListingCacheStats(): Promise<{
  totalListings: number;
  evaluated: number;
  pending: number;
  cacheHitRate: number;
}> {
  const [total, evaluated] = await Promise.all([
    db.listing.count({ where: { isHidden: false } }),
    db.listing.count({ where: { isHidden: false, aiEvaluatedAt: { not: null } } }),
  ]);

  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  const fresh = await db.listing.count({
    where: { isHidden: false, aiEvaluatedAt: { gte: cutoff } },
  });

  return {
    totalListings: total,
    evaluated,
    pending: total - evaluated,
    cacheHitRate: evaluated > 0 ? Math.round((fresh / evaluated) * 100) : 0,
  };
}

// =========================================================================
// v8.33: Per-namespace Brain cache stats — hit/miss/sets counters.
// =========================================================================
//
// Tracks cache hit rates for each Brain layer (master-brain, profit-brain,
// inventory-brain, market-brain, sourcing-brain, risk-brain, buyer-brain,
// pricing-brain). Used by the Performance API + UI ⚡ Performance card.
//
// Memory-only — process restart clears stats (acceptable for monitoring).
// Stats are tracked via the `getCachedAIWithStats`/`setCachedAIWithStats`
// wrappers — direct `getCachedAI`/`setCachedAI` calls bypass stats (we
// intentionally don't pollute the original generic functions).
//
// Eviction tracking is intentionally skipped (we don't store the namespace
// on the cached entry; would require a wider refactor). Stats cover hits,
// misses, and sets only — sufficient for "is the cache effective?" insight.

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
}

const cacheStats = new Map<string, CacheStats>();

function getOrCreateStats(namespace: string): CacheStats {
  if (!cacheStats.has(namespace)) {
    cacheStats.set(namespace, { hits: 0, misses: 0, sets: 0, evictions: 0 });
  }
  return cacheStats.get(namespace)!;
}

/** v8.33: Get cached value with stats tracking. Namespace = cache key prefix
 *  (e.g. 'master-brain', 'profit-brain'). The actual stored key is
 *  `${namespace}:${key}` — same shape as the existing buildCacheKey helpers,
 *  so cache backward compatibility is preserved. */
export function getCachedAIWithStats<T>(namespace: string, key: string): T | null {
  const stats = getOrCreateStats(namespace);
  const value = getCachedAI<T>(`${namespace}:${key}`);
  if (value !== null) {
    stats.hits++;
  } else {
    stats.misses++;
  }
  return value;
}

/** v8.33: Set cached value with stats tracking. */
export function setCachedAIWithStats<T>(namespace: string, key: string, value: T, ttlMs: number): void {
  const stats = getOrCreateStats(namespace);
  stats.sets++;
  setCachedAI(`${namespace}:${key}`, value, ttlMs);
}

/** v8.33: Get cache stats for a namespace. Returns hit/miss/sets/evictions +
 *  computed hitRate + total requests (hits + misses). */
export function getCacheStats(namespace: string): CacheStats & { hitRate: number; total: number } {
  const stats = getOrCreateStats(namespace);
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    hitRate: total > 0 ? (stats.hits / total) * 100 : 0,
    total,
  };
}

/** v8.33: Get all cache stats (all namespaces ever observed). */
export function getAllCacheStats(): Array<{ namespace: string } & CacheStats & { hitRate: number; total: number }> {
  const result: Array<{ namespace: string } & CacheStats & { hitRate: number; total: number }> = [];
  for (const [namespace, stats] of cacheStats.entries()) {
    const total = stats.hits + stats.misses;
    result.push({
      namespace,
      ...stats,
      hitRate: total > 0 ? (stats.hits / total) * 100 : 0,
      total,
    });
  }
  return result;
}

/** v8.33: Reset cache stats for a namespace (or all if no namespace provided). */
export function resetCacheStats(namespace?: string): void {
  if (namespace) {
    cacheStats.delete(namespace);
  } else {
    cacheStats.clear();
  }
}

/** v8.33: Get cache store size (number of cached entries currently in memory).
 *  Useful for the UI to show "Cache entries: 12". */
export function getCacheStoreSize(): number {
  return aiCacheStore.size;
}
