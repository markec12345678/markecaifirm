import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const archived = url.searchParams.get('archived') === '1';
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const monitorId = url.searchParams.get('monitorId');
  const format = url.searchParams.get('format') ?? 'json';

  const where: any = { isArchived: archived };
  if (monitorId) where.monitorId = monitorId;

  const alerts = await db.alert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 1000),
    include: { monitor: { select: { name: true, source: true } } },
  });

  if (format === 'csv') {
    const csv = alertsToCsv(alerts);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="alerts-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return NextResponse.json(alerts);
}

function alertsToCsv(alerts: any[]): string {
  const headers = [
    'createdAt', 'monitor', 'title', 'url', 'aiScore', 'aiRisk', 'aiVerdict',
    'sentTelegram', 'isRead', 'isArchived', 'userAction', 'userActionedAt',
  ];
  const rows = alerts.map(a => [
    a.createdAt?.toISOString() ?? '',
    csvEscape(a.monitor?.name ?? ''),
    csvEscape(a.title ?? ''),
    csvEscape(a.url ?? ''),
    a.aiScore ?? '',
    a.aiRisk ?? '',
    a.aiVerdict ?? '',
    a.sentTelegram ? '1' : '0',
    a.isRead ? '1' : '0',
    a.isArchived ? '1' : '0',
    a.userAction ?? '',
    a.userActionedAt?.toISOString() ?? '',
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function csvEscape(s: string): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, isRead, isArchived, userAction } = body;
  if (!id) return NextResponse.json({ error: 'Manjka id' }, { status: 400 });
  const data: any = {};
  if (typeof isRead === 'boolean') data.isRead = isRead;
  if (typeof isArchived === 'boolean') data.isArchived = isArchived;
  // v1.2: user feedback tracking
  if (typeof userAction === 'string') {
    const valid = ['interested', 'archived', 'scam', 'ignored'];
    if (!valid.includes(userAction)) {
      return NextResponse.json({ error: `Neveljaven userAction: ${userAction}` }, { status: 400 });
    }
    data.userAction = userAction;
    data.userActionedAt = new Date();
  }
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
