// v4.8: Notifications Center — centralni pregled in re-send notifikacij
// GET /api/notifications/center — vrne zadnje notifikacije s delivery statusom
// POST /api/notifications/center — re-send notifikacijo na določen kanal
//   Body: { alertId: string, channels: ['telegram', 'discord', 'slack', 'push', 'email'] }

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage, buildAlertInlineButtons, formatAlertMessage } from '@/lib/telegram';
import { sendDiscordMessage, buildAlertEmbed } from '@/lib/discord';
import { sendPushNotification } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ===== GET: List recent notifications with delivery status =====
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));
  const channel = url.searchParams.get('channel'); // filter by channel
  const status = url.searchParams.get('status'); // 'sent' | 'failed' | 'pending'

  const alerts = await db.alert.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      monitor: { select: { name: true, source: true } },
      listing: { select: { id: true, title: true, url: true, priceText: true, aiVerdict: true } },
    },
  });

  // Build notification records (one alert = up to 5 channel records)
  const records: any[] = [];
  for (const a of alerts) {
    const channels = [
      { key: 'telegram', sent: a.sentTelegram, error: a.telegramError, sentAt: a.telegramSentAt },
      { key: 'discord', sent: a.sentDiscord, error: a.discordError, sentAt: null },
      { key: 'slack', sent: a.sentSlack, error: a.slackError, sentAt: null },
      { key: 'push', sent: a.sentPush, error: null, sentAt: null },
      { key: 'email', sent: a.sentEmail, error: null, sentAt: null },
    ];
    for (const ch of channels) {
      const status = ch.sent ? 'sent' : (ch.error ? 'failed' : 'pending');
      records.push({
        alertId: a.id,
        alertTitle: a.title,
        alertUrl: a.url,
        aiVerdict: a.aiVerdict,
        monitorName: a.monitor?.name,
        monitorSource: a.monitor?.source,
        listingTitle: a.listing?.title,
        listingUrl: a.listing?.url,
        channel: ch.key,
        status,
        error: ch.error,
        sentAt: ch.sentAt ?? a.createdAt,
        createdAt: a.createdAt,
      });
    }
  }

  // Apply filters
  let filtered = records;
  if (channel && channel !== 'all') {
    filtered = filtered.filter(r => r.channel === channel);
  }
  if (status && status !== 'all') {
    filtered = filtered.filter(r => r.status === status);
  }

  // Stats
  const stats = {
    total: records.length,
    sent: records.filter(r => r.status === 'sent').length,
    failed: records.filter(r => r.status === 'failed').length,
    pending: records.filter(r => r.status === 'pending').length,
    byChannel: {
      telegram: { sent: records.filter(r => r.channel === 'telegram' && r.status === 'sent').length, failed: records.filter(r => r.channel === 'telegram' && r.status === 'failed').length, pending: records.filter(r => r.channel === 'telegram' && r.status === 'pending').length },
      discord: { sent: records.filter(r => r.channel === 'discord' && r.status === 'sent').length, failed: records.filter(r => r.channel === 'discord' && r.status === 'failed').length, pending: records.filter(r => r.channel === 'discord' && r.status === 'pending').length },
      slack: { sent: records.filter(r => r.channel === 'slack' && r.status === 'sent').length, failed: records.filter(r => r.channel === 'slack' && r.status === 'failed').length, pending: records.filter(r => r.channel === 'slack' && r.status === 'pending').length },
      push: { sent: records.filter(r => r.channel === 'push' && r.status === 'sent').length, failed: records.filter(r => r.channel === 'push' && r.status === 'failed').length, pending: records.filter(r => r.channel === 'push' && r.status === 'pending').length },
      email: { sent: records.filter(r => r.channel === 'email' && r.status === 'sent').length, failed: records.filter(r => r.channel === 'email' && r.status === 'failed').length, pending: records.filter(r => r.channel === 'email' && r.status === 'pending').length },
    },
  };

  return NextResponse.json({
    notifications: filtered.slice(0, limit),
    stats,
    total: filtered.length,
    offset,
    limit,
  });
}

