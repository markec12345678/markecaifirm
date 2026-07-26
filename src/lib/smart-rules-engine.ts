// v5.3: Smart Rules Engine — evaluates rules and triggers alerts
// Called from pipeline after each monitor run, or manually via API

import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage, formatAlertMessage } from '@/lib/telegram';
import { sendDiscordMessage, buildAlertEmbed } from '@/lib/discord';
import { sendPushNotification } from '@/lib/push';

interface RuleConfig {
  monitorId?: string;
  priceBelow?: number;
  minDealScore?: number;
  count?: number;
  withinHours?: number;
  dropPct?: number;
  minAiScore?: number;
  maxAiRisk?: number;
  hoursOld?: number;
}

interface SmartRule {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  config: string;
  channels: string;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  triggerCount: number;
}

export interface TriggeredRule {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  matchedCount: number;
  listings: Array<{ id: string; title: string; price: number | null; url: string }>;
  message: string;
}

/**
 * Check all active smart rules and trigger alerts for matches.
 * Returns array of triggered rules with details.
 */
export async function checkSmartRules(): Promise<TriggeredRule[]> {
  const rules = await db.smartRule.findMany({ where: { isActive: true } });
  if (rules.length === 0) return [];

  const triggered: TriggeredRule[] = [];

  for (const rule of rules) {
    try {
      const config: RuleConfig = JSON.parse(rule.config);
      const channels: string[] = JSON.parse(rule.channels);
      const result = await evaluateRule(rule, config);

      if (result && result.matchedCount > 0) {
        triggered.push(result);

        // Update rule tracking
        await db.smartRule.update({
          where: { id: rule.id },
          data: {
            lastTriggeredAt: new Date(),
            triggerCount: { increment: 1 },
          },
        });

        // Send notifications
        if (channels.length > 0) {
          await sendNotifications(rule, result, channels);
        }
      }
    } catch (e) {
      console.error(`Smart rule ${rule.id} error:`, e);
    }
  }

  return triggered;
}

