'use client';

// v8.97: Adaptive Weights Card extracted from ai-hub-view.tsx (v8.28, orange).
// FEEDBACK LOOP: Master Brain learns from REVEALED preferences (which actions user
// executes vs rejects). After every 10 actions per domain: rate > 80% → ×1.1,
// < 40% → ×0.9, clamp [0.5, 2.0]. UI: 7 sliders + stats + history + reset + demo form.

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Settings2, AlertCircle, RefreshCw, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { AdaptiveWeightsResponse, DomainName } from './types';
import { rateColor, rateLabel, DOMAIN_DISPLAY } from './utils';

export function AdaptiveWeightsCard() {
  const [data, setData] = useState<AdaptiveWeightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-domain slider draft state (so user can adjust multiple sliders before saving)
  const [draftWeights, setDraftWeights] = useState<Record<DomainName, number>>({
    profit: 1.2,
    inventory: 1.0,
    market: 1.0,
    sourcing: 1.1,
    risk: 1.3,
    buyer: 0.9,
    pricing: 1.1,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Feedback demo form state
  const [feedbackDomain, setFeedbackDomain] = useState<DomainName>('profit');
  const [recording, setRecording] = useState(false);

  const fetchWeights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/weights', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AdaptiveWeightsResponse;
      if (!json?.ok) throw new Error('Adaptive Weights API ni vrnil rezultata');
      setData(json);
      // Sync draft weights with current values (so slider shows current weight)
      const drafts: Record<DomainName, number> = { ...draftWeights };
      for (const d of DOMAIN_DISPLAY) {
        drafts[d.key] = json.adaptiveWeights[d.key]?.weight ?? 1.0;
      }
      setDraftWeights(drafts);
      setDirty(false);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeights();
  }, [fetchWeights]);

  // Save all dirty slider values to backend (calls POST { action: 'set' } for each changed domain)
  const saveAll = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const changedDomains = DOMAIN_DISPLAY.filter(
        (d) => Math.abs(draftWeights[d.key] - data.adaptiveWeights[d.key].weight) > 0.001,
      );
      if (changedDomains.length === 0) {
        toast.info('Ni sprememb za shranjevanje');
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const d of changedDomains) {
        try {
          const res = await fetch('/api/ai/brain/weights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set', domain: d.key, weight: draftWeights[d.key] }),
          });
          if (res.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
      if (fail === 0) {
        toast.success(`✓ Shranjeno: ${ok} uteži posodobljene`);
      } else {
        toast.warning(`Delno: ${ok} OK, ${fail} napake`);
      }
      await fetchWeights();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  }, [data, draftWeights, fetchWeights]);

  // Reset all weights to defaults
  const resetAll = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/ai/brain/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error('Reset ni uspel');
      toast.success('✓ Vse uteži resetirane na default');
      await fetchWeights();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri resetu');
    } finally {
      setResetting(false);
    }
  }, [fetchWeights]);

  // Record feedback (executed/rejected) for the selected domain in the demo form
  const recordFeedback = useCallback(async (feedback: 'executed' | 'rejected') => {
    setRecording(true);
    try {
      const res = await fetch('/api/ai/brain/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record', domain: feedbackDomain, feedback }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? 'Record ni uspel');
      const emoji = feedback === 'executed' ? '✅' : '❌';
      const adjText = json.adjusted
        ? ` → utež posodobljena: ${json.oldWeight} → ${json.newWeight}`
        : ` (executed: ${json.executed}, rejected: ${json.rejected}, rate: ${Math.round(json.executionRate * 100)}%)`;
      toast.success(`${emoji} ${feedbackDomain}: ${feedback}${adjText}`);
      await fetchWeights();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri record');
    } finally {
      setRecording(false);
    }
  }, [feedbackDomain, fetchWeights]);

  return (
    <div className="rounded-xl border-2 border-orange-500/40 bg-gradient-to-br from-orange-500/15 via-amber-500/10 to-yellow-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🎛️ Adaptive Domain Weights
          </span>
          <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-700 dark:text-orange-400 shrink-0 font-bold">
            v8.28
          </Badge>
          <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-700/80 dark:text-orange-400/80 shrink-0">
            FEEDBACK LOOP
          </Badge>
        </div>
        <button
          onClick={fetchWeights}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži uteži
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-orange-700/80 dark:text-orange-300/80 mb-2.5 leading-snug">
        Master Brain se uči iz tvojega vedenja. Ko označuješ akcije kot
        &quot;executed&quot; ali &quot;rejected&quot;, sistem beleži execution
        rate per domeno. Po vsakih 10 akcijah: rate &gt; 80% → utež × 1.1 (boost),
        &lt; 40% → × 0.9 (reduce), clamp [0.5, 2.0].
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-orange-500/10" />
          <Skeleton className="h-3 w-3/4 bg-orange-500/10" />
          <div className="grid grid-cols-1 gap-2 pt-1">
            <Skeleton className="h-12 bg-orange-500/10" />
            <Skeleton className="h-12 bg-orange-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchWeights} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content — 7 domain rows */}
      {!loading && !error && data && (
        <div className="space-y-2.5">
          {DOMAIN_DISPLAY.map((d) => {
            const stats = data.adaptiveWeights[d.key];
            const total = stats.executed + stats.rejected;
            const rate = total > 0 ? stats.executed / total : 0;
            const draftVal = draftWeights[d.key];
            const isDirty = Math.abs(draftVal - stats.weight) > 0.001;
            return (
              <div
                key={d.key}
                className={cn(
                  'rounded-lg border p-2 sm:p-2.5',
                  isDirty
                    ? 'border-orange-500/60 bg-orange-500/10'
                    : 'border-orange-500/20 bg-orange-500/[0.03]',
                )}
              >
                {/* Top row: domain + weight number + stats */}
                <div className="flex items-center gap-2 mb-1.5 min-w-0 flex-wrap">
                  <div className="flex items-center gap-1.5 shrink-0 min-w-[110px]">
                    <span className="text-base">{d.icon}</span>
                    <span className="text-xs sm:text-[13px] font-semibold text-foreground">
                      {d.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    <span
                      className={cn(
                        'text-xs font-mono font-bold px-1.5 py-0.5 rounded',
                        isDirty
                          ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300'
                          : 'bg-background/60 text-foreground',
                      )}
                      title="Current domain weight applied in Master Brain ranking"
                    >
                      {draftVal.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ✅{stats.executed} | ❌{stats.rejected}
                    </span>
                  </div>
                </div>

                {/* Slider */}
                <Slider
                  value={[draftVal]}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  onValueChange={(v) => {
                    const newV = v[0] ?? 1.0;
                    setDraftWeights((prev) => ({ ...prev, [d.key]: newV }));
                    setDirty(true);
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
                  <span>0.5 (reduce)</span>
                  <span>1.0 (default)</span>
                  <span>2.0 (boost)</span>
                </div>

                {/* Execution rate bar */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-background/60 rounded overflow-hidden">
                    <div
                      className={cn('h-full transition-all', rateColor(rate))}
                      style={{ width: `${Math.round(rate * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                    {total > 0 ? `${Math.round(rate * 100)}%` : '—'}
                    {' '}
                    ({rateLabel(rate)})
                  </span>
                </div>

                {/* Mini adjustment history (last 3) */}
                {stats.adjustmentHistory.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="text-[9px] uppercase text-muted-foreground font-semibold">
                      Zgodovina (zadnje {Math.min(3, stats.adjustmentHistory.length)})
                    </div>
                    {stats.adjustmentHistory.slice(0, 3).map((h, idx) => (
                      <div key={idx} className="text-[9px] text-muted-foreground/80 font-mono truncate">
                        {h.date.slice(0, 10)}: {h.oldWeight.toFixed(1)} → {h.newWeight.toFixed(1)}
                        {' '}
                        <span className="text-muted-foreground/60">
                          ({h.newWeight > h.oldWeight ? 'boost' : h.newWeight < h.oldWeight ? 'reduce' : 'no change'})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Action buttons row */}
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-orange-500/20">
            <Button
              size="sm"
              variant="outline"
              onClick={resetAll}
              disabled={resetting || loading}
              className="h-7 px-3 text-[10px] gap-1.5 border-orange-500/40 text-orange-700 dark:text-orange-300 hover:bg-orange-500/10"
            >
              {resetting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              🔄 Reset na default
            </Button>
            <div className="flex items-center gap-2">
              {dirty && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">
                  Neshranjene spremembe
                </span>
              )}
              <Button
                size="sm"
                onClick={saveAll}
                disabled={!dirty || saving}
                className="h-7 px-3 text-[10px] gap-1.5 bg-orange-600 hover:bg-orange-700 text-white border-orange-700"
              >
                {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                💾 Shrani uteži
              </Button>
            </div>
          </div>

          {/* Feedback demo form */}
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-2 sm:p-2.5 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80 font-semibold flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Demo: zabeleži akcijski feedback
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Simuliraj uporabnikovo oznako akcije. Vsaka 10. akcija per domeno
              sproži re-evaluacijo uteži (boost ×1.1 če rate &gt; 80%, reduce ×0.9
              če rate &lt; 40%).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Domain dropdown */}
              <div>
                <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
                  Domena
                </label>
                <select
                  value={feedbackDomain}
                  onChange={(e) => setFeedbackDomain(e.target.value as DomainName)}
                  className="h-8 w-full text-xs bg-background/50 border border-orange-500/20 rounded px-2"
                >
                  {DOMAIN_DISPLAY.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.icon} {d.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* Feedback buttons */}
              <div>
                <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
                  Feedback
                </label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => recordFeedback('executed')}
                    disabled={recording}
                    className="h-8 text-[11px] font-bold rounded border bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    ✅ Executed
                  </button>
                  <button
                    type="button"
                    onClick={() => recordFeedback('rejected')}
                    disabled={recording}
                    className="h-8 text-[11px] font-bold rounded border bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    ❌ Rejected
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[9px] text-muted-foreground italic">
              POST /api/ai/brain/weights &#123; action: &apos;record&apos;, domain, feedback &#125;
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
