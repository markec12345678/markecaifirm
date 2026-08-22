// v8.29 / v8.95.0-d-refactor: Per-draft API — GET fetches a single draft,
// PATCH updates its status. Refaktoriran z withAiRoute helperjem (v8.94).
//
// GET  /api/ai/brain/drafts/{id}                       → single draft (raw SQL)
// PATCH /api/ai/brain/drafts/{id} { status, feedbackNote? }
//        → updateDraftStatus + adaptive-weights feedback loop
//
// Closed feedback loop:
//   - When PATCH status is 'executed' or 'rejected', updateDraftStatus()
//     ALSO calls recordActionFeedback() from v8.28 (adaptive-weights.ts) →
//     adaptive weights re-evaluate every 10 actions per domain → next Master
//     Brain call has updated weights → better ranking for the user's
//     REVEALED preferences.
//
// Returns:
//   PATCH: { ok: true, draft: ActionDraft, feedbackRecorded, feedbackResult? }
//   GET:   { ok: true, draft: ActionDraft, source: 'v8.29-draft-queue' }
//
// Errors:
//   400 — missing id, invalid status (must be 'executed'|'rejected'|'approved'),
//         or cannot change a draft that already has a final status
//   404 — draft not found
//   500 — server error
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.
// v8.95.0-d: enforceBudget: true (consistency guard — endpoint ne kliče AI
//   direktno, ampak drži vzorec; budget check je non-breaking in se ne sproži
//   ker handler ne kliče ctx.callAi).

import type { NextRequest } from 'next/server';
import {
  withAiRoute,
  AI_ROUTE_DEFAULTS,
  ApiRouteError,
  type AiRouteContext,
} from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { updateDraftStatus } from '@/lib/brain/draft-queue';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

const VALID_PATCH_STATUS = new Set<string>(['executed', 'rejected', 'approved']);

// --- Input interfaces ------------------------------------------------------

interface PatchDraftInput {
  id: string;
  /** Normalized (lowercase, trimmed) status — used for validation + handler. */
  status: string;
  /** Original body.status (any type) — used only for the error message. */
  rawStatus: unknown;
  feedbackNote?: string;
}

interface GetDraftInput {
  id: string;
}

// --- PATCH handler ---------------------------------------------------------

export const PATCH = withAiRoute<PatchDraftInput>({
  endpoint: '/api/ai/brain/drafts/[id]',
  maxDuration: 60,
  enforceBudget: true, // v8.94: consistency guard (no AI call but keeps pattern)
  method: 'GET', // PATCH — bypass POST-only check (helper supports POST|GET)

  parseBody: async (req: NextRequest): Promise<PatchDraftInput> => {
    const id = extractIdFromUrl(req);
    const body = await parseJsonBody(req);
    const rawStatus = body.status;
    const status =
      typeof rawStatus === 'string' ? rawStatus.toLowerCase().trim() : '';
    const feedbackNote =
      typeof body.feedbackNote === 'string' && body.feedbackNote.trim() !== ''
        ? body.feedbackNote.trim().slice(0, 1000)
        : undefined;
    return { id, status, rawStatus, feedbackNote };
  },

  validateInput: (input) => {
    if (!input.id) {
      return 'Missing draft id (expected /api/ai/brain/drafts/{id}).';
    }
    if (!VALID_PATCH_STATUS.has(input.status)) {
      return `Invalid status: ${JSON.stringify(input.rawStatus)}. Must be 'executed', 'rejected', or 'approved'.`;
    }
    return null;
  },

  handler: async (input, _ctx: AiRouteContext) => {
    try {
      const result = await updateDraftStatus({
        id: input.id,
        status: input.status as 'executed' | 'rejected' | 'approved',
        feedbackNote: input.feedbackNote,
      });
      return apiOk(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Distinguish "not found" from "bad request" via error message content
      if (msg.includes('not found')) {
        throw new ApiRouteError(msg, 404);
      }
      if (
        msg.includes('already has final status') ||
        msg.includes('Cannot set status')
      ) {
        throw new ApiRouteError(msg, 400);
      }
      throw err;
    }
  },
});

// --- GET handler -----------------------------------------------------------

export const GET = withAiRoute<GetDraftInput>({
  endpoint: '/api/ai/brain/drafts/[id]',
  maxDuration: 60,
  enforceBudget: true, // v8.94: consistency guard (no AI call but keeps pattern)
  method: 'GET',

  parseBody: async (req: NextRequest): Promise<GetDraftInput> => ({
    id: extractIdFromUrl(req),
  }),

  validateInput: (input) =>
    input.id ? null : 'Missing draft id.',

  handler: async (input, ctx: AiRouteContext) => {
    // Raw SQL — bypass stale typed PrismaClient accessor (same pattern as
    // draft-queue.ts: getFreshDb + $queryRaw). Using ctx.db singleton instead
    // of `new PrismaClient()` per request — raw SQL still bypasses typed
    // accessor, but we avoid creating a new connection pool per call.
    const rows = await ctx.db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM ActionDraft WHERE id = ${input.id} LIMIT 1
    `;
    if (rows.length === 0) {
      throw new ApiRouteError(`Draft not found: ${input.id}`, 404);
    }
    const draft = mapDraftRow(rows[0]);
    return apiOk({ ok: true, draft, source: 'v8.29-draft-queue' });
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

/**
 * Extract the draft id from the URL path.
 * Path: /api/ai/brain/drafts/{id} → returns {id} (URL-decoded).
 *
 * Next.js App Router dynamic-route params arrive as the second handler
 * argument (`ctx.params`), but `withAiRoute` only forwards `req` to its
 * internal `parseBody`. We therefore parse `id` from `req.url`'s pathname.
 */
function extractIdFromUrl(req: NextRequest): string {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    // ['api', 'ai', 'brain', 'drafts', '{id}'] → index 4
    const raw = segments[4] ?? '';
    return raw ? decodeURIComponent(raw) : '';
  } catch {
    return '';
  }
}

/**
 * Parse JSON body defensively — tolerates missing/invalid Content-Type,
 * non-object bodies, and JSON parse errors by falling back to {}.
 *
 * Mirrors the original PATCH body parsing (v8.29).
 */
async function parseJsonBody(
  req: NextRequest,
): Promise<Record<string, unknown>> {
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const cloned = req.clone();
      const parsed = (await cloned.json()) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // fall through to default {}
  }
  return {};
}

/**
 * Map a raw SQL row to the draft response shape (identical to original v8.29).
 * Raw SQL rows are untyped — coerce each field explicitly.
 */
function mapDraftRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    rank: Number(row.rank),
    domain: row.domain,
    signal: String(row.signal),
    action: String(row.action),
    expectedUpliftEUR: Number(row.expectedUpliftEUR),
    confidence: row.confidence,
    status: row.status,
    feedbackNote: row.feedbackNote ?? null,
    executedAt: row.executedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    snapshotDate: row.snapshotDate ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
