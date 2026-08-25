'use client';

// v8.97: Brain Snapshots Section extracted from ai-hub-view.tsx (v8.23).
// Historical record of Master Brain predictions (cron @ 00:00 stores FULL masterBrain()
// output in BrainSnapshot Prisma model). Each card shows date + grade + projection30d +
// riskLevel + accuracy (when backfilled 30d later). Empty state + manual save button.

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Camera, History, Save, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SnapshotsApiResponse } from './types';
import { gradeColor, riskLevelColor } from './utils';

export function BrainSnapshotsSection() {
  const [data, setData] = useState<SnapshotsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/snapshots?days=30', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SnapshotsApiResponse;
      if (!json?.ok) throw new Error('Snapshots API ni vrnil rezultata');
      setData(json);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const triggerSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/brain/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Napaka pri shranjevanju');
      toast.success(`✓ Snapshot shranjen za ${json.date}`);
      // Refetch to show the new snapshot in the list
      await fetchSnapshots();
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri shranjevanju snapshot-a');
    } finally {
      setSaving(false);
    }
  }, [fetchSnapshots]);

  const snapshots = data?.snapshots ?? [];
  const hasSnapshots = snapshots.length > 0;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-bold tracking-tight">
            📸 Brain Snapshots
          </span>
          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 shrink-0">
            v8.23
          </Badge>
          {hasSnapshots && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-700/80 dark:text-emerald-400/80 shrink-0">
              <History className="w-2.5 h-2.5 mr-0.5" />
              {snapshots.length} {snapshots.length === 1 ? 'snapshot' : 'snapshotov'}
            </Badge>
          )}
        </div>

        {/* Manual save trigger — always available */}
        <button
          onClick={triggerSave}
          disabled={saving}
          className={cn(
            'text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            'hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {saving ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
          {saving ? 'Shranjujem...' : 'Shrani snapshot zdaj'}
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-44 shrink-0 bg-emerald-500/10 rounded-lg" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchSnapshots} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !hasSnapshots && (
        <div className="text-center py-6 px-4 border border-dashed border-emerald-500/30 rounded-lg">
          <Camera className="w-8 h-8 mx-auto mb-2 text-emerald-500/50" />
          <p className="text-xs text-muted-foreground mb-3">
            Še ni shranjenih snapshot-ov.<br />
            Shrani prvi snapshot za začetek zgodovine Master Brain napovedi.
          </p>
          <Button
            size="sm"
            onClick={triggerSave}
            disabled={saving}
            className="gap-1.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/30"
          >
            {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saving ? 'Shranjujem...' : 'Shrani prvi snapshot'}
          </Button>
        </div>
      )}

      {/* Snapshots horizontal scroll list */}
      {!loading && !error && hasSnapshots && (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
            {snapshots.map((s) => {
              // Predicted vs actual comparison (only available for snapshots
              // older than 30d, when v8.25 backfill runs)
              const hasActual30d = s.actualProfit30d != null;
              const predictedVsActual = hasActual30d && s.projection30dEUR > 0
                ? Math.round(((s.actualProfit30d ?? 0) / s.projection30dEUR) * 10000) / 100
                : null;

              return (
                <div
                  key={s.id}
                  className="shrink-0 w-44 rounded-lg border border-emerald-500/20 bg-background/60 p-2 hover:border-emerald-500/40 transition-colors"
                >
                  {/* Date + grade */}
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-[10px] font-mono font-semibold text-muted-foreground">
                      {s.date}
                    </span>
                    <Badge variant="outline" className={cn('text-[9px] font-bold px-1.5 py-0', gradeColor(s.healthGrade))}>
                      {s.healthGrade}
                    </Badge>
                  </div>

                  {/* Overall health + risk level */}
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[9px] text-muted-foreground">Zdravje:</span>
                    <span className="text-[10px] font-bold">
                      {Math.round(s.overallHealth)}/100
                    </span>
                    <Badge variant="outline" className={cn('text-[8px] px-1 py-0 ml-auto', riskLevelColor(s.riskLevel))}>
                      {s.riskLevel}
                    </Badge>
                  </div>

                  {/* Predicted 30d profit */}
                  <div className="rounded bg-emerald-500/10 border border-emerald-500/20 p-1 text-center mb-1">
                    <div className="text-[8px] uppercase text-muted-foreground">Napoved 30d</div>
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {Math.round(s.projection30dEUR)}€
                    </div>
                  </div>

                  {/* Accuracy (if backfilled) */}
                  {hasActual30d && predictedVsActual != null ? (
                    <div className="rounded bg-indigo-500/10 border border-indigo-500/20 p-1 text-center">
                      <div className="text-[8px] uppercase text-muted-foreground">Dejansko / Napoved</div>
                      <div className={cn(
                        'text-[10px] font-bold',
                        predictedVsActual >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                          : predictedVsActual >= 50 ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400',
                      )}>
                        {Math.round(s.actualProfit30d ?? 0)}€ · {predictedVsActual}%
                      </div>
                    </div>
                  ) : (
                    <div className="text-[9px] text-muted-foreground italic text-center">
                      ⏳ Čaka 30d za primerjavo
                    </div>
                  )}

                  {/* Top action + conflict count */}
                  <div className="flex items-center justify-between text-[8px] text-muted-foreground mt-1 pt-1 border-t border-emerald-500/10">
                    <span>🎯 {s.topActionCount}</span>
                    <span>⚠️ {s.conflictCount}</span>
                    <span>💪 {s.strengthCount}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-emerald-500/20 text-[10px]">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>
                Povprečno zdravje: <span className="font-bold text-foreground">{Math.round(data?.summary.avgOverallHealth ?? 0)}/100</span>
              </span>
              <span>
                Povprečna napoved 30d: <span className="font-bold text-foreground">{Math.round(data?.summary.avgProjection30d ?? 0)}€</span>
              </span>
            </div>
            <button
              onClick={fetchSnapshots}
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
