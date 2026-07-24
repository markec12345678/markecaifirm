'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Mail, MessageSquare, Bell, Send, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface NotificationItem {
  alertId: string;
  title: string;
  monitorName: string;
  createdAt: string;
  channel: string;
  success: boolean;
  error: string | null;
  url: string;
}

interface NotificationStats {
  total: number;
  success: number;
  error: number;
  byChannel: Record<string, number>;
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  telegram: <Send className="w-3.5 h-3.5" />,
  discord: <MessageSquare className="w-3.5 h-3.5" />,
  slack: <Bell className="w-3.5 h-3.5" />,
  email: <Mail className="w-3.5 h-3.5" />,
  push: <Bell className="w-3.5 h-3.5" />,
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  email: 'Email',
  push: 'Push',
};

export function NotificationHistoryView() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (channelFilter !== 'all') params.set('channel', channelFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('limit', '100');
      const res = await fetch(`/api/notifications?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.notifications || []);
      setStats(data.stats || null);
    } catch {
      toast.error('Ne morem naložiti obvestil');
    } finally {
      setLoading(false);
    }
  }, [channelFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Zgodovina obvestil
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Delivery log — kateri alert je bil poslan na kateri kanal in ali je uspel.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Osveži
        </Button>
      </div>

      {/* Stats overview */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50">
            <CardContent className="p-3 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Skupno</div>
              <div className="text-lg font-bold font-mono">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Uspešnih</div>
              <div className="text-lg font-bold font-mono text-primary">{stats.success}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Napak</div>
              <div className="text-lg font-bold font-mono text-destructive">{stats.error}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Uspešnost</div>
              <div className={cn(
                'text-lg font-bold font-mono',
                stats.total > 0 && (stats.success / stats.total) >= 0.9 ? 'text-primary' :
                stats.total > 0 && (stats.success / stats.total) >= 0.7 ? 'text-amber-400' : 'text-destructive'
              )}>
                {stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Kanal:</span>
        {['all', 'telegram', 'discord', 'slack', 'email', 'push'].map(ch => (
          <Button
            key={ch}
            size="sm"
            variant={channelFilter === ch ? 'default' : 'outline'}
            onClick={() => setChannelFilter(ch)}
            className={cn('h-6 px-2 text-[10px] uppercase', channelFilter === ch && 'bg-primary text-primary-foreground')}
          >
            {ch === 'all' ? 'Vsi' : CHANNEL_LABELS[ch] || ch}
          </Button>
        ))}
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-2">Status:</span>
        {['all', 'success', 'error'].map(st => (
          <Button
            key={st}
            size="sm"
            variant={statusFilter === st ? 'default' : 'outline'}
            onClick={() => setStatusFilter(st)}
            className={cn('h-6 px-2 text-[10px] uppercase', statusFilter === st && 'bg-primary text-primary-foreground')}
          >
            {st === 'all' ? 'Vsi' : st === 'success' ? '✓ Uspeh' : '✗ Napaka'}
          </Button>
        ))}
      </div>

      {/* Notification list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-card animate-pulse rounded" />)}
        </div>
      ) : items.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <Bell className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Ni obvestil s temi filtri.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {items.map((item, i) => (
            <Card key={i} className={cn('bg-card/50 hover:bg-card transition-colors', !item.success && 'border-destructive/20')}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <span className={cn('shrink-0 mt-0.5', item.success ? 'text-primary' : 'text-destructive')}>
                    {item.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-[9px] uppercase">
                        {CHANNEL_ICONS[item.channel]} {CHANNEL_LABELS[item.channel] || item.channel}
                      </Badge>
                      <span className="text-xs font-medium truncate">{item.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{item.monitorName}</span>
                      <span>•</span>
                      <span>{new Date(item.createdAt).toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {item.error && (
                        <>
                          <span>•</span>
                          <span className="text-destructive truncate" title={item.error}>{item.error.slice(0, 80)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary/50 hover:text-primary shrink-0">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
