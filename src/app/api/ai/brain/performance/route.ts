// v8.33: Performance Metrics API — GET + POST /api/ai/brain/performance
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

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  getAllCacheStats,
  getCacheStoreSize,
  resetCacheStats,
} from '@/lib/ai-cache';
import { getAllPerfStats, resetPerfStats } from '@/lib/brain/performance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// --- GET: aggregate cache stats + perf stats into one response -------------

export async function GET() {
  try {
    const cacheStats = getAllCacheStats();
    const perfStats = getAllPerfStats();
    const cacheStoreSize = getCacheStoreSize();

    // --- Summary (weighted across all namespaces) ---------------------------
    // overallHitRate = (sum of hits across all namespaces) /
    //                   (sum of hits + misses across all namespaces) × 100
    const totalHits = cacheStats.reduce((s, ns) => s + ns.hits, 0);
    const totalRequests = cacheStats.reduce((s, ns) => s + ns.total, 0);
    const overallHitRate =
      totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;

    // avgResponseTimeMs = mean of all brain avgMs (only brains with data)
    const avgResponseTimeMs =
      perfStats.length > 0
        ? Math.round(
            perfStats.reduce((s, p) => s + p.avgMs, 0) / perfStats.length,
          )
        : 0;

    // p95ResponseTimeMs = MAX p95 across all brains (worst-case tail latency)
    const p95ResponseTimeMs =
      perfStats.length > 0
        ? Math.max(...perfStats.map((p) => p.p95Ms))
        : 0;

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      cacheStats,
      perfStats,
      cacheStoreSize,
      summary: {
        overallHitRate: Math.round(overallHitRate * 100) / 100,
        totalRequests,
        totalCached: totalHits,
        avgResponseTimeMs,
        p95ResponseTimeMs,
      },
      source: 'v8.33-performance',
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/performance', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- POST: reset stats -----------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    let action: string | null = null;
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

    // Also accept ?action=reset as a query-string fallback (for callers that
    // can't easily send a POST body — e.g. curl one-liners).
    if (!action) {
      try {
        action = new URL(req.url).searchParams.get('action');
      } catch {
        action = null;
      }
    }

    if (action !== 'reset') {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Unknown action — expected { \"action\": \"reset\" } (POST body) or ?action=reset (query)",
        },
        { status: 400 },
      );
    }

    // Reset both stores — does NOT clear the underlying cache store, only
    // the counters. Next brain call will re-populate both.
    resetCacheStats();
    resetPerfStats();

    return NextResponse.json({
      ok: true,
      message: 'Cache stats + perf stats reset.',
      timestamp: new Date().toISOString(),
      source: 'v8.33-performance',
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/performance', 'POST failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
