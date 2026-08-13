// v8.25: Backfill accuracy cron — fills actualProfit30d/90d + accuracy30d/90d
// for BrainSnapshots that are old enough to have actual data (>= 30/90 days old).
// Should run daily after the daily-snapshot cron (so today's snapshot exists).
//
// This is the CULMINATION of the Validation phase:
//   v8.23 = DAILY SNAPSHOTS (predictions stored) + ACTUAL PROFIT TRACKER (ground truth)
//   v8.24 = USER RISK PROFILE (personalization)
//   v8.25 = HISTORICAL ACCURACY (closes the loop — predicted vs actual = accuracy %)
//
// WHY THIS EXISTS:
//   - v8.23 stores each day's Master Brain output (projection30dEUR) but leaves
//     actualProfit30d/90d + accuracy30d/90d as NULL — they can't be filled until
//     30/90 days have passed (we need to wait for the trades to actually happen).
//   - v8.25 backfill job runs daily, looks at snapshots whose date + 30d <= today
//     (i.e. enough time has passed) and WHERE actualProfit30d is still null, then
//     computes the actual EUR profit from the Trade table and writes
//     accuracy30d = (actual / predicted) × 100.
//   - This is the FINAL piece: once accuracy30d is populated, the UI "📈 Master
//     Brain Accuracy & Trend" card can show "89% (zadnjih 30 dni)".
//
// IDEMPOTENT: a snapshot is only backfilled if its actualProfit* field is null.
// Re-running the cron on an already-backfilled snapshot is a no-op (just a SELECT).
//
// Schedule: configure externally to hit this endpoint at 01:00 daily (1 hour AFTER
// the daily-brain-snapshot cron which runs at 00:00 — ensures today's snapshot
// exists before backfill runs).
// Example crontab: 0 1 * * * curl -s "http://localhost:3000/api/cron/backfill-accuracy?key=$MONITOR_CRON_KEY"
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset, no auth required (dev mode).
//
// GET /api/cron/backfill-accuracy?key=<MONITOR_CRON_KEY>
// POST /api/cron/backfill-accuracy?key=<MONITOR_CRON_KEY>  (same handler)

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { backfillSnapshotAccuracy } from '@/lib/brain/snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as daily-brain-snapshot, daily-pulse, etc.
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
  return handleBackfill(req);
}

export async function POST(req: NextRequest) {
  return handleBackfill(req);
}

async function handleBackfill(req: NextRequest) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/backfill-accuracy', 'starting accuracy backfill');

    const result = await backfillSnapshotAccuracy();

    logger.info('/api/cron/backfill-accuracy', 'backfill complete', {
      totalSnapshots: result.totalSnapshots,
      backfilled30d: result.backfilled30d,
      backfilled90d: result.backfilled90d,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/cron/backfill-accuracy', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
