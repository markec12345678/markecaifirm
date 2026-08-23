'use client';

// v8.97: Draft Queue Card extracted from ai-hub-view.tsx (v8.29, slate).
// DECISION LEDGER: closed feedback loop. Each Master Brain TOP 5 action becomes
// a draft row. Inline ✅/❌ PATCHes /api/ai/brain/drafts/{id} AND calls
// recordActionFeedback (v8.28) → adaptive weights re-evaluate.

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClipboardList, AlertCircle, RefreshCw, Filter, Clock,
  Check, X, Target, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { DraftQueueResponse, DraftStatus, DomainName } from './types';
import {
  confidenceColor, draftStatusColor, draftStatusLabel,
  DOMAIN_LABELS, DOMAIN_DISPLAY, rateColor,
} from './utils';

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
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('pending'))}>
              {data.stats.pending} čaka
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('approved'))}>
              {data.stats.approved} odobrenih
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('executed'))}>
              {data.stats.executed} izvedenih
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('rejected'))}>
              {data.stats.rejected} zavrnjenih
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', draftStatusColor('expired'))}>
              {data.stats.expired} poteklih
            </Badge>
            {data.stats.executed + data.stats.rejected > 0 && (
              <Badge variant="outline" className="text-[10px] border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300">
                execution rate: {Math.round(data.stats.executionRate * 100)}%
              </Badge>
            )}
          </div>

          {/* Filter bar */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-slate-500/20 bg-slate-500/5 p-1.5">
              <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1 flex items-center gap-1">
                <Filter className="w-2.5 h-2.5" /> Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as DraftStatus | 'all')}
                className="h-7 w-full text-xs bg-background/50 border border-slate-500/20 rounded px-1.5"
              >
                <option value="all">Vsi statusi</option>
                <option value="pending">⏳ Čaka</option>
                <option value="approved">👍 Odobreno</option>
                <option value="executed">✅ Izvedeno</option>
                <option value="rejected">❌ Zavrnjeno</option>
                <option value="expired">⌛ Poteklo</option>
              </select>
            </div>
            <div className="rounded border border-slate-500/20 bg-slate-500/5 p-1.5">
              <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1 flex items-center gap-1">
                <Filter className="w-2.5 h-2.5" /> Domena
              </label>
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value as DomainName | 'all')}
                className="h-7 w-full text-xs bg-background/50 border border-slate-500/20 rounded px-1.5"
              >
                <option value="all">Vse domene</option>
                {DOMAIN_DISPLAY.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.icon} {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Draft list — max-h-96 with custom scrollbar */}
          <div className="max-h-96 overflow-y-auto rounded border border-slate-500/20 bg-slate-500/[0.03]">
            {data.drafts.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground italic">
                Ni draftov za izbrane filtre. Klikni &quot;Osveži Master Brain&quot; zgoraj
                da se avtomatsko kreirajo novi.
              </div>
            ) : (
              <div className="divide-y divide-slate-500/10">
                {data.drafts.map((d) => {
                  const dm = DOMAIN_LABELS[d.domain] ?? { icon: '•', label: d.domain, color: 'text-foreground' };
                  const ts = (() => {
                    try {
                      const dt = new Date(d.createdAt);
                      const date = dt.toLocaleDateString('sl-SI');
                      const time = dt.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
                      return `${date} ${time}`;
                    } catch {
                      return '—';
                    }
                  })();
                  return (
                    <div
                      key={d.id}
                      className={cn(
                        'p-2 flex items-start gap-2 text-[10px] sm:text-[11px] leading-snug transition-colors',
                        d.status === 'executed' && 'bg-emerald-500/[0.04]',
                        d.status === 'rejected' && 'bg-red-500/[0.04]',
                      )}
                    >
                      <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0 w-4 text-center">
                        {d.rank}.
                      </span>
                      <span className="shrink-0" title={dm.label}>
                        {dm.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-medium truncate">{d.action}</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-2 h-2" />
                          {ts}
                          <span className="text-muted-foreground/60">·</span>
                          <span className="font-mono">{d.signal}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span className={cn('font-bold', confidenceColor(d.confidence))}>{d.confidence}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] h-4 px-1 shrink-0', draftStatusColor(d.status))}>
                        {draftStatusLabel(d.status)}
                      </Badge>
                      {/* Inline ✅/❌ buttons — only for pending drafts */}
                      {d.status === 'pending' && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => patchDraftInline(d.id, 'executed')}
                            disabled={patchingId === d.id}
                            aria-label="Označi kot izvedeno"
                            title="v8.29: Označi kot izvedeno — sistem se bo naučil"
                            className="text-[9px] px-1 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 disabled:opacity-40"
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() => patchDraftInline(d.id, 'rejected')}
                            disabled={patchingId === d.id}
                            aria-label="Označi kot zavrnjeno"
                            title="v8.29: Označi kot zavrnjeno — sistem se bo naučil"
                            className="text-[9px] px-1 py-0.5 rounded border bg-red-500/10 border-red-500/30 hover:bg-red-500/25 text-red-700 dark:text-red-400 disabled:opacity-40"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per-domain execution rates — mini section */}
          {data.domainStats.length > 0 && (
            <div className="rounded-lg border border-slate-500/20 bg-slate-500/[0.03] p-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-700/80 dark:text-slate-300/80 font-semibold flex items-center gap-1">
                <Target className="w-2.5 h-2.5" />
                Per-domain execution rate
                <span className="text-[8px] normal-case font-normal text-muted-foreground italic ml-auto">
                  klik na domeno za filter
                </span>
              </div>
              {data.domainStats.map((ds) => {
                const dm = DOMAIN_LABELS[ds.domain] ?? { icon: '•', label: ds.domain, color: 'text-foreground' };
                const rate = ds.executionRate;
                const total = ds.executed + ds.rejected;
                const isSelected = domainFilter === ds.domain;
                return (
                  <button
                    key={ds.domain}
                    onClick={() => setDomainFilter(isSelected ? 'all' : ds.domain)}
                    className={cn(
                      'w-full flex items-center gap-2 text-[10px] p-1 rounded transition-colors text-left',
                      isSelected ? 'bg-slate-500/15 ring-1 ring-slate-500/40' : 'hover:bg-slate-500/10',
                    )}
                    title={`Filter by ${dm.label} domain`}
                  >
                    <span className="shrink-0 w-3 text-center">{dm.icon}</span>
                    <span className="shrink-0 w-16 font-medium">{dm.label}</span>
                    <div className="flex-1 h-1.5 bg-background/60 rounded overflow-hidden">
                      <div
                        className={cn('h-full transition-all', rateColor(rate))}
                        style={{ width: `${Math.round(rate * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[9px] text-muted-foreground font-mono w-20 text-right">
                      {total > 0 ? `${Math.round(rate * 100)}% (${ds.executed}/${total})` : '—'}
                      {ds.pending > 0 && (
                        <span className="text-blue-600 dark:text-blue-400"> · {ds.pending}⏳</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

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
