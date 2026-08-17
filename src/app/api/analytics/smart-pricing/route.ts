// v8.66: Smart Pricing API — batch (all held) or single (?tradeId=xxx)
import { NextRequest, NextResponse } from 'next/server';
import { getSmartPriceForTrade, getSmartPricesForAllHeld } from '@/lib/trades/smart-pricing';
import { withCache } from '@/lib/analytics-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tradeId = url.searchParams.get('tradeId');
    if (tradeId) {
      const result = await withCache(`smart-price:${tradeId}`, 60_000, () => getSmartPriceForTrade(tradeId));
      if (!result) {
        return NextResponse.json({ ok: false, error: 'Trade ne obstaja' }, { status: 404 });
      }
      return NextResponse.json(result);
    }
    const list = await withCache('smart-prices-all', 60_000, () => getSmartPricesForAllHeld());
    return NextResponse.json(list);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
