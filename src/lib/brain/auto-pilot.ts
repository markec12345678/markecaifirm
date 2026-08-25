// v8.30/v8.31: Auto-pilot — automatically executes LOW/MEDIUM-risk Master
// Brain actions that meet ALL safety criteria. AUTOMATION PHASE.
//
// v8.30 = Safe Auto-pilot (LOW risk only, 8 safety rules).
// v8.31 = Aggressive mode + Anomaly Detection — AUTOMATION PHASE COMPLETE:
//   - Aggressive mode (opt-in, double confirmation): allows MEDIUM confidence
//     too (HIGH always manual in BOTH modes), higher limits (10/day, 2000€/day),
//     uplift < 300€. Domain != 'risk' still enforced in BOTH modes.
//   - Anomaly detection: if >8 auto-executions in 1 hour → suspend auto-pilot
//     (possible loop), requires manual re-enable via clearAnomalySuspension().
//   - Double opt-in for aggressive mode: first click sets pending confirmation,
//     second click within 5 minutes confirms. After 5 min, confirmation expires.
//
// 🎯 AUTOMATION PHASE COMPLETE (v8.30 Safe + v8.31 Aggressive + Anomaly).
//
// SAFETY RULES (all must be true for auto-execution) — mode-aware (v8.31):
// 1. autoPilotEnabled is true (master switch — default OFF)
// 2. autoPilotMode is 'safe' OR 'aggressive' (V2 — both modes valid)
// 3. User Risk Profile tolerance is NOT 'conservative' (conservative users
//    never get auto-pilot — they explicitly asked for caution)
// 4. Action confidence is allowed for current mode:
//      - safe mode: confidence = 'LOW' only
//      - aggressive mode: confidence = 'LOW' or 'MEDIUM'
//      - HIGH is ALWAYS excluded (manual execution only — both modes)
// 5. Action's expectedUpliftEUR < mode threshold:
//      - safe mode: < 100€
//      - aggressive mode: < 300€
// 6. Action domain is NOT 'risk' (risk mitigation needs human judgment — both)
// 7. Daily limit not exceeded:
//      - safe mode: todayAutoExecutedCount < 5 (configurable, default 5)
//      - aggressive mode: todayAutoExecutedCount < 10 (configurable)
// 8. Daily budget not exceeded (sum of today's autoExecuted uplift <
//    autoPilotDailyBudgetEUR):
//      - safe mode: default 500€/day
//      - aggressive mode: default 2000€/day
//
// ANOMALY DETECTION (v8.31):
// - Hourly counter (autoPilotHourlyExecCount + autoPilotHourlyWindowStart in
//   Settings) tracks auto-executions in a rolling 1-hour window.
// - If counter exceeds AGGRESSIVE_CONFIG.anomalyHourlyThreshold (default 8) →
//   set autoPilotAnomalySuspended=true, autoPilotAnomalySuspendedAt=now,
//   autoPilotAnomalyReason="N akcij v 1 uri — possible loop".
// - When suspended, runSafeAutoPilot() returns early with anomaly warning.
// - User must explicitly call clearAnomalySuspension() (POST {action:'clear_anomaly'})
//   to re-enable auto-pilot.
//
// AGGRESSIVE MODE DOUBLE OPT-IN (v8.31):
// - First call to enableAggressiveMode() sets autoPilotAggressiveConfirmedAt=now
//   and returns { confirmed: false, message: 'Potrdi ponovno v 5 minutah' }.
// - Second call within 5 minutes sets autoPilotMode='aggressive', clears
//   confirmedAt, returns { confirmed: true, message: 'Aggressive mode omogočen' }.
// - After 5 minutes, confirmation expires — must re-confirm.
// - disableAggressiveMode() immediately reverts to 'safe' (one call, no
//   confirmation needed — fail-safe: easier to disable than enable).
//
// Each auto-execution:
// - Sets draft.status = 'executed', autoExecuted = true, executedAt = now
// - Records autoPilotReason (8-rule audit trail — semicolon-separated)
// - Calls recordActionFeedback() from v8.28 (closes feedback loop) via the
//   updateDraftStatus() path in draft-queue.ts — then patches autoExecuted +
//   autoPilotReason on the same row (audit trail).
// - Increments hourly counter (v8.31) — may trigger anomaly suspension.
// - Is rollbackable (user can undo via rollbackAutoExecution)
//
// MEDIUM/HIGH risk actions in safe mode (or HIGH in aggressive mode) are left
// as 'pending' for manual execution.
//
// Deterministic (aiUsed: false): no AI/LLM SDK is called. No external side
// effects beyond DB writes — the "execution" here is purely bookkeeping. The
// real-world action (e.g. send Telegram, relist an item) is OUT OF SCOPE for
// v8.30/v8.31 — that's the integration layer v8.32+ will add. v8.30+v8.31
// establishes the safety framework + audit trail + rollback capability +
// aggressive mode + anomaly detection.

