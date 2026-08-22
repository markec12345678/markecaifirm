/**
 * Auto-pilot stats display — today's progress bars + all-time counters.
 *
 * Extracted from the original `auto-pilot-card.tsx` (1176 lines) as part of
 * v8.94.8-split-autopilot. Renders two blocks that appear inside AutoPilotCard:
 *
 *   1. "Danes" panel — last run timestamp, mode-aware count/budget line,
 *      hourly anomaly counter, limit progress bar, budget progress bar.
 *   2. All-time 3-col grid — total auto-executed, total rolled back, rollback
 *      rate (color-coded green/amber/red based on thresholds).
 *
 * Purely presentational — the parent owns the stats response and passes the
 * derived display values (counts, percentages, displayLimit/Budget) as props.
 */

import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutoPilotMode, AutoPilotStatsResponse } from './types';

export interface StatsDisplayProps {
  stats: AutoPilotStatsResponse;
  mode: AutoPilotMode;
  todayAutoExecuted: number;
  todayBudgetUsed: number;
  todayLimit: number;
  todayBudget: number;
  displayLimit: number;
  displayBudget: number;
  limitPct: number;
  budgetPct: number;
  hourlyExecCount: number;
  hourlyWindowStart: string | null;
  allTimeTotal: number;
  allTimeRollback: number;
  rollbackRate: number;
}

export function StatsDisplay({
  stats,
  mode,
  todayAutoExecuted,
  todayBudgetUsed,
  todayLimit,
  todayBudget,
  displayLimit,
  displayBudget,
  limitPct,
  budgetPct,
  hourlyExecCount,
  hourlyWindowStart,
  allTimeTotal,
  allTimeRollback,
  rollbackRate,
}: StatsDisplayProps) {
  return (
    <>
      {/* Today's stats — with progress bars + v8.31 hourly counter */}
      <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          Danes
          <span className="text-[8px] normal-case font-normal text-muted-foreground italic ml-auto">
            zadnji run: {stats.config.lastRunAt ? new Date(stats.config.lastRunAt).toLocaleString('sl-SI') : '—'}
          </span>
        </div>
        {/* v8.31: Mode-aware stats line */}
        <div className="text-[10px] text-muted-foreground leading-snug">
          Danes: <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{todayAutoExecuted}/{displayLimit}</span> akcij ({mode}) ·{' '}
          <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{todayBudgetUsed.toFixed(0)}€/{displayBudget}€</span> budget
        </div>
        {/* v8.31: Hourly counter line */}
        <div className="text-[9px] text-muted-foreground/80 italic">
          Zadnja ura: <span className="font-mono font-bold">{hourlyExecCount}</span> akcij
          {hourlyExecCount >= 6 && (
            <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">
              · ⚠️ blizu anomaly threshold (8)
            </span>
          )}
          {hourlyWindowStart && (
            <span className="ml-1 text-[8px]">
              (od {new Date(hourlyWindowStart).toLocaleTimeString('sl-SI')})
            </span>
          )}
        </div>
        {/* Limit progress */}
        <div>
          <div className="flex items-center justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">Limit</span>
            <span className="font-mono font-bold">
              {todayAutoExecuted}/{todayLimit} akcij
            </span>
          </div>
          <div className="h-1.5 bg-background/60 rounded overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                limitPct >= 100 ? 'bg-red-500' : limitPct >= 80 ? 'bg-amber-500' : 'bg-purple-500',
              )}
              style={{ width: `${limitPct}%` }}
            />
          </div>
        </div>
        {/* Budget progress */}
        <div>
          <div className="flex items-center justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">Budget</span>
            <span className="font-mono font-bold">
              {todayBudgetUsed.toFixed(0)}€/{todayBudget}€
            </span>
          </div>
          <div className="h-1.5 bg-background/60 rounded overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-amber-500' : 'bg-purple-500',
              )}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* All-time stats */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Skupno auto</div>
          <div className="text-base font-bold text-purple-700 dark:text-purple-300 font-mono">
            {allTimeTotal}
          </div>
        </div>
        <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Razveljavljeno</div>
          <div className="text-base font-bold text-amber-600 dark:text-amber-400 font-mono">
            {allTimeRollback}
          </div>
        </div>
        <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Rollback rate</div>
          <div
            className={cn(
              'text-base font-bold font-mono',
              rollbackRate > 20
                ? 'text-red-600 dark:text-red-400'
                : rollbackRate > 5
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {rollbackRate.toFixed(1)}%
          </div>
        </div>
      </div>
    </>
  );
}
