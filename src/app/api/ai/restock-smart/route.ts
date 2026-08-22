// v8.44 / v8.95.8-other1: Smart Restock Recommendations API.
// Refaktoriran z withAiRoute helperjem (v8.95.8-other1) + enforceBudget guard
// (konsistentno z vsemi v8.94.x / v8.95.x migracijami — endpoint ne kliče AI
// providerja, je deterministic; vendar ohranjamo guard za konsistentnost).
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

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getRestockRecommendations } from '@/lib/trades/restock-recommendations';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 30; // aggregation + DB scan — allow up to 30s

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RestockSmartInput {}

// In-memory cache (5-min TTL). Restock data changes when trades are
// bought/sold — 5 min is a reasonable freshness window for a "what to buy
// next" recommendation.
interface CacheEntry {
  result: Awaited<ReturnType<typeof getRestockRecommendations>>;
  ts: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

export const GET = withAiRoute<RestockSmartInput>({
  endpoint: '/api/ai/restock-smart',
  maxDuration: 30,
  enforceBudget: true, // v8.95.8-other1: budget guard (konsistentno z vsemi AI route-i)
  method: 'GET',

  parseBody: async () => ({}),

  // Brez validateInput — endpoint nima inputa

  handler: async (_input, ctx: AiRouteContext) => {
    const { logger } = ctx;

    // 1. Cache hit?
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return apiOk(cache.result);
    }

    // 2. Compute fresh
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

    return apiOk(result);
  },
});
