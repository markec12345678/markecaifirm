'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Bell, Check, Archive, Trash2, ExternalLink, RefreshCw, Filter, Target, AlertTriangle, Download, ThumbsUp, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Alert {
  id: string;
  title: string;
  body: string;
  url: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  isRead: boolean;
  isArchived: boolean;
  userAction: string | null;
  sentTelegram: boolean;
  telegramError: string | null;
  createdAt: string;
  monitor: { name: string; source: string };
}

export function AlertsView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<'all' | 'PRILIKA' | 'SUMNJIVO' | 'NEZANIMIVO'>('all');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/alerts?archived=${showArchived ? 1 : 0}&limit=100`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAlerts(data);
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
        <div className="space-y-2">
          {filtered.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onMarkRead={() => markRead(a)}
              onArchive={() => archive(a)}
              onDelete={() => remove(a)}
              onUserAction={(action) => markUserAction(a, action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onMarkRead,
  onArchive,
  onDelete,
  onUserAction,
}: {
  alert: Alert;
  onMarkRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onUserAction: (action: 'interested' | 'scam') => void;
}) {
  const verdictColor =
    alert.aiVerdict === 'PRILIKA' ? 'text-primary terminal-glow' :
    alert.aiVerdict === 'SUMNJIVO' ? 'text-amber-400 amber-glow' :
    'text-muted-foreground';
  const verdictIcon =
    alert.aiVerdict === 'PRILIKA' ? <Target className="w-3.5 h-3.5" /> :
    alert.aiVerdict === 'SUMNJIVO' ? <AlertTriangle className="w-3.5 h-3.5" /> :
    null;
  const userActionBadge =
    alert.userAction === 'interested' ? { text: '👍 Zanima me', cls: 'border-primary/40 text-primary' } :
    alert.userAction === 'scam' ? { text: '🚫 Prevara', cls: 'border-amber-400/40 text-amber-400' } :
    alert.userAction === 'archived' ? { text: '✅ Arhivirano', cls: 'border-muted text-muted-foreground' } :
    null;

  return (
    <Card
      className={cn(
        'bg-card/50 hover:bg-card transition-colors',
        !alert.isRead && 'border-primary/40 bg-primary/5'
      )}
      onClick={onMarkRead}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {verdictIcon && <span className={verdictColor}>{verdictIcon}</span>}
              {alert.aiVerdict && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] uppercase tracking-wider',
                    alert.aiVerdict === 'PRILIKA' && 'border-primary/40 text-primary',
                    alert.aiVerdict === 'SUMNJIVO' && 'border-amber-400/40 text-amber-400',
                    alert.aiVerdict === 'NEZANIMIVO' && 'border-muted text-muted-foreground'
                  )}
                >
                  {alert.aiVerdict}
                </Badge>
              )}
              {alert.aiScore != null && (
                <span className="text-[11px] text-primary">⭐ {alert.aiScore}/10</span>
              )}
              {alert.aiRisk != null && (
                <span className="text-[11px] text-amber-400">🛡 {alert.aiRisk}/10</span>
              )}
              <span className="text-[11px] text-muted-foreground">•</span>
              <span className="text-[11px] text-muted-foreground">{alert.monitor.name}</span>
              {userActionBadge && (
                <Badge variant="outline" className={cn('text-[10px]', userActionBadge.cls)}>
                  {userActionBadge.text}
                </Badge>
              )}
              {!alert.isRead && !userActionBadge && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot ml-auto" />
              )}
            </div>
            <h3 className="font-bold text-sm mb-1 truncate">{alert.title}</h3>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed line-clamp-6">
              {alert.body}
            </pre>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              <a
                href={alert.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-primary/70 hover:text-primary"
              >
                <ExternalLink className="w-3 h-3" /> Odpri oglas
              </a>
              <span>•</span>
              <span>{formatTimeAgo(alert.createdAt)}</span>
              {alert.sentTelegram && (
                <>
                  <span>•</span>
                  <span className="text-primary">Telegram ✓</span>
                </>
              )}
              {alert.telegramError && (
                <>
                  <span>•</span>
                  <span className="text-destructive">Telegram napaka</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            {!userActionBadge && (
              <>
                <Button size="sm" variant="ghost" onClick={() => onUserAction('interested')} className="h-7 w-7 p-0 text-primary hover:text-primary" title="Zanima me">
                  <ThumbsUp className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onUserAction('scam')} className="h-7 w-7 p-0 text-amber-400 hover:text-amber-400" title="Prevara">
                  <ThumbsDown className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onArchive} className="h-7 w-7 p-0" title="Arhiviraj">
              <Archive className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Izbriši">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `pred ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `pred ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `pred ${h}h`;
  return d.toLocaleDateString('sl-SI');
}
