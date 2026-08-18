/**
 * System health, seed/telegram, performance, notification, and orchestration cards.
 *
 * Extracted from the original monolithic `ai-hub-view.tsx` (8217 lines) as
 * part of v8.94.5-split. Holds the "system" cards that aggregate brain-system
 * health, performance, and notifications, plus the BrainSynthesisCard
 * orchestrator that composes all 7 brain sections + automation cards +
 * notification card into one stacked Card.
 *
 *   - SystemHealthCard       (v8.32, emerald/amber/red gradient)
 *   - SeedAndTelegramCard    (v8.35, lime + cyan)
 *   - PerformanceCard        (v8.33, yellow/amber — cache + perf stats)
 *   - ActualProfitCard       (v8.23, indigo/violet — ground truth EUR profit)
 *   - NotificationCenterCard (v8.38, orange/amber — history of notifications)
 *   - NotificationBellDropdown (v8.38, unread-count bell in header)
 *   - BrainSynthesisCard     (orchestrator — composes all cards below it)
 *
 * Module-local types (CacheStatsRow, PerfStatsRow, PerformanceReport,
 * ActualProfitResponse, NotificationCenterItem, NotificationCenterStats,
 * NotificationCenterData) are kept in this file.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity,
  AlertCircle,
  AlertOctagon,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bot,
  Brain,
  Camera,
  Check,
  ClipboardList,
  Clock,
  Coins,
  Crown,
  Eye,
  HeartPulse,
  Info,
  MessageCircle,
  Package,
  RefreshCw,
  Send,
  Settings2,
  Shield,
  Sprout,
  Target,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SystemHealthReport, SeedInfo, ActualProfitResponse } from './types';
import { gradeTextColor, severityBadgeClass, timeAgo } from './utils';

// Cross-module components used by BrainSynthesisCard orchestrator
import {
  ProfitBrainSection,
  InventoryBrainSection,
  MarketBrainSection,
  SourcingBrainSection,
  RiskBrainSection,
  BuyerBrainSection,
  PricingBrainSection,
} from './brain-sections';
import {
  RiskProfileCard,
  MasterBrainBanner,
  ScenarioBrainCard,
  AdaptiveWeightsCard,
  DraftQueueCard,
  AutoPilotCard,
  BrainSnapshotsSection,
  AccuracyTrendCard,
} from './automation-cards';

// ============================================================================
// Local types & constants (used only inside this module)
// ============================================================================

const BRAIN_HEALTH_ICONS: Record<string, { icon: typeof Brain; tint: string }> = {
  profit: { icon: Coins, tint: 'text-emerald-600 dark:text-emerald-400' },
  inventory: { icon: Package, tint: 'text-amber-600 dark:text-amber-400' },
  market: { icon: TrendingUp, tint: 'text-sky-600 dark:text-sky-400' },
  sourcing: { icon: Target, tint: 'text-violet-600 dark:text-violet-400' },
  risk: { icon: Shield, tint: 'text-red-600 dark:text-red-400' },
  buyer: { icon: Users, tint: 'text-cyan-600 dark:text-cyan-400' },
  pricing: { icon: Coins, tint: 'text-lime-600 dark:text-lime-400' },
  master: { icon: Crown, tint: 'text-amber-600 dark:text-amber-400' },
};
interface CacheStatsRow {
  namespace: string;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  hitRate: number;
  total: number;
}

interface PerfStatsRow {
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

interface PerformanceReport {
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

const ACTUAL_PROFIT_DAYS_PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '12m', days: 365 },
] as const;

interface NotificationCenterItem {
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

interface NotificationCenterStats {
  total: number;
  unread: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

interface NotificationCenterData {
  ok: true;
  notifications: NotificationCenterItem[];
  stats: NotificationCenterStats;
}

const NOTIFICATION_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
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

const NOTIFICATION_SEVERITY_STYLES: Record<string, string> = {
  info: 'border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300',
  success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  error: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300',
};

export function SystemHealthCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  const [data, setData] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/health', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SystemHealthReport;
      if (!json?.ok) throw new Error('System Health API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    // Auto-refresh every 60 seconds — health should be fresh.
    const intervalId = setInterval(() => {
      fetchHealth();
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchHealth]);

  // Status → gradient background classes (emerald / amber / red).
  const status = data?.status ?? 'DEGRADED';
  const gradientClasses =
    status === 'HEALTHY'
      ? 'from-emerald-500/15 via-emerald-500/10 to-teal-500/5 border-emerald-500/40'
      : status === 'DEGRADED'
        ? 'from-amber-500/15 via-amber-500/10 to-yellow-500/5 border-amber-500/40'
        : 'from-red-500/15 via-rose-500/10 to-red-500/5 border-red-500/40';
  const statusBadgeClasses =
    status === 'HEALTHY'
      ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
      : status === 'DEGRADED'
        ? 'border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-500/10'
        : 'border-red-500/50 text-red-700 dark:text-red-300 bg-red-500/10';

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gradient-to-br p-3 sm:p-4 shadow-sm',
      gradientClasses,
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HeartPulse className="w-5 h-5 shrink-0 text-primary" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🏥 System Health
          </span>
          <Badge variant="outline" className="text-[10px] border-primary/50 text-primary shrink-0 font-bold">
            v8.32
          </Badge>
          {data && (
            <Badge variant="outline" className={cn('text-[9px] font-bold shrink-0', statusBadgeClasses)}>
              {status}
            </Badge>
          )}
        </div>

        <button
          onClick={fetchHealth}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-primary/10" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 bg-primary/10" />
            ))}
          </div>
          <Skeleton className="h-4 w-3/4 bg-primary/10" />
          <Skeleton className="h-4 w-2/3 bg-primary/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchHealth} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {data && (
        <div className="space-y-3">
          {/* Big health score */}
          <div className="text-center px-1">
            <div className={cn(
              'text-3xl sm:text-4xl font-bold font-mono tracking-tight',
              gradeTextColor(data.overallGrade),
            )}>
              {data.overallHealthScore}<span className="text-base text-muted-foreground font-normal">/100</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-center gap-2 flex-wrap">
              <span className={cn('font-bold', gradeTextColor(data.overallGrade))}>
                Grade: {data.overallGrade}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className={cn('font-bold', gradeTextColor(data.overallGrade))}>
                {data.status}
              </span>
            </div>
          </div>

          {/* 8 Brain endpoints grid */}
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              8 Brain Endpoints
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {data.brainEndpoints.map((b) => {
                const iconMeta = BRAIN_HEALTH_ICONS[b.name] ?? { icon: Brain, tint: 'text-muted-foreground' };
                const Icon = iconMeta.icon;
                return (
                  <button
                    key={b.name}
                    onClick={onBrainCategoryClick}
                    title={b.responsive
                      ? `${b.name}: ${b.responseTimeMs}ms${b.grade ? ` · Grade ${b.grade}` : ''}`
                      : `${b.name}: ${b.lastError ?? 'error'}`}
                    className={cn(
                      'rounded border p-1.5 text-left transition-all hover:scale-[1.02] hover:shadow-sm',
                      b.responsive
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-red-500/40 bg-red-500/5',
                    )}
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <Icon className={cn('w-3 h-3 shrink-0', iconMeta.tint)} />
                      <span className="text-[10px] font-semibold uppercase truncate">
                        {b.name}
                      </span>
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0 ml-auto',
                          b.responsive ? 'bg-emerald-500' : 'bg-red-500',
                        )}
                        title={b.responsive ? 'Responsive' : 'Not responding'}
                      />
                    </div>
                    <div className="text-[9px] text-muted-foreground font-mono">
                      {b.responsive ? `${b.responseTimeMs}ms` : 'timeout'}
                    </div>
                    {b.grade && (
                      <div className={cn('text-[10px] font-bold', gradeTextColor(b.grade))}>
                        {b.grade}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Data freshness + auto-pilot + draft queue + risk + adaptive */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
            {/* Data freshness */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <Camera className="w-2.5 h-2.5" /> Data Freshness
              </div>
              <div className="font-mono">
                📸 {data.dataFreshness.latestSnapshotDate
                  ? `${data.dataFreshness.latestSnapshotDate} (${data.dataFreshness.daysSinceLastSnapshot === 0 ? 'danes' : `${data.dataFreshness.daysSinceLastSnapshot}d nazaj`})`
                  : 'Ni snapshot-a'}
                {' · '}
                <span title="Število snapshotov">
                  {data.dataFreshness.snapshotsCount} {data.dataFreshness.snapshotsCount === 1 ? 'snap' : 'snap-ov'}
                </span>
              </div>
              <div className="font-mono">
                📊 {data.dataFreshness.tradesRecorded} {data.dataFreshness.tradesRecorded === 1 ? 'trade' : 'trade-ov'}
                {' · 📈 '}
                {data.dataFreshness.accuracy30d != null
                  ? `${data.dataFreshness.accuracy30d}% acc`
                  : '— acc'}
              </div>
            </div>

            {/* Auto-pilot status */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <Bot className="w-2.5 h-2.5" /> Auto-pilot
              </div>
              <div className="font-mono">
                {data.autoPilot.anomalySuspended
                  ? <span className="text-red-600 dark:text-red-400 font-bold">🤖 SUSPENDED (anomaly)</span>
                  : data.autoPilot.enabled
                    ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">🤖 ON ({data.autoPilot.mode})</span>
                    : <span className="text-amber-600 dark:text-amber-400 font-bold">🤖 OFF ({data.autoPilot.mode} ready)</span>}
              </div>
              <div className="font-mono text-muted-foreground">
                {data.autoPilot.todayAutoExecuted} today · {Math.round(data.autoPilot.todayBudgetUsed)}€ used
              </div>
            </div>

            {/* Draft queue */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <ClipboardList className="w-2.5 h-2.5" /> Draft Queue
              </div>
              <div className="font-mono">
                📋 {data.draftQueue.pending} pending
                {' · '} {data.draftQueue.executed} exec
                {' · '} {data.draftQueue.rejected} rej
              </div>
              <div className="font-mono text-muted-foreground">
                {Math.round(data.draftQueue.executionRate * 100)}% execution rate · {data.draftQueue.expired} expired
              </div>
            </div>

            {/* Risk + adaptive */}
            <div className="rounded border border-border/50 bg-background/40 p-1.5">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5 flex items-center gap-1">
                <Settings2 className="w-2.5 h-2.5" /> Risk & Adaptive
              </div>
              <div className="font-mono">
                ⚙️ {data.riskProfile.riskTolerance} ({data.riskProfile.maxAcceptableRisk}/100)
              </div>
              <div className="font-mono text-muted-foreground">
                🎛️ {data.adaptiveWeights.adjustedDomains} domains adjusted · {data.adaptiveWeights.totalExecuted} exec · {data.adaptiveWeights.totalRejected} rej
              </div>
            </div>
          </div>

          {/* Recommendations */}
          {data.recommendations.length > 0 && (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
                <Info className="w-3 h-3" /> Priporočila ({data.recommendations.length})
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                {data.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="text-[10px] rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-amber-700 dark:text-amber-300"
                  >
                    {rec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All healthy message */}
          {data.recommendations.length === 0 && (
            <div className="text-center text-[11px] text-emerald-600 dark:text-emerald-400 italic">
              ✅ Sistem je zdrav — vsi brain-i odgovarjajo, podatki so sveži.
            </div>
          )}

          {/* Last updated timestamp */}
          <div className="text-[9px] text-muted-foreground/70 text-right">
            Osveženo: {new Date(data.timestamp).toLocaleTimeString('sl-SI')}
            {status !== 'HEALTHY' && ' · auto-refresh 60s'}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Seed & Telegram Card (v8.35, lime + cyan gradient) --------------------
//
// v8.35 NEW: Polish phase continues — "Make the system alive."
//
// TWO action areas in one card (because both are about "onboarding" the Brain
// system with real-world signals):
//
//   A. SEED DEMO DATA — if Trade table is empty (0 trades), shows a prominent
//      🌱 button to load 25 realistic Slovenian trade-ov (Bolha/Vinted/
//      Avtonet/mobile.de, electronics/sneakers/clothing/auto/tools, last 90
//      days, mixed margins including one deliberate loss). Idempotent —
//      if trades already exist, the section is hidden.
//
//   B. TELEGRAM BRAIN NOTIFICATIONS — 3 test buttons that send test
//      notifications via the existing Telegram bot:
//        • "Pošlji digest" — sends real Master Brain TOP 5 + health summary
//        • "Pošlji auto-pilot test" — sends a mock auto-pilot execution alert
//        • "Pošlji anomalija test" — sends a mock anomaly suspension alert
//      Each button returns "✅ Poslano" or "❌ Telegram ni konfiguriran"
//      (when Telegram is not set up in Settings).
//
// Placed IMMEDIATELY BELOW 🏥 System Health (health first, then onboarding).
// Dual-tint gradient: lime for seed (growth metaphor) + cyan for Telegram
// (messaging metaphor). Auto-refreshes trade count every 60s.

export function SeedAndTelegramCard() {
  const [seedInfo, setSeedInfo] = useState<SeedInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ type: string; sent: boolean; reason?: string | null } | null>(null);

  const fetchSeedInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const res = await fetch('/api/ai/brain/seed', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SeedInfo;
      if (!json?.ok) throw new Error('API ni vrnil rezultata');
      setSeedInfo(json);
    } catch {
      // Silent fail — the card just shows the seed button without count info
    } finally {
      setLoadingInfo(false);
    }
  }, []);

  useEffect(() => {
    fetchSeedInfo();
    // Auto-refresh trade count every 60 seconds (matches SystemHealthCard cadence)
    const intervalId = setInterval(() => {
      fetchSeedInfo();
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchSeedInfo]);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/ai/brain/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      if (json.created > 0) {
        toast.success(`✓ Naloženih ${json.created} demo trade-ov. Osvežujem...`);
        // Refresh info to show new trade count
        await fetchSeedInfo();
        // Trigger a full page refresh after a short delay so all brain cards recompute
        setTimeout(() => {
          if (typeof window !== 'undefined') window.location.reload();
        }, 1500);
      } else {
        // Skipped because trades already exist
        toast.info(`ℹ️ Trade-i že obstajajo (${json.total}). Uporabi 'reseed' za reset.`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri nalaganju demo podatkov');
    } finally {
      setSeeding(false);
    }
  }, [fetchSeedInfo]);

  const handleTelegramTest = useCallback(async (type: 'digest' | 'autopilot' | 'anomaly') => {
    setSendingTest(type);
    setLastResult(null);
    try {
      const res = await fetch('/api/ai/brain/telegram-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      if (json.sent) {
        toast.success(`✓ ${type} test poslan na Telegram`);
        setLastResult({ type, sent: true });
      } else {
        const reason = json.reason ?? 'Telegram ni konfiguriran';
        toast.warning(`ℹ️ ${type}: ${reason}`);
        setLastResult({ type, sent: false, reason });
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri testiranju Telegram-a');
      setLastResult({ type, sent: false, reason: e?.message ?? 'Napaka' });
    } finally {
      setSendingTest(null);
    }
  }, []);

  // Hide the seed section if trades already exist (user already has real data)
  const showSeedSection = seedInfo ? seedInfo.count === 0 : loadingInfo;

  return (
    <div className="rounded-xl border-2 bg-gradient-to-br from-lime-500/15 via-cyan-500/10 to-sky-500/5 border-lime-500/40 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sprout className="w-5 h-5 shrink-0 text-lime-600 dark:text-lime-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🌱 Seed Data & 📱 Telegram
          </span>
          <Badge variant="outline" className="text-[10px] border-lime-500/50 text-lime-700 dark:text-lime-300 shrink-0 font-bold">
            v8.35
          </Badge>
        </div>
        <button
          onClick={fetchSeedInfo}
          disabled={loadingInfo}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loadingInfo && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* SEED SECTION — only shown if Trade table is empty */}
      {showSeedSection ? (
        <div className="rounded-lg border border-lime-500/30 bg-lime-500/5 p-2.5 mb-2.5">
          <div className="flex items-start gap-2 mb-2">
            <Sprout className="w-4 h-4 shrink-0 text-lime-600 dark:text-lime-400 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-bold text-lime-700 dark:text-lime-300">Nisi še dodal nobene prodaje.</span>{' '}
              <span className="text-muted-foreground">
                Naloži demo podatke (25 trade-ov) za testiranje Brain sistema — Actual Profit, Accuracy in vsi Brain signali bodo dobili realne podatke.
              </span>
            </div>
          </div>
          <Button
            onClick={handleSeed}
            disabled={seeding}
            size="sm"
            className="w-full h-8 text-[11px] bg-lime-600 hover:bg-lime-700 text-white border-0"
          >
            {seeding ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin mr-1" /> Nalagam...
              </>
            ) : (
              <>
                <Sprout className="w-3 h-3 mr-1" /> Naloži demo podatke (25 trade-ov)
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 mb-2.5 text-[10px] text-emerald-700 dark:text-emerald-300">
          ✓ Trade-i obstajajo: <span className="font-mono font-bold">{seedInfo?.count ?? 0}</span>
          {' '}({seedInfo?.byStatus.sold ?? 0} sold · {seedInfo?.byStatus.held ?? 0} held · {seedInfo?.byStatus.cancelled ?? 0} cancelled)
        </div>
      )}

      {/* TELEGRAM SECTION — always visible */}
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <MessageCircle className="w-3.5 h-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <span className="text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
            📱 Telegram Brain Notifications
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
          3 tipi obvestil: (1) <span className="font-semibold">dnevni digest</span> — TOP 5 akcij + health + strategija; (2) <span className="font-semibold">auto-pilot alert</span> — ko auto-pilot izvede akcijo; (3) <span className="font-semibold">anomalija alert</span> — ko je auto-pilot suspendiran.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          <Button
            onClick={() => handleTelegramTest('digest')}
            disabled={sendingTest !== null}
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            {sendingTest === 'digest' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
            Pošlji digest
          </Button>
          <Button
            onClick={() => handleTelegramTest('autopilot')}
            disabled={sendingTest !== null}
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            {sendingTest === 'autopilot' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Bot className="w-3 h-3 mr-1" />}
            Pošlji auto-pilot test
          </Button>
          <Button
            onClick={() => handleTelegramTest('anomaly')}
            disabled={sendingTest !== null}
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10"
          >
            {sendingTest === 'anomaly' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <AlertOctagon className="w-3 h-3 mr-1" />}
            Pošlji anomalija test
          </Button>
        </div>
        {lastResult && (
          <div className={cn(
            'mt-2 text-[10px] rounded border px-2 py-1',
            lastResult.sent
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>
            {lastResult.sent
              ? `✅ ${lastResult.type}: Poslano na Telegram`
              : `❌ ${lastResult.type}: ${lastResult.reason ?? 'Telegram ni konfiguriran'}`}
          </div>
        )}
        <div className="mt-2 text-[9px] text-muted-foreground/70 leading-relaxed">
          💡 Konfiguriraj Telegram bot token + chat ID v ⚙️ Settings → Telegram sekcija.
        </div>
      </div>
    </div>
  );
}

// --- Performance & Cache Stats Card (v8.33, yellow/amber tint) -----------
//
// v8.33 NEW PHASE: Polish continues — "How fast is the Brain system?
// Is the cache working?"
//
// Placed IMMEDIATELY BELOW the 🏥 System Health card (health first, then
// performance). Aggregates two complementary signals:
//
//   1. CACHE STATS (per namespace) — hit/miss/sets counters for each brain
//      layer's in-memory cache (master-brain, profit-brain, ...). The
//      overall hit rate (weighted) is the headline metric — a healthy
//      system should hit ≥70% (cache is doing its job).
//
//   2. PERF STATS (per brain) — rolling-window (last 100 calls) response
//      times per brain: avg, p50 (median), p95, p99, min, max, last.
//      Color-coded thresholds: green <50ms, amber 50-200ms, red >200ms.
//      cacheHitRate here is derived from the perf entries themselves
//      (cached flag set by recordPerf on each call) — independent from the
//      ai-cache.ts counter, so a useful cross-check.
//
// Action buttons:
//   - 🔄 Osveži — manual refetch (auto-refresh every 30s)
//   - 🗑️ Reset stats — POST { action: 'reset' } to clear counters
//
// Fetches /api/ai/brain/performance. Yellow/amber gradient (visual link
// to the lightning/⚡ emoji — "this is the speed card").

export function PerformanceCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  const [data, setData] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetchPerf = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/performance', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PerformanceReport;
      if (!json?.ok) throw new Error('Performance API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  const resetStats = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/ai/brain/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // After reset, refetch immediately to show cleared state.
      await fetchPerf();
      toast.success('Stats reset.');
    } catch (e: any) {
      toast.error(`Reset failed: ${e?.message ?? 'Napaka'}`);
    } finally {
      setResetting(false);
    }
  }, [fetchPerf]);

  useEffect(() => {
    fetchPerf();
    // Auto-refresh every 30 seconds — perf stats change frequently.
    const intervalId = setInterval(() => {
      fetchPerf();
    }, 30 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchPerf]);

  const summary = data?.summary;
  const overallHitRate = summary?.overallHitRate ?? 0;
  const avgResponseTimeMs = summary?.avgResponseTimeMs ?? 0;
  const p95ResponseTimeMs = summary?.p95ResponseTimeMs ?? 0;
  const totalRequests = summary?.totalRequests ?? 0;
  const totalCached = summary?.totalCached ?? 0;

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gradient-to-br p-3 sm:p-4 shadow-sm',
      'from-amber-500/15 via-yellow-500/10 to-amber-500/5 border-amber-500/40',
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            ⚡ Performance & Cache Stats
          </span>
          <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-300 shrink-0 font-bold">
            v8.33
          </Badge>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={resetStats}
            disabled={resetting || loading}
            title="Reset cache + perf stats"
            className="text-[10px] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 className={cn('w-2.5 h-2.5', resetting && 'animate-spin')} />
            Reset
          </button>
          <button
            onClick={fetchPerf}
            disabled={loading}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
            Osveži
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full bg-amber-500/10" />
          <Skeleton className="h-32 w-full bg-amber-500/10" />
          <Skeleton className="h-32 w-full bg-amber-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchPerf} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {data && (
        <div className="space-y-3">
          {/* Overall summary — 4 big numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                Cache hit rate
              </div>
              <div className={cn('text-lg sm:text-xl font-bold font-mono', hitRateColor(overallHitRate))}>
                {overallHitRate.toFixed(1)}<span className="text-xs text-muted-foreground font-normal">%</span>
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                Total requests
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono">
                {totalRequests}
              </div>
              <div className="text-[9px] text-muted-foreground font-mono">
                {totalCached} cached
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                Avg response
              </div>
              <div className={cn('text-lg sm:text-xl font-bold font-mono', responseTimeColor(avgResponseTimeMs))}>
                {avgResponseTimeMs}<span className="text-xs text-muted-foreground font-normal">ms</span>
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-background/40 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                P95 response
              </div>
              <div className={cn('text-lg sm:text-xl font-bold font-mono', responseTimeColor(p95ResponseTimeMs))}>
                {p95ResponseTimeMs}<span className="text-xs text-muted-foreground font-normal">ms</span>
              </div>
            </div>
          </div>

          {/* Cache stats table (per namespace) */}
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <Brain className="w-3 h-3" />
              Cache Stats ({data.cacheStats.length} namespaces)
            </div>
            {data.cacheStats.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-2">
                Ni še cache statistike — kliči kateri od brain-ov da napolniš.
              </div>
            ) : (
              <div className="rounded border border-amber-500/20 overflow-hidden">
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-amber-500/10 text-muted-foreground">
                    <tr>
                      <th className="text-left p-1.5 font-semibold">Namespace</th>
                      <th className="text-right p-1.5 font-semibold">Hits</th>
                      <th className="text-right p-1.5 font-semibold">Misses</th>
                      <th className="text-right p-1.5 font-semibold">Sets</th>
                      <th className="text-right p-1.5 font-semibold">Hit Rate</th>
                      <th className="text-left p-1.5 font-semibold w-24">Bar</th>
                      <th className="text-right p-1.5 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cacheStats
                      .slice()
                      .sort((a, b) => a.namespace.localeCompare(b.namespace))
                      .map((cs) => (
                        <tr
                          key={cs.namespace}
                          className="border-t border-amber-500/10 hover:bg-amber-500/5 cursor-pointer"
                          onClick={onBrainCategoryClick}
                          title={`Klikni za brain kategorijo — ${cs.namespace}`}
                        >
                          <td className="p-1.5 font-semibold text-left">
                            {namespaceLabel(cs.namespace)}
                          </td>
                          <td className="p-1.5 text-right text-emerald-600 dark:text-emerald-400">
                            {cs.hits}
                          </td>
                          <td className="p-1.5 text-right text-red-600 dark:text-red-400">
                            {cs.misses}
                          </td>
                          <td className="p-1.5 text-right text-muted-foreground">
                            {cs.sets}
                          </td>
                          <td className={cn('p-1.5 text-right font-bold', hitRateColor(cs.hitRate))}>
                            {cs.hitRate.toFixed(1)}%
                          </td>
                          <td className="p-1.5">
                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn('h-full rounded-full transition-all', hitRateBarColor(cs.hitRate))}
                                style={{ width: `${Math.min(100, cs.hitRate)}%` }}
                              />
                            </div>
                          </td>
                          <td className="p-1.5 text-right text-muted-foreground">
                            {cs.total}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Performance stats table (per brain) */}
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1.5 flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Performance Stats ({data.perfStats.length} brains · rolling window 100)
            </div>
            {data.perfStats.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic text-center py-2">
                Ni še perf statistike — kliči kateri od brain-ov da napolniš.
              </div>
            ) : (
              <div className="rounded border border-amber-500/20 overflow-x-auto">
                <table className="w-full text-[10px] font-mono min-w-[560px]">
                  <thead className="bg-amber-500/10 text-muted-foreground">
                    <tr>
                      <th className="text-left p-1.5 font-semibold">Brain</th>
                      <th className="text-right p-1.5 font-semibold">Count</th>
                      <th className="text-right p-1.5 font-semibold">Avg ms</th>
                      <th className="text-right p-1.5 font-semibold">P50 ms</th>
                      <th className="text-right p-1.5 font-semibold">P95 ms</th>
                      <th className="text-right p-1.5 font-semibold">P99 ms</th>
                      <th className="text-right p-1.5 font-semibold">Min</th>
                      <th className="text-right p-1.5 font-semibold">Max</th>
                      <th className="text-right p-1.5 font-semibold">Cache %</th>
                      <th className="text-right p-1.5 font-semibold">Last ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perfStats.map((ps) => (
                      <tr
                        key={ps.brain}
                        className="border-t border-amber-500/10 hover:bg-amber-500/5 cursor-pointer"
                        onClick={onBrainCategoryClick}
                        title={`Klikni za brain kategorijo — ${ps.brain}`}
                      >
                        <td className="p-1.5 font-semibold text-left capitalize">
                          {ps.brain}
                        </td>
                        <td className="p-1.5 text-right text-muted-foreground">
                          {ps.count}
                        </td>
                        <td className={cn('p-1.5 text-right font-bold', responseTimeColor(ps.avgMs))}>
                          {ps.avgMs}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.p50Ms))}>
                          {ps.p50Ms}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.p95Ms))}>
                          {ps.p95Ms}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.p99Ms))}>
                          {ps.p99Ms}
                        </td>
                        <td className="p-1.5 text-right text-muted-foreground">
                          {ps.minMs}
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.maxMs))}>
                          {ps.maxMs}
                        </td>
                        <td className={cn('p-1.5 text-right font-semibold', hitRateColor(ps.cacheHitRate))}>
                          {ps.cacheHitRate.toFixed(0)}%
                        </td>
                        <td className={cn('p-1.5 text-right', responseTimeColor(ps.lastDurationMs))}>
                          {ps.lastDurationMs}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Cache store size + last updated */}
          <div className="flex items-center justify-between text-[9px] text-muted-foreground/70 gap-2 flex-wrap">
            <span className="font-mono">
              📦 Cache entries: <span className="font-bold text-amber-700 dark:text-amber-300">{data.cacheStoreSize}</span>
            </span>
            <span>
              Osveženo: {new Date(data.timestamp).toLocaleTimeString('sl-SI')} · auto-refresh 30s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Actual Profit Card (v8.23, indigo/violet tint) ----------------------
//
// v8.23 NEW PHASE: Validation — "Ali lahko zaupaš Master Brain-u?"
//
// This card shows GROUND TRUTH: actual EUR profit computed from the Trade
// table (status='sold', sellDate within last N days). Placed ABOVE the Master
// Brain banner because ground truth should be the first thing the user sees,
// before predictions. The Master Brain banner shows PREDICTIONS (30d: 3133€);
// this card shows ACTUAL (zadnjih 30 dni: X€ prodano).
//
// Visual hierarchy: Actual Profit (top, indigo, ground truth) → Master Brain
// (gold/amber, predictions) → 7 Domain Brains (detailed drill-down).
//
// Days selector: 7d / 30d / 90d / 12m (12m = 365d).

export function ActualProfitCard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ActualProfitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActual = useCallback(async (selectedDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/brain/actual-profit?days=${selectedDays}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ActualProfitResponse;
      if (!json?.ok) throw new Error('Actual profit API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActual(days);
  }, [days, fetchActual]);

  const profitPositive = (data?.totalProfitEUR ?? 0) >= 0;

  return (
    <div className="rounded-xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-purple-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📊 Dejanski profit
          </span>
          <Badge variant="outline" className="text-[10px] border-indigo-500/50 text-indigo-700 dark:text-indigo-400 shrink-0 font-bold">
            v8.23
          </Badge>
          <Badge variant="outline" className="text-[9px] border-indigo-500/30 text-indigo-700/80 dark:text-indigo-400/80 shrink-0">
            GROUND TRUTH
          </Badge>
        </div>

        {/* Days selector: 7d / 30d / 90d / 12m */}
        <div className="flex items-center gap-0.5 bg-background/50 rounded-md border border-indigo-500/20 p-0.5">
          {ACTUAL_PROFIT_DAYS_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono font-semibold rounded transition-colors',
                days === p.days
                  ? 'bg-indigo-500/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-muted-foreground hover:text-foreground hover:bg-indigo-500/10',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full bg-indigo-500/10" />
          <Skeleton className="h-4 w-3/4 bg-indigo-500/10" />
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
            <Skeleton className="h-7 bg-indigo-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={() => fetchActual(days)} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Big profit number */}
          <div className="text-center px-1">
            <div className={cn(
              'text-3xl sm:text-4xl font-bold font-mono tracking-tight',
              profitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}>
              {profitPositive ? '+' : ''}{data.totalProfitEUR}€
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {data.dailyAvgEUR >= 0 ? '+' : ''}{data.dailyAvgEUR}€/dan · {data.tradeCount} {data.tradeCount === 1 ? 'trade' : 'trade-ov'} · {data.avgProfitPerTradeEUR}€/trade · {data.avgMarginPct}% margin
            </div>
          </div>

          {/* Metrics grid: revenue / cost / margin / daily avg */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Prihodek</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {Math.round(data.totalRevenueEUR)}€
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Stroški</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {Math.round(data.totalCostEUR)}€
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Margin</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {data.avgMarginPct}%
              </div>
            </div>
            <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Na dan</div>
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400">
                {data.dailyAvgEUR}€
              </div>
            </div>
          </div>

          {/* Best / worst trade pills */}
          {(data.bestTrade || data.worstTrade) && (
            <div className="flex flex-wrap gap-2 justify-center text-[10px]">
              {data.bestTrade && (
                <div className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5">
                  <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">Naj:</span>
                  <span className="font-semibold truncate max-w-[140px]" title={data.bestTrade.title}>
                    {data.bestTrade.title}
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    +{data.bestTrade.profitEUR}€
                  </span>
                </div>
              )}
              {data.worstTrade && (
                <div className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/5 px-2 py-0.5">
                  <ArrowDownRight className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-muted-foreground">Slab:</span>
                  <span className="font-semibold truncate max-w-[140px]" title={data.worstTrade.title}>
                    {data.worstTrade.title}
                  </span>
                  <span className={cn(
                    'font-bold',
                    data.worstTrade.profitEUR >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400',
                  )}>
                    {data.worstTrade.profitEUR >= 0 ? '+' : ''}{data.worstTrade.profitEUR}€
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {data.tradeCount === 0 && (
            <p className="text-[11px] text-muted-foreground italic text-center">
              📭 Ni prodaj v zadnjih {days} dneh. Dodaj prodaje v Trade tabelo za prikaz dejanskega profita.
            </p>
          )}

          {/* Refresh */}
          <div className="flex justify-end">
            <button
              onClick={() => fetchActual(days)}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži dejanski profit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- User Risk Profile Card (v8.24, violet/indigo tint) ------------------
//
// v8.24: User Risk Profile — makes Master Brain PERSONAL.
//
// Problem (v8.15-v8.23): Master Brain gives the SAME recommendation for a
// conservative user (who wants low risk) and an aggressive user (who wants
// high growth). This is impersonal and wrong.
//
// Solution: 4 user-configurable fields stored in Settings singleton:
//   - riskTolerance: 'conservative' | 'balanced' | 'aggressive'
//   - maxAcceptableRisk: 0-100 (numeric cap)
//   - liquidityReserve: EUR (min cash to keep)
//   - investmentHorizon: 'short' | 'medium' | 'long'
//
// Master Brain (v8.22) endpoint loads these fields and applies
// adjustMasterBrainForRiskProfile() to its result before returning — so the
// recommendationOverride (REDUCE_RISK / ACCEPT_RISK / CAUTIOUS_PROCEED),
// filteredTopActions (HIGH/CRITICAL actions filtered for conservative), and
// adjustedRiskBudget (0.5× / 1.0× / 1.5×) all reflect the user's profile.
//
// Visual: violet/indigo gradient (distinct from Actual Profit's indigo and
// Master Brain's gold/amber). Placed BETWEEN Actual Profit (top) and Master
// Brain banner (predictions) because the profile DEFINES how the predictions
// are interpreted — context before content.

export function NotificationCenterCard() {
  const [data, setData] = useState<NotificationCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterRead, setFilterRead] = useState<string>('all');
  const [acting, setActing] = useState<string | null>(null); // 'markAll' | 'deleteRead' | notificationId

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('days', '30');
      if (filterType !== 'all') params.set('type', filterType);
      if (filterSeverity !== 'all') params.set('severity', filterSeverity);
      if (filterRead !== 'all') params.set('isRead', filterRead);
      const res = await fetch(`/api/brain-notifications?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error('API failed');
      setData(json);
    } catch {
      // Silent fail — the card just shows empty state
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSeverity, filterRead]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetchData, 30 * 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleMarkRead = useCallback(async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/brain-notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success('✓ Označeno kot prebrano');
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleDelete = useCallback(async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(`/api/brain-notifications/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success('✓ Izbrisano');
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleMarkAllRead = useCallback(async () => {
    setActing('markAll');
    try {
      const res = await fetch('/api/brain-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success(`✓ ${json.updated} obvestil označenih kot prebranih`);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const handleDeleteRead = useCallback(async () => {
    setActing('deleteRead');
    try {
      const res = await fetch('/api/brain-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_read' }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Failed');
      toast.success(`✓ ${json.deleted} prebranih obvestil izbrisanih`);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setActing(null);
    }
  }, [fetchData]);

  const notifications = data?.notifications ?? [];
  const stats = data?.stats ?? { total: 0, unread: 0, byType: {}, bySeverity: {} };

  return (
    <div
      id="notification-center"
      className="rounded-xl border-2 bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-yellow-500/5 border-orange-500/30 p-3 sm:p-4 shadow-sm scroll-mt-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Bell className="w-5 h-5 shrink-0 text-orange-600 dark:text-orange-400" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🔔 Notification Center
          </span>
          <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-700 dark:text-orange-300 shrink-0 font-bold">
            v8.38
          </Badge>
          {stats.unread > 0 && (
            <Badge className="text-[10px] bg-red-500 text-white border-0 shrink-0 font-bold animate-pulse">
              {stats.unread} novo
            </Badge>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mb-2.5">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po tipu"
        >
          <option value="all">Vsi tipi</option>
          {Object.entries(NOTIFICATION_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po teži"
        >
          <option value="all">Vse teže</option>
          <option value="info">ℹ️ Info</option>
          <option value="success">✅ Success</option>
          <option value="warning">⚠️ Warning</option>
          <option value="error">❌ Error</option>
        </select>
        <select
          value={filterRead}
          onChange={(e) => setFilterRead(e.target.value)}
          className="text-[10px] h-7 rounded border border-border bg-background px-2"
          aria-label="Filter po statusu prebranosti"
        >
          <option value="all">Vsa (prebrana + neprebrana)</option>
          <option value="false">📨 Samo neprebrana</option>
          <option value="true">✓ Samo prebrana</option>
        </select>
      </div>

      {/* Stats row */}
      <div className="text-[10px] text-muted-foreground mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono">
          <span className="font-bold text-foreground">{stats.total}</span> skupaj
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="font-mono">
          <span className={cn('font-bold', stats.unread > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
            {stats.unread}
          </span>{' '}neprebranih
        </span>
        {Object.entries(stats.byType).slice(0, 5).map(([type, count]) => (
          <span key={type} className="text-muted-foreground/50">
            · <span className="font-mono font-bold">{count}</span> {NOTIFICATION_TYPE_LABELS[type]?.label ?? type}
          </span>
        ))}
      </div>

      {/* Notification list (scrollable, max-h-96 with custom scrollbar styling) */}
      <div className="max-h-96 overflow-y-auto rounded border border-border bg-card/30">
        {loading ? (
          <div className="p-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Nalagam obvestila...
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">
            <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Ni obvestil v zadnjih 30 dneh.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => {
              const typeMeta = NOTIFICATION_TYPE_LABELS[n.type] ?? { label: n.type, icon: '🔔' };
              const truncatedBody = n.body.length > 200 ? n.body.slice(0, 200) + '...' : n.body;
              return (
                <div
                  key={n.id}
                  className={cn(
                    'p-2.5 transition-colors',
                    !n.isRead && 'bg-orange-500/5 border-l-2 border-l-orange-500',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0 mt-0.5" aria-hidden="true">{typeMeta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold leading-tight flex items-center gap-1.5">
                            {!n.isRead && (
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 animate-pulse" aria-label="neprebrano" />
                            )}
                            <span className="truncate">{n.title}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 break-words">
                            {truncatedBody}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={cn(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase',
                              severityBadgeClass(n.severity),
                            )}>
                              {n.severity}
                            </span>
                            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="w-2 h-2" />
                              {timeAgo(n.createdAt)}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              · {n.source}
                            </span>
                          </div>
                          {/* v8.77: Action button za buy_request_match — deep link v Iskalnik */}
                          {n.type === 'buy_request_match' && (() => {
                            let buyRequestId: string | null = null;
                            try {
                              const meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata;
                              buyRequestId = meta?.buyRequestId || null;
                            } catch { /* ignore */ }
                            if (!buyRequestId) return null;
                            return (
                              <a
                                href={`/?view=iskalnik&matchRequestId=${encodeURIComponent(buyRequestId)}`}
                                className="inline-flex items-center gap-0.5 mt-1.5 px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                                title="Prikaži ujemanja v Iskalniku"
                              >
                                <Eye className="w-2.5 h-2.5" /> Prikaži ujemanja
                              </a>
                            );
                          })()}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {!n.isRead && (
                            <button
                              onClick={() => handleMarkRead(n.id)}
                              disabled={acting === n.id}
                              title="Označi kot prebrano"
                              aria-label="Označi kot prebrano"
                              className="text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50 p-1 rounded hover:bg-accent"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(n.id)}
                            disabled={acting === n.id}
                            title="Izbriši"
                            aria-label="Izbriši obvestilo"
                            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 p-1 rounded hover:bg-accent"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Button
          onClick={handleMarkAllRead}
          disabled={acting === 'markAll' || stats.unread === 0}
          size="sm"
          variant="outline"
          className="h-7 text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
        >
          {acting === 'markAll' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
          Označi vse kot prebrano
        </Button>
        <Button
          onClick={handleDeleteRead}
          disabled={acting === 'deleteRead'}
          size="sm"
          variant="outline"
          className="h-7 text-[10px] border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10"
        >
          {acting === 'deleteRead' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
          Izbriši prebrane
        </Button>
      </div>

      {/* Footer */}
      <div className="mt-2 text-[9px] text-muted-foreground/70 leading-relaxed">
        💡 Avto-osvežitev vsakih 30s. Prikazujem zadnjih 30 dni. Tipi: 🧠 Brain digest · 🤖 Auto-pilot · ⚠️ Anomalija · 🔧 Sistem. Telegram + DB log — tudi če Telegram ni konfiguriran, so obvestila zabeležena tukaj.
      </div>
    </div>
  );
}

/**
 * v8.38: Notification Bell icon — shown in the BrainSynthesisCard header.
 * Displays the unread count as a red badge + opens a dropdown with the most
 * recent 5 unread notifications + a "Glej vse" link that scrolls to the
 * full NotificationCenterCard section below.
 *
 * Polls /api/brain-notifications?limit=5&days=7&isRead=false every 30s for
 * the unread count + recent items.
 */
export function NotificationBellDropdown({ onJumpToCenter }: { onJumpToCenter: () => void }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<number>(0);
  const [recent, setRecent] = useState<NotificationCenterItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/brain-notifications?limit=5&days=7&isRead=false');
        if (!res.ok) return;
        const json = await res.json();
        if (!json?.ok) return;
        if (cancelled) return;
        setUnread(json.stats.unread);
        setRecent(json.notifications);
      } catch {
        // Silent
      }
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 30 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleMarkReadFromDropdown = useCallback(async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/brain-notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      });
      toast.success('✓ Označeno kot prebrano');
      // Refresh the dropdown
      const res = await fetch('/api/brain-notifications?limit=5&days=7&isRead=false');
      if (res.ok) {
        const json = await res.json();
        if (json?.ok) {
          setUnread(json.stats.unread);
          setRecent(json.notifications);
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md hover:bg-accent transition-colors"
        title={unread > 0 ? `${unread} neprebranih obvestil` : 'Obvestila'}
        aria-label={`Obvestila — ${unread} neprebranih`}
        aria-expanded={open}
      >
        <Bell className={cn('w-4 h-4', unread > 0 && 'text-orange-500 animate-pulse')} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* Backdrop (click outside to close) */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Dropdown panel */}
          <div className="absolute right-0 top-full mt-1 w-72 sm:w-80 max-h-[400px] flex flex-col bg-popover border border-border rounded-md shadow-lg z-50">
            <div className="flex items-center justify-between p-2 border-b border-border">
              <span className="text-xs font-bold flex items-center gap-1">
                <Bell className="w-3 h-3" />
                Obvestila
                {unread > 0 && (
                  <Badge className="text-[9px] bg-red-500 text-white border-0 px-1 py-0 h-4">
                    {unread}
                  </Badge>
                )}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
                aria-label="Zapri"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-muted-foreground">
                  <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  Ni neprebranih obvestil.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recent.map((n) => {
                    const typeMeta = NOTIFICATION_TYPE_LABELS[n.type] ?? { label: n.type, icon: '🔔' };
                    return (
                      <div key={n.id} className="p-2 hover:bg-accent/50 transition-colors">
                        <div className="flex items-start gap-1.5">
                          <span className="text-sm shrink-0">{typeMeta.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold truncate">{n.title}</div>
                            <p className="text-[10px] text-muted-foreground line-clamp-2">{n.body}</p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[9px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                              <button
                                onClick={() => handleMarkReadFromDropdown(n.id)}
                                disabled={loading}
                                className="text-[9px] text-primary hover:underline disabled:opacity-50"
                              >
                                ✓ Preberi
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-2 border-t border-border flex items-center justify-between gap-2">
              <button
                onClick={() => { setOpen(false); onJumpToCenter(); }}
                className="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                Glej vse →
              </button>
              <span className="text-[9px] text-muted-foreground">{unread} neprebranih</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function BrainSynthesisCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  const jumpToNotificationCenter = useCallback(() => {
    if (typeof document !== 'undefined') {
      const el = document.getElementById('notification-center');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-1 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Brain className="w-5 h-5 text-primary shrink-0" />
            <span className="text-sm sm:text-base font-bold tracking-tight">
              AI BRAIN SYNTHESIS
            </span>
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
              v8.38 Notification Center + v8.35 Seed+Telegram + v8.33 Performance + v8.32 Health + v8.31 Auto-pilot + v8.29 Draft Queue + v8.28 Adaptive + v8.27 Scenario + v8.26 Explain + v8.25 Accuracy + v8.24 Personal + v8.23 Validation + v8.22 Master + v8.15-v8.21 (7 Domains)
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* v8.38: Notification Bell — unread count badge + dropdown with recent 5 + "Glej vse" link */}
            <NotificationBellDropdown onJumpToCenter={jumpToNotificationCenter} />
            <button
              onClick={onBrainCategoryClick}
              className="text-[11px] text-primary hover:underline shrink-0 flex items-center gap-1"
            >
              🧠 Možgani kategorija →
            </button>
          </div>
        </div>

        {/* v8.32: SYSTEM HEALTH DASHBOARD — POLISH PHASE.
            "How healthy is the Brain system?" One card that aggregates the
            entire Brain system's health into one view: 8 brain endpoints
            status + cache hit rates + auto-pilot status + draft queue +
            data freshness + risk profile + adaptive weights + auto-generated
            recommendations + overall health score 0-100.
            Gradient background: emerald HEALTHY / amber DEGRADED / red UNHEALTHY. */}
        <SystemHealthCard onBrainCategoryClick={onBrainCategoryClick} />

        {/* v8.35: SEED DATA + TELEGRAM BRAIN NOTIFICATIONS — POLISH PHASE CONTINUES.
            "Make the system alive." TWO action areas in one card:
            (A) Seed Demo Data — if Trade table is empty (0 trades), shows a
                prominent 🌱 button to load 25 realistic Slovenian trades. After
                seeding, the page auto-refreshes so Actual Profit + Accuracy +
                all brain signals pick up the new data.
            (B) Telegram Brain Notifications — 3 test buttons (digest/autopilot/
                anomaly) that send test notifications via the existing Telegram
                bot. Returns "✅ Poslano" or "❌ Telegram ni konfiguriran".
            Dual-tint gradient: lime (growth) + cyan (messaging). */}
        <SeedAndTelegramCard />

        {/* v8.33: PERFORMANCE + CACHE STATS — POLISH PHASE CONTINUES.
            "How fast is the Brain system? Is the cache working?" Placed
            immediately below System Health (health first, then performance).
            Shows per-namespace cache hit/miss/sets + per-brain response
            times (avg/p50/p95/p99/min/max) + overall summary (4 big numbers)
            + reset button. Auto-refresh every 30s. Yellow/amber gradient
            (visual link to ⚡ emoji — "speed card"). */}
        <PerformanceCard onBrainCategoryClick={onBrainCategoryClick} />

        {/* v8.23: GROUND TRUTH first — actual profit from Trade table */}
        <ActualProfitCard />

        {/* v8.24: User Risk Profile — makes Master Brain PERSONAL (conservative/balanced/aggressive) */}
        <RiskProfileCard />

        {/* v8.22: PREDICTIONS — Master Brain synthesizes 7 Domain Brains */}
        <MasterBrainBanner />

        {/* v8.27: SCENARIO BRAIN — "What If?" simulator. 3 preset scenarios
            (conservative/balanced/aggressive) run Master Brain in parallel,
            show side-by-side comparison + recommendation + custom input form. */}
        <ScenarioBrainCard />

        {/* v8.28: ADAPTIVE DOMAIN WEIGHTS — feedback loop. Master Brain (v8.22)
            used HARDCODED domain weights. v8.28 makes them adaptive — stored
            per-user in Settings.adaptiveDomainWeights (JSON). System learns
            from REVEALED preferences (which actions user actually executes vs
            rejects). Bright orange-tinted card with 7 sliders + stats +
            history + reset + feedback demo form. */}
        <AdaptiveWeightsCard />

        {/* v8.29: DRAFT QUEUE — CLOSED FEEDBACK LOOP (Intelligence phase CULMINATION).
            Each Master Brain TOP 5 action becomes a draft row. When the user
            clicks ✅ Izvedel or ❌ Zavrnil (on the Master Brain banner OR in this
            card), the draft's status updates AND recordActionFeedback (v8.28) is
            called → adaptive weights re-evaluate → better ranking next time.
            Slate/blue-gray-tinted card. Stats + filter bar + draft list (max-h-96
            scrollable) + per-domain execution rates + cleanup button. */}
        <DraftQueueCard />

        {/* v8.30: SAFE AUTO-PILOT — AUTOMATION PHASE STARTED.
            Automatically executes ONLY LOW-risk drafts that meet ALL 8 safety
            rules (enabled + safe mode + non-conservative + confidence=LOW +
            uplift<100€ + domain!=risk + daily limit + daily budget). MEDIUM/HIGH
            risk drafts stay pending for manual ✅ Izvedel click. Each auto-executed
            draft is rollbackable — undo calls recordActionFeedback('rejected') to
            balance the learning signal. Purple/indigo-tinted card. Master switch +
            config sliders + today's stats + all-time stats + run button + history
            modal with rollback + safety info box. */}
        <AutoPilotCard />

        {/* v8.15-v8.21: 7 Domain Brain sections — detailed drill-down */}
        <ProfitBrainSection />
        <InventoryBrainSection />
        <MarketBrainSection />
        <SourcingBrainSection />
        <RiskBrainSection />
        <BuyerBrainSection />
        <PricingBrainSection />

        {/* v8.23: Historical record of Master Brain predictions — foundation for v8.25 */}
        <BrainSnapshotsSection />

        {/* v8.25: Historical Accuracy + Trend — Validation phase CULMINATION.
            Answers "Ali lahko zaupam Master Brain-u?" with actual % data. */}
        <AccuracyTrendCard />

        {/* v8.38: NOTIFICATION CENTER + ALERT HISTORY — POLISH PHASE CONTINUES.
            "What happened in the Brain system?" Centralized history of ALL
            notifications: Brain digests (sendBrainDigest), auto-pilot executions
            (sendAutoPilotAlert), anomalies (sendAnomalyAlert), system events.
            Bell icon in header shows unread count + dropdown with recent 5.
            This card (below) shows full filterable list + bulk actions +
            auto-refresh 30s. Fetches /api/brain-notifications?limit=50&days=30.
            Orange/amber-tinted card (visual link to 🔔 bell emoji). */}
        <NotificationCenterCard />
      </CardContent>
    </Card>
  );
}

