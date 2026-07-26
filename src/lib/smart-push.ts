// v5.3: Smart Push — AI priority + smart batching for push notifications
// Groups alerts within a time window and sends a single batched notification
// instead of spamming multiple notifications

import { db } from './db';
import { sendPushNotification } from './push';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

interface PriorityAlert {
  id: string;
  title: string;
  body: string;
  url?: string;
  priority: Priority;
  category?: string; // e.g., 'price_drop', 'new_listing', 'ai_prilika'
  aiScore?: number;
  dealScore?: number;
  timestamp: Date;
}

interface BatchedNotification {
  title: string;
  body: string;
  url: string;
  priority: Priority;
  alertCount: number;
  categories: string[];
}

const PRIORITY_LABELS: Record<Priority, { icon: string; label: string; color: string }> = {
  critical: { icon: '🔥', label: 'KRITIČNO', color: '#ef4444' },
  high: { icon: '🎯', label: 'VISOKA', color: '#10b981' },
  medium: { icon: '📊', label: 'SREDNJA', color: '#f59e0b' },
  low: { icon: 'ℹ️', label: 'NIZKA', color: '#737373' },
};

const BATCH_WINDOW_MS = 60_000; // 1 minute batch window
const MAX_BATCH_SIZE = 5; // max alerts in one notification

/**
 * Calculate AI priority for an alert based on its content.
 * Returns priority level.
 */
export function calculatePriority(alert: {
  aiVerdict?: string | null;
  aiScore?: number | null;
  aiRisk?: number | null;
  dealScore?: number | null;
  priceDroppedAt?: Date | null;
  targetPriceHit?: boolean;
  isBookmarked?: boolean;
}): Priority {
  // Critical: target price hit on bookmarked listing
  if (alert.targetPriceHit && alert.isBookmarked) return 'critical';

  // Critical: PRILIKA with high AI score AND high deal score
  if (alert.aiVerdict === 'PRILIKA' && (alert.aiScore ?? 0) >= 8 && (alert.dealScore ?? 0) >= 80) {
    return 'critical';
  }

  // High: PRILIKA with good scores
  if (alert.aiVerdict === 'PRILIKA' && (alert.aiScore ?? 0) >= 7) {
    return 'high';
  }

  // High: price drop on bookmarked
  if (alert.priceDroppedAt && alert.isBookmarked) {
    return 'high';
  }

  // High: deal score >= 70
  if ((alert.dealScore ?? 0) >= 70) {
    return 'high';
  }

  // Medium: PRILIKA or price drop
  if (alert.aiVerdict === 'PRILIKA' || alert.priceDroppedAt) {
    return 'medium';
  }

  // Medium: deal score >= 50
  if ((alert.dealScore ?? 0) >= 50) {
    return 'medium';
  }

  // Low: everything else
  return 'low';
}

/**
 * Batch multiple alerts into a single notification.
 * Groups by priority and category within the time window.
 */
