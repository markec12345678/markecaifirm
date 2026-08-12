// v8.23: Brain Snapshots API — fetch historical Master Brain snapshots + actual profit.
//
// GET: returns last N days of snapshots + actual profit calculation.
//      Query params: ?days=30 (default 30)
//      Returns: { ok, snapshots, actualProfit, summary }
//
// POST: triggers a new snapshot save (manual). Useful for testing or when
//       the user wants to capture the current Master Brain state immediately.
//       Body: { force?: boolean } — force re-save today's snapshot (default true
//       since saveDailySnapshot is idempotent anyway)
//       Returns: { ok, date, snapshot }
//
// Foundation for v8.25 (Historical Accuracy) — snapshots store BOTH:
//   - Predicted (now, at creation): projection30dEUR, projection90dEUR
//   - Actual (filled 30d/90d later by accuracy backfill cron): actualProfit30d, accuracy30d
//
// Together with /api/ai/brain/actual-profit (ground truth from Trade table),
// this enables historical accuracy measurement: predicted vs actual.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  saveDailySnapshot,
  getSnapshots,
  type BrainSnapshotRow,
} from '@/lib/brain/snapshots';
import { calculateActualProfit, type ActualProfitResult } from '@/lib/profit/actual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// --- GET handler -----------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const days = parseDays(req);

    // Fetch snapshots + actual profit in parallel
    const [snapshots, actualProfit]: [BrainSnapshotRow[], ActualProfitResult] =
      await Promise.all([getSnapshots(days), calculateActualProfit(days)]);

    const publicViews = snapshots.map(toPublicView);

    // Build a lightweight summary block for the UI
    const summary = {
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

    return NextResponse.json({
      ok: true,
      days,
      snapshots: publicViews,
      actualProfit,
      summary,
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/snapshots', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// --- POST handler (manual trigger) -----------------------------------------

export async function POST(req: NextRequest) {
  try {
    // Parse body — accept { force?: boolean }. force is informational only
    // since saveDailySnapshot is idempotent (always upserts today's row).
    let force = true;
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

    logger.info('/api/ai/brain/snapshots', 'manual snapshot trigger', { force });

    const result = await saveDailySnapshot();
    const snapshot = result.snapshot;

    return NextResponse.json({
      ok: true,
      date: result.date,
      forced: force,
      snapshot: toPublicView(snapshot),
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/snapshots', 'POST handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

