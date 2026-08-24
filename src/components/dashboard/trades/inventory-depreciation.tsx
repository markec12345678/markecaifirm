'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, LineChart as LineChartIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InventoryDepreciation() {
  // v6.23: Inventory Depreciation
  const [depreciationData, setDepreciationData] = useState<any>(null);
  const [depreciationLoading, setDepreciationLoading] = useState(false);

  return (
    <>
      {/* v6.23: Inventory Depreciation Forecaster */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-orange-400/40 text-orange-400 hover:bg-orange-400/10"
        disabled={depreciationLoading}
        onClick={async () => {
          setDepreciationLoading(true); setDepreciationData(null);
          try {
            const res = await fetch('/api/ai/depreciation-forecast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            const data = await res.json();
            if (data.ok) { setDepreciationData(data); toast.success('✓ Napoved amortizacije generirana'); }
            else toast.error(data.error ?? data.message ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setDepreciationLoading(false); }
        }}
        title="AI napove padec vrednosti inventarja in kdaj prodati"
      >
        {depreciationLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LineChartIcon className="w-3.5 h-3.5" />}
        Amortizacija
      </Button>

      {/* v6.23: AI Inventory Depreciation Forecaster results */}
      {depreciationData && (
        <Card className="bg-card/50 border-orange-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LineChartIcon className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-bold">AI Inventory Depreciation Forecaster</span>
                <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/40">v6.23</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDepreciationData(null)} className="h-6 text-xs">×</Button>
            </div>

            {depreciationData.insights && (
              <div className="bg-orange-400/5 border border-orange-400/20 rounded p-2 text-xs text-orange-400">{depreciationData.insights}</div>
            )}

            {/* Portfolio summary */}
            {depreciationData.portfolioSummary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Trenutna vrednost</div>
                  <div className="font-bold text-primary">{depreciationData.portfolioSummary.totalCurrentValueEur}€</div>
                </div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                  <div className="text-amber-400 uppercase">Izguba 6m</div>
                  <div className="font-bold text-amber-400">−{depreciationData.portfolioSummary.projectedLoss6mEur}€</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                  <div className="text-red-500 uppercase">Izguba 12m</div>
                  <div className="font-bold text-red-500">−{depreciationData.portfolioSummary.projectedLoss12mEur}€</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                  <div className="text-red-500 uppercase">Izguba 24m</div>
                  <div className="font-bold text-red-500">−{depreciationData.portfolioSummary.projectedLoss24mEur}€</div>
                </div>
              </div>
            )}

            {/* Forecasts per item */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {depreciationData.forecasts?.map((f: any, i: number) => {
                const actionCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  sell_now: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  sell_soon: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  monitor: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  hold: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                  vintage_holding: { color: 'text-purple-400', bg: 'border-purple-400/20 bg-purple-400/5', icon: '👑' },
                };
                const cfg = actionCfg[f.action] || actionCfg.monitor;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px] truncate">{f.title}</span>
                      </div>
                      <Badge variant="outline" className={cn('text-[8px] uppercase shrink-0', cfg.color)}>
                        {f.action.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">Trenutno</div>
                        <div className="font-mono font-bold">{f.currentValue}€</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">6m</div>
                        <div className="font-mono font-bold text-amber-400">{f.projectedValue6mEur}€</div>
                        <div className="text-[7px] text-red-500">−{f.loss6mPct}%</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">12m</div>
                        <div className="font-mono font-bold text-orange-400">{f.projectedValue12mEur}€</div>
                        <div className="text-[7px] text-red-500">−{f.loss12mPct}%</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border text-center">
                        <div className="text-[8px] uppercase text-muted-foreground">24m</div>
                        <div className="font-mono font-bold text-red-500">{f.projectedValue24mEur}€</div>
                        <div className="text-[7px] text-red-500">−{f.loss24mPct}%</div>
                      </div>
                    </div>
                    {f.monthsToZeroProfit != null && (
                      <div className="text-[9px] text-amber-400">⏱ Do izgube dobička: <b>{f.monthsToZeroProfit} mesecev</b></div>
                    )}
                    {f.optimalSellWindow && (
                      <div className="text-[9px] text-primary">📅 Optimalen čas prodaje: {f.optimalSellWindow}</div>
                    )}
                    {f.reasoning && <div className="text-[9px] italic">{f.reasoning}</div>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
