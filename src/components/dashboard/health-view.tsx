'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Heart, CheckCircle2, AlertCircle, AlertTriangle, XCircle, Server, Cpu, MessageSquare, Bell, Globe, Clock, Smartphone, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'disabled';
  message: string;
  latencyMs?: number;
  details?: Record<string, any>;
}

interface HealthData {
  overall: 'ok' | 'warn' | 'error';
  errorCount: number;
  warnCount: number;
  checks: HealthCheck[];
  generatedAt: string;
}

const STATUS_CONFIG = {
  ok: { color: 'text-primary', bg: 'bg-primary/5 border-primary/30', icon: CheckCircle2, label: 'OK' },
  warn: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/30', icon: AlertTriangle, label: 'OPOZORILO' },
  error: { color: 'text-destructive', bg: 'bg-destructive/5 border-destructive/30', icon: XCircle, label: 'NAPAKA' },
  disabled: { color: 'text-muted-foreground', bg: 'bg-muted/5 border-muted/30', icon: AlertCircle, label: 'IZKLOPLJENO' },
};

const CHECK_ICONS: Record<string, any> = {
  'Baza (SQLite)': Server,
  'AI (Ollama)': Cpu,
  'AI (OpenAI)': Cpu,
  'AI (Anthropic)': Cpu,
  'AI (OpenAI-kompatibilni)': Cpu,
  'Telegram': MessageSquare,
  'Discord': Bell,
  'Bolha.com': Globe,
  'Nepremicnine.net': Globe,
  'Cron / Monitorji': Clock,
  'Push notifications': Smartphone,
};

