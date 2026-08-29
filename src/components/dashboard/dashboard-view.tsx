'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, RefreshCw, Clock, Plus, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';
import type { ViewProps } from './dashboard/types';

interface FoundListing {
  id: string;
  title: string;
  price: string;
  url: string;
  location?: string;
  isNew: boolean;
  aiScore?: number;
  aiRisk?: number;
  aiVerdict?: string;
  aiReason?: string;
  dealScore?: number;
}

interface ScraperProgress {
  monitorId: string;
  monitorName: string;
  status: 'scraping' | 'dedup' | 'ai-evaluating' | 'sending-alerts' | 'done' | 'error';
  step: string;
  progress: number;
  listingsFound: number;
  newListings: number;
  alertsSent: number;
  aiEvaluated: number;
  aiTotal: number;
  startedAt: number;
  error?: string;
  foundListings: FoundListing[];
}

interface MonitorCard {
  id: string;
  name: string;
  source: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  newListings: number;
  totalListings: number;
  alertsSent: number;
  consecutiveErrors: number;
}

interface Stats {
  activeMonitors: number;
  totalMonitors: number;
  totalListings: number;
  newListings24h: number;
  unreadAlerts: number;
  prilikaAlerts: number;
  sumnjivoAlerts: number;
  today: {
    newListings: number;
    newAlerts: number;
    runs: number;
    successfulRuns: number;
  } | null;
  monitors: MonitorCard[];
  recentRuns: Array<{
    id: string;
    monitor: { name: string };
    status: string;
    newListings: number;
    listingsFound: number;
    alertsSent: number;
    durationMs: number;
    startedAt: string;
  }>;
}

function formatTimeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'pravkar';
  if (mins < 60) return `pred ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `pred ${hrs}h`;
  return `pred ${Math.floor(hrs / 24)}d`;
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function getStatusColor(status: string | null) {
  if (status === 'ok' || status === 'success') return 'bg-emerald-500';
  if (status === 'error') return 'bg-red-500';
  if (status === 'empty') return 'bg-amber-500';
  return 'bg-zinc-500';
}

function getSourceIcon(source: string) {
  const icons: Record<string, string> = {
    bolha: '🛒',
    nepremicnine: '🏠',
    avtonet: '🚗',
    'mobile-de': '🚙',
    autoscout24: '🏎️',
    vinted: '👗',
    quoka: '📋',
    salomon: '👟',
    'custom-rss': '📡',
  };
  return icons[source] || '🔍';
}

export function DashboardView({ onNavigate }: ViewProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScraperProgress[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setStats(data);
    } catch {
      toast.error('Ne morem naložiti statistik');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const connectSSE = useCallback(() => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch('/api/scraper-progress', { signal: abort.signal });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const event of events) {
            const dataLine = event.trim();
            if (!dataLine.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(dataLine.slice(6));
              setProgress(data);
            } catch {}
          }
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') setTimeout(connectSSE, 3000);
      }
    })();
  }, []);

  useEffect(() => {
    connectSSE();
    return () => abortRef.current?.abort();
  }, [connectSSE]);

  const runAll = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/run-all', { method: 'POST' });
      if (!res.ok) throw new Error('napaka');
      toast.success('Monitorji zagnani');
    } catch {
      toast.error('Napaka pri poganjanju');
    } finally {
      setRunning(false);
    }
  };

  if (loading || !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="bg-card/50">
              <CardContent className="p-4">
                <div className="h-14 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const successRate = stats.today && stats.today.runs > 0
    ? Math.round((stats.today.successfulRuns / stats.today.runs) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* ── Stats Row ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-all"
          onClick={() => { haptic.light(); onNavigate('listings'); }}
        >
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold font-mono text-primary">{stats.today?.newListings ?? stats.newListings24h}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Novi oglasi</div>
          </CardContent>
        </Card>
        <Card
          className="bg-card/50 hover:bg-card hover:border-amber-500/30 cursor-pointer transition-all"
          onClick={() => { haptic.light(); onNavigate('alerts'); }}
        >
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold font-mono text-amber-400">{stats.unreadAlerts}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Alerti</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3 text-center">
            <div className={cn(
              'text-2xl font-bold font-mono',
              successRate >= 90 ? 'text-emerald-400' :
              successRate >= 70 ? 'text-amber-400' : 'text-red-400'
            )}>
              {successRate}%
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Uspeh</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Live Scraping Progress ── */}
      {progress.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Spinner />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Potek</span>
            </div>
            <div className="space-y-2">
              {progress.map((p) => {
                const elapsed = Math.floor((Date.now() - p.startedAt) / 1000);
                return (
                  <div key={p.monitorId} className="bg-background/50 rounded p-2 border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate">{p.monitorName}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{elapsed}s</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(p.progress, 100)}%` }}
                      />
                    </div>
                    <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
                      <span>{p.listingsFound} oglasov</span>
                      {p.newListings > 0 && <span className="text-primary">+{p.newListings} novih</span>}
                      {p.alertsSent > 0 && <span className="text-amber-400">+{p.alertsSent} alertov</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Active Monitors ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Aktivni monitorji ({stats.monitors?.filter(m => m.isActive).length ?? 0})
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => { haptic.light(); onNavigate('monitors'); }}
          >
            Vsi <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
        <div className="space-y-2">
          {(stats.monitors?.filter(m => m.isActive) ?? []).slice(0, 5).map((monitor) => (
            <Card
              key={monitor.id}
              className="bg-card/50 hover:bg-card hover:border-primary/20 cursor-pointer transition-all group"
              onClick={() => { haptic.light(); onNavigate('monitors'); }}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-base shrink-0">{getSourceIcon(monitor.source)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{monitor.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {monitor.lastRunAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {formatTimeAgo(monitor.lastRunAt)}
                          </span>
                        )}
                        <span>·</span>
                        <span>{monitor.newListings}/{monitor.totalListings} novih</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={cn('w-2 h-2 rounded-full', getStatusColor(monitor.lastStatus))} />
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                {monitor.alertsSent > 0 && (
                  <Badge className="mt-2 bg-amber-400/20 text-amber-400 border-amber-400/40 text-[10px]">
                    +{monitor.alertsSent} alertov
                  </Badge>
                )}
                {monitor.consecutiveErrors >= 3 && (
                  <Badge className="mt-2 bg-red-500/20 text-red-400 border-red-500/40 text-[10px]">
                    ⚠ {monitor.consecutiveErrors} zaporednih napak
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
          {(stats.monitors?.filter(m => m.isActive).length ?? 0) === 0 && (
            <Card className="border-dashed border-primary/30 bg-primary/5">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-2">Še ni aktivnih monitorjev</p>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { haptic.light(); onNavigate('monitors'); }}
                >
                  <Plus className="w-3 h-3" /> Dodaj monitor
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Recent Runs ── */}
      {stats.recentRuns.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Zadnje izvedbe</h2>
          <div className="space-y-1">
            {stats.recentRuns.slice(0, 5).map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-background/50 border border-border text-xs"
              >
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  run.status === 'ok' || run.status === 'success' ? 'bg-emerald-500' :
                  run.status === 'error' ? 'bg-red-500' : 'bg-zinc-500'
                )} />
                <span className="truncate flex-1">{run.monitor.name}</span>
                <span className="text-muted-foreground">{run.newListings}/{run.listingsFound}</span>
                {run.alertsSent > 0 && (
                  <Badge className="bg-amber-400/20 text-amber-400 border-amber-400/40 text-[9px] px-1">
                    +{run.alertsSent}
                  </Badge>
                )}
                <span className="text-muted-foreground font-mono">{formatTimeAgo(run.startedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={runAll}
          disabled={running}
          className="gap-1.5 flex-1"
        >
          {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Poženi vse
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { haptic.light(); onNavigate('monitors'); }}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Dodaj
        </Button>
      </div>
    </div>
  );
}
