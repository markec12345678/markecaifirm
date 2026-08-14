'use client';

// v8.39: Goal Tracker Dashboard Card — visual progress bar toward monthly goal.
//
// Replaces the v6.7 inline goal card in dashboard-view.tsx (which only
// rendered when monthlyGoal > 0 — left the disabled state without any UI).
// This component handles BOTH states:
//
//   1. monthlyGoal === 0 (DISABLED):
//      Shows "Nastavi mesečni cilj" prompt with input field + Save button.
//      POSTs to /api/trades/goal-tracker/set → on success, refetches the
//      goal-tracker GET endpoint and switches to the enabled view.
//
//   2. monthlyGoal > 0 (ENABLED):
//      - Big progress bar (0% → 100%) with color coding:
//          red    < 25%
//          amber  25-75%
//          green  ≥ 75%
//      - Big numbers: "306€ / 500€" (current / goal)
//      - Projected profit: "Projiciran: 678€ (135%)" with trend arrow
//      - 4 milestone circles (25%/50%/75%/100%) — achieved = filled green,
//        pending = gray
//      - Days remaining + Daily needed: "17 dni do konca meseca · 12€/dan"
//      - MoM trend: "↗️ +15% vs prejšnji mesec" or "↘️ -54% vs prejšnji mesec"
//      - Goal status badge: "🟡 Na poti" / "🟢 Dosežen!" / "🔴 Za ciljem"
//      - "✏️ Uredi cilj" button → inline edit mode (reuses the disabled
//        state's input UI, but pre-populated with current goal)
//
// Auto-refresh every 60s (per task spec).
// Color coding: red / amber / green via Tailwind utility classes.
// Uses shadcn Card, Badge, Button, Input, Label components.
// Fetches from /api/trades/goal-tracker (existing v6.7 GET).

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Target,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Check,
  Pencil,
  Save,
  X,
  CalendarClock,
  CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- Types (mirror GET /api/trades/goal-tracker response shape) -----------

interface CurrentData {
  realizedProfit: number;
  potentialProfit: number;
  totalPotential: number;
  soldCount: number;
  heldCount: number;
  lastMonthProfit: number;
  momTrend: number | null;
}

interface GoalData {
  monthlyGoal: number;
  goalPct: number;
  projectedPct: number;
  projectedProfit: number;
  remainingToGoal: number;
  dailyNeeded: number;
  daysRemaining: number;
  achieved: boolean;
}

interface Milestone {
  pct: number;
  label: string;
  achieved: boolean;
  profit: number;
}

interface GoalTrackerResponse {
  ok: boolean;
  current: CurrentData;
  goal: GoalData;
  milestones: Milestone[];
  recommendation: string;
  recommendationLevel: 'good' | 'warning' | 'critical';
  history: Array<{ month: string; label: string; profit: number; count: number }>;
}

// --- Color coding helpers -------------------------------------------------

function progressColor(pct: number): { bar: string; text: string; bg: string; border: string } {
  if (pct >= 75) {
    return {
      bar: 'bg-primary',
      text: 'text-primary',
      bg: 'bg-primary/5 border-primary/40',
      border: 'border-primary/40',
    };
  }
  if (pct >= 25) {
    return {
      bar: 'bg-amber-400',
      text: 'text-amber-400',
      bg: 'bg-amber-400/5 border-amber-400/40',
      border: 'border-amber-400/40',
    };
  }
  return {
    bar: 'bg-red-500',
    text: 'text-red-500',
    bg: 'bg-red-500/5 border-red-500/40',
    border: 'border-red-500/40',
  };
}

function statusBadge(goal: GoalData): { emoji: string; label: string; className: string } {
  if (goal.achieved || goal.goalPct >= 100) {
    return {
      emoji: '🟢',
      label: 'Dosežen!',
      className: 'bg-primary/15 text-primary border-primary/40',
    };
  }
  if (goal.projectedPct >= 100) {
    return {
      emoji: '🟡',
      label: 'Na poti',
      className: 'bg-amber-400/15 text-amber-400 border-amber-400/40',
    };
  }
  return {
    emoji: '🔴',
    label: 'Za ciljem',
    className: 'bg-red-500/15 text-red-500 border-red-500/40',
  };
}

// --- Component ------------------------------------------------------------