async function evaluateRule(rule: SmartRule, config: RuleConfig): Promise<TriggeredRule | null> {
  const where: any = { isHidden: false };

  // Apply monitor filter
  if (config.monitorId) {
    where.monitorId = config.monitorId;
  }

  switch (rule.ruleType) {
    case 'price_threshold': {
      // Alert when listing price <= priceBelow AND dealScore >= minDealScore
      if (config.priceBelow == null) return null;
      where.price = { lte: config.priceBelow };
      if (config.minDealScore != null) {
        where.dealScore = { gte: config.minDealScore };
      }
      // Only trigger for listings seen in last 24h
      where.firstSeenAt = { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
      const listings = await db.listing.findMany({
        where,
        select: { id: true, title: true, price: true, url: true },
        take: 10,
      });
      if (listings.length === 0) return null;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matchedCount: listings.length,
        listings,
        message: `🎯 ${listings.length} oglasov pod ${config.priceBelow}€${config.minDealScore ? ` z deal score ≥ ${config.minDealScore}` : ''}`,
      };
    }

    case 'multiple_listings': {
      // Alert when N listings appear within X hours
      if (config.count == null || config.withinHours == null) return null;
      const since = new Date(Date.now() - config.withinHours * 60 * 60 * 1000);
      where.firstSeenAt = { gte: since };
      if (config.priceBelow != null) {
        where.price = { lte: config.priceBelow };
      }
      const listings = await db.listing.findMany({
        where,
        select: { id: true, title: true, price: true, url: true },
        orderBy: { firstSeenAt: 'desc' },
        take: config.count,
      });
      if (listings.length < config.count) return null;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matchedCount: listings.length,
        listings: listings.slice(0, 10),
        message: `🔥 ${listings.length} novih oglasov v ${config.withinHours}h${config.priceBelow ? ` pod ${config.priceBelow}€` : ''} (potrebno ${config.count})`,
      };
    }

    case 'price_drop_pct': {
      // Alert when price drops by X% within Y hours
      if (config.dropPct == null || config.withinHours == null) return null;
      const since = new Date(Date.now() - config.withinHours * 60 * 60 * 1000);
      const dropped = await db.listing.findMany({
        where: {
          ...where,
          priceDroppedAt: { gte: since },
          previousPrice: { not: null },
        },
        select: { id: true, title: true, price: true, url: true, previousPrice: true },
      });
      const matching = dropped.filter(l => {
        if (!l.price || !l.previousPrice) return false;
        const dropPct = ((l.previousPrice - l.price) / l.previousPrice) * 100;
        return dropPct >= config.dropPct!;
      });
      if (matching.length === 0) return null;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matchedCount: matching.length,
        listings: matching.slice(0, 10).map(l => ({ id: l.id, title: l.title, price: l.price, url: l.url })),
        message: `📉 ${matching.length} oglasov s padcem ≥ ${config.dropPct}% v ${config.withinHours}h`,
      };
    }

    case 'ai_verdict_combo': {
      // Alert when AI score >= X AND risk <= Y AND dealScore >= Z
      if (config.minAiScore != null) where.aiScore = { gte: config.minAiScore };
      if (config.maxAiRisk != null) where.aiRisk = { lte: config.maxAiRisk };
      if (config.minDealScore != null) where.dealScore = { gte: config.minDealScore };
      where.aiVerdict = 'PRILIKA';
      where.firstSeenAt = { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
      const listings = await db.listing.findMany({
        where,
        select: { id: true, title: true, price: true, url: true },
        take: 10,
      });
      if (listings.length === 0) return null;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matchedCount: listings.length,
        listings,
        message: `🤖 ${listings.length} oglasov z AI prilika ≥ ${config.minAiScore ?? '?'}, tveganje ≤ ${config.maxAiRisk ?? '?'}${config.minDealScore ? `, deal ≥ ${config.minDealScore}` : ''}`,
      };
    }

    case 'time_based': {
      // Alert when listing is X hours old and price <= Y
      if (config.hoursOld == null) return null;
      const cutoff = new Date(Date.now() - config.hoursOld * 60 * 60 * 1000);
      where.firstSeenAt = { lte: cutoff };
      if (config.priceBelow != null) {
        where.price = { lte: config.priceBelow };
      }
      const listings = await db.listing.findMany({
        where,
        select: { id: true, title: true, price: true, url: true, firstSeenAt: true },
        take: 10,
        orderBy: { firstSeenAt: 'asc' },
      });
      if (listings.length === 0) return null;
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        matchedCount: listings.length,
        listings,
        message: `⏰ ${listings.length} oglasov starejših od ${config.hoursOld}h${config.priceBelow ? ` pod ${config.priceBelow}€` : ''} (morda pripravljeni za pogajanje)`,
      };
    }

    default:
      return null;
  }
}

async function sendNotifications(rule: SmartRule, result: TriggeredRule, channels: string[]) {
  const settings = await getSettingsRow();
  const messageText = `${result.message}\n\nPravilo: ${rule.name}\n${result.listings.slice(0, 5).map(l => `• ${l.title}${l.price ? ` (${l.price}€)` : ''}`).join('\n')}${result.listings.length > 5 ? `\n... in ${result.listings.length - 5} več` : ''}`;

  for (const channel of channels) {
    try {
      if (channel === 'telegram' && settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
        await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          messageText
        );
      } else if (channel === 'discord' && settings.discordEnabled && settings.discordWebhookUrl) {
        const embed = buildAlertEmbed({
          monitorName: 'Smart Rule',
          title: result.message,
          priceText: '',
          url: result.listings[0]?.url ?? '',
          aiVerdict: 'PRILIKA',
          aiReason: `Pravilo: ${rule.name}`,
          aiScore: null,
          aiRisk: null,
        });
        await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
      } else if (channel === 'push' && settings.pushEnabled) {
        await sendPushNotification({
          title: result.message.slice(0, 100),
          body: `Pravilo: ${rule.name} — ${result.matchedCount} oglasov`,
          url: '/alerts',
        });
      }
    } catch (e) {
      console.error(`Smart rule ${rule.id} notification ${channel} error:`, e);
    }
  }
}
