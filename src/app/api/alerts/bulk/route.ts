import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/alerts/bulk
 * Body: { ids: string[], action: 'archive' | 'unarchive' | 'read' | 'delete' | 'scam' | 'interested' }
 *
 * Performs batch operations on multiple alerts at once.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  const action: string = body?.action;

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Manjkajo ids' }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: 'Maksimalno 500 alertov naenkrat' }, { status: 400 });
  }

  const validActions = ['archive', 'unarchive', 'read', 'unread', 'delete', 'scam', 'interested'];
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: `Neveljavna akcija: ${action}` }, { status: 400 });
  }

  try {
    let affected = 0;

    if (action === 'delete') {
      const result = await db.alert.deleteMany({ where: { id: { in: ids } } });
      affected = result.count;
    } else if (action === 'archive') {
      const result = await db.alert.updateMany({
        where: { id: { in: ids } },
        data: { isArchived: true, userAction: 'archived', userActionedAt: new Date() },
      });
      affected = result.count;
    } else if (action === 'unarchive') {
      const result = await db.alert.updateMany({
        where: { id: { in: ids } },
        data: { isArchived: false },
      });
      affected = result.count;
    } else if (action === 'read') {
      const result = await db.alert.updateMany({
        where: { id: { in: ids } },
        data: { isRead: true },
      });
      affected = result.count;
    } else if (action === 'unread') {
      const result = await db.alert.updateMany({
        where: { id: { in: ids } },
        data: { isRead: false },
      });
      affected = result.count;
    } else if (action === 'scam') {
      const result = await db.alert.updateMany({
        where: { id: { in: ids } },
        data: {
          isArchived: true,
          isRead: true,
          aiVerdict: 'SUMNJIVO',
          userAction: 'scam',
          userActionedAt: new Date(),
        },
      });
      affected = result.count;
    } else if (action === 'interested') {
      const result = await db.alert.updateMany({
        where: { id: { in: ids } },
        data: {
          isRead: true,
          userAction: 'interested',
          userActionedAt: new Date(),
        },
      });
      affected = result.count;
    }

    return NextResponse.json({ ok: true, action, affected });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka pri bulk operaciji' }, { status: 500 });
  }
}
