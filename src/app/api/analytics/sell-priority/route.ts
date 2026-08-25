// v8.65: Sell Priority API — returns held trades ranked by sell urgency
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getSellPriorityForHeldTrades } from '@/lib/trades/sell-priority';
import { withCache } from '@/lib/analytics-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const result = await withCache('sell-priority', 60_000, () => getSellPriorityForHeldTrades());
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/analytics/sell-priority', 'GET failed', err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
