// v8.32 / v8.94-refactor: System Health Dashboard API — aggregates entire Brain system health.
//
// GET /api/ai/brain/health → returns full SystemHealthReport:
//   - 8 brain endpoint statuses (responsive + responseTimeMs + grade)
//   - data freshness (latest snapshot, trades count, accuracy30d)
//   - auto-pilot status (enabled, mode, anomalySuspended, today's stats)
//   - draft queue summary (pending, executed, rejected, executionRate)
//   - risk profile + adaptive weights summary
//   - auto-generated recommendations (5+ rules)
//   - overall health score 0-100 (weighted: 40% brains + 20% freshness + 15%
//     draft queue + 15% auto-pilot + 10% risk profile) + overall grade + status
//
// POLISH PHASE — answers: "Ali je sistem zdrav? Ali vsi brain-i odgovarjajo?"
//
// 30-second cache — shorter than other brains (5-10 min) because health should
// be fresh. Each brain endpoint health-check has its own 3-second timeout, and
// they run in parallel — total worst-case latency is ~3 seconds + DB queries
// (~100ms) = ~3.5 seconds. maxDuration=30s gives comfortable headroom.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
// The 8 brain endpoint health checks use native `fetch()` — they hit OTHER
// routes in this same Next.js server (internal HTTP loopback).
//
// Refaktoriran z withAiRoute helperjem (v8.94.9-e) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x migracijami).

import { withAiRoute, AI_ROUTE_DEFAULTS, type AiRouteContext } from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import {
  getSystemHealth,
  type SystemHealthReport,
} from '@/lib/brain/system-health';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 30; // shorter than other brains — health should not hang

// --- Cache TTL -------------------------------------------------------------
// 30 seconds — fresh enough to surface recent state changes (auto-pilot
// suspension, anomaly detection, etc.) without re-running the full 8-brain
// health-check + DB scan on every request.
const HEALTH_CACHE_TTL_MS = 30 * 1000;
const HEALTH_CACHE_KEY = 'system-health:v8.32';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BrainHealthInput {}

// --- Handler ---------------------------------------------------------------

export const GET = withAiRoute<BrainHealthInput>({
  endpoint: '/api/ai/brain/health',
  maxDuration: 30,
  enforceBudget: true, // v8.94.9-e: budget guard + avtomatski recordAiCall
  method: 'GET',

  // GET — brez telesa; parseBody vrne prazen objekt
  parseBody: async () => ({}),

  // Brez validateInput — endpoint nima inputa

  handler: async (_input, _ctx: AiRouteContext) => {
    // Cache check — 30-second TTL. Same shape for all callers (no inputs).
    const cached = getCachedAI<SystemHealthReport>(HEALTH_CACHE_KEY);
    if (cached) {
      // Re-stamp timestamp so the caller sees a fresh "served at" time, even
      // though the underlying data is up to 30s old. This mirrors the pattern
      // used by other brain endpoints (profitBrain, masterBrain, ...).
      return apiOk({
        ...cached,
        timestamp: new Date().toISOString(),
      });
    }

    const report = await getSystemHealth();
    setCachedAI(HEALTH_CACHE_KEY, report, HEALTH_CACHE_TTL_MS);

    return apiOk(report);
  },
});
