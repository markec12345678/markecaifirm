/**
 * Barrel file for BrainSnapshotsSection + AccuracyTrendCard.
 *
 * Extracted from the original `snapshots-accuracy.tsx` (577 lines) as part of
 * v8.94.9-split. Re-exports the 2 Validation-phase cards:
 *
 *   - BrainSnapshotsSection   (v8.23, emerald) — horizontal scroll list of
 *     past Master Brain snapshots (date + grade + projection + actual).
 *   - AccuracyTrendCard        (v8.25, teal)    — META-ANALYSIS: 30d/90d
 *     accuracy big numbers + OverallHealth sparkline + 7-domain grade trend.
 *
 * Module-local types (SnapshotView, SnapshotsApiResponse, AccuracyTrendPoint,
 * AccuracyApiResponse, DOMAIN_TREND_LABELS) live in ./snapshot-types (moved
 * here from ../types.ts as part of v8.94.9-split — these types are only used
 * by the two cards under this directory).
 */

export { BrainSnapshotsSection } from './brain-snapshots-section';
export { AccuracyTrendCard } from './accuracy-trend-card';

export type {
  SnapshotView,
  SnapshotsApiResponse,
  AccuracyTrendPoint,
  AccuracyApiResponse,
} from './snapshot-types';

export { DOMAIN_TREND_LABELS } from './snapshot-types';
