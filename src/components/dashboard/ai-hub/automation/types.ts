/**
 * Automation-phase types and constants.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. Holds all module-local interfaces and constants used by the
 * 6 automation cards that remain in this directory:
 *
 *   - RiskProfileCard         (risk-tolerance form)
 *   - MasterBrainBanner       (synthesizes 7 domains)
 *   - ScenarioBrainCard       ("What if?" simulator)
 *   - AdaptiveWeightsCard     (domain weight sliders)
 *   - DraftQueueCard          (feedback-loop drafts)
 *   - AutoPilotCard           (auto-execute low-risk drafts)
 *
 * BrainSnapshotsSection + AccuracyTrendCard types were moved to
 * ./snapshots-accuracy/snapshot-types.ts as part of v8.94.9-split — they are
 * only used by the two Validation-phase cards under that directory.
 * AutoPilotCard types live in ./auto-pilot/types.ts (moved in
 * v8.94.8-split-autopilot).
 *
 * Cross-module shared types (DomainName, DraftStatus) are imported from
 * ../types.
 */

import type {
  DomainName,
  DraftStatus,
} from '../types';

export type RiskTolerance = 'conservative' | 'balanced' | 'aggressive';
export type InvestmentHorizon = 'short' | 'medium' | 'long';

export interface UserRiskProfile {
  riskTolerance: RiskTolerance;
  maxAcceptableRisk: number;
  liquidityReserve: number;
  investmentHorizon: InvestmentHorizon;
}

export interface RiskProfileAdjustment {
  profile: UserRiskProfile;
  adjusted: boolean;
  recommendationOverride: {
    action: 'REDUCE_RISK' | 'ACCEPT_RISK' | 'PROCEED' | 'CAUTIOUS_PROCEED';
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
  } | null;
  profileSummary: string;
}

export interface RiskProfileApiResponse {
  ok: true;
  profile: UserRiskProfile;
  adjustment: RiskProfileAdjustment | null;
}

export const RISK_TOLERANCE_OPTIONS: Array<{ value: RiskTolerance; label: string; hint: string }> = [
  { value: 'conservative', label: 'Konzervativni', hint: 'Nizko tveganje, filter HIGH akcij, 0.5× budget' },
  { value: 'balanced', label: 'Uravnoteženi', hint: 'Brez prilagoditev — Master Brain kot je' },
  { value: 'aggressive', label: 'Agresivni', hint: 'Visoka rast, dovoli HIGH akcij, 1.5× budget' },
];

export const INVESTMENT_HORIZON_OPTIONS: Array<{ value: InvestmentHorizon; label: string }> = [
  { value: 'short', label: 'Kratka' },
  { value: 'medium', label: 'Srednja' },
  { value: 'long', label: 'Dolga' },
];

export interface ActionExplanation {
  rank: number;
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  finalScore: number;
  reasoning: string;
  reasoningParts: {
    trigger: string;
    signalScore: number;
    signalGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    whyRankedHere: string;
    profileImpact: string | null;
    conflictImpact: string | null;
    expectedOutcome: string;
  };
  trustScore: number; // 0-100
}

export interface MasterBrainExplanation {
  ok: true;
  explanations: ActionExplanation[];
  summaryBlurb: string;
  trustScore: number; // 0-100 overall (weighted by finalScore)
  source: string;
  cachedAt?: number;
}

