/**
 * Barrel file for Auto-pilot sub-components + types.
 *
 * Extracted from the original `auto-pilot-card.tsx` (1176 lines) as part of
 * v8.94.8-split-autopilot. Re-exports the presentational sub-components used
 * by AutoPilotCard (in ../auto-pilot-card.tsx) plus the Auto-pilot-specific
 * types (moved here from ../types.ts):
 *
 *   Sub-components:
 *     - AnomalyBanner, AggressiveActiveBanner, AggressivePendingBanner
 *     - ModeSelector
 *     - ConfigPanel
 *     - StatsDisplay
 *     - HistoryPanel
 *
 *   Types:
 *     - AutoPilotMode, AutoPilotStatsResponse, AutoPilotHistoryDraft,
 *       AutoPilotHistoryResponse, AutoPilotRunResponse,
 *       EnableAggressiveResponse, DisableAggressiveResponse,
 *       ClearAnomalyResponse
 *
 * The main AutoPilotCard component stays at ../auto-pilot-card.tsx (preserved
 * path for the existing import in ../index.ts barrel file).
 */

export { AnomalyBanner, AggressiveActiveBanner, AggressivePendingBanner } from './anomaly-banner';
export type {
  AnomalyBannerProps,
  AggressiveActiveBannerProps,
  AggressivePendingBannerProps,
} from './anomaly-banner';

export { ModeSelector } from './mode-selector';
export type { ModeSelectorProps } from './mode-selector';

export { ConfigPanel } from './config-panel';
export type { ConfigPanelProps } from './config-panel';

export { StatsDisplay } from './stats-display';
export type { StatsDisplayProps } from './stats-display';

export { HistoryPanel } from './history-panel';
export type { HistoryPanelProps } from './history-panel';

export type {
  AutoPilotMode,
  AutoPilotStatsResponse,
  AutoPilotHistoryDraft,
  AutoPilotHistoryResponse,
  AutoPilotRunResponse,
  EnableAggressiveResponse,
  DisableAggressiveResponse,
  ClearAnomalyResponse,
} from './types';
