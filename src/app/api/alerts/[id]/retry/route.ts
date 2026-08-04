import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage, formatAlertMessage, buildAlertInlineButtons } from '@/lib/telegram';
import { sendDiscordMessage, buildAlertEmbed } from '@/lib/discord';
import { sendSlackMessage, buildAlertSlackBlocks } from '@/lib/slack';
import { sendPushNotification } from '@/lib/push';
import { sendEmail, formatAlertEmail } from '@/lib/email';
import { getAppUrl } from '@/lib/app-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/alerts/:id/retry
 * Re-sends an alert to all enabled channels.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const alert = await db.alert.findUnique({
    where: { id },
    include: { monitor: { select: { name: true } }, listing: { select: { url: true, imageUrl: true, priceText: true, location: true } } },
  });
  if (!alert) return NextResponse.json({ error: 'Alert ne obstaja' }, { status: 404 });

  const settings = await getSettingsRow();
  const results: any = { telegram: null, discord: null, slack: null, push: null, email: null };

  // Telegram
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    const inlineButtons = settings.telegramInlineButtons
      ? buildAlertInlineButtons({ alertId: alert.id, listingUrl: alert.url, dashboardUrl: getAppUrl() + '/alerts' })
      : undefined;
    const tg = await sendTelegramMessage(
      { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
      alert.body, { inlineButtons }
    );
    results.telegram = tg.ok ? 'success' : tg.error;
    await db.alert.update({ where: { id }, data: { sentTelegram: tg.ok, telegramError: tg.ok ? null : tg.error, telegramSentAt: tg.ok ? new Date() : null } });
  }

  // Discord
  if (settings.discordEnabled && settings.discordWebhookUrl) {
    const embed = buildAlertEmbed({
      monitorName: alert.monitor.name, title: alert.title, priceText: alert.listing?.priceText ?? '',
      url: alert.url, aiScore: alert.aiScore, aiRisk: alert.aiRisk, aiVerdict: alert.aiVerdict,
    });
    const dc = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
    results.discord = dc.ok ? 'success' : dc.error;
    await db.alert.update({ where: { id }, data: { sentDiscord: dc.ok, discordError: dc.ok ? null : dc.error } });
  }

  // Slack
  if (settings.slackEnabled && settings.slackWebhookUrl) {
    const blocks = buildAlertSlackBlocks({
      title: alert.title, priceText: alert.listing?.priceText ?? '', url: alert.url,
      monitorName: alert.monitor.name, aiScore: alert.aiScore, aiRisk: alert.aiRisk, aiVerdict: alert.aiVerdict,
    });
    const sl = await sendSlackMessage({ webhookUrl: settings.slackWebhookUrl }, `🎯 ${alert.title}`, blocks);
    results.slack = sl.ok ? 'success' : sl.error;
    await db.alert.update({ where: { id }, data: { sentSlack: sl.ok, slackError: sl.ok ? null : sl.error } });
  }

  // Push
  if (settings.pushEnabled) {
    const push = await sendPushNotification({ title: `🎯 ${alert.title.slice(0, 60)}`, body: alert.listing?.priceText ?? '', url: '/alerts' });
    results.push = push.sent > 0 ? 'success' : (push.errors[0] ?? 'no devices');
    await db.alert.update({ where: { id }, data: { sentPush: push.sent > 0, pushError: push.sent > 0 ? null : (push.errors[0] ?? null) } });
  }

  // Email
  if (settings.emailEnabled && settings.emailSmtpHost && settings.emailTo) {
    const html = formatAlertEmail({
      title: alert.title, priceText: alert.listing?.priceText ?? '', url: alert.url,
      monitorName: alert.monitor.name, aiScore: alert.aiScore, aiRisk: alert.aiRisk, aiVerdict: alert.aiVerdict,
    });
    const em = await sendEmail(
      { smtpHost: settings.emailSmtpHost, smtpPort: settings.emailSmtpPort, smtpUser: settings.emailSmtpUser,
        smtpPassword: settings.emailSmtpPassword, from: settings.emailFrom, to: settings.emailTo },
      `🎯 ${alert.title.slice(0, 60)}`, html
    );
    results.email = em.ok ? 'success' : em.error;
    await db.alert.update({ where: { id }, data: { sentEmail: em.ok, emailError: em.ok ? null : em.error } });
  }

  return NextResponse.json({ ok: true, results });
}
