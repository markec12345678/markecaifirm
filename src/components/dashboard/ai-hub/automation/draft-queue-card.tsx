/**
 * DraftQueueCard — v8.29 (slate/blue-gray) — closed feedback loop.
 *
 * Extracted from the original `automation-cards.tsx` (4095 lines) as part of
 * v8.94.6-split. ACTION layer (Intelligence phase CULMINATION). Each Master
 * Brain TOP 5 action becomes a "draft" row in the queue. When the user
 * clicks ✅ Izvedel or ❌ Zavrnil (on the Master Brain banner), the draft
 * status changes AND recordActionFeedback (v8.28) is called → adaptive
 * weights re-evaluate. This card shows:
 *   - Stats row: total pending / approved / executed / rejected / expired counts
 *   - Filter bar: status dropdown + domain dropdown (filters the list below)
 *   - Draft list (last 30, max-h-96 overflow-y-auto):
 *     per-row: rank + domain badge + signal + action + confidence pill +
 *     ✅/❌ inline buttons (which PATCH /api/ai/brain/drafts/[id])
 *   - Osveži button + Počisti expired button (calls /api/cron/cleanup-drafts)
 *
 * Slate/blue-gray gradient distinguishes from:
 *   - Adaptive Weights (orange) — the WEIGHTS / CONFIG side of the feedback loop
 *   - Risk Profile (violet) — user's stated preferences
 *   - This card (slate) — the DECISION LEDGER (history of past decisions)
 *
 * v8.95.0-split-draft: split into container + presentational sub-components.
 *   - Container (this file) owns all state (data, loading, error,
 *     statusFilter, domainFilter, patchingId), all callbacks (fetchDrafts,
 *     patchDraftInline, triggerCleanup). Renders the outer wrapper + header +
 *     subtitle + loading/error states + action buttons row inline; delegates
 *     the larger presentational blocks to ./draft-queue/ sub-components.
 *   - Presentational sub-components (./draft-queue/): StatsSummary (5 status
 *     pills + execution-rate pill), FilterBar (Status + Domain dropdowns),
 *     DraftRowItem (single draft row with ✅/❌ buttons), DraftList (empty
 *     state + map of DraftRowItem), DomainRates (per-domain execution rate
 *     bars). Pure render — props in, JSX out, no state, no fetches, no side
 *     effects.
 *
 * Module-local types (DraftRow, DraftQueueResponse) were moved to
 * ./draft-queue/types as part of v8.95.0-split-draft — they are only used by
 * DraftQueueCard + its sub-components. Cross-module shared types
 * (DomainName, DraftStatus) are imported from ../types. Color helpers
 * (confidenceColor, draftStatusColor, draftStatusLabel, rateColor) stay in
 * ../utils — used by the sub-components. DOMAIN_DISPLAY + DOMAIN_LABELS stay
 * in ./types — they are shared with AdaptiveWeightsCard + AutoPilotCard.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ClipboardList,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { DomainName, DraftStatus } from '../types';
import {
  StatsSummary,
  FilterBar,
  DraftList,
  DomainRates,
} from './draft-queue';
import type { DraftQueueResponse } from './draft-queue';

// --- v8.29: Draft Queue card (slate/blue-gray-tinted, closed feedback loop) ---
//
// v8.29 NEW: 📋 Draft Queue — ACTION layer (Intelligence phase CULMINATION).
// Each Master Brain TOP 5 action becomes a "draft" row in the queue. When the
// user clicks ✅ Izvedel or ❌ Zavrnil (on the Master Brain banner), the draft
// status changes AND recordActionFeedback (v8.28) is called → adaptive weights
// re-evaluate. This card shows:
//   - Stats row: total pending / approved / executed / rejected / expired counts
//   - Filter bar: status dropdown + domain dropdown (filters the list below)
//   - Draft list (last 30, max-h-96 overflow-y-auto):
//       rank badge + domain icon + action text + status pill + ✅/❌ (if pending)
//       + timestamp (createdAt)
//   - Per-domain execution rates (7 rows, mini horizontal bars like Adaptive Weights)
//   - Osveži button + Počisti expired button (calls /api/cron/cleanup-drafts)
//
// Slate/blue-gray gradient distinguishes from:
//   - Adaptive Weights (orange) — the WEIGHTS / CONFIG side of the feedback loop
//   - Risk Profile (violet) — user's stated preferences
//   - This card (slate) — the DECISION LEDGER (history of past decisions)

export function DraftQueueCard() {
  const [data, setData] = useState<DraftQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filters (local UI state — passed to API on next fetch)
  const [statusFilter, setStatusFilter] = useState<DraftStatus | 'all'>('all');
  const [domainFilter, setDomainFilter] = useState<DomainName | 'all'>('all');
  // Per-draft patching state (for inline ✅/❌ buttons in the list)
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30', days: '30' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (domainFilter !== 'all') params.set('domain', domainFilter);
      const res = await fetch(`/api/ai/brain/drafts?${params.toString()}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DraftQueueResponse;
      if (!json?.ok) throw new Error('Draft Queue API ni vrnil rezultata');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, domainFilter]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // PATCH a draft from the inline ✅/❌ button in the list (pending drafts only)
  const patchDraftInline = useCallback(async (draftId: string, status: 'executed' | 'rejected') => {
    setPatchingId(draftId);
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
      const emoji = status === 'executed' ? '✅' : '❌';
      const slovenian = status === 'executed' ? 'izvedena' : 'zavrnjena';
      const feedbackNote = json.feedbackRecorded
        ? ` · sistem se uči (${json.feedbackResult?.adjusted ? `utež ${json.feedbackResult.oldWeight} → ${json.feedbackResult.newWeight}` : 'utež nespremenjena'})`
        : '';
      toast.success(`${emoji} Akcija označena kot ${slovenian}${feedbackNote}`);
      await fetchDrafts();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri posodobitvi drafta');
    } finally {
      setPatchingId(null);
    }
  }, [fetchDrafts]);

  // Trigger cleanup cron — deletes old (executed/rejected/expired, >90 days)
  const triggerCleanup = useCallback(async () => {
    try {
      const res = await fetch('/api/cron/cleanup-drafts', { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`🧹 Počiščeno: ${json.deleted ?? 0} starih draftov`);
      await fetchDrafts();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri cleanup');
    }
  }, [fetchDrafts]);

  return (
    <div className="rounded-xl border-2 border-slate-500/40 bg-gradient-to-br from-slate-500/15 via-slate-400/10 to-zinc-500/5 p-3 sm:p-4 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-5 h-5 text-slate-600 dark:text-slate-300 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight">
            📋 Draft Queue
          </span>
          <Badge variant="outline" className="text-[10px] border-slate-500/50 text-slate-700 dark:text-slate-300 shrink-0 font-bold">
            v8.29
          </Badge>
          <Badge variant="outline" className="text-[9px] border-slate-500/30 text-slate-700/80 dark:text-slate-300/80 shrink-0">
            ACTION · CLOSED LOOP
          </Badge>
        </div>
        <button
          onClick={fetchDrafts}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-2.5 h-2.5', loading && 'animate-spin')} />
          Osveži
        </button>
      </div>

      {/* Subtitle */}
      <p className="text-[11px] sm:text-xs text-slate-700/80 dark:text-slate-300/80 mb-2.5 leading-snug">
        Zgodovina odločitev za vsako TOP 5 Master Brain akcijo. Ko klikneš
        &quot;Izvedel&quot; ali &quot;Zavrnil&quot;, se odločitev shrani sem
        in avtomatsko pokliče <code className="px-1 bg-slate-500/10 rounded">recordActionFeedback</code> (v8.28) —
        adaptive weights se naučijo iz tvojega vedenja.
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-slate-500/10" />
          <Skeleton className="h-3 w-3/4 bg-slate-500/10" />
          <Skeleton className="h-16 w-full bg-slate-500/10" />
          <Skeleton className="h-16 w-full bg-slate-500/10" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchDrafts} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <div className="space-y-3">
          {/* Stats row — 5 color-coded pills */}
          <StatsSummary stats={data.stats} />

          {/* Filter bar */}
          <FilterBar
            statusFilter={statusFilter}
            domainFilter={domainFilter}
            onStatusFilterChange={setStatusFilter}
            onDomainFilterChange={setDomainFilter}
          />

          {/* Draft list — max-h-96 with custom scrollbar */}
          <DraftList
            drafts={data.drafts}
            patchingId={patchingId}
            onPatch={patchDraftInline}
          />

          {/* Per-domain execution rates — mini section */}
          <DomainRates
            domainStats={data.domainStats}
            domainFilter={domainFilter}
            onDomainFilterChange={setDomainFilter}
          />

          {/* Action buttons row */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-500/20">
            <span className="text-[9px] text-muted-foreground italic">
              GET /api/ai/brain/drafts?limit=30&amp;days=30 · PATCH /api/ai/brain/drafts/&#123;id&#125;
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={triggerCleanup}
              className="h-7 px-3 text-[10px] gap-1.5 border-slate-500/40 text-slate-700 dark:text-slate-300 hover:bg-slate-500/10"
            >
              <Trash2 className="w-3 h-3" />
              Počisti expired
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
