import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { answerCallbackQuery, editMessageText, formatAlertMessage } from '@/lib/telegram';
import { getSettingsRow } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v1.1: Telegram webhook for inline button callbacks.
 *
 * Setup (after exposing localhost via ngrok/cloudflare tunnel):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-tunnel>.ngrok.io/api/telegram/webhook"
 *
 * Optional: ?secret=XXX — if TELEGRAM_WEBHOOK_SECRET env is set, URL must contain ?secret=XXX
 *
 * Callback data format:
 *   archive:<alertId>  — archive the alert, ack with "Arhivirano"
 *   scam:<alertId>     — archive + mark as scam (move to scam list), ack with "Označeno kot prevara"
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = url.searchParams.get('secret');
    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const callbackQuery = update?.callback_query;
  if (!callbackQuery) {
    // Not a callback — could be a regular message, just acknowledge
    return NextResponse.json({ ok: true });
  }

  const data: string = callbackQuery.data ?? '';
  const messageId: number = callbackQuery.message?.message_id;
  const callbackQueryId: string = callbackQuery.id;

  const settings = await getSettingsRow();
  const tgCfg = {
    botToken: settings.telegramBotToken,
    chatId: settings.telegramChatId,
  };

  let ackText = 'OK';
  let actionSuccess = false;

  try {
    if (data.startsWith('archive:')) {
      const alertId = data.slice('archive:'.length);
      const alert = await db.alert.findUnique({ where: { id: alertId } });
      if (!alert) {
        ackText = 'Alert ne obstaja več';
      } else {
        await db.alert.update({
          where: { id: alertId },
          data: {
            isArchived: true,
            isRead: true,
            // v1.2: track user feedback
            userAction: 'archived',
            userActionedAt: new Date(),
          },
        });
        ackText = '✅ Arhivirano';
        actionSuccess = true;
        // Edit message to add archived marker
        if (messageId) {
          await editMessageText(
            tgCfg,
            messageId,
            `_ARHIVIRANO_\n\n${alert.body}`,
            [[{ text: '🔗 Odpri oglas', url: alert.url }]]
          );
        }
      }
    } else if (data.startsWith('scam:')) {
      const alertId = data.slice('scam:'.length);
      const alert = await db.alert.findUnique({ where: { id: alertId } });
      if (!alert) {
        ackText = 'Alert ne obstaja več';
      } else {
        // Update: archive, mark as scam via verdict override + reason note
        await db.alert.update({
          where: { id: alertId },
          data: {
            isArchived: true,
            isRead: true,
            aiVerdict: 'SUMNJIVO',
            // v1.2: track user feedback
            userAction: 'scam',
            userActionedAt: new Date(),
          },
        });
        ackText = '🚫 Označeno kot prevara';
        actionSuccess = true;
        if (messageId) {
          await editMessageText(
            tgCfg,
            messageId,
            `🚫 _OZNAČENO KOT PREVARA_\n\n${alert.body}`,
            [[{ text: '🔗 Odpri oglas', url: alert.url }]]
          );
        }
      }
    } else if (data.startsWith('interested:')) {
      // v1.2: explicit "interested" callback
      const alertId = data.slice('interested:'.length);
      const alert = await db.alert.findUnique({ where: { id: alertId } });
      if (!alert) {
        ackText = 'Alert ne obstaja več';
      } else {
        await db.alert.update({
          where: { id: alertId },
          data: {
            isRead: true,
            userAction: 'interested',
            userActionedAt: new Date(),
          },
        });
        ackText = '👍 Zabeleženo kot zanimiv';
        actionSuccess = true;
      }
    } else {
      ackText = `Neznana akcija: ${data}`;
    }
  } catch (e: any) {
    ackText = `Napaka: ${e?.message?.slice(0, 60) ?? 'neznana'}`;
  }

  await answerCallbackQuery(tgCfg, callbackQueryId, ackText);
  return NextResponse.json({ ok: true, actionSuccess, ackText });
}

/** Health check / webhook info endpoint. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    webhookActive: true,
    setupInstructions: 'POST https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-public-url>/api/telegram/webhook',
  });
}
