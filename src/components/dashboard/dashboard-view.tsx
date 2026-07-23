'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, Bell, AlertTriangle, Target, TrendingUp, Play, RefreshCw, Clock, Zap, LayoutGrid, BarChart3, Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Stats {
  totalMonitors: number;
  activeMonitors: number;
  totalListings: number;
  totalAlerts: number;
  unreadAlerts: number;
  prilikaAlerts: number;
  sumnjivoAlerts: number;
  bookmarkedListings: number;
  newListings24h: number;
  newAlerts24h: number;
  recentRuns: Array<{
    id: string;
    status: string;
    listingsFound: number;
    newListings: number;
    alertsSent: number;
    durationMs: number | null;
    error: string | null;
    startedAt: string;
    monitor: { name: string };
  }>;
}

interface ViewProps {
  onNavigate: (v: 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'analytics' | 'settings') => void;
}

export function DashboardView({ onNavigate }: ViewProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setStats(data);
    } catch (e) {
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

  const runAll = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/cron/run-all', { method: 'POST' });
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      toast.success(`Pognan ${data.ran} monitorjev. Preveri alerte.`);
      await load();
    } catch (e) {
      toast.error('Napaka pri poganjanju');
    } finally {
      setRunning(false);
    }
  };

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-card/50">
            <CardContent className="p-6">
              <div className="h-16 animate-pulse bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick action bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Pregled sistema
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Stanje monitorjev, zadnje aktivnosti in alerti.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Osveži
          </Button>
          <Button size="sm" onClick={runAll} disabled={running} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Poženi vse monitorje
          </Button>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Aktivni monitorji"
          value={stats.activeMonitors}
          total={stats.totalMonitors}
          color="primary"
          onClick={() => onNavigate('monitors')}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Oglasov v bazi"
          value={stats.totalListings}
          subtext={`${stats.newListings24h} novih v 24h`}
          color="primary"
        />
        <StatCard
          icon={<Bell className="w-4 h-4" />}
          label="Nebrani alerti"
          value={stats.unreadAlerts}
          total={stats.totalAlerts}
          subtext={`${stats.newAlerts24h} novih v 24h`}
          color="amber"
          onClick={() => onNavigate('alerts')}
        />
        <StatCard
          icon={<Target className="w-4 h-4" />}
          label="Priložnosti (PRILIKA)"
          value={stats.prilikaAlerts}
          subtext={`${stats.sumnjivoAlerts} sumljivih`}
          color="primary"
          onClick={() => onNavigate('alerts')}
        />
        <StatCard
          icon={<Bookmark className="w-4 h-4" />}
          label="Priljubljeni"
          value={stats.bookmarkedListings}
          subtext="shranjeni oglasi"
          color="amber"
          onClick={() => onNavigate('listings')}
        />
      </div>

      {/* Quick links row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('listings')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-bold">Pregled vseh oglasov</p>
              <p className="text-[11px] text-muted-foreground">Validiraj AI — vidi tudi NEZANIMIVO</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('analytics')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-bold">Analitika sistema</p>
              <p className="text-[11px] text-muted-foreground">Trendi, performansa monitorjev, natančnost AI</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent runs */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Zadnje izvedbe
          </CardTitle>
          <CardDescription>Zadnjih 10 poganjanj monitorjev.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentRuns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Zap className="w-6 h-6 mx-auto mb-2 opacity-50" />
              Še ni bilo izvedb. Dodaj monitor in ga poženi.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {stats.recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-background/50 border border-border hover:border-primary/30 transition-colors text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <StatusDot status={run.status} />
                    <span className="font-medium truncate">{run.monitor.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span>{run.newListings}/{run.listingsFound} novih</span>
                    {run.alertsSent > 0 && (
                      <Badge className="bg-primary/20 text-primary border-primary/40 text-[10px]">
                        +{run.alertsSent} alertov
                      </Badge>
                    )}
                    <span className="font-mono">{formatDuration(run.durationMs)}</span>
                    <span>{formatTimeAgo(run.startedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick start hint */}
      {stats.totalMonitors === 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-bold text-sm mb-1">Začenjamo</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Začni tako, da dodaš prvi monitor (npr. iskanje na Bolhi ali Nepremičninah),
                  nato v <span className="text-primary">Nastavitve</span> vnesi AI provider
                  (Ollama na localhostu ali API ključ za OpenAI/Anthropic).
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onNavigate('monitors')} className="gap-2">
                    Dodaj monitor
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onNavigate('settings')} className="gap-2">
                    Konfiguriraj AI
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  total,
  subtext,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total?: number;
  subtext?: string;
  color: 'primary' | 'amber';
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        'bg-card/50 hover:bg-card transition-colors',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={cn(color === 'primary' ? 'text-primary' : 'text-amber-400')}>
            {icon}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'text-2xl font-bold',
            color === 'primary' ? 'text-primary terminal-glow' : 'text-amber-400 amber-glow'
          )}>
            {value}
          </span>
          {total != null && (
            <span className="text-sm text-muted-foreground">/ {total}</span>
          )}
        </div>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-primary' :
    status === 'error' ? 'bg-destructive' :
    'bg-muted-foreground';
  return <span className={cn('w-2 h-2 rounded-full shrink-0', color)} />;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
