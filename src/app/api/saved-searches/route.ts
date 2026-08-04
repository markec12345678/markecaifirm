// v6.1: Saved Searches API — CRUD za shranjene iskalne filtrore
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const searches = await db.savedSearch.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json({
      searches: searches.map(s => ({ ...s, filters: JSON.parse(s.filters) })),
    });

  } catch (err) {
    logger.error("/api/saved-searches", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, filters, autoNotify } = body;
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Ime je obvezno' }, { status: 400 });
    }
    if (!filters || typeof filters !== 'object') {
      return NextResponse.json({ error: 'Filters so obvezni' }, { status: 400 });
    }
    const search = await db.savedSearch.create({
      data: {
        name: name.trim(),
        filters: JSON.stringify(filters),
        autoNotify: autoNotify === true,
      },
    });
    return NextResponse.json({ ok: true, search: { ...search, filters: JSON.parse(search.filters) } });
  } catch (e: any) {
    logger.error("/api/saved-searches", "POST handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, filters, autoNotify } = body;
    if (!id) return NextResponse.json({ error: 'ID je obvezen' }, { status: 400 });
    const data: any = {};
    if (typeof name === 'string') data.name = name.trim();
    if (filters && typeof filters === 'object') data.filters = JSON.stringify(filters);
    if (typeof autoNotify === 'boolean') data.autoNotify = autoNotify;
    const updated = await db.savedSearch.update({ where: { id }, data });
    return NextResponse.json({ ok: true, search: { ...updated, filters: JSON.parse(updated.filters) } });
  } catch (e: any) {
    logger.error("/api/saved-searches", "PATCH handler failed", e);
    return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID je obvezen' }, { status: 400 });
    try {
      await db.savedSearch.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Napaka' }, { status: 500 });
    }

  } catch (err) {
    logger.error("/api/saved-searches", "DELETE handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
