// v8.35: Daily Brain Digest cron — sends Master Brain TOP 5 to Telegram.
//
// Schedule (example crontab):
//   0 8 * * * curl -s "http://localhost:3000/api/cron/brain-digest?key=$MONITOR_CRON_KEY"
//
// Runs daily at 08:00 (morning review). Each run:
//   1. Loads Telegram config from Settings (early-return if not configured)
//   2. Computes fresh Master Brain result (no cache — digest must reflect
//      latest state, including any auto-pilot executions from overnight)
//   3. Formats digest: 🧠 header + health score + strategy projections +
//      TOP 5 actions + one-line summary + conflicts count
//   4. Sends to Telegram chat (plain text — no Markdown escaping issues)
//
// If Telegram is not configured or disabled, returns { sent: false, reason: ... }
// silently — the cron job is non-fatal in that case.
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset (dev mode), no auth required.
//
// GET /api/cron/brain-digest?key=<MONITOR_CRON_KEY>
// POST /api/cron/brain-digest?key=<MONITOR_CRON_KEY>  (same handler)
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { sendBrainDigest } from '@/lib/brain/telegram-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as auto-pilot, cleanup-drafts, etc.
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
  return handleBrainDigest(req);
}

export async function POST(req: NextRequest) {
  return handleBrainDigest(req);
}

async function handleBrainDigest(req: NextRequest) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/brain-digest', 'starting daily Brain digest');

    const result = await sendBrainDigest();

    logger.info('/api/cron/brain-digest', 'digest complete', result);

    return NextResponse.json({
      ok: true,
      sent: result.sent,
      reason: result.reason ?? null,
      timestamp: new Date().toISOString(),
      source: 'v8.35-brain-digest-cron',
    });
  } catch (err: any) {
    logger.error('/api/cron/brain-digest', 'handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
