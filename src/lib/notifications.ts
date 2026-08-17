// v8.38: Notification Center — centralizirana zgodovina vseh obvestil.
// Pure compute + DB module. Used by Brain system (telegram-notifications.ts),
// auto-pilot.ts, cron jobs, and UI Notification Center.
//
// 8 supported notification types:
//   - brain_digest      — daily Master Brain digest (cron @ 08:00)
//   - autopilot_executed — auto-pilot executed a draft
//   - autopilot_rollback — user rolled back an auto-execution
//   - anomaly           — auto-pilot suspended due to anomaly detection
//   - price_drop         — listing price dropped (future use)
//   - system            — generic system event (manual/cron)
//   - trade_sold         — a trade was marked sold (future use)
//   - error              — system error (future use)
//
// 4 severities: info | success | warning | error
// 5 sources:    brain | autopilot | telegram | system | manual
//
// DESIGN: every Brain system event creates a Notification record (regardless of
// whether Telegram is configured). This ensures the user always has a central
// historical view in the UI — even if Telegram is not set up.

import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';

export type NotificationType =
  | 'brain_digest'
  | 'autopilot_executed'
  | 'autopilot_rollback'
  | 'anomaly'
  | 'price_drop'
  | 'system'
  | 'trade_sold'
  | 'error'
  | 'buy_request_match';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  source: string;
  isRead: boolean;
  readAt: Date | null;
  draftId: string | null;
  snapshotDate: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  source?: string;
  draftId?: string;
  snapshotDate?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationQuery {
  type?: NotificationType;
  severity?: NotificationSeverity;
  isRead?: boolean;
  limit?: number;
  days?: number;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

/**
 * v8.38: Use a FRESH PrismaClient per call (same pattern as v8.28
 * adaptive-weights.ts + v8.29 draft-queue.ts + v8.30 auto-pilot.ts). The
 * standard `db` from @/lib/db caches a single PrismaClient in
 * `globalThis.prisma` for the lifetime of the dev server process — fine for
 * production but problematic in dev when the schema changes mid-run.
 * SCHEMA_VERSION in db.ts SHOULD discard the stale client, but Turbopack's
 * module-caching can still hold a reference to the OLD @prisma/client module
 * (which doesn't know about the new Notification model). Creating a fresh
 * PrismaClient each call guarantees we always use the latest generated client.
 *
 * PrismaClient internally pools connections, so this is still cheap.
 */
function getFreshDb(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn'],
  });
}

/**
 * Create a notification record.
 * Returns the created Notification row.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ ok: true; notification: Notification }> {
  const db = getFreshDb();
  try {
    const notification = await db.notification.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body,
        severity: input.severity ?? 'info',
        source: input.source ?? 'system',
        draftId: input.draftId ?? null,
        snapshotDate: input.snapshotDate ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
    return { ok: true, notification: notification as unknown as Notification };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Get notifications with optional filters.
 *
 * Default: last 30 days, up to 50 records, sorted by createdAt DESC.
 * Returns notifications + aggregate stats (total, unread, byType, bySeverity).
 *
 * Stats are computed over the SAME filtered window (NOT the entire DB) so
 * the UI badge can show "12 total · 3 unread · 5 brain_digest" relative to
 * the current filter view.
 */
export async function getNotifications(
  query: NotificationQuery = {},
): Promise<{ ok: true; notifications: Notification[]; stats: NotificationStats }> {
  const db = getFreshDb();
  try {
    const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
    const days = Math.max(1, Math.min(query.days ?? 30, 365));

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: {
      createdAt: { gte: Date };
      type?: string;
      severity?: string;
      isRead?: boolean;
    } = {
      createdAt: { gte: since },
    };
    if (query.type) where.type = query.type;
    if (query.severity) where.severity = query.severity;
    if (query.isRead !== undefined) where.isRead = query.isRead;

    const [notifications, total, unread, byTypeRaw, bySeverityRaw] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      db.notification.count({ where }),
      db.notification.count({ where: { ...where, isRead: false } }),
      db.notification.groupBy({ by: ['type'], _count: true, where }),
      db.notification.groupBy({ by: ['severity'], _count: true, where }),
    ]);

    const byType: Record<string, number> = {};
    byTypeRaw.forEach((t: { type: string; _count: number }) => {
      byType[t.type] = t._count;
    });

    const bySeverity: Record<string, number> = {};
    bySeverityRaw.forEach((s: { severity: string; _count: number }) => {
      bySeverity[s.severity] = s._count;
    });

    return {
      ok: true,
      notifications: notifications as unknown as Notification[],
      stats: { total, unread, byType, bySeverity },
    };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Get unread count only (for bell badge in the UI).
 * Counts ALL unread notifications (no time window).
 */
export async function getUnreadCount(): Promise<number> {
  const db = getFreshDb();
  try {
    return await db.notification.count({ where: { isRead: false } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Mark a single notification as read.
 * Sets isRead=true and readAt=now().
 */
export async function markAsRead(id: string): Promise<{ ok: true }> {
  const db = getFreshDb();
  try {
    await db.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Mark all unread notifications as read.
 * Returns the count of updated records.
 */
export async function markAllAsRead(): Promise<{ ok: true; updated: number }> {
  const db = getFreshDb();
  try {
    const result = await db.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true, updated: result.count };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Delete a single notification by id.
 */
export async function deleteNotification(id: string): Promise<{ ok: true }> {
  const db = getFreshDb();
  try {
    await db.notification.delete({ where: { id } });
    return { ok: true };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Delete all READ notifications (manual cleanup button in UI).
 * Unread notifications are preserved.
 */
export async function deleteReadNotifications(): Promise<{ ok: true; deleted: number }> {
  const db = getFreshDb();
  try {
    const result = await db.notification.deleteMany({ where: { isRead: true } });
    return { ok: true, deleted: result.count };
  } finally {
    await db.$disconnect();
  }
}

/**
 * Delete old notifications (cleanup — call from cron).
 * Default cutoff: 90 days. Returns deleted count.
 */
export async function cleanupOldNotifications(
  daysOld: number = 90,
): Promise<{ ok: true; deleted: number }> {
  const db = getFreshDb();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const result = await db.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    logger.info('cleanupOldNotifications', `deleted ${result.count} notifications older than ${daysOld} days`);
    return { ok: true, deleted: result.count };
  } finally {
    await db.$disconnect();
  }
}
