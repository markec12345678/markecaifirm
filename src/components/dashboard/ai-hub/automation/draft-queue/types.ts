/**
 * Draft Queue sub-component types, shared interfaces, and Props.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Holds the DraftQueue-specific response/row shapes
 * (moved here from ../types.ts — they are only consumed by DraftQueueCard and
 * its sub-components) plus the Props interfaces for the presentational sub-
 * components used by DraftQueueCard (in ../draft-queue-card.tsx).
 *
 *   Moved types:
 *     - DraftRow              (one TOP-5 action as persisted in DB)
 *     - DraftQueueResponse    (GET /api/ai/brain/drafts response shape)
 *
 *   Derived aliases:
 *     - DraftStats            (DraftQueueResponse['stats'])
 *     - DomainStat            (DraftQueueResponse['domainStats'][number])
 *
 *   Sub-component Props:
 *     - StatsSummaryProps     (5 color-coded status pills + execution-rate pill)
 *     - FilterBarProps        (Status + Domain dropdowns + onChange handlers)
 *     - DraftRowItemProps     (single draft row + ✅/❌ patch handler)
 *     - DraftListProps        (wrapper with empty state + map of DraftRowItem)
 *     - DomainRatesProps      (per-domain execution rate bars + click-to-filter)
 *
 * Shared cross-module types (DomainName, DraftStatus) are imported from
 * ../../types. DOMAIN_DISPLAY + DOMAIN_LABELS constants stay in ../types
 * (shared with AdaptiveWeightsCard + AutoPilotCard's HistoryPanel — moving
 * them here would force other consumers to import from a draft-specific
 * subdirectory, which would be wrong).
 */

import type { DomainName, DraftStatus } from '../../types';

// --- Moved from ../types.ts (only used by DraftQueueCard + sub-components) ---

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

// --- Derived aliases over DraftQueueResponse inline shapes -------------------
// Avoids re-declaring the inline `stats` / `domainStats` shapes — keeps us in
// sync with the parent DraftQueueResponse automatically.

export type DraftStats = DraftQueueResponse['stats'];
export type DomainStat = DraftQueueResponse['domainStats'][number];

// --- Sub-component Props ----------------------------------------------------

export interface StatsSummaryProps {
  stats: DraftStats;
}

export interface FilterBarProps {
  statusFilter: DraftStatus | 'all';
  domainFilter: DomainName | 'all';
  onStatusFilterChange: (value: DraftStatus | 'all') => void;
  onDomainFilterChange: (value: DomainName | 'all') => void;
}

export interface DraftRowItemProps {
  draft: DraftRow;
  patchingId: string | null;
  onPatch: (draftId: string, status: 'executed' | 'rejected') => void;
}

export interface DraftListProps {
  drafts: DraftRow[];
  patchingId: string | null;
  onPatch: (draftId: string, status: 'executed' | 'rejected') => void;
}

export interface DomainRatesProps {
  domainStats: DomainStat[];
  domainFilter: DomainName | 'all';
  onDomainFilterChange: (value: DomainName | 'all') => void;
}
