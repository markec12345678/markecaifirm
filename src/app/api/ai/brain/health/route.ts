// v8.32: System Health Dashboard API — aggregates entire Brain system health.
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

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCachedAI, setCachedAI } from '@/lib/ai-cache';
import {
  getSystemHealth,
  type SystemHealthReport,
} from '@/lib/brain/system-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // shorter than other brains — health should not hang

// --- Cache TTL -------------------------------------------------------------
// 30 seconds — fresh enough to surface recent state changes (auto-pilot
// suspension, anomaly detection, etc.) without re-running the full 8-brain
// health-check + DB scan on every request.
const HEALTH_CACHE_TTL_MS = 30 * 1000;

// --- Handler ---------------------------------------------------------------

export async function GET() {
  try {
    // Cache check — 30-second TTL. Same shape for all callers (no inputs).
    const cacheKey = 'system-health:v8.32';
    const cached = getCachedAI<SystemHealthReport>(cacheKey);
    if (cached) {
      // Re-stamp timestamp so the caller sees a fresh "served at" time, even
      // though the underlying data is up to 30s old. This mirrors the pattern
      // used by other brain endpoints (profitBrain, masterBrain, ...).
      return NextResponse.json({
        ...cached,
        timestamp: new Date().toISOString(),
      });
    }

    const report = await getSystemHealth();
    setCachedAI(cacheKey, report, HEALTH_CACHE_TTL_MS);

    return NextResponse.json(report);
  } catch (err: any) {
    logger.error('/api/ai/brain/health', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
