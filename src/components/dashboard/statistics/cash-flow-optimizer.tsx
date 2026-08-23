'use client';

// v9.02: Extracted from statistics-view.tsx — AI Cash Flow Optimizer (v6.13)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CashFlowOptimizer() {
  const [cashflowData, setCashflowData] = useState<any>(null);
  const [cashflowLoading, setCashflowLoading] = useState(false);
  const [cashflowDays, setCashflowDays] = useState('30');

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Cash Flow Optimizer
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.13</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI analizira denarni tok, identificira bottlenecke in optimizira reinvesticije.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-muted-foreground shrink-0">Dni naprej:</span>
          <Input
            type="number"
            min={7}
            max={90}
            value={cashflowDays}
            onChange={(e) => setCashflowDays(e.target.value)}
            className="h-7 text-xs w-20"
          />
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={cashflowLoading}
            onClick={async () => {
              setCashflowLoading(true); setCashflowData(null);
              try {
                const days = Math.max(7, Math.min(90, Number(cashflowDays) || 30));
                const res = await fetch('/api/ai/cashflow', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ forecastDays: days }),
                });
                const data = await res.json();
                if (data.ok) { setCashflowData(data); toast.success('✓ Cash flow analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setCashflowLoading(false); }
            }}>
            {cashflowLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Optimiziraj
          </Button>
        </div>
        {cashflowLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira denarne tokove in bottlenecke...</div>
        ) : cashflowData ? (
          <div className="space-y-2 text-xs">
            {/* Current cash */}
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className={cn('rounded p-1.5 border',
                cashflowData.currentCash >= 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                <div className="text-muted-foreground uppercase">💸 Trenutni cash</div>
                <div className={cn('font-mono font-bold text-[12px]',
                  cashflowData.currentCash >= 0 ? 'text-primary' : 'text-destructive')}>
                  {cashflowData.currentCash}€
                </div>
              </div>
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-muted-foreground uppercase">📦 Vezan inventar</div>
                <div className="font-mono font-bold">{cashflowData.totalInvestedHeld}€</div>
              </div>
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-muted-foreground uppercase">💰 Realizirano</div>
                <div className="font-mono font-bold text-primary">{cashflowData.totalRealized}€</div>
              </div>
            </div>

            {cashflowData.analysis?.summary && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{cashflowData.analysis.summary}</div>
            )}

            {/* Strategy */}
            {cashflowData.analysis?.currentStrategy && cashflowData.analysis?.recommendedStrategy && (
              <div className="bg-background/40 rounded p-1.5 border flex items-center justify-between text-[10px]">
                <span>Trenutna: <b className="text-amber-400">{cashflowData.analysis.currentStrategy.replace('_', ' ')}</b></span>
                <span>→</span>
                <span>Priporočena: <b className="text-primary">{cashflowData.analysis.recommendedStrategy.replace('_', ' ')}</b></span>
              </div>
            )}

            {/* Optimal allocation */}
            {cashflowData.analysis?.optimalAllocation && (
              <div className="bg-background/40 rounded p-1.5 border">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Optimalna alokacija:</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-muted-foreground">Reinvestiraj:</span>
                    <span className="font-mono font-bold text-primary"> {cashflowData.analysis.optimalAllocation.reinvestPct}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Rezerva:</span>
                    <span className="font-mono font-bold text-amber-400"> {cashflowData.analysis.optimalAllocation.reservePct}%</span>
                  </div>
                </div>
                {cashflowData.analysis.optimalAllocation.reasoning && (
                  <div className="text-[9px] text-muted-foreground italic mt-1">{cashflowData.analysis.optimalAllocation.reasoning}</div>
                )}
              </div>
            )}

            {/* Forecast summary */}
            {cashflowData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Prič. prodaje</div>
                  <div className="font-bold">{cashflowData.summary.expectedSales ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Prič. prihodek</div>
                  <div className="font-bold text-primary">{cashflowData.summary.expectedRevenue ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Reinvesticija</div>
                  <div className="font-bold text-amber-400">{cashflowData.summary.expectedReinvestment ?? 0}€</div>
                </div>
                <div className={cn('rounded p-1.5 border',
                  (cashflowData.summary.endingCash ?? 0) >= 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                  <div className="text-muted-foreground uppercase">Končni cash</div>
                  <div className={cn('font-bold font-mono',
                    (cashflowData.summary.endingCash ?? 0) >= 0 ? 'text-primary' : 'text-destructive')}>
                    {cashflowData.summary.endingCash ?? 0}€
                  </div>
                </div>
              </div>
            )}

            {/* Bottlenecks */}
            {cashflowData.analysis?.bottlenecks?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Bottlenecks:</div>
                <div className="space-y-1">
                  {cashflowData.analysis.bottlenecks.map((b: any, i: number) => (
                    <div key={i} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{b.type.replace('_', ' ')}</span>
                        <span className="font-mono text-red-500">−{b.impactEur}€</span>
                      </div>
                      <div className="text-[9px] text-muted-foreground">{b.description}</div>
                      <div className="text-[9px] text-primary">→ {b.fix}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {cashflowData.analysis?.recommendations?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">💡 Priporočila:</div>
                <div className="space-y-1">
                  {cashflowData.analysis.recommendations.map((r: any, i: number) => {
                    const prColor = r.priority === 'high' ? 'text-red-500' : r.priority === 'medium' ? 'text-amber-400' : 'text-blue-400';
                    return (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{r.action}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className={cn('text-[9px]', prColor)}>{r.priority}</Badge>
                            <span className="font-mono text-primary">+{r.expectedImpactEur}€</span>
                          </div>
                        </div>
                        <div className="text-[9px] text-muted-foreground">⏱ {r.timeframe}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cash flow gaps */}
            {cashflowData.analysis?.cashFlowGaps?.length > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-amber-400 mb-1">📉 Cash flow gap-i:</div>
                <div className="space-y-1">
                  {cashflowData.analysis.cashFlowGaps.map((g: any, i: number) => (
                    <div key={i} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{g.dateRange}</span>
                        <span className="font-mono text-red-500">−{g.expectedShortfallEur}€</span>
                      </div>
                      <div className="text-[9px] text-primary">→ {g.mitigation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Optimiziraj" za AI analizo denarnega toka in reinvesticijske strategije.</p>
        )}
      </CardContent>
    </Card>
  );
}
