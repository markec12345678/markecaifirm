'use client';

// v5.3: AI Insights — AI odkriva trende in anomalije
// Prikaz na Dashboardu kot widget

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, AlertCircle, Target, Lightbulb, Info, Award, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Insight {
  type: 'trend' | 'anomaly' | 'opportunity' | 'warning' | 'info';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  data: any;
  actionable?: string;
}

export function AiInsightsWidget() {
  const [data, setData] = useState<{ insights: Insight[]; stats: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/insights?days=${days}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const typeConfig: Record<Insight['type'], { icon: typeof TrendingUp; color: string; label: string }> = {
    trend: { icon: TrendingUp, color: 'text-blue-400', label: 'Trend' },
    anomaly: { icon: AlertCircle, color: 'text-red-500', label: 'Anomalija' },
    opportunity: { icon: Target, color: 'text-primary', label: 'Priložnost' },
    warning: { icon: AlertTriangle, color: 'text-amber-400', label: 'Opozorilo' },
    info: { icon: Info, color: 'text-muted-foreground', label: 'Info' },
  };

  const severityConfig: Record<Insight['severity'], { bg: string; border: string; label: string }> = {
    high: { bg: 'bg-primary/5', border: 'border-primary/30', label: 'Visoka' },
    medium: { bg: 'bg-amber-400/5', border: 'border-amber-400/30', label: 'Srednja' },
    low: { bg: 'bg-muted/5', border: 'border-border', label: 'Nizka' },
  };

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            AI Insights
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.3</Badge>
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="bg-card border border-border rounded px-2 py-1 text-[11px]"
            >
              <option value={7}>7 dni</option>
              <option value={30}>30 dni</option>
              <option value={90}>90 dni</option>
            </select>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-7 text-xs gap-1">
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            AI analizira trende in anomalije...
          </div>
        ) : !data || data.insights.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Lightbulb className="w-6 h-6 mx-auto mb-2 opacity-30" />
            Ni AI insightov za prikaz. Potrebno je več podatkov (vsaj 5 oglasov v izbranem obdobju).
          </div>
        ) : (
          <div className="space-y-2">
            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-muted-foreground uppercase">Oglasi</div>
                <div className="font-mono font-bold">{data.stats.totalListings}</div>
              </div>
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-muted-foreground uppercase">Viri</div>
                <div className="font-mono font-bold">{data.stats.totalSources}</div>
              </div>
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-muted-foreground uppercase">Monitorji</div>
                <div className="font-mono font-bold">{data.stats.totalMonitors}</div>
              </div>
            </div>

            {/* Insights list */}
            {data.insights.slice(0, 6).map((insight, i) => {
              const typeCfg = typeConfig[insight.type];
              const sevCfg = severityConfig[insight.severity];
              const Icon = typeCfg.icon;
              return (
                <div
                  key={i}
                  className={cn(
                    'border rounded p-2 text-xs',
                    sevCfg.bg,
                    sevCfg.border
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', typeCfg.color)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="font-bold text-xs">{insight.title}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">
                          {typeCfg.label}
                        </Badge>
                        {insight.severity === 'high' && (
                          <Badge variant="outline" className="text-[9px] text-primary border-primary/40 shrink-0">
                            🔥
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        {insight.description}
                      </p>
                      {insight.actionable && (
                        <p className="text-primary text-[10px] mt-1 italic">
                          {insight.actionable}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {data.insights.length > 6 && (
              <div className="text-center text-[10px] text-muted-foreground pt-1">
                + {data.insights.length - 6} dodatnih insightov
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
