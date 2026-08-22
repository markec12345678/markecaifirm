/**
 * Adaptive Weights sub-component types and derived aliases.
 *
 * Extracted from the original `adaptive-weights-card.tsx` (441 lines) as part
 * of v8.95.0-split-adaptive. Holds the Props interfaces for the presentational
 * sub-components used by AdaptiveWeightsCard (in ../adaptive-weights-card.tsx)
 * plus a derived alias over the shared `DOMAIN_DISPLAY` constant.
 *
 * Shared types (`AdaptiveWeightsResponse`, `DomainWeightStats`,
 * `DOMAIN_DISPLAY`) stay in ../types — `DOMAIN_DISPLAY` is also consumed by
 * the container's `fetchWeights` callback (to sync draft weights from the
 * server response), so co-locating the constant with a single client card
 * would be wrong. This file only adds per-sub-component Props.
 */

import type { DomainName } from '../../types';
import type {
  AdaptiveWeightsResponse,
  DomainWeightStats,
  DOMAIN_DISPLAY,
} from '../types';

// --- Derived aliases over shared shapes ----------------------------------
// Avoids re-declaring the inline `{ key, label, icon }` shape — keeps us in
// sync with ../types automatically.

export type DomainDisplayEntry = typeof DOMAIN_DISPLAY[number];

// --- Sub-component Props ---------------------------------------------------

export interface DomainWeightRowProps {
  /** Domain display entry (key, label, icon) from DOMAIN_DISPLAY. */
  domain: DomainDisplayEntry;
  /** Per-domain execution stats from `data.adaptiveWeights[domain.key]`. */
  stats: DomainWeightStats;
  /** Current draft slider value (may differ from `stats.weight` when dirty). */
  draftVal: number;
  /** Called when the user drags the slider for this domain. */
  onWeightChange: (newWeight: number) => void;
}

export interface DomainWeightsListProps {
  /** Full adaptive weights response from GET /api/ai/brain/weights. */
  data: AdaptiveWeightsResponse;
  /** Per-domain draft slider values (edited locally before Save). */
  draftWeights: Record<DomainName, number>;
  /** Called with the domain key + new weight when a slider changes. */
  onWeightChange: (domain: DomainName, newWeight: number) => void;
}

export interface ActionButtonsProps {
  /** Whether any slider has unsaved changes. */
  dirty: boolean;
  /** Whether Save is in-flight (disables Save button + spinner). */
  saving: boolean;
  /** Whether Reset is in-flight (disables Reset button + spinner). */
  resetting: boolean;
  /** Whether the parent is loading (disables Reset button). */
  loading: boolean;
  /** Called when the user clicks "Reset na default". */
  onReset: () => void;
  /** Called when the user clicks "Shrani uteži". */
  onSave: () => void;
}

export interface FeedbackFormProps {
  /** Currently selected domain in the demo feedback dropdown. */
  feedbackDomain: DomainName;
  /** Whether a feedback POST is in-flight (disables ✅/❌ buttons). */
  recording: boolean;
  /** Called when the user picks a different domain in the dropdown. */
  onFeedbackDomainChange: (domain: DomainName) => void;
  /** Called with 'executed' or 'rejected' when the user clicks a button. */
  onRecord: (feedback: 'executed' | 'rejected') => void;
}
