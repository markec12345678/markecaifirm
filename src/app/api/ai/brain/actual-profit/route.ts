// v8.23 / v8.94.9-d-refactor: Actual Profit API — computes REAL EUR profit from Trade table.
// Refaktoriran z withAiRoute helperjem (v8.94) + enforceBudget guard.
//
// GET  /api/ai/brain/actual-profit?days=30 (default 30)
// POST /api/ai/brain/actual-profit         (same handler — some UIs prefer POST)
//
// Returns ActualProfitResult — the GROUND TRUTH for validating Master Brain
// predictions. Until v8.23, the Brain architecture (v8.15-v8.22) made
// predictions ("30d: 3133€") but had no way to measure actual realized profit.
//
// Pure read endpoint — calls calculateActualProfit() in src/lib/profit/actual
// which reads from the Trade table (status='sold', sellDate within last N days).
//
// Used by:
//   - UI card "📊 Dejanski profit (zadnjih 30 dni)" — top of Brain view
//     (ground truth first, above the Master Brain banner)
//   - GET /api/ai/brain/snapshots — combined with snapshots for predicted vs
//     actual comparison
//   - (v8.25 future) accuracy backfill cron — fills actualProfit30d/90d cols
//     on BrainSnapshot rows older than 30/90 days
//
// Per-trade profit formula:
//   profit = sellPrice - sellFees - buyPrice - buyFees

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { calculateActualProfit } from '@/lib/profit/actual';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface ActualProfitInput {
  days: number;
}

/**
 * Parse `days` query param — clamp to [1, 730] (2 years max).
 * Default 30. Supports common presets: 7, 30, 90, 365.
 */
function parseDays(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('days');
    if (!raw) return 30;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(n, 730);
  } catch {
    return 30;
  }
}

const actualProfitHandler = withAiRoute<ActualProfitInput>({
  endpoint: '/api/ai/brain/actual-profit',
  maxDuration: 60,
  enforceBudget: true, // v8.94: budget guard (non-breaking za pure-read endpoint)
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req) => ({
    days: parseDays(req),
  }),

  // Brez validateInput — parseDays ima privzeto vrednost 30

  handler: async (input, ctx: AiRouteContext) => {
    const { logger } = ctx;
    const { days } = input;
    const result = await calculateActualProfit(days);

    logger.info('/api/ai/brain/actual-profit', `computed for ${days}d`, {
      tradeCount: result.tradeCount,
      totalProfit: result.totalProfitEUR,
    });

    return apiOk(result);
  },
});

export const GET = actualProfitHandler;
// POST also supported — same handler (some UIs prefer POST for data fetches)
export const POST = actualProfitHandler;
