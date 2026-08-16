// v8.71: Buy Request by ID — update + delete
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: any = {};
    if (typeof body.title === 'string') data.title = body.title;
    if (typeof body.searchFor === 'string') data.searchFor = body.searchFor;
    if (typeof body.keywords === 'string') data.keywords = body.keywords;
    if (typeof body.category === 'string') data.category = body.category;
    if (body.priceMin != null) data.priceMin = parseInt(body.priceMin, 10);
    if (body.priceMax != null) data.priceMax = parseInt(body.priceMax, 10);
    if (typeof body.location === 'string') data.location = body.location;
    if (body.yearMin != null) data.yearMin = parseInt(body.yearMin, 10);
    if (body.yearMax != null) data.yearMax = parseInt(body.yearMax, 10);
    if (typeof body.condition === 'string') data.condition = body.condition;
    if (typeof body.sortBy === 'string') data.sortBy = body.sortBy;
    if (typeof body.notes === 'string') data.notes = body.notes;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

    const updated = await db.buyRequest.update({ where: { id }, data });
    return NextResponse.json({ ok: true, request: updated });
  } catch (err) {
    logger.error('/api/buy-requests/[id]', 'PUT failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.buyRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('/api/buy-requests/[id]', 'DELETE failed', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
