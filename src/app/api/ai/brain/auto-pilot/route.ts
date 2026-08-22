// v8.30/v8.31/v8.95-refactor: Auto-pilot API — 🎯 AUTOMATION PHASE.
// GET  /api/ai/brain/auto-pilot — returns current config + stats (today + all-time).
//      v8.31: config now includes 6 new fields (aggressiveConfirmedAt,
//      anomalySuspended, anomalySuspendedAt, anomalyReason, hourlyExecCount,
//      hourlyWindowStart) so the UI can render the mode selector state +
//      anomaly banner.
// POST /api/ai/brain/auto-pilot — 5 actions (v8.30 + v8.31):
//   { action: 'run' }                    → triggers auto-pilot run (manual trigger)
//                                          returns AutoPilotRunResult with
//                                          checked/autoExecuted/skipped lists.
//                                          v8.31: may return anomalySuspended
//                                          if anomaly triggered mid-run or pre-run.
//   { action: 'config', config: {...} }  → updates config (Partial<AutoPilotConfig>)
//                                          e.g. { enabled: true } or
//                                          { dailyLimit: 3, dailyBudgetEUR: 250 }
//                                          returns { ok, config }.
//                                          NOTE: 'mode' field is IGNORED here —
//                                          use enable_aggressive / disable_aggressive
//                                          actions for mode changes (they implement
//                                          the double-confirmation flow).
//   { action: 'enable_aggressive' }      → v8.31: starts/confirms aggressive mode
//                                          double-confirmation flow.
//                                          Returns { ok, confirmed, message, confirmedAt? }.
//                                          - First call: confirmed=false (pending)
//                                          - Second call within 5 min: confirmed=true
//                                          - After 5 min: confirmation expires
//   { action: 'disable_aggressive' }    → v8.31: immediately reverts to safe mode
//                                          (no confirmation needed — fail-safe).
//                                          Returns { ok, mode: 'safe' }.
//   { action: 'clear_anomaly' }          → v8.31: clears anomaly suspension + resets
//                                          hourly counter. User must explicitly call
//                                          this to re-enable auto-pilot after an
//                                          anomaly-triggered suspension.
//                                          Returns { ok, message }.
//
// Rollback is at /api/ai/brain/auto-pilot/rollback (separate route).
// Cron is at /api/cron/auto-pilot (hourly auto-trigger).
//
// 8 SAFETY RULES (mode-aware — v8.31):
// 1. autoPilotEnabled=true (master switch)
// 2. autoPilotMode='safe' or 'aggressive' (V2 — both modes valid)
// 3. User risk tolerance != 'conservative' (v8.24)
// 4. confidence in mode's allowedConfidence:
//      - safe: ['LOW']
//      - aggressive: ['LOW', 'MEDIUM']
//      - HIGH is ALWAYS excluded (manual only — both modes)
// 5. expectedUpliftEUR < mode threshold (safe: 100€, aggressive: 300€)
// 6. domain != 'risk' (risk mitigation needs human judgment — both modes)
// 7. today's auto-executed count < mode's daily limit (safe: 5, aggressive: 10)
// 8. today's auto-executed budget + this draft's uplift < mode's daily budget
//    (safe: 500€, aggressive: 2000€)
//
// ANOMALY DETECTION (v8.31):
// - If >8 auto-executions in 1 hour → suspend auto-pilot (possible loop).
// - When suspended, runSafeAutoPilot returns early with anomaly warning.
// - User must POST { action: 'clear_anomaly' } to re-enable.
//
// Each auto-execution:
// - Sets draft.status='executed', autoExecuted=true, executedAt=now
// - Records autoPilotReason (8-rule audit trail, semicolon-separated)
// - Calls recordActionFeedback() from v8.28 via updateDraftStatus()
// - Increments hourly counter (v8.31) — may trigger anomaly suspension
// - Is rollbackable (POST /rollback)
//
// DETERMINISTIC (aiUsed: false): no AI/LLM SDK called. Real-world side effects
// (sending Telegram, relisting items) are OUT OF SCOPE for v8.30/v8.31 — this is
// purely bookkeeping + audit trail. v8.32+ will add execution-side integration.
//
// Refaktoriran z withAiRoute helperjem (v8.95) — konsistentno z vsemi v8.94.x
// brain migracijami (npr. brain/health). enforceBudget: true je non-breaking —
// endpoint ne kliče AI direktno, ampak je konsistenten z ostalimi migracijami
// (budget guard pred klicem + avtomatski recordAiCall po uspehu).

import type { NextRequest } from 'next/server';
import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk, apiBadRequest } from '@/lib/api-response';
import {
  runSafeAutoPilot,
  getAutoPilotStats,
  updateAutoPilotConfig,
  enableAggressiveMode,
  disableAggressiveMode,
  clearAnomalySuspension,
  type AutoPilotConfig,
} from '@/lib/brain/auto-pilot';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input types -----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface AutoPilotGetInput {}

interface AutoPilotPostInput {
  action: string;
  config?: Record<string, unknown>;
}

// --- GET: stats + config ----------------------------------------------------