import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import { updateDraftStatus } from './draft-queue';
import { recordActionFeedback } from './adaptive-weights';
import { sendAutoPilotAlert, sendAnomalyAlert } from './telegram-notifications';
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
  // v8.31: Aggressive mode double confirmation + anomaly detection fields.
  // These are loaded alongside the v8.30 fields and exposed in AutoPilotStats
  // so the UI can render the mode selector state + anomaly banner.
  aggressiveConfirmedAt: Date | null;  // pending double-confirm timestamp (null if none)
  anomalySuspended: boolean;            // true if anomaly detection suspended auto-pilot
  anomalySuspendedAt: Date | null;      // when anomaly was triggered
  anomalyReason: string | null;          // why suspended (human-readable)
  hourlyExecCount: number;               // count of auto-executions in current 1-hour window
  hourlyWindowStart: Date | null;       // start of current 1-hour window
}

export const DEFAULT_AUTOPILOT_CONFIG: AutoPilotConfig = {
  enabled: false,
  mode: 'safe',
  dailyLimit: 5,
  dailyBudgetEUR: 500,
  lastRunAt: null,
  // v8.31: safe defaults — no pending confirmation, not suspended, no executions.
  aggressiveConfirmedAt: null,
  anomalySuspended: false,
  anomalySuspendedAt: null,
  anomalyReason: null,
  hourlyExecCount: 0,
  hourlyWindowStart: null,
};

// v8.31: Aggressive mode thresholds — HIGHER than safe.
// - maxDailyLimit: 10 (vs 5 in safe)
// - maxDailyBudgetEUR: 2000€ (vs 500€ in safe)
// - maxUpliftEUR: 300€ (vs 100€ in safe) — MEDIUM confidence allowed
// - allowedConfidence: ['LOW', 'MEDIUM'] — HIGH still ALWAYS excluded (both modes)
// - anomalyHourlyThreshold: 8 — if >8 auto-executions in 1 hour, suspend
export const AGGRESSIVE_CONFIG = {
  maxDailyLimit: 10,
  maxDailyBudgetEUR: 2000,
  maxUpliftEUR: 300,
  allowedConfidence: ['LOW', 'MEDIUM'] as const,
  anomalyHourlyThreshold: 8,
};

// v8.31: Safe mode thresholds — kept in sync with checkAutoPilotEligibility V1.
export const SAFE_CONFIG = {
  maxDailyLimit: 5,
  maxDailyBudgetEUR: 500,
  maxUpliftEUR: 100,
  allowedConfidence: ['LOW'] as const,
  anomalyHourlyThreshold: 8,  // same threshold in both modes
};

// v8.31: 5-minute window for aggressive mode double confirmation.
export const AGGRESSIVE_CONFIRM_WINDOW_MS = 5 * 60 * 1000;

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
  // v8.31: anomaly detection result — if suspended mid-run or pre-run, this
  // is populated so the UI/cron can surface a warning.
  anomalySuspended?: boolean;
  anomalyReason?: string | null;
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
 *
 * v8.31: Also loads the 6 new fields (aggressiveConfirmedAt, anomalySuspended,
 * anomalySuspendedAt, anomalyReason, hourlyExecCount, hourlyWindowStart) so the
 * AutoPilotStats response surfaces them for the UI mode selector + anomaly banner.
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
      autoPilotAggressiveConfirmedAt: string | Date | null;
      autoPilotAnomalySuspended: number | boolean;
      autoPilotAnomalySuspendedAt: string | Date | null;
      autoPilotAnomalyReason: string | null;
      autoPilotHourlyExecCount: number;
      autoPilotHourlyWindowStart: string | Date | null;
    }>>`SELECT autoPilotEnabled, autoPilotMode, autoPilotDailyLimit, autoPilotDailyBudgetEUR, autoPilotLastRunAt,
               autoPilotAggressiveConfirmedAt, autoPilotAnomalySuspended, autoPilotAnomalySuspendedAt, autoPilotAnomalyReason,
               autoPilotHourlyExecCount, autoPilotHourlyWindowStart
        FROM Settings WHERE id = 'singleton' LIMIT 1`;
    if (rows.length === 0) return { ...DEFAULT_AUTOPILOT_CONFIG };
    const r = rows[0];
    const mode: 'safe' | 'aggressive' =
      String(r.autoPilotMode ?? 'safe').toLowerCase() === 'aggressive'
        ? 'aggressive'
        : 'safe';
    const lastRunAtRaw = r.autoPilotLastRunAt;
    const aggressiveConfirmedAtRaw = r.autoPilotAggressiveConfirmedAt;
    const anomalySuspendedAtRaw = r.autoPilotAnomalySuspendedAt;
    const hourlyWindowStartRaw = r.autoPilotHourlyWindowStart;

    // v8.31: If hourly window is older than 1 hour, treat counter as stale (0).
    // This is a soft check at READ time — the authoritative reset happens in
    // incrementHourlyCounter() / checkAnomaly() which writes back to DB. Here
    // we just expose a "fresh" view for the UI without mutating state.
    let hourlyExecCount = Number(r.autoPilotHourlyExecCount) || 0;
    let hourlyWindowStart =
      hourlyWindowStartRaw == null ? null : new Date(hourlyWindowStartRaw as string);
    if (hourlyWindowStart && Date.now() - hourlyWindowStart.getTime() > 60 * 60 * 1000) {
      // Stale window — expose as 0 (DB will be reset on next increment/check).
      hourlyExecCount = 0;
      hourlyWindowStart = null;
    }

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
      // v8.31 new fields:
      aggressiveConfirmedAt:
        aggressiveConfirmedAtRaw == null ? null : new Date(aggressiveConfirmedAtRaw as string),
      anomalySuspended: Boolean(r.autoPilotAnomalySuspended),
      anomalySuspendedAt:
        anomalySuspendedAtRaw == null ? null : new Date(anomalySuspendedAtRaw as string),
      anomalyReason:
        r.autoPilotAnomalyReason == null ? null : String(r.autoPilotAnomalyReason),
      hourlyExecCount,
      hourlyWindowStart,
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

