// v8.52: Inventory Aging Alerts — generates alerts for held trades
// that are aging (30/60/90+ days). Creates Notifications + Telegram.

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';
import { sendTelegramMessage } from '@/lib/telegram';

export interface AgingAlert {
  tradeId: string;
  title: string;
  category: string;
  buyPrice: number;
  buyDate: Date;
  daysHeld: number;
  threshold: 30 | 60 | 90;
  severity: 'warning' | 'error';
  recommendation: string;
}

const THRESHOLDS = [30, 60, 90] as const;
const ALERT_METADATA_KEY = 'agingAlertsSent';

/**
 * Check all held trades for aging thresholds.
 * Each trade gets alerted once per threshold (30d, 60d, 90d).
 * Uses Trade.notes to track which thresholds have been alerted.
 */
export async function checkInventoryAging(): Promise<{
  ok: true;
  checked: number;
  alerted: number;
  alerts: AgingAlert[];
}> {
  // Fetch all held trades
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: {
      id: true,
      title: true,
      category: true,
      buyPrice: true,
      buyDate: true,
      notes: true,
    },
  });

  const now = new Date();
  const alerts: AgingAlert[] = [];
  let alerted = 0;

  for (const trade of heldTrades) {
    const daysHeld = Math.floor((now.getTime() - trade.buyDate.getTime()) / (1000 * 60 * 60 * 24));

    // Check which thresholds have been alerted (stored in notes as JSON)
    let sentThresholds: number[] = [];
    try {
      const match = trade.notes?.match(/\[aging-alerts:(.*?)\]/);
      if (match) {
        sentThresholds = JSON.parse(match[1] || '[]');
      }
    } catch {
      sentThresholds = [];
    }

    for (const threshold of THRESHOLDS) {
      if (daysHeld >= threshold && !sentThresholds.includes(threshold)) {
        const severity = threshold >= 60 ? 'error' : 'warning';
        const recommendation =
          threshold === 30
            ? `Prenastavi ceno: znižaj za 5-10% ali izboljšaj fotografije/opis.`
            : threshold === 60
            ? `Likvidiraj z 15-20% popustom ali prestavi na drugo platformo (Vinted → Bolha).`
            : `Kritično: razmisli o prodaji pod ceno nabave za sprostitev kapitala.`;

        const alert: AgingAlert = {
          tradeId: trade.id,
          title: trade.title,
          category: trade.category,
          buyPrice: trade.buyPrice,
          buyDate: trade.buyDate,
          daysHeld,
          threshold,
          severity,
          recommendation,
        };
        alerts.push(alert);
        alerted++;

        // Send notification
        const message = `${threshold === 30 ? '⚠️' : threshold === 60 ? '🟠' : '🔴'} AGING ALERT: "${trade.title}" je v skladišču ${daysHeld} dni!\n\n📦 Kategorija: ${trade.category || 'N/A'}\n💰 Nabavna cena: ${trade.buyPrice}€\n⏱ Dani v skladišču: ${daysHeld}\n💡 Priporočilo: ${recommendation}`;

        await createNotification({
          type: 'system',
          title: `${threshold === 30 ? '⚠️' : threshold === 60 ? '🟠' : '🔴'} ${trade.title} — ${daysHeld} dni v skladišču`,
          body: message,
          severity: severity === 'error' ? 'error' : 'warning',
          source: 'system',
          metadata: { tradeId: trade.id, daysHeld, threshold, buyPrice: trade.buyPrice },
        }).catch(() => {});

        // Try Telegram
        try {
          const settings = await db.settings.findUnique({ where: { id: 'singleton' } });
          if (settings?.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
            await sendTelegramMessage(
              { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
              message
            );
          }
        } catch {}

        // Mark threshold as sent in notes
        sentThresholds.push(threshold);
        const newNotes = (trade.notes || '').replace(/\[aging-alerts:.*?\]/g, '').trim();
        const updatedNotes = `${newNotes} [aging-alerts:${JSON.stringify(sentThresholds)}]`.trim();
        await db.trade.update({
          where: { id: trade.id },
          data: { notes: updatedNotes },
        });
      }
    }
  }

  logger.info('checkInventoryAging', `checked ${heldTrades.length}, alerted ${alerted}`);

  return {
    ok: true,
    checked: heldTrades.length,
    alerted,
    alerts,
  };
}
