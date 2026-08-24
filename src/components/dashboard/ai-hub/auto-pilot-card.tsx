'use client';

// v8.97: Auto Pilot Card extracted from ai-hub-view.tsx (v8.30/v8.31, purple/indigo).
// AUTOMATION PHASE: automatically executes ONLY LOW-risk drafts that meet ALL 8
// safety rules. v8.31 adds aggressive mode + anomaly detection + double-confirm.
// Each auto-executed draft is rollbackable — undo calls recordActionFeedback('rejected').

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Activity, AlertCircle, AlertOctagon, Bot, Clock, History, Info, Lock,
  Play, Power, RefreshCw, Rocket, Settings2, ShieldAlert, Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type {
  AutoPilotStatsResponse, AutoPilotHistoryDraft, AutoPilotRunResponse,
  EnableAggressiveResponse, DisableAggressiveResponse, ClearAnomalyResponse,
} from './types';
import { DOMAIN_LABELS } from './utils';

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
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Napaka');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri preklopu auto-pilot-a');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri shranjevanju config-a');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri zagonu auto-pilot-a');
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
    } catch (e: unknown) {
      // Fallback: show empty history with error toast
      toast.error((e as Error)?.message ?? 'Napaka pri pridobivanju zgodovine');
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
      } catch (e: unknown) {
        toast.error((e as Error)?.message ?? 'Napaka pri razveljavitvi');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri vklopu aggressive mode');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri izklopu aggressive mode');
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
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri razveljavitvi suspenzije');
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
              Red, eye-catching, with "Razveljavi suspenzijo" button. */}
          {anomalySuspended && (
            <div className="rounded-lg border-2 border-red-500/50 bg-red-500/10 p-2.5 space-y-1.5">
              <div className="flex items-start gap-2">
                <AlertOctagon className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-red-700 dark:text-red-300">
                    ⚠️ AUTO-PILOT SUSPENDED
                  </div>
                  <div className="text-[10px] text-red-700/90 dark:text-red-300/90 mt-0.5 leading-snug">
                    {anomalyReason ?? 'Anomaly detected — possible loop'}
                    {anomalySuspendedAt && (
                      <span className="block text-[9px] italic mt-0.5">
                        Suspended at: {new Date(anomalySuspendedAt).toLocaleString('sl-SI')}
                      </span>
                    )}
                    <span className="block mt-0.5">
                      Preglej zgodovino in klikni &quot;Razveljavi suspenzijo&quot; za ponovni vklop.
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleClearAnomaly}
                  disabled={clearingAnomaly}
                  className="text-[10px] px-2 py-1 rounded border bg-red-500/20 border-red-500/50 hover:bg-red-500/30 text-red-700 dark:text-red-300 shrink-0 flex items-center gap-1 disabled:opacity-50 font-semibold"
                >
                  {clearingAnomaly ? (
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <Undo2 className="w-2.5 h-2.5" />
                  )}
                  Razveljavi suspenzijo
                </button>
              </div>
            </div>
          )}

          {/* v8.31: Aggressive mode active banner — shown when mode='aggressive'.
              Red/rose, with toggle-back button. */}
          {!anomalySuspended && isAggressive && (
            <div className="rounded-lg border-2 border-rose-500/40 bg-rose-500/10 p-2 flex items-center gap-2">
              <Rocket className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                  AGGRESSIVE MODE — višje tveganje
                </div>
                <div className="text-[9px] text-rose-700/80 dark:text-rose-300/80">
                  Dovoljena MEDIUM confidence (do 300€ uplift). HIGH še vedno manual. Limit 10/dan, budget 2000€/dan.
                </div>
              </div>
              <button
                onClick={handleDisableAggressive}
                disabled={togglingMode}
                className="text-[10px] px-2 py-1 rounded border bg-rose-500/15 border-rose-500/40 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 shrink-0 disabled:opacity-50 font-semibold"
              >
                🛡️ Nazaj v Safe
              </button>
            </div>
          )}

          {/* v8.31: Aggressive pending confirmation banner — shown after first click.
              Yellow/amber, prompts user to confirm within 5 minutes. */}
          {!anomalySuspended && !isAggressive && aggressivePending && (
            <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-2 flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                  ⚠️ Aggressive mode dovoli MEDIUM confidence
                </div>
                <div className="text-[9px] text-amber-700/80 dark:text-amber-300/80">
                  Potrdi ponovno v 5 minutah za aktivacijo aggressive mode.
                </div>
              </div>
              <button
                onClick={handleEnableAggressive}
                disabled={togglingMode}
                className="text-[10px] px-2 py-1 rounded border bg-amber-500/20 border-amber-500/40 hover:bg-amber-500/30 text-amber-700 dark:text-amber-400 shrink-0 disabled:opacity-50 font-bold"
              >
                ✅ Potrdi
              </button>
            </div>
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

          {/* Config sliders — only when enabled */}
          {enabled && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-2 space-y-3">
              <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
                <Settings2 className="w-2.5 h-2.5" />
                Konfiguracija
              </div>

              {/* Daily limit slider (1-10) */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">Dnevni limit (akcije)</span>
                  <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
                    {dailyLimitInput}/dan
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={dailyLimitInput}
                  onChange={(e) => setDailyLimitInput(Number(e.target.value))}
                  className="w-full accent-purple-600 cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
                  <span>1</span>
                  <span>5</span>
                  <span>10</span>
                </div>
              </div>

              {/* Daily budget slider (100-2000€) */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">Dnevni budget (€)</span>
                  <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
                    {dailyBudgetInput}€/dan
                  </span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={2000}
                  step={50}
                  value={dailyBudgetInput}
                  onChange={(e) => setDailyBudgetInput(Number(e.target.value))}
                  className="w-full accent-purple-600 cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
                  <span>100€</span>
                  <span>1000€</span>
                  <span>2000€</span>
                </div>
              </div>

              {/* v8.31: Mode selector — now active (not disabled).
                  Safe is default; Aggressive requires double confirmation. */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1 flex items-center justify-between">
                  <span>Mode</span>
                  <span className="text-[8px] normal-case font-normal italic">
                    {isAggressive
                      ? 'Aggressive aktiven — klikni Safe za izklop'
                      : aggressivePending
                        ? 'Čaka potrditev aggressive...'
                        : 'Klikni Aggressive za double opt-in'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={handleDisableAggressive}
                    disabled={togglingMode || (!isAggressive && !aggressivePending)}
                    className={cn(
                      'h-7 text-[10px] font-bold rounded border transition-colors',
                      !isAggressive
                        ? 'bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300'
                        : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50',
                    )}
                    title="Safe mode — only LOW-confidence, low-uplift, non-risk actions"
                  >
                    🛡️ Safe (LOW risk only)
                  </button>
                  <button
                    type="button"
                    onClick={handleEnableAggressive}
                    disabled={togglingMode || isAggressive || anomalySuspended}
                    className={cn(
                      'h-7 text-[10px] font-bold rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                      isAggressive
                        ? 'bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-300'
                        : aggressivePending
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400 animate-pulse'
                          : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/50',
                    )}
                    title={
                      anomalySuspended
                        ? 'Cannot switch to aggressive while anomaly is suspended'
                        : isAggressive
                          ? 'Aggressive mode already active'
                          : 'Aggressive mode — requires double confirmation (5-min window)'
                    }
                  >
                    {aggressivePending ? '✅ Potrdi Aggressive' : '🚀 Aggressive (MEDIUM OK)'}
                  </button>
                </div>
              </div>

              {/* Save config button (only when dirty) */}
              {dirty && (
                <div className="flex items-center justify-end gap-1 pt-1 border-t border-purple-500/20">
                  <button
                    onClick={() => {
                      setDailyLimitInput(todayLimit);
                      setDailyBudgetInput(todayBudget);
                    }}
                    className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted/50"
                  >
                    Prekliči
                  </button>
                  <button
                    onClick={saveConfig}
                    disabled={toggling}
                    className="text-[10px] px-2 py-1 rounded border bg-purple-500/20 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/30 font-semibold disabled:opacity-50"
                  >
                    💾 Shrani config
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Today's stats — with progress bars + v8.31 hourly counter */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.03] p-2 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80 font-semibold flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" />
              Danes
              <span className="text-[8px] normal-case font-normal text-muted-foreground italic ml-auto">
                zadnji run: {stats.config.lastRunAt ? new Date(stats.config.lastRunAt).toLocaleString('sl-SI') : '—'}
              </span>
            </div>
            {/* v8.31: Mode-aware stats line */}
            <div className="text-[10px] text-muted-foreground leading-snug">
              Danes: <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{todayAutoExecuted}/{displayLimit}</span> akcij ({mode}) ·{' '}
              <span className="font-mono font-bold text-purple-700 dark:text-purple-300">{todayBudgetUsed.toFixed(0)}€/{displayBudget}€</span> budget
            </div>
            {/* v8.31: Hourly counter line */}
            <div className="text-[9px] text-muted-foreground/80 italic">
              Zadnja ura: <span className="font-mono font-bold">{hourlyExecCount}</span> akcij
              {hourlyExecCount >= 6 && (
                <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">
                  · ⚠️ blizu anomaly threshold (8)
                </span>
              )}
              {hourlyWindowStart && (
                <span className="ml-1 text-[8px]">
                  (od {new Date(hourlyWindowStart).toLocaleTimeString('sl-SI')})
                </span>
              )}
            </div>
            {/* Limit progress */}
            <div>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-muted-foreground">Limit</span>
                <span className="font-mono font-bold">
                  {todayAutoExecuted}/{todayLimit} akcij
                </span>
              </div>
              <div className="h-1.5 bg-background/60 rounded overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    limitPct >= 100 ? 'bg-red-500' : limitPct >= 80 ? 'bg-amber-500' : 'bg-purple-500',
                  )}
                  style={{ width: `${limitPct}%` }}
                />
              </div>
            </div>
            {/* Budget progress */}
            <div>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-muted-foreground">Budget</span>
                <span className="font-mono font-bold">
                  {todayBudgetUsed.toFixed(0)}€/{todayBudget}€
                </span>
              </div>
              <div className="h-1.5 bg-background/60 rounded overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-amber-500' : 'bg-purple-500',
                  )}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* All-time stats */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Skupno auto</div>
              <div className="text-base font-bold text-purple-700 dark:text-purple-300 font-mono">
                {allTimeTotal}
              </div>
            </div>
            <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Razveljavljeno</div>
              <div className="text-base font-bold text-amber-600 dark:text-amber-400 font-mono">
                {allTimeRollback}
              </div>
            </div>
            <div className="rounded border border-purple-500/20 bg-purple-500/[0.03] p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Rollback rate</div>
              <div
                className={cn(
                  'text-base font-bold font-mono',
                  rollbackRate > 20
                    ? 'text-red-600 dark:text-red-400'
                    : rollbackRate > 5
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {rollbackRate.toFixed(1)}%
              </div>
            </div>
          </div>

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

      {/* History Modal */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bot className="w-4 h-4 text-purple-600 dark:text-purple-300" />
              🤖 Auto-pilot Zgodovina
            </DialogTitle>
            <DialogDescription>
              Zadnjih 10 auto-executed akcij. Vsako lahko razveljaviš (↩️ Razveljavi) —
              to tudi undo-a learning preko recordActionFeedback z &apos;rejected&apos;.
            </DialogDescription>
          </DialogHeader>

          {historyLoading && (
            <div className="space-y-2 py-4">
              <Skeleton className="h-12 w-full bg-purple-500/10" />
              <Skeleton className="h-12 w-full bg-purple-500/10" />
              <Skeleton className="h-12 w-full bg-purple-500/10" />
            </div>
          )}

          {!historyLoading && history && history.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Bot className="w-8 h-8 mx-auto mb-2 text-purple-500/50" />
              Še ni auto-executed akcij. Vklopi auto-pilot in zaženi run, ali
              počakaj na hourly cron.
            </div>
          )}

          {!historyLoading && history && history.length > 0 && (
            <div className="space-y-2">
              {history.map((d) => {
                const dm = DOMAIN_LABELS[d.domain] ?? { icon: '•', label: d.domain, color: 'text-foreground' };
                const executedAtStr = d.executedAt
                  ? (() => {
                      try {
                        return new Date(d.executedAt).toLocaleString('sl-SI');
                      } catch {
                        return '—';
                      }
                    })()
                  : '—';
                return (
                  <div
                    key={d.id}
                    className={cn(
                      'rounded-lg border p-2 text-xs',
                      d.rolledBack
                        ? 'border-amber-500/30 bg-amber-500/[0.04]'
                        : 'border-purple-500/20 bg-purple-500/[0.03]',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 w-3 text-center font-bold text-muted-foreground">
                        {d.rank}.
                      </span>
                      <span className="shrink-0" title={dm.label}>
                        {dm.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{d.action}</div>
                        <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                          <Clock className="w-2 h-2" />
                          {executedAtStr}
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono">{d.signal}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono text-purple-600 dark:text-purple-400">
                            +{d.expectedUpliftEUR}€
                          </span>
                        </div>
                        {d.rolledBack && (
                          <div className="mt-1 text-[9px] text-amber-700 dark:text-amber-400 italic">
                            ↩️ Razveljavljeno{d.rollbackReason ? `: ${d.rollbackReason.slice(0, 80)}` : ''}
                          </div>
                        )}
                        {d.autoPilotReason && !d.rolledBack && (
                          <details className="mt-1">
                            <summary className="text-[9px] text-purple-700/70 dark:text-purple-300/70 cursor-pointer">
                              ℹ️ Audit (8 pravil)
                            </summary>
                            <div className="text-[8px] text-muted-foreground mt-0.5 font-mono whitespace-pre-wrap">
                              {d.autoPilotReason.split('; ').map((r, i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    r.startsWith('PASS')
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-600 dark:text-red-400',
                                  )}
                                >
                                  {r}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                      {!d.rolledBack && (
                        <button
                          onClick={() => rollbackDraft(d.id)}
                          disabled={rollingBackId === d.id}
                          className="text-[9px] px-2 py-1 rounded border bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 shrink-0 flex items-center gap-1 disabled:opacity-50"
                        >
                          {rollingBackId === d.id ? (
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Undo2 className="w-2.5 h-2.5" />
                          )}
                          Razveljavi
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
