// v8.94: Tests za AI Cost Tracking (lib/ai-cost.ts).
//
// Pokrivamo:
// 1. Date helperji (getTodayDate, getMonthDate, getTomorrowMidnight, getFirstOfNextMonth)
// 2. AiBudgetExceeded class
// 3. checkAiBudget() — z mock Prisma client
//    - settings ne obstajajo → dovoli
//    - pod limitom → dovoli
//    - daily limit presežen → throw
//    - monthly limit presežen → throw
//    - reset daily counter ob spremembi dneva
//    - reset monthly counter ob spremembi meseca
// 4. recordAiCall() — z mock
//    - increment daily + monthly
//    - reset + increment ob spremembi dneva
//    - reset + increment ob spremembi meseca
// 5. getAiUsageStats() — z mock
//    - default če settings ne obstajajo
//    - pravilno izračunani procenti, remaining, reset times
// 6. resetAiCounters() — z mock
//
// Mock pristop: ustvarimo minimalen mock object z `settings.findUnique` in
// `settings.update` metodami. PrismaClient tip je preširok za mock-anje,
// zato uporabljamo `as unknown as PrismaClient`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkAiBudget,
  recordAiCall,
  getAiUsageStats,
  resetAiCounters,
  AiBudgetExceeded,
  getTodayDate,
  getMonthDate,
  getTomorrowMidnight,
  getFirstOfNextMonth,
} from '../../src/lib/ai-cost';
import type { PrismaClient } from '@prisma/client';

// --- Mock Prisma Client ---

interface MockSettings {
  aiCallsToday: number;
  aiCallsDate: string;
  aiCallsMonth: number;
  aiCallsMonthDate: string;
  aiMaxDailyCalls: number;
  aiMaxMonthlyCalls: number;
  aiBudgetAlertedAt?: string;
}

interface MockPrisma {
  settings: {
    findUnique: (args: { where: { id: string }; select: Record<string, boolean> }) => Promise<MockSettings | null>;
    update: (args: { where: { id: string }; data: Partial<MockSettings> | { aiCallsToday: { increment: number }; aiCallsMonth: { increment: number } } }) => Promise<{ updatedAt: Date }>;
  };
}

function createMockPrisma(settings: MockSettings | null): MockPrisma {
  let currentSettings = settings ? { ...settings } : null;
  return {
    settings: {
      findUnique: async () => currentSettings ? { ...currentSettings } : null,
      update: async (args) => {
        if (!currentSettings) return { updatedAt: new Date() };
        const data = args.data as any;
        if (data.aiCallsToday && typeof data.aiCallsToday === 'object' && 'increment' in data.aiCallsToday) {
          currentSettings.aiCallsToday += data.aiCallsToday.increment;
        } else if (data.aiCallsToday !== undefined) {
          currentSettings.aiCallsToday = data.aiCallsToday as number;
        }
        if (data.aiCallsMonth && typeof data.aiCallsMonth === 'object' && 'increment' in data.aiCallsMonth) {
          currentSettings.aiCallsMonth += data.aiCallsMonth.increment;
        } else if (data.aiCallsMonth !== undefined) {
          currentSettings.aiCallsMonth = data.aiCallsMonth as number;
        }
        if (data.aiCallsDate !== undefined) currentSettings.aiCallsDate = data.aiCallsDate as string;
        if (data.aiCallsMonthDate !== undefined) currentSettings.aiCallsMonthDate = data.aiCallsMonthDate as string;
        if (data.aiBudgetAlertedAt !== undefined) currentSettings.aiBudgetAlertedAt = data.aiBudgetAlertedAt as string;
        return { updatedAt: new Date() };
      },
    },
  };
}

function defaultSettings(overrides: Partial<MockSettings> = {}): MockSettings {
  return {
    aiCallsToday: 10,
    aiCallsDate: getTodayDate(),
    aiCallsMonth: 150,
    aiCallsMonthDate: getMonthDate(),
    aiMaxDailyCalls: 500,
    aiMaxMonthlyCalls: 10000,
    ...overrides,
  };
}

// --- Tests ---

describe('ai-cost — date helperji', () => {
  it('getTodayDate vrne YYYY-MM-DD format', () => {
    const today = getTodayDate();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today.length).toBe(10);
  });

  it('getMonthDate vrne YYYY-MM format', () => {
    const month = getMonthDate();
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(month.length).toBe(7);
  });

  it('getTomorrowMidnight vrne ISO datum v prihodnosti', () => {
    const before = Date.now();
    const tomorrow = getTomorrowMidnight();
    const after = Date.now();
    const tomorrowMs = new Date(tomorrow).getTime();
    expect(tomorrowMs).toBeGreaterThan(before);
    // naj bi biti ~24h v prihodnosti (znotraj 25h tolerance)
    expect(tomorrowMs).toBeLessThan(after + 25 * 60 * 60 * 1000);
  });

  it('getFirstOfNextMonth vrne ISO datum 1. dne naslednjega meseca', () => {
    const next = getFirstOfNextMonth();
    const nextDate = new Date(next);
    expect(nextDate.getDate()).toBe(1); // 1. dan meseca
    expect(nextDate.getHours()).toBe(0);
    expect(nextDate.getMinutes()).toBe(0);
  });
});

