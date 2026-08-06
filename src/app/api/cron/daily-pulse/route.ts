// v7.47: Daily Profit Pulse — jutranji Telegram z včerajšnjimi rezultati + action items.
//
// Razlika od Weekly Report: krajši, bolj akcijski, vsak dan.
// "Včeraj: 2 prodaji (+85€). Danes: 3 zastareli item-i, 5 novih deal-ov. Akcija: znižaj PS5."
//
// GET /api/cron/daily-pulse?key=<MONITOR_CRON_KEY>

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSettingsRow } from '@/lib/pipeline';
import { sendTelegramMessage } from '@/lib/telegram';
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
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
    const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    // === YESTERDAY ===
    const soldYesterday = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: yesterdayStart, lte: yesterdayEnd, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true, title: true, category: true },
    });
    const yesterdayProfit = soldYesterday.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);

    const boughtYesterday = await db.trade.count({
      where: { buyDate: { gte: yesterdayStart, lte: yesterdayEnd } },
    });

    const newDealsYesterday = await db.listing.count({
      where: { aiVerdict: 'PRILIKA', firstSeenAt: { gte: yesterdayStart, lte: yesterdayEnd }, isHidden: false },
    });

    const newAlertsYesterday = await db.alert.count({
      where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
    });

    // === TODAY (so far) ===
    const newDealsToday = await db.listing.count({
      where: { aiVerdict: 'PRILIKA', firstSeenAt: { gte: todayStart }, isHidden: false, contactStatus: 'none' },
      // Only uncontacted
    });

    // === INVENTORY STATUS ===
    const heldTrades = await db.trade.findMany({
      where: { status: 'held' },
      select: { id: true, title: true, buyPrice: true, buyDate: true, flipChecklist: true },
    });
    const heldValue = heldTrades.reduce((s, t) => s + t.buyPrice, 0);

    // Find aging items (>30d, not yet price-dropped)
    const agingItems: Array<{ title: string; days: number; buyPrice: number }> = [];
    for (const t of heldTrades) {
      const days = Math.floor((now.getTime() - new Date(t.buyDate).getTime()) / 86400000);
      let checklist: Array<{ step: string }> = [];
      try { checklist = JSON.parse(t.flipChecklist || '[]'); } catch { /* */ }
      const hasDrop30 = checklist.some(c => c.step === 'price_drop_30d');
      if (days > 30 && !hasDrop30) {
        agingItems.push({ title: t.title, days, buyPrice: t.buyPrice });
      }
    }

    // === MONTH PROGRESS ===
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const soldThisMonth = await db.trade.findMany({
      where: { status: 'sold', sellDate: { gte: monthStart, not: null } },
      select: { buyPrice: true, buyFees: true, sellPrice: true, sellFees: true },
    });
    const monthProfit = soldThisMonth.reduce((s, t) => s + ((t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0)), 0);
    const goal = settings.monthlyProfitGoal || 0;
    const goalProgress = goal > 0 ? Math.min(100, Math.round((monthProfit / goal) * 100)) : 0;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expectedProgress = Math.round((dayOfMonth / daysInMonth) * 100);

    // === BUILD PULSE ===
    let pulse = `☀️ *DNEVNI PULS* — ${now.toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'short' })}\n\n`;

    // Yesterday summary
    pulse += `📅 *VČERAJ:*\n`;
    if (soldYesterday.length > 0) {
      pulse += `✅ ${soldYesterday.length} prodaji • ${yesterdayProfit >= 0 ? '+' : ''}${yesterdayProfit}€\n`;
    } else {
      pulse += `💤 Brez prodaj\n`;
    }
    pulse += `🛒 ${boughtYesterday} nakupov • 🎯 ${newDealsYesterday} novih deal-ov • 🔔 ${newAlertsYesterday} alertov\n\n`;

    // Today action items
    pulse += `📋 *DANES:*\n`;
    if (newDealsToday > 0) {
      pulse += `🎯 ${newDealsToday} novih neprezrtih deal-ov — preveri!\n`;
    }
    if (agingItems.length > 0) {
      pulse += `⚠️ ${agingItems.length} zastarelih item-ov (30+d):\n`;
      for (const a of agingItems.slice(0, 3)) {
        pulse += `   • ${a.title.slice(0, 30)} — ${a.days}d (${a.buyPrice}€)\n`;
      }
      if (agingItems.length > 3) pulse += `   +${agingItems.length - 3} več...\n`;
    }
    if (newDealsToday === 0 && agingItems.length === 0) {
      pulse += `✅ Vse na prvem mestu — išči nove priložnosti!\n`;
    }
    pulse += '\n';

    // Month progress
    if (goal > 0) {
      const onTrack = goalProgress >= expectedProgress;
      pulse += `📈 *MESEC:* ${monthProfit}€ / ${goal}€ (${goalProgress}%)\n`;
      pulse += `${onTrack ? '✅ Na poti' : `⚠️ Zaostajaš (${expectedProgress}% pričakovano)`}\n\n`;
    }

    // Held inventory
    pulse += `📦 *INVENTAR:* ${heldTrades.length} held (${heldValue}€)\n`;

    // Quick action
    if (agingItems.length > 0) {
      pulse += `\n🔑 *AKCIJA:* Znižaj cene zastarelim item-om!\n`;
    } else if (newDealsToday > 0) {
      pulse += `\n🔑 *AKCIJA:* Preveri ${newDealsToday} novih deal-ov!\n`;
    }

    // Send
    const results: any = {};
    if (settings.telegramEnabled && settings.telegramBotToken) {
      try {
        results.telegram = await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          pulse,
        );
      } catch (e) {
        results.telegram = { ok: false, error: e instanceof Error ? e.message : 'Unknown' };
      }
    }

    logger.info('/api/cron/daily-pulse', 'Daily pulse sent');

    return NextResponse.json({
      ok: true,
      sent: true,
      summary: {
        yesterday: { sold: soldYesterday.length, profit: yesterdayProfit, bought: boughtYesterday, deals: newDealsYesterday, alerts: newAlertsYesterday },
        today: { newDeals: newDealsToday, agingItems: agingItems.length },
        month: { profit: monthProfit, goal, progress: goalProgress, expectedProgress },
        inventory: { held: heldTrades.length, value: heldValue, aging: agingItems.length },
      },
      channels: results,
    });
  } catch (err: any) {
    logger.error('/api/cron/daily-pulse', 'GET handler failed', err);
    return NextResponse.json({ error: err?.message ?? 'Napaka' }, { status: 500 });
  }
}
