// v8.30 / v8.94.9-f: Auto-pilot Rollback API — migrated to withAiRoute helper.
// POST /api/ai/brain/auto-pilot/rollback
//   Body: { draftId: string, reason?: string }
//   → calls rollbackAutoExecution(draftId, reason)
//   → returns RollbackResult { ok, draft, rolledBack: true, reason }
//
// Rollback an auto-executed action:
// - Sets rolledBack=true, rolledBackAt=now, rollbackReason=reason
// - Calls recordActionFeedback with 'rejected' (v8.28) to UNDO the learning
//   (the auto-execution had incremented the executed counter; we balance it
//   with a rejected signal)
// - Does NOT un-execute in the real world (we can't un-send a Telegram message)
// - Guard: only drafts with autoExecuted=true AND rolledBack=false can be rolled back
//
// 400 for invalid body / not-auto-executed / already-rolled-back.
// 404 for draft not found.
// 500 for server errors.
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.
// v8.94.9-f: enforceBudget: true (consistency guard — endpoint ne kliče AI,
//   ampak drži vzorec; budget check je non-breaking in se ne sproži ker handler
//   ne kliče ctx.callAi).

import {
  withAiRoute,
  AI_ROUTE_DEFAULTS,
  ApiRouteError,
  type AiRouteContext,
} from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { rollbackAutoExecution } from '@/lib/brain/auto-pilot';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

interface RollbackInput {
  draftId: string;
  reason: string;
}

export const POST = withAiRoute<RollbackInput>({
  endpoint: '/api/ai/brain/auto-pilot/rollback',
  maxDuration: 60,
  enforceBudget: true, // v8.94: consistency guard (no AI call but keeps pattern)

  parseBody: async (req) => parseRollbackBody(req),

  validateInput: (input) =>
    input.draftId
      ? null
      : `Missing 'draftId' in body. Expected: { draftId: string, reason?: string }.`,

  handler: async (input, _ctx: AiRouteContext) => {
    const result = await runRollback(input.draftId, input.reason);
    return apiOk(result);
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/**
 * Parse request body into RollbackInput.
 *
 * Defensive JSON parse — tolerates missing/invalid Content-Type and non-object
 * bodies by falling back to {}. Reason is truncated to 1000 chars and defaults
 * to a timestamped message when absent.
 */
async function parseRollbackBody(req: Request): Promise<RollbackInput> {
  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const cloned = req.clone();
      body = (await cloned.json()) as Record<string, unknown>;
    }
  } catch {
    body = {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    body = {};
  }

  const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
  const reason =
    typeof body.reason === 'string'
      ? body.reason.slice(0, 1000)
      : `User rollback at ${new Date().toISOString()}`;

  return { draftId, reason };
}

/**
 * Run rollback and map known rollbackAutoExecution errors to HTTP status codes:
 * - "Draft not found" → ApiRouteError(404)
 * - "was not auto-executed" / "was already rolled back" → ApiRouteError(400)
 * - other → re-throw (bubbles to withAiRoute outer catch → 500 via apiError)
 */
async function runRollback(
  draftId: string,
  reason: string,
): Promise<Awaited<ReturnType<typeof rollbackAutoExecution>>> {
  try {
    return await rollbackAutoExecution(draftId, reason);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('Draft not found')) {
      throw new ApiRouteError(msg, 404);
    }
    if (
      msg.includes('was not auto-executed') ||
      msg.includes('was already rolled back')
    ) {
      throw new ApiRouteError(msg, 400);
    }
    throw err;
  }
}
