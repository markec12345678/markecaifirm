'use client';

/**
 * v7.33: Deal Conversion Funnel Widget — kje denar uhaja?
 *
 * Visualizes the deal pipeline from discovery to profit:
 * Odkrito → Zanimivo → Kontaktirano → Kupljeno → Prodano → Dobiček
 *
 * Each stage shows count, conversion rate, and EUR value.
 * Highlights the bottleneck (lowest conversion stage) with a suggestion.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Filter, AlertTriangle, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FunnelStage {
  name: string;
  key: string;
  count: number;
  valueEur: number;
  conversion: number;
}

interface FunnelData {
  ok: boolean;
  days: number;
  stages: FunnelStage[];
  summary: {
    totalDiscovered: number;
    totalProfitable: number;
    totalProfitEur: number;
    overallConversion: number;
    avgHoldDays: number;
    bottleneck: { stage: string; conversion: number; suggestion: string } | null;
  };
}

export function DealFunnelWidget() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/analytics/deal-funnel?days=${days}`);
        if (!cancelled && res.ok) setData(await res.json());
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [days]);

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-4 text-xs text-muted-foreground">Nalagam funnel...</CardContent>
      </Card>
    );
  }

  if (!data || data.stages.every(s => s.count === 0)) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" /> DEAL FUNNEL
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Ni podatkov v izbranem obdobju.</p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...data.stages.map(s => s.count), 1);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" /> DEAL FUNNEL
          </CardTitle>
          <div className="flex gap-1">
            {[30, 90, 365].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] transition-colors',
                  days === d ? 'bg-primary/20 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {d === 365 ? '1 leto' : `${d}d`}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Funnel bars */}
        {data.stages.map((stage, i) => {
          const widthPct = (stage.count / maxCount) * 100;
          const isBottleneck = data.summary.bottleneck?.stage === stage.name;
          const conversionColor = stage.conversion >= 50 ? 'text-primary' : stage.conversion >= 25 ? 'text-amber-400' : 'text-red-500';

          return (
            <div key={stage.key} className="flex items-center gap-2 text-xs">
              {/* Stage label */}
              <div className="w-20 shrink-0 text-right text-muted-foreground">
                {stage.name}
              </div>
              {/* Bar */}
              <div className="flex-1 relative">
                <div
                  className={cn(
                    'h-7 rounded flex items-center px-2 transition-all',
                    isBottleneck ? 'bg-red-500/20 border border-red-500/40' : 'bg-primary/10 border border-primary/20'
                  )}
                  style={{ width: `${Math.max(widthPct, 10)}%` }}
                >
                  <span className="font-mono font-bold text-foreground whitespace-nowrap">
                    {stage.count}
                  </span>
                  {stage.valueEur > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-1.5 whitespace-nowrap">
                      {stage.valueEur}€
                    </span>
                  )}
                </div>
              </div>
              {/* Conversion rate */}
              {i > 0 && (
                <div className={cn('w-16 shrink-0 text-right font-mono', conversionColor)}>
                  {stage.conversion.toFixed(0)}%
                </div>
              )}
              {i === 0 && <div className="w-16 shrink-0" />}
            </div>
          );
        })}

        {/* Summary stats */}
        <div className="pt-3 mt-2 border-t border-border/50 grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Konverzija</div>
            <div className={cn('font-mono font-bold', data.summary.overallConversion >= 5 ? 'text-primary' : 'text-amber-400')}>
              {data.summary.overallConversion}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Dobiček</div>
            <div className={cn('font-mono font-bold', data.summary.totalProfitEur >= 0 ? 'text-primary' : 'text-red-500')}>
              {data.summary.totalProfitEur >= 0 ? '+' : ''}{data.summary.totalProfitEur}€
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Hold čas</div>
            <div className="font-mono font-bold">{data.summary.avgHoldDays}d</div>
          </div>
        </div>

        {/* Bottleneck alert */}
        {data.summary.bottleneck && (
          <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/30 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-[11px]">
              <span className="font-bold text-red-500">Bottleneck: {data.summary.bottleneck.stage}</span>
              <span className="text-muted-foreground"> ({data.summary.bottleneck.conversion.toFixed(0)}% konverzija)</span>
              <p className="text-muted-foreground mt-0.5">{data.summary.bottleneck.suggestion}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
