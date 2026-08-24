'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './types';

interface CrossPlatformPriceComparisonProps {
  trades: Trade[];
}

export function CrossPlatformPriceComparison({ trades }: CrossPlatformPriceComparisonProps) {
  // v6.23: Cross-Platform Price
  const [crossPriceData, setCrossPriceData] = useState<any>(null);
  const [crossPriceLoading, setCrossPriceLoading] = useState(false);

  return (
    <>
      {/* v6.23: Cross-Platform Price Comparison */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-indigo-400/40 text-indigo-400 hover:bg-indigo-400/10"
        disabled={crossPriceLoading}
        onClick={async () => {
          if (trades.length === 0) { toast.error('Ni tradeov v skladišču'); return; }
          const firstHeld = trades.find((t: any) => t.status === 'held');
          if (!firstHeld) { toast.error('Ni held tradeov'); return; }
          setCrossPriceLoading(true); setCrossPriceData(null);
          try {
            const res = await fetch('/api/ai/cross-platform-price', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tradeId: firstHeld.id }),
            });
            const data = await res.json();
            if (data.ok) { setCrossPriceData(data); toast.success('✓ Cross-platform primerjava generirana'); }
            else toast.error(data.error ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setCrossPriceLoading(false); }
        }}
        title="AI primerja cene na 10 platformah in identificira arbitražo"
      >
        {crossPriceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
        Cross-platform
      </Button>

      {/* v6.23: AI Cross-Platform Price Comparison results */}
      {crossPriceData?.comparison && (
        <Card className="bg-card/50 border-indigo-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold">AI Cross-Platform Price Comparison</span>
                <Badge variant="outline" className="text-[10px] text-indigo-400 border-indigo-400/40">v6.23</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setCrossPriceData(null)} className="h-6 text-xs">×</Button>
            </div>

            <div className="text-[10px] text-muted-foreground">Item: <b>{crossPriceData.comparison.itemTitle}</b></div>

            {/* Recommendation */}
            {crossPriceData.comparison.recommendation && (
              <div className={cn('border rounded p-2',
                crossPriceData.comparison.recommendation.action === 'buy_now' ? 'bg-primary/10 border-primary/30' :
                crossPriceData.comparison.recommendation.action === 'avoid' ? 'bg-red-500/10 border-red-500/30' :
                'bg-amber-400/10 border-amber-400/30')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase font-bold">
                    → {crossPriceData.comparison.recommendation.action.replace('_', ' ')}
                  </span>
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                    Pričakovan dobiček: {crossPriceData.comparison.recommendation.expectedProfitEur}€
                  </Badge>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  🛒 Kupi na: <b>{crossPriceData.comparison.recommendation.bestBuyPlatform}</b> · 💰 Prodaj na: <b>{crossPriceData.comparison.recommendation.bestSellPlatform}</b>
                </div>
                <p className="text-[9px] italic mt-1">{crossPriceData.comparison.recommendation.reasoning}</p>
              </div>
            )}

            {/* Prices table */}
            {crossPriceData.comparison.prices?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">💰 Cene po platformah:</div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {crossPriceData.comparison.prices.map((p: any, i: number) => (
                    <div key={i} className={cn('border rounded p-1.5 flex items-center justify-between gap-2',
                      p === crossPriceData.comparison.cheapest ? 'bg-primary/5 border-primary/20' : 'bg-background/40')}>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-[10px] font-bold truncate">{p.platformName}</span>
                        <Badge variant="outline" className="text-[8px] shrink-0">{p.country}</Badge>
                        <Badge variant="outline" className={cn('text-[8px] shrink-0',
                          p.demandLevel === 'high' ? 'text-primary border-primary/30' :
                          p.demandLevel === 'low' ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                          {p.demandLevel}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-[11px]">{p.estimatedPriceEur}€</div>
                        <div className="text-[8px] text-muted-foreground">neto {p.netRevenueEur}€</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Arbitrage opportunities */}
            {crossPriceData.comparison.arbitrageOpportunities?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">⚡ Arbitražne priložnosti:</div>
                <div className="space-y-1">
                  {crossPriceData.comparison.arbitrageOpportunities.map((a: any, i: number) => (
                    <div key={i} className="bg-indigo-400/5 border border-indigo-400/20 rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span><Badge variant="outline" className="text-[8px] mr-1">{a.strategy.replace('_', ' ')}</Badge> {a.buyPlatform} → {a.sellPlatform}</span>
                        <Badge variant="outline" className="text-[8px] text-primary border-primary/30">+{a.netProfitEur}€ ({a.roiPct}%)</Badge>
                      </div>
                      <div className="text-[8px] text-muted-foreground mt-0.5">
                        Kupi {a.buyPriceEur}€ · Prodaj {a.sellPriceEur}€ · Shipping {a.shippingEur}€ · Provizije {a.feesEur}€ · {a.timeRequiredDays}d · {a.feasibility}
                      </div>
                      <div className="text-[8px] italic">{a.reasoning}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {crossPriceData.insights && (
              <div className="bg-indigo-400/5 border border-indigo-400/20 rounded p-2 text-xs text-indigo-400">{crossPriceData.insights}</div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
