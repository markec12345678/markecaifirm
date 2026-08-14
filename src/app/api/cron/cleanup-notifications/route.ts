// v8.38: Notification cleanup cron — deletes notifications older than 90 days.
//
// Schedule (example crontab — runs daily after cleanup-drafts):
//   30 2 * * * curl -s "http://localhost:3000/api/cron/cleanup-notifications?key=$MONITOR_CRON_KEY"
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset (dev mode), no auth required.
//
// GET /api/cron/cleanup-notifications?key=<MONITOR_CRON_KEY>
// POST /api/cron/cleanup-notifications?key=<MONITOR_CRON_KEY>  (same handler)
//
// Returns: { ok: true, deleted: N }
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { cleanupOldNotifications } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as cleanup-drafts, daily-brain-snapshot, etc.
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
  return handleCleanup(req);
}

export async function POST(req: NextRequest) {
  return handleCleanup(req);
}

async function handleCleanup(req: NextRequest) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/cleanup-notifications', 'starting notification cleanup (90-day cutoff)');

    const result = await cleanupOldNotifications(90);

    logger.info('/api/cron/cleanup-notifications', 'cleanup complete', {
      deleted: result.deleted,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/cron/cleanup-notifications', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
