// v8.44: Smart Restock Recommendations API.
//
// GET /api/ai/restock-smart
//   → RestockResult {
//       ok: true,
//       recommendations: [5],         // top 5 "buy next" — RESTOCK only
//       categoryStatus: [...],         // all categories with action badge
//       inventoryGaps: [...],          // profitable cats with 0 held
//       overstockWarnings: [...],      // cats with >3 held (aging risk)
//       summary { totalCategories, restockRecommended, maintainCount, reduceCount, avoidCount, newOpportunities },
//       source: 'v8.44-restock-recommendations'
//     }
//
// Pure read — no mutations, no AI/LLM SDK. Calls getRestockRecommendations()
// from src/lib/trades/restock-recommendations.ts (combines v8.40 Trade Insights
// + current held inventory). Results cached 5 minutes (inventory changes
// rarely, historical aggregates even less so).

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getRestockRecommendations } from '@/lib/trades/restock-recommendations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // aggregation + DB scan — allow up to 30s

// In-memory cache (5-min TTL). Restock data changes when trades are
// bought/sold — 5 min is a reasonable freshness window for a "what to buy
// next" recommendation.
interface CacheEntry {
  result: Awaited<ReturnType<typeof getRestockRecommendations>>;
  ts: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.result);
    }

    const result = await getRestockRecommendations();
    cache = { result, ts: Date.now() };

    logger.info('/api/ai/restock-smart', 'computed restock recommendations', {
      categories: result.summary.totalCategories,
      restockRecommended: result.summary.restockRecommended,
      reduceCount: result.summary.reduceCount,
      avoidCount: result.summary.avoidCount,
      topRecommendations: result.recommendations.length,
      inventoryGaps: result.inventoryGaps.length,
      overstockWarnings: result.overstockWarnings.length,
      cacheTtlMin: 5,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/restock-smart', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
