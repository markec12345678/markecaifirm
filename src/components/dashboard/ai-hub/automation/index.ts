/**
 * Barrel file for automation-phase AI Hub cards.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. Re-exports the 8 automation cards used by BrainSynthesisCard
 * (in ../system-cards.tsx):
 *
 *   - RiskProfileCard         (v8.24, violet)        — risk-tolerance form
 *   - BrainSnapshotsSection   (v8.23, emerald)       — historical predictions
 *   - AccuracyTrendCard        (v8.25, teal)          — historical accuracy
 *   - MasterBrainBanner        (v8.22, gold/amber)    — synthesizes 7 domains
 *   - ScenarioBrainCard        (v8.27, rose)          — "What if?" simulator
 *   - AdaptiveWeightsCard     (v8.28, orange)        — domain weight sliders
 *   - DraftQueueCard           (v8.29, slate)         — feedback-loop drafts
 *   - AutoPilotCard            (v8.30/v8.31, indigo)  — auto-execute low-risk
 *
 * Module-local types and constants live in ./types and are NOT re-exported
 * here (they were never exported by the original automation-cards.tsx either —
 * they are an internal implementation detail).
 */

export { RiskProfileCard } from './risk-profile-card';
export { BrainSnapshotsSection, AccuracyTrendCard } from './snapshots-accuracy';
export { MasterBrainBanner } from './master-brain-banner';
export { ScenarioBrainCard } from './scenario-brain-card';
export { AdaptiveWeightsCard } from './adaptive-weights-card';
export { DraftQueueCard } from './draft-queue-card';
export { AutoPilotCard } from './auto-pilot-card';
