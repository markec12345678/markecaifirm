// v8.67: Trade Outcome Scorecard API — batch summary or single ?tradeId=xxx
import { NextRequest, NextResponse } from 'next/server';
import { getOutcomeSummary, getOutcomeForTrade } from '@/lib/trades/outcome-score';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tradeId = url.searchParams.get('tradeId');
    if (tradeId) {
      const result = await getOutcomeForTrade(tradeId);
      if (!result) {
        return NextResponse.json({ ok: false, error: 'Trade ne obstaja ali ni prodan' }, { status: 404 });
      }
      return NextResponse.json(result);
    }
    const summary = await getOutcomeSummary();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
