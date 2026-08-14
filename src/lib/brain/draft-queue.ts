// v8.29: Draft Queue — stores Master Brain TOP 5 actions + tracks execution status.
// Closed feedback loop: when user marks a draft as executed/rejected, calls
// recordActionFeedback() from v8.28 (adaptive-weights.ts) so the system learns.
//
// Architectural role: connects Master Brain output → user decision → adaptive weights.
// Without this, adaptive weights (v8.28) have no input source — the feedback demo
// form in v8.28 was manual. v8.29 makes it automatic via the draft queue.
//
// Lifecycle:
//   1. createDraftsFromMasterBrain(actions, snapshotDate?) — creates 5 drafts for
//      the current Master Brain TOP 5. Existing 'pending' drafts are marked
//      'expired' (replaced by new recommendations). Idempotent: if drafts already
//      exist for the given snapshotDate, returns them instead of re-creating.
//   2. updateDraftStatus(id, status, feedbackNote?) — updates a draft's status.
//      If status is 'executed' or 'rejected', ALSO calls recordActionFeedback()
//      from adaptive-weights.ts (v8.28) — the system learns from the user's
//      decision. Closes the feedback loop.
//   3. getDraftQueue(query) — fetches drafts with optional filters (status, domain,
//      limit, days). Returns drafts + overall stats + per-domain execution rates
//      (for adaptive weights transparency — same shape as the Adaptive Weights card).
//   4. cleanupOldDrafts(daysOld) — deletes old drafts (status IN executed/rejected/
//      expired AND createdAt < now - daysOld). Called by daily cron.
//
// DB approach: uses the standard `db` from @/lib/db (typed PrismaClient).
// The ActionDraft model is a NEW model (not a Settings field extension), so the
// stale PrismaClient issue from v8.28 (which needed raw SQL for the new Settings
// field) doesn't apply — Prisma regenerates the client on `db:push` and the new
// model's accessor is available immediately. We still bump SCHEMA_VERSION in
// db.ts to discard the stale client from globalThis cache on dev server reload.
//
// Deterministic (aiUsed: false): no AI/LLM SDK is called.

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { recordActionFeedback, type WeightAdjustmentResult } from './adaptive-weights';
import type { DomainName } from './master';

// --- Types -----------------------------------------------------------------

export type DraftStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ActionDraft {
  id: string;
  rank: number;
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: Confidence;
  status: DraftStatus;
  feedbackNote: string | null;
  executedAt: Date | null;
  rejectedAt: Date | null;
  snapshotDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDraftsInput {
  // The TOP 5 actions from Master Brain to create as drafts
  actions: Array<{
    rank: number;
    domain: DomainName;
    signal: string;
    action: string;
    expectedUpliftEUR: number;
    confidence: Confidence;
  }>;
  snapshotDate?: string; // optional link to BrainSnapshot (YYYY-MM-DD)
}

export interface CreateDraftsResult {
  ok: true;
  created: number;
  drafts: ActionDraft[];
  // Existing pending drafts that were expired (replaced by new ones)
  expiredCount: number;
}

export interface UpdateDraftStatusInput {
  id: string;
  status: 'executed' | 'rejected' | 'approved';
  feedbackNote?: string;
}

export interface UpdateDraftStatusResult {
  ok: true;
  draft: ActionDraft;
  // The feedback that was recorded (for adaptive weights — v8.28 integration)
  feedbackRecorded: boolean;
  feedbackResult?: WeightAdjustmentResult;
}

export interface DraftQueueQuery {
  status?: DraftStatus;
  domain?: DomainName;
  limit?: number; // default 30
  days?: number; // default 30 (last N days)
}

export interface DomainStat {
  domain: DomainName;
  executed: number;
  rejected: number;
  pending: number;
  executionRate: number; // executed / (executed + rejected), 0 if no decisions yet
}

export interface DraftQueueStats {
  total: number;
  pending: number;
  approved: number;
  executed: number;
  rejected: number;
  expired: number;
  executionRate: number; // executed / (executed + rejected) overall
}

export interface DraftQueueResult {
  ok: true;
  drafts: ActionDraft[];
  stats: DraftQueueStats;
  domainStats: DomainStat[];
}

// --- Constants -------------------------------------------------------------

const ALL_DOMAINS: DomainName[] = ['profit', 'inventory', 'market', 'sourcing', 'risk', 'buyer', 'pricing'];
const DOMAIN_SET = new Set<string>(ALL_DOMAINS);

const VALID_CONFIDENCE = new Set<string>(['HIGH', 'MEDIUM', 'LOW']);
const VALID_STATUS = new Set<string>(['pending', 'approved', 'executed', 'rejected', 'expired']);

/**
 * v8.29: Use a FRESH PrismaClient per call (same pattern as v8.28
 * adaptive-weights.ts). The standard `db` from @/lib/db caches a single
 * PrismaClient in `globalThis.prisma` for the lifetime of the dev server
 * process — fine for production but problematic in dev when the schema
 * changes mid-run. The SCHEMA_VERSION check in db.ts SHOULD discard the
 * stale client, but Turbopack's module-caching can still hold a reference
 * to the OLD @prisma/client module (which doesn't know about the new
 * `ActionDraft` model's accessor). Creating a fresh PrismaClient each call
 * guarantees we always use the latest generated client.
 *
 * PrismaClient internally pools connections, so this is still cheap.
 */
function getFreshDb(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn'],
  });
}

