// v7.36: Inventory Aging Alert — warns when held inventory is aging.
//
// Every held trade has a "carrying cost" = capital tied up + depreciation.
// This endpoint:
// 1. Finds all held trades
// 2. Computes days held + carrying cost + depreciation estimate
// 3. Categorizes: GREEN (<30d) / AMBER (30-60d) / RED (60-90d) / CRITICAL (>90d)
// 4. Sends alert if any RED/CRITICAL items exist
// 5. Recommends action: cut price 10%, cut 20%, or liquidate
//
// GET /api/cron/inventory-aging-alert?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
import { sendDiscordMessage } from '@/lib/discord';
import { sendPushNotification } from '@/lib/push';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CARRYING_COST_PER_DAY = 0.50; // EUR — capital opportunity cost
const DEPRECIATION_MONTHLY_PCT = {
  elektronika: 5,    // 5%/month — phones, laptops lose value fast
  avto: 2,           // 2%/month
  moda: 1,           // 1%/month — clothes don't depreciate much
  orodje: 1.5,       // 1.5%/month
  drugo: 3,          // 3%/month default
} as const;

interface AgingTrade {
  id: string;
  title: string;
  buyPrice: number;
  buyDate: Date;
  category: string;
  daysHeld: number;
  carryingCostEur: number;
  depreciationEur: number;
  totalLossEur: number;
  severity: 'green' | 'amber' | 'red' | 'critical';
  recommendedAction: string;
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

    // Get all held trades
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: {
        id: true, title: true, buyPrice: true, buyDate: true, category: true,
        flipChecklist: true,
      },
      orderBy: { buyDate: 'asc' }, // oldest first
    });

    if (heldTrades.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'No held trades' });
    }

    // Compute aging for each trade
    const now = Date.now();
    const agingTrades: AgingTrade[] = heldTrades.map(t => {
      const daysHeld = Math.floor((now - new Date(t.buyDate).getTime()) / 86400000);
      const carryingCostEur = Math.round(daysHeld * CARRYING_COST_PER_DAY * 100) / 100;

      // Depreciation estimate
      const cat = (t.category || 'drugo').toLowerCase();
      const depRate = DEPRECIATION_MONTHLY_PCT[cat as keyof typeof DEPRECIATION_MONTHLY_PCT]
        ?? DEPRECIATION_MONTHLY_PCT.drugo;
      const monthsHeld = daysHeld / 30;
      const depreciationEur = Math.round(t.buyPrice * (depRate / 100) * monthsHeld * 100) / 100;

      const totalLossEur = Math.round((carryingCostEur + depreciationEur) * 100) / 100;

      // Severity
      let severity: AgingTrade['severity'] = 'green';
      if (daysHeld > 90) severity = 'critical';
      else if (daysHeld > 60) severity = 'red';
      else if (daysHeld > 30) severity = 'amber';

      // Recommended action
      let recommendedAction = '';
      if (daysHeld <= 30) {
        recommendedAction = 'OK — spremljaj';
      } else if (daysHeld <= 60) {
        recommendedAction = `Znižaj ceno za 10% (${Math.round(t.buyPrice * 1.1 * 0.9)}€)`;
      } else if (daysHeld <= 90) {
        recommendedAction = `Znižaj ceno za 20% (${Math.round(t.buyPrice * 1.1 * 0.8)}€)`;
      } else {
        recommendedAction = `LIKVIDACIJA — prodaj za nabavno (${t.buyPrice}€) ali manj`;
      }

      return {
        id: t.id,
        title: t.title,
        buyPrice: t.buyPrice,
        buyDate: t.buyDate,
        category: t.category || 'drugo',
        daysHeld,
        carryingCostEur,
        depreciationEur,
        totalLossEur,
        severity,
        recommendedAction,
      };
    });

    // Only alert if there are RED or CRITICAL items
    const redItems = agingTrades.filter(t => t.severity === 'red' || t.severity === 'critical');
    const amberItems = agingTrades.filter(t => t.severity === 'amber');

    if (redItems.length === 0 && amberItems.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: 'No aging items requiring alert',
        summary: {
          total: heldTrades.length,
          green: agingTrades.filter(t => t.severity === 'green').length,
          amber: amberItems.length,
          red: redItems.length,
        },
      });
    }

    // Build alert message
    const totalCapitalTied = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
    const totalLoss = redItems.reduce((s, t) => s + t.totalLossEur, 0);

    let alertText = `⚠️ *INVENTORY AGING ALERT*\n\n`;
    alertText += `📦 ${heldTrades.length} held items • ${totalCapitalTied}€ capital tied\n`;
    alertText += `💸 ${redItems.length} RED items — ${totalLoss}€ total loss (carrying + depreciation)\n\n`;

    if (redItems.length > 0) {
      alertText += `🔴 *AKCIJA POTREBNA:*\n`;
      for (const item of redItems.slice(0, 5)) {
        alertText += `\n• ${item.title}\n`;
        alertText += `  ${item.daysHeld}d • nabava ${item.buyPrice}€ • izguba ${item.totalLossEur}€\n`;
        alertText += `  → ${item.recommendedAction}\n`;
      }
    }

    if (amberItems.length > 0 && redItems.length < 3) {
      alertText += `\n🟡 *BLIŽAJO SE:*\n`;
      for (const item of amberItems.slice(0, 3)) {
        alertText += `• ${item.title} — ${item.daysHeld}d (${item.totalLossEur}€ izguba)\n`;
      }
    }

    // Send via channels
    const results: any = {};

    if (settings.telegramEnabled && settings.telegramBotToken) {
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

    if (settings.discordEnabled && settings.discordWebhookUrl) {
      try {
        const embed = {
          title: '⚠️ Inventory Aging Alert',
          description: alertText.slice(0, 4000),
          color: redItems.length > 0 ? 0xff0000 : 0xf59e0b,
          fields: redItems.slice(0, 5).map(item => ({
            name: `🔴 ${item.title.slice(0, 60)}`,
            value: `${item.daysHeld}d • ${item.buyPrice}€ nabava • ${item.totalLossEur}€ izguba\n→ ${item.recommendedAction}`,
            inline: false,
          })),
          footer: { text: `${heldTrades.length} held • ${totalCapitalTied}€ tied • ${totalLoss}€ at risk` },
          timestamp: new Date().toISOString(),
        };
        const dcResult = await sendDiscordMessage({ webhookUrl: settings.discordWebhookUrl }, embed);
        results.discord = dcResult;
      } catch (e) {
        results.discord = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    if (settings.pushEnabled) {
      try {
        const pushResult = await sendPushNotification({
          title: `⚠️ ${redItems.length} items aging!`,
          body: `${totalLoss}€ at risk. Action needed: cut prices or liquidate.`,
        });
        results.push = pushResult;
      } catch (e) {
        results.push = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    logger.info('/api/cron/inventory-aging-alert', `Alert sent: ${redItems.length} red, ${amberItems.length} amber`);

    return NextResponse.json({
      ok: true,
      sent: true,
      summary: {
        total: heldTrades.length,
        capitalTiedEur: totalCapitalTied,
        totalLossEur: totalLoss,
        green: agingTrades.filter(t => t.severity === 'green').length,
        amber: amberItems.length,
        red: redItems.filter(t => t.severity === 'red').length,
        critical: redItems.filter(t => t.severity === 'critical').length,
      },
      redItems: redItems.map(t => ({
        id: t.id,
        title: t.title,
        daysHeld: t.daysHeld,
        buyPrice: t.buyPrice,
        totalLossEur: t.totalLossEur,
        recommendedAction: t.recommendedAction,
      })),
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/inventory-aging-alert', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
