/**
 * MasterBrainBanner — v8.22 (gold/amber) — synthesizes 7 domains.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. The APEX of the Brain hierarchy — sits ON TOP of all 7
 * Domain Brain sections inside BrainSynthesisCard. Master Brain synthesizes
 * 21+ actions from 7 domains into ONE final decision: TOP 5 ranked actions +
 * 30d/90d/12m strategy + conflict detection + overallHealth score +
 * oneLineSummary.
 *
 * v8.26: response includes `explanations` array (one per TOP action) with
 * reasoning + reasoningParts { trigger, signalScore, signalGrade,
 * whyRankedHere, profileImpact, conflictImpact, expectedOutcome } +
 * trustScore (0-100 per action). The banner renders an "ℹ️ Zakaj?" toggle per
 * action to expand the reasoning + reasoningParts grid + per-action
 * trustScore pill. An overall trustScore pill is also in the banner header.
 *
 * Module-local types (ActionExplanation, MasterBrainResult, DOMAIN_LABELS)
 * come from ./types. Color helpers come from ../utils. DomainName is reached
 * indirectly via ActionExplanation / MasterBrainResult — not imported directly.
 */

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Info,
  RefreshCw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  confidenceColor,
  conflictSeverityColor,
  gradeColor,
  riskLevelColor,
  signalGradeColor,
  trustScoreColor,
} from '../utils';
import { DOMAIN_LABELS } from './types';
import type { ActionExplanation, MasterBrainResult } from './types';

// --- Master Brain BANNER (v8.22, gold/amber gradient) --------------------
//
// This is the APEX of the Brain hierarchy — sits ON TOP of all 7 Domain Brain
// sections inside BrainSynthesisCard. Master Brain synthesizes 21+ actions
// from 7 domains into ONE final decision: TOP 5 ranked actions + 30d/90d/12m
// strategy + conflict detection + overallHealth score + oneLineSummary.
//
// v8.26 (NEW): response now ALSO includes `explanations` — an array of
// ActionExplanation (one per TOP action). Each contains:
//   - reasoning (1-3 Slovenian sentences — the WHY behind the recommendation)
//   - reasoningParts { trigger, signalScore, signalGrade, whyRankedHere,
//     profileImpact, conflictImpact, expectedOutcome }
//   - trustScore (0-100 per action)
// The Master Brain banner renders an "ℹ️ Zakaj?" toggle per action to expand
// the reasoning + reasoningParts grid + per-action trustScore pill. An overall
// trustScore pill is also added to the banner header.

