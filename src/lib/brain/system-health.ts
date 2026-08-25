// v8.32: System Health Dashboard — aggregates the entire Brain system's health
// into one view. Pure compute — calls each brain endpoint's health check,
// reads DB for counts, returns unified health report.
//
// Architectural role: POLISH PHASE START — now that all features work
// (Architecture v8.15-v8.22 + Validation v8.23-v8.25 + Intelligence v8.26-v8.29
// + Automation v8.30-v8.31), we need to MONITOR them. v8.32 provides the
// "dashboard light" — answers: "Ali je sistem zdrav? Ali vsi brain-i
// odgovarjajo? Kakšna je cache hit rate? Koliko draftov pending?"
//
// How it works:
//   1. For each of 8 brain endpoints (profit, inventory, market, sourcing, risk,
//      buyer, pricing, master) — fetch with 3-second timeout. Record responsive
//      + responseTimeMs + lastError + grade (from response if present).
//   2. Read DB:
//      - latest BrainSnapshot (date + accuracy30d)
//      - count of BrainSnapshots
//      - count of Trade rows with status='sold' (used for accuracy tracking)
//      - ActionDraft stats (pending, executed, rejected, expired counts)
//      - Settings (autoPilot config, risk profile, adaptive weights)
//   3. Compute overallHealthScore (0-100):
//      - 40% brain endpoints responsive (8 endpoints × 5 points each = 40)
//      - 20% data freshness (snapshot exists + <7 days old = 20; no snapshot = 0)
//      - 15% draft queue health (executionRate > 0.5 = 15)
//      - 15% auto-pilot health (not suspended = 15; suspended = 0)
//      - 10% risk profile set (non-default = 10)
//   4. overallGrade: A+ >=90, A >=80, B >=65, C >=50, D >=30, F <30
//   5. status: HEALTHY >=80, DEGRADED >=50, UNHEALTHY <50
//   6. recommendations: auto-generate based on gaps (5+ rules)
//
// Pure TypeScript function — no `next/server` import, no AI/LLM SDK. Calls
// other brain endpoints via HTTP `fetch()` with short timeout (3s). DB reads
// via fresh PrismaClient (v8.28+ pattern — Turbopack-safe for newer fields).
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.

import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import type { ProfitGrade } from './profit';
import type { DomainName } from './master';
import {
  loadAdaptiveWeights,
  DEFAULT_DOMAIN_WEIGHTS,
  type AdaptiveWeights,
} from './adaptive-weights';
import {
  getAutoPilotStats,
  type AutoPilotConfig,
} from './auto-pilot';

// --- Types ------------------------------------------------------------------

export interface BrainEndpointHealth {
  name: string;              // 'profit' | 'inventory' | ... | 'master'
  path: string;              // '/api/ai/brain/profit' etc.
  responsive: boolean;       // did it respond within timeout?
  responseTimeMs: number;    // response time (0 if error)
  lastError: string | null;  // last error message (null if healthy)
  grade: ProfitGrade | null; // latest grade from latest snapshot (null if no data)
}

export interface SystemHealthReport {
  ok: true;
  timestamp: string;         // ISO
  // Overall score
  overallHealthScore: number;  // 0-100 (weighted: brains responsive + data freshness + auto-pilot health)
  overallGrade: ProfitGrade;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';  // HEALTHY >=80, DEGRADED >=50, UNHEALTHY <50
  // 8 Brain endpoints health
  brainEndpoints: BrainEndpointHealth[];  // 8 entries (7 domains + master)
  // Data freshness
  dataFreshness: {
    latestSnapshotDate: string | null;    // YYYY-MM-DD
    snapshotsCount: number;
    daysSinceLastSnapshot: number | null;
    accuracy30d: number | null;          // from latest backfilled snapshot
    tradesRecorded: number;              // total Trade rows with status='sold'
  };
  // Auto-pilot status
  autoPilot: {
    enabled: boolean;
    mode: 'safe' | 'aggressive';
    anomalySuspended: boolean;
    todayAutoExecuted: number;
    todayBudgetUsed: number;
  };
  // Draft queue status
  draftQueue: {
    pending: number;
    executed: number;
    rejected: number;
    expired: number;
    total: number;
    executionRate: number;  // executed / (executed + rejected)
  };
  // Risk profile
  riskProfile: {
    riskTolerance: 'conservative' | 'balanced' | 'aggressive';
    maxAcceptableRisk: number;
  };
  // Adaptive weights summary
  adaptiveWeights: {
    adjustedDomains: number;   // count of domains with non-default weights
    totalExecuted: number;      // sum of executed across all domains
    totalRejected: number;
  };
  // Recommendations (auto-generated)
  recommendations: string[];   // e.g. "Enable auto-pilot for LOW-risk automation", "Record more trades for accuracy"
  source: 'v8.32-system-health';
}

