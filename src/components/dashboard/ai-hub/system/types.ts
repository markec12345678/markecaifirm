/**
 * Module-local types and helpers for the system cards.
 *
 * Extracted from the original `system-cards.tsx` (1947 lines) as part of
 * v8.94.7-split. Holds the interfaces + helpers used by the 7 system cards
 * (SystemHealth, SeedTelegram, Performance, ActualProfit, NotificationCenter,
 * NotificationBell, BrainSynthesis orchestrator).
 *
 * Cross-module shared types (SystemHealthReport, SeedInfo, ActualProfitResponse)
 * live in ../types and are imported by the individual component modules
 * directly — this file only holds types and helpers that were originally
 * module-local to system-cards.tsx.
 */

// ============================================================================
// PerformanceCard — interfaces + helpers (cache & perf stats)
// ============================================================================

export interface CacheStatsRow {
  namespace: string;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  hitRate: number;
  total: number;
}

export interface PerfStatsRow {
  brain: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  cacheHitRate: number;
  lastDurationMs: number;
}

export interface PerformanceReport {
  ok: true;
  timestamp: string;
  cacheStats: CacheStatsRow[];
  perfStats: PerfStatsRow[];
  cacheStoreSize: number;
  summary: {
    overallHitRate: number;
    totalRequests: number;
    totalCached: number;
    avgResponseTimeMs: number;
    p95ResponseTimeMs: number;
  };
  source: string;
}

export function hitRateColor(rate: number): string {
  if (rate >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (rate >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function responseTimeColor(ms: number): string {
  if (ms < 50) return 'text-emerald-600 dark:text-emerald-400';
  if (ms <= 200) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function hitRateBarColor(rate: number): string {
  if (rate >= 70) return 'bg-emerald-500';
  if (rate >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

// Human-readable namespace label — strip the "-brain" suffix and capitalize.
export function namespaceLabel(ns: string): string {
  return ns.replace(/-brain$/, '').replace(/^./, (c) => c.toUpperCase());
}

// ============================================================================
// NotificationCenterCard + NotificationBellDropdown — interfaces + constants
// ============================================================================

export interface NotificationCenterItem {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  source: string;
  isRead: boolean;
  readAt: string | null;
  draftId: string | null;
  snapshotDate: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface NotificationCenterStats {
  total: number;
  unread: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface NotificationCenterData {
  ok: true;
  notifications: NotificationCenterItem[];
  stats: NotificationCenterStats;
}

export const NOTIFICATION_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  brain_digest: { label: 'Brain Digest', icon: '🧠' },
  autopilot_executed: { label: 'Auto-pilot', icon: '🤖' },
  autopilot_rollback: { label: 'Auto-pilot Rollback', icon: '↩️' },
  anomaly: { label: 'Anomalija', icon: '⚠️' },
  price_drop: { label: 'Cena padec', icon: '📉' },
  system: { label: 'Sistem', icon: '🔧' },
  trade_sold: { label: 'Trade prodan', icon: '💰' },
  error: { label: 'Napaka', icon: '❌' },
  buy_request_match: { label: 'Iskalnik ujemanje', icon: '🔍' },
};
