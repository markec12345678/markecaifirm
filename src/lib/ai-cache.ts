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
 */
export async function getCacheStats(): Promise<{
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
