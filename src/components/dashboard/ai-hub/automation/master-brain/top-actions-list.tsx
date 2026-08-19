/**
 * TopActionsList — "🎯 TOP 5 AKCIJ ZA DANES" section.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Renders the section header (with optional "ℹ️
 * klikni Zakaj? za razlago" hint when explanations exist), the empty-state
 * fallback ("Ni akcij"), and maps over the TOP actions, finding the
 * matching explanation for each and delegating row rendering to
 * TopActionRow.
 *
 * Purely presentational — takes the action list + explanations + expand
 * state + draft/patch state + handlers as props. No internal state.
 */

import type { ActionExplanation } from '../types';
import { TopActionRow } from './top-action-row';
import type { TopActionsListProps } from './types';

export function TopActionsList({
  topActions,
  explanations,
  expandedRank,
  onExpandedRankChange,
  draftIds,
  patchingRank,
  patchedRanks,
  onPatch,
}: TopActionsListProps) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold flex items-center justify-between">
        <span>🎯 TOP 5 AKCIJ ZA DANES</span>
        {explanations && explanations.length > 0 && (
          <span className="text-[9px] normal-case font-normal text-muted-foreground italic">
            ℹ️ klikni &quot;Zakaj?&quot; za razlago
          </span>
        )}
      </div>
      {topActions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">Ni akcij</p>
      ) : (
        topActions.map((a) => {
          // v8.26: find the matching explanation (if any) — match by rank +
          // domain + signal so the explanation uniquely identifies the row.
          const explanation: ActionExplanation | undefined = explanations?.find(
            (e) => e.rank === a.rank && e.domain === a.domain && e.signal === a.signal,
          );
          const isExpanded = expandedRank === a.rank;
          return (
            <TopActionRow
              key={a.rank}
              action={a}
              explanation={explanation}
              expanded={isExpanded}
              onToggleExpand={() => onExpandedRankChange(isExpanded ? null : a.rank)}
              draftId={draftIds[a.rank]}
              patchingRank={patchingRank}
              patchedStatus={patchedRanks[a.rank]}
              onPatch={(status) => onPatch(a.rank, status)}
            />
          );
        })
      )}
    </div>
  );
}
