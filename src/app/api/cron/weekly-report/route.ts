// v7.38: Weekly Profit Report — vsak ponedeljek Telegram/Discord povzetek.
//
// GET /api/cron/weekly-report?key=<MONITOR_CRON_KEY>
//
// Šteje:
// - Koliko si zaslužil ta teden (profit EUR + ROI %)
// - Koliko deal-ov si odkril in kupil
// - Top 3 najbolj donosni flip-i
// - Inventory aging (koliko item-ov zastara)
// - Deal velocity (ali trg postaja boljši)
// - Priporočilo za naslednji teden

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendDiscordMessage } from '@/lib/discord';
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
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // 1. Sold trades this week
    const soldThisWeek = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: weekAgo, not: null } },
      select: { id: true, title: true, buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, buyDate: true, sellDate: true, category: true },
    });

    const weeklyProfit = soldThisWeek.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const weeklyRevenue = soldThisWeek.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
    const weeklyInvested = soldThisWeek.reduce((s, t) => s + t.buyPrice + (t.buyFees ?? 0), 0);
    const weeklyRoi = weeklyInvested > 0 ? Math.round((weeklyProfit / weeklyInvested) * 100) : 0;

    // 2. Bought this week
    const boughtThisWeek = await db.trade.count({
      where: { buyDate: { gte: weekAgo }, status: { in: ['held', 'sold'] } },
    });

    // 3. Deals found this week
    const dealsFound = await db.listing.count({
      where: { aiVerdict: 'PRILIKA', firstSeenAt: { gte: weekAgo }, isHidden: false },
    });

    // 4. Top 3 flips this week
    const topFlips = soldThisWeek
      .map(t => ({
        title: t.title,
        profit: (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0),
        roi: t.buyPrice > 0 ? Math.round((((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)) / t.buyPrice) * 100) : 0,
        buyPrice: t.buyPrice,
        sellPrice: t.sellPrice ?? 0,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 3);

    // 5. Currently held inventory
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, buyPrice: true, buyDate: true, category: true },
    });
    const heldValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);

    // 6. Aging items (30+ days)
    const agingItems = heldTrades.filter(t => {
      const days = Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / 86400000);
      return days > 30;
    });

    // 7. Previous week comparison
    const soldPrevWeek = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: twoWeeksAgo, lt: weekAgo, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
    });
    const prevWeekProfit = soldPrevWeek.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const profitTrend = prevWeekProfit !== 0 ? Math.round(((weeklyProfit - prevWeekProfit) / Math.abs(prevWeekProfit)) * 100) : 0;

    // Build report
    const weekNum = Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7);
    let report = `📊 *TEDENSKI POVZETEK #${weekNum}*\n`;
    report += `${now.toLocaleDateString('sl-SI', { day: 'numeric', month: 'long' })}\n\n`;

    report += `💰 *DOBIČEK: ${weeklyProfit >= 0 ? '+' : ''}${weeklyProfit}€*`;
    if (profitTrend !== 0) report += ` (${profitTrend > 0 ? '↑' : '↓'} ${Math.abs(profitTrend)}% vs prejšnji teden)`;
    report += `\n`;
    report += `📈 ROI: ${weeklyRoi}% • Promet: ${weeklyRevenue}€\n`;
    report += `🛒 Kupljeno: ${boughtThisWeek} • Prodano: ${soldThisWeek.length}\n`;
    report += `🎯 Novi deal-i: ${dealsFound}\n\n`;

    if (topFlips.length > 0) {
      report += `🏆 *TOP FLIP-I:*\n`;
      for (const f of topFlips) {
        report += `${f.profit >= 0 ? '✅' : '❌'} ${f.title.slice(0, 40)} — ${f.buyPrice}€→${f.sellPrice}€ (${f.profit >= 0 ? '+' : ''}${f.profit}€, ${f.roi}%)\n`;
      }
      report += `\n`;
    }

    if (heldTrades.length > 0) {
      report += `📦 *INVENTAR:* ${heldTrades.length} item-ov (${heldValue}€ vezano)\n`;
      if (agingItems.length > 0) {
        report += `⚠️ ${agingItems.length} item-ov 30+ dni — znižaj cene!\n`;
      }
      report += `\n`;
    }

    // Recommendation
    let recommendation = '';
    if (weeklyProfit > 0 && weeklyRoi > 15) {
      recommendation = `🚀 Odličen teden! ROI ${weeklyRoi}% je nad povprečjem. Povečaj volume — kupuj več v kategorijah z visokim ROI.`;
    } else if (weeklyProfit > 0) {
      recommendation = `✅ Pozitiven teden. Fokusiraj se na kategorije z višjim ROI za večji dobiček.`;
    } else if (weeklyProfit < 0 && soldThisWeek.length > 0) {
      recommendation = `❌ Negativen teden. Preverjaj Sold Comps pred nakupom — mogoče previč plačuješ.`;
    } else if (soldThisWeek.length === 0) {
      recommendation = `💤 Ni prodaj ta teden. Objavi več oglasov — preveri Flip Status za zastarele item-e.`;
    }
    if (agingItems.length > 2) {
      recommendation += ` ⚠️ ${agingItems.length} item-ov zastara — likvidiraj ali znižaj cene!`;
    }

    report += `💡 *PRIOROČILO:* ${recommendation}`;

    // Send
    const results: any = {};
    if (settings.telegramEnabled && settings.telegramBotToken) {
      try {
        results.telegram = await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          report,
        );
      } catch (e) {
        results.telegram = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }
    if (settings.discordEnabled && settings.discordWebhookUrl) {
      try {
        results.discord = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, {
          title: `📊 Tedenski povzetek #${weekNum}`,
          description: report.slice(0, 4000),
          color: weeklyProfit >= 0 ? 0x10b981 : 0xef4444,
          fields: topFlips.map(f => ({
            name: `${f.profit >= 0 ? '✅' : '❌'} ${f.title.slice(0, 60)}`,
            value: `${f.buyPrice}€ → ${f.sellPrice}€ = ${f.profit >= 0 ? '+' : ''}${f.profit}€ (${f.roi}%)`,
            inline: false,
          })),
          timestamp: now.toISOString(),
        });
      } catch (e) {
        results.discord = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    logger.info('/api/cron/weekly-report', `Report sent: ${weeklyProfit}€ profit, ${soldThisWeek.length} sales`);

    return NextResponse.json({
      ok: true,
      sent: true,
      summary: {
        weeklyProfit,
        weeklyRoi,
        weeklyRevenue,
        boughtCount: boughtThisWeek,
        soldCount: soldThisWeek.length,
        dealsFound,
        heldCount: heldTrades.length,
        heldValue,
        agingCount: agingItems.length,
        profitTrend,
        topFlips,
        recommendation,
      },
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/weekly-report', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
