// v8.94: AI Cost Tracking — budget guard + usage stats.
//
// Namen: preprečiti, da AI poraba izstopi izpod kontrole. Solo developer
// nima unlimited budget-a, zato je pomembno vedeti koliko AI klicev
// dnevno/mesečno porabi in imeti "circuit breaker" ko se limit preseže.
//
// ARHITEKTURA:
// - Settings tabele shranjuje: aiCallsToday, aiCallsMonth, aiMaxDailyCalls, aiMaxMonthlyCalls
// - checkAiBudget() se kliče PRED AI klicem — če preseženo, throw-a AiBudgetExceeded
// - recordAiCall() se kliče PO uspešnem AI klicu — increment-a counter-je
// - getAiUsageStats() vrača trenutno porabo za dashboard
//
// INTEGRACIJA z withAiRoute:
// Helper ne kliče avtomatsko (da ostane backward-compatible).
// Endpoint-i ki želijo budget guard, kličejo ročno:
//   await checkAiBudget(db);
//   const raw = await callAi(prompt);
//   await recordAiCall(db);
//
// ALI z ApiRouteError:
//   if (!await checkAiBudget(db)) {
//     throw new ApiRouteError('Dnevni AI budget presežen', 429);
//   }
//
// TODO (v8.95): token tracking ko bo AI provider vračal usage info.
// Trenutno callProviderForRaw vrača samo text (ne { content, usage }).

import type { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';

// --- Tipi ---

export interface AiUsageStats {
  today: number;
  month: number;
  dailyLimit: number;
  monthlyLimit: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  dailyPercent: number; // 0-100
  monthlyPercent: number; // 0-100
  dailyResetAt: string; // ISO datum naslednji reset (00:00 lokalno)
  monthlyResetAt: string; // ISO datum naslednji monthly reset (1. dan meseca)
  budgetAlerted: boolean;
}

export class AiBudgetExceeded extends Error {
  period: 'daily' | 'monthly';
  limit: number;
  current: number;
  constructor(period: 'daily' | 'monthly', limit: number, current: number) {
    const periodLabel = period === 'daily' ? 'dnevni' : 'mesečni';
    super(`AI ${periodLabel} budget presežen: ${current}/${limit} klicev`);
    this.name = 'AiBudgetExceeded';
    this.period = period;
    this.limit = limit;
    this.current = current;
  }
}

// --- Helperji (exportani za testiranje) ---

export function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export function getMonthDate(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export function getTomorrowMidnight(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

export function getFirstOfNextMonth(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return next.toISOString();
}

// --- Public API ---

/**
 * Preveri ali je AI klic dovoljen glede na budget.
 * Stran efekta: reset-a counter-je če se je dan/mesec spremenil.
 *
 * @throws AiBudgetExceeded če je limit presežen
 * @returns true če je dovoljen
 */
export async function checkAiBudget(db: PrismaClient): Promise<boolean> {
  const today = getTodayDate();
  const month = getMonthDate();

  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: {
      aiCallsToday: true,
      aiCallsDate: true,
      aiCallsMonth: true,
      aiCallsMonthDate: true,
      aiMaxDailyCalls: true,
      aiMaxMonthlyCalls: true,
    },
  });

  if (!settings) {
    // Settings ne obstajajo — dovoli (local-first, še ni setup)
    return true;
  }

  // Reset daily counter če se je datum spremenil
  if (settings.aiCallsDate !== today) {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsDate: today, aiCallsToday: 0 },
    });
    settings.aiCallsToday = 0;
  }

  // Reset monthly counter če se je mesec spremenil
  if (settings.aiCallsMonthDate !== month) {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsMonthDate: month, aiCallsMonth: 0 },
    });
    settings.aiCallsMonth = 0;
  }

  // Preveri daily limit
  if (settings.aiCallsToday >= settings.aiMaxDailyCalls) {
    logger.warn('ai-cost', `Daily budget exceeded: ${settings.aiCallsToday}/${settings.aiMaxDailyCalls}`);
    throw new AiBudgetExceeded('daily', settings.aiMaxDailyCalls, settings.aiCallsToday);
  }

  // Preveri monthly limit
  if (settings.aiCallsMonth >= settings.aiMaxMonthlyCalls) {
    logger.warn('ai-cost', `Monthly budget exceeded: ${settings.aiCallsMonth}/${settings.aiMaxMonthlyCalls}`);
    throw new AiBudgetExceeded('monthly', settings.aiMaxMonthlyCalls, settings.aiCallsMonth);
  }

  return true;
}

