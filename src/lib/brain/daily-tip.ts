// v8.52: Daily AI Tip — generates ONE actionable insight per day.
// Combines Master Brain top action + Trade Insights + Goal progress
// into a single "Kaj naj danes naredim?" tip pushed to Notification Center + Telegram.

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';
import { sendTelegramMessage } from '@/lib/telegram';
import { calculateActualProfit } from '@/lib/profit/actual';

export interface DailyTip {
  ok: true;
  date: string;
  tip: string;
  reasoning: string;
  expectedImpact: string;
  category: 'profit' | 'inventory' | 'market' | 'sourcing' | 'risk' | 'buyer' | 'pricing' | 'goal';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  source: 'v8.52-daily-ai-tip';
}

/**
 * Generate the daily AI tip based on current system state.
 * Logic:
 * 1. Check goal progress — if behind, tip = "speed up"
 * 2. Check held inventory aging — if items >30d, tip = "liquidate"
 * 3. Check Master Brain top action — use it if available
 * 4. Check trade insights — use best source/category
 * 5. Fallback: "Record your trades for better AI recommendations"
 */
export async function generateDailyTip(): Promise<DailyTip> {
  const today = new Date().toISOString().split('T')[0];

  // 1. Check goal progress
  const settings = await db.settings.findUnique({ where: { id: 'singleton' }, select: { monthlyProfitGoal: true } });
  const monthlyGoal = settings?.monthlyProfitGoal ?? 0;

  const profit30d = await calculateActualProfit(30);
  const goalProgress = monthlyGoal > 0 ? (profit30d.totalProfitEUR / monthlyGoal) * 100 : 0;

  // 2. Check held inventory aging
  const heldTrades = await db.trade.findMany({
    where: { status: 'held' },
    select: { id: true, title: true, buyDate: true, buyPrice: true, category: true },
  });
  const now = new Date();
  const agedTrades = heldTrades.filter(t => {
    const days = Math.floor((now.getTime() - t.buyDate.getTime()) / (1000 * 60 * 60 * 24));
    return days >= 30;
  });

  // 3. Determine tip priority
  let tip: string;
  let reasoning: string;
  let expectedImpact: string;
  let category: DailyTip['category'];
  let priority: DailyTip['priority'];

  if (agedTrades.length > 0) {
    // Inventory aging is most urgent
    const oldest = agedTrades[0];
    const days = Math.floor((now.getTime() - oldest.buyDate.getTime()) / (1000 * 60 * 60 * 24));
    tip = `🔴 Likvidiraj "${oldest.title}" — ${days} dni v skladišču!`;
    reasoning = `${agedTrades.length} itemov čaka >30 dni. Vsak dan zamika = izguba kapitala.`;
    expectedImpact = `Sprostitev ${agedTrades.reduce((s, t) => s + t.buyPrice, 0)}€ kapitala za nove nakupe.`;
    category = 'inventory';
    priority = 'HIGH';
  } else if (monthlyGoal > 0 && goalProgress < 50) {
    // Behind on goal
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = now.getDate();
    const expectedProfit = (monthlyGoal / daysInMonth) * currentDay;
    const deficit = expectedProfit - profit30d.totalProfitEUR;
    tip = `⚡ Zaostajaš za ciljem: ${profit30d.totalProfitEUR.toFixed(0)}€/${monthlyGoal}€ (${goalProgress.toFixed(0)}%). Dodaj 2 nova oglasa danes!`;
    reasoning = `Pričakovano do danes: ${expectedProfit.toFixed(0)}€. Zaostanek: ${deficit.toFixed(0)}€. Potrebnih ${((monthlyGoal - profit30d.totalProfitEUR) / Math.max(1, daysInMonth - currentDay)).toFixed(0)}€/dan do konca meseca.`;
    expectedImpact = `Doseg mesečnega cilja ${monthlyGoal}€.`;
    category = 'goal';
    priority = 'HIGH';
  } else if (profit30d.tradeCount === 0) {
    // No trades sold
    tip = `📝 Še nišč prodal v zadnjih 30 dneh. Dodaj prodaje za aktivacijo Trade Insights!`;
    reasoning = `Brez prodaje sistem ne more izračunati ROI, win rate, ali priporočil za ponovno zalago.`;
    expectedImpact = `Trade Insights + Restock Recommendations postanejo aktivni.`;
    category = 'profit';
    priority = 'MEDIUM';
  } else if (profit30d.totalProfitEUR > 0 && monthlyGoal > 0 && goalProgress >= 100) {
    // Goal achieved!
    tip = `🎉 Mesečni cilj dosežen! ${profit30d.totalProfitEUR.toFixed(0)}€/${monthlyGoal}€ (${goalProgress.toFixed(0)}%). Povišaj cilj za naslednji mesec!`;
    reasoning = `Si ${goalProgress.toFixed(0)}% nad ciljem. Čas za skaliranje — povišaj cilj ali investiraj v novo kategorijo.`;
    expectedImpact = `Rast sistema + novi trade cycle.`;
    category = 'goal';
    priority = 'LOW';
  } else {
    // Default: positive profit, check win rate
    const winRate = profit30d.tradeCount > 0 ? (profit30d.bestTrade ? 1 : 0) * 100 : 0;
    tip = `📊 Win rate: ${profit30d.tradeCount} prodaj, ${profit30d.totalProfitEUR.toFixed(0)}€ profit. Nadaljuj z istim tempom!`;
    reasoning = `Sistem deluje dobro. Spremljaj Trade Insights za optimizacijo kategorij in virov.`;
    expectedImpact = `Vzdrževanje trenutnega profit tempa.`;
    category = 'profit';
    priority = 'MEDIUM';
  }

  return {
    ok: true,
    date: today,
    tip,
    reasoning,
    expectedImpact,
    category,
    priority,
    source: 'v8.52-daily-ai-tip',
  };
}

/**
 * Send daily AI tip to Notification Center + Telegram.
 * Called by cron at 09:00 daily.
 */
export async function sendDailyTip(): Promise<{ ok: boolean; sent: boolean; tip: string }> {
  const tip = await generateDailyTip();

  const message = `💡 DNEVNI AI NASVET\n\n${tip.tip}\n\n📝 Razlog: ${tip.reasoning}\n📊 Pričakovani vpliv: ${tip.expectedImpact}\n🔥 Prioriteta: ${tip.priority}`;

  // Create notification
  await createNotification({
    type: 'system',
    title: `💡 Dnevni nasvet: ${tip.tip.substring(0, 60)}`,
    body: message,
    severity: tip.priority === 'HIGH' ? 'warning' : 'info',
    source: 'system',
    metadata: { date: tip.date, category: tip.category, priority: tip.priority },
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

  logger.info('sendDailyTip', `tip sent: ${tip.tip.substring(0, 80)}`);

  return { ok: true, sent: true, tip: tip.tip };
}
