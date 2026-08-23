'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Play, Pencil, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Clock, Zap, AlertCircle, PauseCircle, Bell, Copy, Square, Tag, Sparkles, Check, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PROMPT_CATEGORIES, getPromptsByCategory } from '@/lib/ai-prompts';
import type { Source, Monitor } from './monitors/types';
import { SOURCE_LABELS, SOURCE_PRESETS, formatTimeAgo } from './monitors/utils';
import { Sparkline } from './monitors/sparkline';
import { TemplateModal } from './monitors/template-modal';
import { MonitorFormDialog } from './monitors/monitor-form-dialog';
import { PromptLibraryModal } from './monitors/prompt-library-modal';

// v3.4: Mini SVG sparkline component
// Sparkline — v9.03: imported from ./monitors/sparkline
export function MonitorsView() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  // v4.6: Templates modal
  const [showTemplates, setShowTemplates] = useState(false);
  // v3.4: Sparkline data
  const [sparklines, setSparklines] = useState<Record<string, { sparkline: number[]; totalNew: number; totalAlerts: number; successRate: number }>>({});
  // v4.4: Tag filter
  const [activeTag, setActiveTag] = useState<string>('all');

  // v4.4: Collect all unique tags from monitors
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of monitors) {
      if (m.tags) {
        for (const t of m.tags.split(',').map(s => s.trim()).filter(Boolean)) {
          set.add(t);
        }
      }
    }
    return Array.from(set).sort();
  }, [monitors]);

  // v4.4: Filtered monitors by active tag
  const filteredMonitors = useMemo(() => {
    if (activeTag === 'all') return monitors;
    return monitors.filter(m => {
      if (!m.tags) return false;
      return m.tags.split(',').map(s => s.trim()).includes(activeTag);
    });
  }, [monitors, activeTag]);

  const load = useCallback(async () => {
    try {
      const [res, sparkRes] = await Promise.all([
        fetch('/api/monitors'),
        fetch('/api/monitors/sparkline'),
      ]);
      if (res.ok) setMonitors(await res.json());
      if (sparkRes.ok) {
        const sparkData = await sparkRes.json();
        const map: Record<string, any> = {};
        for (const s of sparkData.sparklines || []) {
          map[s.id] = s;
        }
        setSparklines(map);
      }
    } catch {
      toast.error('Ne morem naložiti monitorjev');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runMonitor = async (id: string) => {
    setRunningIds((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/monitors/${id}`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result.status === 'error') {
        toast.error(`Napaka: ${result.error?.slice(0, 80) ?? 'neznana'}`);
      } else if (result.status === 'empty') {
        toast.info('Ni najdenih oglasov (morda blokada ali narobe URL)');
      } else {
        toast.success(`OK: ${result.newListings} novih, ${result.alertsSent} alertov`);
      }
      await load();
    } catch {
      toast.error('Napaka pri poganjanju');
    } finally {
      setRunningIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const toggleActive = async (m: Monitor) => {
    try {
      // When reactivating, isActive: true triggers reset of consecutiveErrors and autoPausedAt in API
      await fetch(`/api/monitors/${m.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const deleteMonitor = async (m: Monitor) => {
    if (!confirm(`Izbrišem monitor "${m.name}"? Vsi pripadajoči oglasi in alerti bodo izbrisani.`)) return;
    try {
      await fetch(`/api/monitors/${m.id}`, { method: 'DELETE' });
      toast.success('Monitor izbrisan');
      await load();
    } catch {
      toast.error('Napaka pri brisanju');
    }
  };

  // v3.2: Clone monitor
  const cloneMonitor = async (m: Monitor) => {
    try {
      const res = await fetch(`/api/monitors/${m.id}/clone`, { method: 'POST' });
      if (res.ok) {
        toast.success(`Monitor kloniran: "${m.name} (kopija)" — aktiviraj v seznamu`);
        await load();
      } else {
        toast.error('Napaka pri kloniranju');
      }
    } catch {
      toast.error('Napaka');
    }
  };

  // v3.2: Batch run selected monitors
  const batchRun = async () => {
    if (selectedIds.size === 0) return;
    setBatchRunning(true);
    try {
      const res = await fetch('/api/monitors/batch-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.ok) {
        const ok = data.results.filter((r: any) => r.status === 'ok').length;
        const err = data.results.filter((r: any) => r.status === 'error').length;
        toast.success(`Pognano ${ok} monitorjev${err > 0 ? `, ${err} napak` : ''}`);
        setSelectedIds(new Set());
        await load();
      }
    } catch {
      toast.error('Napaka pri batch poganjanju');
    } finally {
      setBatchRunning(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Monitorji
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Konfigurirana iskanja na slovenskih trgih.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* v3.7: Pause all / Resume all */}
          {monitors.some(m => m.isActive) && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const activeIds = monitors.filter(m => m.isActive).map(m => m.id);
                if (activeIds.length === 0) return;
                try {
                  await fetch('/api/monitors/batch-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: activeIds, active: false }),
                  });
                  toast.success(`${activeIds.length} monitorjev pavziranih`);
                  await load();
                } catch { toast.error('Napaka'); }
              }}
              className="gap-2 text-xs h-8"
            >
              <PauseCircle className="w-3.5 h-3.5" /> Pavziraj vse
            </Button>
          )}
          {monitors.some(m => !m.isActive) && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const pausedIds = monitors.filter(m => !m.isActive).map(m => m.id);
                if (pausedIds.length === 0) return;
                try {
                  await fetch('/api/monitors/batch-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: pausedIds, active: true }),
                  });
                  toast.success(`${pausedIds.length} monitorjev aktiviranih`);
                  await load();
                } catch { toast.error('Napaka'); }
              }}
              className="gap-2 text-xs h-8 border-primary/40 text-primary hover:bg-primary/10"
            >
              <Play className="w-3.5 h-3.5" /> Aktiviraj vse
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" />
            Nov monitor
          </Button>
          {/* v4.6: Templates button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTemplates(true)}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Predloge
          </Button>
        </div>
      </div>

      {/* v3.2: Batch run toolbar */}
      {selectedIds.size > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-primary">{selectedIds.size} izbranih</span>
              <Button size="sm" onClick={batchRun} disabled={batchRunning} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 h-7">
                {batchRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Zaženi izbrane ({selectedIds.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="h-7 text-xs">
                Počisti
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-card animate-pulse rounded" />
          ))}
        </div>
      ) : monitors.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8">
            <EmptyState
              icon={<ListPlus className="w-12 h-12" />}
              title="Še ni monitorjev"
              description="Monitorji samodejno preverjajo Bolha, Vinted, Quoka in druge platforme za nove oglase. Ustvari svoj prvi monitor z iskalnim URL-jem."
              action={{
                label: 'Ustvari prvi monitor',
                onClick: () => { setEditing(null); setShowForm(true); },
                icon: <Plus className="w-3.5 h-3.5" />,
              }}
              helpLink="/?view=monitors"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* v4.4: Tag filter chips */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Tag className="w-3 h-3" /> Filter:
              </span>
              <button
                onClick={() => setActiveTag('all')}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                  activeTag === 'all'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                )}
              >
                Vsi ({monitors.length})
              </button>
              {allTags.map(tag => {
                const count = monitors.filter(m =>
                  m.tags && m.tags.split(',').map(s => s.trim()).includes(tag)
                ).length;
                return (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                      activeTag === tag
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    )}
                  >
                    {tag} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {filteredMonitors.length === 0 ? (
            <Card className="bg-card/50">
              <CardContent className="p-6 text-center text-xs text-muted-foreground">
                Noben monitor nima taga "{activeTag}".
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filteredMonitors.map((m) => (
                <Card key={m.id} className={cn('bg-card/50 hover:bg-card transition-colors', !m.isActive && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-sm truncate">{m.name}</h3>
                      <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[m.source]}</Badge>
                      {/* v4.4: tag badges */}
                      {m.tags && m.tags.split(',').map(s => s.trim()).filter(Boolean).map(tag => (
                        <button
                          key={tag}
                          onClick={() => setActiveTag(tag)}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                            activeTag === tag
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-primary/30 text-primary/70 hover:border-primary/60'
                          )}
                          title={`Filtriraj po: ${tag}`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary/70 hover:text-primary truncate block max-w-full"
                    >
                      <ExternalLink className="w-3 h-3 inline mr-1" />
                      {m.sourceUrl.length > 60 ? m.sourceUrl.slice(0, 60) + '...' : m.sourceUrl}
                    </a>
                  </div>
                  <Switch checked={m.isActive} onCheckedChange={() => toggleActive(m)} />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mb-3">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> vsakih {m.intervalMinutes}min
                  </span>
                  {m.runStartHour != null && m.runEndHour != null && (
                    <span className="text-primary">
                      • {String(m.runStartHour).padStart(2, '0')}:00–{String(m.runEndHour).padStart(2, '0')}:00
                    </span>
                  )}
                  {m.minPrice != null && <span>min {m.minPrice}€</span>}
                  {m.maxPrice != null && <span>max {m.maxPrice}€</span>}
                  {m.keywords && <span className="text-amber-400">+{m.keywords.split(',').length} kw</span>}
                  {m._count && (
                    <>
                      <span>•</span>
                      <span>{m._count.listings} oglasov</span>
                      <span>{m._count.alerts} alertov</span>
                    </>
                  )}
                </div>

                {/* v3.4: Sparkline + stats */}
                {sparklines[m.id] && (
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <Sparkline data={sparklines[m.id].sparkline} />
                    <span>{sparklines[m.id].totalNew} novih v 14d</span>
                    {sparklines[m.id].totalAlerts > 0 && (
                      <span className="text-primary">{sparklines[m.id].totalAlerts} alertov</span>
                    )}
                    <span className={cn(
                      'text-[10px]',
                      sparklines[m.id].successRate >= 0.9 ? 'text-primary' :
                      sparklines[m.id].successRate >= 0.7 ? 'text-amber-400' : 'text-destructive'
                    )}>
                      {Math.round(sparklines[m.id].successRate * 100)}% uspeh
                    </span>
                    {/* v4.3: Next run preview */}
                    {m.isActive && m.lastRunAt && (() => {
                      const lastRun = new Date(m.lastRunAt);
                      const nextRun = new Date(lastRun.getTime() + m.intervalMinutes * 60 * 1000);
                      const now = new Date();
                      const isOverdue = nextRun < now;
                      if (isOverdue) {
                        return <span className="text-amber-400 text-[10px]">⚡ zapadlo</span>;
                      }
                      const minsLeft = Math.round((nextRun.getTime() - now.getTime()) / 60000);
                      if (minsLeft < 60) {
                        return <span className="text-[10px]">⏱ čez {minsLeft}min</span>;
                      }
                      const hoursLeft = Math.floor(minsLeft / 60);
                      const remMins = minsLeft % 60;
                      return <span className="text-[10px]">⏱ čez {hoursLeft}h{remMins > 0 ? `${remMins}m` : ''}</span>;
                    })()}
                  </div>
                )}

                {/* v1.3: auto-paused warning */}
                {m.autoPausedAt && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-400 mb-2 p-2 bg-amber-400/5 border border-amber-400/20 rounded">
                    <PauseCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Auto-paused {formatTimeAgo(m.autoPausedAt)} po {m.consecutiveErrors} zaporednih napakah.
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleActive(m); }}
                        className="ml-1 underline hover:text-amber-300"
                      >
                        Reaktiviraj
                      </button>
                    </span>
                  </div>
                )}
                {!m.autoPausedAt && m.consecutiveErrors > 0 && m.autoPauseThreshold > 0 && (
                  <div className="text-[10px] text-amber-400/70 mb-2">
                    ⚠ {m.consecutiveErrors}/{m.autoPauseThreshold} zaporednih napak
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* v3.2: Batch select checkbox */}
                    <button
                      onClick={() => toggleSelect(m.id)}
                      className={cn(
                        'w-4 h-4 rounded border shrink-0 transition-colors',
                        selectedIds.has(m.id) ? 'bg-primary border-primary' : 'border-border hover:border-primary'
                      )}
                    >
                      {selectedIds.has(m.id) && <CheckCircle2 className="w-3 h-3 text-primary-foreground mx-auto" />}
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                      {m.lastStatus === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                      {m.lastStatus === 'error' && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                      {m.lastStatus === 'empty' && <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                      {m.lastStatus === null && <span className="text-muted-foreground text-[11px]">še ni pognan</span>}
                      {m.lastRunAt && (
                        <span className="text-muted-foreground text-[11px]">
                          {formatTimeAgo(m.lastRunAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runMonitor(m.id)}
                      disabled={runningIds.has(m.id)}
                      className="h-7 px-2 gap-1 text-xs"
                    >
                      {runningIds.has(m.id) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Poženi
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cloneMonitor(m)}
                      className="h-7 w-7 p-0"
                      title="Kloniraj monitor"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditing(m); setShowForm(true); }}
                      className="h-7 px-2"
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMonitor(m)}
                      className="h-7 px-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                {m.lastError && (
                  <div className="text-xs text-destructive mt-2">
                    <details className="cursor-pointer">
                      <summary className="truncate select-none hover:text-destructive/80">
                        ⚠ {m.lastError.slice(0, 80)}{m.lastError.length > 80 ? '...' : ''}
                      </summary>
                      <div className="mt-1 p-2 bg-destructive/5 border border-destructive/20 rounded text-[11px] font-mono whitespace-pre-wrap break-all">
                        {m.lastError}
                      </div>
                    </details>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
            </div>
          )}
        </>
      )}

      <MonitorFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        editing={editing}
        onSaved={() => { setShowForm(false); load(); }}
      />

      {/* v4.6: Templates modal */}
      <TemplateModal
        open={showTemplates}
        onOpenChange={setShowTemplates}
        onCreated={() => { setShowTemplates(false); load(); }}
      />
    </div>
  );
}

// v4.6: Template modal — pick from pre-configured monitors
// TemplateModal — v9.03: imported from ./monitors/template-modal
// MonitorFormDialog — v9.03: imported from ./monitors/monitorform-dialog
// PromptLibraryModal — v9.03: imported from ./monitors/promptlibrary-modal
// formatTimeAgo — v9.03: imported from ./monitors/formattimeago
