/**
 * ActionExplanationPanel — expanded reasoning panel for a TOP action.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Renders the v8.26 expanded panel shown when the
 * user clicks the "ℹ️ Zakaj?" toggle on a TOP action row:
 *
 *   - The primary reasoning string (💡 Razlaga)
 *   - A 2-col grid of reasoningParts cards (Signal / Zakaj na tem mestu /
 *     Vpliv profila / Vpliv konfliktov / Pričakovan izid)
 *   - A per-action trustScore pill (0-100) at the bottom
 *
 * Purely presentational — takes a single `explanation` prop. No internal
 * state, no fetches, no side effects.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { signalGradeColor, trustScoreColor } from '../../utils';
import type { ActionExplanationPanelProps } from './types';

export function ActionExplanationPanel({ explanation }: ActionExplanationPanelProps) {
  return (
    <div className="mx-1.5 mb-1.5 p-2 rounded border border-amber-500/20 bg-amber-500/5 space-y-2">
      {/* Reasoning — the primary WHY string (prominent) */}
      <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200 font-medium">
        <span className="text-[9px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold mr-1">
          💡 Razlaga:
        </span>
        {explanation.reasoning}
      </p>

      {/* reasoningParts grid: Signal + Rank + Profile + Conflict + Expected */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
        {/* Signal */}
        <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
          <div className="text-[8px] uppercase text-muted-foreground font-semibold">
            Signal
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className="font-mono text-amber-700 dark:text-amber-400 font-medium">
              {explanation.signal}
            </span>
            <Badge
              variant="outline"
              className={cn('text-[8px] px-1 py-0 h-3.5', signalGradeColor(explanation.reasoningParts.signalGrade))}
            >
              {explanation.reasoningParts.signalGrade}
            </Badge>
            <span className="text-muted-foreground text-[9px]">
              {Math.round(explanation.reasoningParts.signalScore)}/100
            </span>
          </div>
        </div>

        {/* Rank reason */}
        <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
          <div className="text-[8px] uppercase text-muted-foreground font-semibold">
            Zakaj na tem mestu
          </div>
          <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
            {explanation.reasoningParts.whyRankedHere}
          </div>
        </div>

        {/* Profile impact */}
        <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
          <div className="text-[8px] uppercase text-muted-foreground font-semibold">
            Vpliv profila
          </div>
          <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
            {explanation.reasoningParts.profileImpact ?? '—'}
          </div>
        </div>

        {/* Conflict impact */}
        <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
          <div className="text-[8px] uppercase text-muted-foreground font-semibold">
            Vpliv konfliktov
          </div>
          <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
            {explanation.reasoningParts.conflictImpact ?? '—'}
          </div>
        </div>

        {/* Expected outcome */}
        <div className="rounded border border-amber-500/20 bg-background/50 p-1.5 sm:col-span-2">
          <div className="text-[8px] uppercase text-muted-foreground font-semibold">
            Pričakovan izid
          </div>
          <div className="mt-0.5 text-[9px] leading-snug text-emerald-700 dark:text-emerald-400 font-medium">
            {explanation.reasoningParts.expectedOutcome}
          </div>
        </div>
      </div>

      {/* Per-action trustScore pill */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20">
        <span className="text-[9px] uppercase text-muted-foreground font-semibold">
          Trust score
        </span>
        <Badge
          variant="outline"
          className={cn('text-[10px] font-bold px-2 py-0.5', trustScoreColor(explanation.trustScore))}
          title="v8.26: Zaupanje v to priporočilo (0-100). ≥70=zeleno, ≥50=rumeno, <50=rdeče."
        >
          {Math.round(explanation.trustScore)}/100
        </Badge>
      </div>
    </div>
  );
}
