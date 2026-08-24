'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AiTrendPredictions() {
  const [trendPreds, setTrendPreds] = useState<Record<string, any> | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  // v6.0: Load AI trend predictions
  const loadTrendPredictions = useCallback(async () => {
    setTrendLoading(true);
    try {
      const res = await fetch('/api/ai/trend-predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30 }),
      });
      if (res.ok) setTrendPreds(await res.json());
    } catch { /* ignore */ }
    finally { setTrendLoading(false); }
  }, []);

  return (
    <Card className="bg-card/50 lg:col-span-2 border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              AI Tržne napovedi
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.0</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              AI napove tržne trende po kategorijah (naslednjih 30 dni).
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadTrendPredictions} disabled={trendLoading} className="gap-2 h-7 text-xs">
            {trendLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Napovej trende
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {trendLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            AI analizira tržne trende...
          </div>
        ) : !trendPreds || trendPreds.predictions?.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {trendPreds?.message || 'Klikni "Napovej trende" za AI analizo tržnih trendov.'}
          </div>
        ) : (
          <div className="space-y-2">
            {trendPreds.predictions.map((p: Record<string, any>, i: number) => {
              const trendCfg: Record<string, { icon: string; color: string; label: string }> = {
                rising: { icon: '📈', color: 'text-red-500', label: 'Raste' },
                stable: { icon: '➡️', color: 'text-amber-400', label: 'Stabilno' },
                declining: { icon: '📉', color: 'text-primary', label: 'Pada' },
              };
              const cfg = trendCfg[p.trend] || trendCfg.stable;
              const recCfg: Record<string, string> = {
                'kupi zdaj': 'text-primary',
                'čakaj': 'text-amber-400',
                'prodaj': 'text-red-500',
              };
              return (
                <div key={i} className="flex items-start gap-2 p-2 bg-background/30 rounded text-xs">
                  <Badge variant="outline" className="text-[9px] shrink-0">{p.category}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('font-bold', cfg.color)}>{cfg.icon} {cfg.label}</span>
                      <span className={cn('font-mono', p.predictedPriceChange < 0 ? 'text-primary' : p.predictedPriceChange > 0 ? 'text-red-500' : 'text-muted-foreground')}>
                        {p.predictedPriceChange > 0 ? '+' : ''}{p.predictedPriceChange}%
                      </span>
                      <Badge variant="outline" className={cn('text-[9px]', p.confidence >= 70 ? 'text-primary border-primary/40' : 'text-muted-foreground')}>
                        🎯 {p.confidence}%
                      </Badge>
                      <span className="text-[9px] text-muted-foreground">{p.dataPoints} oglasov</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 italic">{p.reasoning}</p>
                    {p.recommendation && (
                      <p className={cn('text-[10px] mt-0.5 font-bold', recCfg[p.recommendation.toLowerCase()] || 'text-muted-foreground')}>
                        → {p.recommendation}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
