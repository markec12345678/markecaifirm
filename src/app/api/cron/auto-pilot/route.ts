// v8.30: Auto-pilot hourly cron — triggers runSafeAutoPilot().
//
// Schedule (example crontab):
//   0 * * * * curl -s "http://localhost:3000/api/cron/auto-pilot?key=$MONITOR_CRON_KEY"
//
// Runs every hour. Each run:
// 1. Loads auto-pilot config from Settings (early-return if disabled)
// 2. Loads user risk tolerance (skip if conservative)
// 3. Fetches all pending ActionDraft rows
// 4. For each, checks the 8 safety rules via checkAutoPilotEligibility()
// 5. Auto-executes eligible ones (sets autoExecuted=true + autoPilotReason)
// 6. Updates Settings.autoPilotLastRunAt = now
//
// Returns the AutoPilotRunResult for audit logging.
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset (dev mode), no auth required.
//
// GET /api/cron/auto-pilot?key=<MONITOR_CRON_KEY>
// POST /api/cron/auto-pilot?key=<MONITOR_CRON_KEY>  (same handler)
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60.

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { runSafeAutoPilot } from '@/lib/brain/auto-pilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as daily-brain-snapshot, cleanup-drafts, etc.
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
  return handleAutoPilotRun(req);
}

export async function POST(req: NextRequest) {
  return handleAutoPilotRun(req);
}

async function handleAutoPilotRun(req: NextRequest) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/auto-pilot', 'starting hourly auto-pilot run');

    const result = await runSafeAutoPilot();

    logger.info('/api/cron/auto-pilot', 'auto-pilot run complete', {
      enabled: result.config.enabled,
      checked: result.checked,
      autoExecuted: result.autoExecuted,
      skipped: result.skipped,
      todayCount: result.todayStats.autoExecuted,
      todayBudget: result.todayStats.budgetUsed,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/cron/auto-pilot', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
