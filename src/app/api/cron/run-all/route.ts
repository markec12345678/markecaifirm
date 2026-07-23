import { NextRequest, NextResponse } from 'next/server';
import { runDueMonitors, maybeSendHeartbeat } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Run all due monitors + check if heartbeat should fire + check if digest should fire.
 * Designed to be called by an external cron every 5-10 minutes.
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

  const [monitorsResult, heartbeatResult] = await Promise.all([
    runDueMonitors(),
    maybeSendHeartbeat(),
  ]);

  // v1.6: Check digest (not in parallel with monitors because digest reads listings created by monitors)
  let digestResult = { sent: false, reason: 'not checked' };
  try {
    const digestRes = await fetch(`${req.nextUrl.origin}/api/digest`, {
      method: 'POST',
    });
    if (digestRes.ok) {
      digestResult = await digestRes.json();
    }
  } catch { /* ignore digest errors */ }

  return NextResponse.json({
    ran: monitorsResult.ran,
    skipped: monitorsResult.skipped,
    autoPaused: monitorsResult.autoPaused,
    results: monitorsResult.results,
    heartbeat: heartbeatResult,
    digest: digestResult,
    timestamp: new Date().toISOString(),
  });
}

export const POST = GET;
