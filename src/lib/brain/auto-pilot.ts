// v8.30: Safe Auto-pilot — automatically executes LOW-risk Master Brain actions
// that meet ALL safety criteria. First step toward autonomous trading.
//
// 🎯 AUTOMATION PHASE STARTED.
//
// SAFETY RULES (all must be true for auto-execution):
// 1. autoPilotEnabled is true (master switch — default OFF)
// 2. autoPilotMode is 'safe' (v8.31 will add 'aggressive')
// 3. User Risk Profile tolerance is NOT 'conservative' (conservative users
//    never get auto-pilot — they explicitly asked for caution)
// 4. Action confidence is 'LOW' (HIGH/MEDIUM always need manual)
// 5. Action's expectedUpliftEUR < 100€ (small impact, safe to auto-execute)
// 6. Action domain is NOT 'risk' (risk mitigation needs human judgment)
// 7. Daily limit not exceeded (autoExecuted count today < autoPilotDailyLimit)
// 8. Daily budget not exceeded (sum of today's autoExecuted uplift <
//    autoPilotDailyBudgetEUR)
//
// Each auto-execution:
// - Sets draft.status = 'executed', autoExecuted = true, executedAt = now
// - Records autoPilotReason (8-rule audit trail — semicolon-separated)
// - Calls recordActionFeedback() from v8.28 (closes feedback loop) via the
//   updateDraftStatus() path in draft-queue.ts — then patches autoExecuted +
//   autoPilotReason on the same row (audit trail).
// - Is rollbackable (user can undo via rollbackAutoExecution)
//
// MEDIUM/HIGH risk actions are left as 'pending' for manual execution.
//
// Deterministic (aiUsed: false): no AI/LLM SDK is called. No external side
// effects beyond DB writes — the "execution" here is purely bookkeeping. The
// real-world action (e.g. send Telegram, relist an item) is OUT OF SCOPE for
// v8.30 — that's the integration layer v8.31+ will add. v8.30 establishes the
// safety framework + audit trail + rollback capability.

import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import { updateDraftStatus } from './draft-queue';
import { recordActionFeedback } from './adaptive-weights';
import type { ActionDraft } from './draft-queue';
import type { DomainName } from './master';

// --- Types -----------------------------------------------------------------

/**
 * v8.30: Extends ActionDraft (v8.29) with the 5 new auto-pilot tracking fields.
 * We extend the interface here rather than modify draft-queue.ts (which is
 * out of scope per v8.30 task constraints — only ADD new files). The
 * underlying DB row has these columns; this type just makes them accessible
 * to callers without requiring draft-queue.ts changes.
 */
export interface ActionDraftV830 extends ActionDraft {
  autoExecuted: boolean;
  autoPilotReason: string | null;
  rolledBack: boolean;
  rolledBackAt: Date | null;
  rollbackReason: string | null;
}

export interface AutoPilotConfig {
  enabled: boolean;
  mode: 'safe' | 'aggressive';
  dailyLimit: number;
  dailyBudgetEUR: number;
  lastRunAt: Date | null;
}

export const DEFAULT_AUTOPILOT_CONFIG: AutoPilotConfig = {
  enabled: false,
  mode: 'safe',
  dailyLimit: 5,
  dailyBudgetEUR: 500,
  lastRunAt: null,
};

export interface AutoPilotCandidateCheck {
  draft: ActionDraft;
  canAutoExecute: boolean;
  reasons: string[]; // list of pass/fail reasons (for audit)
}

export interface AutoPilotRunResult {
  ok: true;
  config: AutoPilotConfig;
  checked: number; // total pending drafts checked
  autoExecuted: number; // how many were auto-executed
  skipped: number; // how many failed safety check
  executedDrafts: Array<{
    id: string;
    action: string;
    domain: DomainName;
    reasons: string[];
  }>;
  skippedDrafts: Array<{
    id: string;
    action: string;
    reasons: string[]; // full audit of pass/fail reasons
  }>;
  todayStats: {
    autoExecuted: number;
    budgetUsed: number;
    budgetRemaining: number;
    limitRemaining: number;
  };
  source: 'v8.30-safe-auto-pilot';
}

