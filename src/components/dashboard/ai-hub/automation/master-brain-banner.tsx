/**
 * MasterBrainBanner — v8.22 (gold/amber) — synthesizes 7 domains.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part
 * of v8.94.6-split. The APEX of the Brain hierarchy — sits ON TOP of all 7
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
 * v8.94.9-split-master: split into container + presentational sub-components.
 *   - Container (this file) owns all state (data, loading, error,
 *     expandedRank, draftIds, patchingRank, patchedRanks), all callbacks
 *     (fetchMaster, patchDraft), and the overallTrustScore useMemo. Renders
 *     the outer wrapper + header + loading/error states + oneLineSummary +
 *     overallHealth row + refresh button inline; delegates the larger
 *     presentational blocks to ./master-brain/ sub-components.
 *   - Presentational sub-components (./master-brain/): ActionExplanationPanel
 *     (v8.26 expanded reasoning grid), TopActionRow (one TOP-5 card with
 *     ✅/❌ + ℹ️ Zakaj? toggle), TopActionsList (header + map),
 *     StrategyProjections (30d/90d/12m pills), ConflictsList (conflict cards),
 *     BottlenecksStrengths (⚠️ Ozka grla + 💪 Moč row). Pure render — props
 *     in, JSX out, no state, no fetches, no side effects.
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
  Crown,
  Info,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  gradeColor,
  riskLevelColor,
  trustScoreColor,
} from '../utils';
import type { MasterBrainResult } from './types';
import {
  TopActionsList,
  StrategyProjections,
  ConflictsList,
  BottlenecksStrengths,
} from './master-brain';

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
          <TopActionsList
            topActions={data.topActions}
            explanations={data.explanations}
            expandedRank={expandedRank}
            onExpandedRankChange={setExpandedRank}
            draftIds={draftIds}
            patchingRank={patchingRank}
            patchedRanks={patchedRanks}
            onPatch={patchDraft}
          />

          {/* Strategy pills: 30d / 90d / 12m */}
          <StrategyProjections strategy={data.strategy} />

          {/* Conflicts (if any) */}
          <ConflictsList conflicts={data.conflicts} />

          {/* Bottlenecks / Strengths row */}
          <BottlenecksStrengths overallHealth={data.overallHealth} />

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