/**
 * Zabeleži AI klic — increment-a dnevni + mesečni counter.
 * Stran efekta: tudi reset-a če se je dan/mesec spremenil.
 *
 * @param db Prisma client
 * @param endpointName ime endpointa za logiranje (optional)
 */
export async function recordAiCall(db: PrismaClient, endpointName?: string): Promise<void> {
  const today = getTodayDate();
  const month = getMonthDate();

  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { aiCallsDate: true, aiCallsMonthDate: true },
  });

  if (!settings) return;

  // Daily reset + increment
  if (settings.aiCallsDate !== today) {
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsDate: today, aiCallsToday: 1, aiCallsMonth: settings.aiCallsMonthDate !== month ? 1 : { increment: 1 }, aiCallsMonthDate: month },
    });
  } else if (settings.aiCallsMonthDate !== month) {
    // Monthly reset
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiCallsToday: { increment: 1 }, aiCallsMonth: 1, aiCallsMonthDate: month },
    });
  } else {
    // Samo increment (no reset needed)
    await db.settings.update({
      where: { id: 'singleton' },
      data: {
        aiCallsToday: { increment: 1 },
        aiCallsMonth: { increment: 1 },
      },
    });
  }

  if (endpointName) {
    logger.info('ai-cost', `AI call recorded: ${endpointName}`);
  }

  // v8.94: Samodejno preveri budget threshold (80%) in pošlji alert.
  // Non-blocking — ne throw-a če alert pošiljanje fail-a.
  // Fire-and-forget (ne await-a) da ne zamudi response-a.
  checkAndAlertBudget(db).catch(() => {
    // Silent fail — alert je non-critical
  });
}

/**
 * Vrne AI usage statistiko za dashboard.
 */
export async function getAiUsageStats(db: PrismaClient): Promise<AiUsageStats> {
  const today = getTodayDate();
  const month = getMonthDate();

  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: {
      aiCallsToday: true,
      aiCallsDate: true,
      aiCallsMonth: true,
      aiCallsMonthDate: true,
      aiMaxDailyCalls: true,
      aiMaxMonthlyCalls: true,
      aiBudgetAlertedAt: true,
    },
  });

  // Default če settings ne obstajajo
  const daily = settings && settings.aiCallsDate === today ? settings.aiCallsToday : 0;
  const monthly = settings && settings.aiCallsMonthDate === month ? settings.aiCallsMonth : 0;
  const dailyLimit = settings?.aiMaxDailyCalls ?? 500;
  const monthlyLimit = settings?.aiMaxMonthlyCalls ?? 10000;

  return {
    today: daily,
    month: monthly,
    dailyLimit,
    monthlyLimit,
    dailyRemaining: Math.max(0, dailyLimit - daily),
    monthlyRemaining: Math.max(0, monthlyLimit - monthly),
    dailyPercent: dailyLimit > 0 ? Math.min(100, Math.round((daily / dailyLimit) * 100)) : 0,
    monthlyPercent: monthlyLimit > 0 ? Math.min(100, Math.round((monthly / monthlyLimit) * 100)) : 0,
    dailyResetAt: getTomorrowMidnight(),
    monthlyResetAt: getFirstOfNextMonth(),
    budgetAlerted: !!settings?.aiBudgetAlertedAt,
  };
}

/**
 * Reset vse AI counter-je (za testing ali admin override).
 */
export async function resetAiCounters(db: PrismaClient): Promise<void> {
  const today = getTodayDate();
  const month = getMonthDate();
  await db.settings.update({
    where: { id: 'singleton' },
    data: {
      aiCallsToday: 0,
      aiCallsDate: today,
      aiCallsMonth: 0,
      aiCallsMonthDate: month,
      aiBudgetAlertedAt: '',
    },
  });
  logger.info('ai-cost', 'AI counters reset');
}

/**
 * v8.94: Preveri ali je AI budget presegel 80% threshold in pošlje alert
 * (Telegram/Email/Discord) če še ni bil poslan v zadnjih 24h.
 *
 * Stran efekta:
 * - Če threshold presežen IN ni bil alert-an v zadnjih 24h:
 *   - Pošlje Telegram/Email/Discord obvestilo
 *   - Posodobi `aiBudgetAlertedAt` timestamp (prepreči spam)
 * - Drugače: ne naredi nič
 *
 * Kliče se iz `recordAiCall()` (po vsakem AI klicu).
 * Non-blocking — ne throw-a če alert pošiljanje fail-a.
 *
 * @param db Prisma client
 * @param stats Trenutne AI usage statistike (za izogib duplicate fetch-u)
 */
