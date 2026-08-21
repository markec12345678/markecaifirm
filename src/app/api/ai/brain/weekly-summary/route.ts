// v8.41 / v8.95.2-small-batch: Weekly Summary Report API — comprehensive weekly digest.
// GET  → returns last generated weekly summary (without sending).
// POST { action: 'send' } → sends summary to Telegram + Email + Notification Center.
//
// Used by:
//   - Dashboard WeeklySummaryCard (GET to preview, POST to send)
//   - Manual trigger via API runner
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-small-batch) + enforceBudget
// guard. LOČENA handlerja za GET in POST (različna poslovna logika — match-a
// brain/daily-tip vzorec). DETERMINISTIC — endpoint ne kliče AI direktno;
// enforceBudget: true je non-breaking. ctx.logger dependency injection
// (replaces module-level logger import).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import {
  generateWeeklySummary,
  sendWeeklySummary,
} from '@/lib/brain/weekly-summary';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface WeeklySummaryGetInput {}

interface WeeklySummaryPostInput {
  action: string;
}

/**
 * GET /api/ai/brain/weekly-summary
 * Returns the weekly summary WITHOUT sending to any channel.
 * Used by the Dashboard card to preview last week's summary.
 */
export const GET = withAiRoute<WeeklySummaryGetInput>({
  endpoint: '/api/ai/brain/weekly-summary',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2: budget guard + avtomatski recordAiCall
  method: 'GET',
  parseBody: async () => ({}),
  // Brez validateInput — GET brez input polj
  handler: async (_input, ctx: AiRouteContext) => {
    const { logger } = ctx;
    const summary = await generateWeeklySummary();
    logger.info(
      '/api/ai/brain/weekly-summary',
      `generated summary for ${summary.period.start} → ${summary.period.end} (profit=${summary.profit.thisWeek}, sold=${summary.trades.soldThisWeek})`,
    );
    return apiOk(summary);
  },
});

/**
 * POST /api/ai/brain/weekly-summary { action: 'send' }
 * Sends weekly summary to Telegram + Email + Notification Center.
 * Returns { ok, sentTelegram, sentEmail }.
 *
 * If neither Telegram nor Email is configured, returns
 * { ok: true, sentTelegram: false, sentEmail: false } — the summary
 * was still generated + recorded in Notification Center.
 */
export const POST = withAiRoute<WeeklySummaryPostInput>({
  endpoint: '/api/ai/brain/weekly-summary',
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

    if (action !== 'send') {
      return apiBadRequest(`Unknown action: '${action}'. Use { action: 'send' }.`);
    }

    const result = await sendWeeklySummary();
    logger.info('/api/ai/brain/weekly-summary', 'POST send result', result);

    return apiOk({
      ok: result.ok,
      sentTelegram: result.sentTelegram,
      sentEmail: result.sentEmail,
      error: result.error ?? null,
    });
  },
});
