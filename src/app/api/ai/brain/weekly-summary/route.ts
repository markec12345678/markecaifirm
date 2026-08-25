// v8.41: Weekly Summary Report API — comprehensive weekly digest.
// GET  → returns last generated weekly summary (without sending).
// POST { action: 'send' } → sends summary to Telegram + Email + Notification Center.
//
// Used by:
//   - Dashboard WeeklySummaryCard (GET to preview, POST to send)
//   - Manual trigger via API runner
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=60

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  generateWeeklySummary,
  sendWeeklySummary,
} from '@/lib/brain/weekly-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/ai/brain/weekly-summary
 * Returns the weekly summary WITHOUT sending to any channel.
 * Used by the Dashboard card to preview last week's summary.
 */
export async function GET() {
  try {
    const summary = await generateWeeklySummary();
    logger.info(
      '/api/ai/brain/weekly-summary',
      `generated summary for ${summary.period.start} → ${summary.period.end} (profit=${summary.profit.thisWeek}, sold=${summary.trades.soldThisWeek})`,
    );
    return NextResponse.json(summary);
  } catch (err: any) {
    logger.error('/api/ai/brain/weekly-summary', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/ai/brain/weekly-summary { action: 'send' }
 * Sends weekly summary to Telegram + Email + Notification Center.
 * Returns { ok, sentTelegram, sentEmail }.
 *
 * If neither Telegram nor Email is configured, returns
 * { ok: true, sentTelegram: false, sentEmail: false } — the summary
 * was still generated + recorded in Notification Center.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action !== 'send') {
      return NextResponse.json(
        { error: `Unknown action: '${action}'. Use { action: 'send' }.` },
        { status: 400 },
      );
    }

    const result = await sendWeeklySummary();
    logger.info('/api/ai/brain/weekly-summary', 'POST send result', result);

    return NextResponse.json({
      ok: result.ok,
      sentTelegram: result.sentTelegram,
      sentEmail: result.sentEmail,
      error: result.error ?? null,
    });
  } catch (err: any) {
    logger.error('/api/ai/brain/weekly-summary', 'POST handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
