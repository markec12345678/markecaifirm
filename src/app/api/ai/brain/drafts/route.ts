// v8.29 / v8.95.0-c-refactor: Draft Queue API — 🎯 INTELLIGENCE PHASE COMPLETE.
// Refaktoriran z withAiRoute helperjem (v8.95.0-c) + enforceBudget guard.
//
// GET  /api/ai/brain/drafts?status=pending&domain=profit&limit=30&days=30
//      → returns DraftQueueResult { ok, drafts, stats, domainStats }
// POST /api/ai/brain/drafts { actions?: [...], snapshotDate?: 'YYYY-MM-DD' }
//      → if `actions` omitted, calls masterBrain() and uses its topActions
//      → returns CreateDraftsResult { ok, created, drafts, expiredCount }
//
// Closed feedback loop (v8.22 + v8.28 + v8.29):
//   Master Brain recommends (v8.22) → user clicks ✅/❌ (v8.29 ✅) →
//   recordActionFeedback (v8.28) → adaptive weights update → better ranking.
//
// POST creates drafts for the TOP 5 Master Brain actions. Existing 'pending'
// drafts are marked 'expired' (replaced by new recommendations). Idempotent —
// if `snapshotDate` is provided AND drafts already exist for it, returns
// those existing drafts instead of re-creating.
//
// PATCH /api/ai/brain/drafts/{id} — handled in drafts/[id]/route.ts
//   - Updates a draft's status to 'executed' | 'rejected' | 'approved'
//   - For 'executed'/'rejected': calls recordActionFeedback (closes feedback loop)
//
// DETERMINISTIC (aiUsed: false): route handler ne kliče AI/LLM SDK direktno.
// POST handler kliče masterBrain() (interno — ta lahko sproži AI klice preko
// svojih 7 domen brain-ov, vendar znotraj svoje closure, ne preko ctx.callAi).
// v8.95.0-c: enforceBudget: true (consistency guard — recordAiCall je additive,
// ne breaking; isti vzorec kot vse v8.94.x migracije brain endpoint-ov).

import type { NextRequest } from 'next/server';
import {
  withAiRoute,
  AI_ROUTE_DEFAULTS,
  type AiRouteContext,
} from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import {
  createDraftsFromMasterBrain,
  getDraftQueue,
  type DraftStatus,
  type CreateDraftsInput,
  type DraftQueueQuery,
} from '@/lib/brain/draft-queue';
import type { DomainName } from '@/lib/brain/master';
import type { Confidence } from '@/lib/brain/profit';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Domain / enum validation ----------------------------------------------

const ALL_DOMAINS: DomainName[] = ['profit', 'inventory', 'market', 'sourcing', 'risk', 'buyer', 'pricing'];
const DOMAIN_SET = new Set<string>(ALL_DOMAINS);

const VALID_STATUS_SET = new Set<string>(['pending', 'approved', 'executed', 'rejected', 'expired']);
const VALID_CONFIDENCE_SET = new Set<string>(['HIGH', 'MEDIUM', 'LOW']);

// --- Input interfaces -------------------------------------------------------

interface DraftsPostInput {
  actions?: CreateDraftsInput['actions'];
  snapshotDate?: string;
}

// --- GET: fetch draft queue with optional filters + stats -------------------

export const GET = withAiRoute<DraftQueueQuery>({
  endpoint: '/api/ai/brain/drafts',
  maxDuration: 60,
  enforceBudget: true, // v8.95.0-c: consistency guard (pure-read; non-breaking)
  method: 'GET',

  // GET nima telesa — parseBody vzame query string iz URL-ja
  parseBody: (req) => parseDraftsQuery(req),

  // Brez validateInput — vsi input-i imajo defaults (limit=30, days=30)
  handler: async (input, _ctx: AiRouteContext) => {
    const result = await getDraftQueue(input);
    return apiOk(result);
  },
});

// --- POST: create drafts from Master Brain TOP 5 --------------------------

/**
 * Parse the POST body. Accepts:
 *   { }                                    // empty — calls masterBrain() for TOP 5
 *   { actions: [...], snapshotDate?: 'YYYY-MM-DD' }  // explicit actions (e.g. from cached master)
 *   { snapshotDate: 'YYYY-MM-DD' }         // calls masterBrain() and tags drafts with snapshotDate
 *
 * Each action object: { rank, domain, signal, action, expectedUpliftEUR, confidence }
 * - rank: number 1-5
 * - domain: 'profit' | 'inventory' | 'market' | 'sourcing' | 'risk' | 'buyer' | 'pricing'
 * - signal: non-empty string
 * - action: non-empty string (human-readable)
 * - expectedUpliftEUR: number (EUR/month)
 * - confidence: 'HIGH' | 'MEDIUM' | 'LOW'
 *
 * Invalid actions are filtered out (not error). If ALL actions are invalid OR
 * masterBrain returns 0 topActions, returns { ok: true, created: 0, drafts: [], expiredCount: N }.
 */