export interface MasterBrainResult {
  ok: true;
  domainSummary: Array<{
    name: DomainName;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    gradeScore: number;
    bestOpportunity: string;
    oneLineSummary: string;
  }>;
  topActions: Array<{
    rank: number;
    domain: DomainName;
    signal: string;
    action: string;
    expectedUpliftEUR: number;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    domainWeight: number;
    finalScore: number;
  }>;
  conflicts: Array<{
    id: string;
    domainA: DomainName;
    domainB: DomainName;
    description: string;
    resolution: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
  overallHealth: {
    score: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    bottlenecks: DomainName[];
    strengths: DomainName[];
  };
  strategy: {
    projection30d: { profitEUR: number; riskScore: number; keyMilestone: string };
    projection90d: { profitEUR: number; riskScore: number; keyMilestone: string };
    projection12m: { profitEUR: number; riskScore: number; keyMilestone: string };
  };
  oneLineSummary: string;
  aiUsed: false;
  source: string;
  cachedAt?: number;
  // v8.26: per-action explanations array (one per TOP action — up to 5)
  explanations?: ActionExplanation[];
  // v8.26: overall explanation summary (mirror from /api/ai/brain/explain response
  // when computed by master endpoint). Optional — only present if the master
  // endpoint included explanations in the response.
  explanationSummary?: {
    summaryBlurb: string;
    trustScore: number;
  };
}

export const DOMAIN_LABELS: Record<DomainName, { icon: string; label: string; color: string }> = {
  profit: { icon: '🧠', label: 'Profit', color: 'text-emerald-600 dark:text-emerald-400' },
  inventory: { icon: '📦', label: 'Inventar', color: 'text-amber-600 dark:text-amber-400' },
  market: { icon: '📈', label: 'Trg', color: 'text-sky-600 dark:text-sky-400' },
  sourcing: { icon: '🎯', label: 'Sourcing', color: 'text-purple-600 dark:text-purple-400' },
  risk: { icon: '🛡️', label: 'Tveganje', color: 'text-rose-600 dark:text-rose-400' },
  buyer: { icon: '👥', label: 'Kupci', color: 'text-cyan-600 dark:text-cyan-400' },
  pricing: { icon: '💶', label: 'Cene', color: 'text-lime-700 dark:text-lime-400' },
};

export interface ScenarioComparisonResponse {
  ok: true;
  scenarios: Array<{
    type: 'conservative' | 'balanced' | 'aggressive' | 'custom';
    label: string;
    description: string;
    comparison: {
      projectedProfit30d: number;
      projectedProfit90d: number;
      projectedProfit12m: number;
      overallHealth: number;
      healthGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
      riskLevel: string;
      topAction: string;
      topActionUpliftEUR: number;
      capitalRequired: number;
      conflictsCount: number;
      bottlenecksCount: number;
    };
  }>;
  baseCapital: number;
  custom?: ScenarioComparisonResponse['scenarios'][number];
  comparisonTable: Array<{
    metric: string;
    conservative: string | number;
    balanced: string | number;
    aggressive: string | number;
    custom?: string | number;
  }>;
  recommendation: {
    bestScenario: 'conservative' | 'balanced' | 'aggressive' | 'custom';
    reasoning: string;
  };
  source: string;
  cachedAt?: number;
}

export interface DomainWeightStats {
  weight: number;
  executed: number;
  rejected: number;
  lastAdjustedAt: string | null;
  adjustmentHistory: Array<{
    date: string;
    oldWeight: number;
    newWeight: number;
    reason: string;
  }>;
}

export type AdaptiveWeightsMap = Record<DomainName, DomainWeightStats>;

export interface AdaptiveWeightsResponse {
  ok: true;
  adaptiveWeights: AdaptiveWeightsMap;
  source: string;
}

export const DOMAIN_DISPLAY: Array<{
  key: DomainName;
  label: string;
  icon: string;
}> = [
  { key: 'profit', label: 'Profit', icon: '💰' },
  { key: 'inventory', label: 'Inventar', icon: '📦' },
  { key: 'market', label: 'Trg', icon: '📈' },
  { key: 'sourcing', label: 'Sourcing', icon: '🎯' },
  { key: 'risk', label: 'Tveganje', icon: '🛡️' },
  { key: 'buyer', label: 'Kupci', icon: '👥' },
  { key: 'pricing', label: 'Cene', icon: '💶' },
];

export interface DraftRow {
  id: string;
  rank: number;
  domain: DomainName;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  status: DraftStatus;
  feedbackNote: string | null;
  executedAt: string | Date | null;
  rejectedAt: string | Date | null;
  snapshotDate: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface DraftQueueResponse {
  ok: true;
  drafts: DraftRow[];
  stats: {
    total: number;
    pending: number;
    approved: number;
    executed: number;
    rejected: number;
    expired: number;
    executionRate: number;
  };
  domainStats: Array<{
    domain: DomainName;
    executed: number;
    rejected: number;
    pending: number;
    executionRate: number;
  }>;
}

// NOTE: Auto-pilot types (AutoPilotMode, AutoPilotStatsResponse,
// AutoPilotHistoryDraft, AutoPilotHistoryResponse, AutoPilotRunResponse,
// EnableAggressiveResponse, DisableAggressiveResponse, ClearAnomalyResponse)
// were moved to ./auto-pilot/types.ts as part of v8.94.8-split-autopilot.
// They are only used by AutoPilotCard and its sub-components, so colocating
// them with the consumer is more correct than keeping them in this shared
// module. DOMAIN_LABELS stays here (shared with MasterBrainBanner +
// DraftQueueCard + AutoPilotCard).
//
// NOTE: Snapshot + Accuracy types (SnapshotView, SnapshotsApiResponse,
// AccuracyTrendPoint, AccuracyApiResponse, DOMAIN_TREND_LABELS) were moved to
// ./snapshots-accuracy/snapshot-types.ts as part of v8.94.9-split. They are
// only used by BrainSnapshotsSection + AccuracyTrendCard, so colocating them
// with the consumers is more correct than keeping them in this shared module.
