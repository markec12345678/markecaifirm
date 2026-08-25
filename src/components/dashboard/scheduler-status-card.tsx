'use client';

/**
 * v9.66: Scheduler Status Card — prikaz statusa internega schedulerja.
 *
 * Prikazuje:
 * - Ali scheduler teče (Running/Stopped)
 * - Interval (koliko minut med runs)
 * - Zadnji run (kdaj, status, število monitorjev)
 * - Statistike (total, successful, failed)
 * - Uptime (koliko časa teče)
 * - Manual trigger gumb ("Poženi zdaj")
 * - Config gumb (enable/disable + interval)
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Play, RefreshCw, Settings2, CheckCircle2, XCircle, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useHaptic } from '@/hooks/use-haptic';

interface SchedulerStatus {
  running: boolean;
  isExecuting: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | 'never';
  lastRunError: string | null;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  uptimeSeconds: number;
}

interface SchedulerConfig {
  enabled: boolean;
  intervalMin: number;
}

interface SchedulerData {
  ok: boolean;
  status: SchedulerStatus;
  config: SchedulerConfig;
  message?: string;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatRelativeTime(date: string | null): string {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return 'zdaj';
  if (diff < 3600000) return `pred ${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return `pred ${Math.floor(diff / 3600000)}h`;
  return `pred ${Math.floor(diff / 86400000)}d`;
}

export function SchedulerStatusCard() {
  const [data, setData] = useState<SchedulerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [intervalInput, setIntervalInput] = useState(30);
  const [enabledInput, setEnabledInput] = useState(true);
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler');
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setData(json);
          setIntervalInput(json.config.intervalMin);
          setEnabledInput(json.config.enabled);
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // refresh vsakih 10s
    return () => clearInterval(interval);
  }, [load]);

  const handleTrigger = async () => {
    haptic.medium();
    setTriggering(true);
    try {
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger' }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || 'Scheduler run uspešen');
        haptic.success();
        await load();
      } else {
        toast.error(json.error || 'Napaka pri trigger');
      }
    } catch {
      toast.error('Povezava ni uspela');
    } finally {
      setTriggering(false);
    }
  };

  const handleSaveConfig = async () => {
    haptic.light();
    try {
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          enabled: enabledInput,
          intervalMin: intervalInput,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || 'Nastavitve shranjene');
        setShowConfig(false);
        await load();
      } else {
        toast.error(json.error || 'Napaka');
      }
    } catch {
      toast.error('Povezava ni uspela');
    }
  };

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-24 bg-muted/30 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { status, config } = data;
  const isRunning = status.running;
  const successRate = status.totalRuns > 0
    ? Math.round((status.successfulRuns / status.totalRuns) * 100)
    : null;

  return (
    <Card className={cn(
      'bg-card/50',
      isRunning ? 'border-emerald-500/20' : 'border-amber-500/20'
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Clock className={cn('w-4 h-4', isRunning ? 'text-emerald-500' : 'text-amber-500')} />
          Interni Scheduler
          <Badge
            className={cn(
              'ml-auto text-[10px]',
              isRunning
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
            )}
          >
            {isRunning ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
                AKTIVEN
              </>
            ) : 'USTAVLJEN'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status info */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-background/30 border border-border">
            <div className="text-[9px] uppercase text-muted-foreground font-bold">Interval</div>
            <div className="text-base font-bold text-foreground">{config.intervalMin} min</div>
          </div>
          <div className="p-2 rounded bg-background/30 border border-border">
            <div className="text-[9px] uppercase text-muted-foreground font-bold">Uptime</div>
            <div className="text-base font-bold text-foreground">
              {status.startedAt ? formatUptime(status.uptimeSeconds) : '—'}
            </div>
          </div>
        </div>

        {/* Last run */}
        <div className="p-2 rounded bg-background/30 border border-border">
          <div className="text-[9px] uppercase text-muted-foreground font-bold mb-1">Zadnji run</div>
          {status.lastRunStatus === 'never' ? (
            <div className="text-xs text-muted-foreground italic">Še ni bil izveden</div>
          ) : (
            <div className="flex items-center gap-2">
              {status.lastRunStatus === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  {status.lastRunStatus === 'success' ? 'Uspešen' : 'Napaka'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(status.lastRunAt)}
                  {status.isExecuting && ' · trenutno izvaja...'}
                </div>
                {status.lastRunError && (
                  <div className="text-[9px] text-red-500 mt-0.5 truncate">
                    {status.lastRunError}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="p-1.5 rounded bg-background/30">
            <div className="text-base font-bold text-foreground">{status.totalRuns}</div>
            <div className="uppercase text-muted-foreground">Skupaj</div>
          </div>
          <div className="p-1.5 rounded bg-background/30">
            <div className="text-base font-bold text-emerald-500">{status.successfulRuns}</div>
            <div className="uppercase text-muted-foreground">Uspeh</div>
          </div>
          <div className="p-1.5 rounded bg-background/30">
            <div className="text-base font-bold text-red-500">{status.failedRuns}</div>
            <div className="uppercase text-muted-foreground">Napake</div>
          </div>
        </div>

        {/* Success rate bar */}
        {successRate !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Success rate</span>
              <span className="font-bold">{successRate}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  successRate >= 90 ? 'bg-emerald-500' : successRate >= 70 ? 'bg-amber-500' : 'bg-red-500'
                )}
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleTrigger}
            disabled={triggering || status.isExecuting}
            size="sm"
            className="flex-1 h-7 text-xs gap-1"
            aria-label="Ročno zaženi scheduler run"
          >
            {triggering || status.isExecuting ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Poženi zdaj
          </Button>
          <Button
            onClick={() => {
              haptic.light();
              setShowConfig(!showConfig);
            }}
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            aria-label="Pokaži/skrij nastavitve schedulerja"
          >
            <Settings2 className="w-3 h-3" />
            Nastavitve
          </Button>
        </div>

        {/* Config panel */}
        {showConfig && (
          <div className="p-3 rounded border border-border bg-background/30 space-y-2">
            <div className="text-[10px] uppercase text-muted-foreground font-bold">
              Nastavitve schedulerja
            </div>

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs">Omogočen</span>
              <Button
                onClick={() => {
                  haptic.light();
                  setEnabledInput(!enabledInput);
                }}
                variant={enabledInput ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-[10px] px-2"
              >
                {enabledInput ? 'ON' : 'OFF'}
              </Button>
            </div>

            {/* Interval input */}
            <div className="flex items-center justify-between">
              <span className="text-xs">Interval (min)</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={intervalInput}
                  onChange={(e) => setIntervalInput(Number(e.target.value))}
                  className="w-16 px-2 py-1 bg-background border border-border rounded text-xs text-right focus:outline-none focus:border-primary/50"
                />
                <span className="text-[10px] text-muted-foreground">min</span>
              </div>
            </div>

            <div className="text-[9px] text-muted-foreground/70">
              Min 5 min · Max 1440 min (24h) · Default 30 min
            </div>

            <Button
              onClick={handleSaveConfig}
              size="sm"
              className="w-full h-7 text-xs"
            >
              Shrani & restart
            </Button>
          </div>
        )}

        {/* Info hint */}
        <div className="text-[9px] text-muted-foreground/70 text-center pt-1 border-t border-border/50 flex items-center justify-center gap-1">
          <Activity className="w-2.5 h-2.5" />
          Samodejno se zažene ob startu aplikacije — brez zunanjega cron-a
        </div>
      </CardContent>
    </Card>
  );
}
