// v8.38: Per-notification API — single-notification operations.
//
// PATCH /api/brain-notifications/[id] { isRead: true } → markAsRead(id)
// DELETE /api/brain-notifications/[id]                  → deleteNotification(id)
//
// runtime='nodejs', dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { markAsRead, deleteNotification } from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ===== PATCH: mark as read =================================================

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    // Currently only `isRead: true` is supported (mark as read). If `isRead:
    // false` is passed (mark as unread), we return 400 — unread-marking is not
    // currently supported (would require clearing readAt + isRead=false).
    if (body?.isRead !== true) {
      return NextResponse.json(
        { ok: false, error: 'Only { isRead: true } is currently supported' },
        { status: 400 },
      );
    }

    await markAsRead(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logger.error('/api/brain-notifications/[id]', 'PATCH handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// ===== DELETE: delete single ===============================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    await deleteNotification(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logger.error('/api/brain-notifications/[id]', 'DELETE handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
