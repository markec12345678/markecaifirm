/**
 * ComparisonTable — 8 metrics × 3-4 columns side-by-side scenario table.
 *
 * Extracted from the original `scenario-brain-card.tsx` (397 lines) as part
 * of v8.95.0-split-scenario. Renders the rose-tinted comparison table that
 * the Scenario Brain is centered around:
 *
 *   - Header row: "Metrika" label + 3-4 preset columns (🛡️ Konzervativni /
 *     ⚖️ Uravnovešeni / 🚀 Agresivni / 🎯 Custom [only if a custom scenario
 *     was submitted]). The BEST column (highest projectedProfit12m, tie-break
 *     higher overallHealth — computed server-side) gets a stronger rose
 *     background + 2px border + 🏆 BEST badge.
 *   - Body rows: 8 metrics (profit 30d / 90d / 12m, overallHealth, riskLevel,
 *     top action, capital required, conflicts) — each row alternates a faint
 *     rose stripe for readability.
 *
 * The `columns` array (3 base + optional 4th Custom) is derived internally
 * via useMemo from the `custom` and `bestScenario` props — matches the
 * original container-side useMemo that lived in `scenario-brain-card.tsx`.
 *
 * Purely presentational — takes the `comparisonTable` slice + the optional
 * `custom` scenario + the optional `bestScenario` literal as props. No
 * internal state, no fetches, no side effects.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type {
  ComparisonTableProps,
  ScenarioColumn,
} from './types';

export function ComparisonTable({
  comparisonTable,
  custom,
  bestScenario,
}: ComparisonTableProps) {
  // Build the column headers — 3 presets + optional 4th Custom column.
  // `bestScenario` highlights the BEST column (🏆 badge + stronger rose bg).
  const columns = useMemo<ScenarioColumn[]>(() => {
    const best = bestScenario;
    const cols: ScenarioColumn[] = [
      { key: 'conservative', label: '🛡️ Konzervativni', isBest: best === 'conservative' },
      { key: 'balanced', label: '⚖️ Uravnovešeni', isBest: best === 'balanced' },
      { key: 'aggressive', label: '🚀 Agresivni', isBest: best === 'aggressive' },
    ];
    if (custom) {
      cols.push({
        key: 'custom',
        label: '🎯 Custom',
        isBest: best === 'custom',
        isCustom: true,
      });
    }
    return cols;
  }, [custom, bestScenario]);

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-[10px] sm:text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold uppercase tracking-wide text-muted-foreground p-1.5 sm:p-2 align-bottom">
              Metrika
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'p-1.5 sm:p-2 text-center font-bold align-bottom rounded-t',
                  col.isBest
                    ? 'bg-rose-500/20 border-2 border-rose-500/50 text-rose-700 dark:text-rose-300'
                    : 'bg-rose-500/5 border border-rose-500/20 text-rose-700/80 dark:text-rose-300/80',
                  col.isCustom && !col.isBest && 'italic',
                )}
              >
                <div className="flex flex-col gap-0.5 items-center">
                  <span>{col.label}</span>
                  {col.isBest && (
                    <span className="text-[8px] uppercase font-bold text-rose-600 dark:text-rose-400">
                      🏆 BEST
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparisonTable.map((row, idx) => (
            <tr
              key={row.metric}
              className={cn(
                'border-b border-rose-500/10',
                idx % 2 === 0 ? 'bg-rose-500/[0.03]' : '',
              )}
            >
              <td className="text-left font-medium text-muted-foreground p-1.5 sm:p-2">
                {row.metric}
              </td>
              {columns.map((col) => {
                const cellVal = row[col.key];
                return (
                  <td
                    key={col.key}
                    className={cn(
                      'p-1.5 sm:p-2 text-center font-medium',
                      col.isBest
                        ? 'bg-rose-500/15 border-x-2 border-rose-500/40 text-rose-900 dark:text-rose-100'
                        : 'text-foreground/90',
                    )}
                  >
                    {cellVal === undefined || cellVal === '' ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="block max-w-[160px] mx-auto leading-snug">
                        {String(cellVal)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