// ===== POST: Re-send notification to specified channels =====
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { alertId, channels } = body;

    if (!alertId) {
      return NextResponse.json({ error: 'alertId je obvezen' }, { status: 400 });
    }

    const validChannels = ['telegram', 'discord', 'slack', 'push', 'email'];
    const targetChannels = (channels || []).filter((c: string) => validChannels.includes(c));

    if (targetChannels.length === 0) {
      return NextResponse.json({ error: 'Navedi vsaj en veljaven kanal' }, { status: 400 });
    }

    const alert = await db.alert.findUnique({
      where: { id: alertId },
      include: {
        monitor: { select: { name: true } },
        listing: { select: { title: true, url: true, priceText: true, aiVerdict: true, aiScore: true, aiRisk: true, aiReason: true, aiEstimatedValue: true } },
      },
    });

    if (!alert) {
      return NextResponse.json({ error: 'Alert ne obstaja' }, { status: 404 });
    }

    const settings = await getSettingsRow();
    const results: any = {};

    // Re-build alert body from listing if available
    const alertBody = formatAlertMessage({
      monitorName: alert.monitor?.name ?? '',
      title: alert.title,
      priceText: alert.listing?.priceText ?? '',
      url: alert.url,
      aiScore: alert.listing?.aiScore ?? null,
      aiRisk: alert.listing?.aiRisk ?? null,
      aiVerdict: alert.listing?.aiVerdict ?? alert.aiVerdict,
      aiReason: alert.listing?.aiReason ?? '',
      estimatedValue: alert.listing?.aiEstimatedValue ?? null,
    });

    // Telegram
    if (targetChannels.includes('telegram')) {
      if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
        try {
          const inlineButtons = settings.telegramInlineButtons
            ? buildAlertInlineButtons({ alertId: alert.id, listingUrl: alert.url, dashboardUrl: 'http://localhost:3000/alerts' })
            : undefined;
          await sendTelegramMessage(
            { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
            alertBody,
            { inlineButtons }
          );
          results.telegram = { ok: true };
          await db.alert.update({
            where: { id: alert.id },
            data: { sentTelegram: true, telegramSentAt: new Date(), telegramError: null },
          });
        } catch (e: any) {
          results.telegram = { ok: false, error: e?.message };
          await db.alert.update({
            where: { id: alert.id },
            data: { telegramError: e?.message ?? 'Telegram error' },
          });
        }
      } else {
        results.telegram = { ok: false, error: 'Telegram ni konfiguriran' };
      }
    }

    // Discord
    if (targetChannels.includes('discord')) {
      if (settings.discordEnabled && settings.discordWebhookUrl) {
        try {
          const embed = buildAlertEmbed({
            monitorName: alert.monitor?.name ?? '',
            title: alert.title,
            priceText: alert.listing?.priceText ?? '',
            url: alert.url,
            aiVerdict: alert.listing?.aiVerdict ?? alert.aiVerdict,
            aiReason: alert.listing?.aiReason ?? '',
            aiScore: alert.listing?.aiScore ?? null,
            aiRisk: alert.listing?.aiRisk ?? null,
          });
          await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
          results.discord = { ok: true };
          await db.alert.update({
            where: { id: alert.id },
            data: { sentDiscord: true, discordError: null },
          });
        } catch (e: any) {
          results.discord = { ok: false, error: e?.message };
          await db.alert.update({
            where: { id: alert.id },
            data: { discordError: e?.message ?? 'Discord error' },
          });
        }
      } else {
        results.discord = { ok: false, error: 'Discord ni konfiguriran' };
      }
    }

    // Slack
    if (targetChannels.includes('slack')) {
      if (settings.slackEnabled && settings.slackWebhookUrl) {
        try {
          const { sendSlackMessage } = await import('@/lib/slack');
          await sendSlackMessage({ webhookUrl: settings.slackWebhookUrl }, alertBody);
          results.slack = { ok: true };
          await db.alert.update({
            where: { id: alert.id },
            data: { sentSlack: true, slackError: null },
          });
        } catch (e: any) {
          results.slack = { ok: false, error: e?.message };
          await db.alert.update({
            where: { id: alert.id },
            data: { slackError: e?.message ?? 'Slack error' },
          });
        }
      } else {
        results.slack = { ok: false, error: 'Slack ni konfiguriran' };
      }
    }

    // Push
    if (targetChannels.includes('push')) {
      if (settings.pushEnabled) {
        try {
          await sendPushNotification({
            title: alert.title.slice(0, 100),
            body: alertBody.slice(0, 200),
            url: '/alerts',
          });
          results.push = { ok: true };
          await db.alert.update({
            where: { id: alert.id },
            data: { sentPush: true },
          });
        } catch (e: any) {
          results.push = { ok: false, error: e?.message };
        }
      } else {
        results.push = { ok: false, error: 'Push ni konfiguriran' };
      }
    }

    // Email
    if (targetChannels.includes('email')) {
      if (settings.emailEnabled && settings.emailSmtpHost && settings.emailTo) {
        try {
          const { sendEmail } = await import('@/lib/email');
          // Convert plain text body to simple HTML
          const html = `<div style="font-family: monospace; padding: 16px;">${alertBody.replace(/\n/g, '<br>')}</div>`;
          await sendEmail({
            smtpHost: settings.emailSmtpHost,
            smtpPort: settings.emailSmtpPort,
            smtpUser: settings.emailSmtpUser,
            smtpPassword: settings.emailSmtpPassword,
            from: settings.emailFrom,
            to: settings.emailTo,
          }, alert.title, html);
          results.email = { ok: true };
          await db.alert.update({
            where: { id: alert.id },
            data: { sentEmail: true },
          });
        } catch (e: any) {
          results.email = { ok: false, error: e?.message };
          await db.alert.update({
            where: { id: alert.id },
            data: { slackError: e?.message ?? 'Email error' },
          });
        }
      } else {
        results.email = { ok: false, error: 'Email ni konfiguriran' };
      }
    }

    const successCount = Object.values(results).filter((r: any) => r.ok).length;
    const failCount = targetChannels.length - successCount;

    return NextResponse.json({
      ok: true,
      results,
      successCount,
      failCount,
      message: `Poslano: ${successCount}/${targetChannels.length} kanalov`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Napaka pri ponovnem pošiljanju' }, { status: 500 });
  }
}
