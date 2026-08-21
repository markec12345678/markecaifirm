// v8.35 / v8.95.2-small-batch: Seed Demo Data API — creates realistic Slovenian trade history.
//
// POST /api/ai/brain/seed  { action: 'seed' | 'clear' | 'reseed' }
//   - 'seed'    → seedDemoData() — idempotent (skips if trades already exist)
//   - 'clear'   → clearAllTrades() — deletes ALL trades (use with caution)
//   - 'reseed'  → clearAllTrades() + seedDemoData() — clean reset
//
// GET /api/ai/brain/seed — returns current Trade count + 25 demo template info.
//
// Without this endpoint, the Trade table is empty (0 trades) → Actual Profit
// Tracker shows 0€, accuracy can't be computed, and all brains use default
// inputs. v8.35 makes the system "alive" with real data.
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-small-batch) + enforceBudget
// guard. LOČENA handlerja za GET in POST (različna poslovna logika — match-a
// brain/daily-tip vzorec). DETERMINISTIC — endpoint ne kliče AI direktno;
// enforceBudget: true je non-breaking. ctx.db dependency injection (replaces
// module-level db import) + ctx.logger (replaces module-level logger import).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import { seedDemoData, clearAllTrades, DEMO_TRADES } from '@/lib/seed/demo-data';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60; // seeding 25 trades can take a few seconds in dev mode with Prisma

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SeedGetInput {}

interface SeedPostInput {
  action: string;
}

/**
 * GET /api/ai/brain/seed — returns current Trade count + 25 demo template info.
 * Used by the UI to display "system is alive" status before seeding.
 */
export const GET = withAiRoute<SeedGetInput>({
  endpoint: '/api/ai/brain/seed',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2: budget guard + avtomatski recordAiCall
  method: 'GET',
  parseBody: async () => ({}),
  // Brez validateInput — GET brez input polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { db } = ctx;
    const count = await db.trade.count();
    const sold = await db.trade.count({ where: { status: 'sold' } });
    const held = await db.trade.count({ where: { status: 'held' } });
    const cancelled = await db.trade.count({ where: { status: 'cancelled' } });
    return apiOk({
      ok: true,
      count,
      byStatus: { sold, held, cancelled },
      demoTemplateCount: DEMO_TRADES.length,
      source: 'v8.35-seed-demo-data',
    });
  },
});

/**
 * POST /api/ai/brain/seed { action: 'seed' | 'clear' | 'reseed' }
 * Dispatches to seedDemoData/clearAllTrades based on `action`.
 */
export const POST = withAiRoute<SeedPostInput>({
  endpoint: '/api/ai/brain/seed',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2: budget guard + avtomatski recordAiCall
  method: 'POST',
  parseBody: async (req: NextRequest) => {
    const body = await req.json().catch(() => ({}));
    return { action: typeof body?.action === 'string' ? body.action : '' };
  },
  // Brez validateInput — handler sam vrne 400 za neznane akcije
  handler: async (input, ctx: AiRouteContext) => {
    const { logger } = ctx;
    const { action } = input;

    if (action === 'seed') {
      const result = await seedDemoData();
      logger.info('/api/ai/brain/seed', 'seed action complete', result);
      return apiOk(result);
    }

    if (action === 'clear') {
      const result = await clearAllTrades();
      logger.info('/api/ai/brain/seed', 'clear action complete', result);
      return apiOk({ ...result, source: 'v8.35-seed-demo-data' });
    }

    if (action === 'reseed') {
      const clearResult = await clearAllTrades();
      const seedResult = await seedDemoData();
      logger.info('/api/ai/brain/seed', 'reseed action complete', {
        cleared: clearResult.deleted,
        created: seedResult.created,
      });
      return apiOk({
        ok: true,
        cleared: clearResult.deleted,
        created: seedResult.created,
        total: seedResult.total,
        source: 'v8.35-seed-demo-data',
      });
    }

    return apiBadRequest(`Unknown action: '${action}'. Use 'seed', 'clear', or 'reseed'.`);
  },
});
