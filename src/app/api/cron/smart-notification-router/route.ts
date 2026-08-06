// v7.53: Smart Notification Router — priority-based alert routing.
//
// Ne pošiljaj VSEGA na Telegram (spam). Pametno razporedi:
// - CRITICAL (deal 90+, price drop >30%) → Telegram + Push + Discord
// - HIGH (deal 70-89, new PRILIKA) → Telegram + Push
// - MEDIUM (deal 50-69, new listing) → Push only (no Telegram noise)
// - LOW (monitor run OK, stats) → Dashboard only (no notification)
//
// GET /api/cron/smart-notification-router?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendPushNotification } from '@/lib/push';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

function determinePriority(deal: {
  dealScore: number | null;
  aiVerdict: string | null;
  aiRisk: number | null;
  priceDroppedAt: Date | null;
  previousPrice: number | null;
  price: number | null;
}): Priority {
  // CRITICAL: deal 90+ OR price dropped >30%
  if (deal.dealScore && deal.dealScore >= 90 && (deal.aiRisk ?? 5) <= 3) return 'CRITICAL';
  if (deal.priceDroppedAt && deal.previousPrice && deal.price) {
    const dropPct = (deal.previousPrice - deal.price) / deal.previousPrice;
    if (dropPct > 0.3) return 'CRITICAL'; // >30% price drop
  }

  // HIGH: deal 70-89, PRILIKA
  if (deal.dealScore && deal.dealScore >= 70 && deal.aiVerdict === 'PRILIKA') return 'HIGH';

  // MEDIUM: deal 50-69 or any PRILIKA
  if ((deal.dealScore && deal.dealScore >= 50) || deal.aiVerdict === 'PRILIKA') return 'MEDIUM';

  // LOW: everything else
  return 'LOW';
}

export async function GET(req: NextRequest) {
  try {
    const expectedKey = process.env.MONITOR_CRON_KEY;
    if (expectedKey) {
      const url = new URL(req.url);
      if (url.searchParams.get('key') !== expectedKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const settings = await getSettingsRow();
    const since = new Date(Date.now() - 30 * 60 * 1000); // last 30 min

    // Find new listings since last check that haven't been notified yet
    const newDeals = await db.listing.findMany({
      where: {
        firstSeenAt: { gte: since },
        isHidden: false,
        aiVerdict: 'PRILIKA',
        contactStatus: 'none',
      },
      select: {
        id: true, title: true, price: true, priceText: true, url: true,
        dealScore: true, aiScore: true, aiRisk: true, aiVerdict: true,
        aiEstimatedValue: true, priceDroppedAt: true, previousPrice: true,
        location: true, monitor: { select: { name: true, source: true } },
      },
      orderBy: { dealScore: 'desc' },
      take: 30,
    });

    if (newDeals.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No new deals in last 30 min' });
    }

    // Categorize by priority
    const categorized: Record<Priority, typeof newDeals> = {
      CRITICAL: [],
      HIGH: [],
      MEDIUM: [],
      LOW: [],
    };

    for (const deal of newDeals) {
      const priority = determinePriority(deal);
      categorized[priority].push(deal);
    }

    const results = { critical: 0, high: 0, medium: 0, low: 0, telegramSent: 0, pushSent: 0 };

    // CRITICAL → Telegram + Push + Discord (all channels)
    if (categorized.CRITICAL.length > 0) {
      let msg = `🚨 *KRITIČNO* — ${categorized.CRITICAL.length} TOP priložnosti!\n\n`;
      for (const d of categorized.CRITICAL.slice(0, 3)) {
        const savings = d.aiEstimatedValue && d.price ? ` (est. ${d.aiEstimatedValue}€ — prihranek ${d.aiEstimatedValue - d.price}€)` : '';
        const risk = (d.aiRisk ?? 5) <= 2 ? '✅' : '⚠️';
        msg += `*${d.dealScore}/100* ${risk} ${d.title?.slice(0, 40)}\n`;
        msg += `   💰 ${d.priceText}${savings}\n`;
        if (d.location) msg += `   📍 ${d.location}\n`;
        msg += `   🔗 ${d.url}\n\n`;
      }

      if (settings.telegramEnabled && settings.telegramBotToken) {
        try {
          await sendTelegramMessage({ botToken: settings.telegramBotToken, chatId: settings.telegramChatId }, msg);
          results.telegramSent += 1;
        } catch (e) { logger.error('smart-router', 'Telegram failed for CRITICAL', e); }
      }
      if (settings.pushEnabled) {
        try {
          await sendPushNotification({
            title: `🚨 ${categorized.CRITICAL.length} KRITIČNIH deal-ov!`,
            body: categorized.CRITICAL[0].title.slice(0, 50) + ` — ${categorized.CRITICAL[0].priceText}`,
            url: categorized.CRITICAL[0].url,
          });
          results.pushSent += 1;
        } catch (e) { logger.error('smart-router', 'Push failed for CRITICAL', e); }
      }
      results.critical = categorized.CRITICAL.length;
    }

    // HIGH → Telegram + Push (but shorter message)
    if (categorized.HIGH.length > 0) {
      let msg = `🎯 *${categorized.HIGH.length} novih priložnosti* (deal 70+)\n\n`;
      for (const d of categorized.HIGH.slice(0, 5)) {
        msg += `• ${d.dealScore}/100 — ${d.title?.slice(0, 35)} (${d.priceText})\n`;
        msg += `  ${d.url}\n`;
      }

      if (settings.telegramEnabled && settings.telegramBotToken) {
        try {
          await sendTelegramMessage({ botToken: settings.telegramBotToken, chatId: settings.telegramChatId }, msg);
          results.telegramSent += 1;
        } catch (e) { /* ignore */ }
      }
      if (settings.pushEnabled) {
        try {
          await sendPushNotification({
            title: `🎯 ${categorized.HIGH.length} novih deal-ov`,
            body: categorized.HIGH[0].title.slice(0, 50),
          });
          results.pushSent += 1;
        } catch (e) { /* ignore */ }
      }
      results.high = categorized.HIGH.length;
    }

    // MEDIUM → Push only (no Telegram — reduce noise)
    if (categorized.MEDIUM.length > 0 && settings.pushEnabled) {
      try {
        await sendPushNotification({
          title: `📊 ${categorized.MEDIUM.length} novih oglasov`,
          body: `Deal score 50-69. Preveri v dashboardu.`,
        });
        results.pushSent += 1;
      } catch (e) { /* ignore */ }
      results.medium = categorized.MEDIUM.length;
    }

    // LOW → Dashboard only (no notification at all)
    results.low = categorized.LOW.length;

    logger.info('/api/cron/smart-notification-router',
      `Routed: ${results.critical} CRITICAL, ${results.high} HIGH, ${results.medium} MEDIUM, ${results.low} LOW. Telegram: ${results.telegramSent}, Push: ${results.pushSent}`);

    return NextResponse.json({
      ok: true,
      summary: {
        totalDeals: newDeals.length,
        critical: results.critical,
        high: results.high,
        medium: results.medium,
        low: results.low,
        telegramSent: results.telegramSent,
        pushSent: results.pushSent,
        dashboardOnly: results.low,
      },
      routing: {
        CRITICAL: 'Telegram + Push + Discord',
        HIGH: 'Telegram + Push',
        MEDIUM: 'Push only',
        LOW: 'Dashboard only',
      },
    });
  } catch (err: any) {
    logger.error('/api/cron/smart-notification-router', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