export function GoalTrackerCard() {
  const [data, setData] = useState<GoalTrackerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftGoal, setDraftGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades/goal-tracker');
      if (!res.ok) return;
      const json = (await res.json()) as GoalTrackerResponse;
      setData(json);
      setDraftGoal(String(json.goal.monthlyGoal || ''));
    } catch {
      // Silent fail — non-critical widget
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // v8.39: auto-refresh every 60s
    return () => clearInterval(t);
  }, [load]);

  const handleSave = async () => {
    const raw = draftGoal.trim().replace(',', '.');
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Vnesi veljavno število (€) — 0 ali več.');
      return;
    }
    if (num > 1_000_000) {
      toast.error('Cilj je previsok (max 1.000.000€).');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/trades/goal-tracker/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyGoal: num }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'Napaka pri shranjevanju');
      }
      toast.success(
        num === 0
          ? 'Mesečni cilj onemogočen.'
          : `Mesečni cilj nastavljen na ${num}€.`,
      );
      if (json.goalAchieved) {
        toast.success('🎉 Dosežen mesečni cilj! Čestitke!');
      }
      setEditing(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setDraftGoal(String(data?.goal.monthlyGoal ?? ''));
  };

  // --- Loading state ----------------------------------------------------
  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-32 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const monthlyGoal = data?.goal.monthlyGoal ?? 0;
  const isDisabled = monthlyGoal === 0;

  // --- Edit form (shared by disabled + edit-mode) -----------------------
  const editForm = (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Target className="w-3.5 h-3.5" />
        {isDisabled
          ? 'Nastavi mesečni cilj dobička (€). 0 = onemogočeno.'
          : 'Uredi mesečni cilj dobička (€). 0 = onemogočeno.'}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <Label htmlFor="goal-input" className="text-xs uppercase tracking-wider">
            Cilj (€/mesec)
          </Label>
          <Input
            id="goal-input"
            type="number"
            min={0}
            step={50}
            value={draftGoal}
            onChange={(e) => setDraftGoal(e.target.value)}
            placeholder="npr. 500"
            className="mt-1 font-mono"
            autoFocus={isDisabled || editing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') handleCancel();
            }}
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? 'Shranjujem…' : 'Shrani'}
        </Button>
        {!isDisabled && (
          <Button variant="ghost" onClick={handleCancel} disabled={saving} className="gap-1">
            <X className="w-3.5 h-3.5" />
            Prekliči
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ko dosežeš cilj, se samodejno kreira obvestilo v Notification Center (v8.38).
      </p>
    </div>
  );

  // --- Disabled state (no goal set) ------------------------------------
  if (isDisabled || !data) {
    return (
      <Card className="border-2 border-amber-400/30 bg-amber-400/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Target className="w-4 h-4" />
              Mesečni cilj dobička
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">
                v8.39
              </Badge>
            </h3>
            <span className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' })}
            </span>
          </div>
          {editForm}
        </CardContent>
      </Card>
    );
  }

  // --- Enabled state (goal > 0) ----------------------------------------
  const goal = data.goal;
  const current = data.current;
  const pc = progressColor(goal.goalPct);
  const sb = statusBadge(goal);
  const momTrend = current.momTrend;
  const monthLabel = new Date().toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });

  return (
    <Card className={cn('border-2', pc.bg)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Target className="w-4 h-4" />
            Mesečni cilj dobička
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
              v8.39
            </Badge>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{monthLabel}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={load}
              title="Osveži"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
            {!editing && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setEditing(true);
                  setDraftGoal(String(goal.monthlyGoal));
                }}
              >
                <Pencil className="w-3 h-3" />
                Uredi cilj
              </Button>
            )}
          </div>
        </div>

        {/* Edit mode inline */}
        {editing ? (
          editForm
        ) : (
          <>
            {/* Big numbers row: current / goal */}
            <div className="flex items-baseline gap-3 mb-3 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Realizirano / Cilj
                </div>
                <div className="text-3xl font-bold font-mono">
                  <span className={pc.text}>{current.realizedProfit}€</span>
                  <span className="text-muted-foreground mx-1 text-2xl">/</span>
                  <span className="text-foreground">{goal.monthlyGoal}€</span>
                </div>
              </div>
              <div className="ml-auto">
                <Badge className={cn('text-xs gap-1 border', sb.className)} variant="outline">
                  <span>{sb.emoji}</span>
                  {sb.label}
                </Badge>
              </div>
            </div>

            {/* Big progress bar */}
            <div className="mb-3">
              <div className="h-5 bg-background rounded-full overflow-hidden relative border border-border">
                {/* Realized portion */}
                <div
                  className={cn('h-full transition-all duration-500', pc.bar)}
                  style={{ width: `${Math.min(100, goal.goalPct)}%` }}
                />
                {/* Projected overlay (lighter) */}
                {goal.projectedPct > goal.goalPct && goal.projectedPct <= 100 && (
                  <div
                    className={cn('absolute top-0 h-full opacity-30 transition-all', pc.bar)}
                    style={{
                      left: `${Math.min(100, goal.goalPct)}%`,
                      width: `${Math.min(100, goal.projectedPct) - Math.min(100, goal.goalPct)}%`,
                    }}
                />
                )}
                {/* % label centered */}
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-foreground/80 mix-blend-difference">
                  {goal.goalPct}%
                </div>
              </div>
              {/* Under-bar meta */}
              <div className="flex items-center justify-between text-[10px] mt-1.5">
                <span className={cn('font-bold', pc.text)}>{goal.goalPct}% realizirano</span>
                {goal.projectedPct !== goal.goalPct && (
                  <span className="text-muted-foreground">
                    Projiciran do konca meseca:{' '}
                    <span className={cn('font-bold', goal.projectedPct >= 100 ? 'text-primary' : 'text-amber-400')}>
                      {goal.projectedPct}%
                    </span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  Še {goal.remainingToGoal}€ do cilja
                </span>
              </div>
            </div>

            {/* Projected profit + MoM trend row */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-background/30 rounded p-2">
                <div className="text-[9px] text-muted-foreground uppercase flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Projiciran dobiček
                </div>
                <div className="flex items-baseline gap-1.5">
                  <div
                    className={cn(
                      'font-mono font-bold text-lg',
                      goal.projectedPct >= 100 ? 'text-primary' : 'text-amber-400',
                    )}
                  >
                    {goal.projectedProfit}€
                  </div>
                  <div
                    className={cn(
                      'text-[10px] font-bold flex items-center gap-0.5',
                      goal.projectedPct >= 100 ? 'text-primary' : 'text-amber-400',
                    )}
                  >
                    {goal.projectedPct >= 100 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {goal.projectedPct}%
                  </div>
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[9px] text-muted-foreground uppercase">
                  ↗️ MoM trend (vs prejšnji mesec)
                </div>
                {momTrend == null ? (
                  <div className="font-mono font-bold text-muted-foreground text-lg">—</div>
                ) : (
                  <div
                    className={cn(
                      'font-mono font-bold text-lg flex items-center gap-1',
                      momTrend > 0 ? 'text-primary' : momTrend < 0 ? 'text-red-500' : 'text-muted-foreground',
                    )}
                  >
                    {momTrend > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : momTrend < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5" />
                    ) : null}
                    {momTrend > 0 ? '+' : ''}
                    {momTrend}%
                    <span className="text-[10px] text-muted-foreground font-normal">
                      ({current.lastMonthProfit}€ lani)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Milestones row — 4 circles */}
            <div className="flex items-center justify-between gap-2 mb-3">
              {data.milestones?.map((m: Milestone) => (
                <div
                  key={m.pct}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={`${m.pct}% — ${m.label}: ${m.profit}€`}
                >
                  <div
                    className={cn(
                      'w-9 h-9 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all',
                      m.achieved
                        ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                        : 'bg-background border-border text-muted-foreground',
                    )}
                  >
                    {m.achieved ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <span>{m.pct}</span>
                    )}
                  </div>
                  <div
                    className={cn(
                      'text-[9px] text-center',
                      m.achieved ? 'text-primary font-bold' : 'text-muted-foreground',
                    )}
                  >
                    {m.label}
                    <div className="font-mono">{m.profit}€</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Days remaining + Daily needed */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-background/30 rounded p-2 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase">Dni do konca meseca</div>
                  <div className="font-mono font-bold text-sm">
                    {goal.daysRemaining} <span className="text-muted-foreground text-[10px]">dni</span>
                  </div>
                </div>
              </div>
              <div className="bg-background/30 rounded p-2 flex items-center gap-2">
                <CalendarClock
                  className={cn(
                    'w-4 h-4 shrink-0',
                    goal.dailyNeeded > 50 ? 'text-red-500' : 'text-primary',
                  )}
                />
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase">Dnevno potrebnih</div>
                  <div
                    className={cn(
                      'font-mono font-bold text-sm',
                      goal.dailyNeeded > 50 ? 'text-red-500' : 'text-primary',
                    )}
                  >
                    {goal.dailyNeeded}€<span className="text-muted-foreground text-[10px]">/dan</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recommendation */}
            <div
              className={cn(
                'rounded p-2 text-xs font-medium',
                data.recommendationLevel === 'good'
                  ? 'bg-primary/5 text-primary'
                  : data.recommendationLevel === 'warning'
                    ? 'bg-amber-400/5 text-amber-400'
                    : 'bg-red-500/5 text-red-500',
              )}
            >
              {data.recommendation}
            </div>

            {/* History mini chart */}
            {data.history && data.history.length > 1 && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Zadnjih 6 mesecev
                </div>
                <div className="flex items-end gap-1 h-12">
                  {data.history.map((h, i: number) => {
                    const maxProfit = Math.max(
                      ...data.history.map((x) => Math.abs(x.profit)),
                      1,
                    );
                    const heightPct = (Math.abs(h.profit) / maxProfit) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 group relative"
                        title={`${h.label}: ${h.profit}€ (${h.count} prodaj)`}
                      >
                        <div
                          className={cn(
                            'w-full rounded-sm transition-all',
                            h.profit >= 0 ? 'bg-primary/60' : 'bg-red-500/60',
                          )}
                          style={{ height: `${Math.max(4, heightPct)}%` }}
                        />
                        <div className="text-[8px] text-muted-foreground text-center mt-0.5 truncate">
                          {h.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
