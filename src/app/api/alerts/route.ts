import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const archived = url.searchParams.get('archived') === '1';
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const monitorId = url.searchParams.get('monitorId');

  const where: any = { isArchived: archived };
  if (monitorId) where.monitorId = monitorId;

  const alerts = await db.alert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: { monitor: { select: { name: true, source: true } } },
  });
  return NextResponse.json(alerts);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isRead, isArchived } = body;
  if (!id) return NextResponse.json({ error: 'Manjka id' }, { status: 400 });
  const data: any = {};
  if (typeof isRead === 'boolean') data.isRead = isRead;
  if (typeof isArchived === 'boolean') data.isArchived = isArchived;
  const updated = await db.alert.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Manjka id' }, { status: 400 });
  await db.alert.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
