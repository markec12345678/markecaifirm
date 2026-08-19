/**
 * Backward-compat re-export shim.
 *
 * Originally a 577-line monolith holding two Validation-phase components:
 *   - BrainSnapshotsSection (v8.23, emerald) — historical snapshots list
 *   - AccuracyTrendCard     (v8.25, teal)    — accuracy + 7-domain trend
 *
 * Also imported module-local types (SnapshotsApiResponse, AccuracyApiResponse,
 * DOMAIN_TREND_LABELS) from ./types. As part of v8.94.9-split, the two
 * components were split into per-component modules under
 * ./snapshots-accuracy/, and the 5 module-local types (SnapshotView,
 * SnapshotsApiResponse, AccuracyTrendPoint, AccuracyApiResponse,
 * DOMAIN_TREND_LABELS) were moved from ./types.ts to
 * ./snapshots-accuracy/snapshot-types.ts (they are only used by these two
 * cards).
 *
 * Existing imports like:
 *   import { BrainSnapshotsSection, AccuracyTrendCard } from './snapshots-accuracy';
 * continue to work via this shim.
 *
 * New code should import directly from './snapshots-accuracy' (the index
 * barrel).
 */

// NOTE: import path uses the explicit '/index' suffix because the shim file
// `snapshots-accuracy.tsx` shares its name with the `snapshots-accuracy/`
// directory — without the suffix, TypeScript's bundler resolution would
// resolve `./snapshots-accuracy` to THIS file (recursive import).

export { BrainSnapshotsSection, AccuracyTrendCard } from './snapshots-accuracy/index';
