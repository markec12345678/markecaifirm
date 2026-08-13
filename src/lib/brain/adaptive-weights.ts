// v8.28: Adaptive Domain Weights — feedback loop that learns from user behavior.
// Master Brain (v8.22) uses hardcoded DOMAIN_WEIGHTS (risk=1.3, profit=1.2, ...).
// v8.28 replaces these with adaptive weights stored per-user in the Settings
// table (singleton row, JSON `adaptiveDomainWeights` field).
//
// How it works:
// 1. User marks Master Brain actions as "executed" or "rejected" (via API)
// 2. System tracks execution stats per-domain (executed count, rejected count)
// 3. After every 10 actions per domain, weights are re-computed:
//    - executionRate = executed / (executed + rejected)
//    - if executionRate > 0.8: weight × 1.1 (boost — user values this domain)
//    - if executionRate < 0.4: weight × 0.9 (reduce — user ignores this domain)
//    - else: no change
//    - clamp weight to [0.5, 2.0] (never go below 0.5 or above 2.0)
// 4. Master Brain loads adaptive weights instead of hardcoded ones (when present)
//
// This is the "behavioral economics" feature — system learns from REVEALED
// preferences (what users actually do), not stated ones (what they say they want).
//
// Pure compute for the weight adjustment logic. DB read/write for persistence.
//
// Architecture: same shape as risk-profile.ts (v8.24) — pure compute helpers
// exposed for unit testing, plus DB-backed load/save functions. The API
// endpoint (/api/ai/brain/weights) is the ONLY writer; the master brain
// endpoint is a READER (loads adaptive weights, passes to masterBrain()).

import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import type { DomainName } from './master';

// v8.28: Use a FRESH PrismaClient per call (similar pattern as v8.24
// risk-profile route). The standard `db` from @/lib/db caches a single
// PrismaClient in `globalThis.prisma` for the lifetime of the dev server
// process — fine for production but problematic in dev when the schema
// changes mid-run. The SCHEMA_VERSION check in db.ts SHOULD discard the
// stale client, but Turbopack's module-caching can still hold a reference
// to the OLD @prisma/client module (which doesn't know about the new
// `adaptiveDomainWeights` field). Creating a fresh PrismaClient each call
// guarantees we always use the latest generated client.
//
// PrismaClient internally pools connections, so this is still cheap.
function getFreshDb(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn'],
  });
}

// --- Defaults ---------------------------------------------------------------

/**
 * Default domain weights — mirrors the hardcoded DOMAIN_WEIGHTS in master.ts.
 * Used when no adaptive weights are stored in Settings (null field).
 *
 * Rationale (kept in sync with master.ts):
 *  - risk:    1.3 (highest — risk mitigation is most critical)
 *  - profit:  1.2 (revenue-generating actions get a premium)
 *  - sourcing: 1.1 (capital allocation has direct € impact)
 *  - pricing: 1.1 (price changes have direct revenue impact)
 *  - inventory: 1.0 (baseline)
 *  - market:  1.0 (baseline)
 *  - buyer:   0.9 (buyer cultivation is slower-acting, lower short-term weight)
 */
export const DEFAULT_DOMAIN_WEIGHTS: Record<DomainName, number> = {
  profit: 1.2,
  inventory: 1.0,
  market: 1.0,
  sourcing: 1.1,
  risk: 1.3,
  buyer: 0.9,
  pricing: 1.1,
};

// --- Types -----------------------------------------------------------------

export interface DomainWeightStats {
  /** Current weight applied during Master Brain ranking (clamped [0.5, 2.0]). */
  weight: number;
  /** Number of times user marked an action in this domain as "executed". */
  executed: number;
  /** Number of times user marked an action in this domain as "rejected". */
  rejected: number;
  /** ISO date string of the last weight adjustment (null if never adjusted). */
  lastAdjustedAt: string | null;
  /** History of weight adjustments (most recent first, capped at 20). */
  adjustmentHistory: Array<{
    /** ISO date string of the adjustment. */
    date: string;
    /** Weight before adjustment. */
    oldWeight: number;
    /** Weight after adjustment (may equal oldWeight if "no change"). */
    newWeight: number;
    /** Human-readable reason for the adjustment. */
    reason: string;
  }>;
}

