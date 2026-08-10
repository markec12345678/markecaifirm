// v7.44: Smart Relisting Reminder — opozori ko Bolha/Vinted oglas poteče.
//
// Bolha oglasi potečejo po 30-60 dneh. Če imaš held trade ki je bil
// objavljen za prodajo (flip step 'listed_bolha'), preveri ali je oglas še aktiven.
// Če je starejši od 30 dni od objave → predlagaj ponovno objavo z optimizirano ceno.
//
// GET /api/cron/relisting-reminder?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LISTING_EXPIRY_DAYS = 30; // Bolha default
const PRICE_DROP_ON_RELIST = 5; // 5% drop suggested on relist

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

    // Get held trades with flip checklist (check if listed)
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true,
        category: true, flipChecklist: true, url: true,
        listing: { select: { aiEstimatedValue: true, firstSeenAt: true } },
      },
      orderBy: { buyDate: 'asc' },
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No held trades' });
    }

    const now = Date.now();
    const relistingCandidates: Array<{
      tradeId: string;
      title: string;
      buyPrice: number;
      daysSinceBuy: number;
      suggestedPrice: number;
      priceDropPct: number;
      reason: string;
      url: string | null;
    }> = [];

    for (const trade of heldTrades) {
      // Parse flip checklist — check if 'listed_bolha' was completed
      let checklist: Array<{ step: string; completedAt: string | null }> = [];
      try { checklist = JSON.parse(trade.flipChecklist || '[]'); } catch { /* */ }
      const listedStep = checklist.find(c => c.step === 'listed_bolha' || c.step === 'listed_vinted');

      if (!listedStep || !listedStep.completedAt) continue; // not listed yet

      const listedDate = new Date(listedStep.completedAt);
      const daysSinceListed = Math.floor((now - listedDate.getTime()) / 86400000);

      // Check if listing needs relisting (>30 days since listed)
      if (daysSinceListed >= LISTING_EXPIRY_DAYS) {
        const estValue = trade.listing?.aiEstimatedValue ?? Math.round(trade.buyPrice * 1.2);
        // Suggest 5% price drop on relist
        const currentAskingPrice = Math.round(estValue * 1.0);
        const suggestedPrice = Math.round(currentAskingPrice * (1 - PRICE_DROP_ON_RELIST / 100));
        const priceDropPct = PRICE_DROP_ON_RELIST;

        relistingCandidates.push({
          tradeId: trade.id,
          title: trade.title,
          buyPrice: trade.buyPrice,
          daysSinceBuy: Math.floor((now - new Date(trade.buyDate).getTime()) / 86400000),
          suggestedPrice,
          priceDropPct,
          reason: daysSinceListed >= 45
            ? `Oglas objavljen pred ${daysSinceListed} dnevi — verjetno potekel na Bolhi. Ponovno objavi z ${priceDropPct}% nižjo ceno.`
            : `Oglas objavljen pred ${daysSinceListed} dnevi — kmalu poteče. Ponovno objavi z ${priceDropPct}% nižjo ceno.`,
          url: trade.url,
        });
      }
    }

    if (relistingCandidates.length === 0) {
      return NextResponse.json({
        ok: true, sent: false,
        reason: 'No listings need relisting',
        summary: { total: heldTrades.length, candidates: 0 },
      });
    }

    // Build alert
    let alertText = `🔄 *RELISTING* — ${relistingCandidates.length} oglasov potrebujejo ponovno objavo\n\n`;

    for (const c of relistingCandidates.slice(0, 8)) {
      alertText += `📝 *${c.title.slice(0, 40)}*\n`;
      alertText += `   Nabava: ${c.buyPrice}€ → Predlagana cena: ${c.suggestedPrice}€ (-${c.priceDropPct}%)\n`;
      alertText += `   ${c.reason}\n`;
      if (c.url) alertText += `   🔗 ${c.url}\n`;
      alertText += '\n';
    }

    alertText += `_Bolha oglasi potečejo po ~30 dneh. Ponovno objavi z nižjo ceno za hitro prodajo._`;

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

    logger.info('/api/cron/relisting-reminder', `${relistingCandidates.length} relisting reminders sent`);

    return NextResponse.json({
      ok: true,
      sent: true,
      summary: {
        total: heldTrades.length,
        candidates: relistingCandidates.length,
      },
      candidates: relistingCandidates,
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/relisting-reminder', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