// --- v8.31: Mode-aware eligibility check (V2) --------------------------------

/**
 * v8.31: Check if a single draft can be auto-executed with mode-aware rules.
 *
 * Differences from V1 (checkAutoPilotEligibility):
 *   - safe mode: confidence=LOW only, uplift <100€, limit 5, budget 500€
 *   - aggressive mode: confidence=LOW or MEDIUM, uplift <300€, limit 10, budget 2000€
 *   - BOTH modes: domain != 'risk', HIGH confidence ALWAYS excluded (manual only)
 *
 * The `reasons` array always has exactly 8 entries (one per rule), each prefixed
 * with either "PASS:" or "FAIL:" for easy audit. The mode + threshold used is
 * included in each reason so the audit trail is self-explanatory.
 *
 * `canAutoExecute` is true iff ALL 8 reasons start with "PASS:".
 *
 * NOTE: V1 (checkAutoPilotEligibility) is kept for backward-compat / external
 * callers. Internally, runSafeAutoPilot (v8.31) uses V2.
 */
export function checkAutoPilotEligibilityV2(
  draft: ActionDraft,
  config: AutoPilotConfig,
  userRiskTolerance: 'conservative' | 'balanced' | 'aggressive',
  todayAutoExecutedCount: number,
  todayAutoExecutedBudgetUsed: number,
): AutoPilotCandidateCheck {
  const reasons: string[] = [];
  const isAggressive = config.mode === 'aggressive';
  // Pick thresholds based on mode. For safe mode, use SAFE_CONFIG. For aggressive,
  // use AGGRESSIVE_CONFIG. The hourly anomaly threshold is the same in both
  // (8) — kept in the threshold object for consistency but not enforced here.
  const thresholds = isAggressive
    ? {
        maxDailyLimit: AGGRESSIVE_CONFIG.maxDailyLimit,
        maxDailyBudgetEUR: AGGRESSIVE_CONFIG.maxDailyBudgetEUR,
        maxUpliftEUR: AGGRESSIVE_CONFIG.maxUpliftEUR,
        allowedConfidence: AGGRESSIVE_CONFIG.allowedConfidence,
      }
    : {
        maxDailyLimit: SAFE_CONFIG.maxDailyLimit,
        maxDailyBudgetEUR: SAFE_CONFIG.maxDailyBudgetEUR,
        maxUpliftEUR: SAFE_CONFIG.maxUpliftEUR,
        allowedConfidence: SAFE_CONFIG.allowedConfidence,
      };

  // Rule 1: enabled
  if (!config.enabled) {
    reasons.push('FAIL: auto-pilot is disabled');
  } else {
    reasons.push('PASS: auto-pilot enabled');
  }

  // Rule 2: mode (V2 accepts both 'safe' and 'aggressive')
  if (config.mode !== 'safe' && config.mode !== 'aggressive') {
    reasons.push(`FAIL: mode is '${config.mode}' (must be 'safe' or 'aggressive')`);
  } else {
    reasons.push(`PASS: mode is ${config.mode}`);
  }

  // Rule 3: risk tolerance != conservative (still enforced in BOTH modes)
  if (userRiskTolerance === 'conservative') {
    reasons.push('FAIL: user risk tolerance is conservative (auto-pilot disabled for conservative users)');
  } else {
    reasons.push(`PASS: risk tolerance ${userRiskTolerance}`);
  }

  // Rule 4: confidence (mode-aware — HIGH always excluded)
  if (!thresholds.allowedConfidence.includes(draft.confidence as any)) {
    reasons.push(
      `FAIL: confidence ${draft.confidence} not in [${thresholds.allowedConfidence.join(',')}] (${config.mode} mode)`,
    );
  } else {
    reasons.push(`PASS: confidence ${draft.confidence} allowed in ${config.mode} mode`);
  }

  // Rule 5: uplift (mode-aware threshold)
  if (draft.expectedUpliftEUR >= thresholds.maxUpliftEUR) {
    reasons.push(
      `FAIL: uplift ${draft.expectedUpliftEUR}€ >= ${thresholds.maxUpliftEUR}€ (${config.mode} threshold)`,
    );
  } else {
    reasons.push(
      `PASS: uplift ${draft.expectedUpliftEUR}€ < ${thresholds.maxUpliftEUR}€ (${config.mode} threshold)`,
    );
  }

  // Rule 6: domain != risk (still enforced in BOTH modes)
  if (draft.domain === 'risk') {
    reasons.push('FAIL: domain is risk (risk mitigation needs human judgment)');
  } else {
    reasons.push(`PASS: domain ${draft.domain} (not risk)`);
  }

  // Rule 7: daily limit (mode-aware)
  const limit = thresholds.maxDailyLimit;
  if (todayAutoExecutedCount >= limit) {
    reasons.push(`FAIL: daily limit ${todayAutoExecutedCount}/${limit} reached (${config.mode})`);
  } else {
    reasons.push(`PASS: daily limit ${todayAutoExecutedCount}/${limit} OK (${config.mode})`);
  }

  // Rule 8: daily budget (mode-aware)
  const budget = thresholds.maxDailyBudgetEUR;
  if (todayAutoExecutedBudgetUsed + draft.expectedUpliftEUR > budget) {
    reasons.push(
      `FAIL: budget ${todayAutoExecutedBudgetUsed}€ + ${draft.expectedUpliftEUR}€ > ${budget}€ (${config.mode})`,
    );
  } else {
    reasons.push(
      `PASS: budget ${todayAutoExecutedBudgetUsed}€ + ${draft.expectedUpliftEUR}€ <= ${budget}€ (${config.mode})`,
    );
  }

  const canAutoExecute = reasons.every((r) => r.startsWith('PASS'));
  return { draft, canAutoExecute, reasons };
}