export type AdaptiveWeights = Record<DomainName, DomainWeightStats>;

export interface ActionFeedbackInput {
  domain: DomainName;
  /** The action text being marked (for logging / future use). */
  action: string;
  /** Whether the user executed or rejected the action. */
  feedback: 'executed' | 'rejected';
}

export interface WeightAdjustmentResult {
  ok: true;
  domain: DomainName;
  /** Weight before this feedback was recorded. */
  oldWeight: number;
  /** Weight after this feedback (may equal oldWeight if no adjustment). */
  newWeight: number;
  /** Total executed count for this domain (after this feedback). */
  executed: number;
  /** Total rejected count for this domain (after this feedback). */
  rejected: number;
  /** executed / (executed + rejected) — current execution rate (0-1). */
  executionRate: number;
  /** True if a weight adjustment happened on this feedback call. */
  adjusted: boolean;
  /** Human-readable explanation (always non-empty). */
  reason: string;
}

// --- Constants -------------------------------------------------------------

const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 2.0;
const ADJUSTMENT_INTERVAL = 10; // Re-evaluate weight every 10 actions per domain
const BOOST_FACTOR = 1.1;       // executionRate > 0.8 → weight × 1.1
const REDUCE_FACTOR = 0.9;      // executionRate < 0.4 → weight × 0.9
const BOOST_THRESHOLD = 0.8;
const REDUCE_THRESHOLD = 0.4;
const HISTORY_CAP = 20;          // Keep only last 20 adjustments

/**
 * Default AdaptiveWeights object — all 7 domains at their default weight,
 * with zero execution stats and empty adjustment history.
 *
 * Used as the initial value when no adaptive weights are stored in Settings
 * AND as the result of `resetAdaptiveWeights()`.
 */
