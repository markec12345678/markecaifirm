/**
 * TopActionRow — a single TOP action card.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Renders ONE row of the "🎯 TOP 5 AKCIJ ZA DANES"
 * list — the rank number, domain icon, action text, +€/mo uplift, confidence
 * pill, v8.29 ✅ Izvedel / ❌ Zavrnil buttons (when a draft exists for this
 * rank), v8.26 ℹ️ Zakaj? toggle (when an explanation exists), and the
 * expanded ActionExplanationPanel below when expanded.
 *
 * Purely presentational — takes the action + matched explanation + handlers
 * as props. No internal state, no fetches, no side effects.
 */

import { Check, ChevronDown, ChevronUp, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confidenceColor } from '../../utils';
import { DOMAIN_LABELS } from '../types';
import { ActionExplanationPanel } from './action-explanation-panel';
import type { TopActionRowProps } from './types';

export function TopActionRow({
  action,
  explanation,
  expanded,
  onToggleExpand,
  draftId,
  patchingRank,
  patchedStatus,
  onPatch,
}: TopActionRowProps) {
  const dm = DOMAIN_LABELS[action.domain] ?? { icon: '•', label: action.domain, color: 'text-foreground' };

  return (
    <div
      className={cn(
        'rounded bg-background/40 transition-colors',
        expanded ? 'ring-1 ring-amber-500/30 bg-amber-500/5' : '',
      )}
    >
      <div className="flex items-start gap-2 text-[11px] sm:text-xs leading-snug p-1.5">
        <span className="font-bold text-amber-700 dark:text-amber-400 shrink-0 w-4 text-center">
          {action.rank}.
        </span>
        <span className="shrink-0" title={dm.label}>
          {dm.icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-medium">{action.action}</span>
          <span className="text-muted-foreground"> · +{Math.round(action.expectedUpliftEUR)}€/mo</span>
        </span>
        <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(action.confidence))}>
          {action.confidence}
        </span>
        {/* v8.29: ✅ Izvedel / ❌ Zavrnil buttons — close the feedback loop.
            When clicked, PATCHes the draft for this action to status='executed'
            or 'rejected', AND calls recordActionFeedback (v8.28) → adaptive
            weights re-evaluate every 10 actions per domain → better ranking. */}
        {draftId && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onPatch('executed')}
              disabled={patchingRank === action.rank || patchedStatus != null}
              className={cn(
                'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors',
                patchedStatus === 'executed'
                  ? 'bg-emerald-500/30 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 cursor-default'
                  : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 disabled:opacity-40',
              )}
              aria-label={`Označi akcijo ${action.rank} kot izvedel`}
              title="v8.29: Označi kot izvedel — sistem se bo naučil (recordActionFeedback)"
            >
              <Check className="w-2.5 h-2.5" />
              Izvedel
            </button>
            <button
              onClick={() => onPatch('rejected')}
              disabled={patchingRank === action.rank || patchedStatus != null}
              className={cn(
                'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors',
                patchedStatus === 'rejected'
                  ? 'bg-red-500/30 border-red-500/60 text-red-700 dark:text-red-300 cursor-default'
                  : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/25 text-red-700 dark:text-red-400 disabled:opacity-40',
              )}
              aria-label={`Označi akcijo ${action.rank} kot zavrnjeno`}
              title="v8.29: Označi kot zavrnjeno — sistem se bo naučil (recordActionFeedback)"
            >
              <X className="w-2.5 h-2.5" />
              Zavrnil
            </button>
          </div>
        )}
        {/* v8.26: ℹ️ Zakaj? toggle button — only render if an explanation exists */}
        {explanation && (
          <button
            onClick={onToggleExpand}
            className="text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0 transition-colors"
            aria-expanded={expanded}
            aria-label={`Razširi razlago za akcijo ${action.rank}`}
            title="v8.26: Razširi za razlago (Zakaj Master Brain priporoča to akcijo?)"
          >
            <Info className="w-2.5 h-2.5" />
            Zakaj?
            {expanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          </button>
        )}
      </div>
      {/* v8.26: Expanded explanation panel — reasoning + reasoningParts grid + trustScore pill */}
      {explanation && expanded && (
        <ActionExplanationPanel explanation={explanation} />
      )}
    </div>
  );
}