// --- v8.31: Anomaly detection -----------------------------------------------

/**
 * v8.31: Check if auto-pilot should be suspended due to anomaly.
 *
 * Triggers if the hourly execution counter exceeds the anomaly threshold
 * (default 8 from AGGRESSIVE_CONFIG.anomalyHourlyThreshold — same in both modes).
 *
 * If the hourly window is older than 1 hour, the counter is RESET (no anomaly).
 * This makes the counter a ROLLING 1-hour window: stale windows are not anomalies.
 *
 * Side effects:
 *   - If anomaly detected: writes autoPilotAnomalySuspended=true,
 *     autoPilotAnomalySuspendedAt=now, autoPilotAnomalyReason="N akcij v 1 uri —
 *     possible loop" to Settings (PERSISTS suspension — requires manual clear).
 *   - If window expired (older than 1h): resets counter to 0 + windowStart=now
 *     (so future increments start fresh — but only resets the WINDOW, not the
 *     suspension if already suspended).
 *
 * Returns:
 *   { anomaly: true, reason } if suspended (either newly or already)
 *   { anomaly: false, reason: null } if OK to proceed
 */
export async function checkAnomaly(): Promise<{ anomaly: boolean; reason: string | null }> {
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<Array<{
      autoPilotAnomalySuspended: number | boolean;
      autoPilotHourlyExecCount: number;
      autoPilotHourlyWindowStart: string | Date | null;
    }>>`SELECT autoPilotAnomalySuspended, autoPilotHourlyExecCount, autoPilotHourlyWindowStart FROM Settings WHERE id = 'singleton' LIMIT 1`;
    if (rows.length === 0) {
      // No Settings row yet — no anomaly possible.
      return { anomaly: false, reason: null };
    }
    const r = rows[0];

    // If already suspended, return anomaly=true (with existing reason fetched below).
    if (Boolean(r.autoPilotAnomalySuspended)) {
      const reasonRows = await db.$queryRaw<Array<{ autoPilotAnomalyReason: string | null }>>`
        SELECT autoPilotAnomalyReason FROM Settings WHERE id = 'singleton' LIMIT 1
      `;
      const reason = reasonRows[0]?.autoPilotAnomalyReason ?? 'Auto-pilot suspended (anomaly)';
      return { anomaly: true, reason };
    }

    const count = Number(r.autoPilotHourlyExecCount) || 0;
    const windowStartRaw = r.autoPilotHourlyWindowStart;
    const now = Date.now();

    // No window yet → counter is 0 → no anomaly.
    if (windowStartRaw == null) {
      return { anomaly: false, reason: null };
    }

    const windowStart = new Date(windowStartRaw as string).getTime();
    const windowAgeMs = now - windowStart;
    const oneHourMs = 60 * 60 * 1000;

    // Stale window (older than 1 hour) — reset counter, no anomaly.
    if (windowAgeMs > oneHourMs) {
      await db.$executeRaw`
        UPDATE Settings
        SET autoPilotHourlyExecCount = 0,
            autoPilotHourlyWindowStart = NULL,
            updatedAt = ${new Date().toISOString()}
        WHERE id = 'singleton'
      `;
      return { anomaly: false, reason: null };
    }

    // Active window — check if count exceeds threshold.
    if (count >= AGGRESSIVE_CONFIG.anomalyHourlyThreshold) {
      const reason = `${count} akcij v 1 uri — possible loop`;
      await db.$executeRaw`
        UPDATE Settings
        SET autoPilotAnomalySuspended = 1,
            autoPilotAnomalySuspendedAt = ${new Date().toISOString()},
            autoPilotAnomalyReason = ${reason},
            updatedAt = ${new Date().toISOString()}
        WHERE id = 'singleton'
      `;
      logger.warn('checkAnomaly', `anomaly detected — suspending auto-pilot (${reason})`, {
        count,
        windowStart: new Date(windowStart).toISOString(),
      });
      return { anomaly: true, reason };
    }

    return { anomaly: false, reason: null };
  } catch (err: any) {
    logger.error('checkAnomaly', 'failed — treating as no anomaly (fail-open)', err);
    return { anomaly: false, reason: null };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * v8.31: Increment the hourly execution counter after each auto-execution.
 *
 * Logic:
 *   1. Load current window (autoPilotHourlyWindowStart) + count.
 *   2. If window is null OR expired (>1h old): reset count=1, windowStart=now.
 *   3. Else: count++.
 *   4. If count >= AGGRESSIVE_CONFIG.anomalyHourlyThreshold (8) → suspend
 *      auto-pilot (set autoPilotAnomalySuspended=true + suspendedAt + reason).
 *
 * Returns the new count + whether suspension was triggered (or was already active).
 */
export async function incrementHourlyCounter(): Promise<{
  count: number;
  suspended: boolean;
  suspendedNow: boolean;
  reason: string | null;
}> {
  const db = getFreshDb();
  const nowIso = new Date().toISOString();
  try {
    const rows = await db.$queryRaw<Array<{
      autoPilotHourlyExecCount: number;
      autoPilotHourlyWindowStart: string | Date | null;
      autoPilotAnomalySuspended: number | boolean;
    }>>`SELECT autoPilotHourlyExecCount, autoPilotHourlyWindowStart, autoPilotAnomalySuspended FROM Settings WHERE id = 'singleton' LIMIT 1`;
    if (rows.length === 0) {
      // No Settings row — INSERT one with count=1.
      await db.$executeRaw`
        INSERT INTO Settings (id, autoPilotHourlyExecCount, autoPilotHourlyWindowStart)
        VALUES ('singleton', 1, ${nowIso})
      `;
      return { count: 1, suspended: false, suspendedNow: false, reason: null };
    }
    const r = rows[0];
    const currentCount = Number(r.autoPilotHourlyExecCount) || 0;
    const windowStartRaw = r.autoPilotHourlyWindowStart;
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;

    let newCount: number;
    let newWindowStart: string;

    if (windowStartRaw == null) {
      // No window — start fresh.
      newCount = 1;
      newWindowStart = nowIso;
    } else {
      const windowStart = new Date(windowStartRaw as string).getTime();
      if (now - windowStart > oneHourMs) {
        // Stale window — reset.
        newCount = 1;
        newWindowStart = nowIso;
      } else {
        // Active window — increment.
        newCount = currentCount + 1;
        newWindowStart = new Date(windowStart).toISOString();
      }
    }

    // Persist counter + window.
    await db.$executeRaw`
      UPDATE Settings
      SET autoPilotHourlyExecCount = ${newCount},
          autoPilotHourlyWindowStart = ${newWindowStart},
          updatedAt = ${nowIso}
      WHERE id = 'singleton'
    `;

    // Check if threshold reached → suspend.
    if (newCount >= AGGRESSIVE_CONFIG.anomalyHourlyThreshold) {
      const reason = `${newCount} akcij v 1 uri — possible loop`;
      await db.$executeRaw`
        UPDATE Settings
        SET autoPilotAnomalySuspended = 1,
            autoPilotAnomalySuspendedAt = ${nowIso},
            autoPilotAnomalyReason = ${reason},
            updatedAt = ${nowIso}
        WHERE id = 'singleton'
      `;
      logger.warn('incrementHourlyCounter', `anomaly threshold reached — suspending auto-pilot (${reason})`, {
        newCount,
        threshold: AGGRESSIVE_CONFIG.anomalyHourlyThreshold,
      });
      return { count: newCount, suspended: true, suspendedNow: true, reason };
    }

    return {
      count: newCount,
      suspended: Boolean(r.autoPilotAnomalySuspended),
      suspendedNow: false,
      reason: null,
    };
  } catch (err: any) {
    logger.error('incrementHourlyCounter', 'failed — counter not incremented', err);
    return { count: 0, suspended: false, suspendedNow: false, reason: null };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * v8.31: Enable aggressive mode — requires DOUBLE CONFIRMATION.
 *
 * Flow:
 *   - First call: sets autoPilotAggressiveConfirmedAt=now (pending confirmation).
 *     Returns { confirmed: false, message: 'Potrdi ponovno v 5 minutah za aggressive mode' }.
 *   - Second call within 5 minutes: sets autoPilotMode='aggressive', clears
 *     confirmedAt. Returns { confirmed: true, message: 'Aggressive mode omogočen' }.
 *   - After 5 minutes: confirmation expires — must re-confirm (treated as first call).
 *
 * Also requires: enabled=true (auto-pilot must be ON to enable aggressive mode —
 * fail-safe). If disabled, returns error.
 */
export async function enableAggressiveMode(): Promise<{
  ok: true;
  confirmed: boolean;
  message: string;
  confirmedAt?: string;
}> {
  const db = getFreshDb();
  const nowIso = new Date().toISOString();
  const now = Date.now();
  try {
    const rows = await db.$queryRaw<Array<{
      autoPilotEnabled: number | boolean;
      autoPilotAggressiveConfirmedAt: string | Date | null;
    }>>`SELECT autoPilotEnabled, autoPilotAggressiveConfirmedAt FROM Settings WHERE id = 'singleton' LIMIT 1`;

    if (rows.length === 0) {
      // No Settings row — INSERT singleton with confirmedAt=now (first call).
      await db.$executeRaw`
        INSERT INTO Settings (id, autoPilotEnabled, autoPilotAggressiveConfirmedAt)
        VALUES ('singleton', 0, ${nowIso})
      `;
      return {
        ok: true,
        confirmed: false,
        message: 'Potrdi ponovno v 5 minutah za aggressive mode (auto-pilot je trenutno IZKLJUČEN — ga najprej vklopi).',
        confirmedAt: nowIso,
      };
    }
    const r = rows[0];

    if (!Boolean(r.autoPilotEnabled)) {
      // Auto-pilot must be enabled first.
      return {
        ok: true,
        confirmed: false,
        message: 'Najprej vklopi auto-pilot (master switch OFF). Aggressive mode zahteva aktiven auto-pilot.',
      };
    }

    const confirmedAtRaw = r.autoPilotAggressiveConfirmedAt;
    if (confirmedAtRaw == null) {
      // First call — set pending confirmation.
      await db.$executeRaw`
        UPDATE Settings
        SET autoPilotAggressiveConfirmedAt = ${nowIso},
            updatedAt = ${nowIso}
        WHERE id = 'singleton'
      `;
      logger.info('enableAggressiveMode', 'first confirmation set — awaiting second click within 5 min');
      return {
        ok: true,
        confirmed: false,
        message: '⚠️ Aggressive mode dovoli MEDIUM confidence. Potrdi ponovno v 5 minutah.',
        confirmedAt: nowIso,
      };
    }

    const confirmedAt = new Date(confirmedAtRaw as string).getTime();
    const ageMs = now - confirmedAt;
    if (ageMs > AGGRESSIVE_CONFIRM_WINDOW_MS) {
      // Confirmation expired — set new pending confirmation.
      await db.$executeRaw`
        UPDATE Settings
        SET autoPilotAggressiveConfirmedAt = ${nowIso},
            updatedAt = ${nowIso}
        WHERE id = 'singleton'
      `;
      logger.info('enableAggressiveMode', 'previous confirmation expired — new one set');
      return {
        ok: true,
        confirmed: false,
        message: 'Prejšnja potrditev je potekla. Potrdi ponovno v 5 minutah za aggressive mode.',
        confirmedAt: nowIso,
      };
    }

    // Second call within 5 minutes — CONFIRM aggressive mode.
    await db.$executeRaw`
      UPDATE Settings
      SET autoPilotMode = 'aggressive',
          autoPilotAggressiveConfirmedAt = NULL,
          autoPilotAnomalySuspended = 0,
          autoPilotAnomalySuspendedAt = NULL,
          autoPilotAnomalyReason = NULL,
          updatedAt = ${nowIso}
      WHERE id = 'singleton'
    `;
    logger.info('enableAggressiveMode', 'aggressive mode CONFIRMED + anomaly suspension cleared');
    return {
      ok: true,
      confirmed: true,
      message: '✅ Aggressive mode omogočen — dovoljena MEDIUM confidence (do 300€ uplift, 10/dan, 2000€/dan budget). HIGH je še vedno vedno manual.',
    };
  } catch (err: any) {
    logger.error('enableAggressiveMode', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * v8.31: Disable aggressive mode — immediately reverts to 'safe'.
 * Single call (no confirmation needed — fail-safe: easier to disable than enable).
 * Also clears any pending aggressive confirmation.
 */
export async function disableAggressiveMode(): Promise<{ ok: true; mode: string }> {
  const db = getFreshDb();
  const nowIso = new Date().toISOString();
  try {
    const result = await db.$executeRaw`
      UPDATE Settings
      SET autoPilotMode = 'safe',
          autoPilotAggressiveConfirmedAt = NULL,
          updatedAt = ${nowIso}
      WHERE id = 'singleton'
    `;
    if (result === 0) {
      // Singleton doesn't exist — INSERT with safe mode.
      await db.$executeRaw`
        INSERT INTO Settings (id, autoPilotMode)
        VALUES ('singleton', 'safe')
      `;
    }
    logger.info('disableAggressiveMode', 'aggressive mode disabled — reverted to safe');
    return { ok: true, mode: 'safe' };
  } catch (err: any) {
    logger.error('disableAggressiveMode', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * v8.31: Clear anomaly suspension — user manually re-enables after reviewing.
 *
 * Resets: autoPilotAnomalySuspended=false, anomalySuspendedAt=null,
 * anomalyReason=null, AND resets the hourly counter (count=0, windowStart=null)
 * so a fresh window starts.
 *
 * Does NOT change autoPilotEnabled or autoPilotMode — user can independently
 * re-toggle those via the existing config actions.
 */
export async function clearAnomalySuspension(): Promise<{ ok: true; message: string }> {
  const db = getFreshDb();
  const nowIso = new Date().toISOString();
  try {
    const result = await db.$executeRaw`
      UPDATE Settings
      SET autoPilotAnomalySuspended = 0,
          autoPilotAnomalySuspendedAt = NULL,
          autoPilotAnomalyReason = NULL,
          autoPilotHourlyExecCount = 0,
          autoPilotHourlyWindowStart = NULL,
          updatedAt = ${nowIso}
      WHERE id = 'singleton'
    `;
    if (result === 0) {
      // Singleton doesn't exist — INSERT fresh.
      await db.$executeRaw`
        INSERT INTO Settings (id, autoPilotAnomalySuspended, autoPilotHourlyExecCount)
        VALUES ('singleton', 0, 0)
      `;
    }
    logger.info('clearAnomalySuspension', 'anomaly suspension cleared + hourly counter reset');
    return {
      ok: true,
      message: '✅ Suspenzija razveljavljena. Auto-pilot lahko ponovno deluje (hourly counter resetiran).',
    };
  } catch (err: any) {
    logger.error('clearAnomalySuspension', 'failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
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

  // v8.31: Anomaly detection — if auto-pilot is suspended (either pre-existing
  // or just triggered), return early with anomaly warning. User must explicitly
  // call clearAnomalySuspension() to re-enable.
  const anomalyCheck = await checkAnomaly();
  if (anomalyCheck.anomaly) {
    logger.warn('runSafeAutoPilot', 'auto-pilot is SUSPENDED due to anomaly — returning early', {
      reason: anomalyCheck.reason,
    });
    // v8.35: Send Telegram anomaly alert (NON-CRITICAL — wrapped in try/catch).
    // If Telegram is not configured or send fails, auto-pilot logic is unaffected.
    if (anomalyCheck.reason) {
      try {
        await sendAnomalyAlert(anomalyCheck.reason);
      } catch (err: any) {
        logger.warn('runSafeAutoPilot', 'sendAnomalyAlert failed (non-critical)', err);
      }
    }
    // Reload config to get the latest anomaly fields for the response.
    const suspendedConfig = await loadAutoPilotConfig();
    return {
      ok: true,
      config: suspendedConfig,
      checked: 0,
      autoExecuted: 0,
      skipped: 0,
      executedDrafts: [],
      skippedDrafts: [],
      todayStats: {
        autoExecuted: 0,
        budgetUsed: 0,
        budgetRemaining: suspendedConfig.dailyBudgetEUR,
        limitRemaining: suspendedConfig.dailyLimit,
      },
      anomalySuspended: true,
      anomalyReason: anomalyCheck.reason,
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

    // v8.31: Tracks if anomaly was triggered MID-RUN (counter exceeded threshold).
    // If so, remaining pending drafts are marked as skipped with anomaly reason.
    let anomalyTriggeredMidRun = false;
    let anomalyReasonMidRun: string | null = null;

    // 5. For each pending draft, check eligibility (V2 — mode-aware) + auto-execute if eligible
    for (const draft of pendingDrafts) {
      // If anomaly was triggered mid-run, skip remaining drafts with anomaly reason.
      if (anomalyTriggeredMidRun) {
        skippedDrafts.push({
          id: draft.id,
          action: draft.action,
          reasons: [`FAIL: auto-pilot suspended mid-run (anomaly: ${anomalyReasonMidRun ?? 'unknown'})`],
        });
        continue;
      }

      // v8.31: V2 — mode-aware eligibility check.
      const check = checkAutoPilotEligibilityV2(
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

          // v8.35: Send Telegram auto-pilot alert (NON-CRITICAL — wrapped in
          // try/catch). If Telegram is not configured or send fails, the
          // auto-execution itself is unaffected (it already succeeded above).
          try {
            await sendAutoPilotAlert(draft, reasonStr);
          } catch (err: any) {
            logger.warn('runSafeAutoPilot', `sendAutoPilotAlert failed for draft ${draft.id} (non-critical)`, err);
          }

          // v8.31: Increment hourly counter. If this triggered suspension, mark
          // flag so remaining drafts in this loop are skipped.
          const counterResult = await incrementHourlyCounter();
          if (counterResult.suspendedNow) {
            anomalyTriggeredMidRun = true;
            anomalyReasonMidRun = counterResult.reason;
            logger.warn('runSafeAutoPilot', 'anomaly triggered mid-run — skipping remaining drafts', {
              count: counterResult.count,
              reason: counterResult.reason,
            });
            // v8.35: Send Telegram anomaly alert for mid-run suspension.
            try {
              await sendAnomalyAlert(counterResult.reason ?? 'Anomaly detected mid-run');
            } catch (err: any) {
              logger.warn('runSafeAutoPilot', 'sendAnomalyAlert (mid-run) failed (non-critical)', err);
            }
          }
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
      anomalyTriggeredMidRun,
    });

    // Reload config to get the latest hourlyExecCount + anomalySuspended state
    // (incrementHourlyCounter may have set suspended=true mid-run).
    const finalConfig = anomalyTriggeredMidRun ? await loadAutoPilotConfig() : updatedConfig;

    return {
      ok: true,
      config: finalConfig,
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
      anomalySuspended: anomalyTriggeredMidRun,
      anomalyReason: anomalyReasonMidRun,
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
 * v8.31: The 'mode' field is NOT accepted here anymore — the API route
 * strips it out. Mode changes go through enableAggressiveMode() /
 * disableAggressiveMode() which implement the double-confirmation safety flow.
 * If 'mode' is somehow passed here, it's silently ignored (current value
 * retained). The v8.31 new fields (aggressiveConfirmedAt, anomalySuspended,
 * etc.) are ALSO never overwritten here — they're managed exclusively by
 * enable/disable/clearAnomaly/incrementHourlyCounter functions.
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
    // v8.31 fields are NEVER overwritten by updateAutoPilotConfig — they're
    // managed exclusively by enableAggressiveMode / disableAggressiveMode /
    // clearAnomalySuspension / incrementHourlyCounter. Here we just preserve
    // the current values (loaded above).
    aggressiveConfirmedAt: current.aggressiveConfirmedAt,
    anomalySuspended: current.anomalySuspended,
    anomalySuspendedAt: current.anomalySuspendedAt,
    anomalyReason: current.anomalyReason,
    hourlyExecCount: current.hourlyExecCount,
    hourlyWindowStart: current.hourlyWindowStart,
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