describe('ai-cost — AiBudgetExceeded class', () => {
  it('ima pravilno ime in message', () => {
    const err = new AiBudgetExceeded('daily', 500, 501);
    expect(err.name).toBe('AiBudgetExceeded');
    expect(err.message).toContain('dnevni');
    expect(err.message).toContain('500');
    expect(err.message).toContain('501');
  });

  it('shrani period, limit, current', () => {
    const err = new AiBudgetExceeded('monthly', 10000, 10001);
    expect(err.period).toBe('monthly');
    expect(err.limit).toBe(10000);
    expect(err.current).toBe(10001);
  });

  it('je instanceof Error', () => {
    const err = new AiBudgetExceeded('daily', 100, 101);
    expect(err).toBeInstanceOf(Error);
  });

  it('za daily period message vsebuje "dnevni"', () => {
    const err = new AiBudgetExceeded('daily', 100, 101);
    expect(err.message).toMatch(/dnevni/i);
  });

  it('za monthly period message vsebuje "mesečni"', () => {
    const err = new AiBudgetExceeded('monthly', 100, 101);
    expect(err.message).toMatch(/mesečni|mescni/i);
  });
});

describe('ai-cost — checkAiBudget', () => {
  it('vrne true če settings ne obstajajo (local-first, še ni setup)', async () => {
    const mockPrisma = createMockPrisma(null);
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
  });

  it('vrne true ko pod limitom', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 100,
      aiCallsMonth: 500,
    }));
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
  });

  it('throw-a AiBudgetExceeded ko daily limit presežen', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 500,
      aiCallsMonth: 100,
    }));
    await expect(checkAiBudget(mockPrisma as unknown as PrismaClient)).rejects.toThrow(AiBudgetExceeded);
    try {
      await checkAiBudget(mockPrisma as unknown as PrismaClient);
    } catch (err) {
      expect(err).toBeInstanceOf(AiBudgetExceeded);
      expect((err as AiBudgetExceeded).period).toBe('daily');
    }
  });

  it('throw-a AiBudgetExceeded ko monthly limit presežen', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 100,
      aiCallsMonth: 10000,
    }));
    await expect(checkAiBudget(mockPrisma as unknown as PrismaClient)).rejects.toThrow(AiBudgetExceeded);
    try {
      await checkAiBudget(mockPrisma as unknown as PrismaClient);
    } catch (err) {
      expect(err).toBeInstanceOf(AiBudgetExceeded);
      expect((err as AiBudgetExceeded).period).toBe('monthly');
    }
  });

  it('reset-a daily counter ko se je dan spremenil', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsDate: '2020-01-01', // star datum
      aiCallsToday: 500, // presežen, ampak po reset-u bo 0
    }));
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
  });

  it('reset-a monthly counter ko se je mesec spremenil', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsMonthDate: '2020-01', // star mesec
      aiCallsMonth: 10000, // presežen, ampak po reset-u bo 0
    }));
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
  });

  it('daily limit preveri PREJ monthly (daily ima prednost)', async () => {
    // Oba presežena — daily se preveri prvi
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 500,
      aiCallsMonth: 10000,
    }));
    try {
      await checkAiBudget(mockPrisma as unknown as PrismaClient);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as AiBudgetExceeded).period).toBe('daily');
    }
  });

  it('ne throw-a ko daily = limit - 1 (tik pod)', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 499,
      aiCallsMonth: 100,
    }));
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
  });

  it('ne throw-a ko monthly = limit - 1 (tik pod)', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 100,
      aiCallsMonth: 9999,
    }));
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
  });
});

describe('ai-cost — recordAiCall', () => {
  it('increment-a daily + monthly counter', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 10,
      aiCallsMonth: 150,
    }));
    await recordAiCall(mockPrisma as unknown as PrismaClient, '/api/ai/test');
    // Po klicu naj bi bila settings.update klicana z increment
    // (mock sam posodobi internal state)
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.today).toBe(11);
    expect(stats.month).toBe(151);
  });

  it('reset-a daily counter ob spremembi dneva', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsDate: '2020-01-01',
      aiCallsToday: 500,
      aiCallsMonth: 150,
    }));
    await recordAiCall(mockPrisma as unknown as PrismaClient);
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.today).toBe(1); // reset + 1
  });

  it('reset-a monthly counter ob spremembi meseca', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsMonthDate: '2020-01',
      aiCallsMonth: 10000,
      aiCallsToday: 10,
    }));
    await recordAiCall(mockPrisma as unknown as PrismaClient);
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.month).toBe(1); // reset + 1
  });

  it('ne fail-a če settings ne obstajajo', async () => {
    const mockPrisma = createMockPrisma(null);
    // Ne sme throw-at
    await recordAiCall(mockPrisma as unknown as PrismaClient);
  });
});

