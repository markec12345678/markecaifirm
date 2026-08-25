// v9.56: Gamification API — streaks, badges, level system.
//
// Navdih: Duolingo, Strava, GitHub contributions (62% več MAU po raziskavi).
// Cilj: povečati engagement z gamification elementi.
//
// Endpoint: GET /api/gamification
// Returns: { ok, level, streak, badges, nextLevel, progress, recentAchievements }
//
// Izračunava vse iz obstoječih podatkov (brez novega DB modela):
// - Trade model → trade badges (first sale, 10 sales, profit milestones)
// - RunLog model → streak tracking (daily activity)
// - Settings.aiCallsToday → AI usage badges
// - Alert model → alert-related badges

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'trades' | 'profit' | 'streak' | 'ai' | 'goals' | 'special';
  unlocked: boolean;
  unlockedAt?: string;
  progress?: { current: number; target: number };
}

interface Level {
  level: number;
  name: string;
  icon: string;
  description: string;
  minTrades: number;
  minProfit: number;
}

const LEVELS: Level[] = [
  { level: 1, name: 'Beginner', icon: '🌱', description: 'Začetnik — še nimaš prodaj', minTrades: 0, minProfit: 0 },
  { level: 2, name: 'Trader', icon: '🛒', description: 'Trader — prvi koraki', minTrades: 1, minProfit: 0 },
  { level: 3, name: 'Pro', icon: '⭐', description: 'Pro Trader — 10+ prodaj', minTrades: 10, minProfit: 0 },
  { level: 4, name: 'Expert', icon: '🏆', description: 'Expert — 25+ prodaj in 500€ profit', minTrades: 25, minProfit: 500 },
  { level: 5, name: 'Master', icon: '👑', description: 'Master — 50+ prodaj in 1000€ profit', minTrades: 50, minProfit: 1000 },
  { level: 6, name: 'Legend', icon: '💎', description: 'Legend — 100+ prodaj in 5000€ profit', minTrades: 100, minProfit: 5000 },
];

interface ProgressToNext {
  tradesProgress: number;
  profitProgress: number;
  overallProgress: number;
  tradesCurrent: number;
  tradesTarget: number;
  profitCurrent: number;
  profitTarget: number;
}

