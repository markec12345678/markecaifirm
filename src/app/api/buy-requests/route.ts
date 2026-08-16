// v8.71: Buy Requests CRUD — saved item searches
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const requests = await db.buyRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ ok: true, requests });
  } catch (err) {
    logger.error('/api/buy-requests', 'GET failed', err);
    return NextResponse.json({ ok: false, error: 'Napaka' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ ok: false, error: 'Manjka title' }, { status: 400 });
    }
    const created = await db.buyRequest.create({
      data: {
        searchFor: String(body.searchFor ?? ''),
        title: String(body.title).trim(),
        keywords: String(body.keywords ?? ''),
        category: String(body.category ?? ''),
        priceMin: body.priceMin ? parseInt(body.priceMin, 10) : null,
        priceMax: body.priceMax ? parseInt(body.priceMax, 10) : null,
        location: String(body.location ?? ''),
        yearMin: body.yearMin ? parseInt(body.yearMin, 10) : null,
        yearMax: body.yearMax ? parseInt(body.yearMax, 10) : null,
        condition: String(body.condition ?? ''),
        sortBy: String(body.sortBy ?? 'cheapest'),
        notes: String(body.notes ?? ''),
        isActive: body.isActive !== false,
      },
    });
    return NextResponse.json({ ok: true, request: created }, { status: 201 });
  } catch (err) {
    logger.error('/api/buy-requests', 'POST failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
