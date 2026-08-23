'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PriceWarDetection() {
  const [priceWar, setPriceWar] = useState<any>(null);
  const [warLoading, setWarLoading] = useState(false);

  // v6.6: Load price war detection
  const loadPriceWar = useCallback(async () => {
    setWarLoading(true);
    try {
      const res = await fetch('/api/ai/price-war?days=14');
      if (res.ok) setPriceWar(await res.json());
    } catch { /* ignore */ }
    finally { setWarLoading(false); }
  }, []);

  return (
    <Card className="bg-card/50 lg:col-span-2 border-red-500/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Detekcija cenovne vojne
              <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.6</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              AI zazna hitre padce cen — ali je buyer's market?
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadPriceWar} disabled={warLoading} className="gap-2 h-7 text-xs">
            {warLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
            Skeniraj
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {warLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Detecting price wars...
          </div>
        ) : !priceWar || priceWar.wars?.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {priceWar?.message || 'Klikni "Skeniraj" za detekcijo cenovnih vojn.'}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Skupno padcev</div>
                <div className="font-mono font-bold">{priceWar.totalDrops}</div>
              </div>
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Aktivne vojne</div>
                <div className="font-mono font-bold text-red-500">{priceWar.activeWars}</div>
              </div>
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Buyer's market</div>
                <div className="font-mono font-bold text-primary">{priceWar.buyerMarketCategories}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {priceWar.wars.map((w: any, i: number) => (
                <div key={i} className={cn('p-2 rounded text-xs border',
                  w.isPriceWar ? 'bg-red-500/5 border-red-500/20' :
                  w.buyerMarket ? 'bg-primary/5 border-primary/20' :
                  'bg-background/30 border-border')}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] shrink-0">{w.category}</Badge>
                      {w.isPriceWar && <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/40">🔥 VOJNA</Badge>}
                      {w.buyerMarket && !w.isPriceWar && <Badge variant="outline" className="text-[9px] text-primary border-primary/40">✅ BUYER'S MARKET</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="font-mono font-bold text-red-500">-{w.avgDropPct}%</span>
                      <span className="text-muted-foreground">{w.dropCount} padcev</span>
                      <span className="text-muted-foreground">{w.uniqueSellers} prodajalcev</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{w.recommendation}</p>
                  {w.topDrops?.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Top padci ({w.topDrops.length})</summary>
                      <div className="mt-0.5 space-y-0.5">
                        {w.topDrops.map((d: any, j: number) => (
                          <a key={j} href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 p-0.5 hover:bg-card/50 rounded text-[10px]">
                            <span className="truncate flex-1">{d.title}</span>
                            <span className="text-muted-foreground line-through">{d.previousPrice}€</span>
                            <span className="text-red-500 font-bold">→ {d.currentPrice}€</span>
                            <Badge variant="outline" className="text-[8px] text-red-500 border-red-500/40">-{d.dropPct}%</Badge>
                          </a>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
