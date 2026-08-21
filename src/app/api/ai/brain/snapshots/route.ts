// v8.23 / v8.95.2-e-refactor: Brain Snapshots API — fetch historical Master
// Brain snapshots + actual profit, or trigger a manual snapshot save.
//
// GET  /api/ai/brain/snapshots?days=30 (default 30)
//      Returns last N days of snapshots + actual profit calculation.
//      Response shape: { ok, days, snapshots, actualProfit, summary }
//
// POST /api/ai/brain/snapshots         (same handler — body: { force?: boolean })
//      Triggers a new snapshot save (manual). Useful for testing or when the
//      user wants to capture the current Master Brain state immediately.
//      `force` is informational only — saveDailySnapshot is idempotent
//      (always upserts today's row by YYYY-MM-DD key).
//      Response shape: { ok, date, forced, snapshot }
//
// Foundation for v8.25 (Historical Accuracy) — snapshots store BOTH:
//   - Predicted (now, at creation): projection30dEUR, projection90dEUR
//   - Actual (filled 30d/90d later by accuracy backfill cron): actualProfit30d, accuracy30d
//
// Together with /api/ai/brain/actual-profit (ground truth from Trade table),
// this enables historical accuracy measurement: predicted vs actual.
//
// DETERMINISTIC (aiUsed: false): no external AI/LLM SDK is called.
//   - GET reads BrainSnapshot rows via getSnapshots() from @/lib/brain/snapshots
//     + actual profit via calculateActualProfit() from @/lib/profit/actual.
//   - POST calls saveDailySnapshot() which internally calls masterBrain() —
//     itself a pure TypeScript function that aggregates the 7 Domain Brains.
//
// Refaktoriran z withAiRoute helperjem (v8.95.2-e) + enforceBudget guard
// (non-breaking — endpoint ne kliče AI direktno, ampak je konsistentno z
// vsemi v8.94.x / v8.95.x migracijami). EN handler shared za GET in POST
// (konsistentno z brain/actual-profit in brain/explain vzorcem — parseBody
// razlikuje med metodami preko req.method, handler nato branch-a na GET
// ali POST logiko).

import type { NextRequest } from 'next/server';
import {
  withAiRoute,
  AI_ROUTE_DEFAULTS,
  type AiRouteContext,
} from '@/lib/with-ai-route';
import { apiOk } from '@/lib/api-response';
import {
  saveDailySnapshot,
  getSnapshots,
  type BrainSnapshotRow,
} from '@/lib/brain/snapshots';
import { calculateActualProfit, type ActualProfitResult } from '@/lib/profit/actual';

export const { runtime, dynamic } = AI_ROUTE_DEFAULTS;
export const maxDuration = 60;

// --- Input shape ----------------------------------------------------------
// GET → method='GET' + days query param (force ignored)
// POST → method='POST' + force body field (days parsed but unused)

interface SnapshotsInput {
  /** HTTP metoda — določa ali tečemo GET (read) ali POST (trigger) logiko. */
  method: 'GET' | 'POST';
  /** GET: days query param, clamp [1, 400]. Default 30. */
  days: number;
  /** POST: force re-save today's snapshot (informational only). Default true. */
  force: boolean;
}

// --- Public snapshot shape (stripped of the heavy masterResultJson) ----------
// We strip masterResultJson from the list response to keep payload small.
// UI can fetch full master result via /api/ai/brain/snapshots/[date] (v8.25)
// or by parsing the embedded JSON if we choose to include it.

interface SnapshotPublicView {
  id: string;
  date: string;
  overallHealth: number;
  healthGrade: string;
  riskLevel: string;
  topActionCount: number;
  conflictCount: number;
  bottleneckCount: number;
  strengthCount: number;
  projection30dEUR: number;
  projection90dEUR: number;
  projection12mEUR: number;
  profitGrade: string;
  inventoryGrade: string;
  marketGrade: string;
  sourcingGrade: string;
  riskGrade: string;
  buyerGrade: string;
  pricingGrade: string;
  actualProfit30d: number | null;
  actualProfit90d: number | null;
  accuracy30d: number | null;
  accuracy90d: number | null;
  createdAt: string; // ISO string
}

// --- Pure helpers (čiste, testabilne) -------------------------------------

/**
 * Parse `days` query param — clamp to [1, 400]. Default 30.
 */
function parseDays(req: NextRequest): number {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('days');
    if (!raw) return 30;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(n, 400);
  } catch {
    return 30;
  }
}

/**
 * Strip the heavy masterResultJson from a BrainSnapshotRow to produce a
 * lightweight public view for the list response. The full master result
 * remains available via /api/ai/brain/snapshots/[date].
 */
