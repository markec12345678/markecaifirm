// v7.41: Competitor Price Monitor — spremlja podobne oglase na Bolhi.
//
// Ko imaš item v inventarju (held trade), AI poišče podobne aktivne oglase.
// Če je konkurenca cenejša, opozori: "Konkurent prodaja iPhone 13 za 20€ manj — znižaj ceno!"
//
// GET /api/cron/competitor-price-monitor?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

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

    // Get all held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, buyPrice: true, buyDate: true, category: true },
      take: 50,
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No held trades' });
    }

    // For each held trade, find similar active listings in DB
    const competitorAlerts: Array<{
      tradeId: string;
      tradeTitle: string;
      yourPrice: number;
      competitorPrice: number;
      priceDiff: number;
      competitorTitle: string;
      competitorUrl: string;
      urgency: 'undercut' | 'match' | 'ok';
    }> = [];

    for (const trade of heldTrades) {
      // Extract keywords from trade title
      const titleWords = trade.title.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 4);
      if (titleWords.length === 0) continue;

      // Find active listings with similar title (not the trade's own listing)
      const similarListings = await db.listing.findMany({
        where: {
          isHidden: false,
          price: { not: null, gt: 0 },
          id: { not: trade.id },
          OR: titleWords.map(w => ({ title: { contains: w, mode: 'insensitive' } })),
        },
        select: { id: true, title: true, price: true, url: true, firstSeenAt: true },
        orderBy: { price: 'asc' },
        take: 5,
      });

      if (similarListings.length === 0) continue;

      // Your estimated selling price (buy + 20% markup)
      const yourPrice = Math.round(trade.buyPrice * 1.2);

      // Find cheapest competitor
      const cheapest = similarListings[0];
      const priceDiff = yourPrice - (cheapest.price ?? 0);

      if (priceDiff > 20) {
        // Competitor is significantly cheaper — alert
        competitorAlerts.push({
          tradeId: trade.id,
          tradeTitle: trade.title,
          yourPrice,
          competitorPrice: cheapest.price ?? 0,
          priceDiff,
          competitorTitle: cheapest.title,
          competitorUrl: cheapest.url,
          urgency: priceDiff > 50 ? 'undercut' : 'match',
        });
      }
    }

    if (competitorAlerts.length === 0) {
      return NextResponse.json({
        ok: true, sent: false,
        reason: 'No competitor price threats detected',
        summary: { checked: heldTrades.length, threats: 0 },
      });
    }

    // Build alert
    let alertText = `🔍 *KONKURENCA* — ${competitorAlerts.length} item-ov imajo cenejšo konkurenco\n\n`;

    for (const a of competitorAlerts.slice(0, 5)) {
      const emoji = a.urgency === 'undercut' ? '🔴' : '🟡';
      alertText += `${emoji} *${a.tradeTitle.slice(0, 40)}*\n`;
      alertText += `   Tvoja cena: ${a.yourPrice}€ • Konkurenca: ${a.competitorPrice}€\n`;
      alertText += `   Razlika: ${a.priceDiff}€ dražji od konkurenca\n`;
      alertText += `   ${a.urgency === 'undercut' ? '⚠️ ZNIŽAJ CENO!' : 'Razmisli o ujemanju cene'}\n\n`;
    }

    alertText += `_Avtomatsko spremljanje konkurence_`;

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

    logger.info('/api/cron/competitor-price-monitor', `${competitorAlerts.length} competitor alerts sent`);

    return NextResponse.json({
      ok: true,
      sent: true,
      summary: {
        checked: heldTrades.length,
        threats: competitorAlerts.length,
        undercutCount: competitorAlerts.filter(a => a.urgency === 'undercut').length,
        matchCount: competitorAlerts.filter(a => a.urgency === 'match').length,
      },
      alerts: competitorAlerts,
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/competitor-price-monitor', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