export const POST = withAiRoute<DraftsPostInput>({
  endpoint: '/api/ai/brain/drafts',
  maxDuration: 60,
  enforceBudget: true, // v8.95.0-c: masterBrain() lahko interno kliče AI
  method: 'POST',

  parseBody: (req) => parseDraftsBody(req),

  // Brez validateInput — prazno telo je valid (kliče masterBrain)
  handler: async (input, _ctx: AiRouteContext) => {
    const result = await createDraftsFromActions(input);
    return apiOk(result);
  },
});

// --- Pomožne funkcije (pure, testabilne) ------------------------------------

/**
 * Parse GET query string into DraftQueueQuery.
 * Defaults: limit=30, days=30. status/domain only set if they pass enum
 * validation. limit/days clamped to positive integers.
 */
function parseDraftsQuery(req: NextRequest): DraftQueueQuery {
  let url: URL | null = null;
  try {
    url = new URL(req.url);
  } catch {
    url = null;
  }
  const sp = url?.searchParams;

  const query: DraftQueueQuery = { limit: 30, days: 30 };
  if (sp) {
    const statusRaw = sp.get('status');
    if (statusRaw && VALID_STATUS_SET.has(statusRaw)) {
      query.status = statusRaw as DraftStatus;
    }
    const domainRaw = sp.get('domain');
    if (domainRaw && DOMAIN_SET.has(domainRaw)) {
      query.domain = domainRaw as DomainName;
    }
    const limitRaw = sp.get('limit');
    if (limitRaw) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n > 0) query.limit = Math.floor(n);
    }
    const daysRaw = sp.get('days');
    if (daysRaw) {
      const n = Number(daysRaw);
      if (Number.isFinite(n) && n > 0) query.days = Math.floor(n);
    }
  }
  return query;
}

/**
 * Parse POST body into DraftsPostInput.
 *
 * Defensive JSON parse — tolerates missing/invalid Content-Type and non-object
 * bodies by falling back to {}. snapshotDate validated against YYYY-MM-DD regex.
 * Actions array filtered to valid object shape; per-action fields coerced with
 * type-safe fallbacks (rank → 0, domain → '', signal/action → '', uplift → 0,
 * confidence → '').
 */
async function parseDraftsBody(req: NextRequest): Promise<DraftsPostInput> {
  let body: Record<string, unknown> = {};
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const cloned = req.clone();
      const parsed = (await cloned.json()) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed;
      }
    }
  } catch {
    body = {};
  }

  let snapshotDate: string | undefined = undefined;
  if (typeof body.snapshotDate === 'string' && body.snapshotDate.trim() !== '') {
    // Light validation — must be YYYY-MM-DD format
    const sd = body.snapshotDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      snapshotDate = sd;
    }
  }

  // Parse explicit actions if provided
  let actions: CreateDraftsInput['actions'] | undefined = undefined;
  if (Array.isArray(body.actions)) {
    actions = (body.actions as any[])
      .filter((a) => a && typeof a === 'object' && !Array.isArray(a))
      .map((a) => {
        const o = a as Record<string, unknown>;
        return {
          rank: typeof o.rank === 'number' ? o.rank : Number(o.rank) || 0,
          domain: typeof o.domain === 'string' ? (o.domain as DomainName) : ('' as DomainName),
          signal: typeof o.signal === 'string' ? o.signal : '',
          action: typeof o.action === 'string' ? o.action : '',
          expectedUpliftEUR: typeof o.expectedUpliftEUR === 'number'
            ? o.expectedUpliftEUR
            : Number(o.expectedUpliftEUR) || 0,
          confidence: typeof o.confidence === 'string' ? (o.confidence as Confidence) : ('' as Confidence),
        };
      });
  }

  return { actions, snapshotDate };
}

/**
 * Create drafts from explicit actions OR by calling masterBrain() for TOP 5.
 *
 * If `actions` is undefined (POST body without explicit actions), calls
 * masterBrain() and uses its topActions. If snapshotDate is also absent,
 * defaults to today's date (UTC).
 *
 * Otherwise (actions explicitly provided), uses them as-is with the provided
 * snapshotDate (may be undefined — createDraftsFromMasterBrain handles it).
 */
async function createDraftsFromActions(
  input: DraftsPostInput,
): Promise<Awaited<ReturnType<typeof createDraftsFromMasterBrain>>> {
  let { actions, snapshotDate } = input;

  // If no actions provided, call masterBrain() and use its topActions
  if (!actions) {
    const { masterBrain } = await import('@/lib/brain/master');
    const masterInput = {} as any; // default inputs — same as GET /api/ai/brain/master
    const masterResult = await masterBrain(masterInput);
    actions = masterResult.topActions.map((a) => ({
      rank: a.rank,
      domain: a.domain,
      signal: a.signal,
      action: a.action,
      expectedUpliftEUR: a.expectedUpliftEUR,
      confidence: a.confidence,
    }));
    // If snapshotDate not provided, use today's date (UTC)
    if (!snapshotDate) {
      const today = new Date();
      snapshotDate = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    }
  }

  return await createDraftsFromMasterBrain({ actions, snapshotDate });
}

// NOTE: VALID_CONFIDENCE_SET je ohranjen iz originala za prihodnjo uporabo
// (validacija confidence v parseDraftsBody). Trenutno se confidence preko
// tip-coercion preverja preko CreateDraftsInput['actions'] tipa, ne preko Set-a.
void VALID_CONFIDENCE_SET;
