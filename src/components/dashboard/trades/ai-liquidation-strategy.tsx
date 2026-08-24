'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AILiquidationStrategyProps {
  bulkTradeIds: Set<string>;
}

export function AILiquidationStrategy({ bulkTradeIds }: AILiquidationStrategyProps) {
  const [liquidationData, setLiquidationData] = useState<any>(null);
  const [liquidationLoading, setLiquidationLoading] = useState(false);

  return (
    <>
      {/* v6.10: Liquidation Strategy */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
        disabled={liquidationLoading}
        onClick={async () => {
          setLiquidationLoading(true); setLiquidationData(null);
          try {
            const ids = Array.from(bulkTradeIds);
            const res = await fetch('/api/ai/liquidation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(ids.length > 0 ? { tradeIds: ids } : {}),
            });
            const data = await res.json();
            if (data.ok) { setLiquidationData(data); toast.success('✓ Likvidacijska strategija generirana'); }
            else toast.error(data.error ?? data.message ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setLiquidationLoading(false); }
        }}
        title="AI predlaga kako hitro likvidirati stalled inventar"
      >
        {liquidationLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
        Likvidacija
      </Button>

      {/* v6.10: AI Liquidation Strategy results */}
      {liquidationData && (
        <Card className="bg-card/50 border-amber-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold">AI Likvidacijska strategija</span>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.10</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setLiquidationData(null)} className="h-6 text-xs">×</Button>
            </div>
            {liquidationData.summary && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs text-amber-400">{liquidationData.summary}</div>
            )}
            {liquidationData.totals && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{liquidationData.totals.itemCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Stalled</div>
                  <div className="font-bold text-amber-400">{liquidationData.totals.stalledCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Projekt. prihodek</div>
                  <div className="font-bold text-primary">{liquidationData.totals.totalProjectedRevenue ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Projekt. izguba</div>
                  <div className={cn('font-bold', (liquidationData.totals.totalProjectedLoss ?? 0) >= 0 ? 'text-primary' : 'text-destructive')}>
                    {(liquidationData.totals.totalProjectedLoss ?? 0) >= 0 ? '+' : ''}{liquidationData.totals.totalProjectedLoss ?? 0}€
                  </div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. čas</div>
                  <div className="font-bold">{liquidationData.totals.avgDaysToSell ?? 0}d</div>
                </div>
              </div>
            )}
            {liquidationData.totals?.urgencyBreakdown && (
              <div className="flex gap-1 text-[10px]">
                {(['critical', 'high', 'medium', 'low'] as const).map((u) => {
                  const cfg: Record<string, string> = {
                    critical: 'text-red-500 bg-red-500/5 border-red-500/20',
                    high: 'text-amber-400 bg-amber-400/5 border-amber-400/20',
                    medium: 'text-blue-400 bg-blue-400/5 border-blue-400/20',
                    low: 'text-muted-foreground bg-background/40 border-border',
                  };
                  return (
                    <span key={u} className={cn('px-2 py-0.5 rounded border', cfg[u])}>
                      {u === 'critical' ? '🔴' : u === 'high' ? '🟡' : u === 'medium' ? '🔵' : '⚪'} {u}: <b>{liquidationData.totals.urgencyBreakdown[u] ?? 0}</b>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="space-y-2">
              {liquidationData.items?.map((it: any, i: number) => {
                const urgencyCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  critical: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  high: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  medium: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  low: { color: 'text-muted-foreground', bg: 'border-border bg-background/30', icon: '⚪' },
                };
                const cfg = urgencyCfg[it.urgency] || urgencyCfg.medium;
                const strategyLabels: Record<string, string> = {
                  discount_progressive: 'Progresivni popust',
                  auction_online: 'Online dražba',
                  bundle_with_hot: 'Bundle s hitrim',
                  part_out: 'Razstavi na dele',
                  flash_sale: 'Flash sale',
                  trade_in: 'Trade-in',
                  wait_seasonal: 'Čakaj sezono',
                  donation_tax: 'Donacija',
                  relist_refresh: 'Ponovna objava',
                };
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs">{cfg.icon}</span>
                        <span className="font-bold text-xs">{it.title}</span>
                        <Badge variant="outline" className="text-[9px]">{it.category}</Badge>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] border', cfg.color)}>
                        {strategyLabels[it.strategy] || it.strategy}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      <div><span className="text-muted-foreground">Cena:</span> <span className="font-mono font-bold text-primary">{it.expectedPrice}€</span></div>
                      <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{it.cost}€</span></div>
                      <div><span className="text-muted-foreground">Izguba:</span> <span className={cn('font-mono font-bold', it.projectedLoss >= 0 ? 'text-primary' : 'text-destructive')}>{it.projectedLoss >= 0 ? '+' : ''}{it.projectedLoss}€</span></div>
                      <div><span className="text-muted-foreground">Čas:</span> <span className="font-mono">{it.timeToSellDays}d</span></div>
                    </div>
                    {it.steps?.length > 0 && (
                      <ol className="text-[10px] list-decimal list-inside space-y-0.5">
                        {it.steps.map((s: string, j: number) => <li key={j}>{s}</li>)}
                      </ol>
                    )}
                    <div className="text-[9px] text-muted-foreground italic">⏱ {it.daysHeld}d v skladišču · {it.reasoning}</div>
                  </div>
                );
              })}
              {liquidationData.items?.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-2">Ni itemov za likvidacijo.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
