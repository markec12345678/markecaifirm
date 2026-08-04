import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications
 * Returns notification delivery history with filtering.
 *
 * Query params:
 *   channel — telegram | discord | slack | email | push
 *   status  — success | error
 *   limit   — default 50, max 200
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const channel = url.searchParams.get('channel') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

    const alerts = await db.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { monitor: { select: { name: true } } },
    });

    // Build notification records from alert delivery fields
    const notifications: Array<{
      alertId: string;
      title: string;
      monitorName: string;
      createdAt: string;
      channel: string;
      success: boolean;
      error: string | null;
      url: string;
    }> = [];

    for (const a of alerts) {
      const channels = [
        { name: 'telegram', sent: a.sentTelegram, error: a.telegramError },
        { name: 'discord', sent: a.sentDiscord, error: a.discordError },
        { name: 'slack', sent: a.sentSlack, error: a.slackError },
        { name: 'email', sent: a.sentEmail, error: a.emailError },
        { name: 'push', sent: a.sentPush, error: a.pushError },
      ];
      for (const ch of channels) {
        // Only include if the channel was attempted (sent=true or has error)
        if (ch.sent || ch.error) {
          if (channel && ch.name !== channel) continue;
          if (status === 'success' && !ch.sent) continue;
          if (status === 'error' && ch.sent) continue;
          notifications.push({
            alertId: a.id,
            title: a.title,
            monitorName: a.monitor.name,
            createdAt: a.createdAt.toISOString(),
            channel: ch.name,
            success: ch.sent,
            error: ch.error,
            url: a.url,
          });
        }
      }
    }

    // Stats
    const stats = {
      total: notifications.length,
      success: notifications.filter(n => n.success).length,
      error: notifications.filter(n => !n.success).length,
      byChannel: {
        telegram: notifications.filter(n => n.channel === 'telegram').length,
        discord: notifications.filter(n => n.channel === 'discord').length,
        slack: notifications.filter(n => n.channel === 'slack').length,
        email: notifications.filter(n => n.channel === 'email').length,
        push: notifications.filter(n => n.channel === 'push').length,
      },
    };

    return NextResponse.json({ notifications, stats });

  } catch (err) {
    logger.error("/api/notifications", "GET handler failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Napaka' }, { status: 500 });
  }
}
