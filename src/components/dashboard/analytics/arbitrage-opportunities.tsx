'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitCompare, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ArbitrageOpportunities() {
  const [arbitrage, setArbitrage] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/arbitrage');
        if (res.ok && !cancelled) setArbitrage(await res.json());
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!arbitrage || !arbitrage.opportunities || arbitrage.opportunities.length === 0) return null;

  return (
    <Card className="bg-card/50 lg:col-span-2 border-primary/30">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-primary" />
          Arbitražne priložnosti ({arbitrage.total})
        </CardTitle>
        <CardDescription>
          Ista artikla na različnih portalih z različnimi cenami — kupi poceni, prodaj drago.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {arbitrage.opportunities.slice(0, 10).map((opp: any, i: number) => (
            <div key={i} className="p-2 bg-background/30 rounded border border-border">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium truncate flex-1">{opp.title}</span>
                <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
                  💰 +{opp.potentialProfit}€ ({opp.profitPct}%)
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {opp.listings.map((l: any, j: number) => (
                  <a key={j} href={l.url} target="_blank" rel="noopener noreferrer" className={cn(
                    'flex items-center justify-between gap-1 p-1.5 rounded hover:bg-card/50 transition-colors',
                    l.price === opp.cheapestPrice && 'bg-primary/5 border border-primary/20'
                  )}>
                    <span className="text-muted-foreground truncate">{l.source}</span>
                    <span className={cn('font-mono', l.price === opp.cheapestPrice ? 'text-primary font-bold' : 'text-amber-400')}>
                      {l.price}€ <ExternalLink className="w-2.5 h-2.5 inline" />
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