function toPublicView(s: BrainSnapshotRow): SnapshotPublicView {
  return {
    id: s.id,
    date: s.date,
    overallHealth: s.overallHealth,
    healthGrade: s.healthGrade,
    riskLevel: s.riskLevel,
    topActionCount: s.topActionCount,
    conflictCount: s.conflictCount,
    bottleneckCount: s.bottleneckCount,
    strengthCount: s.strengthCount,
    projection30dEUR: s.projection30dEUR,
    projection90dEUR: s.projection90dEUR,
    projection12mEUR: s.projection12mEUR,
    profitGrade: s.profitGrade,
    inventoryGrade: s.inventoryGrade,
    marketGrade: s.marketGrade,
    sourcingGrade: s.sourcingGrade,
    riskGrade: s.riskGrade,
    buyerGrade: s.buyerGrade,
    pricingGrade: s.pricingGrade,
    actualProfit30d: s.actualProfit30d,
    actualProfit90d: s.actualProfit90d,
    accuracy30d: s.accuracy30d,
    accuracy90d: s.accuracy90d,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : new Date(s.createdAt).toISOString(),
  };
}

/**
 * Build the lightweight summary block returned alongside the snapshot list
 * (GET path). Aggregates avgOverallHealth + avgProjection30d across the
 * visible window plus actual-profit ground truth from the Trade table.
 */
function buildSummary(
  publicViews: SnapshotPublicView[],
  days: number,
  actualProfit: ActualProfitResult,
) {
  return {
    days,
    snapshotCount: publicViews.length,
    latestSnapshot: publicViews.length > 0 ? publicViews[publicViews.length - 1] : null,
    oldestSnapshot: publicViews.length > 0 ? publicViews[0] : null,
    avgOverallHealth:
      publicViews.length > 0
        ? Math.round(
            (publicViews.reduce((s, x) => s + x.overallHealth, 0) / publicViews.length) * 100,
          ) / 100
        : 0,
    avgProjection30d:
      publicViews.length > 0
        ? Math.round(
            (publicViews.reduce((s, x) => s + x.projection30dEUR, 0) / publicViews.length) * 100,
          ) / 100
        : 0,
    actualProfit30d: actualProfit.totalProfitEUR,
    actualProfitTradeCount: actualProfit.tradeCount,
  };
}

/**
 * Resolve SnapshotsInput from the incoming request — supports both GET
 * (query string `days`) and POST (optional body `{ force?: boolean }`).
 *
 * POST body parsing mirrors the original behavior: content-type must be
 * application/json, body is read via req.clone() (so the body stream stays
 * intact for any downstream consumer), and a non-boolean `force` field
 * falls through to the default (true). Body parse errors silently fall
 * through to defaults — POST is always valid.
 */
async function parseSnapshotsInput(req: NextRequest): Promise<SnapshotsInput> {
  const method = (req.method === 'POST' ? 'POST' : 'GET') as 'GET' | 'POST';
  const days = parseDays(req);

  let force = true;
  if (method === 'POST') {
    try {
      const ct = req.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const cloned = req.clone();
        const body = (await cloned.json()) as { force?: boolean };
        if (typeof body?.force === 'boolean') force = body.force;
      }
    } catch {
      // ignore body parse errors — fall through with force=true
    }
  }

  return { method, days, force };
}

// --- Shared handler (GET + POST) ------------------------------------------

const handler = withAiRoute<SnapshotsInput>({
  endpoint: '/api/ai/brain/snapshots',
  maxDuration: 60,
  enforceBudget: true, // v8.95.2-e: budget guard + avtomatski recordAiCall
  method: 'GET', // Endpoint sprejema GET + POST — bypass POST-only check

  parseBody: async (req: NextRequest) => parseSnapshotsInput(req),

  // Brez validateInput — vsi input-i imajo sensible defaults

  handler: async (input, ctx: AiRouteContext) => {
    const { logger } = ctx;

    // --- POST: manual snapshot trigger -------------------------------
    // saveDailySnapshot is idempotent (upserts today's row). `force` is
    // informational only — echoed back in the response shape.
    if (input.method === 'POST') {
      logger.info('/api/ai/brain/snapshots', 'manual snapshot trigger', {
        force: input.force,
      });

      const result = await saveDailySnapshot();

      return apiOk({
        ok: true,
        date: result.date,
        forced: input.force,
        snapshot: toPublicView(result.snapshot),
      });
    }

    // --- GET: fetch snapshots + actual profit in parallel ------------
    const [snapshots, actualProfit]: [BrainSnapshotRow[], ActualProfitResult] =
      await Promise.all([getSnapshots(input.days), calculateActualProfit(input.days)]);

    const publicViews = snapshots.map(toPublicView);
    const summary = buildSummary(publicViews, input.days, actualProfit);

    return apiOk({
      ok: true,
      days: input.days,
      snapshots: publicViews,
      actualProfit,
      summary,
    });
  },
});

export const GET = handler;
export const POST = handler;
