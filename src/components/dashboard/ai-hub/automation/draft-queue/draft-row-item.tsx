/**
 * DraftRowItem — a single draft row in the queue list.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Renders ONE row of the scrollable draft list:
 *
 *   - rank number (1-5)
 *   - domain icon (from DOMAIN_LABELS)
 *   - action text (truncated)
 *   - timestamp (createdAt formatted as "DD. MM. YYYY HH:MM" via sl-SI locale)
 *   - signal (mono-spaced)
 *   - confidence pill (color via confidenceColor)
 *   - status pill (color + label via draftStatusColor / draftStatusLabel)
 *   - ✅ / ❌ inline buttons (only when status === 'pending') — PATCH the
 *     draft via the parent's onPatch handler → recordActionFeedback loop
 *
 * Purely presentational — takes a single draft + patchingId + onPatch handler
 * as props. No internal state, no fetches, no side effects.
 */

import { Badge } from '@/components/ui/badge';
import { Check, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confidenceColor, draftStatusColor, draftStatusLabel } from '../../utils';
import { DOMAIN_LABELS } from '../types';
import type { DraftRowItemProps } from './types';

export function DraftRowItem({ draft, patchingId, onPatch }: DraftRowItemProps) {
  const dm = DOMAIN_LABELS[draft.domain] ?? { icon: '•', label: draft.domain, color: 'text-foreground' };
  const ts = (() => {
    try {
      const dt = new Date(draft.createdAt);
      const date = dt.toLocaleDateString('sl-SI');
      const time = dt.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
      return `${date} ${time}`;
    } catch {
      return '—';
    }
  })();
  return (
    <div
      className={cn(
        'p-2 flex items-start gap-2 text-[10px] sm:text-[11px] leading-snug transition-colors',
        draft.status === 'executed' && 'bg-emerald-500/[0.04]',
        draft.status === 'rejected' && 'bg-red-500/[0.04]',
      )}
    >
      <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0 w-4 text-center">
        {draft.rank}.
      </span>
      <span className="shrink-0" title={dm.label}>
        {dm.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-medium truncate">{draft.action}</span>
        </div>
        <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <Clock className="w-2 h-2" />
          {ts}
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono">{draft.signal}</span>
          <span className="text-muted-foreground/60">·</span>
          <span className={cn('font-bold', confidenceColor(draft.confidence))}>{draft.confidence}</span>
        </div>
      </div>
      <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0', draftStatusColor(draft.status))}>
        {draftStatusLabel(draft.status)}
      </Badge>
      {/* Inline ✅/❌ buttons — only for pending drafts */}
      {draft.status === 'pending' && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onPatch(draft.id, 'executed')}
            disabled={patchingId === draft.id}
            aria-label="Označi kot izvedeno"
            title="v8.29: Označi kot izvedeno — sistem se bo naučil"
            className="text-[9px] px-1 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 disabled:opacity-40"
          >
            <Check className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={() => onPatch(draft.id, 'rejected')}
            disabled={patchingId === draft.id}
            aria-label="Označi kot zavrnjeno"
            title="v8.29: Označi kot zavrnjeno — sistem se bo naučil"
            className="text-[9px] px-1 py-0.5 rounded border bg-red-500/10 border-red-500/30 hover:bg-red-500/25 text-red-700 dark:text-red-400 disabled:opacity-40"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}
