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
    super(`AI ${period}ni budget presežen: ${current}/${limit} klicev`);
    this.name = 'AiBudgetExceeded';
    this.period = period;
    this.limit = limit;
    this.current = current;
  }
}

// --- Helperji ---

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getMonthDate(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getTomorrowMidnight(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

function getFirstOfNextMonth(): string {
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
