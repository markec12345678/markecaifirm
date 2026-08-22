/**
 * Backward-compat re-export shim.
 *
 * Originally a 4095-line monolith holding all 8 automation cards (RiskProfile,
 * BrainSnapshots, AccuracyTrend, MasterBrainBanner, ScenarioBrain,
 * AdaptiveWeights, DraftQueue, AutoPilot) + their module-local types and
 * constants. Split into per-component modules under ./automation/ as part of
 * v8.94.6-split.
 *
 * Existing imports like:
 *   import { RiskProfileCard, MasterBrainBanner, ... } from './automation-cards';
 * continue to work via this shim.
 *
 * New code should import directly from './automation' (the index barrel).
 */

export {
  RiskProfileCard,
  BrainSnapshotsSection,
  AccuracyTrendCard,
  MasterBrainBanner,
  ScenarioBrainCard,
  AdaptiveWeightsCard,
  DraftQueueCard,
  AutoPilotCard,
} from './automation';
