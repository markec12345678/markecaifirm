'use client';

// v8.39: Profit Goal section — enhanced v4.2 with live preview + dedicated
// /api/trades/goal-tracker/set endpoint + Goal Tracker Dashboard card hook.
//
// Live preview fetches /api/trades/goal-tracker to show: current realized
// profit, projected profit, % progress, days remaining, daily needed EUR,
// status badge (🟡 Na poti / 🟢 Dosežen / 🔴 Za ciljem). The "Shrani cilj
// takoj" button POSTs to /api/trades/goal-tracker/set which creates a
// notification in v8.38 Notification Center when the goal is achieved.
//
// The local state setter still updates the global settings form state, so
// the standard "Shrani" button at the top of the settings page still saves
// monthlyProfitGoal via /api/settings (backward compat). The dedicated
// endpoint is preferred because it triggers notification creation.
//
// Izločeno iz settings-view.tsx (sprejema props, ker delji state z glavno formo).

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Save, AlertCircle, Target } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ProfitGoalSection({
  monthlyProfitGoal,
  setMonthlyProfitGoal,
  saving: globalSaving,
}: {
  monthlyProfitGoal: number;
  setMonthlyProfitGoal: (n: number) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<string>(String(monthlyProfitGoal ?? ''));
  const [savingGoal, setSavingGoal] = useState(false);
  const [preview, setPreview] = useState<null | {
    ok: boolean;
    current: {
      realizedProfit: number;
      potentialProfit: number;
      soldCount: number;
      heldCount: number;
      lastMonthProfit: number;
      momTrend: number | null;
    };
    goal: {
      monthlyGoal: number;
      goalPct: number;
      projectedPct: number;
      projectedProfit: number;
      remainingToGoal: number;
      dailyNeeded: number;
      daysRemaining: number;
      achieved: boolean;
    };
    recommendation: string;
    recommendationLevel: 'good' | 'warning' | 'critical';
  }>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Sync draft when external state changes (e.g. after settings load)
  useEffect(() => {
    setDraft(String(monthlyProfitGoal ?? ''));
  }, [monthlyProfitGoal]);

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch('/api/trades/goal-tracker');
      if (!res.ok) return;
      const json = await res.json();
      setPreview(json);
    } catch {
      // Silent fail — preview is non-critical
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  useEffect(() => {
    loadPreview();
    const t = setInterval(loadPreview, 60_000);
    return () => clearInterval(t);
  }, [loadPreview]);

  const handleSaveNow = async () => {
    const num = Number(String(draft).trim().replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Vnesi veljavno število (€).');
      return;
    }
    if (num > 1_000_000) {
      toast.error('Cilj previsok (max 1.000.000€).');
      return;
    }
    setSavingGoal(true);
    try {
      const res = await fetch('/api/trades/goal-tracker/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyGoal: num }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'Napaka pri shranjevanju cilja');
      }
      // Sync local + parent state so the global "Shrani" button stays consistent.
      setMonthlyProfitGoal(num);
      toast.success(
        num === 0
          ? 'Mesečni cilj onemogočen.'
          : `Mesečni cilj ${num}€ shranjen.`,
      );
      if (json.goalAchieved) {
        toast.success('🎉 Dosežen mesečni cilj! Čestitke!');
      }
      // Refresh preview to reflect new state.
      loadPreview();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju cilja');
    } finally {
      setSavingGoal(false);
    }
  };

  // Status badge styling — mirrors the GoalTrackerCard dashboard widget.
  const statusBadge = (() => {
    if (!preview || preview.goal.monthlyGoal === 0) {
      return { emoji: '⚪', label: 'Onemogočeno', cls: 'bg-muted/20 text-muted-foreground border-border' };
    }
    if (preview.goal.achieved || preview.goal.goalPct >= 100) {
      return { emoji: '🟢', label: 'Dosežen!', cls: 'bg-primary/15 text-primary border-primary/40' };
    }
    if (preview.goal.projectedPct >= 100) {
      return { emoji: '🟡', label: 'Na poti', cls: 'bg-amber-400/15 text-amber-400 border-amber-400/40' };
    }
    return { emoji: '🔴', label: 'Za ciljem', cls: 'bg-red-500/15 text-red-500 border-red-500/40' };
  })();

  const isDirty = Number(String(draft).trim().replace(',', '.')) !== monthlyProfitGoal;

  return (
    <div className="space-y-4">
      {/* Input row */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="min-w-[180px]">
          <Label className="text-xs uppercase tracking-wider">Cilj (€/mesec)</Label>
          <Input
            type="number"
            min={0}
            step={50}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="0 = onemogočeno"
            className="mt-1 font-mono w-40"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveNow();
            }}
          />
        </div>
        <Button
          onClick={handleSaveNow}
          disabled={savingGoal || globalSaving}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {savingGoal ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {savingGoal ? 'Shranjujem…' : 'Shrani cilj takoj'}
        </Button>
        <p className="text-[11px] text-muted-foreground mt-2 flex-1 min-w-[200px]">
          {Number(String(draft).trim().replace(',', '.')) > 0
            ? 'Goal Tracker card na Dashboard prikaže progress bar z milestones in dnevno potrebnih EUR. Ko dosežeš cilj, se samodejno kreira obvestilo v Notification Center.'
            : 'Onemogočeno — nastavi znesek za motivacijski progress bar z milestones.'}
        </p>
      </div>

      {isDirty && (
        <div className="text-[11px] text-amber-400 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3" />
          Ne-shranjena sprememba — klikni &quot;Shrani cilj takoj&quot; da aktiviraš nov cilj.
        </div>
      )}

      {/* Live preview row */}
      {loadingPreview ? (
        <div className="h-24 animate-pulse bg-muted rounded" />
      ) : preview && preview.goal.monthlyGoal > 0 ? (
        <div className="bg-background/30 rounded p-3 space-y-3 border border-border">
          {/* Header: status badge + progress % */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Target className="w-3 h-3" />
              Trenutno stanje
            </div>
            <Badge variant="outline" className={cn('text-xs gap-1 border', statusBadge.cls)}>
              <span>{statusBadge.emoji}</span>
              {statusBadge.label}
            </Badge>
          </div>

          {/* Big numbers */}
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold font-mono text-primary">
              {preview.current.realizedProfit}€
            </div>
            <div className="text-sm text-muted-foreground font-mono">/ {preview.goal.monthlyGoal}€</div>
            <div className="ml-auto text-sm font-bold font-mono">
              <span className={preview.goal.goalPct >= 100 ? 'text-primary' : preview.goal.goalPct >= 50 ? 'text-amber-400' : 'text-red-500'}>
                {preview.goal.goalPct}%
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-background rounded-full overflow-hidden relative border border-border">
            <div
              className={cn(
                'h-full transition-all',
                preview.goal.goalPct >= 100 ? 'bg-primary' : preview.goal.goalPct >= 50 ? 'bg-amber-400' : 'bg-red-500',
              )}
              style={{ width: `${Math.min(100, preview.goal.goalPct)}%` }}
            />
            {preview.goal.projectedPct > preview.goal.goalPct && preview.goal.projectedPct <= 100 && (
              <div
                className="absolute top-0 h-full opacity-30 bg-primary"
                style={{
                  left: `${Math.min(100, preview.goal.goalPct)}%`,
                  width: `${Math.min(100, preview.goal.projectedPct) - Math.min(100, preview.goal.goalPct)}%`,
                }}
              />
            )}
          </div>

          {/* Mini stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-background/40 rounded p-2 text-center">
              <div className="text-[9px] text-muted-foreground uppercase">Projiciran</div>
              <div className={cn(
                'font-mono font-bold',
                preview.goal.projectedPct >= 100 ? 'text-primary' : 'text-amber-400',
              )}>
                {preview.goal.projectedProfit}€
                <div className="text-[10px]">({preview.goal.projectedPct}%)</div>
              </div>
            </div>
            <div className="bg-background/40 rounded p-2 text-center">
              <div className="text-[9px] text-muted-foreground uppercase">Dnevno potrebnih</div>
              <div className={cn(
                'font-mono font-bold',
                preview.goal.dailyNeeded > 50 ? 'text-red-500' : 'text-primary',
              )}>
                {preview.goal.dailyNeeded}€<div className="text-[10px] text-muted-foreground">/dan</div>
              </div>
            </div>
            <div className="bg-background/40 rounded p-2 text-center">
              <div className="text-[9px] text-muted-foreground uppercase">Dni do konca</div>
              <div className="font-mono font-bold">
                {preview.goal.daysRemaining}<div className="text-[10px] text-muted-foreground">dni</div>
              </div>
            </div>
            <div className="bg-background/40 rounded p-2 text-center">
              <div className="text-[9px] text-muted-foreground uppercase">MoM trend</div>
              <div className={cn(
                'font-mono font-bold',
                (preview.current.momTrend ?? 0) > 0 ? 'text-primary' : (preview.current.momTrend ?? 0) < 0 ? 'text-red-500' : 'text-muted-foreground',
              )}>
                {preview.current.momTrend != null
                  ? `${preview.current.momTrend > 0 ? '+' : ''}${preview.current.momTrend}%`
                  : '—'}
                <div className="text-[10px] text-muted-foreground">({preview.current.lastMonthProfit}€ lani)</div>
              </div>
            </div>
          </div>

          {/* Recommendation */}
          <div className={cn(
            'rounded p-2 text-[11px] font-medium',
            preview.recommendationLevel === 'good'
              ? 'bg-primary/5 text-primary'
              : preview.recommendationLevel === 'warning'
                ? 'bg-amber-400/5 text-amber-400'
                : 'bg-red-500/5 text-red-500',
          )}>
            {preview.recommendation}
          </div>

          <div className="text-[10px] text-muted-foreground text-center pt-1 border-t border-border">
            💡 Goal Tracker card na Dashboard se avto-osvežuje vsakih 60s. Live preview tukaj se osvežuje vsakih 60s.
          </div>
        </div>
      ) : (
        <div className="bg-amber-400/5 border border-amber-400/30 rounded p-3 text-xs text-amber-400 text-center">
          ⚠️ Mesečni cilj ni nastavljen. Vnesi znesek zgoraj in klikni &quot;Shrani cilj takoj&quot; za aktivacijo Goal Tracker card-a na Dashboard.
        </div>
      )}
    </div>
  );
}
