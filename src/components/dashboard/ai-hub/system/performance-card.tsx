/**
 * PerformanceCard — v8.33 yellow/amber cache + perf stats card.
 *
 * Extracted from the original `system-cards.tsx` (1947 lines) as part of
 * v8.94.7-split. Placed IMMEDIATELY BELOW the 🏥 System Health card (health
 * first, then performance). Aggregates two complementary signals:
 *
 *   1. CACHE STATS (per namespace) — hit/miss/sets counters for each brain
 *      layer's in-memory cache. Overall hit rate (weighted) is the headline
 *      metric — a healthy system should hit ≥70%.
 *
 *   2. PERF STATS (per brain) — rolling-window (last 100 calls) response
 *      times per brain: avg, p50 (median), p95, p99, min, max, last.
 *      Color-coded thresholds: green <50ms, amber 50-200ms, red >200ms.
 *
 * Action buttons:
 *   - 🔄 Osveži — manual refetch (auto-refresh every 30s)
 *   - 🗑️ Reset stats — POST { action: 'reset' } to clear counters
 *
 * Fetches /api/ai/brain/performance. Yellow/amber gradient.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, AlertCircle, Brain, RefreshCw, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PerformanceReport } from './types';
import { hitRateColor, responseTimeColor, hitRateBarColor, namespaceLabel } from './types';

export function PerformanceCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  const [data, setData] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetchPerf = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/performance', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PerformanceReport;
      if (!json?.ok) throw new Error('Performance API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  const resetStats = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/ai/brain/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // After reset, refetch immediately to show cleared state.
      await fetchPerf();
      toast.success('Stats reset.');
    } catch (e: any) {
      toast.error(`Reset failed: ${e?.message ?? 'Napaka'}`);
    } finally {
      setResetting(false);
    }
  }, [fetchPerf]);

  useEffect(() => {
    fetchPerf();
    // Auto-refresh every 30 seconds — perf stats change frequently.
    const intervalId = setInterval(() => {
      fetchPerf();
    }, 30 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchPerf]);

  const summary = data?.summary;
  const overallHitRate = summary?.overallHitRate ?? 0;
  const avgResponseTimeMs = summary?.avgResponseTimeMs ?? 0;
  const p95ResponseTimeMs = summary?.p95ResponseTimeMs ?? 0;
  const totalRequests = summary?.totalRequests ?? 0;
  const totalCached = summary?.totalCached ?? 0;

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gradient-to-br p-3 sm:p-4 shadow-sm',
      'from-amber-500/15 via-yellow-500/10 to-amber-500/5 border-amber-500/40',
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            ⚡ Performance & Cache Stats
          </span>
          <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-300 shrink-0 font-bold">
            v8.33
          </Badge>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={resetStats}
            disabled={resetting || loading}
            title="Reset cache + perf stats"
            className="text-[10px] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 className={cn('w-2.5 h-2.5', resetting && 'animate-spin')} />
            Reset
          </button>
          <button
            onClick={fetchPerf}
            disabled={loading}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
            Osveži
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-amber-500/10" />
          <Skeleton className="h-32 w-full bg-amber-500/10" />
          <Skeleton className="h-32 w-full bg-amber-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchPerf} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {data && (
        <div className="space-y-3">
          {/* Overall summary — 4 big numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                Cache hit rate
              </div>
              <div className={cn('text-lg sm:text-xl font-bold font-mono', hitRateColor(overallHitRate))}>
                {overallHitRate.toFixed(1)}<span className="text-xs text-muted-foreground font-normal">%</span>
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                Total requests
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono">
                {totalRequests}
              </div>
              <div className="text-[9px] text-muted-foreground font-mono">
                {totalCached} cached
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                Avg response
              </div>
              <div className={cn('text-lg sm:text-xl font-bold font-mono', responseTimeColor(avgResponseTimeMs))}>
                {avgResponseTimeMs}<span className="text-xs text-muted-foreground font-normal">ms</span>
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                P95 response
              </div>
              <div className={cn('text-lg sm:text-xl font-bold font-mono', responseTimeColor(p95ResponseTimeMs))}>
                {p95ResponseTimeMs}<span className="text-xs text-muted-foreground font-normal">ms</span>
              </div>
            </div>
          </div>

          {/* Cache stats table (per namespace) */}
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              Cache Stats ({data.cacheStats.length} namespaces)
            </div>
            {data.cacheStats.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-2">
                Ni še cache statistike — kliči kateri od brain-ov da napolniš.
              </div>
            ) : (
              <div className="rounded border border-amber-500/20 overflow-hidden">
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-amber-500/10 text-muted-foreground">
                    <tr>
                      <th className="text-left p-1.5 font-semibold">Namespace</th>
                      <th className="text-right p-1.5 font-semibold">Hits</th>
                      <th className="text-right p-1.5 font-semibold">Misses</th>
                      <th className="text-right p-1.5 font-semibold">Sets</th>
                      <th className="text-right p-1.5 font-semibold">Hit Rate</th>
                      <th className="text-left p-1.5 font-semibold w-24">Bar</th>
                      <th className="text-right p-1.5 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cacheStats
                      .slice()
                      .sort((a, b) => a.namespace.localeCompare(b.namespace))
                      .map((cs) => (
                        <tr
                          key={cs.namespace}
                          className="border-t border-amber-500/10 hover:bg-amber-500/5 cursor-pointer"
                          onClick={onBrainCategoryClick}
                          title={`Klikni za brain kategorijo — ${cs.namespace}`}
                        >
                          <td className="p-1.5 font-semibold text-left">
                            {namespaceLabel(cs.namespace)}
                          </td>
                          <td className="p-1.5 text-right text-emerald-600 dark:text-emerald-400">
                            {cs.hits}
                          </td>
                          <td className="p-1.5 text-right text-red-600 dark:text-red-400">
                            {cs.misses}
                          </td>
                          <td className="p-1.5 text-right text-muted-foreground">
                            {cs.sets}
                          </td>
                          <td className={cn('p-1.5 text-right font-bold', hitRateColor(cs.hitRate))}>
                            {cs.hitRate.toFixed(1)}%
                          </td>
                          <td className="p-1.5">
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn('h-full rounded-full transition-all', hitRateBarColor(cs.hitRate))}
                                style={{ width: `${Math.min(100, cs.hitRate)}%` }}
                              />
                            </div>
                          </td>
                          <td className="p-1.5 text-right text-muted-foreground">
                            {cs.total}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Performance stats table (per brain) */}
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Performance Stats ({data.perfStats.length} brains · rolling window 100)
            </div>
            {data.perfStats.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-2">
                Ni še perf statistike — kliči kateri od brain-ov da napolniš.
              </div>
            ) : (
              <div className="rounded border border-amber-500/20 overflow-x-auto">
                <table className="w-full text-[10px] font-mono min-w-[560px]">
                  <thead className="bg-amber-500/10 text-muted-foreground">
                    <tr>
                      <th className="text-left p-1.5 font-semibold">Brain</th>
                      <th className="text-right p-1.5 font-semibold">Count</th>
                      <th className="text-right p-1.5 font-semibold">Avg ms</th>
                      <th className="text-right p-1.5 font-semibold">P50 ms</th>
                      <th className="text-right p-1.5 font-semibold">P95 ms</th>
                      <th className="text-right p-1.5 font-semibold">P99 ms</th>
                      <th className="text-right p-1.5 font-semibold">Min</th>
                      <th className="text-right p-1.5 font-semibold">Max</th>
                      <th className="text-right p-1.5 font-semibold">Cache %</th>
                      <th className="text-right p-1.5 font-semibold">Last ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perfStats.map((ps) => (
                      <tr
                        key={ps.brain}
                        className="border-t border-amber-500/10 hover:bg-amber-500/5 cursor-pointer"
                        onClick={onBrainCategoryClick}
                        title={`Klikni za brain kategorijo — ${ps.brain}`}
                      >
                        <td className="p-1.5 font-semibold text-left capitalize">
                          {ps.brain}
                        </td>
                        <td className="p-1.5 text-right text-muted-foreground">
                          {ps.count}
                        </td>
                        <td className={cn('p-1.5 text-right font-bold', responseTimeColor(ps.avgMs))}>
                          {ps.avgMs}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.p50Ms))}>
                          {ps.p50Ms}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.p95Ms))}>
                          {ps.p95Ms}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.p99Ms))}>
                          {ps.p99Ms}
                        </td>
                        <td className="p-1.5 text-right text-muted-foreground">
                          {ps.minMs}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.maxMs))}>
                          {ps.maxMs}
                        </td>
                        <td className={cn('p-1.5 text-right font-semibold', hitRateColor(ps.cacheHitRate))}>
                          {ps.cacheHitRate.toFixed(0)}%
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.lastDurationMs))}>
                          {ps.lastDurationMs}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Cache store size + last updated */}
          <div className="flex items-center justify-between text-[9px] text-muted-foreground/70 gap-2 flex-wrap">
            <span className="font-mono">
              📦 Cache entries: <span className="font-bold text-amber-700 dark:text-amber-300">{data.cacheStoreSize}</span>
            </span>
            <span>
              Osveženo: {new Date(data.timestamp).toLocaleTimeString('sl-SI')} · auto-refresh 30s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
