/**
 * Auto-pilot types and response shapes.
 *
 * Extracted from the original `automation/types.ts` (454 lines) as part of
 * v8.94.8-split-autopilot. Holds the AutoPilot-specific types used only by
 * AutoPilotCard and its sub-components (anomaly banner, mode selector,
 * config panel, stats display, history panel).
 *
 *   - AutoPilotMode             (union: 'safe' | 'aggressive')
 *   - AutoPilotStatsResponse    (GET /api/ai/brain/auto-pilot)
 *   - AutoPilotHistoryDraft     (client-filtered row from /api/ai/brain/drafts)
 *   - AutoPilotHistoryResponse  (full response shape)
 *   - AutoPilotRunResponse     (POST {action:'run'})
 *   - EnableAggressiveResponse  (POST {action:'enable_aggressive'} — double confirm)
 *   - DisableAggressiveResponse (POST {action:'disable_aggressive'})
 *   - ClearAnomalyResponse      (POST {action:'clear_anomaly'})
 *
 * Shared cross-module types (DomainName) are imported from ../../types.
 * DOMAIN_LABELS constant stays in ../types (shared with other automation cards).
 */

import type { DomainName } from '../../types';

export type AutoPilotMode = 'safe' | 'aggressive';

export interface AutoPilotStatsResponse {
  ok: true;
  config: {
    enabled: boolean;
    mode: AutoPilotMode;
    dailyLimit: number;
    dailyBudgetEUR: number;
    lastRunAt: string | null;
    // v8.31: aggressive double-confirm + anomaly detection fields.
    aggressiveConfirmedAt: string | null;
    anomalySuspended: boolean;
    anomalySuspendedAt: string | null;
    anomalyReason: string | null;
    hourlyExecCount: number;
    hourlyWindowStart: string | null;
  };
  today: {
    autoExecuted: number;
    budgetUsed: number;
    budgetRemaining: number;
    limitRemaining: number;
  };
  allTime: {
    totalAutoExecuted: number;
    totalRolledBack: number;
    rollbackRate: number;
  };
  source: string;
}

export interface AutoPilotHistoryDraft {
  id: string;
  rank: number;
  domain: DomainName;
  action: string;
  signal: string;
  expectedUpliftEUR: number;
  confidence: string;
  status: string;
  autoExecuted: boolean;
  autoPilotReason: string | null;
  rolledBack: boolean;
  rolledBackAt: string | null;
  rollbackReason: string | null;
  executedAt: string | null;
  createdAt: string;
}

export interface AutoPilotHistoryResponse {
  ok: true;
  drafts: AutoPilotHistoryDraft[];
  source: string;
}

export interface AutoPilotRunResponse {
  ok: true;
  config: AutoPilotStatsResponse['config'];
  checked: number;
  autoExecuted: number;
  skipped: number;
  executedDrafts: Array<{
    id: string;
    action: string;
    domain: DomainName;
    reasons: string[];
  }>;
  skippedDrafts: Array<{
    id: string;
    action: string;
    reasons: string[];
  }>;
  todayStats: {
    autoExecuted: number;
    budgetUsed: number;
    budgetRemaining: number;
    limitRemaining: number;
  };
  // v8.31: anomaly detection result — if suspended mid-run or pre-run.
  anomalySuspended?: boolean;
  anomalyReason?: string | null;
  source: string;
}

// v8.31: Response shape for POST {action:'enable_aggressive'}.
export interface EnableAggressiveResponse {
  ok: true;
  confirmed: boolean; // false = pending first confirmation, true = aggressive enabled
  message: string;
  confirmedAt?: string;
}

// v8.31: Response shape for POST {action:'disable_aggressive'}.
export interface DisableAggressiveResponse {
  ok: true;
  mode: string;
}

// v8.31: Response shape for POST {action:'clear_anomaly'}.
export interface ClearAnomalyResponse {
  ok: true;
  message: string;
}
