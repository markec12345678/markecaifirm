'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function OptimalTimePredictor() {
  // v6.21: Optimal Time Predictor
  const [optimalTimeData, setOptimalTimeData] = useState<Record<string, any> | null>(null);
  const [optimalTimeLoading, setOptimalTimeLoading] = useState(false);

  return (
    <>
      {/* v6.21: Optimal Listing Time Predictor */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
        disabled={optimalTimeLoading}
        onClick={async () => {
          setOptimalTimeLoading(true); setOptimalTimeData(null);
          try {
            const res = await fetch('/api/ai/optimal-time', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            const data = await res.json();
            if (data.ok) { setOptimalTimeData(data); toast.success('✓ Optimalni čas objave generiran'); }
            else toast.error(data.error ?? data.message ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setOptimalTimeLoading(false); }
        }}
        title="AI napove kdaj objaviti oglas za max dobiček"
      >
        {optimalTimeLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
        Optimalni čas
      </Button>

      {/* v6.21: AI Optimal Listing Time Predictor results */}
      {optimalTimeData && (
        <Card className="bg-card/50 border-blue-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold">AI Optimal Listing Time</span>
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/40">v6.21</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOptimalTimeData(null)} className="h-6 text-xs">×</Button>
            </div>

            {optimalTimeData.insights && (
              <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2 text-xs text-blue-400">{optimalTimeData.insights}</div>
            )}

            {optimalTimeData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{optimalTimeData.summary.totalItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. cena</div>
                  <div className="font-bold text-primary">{optimalTimeData.summary.avgExpectedPrice ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. čas</div>
                  <div className="font-bold">{optimalTimeData.summary.avgTimeToSell ?? 0}d</div>
                </div>
                <div className="bg-blue-400/5 border border-blue-400/20 rounded p-1.5">
                  <div className="text-blue-400 uppercase">Skupni prihodek</div>
                  <div className="font-bold text-primary">{optimalTimeData.summary.totalExpectedRevenue ?? 0}€</div>
                </div>
              </div>
            )}

            {/* Predictions */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {optimalTimeData.predictions?.map((p: Record<string, any>, i: number) => {
                const stratCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  premium_time: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '⭐' },
                  off_peak: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  flash_sale: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔥' },
                  staggered: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '📅' },
                  wait_seasonal: { color: 'text-purple-400', bg: 'border-purple-400/20 bg-purple-400/5', icon: '🎄' },
                };
                const cfg = stratCfg[p.strategy] || stratCfg.premium_time;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px] truncate">{p.title}</span>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] shrink-0', cfg.color)}>{p.strategy.replace('_', ' ')}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div>
                        <div className="text-muted-foreground">📅 Dan</div>
                        <div className="font-bold capitalize">{p.optimalDay}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">⏰ Ura</div>
                        <div className="font-mono font-bold">{String(p.optimalHour).padStart(2, '0')}:00</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">📍 Platforma</div>
                        <div className="font-bold capitalize">{p.optimalPlatform}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">💰 Cena</div>
                        <div className="font-mono font-bold text-primary">{p.expectedPriceEur}€</div>
                      </div>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      ⏱ {p.expectedTimeToSellDays}d prodaja · {p.seasonalityNote}
                    </div>
                    {p.reasoning && <div className="text-[9px] italic">{p.reasoning}</div>}
                  </div>
                );
              })}
            </div>

            {/* Historical data */}
            {optimalTimeData.historicalData?.salesByDay?.some((d: Record<string, any>) => d.count > 0) && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Zgodovina prodaj po dnevih:</div>
                <div className="grid grid-cols-7 gap-1 text-[9px]">
                  {optimalTimeData.historicalData.salesByDay.map((d: Record<string, any>, j: number) => (
                    <div key={j} className="text-center">
                      <div className="text-muted-foreground capitalize truncate">{d.day.slice(0, 3)}</div>
                      <div className={cn('font-mono font-bold', d.count > 0 ? 'text-primary' : 'text-muted-foreground')}>{d.count}</div>
                      {d.count > 0 && <div className="text-[8px] text-muted-foreground">{d.avgProfit}€</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
