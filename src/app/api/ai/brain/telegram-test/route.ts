// v8.35 / v8.95.2-small-batch: Telegram Brain Test API — lets user test Brain notifications.
//
// POST /api/ai/brain/telegram-test  { type: 'digest' | 'autopilot' | 'anomaly' }
//   - 'digest'    → sendBrainDigest() — sends real Master Brain digest
//   - 'autopilot' → sendAutoPilotAlert(mockDraft, ...) — sends a test alert
//   - 'anomaly'   → sendAnomalyAlert('Test anomaly — preverjamo Telegram povezavo')
//
// Returns { ok, sent, reason, type } — same shape as the NotificationResult.
// If Telegram is not configured, returns { ok: true, sent: false, reason: '...' }
// (not an error — just a skipped notification).
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-small-batch) + enforceBudget
// guard. POST-only (original GET method ni obstajal). DETERMINISTIC — endpoint
// ne kliče AI direktno; enforceBudget: true je non-breaking. ctx.logger
// dependency injection (replaces module-level logger import). buildMockDraft
// pure helper ekstrahiran OUTSIDE handler-ja (IDENTIČEN originalu).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import { sendBrainDigest, sendAutoPilotAlert, sendAnomalyAlert } from '@/lib/brain/telegram-notifications';
import type { ActionDraft } from '@/lib/brain/draft-queue';
import type { DomainName } from '@/lib/brain/master';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 30;

/**
 * Build a mock ActionDraft for the 'autopilot' test alert.
 * Marked clearly as a TEST notification so the user can distinguish real
 * auto-pilot executions from test sends in their Telegram chat.
 */
function buildMockDraft(): ActionDraft {
  return {
    id: `test-${Date.now()}`,
    rank: 1,
    domain: 'profit' as DomainName,
    signal: 'TEST_SIGNAL — preverjamo Telegram povezavo',
    action: 'Test akcija — to je testno sporočilo avto-pilot alert-a',
    expectedUpliftEUR: 50,
    confidence: 'LOW',
    status: 'executed',
    feedbackNote: null,
    executedAt: new Date(),
    rejectedAt: null,
    snapshotDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface TelegramTestInput {
  type: string;
}

export const POST = withAiRoute<TelegramTestInput>({
  endpoint: '/api/ai/brain/telegram-test',
  maxDuration: 30,
  enforceBudget: true, // v8.95.2: budget guard + avtomatski recordAiCall
  method: 'POST',
  parseBody: async (req: NextRequest) => {
    const body = await req.json().catch(() => ({}));
    return { type: typeof body?.type === 'string' ? body.type : '' };
  },
  // Brez validateInput — handler sam vrne 400 za neznane type
  handler: async (input, ctx: AiRouteContext) => {
    const { logger } = ctx;
    const { type } = input;

    if (type === 'digest') {
      const result = await sendBrainDigest();
      logger.info('/api/ai/brain/telegram-test', 'digest test', result);
      return apiOk({ ok: result.ok, sent: result.sent, reason: result.reason ?? null, type: 'digest' });
    }

    if (type === 'autopilot') {
      const mockDraft = buildMockDraft();
      const result = await sendAutoPilotAlert(mockDraft, 'Test notification — preverjamo Telegram povezavo');
      logger.info('/api/ai/brain/telegram-test', 'autopilot test', result);
      return apiOk({ ok: result.ok, sent: result.sent, reason: result.reason ?? null, type: 'autopilot' });
    }

    if (type === 'anomaly') {
      const result = await sendAnomalyAlert('Test anomaly — preverjamo Telegram povezavo');
      logger.info('/api/ai/brain/telegram-test', 'anomaly test', result);
      return apiOk({ ok: result.ok, sent: result.sent, reason: result.reason ?? null, type: 'anomaly' });
    }

    return apiBadRequest(`Unknown type: '${type}'. Use 'digest', 'autopilot', or 'anomaly'.`);
  },
});
