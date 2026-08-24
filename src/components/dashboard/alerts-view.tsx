'use client';

// v9.09: AlertsView — modulariziran.
// - AlertCard ekstraktiran v ./alerts/alert-card.tsx (presentational)
// - AI Prioriteta sekcija ekstraktirana v ./alerts/ai-prioritized-alerts.tsx (own state + fetch)
// - Alert interface in formatTimeAgo premaknjena v ./alerts/{types,utils}.ts

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Bell, Check, Archive, Trash2, RefreshCw, Filter, Download, ThumbsUp, ThumbsDown, Square } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Alert } from './alerts/types';
import { AlertCard } from './alerts/alert-card';
import { AiPrioritizedAlerts } from './alerts/ai-prioritized-alerts';

export function AlertsView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<'all' | 'PRILIKA' | 'SUMNJIVO' | 'NEZANIMIVO'>('all');
  const [notifStats, setNotifStats] = useState<{ total: number; success: number; error: number; byChannel: Record<string, number> } | null>(null);
  // v1.3: multi-select for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [alertsRes, notifRes] = await Promise.all([
        fetch(`/api/alerts?archived=${showArchived ? 1 : 0}&limit=100`),
        fetch('/api/notifications?limit=100'),
      ]);
      if (alertsRes.ok) setAlerts(await alertsRes.json());
      if (notifRes.ok) {
        const notifData = await notifRes.json();
        setNotifStats(notifData.stats);
      }
    } catch {
      toast.error('Ne morem naložiti alertov');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (a: Alert) => {
    if (a.isRead) return;
    setAlerts((prev) => prev.map((x) => x.id === a.id ? { ...x, isRead: true } : x));
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, isRead: true }),
    });
  };

  const archive = async (a: Alert) => {
    setAlerts((prev) => prev.filter((x) => x.id !== a.id));
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, isArchived: !a.isArchived, userAction: 'archived' }),
    });
    toast.success(a.isArchived ? 'Povrnjeno iz arhiva' : 'Arhivirano');
  };

  const markUserAction = async (a: Alert, action: 'interested' | 'scam') => {
    setAlerts((prev) => prev.map((x) => x.id === a.id ? { ...x, userAction: action } : x));
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, userAction: action, isRead: true }),
    });
    toast.success(action === 'interested' ? '👍 Zabeleženo kot zanimiv' : '🚫 Označeno kot prevara');
  };

  const exportCsv = () => {
    window.open(`/api/alerts?archived=${showArchived ? '1' : '0'}&limit=1000&format=csv`, '_blank');
  };

  // v1.3: Bulk actions
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filtered.map(a => a.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkAction = async (action: 'archive' | 'read' | 'scam' | 'interested' | 'delete') => {
    if (selectedIds.size === 0) return;
    const actionLabels: Record<string, string> = {
      archive: 'arhivirano',
      read: 'označeno prebrano',
      scam: 'označeno kot prevara',
      interested: 'označeno kot zanimivo',
      delete: 'izbrisano',
    };
    try {
      const res = await fetch('/api/alerts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), action }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`${data.affected} alertov ${actionLabels[action]}`);
        setSelectedIds(new Set());
        await load();
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch {
      toast.error('Napaka pri bulk operaciji');
    }
  };

  // v3.3: Retry alert — re-send to all channels
  const retryAlert = async (a: Alert) => {
    try {
      const res = await fetch(`/api/alerts/${a.id}/retry`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const sent = Object.values(data.results).filter((r: any) => r === 'success').length;
        toast.success(`Alert ponovno poslan na ${sent} kanalov`);
        await load();
      } else {
        toast.error('Napaka pri ponovnem pošiljanju');
      }
    } catch {
      toast.error('Napaka');
    }
  };

  const remove = async (a: Alert) => {
    if (!confirm('Izbrišem ta alert?')) return;
    setAlerts((prev) => prev.filter((x) => x.id !== a.id));
    await fetch(`/api/alerts?id=${a.id}`, { method: 'DELETE' });
    toast.success('Izbrisano');
  };

  const markAllRead = async () => {
    const unread = alerts.filter(a => !a.isRead);
    if (unread.length === 0) return;
    setAlerts((prev) => prev.map((x) => ({ ...x, isRead: true })));
    await Promise.all(unread.map(a =>
      fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, isRead: true }),
      })
    ));
    toast.success(`Označenih ${unread.length} alertov kot prebrani`);
  };

  const filtered = alerts.filter(a => filter === 'all' || a.aiVerdict === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Alerti
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Oglasov, ki so zadeli kriterij (AI prilika + nizko tveganje).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            <span className="text-muted-foreground">Arhivirani</span>
          </div>
          <Button size="sm" variant="outline" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Osveži
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-2">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={markAllRead} className="gap-2">
            <Check className="w-3.5 h-3.5" /> Vse prebrano
          </Button>
        </div>
      </div>

      {/* v6.6: AI Prioriteta (button + conditional card together) */}
      <AiPrioritizedAlerts />

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(['all', 'PRILIKA', 'SUMNJIVO', 'NEZANIMIVO'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
            className={cn(
              'h-7 px-2 text-xs uppercase tracking-wider',
              filter === f && 'bg-primary text-primary-foreground'
            )}
          >
            {f === 'all' ? 'Vsi' : f}
          </Button>
        ))}
      </div>

      {/* v3.0: Notification delivery stats */}
      {notifStats && notifStats.total > 0 && (
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Dostava:</span>
              <span className="text-primary">✓ {notifStats.success} uspešnih</span>
              {notifStats.error > 0 && <span className="text-destructive">✗ {notifStats.error} napak</span>}
              <span className="text-muted-foreground">•</span>
              {Object.entries(notifStats.byChannel).map(([ch, count]) => (
                count > 0 ? (
                  <span key={ch} className="text-muted-foreground">
                    {ch === 'telegram' ? 'TG' : ch === 'discord' ? 'DC' : ch === 'slack' ? 'SL' : ch === 'email' ? '📧' : '🔔'}: {count}
                  </span>
                ) : null
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v1.3: Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-primary mr-2">
                {selectedIds.size} izbranih
              </span>
              <Button size="sm" variant="outline" onClick={() => bulkAction('read')} aria-label="Označi izbrane alerte kot prebrane" className="h-7 gap-1.5 text-xs">
                <Check className="w-3 h-3" /> Prebrano
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('interested')} aria-label="Označi izbrane alerte kot zanimive" className="h-7 gap-1.5 text-xs text-primary">
                <ThumbsUp className="w-3 h-3" /> Zanima me
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('archive')} aria-label="Arhiviraj izbrane alerte" className="h-7 gap-1.5 text-xs">
                <Archive className="w-3 h-3" /> Arhiviraj
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('scam')} aria-label="Označi izbrane alerte kot prevaro" className="h-7 gap-1.5 text-xs text-amber-400">
                <ThumbsDown className="w-3 h-3" /> Prevara
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkAction('delete')} aria-label="Izbriši izbrane alerte" className="h-7 gap-1.5 text-xs text-destructive">
                <Trash2 className="w-3 h-3" /> Izbriši
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection} aria-label="Prekliči izbiro vseh alertov" className="h-7 text-xs ml-auto">
                Prekliči izbiro
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-card animate-pulse rounded" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <Bell className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Ni alertov v tem pogledu.</p>
            <p className="text-xs text-muted-foreground mt-1">Poženi monitor, da začneš prejemati alerte.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* v1.3: Select all row */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <button
              onClick={selectedIds.size === filtered.length && filtered.length > 0 ? clearSelection : selectAll}
              className="flex items-center gap-2 text-muted-foreground hover:text-primary"
            >
              <Square className="w-3.5 h-3.5" />
              {selectedIds.size === filtered.length && filtered.length > 0 ? 'Odznači vse' : 'Izberi vse'}
            </button>
            <span className="text-muted-foreground">{filtered.length} alertov</span>
          </div>
          <div className="space-y-2">
            {filtered.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                selected={selectedIds.has(a.id)}
                onToggleSelect={() => toggleSelect(a.id)}
                onMarkRead={() => markRead(a)}
                onArchive={() => archive(a)}
                onDelete={() => remove(a)}
                onUserAction={(action) => markUserAction(a, action)}
                onRetry={() => retryAlert(a)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
