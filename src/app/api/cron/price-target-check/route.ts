// v8.51: Price Target Check Cron — checks all listings with targetPrice set
// and not yet alerted. If current price <= targetPrice, send notification.
// Runs every 30 minutes.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';
import { sendTelegramMessage } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  try {
    // Find all listings with targetPrice set and not yet alerted
    const listings = await db.listing.findMany({
      where: {
        targetPrice: { not: null },
        targetPriceAlertSent: false,
        price: { not: null },
      },
      select: {
        id: true,
        title: true,
        price: true,
        targetPrice: true,
        url: true,
        monitorId: true,
        monitor: { select: { name: true, source: true } },
      },
      take: 100,
    });

    let alerted = 0;
    let skipped = 0;

    for (const listing of listings) {
      const currentPrice = listing.price;
      const targetPrice = listing.targetPrice;

      if (currentPrice !== null && targetPrice !== null && currentPrice <= targetPrice) {
        // Price dropped to/below target — ALERT!
        const savings = targetPrice - currentPrice;
        const source = listing.monitor?.source || listing.monitor?.name || 'Bolha';

        const message = `🔔 PRICE TARGET dosežen!\n\n📦 ${listing.title}\n💵 Trenutna cena: ${currentPrice}€\n🎯 Target: ${targetPrice}€\n💰 Prihranek: ${savings}€\n📍 Vir: ${source}\n🔗 ${listing.url}`;

        // Create notification
        await createNotification({
          type: 'price_drop',
          title: `🔔 Price target dosežen: ${listing.title.substring(0, 50)}`,
          body: message,
          severity: 'success',
          source: 'system',
          metadata: { listingId: listing.id, currentPrice, targetPrice, savings },
        }).catch(() => {});

        // Try send to Telegram (non-blocking)
        try {
          const settings = await db.settings.findUnique({ where: { id: 'singleton' } });
          if (settings?.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
            await sendTelegramMessage(
              { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
              message
            );
          }
        } catch {}

        // Mark as alerted
        await db.listing.update({
          where: { id: listing.id },
          data: { targetPriceAlertSent: true },
        });

        alerted++;
        logger.info('/api/cron/price-target-check', `alert sent for ${listing.id}`, { currentPrice, targetPrice, savings });
      } else {
        skipped++;
      }
    }

    return NextResponse.json({
      ok: true,
      checked: listings.length,
      alerted,
      skipped,
      source: 'v8.51-price-target-check',
    });
  } catch (err: any) {
    logger.error('/api/cron/price-target-check', 'handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