export interface RollbackResult {
  ok: true;
  draft: ActionDraftV830;
  rolledBack: boolean;
  reason: string;
}

export interface AutoPilotStats {
  ok: true;
  config: AutoPilotConfig;
  today: {
    autoExecuted: number;
    budgetUsed: number;
    budgetRemaining: number;
    limitRemaining: number;
  };
  allTime: {
    totalAutoExecuted: number;
    totalRolledBack: number;
    rollbackRate: number; // rolledBack / totalAutoExecuted × 100
  };
  source: 'v8.30-safe-auto-pilot';
}

// --- DB helper --------------------------------------------------------------

/**
 * v8.30: Use a FRESH PrismaClient per call (same pattern as v8.28
 * adaptive-weights.ts + v8.29 draft-queue.ts). The standard `db` from @/lib/db
 * caches a single PrismaClient in `globalThis.prisma` for the lifetime of the
 * dev server process — fine for production but problematic in dev when the
 * schema changes mid-run. SCHEMA_VERSION in db.ts SHOULD discard the stale
 * client, but Turbopack's module-caching can still hold a reference to the
 * OLD @prisma/client module (which doesn't know about the new auto-pilot
 * fields). Creating a fresh PrismaClient each call guarantees we always use
 * the latest generated client.
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

// --- Row → ActionDraft mapping (mirrors draft-queue.ts mapRow) -------------

function mapRow(row: any): ActionDraft {
  return {
    id: String(row.id),
    rank: Number(row.rank),
    domain: row.domain as DomainName,
    signal: String(row.signal),
    action: String(row.action),
    expectedUpliftEUR: Number(row.expectedUpliftEUR),
    confidence: row.confidence as ActionDraft['confidence'],
    status: row.status as ActionDraft['status'],
    feedbackNote: row.feedbackNote == null ? null : String(row.feedbackNote),
    executedAt: row.executedAt == null ? null : new Date(row.executedAt),
    rejectedAt: row.rejectedAt == null ? null : new Date(row.rejectedAt),
    snapshotDate: row.snapshotDate == null ? null : String(row.snapshotDate),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

// --- Config load / save -----------------------------------------------------

/**
 * Load auto-pilot config from Settings singleton row.
 * On any DB error / missing row / missing fields, returns DEFAULT_AUTOPILOT_CONFIG
 * (enabled=false — fail-safe, never auto-execute on missing config).
 */
