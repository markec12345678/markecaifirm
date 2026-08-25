'use client';

/**
 * v9.60: Predictive Analytics Widget — proaktivno opozarjanje.
 *
 * Navdih: Zendesk AI, Bold BI, ERP Suites.
 *
 * Prikazuje:
 * - ANOMALIES — nenavadni vzorci (win rate drop, inventory aging, profit drop, category decline)
 * - PREDICTIONS — napovedi za naslednji teden/mesec
 * - INSIGHTS — AI vpogledi
 *
 * Vsaka anomalija/predikcija je klikljiva → navigira na relevantni view.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, TrendingUp, Lightbulb, ChevronRight,
  AlertCircle, Zap, TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';
import type { DashboardView } from './dashboard/types';

interface Anomaly {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviation: number;
  recommendation: string;
  actionUrl?: string;
}

interface Prediction {
  id: string;
  type: string;
  title: string;
  description: string;
  metric: string;
  predictedValue: number;
  confidence: number;
  timeframe: string;
  recommendation: string;
  actionUrl?: string;
}

interface Insight {
  id: string;
  icon: string;
  text: string;
  category: 'positive' | 'warning' | 'opportunity';
}

interface PredictiveData {
  ok: true;
  anomalies: Anomaly[];
  predictions: Prediction[];
  insights: Insight[];
  summary: {
    totalAnomalies: number;
    highSeverity: number;
    totalPredictions: number;
    winRateThisWeek: number;
    winRateLastWeek: number;
    thisMonthProfit: number;
    lastMonthProfit: number;
    projectedMonthEnd: number;
    agedItemsCount: number;
  };
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  high: { bg: 'bg-red-500/5', border: 'border-red-500/40', text: 'text-red-500', icon: '🔴' },
  medium: { bg: 'bg-amber-500/5', border: 'border-amber-500/40', text: 'text-amber-500', icon: '🟡' },
  low: { bg: 'bg-sky-500/5', border: 'border-sky-500/40', text: 'text-sky-500', icon: '🔵' },
};

const INSIGHT_COLORS: Record<string, string> = {
  positive: 'text-emerald-500',
  warning: 'text-amber-500',
  opportunity: 'text-sky-500',
};

interface PredictiveAnalyticsWidgetProps {
  onNavigate?: (view: DashboardView) => void;
}

export function PredictiveAnalyticsWidget({ onNavigate }: PredictiveAnalyticsWidgetProps) {
  const [data, setData] = useState<PredictiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const haptic = useHaptic();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics/predictive');
      if (res.ok) {
        const json = await res.json();
        if (json.ok) setData(json);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleAction = (actionUrl?: string) => {
    if (!actionUrl || !onNavigate) return;
    haptic.light();
    // Parse view from URL like "/?view=trades"
    const match = actionUrl.match(/\?view=(\w+)/);
    if (match) {
      onNavigate(match[1] as DashboardView);
    }
  };

  if (loading || !data) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-32 bg-muted/30 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const { anomalies, predictions, insights, summary } = data;

  return (
    <Card className="bg-card/50 border-purple-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-purple-500" />
          Predictive Analytics
          {anomalies.length > 0 && (
            <Badge
              className={cn(
                'ml-auto text-[10px]',
                summary.highSeverity > 0
                  ? 'bg-red-500/10 text-red-500 border-red-500/30'
                  : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
              )}
            >
              {summary.highSeverity > 0 ? `${summary.highSeverity} nujnih` : `${anomalies.length} opozoril`}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
          <div className="p-1.5 rounded bg-background/30">
            <div className="text-base font-bold text-foreground">{summary.winRateThisWeek}%</div>
            <div className="uppercase text-muted-foreground">Win (7d)</div>
          </div>
          <div className="p-1.5 rounded bg-background/30">
            <div className="text-base font-bold text-emerald-500">{summary.projectedMonthEnd}€</div>
            <div className="uppercase text-muted-foreground">Napoved</div>
          </div>
          <div className="p-1.5 rounded bg-background/30">
            <div className="text-base font-bold text-amber-500">{summary.agedItemsCount}</div>
            <div className="uppercase text-muted-foreground">Zastar.</div>
          </div>
          <div className="p-1.5 rounded bg-background/30">
            <div className={cn('text-base font-bold', summary.highSeverity > 0 ? 'text-red-500' : 'text-emerald-500')}>
              {summary.highSeverity}
            </div>
            <div className="uppercase text-muted-foreground">Nujno</div>
          </div>
        </div>

        {/* Anomalies */}
        {anomalies.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Anomalije ({anomalies.length})
            </div>
            {anomalies.slice(0, 3).map((a) => {
              const sev = SEVERITY_COLORS[a.severity];
              return (
                <button
                  key={a.id}
                  onClick={() => handleAction(a.actionUrl)}
                  disabled={!a.actionUrl}
                  className={cn(
                    'w-full text-left p-2 rounded border text-xs transition-colors',
                    sev.bg, sev.border,
                    a.actionUrl && 'hover:border-primary/40 cursor-pointer'
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="text-sm">{sev.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className={cn('font-bold', sev.text)}>{a.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{a.description}</div>
                      <div className="text-[10px] mt-1 italic opacity-80">💡 {a.recommendation}</div>
                    </div>
                    {a.actionUrl && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Predictions */}
        {predictions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              Napovedi ({predictions.length})
            </div>
            {predictions.slice(0, 2).map((p) => (
              <button
                key={p.id}
                onClick={() => handleAction(p.actionUrl)}
                disabled={!p.actionUrl}
                className={cn(
                  'w-full text-left p-2 rounded border border-sky-500/30 bg-sky-500/5 text-xs transition-colors',
                  p.actionUrl && 'hover:border-sky-500/50 cursor-pointer'
                )}
              >
                <div className="flex items-start gap-1.5">
                  <Zap className="w-3 h-3 text-sky-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sky-500">{p.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{p.description}</div>
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      <span className="text-sky-500">Confidence: {p.confidence}%</span>
                      <span className="text-muted-foreground">· {p.timeframe}</span>
                    </div>
                  </div>
                  {p.actionUrl && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <Lightbulb className="w-3 h-3" />
              Vpogledi ({insights.length})
            </div>
            {insights.slice(0, 3).map((i) => (
              <div
                key={i.id}
                className="flex items-start gap-1.5 p-1.5 rounded bg-background/30 text-xs"
              >
                <span className="text-sm">{i.icon}</span>
                <span className={cn('flex-1', INSIGHT_COLORS[i.category])}>{i.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {anomalies.length === 0 && predictions.length === 0 && insights.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Ni dovolj podatkov za napovedi.
            <br />
            <span className="text-[10px]">Dodaj več trgovin za boljše napovedi.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
