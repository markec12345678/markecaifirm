'use client';

// v8.97: Accuracy & Trend Card extracted from ai-hub-view.tsx (v8.25).
// Historical Accuracy + Trend (Validation phase CULMINATION). Answers
// "Ali lahko zaupam Master Brain-u?" with actual % data. Fetches /api/ai/brain/accuracy.
// Local const DOMAIN_TREND_LABELS co-located.

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { AccuracyApiResponse, AccuracyTrendPoint } from './types';
import {
  gradeColor, gradeTrendPill, trendBadgeClass, trendIcon,
} from './utils';

const DOMAIN_TREND_LABELS: Array<{ key: keyof AccuracyTrendPoint; label: string }> = [
  { key: 'profitGrade', label: 'Profit' },
  { key: 'inventoryGrade', label: 'Inventar' },
  { key: 'marketGrade', label: 'Trg' },
  { key: 'sourcingGrade', label: 'Sourcing' },
  { key: 'riskGrade', label: 'Tveganje' },
  { key: 'buyerGrade', label: 'Kupci' },
  { key: 'pricingGrade', label: 'Cene' },
];

export function AccuracyTrendCard() {
  const [data, setData] = useState<AccuracyApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const fetchAccuracy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/accuracy?days=30', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AccuracyApiResponse;
      if (!json?.ok) throw new Error('Accuracy API ni vrnil rezultata');
      setData(json);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccuracy();
  }, [fetchAccuracy]);

  const triggerBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch('/api/ai/brain/accuracy/backfill', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Napaka pri backfill');
      toast.success(
        `✓ Backfill: ${json.backfilled30d} novih 30d + ${json.backfilled90d} novih 90d (od ${json.totalSnapshots} snapshotov)`,
      );
      // Refetch to show updated accuracy
      await fetchAccuracy();
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri backfill');
    } finally {
      setBackfilling(false);
    }
  }, [fetchAccuracy]);

  // Last N overallHealth scores for the sparkline (most recent on the right)
  const trend = data?.gradeTrend ?? [];
  const sparkline = trend.slice(-7);
  const hasSnapshots = trend.length > 0;
  const summary = data?.summary;
  const accuracy30d = data?.accuracy30d ?? null;
  const accuracy90d = data?.accuracy90d ?? null;

  return (
    <div className="rounded-xl border-2 border-teal-500/40 bg-gradient-to-br from-teal-500/15 via-cyan-500/10 to-emerald-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📈 Master Brain Accuracy &amp; Trend
          </span>
          <Badge variant="outline" className="text-[10px] border-teal-500/50 text-teal-700 dark:text-teal-400 shrink-0 font-bold">
            v8.25
          </Badge>
          <Badge variant="outline" className="text-[9px] border-teal-500/40 text-teal-700/80 dark:text-teal-400/80 shrink-0">
            VALIDATION FINAL
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* Backfill button */}
          <button
            onClick={triggerBackfill}
            disabled={backfilling}
            className={cn(
              'text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
              'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400',
              'hover:bg-teal-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {backfilling ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
            {backfilling ? 'Backfill...' : '🔄 Backfill accuracy'}
          </button>
          {/* Refresh button */}
          <button
            onClick={fetchAccuracy}
            className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border border-teal-500/20 text-teal-700/80 dark:text-teal-400/80 hover:bg-teal-500/10"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Osveži
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-16 bg-teal-500/10" />
            <Skeleton className="h-16 bg-teal-500/10" />
          </div>
          <Skeleton className="h-8 w-full bg-teal-500/10" />
          <Skeleton className="h-24 w-full bg-teal-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchAccuracy} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && (
        <div className="space-y-3">
          {/* Accuracy big-number block — 30d + 90d */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">30d accuracy</div>
              <div className={cn(
                'text-2xl sm:text-3xl font-bold tabular-nums',
                accuracy30d === null ? 'text-muted-foreground/60' :
                  accuracy30d >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
                  accuracy30d >= 50 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400',
              )}>
                {accuracy30d === null ? '—' : `${accuracy30d.toFixed(1)}%`}
              </div>
              <div className="text-[8px] text-muted-foreground">
                {summary?.snapshotsWithAccuracy30d ?? 0} / {summary?.totalSnapshots ?? 0} snapshotov
              </div>
            </div>

            <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">90d accuracy</div>
              <div className={cn(
                'text-2xl sm:text-3xl font-bold tabular-nums',
                accuracy90d === null ? 'text-muted-foreground/60' :
                  accuracy90d >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
                  accuracy90d >= 50 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400',
              )}>
                {accuracy90d === null ? '—' : `${accuracy90d.toFixed(1)}%`}
              </div>
              <div className="text-[8px] text-muted-foreground">
                {summary?.snapshotsWithAccuracy90d ?? 0} / {summary?.totalSnapshots ?? 0} snapshotov
              </div>
            </div>
          </div>

          {/* Insufficient-data info message */}
          {accuracy30d === null && (
            <div className="flex items-start gap-1.5 text-[10px] text-teal-700/80 dark:text-teal-400/80 bg-teal-500/5 border border-teal-500/20 rounded p-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Potrebno več podatkov — snemaj dneve 30+ za accuracy.
                {' '}
                <button
                  onClick={triggerBackfill}
                  disabled={backfilling}
                  className="underline hover:text-teal-700 dark:hover:text-teal-300 disabled:opacity-50"
                >
                  Poženi backfill
                </button>{' '}
                za preverbo (pričakovan rezultat: 0 backfilled ker je naš snapshot iz današnjega dne).
              </span>
            </div>
          )}

          {/* Overall Health trend sparkline */}
          <div className="rounded-lg border border-teal-500/20 bg-background/40 p-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Overall Health trend (zadnjih {sparkline.length})
              </span>
              <Badge variant="outline" className={cn('text-[9px] font-bold px-1.5 py-0', trendBadgeClass(summary?.trend ?? 'INSUFFICIENT_DATA'))}>
                {trendIcon(summary?.trend ?? 'INSUFFICIENT_DATA')} {summary?.trend ?? 'INSUFFICIENT_DATA'}
              </Badge>
            </div>

            {sparkline.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-1">
                — Ni dovolj snapshotov za trend
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 flex-wrap">
                  {sparkline.map((s, i) => (
                    <span key={s.date} className="flex items-center gap-1">
                      <span className={cn(
                        'px-1.5 py-0.5 rounded border text-[10px] font-bold tabular-nums',
                        gradeColor(s.healthGrade),
                      )}>
                        {Math.round(s.overallHealth)}
                      </span>
                      {i < sparkline.length - 1 && (
                        <span className="text-[8px] text-muted-foreground">→</span>
                      )}
                    </span>
                  ))}
                </div>
                {(summary?.firstHalfAvg != null && summary?.secondHalfAvg != null) && (
                  <div className="text-[9px] text-muted-foreground mt-1">
                    1. polovica: <span className="font-bold text-foreground">{summary.firstHalfAvg}</span> · 2. polovica: <span className="font-bold text-foreground">{summary.secondHalfAvg}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 7 Domain grade trend table */}
          <div className="rounded-lg border border-teal-500/20 bg-background/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              7 Domain grade trend (zadnjih {sparkline.length} snapshotov)
            </div>
            {!hasSnapshots ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-1">
                — Ni snapshotov
              </div>
            ) : (
              <div className="space-y-1">
                {DOMAIN_TREND_LABELS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2 text-[10px]">
                    <span className="w-16 shrink-0 text-muted-foreground font-semibold">{label}:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {sparkline.map((s, i) => (
                        <span key={s.date} className="flex items-center gap-1">
                          <span className={gradeTrendPill(s[key] as string)}>
                            {s[key] as string}
                          </span>
                          {i < sparkline.length - 1 && (
                            <span className="text-[8px] text-muted-foreground">→</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-teal-500/20 text-[10px] text-muted-foreground">
            <span>
              Skupaj snapshotov: <span className="font-bold text-foreground">{summary?.totalSnapshots ?? 0}</span>
            </span>
            <span>
              Z accuracy 30d: <span className="font-bold text-foreground">{summary?.snapshotsWithAccuracy30d ?? 0}</span>
            </span>
            <span>
              Z accuracy 90d: <span className="font-bold text-foreground">{summary?.snapshotsWithAccuracy90d ?? 0}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
