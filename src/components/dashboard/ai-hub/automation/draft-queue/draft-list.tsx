/**
 * DraftList — the scrollable list of drafts.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Renders the draft list wrapper (max-h-96 with overflow
 * scroll + slate border) and either:
 *
 *   - empty state ("Ni draftov za izbrane filtre. Klikni 'Osveži Master
 *     Brain' zgoraj da se avtomatsko kreirajo novi.")
 *   - divided list of DraftRowItem components (one per draft)
 *
 * Purely presentational — takes drafts[] + patchingId + onPatch handler.
 * Delegates single-row rendering to DraftRowItem. No internal state.
 */

import { DraftRowItem } from './draft-row-item';
import type { DraftListProps } from './types';

export function DraftList({ drafts, patchingId, onPatch }: DraftListProps) {
  return (
    <div className="max-h-96 overflow-y-auto rounded border border-slate-500/20 bg-slate-500/[0.03]">
      {drafts.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground italic">
          Ni draftov za izbrane filtre. Klikni &quot;Osveži Master Brain&quot; zgoraj
          da se avtomatsko kreirajo novi.
        </div>
      ) : (
        <div className="divide-y divide-slate-500/10">
          {drafts.map((d) => (
            <DraftRowItem
              key={d.id}
              draft={d}
              patchingId={patchingId}
              onPatch={onPatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