// --- Row → ActionDraft mapping --------------------------------------------

/**
 * Map a raw DB row (Prisma's ActionDraft or a $queryRaw result) to the
 * ActionDraft interface. Handles Prisma typed objects (Date fields already
 * Date instances) and raw SQL rows (Date fields as ISO strings).
 */
function mapRow(row: any): ActionDraft {
  return {
    id: String(row.id),
    rank: Number(row.rank),
    domain: row.domain as DomainName,
    signal: String(row.signal),
    action: String(row.action),
    expectedUpliftEUR: Number(row.expectedUpliftEUR),
    confidence: row.confidence as Confidence,
    status: row.status as DraftStatus,
    feedbackNote: row.feedbackNote == null ? null : String(row.feedbackNote),
    executedAt: row.executedAt == null ? null : new Date(row.executedAt),
    rejectedAt: row.rejectedAt == null ? null : new Date(row.rejectedAt),
    snapshotDate: row.snapshotDate == null ? null : String(row.snapshotDate),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

// --- Create drafts from Master Brain TOP 5 --------------------------------

/**
 * Create drafts for TOP 5 Master Brain actions.
 * Any existing 'pending' drafts are marked 'expired' (replaced by new recommendations).
 *
 * IDEMPOTENT: if `snapshotDate` is provided AND drafts already exist with that
 * snapshotDate (any status), return those existing drafts instead of re-creating.
 * This lets the UI call POST /api/ai/brain/drafts on every Master Brain load
 * without creating duplicate drafts for the same snapshot.
 *
 * If `snapshotDate` is not provided, ALWAYS creates new drafts (and expires
 * existing pending ones) — used for the "force re-create" path.
 */
export async function createDraftsFromMasterBrain(input: CreateDraftsInput): Promise<CreateDraftsResult> {
  const { actions, snapshotDate } = input;

  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: true, created: 0, drafts: [], expiredCount: 0 };
  }

  // Validate each action
  const validActions = actions.filter((a) => {
    if (typeof a.rank !== 'number' || !Number.isFinite(a.rank)) return false;
    if (!DOMAIN_SET.has(a.domain)) return false;
    if (typeof a.signal !== 'string' || a.signal.trim() === '') return false;
    if (typeof a.action !== 'string' || a.action.trim() === '') return false;
    if (typeof a.expectedUpliftEUR !== 'number' || !Number.isFinite(a.expectedUpliftEUR)) return false;
    if (!VALID_CONFIDENCE.has(a.confidence)) return false;
    return true;
  });

  if (validActions.length === 0) {
    return { ok: true, created: 0, drafts: [], expiredCount: 0 };
  }

  const db = getFreshDb();
  try {
    // 1. Idempotency: if snapshotDate provided, check existing drafts for it
    if (snapshotDate) {
      const existingRows = await db.$queryRaw<any[]>`
        SELECT * FROM ActionDraft WHERE snapshotDate = ${snapshotDate} ORDER BY rank ASC
      `;
      if (existingRows.length > 0) {
        const existingDrafts = existingRows.map(mapRow);
        logger.info('createDraftsFromMasterBrain', `idempotent return of ${existingDrafts.length} existing drafts for snapshotDate=${snapshotDate}`);
        return {
          ok: true,
          created: 0,
          drafts: existingDrafts,
          expiredCount: 0,
        };
      }
    }

    // 2. Expire existing 'pending' drafts (replaced by new recommendations)
    //    We use raw SQL UPDATE because the typed PrismaClient may be stale in dev.
    const expiredResult = await db.$executeRaw`
      UPDATE ActionDraft SET status = 'expired', "updatedAt" = ${new Date().toISOString()}
      WHERE status = 'pending'
    `;
    const expiredCount = Number(expiredResult) || 0;

    // 3. Create new drafts — one per action in input.actions
    const createdAt = new Date().toISOString();
    const createdDrafts: ActionDraft[] = [];
    for (const a of validActions) {
      // Generate a cuid-like id (use crypto.randomUUID if available, else fallback)
      const id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const updatedAt = createdAt;
      await db.$executeRaw`
        INSERT INTO ActionDraft (id, rank, domain, signal, action, "expectedUpliftEUR", confidence, status, "feedbackNote", "executedAt", "rejectedAt", "snapshotDate", "createdAt", "updatedAt")
        VALUES (${id}, ${a.rank}, ${a.domain}, ${a.signal}, ${a.action}, ${a.expectedUpliftEUR}, ${a.confidence}, 'pending', NULL, NULL, NULL, ${snapshotDate ?? null}, ${createdAt}, ${updatedAt})
      `;
      createdDrafts.push({
        id,
        rank: a.rank,
        domain: a.domain,
        signal: a.signal,
        action: a.action,
        expectedUpliftEUR: a.expectedUpliftEUR,
        confidence: a.confidence,
        status: 'pending',
        feedbackNote: null,
        executedAt: null,
        rejectedAt: null,
        snapshotDate: snapshotDate ?? null,
        createdAt: new Date(createdAt),
        updatedAt: new Date(updatedAt),
      });
    }

    logger.info('createDraftsFromMasterBrain', `created ${createdDrafts.length} drafts (expired ${expiredCount} pending)`, {
      snapshotDate,
      createdCount: createdDrafts.length,
      expiredCount,
    });

    return {
      ok: true,
      created: createdDrafts.length,
      drafts: createdDrafts,
      expiredCount,
    };
  } catch (err: any) {
    logger.error('createDraftsFromMasterBrain', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Update draft status (closes feedback loop) ---------------------------

/**
 * Update a draft's status. If status is 'executed' or 'rejected', ALSO calls
 * recordActionFeedback() from adaptive-weights.ts (v8.28) so the system learns.
 *
 * This is the CULMINATION of the Intelligence phase — the closed feedback loop:
 *   Master Brain recommends (v8.22) → user decides (v8.29 ✅/❌ button) →
 *   adaptive weights learn (v8.28) → better recommendations next time.
 *
 * For status='approved' (intermediate state — user is considering): does NOT
 * call recordActionFeedback (only final decisions trigger learning).
 */
export async function updateDraftStatus(input: UpdateDraftStatusInput): Promise<UpdateDraftStatusResult> {
  const { id, status, feedbackNote } = input;

  if (!VALID_STATUS.has(status)) {
    throw new Error(`Invalid status: ${status}. Must be 'executed', 'rejected', or 'approved'.`);
  }
  // Note: UpdateDraftStatusInput.status type already constrains to 'executed'|'rejected'|'approved',
  // but we check VALID_STATUS too for runtime safety against any caller bypassing TypeScript.

  const db = getFreshDb();
  try {
    // 1. Fetch the draft (raw SQL to bypass Turbopack stale @prisma/client)
    const rows = await db.$queryRaw<any[]>`
      SELECT * FROM ActionDraft WHERE id = ${id} LIMIT 1
    `;
    if (rows.length === 0) {
      throw new Error(`Draft not found: ${id}`);
    }
    const existing = mapRow(rows[0]);

    // Guard: don't allow re-deciding an already-decided draft
    if (existing.status === 'executed' || existing.status === 'rejected') {
      throw new Error(`Draft ${id} already has final status '${existing.status}' (cannot change to '${status}').`);
    }

    // 2. Compute update fields
    const now = new Date();
    const nowIso = now.toISOString();
    const executedAt = status === 'executed' ? nowIso : existing.executedAt?.toISOString() ?? null;
    const rejectedAt = status === 'rejected' ? nowIso : existing.rejectedAt?.toISOString() ?? null;
    const newFeedbackNote = feedbackNote !== undefined ? feedbackNote : existing.feedbackNote;

    // 3. Update the draft row
    await db.$executeRaw`
      UPDATE ActionDraft
      SET status = ${status},
          "executedAt" = ${executedAt},
          "rejectedAt" = ${rejectedAt},
          "feedbackNote" = ${newFeedbackNote},
          "updatedAt" = ${nowIso}
      WHERE id = ${id}
    `;

    // 4. Build updated draft for return
    const updatedDraft: ActionDraft = {
      ...existing,
      status,
      executedAt: executedAt ? new Date(executedAt) : null,
      rejectedAt: rejectedAt ? new Date(rejectedAt) : null,
      feedbackNote: newFeedbackNote,
      updatedAt: now,
    };

    // 5. Close feedback loop: if executed/rejected, call recordActionFeedback from v8.28
    let feedbackRecorded = false;
    let feedbackResult: WeightAdjustmentResult | undefined;
    if (status === 'executed' || status === 'rejected') {
      try {
        const feedback = status; // 'executed' | 'rejected'
        feedbackResult = await recordActionFeedback({
          domain: existing.domain,
          action: existing.action,
          feedback,
        });
        feedbackRecorded = true;
        logger.info('updateDraftStatus', `feedback loop closed for draft ${id}`, {
          domain: existing.domain,
          feedback,
          adjusted: feedbackResult.adjusted,
          oldWeight: feedbackResult.oldWeight,
          newWeight: feedbackResult.newWeight,
        });
      } catch (err: any) {
        // Feedback loop failure is non-fatal — the draft update succeeded.
        // Log and continue (the user's decision is still recorded in the draft).
        logger.error('updateDraftStatus', `recordActionFeedback failed for draft ${id} (draft update still succeeded)`, err);
      }
    }

    return {
      ok: true,
      draft: updatedDraft,
      feedbackRecorded,
      feedbackResult,
    };
  } catch (err: any) {
    logger.error('updateDraftStatus', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Fetch draft queue with filters + stats -------------------------------

/**
 * Fetch draft queue with optional filters + compute aggregate stats.
 *
 * Stats include:
 *   - total / pending / approved / executed / rejected / expired counts
 *   - executionRate (overall: executed / (executed + rejected))
 *   - per-domain execution rates (7 rows — one per domain)
 *
 * Per-domain rates mirror the Adaptive Weights card UI (v8.28) so the user
 * can see HOW their decisions have influenced the system at a glance.
 */
export async function getDraftQueue(query: DraftQueueQuery = {}): Promise<DraftQueueResult> {
  const status = query.status;
  const domain = query.domain;
  const limit = typeof query.limit === 'number' && query.limit > 0 ? Math.min(Math.floor(query.limit), 200) : 30;
  const days = typeof query.days === 'number' && query.days > 0 ? Math.min(Math.floor(query.days), 365) : 30;
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = getFreshDb();
  try {
    // Build the WHERE clause dynamically using Prisma.sql fragments — safe
    // parameterized queries (no string concatenation of user input).
    const conditions: Prisma.Sql[] = [Prisma.sql`"createdAt" >= ${cutoffDate}`];
    if (status && VALID_STATUS.has(status)) {
      conditions.push(Prisma.sql`status = ${status}`);
    }
    if (domain && DOMAIN_SET.has(domain)) {
      conditions.push(Prisma.sql`domain = ${domain}`);
    }
    const whereClause = Prisma.join(conditions, ' AND ');

    const rows = await db.$queryRaw<any[]>(
      Prisma.sql`SELECT * FROM ActionDraft WHERE ${whereClause} ORDER BY "createdAt" DESC LIMIT ${limit}`,
    );
    const drafts = rows.map(mapRow);

    // Compute stats — fetch the FULL dataset (within days window) for accurate counts.
    // Re-uses cutoffDate but ignores status/domain filters so stats reflect ALL drafts.
    const statsRows = await db.$queryRaw<any[]>(
      Prisma.sql`SELECT status, domain FROM ActionDraft WHERE "createdAt" >= ${cutoffDate}`,
    );

    let total = 0;
    let pending = 0;
    let approved = 0;
    let executed = 0;
    let rejected = 0;
    let expired = 0;
    const perDomain: Record<string, { executed: number; rejected: number; pending: number }> = {};
    for (const d of ALL_DOMAINS) {
      perDomain[d] = { executed: 0, rejected: 0, pending: 0 };
    }

    for (const r of statsRows) {
      total++;
      const s = String(r.status);
      const dom = String(r.domain);
      if (s === 'pending') pending++;
      else if (s === 'approved') approved++;
      else if (s === 'executed') executed++;
      else if (s === 'rejected') rejected++;
      else if (s === 'expired') expired++;
      if (perDomain[dom]) {
        if (s === 'executed') perDomain[dom].executed++;
        else if (s === 'rejected') perDomain[dom].rejected++;
        else if (s === 'pending') perDomain[dom].pending++;
      }
    }

    const decisionsTotal = executed + rejected;
    const executionRate = decisionsTotal > 0 ? Math.round((executed / decisionsTotal) * 100) / 100 : 0;

    const domainStats: DomainStat[] = ALL_DOMAINS.map((d) => {
      const s = perDomain[d];
      const domDecisions = s.executed + s.rejected;
      return {
        domain: d,
        executed: s.executed,
        rejected: s.rejected,
        pending: s.pending,
        executionRate: domDecisions > 0 ? Math.round((s.executed / domDecisions) * 100) / 100 : 0,
      };
    });

    return {
      ok: true,
      drafts,
      stats: {
        total,
        pending,
        approved,
        executed,
        rejected,
        expired,
        executionRate,
      },
      domainStats,
    };
  } catch (err: any) {
    logger.error('getDraftQueue', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Cleanup old drafts (cron) --------------------------------------------

/**
 * Delete old drafts. Called by daily cron (/api/cron/cleanup-drafts).
 *
 * Deletes drafts where:
 *   - createdAt < (now - daysOld)
 *   - AND status IN ('executed', 'rejected', 'expired')
 *
 * 'pending' and 'approved' drafts are NEVER deleted (they represent open
 * decisions the user may still act on).
 *
 * Default: 90 days old. Configurable via the `daysOld` parameter.
 */
export async function cleanupOldDrafts(daysOld = 90): Promise<{ ok: true; deleted: number }> {
  if (typeof daysOld !== 'number' || !Number.isFinite(daysOld) || daysOld <= 0) {
    daysOld = 90;
  }
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

  const db = getFreshDb();
  try {
    const deleted = await db.$executeRaw`
      DELETE FROM ActionDraft
      WHERE "createdAt" < ${cutoff}
        AND status IN ('executed', 'rejected', 'expired')
    `;
    const count = Number(deleted) || 0;
    logger.info('cleanupOldDrafts', `deleted ${count} old drafts (>${daysOld} days, status in executed/rejected/expired)`);
    return { ok: true, deleted: count };
  } catch (err: any) {
    logger.error('cleanupOldDrafts', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}
