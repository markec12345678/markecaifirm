/**
 * Barrel file for Adaptive Weights sub-components + Props types.
 *
 * Extracted from the original `adaptive-weights-card.tsx` (441 lines) as part
 * of v8.95.0-split-adaptive. Re-exports the presentational sub-components used
 * by AdaptiveWeightsCard (in ../adaptive-weights-card.tsx) plus the per-sub-
 * component Props interfaces and the DomainDisplayEntry derived alias:
 *
 *   Sub-components:
 *     - DomainWeightsList   (maps 7 domain rows)
 *     - DomainWeightRow     (single domain card: slider + rate bar + history)
 *     - ActionButtons      (Reset + Save row)
 *     - FeedbackForm        (demo feedback form: domain dropdown + ✅/❌)
 *
 *   Types:
 *     - DomainDisplayEntry (derived from DOMAIN_DISPLAY — kept in sync with
 *       ../types automatically)
 *     - *Props interfaces for each sub-component above
 *
 * Shared types (AdaptiveWeightsResponse, DomainWeightStats, DOMAIN_DISPLAY)
 * stay in ../types — DOMAIN_DISPLAY is also consumed by the container's
 * fetchWeights callback (to sync draft weights from the server response),
 * so co-locating the constant with a single client card would be wrong.
 * The main AdaptiveWeightsCard component stays at ../adaptive-weights-card.tsx
 * (preserved path for the existing import in ../index.ts barrel file).
 */

export { DomainWeightsList } from './domain-weights-list';
export type { DomainWeightsListProps } from './types';

export { DomainWeightRow } from './domain-weight-row';
export type { DomainWeightRowProps } from './types';

export { ActionButtons } from './action-buttons';
export type { ActionButtonsProps } from './types';

export { FeedbackForm } from './feedback-form';
export type { FeedbackFormProps } from './types';

export type { DomainDisplayEntry } from './types';
