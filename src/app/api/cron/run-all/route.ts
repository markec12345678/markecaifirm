import { NextRequest, NextResponse } from 'next/server';
import { runDueMonitors } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Run all due monitors. Designed to be called by an external cron
 * (e.g. Windows Task Scheduler hitting this URL every 5-10 minutes).
 *
 * Optional: ?key=SECRET — if MONITOR_CRON_KEY env is set, request must match.
 */
export async function GET(req: NextRequest) {
  const expectedKey = process.env.MONITOR_CRON_KEY;
  if (expectedKey) {
    const url = new URL(req.url);
    const providedKey = url.searchParams.get('key');
    if (providedKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const result = await runDueMonitors();
  return NextResponse.json({
    ran: result.ran,
    results: result.results,
    timestamp: new Date().toISOString(),
  });
}

export const POST = GET;
