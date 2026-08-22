/**
 * SystemHealthCard — v8.32 emerald/amber/red gradient health dashboard.
 *
 * Extracted from the original `system-cards.tsx` (1947 lines) as part of
 * v8.94.7-split. Aggregates the entire Brain system's health into one view:
 * 8 brain endpoints status + cache hit rates + auto-pilot status + draft
 * queue + data freshness + risk profile + adaptive weights +
 * auto-generated recommendations + overall health score 0-100.
 *
 * Fetches /api/ai/brain/health every 60s. Gradient background:
 * emerald HEALTHY / amber DEGRADED / red UNHEALTHY.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  Bot,
  Brain,
  Camera,
  ClipboardList,
  Coins,
  Crown,
  HeartPulse,
  Info,
  Package,
  RefreshCw,
  Settings2,
  Shield,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SystemHealthReport } from '../types';
import { gradeTextColor } from '../utils';

// ============================================================================
// Local constants (used only inside this module)
// ============================================================================

const BRAIN_HEALTH_ICONS: Record<string, { icon: typeof Brain; tint: string }> = {
  profit: { icon: Coins, tint: 'text-emerald-600 dark:text-emerald-400' },
  inventory: { icon: Package, tint: 'text-amber-600 dark:text-amber-400' },
  market: { icon: TrendingUp, tint: 'text-sky-600 dark:text-sky-400' },
  sourcing: { icon: Target, tint: 'text-violet-600 dark:text-violet-400' },
  risk: { icon: Shield, tint: 'text-red-600 dark:text-red-400' },
  buyer: { icon: Users, tint: 'text-cyan-600 dark:text-cyan-400' },
  pricing: { icon: Coins, tint: 'text-lime-600 dark:text-lime-400' },
  master: { icon: Crown, tint: 'text-amber-600 dark:text-amber-400' },
};

export function SystemHealthCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  const [data, setData] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/health', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SystemHealthReport;
      if (!json?.ok) throw new Error('System Health API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    // Auto-refresh every 60 seconds — health should be fresh.
    const intervalId = setInterval(() => {
      fetchHealth();
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchHealth]);

  // Status → gradient background classes (emerald / amber / red).
  const status = data?.status ?? 'DEGRADED';
  const gradientClasses =
    status === 'HEALTHY'
      ? 'from-emerald-500/15 via-emerald-500/10 to-teal-500/5 border-emerald-500/40'
      : status === 'DEGRADED'
        ? 'from-amber-500/15 via-amber-500/10 to-yellow-500/5 border-amber-500/40'
        : 'from-red-500/15 via-rose-500/10 to-red-500/5 border-red-500/40';
  const statusBadgeClasses =
    status === 'HEALTHY'
      ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
      : status === 'DEGRADED'
        ? 'border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-500/10'
        : 'border-red-500/50 text-red-700 dark:text-red-300 bg-red-500/10';

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gradient-to-br p-3 sm:p-4 shadow-sm',
      gradientClasses,
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HeartPulse className="w-5 h-5 shrink-0 text-primary" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🏥 System Health
          </span>
          <Badge variant="outline" className="text-[10px] border-primary/50 text-primary shrink-0 font-bold">
            v8.32
          </Badge>
          {data && (
            <Badge variant="outline" className={cn('text-[9px] font-bold shrink-0', statusBadgeClasses)}>
              {status}
            </Badge>
          )}
        </div>

        <button
          onClick={fetchHealth}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-primary/10" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 bg-primary/10" />
            ))}
          </div>
          <Skeleton className="h-4 w-3/4 bg-primary/10" />
          <Skeleton className="h-4 w-2/3 bg-primary/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchHealth} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {data && (
        <div className="space-y-3">
          {/* Big health score */}
          <div className="text-center px-1">
            <div className={cn(
              'text-3xl sm:text-4xl font-bold font-mono tracking-tight',
              gradeTextColor(data.overallGrade),
            )}>
              {data.overallHealthScore}<span className="text-base text-muted-foreground font-normal">/100</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-2 flex-wrap">
              <span className={cn('font-bold', gradeTextColor(data.overallGrade))}>
                Grade: {data.overallGrade}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className={cn('font-bold', gradeTextColor(data.overallGrade))}>
                {data.status}
              </span>
            </div>
          </div>

          {/* 8 Brain endpoints grid */}
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              8 Brain Endpoints
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {data.brainEndpoints.map((b) => {
                const iconMeta = BRAIN_HEALTH_ICONS[b.name] ?? { icon: Brain, tint: 'text-muted-foreground' };
                const Icon = iconMeta.icon;
                return (
                  <button
                    key={b.name}
                    onClick={onBrainCategoryClick}
                    title={b.responsive
                      ? `${b.name}: ${b.responseTimeMs}ms${b.grade ? ` · Grade ${b.grade}` : ''}`
                      : `${b.name}: ${b.lastError ?? 'error'}`}
                    className={cn(
                      'rounded border p-1.5 text-left transition-all hover:scale-[1.02] hover:shadow-sm',
                      b.responsive
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-red-500/40 bg-red-500/5',
                    )}
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <Icon className={cn('w-3 h-3 shrink-0', iconMeta.tint)} />
                      <span className="text-[10px] font-semibold uppercase truncate">
                        {b.name}
                      </span>
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0 ml-auto',
                          b.responsive ? 'bg-emerald-500' : 'bg-red-500',
                        )}
                        title={b.responsive ? 'Responsive' : 'Not responding'}
                      />
                    </div>
                    <div className="text-[9px] text-muted-foreground font-mono">
                      {b.responsive ? `${b.responseTimeMs}ms` : 'timeout'}
                    </div>
                    {b.grade && (
                      <div className={cn('text-[10px] font-bold', gradeTextColor(b.grade))}>
                        {b.grade}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Data freshness + auto-pilot + draft queue + risk + adaptive */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
            {/* Data freshness */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <Camera className="w-2.5 h-2.5" /> Data Freshness
              </div>
              <div className="font-mono">
                📸 {data.dataFreshness.latestSnapshotDate
                  ? `${data.dataFreshness.latestSnapshotDate} (${data.dataFreshness.daysSinceLastSnapshot === 0 ? 'danes' : `${data.dataFreshness.daysSinceLastSnapshot}d nazaj`})`
                  : 'Ni snapshot-a'}
                {' · '}
                <span title="Število snapshotov">
                  {data.dataFreshness.snapshotsCount} {data.dataFreshness.snapshotsCount === 1 ? 'snap' : 'snap-ov'}
                </span>
              </div>
              <div className="font-mono">
                📊 {data.dataFreshness.tradesRecorded} {data.dataFreshness.tradesRecorded === 1 ? 'trade' : 'trade-ov'}
                {' · 📈 '}
                {data.dataFreshness.accuracy30d != null
                  ? `${data.dataFreshness.accuracy30d}% acc`
                  : '— acc'}
              </div>
            </div>

            {/* Auto-pilot status */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <Bot className="w-2.5 h-2.5" /> Auto-pilot
              </div>
              <div className="font-mono">
                {data.autoPilot.anomalySuspended
                  ? <span className="text-red-600 dark:text-red-400 font-bold">🤖 SUSPENDED (anomaly)</span>
                  : data.autoPilot.enabled
                    ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">🤖 ON ({data.autoPilot.mode})</span>
                    : <span className="text-amber-600 dark:text-amber-400 font-bold">🤖 OFF ({data.autoPilot.mode} ready)</span>}
              </div>
              <div className="font-mono text-muted-foreground">
                {data.autoPilot.todayAutoExecuted} today · {Math.round(data.autoPilot.todayBudgetUsed)}€ used
              </div>
            </div>

            {/* Draft queue */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <ClipboardList className="w-2.5 h-2.5" /> Draft Queue
              </div>
              <div className="font-mono">
                📋 {data.draftQueue.pending} pending
                {' · '} {data.draftQueue.executed} exec
                {' · '} {data.draftQueue.rejected} rej
              </div>
              <div className="font-mono text-muted-foreground">
                {Math.round(data.draftQueue.executionRate * 100)}% execution rate · {data.draftQueue.expired} expired
              </div>
            </div>

            {/* Risk + adaptive */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <Settings2 className="w-2.5 h-2.5" /> Risk & Adaptive
              </div>
              <div className="font-mono">
                ⚙️ {data.riskProfile.riskTolerance} ({data.riskProfile.maxAcceptableRisk}/100)
              </div>
              <div className="font-mono text-muted-foreground">
                🎛️ {data.adaptiveWeights.adjustedDomains} domains adjusted · {data.adaptiveWeights.totalExecuted} exec · {data.adaptiveWeights.totalRejected} rej
              </div>
            </div>
          </div>

          {/* Recommendations */}
          {data.recommendations.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
                <Info className="w-3 h-3" /> Priporočila ({data.recommendations.length})
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                {data.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="text-[10px] rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-amber-700 dark:text-amber-300"
                  >
                    {rec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All healthy message */}
          {data.recommendations.length === 0 && (
            <div className="text-center text-[11px] text-emerald-600 dark:text-emerald-400 italic">
              ✅ Sistem je zdrav — vsi brain-i odgovarjajo, podatki so sveži.
            </div>
          )}

          {/* Last updated timestamp */}
          <div className="text-[9px] text-muted-foreground/70 text-right">
            Osveženo: {new Date(data.timestamp).toLocaleTimeString('sl-SI')}
            {status !== 'HEALTHY' && ' · auto-refresh 60s'}
          </div>
        </div>
      )}
    </div>
  );
}
