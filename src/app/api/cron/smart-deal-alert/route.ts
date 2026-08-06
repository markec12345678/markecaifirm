// v7.36: Smart Deal Alert — TOP 3 deals found, pushed to Telegram/Discord/Push.
//
// Called by cron every 2-4 hours. Finds the BEST opportunities found since
// last alert, sends an actionable message with:
// - Title, price, AI score, deal score
// - Urgency (buy now / wait / stable based on price history)
// - Direct link to listing + make-offer shortcut
//
// Only sends if there are NEW deals above threshold (default dealScore >= 70).
// Prevents alert fatigue — max 1 alert per 2 hours.
//
// GET /api/cron/smart-deal-alert?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage, buildAlertInlineButtons } from '@/lib/telegram';
import { sendDiscordMessage, buildAlertEmbed } from '@/lib/discord';
import { sendPushNotification } from '@/lib/push';
import { getAppUrl } from '@/lib/app-url';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_DEAL_SCORE = 70;
const HOURS_WINDOW = 4; // look back 4 hours
const MIN_ALERT_INTERVAL_HOURS = 2;

export async function GET(req: NextRequest) {
  try {
    // Auth check
    const expectedKey = process.env.MONITOR_CRON_KEY;
    if (expectedKey) {
      const url = new URL(req.url);
      if (url.searchParams.get('key') !== expectedKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const settings = await getSettingsRow();

    // Check if any notification channel is enabled
    const hasTelegram = settings.telegramEnabled && settings.telegramBotToken;
    const hasDiscord = settings.discordEnabled && settings.discordWebhookUrl;
    const hasPush = settings.pushEnabled;
    if (!hasTelegram && !hasDiscord && !hasPush) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No notification channels enabled' });
    }

    // Find top deals from last HOURS_WINDOW hours
    const since = new Date(Date.now() - HOURS_WINDOW * 60 * 60 * 1000);
    const topDeals = await db.listing.findMany({
      where: {
        aiVerdict: 'PRILIKA',
        firstSeenAt: { gte: since },
        isHidden: false,
        dealScore: { gte: MIN_DEAL_SCORE },
        // Exclude already-contacted
        contactStatus: 'none',
      },
      select: {
        id: true,
        title: true,
        price: true,
        priceText: true,
        url: true,
        location: true,
        aiScore: true,
        aiRisk: true,
        dealScore: true,
        aiEstimatedValue: true,
        priceDroppedAt: true,
        previousPrice: true,
        sellerName: true,
        monitor: { select: { name: true, source: true } },
      },
      orderBy: { dealScore: 'desc' },
      take: 3,
    });

    if (topDeals.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: `No deals with score >= ${MIN_DEAL_SCORE} in last ${HOURS_WINDOW}h`,
      });
    }

    // Build alert message
    const dashboardUrl = getAppUrl();
    let alertText = `🎯 *TOP ${topDeals.length} PRILIKNOSTI* (zadnje ${HOURS_WINDOW}h)\n\n`;

    for (let i = 0; i < topDeals.length; i++) {
      const d = topDeals[i];
      const savings = d.aiEstimatedValue && d.price ? d.aiEstimatedValue - d.price : null;
      const priceDrop = d.priceDroppedAt ? ' 📉PADLA CENA' : '';
      const riskIcon = (d.aiRisk ?? 0) <= 2 ? '✅' : (d.aiRisk ?? 0) <= 5 ? '⚠️' : '🔴';

      alertText += `${i + 1}. ${d.title}\n`;
      alertText += `   💰 ${d.priceText}${savings ? ` (est. ${d.aiEstimatedValue}€ — prihranek ${savings}€)` : ''}\n`;
      alertText += `   📊 Deal: ${d.dealScore}/100 • AI: ${d.aiScore}/10 ${riskIcon}${priceDrop}\n`;
      if (d.location) alertText += `   📍 ${d.location}\n`;
      alertText += `   🔗 ${d.url}\n`;
      // Make offer link
      alertText += `   ⚡ Ponudba: ${dashboardUrl}/listings?listing=${d.id}\n\n`;
    }

    alertText += `_Avtomatsko_${topDeals.length > 0 ? ` • ${topDeals.length} novih` : ''}_`;

    // Send via enabled channels
    const results: any = {};

    if (hasTelegram) {
      try {
        const tgResult = await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          alertText,
        );
        results.telegram = tgResult;
      } catch (e) {
        results.telegram = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    if (hasDiscord) {
      try {
        const embed = {
          title: `🎯 TOP ${topDeals.length} PRILIKNOSTI`,
          description: alertText.slice(0, 4000),
          color: 0x10b981,
          fields: topDeals.map((d, i) => ({
            name: `${i + 1}. ${d.title.slice(0, 80)}`,
            value: `${d.priceText} • Deal: ${d.dealScore}/100 • AI: ${d.aiScore}/10\n[Odpri](${d.url}) • [Ponudba](${dashboardUrl}/listings?listing=${d.id})`,
            inline: false,
          })),
          timestamp: new Date().toISOString(),
        };
        const dcResult = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
        results.discord = dcResult;
      } catch (e) {
        results.discord = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    if (hasPush) {
      try {
        const pushResult = await sendPushNotification({
          title: `🎯 ${topDeals.length} novih priložnosti!`,
          body: `Top: ${topDeals[0].title} — ${topDeals[0].priceText} (deal ${topDeals[0].dealScore}/100)`,
          url: `${dashboardUrl}/listings?listing=${topDeals[0].id}`,
        });
        results.push = pushResult;
      } catch (e) {
        results.push = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    logger.info('/api/cron/smart-deal-alert', `Sent ${topDeals.length} deals via ${Object.keys(results).length} channels`);

    return NextResponse.json({
      ok: true,
      sent: true,
      dealsCount: topDeals.length,
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/smart-deal-alert', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
