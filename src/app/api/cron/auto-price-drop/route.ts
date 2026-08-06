// v7.41: Auto Price Drop — cron avtomatsko predlaga znižanje za zastarele item-e.
//
// Skenira held trades, za vsak izračuna:
// - Dni v inventarju
// - Ali je flip checklist doseže "price_drop_14d" ali "price_drop_30d"
// - Predlagano ceno (10% znižanje pri 14d, 20% pri 30d, likvidacija pri 90d+)
//
// Pošlje Telegram alert s predlaganimi akcijami.
//
// GET /api/cron/auto-price-drop?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendPushNotification } from '@/lib/push';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const now = Date.now();

    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true,
        category: true, flipChecklist: true, imageUrl: true,
      },
      orderBy: { buyDate: 'asc' },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No held trades' });
    }

    // Parse flip checklist for each trade
    const priceDropSuggestions: Array<{
      id: string;
      title: string;
      buyPrice: number;
      daysHeld: number;
      currentSuggestedPrice: number;
      dropPct: number;
      dropEur: number;
      urgency: 'review' | 'drop_10' | 'drop_20' | 'liquidate';
      flipStep: string;
    }> = [];

    for (const trade of heldTrades) {
      const daysHeld = Math.floor((now - new Date(trade.buyDate).getTime()) / 86400000);

      // Parse flip checklist
      let checklist: Array<{ step: string; completedAt: string | null }> = [];
      try { checklist = JSON.parse(trade.flipChecklist || '[]'); } catch { /* */ }
      const completedSteps = new Set(checklist.map(c => c.step));

      // Determine what action is needed
      if (daysHeld >= 90 && !completedSteps.has('price_drop_30d')) {
        // LIQUIDATE — sell at or below buy price
        const liquidatePrice = Math.round(trade.buyPrice * 0.9); // 10% below buy
        priceDropSuggestions.push({
          id: trade.id, title: trade.title, buyPrice: trade.buyPrice,
          daysHeld, currentSuggestedPrice: liquidatePrice,
          dropPct: 0, dropEur: trade.buyPrice - liquidatePrice,
          urgency: 'liquidate', flipStep: 'price_drop_30d',
        });
      } else if (daysHeld >= 30 && !completedSteps.has('price_drop_30d')) {
        // DROP 20%
        const newPrice = Math.round(trade.buyPrice * 1.1 * 0.8); // 20% off asking
        priceDropSuggestions.push({
          id: trade.id, title: trade.title, buyPrice: trade.buyPrice,
          daysHeld, currentSuggestedPrice: newPrice,
          dropPct: 20, dropEur: Math.round(trade.buyPrice * 1.1 * 0.2),
          urgency: 'drop_20', flipStep: 'price_drop_30d',
        });
      } else if (daysHeld >= 14 && !completedSteps.has('price_drop_14d')) {
        // DROP 10%
        const newPrice = Math.round(trade.buyPrice * 1.1 * 0.9); // 10% off asking
        priceDropSuggestions.push({
          id: trade.id, title: trade.title, buyPrice: trade.buyPrice,
          daysHeld, currentSuggestedPrice: newPrice,
          dropPct: 10, dropEur: Math.round(trade.buyPrice * 1.1 * 0.1),
          urgency: 'drop_10', flipStep: 'price_drop_14d',
        });
      }
    }

    if (priceDropSuggestions.length === 0) {
      return NextResponse.json({
        ok: true, sent: false,
        reason: 'No items need price drops',
        summary: { total: heldTrades.length, suggestions: 0 },
      });
    }

    // Build alert
    let alertText = `📉 *AUTO PRICE DROP* — ${priceDropSuggestions.length} item-ov potrebujejo akcijo\n\n`;

    for (const s of priceDropSuggestions.slice(0, 10)) {
      const emoji = s.urgency === 'liquidate' ? '🔴' : s.urgency === 'drop_20' ? '🟠' : '🟡';
      const action = s.urgency === 'liquidate'
        ? `LIKVIDACIJA: prodaj za ${s.currentSuggestedPrice}€ (pod nabavno!)`
        : `Znižaj za ${s.dropPct}% → ${s.currentSuggestedPrice}€`;

      alertText += `${emoji} *${s.title.slice(0, 40)}*\n`;
      alertText += `   ${s.daysHeld}d • nabava ${s.buyPrice}€ • ${action}\n\n`;
    }

    const totalPotentialLoss = priceDropSuggestions.reduce((s, x) => s + x.dropEur, 0);
    alertText += `💸 Skupni potencialni izgubek: ${totalPotentialLoss}€\n`;
    alertText += `_Avtomatsko priporocilo — potrdi v web vmesniku_`;

    // Send
    const results: any = {};
    if (settings.telegramEnabled && settings.telegramBotToken) {
      try {
        results.telegram = await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          alertText,
        );
      } catch (e) {
        results.telegram = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }
    if (settings.pushEnabled) {
      try {
        results.push = await sendPushNotification({
          title: `📉 ${priceDropSuggestions.length} items need price drop`,
          body: `${priceDropSuggestions.filter(s => s.urgency === 'liquidate').length} critical, ${priceDropSuggestions.filter(s => s.urgency === 'drop_20').length} urgent`,
        });
      } catch (e) {
        results.push = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    logger.info('/api/cron/auto-price-drop', `${priceDropSuggestions.length} price drop suggestions sent`);

    return NextResponse.json({
      ok: true,
      sent: true,
      summary: {
        total: heldTrades.length,
        suggestions: priceDropSuggestions.length,
        liquidate: priceDropSuggestions.filter(s => s.urgency === 'liquidate').length,
        drop20: priceDropSuggestions.filter(s => s.urgency === 'drop_20').length,
        drop10: priceDropSuggestions.filter(s => s.urgency === 'drop_10').length,
        totalPotentialLossEur: totalPotentialLoss,
      },
      suggestions: priceDropSuggestions,
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/auto-price-drop', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
