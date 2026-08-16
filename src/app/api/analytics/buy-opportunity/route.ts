// v8.68: Buy Opportunity Score API — single ?listingId=xxx or batch (top N)
import { NextRequest, NextResponse } from 'next/server';
import { getBuyOpportunityForListing, getTopBuyOpportunities } from '@/lib/trades/buy-opportunity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const listingId = url.searchParams.get('listingId');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (listingId) {
      const result = await getBuyOpportunityForListing(listingId);
      if (!result) {
        return NextResponse.json({ ok: false, error: 'Listing ne obstaja' }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const list = await getTopBuyOpportunities(Math.min(limit, 50));
    return NextResponse.json(list);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
