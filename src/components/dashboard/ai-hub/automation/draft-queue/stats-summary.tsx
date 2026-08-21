/**
 * StatsSummary — 5 color-coded status pills + execution-rate pill.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Renders the stats row at the top of the main content
 * area: pending / approved / executed / rejected / expired counts (each pill
 * uses draftStatusColor from ../../utils for color-coding) plus an optional
 * execution-rate pill shown only when executed + rejected > 0.
 *
 * Purely presentational — takes a single `stats` prop. No internal state, no
 * fetches, no side effects.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { draftStatusColor } from '../../utils';
import type { StatsSummaryProps } from './types';

export function StatsSummary({ stats }: StatsSummaryProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('pending'))}>
        {stats.pending} čaka
      </Badge>
      <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('approved'))}>
        {stats.approved} odobrenih
      </Badge>
      <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('executed'))}>
        {stats.executed} izvedenih
      </Badge>
      <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('rejected'))}>
        {stats.rejected} zavrnjenih
      </Badge>
      <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('expired'))}>
        {stats.expired} poteklih
      </Badge>
      {stats.executed + stats.rejected > 0 && (
        <Badge variant="outline" className="text-[10px] border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300">
          execution rate: {Math.round(stats.executionRate * 100)}%
        </Badge>
      )}
    </div>
  );
}
