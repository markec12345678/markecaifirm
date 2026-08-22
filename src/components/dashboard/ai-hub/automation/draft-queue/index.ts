/**
 * Barrel file for Draft Queue sub-components + types.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Re-exports the presentational sub-components used by
 * DraftQueueCard (in ../draft-queue-card.tsx) plus the DraftQueue-specific
 * types (moved here from ../types.ts — they are only consumed by
 * DraftQueueCard and its sub-components):
 *
 *   Sub-components:
 *     - StatsSummary     (5 status pills + execution-rate pill)
 *     - FilterBar        (Status + Domain dropdowns + onChange handlers)
 *     - DraftRowItem     (single draft row with ✅/❌ inline buttons)
 *     - DraftList        (empty state + map of DraftRowItem)
 *     - DomainRates      (per-domain execution rate bars + click-to-filter)
 *
 *   Types:
 *     - DraftRow, DraftQueueResponse (moved from ../types.ts)
 *     - DraftStats, DomainStat       (derived aliases)
 *     - StatsSummaryProps, FilterBarProps, DraftRowItemProps,
 *       DraftListProps, DomainRatesProps
 *
 * Shared cross-module types (DomainName, DraftStatus) and constants
 * (DOMAIN_DISPLAY, DOMAIN_LABELS) stay in ../types — they are also consumed
 * by AdaptiveWeightsCard + AutoPilotCard's HistoryPanel + MasterBrainBanner,
 * so co-locating them with a single client card would be wrong. The main
 * DraftQueueCard component stays at ../draft-queue-card.tsx (preserved path
 * for the existing import in ../index.ts barrel file).
 */

export { StatsSummary } from './stats-summary';
export type { StatsSummaryProps } from './types';

export { FilterBar } from './filter-bar';
export type { FilterBarProps } from './types';

export { DraftRowItem } from './draft-row-item';
export type { DraftRowItemProps } from './types';

export { DraftList } from './draft-list';
export type { DraftListProps } from './types';

export { DomainRates } from './domain-rates';
export type { DomainRatesProps } from './types';

export type {
  DraftRow,
  DraftQueueResponse,
  DraftStats,
  DomainStat,
} from './types';
