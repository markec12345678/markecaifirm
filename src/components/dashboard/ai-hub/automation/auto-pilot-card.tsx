/**
 * AutoPilotCard — v8.30/v8.31 (purple/indigo) — autonomous execution.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. AUTOMATION PHASE.
 *
 *   - v8.30: Safe Auto-pilot — automatically executes ONLY LOW-risk actions
 *     that meet ALL 8 safety rules:
 *       1. autoPilotEnabled=true (master switch — default OFF)
 *       2. autoPilotMode='safe' (v8.31 will add 'aggressive')
 *       3. User risk tolerance != 'conservative' (v8.24)
 *       4. confidence='LOW' (HIGH/MEDIUM always need manual)
 *       5. domain not in bottlenecks
 *       6. expectedUpliftEUR <= dailyBudgetEUR
 *       7. not yet executed today (dailyLimit cap)
 *       8. no anomaly in last 24h
 *   - v8.31: Aggressive mode (double-confirm) + anomaly detection + rollback.
 *   - Safety info box (always visible): 8 rules listed
 *
 * Purple/indigo-tinted gradient distinguishes from:
 *   - Draft Queue (slate) — DECISION LEDGER
 *   - Adaptive Weights (orange) — WEIGHTS / CONFIG
 *   - Scenario Brain (rose/pink) — WHAT IF?
 *   - This card (purple/indigo) — AUTONOMOUS EXECUTION
 *
 * Module-local types (AutoPilotHistoryDraft, AutoPilotRunResponse,
 * AutoPilotStatsResponse, ClearAnomalyResponse, DisableAggressiveResponse,
 * EnableAggressiveResponse) come from ./auto-pilot/types (moved out of
 * ../types.ts as part of v8.94.8-split-autopilot — these are only used by
 * AutoPilotCard and its sub-components). DOMAIN_LABELS stays in ../types
 * (shared with MasterBrainBanner + DraftQueueCard). DomainName is reached
 * indirectly via these types — not imported directly. No shared utils
 * are used.
 *
 * v8.94.8-split-autopilot: presentational sub-sections extracted to
 * ./auto-pilot/ (AnomalyBanner, AggressiveActiveBanner,
 * AggressivePendingBanner, ModeSelector, ConfigPanel, StatsDisplay,
 * HistoryPanel). This file remains the orchestrator owning all state +
 * fetch callbacks; sub-components are pure render (props in, JSX out).
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  Bot,
  History,
  Info,
  Lock,
  Play,
  Power,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// v8.94.8-split-autopilot: sub-components + types extracted to ./auto-pilot/.
// DOMAIN_LABELS now lives only in HistoryPanel (only consumer of the
// domain-icon mapping). All AutoPilot* types moved to ./auto-pilot/types.ts
// (only used by AutoPilotCard + its sub-components).
import {
  AnomalyBanner,
  AggressiveActiveBanner,
  AggressivePendingBanner,
  ConfigPanel,
  StatsDisplay,
  HistoryPanel,
} from './auto-pilot';
import type {
  AutoPilotHistoryDraft,
  AutoPilotRunResponse,
  AutoPilotStatsResponse,
  ClearAnomalyResponse,
  DisableAggressiveResponse,
  EnableAggressiveResponse,
} from './auto-pilot';

// --- v8.30: Safe Auto-pilot card (purple/indigo-tinted, Automation phase) ---
//
// v8.30 NEW: 🤖 Safe Auto-pilot — AUTOMATION PHASE STARTED.
// Problem: Master Brain (v8.22) recommends TOP 5 actions, user must manually
// execute each one. For LOW-risk actions (e.g. "send Telegram reminder",
// "relist an item") this is tedious. v8.30 adds Safe Auto-pilot — automatically
// executes ONLY LOW-risk actions that meet ALL 8 safety rules:
//   1. autoPilotEnabled=true (master switch — default OFF)
//   2. autoPilotMode='safe' (v8.31 will add 'aggressive')
//   3. User risk tolerance != 'conservative' (v8.24)
//   4. confidence='LOW' (HIGH/MEDIUM always need manual)
//   5. expectedUpliftEUR < 100€
//   6. domain != 'risk' (risk mitigation needs human judgment)
//   7. today's auto-executed count < dailyLimit (default 5)
//   8. today's auto-executed budget + this draft's uplift < dailyBudgetEUR (default 500€)
//
// Card features:
//   - Master switch toggle (Auto-pilot: ON/OFF)
//   - Config sliders (when enabled): daily limit (1-10), daily budget (100-2000€)
//   - Mode selector: "Safe (LOW risk only)" — "Aggressive" disabled (v8.31)
//   - Today's stats: auto-executed count + budget used (with progress bars)
//   - All-time stats: total auto-executed + total rolled back + rollback rate %
//   - Action buttons: ▶️ Zaženi zdaj (manual trigger) + ℹ️ Zgodovina (last 10)
//   - History view: each auto-executed draft has ↩️ Razveljavi button
//   - Safety info box (always visible): 8 rules listed
//
// Purple/indigo-tinted gradient distinguishes from:
//   - Draft Queue (slate) — DECISION LEDGER
//   - Adaptive Weights (orange) — WEIGHTS / CONFIG
//   - Scenario Brain (rose/pink) — WHAT IF?
//   - This card (purple/indigo) — AUTONOMOUS EXECUTION

export function AutoPilotCard() {
  const [stats, setStats] = useState<AutoPilotStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // History modal
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AutoPilotHistoryDraft[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Pending config edits (sliders local state, debounced save)
  const [dailyLimitInput, setDailyLimitInput] = useState<number>(5);
  const [dailyBudgetInput, setDailyBudgetInput] = useState<number>(500);
  // In-flight action states
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  // v8.31: Aggressive mode + anomaly state
  const [aggressivePending, setAggressivePending] = useState(false); // local UI: pending confirmation shown
  const [aggressiveMsg, setAggressiveMsg] = useState<string | null>(null); // last enable message
  const [togglingMode, setTogglingMode] = useState(false); // disabling aggressive / enabling
  const [clearingAnomaly, setClearingAnomaly] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AutoPilotStatsResponse;
      if (!json?.ok) throw new Error('Auto-pilot API ni vrnil rezultata');
      setStats(json);
      setDailyLimitInput(json.config.dailyLimit);
      setDailyBudgetInput(json.config.dailyBudgetEUR);
      // v8.31: Sync aggressive pending state from server (aggressiveConfirmedAt
      // is set by first enable call, cleared on second call or expiry).
      setAggressivePending(Boolean(json.config.aggressiveConfirmedAt));
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Toggle master switch (POST config { enabled })
  const toggleEnabled = useCallback(async () => {
    if (!stats) return;
    setToggling(true);
    const newEnabled = !stats.config.enabled;
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          config: { enabled: newEnabled },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        newEnabled
          ? '🤖 Auto-pilot VKLJUČEN — sistem samodejno izvaja LOW-risk akcije'
          : '🤖 Auto-pilot IZKLJUČEN — vse akcije zahtevajo ročni ✅ Izvedel',
      );
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri preklopu auto-pilot-a');
    } finally {
      setToggling(false);
    }
  }, [stats, fetchStats]);

  // Save config (dailyLimit + dailyBudgetEUR) — POST config
  const saveConfig = useCallback(async () => {
    setToggling(true);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          config: {
            dailyLimit: dailyLimitInput,
            dailyBudgetEUR: dailyBudgetInput,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        `💾 Config shranjen: ${dailyLimitInput}/dan, ${dailyBudgetInput}€/dan budget`,
      );
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju config-a');
    } finally {
      setToggling(false);
    }
  }, [dailyLimitInput, dailyBudgetInput, fetchStats]);

  // Manual trigger — POST run
  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      const json = (await res.json()) as AutoPilotRunResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      const executedMsg =
        json.autoExecuted > 0
          ? ` · auto-executed: ${json.autoExecuted} (${json.executedDrafts.map((d) => `#${d.id.slice(0, 6)}`).join(', ') || '—'})`
          : ' · 0 auto-executed';
      const skippedMsg = json.skipped > 0 ? ` · skipped: ${json.skipped}` : '';
      toast.success(
        `▶️ Auto-pilot tekel: preveril ${json.checked} draft-ov${executedMsg}${skippedMsg}`,
      );
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri zagonu auto-pilot-a');
    } finally {
      setRunning(false);
    }
  }, [fetchStats]);

  // Fetch history (last 10 auto-executed drafts) — used by history modal
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/ai/brain/drafts?limit=30&days=30&status=executed', {
        method: 'GET',
      });
      // Note: drafts endpoint doesn't filter by autoExecuted directly —
      // we filter client-side. This is intentional — reuses the existing
      // drafts endpoint without adding a new one. (The auto-pilot/rollback
      // route is the only auto-pilot-specific fetch besides GET/POST main.)
      const json = (await res.json()) as any;
      if (!res.ok || !json?.ok) throw new Error(`HTTP ${res.status}`);
      // Filter: only drafts where autoExecuted=true (v8.30 field).
      // The drafts endpoint returns DraftRow[] which may not include the
      // autoExecuted field — we accept both shapes (autoExecuted may be
      // missing → we treat undefined as false, which is fine since
      // pre-v8.30 drafts are never auto-executed).
      const auto = (json.drafts as any[]).filter((d) => d.autoExecuted === true);
      setHistory(auto as AutoPilotHistoryDraft[]);
    } catch (e: any) {
      // Fallback: show empty history with error toast
      toast.error(e?.message ?? 'Napaka pri pridobivanju zgodovine');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Rollback an auto-executed draft — POST /rollback
  const rollbackDraft = useCallback(
    async (draftId: string) => {
      setRollingBackId(draftId);
      try {
        const res = await fetch('/api/ai/brain/auto-pilot/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftId,
            reason: `User rollback iz Auto-pilot UI @ ${new Date().toISOString()}`,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
        toast.success(
          `↩️ Razveljavljeno — sistem undo-a learning (recordActionFeedback 'rejected')`,
        );
        // Refresh history + stats
        await fetchHistory();
        await fetchStats();
      } catch (e: any) {
        toast.error(e?.message ?? 'Napaka pri razveljavitvi');
      } finally {
        setRollingBackId(null);
      }
    },
    [fetchHistory, fetchStats],
  );

  // v8.31: Enable aggressive mode — double confirmation flow.
  // First click → server sets aggressiveConfirmedAt, returns confirmed=false.
  // Second click within 5 min → server confirms, returns confirmed=true + mode='aggressive'.
  const handleEnableAggressive = useCallback(async () => {
    setTogglingMode(true);
    setAggressiveMsg(null);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable_aggressive' }),
      });
      const json = (await res.json()) as EnableAggressiveResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      setAggressiveMsg(json.message);
      if (json.confirmed) {
        // Second confirmation succeeded — aggressive mode now active.
        toast.success(json.message);
        setAggressivePending(false);
      } else {
        // First confirmation — pending second click within 5 min.
        toast.info(json.message);
        setAggressivePending(true);
      }
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri vklopu aggressive mode');
    } finally {
      setTogglingMode(false);
    }
  }, [fetchStats]);

  // v8.31: Disable aggressive mode — immediate revert to safe (single click).
  const handleDisableAggressive = useCallback(async () => {
    setTogglingMode(true);
    setAggressiveMsg(null);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable_aggressive' }),
      });
      const json = (await res.json()) as DisableAggressiveResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      toast.success('🛡️ Aggressive mode izklopljen — vrnjen v safe mode (LOW risk only)');
      setAggressivePending(false);
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri izklopu aggressive mode');
    } finally {
      setTogglingMode(false);
    }
  }, [fetchStats]);

  // v8.31: Clear anomaly suspension — user manually re-enables after review.
  const handleClearAnomaly = useCallback(async () => {
    setClearingAnomaly(true);
    try {
      const res = await fetch('/api/ai/brain/auto-pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_anomaly' }),
      });
      const json = (await res.json()) as ClearAnomalyResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error ?? `HTTP ${res.status}`);
      }
      toast.success(json.message);
      await fetchStats();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri razveljavitvi suspenzije');
    } finally {
      setClearingAnomaly(false);
    }
  }, [fetchStats]);

  const enabled = stats?.config.enabled ?? false;
  const mode = stats?.config.mode ?? 'safe';
  const todayAutoExecuted = stats?.today.autoExecuted ?? 0;
  const todayBudgetUsed = stats?.today.budgetUsed ?? 0;
  const todayLimit = stats?.config.dailyLimit ?? 5;
  const todayBudget = stats?.config.dailyBudgetEUR ?? 500;
  const limitPct = Math.min(100, Math.round((todayAutoExecuted / Math.max(1, todayLimit)) * 100));
  const budgetPct = Math.min(100, Math.round((todayBudgetUsed / Math.max(1, todayBudget)) * 100));
  const allTimeTotal = stats?.allTime.totalAutoExecuted ?? 0;
  const allTimeRollback = stats?.allTime.totalRolledBack ?? 0;
  const rollbackRate = stats?.allTime.rollbackRate ?? 0;
  const dirty =
    dailyLimitInput !== todayLimit || dailyBudgetInput !== todayBudget;
  // v8.31: Anomaly detection state — surfaced for the anomaly banner.
  const anomalySuspended = stats?.config.anomalySuspended ?? false;
  const anomalyReason = stats?.config.anomalyReason ?? null;
  const anomalySuspendedAt = stats?.config.anomalySuspendedAt ?? null;
  // v8.31: Hourly counter for "Zadnja ura: N akcij" display.
  const hourlyExecCount = stats?.config.hourlyExecCount ?? 0;
  const hourlyWindowStart = stats?.config.hourlyWindowStart ?? null;
  const isAggressive = mode === 'aggressive';
  // Mode-aware thresholds for display:
  const displayLimit = isAggressive ? 10 : 5;
  const displayBudget = isAggressive ? 2000 : 500;

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-3 sm:p-4 shadow-sm transition-colors',
        anomalySuspended
          ? 'border-red-500/60 bg-gradient-to-br from-red-500/10 via-purple-500/10 to-violet-500/5'
          : isAggressive
            ? 'border-rose-500/50 bg-gradient-to-br from-rose-500/10 via-purple-500/10 to-violet-500/5'
            : 'border-purple-500/40 bg-gradient-to-br from-purple-500/15 via-indigo-500/10 to-violet-500/5',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-5 h-5 text-purple-600 dark:text-purple-300 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🤖 Auto-pilot
          </span>
          <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-700 dark:text-purple-300 shrink-0 font-bold">
            v8.31
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-[9px] shrink-0',
              isAggressive
                ? 'border-rose-500/40 text-rose-700 dark:text-rose-300'
                : 'border-purple-500/30 text-purple-700/80 dark:text-purple-300/80',
            )}
          >
            {anomalySuspended
              ? '⚠️ SUSPENDED · ANOMALY'
              : isAggressive
                ? '🚀 AGGRESSIVE · MEDIUM OK'
                : '🛡️ SAFE · LOW RISK ONLY'}
          </Badge>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-purple-700/80 dark:text-purple-300/80 mb-2.5 leading-snug">
        Samodejno izvaja akcije ki izpolnjujejo VSA 8 varnostna pravila.
        {' '}
        <b className="text-purple-700 dark:text-purple-300">Safe mode</b>: confidence=LOW, uplift
        &lt;100€, limit 5/dan, budget 500€/dan.{' '}
        <b className="text-rose-700 dark:text-rose-300">Aggressive mode</b> (opt-in, double confirm):
        confidence=LOW/MEDIUM, uplift &lt;300€, limit 10/dan, budget 2000€/dan.
        {' '}HIGH confidence in domain=&apos;risk&apos; sta vedno ročno (v8.29).
        {' '}Vsako auto-executed akcijo lahko razveljaviš (↩️ Razveljavi).
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-purple-500/10" />
          <Skeleton className="h-3 w-3/4 bg-purple-500/10" />
          <Skeleton className="h-16 w-full bg-purple-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchStats} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && stats && (
        <div className="space-y-3">
          {/* v8.31: Anomaly banner — shown at TOP of card when suspended.
              Red, eye-catching, with "Razveljavi suspenzijo" button.
              v8.94.8-split-autopilot: extracted to <AnomalyBanner /> */}
          {anomalySuspended && (
            <AnomalyBanner
              anomalyReason={anomalyReason}
              anomalySuspendedAt={anomalySuspendedAt}
              clearingAnomaly={clearingAnomaly}
              onClearAnomaly={handleClearAnomaly}
            />
          )}

          {/* v8.31: Aggressive mode active banner — shown when mode='aggressive'.
              Red/rose, with toggle-back button.
              v8.94.8-split-autopilot: extracted to <AggressiveActiveBanner /> */}
          {!anomalySuspended && isAggressive && (
            <AggressiveActiveBanner
              togglingMode={togglingMode}
              onDisableAggressive={handleDisableAggressive}
            />
          )}

          {/* v8.31: Aggressive pending confirmation banner — shown after first click.
              Yellow/amber, prompts user to confirm within 5 minutes.
              v8.94.8-split-autopilot: extracted to <AggressivePendingBanner /> */}
          {!anomalySuspended && !isAggressive && aggressivePending && (
            <AggressivePendingBanner
              togglingMode={togglingMode}
              onConfirmAggressive={handleEnableAggressive}
            />
          )}

          {/* Master switch — big toggle */}
          <div
            className={cn(
              'flex items-center justify-between gap-2 p-2 rounded-lg border',
              enabled
                ? anomalySuspended
                  ? 'bg-red-500/15 border-red-500/40'
                  : isAggressive
                    ? 'bg-rose-500/15 border-rose-500/40'
                    : 'bg-purple-500/15 border-purple-500/40'
                : 'bg-muted/30 border-border',
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Power
                className={cn(
                  'w-4 h-4 shrink-0',
                  enabled
                    ? anomalySuspended
                      ? 'text-red-600 dark:text-red-400'
                      : isAggressive
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-purple-600 dark:text-purple-300'
                    : 'text-muted-foreground',
                )}
              />
              <div className="min-w-0">
                <div className="text-xs font-bold">
                  Auto-pilot: {enabled ? (anomalySuspended ? 'SUSPENDED' : 'ON') : 'OFF'}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {enabled
                    ? anomalySuspended
                      ? `Mode: ${mode} · SUSPENDED · ${anomalyReason ?? 'anomaly'}`
                      : `Mode: ${mode} · limit ${displayLimit}/dan · budget ${displayBudget}€/dan`
                    : 'Klikni za vklop — samodejno izvaja LOW/MEDIUM-risk akcije'}
                </div>
              </div>
            </div>
            <button
              onClick={toggleEnabled}
              disabled={toggling}
              role="switch"
              aria-checked={enabled}
              aria-label="Toggle auto-pilot master switch"
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50',
                enabled
                  ? anomalySuspended
                    ? 'bg-red-600'
                    : isAggressive
                      ? 'bg-rose-600'
                      : 'bg-purple-600'
                  : 'bg-muted-foreground/30',
                toggling && 'opacity-50 cursor-wait',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out',
                  enabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>

          {/* Config sliders — only when enabled.
              v8.94.8-split-autopilot: extracted to <ConfigPanel /> (which
              internally renders <ModeSelector /> + sliders + save/cancel). */}
          {enabled && (
            <ConfigPanel
              dailyLimitInput={dailyLimitInput}
              dailyBudgetInput={dailyBudgetInput}
              onDailyLimitChange={setDailyLimitInput}
              onDailyBudgetChange={setDailyBudgetInput}
              isAggressive={isAggressive}
              aggressivePending={aggressivePending}
              anomalySuspended={anomalySuspended}
              togglingMode={togglingMode}
              toggling={toggling}
              dirty={dirty}
              todayLimit={todayLimit}
              todayBudget={todayBudget}
              onResetConfig={() => {
                setDailyLimitInput(todayLimit);
                setDailyBudgetInput(todayBudget);
              }}
              onSaveConfig={saveConfig}
              onEnableAggressive={handleEnableAggressive}
              onDisableAggressive={handleDisableAggressive}
            />
          )}

          {/* Today's stats + all-time stats — v8.94.8-split-autopilot: extracted
              to <StatsDisplay /> (renders progress bars + 3-col all-time grid). */}
          <StatsDisplay
            stats={stats}
            mode={mode}
            todayAutoExecuted={todayAutoExecuted}
            todayBudgetUsed={todayBudgetUsed}
            todayLimit={todayLimit}
            todayBudget={todayBudget}
            displayLimit={displayLimit}
            displayBudget={displayBudget}
            limitPct={limitPct}
            budgetPct={budgetPct}
            hourlyExecCount={hourlyExecCount}
            hourlyWindowStart={hourlyWindowStart}
            allTimeTotal={allTimeTotal}
            allTimeRollback={allTimeRollback}
            rollbackRate={rollbackRate}
          />

          {/* Action buttons row */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              onClick={runNow}
              disabled={running || anomalySuspended}
              className="h-8 text-[11px] font-bold bg-purple-600 hover:bg-purple-700 text-white border-purple-600 gap-1.5 disabled:opacity-50"
            >
              {running ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {running ? 'Teče...' : '▶️ Zaženi zdaj'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowHistory(true);
                fetchHistory();
              }}
              className="h-8 text-[11px] gap-1.5 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
            >
              <History className="w-3 h-3" />
              ℹ️ Zgodovina
            </Button>
          </div>

          {/* v8.31: Threshold comparison box — always visible info card
              showing the difference between Safe and Aggressive modes. */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/[0.05] p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
              <Info className="w-2.5 h-2.5" />
              Primerjava modal (Safe vs Aggressive)
            </div>
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              {/* Safe column */}
              <div className={cn('rounded border p-1.5 space-y-0.5', isAggressive ? 'border-border bg-muted/30 opacity-70' : 'border-purple-500/40 bg-purple-500/10')}>
                <div className="font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                  🛡️ Safe {!isAggressive && '✓'}
                </div>
                <div className="text-muted-foreground">confidence: LOW</div>
                <div className="text-muted-foreground">uplift &lt; 100€</div>
                <div className="text-muted-foreground">limit 5/dan</div>
                <div className="text-muted-foreground">budget 500€/dan</div>
                <div className="text-muted-foreground">domain != risk</div>
                <div className="text-muted-foreground">HIGH = manual</div>
              </div>
              {/* Aggressive column */}
              <div className={cn('rounded border p-1.5 space-y-0.5', isAggressive ? 'border-rose-500/40 bg-rose-500/10' : 'border-border bg-muted/30 opacity-70')}>
                <div className="font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
                  🚀 Aggressive {isAggressive && '✓'}
                </div>
                <div className="text-muted-foreground">confidence: LOW, MEDIUM</div>
                <div className="text-muted-foreground">uplift &lt; 300€</div>
                <div className="text-muted-foreground">limit 10/dan</div>
                <div className="text-muted-foreground">budget 2000€/dan</div>
                <div className="text-muted-foreground">domain != risk (oba)</div>
                <div className="text-muted-foreground">HIGH = manual (oba)</div>
              </div>
            </div>
            <div className="text-[8px] text-muted-foreground italic pt-1 border-t border-purple-500/20">
              Anomaly: če &gt;8 akcij v 1 uri → suspendiran (oba modal).
              Rollback: ✅ razveljavi vsako auto-akcijo (+ undo learning).
            </div>
          </div>

          {/* Safety info box — always visible */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/[0.05] p-2 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" />
              Varnostna pravila (8 — mode-aware)
            </div>
            <ol className="text-[9px] text-muted-foreground space-y-0.5 list-decimal list-inside">
              <li>Auto-pilot enabled (master switch)</li>
              <li>Mode = &apos;safe&apos; ali &apos;aggressive&apos; (V2 — oba veljavna)</li>
              <li>User risk tolerance != conservative (oba modal)</li>
              <li>Confidence dovoljen za mode (safe: LOW; aggressive: LOW+MEDIUM; HIGH vedno ročno)</li>
              <li>expectedUpliftEUR &lt; mode threshold (safe: 100€, aggressive: 300€)</li>
              <li>Domain != &apos;risk&apos; (risk mitigation = human judgment — oba)</li>
              <li>Daily limit ≤ {displayLimit} akcij/dan ({mode})</li>
              <li>Daily budget ≤ {displayBudget}€/dan ({mode})</li>
            </ol>
          </div>

          {/* Footer info */}
          <div className="flex items-center justify-between pt-1 border-t border-purple-500/20">
            <span className="text-[9px] text-muted-foreground italic">
              GET + POST /api/ai/brain/auto-pilot · cron /api/cron/auto-pilot
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              POST actions: run, config, enable_aggressive, disable_aggressive, clear_anomaly
            </span>
          </div>
        </div>
      )}

      {/* History Modal — v8.94.8-split-autopilot: extracted to <HistoryPanel />.
          Renders the Dialog with last-10 auto-executed drafts + rollback buttons. */}
      <HistoryPanel
        open={showHistory}
        onOpenChange={setShowHistory}
        historyLoading={historyLoading}
        history={history}
        rollingBackId={rollingBackId}
        onRollback={rollbackDraft}
      />
    </div>
  );
}

// --- Outer card wrapper (v8.30 Auto-pilot + v8.29 Draft Queue + v8.28 Adaptive + v8.27 Scenario + v8.26 Intelligence + v8.25 Accuracy + v8.24 Personal + v8.23 Validation + v8.22 Master + v8.15-v8.21 7 Domains) --------------------
//
// v8.28 NEW: Adaptive Domain Weights — feedback loop. Master Brain (v8.22) used
// HARDCODED domain weights. v8.28 makes them adaptive — stored per-user in
// Settings.adaptiveDomainWeights (JSON). System learns from REVEALED preferences
// (which actions user actually executes vs rejects). Card is bright orange-tinted,
// sits BETWEEN ScenarioBrainCard and the 7 Domain Brain sections. 7 sliders (one
// per domain, range 0.5-2.0) + execution stats + rate bar + history + reset
// button + save button + feedback demo form.
//
// v8.27 NEW: Scenario Brain — "What if?" simulator. Generates 3 preset scenarios
// (conservative/balanced/aggressive) and runs Master Brain for each in parallel
// (3× Promise.all). Shows side-by-side comparison table + recommendation +
// custom scenario input form. Rose/pink-tinted card sits BETWEEN Master Brain
// banner and the 7 Domain Brain sections.
//
// v8.26 NEW PHASE: Intelligence — "Zakaj Master Brain priporoča TOČNO to akcijo?"
// Master Brain banner response now includes `explanations` (5 ActionExplanation).
// Each TOP action gets an "ℹ️ Zakaj?" toggle that expands reasoning + reasoningParts
// grid + per-action trustScore pill. Banner header shows overall trustScore pill.
//
// v8.24 NEW: User Risk Profile — Master Brain becomes PERSONAL.
// Added "Tvoj Risk Profile" card BETWEEN Actual Profit and Master Brain banner.
// 4 user-configurable fields (riskTolerance, maxAcceptableRisk, liquidityReserve,
// investmentHorizon) stored in Settings singleton. Master Brain loads these and
// applies adjustMasterBrainForRiskProfile() — recommendationOverride (REDUCE_RISK /
// ACCEPT_RISK / CAUTIOUS_PROCEED), filteredTopActions, adjustedRiskBudget.
//
// v8.23 NEW PHASE: Validation — "Ali lahko zaupaš Master Brain-u?"
//
// New visual hierarchy (top → bottom):
//   1. 📊 Actual Profit Card (v8.23, indigo) — GROUND TRUTH first, before
//      any predictions. Shows real EUR profit from Trade table.
//   2. ⚙️ Tvoj Risk Profile (v8.24, violet) — USER CONTEXT. Defines how Master
//      Brain predictions should be interpreted for THIS user.
//   3. 🧠✨ Master Brain Banner (v8.22, gold/amber) — PREDICTIONS.
//      Synthesizes 7 Domain Brains into ONE decision (adjusted by profile).
//      v8.26: each TOP action has an "ℹ️ Zakaj?" toggle for explainability.
//   4. 🎯 Scenario Brain (v8.27, rose/pink) — WHAT IF? simulator. 3 preset
//      scenarios + custom input form, side-by-side comparison table.
//   5. 🎛️ Adaptive Domain Weights (v8.28, bright orange) — FEEDBACK LOOP.
//      7 sliders + execution stats + rate bars + history + feedback demo.
//      System learns from REVEALED preferences (which actions user executes).
//   6. 🧠📦📈🎯🛡️👥💶 7 Domain Brain sections (v8.15-v8.21) — detailed
//      drill-down into each domain.
//   7. 📸 Brain Snapshots section (v8.23, emerald) — historical record of
//      Master Brain predictions, foundation for v8.25 Historical Accuracy.

// ============================================================================
// v8.38: NOTIFICATION CENTER + ALERT HISTORY
// ============================================================================
//
// "What happened in the Brain system?" — centralized history of ALL
// notifications. Previously Brain events were scattered: Telegram messages,
// toast notifications, dev.log. User had no central view of "what happened".
//
// v8.38 solution:
//   - NEW `Notification` Prisma model (type, title, body, severity, source,
//     isRead, draftId, snapshotDate, metadata, createdAt) — general (NOT
//     tied to Monitor/Listing like the existing `Alert` model).
//   - `src/lib/notifications.ts` — createNotification, getNotifications,
//     markAsRead, markAllAsRead, deleteNotification, cleanupOldNotifications.
//   - Telegram integration: sendBrainDigest / sendAutoPilotAlert /
//     sendAnomalyAlert now ALSO createNotification() (in addition to Telegram
//     send). If Telegram is not configured, the notification is STILL logged.
//   - `/api/brain-notifications` — GET (with filters + stats) + POST (create)
//     + PATCH (bulk: mark_read / mark_all_read / delete_read). Uses
//     /api/brain-notifications (NOT /api/notifications — existing endpoint
//     for Monitor/Listing alert delivery history).
//   - `/api/brain-notifications/[id]` — PATCH (mark as read) + DELETE.
//   - `/api/cron/cleanup-notifications` — daily cron (90-day cutoff).
//
// UI:
//   - Bell icon (🔔) in BrainSynthesisCard header — unread count badge (red
//     circle) + dropdown with recent 5 notifications + "Glej vse" link.
//   - Full NotificationCenterCard at the bottom of BrainSynthesisCard —
//     filter bar (type/severity/read) + scrollable list + per-notification
//     actions (mark read / delete) + bulk actions (mark all read / delete
//     read) + auto-refresh 30s. Stats row at the top showing totals.
//
// 8 notification types: brain_digest | autopilot_executed | autopilot_rollback
//   | anomaly | price_drop | system | trade_sold | error
// 4 severities: info | success | warning | error
// 5 sources: brain | autopilot | telegram | system | manual

