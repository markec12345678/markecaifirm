/**
 * ConflictsList — inter-domain conflict list section.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Renders the conflicts block — only when the
 * Master Brain detected at least one conflict (severity LOW/MEDIUM/HIGH)
 * between two domains. Each conflict card shows severity pill + both
 * domains (with their icons) + description + resolution hint.
 *
 * Purely presentational — takes the `conflicts` slice as a prop. Renders
 * nothing when the array is empty.
 */

import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { conflictSeverityColor } from '../../utils';
import { DOMAIN_LABELS } from '../types';
import type { ConflictsListProps } from './types';

export function ConflictsList({ conflicts }: ConflictsListProps) {
  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-1 pt-1 border-t border-amber-500/20">
      <div className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />
        KONFLIKTI ({conflicts.length})
      </div>
      {conflicts.map((c) => (
        <div
          key={c.id}
          className={cn('rounded border p-1.5 text-[10px] leading-snug', conflictSeverityColor(c.severity))}
        >
          <div className="font-semibold flex items-center gap-1">
            <span className="font-bold uppercase">{c.severity}</span>
            <span className="text-muted-foreground">·</span>
            <span>
              {DOMAIN_LABELS[c.domainA]?.icon ?? '•'} {c.domainA}
            </span>
            <span className="text-muted-foreground">vs</span>
            <span>
              {DOMAIN_LABELS[c.domainB]?.icon ?? '•'} {c.domainB}
            </span>
          </div>
          <div className="mt-0.5">{c.description}</div>
          <div className="mt-0.5 italic text-muted-foreground">→ {c.resolution}</div>
        </div>
      ))}
    </div>
  );
}
