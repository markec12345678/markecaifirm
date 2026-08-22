/**
 * StrategyProjections — 30d / 90d / 12m profit + risk pills.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Renders the 3-column strategy grid showing
 * projected profit (€) + risk score (0-100) for each of the three horizons.
 * The 12m column is visually emphasized (slightly stronger amber background).
 *
 * Purely presentational — takes the `strategy` slice of MasterBrainResult
 * as a prop. No internal state.
 */

import type { StrategyProjectionsProps } from './types';

export function StrategyProjections({ strategy }: StrategyProjectionsProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
        <div className="text-[9px] uppercase text-muted-foreground">30d</div>
        <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
          {Math.round(strategy.projection30d.profitEUR)}€
        </div>
        <div className="text-[9px] text-muted-foreground">
          risk {Math.round(strategy.projection30d.riskScore)}/100
        </div>
      </div>
      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
        <div className="text-[9px] uppercase text-muted-foreground">90d</div>
        <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
          {Math.round(strategy.projection90d.profitEUR)}€
        </div>
        <div className="text-[9px] text-muted-foreground">
          risk {Math.round(strategy.projection90d.riskScore)}/100
        </div>
      </div>
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-center">
        <div className="text-[9px] uppercase text-muted-foreground">12m</div>
        <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
          {Math.round(strategy.projection12m.profitEUR)}€
        </div>
        <div className="text-[9px] text-muted-foreground">
          risk {Math.round(strategy.projection12m.riskScore)}/100
        </div>
      </div>
    </div>
  );
}