export function batchAlerts(alerts: PriorityAlert[]): BatchedNotification | null {
  if (alerts.length === 0) return null;

  // Sort by priority (critical first) then by timestamp
  const priorityOrder: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...alerts].sort((a, b) => {
    const p = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (p !== 0) return p;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  // Take top alerts (max MAX_BATCH_SIZE)
  const top = sorted.slice(0, MAX_BATCH_SIZE);
  const topPriority = top[0].priority;
  const priorityCfg = PRIORITY_LABELS[topPriority];

  // Collect categories
  const categories = Array.from(new Set(top.map(a => a.category).filter(Boolean))) as string[];

  if (top.length === 1) {
    // Single alert — send as-is
    return {
      title: `${priorityCfg.icon} ${top[0].title}`,
      body: top[0].body,
      url: top[0].url || '/alerts',
      priority: topPriority,
      alertCount: 1,
      categories,
    };
  }

  // Multiple alerts — batch into one notification
  const alertCount = alerts.length; // total, not just top
  const title = `${priorityCfg.icon} ${alertCount} novih alertov`;
  const bodyLines = top.map(a => {
    const score = a.dealScore ? ` [🎯${a.dealScore}]` : '';
    return `• ${a.title.slice(0, 50)}${score}`;
  });
  if (alertCount > top.length) {
    bodyLines.push(`... in ${alertCount - top.length} več`);
  }
  return {
    title,
    body: bodyLines.join('\n'),
    url: '/alerts',
    priority: topPriority,
    alertCount,
    categories,
  };
}

/**
 * Get pending alerts from the last batch window that haven't been sent yet.
 * Returns alerts created within the last BATCH_WINDOW_MS.
 */
export async function getPendingAlertsForBatch(): Promise<PriorityAlert[]> {
  const since = new Date(Date.now() - BATCH_WINDOW_MS);
  const alerts = await db.alert.findMany({
    where: {
      createdAt: { gte: since },
      sentPush: false,
      isArchived: false,
    },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          price: true,
          priceText: true,
          aiVerdict: true,
          aiScore: true,
          aiRisk: true,
          dealScore: true,
          isBookmarked: true,
          targetPrice: true,
          priceDroppedAt: true,
        },
      },
      monitor: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return alerts.map(a => {
    const listing = a.listing;
    const targetPriceHit = listing?.targetPrice != null && listing?.price != null && listing.price <= listing.targetPrice;
    const priority = calculatePriority({
      aiVerdict: a.aiVerdict ?? listing?.aiVerdict,
      aiScore: a.aiScore ?? listing?.aiScore,
      aiRisk: a.aiRisk ?? listing?.aiRisk,
      dealScore: listing?.dealScore,
      priceDroppedAt: listing?.priceDroppedAt,
      targetPriceHit,
      isBookmarked: listing?.isBookmarked,
    });

    let category = 'new_listing';
    if (targetPriceHit) category = 'target_price';
    else if (listing?.priceDroppedAt) category = 'price_drop';
    else if (a.aiVerdict === 'PRILIKA') category = 'ai_prilika';
    else if (a.aiVerdict === 'SUMNJIVO') category = 'ai_sumnjivo';

    return {
      id: a.id,
      title: a.title,
      body: a.body.slice(0, 200),
      url: '/alerts',
      priority,
      category,
      aiScore: a.aiScore ?? undefined,
      dealScore: listing?.dealScore ?? undefined,
      timestamp: a.createdAt,
    } as PriorityAlert;
  });
}

/**
 * Smart push: collect pending alerts, batch them, send a single notification.
 * Marks alerts as sent after successful push.
 */
export async function sendSmartPush(): Promise<{
  ok: boolean;
  sent: number;
  alertCount: number;
  batched: boolean;
  priority: Priority | null;
  error?: string;
}> {
  const pending = await getPendingAlertsForBatch();
  if (pending.length === 0) {
    return { ok: true, sent: 0, alertCount: 0, batched: false, priority: null };
  }

  const batch = batchAlerts(pending);
  if (!batch) {
    return { ok: true, sent: 0, alertCount: 0, batched: false, priority: null };
  }

  const result = await sendPushNotification({
    title: batch.title,
    body: batch.body,
    url: batch.url,
  });

  if (result.sent > 0) {
    // Mark all pending alerts as push-sent
    await db.alert.updateMany({
      where: { id: { in: pending.map(a => a.id) } },
      data: { sentPush: true },
    });
  }

  return {
    ok: result.sent > 0,
    sent: result.sent,
    alertCount: batch.alertCount,
    batched: batch.alertCount > 1,
    priority: batch.priority,
    error: result.errors[0],
  };
}

/**
 * Send an immediate high-priority push (bypasses batching).
 * Use for critical alerts that need instant notification.
 */
export async function sendImmediatePush(alert: {
  title: string;
  body: string;
  url?: string;
  priority: Priority;
}): Promise<{ ok: boolean; sent: number; error?: string }> {
  const cfg = PRIORITY_LABELS[alert.priority];
  const result = await sendPushNotification({
    title: `${cfg.icon} ${alert.title}`,
    body: alert.body,
    url: alert.url || '/alerts',
  });
  return {
    ok: result.sent > 0,
    sent: result.sent,
    error: result.errors[0],
  };
}
