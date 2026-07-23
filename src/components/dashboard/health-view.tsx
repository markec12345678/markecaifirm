'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Heart, CheckCircle2, AlertCircle, AlertTriangle, XCircle, Server, Cpu, MessageSquare, Bell, Globe, Clock, Smartphone } from 'lucide-react';
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
    </div>
  );
}
