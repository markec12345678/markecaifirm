// v8.25: Manual backfill trigger — POST calls backfillSnapshotAccuracy().
//
// For testing/debugging — same as /api/cron/backfill-accuracy but WITHOUT auth
// (it's under /api/ai/... which is the user-facing API surface). The cron
// endpoint requires MONITOR_CRON_KEY; this one doesn't (manual trigger from UI).
//
// POST /api/ai/brain/accuracy/backfill
// → { ok, backfilled30d, backfilled90d, totalSnapshots }
//
// runtime='nodejs', dynamic='force-dynamic'.

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { backfillSnapshotAccuracy } from '@/lib/brain/snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    logger.info('/api/ai/brain/accuracy/backfill', 'manual backfill trigger');

    const result = await backfillSnapshotAccuracy();

    logger.info('/api/ai/brain/accuracy/backfill', 'backfill complete', {
      totalSnapshots: result.totalSnapshots,
      backfilled30d: result.backfilled30d,
      backfilled90d: result.backfilled90d,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/ai/brain/accuracy/backfill', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// Also support GET for easy browser/curl testing
export async function GET() {
  return POST();
}
