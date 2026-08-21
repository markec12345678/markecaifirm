/**
 * DomainWeightRow — one domain weight slider + stats card.
 *
 * Extracted from the original `adaptive-weights-card.tsx` (441 lines) as part
 * of v8.95.0-split-adaptive. Renders a single domain's row in the adaptive
 * weights card:
 *
 *   - Top row: domain icon + label + current weight number pill +
 *     ✅executed / ❌rejected counters.
 *   - Slider (0.5 – 2.0, step 0.1) with min/default/max labels.
 *   - Execution rate bar (color-coded via rateColor + rateLabel helpers).
 *   - Mini adjustment history (last 3 entries — boost/reduce/no change).
 *
 * Purely presentational — takes the domain entry + per-domain stats + the
 * current draft slider value + an onWeightChange callback as props. Computes
 * its own `total` / `rate` / `isDirty` derived values. No internal state.
 */

import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { rateColor, rateLabel } from '../../utils';
import type { DomainWeightRowProps } from './types';

export function DomainWeightRow({
  domain,
  stats,
  draftVal,
  onWeightChange,
}: DomainWeightRowProps) {
  const total = stats.executed + stats.rejected;
  const rate = total > 0 ? stats.executed / total : 0;
  const isDirty = Math.abs(draftVal - stats.weight) > 0.001;

  return (
    <div
      className={cn(
        'rounded-lg border p-2 sm:p-2.5',
        isDirty
          ? 'border-orange-500/60 bg-orange-500/10'
          : 'border-orange-500/20 bg-orange-500/[0.03]',
      )}
    >
      {/* Top row: domain + weight number + stats */}
      <div className="flex items-center gap-2 mb-1.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0 min-w-[110px]">
          <span className="text-base">{domain.icon}</span>
          <span className="text-xs sm:text-[13px] font-semibold text-foreground">
            {domain.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span
            className={cn(
              'text-xs font-mono font-bold px-1.5 py-0.5 rounded',
              isDirty
                ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300'
                : 'bg-background/60 text-foreground',
            )}
            title="Current domain weight applied in Master Brain ranking"
          >
            {draftVal.toFixed(1)}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            ✅{stats.executed} | ❌{stats.rejected}
          </span>
        </div>
      </div>

      {/* Slider */}
      <Slider
        value={[draftVal]}
        min={0.5}
        max={2.0}
        step={0.1}
        onValueChange={(v) => {
          const newV = v[0] ?? 1.0;
          onWeightChange(newV);
        }}
        className="w-full"
      />
      <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
        <span>0.5 (reduce)</span>
        <span>1.0 (default)</span>
        <span>2.0 (boost)</span>
      </div>

      {/* Execution rate bar */}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-background/60 rounded overflow-hidden">
          <div
            className={cn('h-full transition-all', rateColor(rate))}
            style={{ width: `${Math.round(rate * 100)}%` }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground font-mono shrink-0">
          {total > 0 ? `${Math.round(rate * 100)}%` : '—'}
          {' '}
          ({rateLabel(rate)})
        </span>
      </div>

      {/* Mini adjustment history (last 3) */}
      {stats.adjustmentHistory.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          <div className="text-[9px] uppercase text-muted-foreground font-semibold">
            Zgodovina (zadnje {Math.min(3, stats.adjustmentHistory.length)})
          </div>
          {stats.adjustmentHistory.slice(0, 3).map((h, idx) => (
            <div key={idx} className="text-[9px] text-muted-foreground/80 font-mono truncate">
              {h.date.slice(0, 10)}: {h.oldWeight.toFixed(1)} → {h.newWeight.toFixed(1)}
              {' '}
              <span className="text-muted-foreground/60">
                ({h.newWeight > h.oldWeight ? 'boost' : h.newWeight < h.oldWeight ? 'reduce' : 'no change'})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