export async function loadAutoPilotConfig(): Promise<AutoPilotConfig> {
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<Array<{
      autoPilotEnabled: number | boolean;
      autoPilotMode: string;
      autoPilotDailyLimit: number;
      autoPilotDailyBudgetEUR: number;
      autoPilotLastRunAt: string | Date | null;
    }>>`SELECT autoPilotEnabled, autoPilotMode, autoPilotDailyLimit, autoPilotDailyBudgetEUR, autoPilotLastRunAt FROM Settings WHERE id = 'singleton' LIMIT 1`;
    if (rows.length === 0) return { ...DEFAULT_AUTOPILOT_CONFIG };
    const r = rows[0];
    const mode: 'safe' | 'aggressive' =
      String(r.autoPilotMode ?? 'safe').toLowerCase() === 'aggressive'
        ? 'aggressive'
        : 'safe';
    const lastRunAtRaw = r.autoPilotLastRunAt;
    return {
      enabled: Boolean(r.autoPilotEnabled),
      mode,
      dailyLimit:
        Number.isFinite(Number(r.autoPilotDailyLimit)) && Number(r.autoPilotDailyLimit) > 0
          ? Math.floor(Number(r.autoPilotDailyLimit))
          : DEFAULT_AUTOPILOT_CONFIG.dailyLimit,
      dailyBudgetEUR:
        Number.isFinite(Number(r.autoPilotDailyBudgetEUR)) && Number(r.autoPilotDailyBudgetEUR) > 0
          ? Number(r.autoPilotDailyBudgetEUR)
          : DEFAULT_AUTOPILOT_CONFIG.dailyBudgetEUR,
      lastRunAt: lastRunAtRaw == null ? null : new Date(lastRunAtRaw as string),
    };
  } catch (err: any) {
    logger.warn('loadAutoPilotConfig', 'failed to load, using DEFAULT (disabled)', err);
    return { ...DEFAULT_AUTOPILOT_CONFIG };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Persist auto-pilot config fields to Settings singleton. Uses UPDATE with
 * WHERE id='singleton' — if 0 rows affected (singleton doesn't exist), falls
 * back to INSERT. Same raw-SQL pattern as adaptive-weights.ts to bypass
 * Turbopack stale @prisma/client cache.
 */
async function saveAutoPilotConfig(config: AutoPilotConfig): Promise<void> {
  const db = getFreshDb();
  const nowIso = new Date().toISOString();
  const lastRunIso = config.lastRunAt ? new Date(config.lastRunAt).toISOString() : null;
  try {
    const result = await db.$executeRaw`
      UPDATE Settings
      SET autoPilotEnabled = ${config.enabled ? 1 : 0},
          autoPilotMode = ${config.mode},
          autoPilotDailyLimit = ${config.dailyLimit},
          autoPilotDailyBudgetEUR = ${config.dailyBudgetEUR},
          autoPilotLastRunAt = ${lastRunIso},
          updatedAt = ${nowIso}
      WHERE id = 'singleton'
    `;
    if (result === 0) {
      // Row doesn't exist — INSERT with explicit id + auto-pilot fields.
      // All other Settings fields use their @default values from schema.prisma.
      await db.$executeRaw`
        INSERT INTO Settings (id, autoPilotEnabled, autoPilotMode, autoPilotDailyLimit, autoPilotDailyBudgetEUR, autoPilotLastRunAt)
        VALUES ('singleton', ${config.enabled ? 1 : 0}, ${config.mode}, ${config.dailyLimit}, ${config.dailyBudgetEUR}, ${lastRunIso})
      `;
    }
  } catch (err: any) {
    logger.error('saveAutoPilotConfig', 'raw SQL update/insert failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Pure compute: safety check --------------------------------------------

/**
 * Check if a single draft can be auto-executed (all 8 safety criteria).
 * PURE FUNCTION — no side effects. Exposed for unit testing.
 *
 * The `reasons` array always has exactly 8 entries (one per rule), each
 * prefixed with either "PASS:" or "FAIL:" for easy audit.
 *
 * `canAutoExecute` is true iff ALL 8 reasons start with "PASS:".
 */
export function checkAutoPilotEligibility(
  draft: ActionDraft,
  config: AutoPilotConfig,
  userRiskTolerance: 'conservative' | 'balanced' | 'aggressive',
  todayAutoExecutedCount: number,
  todayAutoExecutedBudgetUsed: number,
): AutoPilotCandidateCheck {
  const reasons: string[] = [];

  // 1. Auto-pilot enabled?
  if (!config.enabled) {
    reasons.push('FAIL: auto-pilot is disabled');
  } else {
    reasons.push('PASS: auto-pilot enabled');
  }

  // 2. Mode is 'safe'?
  if (config.mode !== 'safe') {
    reasons.push(`FAIL: mode is '${config.mode}' not 'safe'`);
  } else {
    reasons.push('PASS: mode is safe');
  }

  // 3. User risk tolerance is NOT conservative
  if (userRiskTolerance === 'conservative') {
    reasons.push('FAIL: user risk tolerance is conservative (auto-pilot disabled for conservative users)');
  } else {
    reasons.push(`PASS: user risk tolerance is ${userRiskTolerance}`);
  }

  // 4. Action confidence is LOW
  if (draft.confidence !== 'LOW') {
    reasons.push(`FAIL: confidence is ${draft.confidence} (only LOW can be auto-executed)`);
  } else {
    reasons.push('PASS: confidence is LOW');
  }

  // 5. expectedUpliftEUR < 100
  if (draft.expectedUpliftEUR >= 100) {
    reasons.push(`FAIL: expectedUpliftEUR ${draft.expectedUpliftEUR}€ >= 100€ threshold`);
  } else {
    reasons.push(`PASS: expectedUpliftEUR ${draft.expectedUpliftEUR}€ < 100€ threshold`);
  }

  // 6. Domain is NOT 'risk'
  if (draft.domain === 'risk') {
    reasons.push('FAIL: domain is risk (risk mitigation needs human judgment)');
  } else {
    reasons.push(`PASS: domain is ${draft.domain} (not risk)`);
  }

  // 7. Daily limit not exceeded
  if (todayAutoExecutedCount >= config.dailyLimit) {
    reasons.push(`FAIL: daily limit ${todayAutoExecutedCount}/${config.dailyLimit} reached`);
  } else {
    reasons.push(`PASS: daily limit ${todayAutoExecutedCount}/${config.dailyLimit} OK`);
  }

  // 8. Daily budget not exceeded
  if (todayAutoExecutedBudgetUsed + draft.expectedUpliftEUR > config.dailyBudgetEUR) {
    reasons.push(
      `FAIL: daily budget ${todayAutoExecutedBudgetUsed}€ + ${draft.expectedUpliftEUR}€ > ${config.dailyBudgetEUR}€`,
    );
  } else {
    reasons.push(
      `PASS: daily budget ${todayAutoExecutedBudgetUsed}€ + ${draft.expectedUpliftEUR}€ <= ${config.dailyBudgetEUR}€`,
    );
  }

  const canAutoExecute = reasons.every((r) => r.startsWith('PASS'));
  return { draft, canAutoExecute, reasons };
}

// --- Today stats helper ----------------------------------------------------

/**
 * Compute today's auto-execution stats: count of drafts auto-executed today
 * + sum of their expectedUpliftEUR (the "budget used").
 *
 * A draft counts as "today's" if `autoExecuted=true` AND `executedAt` is
 * today (UTC midnight to now).
 */
async function computeTodayStats(db: PrismaClient): Promise<{
  autoExecuted: number;
  budgetUsed: number;
}> {
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);
  const rows = await db.$queryRaw<Array<{ count: number; total: number | null }>>`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM("expectedUpliftEUR"), 0) AS total
    FROM ActionDraft
    WHERE autoExecuted = 1
      AND "executedAt" >= ${startOfTodayUtc.toISOString()}
      AND rolledBack = 0
  `;
  const r = rows[0] ?? { count: 0, total: 0 };
  return {
    autoExecuted: Number(r.count) || 0,
    budgetUsed: Number(r.total) || 0,
  };
}

// --- Main entry: runSafeAutoPilot ------------------------------------------

/**
 * Run the safe auto-pilot: check all pending drafts, auto-execute those
 * that pass ALL 8 safety criteria.
 *
 * This is the main entry point. Called by:
 * - Cron job (hourly) — /api/cron/auto-pilot
 * - Manual trigger — POST /api/ai/brain/auto-pilot { action: 'run' }
 *
 * Idempotent within a single run: each pending draft is checked at most once.
 * Daily limit + budget are updated IN-MEMORY during the run (so if the daily
 * limit is 3, we auto-execute at most 3 drafts even if 10 are eligible).
 *
 * After the run, Settings.autoPilotLastRunAt is updated to NOW (audit trail).
 */
export async function runSafeAutoPilot(): Promise<AutoPilotRunResult> {
  // 1. Load config — if disabled, return early
  const config = await loadAutoPilotConfig();
  if (!config.enabled) {
    logger.info('runSafeAutoPilot', 'auto-pilot is disabled — returning empty result');
    return {
      ok: true,
      config,
      checked: 0,
      autoExecuted: 0,
      skipped: 0,
      executedDrafts: [],
      skippedDrafts: [],
      todayStats: {
        autoExecuted: 0,
        budgetUsed: 0,
        budgetRemaining: config.dailyBudgetEUR,
        limitRemaining: config.dailyLimit,
      },
      source: 'v8.30-safe-auto-pilot',
    };
  }

  // 2. Load user risk tolerance (v8.24) — conservative users never get auto-pilot
  const userRiskTolerance = await loadUserRiskTolerance();

  const db = getFreshDb();
  try {
    // 3. Fetch all pending drafts (oldest first — fairness: older
    //    recommendations get auto-executed before newer ones replace them)
    const pendingRows = await db.$queryRaw<any[]>`
      SELECT * FROM ActionDraft WHERE status = 'pending' ORDER BY "createdAt" ASC
    `;
    const pendingDrafts = pendingRows.map(mapRow);

    if (pendingDrafts.length === 0) {
      // Nothing to check — update lastRunAt and return
      const updatedConfig = { ...config, lastRunAt: new Date() };
      await saveAutoPilotConfig(updatedConfig);
      return {
        ok: true,
        config: updatedConfig,
        checked: 0,
        autoExecuted: 0,
        skipped: 0,
        executedDrafts: [],
        skippedDrafts: [],
        todayStats: {
          autoExecuted: 0,
          budgetUsed: 0,
          budgetRemaining: config.dailyBudgetEUR,
          limitRemaining: config.dailyLimit,
        },
        source: 'v8.30-safe-auto-pilot',
      };
    }

    // 4. Compute today's auto-execution count + budget used (so far today)
    const today = await computeTodayStats(db);
    let todayCount = today.autoExecuted;
    let todayBudget = today.budgetUsed;

    const executedDrafts: AutoPilotRunResult['executedDrafts'] = [];
    const skippedDrafts: AutoPilotRunResult['skippedDrafts'] = [];

    // 5. For each pending draft, check eligibility + auto-execute if eligible
    for (const draft of pendingDrafts) {
      const check = checkAutoPilotEligibility(
        draft,
        config,
        userRiskTolerance,
        todayCount,
        todayBudget,
      );

      if (check.canAutoExecute) {
        // Auto-execute: call updateDraftStatus() (closes feedback loop with v8.28),
        // then patch autoExecuted=true + autoPilotReason on the same row.
        try {
          await updateDraftStatus({
            id: draft.id,
            status: 'executed',
            feedbackNote: 'auto-pilot: ' + check.reasons.join('; '),
          });
          // Patch autoExecuted + autoPilotReason — raw SQL on the same row
          const reasonStr = check.reasons.join('; ');
          await db.$executeRaw`
            UPDATE ActionDraft
            SET autoExecuted = 1,
                "autoPilotReason" = ${reasonStr},
                "updatedAt" = ${new Date().toISOString()}
            WHERE id = ${draft.id}
          `;
          // Increment in-memory today stats so subsequent drafts in this loop
          // see updated count + budget (daily limit + budget enforcement).
          todayCount += 1;
          todayBudget += draft.expectedUpliftEUR;

          executedDrafts.push({
            id: draft.id,
            action: draft.action,
            domain: draft.domain,
            reasons: check.reasons,
          });

          logger.info('runSafeAutoPilot', `auto-executed draft ${draft.id} (${draft.action})`, {
            domain: draft.domain,
            uplift: draft.expectedUpliftEUR,
            todayCount,
            todayBudget,
          });
        } catch (err: any) {
          // Auto-execution failed for this draft — log + skip to next.
          // Don't throw (one bad draft shouldn't kill the whole run).
          logger.error('runSafeAutoPilot', `failed to auto-execute draft ${draft.id} — skipping`, err);
          skippedDrafts.push({
            id: draft.id,
            action: draft.action,
            reasons: [...check.reasons, `FAIL: execution error: ${err?.message ?? 'unknown'}`],
          });
        }
      } else {
        // Not eligible — record for skippedDrafts (full audit)
        skippedDrafts.push({
          id: draft.id,
          action: draft.action,
          reasons: check.reasons,
        });
      }
    }

    // 6. Update Settings.autoPilotLastRunAt = now
    const updatedConfig = { ...config, lastRunAt: new Date() };
    await saveAutoPilotConfig(updatedConfig);

    logger.info('runSafeAutoPilot', 'run complete', {
      checked: pendingDrafts.length,
      autoExecuted: executedDrafts.length,
      skipped: skippedDrafts.length,
      todayCount,
      todayBudget,
    });

    return {
      ok: true,
      config: updatedConfig,
      checked: pendingDrafts.length,
      autoExecuted: executedDrafts.length,
      skipped: skippedDrafts.length,
      executedDrafts,
      skippedDrafts,
      todayStats: {
        autoExecuted: todayCount,
        budgetUsed: todayBudget,
        budgetRemaining: Math.max(0, config.dailyBudgetEUR - todayBudget),
        limitRemaining: Math.max(0, config.dailyLimit - todayCount),
      },
      source: 'v8.30-safe-auto-pilot',
    };
  } catch (err: any) {
    logger.error('runSafeAutoPilot', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Rollback ---------------------------------------------------------------

/**
 * Roll back an auto-executed action.
 *
 * Sets rolledBack=true, rolledBackAt=now, rollbackReason=reason.
 *
 * Does NOT un-execute the action in the real world — we can't un-send a
 * Telegram message or un-relist an item. But it:
 *   (1) Marks the audit trail (rolledBack=true for stats + filtering)
 *   (2) Calls recordActionFeedback with 'rejected' to UNDO the learning from
 *       v8.28 — the system thought the user valued this action (auto-executed
 *       counted as "executed" in adaptive weights), but the user disagreed,
 *       so we record a compensating 'rejected' signal.
 *
 * Guard: only drafts with autoExecuted=true AND rolledBack=false can be
 * rolled back. Returns 400 if guard fails.
 */
export async function rollbackAutoExecution(
  draftId: string,
  reason: string,
): Promise<RollbackResult> {
  const db = getFreshDb();
  try {
    // 1. Fetch the draft
    const rows = await db.$queryRaw<any[]>`
      SELECT * FROM ActionDraft WHERE id = ${draftId} LIMIT 1
    `;
    if (rows.length === 0) {
      throw new Error(`Draft not found: ${draftId}`);
    }
    const existing = mapRow(rows[0]);

    // 2. Guard: must be autoExecuted AND not already rolledBack
    if (!isAutoExecutedDraft(rows[0])) {
      throw new Error(`Draft ${draftId} was not auto-executed (cannot roll back a manual execution).`);
    }
    if (Boolean(rows[0].rolledBack)) {
      throw new Error(`Draft ${draftId} was already rolled back at ${rows[0].rolledBackAt}.`);
    }

    // 3. Set rolledBack=true, rolledBackAt=now, rollbackReason=reason
    const nowIso = new Date().toISOString();
    const safeReason = String(reason ?? '').slice(0, 1000);
    await db.$executeRaw`
      UPDATE ActionDraft
      SET rolledBack = 1,
          "rolledBackAt" = ${nowIso},
          "rollbackReason" = ${safeReason || null},
          "updatedAt" = ${nowIso}
      WHERE id = ${draftId}
    `;

    // 4. Call recordActionFeedback with 'rejected' to undo the learning.
    //    When the auto-pilot executed this draft, updateDraftStatus called
    //    recordActionFeedback('executed') — adaptive weights incremented
    //    the executed counter. We now call 'rejected' to balance it out.
    //    This is non-fatal — rollback still succeeds even if feedback fails.
    let feedbackReason = '';
    try {
      const feedbackResult = await recordActionFeedback({
        domain: existing.domain,
        action: existing.action,
        feedback: 'rejected',
      });
      feedbackReason = `feedback undo: executed=${feedbackResult.executed}, rejected=${feedbackResult.rejected}, adjusted=${feedbackResult.adjusted}`;
      logger.info('rollbackAutoExecution', `feedback undo recorded for draft ${draftId}`, {
        domain: existing.domain,
        oldWeight: feedbackResult.oldWeight,
        newWeight: feedbackResult.newWeight,
      });
    } catch (err: any) {
      logger.error('rollbackAutoExecution', `recordActionFeedback failed for draft ${draftId} (rollback still succeeded)`, err);
      feedbackReason = `feedback undo FAILED: ${err?.message ?? 'unknown error'}`;
    }

    // 5. Build the updated draft for the return value (extends ActionDraft
    //    with the v8.30 fields rolledBack/rolledBackAt/rollbackReason +
    //    preserved autoExecuted=true + autoPilotReason).
    const updatedDraft: ActionDraftV830 = {
      ...existing,
      autoExecuted: true,
      autoPilotReason: rows[0].autoPilotReason == null ? null : String(rows[0].autoPilotReason),
      rolledBack: true,
      rolledBackAt: new Date(nowIso),
      rollbackReason: safeReason || null,
      updatedAt: new Date(nowIso),
    };

    return {
      ok: true,
      draft: updatedDraft,
      rolledBack: true,
      reason: `Rolled back at ${nowIso}. ${feedbackReason}`.trim(),
    };
  } catch (err: any) {
    logger.error('rollbackAutoExecution', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// Type guard: row.autoExecuted is stored as 0/1 in SQLite (Boolean in Prisma).
function isAutoExecutedDraft(row: any): boolean {
  return Boolean(row.autoExecuted);
}

// --- Stats -----------------------------------------------------------------

/**
 * Get auto-pilot stats (today + all-time).
 *
 * - config: current AutoPilotConfig (loaded from Settings)
 * - today: today's auto-execution count + budget used + remaining
 * - allTime: total auto-executed (all time) + total rolled back + rollback rate %
 */
export async function getAutoPilotStats(): Promise<AutoPilotStats> {
  const config = await loadAutoPilotConfig();
  const db = getFreshDb();
  try {
    // Today's stats (UTC midnight to now, rolledBack=false)
    const today = await computeTodayStats(db);

    // All-time stats (rolledBack=false means effective executions)
    const allRows = await db.$queryRaw<Array<{
      totalAuto: number;
      totalRollback: number;
    }>>`
      SELECT
        COUNT(CASE WHEN autoExecuted = 1 THEN 1 END) AS totalAuto,
        COUNT(CASE WHEN rolledBack = 1 THEN 1 END) AS totalRollback
      FROM ActionDraft
    `;
    const a = allRows[0] ?? { totalAuto: 0, totalRollback: 0 };
    const totalAutoExecuted = Number(a.totalAuto) || 0;
    const totalRolledBack = Number(a.totalRollback) || 0;
    const rollbackRate =
      totalAutoExecuted > 0
        ? Math.round((totalRolledBack / totalAutoExecuted) * 1000) / 10 // 1 decimal
        : 0;

    return {
      ok: true,
      config,
      today: {
        autoExecuted: today.autoExecuted,
        budgetUsed: today.budgetUsed,
        budgetRemaining: Math.max(0, config.dailyBudgetEUR - today.budgetUsed),
        limitRemaining: Math.max(0, config.dailyLimit - today.autoExecuted),
      },
      allTime: {
        totalAutoExecuted,
        totalRolledBack,
        rollbackRate,
      },
      source: 'v8.30-safe-auto-pilot',
    };
  } catch (err: any) {
    logger.error('getAutoPilotStats', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Config update ---------------------------------------------------------

/**
 * Update auto-pilot config (enable/disable, change limits, change mode).
 *
 * Accepts a Partial<AutoPilotConfig> — unspecified fields retain their
 * current value (loaded from DB first). Returns the merged config.
 *
 * NOTE: 'aggressive' mode is accepted by this function (forward-compat) but
 * runSafeAutoPilot() will refuse to auto-execute when mode !== 'safe' (rule 2
 * fails). So setting mode='aggressive' is a no-op for now — kept so the UI
 * can show it as "coming v8.31" and persist user intent.
 */
export async function updateAutoPilotConfig(
  updates: Partial<AutoPilotConfig>,
): Promise<{ ok: true; config: AutoPilotConfig }> {
  const current = await loadAutoPilotConfig();

  const merged: AutoPilotConfig = {
    enabled:
      typeof updates.enabled === 'boolean' ? updates.enabled : current.enabled,
    mode:
      updates.mode === 'safe' || updates.mode === 'aggressive'
        ? updates.mode
        : current.mode,
    dailyLimit:
      typeof updates.dailyLimit === 'number' &&
      Number.isFinite(updates.dailyLimit) &&
      updates.dailyLimit > 0
        ? Math.min(50, Math.max(1, Math.floor(updates.dailyLimit)))
        : current.dailyLimit,
    dailyBudgetEUR:
      typeof updates.dailyBudgetEUR === 'number' &&
      Number.isFinite(updates.dailyBudgetEUR) &&
      updates.dailyBudgetEUR > 0
        ? Math.min(10000, Math.max(10, Math.round(updates.dailyBudgetEUR)))
        : current.dailyBudgetEUR,
    lastRunAt: current.lastRunAt, // never overwritten by update (only by runSafeAutoPilot)
  };

  await saveAutoPilotConfig(merged);

  logger.info('updateAutoPilotConfig', 'config updated', {
    enabled: merged.enabled,
    mode: merged.mode,
    dailyLimit: merged.dailyLimit,
    dailyBudgetEUR: merged.dailyBudgetEUR,
  });

  return { ok: true, config: merged };
}

// --- User risk tolerance loader (mirrors risk-profile.ts loadProfile) ------

/**
 * Load user's risk tolerance from Settings singleton.
 * Used by runSafeAutoPilot() to enforce rule 3 (conservative users never
 * get auto-pilot). Returns 'balanced' on any error / missing row.
 */
async function loadUserRiskTolerance(): Promise<'conservative' | 'balanced' | 'aggressive'> {
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<Array<{ userRiskTolerance: string | null }>>`
      SELECT userRiskTolerance FROM Settings WHERE id = 'singleton' LIMIT 1
    `;
    if (rows.length === 0) return 'balanced';
    const raw = String(rows[0].userRiskTolerance ?? 'balanced').toLowerCase();
    if (raw === 'conservative' || raw === 'aggressive') return raw;
    return 'balanced';
  } catch (err: any) {
    logger.warn('loadUserRiskTolerance', 'failed to load, using balanced', err);
    return 'balanced';
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- History fetcher (for UI rollback section) ----------------------------

/**
 * Fetch recent auto-executed drafts for the UI history view.
 * Returns the last N drafts where autoExecuted=true, newest first.
 * Each includes the rollback fields so the UI can show the rollback button
 * (only for non-rolled-back drafts) + rollback reason (if rolled back).
 */
export async function getAutoExecutedHistory(
  limit = 10,
): Promise<{
  ok: true;
  drafts: Array<{
    id: string;
    rank: number;
    domain: DomainName;
    action: string;
    signal: string;
    expectedUpliftEUR: number;
    confidence: string;
    status: string;
    autoExecuted: boolean;
    autoPilotReason: string | null;
    rolledBack: boolean;
    rolledBackAt: string | null;
    rollbackReason: string | null;
    executedAt: string | null;
    createdAt: string;
  }>;
  source: 'v8.30-safe-auto-pilot';
}> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<any[]>`
      SELECT id, rank, domain, signal, action, "expectedUpliftEUR", confidence, status,
             "autoPilotReason", rolledBack, "rolledBackAt", "rollbackReason",
             "executedAt", "createdAt"
      FROM ActionDraft
      WHERE autoExecuted = 1
      ORDER BY "executedAt" DESC
      LIMIT ${safeLimit}
    `;
    const drafts = rows.map((r) => ({
      id: String(r.id),
      rank: Number(r.rank),
      domain: r.domain as DomainName,
      action: String(r.action),
      signal: String(r.signal),
      expectedUpliftEUR: Number(r.expectedUpliftEUR),
      confidence: String(r.confidence),
      status: String(r.status),
      autoExecuted: true,
      autoPilotReason: r.autoPilotReason == null ? null : String(r.autoPilotReason),
      rolledBack: Boolean(r.rolledBack),
      rolledBackAt: r.rolledBackAt == null ? null : String(r.rolledBackAt),
      rollbackReason: r.rollbackReason == null ? null : String(r.rollbackReason),
      executedAt: r.executedAt == null ? null : String(r.executedAt),
      createdAt: String(r.createdAt),
    }));
    return { ok: true, drafts, source: 'v8.30-safe-auto-pilot' };
  } catch (err: any) {
    logger.error('getAutoExecutedHistory', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}