// --- Constants --------------------------------------------------------------

/**
 * The 8 brain endpoints we health-check.
 *
 * 7 Domain Brains (v8.15-v8.21) + 1 Master Brain (v8.22) = 8 total.
 * Each is fetched with a 3-second timeout. Failure (timeout, network error,
 * non-2xx status) marks the brain as not responsive — but does NOT abort the
 * overall health report (we still return data for the other 7 brains).
 */
const BRAIN_ENDPOINTS: Array<{ name: string; path: string }> = [
  { name: 'profit', path: '/api/ai/brain/profit' },
  { name: 'inventory', path: '/api/ai/brain/inventory' },
  { name: 'market', path: '/api/ai/brain/market' },
  { name: 'sourcing', path: '/api/ai/brain/sourcing' },
  { name: 'risk', path: '/api/ai/brain/risk' },
  { name: 'buyer', path: '/api/ai/brain/buyer' },
  { name: 'pricing', path: '/api/ai/brain/pricing' },
  { name: 'master', path: '/api/ai/brain/master' },
];

/** Timeout per brain endpoint health-check (ms). */
const BRAIN_CHECK_TIMEOUT_MS = 3000;

/**
 * Base URL for internal fetch calls. In Next.js server runtime, we use
 * `http://localhost:3000` (the dev server's port) — the same pattern used
 * by the cron endpoints. We always pass an absolute URL to fetch().
 */
const INTERNAL_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3000';

// --- Helpers ----------------------------------------------------------------

/**
 * v8.32: Use a FRESH PrismaClient per call (same pattern as v8.24/v8.28/v8.30
 * to handle Turbopack cache issues with newer Settings fields). The standard
 * `db` from @/lib/db caches a single PrismaClient in `globalThis.prisma` —
 * fine for production but problematic in dev when the schema changes mid-run.
 */
function getFreshDb(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn'],
  });
}

/**
 * Map a numeric health score (0-100) to a ProfitGrade.
 *
 * Same thresholds used by the rest of the Brain system:
 *   - A+ >= 90
 *   - A  >= 80
 *   - B  >= 65
 *   - C  >= 50
 *   - D  >= 30
 *   - F  <  30
 */