export function MasterBrainBanner() {
  const [data, setData] = useState<MasterBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // v8.26: track which TOP action's "ℹ️ Zakaj?" panel is expanded.
  // null = none expanded; otherwise the action's rank (1-5).
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  // v8.29: Draft Queue integration — when Master Brain loads TOP 5, we POST
  // them to /api/ai/brain/drafts which auto-creates a draft per action
  // (idempotent per snapshotDate). The returned draft IDs power the ✅/❌
  // buttons — each click PATCHes the corresponding draft to executed/rejected
  // AND calls recordActionFeedback (v8.28) → adaptive weights learn.
  const [draftIds, setDraftIds] = useState<Record<number, string>>({});
  const [patchingRank, setPatchingRank] = useState<number | null>(null);
  // After a successful ✅/❌ click, records the final status so we can disable
  // both buttons and visually mark the row as decided.
  const [patchedRanks, setPatchedRanks] = useState<Record<number, 'executed' | 'rejected'>>({});

  const fetchMaster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/master', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MasterBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Master Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
      // v8.29: After Master Brain data loads, auto-create drafts for TOP 5.
      // POST body shape matches CreateDraftsInput.actions. The endpoint will
      // set snapshotDate=today (YYYY-MM-DD) by default and is idempotent —
      // multiple calls per day return the same drafts (no duplicates).
      // Errors here are non-fatal — Master Brain still renders.
      if (Array.isArray(json.topActions) && json.topActions.length > 0) {
        try {
          const actionsPayload = json.topActions.map((a) => ({
            rank: a.rank,
            domain: a.domain,
            signal: a.signal,
            action: a.action,
            expectedUpliftEUR: a.expectedUpliftEUR,
            confidence: a.confidence,
          }));
          const draftRes = await fetch('/api/ai/brain/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions: actionsPayload }),
          });
          if (draftRes.ok) {
            const draftJson = await draftRes.json();
            if (draftJson?.ok && Array.isArray(draftJson.drafts)) {
              const idMap: Record<number, string> = {};
              for (const d of draftJson.drafts) {
                if (typeof d.rank === 'number' && typeof d.id === 'string') {
                  idMap[d.rank] = d.id;
                }
              }
              setDraftIds(idMap);
              // Reset patched state — new TOP 5 means fresh pending decisions
              setPatchedRanks({});
            }
          }
        } catch {
          // Non-fatal: drafts just won't be trackable, banner still works.
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaster();
  }, [fetchMaster]);

  // v8.29: PATCH a draft's status (✅ Izvedel or ❌ Zavrnil). Calls the
  // /api/ai/brain/drafts/{id} endpoint which also calls recordActionFeedback
  // (v8.28) — closing the feedback loop.
  const patchDraft = useCallback(async (rank: number, status: 'executed' | 'rejected') => {
    const draftId = draftIds[rank];
    if (!draftId) {
      toast.error('Draft ID ni najden — osveži Master Brain');
      return;
    }
    setPatchingRank(rank);
    try {
      const res = await fetch(`/api/ai/brain/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      // Mark this rank as decided (disables both buttons, highlights result)
      setPatchedRanks((prev) => ({ ...prev, [rank]: status }));
      const emoji = status === 'executed' ? '✅' : '❌';
      const slovenian = status === 'executed' ? 'izvedena' : 'zavrnjena';
      const feedbackNote = json.feedbackRecorded
        ? ` · sistem se uči (${json.feedbackResult?.adjusted ? `utež ${json.feedbackResult.oldWeight} → ${json.feedbackResult.newWeight}` : 'utež nespremenjena'})`
        : '';
      toast.success(`${emoji} Akcija #${rank} označena kot ${slovenian}${feedbackNote}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri posodobitvi drafta');
    } finally {
      setPatchingRank(null);
    }
  }, [draftIds]);

  // v8.26: compute overall trustScore from the explanations array
  // (weighted by finalScore — same as the backend's overall trustScore).
  // Falls back to 0 if no explanations are present.
  const explanations = data?.explanations;
  const overallTrustScore = useMemo(() => {
    if (!explanations || explanations.length === 0) return null;
    let weightSum = 0;
    let weightedSum = 0;
    for (const e of explanations) {
      const w = e.finalScore > 0 ? e.finalScore : 1;
      weightedSum += e.trustScore * w;
      weightSum += w;
    }
    if (weightSum === 0) return null;
    return Math.round((weightedSum / weightSum) * 10) / 10;
  }, [explanations]);

  return (
    <div className="rounded-xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-yellow-500/10 to-orange-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            🧠✨ MASTER BRAIN
          </span>
          <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400 shrink-0 font-bold">
            v8.22
          </Badge>
          <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-700/80 dark:text-amber-400/80 shrink-0">
            FINAL · APEX
          </Badge>
          {/* v8.26: overall trustScore pill (emerald ≥70, amber ≥50, red <50) */}
          {overallTrustScore != null && (
            <Badge
              variant="outline"
              className={cn('text-[10px] font-bold px-2 py-0.5 shrink-0', trustScoreColor(overallTrustScore))}
              title="v8.26: Zaupanje v Master Brain priporočila (0-100)"
            >
              <Info className="w-2.5 h-2.5 inline mr-0.5" />
              Trust: {Math.round(overallTrustScore)}/100
            </Badge>
          )}
        </div>
        {data?.cachedAt && (
          <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted shrink-0">
            cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
          </Badge>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full bg-amber-500/10" />
          <Skeleton className="h-4 w-3/4 bg-amber-500/10" />
          <div className="grid grid-cols-5 gap-2 pt-1">
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
            <Skeleton className="h-8 bg-amber-500/10" />
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchMaster} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Big oneLineSummary (centered, prominent) */}
          <p className="text-sm sm:text-base font-bold leading-snug text-center px-1">
            {data.oneLineSummary}
          </p>

          {/* Overall health row: grade pill + score + riskLevel pill */}
          <div className="flex items-center justify-center flex-wrap gap-2">
            <Badge variant="outline" className={cn('text-xs font-bold px-3 py-1', gradeColor(data.overallHealth.grade))}>
              Zdravje: {data.overallHealth.grade} · {Math.round(data.overallHealth.score)}/100
            </Badge>
            <Badge variant="outline" className={cn('text-[10px] px-2 py-0.5', riskLevelColor(data.overallHealth.riskLevel))}>
              Risk: {data.overallHealth.riskLevel}
            </Badge>
          </div>

          {/* TOP 5 AKCIJ ZA DANES (v8.26: each with an ℹ️ Zakaj? toggle) */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold flex items-center justify-between">
              <span>🎯 TOP 5 AKCIJ ZA DANES</span>
              {data.explanations && data.explanations.length > 0 && (
                <span className="text-[9px] normal-case font-normal text-muted-foreground italic">
                  ℹ️ klikni &quot;Zakaj?&quot; za razlago
                </span>
              )}
            </div>
            {data.topActions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">Ni akcij</p>
            ) : (
              data.topActions.map((a) => {
                const dm = DOMAIN_LABELS[a.domain] ?? { icon: '•', label: a.domain, color: 'text-foreground' };
                // v8.26: find the matching explanation (if any)
                const explanation = data.explanations?.find(
                  (e) => e.rank === a.rank && e.domain === a.domain && e.signal === a.signal,
                );
                const isExpanded = expandedRank === a.rank;
                return (
                  <div
                    key={a.rank}
                    className={cn(
                      'rounded bg-background/40 transition-colors',
                      isExpanded ? 'ring-1 ring-amber-500/30 bg-amber-500/5' : '',
                    )}
                  >
                    <div className="flex items-start gap-2 text-[11px] sm:text-xs leading-snug p-1.5">
                      <span className="font-bold text-amber-700 dark:text-amber-400 shrink-0 w-4 text-center">
                        {a.rank}.
                      </span>
                      <span className="shrink-0" title={dm.label}>
                        {dm.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{a.action}</span>
                        <span className="text-muted-foreground"> · +{Math.round(a.expectedUpliftEUR)}€/mo</span>
                      </span>
                      <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                        {a.confidence}
                      </span>
                      {/* v8.29: ✅ Izvedel / ❌ Zavrnil buttons — close the feedback loop.
                          When clicked, PATCHes the draft for this action to status='executed'
                          or 'rejected', AND calls recordActionFeedback (v8.28) → adaptive
                          weights re-evaluate every 10 actions per domain → better ranking. */}
                      {draftIds[a.rank] && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => patchDraft(a.rank, 'executed')}
                            disabled={patchingRank === a.rank || patchedRanks[a.rank] != null}
                            className={cn(
                              'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors',
                              patchedRanks[a.rank] === 'executed'
                                ? 'bg-emerald-500/30 border-emerald-500/60 text-emerald-700 dark:text-emerald-300 cursor-default'
                                : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 disabled:opacity-40',
                            )}
                            aria-label={`Označi akcijo ${a.rank} kot izvedel`}
                            title="v8.29: Označi kot izvedel — sistem se bo naučil (recordActionFeedback)"
                          >
                            <Check className="w-2.5 h-2.5" />
                            Izvedel
                          </button>
                          <button
                            onClick={() => patchDraft(a.rank, 'rejected')}
                            disabled={patchingRank === a.rank || patchedRanks[a.rank] != null}
                            className={cn(
                              'text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors',
                              patchedRanks[a.rank] === 'rejected'
                                ? 'bg-red-500/30 border-red-500/60 text-red-700 dark:text-red-300 cursor-default'
                                : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/25 text-red-700 dark:text-red-400 disabled:opacity-40',
                            )}
                            aria-label={`Označi akcijo ${a.rank} kot zavrnjeno`}
                            title="v8.29: Označi kot zavrnjeno — sistem se bo naučil (recordActionFeedback)"
                          >
                            <X className="w-2.5 h-2.5" />
                            Zavrnil
                          </button>
                        </div>
                      )}
                      {/* v8.26: ℹ️ Zakaj? toggle button — only render if an explanation exists */}
                      {explanation && (
                        <button
                          onClick={() => setExpandedRank(isExpanded ? null : a.rank)}
                          className="text-[9px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0 transition-colors"
                          aria-expanded={isExpanded}
                          aria-label={`Razširi razlago za akcijo ${a.rank}`}
                          title="v8.26: Razširi za razlago (Zakaj Master Brain priporoča to akcijo?)"
                        >
                          <Info className="w-2.5 h-2.5" />
                          Zakaj?
                          {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                        </button>
                      )}
                    </div>
                    {/* v8.26: Expanded explanation panel — reasoning + reasoningParts grid + trustScore pill */}
                    {explanation && isExpanded && (
                      <div className="mx-1.5 mb-1.5 p-2 rounded border border-amber-500/20 bg-amber-500/5 space-y-2">
                        {/* Reasoning — the primary WHY string (prominent) */}
                        <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200 font-medium">
                          <span className="text-[9px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold mr-1">
                            💡 Razlaga:
                          </span>
                          {explanation.reasoning}
                        </p>

                        {/* reasoningParts grid: Signal + Rank + Profile + Conflict + Expected */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
                          {/* Signal */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Signal
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <span className="font-mono text-amber-700 dark:text-amber-400 font-medium">
                                {explanation.signal}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn('text-[8px] px-1 py-0 h-3.5', signalGradeColor(explanation.reasoningParts.signalGrade))}
                              >
                                {explanation.reasoningParts.signalGrade}
                              </Badge>
                              <span className="text-muted-foreground text-[9px]">
                                {Math.round(explanation.reasoningParts.signalScore)}/100
                              </span>
                            </div>
                          </div>

                          {/* Rank reason */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Zakaj na tem mestu
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
                              {explanation.reasoningParts.whyRankedHere}
                            </div>
                          </div>

                          {/* Profile impact */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Vpliv profila
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
                              {explanation.reasoningParts.profileImpact ?? '—'}
                            </div>
                          </div>

                          {/* Conflict impact */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Vpliv konfliktov
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-foreground/90">
                              {explanation.reasoningParts.conflictImpact ?? '—'}
                            </div>
                          </div>

                          {/* Expected outcome */}
                          <div className="rounded border border-amber-500/20 bg-background/50 p-1.5 sm:col-span-2">
                            <div className="text-[8px] uppercase text-muted-foreground font-semibold">
                              Pričakovan izid
                            </div>
                            <div className="mt-0.5 text-[9px] leading-snug text-emerald-700 dark:text-emerald-400 font-medium">
                              {explanation.reasoningParts.expectedOutcome}
                            </div>
                          </div>
                        </div>

                        {/* Per-action trustScore pill */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20">
                          <span className="text-[9px] uppercase text-muted-foreground font-semibold">
                            Trust score
                          </span>
                          <Badge
                            variant="outline"
                            className={cn('text-[10px] font-bold px-2 py-0.5', trustScoreColor(explanation.trustScore))}
                            title="v8.26: Zaupanje v to priporočilo (0-100). ≥70=zeleno, ≥50=rumeno, <50=rdeče."
                          >
                            {Math.round(explanation.trustScore)}/100
                          </Badge>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Strategy pills: 30d / 90d / 12m */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">30d</div>
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {Math.round(data.strategy.projection30d.profitEUR)}€
              </div>
              <div className="text-[9px] text-muted-foreground">
                risk {Math.round(data.strategy.projection30d.riskScore)}/100
              </div>
            </div>
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">90d</div>
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {Math.round(data.strategy.projection90d.profitEUR)}€
              </div>
              <div className="text-[9px] text-muted-foreground">
                risk {Math.round(data.strategy.projection90d.riskScore)}/100
              </div>
            </div>
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">12m</div>
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {Math.round(data.strategy.projection12m.profitEUR)}€
              </div>
              <div className="text-[9px] text-muted-foreground">
                risk {Math.round(data.strategy.projection12m.riskScore)}/100
              </div>
            </div>
          </div>

          {/* Conflicts (if any) */}
          {data.conflicts.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-amber-500/20">
              <div className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                KONFLIKTI ({data.conflicts.length})
              </div>
              {data.conflicts.map((c) => (
                <div
                  key={c.id}
                  className={cn('rounded border p-1.5 text-[10px] leading-snug', conflictSeverityColor(c.severity))}
                >
                  <div className="font-semibold flex items-center gap-1">
                    <span className="font-bold uppercase">{c.severity}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>
                      {DOMAIN_LABELS[c.domainA]?.icon ?? '•'} {c.domainA}
                    </span>
                    <span className="text-muted-foreground">vs</span>
                    <span>
                      {DOMAIN_LABELS[c.domainB]?.icon ?? '•'} {c.domainB}
                    </span>
                  </div>
                  <div className="mt-0.5">{c.description}</div>
                  <div className="mt-0.5 italic text-muted-foreground">→ {c.resolution}</div>
                </div>
              ))}
            </div>
          )}

          {/* Bottlenecks / Strengths row */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] pt-1 border-t border-amber-500/20">
            {data.overallHealth.bottlenecks.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">⚠️ Ozka grla:</span>
                {data.overallHealth.bottlenecks.map((d) => (
                  <span key={d} className={cn('font-bold', DOMAIN_LABELS[d]?.color ?? '')}>
                    {DOMAIN_LABELS[d]?.icon} {d}
                  </span>
                ))}
              </div>
            )}
            {data.overallHealth.strengths.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">💪 Moč:</span>
                {data.overallHealth.strengths.map((d) => (
                  <span key={d} className={cn('font-bold', DOMAIN_LABELS[d]?.color ?? '')}>
                    {DOMAIN_LABELS[d]?.icon} {d}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Refresh */}
          <div className="flex justify-end">
            <button
              onClick={fetchMaster}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži Master Brain
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
