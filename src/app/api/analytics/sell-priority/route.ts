// v8.65: Sell Priority API — returns held trades ranked by sell urgency
import { NextResponse } from 'next/server';
import { getSellPriorityForHeldTrades } from '@/lib/trades/sell-priority';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const result = await getSellPriorityForHeldTrades();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
