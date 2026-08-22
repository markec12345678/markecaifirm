/**
 * Barrel file for Master Brain sub-components + Props types.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Re-exports the presentational sub-components used
 * by MasterBrainBanner (in ../master-brain-banner.tsx) plus the per-sub-
 * component Props interfaces and derived type aliases.
 *
 *   Sub-components:
 *     - ActionExplanationPanel   (expanded reasoning panel — v8.26)
 *     - TopActionRow             (one TOP-5 action card with ✅/❌ + ℹ️ Zakaj?)
 *     - TopActionsList           (TOP-5 section header + map over actions)
 *     - StrategyProjections      (30d / 90d / 12m profit + risk pills)
 *     - ConflictsList           (inter-domain conflict cards)
 *     - BottlenecksStrengths    (⚠️ Ozka grla + 💪 Moč row)
 *
 *   Types:
 *     - TopAction, Conflict, OverallHealth, Strategy (derived from
 *       MasterBrainResult — kept in sync with ../types automatically)
 *     - *Props interfaces for each sub-component above
 *
 * Shared types (ActionExplanation, MasterBrainResult, DOMAIN_LABELS) stay in
 * ../types — they are also consumed by server-side modules (lib/brain/*,
 * /api/ai/brain/master/route.ts, etc.), so co-locating them with this single
 * client banner would be wrong. The main MasterBrainBanner component stays
 * at ../master-brain-banner.tsx (preserved path so the existing import in
 * ../index.ts barrel file keeps working).
 */

export { ActionExplanationPanel } from './action-explanation-panel';
export type { ActionExplanationPanelProps } from './types';

export { TopActionRow } from './top-action-row';
export type { TopActionRowProps } from './types';

export { TopActionsList } from './top-actions-list';
export type { TopActionsListProps } from './types';

export { StrategyProjections } from './strategy-projections';
export type { StrategyProjectionsProps } from './types';

export { ConflictsList } from './conflicts-list';
export type { ConflictsListProps } from './types';

export { BottlenecksStrengths } from './bottlenecks-strengths';
export type { BottlenecksStrengthsProps } from './types';

export type {
  TopAction,
  Conflict,
  OverallHealth,
  Strategy,
} from './types';
