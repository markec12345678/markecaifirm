// v8.38: Notification Center API.
//
// PATH NOTE: This endpoint is at /api/brain-notifications (NOT /api/notifications)
// because /api/notifications already exists (v4.8 — Alert-based delivery history
// for Monitor/Listing alerts, used by notification-history-view.tsx and
// alerts-view.tsx). The Brain notification model is semantically different
// (Brain system events vs Monitor/Listing alert delivery) so a separate path
// avoids breaking the existing endpoint.
//
// GET: ?type=brain_digest&severity=error&isRead=false&limit=50&days=30
//   → { ok, notifications, stats: { total, unread, byType, bySeverity } }
//
// POST: { type, title, body, severity?, source?, draftId?, snapshotDate?, metadata? }
//   → { ok, notification } — create new notification (manual/cron use)
//
// PATCH: bulk actions on the collection:
//   { action: 'mark_read', id: <id> }     — mark single as read (convenience — also /api/brain-notifications/[id] PATCH)
//   { action: 'mark_all_read' }           — mark ALL unread as read
//   { action: 'delete_read' }             — delete all read notifications (cleanup)
//
// runtime='nodejs', dynamic='force-dynamic', maxDuration=30

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  createNotification,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteReadNotifications,
  type NotificationType,
  type NotificationSeverity,
} from '@/lib/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const VALID_TYPES: NotificationType[] = [
  'brain_digest',
  'autopilot_executed',
  'autopilot_rollback',
  'anomaly',
  'price_drop',
  'system',
  'trade_sold',
  'error',
];

const VALID_SEVERITIES: NotificationSeverity[] = ['info', 'success', 'warning', 'error'];

function parseType(value: string | null): NotificationType | undefined {
  if (!value) return undefined;
  if (VALID_TYPES.includes(value as NotificationType)) {
    return value as NotificationType;
  }
  return undefined;
}

function parseSeverity(value: string | null): NotificationSeverity | undefined {
  if (!value) return undefined;
  if (VALID_SEVERITIES.includes(value as NotificationSeverity)) {
    return value as NotificationSeverity;
  }
  return undefined;
}

function parseIsRead(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

// ===== GET: list + filter ===================================================

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = parseType(url.searchParams.get('type'));
    const severity = parseSeverity(url.searchParams.get('severity'));
    const isRead = parseIsRead(url.searchParams.get('isRead'));
    const limit = url.searchParams.has('limit')
      ? Math.max(1, Math.min(parseInt(url.searchParams.get('limit')!, 10) || 50, 200))
      : undefined;
    const days = url.searchParams.has('days')
      ? Math.max(1, Math.min(parseInt(url.searchParams.get('days')!, 10) || 30, 365))
      : undefined;

    const result = await getNotifications({ type, severity, isRead, limit, days });
    return NextResponse.json(result);
  } catch (err: any) {
    logger.error('/api/brain-notifications', 'GET handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// ===== POST: create =========================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { type, title, body: notifBody, severity, source, draftId, snapshotDate, metadata } = body ?? {};

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { ok: false, error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 });
    }
    if (!notifBody || typeof notifBody !== 'string') {
      return NextResponse.json({ ok: false, error: 'body is required' }, { status: 400 });
    }
    if (severity && !VALID_SEVERITIES.includes(severity)) {
      return NextResponse.json(
        { ok: false, error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` },
        { status: 400 },
      );
    }

    const result = await createNotification({
      type,
      title: title.trim(),
      body: notifBody,
      severity: severity ?? 'info',
      source: source ?? 'manual',
      draftId: draftId ?? undefined,
      snapshotDate: snapshotDate ?? undefined,
      metadata: metadata ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    logger.error('/api/brain-notifications', 'POST handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}

// ===== PATCH: bulk actions ==================================================

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, id } = body ?? {};

    if (action === 'mark_read') {
      if (!id || typeof id !== 'string') {
        return NextResponse.json(
          { ok: false, error: 'id is required for mark_read action' },
          { status: 400 },
        );
      }
      await markAsRead(id);
      return NextResponse.json({ ok: true });
    }

    if (action === 'mark_all_read') {
      const result = await markAllAsRead();
      return NextResponse.json(result);
    }

    if (action === 'delete_read') {
      const result = await deleteReadNotifications();
      return NextResponse.json(result);
    }

    return NextResponse.json(
      {
        ok: false,
        error: `Unknown action. Must be one of: mark_read, mark_all_read, delete_read`,
      },
      { status: 400 },
    );
  } catch (err: any) {
    logger.error('/api/brain-notifications', 'PATCH handler failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka' },
      { status: 500 },
    );
  }
}
