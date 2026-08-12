// v8.23: Daily Brain Snapshot cron — calls Master Brain at 00:00 and stores
// result for historical accuracy tracking. Foundation for v8.25 (Historical Accuracy).
//
// Cron job @ 00:00 (configure externally — e.g. system cron, Vercel Cron, etc.)
// Calls masterBrain() and saves the FULL result to BrainSnapshot Prisma table.
//
// WHY THIS EXISTS:
//   - Until v8.23, the Brain architecture (v8.15-v8.22) made predictions
//     ("30d: 3133€") but had NO way to verify accuracy — predictions were
//     ephemeral (re-computed on each request, not stored).
//   - v8.23 stores each day's Master Brain output so that 30 days later we
//     can compare predicted vs ACTUAL profit (from Trade table).
//   - This is the "predicted" side of the accuracy equation.
//   - The "actual" side is computed by calculateActualProfit() in
//     src/lib/profit/actual.ts.
//
// IDEMPOTENT: if today's snapshot already exists, it's OVERWRITTEN with the
// latest Master Brain output (re-running the cron at 23:00 replaces the
// 00:00 morning run — we want the latest state of the day).
//
// Schedule: configure externally to hit this endpoint at 00:00 daily.
// Example crontab: 0 0 * * * curl -s "http://localhost:3000/api/cron/daily-brain-snapshot?key=$MONITOR_CRON_KEY"
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset, no auth required (dev mode).
//
// GET /api/cron/daily-brain-snapshot?key=<MONITOR_CRON_KEY>
// POST /api/cron/daily-brain-snapshot?key=<MONITOR_CRON_KEY>  (same handler)

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { saveDailySnapshot, type BrainSnapshotRow } from '@/lib/brain/snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as daily-pulse, weekly-report, etc.
 * If MONITOR_CRON_KEY env var is set, the request's `key` query param must
 * match. If env var is unset (dev mode), no auth required.
 */
function checkCronAuth(req: NextRequest): boolean {
  const expectedKey = process.env.MONITOR_CRON_KEY;
  if (!expectedKey) return true; // dev mode — no auth required
  try {
    const url = new URL(req.url);
    return url.searchParams.get('key') === expectedKey;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  return handleDailySnapshot(req);
}

export async function POST(req: NextRequest) {
  return handleDailySnapshot(req);
}

async function handleDailySnapshot(req: NextRequest) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/daily-brain-snapshot', 'starting daily brain snapshot save');

    const result = await saveDailySnapshot();
    const snapshot: BrainSnapshotRow = result.snapshot;

    logger.info('/api/cron/daily-brain-snapshot', `snapshot saved for ${result.date}`, {
      overallHealth: snapshot.overallHealth,
      healthGrade: snapshot.healthGrade,
      riskLevel: snapshot.riskLevel,
      projection30d: snapshot.projection30dEUR,
      topActionCount: snapshot.topActionCount,
      conflictCount: snapshot.conflictCount,
    });

    return NextResponse.json({
      ok: true,
      saved: true,
      date: result.date,
      snapshot: {
        id: snapshot.id,
        date: snapshot.date,
        overallHealth: snapshot.overallHealth,
        healthGrade: snapshot.healthGrade,
        riskLevel: snapshot.riskLevel,
        topActionCount: snapshot.topActionCount,
        conflictCount: snapshot.conflictCount,
        bottleneckCount: snapshot.bottleneckCount,
        strengthCount: snapshot.strengthCount,
        projection30dEUR: snapshot.projection30dEUR,
        projection90dEUR: snapshot.projection90dEUR,
        projection12mEUR: snapshot.projection12mEUR,
        profitGrade: snapshot.profitGrade,
        inventoryGrade: snapshot.inventoryGrade,
        marketGrade: snapshot.marketGrade,
        sourcingGrade: snapshot.sourcingGrade,
        riskGrade: snapshot.riskGrade,
        buyerGrade: snapshot.buyerGrade,
        pricingGrade: snapshot.pricingGrade,
        createdAt: snapshot.createdAt,
      },
    });
  } catch (err: any) {
    logger.error('/api/cron/daily-brain-snapshot', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
