/**
 * Unified notification dispatcher — replaces 3× duplicated notification logic in pipeline.ts.
 *
 * Handles: Telegram, Discord, Slack, Push, Email, Webhooks
 * Respects: quiet hours, monitor-specific channels, delivery tracking
 */

import { sendTelegramMessage, buildAlertInlineButtons, type AlertMessageOptions } from './telegram';
import { sendDiscordMessage, buildAlertEmbed } from './discord';
import { sendSlackMessage, buildAlertSlackBlocks } from './slack';
import { sendSmartPush, sendImmediatePush, type Priority } from './smart-push';
import { sendEmail, formatAlertEmail } from './email';
import { triggerWebhooks } from './webhook-engine';
import { getAppUrl } from './app-url';

/** Settings needed for notification dispatch. */
export interface NotificationSettings {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  telegramInlineButtons: boolean;
  discordEnabled: boolean;
  discordWebhookUrl: string;
  slackEnabled: boolean;
  slackWebhookUrl: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpUser: string;
  emailSmtpPassword: string;
  emailFrom: string;
  emailTo: string;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
}

/** Monitor-specific channel overrides. */
export interface MonitorChannels {
  telegram?: boolean;
  discord?: boolean;
  slack?: boolean;
  push?: boolean;
}

/** Alert data for dispatch. */
export interface AlertDispatchData {
  alertId: string;
  monitorId: string;
  monitorName: string;
  listingId: string;
  title: string;
  priceText: string;
  url: string;
  location?: string;
  aiScore?: number | null;
  aiRisk?: number | null;
  aiVerdict?: string | null;
  aiReason?: string | null;
  estimatedValue?: number | null;
  imageAnalysis?: string | null;
  imageUrl?: string | null;
  alertBody: string;
}

/** Delivery tracking result. */
export interface DeliveryResult {
  sentTelegram?: boolean;
  telegramSentAt?: Date | null;
  telegramError?: string | null;
  sentDiscord?: boolean;
  discordError?: string | null;
  sentSlack?: boolean;
  slackError?: string | null;
  sentPush?: boolean;
  pushError?: string | null;
  sentEmail?: boolean;
  emailError?: string | null;
  alertsSentCount: number;
}

