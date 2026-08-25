'use client';

/**
 * v9.56: Gamification Widget — streaks, badges, level system.
 *
 * Navdih: Duolingo, Strava, GitHub contributions.
 * Cilj: povečati engagement z gamification elementi.
 *
 * Prikaz v Pregled tab-u:
 * - Level badge + progress bar
 * - Current streak (🔥 flame)
 * - Badge grid (doseženi + nedoseženi z progress)
 * - Recent achievements
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame, Trophy, Lock, Star, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface ProgressToNext {
  tradesProgress: number;
  profitProgress: number;
  overallProgress: number;
  tradesCurrent: number;
  tradesTarget: number;
  profitCurrent: number;
  profitTarget: number;
}

interface GamificationData {
  ok: true;
  level: Level;
  nextLevel: Level | null;
  progressToNext: ProgressToNext | null;
  streak: {
    current: number;
    longest: number;
    todayActive: boolean;
  };
  badges: Badge[];
  stats: {
    unlocked: number;
    total: number;
    percentage: number;
  };
  recentAchievements: Array<{ id: string; name: string; icon: string; unlockedAt: string }>;
}

const CATEGORY_LABELS: Record<Badge['category'], string> = {
  trades: 'Trgovine',
  profit: 'Dobiček',
  streak: 'Streak',
  ai: 'AI',
  goals: 'Cilji',
  special: 'Posebno',
};

const CATEGORY_COLORS: Record<Badge['category'], string> = {
  trades: 'text-emerald-500',
  profit: 'text-amber-500',
  streak: 'text-red-500',
  ai: 'text-sky-500',
  goals: 'text-primary',
  special: 'text-purple-500',
};

export function GamificationWidget() {
  const [data, setData] = useState<GamificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/gamification');
        if (!res.ok) throw new Error('Napaka pri nalaganju');
        const json = await res.json();
        if (!cancelled && json.ok) {
          setData(json);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 120_000); // refresh vsakih 2 min
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-24 bg-muted/30 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="bg-card/50 border-destructive/30">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Gamification podatki trenutno niso na voljo.
        </CardContent>
      </Card>
    );
  }

  const { level, nextLevel, progressToNext, streak, badges, stats, recentAchievements } = data;
  const unlockedBadges = badges.filter((b) => b.unlocked);
  const lockedBadges = badges.filter((b) => !b.unlocked);

  return (
    <Card className="bg-card/50 border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          Tvoji Dosežki
          <Badge className="ml-auto bg-primary/10 text-primary border-primary/30 text-[10px]">
            {stats.unlocked}/{stats.total}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Level + Streak summary */}
        <div className="grid grid-cols-2 gap-3">
          {/* Level */}
          <div className="flex items-center gap-3 p-3 rounded-md bg-background/50 border border-border">
            <div className="text-3xl">{level.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase text-muted-foreground font-bold">Level {level.level}</div>
              <div className="text-sm font-bold text-primary truncate">{level.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{level.description}</div>
            </div>
          </div>

          {/* Streak */}
          <div className="flex items-center gap-3 p-3 rounded-md bg-background/50 border border-border">
            <div className="relative">
              <Flame
                className={cn(
                  'w-8 h-8',
                  streak.current > 0 ? 'text-red-500' : 'text-muted-foreground/40'
                )}
              />
              {streak.todayActive && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase text-muted-foreground font-bold">Streak</div>
              <div className="text-2xl font-bold text-foreground">{streak.current}</div>
              <div className="text-[10px] text-muted-foreground">
                {streak.todayActive ? 'Aktiven danes' : 'Še aktiviraj danes'}
              </div>
            </div>
          </div>
        </div>

        {/* Progress to next level */}
        {nextLevel && progressToNext && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Napredek do <span className="text-primary font-bold">{nextLevel.icon} {nextLevel.name}</span></span>
              <span>{progressToNext.overallProgress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-amber-500 transition-all duration-500"
                style={{ width: `${progressToNext.overallProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/70">
              <span>📅 {progressToNext.tradesCurrent}/{progressToNext.tradesTarget} prodaj</span>
              <span>💰 {progressToNext.profitCurrent}€/{progressToNext.profitTarget}€</span>
            </div>
          </div>
        )}

        {/* Recent achievements (if any) */}
        {recentAchievements.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <Star className="w-3 h-3 text-amber-500" />
              Zadnji dosežki
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentAchievements.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-xs"
                  title={`${a.name} — ${new Date(a.unlockedAt).toLocaleDateString('sl-SI')}`}
                >
                  <span>{a.icon}</span>
                  <span className="text-amber-500 font-medium">{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Badge grid — collapsed prikazuje samo unlocked + 3 locked, expanded prikazuje vse */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center justify-between">
            <span>Odlikovanja ({stats.percentage}%)</span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-primary hover:underline normal-case"
              aria-label={expanded ? 'Skrči' : 'Razširi'}
            >
              {expanded ? 'Skrči ↑' : 'Razširi ↓'}
            </button>
          </div>

          <div className={cn('grid grid-cols-4 sm:grid-cols-6 gap-2', !expanded && 'line-clamp-2')}>
            {(expanded ? badges : [...unlockedBadges, ...lockedBadges.slice(0, 6 - unlockedBadges.length)]).map((badge) => (
              <div
                key={badge.id}
                className={cn(
                  'aspect-square rounded-md flex flex-col items-center justify-center p-1.5 border transition-all',
                  badge.unlocked
                    ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50'
                    : 'bg-muted/20 border-border opacity-50 hover:opacity-80'
                )}
                title={`${badge.icon} ${badge.name} — ${badge.description}${badge.unlocked ? '' : ` (${badge.progress?.current ?? 0}/${badge.progress?.target ?? '?'})`}`}
              >
                <div className={cn('text-xl mb-0.5', !badge.unlocked && 'grayscale opacity-60')}>
                  {badge.unlocked ? badge.icon : <Lock className="w-4 h-4 mx-auto text-muted-foreground" />}
                </div>
                <div className={cn('text-[8px] uppercase font-bold text-center leading-tight', badge.unlocked ? 'text-amber-500' : 'text-muted-foreground')}>
                  {badge.name}
                </div>
                {/* Progress bar za locked badges */}
                {!badge.unlocked && badge.progress && (
                  <div className="w-full h-0.5 bg-muted rounded-full mt-0.5 overflow-hidden">
                    <div
                      className="h-full bg-muted-foreground/50"
                      style={{
                        width: `${Math.min(100, ((badge.progress.current || 0) / badge.progress.target) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Streak stats (only in expanded) */}
        {expanded && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-center">
            <div>
              <div className="text-lg font-bold text-red-500">{streak.longest}</div>
              <div className="text-[9px] uppercase text-muted-foreground">Najdaljši streak</div>
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-500">{stats.unlocked}</div>
              <div className="text-[9px] uppercase text-muted-foreground">Doseženi badge-i</div>
            </div>
            <div>
              <div className="text-lg font-bold text-primary">{level.level}</div>
              <div className="text-[9px] uppercase text-muted-foreground">Level</div>
            </div>
          </div>
        )}

        {/* Hint */}
        <div className="text-[10px] text-muted-foreground/70 text-center pt-1 border-t border-border/50">
          💡 Aktivnost = dodajanje trade-ov, poganjanje monitorjev, prejemanje alertov
        </div>
      </CardContent>
    </Card>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold', className)}>
      {children}
    </span>
  );
}
