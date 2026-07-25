'use client';

// v4.8: NotificationsCenterView — centralni pregled vseh notifikacij z re-send

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Send, CheckCircle2, XCircle, Clock, Bell, MessageSquare, Mail, Smartphone, Bell as Slack, ExternalLink, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface NotificationRecord {
  alertId: string;
  alertTitle: string;
  alertUrl: string;
  aiVerdict: string | null;
  monitorName: string | null;
  monitorSource: string | null;
  listingTitle: string | null;
  listingUrl: string | null;
  channel: 'telegram' | 'discord' | 'slack' | 'push' | 'email';
  status: 'sent' | 'failed' | 'pending';
  error: string | null;
  sentAt: string;
  createdAt: string;
}

interface Stats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  byChannel: Record<string, { sent: number; failed: number; pending: number }>;
}

export function NotificationsCenterView() {
  const [data, setData] = useState<{ notifications: NotificationRecord[]; stats: Stats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [resending, setResending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (channelFilter !== 'all') params.set('channel', channelFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/notifications/center?${params}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error('Ne morem naložiti notifikacij');
    } finally {
      setLoading(false);
    }
  }, [channelFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const resend = async (alertId: string, channel: string) => {
    const key = `${alertId}-${channel}`;
    setResending(s => new Set(s).add(key));
    try {
      const res = await fetch('/api/notifications/center', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, channels: [channel] }),
      });
      const data = await res.json();
      if (data.ok) {
        const result = data.results[channel];
        if (result?.ok) {
          toast.success(`✓ ${channel.toUpperCase()}: ponovno poslano`);
        } else {
          toast.error(`${channel.toUpperCase()}: ${result?.error ?? 'napaka'}`);
        }
        await load();
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch {
      toast.error('Napaka pri ponovnem pošiljanju');
    } finally {
      setResending(s => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  const resendAllFailed = async () => {
    if (!data) return;
    const failed = data.notifications.filter(n => n.status === 'failed');
    if (failed.length === 0) {
      toast.info('Ni failed notifikacij');
      return;
    }
    if (!confirm(`Ponovno pošljem ${failed.length} failed notifikacij?`)) return;
    toast.loading(`Ponovno pošiljam ${failed.length} notifikacij...`, { id: 'bulk' });
    let success = 0;
    let fail = 0;
    for (const n of failed) {
      try {
        const res = await fetch('/api/notifications/center', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alertId: n.alertId, channels: [n.channel] }),
        });
        const d = await res.json();
        if (d.ok && d.results[n.channel]?.ok) success++;
        else fail++;
      } catch {
        fail++;
      }
    }
    toast.success(`Končano: ${success} uspešnih, ${fail} spodletelih`, { id: 'bulk' });
    await load();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 bg-card animate-pulse rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const stats = data?.stats;
  const notifications = data?.notifications ?? [];

  const channelConfig: Record<string, { icon: typeof Bell; label: string; color: string }> = {
    telegram: { icon: Send, label: 'Telegram', color: 'text-blue-400' },
    discord: { icon: MessageSquare, label: 'Discord', color: 'text-purple-400' },
    slack: { icon: Slack, label: 'Slack', color: 'text-green-400' },
    push: { icon: Smartphone, label: 'Push', color: 'text-amber-400' },
    email: { icon: Mail, label: 'Email', color: 'text-red-400' },
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Center obvestil
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Centralni pregled dostave notifikacij. Ponovno pošlji neuspele.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stats && stats.failed > 0 && (
            <Button size="sm" variant="outline" onClick={resendAllFailed} className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10">
              <RefreshCw className="w-3.5 h-3.5" />
              Ponovno pošlji vse failed ({stats.failed})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Osveži
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Skupaj</div>
              <div className="text-2xl font-bold font-mono">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Poslano</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.sent}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Spodletelo</div>
              <div className="text-2xl font-bold font-mono text-red-500">{stats.failed}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Na čakanju</div>
              <div className="text-2xl font-bold font-mono text-amber-400">{stats.pending}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Channel breakdown */}
      {stats && (
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Po kanalih</h4>
            <div className="grid grid-cols-5 gap-2 text-xs">
              {Object.entries(stats.byChannel).map(([channel, counts]) => {
                const cfg = channelConfig[channel];
                const Icon = cfg?.icon || Bell;
                const total = counts.sent + counts.failed + counts.pending;
                return (
                  <div key={channel} className="bg-background/30 rounded p-2 text-center">
                    <Icon className={cn('w-4 h-4 mx-auto mb-1', cfg?.color)} />
                    <div className="text-[10px] uppercase tracking-wider">{cfg?.label || channel}</div>
                    <div className="text-xs font-mono mt-1">
                      <span className="text-primary">{counts.sent}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-red-500">{counts.failed}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-amber-400">{counts.pending}</span>
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">sent/fail/pend</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Kanal:</span>
        {['all', 'telegram', 'discord', 'slack', 'push', 'email'].map(c => (
          <button
            key={c}
            onClick={() => setChannelFilter(c)}
            className={cn(
              'px-2 py-0.5 rounded text-[11px] border transition-colors',
              channelFilter === c
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {c === 'all' ? 'Vsi' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-2">Status:</span>
        {['all', 'sent', 'failed', 'pending'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-2 py-0.5 rounded text-[11px] border transition-colors',
              statusFilter === s
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {s === 'all' ? 'Vsi' : s === 'sent' ? 'Poslano' : s === 'failed' ? 'Spodletelo' : 'Na čakanju'}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      {notifications.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <Bell className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm">Ni notifikacij za prikaz.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {notifications.map((n, i) => {
            const cfg = channelConfig[n.channel];
            const Icon = cfg?.icon || Bell;
            const key = `${n.alertId}-${n.channel}-${i}`;
            const resendingKey = `${n.alertId}-${n.channel}`;
            return (
              <div
                key={key}
                className="flex items-center gap-3 p-2 bg-card/50 hover:bg-card rounded text-xs"
              >
                {/* Status icon */}
                <div className="shrink-0">
                  {n.status === 'sent' && <CheckCircle2 className="w-4 h-4 text-primary" />}
                  {n.status === 'failed' && <XCircle className="w-4 h-4 text-red-500" />}
                  {n.status === 'pending' && <Clock className="w-4 h-4 text-amber-400" />}
                </div>

                {/* Channel icon */}
                <Icon className={cn('w-4 h-4 shrink-0', cfg?.color)} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {n.alertTitle}
                  </div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <span className="uppercase">{cfg?.label || n.channel}</span>
                    <span>•</span>
                    <span>{n.monitorName || 'neznan monitor'}</span>
                    <span>•</span>
                    <span>{new Date(n.sentAt).toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {n.error && (
                      <>
                        <span>•</span>
                        <span className="text-red-500 truncate" title={n.error}>{n.error}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={n.alertUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary p-1"
                    title="Odpri oglas"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px] gap-1"
                    disabled={resending.has(resendingKey)}
                    onClick={() => resend(n.alertId, n.channel)}
                  >
                    {resending.has(resendingKey) ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    Re-send
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
