'use client';

// v9.02: Extracted from statistics-view.tsx — AI Predictive Stockout Alerts (v6.15)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function PredictiveStockout() {
  const [stockoutData, setStockoutData] = useState<any>(null);
  const [stockoutLoading, setStockoutLoading] = useState(false);
  const [stockoutDays, setStockoutDays] = useState('30');

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Predictive Stockout Alerts
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.15</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI napove primanjkljaj kategorij in predlaga restock timing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-muted-foreground shrink-0">Dni naprej:</span>
          <Input
            type="number"
            min={7}
            max={180}
            value={stockoutDays}
            onChange={(e) => setStockoutDays(e.target.value)}
            className="h-7 text-xs w-20"
          />
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={stockoutLoading}
            onClick={async () => {
              setStockoutLoading(true); setStockoutData(null);
              try {
                const days = Math.max(7, Math.min(180, Number(stockoutDays) || 30));
                const res = await fetch('/api/ai/predictive-stockout', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ forecastDays: days }),
                });
                const data = await res.json();
                if (data.ok) { setStockoutData(data); toast.success('✓ Stockout napoved generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setStockoutLoading(false); }
            }}>
            {stockoutLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Napovej
          </Button>
        </div>
        {stockoutLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira depletion rates in stock levels...</div>
        ) : stockoutData ? (
          <div className="space-y-2 text-xs">
            {stockoutData.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{stockoutData.insights}</div>
            )}
            {stockoutData.summary && (
              <div className="grid grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Kategorij</div>
                  <div className="font-bold">{stockoutData.summary.totalCategories ?? 0}</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5 border">
                  <div className="text-red-500 uppercase">🔴 Critical</div>
                  <div className="font-bold text-red-500">{stockoutData.summary.criticalCount ?? 0}</div>
                </div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5 border">
                  <div className="text-amber-400 uppercase">🟡 High</div>
                  <div className="font-bold text-amber-400">{stockoutData.summary.highCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">⚪ Stagnant</div>
                  <div className="font-bold">{stockoutData.summary.stagnantCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Vrednost stocka</div>
                  <div className="font-bold text-primary">{stockoutData.summary.totalStockValue ?? 0}€</div>
                </div>
              </div>
            )}

            {/* Restock alerts */}
            {stockoutData.restockAlerts?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase text-red-500 mb-1">🚨 Restock alerti:</div>
                <div className="space-y-1">
                  {stockoutData.restockAlerts.map((a: any, i: number) => (
                    <div key={i} className={cn('text-[10px] rounded p-1',
                      a.alertLevel === 'critical' ? 'bg-red-500/10 text-red-500' :
                      a.alertLevel === 'high' ? 'bg-amber-400/10 text-amber-400' : 'text-muted-foreground')}>
                      <Badge variant="outline" className="text-[9px] mr-1">{a.category}</Badge>
                      <span className="font-bold uppercase">{a.alertLevel}</span>
                      <span> · {a.deadlineDays}d · {a.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Predictions table */}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stockoutData.predictions?.map((p: any, i: number) => {
                const sevCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  critical: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                  high: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                  medium: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '🔵' },
                  stagnant: { color: 'text-muted-foreground', bg: 'bg-muted/5 border-border', icon: '⚪' },
                  low: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '🟢' },
                };
                const cfg = sevCfg[p.severity] || sevCfg.low;
                return (
                  <div key={i} className={cn('rounded p-1.5 border', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{p.category}</Badge>
                        <span className="text-[10px] text-muted-foreground shrink-0">{p.currentStock} itemov</span>
                      </div>
                      <div className="text-right shrink-0">
                        {p.daysToStockout !== null ? (
                          <>
                            <div className={cn('font-mono font-bold text-[10px]', cfg.color)}>{p.daysToStockout}d</div>
                            <div className="text-[8px] text-muted-foreground">do stockout</div>
                          </>
                        ) : (
                          <div className="text-[9px] text-muted-foreground">ni prodaj</div>
                        )}
                      </div>
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Depletion: {p.depletionRate}/mesec · Vrednost: {p.currentValue}€ · Povp. starost: {p.avgAge}d
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recommendations */}
            {stockoutData.recommendations?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">💡 Restock priporočila:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {stockoutData.recommendations.map((r: any, i: number) => {
                    const actColor = r.action === 'restock_now' ? 'text-red-500' :
                                     r.action === 'start_sourcing' ? 'text-amber-400' :
                                     r.action === 'liquidate' ? 'text-destructive' : 'text-primary';
                    return (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold">{r.category}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className={cn('text-[9px] uppercase', actColor)}>{r.action.replace('_', ' ')}</Badge>
                            <span className="font-mono text-[9px]"> urgency {r.urgency}/10</span>
                          </div>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          🛒 {r.suggestedQuantity}x · 💰 {r.expectedRevenueEur}€ prihodkov · 📍 {r.sourcingHint}
                        </div>
                        {r.reasoning && <div className="text-[9px] italic">{r.reasoning}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej" za AI napoved primanjkljaja kategorij.</p>
        )}
      </CardContent>
    </Card>
  );
}