export async function GET() {
  try {
    const [soldTrades, allTrades, runLogs, settings, alerts] = await Promise.all([
      db.trade.findMany({
        where: { status: 'sold', sellPrice: { not: null } },
        select: {
          id: true, title: true, buyPrice: true, buyFees: true,
          sellPrice: true, sellFees: true, sellDate: true, buyDate: true,
          buyScore: true, category: true,
        },
        orderBy: { sellDate: 'desc' },
      }),
      db.trade.findMany({
        select: { id: true, createdAt: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.runLog.findMany({
        select: { id: true, startedAt: true, status: true },
        orderBy: { startedAt: 'desc' },
        take: 200,
      }),
      db.settings.findFirst({
        select: { aiCallsToday: true, aiCallsDate: true, monthlyProfitGoal: true },
      }),
      db.alert.findMany({
        select: { id: true, createdAt: true, aiVerdict: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    // --- 1. CALCULATE PROFIT ---
    const totalProfit = soldTrades.reduce((sum, t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return sum + (revenue - cost);
    }, 0);

    // --- 2. CALCULATE LEVEL ---
    let currentLevel = LEVELS[0];
    let nextLevel: Level | null = null;
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = LEVELS[i];
      if (soldTrades.length >= lvl.minTrades && totalProfit >= lvl.minProfit) {
        currentLevel = lvl;
        nextLevel = i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
      }
    }

    let progressToNext: ProgressToNext | null = null;
    if (nextLevel) {
      const tradesProgress = Math.min(100, (soldTrades.length / nextLevel.minTrades) * 100);
      const profitProgress = totalProfit >= 0 ? Math.min(100, (totalProfit / nextLevel.minProfit) * 100) : 0;
      progressToNext = {
        tradesProgress: Math.round(tradesProgress),
        profitProgress: Math.round(profitProgress),
        overallProgress: Math.round(Math.min(tradesProgress, profitProgress)),
        tradesCurrent: soldTrades.length,
        tradesTarget: nextLevel.minTrades,
        profitCurrent: Math.round(totalProfit),
        profitTarget: nextLevel.minProfit,
      };
    }

    // --- 3. CALCULATE STREAK ---
    const activityDates = new Set<string>();
    for (const t of allTrades) {
      activityDates.add(t.createdAt.toISOString().slice(0, 10));
    }
    for (const r of runLogs) {
      activityDates.add(r.startedAt.toISOString().slice(0, 10));
    }
    for (const a of alerts) {
      activityDates.add(a.createdAt.toISOString().slice(0, 10));
    }

    let currentStreak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      if (activityDates.has(dateStr)) {
        currentStreak++;
      } else if (i > 0) {
        break;
      }
    }

    const sortedDates = Array.from(activityDates).sort();
    let longestStreak = 0;
    let tempStreak = 0;
    let prevDate: string | null = null;
    for (const dateStr of sortedDates) {
      if (prevDate) {
        const prev = new Date(prevDate);
        const curr = new Date(dateStr);
        const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          tempStreak++;
        } else {
          if (tempStreak > longestStreak) longestStreak = tempStreak;
          tempStreak = 1;
        }
      } else {
        tempStreak = 1;
      }
      prevDate = dateStr;
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak;

    // --- 4. BADGES ---
    const firstTrade = allTrades[0];
    const profitableCount = soldTrades.filter((t) => {
      const cost = t.buyPrice + (t.buyFees ?? 0);
      const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
      return revenue - cost > 0;
    }).length;
    const winRate = soldTrades.length > 0 ? (profitableCount / soldTrades.length) * 100 : 0;
    const aiCallsTotal = settings?.aiCallsToday ?? 0;

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthProfit = soldTrades
      .filter((t) => t.sellDate && new Date(t.sellDate) >= thisMonthStart)
      .reduce((sum, t) => {
        const cost = t.buyPrice + (t.buyFees ?? 0);
        const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0);
        return sum + (revenue - cost);
      }, 0);
    const monthlyGoal = settings?.monthlyProfitGoal ?? 500;
    const goalAchieved = thisMonthProfit >= monthlyGoal && monthlyGoal > 0;

    const badges: Badge[] = [
      { id: 'first-trade', name: 'Prvi Trade', description: 'Dodaj svoj prvi trade v skladišče', icon: '🛒', category: 'trades', unlocked: allTrades.length >= 1, unlockedAt: firstTrade?.createdAt?.toISOString() },
      { id: '10-trades', name: 'Distributor', description: 'Zaključi 10 prodaj', icon: '📦', category: 'trades', unlocked: soldTrades.length >= 10, progress: { current: soldTrades.length, target: 10 } },
      { id: '25-trades', name: 'Trgovina', description: 'Zaključi 25 prodaj', icon: '🏪', category: 'trades', unlocked: soldTrades.length >= 25, progress: { current: soldTrades.length, target: 25 } },
      { id: '50-trades', name: 'Ekspert', description: 'Zaključi 50 prodaj', icon: '🎖️', category: 'trades', unlocked: soldTrades.length >= 50, progress: { current: soldTrades.length, target: 50 } },
      { id: '100-trades', name: 'Legendarni Trader', description: 'Zaključi 100 prodaj', icon: '💯', category: 'trades', unlocked: soldTrades.length >= 100, progress: { current: soldTrades.length, target: 100 } },
      { id: 'first-100', name: 'Prvi €100', description: 'Ustvari 100€ skupnega profita', icon: '💰', category: 'profit', unlocked: totalProfit >= 100, progress: { current: Math.round(totalProfit), target: 100 } },
      { id: 'first-500', name: '€500 Profit', description: 'Ustvari 500€ skupnega profita', icon: '💎', category: 'profit', unlocked: totalProfit >= 500, progress: { current: Math.round(totalProfit), target: 500 } },
      { id: 'first-1000', name: '€1000 Profit', description: 'Ustvari 1000€ skupnega profita', icon: '🏆', category: 'profit', unlocked: totalProfit >= 1000, progress: { current: Math.round(totalProfit), target: 1000 } },
      { id: 'first-5000', name: '€5000 Profit', description: 'Ustvari 5000€ skupnega profita', icon: '👑', category: 'profit', unlocked: totalProfit >= 5000, progress: { current: Math.round(totalProfit), target: 5000 } },
      { id: 'streak-7', name: 'Teden Aktivnosti', description: '7 dni zapored z aktivnostjo', icon: '🔥', category: 'streak', unlocked: longestStreak >= 7, progress: { current: longestStreak, target: 7 } },
      { id: 'streak-30', name: 'Mesec Aktivnosti', description: '30 dni zapored z aktivnostjo', icon: '⚡', category: 'streak', unlocked: longestStreak >= 30, progress: { current: longestStreak, target: 30 } },
      { id: 'streak-100', name: 'Sto Dni', description: '100 dni zapored z aktivnostjo', icon: '🌟', category: 'streak', unlocked: longestStreak >= 100, progress: { current: longestStreak, target: 100 } },
      { id: 'first-ai', name: 'AI Pionir', description: 'Izvedi prvo AI analizo', icon: '🤖', category: 'ai', unlocked: aiCallsTotal >= 1, progress: { current: aiCallsTotal, target: 1 } },
      { id: 'ai-100', name: 'AI Navdušenec', description: 'Izvedi 100 AI analiz', icon: '🧠', category: 'ai', unlocked: aiCallsTotal >= 100, progress: { current: aiCallsTotal, target: 100 } },
      { id: 'goal-achieved', name: 'Cilj Dosežen', description: 'Doseži mesečni cilj dobička', icon: '🎯', category: 'goals', unlocked: goalAchieved, progress: { current: Math.round(thisMonthProfit), target: monthlyGoal } },
      { id: 'goal-exceeded', name: 'Cilj Presežen', description: 'Presegi mesečni cilj za 20%', icon: '🚀', category: 'goals', unlocked: goalAchieved && thisMonthProfit >= monthlyGoal * 1.2, progress: { current: Math.round(thisMonthProfit), target: Math.round(monthlyGoal * 1.2) } },
      { id: 'win-rate-90', name: 'Win Master', description: 'Dosegni 90%+ win rate (min 5 prodaj)', icon: '🎯', category: 'special', unlocked: soldTrades.length >= 5 && winRate >= 90, progress: { current: Math.round(winRate), target: 90 } },
      { id: 'first-loss', name: 'Prva Izguba', description: 'Prvi trade z izgubo (del učenja)', icon: '📉', category: 'special', unlocked: soldTrades.some((t) => { const cost = t.buyPrice + (t.buyFees ?? 0); const revenue = (t.sellPrice ?? 0) - (t.sellFees ?? 0); return revenue - cost < 0; }) },
      { id: 'category-master', name: 'Kategorija Mojster', description: '5+ prodaj v eni kategoriji', icon: '🏷️', category: 'special', unlocked: (() => { const byCat: Record<string, number> = {}; for (const t of soldTrades) { const cat = t.category || 'drugo'; byCat[cat] = (byCat[cat] ?? 0) + 1; if (byCat[cat] >= 5) return true; } return false; })() },
    ];

    const unlockedBadges = badges.filter((b) => b.unlocked && b.unlockedAt);
    const recentAchievements = unlockedBadges
      .sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''))
      .slice(0, 5)
      .map((b) => ({ id: b.id, name: b.name, icon: b.icon, unlockedAt: b.unlockedAt! }));

    const unlockedCount = badges.filter((b) => b.unlocked).length;
    const totalCount = badges.length;

    return NextResponse.json({
      ok: true,
      level: currentLevel,
      nextLevel,
      progressToNext,
      streak: {
        current: currentStreak,
        longest: longestStreak,
        todayActive: activityDates.has(today.toISOString().slice(0, 10)),
      },
      badges,
      stats: {
        unlocked: unlockedCount,
        total: totalCount,
        percentage: Math.round((unlockedCount / totalCount) * 100),
      },
      recentAchievements,
      summary: {
        totalTrades: allTrades.length,
        soldTrades: soldTrades.length,
        totalProfit: Math.round(totalProfit),
        winRate: Math.round(winRate),
        level: currentLevel.level,
        levelName: currentLevel.name,
        levelIcon: currentLevel.icon,
        streak: currentStreak,
        badgesUnlocked: unlockedCount,
        badgesTotal: totalCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('/api/gamification', 'GET failed', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Napaka pri pridobivanju gamification podatkov' },
      { status: 500 }
    );
  }
}
