import { NextRequest, NextResponse } from 'next/server';
import { runDueMonitors, maybeSendHeartbeat } from '@/lib/pipeline';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Run all due monitors + check if heartbeat should fire + check if digest should fire.
 * Designed to be called by an external cron every 5-10 minutes.
 */
export async function GET(req: NextRequest) {
  try {
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

    // v2.2: Auto-cleanup old data
    let cleanupResult = { skipped: true, reason: 'not checked' };
    try {
      const cleanupRes = await fetch(`${req.nextUrl.origin}/api/cleanup`, {
        method: 'POST',
      });
      if (cleanupRes.ok) {
        cleanupResult = await cleanupRes.json();
      }
    } catch { /* ignore cleanup errors */ }

    // v7.36: Smart Deal Alert — push TOP 3 deals to Telegram/Discord/Push
    const cronKey = new URL(req.url).searchParams.get('key') || '';
    let dealAlertResult = { skipped: true, reason: 'not checked' };
    try {
      const dealAlertRes = await fetch(`${req.nextUrl.origin}/api/cron/smart-deal-alert?key=${cronKey}`);
      if (dealAlertRes.ok) {
        dealAlertResult = await dealAlertRes.json();
      }
    } catch { /* ignore deal alert errors */ }

    // v7.36: Inventory Aging Alert — warn about items held too long
    let agingAlertResult = { skipped: true, reason: 'not checked' };
    try {
      const agingRes = await fetch(`${req.nextUrl.origin}/api/cron/inventory-aging-alert?key=${cronKey}`);
      if (agingRes.ok) {
        agingAlertResult = await agingRes.json();
      }
    } catch { /* ignore aging alert errors */ }

    // v8.76: Run BuyRequest auto-monitor — check saved searches for new matches
    let buyRequestResult = { skipped: true, reason: 'not checked' };
    try {
      const buyReqRes = await fetch(`${req.nextUrl.origin}/api/cron/run-buy-requests?key=${cronKey}`);
      if (buyReqRes.ok) {
        buyRequestResult = await buyReqRes.json();
      }
    } catch { /* ignore buy request errors */ }

    return NextResponse.json({
      ran: monitorsResult.ran,
      skipped: monitorsResult.skipped,
      autoPaused: monitorsResult.autoPaused,
      results: monitorsResult.results,
      heartbeat: heartbeatResult,
      digest: digestResult,
      cleanup: cleanupResult,
      dealAlert: dealAlertResult,
      agingAlert: agingAlertResult,
      buyRequests: buyRequestResult,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    logger.error("/api/cron/run-all", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export const POST = GET;
