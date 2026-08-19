/**
 * Master Brain sub-component types and derived aliases.
 *
 * Extracted from the original `master-brain-banner.tsx` (566 lines) as part
 * of v8.94.9-split-master. Holds the Props interfaces for the presentational
 * sub-components used by MasterBrainBanner (in ../master-brain-banner.tsx)
 * plus derived type aliases over the shared `MasterBrainResult` shape
 * (avoids re-declaring inline array/object types).
 *
 * Shared types (`ActionExplanation`, `MasterBrainResult`, `DOMAIN_LABELS`)
 * stay in ../types — they are also consumed by server-side modules
 * (`src/lib/brain/master.ts`, `src/app/api/ai/brain/master/route.ts`, etc.),
 * so co-locating them with a single client component would be wrong. This
 * file only adds convenience aliases + per-sub-component Props.
 */

import type { ActionExplanation, MasterBrainResult } from '../types';

// --- Derived aliases over MasterBrainResult inline shapes ------------------
// Avoids re-declaring the inline `topActions` / `conflicts` / `overallHealth`
// shapes — keeps us in sync with ../types automatically.

export type TopAction = MasterBrainResult['topActions'][number];
export type Conflict = MasterBrainResult['conflicts'][number];
export type OverallHealth = MasterBrainResult['overallHealth'];
export type Strategy = MasterBrainResult['strategy'];

// --- Sub-component Props ---------------------------------------------------

export interface ActionExplanationPanelProps {
  explanation: ActionExplanation;
}

export interface TopActionRowProps {
  action: TopAction;
  explanation?: ActionExplanation;
  expanded: boolean;
  onToggleExpand: () => void;
  draftId?: string;
  patchingRank: number | null;
  patchedStatus?: 'executed' | 'rejected';
  onPatch: (status: 'executed' | 'rejected') => void;
}

export interface TopActionsListProps {
  topActions: TopAction[];
  explanations?: ActionExplanation[];
  expandedRank: number | null;
  onExpandedRankChange: (rank: number | null) => void;
  draftIds: Record<number, string>;
  patchingRank: number | null;
  patchedRanks: Record<number, 'executed' | 'rejected'>;
  onPatch: (rank: number, status: 'executed' | 'rejected') => void;
}

export interface StrategyProjectionsProps {
  strategy: Strategy;
}

export interface ConflictsListProps {
  conflicts: Conflict[];
}

export interface BottlenecksStrengthsProps {
  overallHealth: OverallHealth;
}
