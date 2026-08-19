/**
 * BottlenecksStrengths — bottlenecks (⚠️ Ozka grla) + strengths (💪 Moč) row.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Renders a compact flex row showing the domain
 * bottlenecks and strengths identified by the Master Brain's overallHealth
 * analysis. Each domain is rendered with its icon + name + color from
 * DOMAIN_LABELS. Both halves are conditional on having at least one entry,
 * BUT the surrounding wrapper div (with the `border-t` separator) is always
 * rendered — matching the original in-place JSX behavior so the visual
 * rhythm of the banner is preserved even when both lists are empty.
 *
 * Purely presentational — takes the `overallHealth` slice as a prop.
 */

import { cn } from '@/lib/utils';
import { DOMAIN_LABELS } from '../types';
import type { BottlenecksStrengthsProps } from './types';

export function BottlenecksStrengths({ overallHealth }: BottlenecksStrengthsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] pt-1 border-t border-amber-500/20">
      {overallHealth.bottlenecks.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-muted-foreground">⚠️ Ozka grla:</span>
          {overallHealth.bottlenecks.map((d) => (
            <span key={d} className={cn('font-bold', DOMAIN_LABELS[d]?.color ?? '')}>
              {DOMAIN_LABELS[d]?.icon} {d}
            </span>
          ))}
        </div>
      )}
      {overallHealth.strengths.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-muted-foreground">💪 Moč:</span>
          {overallHealth.strengths.map((d) => (
            <span key={d} className={cn('font-bold', DOMAIN_LABELS[d]?.color ?? '')}>
              {DOMAIN_LABELS[d]?.icon} {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
