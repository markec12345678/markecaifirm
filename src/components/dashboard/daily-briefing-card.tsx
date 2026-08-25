'use client';

// v8.80: Daily Opportunity Briefing — capstone card that unifies all intelligence.
// "Danes: 3 nova ujemanja, 2 held trades za prodajo, dobiček +312€, cilj 62%"

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sun, RefreshCw, TrendingUp, TrendingDown, Search, ShoppingCart, Target, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BriefingData {
  ok: boolean;
  date: string;
  newMatchesToday: number;
  activeBuyRequestsWithMatches: number;
  topBuyRequests: Array<{ id: string; title: string; searchFor: string; newMatchesCount: number }>;
  heldCount: number;
  topSellPriority: Array<{ id: string; title: string; daysHeld: number; buyPrice: number; buyScore: number | null }>;
  soldTodayCount: number;
  todayProfit: number;
  soldYesterdayCount: number;
  yesterdayProfit: number;
  monthProfit: number;
  monthlyGoal: number | null;
  goalProgress: number | null;
  daysRemaining: number;
  actionItems: Array<{ priority: 'high' | 'medium' | 'low'; text: string; link?: string }>;
}

const priorityMeta = {
  high: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30' },
  medium: { icon: Target, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
  low: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' },
};

export function DailyBriefingCard() {
  const { data, loading, error, refetch } = useFetch<BriefingData>('/api/analytics/daily-briefing', { interval: 120000 });

  if (loading) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sun className="w-4 h-4 text-amber-500" /> ☀️ Dnevni Briefing</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sun className="w-4 h-4 text-amber-500" /> ☀️ Dnevni Briefing</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  const dateLabel = new Date(data.date).toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-500" /> ☀️ Dnevni Briefing
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground capitalize">{dateLabel}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Action items — most important part */}
        <div className="space-y-1.5">
          {data.actionItems.map((item, i) => {
            const meta = priorityMeta[item.priority];
            const Icon = meta.icon;
            const content = (
              <div key={i} className={cn('flex items-start gap-2 p-2 rounded-md border text-xs', meta.bg)}>
                <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', meta.color)} />
                <span className="flex-1 text-foreground/80">{item.text}</span>
                {item.link && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />}
              </div>
            );
            return item.link ? (
              <a key={i} href={item.link} className="block hover:opacity-80 transition-opacity">{content}</a>
            ) : content;
          })}
        </div>

        {/* Quick stats grid */}
        <div className="grid grid-cols-4 gap-2 text-center">
          {/* New matches */}
          <a href="/?view=iskalnik" className="bg-muted/20 rounded-lg p-2 hover:bg-muted/40 transition-colors">
            <div className="text-[9px] uppercase text-muted-foreground flex items-center justify-center gap-0.5">
              <Search className="w-2.5 h-2.5" /> Ujemanja
            </div>
            <div className={cn('text-lg font-bold', data.newMatchesToday > 0 ? 'text-primary' : 'text-muted-foreground')}>
              {data.newMatchesToday}
            </div>
            <div className="text-[8px] text-muted-foreground">danes</div>
          </a>

          {/* Held trades */}
          <a href="/?view=trades" className="bg-muted/20 rounded-lg p-2 hover:bg-muted/40 transition-colors">
            <div className="text-[9px] uppercase text-muted-foreground flex items-center justify-center gap-0.5">
              <ShoppingCart className="w-2.5 h-2.5" /> V skladišču
            </div>
            <div className="text-lg font-bold text-amber-500">{data.heldCount}</div>
            <div className="text-[8px] text-muted-foreground">za prodajo</div>
          </a>

          {/* Today's profit */}
          <div className="bg-muted/20 rounded-lg p-2">
            <div className="text-[9px] uppercase text-muted-foreground flex items-center justify-center gap-0.5">
              {data.todayProfit >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />} Danes
            </div>
            <div className={cn('text-lg font-bold font-mono', data.todayProfit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
              {data.todayProfit >= 0 ? '+' : ''}{data.todayProfit.toFixed(0)}€
            </div>
            <div className="text-[8px] text-muted-foreground">{data.soldTodayCount} prodaj</div>
          </div>

          {/* Monthly profit */}
          <div className="bg-muted/20 rounded-lg p-2">
            <div className="text-[9px] uppercase text-muted-foreground flex items-center justify-center gap-0.5">
              <Target className="w-2.5 h-2.5" /> Mesec
            </div>
            <div className={cn('text-lg font-bold font-mono', data.monthProfit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
              {data.monthProfit >= 0 ? '+' : ''}{data.monthProfit.toFixed(0)}€
            </div>
            <div className="text-[8px] text-muted-foreground">
              {data.goalProgress != null ? `${data.goalProgress.toFixed(0)}% cilja` : `${data.daysRemaining}d do konca`}
            </div>
          </div>
        </div>

        {/* Goal progress bar */}
        {data.goalProgress != null && data.monthlyGoal != null && (
          <div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>Mesečni cilj: {data.monthlyGoal}€</span>
              <span className={cn('font-bold', data.goalProgress >= 100 ? 'text-emerald-500' : data.goalProgress >= 50 ? 'text-primary' : 'text-amber-500')}>
                {data.goalProgress.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  data.goalProgress >= 100 ? 'bg-emerald-500' : data.goalProgress >= 50 ? 'bg-primary' : 'bg-amber-500'
                )}
                style={{ width: `${Math.min(100, data.goalProgress)}%` }}
              />
            </div>
          </div>
        )}

        {/* Top sell priority preview */}
        {data.topSellPriority.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1">🔥 Prioriteta za prodajo</div>
            <div className="space-y-1">
              {data.topSellPriority.map((t, i) => (
                <a key={t.id} href={`/?view=trades`} className="flex items-center gap-2 p-1.5 rounded-md border border-border/50 hover:bg-accent/30 transition-colors text-xs">
                  <span className={cn(
                    'shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold',
                    i === 0 ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'
                  )}>
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-medium">{t.title}</span>
                  <span className={cn('text-[10px] font-mono shrink-0', t.daysHeld > 30 ? 'text-red-500' : 'text-amber-500')}>
                    {t.daysHeld}d
                  </span>
                  {t.buyScore != null && (
                    <Badge variant="outline" className="text-[8px] shrink-0">🛒 {t.buyScore}</Badge>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Yesterday summary */}
        {data.soldYesterdayCount > 0 && (
          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
            Včeraj: {data.soldYesterdayCount} prodaj · {data.yesterdayProfit >= 0 ? '+' : ''}{data.yesterdayProfit.toFixed(0)}€
          </div>
        )}
      </CardContent>
    </Card>
  );
}
