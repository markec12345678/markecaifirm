'use client';

// v8.94: AI Usage Widget — prikazuje dnevno/mesečno AI porabo z budget progress bar.
// Nahaja se na vrhu dashboard-a da uporabnik vedno vidi, koliko AI budget-a je porabil.
//
// Prikaže:
// - Danes: X / Y klicev (Z%)
// - Mesec: X / Y klicev (Z%)
// - Progress bar z barvami: zelena (<70%), rumena (70-90%), rdeča (>90%)
// - Reset countdown: "Reset če 8h 23min"
//
// API: GET /api/ai-usage → { ok, usage: AiUsageStats }

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Zap, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface AiUsageData {
  ok: boolean;
  usage: {
    today: number;
    month: number;
    dailyLimit: number;
    monthlyLimit: number;
    dailyRemaining: number;
    monthlyRemaining: number;
    dailyPercent: number;
    monthlyPercent: number;
    dailyResetAt: string;
    monthlyResetAt: string;
    budgetAlerted: boolean;
  };
}

/**
 * Vrne barvo za progress bar glede na procent porabe.
 * - <70%: emerald (vse OK)
 * - 70-90%: amber (pozor)
 * - >90%: red (kritično)
 */
function getProgressColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/**
 * Formatira preostali čas do reset-a (npr. "8h 23min" ali "15min").
 */
function formatTimeUntil(isoDate: string): string {
  const target = new Date(isoDate).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return 'zdaj';
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

export function AiUsageWidget() {
  const { data, loading, error, refetch } = useFetch<AiUsageData>('/api/ai-usage', { interval: 60000 });
  // Tick za "reset če X" countdown — refresh vsako minuto
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> AI Poraba
          </CardTitle>
        </CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }

  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> AI Poraba
          </CardTitle>
        </CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  const u = data.usage;
  const dailyCritical = u.dailyPercent >= 90;
  const monthlyCritical = u.monthlyPercent >= 90;
  const anyCritical = dailyCritical || monthlyCritical;

  return (
    <Card className={cn(
      "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent transition-colors",
      anyCritical && "border-red-500/50 from-red-500/5"
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className={cn("w-4 h-4", anyCritical ? "text-red-500 animate-pulse" : "text-primary")} />
            AI Poraba
            {anyCritical && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                BUDGET
              </Badge>
            )}
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch} aria-label="Osveži AI porabo">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Daily usage */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Danes</span>
            <span className={cn(
              "font-mono tabular-nums",
              dailyCritical ? "text-red-500 font-bold" : "text-foreground"
            )}>
              {u.today} <span className="text-muted-foreground">/ {u.dailyLimit}</span>
            </span>
          </div>
          <div className="relative">
            <Progress
              value={u.dailyPercent}
              className="h-1.5"
            />
            {/* Override indicator color (Progress component uporablja bg-primary) */}
            <div
              className={cn("absolute top-0 left-0 h-1.5 rounded-full transition-all", getProgressColor(u.dailyPercent))}
              style={{ width: `${u.dailyPercent}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between text-[10px] text-muted-foreground">
            <span>{u.dailyPercent}%</span>
            <span>Reset če {formatTimeUntil(u.dailyResetAt)}</span>
          </div>
        </div>

        {/* Monthly usage */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Mesec</span>
            <span className={cn(
              "font-mono tabular-nums",
              monthlyCritical ? "text-red-500 font-bold" : "text-foreground"
            )}>
              {u.month} <span className="text-muted-foreground">/ {u.monthlyLimit}</span>
            </span>
          </div>
          <div className="relative">
            <Progress
              value={u.monthlyPercent}
              className="h-1.5"
            />
            <div
              className={cn("absolute top-0 left-0 h-1.5 rounded-full transition-all", getProgressColor(u.monthlyPercent))}
              style={{ width: `${u.monthlyPercent}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between text-[10px] text-muted-foreground">
            <span>{u.monthlyPercent}%</span>
            <span>
              {u.monthlyRemaining > 0
                ? `Še ${u.monthlyRemaining} klicev`
                : 'Limit presežen'}
            </span>
          </div>
        </div>

        {/* Warning alert če critical */}
        {anyCritical && (
          <div className="flex items-start gap-2 text-[10px] text-red-500 bg-red-500/10 border border-red-500/20 rounded p-1.5">
            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            <span>
              {dailyCritical && 'Dnevni AI limit skoraj dosežen. '}
              {monthlyCritical && 'Mesečni limit skoraj dosežen — upočasni ali povečaj v Nastavitvah.'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
