/**
 * DomainRates — per-domain execution rate bars.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Renders the "Per-domain execution rate" mini section:
 *
 *   - header row with Target icon + "klik na domeno za filter" hint
 *   - one button row per domain in domainStats[]:
 *       icon | label | progress bar (width = executionRate × 100%, color via
 *       rateColor) | "{rate}% ({executed}/{total}) · {pending}⏳" mono text
 *
 * Each row is clickable — clicking toggles the parent's domainFilter between
 * the domain and 'all'. Returns null when domainStats is empty (mirrors the
 * original `data.domainStats.length > 0 && (...)` conditional in the parent).
 *
 * Purely presentational — takes domainStats[] + current domainFilter +
 * onDomainFilterChange handler. No internal state.
 */

import { Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { rateColor } from '../../utils';
import { DOMAIN_LABELS } from '../types';
import type { DomainRatesProps } from './types';

export function DomainRates({
  domainStats,
  domainFilter,
  onDomainFilterChange,
}: DomainRatesProps) {
  if (domainStats.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-500/20 bg-slate-500/[0.03] p-2 space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-slate-700/80 dark:text-slate-300/80 font-semibold flex items-center gap-1">
        <Target className="w-2.5 h-2.5" />
        Per-domain execution rate
        <span className="text-[8px] normal-case font-normal text-muted-foreground italic ml-auto">
          klik na domeno za filter
        </span>
      </div>
      {domainStats.map((ds) => {
        const dm = DOMAIN_LABELS[ds.domain] ?? { icon: '•', label: ds.domain, color: 'text-foreground' };
        const rate = ds.executionRate;
        const total = ds.executed + ds.rejected;
        const isSelected = domainFilter === ds.domain;
        return (
          <button
            key={ds.domain}
            onClick={() => onDomainFilterChange(isSelected ? 'all' : ds.domain)}
            className={cn(
              'w-full flex items-center gap-2 text-[10px] p-1 rounded transition-colors text-left',
              isSelected ? 'bg-slate-500/15 ring-1 ring-slate-500/40' : 'hover:bg-slate-500/10',
            )}
            title={`Filter by ${dm.label} domain`}
          >
            <span className="shrink-0 w-3 text-center">{dm.icon}</span>
            <span className="shrink-0 w-16 font-medium">{dm.label}</span>
            <div className="flex-1 h-1.5 bg-background/60 rounded overflow-hidden">
              <div
                className={cn('h-full transition-all', rateColor(rate))}
                style={{ width: `${Math.round(rate * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-[9px] text-muted-foreground font-mono w-20 text-right">
              {total > 0 ? `${Math.round(rate * 100)}% (${ds.executed}/${total})` : '—'}
              {ds.pending > 0 && (
                <span className="text-blue-600 dark:text-blue-400"> · {ds.pending}⏳</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