export async function checkAndAlertBudget(
  db: PrismaClient,
  stats?: AiUsageStats
): Promise<void> {
  try {
    const usage = stats ?? await getAiUsageStats(db);

    // Threshold: 80% daily ALI 80% monthly
    const dailyAlert = usage.dailyPercent >= 80;
    const monthlyAlert = usage.monthlyPercent >= 80;

    if (!dailyAlert && !monthlyAlert) return;

    // Preveri ali je bil alert že poslan v zadnjih 24h (prepreči spam)
    const settings = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: {
        aiBudgetAlertedAt: true,
        telegramEnabled: true, telegramBotToken: true, telegramChatId: true,
        discordEnabled: true, discordWebhookUrl: true,
        emailEnabled: true, emailSmtpHost: true, emailSmtpPort: true,
        emailSmtpUser: true, emailSmtpPassword: true, emailFrom: true, emailTo: true,
      },
    });

    if (settings?.aiBudgetAlertedAt) {
      const lastAlert = new Date(settings.aiBudgetAlertedAt).getTime();
      const hoursSince = (Date.now() - lastAlert) / (60 * 60 * 1000);
      if (hoursSince < 24) return; // Že alert-ano v zadnjih 24h
    }

    // Pošlji alert preko vseh konfiguriranih kanalov
    const alertMsg = buildBudgetAlertMessage(usage);

    // Telegram (če konfiguriran)
    if (settings?.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      try {
        const { sendTelegramMessage } = await import('@/lib/telegram');
        await sendTelegramMessage(
          { botToken: settings.telegramBotToken, chatId: settings.telegramChatId },
          alertMsg,
          { parseMode: null }
        );
        logger.info('ai-cost', 'Budget alert sent via Telegram');
      } catch (err) {
        logger.warn('ai-cost', 'Telegram alert failed (non-critical)', err);
      }
    }

    // Discord (če konfiguriran)
    if (settings?.discordEnabled && settings.discordWebhookUrl) {
      try {
        const { sendDiscordMessage } = await import('@/lib/discord');
        await sendDiscordMessage(
          { webhookUrl: settings.discordWebhookUrl },
          {
            title: '⚠️ AI Budget Alert — 80% dosežen',
            description: alertMsg,
            color: 0xF59E0B, // amber
            timestamp: new Date().toISOString(),
          }
        );
        logger.info('ai-cost', 'Budget alert sent via Discord');
      } catch (err) {
        logger.warn('ai-cost', 'Discord alert failed (non-critical)', err);
      }
    }

    // Email (če konfiguriran)
    if (settings?.emailEnabled && settings.emailSmtpHost && settings.emailTo) {
      try {
        const { sendEmail } = await import('@/lib/email');
        await sendEmail(
          {
            smtpHost: settings.emailSmtpHost,
            smtpPort: settings.emailSmtpPort,
            smtpUser: settings.emailSmtpUser,
            smtpPassword: settings.emailSmtpPassword,
            from: settings.emailFrom,
            to: settings.emailTo,
          },
          '⚠️ AI Budget Alert — 80% dosežen',
          `<pre>${alertMsg}</pre>`
        );
        logger.info('ai-cost', 'Budget alert sent via Email');
      } catch (err) {
        logger.warn('ai-cost', 'Email alert failed (non-critical)', err);
      }
    }

    // Posodobi aiBudgetAlertedAt (prepreči spam za 24h)
    await db.settings.update({
      where: { id: 'singleton' },
      data: { aiBudgetAlertedAt: new Date().toISOString() },
    });
  } catch (err) {
    // Alert failure je non-critical — ne break-a AI funkcionalnosti
    logger.warn('ai-cost', 'Budget alert check failed (non-critical)', err);
  }
}

/**
 * Zgradi human-readable budget alert message.
 */
function buildBudgetAlertMessage(usage: AiUsageStats): string {
  const lines: string[] = [
    '⚠️ AI BUDGET ALERT — 80% dosežen',
    '',
    `📊 Danes: ${usage.today} / ${usage.dailyLimit} (${usage.dailyPercent}%)`,
    `📅 Mesec: ${usage.month} / ${usage.monthlyLimit} (${usage.monthlyPercent}%)`,
    '',
  ];

  if (usage.dailyPercent >= 80) {
    lines.push(`🔴 Dnevni limit skoraj dosežen — še ${usage.dailyRemaining} klicev do limita`);
  }
  if (usage.monthlyPercent >= 80) {
    lines.push(`🔴 Mesečni limit skoraj dosežen — še ${usage.monthlyRemaining} klicev do limita`);
  }

  lines.push('', '💡 Povečaj limit v Nastavitvah ali zmanjšaj AI klice.');
  return lines.join('\n');
}