function gradeFromScore(score: number): ProfitGrade {
  if (!Number.isFinite(score)) return 'F';
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

/**
 * Extract a ProfitGrade from a brain endpoint's JSON response.
 *
 * Each brain's response shape differs slightly (profit → maximization.profitGrade,
 * inventory → maximization.inventoryGrade, market → maximization.marketGrade,
 * etc.). Master Brain has top-level `overallHealth` (a number, not a grade) —
 * we convert it to a grade.
 *
 * Returns null if the response shape is unexpected or no grade is present.
 */
function extractGradeFromResponse(name: string, json: any): ProfitGrade | null {
  try {
    if (!json || typeof json !== 'object') return null;

    if (name === 'master') {
      // Master Brain: overallHealth is a nested object { score, grade, ... }.
      // Try the numeric `score` field first, then the string `grade` field.
      const healthObj = json.overallHealth;
      if (healthObj && typeof healthObj === 'object') {
        const score = Number(healthObj.score);
        if (Number.isFinite(score)) {
          return gradeFromScore(score);
        }
        const gradeStr = String(healthObj.grade ?? '').toUpperCase();
        if (gradeStr === 'A+' || gradeStr === 'A' || gradeStr === 'B' || gradeStr === 'C' || gradeStr === 'D' || gradeStr === 'F') {
          return gradeStr as ProfitGrade;
        }
      }
      // Fallback: overallHealth could also be a top-level number on some shapes.
      const healthNum = Number(json.overallHealth);
      if (Number.isFinite(healthNum)) {
        return gradeFromScore(healthNum);
      }
      return null;
    }

    // Domain Brain: maximization.<domain>Grade (string 'A+' through 'F').
    const gradeKey = `${name}Grade`;
    const grade = json?.maximization?.[gradeKey];
    if (typeof grade === 'string') {
      const g = grade.toUpperCase();
      if (g === 'A+' || g === 'A' || g === 'B' || g === 'C' || g === 'D' || g === 'F') {
        return g as ProfitGrade;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single brain endpoint with a 3-second timeout.
 *
 * Returns the responsive state, response time, error message (if any),
 * and the latest grade extracted from the response JSON.
 *
 * NEVER throws — failures are returned as `responsive: false` entries.
 */
async function checkBrainEndpoint(
  endpoint: { name: string; path: string },
): Promise<BrainEndpointHealth> {
  const url = `${INTERNAL_BASE_URL}${endpoint.path}`;
  const startedAt = Date.now();

  try {
    // Use AbortController + setTimeout for timeout (broad Node 18+ support).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BRAIN_CHECK_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          // Self-fetch hint — some internal middleware may need it.
          'x-internal-health-check': 'v8.32',
        },
        // Next.js fetch() dedupes by URL — we want fresh data each call.
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const responseTimeMs = Date.now() - startedAt;

    if (!res.ok) {
      return {
        name: endpoint.name,
        path: endpoint.path,
        responsive: false,
        responseTimeMs,
        lastError: `HTTP ${res.status} ${res.statusText}`,
        grade: null,
      };
    }

    // Try to parse JSON to extract the brain's current grade.
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // Response wasn't JSON — still mark as responsive (it returned 2xx).
    }

    const grade = extractGradeFromResponse(endpoint.name, json);

    return {
      name: endpoint.name,
      path: endpoint.path,
      responsive: true,
      responseTimeMs,
      lastError: null,
      grade,
    };
  } catch (err: any) {
    const responseTimeMs = Date.now() - startedAt;
    // Distinguish timeout from other errors for clearer messaging.
    const isTimeout = err?.name === 'AbortError' || /abort/i.test(String(err?.message ?? ''));
    const lastError = isTimeout
      ? `Timeout (>${BRAIN_CHECK_TIMEOUT_MS}ms)`
      : String(err?.message ?? 'Unknown fetch error');

    return {
      name: endpoint.name,
      path: endpoint.path,
      responsive: false,
      responseTimeMs,
      lastError,
      grade: null,
    };
  }
}

// --- DB data loaders --------------------------------------------------------

/**
 * Load the latest BrainSnapshot row + total count.
 *
 * Returns null fields on error or when no snapshots exist.
 */
async function loadSnapshotData(): Promise<{
  latestDate: string | null;
  count: number;
  daysSinceLast: number | null;
  accuracy30d: number | null;
}> {
  const db = getFreshDb();
  try {
    const countRows = await db.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM BrainSnapshot
    `;
    const count = Number(countRows[0]?.cnt ?? 0);

    if (count === 0) {
      return { latestDate: null, count: 0, daysSinceLast: null, accuracy30d: null };
    }

    const latestRows = await db.$queryRaw<Array<{
      date: string;
      accuracy30d: number | null;
    }>>`
      SELECT date, accuracy30d FROM BrainSnapshot
      ORDER BY date DESC
      LIMIT 1
    `;
    const latest = latestRows[0];
    if (!latest) {
      return { latestDate: null, count, daysSinceLast: null, accuracy30d: null };
    }

    const latestDate = String(latest.date);
    // Compute days since last snapshot (parse YYYY-MM-DD as UTC midnight).
    let daysSinceLast: number | null = null;
    try {
      const lastDate = new Date(`${latestDate}T00:00:00Z`);
      const now = new Date();
      daysSinceLast = Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
      if (daysSinceLast < 0) daysSinceLast = 0;
    } catch {
      daysSinceLast = null;
    }

    const accuracy30d =
      typeof latest.accuracy30d === 'number' && Number.isFinite(latest.accuracy30d)
        ? Math.round(latest.accuracy30d * 10) / 10
        : null;

    return { latestDate, count, daysSinceLast, accuracy30d };
  } catch (err: any) {
    logger.warn('system-health.loadSnapshotData', 'failed, using defaults', err);
    return { latestDate: null, count: 0, daysSinceLast: null, accuracy30d: null };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Count Trade rows with status='sold' (used for accuracy tracking).
 */
async function countSoldTrades(): Promise<number> {
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM Trade WHERE status = 'sold'
    `;
    return Number(rows[0]?.cnt ?? 0);
  } catch (err: any) {
    logger.warn('system-health.countSoldTrades', 'failed, returning 0', err);
    return 0;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Aggregate ActionDraft row counts by status.
 *
 * Returns the 4 status counts + total + executionRate (executed / (executed +
 * rejected)). 'approved' status is treated as 'pending' for health display
 * (user has approved but not yet executed — still in flight).
 */
async function loadDraftQueueStats(): Promise<{
  pending: number;
  executed: number;
  rejected: number;
  expired: number;
  total: number;
  executionRate: number;
}> {
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<Array<{
      pending: bigint;
      executed: bigint;
      rejected: bigint;
      expired: bigint;
      total: bigint;
    }>>`
      SELECT
        COUNT(CASE WHEN status = 'pending' OR status = 'approved' THEN 1 END) AS pending,
        COUNT(CASE WHEN status = 'executed' THEN 1 END) AS executed,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) AS expired,
        COUNT(*) AS total
      FROM ActionDraft
    `;
    const r = rows[0] ?? { pending: BigInt(0), executed: BigInt(0), rejected: BigInt(0), expired: BigInt(0), total: BigInt(0) };
    const pending = Number(r.pending) || 0;
    const executed = Number(r.executed) || 0;
    const rejected = Number(r.rejected) || 0;
    const expired = Number(r.expired) || 0;
    const total = Number(r.total) || 0;
    const denom = executed + rejected;
    const executionRate = denom > 0 ? Math.round((executed / denom) * 1000) / 1000 : 0;
    return { pending, executed, rejected, expired, total, executionRate };
  } catch (err: any) {
    logger.warn('system-health.loadDraftQueueStats', 'failed, using defaults', err);
    return { pending: 0, executed: 0, rejected: 0, expired: 0, total: 0, executionRate: 0 };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Load the 4 user risk-profile fields from the Settings singleton row.
 *
 * On any DB error / missing row / invalid values, returns DEFAULT_PROFILE
 * (balanced, 50, 500, medium) — system health must never crash because
 * the user's profile couldn't be loaded.
 */
async function loadRiskProfile(): Promise<{
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  maxAcceptableRisk: number;
}> {
  const db = getFreshDb();
  try {
    const rows = await db.$queryRaw<Array<{
      userRiskTolerance: string | null;
      userMaxAcceptableRisk: number | null;
    }>>`
      SELECT userRiskTolerance, userMaxAcceptableRisk
      FROM Settings WHERE id = 'singleton' LIMIT 1
    `;
    const r = rows[0];
    if (!r) {
      return { riskTolerance: 'balanced', maxAcceptableRisk: 50 };
    }
    const rawTol = String(r.userRiskTolerance ?? 'balanced').toLowerCase();
    const riskTolerance: 'conservative' | 'balanced' | 'aggressive' =
      rawTol === 'conservative' || rawTol === 'aggressive' ? rawTol : 'balanced';
    const maxRisk =
      typeof r.userMaxAcceptableRisk === 'number' && Number.isFinite(r.userMaxAcceptableRisk)
        ? Math.max(0, Math.min(100, r.userMaxAcceptableRisk))
        : 50;
    return { riskTolerance, maxAcceptableRisk: maxRisk };
  } catch (err: any) {
    logger.warn('system-health.loadRiskProfile', 'failed, using defaults', err);
    return { riskTolerance: 'balanced', maxAcceptableRisk: 50 };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

/**
 * Summarize adaptive weights — count domains whose weight differs from the
 * default + sum executed/rejected across all 7 domains.
 *
 * Used to surface "how much has the system learned" in the health report.
 */
function summarizeAdaptiveWeights(weights: AdaptiveWeights): {
  adjustedDomains: number;
  totalExecuted: number;
  totalRejected: number;
} {
  let adjustedDomains = 0;
  let totalExecuted = 0;
  let totalRejected = 0;
  for (const d of Object.keys(weights) as DomainName[]) {
    const entry = weights[d];
    const defaultWeight = DEFAULT_DOMAIN_WEIGHTS[d];
    if (Math.abs(entry.weight - defaultWeight) > 0.001) {
      adjustedDomains += 1;
    }
    totalExecuted += entry.executed;
    totalRejected += entry.rejected;
  }
  return { adjustedDomains, totalExecuted, totalRejected };
}

/**
 * Summarize auto-pilot config + today's stats into the health-report shape.
 */
async function loadAutoPilotSummary(): Promise<{
  config: AutoPilotConfig;
  todayAutoExecuted: number;
  todayBudgetUsed: number;
}> {
  try {
    const stats = await getAutoPilotStats();
    return {
      config: stats.config,
      todayAutoExecuted: stats.today.autoExecuted,
      todayBudgetUsed: stats.today.budgetUsed,
    };
  } catch (err: any) {
    logger.warn('system-health.loadAutoPilotSummary', 'failed, using defaults', err);
    return {
      config: {
        enabled: false,
        mode: 'safe',
        dailyLimit: 5,
        dailyBudgetEUR: 500,
        lastRunAt: null,
        aggressiveConfirmedAt: null,
        anomalySuspended: false,
        anomalySuspendedAt: null,
        anomalyReason: null,
        hourlyExecCount: 0,
        hourlyWindowStart: null,
      },
      todayAutoExecuted: 0,
      todayBudgetUsed: 0,
    };
  }
}

// --- Score computation ------------------------------------------------------

/**
 * Compute the overall system health score (0-100).
 *
 * Weighted formula:
 *   - 40% brain endpoints responsive (8 endpoints × 5 points each = 40)
 *   - 20% data freshness (snapshot exists + <7 days old = 20; no snapshot = 0)
 *   - 15% draft queue health (executionRate > 0.5 = 15)
 *   - 15% auto-pilot health (not suspended = 15; suspended = 0)
 *   - 10% risk profile set (non-default = 10)
 */
function computeOverallScore(params: {
  responsiveCount: number;
  totalEndpoints: number;
  hasFreshSnapshot: boolean;
  executionRate: number;
  hasDraftsResolved: boolean;
  anomalySuspended: boolean;
  riskProfileIsNonDefault: boolean;
}): number {
  const {
    responsiveCount,
    totalEndpoints,
    hasFreshSnapshot,
    executionRate,
    hasDraftsResolved,
    anomalySuspended,
    riskProfileIsNonDefault,
  } = params;

  // 40% brain endpoints responsive — proportional (8/8 = 40, 0/8 = 0).
  const brainScore =
    totalEndpoints > 0
      ? (responsiveCount / totalEndpoints) * 40
      : 0;

  // 20% data freshness — snapshot exists AND fresh (<7 days).
  const freshnessScore = hasFreshSnapshot ? 20 : 0;

  // 15% draft queue health — executionRate > 0.5 means user is acting on
  // recommendations. If no drafts have been resolved yet, partial credit (7.5)
  // so a fresh install doesn't get a 0.
  const draftScore = hasDraftsResolved
    ? executionRate > 0.5
      ? 15
      : executionRate > 0.2
        ? 10
        : 5
    : 7.5;

  // 15% auto-pilot health — suspended means anomaly detected (unhealthy).
  const autoPilotScore = anomalySuspended ? 0 : 15;

  // 10% risk profile set — non-default means user has personalized.
  const riskProfileScore = riskProfileIsNonDefault ? 10 : 0;

  const total =
    brainScore +
    freshnessScore +
    draftScore +
    autoPilotScore +
    riskProfileScore;

  return Math.max(0, Math.min(100, Math.round(total)));
}

// --- Recommendations --------------------------------------------------------

/**
 * Generate a list of actionable recommendations based on the current health
 * report state. Each recommendation is a short Slovenian string.
 *
 * Rules (5+):
 *   - if !autoPilot.enabled → "Enable auto-pilot for LOW-risk automation"
 *   - if snapshotsCount === 0 → "Run Master Brain to create first snapshot"
 *   - if tradesRecorded === 0 → "Record sold trades for accuracy tracking"
 *   - if riskProfile.riskTolerance === 'balanced' (default) → "Set your risk profile"
 *   - if adaptiveWeights.adjustedDomains === 0 → "Execute/reject drafts to train adaptive weights"
 *   - if any brain !responsive → "Brain X is not responding — check logs"
 *   - if anomalySuspended → "Clear anomaly suspension to re-enable auto-pilot"
 *   - if executionRate < 0.4 → "Low execution rate — review pending drafts"
 */
function generateRecommendations(params: {
  brainEndpoints: BrainEndpointHealth[];
  snapshotsCount: number;
  tradesRecorded: number;
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  adaptiveAdjustedDomains: number;
  autoPilotEnabled: boolean;
  anomalySuspended: boolean;
  executionRate: number;
  hasDraftsResolved: boolean;
}): string[] {
  const recs: string[] = [];

  // 1. Brains not responding
  for (const b of params.brainEndpoints) {
    if (!b.responsive) {
      recs.push(`💡 Brain "${b.name}" ne odgovarja — preveri log (${b.lastError ?? 'unknown error'})`);
    }
  }

  // 2. Anomaly suspension
  if (params.anomalySuspended) {
    recs.push('💡 Anomaly suspension aktiven — pošlji POST {action:"clear_anomaly"} za ponovni zagon');
  }

  // 3. Auto-pilot not enabled
  if (!params.autoPilotEnabled) {
    recs.push('💡 Vklopi auto-pilot za LOW-risk avtomatizacijo (8 varnostnih pravil)');
  }

  // 4. No snapshots yet
  if (params.snapshotsCount === 0) {
    recs.push('💡 Zaženi Master Brain za kreiranje prvega snapshot-a (potrebno za accuracy tracking)');
  }

  // 5. No trades recorded
  if (params.tradesRecorded === 0) {
    recs.push('💡 Zabeleži prodane trade-a za accuracy tracking (potrebno za backfill)');
  }

  // 6. Default risk profile
  if (params.riskTolerance === 'balanced') {
    recs.push('💡 Nastavi svoj risk profil (conservative/aggressive) za personalizirana priporočila');
  }

  // 7. No adaptive weight adjustments yet
  if (params.adaptiveAdjustedDomains === 0) {
    recs.push('💡 Izvedi/zavrni draft-a za trening adaptive weights (sistem se uči iz revealed preferences)');
  }

  // 8. Low execution rate
  if (params.hasDraftsResolved && params.executionRate < 0.4) {
    recs.push(`💡 Nizka execution rate (${Math.round(params.executionRate * 100)}%) — pregledaj pending draft-a in zavrni neustrezne`);
  }

  return recs;
}

// --- Main entry point -------------------------------------------------------

/**
 * Generate full system health report.
 *
 * Calls each of the 8 brain endpoints with a short timeout, reads DB for
 * counts (snapshots, trades, drafts, settings), and returns a unified
 * health report with overall score, status, and recommendations.
 *
 * NEVER throws — all sub-errors are caught and reflected as degraded
 * health (e.g. unresponsive brain endpoint → not responsive in the report,
 * but the report itself still returns successfully).
 */
export async function getSystemHealth(): Promise<SystemHealthReport> {
  const timestamp = new Date().toISOString();

  // 1. Health-check all 8 brain endpoints in PARALLEL.
  // Each call has a 3-second timeout — total worst-case = 3 seconds
  // (because they're parallel, not sequential).
  const brainEndpoints: BrainEndpointHealth[] = await Promise.all(
    BRAIN_ENDPOINTS.map((ep) => checkBrainEndpoint(ep)),
  );

  // 2. Read DB data in PARALLEL.
  const [
    snapshotData,
    tradesCount,
    draftStats,
    riskProfile,
    adaptiveWeights,
    autoPilotSummary,
  ] = await Promise.all([
    loadSnapshotData(),
    countSoldTrades(),
    loadDraftQueueStats(),
    loadRiskProfile(),
    loadAdaptiveWeights(),
    loadAutoPilotSummary(),
  ]);

  // 3. Summarize adaptive weights.
  const adaptiveSummary = summarizeAdaptiveWeights(adaptiveWeights);

  // 4. Compute sub-scores for overall health.
  const responsiveCount = brainEndpoints.filter((b) => b.responsive).length;
  const hasFreshSnapshot =
    snapshotData.latestDate !== null &&
    snapshotData.daysSinceLast !== null &&
    snapshotData.daysSinceLast <= 7;
  const hasDraftsResolved = draftStats.executed + draftStats.rejected > 0;
  const anomalySuspended = autoPilotSummary.config.anomalySuspended;
  // Risk profile is "non-default" if tolerance is conservative/aggressive
  // (not the default 'balanced') OR maxAcceptableRisk has been changed from 50.
  const riskProfileIsNonDefault =
    riskProfile.riskTolerance !== 'balanced' ||
    riskProfile.maxAcceptableRisk !== 50;

  // 5. Compute overall health score (0-100).
  const overallHealthScore = computeOverallScore({
    responsiveCount,
    totalEndpoints: brainEndpoints.length,
    hasFreshSnapshot,
    executionRate: draftStats.executionRate,
    hasDraftsResolved,
    anomalySuspended,
    riskProfileIsNonDefault,
  });

  // 6. Compute grade + status from the score.
  const overallGrade = gradeFromScore(overallHealthScore);
  const status: SystemHealthReport['status'] =
    overallHealthScore >= 80
      ? 'HEALTHY'
      : overallHealthScore >= 50
        ? 'DEGRADED'
        : 'UNHEALTHY';

  // 7. Generate recommendations.
  const recommendations = generateRecommendations({
    brainEndpoints,
    snapshotsCount: snapshotData.count,
    tradesRecorded: tradesCount,
    riskTolerance: riskProfile.riskTolerance,
    adaptiveAdjustedDomains: adaptiveSummary.adjustedDomains,
    autoPilotEnabled: autoPilotSummary.config.enabled,
    anomalySuspended,
    executionRate: draftStats.executionRate,
    hasDraftsResolved,
  });

  // 8. Assemble and return the report.
  const report: SystemHealthReport = {
    ok: true,
    timestamp,
    overallHealthScore,
    overallGrade,
    status,
    brainEndpoints,
    dataFreshness: {
      latestSnapshotDate: snapshotData.latestDate,
      snapshotsCount: snapshotData.count,
      daysSinceLastSnapshot: snapshotData.daysSinceLast,
      accuracy30d: snapshotData.accuracy30d,
      tradesRecorded: tradesCount,
    },
    autoPilot: {
      enabled: autoPilotSummary.config.enabled,
      mode: autoPilotSummary.config.mode,
      anomalySuspended,
      todayAutoExecuted: autoPilotSummary.todayAutoExecuted,
      todayBudgetUsed: autoPilotSummary.todayBudgetUsed,
    },
    draftQueue: {
      pending: draftStats.pending,
      executed: draftStats.executed,
      rejected: draftStats.rejected,
      expired: draftStats.expired,
      total: draftStats.total,
      executionRate: draftStats.executionRate,
    },
    riskProfile: {
      riskTolerance: riskProfile.riskTolerance,
      maxAcceptableRisk: riskProfile.maxAcceptableRisk,
    },
    adaptiveWeights: {
      adjustedDomains: adaptiveSummary.adjustedDomains,
      totalExecuted: adaptiveSummary.totalExecuted,
      totalRejected: adaptiveSummary.totalRejected,
    },
    recommendations,
    source: 'v8.32-system-health',
  };

  return report;
}

/**
 * Quick health check — just returns { healthy, score, status }.
 *
 * Used by cron/monitoring — doesn't return the full report (cheaper to log
 * and ship to alerting).
 */
export async function quickHealthCheck(): Promise<{
  healthy: boolean;
  score: number;
  status: string;
}> {
  const report = await getSystemHealth();
  return {
    healthy: report.overallHealthScore >= 50,
    score: report.overallHealthScore,
    status: report.status,
  };
}
