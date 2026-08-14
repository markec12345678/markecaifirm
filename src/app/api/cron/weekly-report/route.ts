// v8.41: Weekly Summary Report cron — sends comprehensive weekly digest to
// Telegram + Email + Notification Center.
//
// Replaces the v7.38 minimal weekly report (which was just Telegram/Discord
// text with basic stats). v8.41 calls sendWeeklySummary() which:
//   1. Aggregates this week's profit + MoM change + goal progress.
//   2. Top 3 trades + worst trade.
//   3. Brain health score (calls masterBrain v8.22).
//   4. Top 3 actionable insights (calls getTradeInsights v8.40).
//   5. Recommendations for next week (auto-generated Slovenian).
//   6. Sends to Telegram (plain text) + Email (HTML) + Notification Center.
//
// Schedule (example crontab):
//   0 9 * * 1 curl -s "http://localhost:3000/api/cron/weekly-report?key=$MONITOR_CRON_KEY"
//
// Runs every Monday at 09:00 (morning review of last week's performance).
//
// Auth: ?key=<MONITOR_CRON_KEY> query param (same as other cron endpoints).
// If MONITOR_CRON_KEY env var is unset (dev mode), no auth required.
//
// GET /api/cron/weekly-report?key=<MONITOR_CRON_KEY>
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { sendWeeklySummary } from '@/lib/brain/weekly-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Check cron auth — same pattern as auto-pilot, brain-digest, etc.
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
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.info('/api/cron/weekly-report', 'starting v8.41 weekly summary send');

    const result = await sendWeeklySummary();

    logger.info('/api/cron/weekly-report', 'weekly summary complete', result);

    return NextResponse.json({
      ok: result.ok,
      sentTelegram: result.sentTelegram,
      sentEmail: result.sentEmail,
      error: result.error ?? null,
      timestamp: new Date().toISOString(),
      source: 'v8.41-weekly-summary-cron',
    });
  } catch (err: any) {
    logger.error('/api/cron/weekly-report', 'GET handler failed', err);
    return NextResponse.json(
      { error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
