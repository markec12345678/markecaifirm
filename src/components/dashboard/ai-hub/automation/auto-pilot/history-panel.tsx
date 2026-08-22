/**
 * Auto-pilot history panel — modal dialog with auto-executed drafts list.
 *
 * Extracted from the original `auto-pilot-card.tsx` (1176 lines) as part of
 * v8.94.8-split-autopilot. Renders the Dialog modal opened by the "ℹ️ Zgodovina"
 * button:
 *
 *   - Header: "🤖 Auto-pilot Zgodovina" (with Bot icon)
 *   - Loading state: 3 skeletons
 *   - Empty state: "Še ni auto-executed akcij." placeholder
 *   - Populated state: scrollable list of last 10 auto-executed drafts, each
 *     showing domain icon, rank, action, executed-at timestamp, signal,
 *     expected uplift EUR, optional rollback note, optional 8-rules audit
 *     details, and a "↩️ Razveljavi" button (hidden if already rolled back).
 *
 * Purely presentational — the parent owns history list + loading + rollingBackId
 * state and the rollbackDraft callback, passing them as props.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, Clock, RefreshCw, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DOMAIN_LABELS } from '../types';
import type { AutoPilotHistoryDraft } from './types';

export interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  historyLoading: boolean;
  history: AutoPilotHistoryDraft[] | null;
  rollingBackId: string | null;
  onRollback: (draftId: string) => void;
}

export function HistoryPanel({
  open,
  onOpenChange,
  historyLoading,
  history,
  rollingBackId,
  onRollback,
}: HistoryPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bot className="w-4 h-4 text-purple-600 dark:text-purple-300" />
            🤖 Auto-pilot Zgodovina
          </DialogTitle>
          <DialogDescription>
            Zadnjih 10 auto-executed akcij. Vsako lahko razveljaviš (↩️ Razveljavi) —
            to tudi undo-a learning preko recordActionFeedback z &apos;rejected&apos;.
          </DialogDescription>
        </DialogHeader>

        {historyLoading && (
          <div className="space-y-2 py-4">
            <Skeleton className="h-12 w-full bg-purple-500/10" />
            <Skeleton className="h-12 w-full bg-purple-500/10" />
            <Skeleton className="h-12 w-full bg-purple-500/10" />
          </div>
        )}

        {!historyLoading && history && history.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <Bot className="w-8 h-8 mx-auto mb-2 text-purple-500/50" />
            Še ni auto-executed akcij. Vklopi auto-pilot in zaženi run, ali
            počakaj na hourly cron.
          </div>
        )}

        {!historyLoading && history && history.length > 0 && (
          <div className="space-y-2">
            {history.map((d) => {
              const dm = DOMAIN_LABELS[d.domain] ?? { icon: '•', label: d.domain, color: 'text-foreground' };
              const executedAtStr = d.executedAt
                ? (() => {
                    try {
                      return new Date(d.executedAt).toLocaleString('sl-SI');
                    } catch {
                      return '—';
                    }
                  })()
                : '—';
              return (
                <div
                  key={d.id}
                  className={cn(
                    'rounded-lg border p-2 text-xs',
                    d.rolledBack
                      ? 'border-amber-500/30 bg-amber-500/[0.04]'
                      : 'border-purple-500/20 bg-purple-500/[0.03]',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-3 text-center font-bold text-muted-foreground">
                      {d.rank}.
                    </span>
                    <span className="shrink-0" title={dm.label}>
                      {dm.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{d.action}</div>
                      <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                        <Clock className="w-2 h-2" />
                        {executedAtStr}
                        <span className="text-muted-foreground/60">·</span>
                        <span className="font-mono">{d.signal}</span>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="font-mono text-purple-600 dark:text-purple-400">
                          +{d.expectedUpliftEUR}€
                        </span>
                      </div>
                      {d.rolledBack && (
                        <div className="mt-1 text-[9px] text-amber-700 dark:text-amber-400 italic">
                          ↩️ Razveljavljeno{d.rollbackReason ? `: ${d.rollbackReason.slice(0, 80)}` : ''}
                        </div>
                      )}
                      {d.autoPilotReason && !d.rolledBack && (
                        <details className="mt-1">
                          <summary className="text-[9px] text-purple-700/70 dark:text-purple-300/70 cursor-pointer">
                            ℹ️ Audit (8 pravil)
                          </summary>
                          <div className="text-[8px] text-muted-foreground mt-0.5 font-mono whitespace-pre-wrap">
                            {d.autoPilotReason.split('; ').map((r, i) => (
                              <div
                                key={i}
                                className={cn(
                                  r.startsWith('PASS')
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400',
                                )}
                              >
                                {r}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                    {!d.rolledBack && (
                      <button
                        onClick={() => onRollback(d.id)}
                        disabled={rollingBackId === d.id}
                        className="text-[9px] px-2 py-1 rounded border bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 shrink-0 flex items-center gap-1 disabled:opacity-50"
                      >
                        {rollingBackId === d.id ? (
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Undo2 className="w-2.5 h-2.5" />
                        )}
                        Razveljavi
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
