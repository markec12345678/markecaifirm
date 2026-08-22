/**
 * Snapshot + Accuracy types and constants.
 *
 * Extracted from the original `automation/types.ts` as part of v8.94.9-split.
 * Holds the BrainSnapshotsSection + AccuracyTrendCard-specific types used only
 * by the two cards under ./snapshots-accuracy/:
 *
 *   - SnapshotView              (one row from /api/ai/brain/snapshots)
 *   - SnapshotsApiResponse      (GET /api/ai/brain/snapshots?days=N)
 *   - AccuracyTrendPoint        (one row in the 7-domain grade trend array)
 *   - AccuracyApiResponse       (GET /api/ai/brain/accuracy?days=N)
 *   - DOMAIN_TREND_LABELS       (7 Domain grade pill labels — compact trend table)
 *
 * Cross-module shared types (ActualProfitResponse, AccuracyTrendSummary) are
 * imported from ../../types (ai-hub/types.ts).
 *
 * The other automation types (RiskProfileApiResponse, MasterBrainResult,
 * AdaptiveWeightsMap, DraftQueueResponse, …) stay in ../types.ts because they
 * are shared across multiple automation cards. ScenarioComparisonResponse was
 * subsequently moved to ./../scenario-brain/types.ts as part of
 * v8.95.0-split-scenario (only consumed by the single client card).
 */

import type {
  ActualProfitResponse,
  AccuracyTrendSummary,
} from '../../types';

export interface SnapshotView {
  id: string;
  date: string;
  overallHealth: number;
  healthGrade: string;
  riskLevel: string;
  topActionCount: number;
  conflictCount: number;
  bottleneckCount: number;
  strengthCount: number;
  projection30dEUR: number;
  projection90dEUR: number;
  projection12mEUR: number;
  profitGrade: string;
  inventoryGrade: string;
  marketGrade: string;
  sourcingGrade: string;
  riskGrade: string;
  buyerGrade: string;
  pricingGrade: string;
  actualProfit30d: number | null;
  actualProfit90d: number | null;
  accuracy30d: number | null;
  accuracy90d: number | null;
  createdAt: string;
}

export interface SnapshotsApiResponse {
  ok: true;
  days: number;
  snapshots: SnapshotView[];
  actualProfit: ActualProfitResponse;
  summary: {
    days: number;
    snapshotCount: number;
    latestSnapshot: SnapshotView | null;
    oldestSnapshot: SnapshotView | null;
    avgOverallHealth: number;
    avgProjection30d: number;
    actualProfit30d: number;
    actualProfitTradeCount: number;
  };
}

export interface AccuracyTrendPoint {
  date: string;
  profitGrade: string;
  inventoryGrade: string;
  marketGrade: string;
  sourcingGrade: string;
  riskGrade: string;
  buyerGrade: string;
  pricingGrade: string;
  overallHealth: number;
  healthGrade: string;
  accuracy30d: number | null;
  accuracy90d: number | null;
}

export interface AccuracyApiResponse {
  ok: true;
  days: number;
  accuracy30d: number | null;
  accuracy90d: number | null;
  gradeTrend: AccuracyTrendPoint[];
  summary: AccuracyTrendSummary;
}

// 7 Domain grade pill style — reuses the existing gradeColor() helper but with
// smaller padding for compact trend display.
export const DOMAIN_TREND_LABELS: Array<{ key: keyof AccuracyTrendPoint; label: string }> = [
  { key: 'profitGrade', label: 'Profit' },
  { key: 'inventoryGrade', label: 'Inventar' },
  { key: 'marketGrade', label: 'Trg' },
  { key: 'sourcingGrade', label: 'Sourcing' },
  { key: 'riskGrade', label: 'Tveganje' },
  { key: 'buyerGrade', label: 'Kupci' },
  { key: 'pricingGrade', label: 'Cene' },
];