describe('ai-cost — getAiUsageStats', () => {
  it('vrne default stats če settings ne obstajajo', async () => {
    const mockPrisma = createMockPrisma(null);
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.today).toBe(0);
    expect(stats.month).toBe(0);
    expect(stats.dailyLimit).toBe(500);
    expect(stats.monthlyLimit).toBe(10000);
  });

  it('vrne pravilne counts', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 150,
      aiCallsMonth: 3000,
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.today).toBe(150);
    expect(stats.month).toBe(3000);
    expect(stats.dailyLimit).toBe(500);
    expect(stats.monthlyLimit).toBe(10000);
  });

  it('izračuna remaining pravilno', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 100,
      aiCallsMonth: 2000,
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.dailyRemaining).toBe(400); // 500 - 100
    expect(stats.monthlyRemaining).toBe(8000); // 10000 - 2000
  });

  it('izračuna procent pravilno', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 250, // 50% od 500
      aiCallsMonth: 5000, // 50% od 10000
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.dailyPercent).toBe(50);
    expect(stats.monthlyPercent).toBe(50);
  });

  it('remaining nikoli ne gre pod 0', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 600, // preseženo
      aiCallsMonth: 11000,
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.dailyRemaining).toBe(0);
    expect(stats.monthlyRemaining).toBe(0);
  });

  it('procent je max 100 (clamp)', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 600,
      aiCallsMonth: 11000,
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.dailyPercent).toBe(100);
    expect(stats.monthlyPercent).toBe(100);
  });

  it('vrne dailyResetAt in monthlyResetAt ISO datume', async () => {
    const mockPrisma = createMockPrisma(defaultSettings());
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.dailyResetAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(stats.monthlyResetAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // dailyReset je v prihodnosti
    expect(new Date(stats.dailyResetAt).getTime()).toBeGreaterThan(Date.now());
    // monthlyReset je v prihodnosti
    expect(new Date(stats.monthlyResetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('vrne budgetAlerted pravilno', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiBudgetAlertedAt: '2026-01-01T00:00:00.000Z',
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.budgetAlerted).toBe(true);
  });

  it('vrne budgetAlerted=false ko aiBudgetAlertedAt prazen', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiBudgetAlertedAt: '',
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.budgetAlerted).toBe(false);
  });

  it('reset-a daily count v stats če se je dan spremenil', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsDate: '2020-01-01',
      aiCallsToday: 500,
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.today).toBe(0); // ker je datum star
  });

  it('reset-a monthly count v stats če se je mesec spremenil', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsMonthDate: '2020-01',
      aiCallsMonth: 10000,
    }));
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.month).toBe(0); // ker je mesec star
  });
});

describe('ai-cost — resetAiCounters', () => {
  it('reset-a vse counter-je na 0 + nastavi datum', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 500,
      aiCallsMonth: 10000,
      aiBudgetAlertedAt: '2026-01-01T00:00:00.000Z',
    }));
    await resetAiCounters(mockPrisma as unknown as PrismaClient);
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.today).toBe(0);
    expect(stats.month).toBe(0);
    expect(stats.budgetAlerted).toBe(false);
  });

  it('ne fail-a če settings ne obstajajo', async () => {
    const mockPrisma = createMockPrisma(null);
    // update bo klican na neobstoječ settings — mock vrne samo updatedAt
    await resetAiCounters(mockPrisma as unknown as PrismaClient);
  });
});

// --- Edge cases ---

describe('ai-cost — edge cases', () => {
  it('handle-a limit = 0 (teoretično nemogoče zaradi validacije, ampak ne crash-a)', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 0,
      aiCallsMonth: 0,
      aiMaxDailyCalls: 0,
      aiMaxMonthlyCalls: 0,
    }));
    // limit=0, calls=0 → 0 >= 0 → throw
    await expect(checkAiBudget(mockPrisma as unknown as PrismaClient)).rejects.toThrow(AiBudgetExceeded);
  });

  it('handle-a very large numbers brez overflow-a', async () => {
    const mockPrisma = createMockPrisma(defaultSettings({
      aiCallsToday: 999999,
      aiCallsMonth: 9999999,
      aiMaxDailyCalls: 1000000,
      aiMaxMonthlyCalls: 10000000,
    }));
    const result = await checkAiBudget(mockPrisma as unknown as PrismaClient);
    expect(result).toBe(true);
    const stats = await getAiUsageStats(mockPrisma as unknown as PrismaClient);
    expect(stats.dailyPercent).toBe(100); // 999999/1000000 = ~100%
  });
});
