'use client';

// v8.97: Sourcing Brain section extracted from ai-hub-view.tsx (v8.18, purple/violet).
// Self-contained — fetches /api/ai/brain/sourcing on mount, renders top 3 actions
// + 30d/90d sourcing projection (recommendedSourceToScale/Reduce + projectedTotalMonthlyProfit).

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Target, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SourcingBrainResult } from './types';
import { gradeColor, confidenceColor } from './utils';

export function SourcingBrainSection() {
  const [data, setData] = useState<SourcingBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/sourcing', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SourcingBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Target className="w-4 h-4 text-purple-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🎯 SOURCING BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400 shrink-0">
          v8.18
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-purple-500/10" />
          <Skeleton className="h-3 w-3/4 bg-purple-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-purple-500/10" />
            <Skeleton className="h-6 bg-purple-500/10" />
            <Skeleton className="h-6 bg-purple-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.sourcingGrade))}>
              Sourcing: {data.maximization.sourcingGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 dark:text-purple-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-purple-600 dark:text-purple-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current sourcing state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-purple-500/20">
            <span className="text-muted-foreground">
              Virov: <span className="font-bold text-foreground">{data.current.sourceCount}</span>
            </span>
            <span className="text-muted-foreground">
              Najboljši: <span className="font-bold text-purple-600 dark:text-purple-400">{data.current.bestSource}</span>
            </span>
            <span className="text-muted-foreground">
              Najslabši: <span className="font-bold text-foreground">{data.current.worstSource}</span>
            </span>
            <span className="text-muted-foreground">
              Koncentracija: <span className="font-bold text-purple-600 dark:text-purple-400">{Math.round(data.current.concentrationPct)}%</span>
            </span>
          </div>

          {/* 30d / 90d sourcing projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-purple-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-purple-600 dark:text-purple-400">
                ↑ {data.maximization.projection30d.recommendedSourceToScale} · ↓ {data.maximization.projection30d.recommendedSourceToReduce}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-purple-600 dark:text-purple-400">
                {Math.round(data.maximization.projection90d.projectedTotalMonthlyProfit)}€/mo
                {data.maximization.projection90d.recommendedNewSource ? ` · +${data.maximization.projection90d.recommendedNewSource}` : ''}
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
