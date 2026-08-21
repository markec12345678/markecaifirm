/**
 * DomainWeightsList — 7-domain slider grid wrapper.
 *
 * Extracted from the original `adaptive-weights-card.tsx` (441 lines) as part
 * of v8.95.0-split-adaptive. Iterates over `DOMAIN_DISPLAY` and renders one
 * `DomainWeightRow` per domain. Passes the per-domain stats slice (looked up
 * by `data.adaptiveWeights[d.key]`) + the current draft slider value (looked
 * up by `draftWeights[d.key]`) + a closure-bound onWeightChange callback that
 * forwards the domain key to the parent's handler.
 *
 * Purely presentational — takes the full adaptive weights response + the
 * draft weights record + an onWeightChange(domain, newWeight) callback. No
 * internal state, no fetches, no side effects.
 */

import { DOMAIN_DISPLAY } from '../types';
import { DomainWeightRow } from './domain-weight-row';
import type { DomainWeightsListProps } from './types';

export function DomainWeightsList({
  data,
  draftWeights,
  onWeightChange,
}: DomainWeightsListProps) {
  return (
    <>
      {DOMAIN_DISPLAY.map((d) => {
        const stats = data.adaptiveWeights[d.key];
        const draftVal = draftWeights[d.key];
        return (
          <DomainWeightRow
            key={d.key}
            domain={d}
            stats={stats}
            draftVal={draftVal}
            onWeightChange={(newWeight: number) => onWeightChange(d.key, newWeight)}
          />
        );
      })}
    </>
  );
}