export function HealthView() {
  // v6.0: Scraper stats
  const [scraperStats, setScraperStats] = useState<any>(null);
  const [scraperLoading, setScraperLoading] = useState(false);

  const loadScraperStats = useCallback(async () => {
    setScraperLoading(true);
    try {
      const res = await fetch('/api/stats/scraper');
      if (res.ok) setScraperStats(await res.json());
    } catch { /* ignore */ }
    finally { setScraperLoading(false); }
  }, []);

  useEffect(() => { loadScraperStats(); }, [loadScraperStats]);
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
    } catch {
      toast.error('Ne morem naložiti health stanja');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // auto-refresh every minute
    return () => clearInterval(t);
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading || !data) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const overallConfig = STATUS_CONFIG[data.overall];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Heart className="w-5 h-5" />
            Zdravje sistema
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time status vseh komponent. Osvežuje se vsako minuto.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="gap-2">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Osveži
        </Button>
      </div>

      {/* Overall status banner */}
      <Card className={cn('border-2', overallConfig.bg)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(() => {
                const Icon = overallConfig.icon;
                return <Icon className={cn('w-8 h-8', overallConfig.color)} />;
              })()}
              <div>
                <div className="text-lg font-bold uppercase tracking-wider">
                  <span className={overallConfig.color}>
                    {data.overall === 'ok' && 'VSE V REDU'}
                    {data.overall === 'warn' && 'OPOZORILA'}
                    {data.overall === 'error' && 'NAPAKE'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data.errorCount} napak, {data.warnCount} opozoril, {data.checks.length - data.errorCount - data.warnCount} OK
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase">Zadnji check</div>
              <div className="text-xs font-mono text-muted-foreground">
                {new Date(data.generatedAt).toLocaleTimeString('sl-SI')}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual checks grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.checks.map((check, i) => {
          const config = STATUS_CONFIG[check.status];
          const Icon = CHECK_ICONS[check.name] || AlertCircle;
          const StatusIcon = config.icon;
          return (
            <Card key={i} className={cn('bg-card/50 border', config.bg)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={cn('w-4 h-4 shrink-0', config.color)} />
                    <span className="text-sm font-bold truncate">{check.name}</span>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] shrink-0', config.color)}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {config.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{check.message}</p>
                {check.latencyMs != null && (
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                    Latenca: {check.latencyMs}ms
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick info */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider">Kaj pomenijo statusi</CardTitle>
          <CardDescription>Vodič za interpretacijo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <span className="text-primary font-medium">OK</span> — komponenta deluje normalno. Latenca pod 100ms za bazo, pod 5s za AI.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-amber-400 font-medium">OPOZORILO</span> — deluje, ampak počasi ali z减压. Preveri v nastavitvah.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <span className="text-destructive font-medium">NAPAKA</span> — komponenta ne deluje. Sistem še vedno teče, ampak ta funkcija ne bo delovala.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <span className="text-muted-foreground font-medium">IZKLOPLJENO</span> — uporabnik je izklopil to funkcijo v nastavitvah.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* v6.0: Scraper Stats Dashboard */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Scraper statistike
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.0</Badge>
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={loadScraperStats} disabled={scraperLoading} className="h-6 text-xs gap-1">
              {scraperLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {scraperStats ? (
            <div className="space-y-3">
              {/* Time window stats */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { label: '24 ur', stats: scraperStats.stats24h },
                  { label: '7 dni', stats: scraperStats.stats7d },
                  { label: '30 dni', stats: scraperStats.stats30d },
                ].map(({ label, stats }) => stats && (
                  <div key={label} className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">{label}</div>
                    <div className="font-mono text-lg font-bold">{stats.total}</div>
                    <div className={cn('text-[10px] font-mono', stats.successRate >= 80 ? 'text-primary' : stats.successRate >= 50 ? 'text-amber-400' : 'text-red-500')}>
                      {stats.successRate}% uspeh
                    </div>
                    <div className="text-[9px] text-muted-foreground">{stats.avgDuration}ms povp</div>
                    <div className="text-[9px] text-primary">{stats.totalNew} novih</div>
                  </div>
                ))}
              </div>

              {/* Per-source breakdown */}
              {scraperStats.bySource?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Po viru</div>
                  <div className="space-y-1">
                    {scraperStats.bySource.map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-1 bg-background/30 rounded text-[11px]">
                        <span className="font-bold w-20 uppercase">{s.source}</span>
                        <span className="text-muted-foreground">{s.total} runov</span>
                        <span className={cn('font-mono', s.successRate >= 80 ? 'text-primary' : s.successRate >= 50 ? 'text-amber-400' : 'text-red-500')}>
                          {s.successRate}%
                        </span>
                        <span className="text-muted-foreground">{s.newListings} novih</span>
                        <span className="text-muted-foreground">{s.avgDuration}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hourly activity (24h) */}
              {scraperStats.byHour && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Aktivnost po urah (24h)</div>
                  <div className="flex items-end gap-0.5 h-12">
                    {scraperStats.byHour.map((h: any, i: number) => {
                      const maxTotal = Math.max(...scraperStats.byHour.map((x: any) => x.total), 1);
                      const heightPct = (h.total / maxTotal) * 100;
                      return (
                        <div key={i} className="flex-1 group relative" title={`${h.hour}:00 — ${h.total} runov, ${h.newListings} novih`}>
                          <div
                            className={cn('w-full rounded-sm', h.ok === h.total ? 'bg-primary/60' : h.ok > 0 ? 'bg-amber-400/60' : 'bg-red-500/60')}
                            style={{ height: `${Math.max(2, heightPct)}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
                    <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                  </div>
                </div>
              )}

              {/* Recent errors */}
              {scraperStats.recentErrors?.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer hover:text-foreground text-red-500">
                    ⚠️ Zadnje napake ({scraperStats.recentErrors.length})
                  </summary>
                  <div className="mt-1 space-y-0.5">
                    {scraperStats.recentErrors.map((e: any, i: number) => (
                      <div key={i} className="bg-red-500/5 border border-red-500/20 rounded p-1 text-[10px]">
                        <span className="font-bold">{e.monitorName}:</span> {e.error?.slice(0, 100)}
                        <span className="text-muted-foreground ml-1">({new Date(e.time).toLocaleString('sl-SI', { hour: '2-digit', minute: '2-digit' })})</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {scraperLoading ? 'Nalagam...' : 'Ni podatkov.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