/** Check if current time is within quiet hours. */
function isInQuietHours(start: number, end: number): boolean {
  const hour = new Date().getHours();
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** Parse monitor-specific channel overrides from JSON. */
export function parseMonitorChannels(channelsJson: string): MonitorChannels | null {
  try {
    const parsed = JSON.parse(channelsJson || '{}');
    if (Object.keys(parsed).length === 0) return null;
    return {
      telegram: parsed.telegram ?? true,
      discord: parsed.discord ?? true,
      slack: parsed.slack ?? true,
      push: parsed.push ?? true,
    };
  } catch {
    return null;
  }
}

/**
 * Dispatch alert notifications to all enabled channels.
 * Returns delivery tracking data for DB update.
 */
export async function dispatchAlert(
  settings: NotificationSettings,
  monitorChannelsJson: string | null,
  data: AlertDispatchData,
  priority: Priority = 'medium',
): Promise<DeliveryResult> {
  const result: DeliveryResult = { alertsSentCount: 0 };

  // Check quiet hours
  if (settings.quietHoursEnabled && isInQuietHours(settings.quietStartHour, settings.quietEndHour)) {
    return result;
  }

  const channels = monitorChannelsJson ? parseMonitorChannels(monitorChannelsJson) : null;
  const useTelegram = channels ? (channels.telegram ?? true) : settings.telegramEnabled;
  const useDiscord = channels ? (channels.discord ?? true) : settings.discordEnabled;
  const useSlack = channels ? (channels.slack ?? true) : settings.slackEnabled;
  const usePush = channels ? (channels.push ?? true) : settings.pushEnabled;
  const useEmail = settings.emailEnabled;

  // Telegram
  if (useTelegram && settings.telegramBotToken && settings.telegramChatId) {
    try {
      const inlineButtons = settings.telegramInlineButtons
        ? buildAlertInlineButtons({ alertId: data.alertId, listingUrl: data.url, dashboardUrl: getAppUrl() + '/alerts' })
        : undefined;
      const tg = await sendTelegramMessage(
        { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
        data.alertBody,
        { inlineButtons }
      );
      result.sentTelegram = tg.ok;
      result.telegramSentAt = tg.ok ? new Date() : null;
      result.telegramError = tg.ok ? null : tg.error;
      if (tg.ok) result.alertsSentCount++;
    } catch { /* non-critical */ }
  }

  // Discord
  if (useDiscord && settings.discordWebhookUrl) {
    try {
      const embed = buildAlertEmbed({
        monitorName: data.monitorName,
        title: data.title,
        priceText: data.priceText,
        url: data.url,
        location: data.location,
        aiScore: data.aiScore,
        aiRisk: data.aiRisk,
        aiVerdict: data.aiVerdict,
        aiReason: data.aiReason,
        estimatedValue: data.estimatedValue,
        imageAnalysis: data.imageAnalysis,
        imageUrl: data.imageUrl,
      });
      const dc = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
      result.sentDiscord = dc.ok;
      result.discordError = dc.ok ? null : dc.error;
      if (dc.ok && result.alertsSentCount === 0) result.alertsSentCount++;
    } catch { /* non-critical */ }
  }

  // Slack
  if (useSlack && settings.slackWebhookUrl) {
    try {
      const blocks = buildAlertSlackBlocks({
        title: data.title,
        priceText: data.priceText,
        url: data.url,
        monitorName: data.monitorName,
        aiScore: data.aiScore,
        aiRisk: data.aiRisk,
        aiVerdict: data.aiVerdict,
        aiReason: data.aiReason,
        estimatedValue: data.estimatedValue,
      });
      const sl = await sendSlackMessage(
        { webhookUrl: settings.slackWebhookUrl },
        `${data.aiVerdict === 'PRILIKA' ? '🎯' : '•'} ${data.title}`,
        blocks
      );
      result.sentSlack = sl.ok;
      result.slackError = sl.ok ? null : sl.error;
      if (sl.ok && result.alertsSentCount === 0) result.alertsSentCount++;
    } catch { /* non-critical */ }
  }

  // Push — smart batching or immediate for critical
  if (usePush) {
    try {
      const isHighPriority = priority === 'critical' || priority === 'high';
      if (isHighPriority) {
        const icon = data.aiVerdict === 'PRILIKA' ? '🎯' : data.aiVerdict === 'SUMNJIVO' ? '⚠️' : '•';
        await sendImmediatePush({
          title: `${icon} ${data.title.slice(0, 60)}`,
          body: `${data.priceText} • ${data.monitorName}${data.aiScore != null ? ` (prilika ${data.aiScore}/10)` : ''}`,
          url: '/alerts',
          priority,
        });
      } else {
        await sendSmartPush();
      }
      result.sentPush = true;
    } catch (e: any) {
      result.pushError = (e?.message ?? 'push error').slice(0, 200);
    }
  }

  // Email
  if (useEmail && settings.emailSmtpHost && settings.emailTo) {
    try {
      const html = formatAlertEmail({
        title: data.title,
        priceText: data.priceText,
        url: data.url,
        monitorName: data.monitorName,
        aiScore: data.aiScore,
        aiRisk: data.aiRisk,
        aiVerdict: data.aiVerdict,
        aiReason: data.aiReason,
        estimatedValue: data.estimatedValue,
      });
      const em = await sendEmail(
        {
          smtpHost: settings.emailSmtpHost,
          smtpPort: settings.emailSmtpPort,
          smtpUser: settings.emailSmtpUser,
          smtpPassword: settings.emailSmtpPassword,
          from: settings.emailFrom,
          to: settings.emailTo,
        },
        `${data.aiVerdict === 'PRILIKA' ? '🎯' : '•'} ${data.title.slice(0, 60)}`,
        html
      );
      result.sentEmail = em.ok;
      result.emailError = em.ok ? null : em.error;
    } catch { /* non-critical */ }
  }

  return result;
}

/**
 * Trigger webhook events for an alert.
 * Non-critical — failures don't affect the pipeline.
 */
export async function triggerAlertWebhooks(
  event: 'alert.created' | 'price.drop' | 'target.hit',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await triggerWebhooks(event, payload);
  } catch { /* webhook failures are non-critical */ }
}
