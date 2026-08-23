'use client';

// v8.97: Actual Profit Card extracted from ai-hub-view.tsx (v8.23).
// GROUND TRUTH: actual EUR profit from Trade table (status='sold', sellDate within N days).
// Days selector: 7d / 30d / 90d / 12m. Fetches /api/ai/brain/actual-profit.
// Local const ACTUAL_PROFIT_DAYS_PRESETS co-located.

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, AlertCircle, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActualProfitResponse } from './types';

const ACTUAL_PROFIT_DAYS_PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '12m', days: 365 },
] as const;

export function ActualProfitCard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ActualProfitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActual = useCallback(async (selectedDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/brain/actual-profit?days=${selectedDays}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ActualProfitResponse;
      if (!json?.ok) throw new Error('Actual profit API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActual(days);
  }, [days, fetchActual]);

  const profitPositive = (data?.totalProfitEUR ?? 0) >= 0;

  return (
    <div className="rounded-xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-purple-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📊 Dejanski profit
          </span>
          <Badge variant="outline" className="text-[10px] border-indigo-500/50 text-indigo-700 dark:text-indigo-400 shrink-0 font-bold">
            v8.23
          </Badge>
          <Badge variant="outline" className="text-[9px] border-indigo-500/30 text-indigo-700/80 dark:text-indigo-400/80 shrink-0">
            GROUND TRUTH
          </Badge>
        </div>

        {/* Days selector: 7d / 30d / 90d / 12m */}
        <div className="flex items-center gap-0.5 bg-background/50 rounded-md border border-indigo-500/20 p-0.5">
          {ACTUAL_PROFIT_DAYS_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono font-semibold rounded transition-colors',
                days === p.days
                  ? 'bg-indigo-500/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-muted-foreground hover:text-foreground hover:bg-indigo-500/10',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full bg-indigo-500/10" />
          <Skeleton className="h-4 w-3/4 bg-indigo-500/10" />
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={() => fetchActual(days)} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Big profit number */}
          <div className="text-center px-1">
            <div className={cn(
              'text-3xl sm:text-4xl font-bold font-mono tracking-tight',
              profitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}>
              {profitPositive ? '+' : ''}{data.totalProfitEUR}€
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {data.dailyAvgEUR >= 0 ? '+' : ''}{data.dailyAvgEUR}€/dan · {data.tradeCount} {data.tradeCount === 1 ? 'trade' : 'trade-ov'} · {data.avgProfitPerTradeEUR}€/trade · {data.avgMarginPct}% margin
            </div>
          </div>

          {/* Metrics grid: revenue / cost / margin / daily avg */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Prihodek</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {Math.round(data.totalRevenueEUR)}€
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Stroški</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {Math.round(data.totalCostEUR)}€
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Margin</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {data.avgMarginPct}%
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Na dan</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {data.dailyAvgEUR}€
              </div>
            </div>
          </div>

          {/* Best / worst trade pills */}
          {(data.bestTrade || data.worstTrade) && (
            <div className="flex flex-wrap gap-2 justify-center text-[10px]">
              {data.bestTrade && (
                <div className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5">
                  <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">Naj:</span>
                  <span className="font-semibold truncate max-w-[140px]" title={data.bestTrade.title}>
                    {data.bestTrade.title}
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    +{data.bestTrade.profitEUR}€
                  </span>
                </div>
              )}
              {data.worstTrade && (
                <div className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/5 px-2 py-0.5">
                  <ArrowDownRight className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-muted-foreground">Slab:</span>
                  <span className="font-semibold truncate max-w-[140px]" title={data.worstTrade.title}>
                    {data.worstTrade.title}
                  </span>
                  <span className={cn(
                    'font-bold',
                    data.worstTrade.profitEUR >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400',
                  )}>
                    {data.worstTrade.profitEUR >= 0 ? '+' : ''}{data.worstTrade.profitEUR}€
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {data.tradeCount === 0 && (
            <p className="text-[11px] text-muted-foreground italic text-center">
              📭 Ni prodaj v zadnjih {days} dneh. Dodaj prodaje v Trade tabelo za prikaz dejanskega profita.
            </p>
          )}

          {/* Refresh */}
          <div className="flex justify-end">
            <button
              onClick={() => fetchActual(days)}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži dejanski profit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
