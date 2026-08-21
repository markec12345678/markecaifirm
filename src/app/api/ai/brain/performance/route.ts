// v8.33 / v8.95.0-f-refactor: Performance Metrics API — GET + POST /api/ai/brain/performance
//
// POLISH PHASE — answers: "How fast is the Brain system? Is the cache working?"
//
// GET returns:
//   - cacheStats: per-namespace hit/miss/sets + hitRate (master-brain,
//     profit-brain, inventory-brain, market-brain, sourcing-brain,
//     risk-brain, buyer-brain, pricing-brain)
//   - perfStats: per-brain response times — count, avg/p50/p95/p99/min/max
//     + cacheHitRate + lastDurationMs (master, profit, inventory, market,
//     sourcing, risk, buyer, pricing)
//   - cacheStoreSize: number of entries currently in the in-memory cache
//   - summary: weighted overall hit rate + total requests + total cached
//     + avg response time (avg of per-brain avgMs) + max p95 across all brains
//
// POST { action: 'reset' } clears all cache stats + perf stats (does NOT
// clear the underlying cache store — only the counters).
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// 30s maxDuration — but realistically this returns in <5ms (pure in-memory
// reads). No DB queries.
//
// Refaktoriran z withAiRoute helperjem (v8.95.0-f) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x / v8.95.x migracijami; avtomatski recordAiCall je additive).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import {
  getAllCacheStats,
  getCacheStoreSize,
  resetCacheStats,
} from '@/lib/ai-cache';
import { getAllPerfStats, resetPerfStats } from '@/lib/brain/performance';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 30;

// --- Input types -----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface PerformanceGetInput {}

interface PerformancePostInput {
  action: string | null;
}

// --- Pure helpers (testable, extracted OUTSIDE handler) -------------------

/**
 * Parse `action` from POST body OR ?action= query string.
 * Accepts JSON body `{ "action": "reset" }` OR query param `?action=reset`
 * (the latter is a convenience for curl one-liners that can't easily send
 * a POST body). Returns null if action is missing or not a string.
 */
async function parseAction(req: NextRequest): Promise<string | null> {
  let action: string | null = null;

  // 1. Try JSON body
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const cloned = req.clone();
      const parsed = (await cloned.json()) as { action?: string };
      if (parsed && typeof parsed.action === 'string') {
        action = parsed.action;
      }
    }
  } catch {
    action = null;
  }

  // 2. Fallback to query string (?action=reset)
  if (!action) {
    try {
      action = new URL(req.url).searchParams.get('action');
    } catch {
      action = null;
    }
  }

  return action;
}

/**
 * Compute aggregate summary across all cache + perf namespaces:
 *   - overallHitRate = sum(hits) / sum(total) × 100 (rounded to 2 decimals)
 *   - totalRequests = sum(total) across namespaces
 *   - totalCached = sum(hits) across namespaces
 *   - avgResponseTimeMs = mean of per-brain avgMs (rounded)
 *   - p95ResponseTimeMs = MAX p95 across all brains (worst-case tail latency)
 */
function computeSummary(
  cacheStats: ReturnType<typeof getAllCacheStats>,
  perfStats: ReturnType<typeof getAllPerfStats>,
): {
  overallHitRate: number;
  totalRequests: number;
  totalCached: number;
  avgResponseTimeMs: number;
  p95ResponseTimeMs: number;
} {
  const totalHits = cacheStats.reduce((s, ns) => s + ns.hits, 0);
  const totalRequests = cacheStats.reduce((s, ns) => s + ns.total, 0);
  const overallHitRate =
    totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;

  const avgResponseTimeMs =
    perfStats.length > 0
      ? Math.round(
          perfStats.reduce((s, p) => s + p.avgMs, 0) / perfStats.length,
        )
      : 0;

  const p95ResponseTimeMs =
    perfStats.length > 0
      ? Math.max(...perfStats.map((p) => p.p95Ms))
      : 0;

  return {
    overallHitRate: Math.round(overallHitRate * 100) / 100,
    totalRequests,
    totalCached: totalHits,
    avgResponseTimeMs,
    p95ResponseTimeMs,
  };
}

// --- GET: aggregate cache stats + perf stats into one response -------------

const performanceGetHandler = withAiRoute<PerformanceGetInput>({
  endpoint: '/api/ai/brain/performance',
  maxDuration: 30,
  enforceBudget: true, // v8.95.0-f: budget guard (non-breaking za pure-read endpoint)
  method: 'GET',

  // GET — brez telesa; parseBody vrne prazen objekt
  parseBody: async () => ({}),

  // Brez validateInput — GET nima inputa

  handler: async (_input, _ctx: AiRouteContext) => {
    const cacheStats = getAllCacheStats();
    const perfStats = getAllPerfStats();
    const cacheStoreSize = getCacheStoreSize();
    const summary = computeSummary(cacheStats, perfStats);

    return apiOk({
      ok: true,
      timestamp: new Date().toISOString(),
      cacheStats,
      perfStats,
      cacheStoreSize,
      summary,
      source: 'v8.33-performance',
    });
  },
});

// --- POST: reset stats -----------------------------------------------------

const performancePostHandler = withAiRoute<PerformancePostInput>({
  endpoint: '/api/ai/brain/performance',
  maxDuration: 30,
  enforceBudget: true, // v8.95.0-f: budget guard (konsistentno z vsemi migracijami)
  method: 'POST',

  parseBody: async (req) => ({
    action: await parseAction(req),
  }),

  validateInput: (input) =>
    input.action === 'reset'
      ? null
      : 'Unknown action — expected { "action": "reset" } (POST body) or ?action=reset (query)',

  handler: async (_input, _ctx: AiRouteContext) => {
    // Reset both stores — does NOT clear the underlying cache store, only
    // the counters. Next brain call will re-populate both.
    resetCacheStats();
    resetPerfStats();

    return apiOk({
      ok: true,
      message: 'Cache stats + perf stats reset.',
      timestamp: new Date().toISOString(),
      source: 'v8.33-performance',
    });
  },
});

export const GET = performanceGetHandler;
export const POST = performancePostHandler;
