/**
 * Barrel file for Scenario Brain sub-components + Props/types.
 *
 * Extracted from the original `scenario-brain-card.tsx` (397 lines) as part
 * of v8.95.0-split-scenario. Re-exports the presentational sub-components used
 * by ScenarioBrainCard (in ../scenario-brain-card.tsx) plus the per-sub-
 * component Props interfaces and the moved `ScenarioComparisonResponse` type
 * (formerly in ../types.ts).
 *
 *   Sub-components:
 *     - RecommendationBanner   (🏆 Priporočeni scenarij banner)
 *     - ComparisonTable         (8 metrics × 3-4 columns side-by-side)
 *     - CustomScenarioForm      (capital / trades / risk + submit button)
 *
 *   Types (moved from ../types.ts):
 *     - ScenarioComparisonResponse, ScenarioType, RiskLevel
 *     - ComparisonRow, Recommendation, CustomScenario, ScenarioColumn
 *     - *Props interfaces for each sub-component above
 *
 * The main ScenarioBrainCard component stays at ../scenario-brain-card.tsx
 * (preserved path so the existing import in ../index.ts barrel file keeps
 * working — same shim pattern used by v8.94.8-split-autopilot and
 * v8.94.9-split-master).
 */

export { RecommendationBanner } from './recommendation-banner';
export type { RecommendationBannerProps } from './types';

export { ComparisonTable } from './comparison-table';
export type { ComparisonTableProps } from './types';

export { CustomScenarioForm } from './custom-scenario-form';
export type { CustomScenarioFormProps } from './types';

export type {
  ScenarioComparisonResponse,
  ScenarioType,
  RiskLevel,
  ComparisonRow,
  Recommendation,
  CustomScenario,
  ScenarioColumn,
} from './types';