export const GET = withAiRoute<AutoPilotGetInput>({
  endpoint: '/api/ai/brain/auto-pilot',
  maxDuration: 60,
  enforceBudget: true, // v8.95: budget guard + avtomatski recordAiCall (konsistentno z brain/health)
  method: 'GET',

  // GET — brez telesa; parseBody vrne prazen objekt
  parseBody: async () => ({}),

  handler: async (_input, _ctx: AiRouteContext) => {
    const stats = await getAutoPilotStats();
    return apiOk(stats);
  },
});

// --- POST: run OR config update --------------------------------------------

export const POST = withAiRoute<AutoPilotPostInput>({
  endpoint: '/api/ai/brain/auto-pilot',
  maxDuration: 60,
  enforceBudget: true, // v8.95: budget guard + avtomatski recordAiCall
  method: 'POST',

  parseBody: parseAutoPilotBody,

  handler: async (input, _ctx: AiRouteContext) => {
    const { action, config } = input;

    // --- action: run -------------------------------------------------------
    if (action === 'run') {
      const result = await runSafeAutoPilot();
      return apiOk(result);
    }

    // --- action: config ----------------------------------------------------
    if (action === 'config') {
      const updates = extractConfigUpdates(config);
      if (!updates) {
        return apiBadRequest(INVALID_CONFIG_MSG);
      }
      if (Object.keys(updates).length === 0) {
        return apiBadRequest(NO_VALID_FIELDS_MSG);
      }
      const result = await updateAutoPilotConfig(updates);
      return apiOk(result);
    }

    // --- action: enable_aggressive (v8.31 — double confirmation) -----------
    if (action === 'enable_aggressive') {
      const result = await enableAggressiveMode();
      return apiOk(result);
    }

    // --- action: disable_aggressive (v8.31 — immediate revert to safe) ---
    if (action === 'disable_aggressive') {
      const result = await disableAggressiveMode();
      return apiOk(result);
    }

    // --- action: clear_anomaly (v8.31 — manual re-enable after suspension)
    if (action === 'clear_anomaly') {
      const result = await clearAnomalySuspension();
      return apiOk(result);
    }

    // --- unknown action ----------------------------------------------------
    return apiBadRequest(
      `Unknown action: ${JSON.stringify(action)}. Must be 'run' (trigger auto-pilot), 'config' (update config), 'enable_aggressive' (start/confirm aggressive double-opt-in), 'disable_aggressive' (revert to safe), or 'clear_anomaly' (clear anomaly suspension).`,
    );
  },
});

// --- Pomožne funkcije (čiste, testabilne) --------------------------------

const INVALID_CONFIG_MSG = `Invalid 'config' — expected an object with optional fields: enabled, mode, dailyLimit, dailyBudgetEUR.`;
const NO_VALID_FIELDS_MSG = `No valid config fields in body.config. Expected at least one of: enabled (boolean), dailyLimit (number), dailyBudgetEUR (number). Mode changes must use 'enable_aggressive' / 'disable_aggressive' actions.`;

/**
 * Parse POST body za auto-pilot. Prebere `action` (lowercased, trimmed) in
 * `config` objekt (validiran da je plain object). Vrne { action: '', config: undefined }
 * ko manjka ali je neveljaven body — handler vrne 400 "Unknown action".
 */
async function parseAutoPilotBody(req: NextRequest): Promise<AutoPilotPostInput> {
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
  const action = typeof body.action === 'string' ? body.action.toLowerCase().trim() : '';
  const rawConfig = body.config;
  const config =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : undefined;
  return { action, config };
}

/**
 * Ekstraktne veljavna polja iz `config` objekta. Vrne:
 * - null ko config manjka ali ni objekt (handler vrne 400 INVALID_CONFIG_MSG)
 * - {} ko config je objekt, ampak brez veljavnih polj (handler vrne 400 NO_VALID_FIELDS_MSG)
 * - Partial<AutoPilotConfig> z veljavnimi polji (enabled, dailyLimit, dailyBudgetEUR)
 *
 * v8.31: 'mode' je INTENCIONALNO ignoriran. Spremembe mode morajo iti skozi
 * enable_aggressive / disable_aggressive akcije (double-confirmation flow).
 */
function extractConfigUpdates(
  config: Record<string, unknown> | undefined,
): Partial<AutoPilotConfig> | null {
  if (!config) return null;
  const updates: Partial<AutoPilotConfig> = {};
  if (typeof config.enabled === 'boolean') updates.enabled = config.enabled;
  // v8.31: 'mode' is intentionally IGNORED here. Mode changes must go
  // through the enable_aggressive / disable_aggressive actions (they
  // implement the double-confirmation flow). Direct mode setting via
  // 'config' would bypass the safety mechanism.
  if (typeof config.dailyLimit === 'number' && Number.isFinite(config.dailyLimit)) {
    updates.dailyLimit = config.dailyLimit;
  }
  if (typeof config.dailyBudgetEUR === 'number' && Number.isFinite(config.dailyBudgetEUR)) {
    updates.dailyBudgetEUR = config.dailyBudgetEUR;
  }
  // lastRunAt is read-only via this endpoint (only set by runSafeAutoPilot)
  return updates;
}