const DEFAULT_DOMAIN_WEIGHTS_OBJECT: AdaptiveWeights = {
  profit: { weight: 1.2, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  inventory: { weight: 1.0, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  market: { weight: 1.0, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  sourcing: { weight: 1.1, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  risk: { weight: 1.3, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  buyer: { weight: 0.9, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  pricing: { weight: 1.1, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
};

// --- Helpers ---------------------------------------------------------------

function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Validate that a parsed JSON object has the expected AdaptiveWeights shape.
 * Returns a sanitized AdaptiveWeights (missing domains filled with defaults).
 */
function sanitizeAdaptiveWeights(parsed: unknown): AdaptiveWeights {
  const result: AdaptiveWeights = { ...DEFAULT_DOMAIN_WEIGHTS_OBJECT };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return result;
  }
  const obj = parsed as Record<string, unknown>;
  for (const d of Object.keys(DEFAULT_DOMAIN_WEIGHTS) as DomainName[]) {
    const entry = obj[d];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const weight = typeof e.weight === 'number' && Number.isFinite(e.weight)
      ? clamp(round2(e.weight), MIN_WEIGHT, MAX_WEIGHT)
      : DEFAULT_DOMAIN_WEIGHTS[d];
    const executed = typeof e.executed === 'number' && Number.isFinite(e.executed) && e.executed >= 0
      ? Math.floor(e.executed)
      : 0;
    const rejected = typeof e.rejected === 'number' && Number.isFinite(e.rejected) && e.rejected >= 0
      ? Math.floor(e.rejected)
      : 0;
    const lastAdjustedAt = typeof e.lastAdjustedAt === 'string' ? e.lastAdjustedAt : null;
    const adjustmentHistory = Array.isArray(e.adjustmentHistory)
      ? e.adjustmentHistory
          .filter((h) => h && typeof h === 'object' && !Array.isArray(h))
          .map((h) => {
            const hh = h as Record<string, unknown>;
            const date = typeof hh.date === 'string' ? hh.date : '';
            const oldWeight = typeof hh.oldWeight === 'number' ? Number(hh.oldWeight) : 0;
            const newWeight = typeof hh.newWeight === 'number' ? Number(hh.newWeight) : 0;
            const reason = typeof hh.reason === 'string' ? hh.reason : '';
            return { date, oldWeight, newWeight, reason };
          })
          .slice(0, HISTORY_CAP)
      : [];
    result[d] = { weight, executed, rejected, lastAdjustedAt, adjustmentHistory };
  }
  return result;
}

// --- DB read/write ---------------------------------------------------------

/**
 * Load adaptive weights from Settings. Returns DEFAULT_DOMAIN_WEIGHTS_OBJECT
 * if the field is null or the row doesn't exist.
 *
 * On any error (DB unavailable, JSON parse failure), returns defaults and
 * logs a warning — Master Brain must never crash because adaptive weights
 * couldn't be loaded.
 */
export async function loadAdaptiveWeights(): Promise<AdaptiveWeights> {
  const db = getFreshDb();
  try {
    // v8.28: Use raw SQL to read Settings.adaptiveDomainWeights — same reason
    // as saveAdaptiveWeights (Turbopack may have a stale @prisma/client cached).
    // $queryRaw returns an array of rows; we pick the first.
    const rows = await db.$queryRaw<Array<{ adaptiveDomainWeights: string | null }>>`SELECT adaptiveDomainWeights FROM Settings WHERE id = 'singleton' LIMIT 1`;
    const json = rows[0]?.adaptiveDomainWeights;
    if (!json) {
      // No adaptive weights stored yet — return defaults with zero stats.
      return { ...DEFAULT_DOMAIN_WEIGHTS_OBJECT };
    }
    const parsed = JSON.parse(json);
    return sanitizeAdaptiveWeights(parsed);
  } catch (err: any) {
    logger.warn('loadAdaptiveWeights', 'failed to load, using defaults', err);
    return { ...DEFAULT_DOMAIN_WEIGHTS_OBJECT };
  } finally {
    // Close the connection pool — fresh client per call pattern.
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Get just the weight numbers — for Master Brain to use instead of hardcoded
 * DOMAIN_WEIGHTS. Returns a `Record<DomainName, number>` (no stats).
 *
 * This is what the master endpoint passes as `domainWeights` in MasterBrainInput.
 */
export async function loadDomainWeights(): Promise<Record<DomainName, number>> {
  const adaptive = await loadAdaptiveWeights();
  const weights: Partial<Record<DomainName, number>> = {};
  for (const d of Object.keys(adaptive) as DomainName[]) {
    weights[d] = adaptive[d].weight;
  }
  return weights as Record<DomainName, number>;
}

/**
 * Persist adaptive weights to Settings (JSON-encoded).
 * Uses upsert pattern: if the singleton row doesn't exist, create it with
 * just the id + adaptiveDomainWeights (other fields use @default values).
 */
async function saveAdaptiveWeights(weights: AdaptiveWeights): Promise<void> {
  const db = getFreshDb();
  const json = JSON.stringify(weights);
  try {
    // v8.28: Use raw SQL to update Settings.adaptiveDomainWeights.
    // Why raw SQL: the dev server's Turbopack module cache may have an OLD
    // @prisma/client module (regenerated by `prisma generate` mid-run, but
    // Turbopack hasn't reloaded it). The typed `db.settings.update()` call
    // fails with "Unknown argument `adaptiveDomainWeights`" because the
    // cached PrismaClient class doesn't know about the new field.
    // Raw SQL bypasses the typed API entirely — works regardless of which
    // version of @prisma/client is cached.
    //
    // SQLite doesn't have INSERT ... ON CONFLICT for arbitrary columns, but
    // we know the singleton row always exists (created by app init). If for
    // some reason it doesn't, the UPDATE affects 0 rows — we then INSERT.
    const result = await db.$executeRaw`UPDATE Settings SET adaptiveDomainWeights = ${json}, updatedAt = ${new Date().toISOString()} WHERE id = 'singleton'`;
    if (result === 0) {
      // Row doesn't exist — INSERT with just id + adaptiveDomainWeights.
      // All other Settings fields use their @default values from schema.prisma.
      // Note: SQLite will use @default values for unspecified columns on INSERT.
      // We pass explicit defaults for the NOT NULL columns to be safe.
      await db.$executeRaw`INSERT INTO Settings (id, adaptiveDomainWeights) VALUES ('singleton', ${json})`;
    }
  } catch (err: any) {
    logger.error('saveAdaptiveWeights', 'raw SQL update/insert failed', err);
    throw err;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// --- Pure compute: weight adjustment logic ---------------------------------

/**
 * Compute the new weight based on the current execution rate.
 *
 * Rules:
 *  - executionRate > 0.8 (user executes most actions): weight × 1.1 (boost)
 *  - executionRate < 0.4 (user ignores most actions): weight × 0.9 (reduce)
 *  - else: no change
 *  - clamp to [0.5, 2.0]
 *
 * Returns { newWeight, reason, adjusted }.
 * - adjusted=false when no adjustment happened (mid-range execution rate).
 * - reason always non-empty (describes either the adjustment or the no-op).
 *
 * PURE FUNCTION — no DB, no side effects. Exposed for unit testing.
 */
export function computeWeightAdjustment(
  currentWeight: number,
  executed: number,
  rejected: number,
): { newWeight: number; reason: string; adjusted: boolean } {
  const total = executed + rejected;
  if (total === 0) {
    return {
      newWeight: currentWeight,
      reason: 'Ni še akcij (executed=0, rejected=0) — utež nespremenjena.',
      adjusted: false,
    };
  }
  const executionRate = executed / total;
  const roundedRate = Math.round(executionRate * 100) / 100;

  if (executionRate > BOOST_THRESHOLD) {
    const raw = currentWeight * BOOST_FACTOR;
    const newWeight = clamp(round2(raw), MIN_WEIGHT, MAX_WEIGHT);
    if (newWeight === currentWeight) {
      return {
        newWeight,
        reason: `executionRate ${roundedRate} > 0.8 (boost ×1.1), a utež je že na max (${MAX_WEIGHT}) — nespremenjena.`,
        adjusted: false,
      };
    }
    return {
      newWeight,
      reason: `executionRate ${roundedRate} > 0.8 — boost ×1.1 (${currentWeight} → ${newWeight}). Uporabnik izvaja akcije v tej domeni.`,
      adjusted: true,
    };
  }
  if (executionRate < REDUCE_THRESHOLD) {
    const raw = currentWeight * REDUCE_FACTOR;
    const newWeight = clamp(round2(raw), MIN_WEIGHT, MAX_WEIGHT);
    if (newWeight === currentWeight) {
      return {
        newWeight,
        reason: `executionRate ${roundedRate} < 0.4 (reduce ×0.9), a utež je že na min (${MIN_WEIGHT}) — nespremenjena.`,
        adjusted: false,
      };
    }
    return {
      newWeight,
      reason: `executionRate ${roundedRate} < 0.4 — reduce ×0.9 (${currentWeight} → ${newWeight}). Uporabnik ignorira akcije v tej domeni.`,
      adjusted: true,
    };
  }
  return {
    newWeight: currentWeight,
    reason: `executionRate ${roundedRate} v srednjem območju [0.4, 0.8] — utež nespremenjena.`,
    adjusted: false,
  };
}

// --- Mutations: record feedback, reset, manual set -------------------------

/**
 * Record user feedback for an action (executed or rejected).
 * After recording, checks if weight adjustment is needed (every 10 actions
 * per domain — i.e. when total becomes a multiple of ADJUSTMENT_INTERVAL).
 *
 * Returns the WeightAdjustmentResult — `adjusted: false` if no adjustment
 * (either not enough new actions, or execution rate is in mid-range).
 */
export async function recordActionFeedback(
  input: ActionFeedbackInput,
): Promise<WeightAdjustmentResult> {
  const { domain, feedback } = input;

  // 1. Load current adaptive weights
  const weights = await loadAdaptiveWeights();
  const current = weights[domain];
  const oldWeight = current.weight;
  const executedBefore = current.executed;
  const rejectedBefore = current.rejected;

  // 2. Increment executed or rejected count
  const executed = feedback === 'executed' ? executedBefore + 1 : executedBefore;
  const rejected = feedback === 'rejected' ? rejectedBefore + 1 : rejectedBefore;
  const total = executed + rejected;
  const executionRate = total > 0 ? executed / total : 0;
  const roundedRate = Math.round(executionRate * 100) / 100;

  // 3. Check if weight adjustment is needed (every 10 actions per domain)
  let newWeight = oldWeight;
  let reason: string;
  let adjusted = false;

  if (total % ADJUSTMENT_INTERVAL === 0) {
    // Trigger re-evaluation
    const result = computeWeightAdjustment(oldWeight, executed, rejected);
    newWeight = result.newWeight;
    reason = result.reason;
    adjusted = result.adjusted;

    if (adjusted) {
      // Update lastAdjustedAt + push to adjustmentHistory
      const nowIso = new Date().toISOString();
      weights[domain] = {
        weight: newWeight,
        executed,
        rejected,
        lastAdjustedAt: nowIso,
        adjustmentHistory: [
          { date: nowIso, oldWeight, newWeight, reason },
          ...current.adjustmentHistory,
        ].slice(0, HISTORY_CAP),
      };
    } else {
      // Not adjusted but still update the counts
      weights[domain] = {
        ...current,
        weight: newWeight,
        executed,
        rejected,
      };
    }
  } else {
    // Not at adjustment interval — just update counts
    weights[domain] = {
      ...current,
      weight: newWeight,
      executed,
      rejected,
    };
    reason = `Zabeležena akcija "${feedback}" za domeno ${domain}. Skupaj ${total} akcij — naslednja evaluacija pri ${Math.ceil(total / ADJUSTMENT_INTERVAL) * ADJUSTMENT_INTERVAL} (vsakih ${ADJUSTMENT_INTERVAL}). executionRate trenutno ${roundedRate}.`;
  }

  // 4. Save back to Settings
  await saveAdaptiveWeights(weights);

  logger.info('recordActionFeedback', `recorded "${feedback}" for domain "${domain}"`, {
    domain,
    feedback,
    executed,
    rejected,
    executionRate: roundedRate,
    adjusted,
    oldWeight,
    newWeight,
  });

  return {
    ok: true,
    domain,
    oldWeight,
    newWeight,
    executed,
    rejected,
    executionRate: roundedRate,
    adjusted,
    reason,
  };
}

/**
 * Reset all adaptive weights to defaults. Clears all execution stats and
 * adjustment history. Useful when the user wants to start fresh (e.g. they
 * accidentally marked many actions as rejected).
 *
 * Returns the new (default) AdaptiveWeights object.
 */
export async function resetAdaptiveWeights(): Promise<{ ok: true; weights: AdaptiveWeights }> {
  const defaults: AdaptiveWeights = {
    profit: { weight: 1.2, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
    inventory: { weight: 1.0, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
    market: { weight: 1.0, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
    sourcing: { weight: 1.1, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
    risk: { weight: 1.3, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
    buyer: { weight: 0.9, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
    pricing: { weight: 1.1, executed: 0, rejected: 0, lastAdjustedAt: null, adjustmentHistory: [] },
  };
  await saveAdaptiveWeights(defaults);
  logger.info('resetAdaptiveWeights', 'reset all weights to defaults');
  return { ok: true, weights: defaults };
}

/**
 * Manually set a domain weight (override — user drags slider in UI).
 *
 * Clamps the weight to [0.5, 2.0]. Does NOT touch executed/rejected counts
 * or adjustmentHistory — those reflect user BEHAVIOR, manual overrides are
 * a separate signal.
 *
 * Returns the clamped weight actually saved.
 */
export async function setDomainWeight(
  domain: DomainName,
  weight: number,
): Promise<{ ok: true; domain: DomainName; weight: number }> {
  if (!Number.isFinite(weight)) {
    throw new Error(`Invalid weight: ${weight} (must be finite number)`);
  }
  const clampedWeight = clamp(round2(weight), MIN_WEIGHT, MAX_WEIGHT);

  const weights = await loadAdaptiveWeights();
  weights[domain] = {
    ...weights[domain],
    weight: clampedWeight,
  };
  await saveAdaptiveWeights(weights);

  logger.info('setDomainWeight', `manually set weight for ${domain}`, {
    domain,
    requestedWeight: weight,
    clampedWeight,
  });

  return { ok: true, domain, weight: clampedWeight };
}

// --- Exported constants for UI / testing -----------------------------------

export const ADAPTIVE_WEIGHTS_CONSTANTS = {
  MIN_WEIGHT,
  MAX_WEIGHT,
  ADJUSTMENT_INTERVAL,
  BOOST_FACTOR,
  REDUCE_FACTOR,
  BOOST_THRESHOLD,
  REDUCE_THRESHOLD,
  HISTORY_CAP,
} as const;
