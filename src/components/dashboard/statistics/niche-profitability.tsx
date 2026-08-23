'use client';

// v9.01: Extracted from statistics-view.tsx — Niche Profitability Tracker (v6.3)

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award } from 'lucide-react';
import { cn } from '@/lib/utils';

export function NicheProfitability() {
  // v6.3: Niche profitability
  const [nicheData, setNicheData] = useState<any>(null);
  const [nicheLoading, setNicheLoading] = useState(false);

  // v6.3: Load niche profitability
  const loadNiche = useCallback(async () => {
    setNicheLoading(true);
    try {
      const res = await fetch('/api/trades/niche-profitability');
      if (res.ok) setNicheData(await res.json());
    } catch { /* ignore */ }
    finally { setNicheLoading(false); }
  }, []);

  useEffect(() => { loadNiche(); }, [loadNiche]);

  return (
    <>
      {/* v6.3: Niche Profitability Tracker */}
      {nicheData && !nicheLoading && (
        <Card className="bg-card/50 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" />
              Profitabilnost niš (kategorij)
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.3</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Katere kategorije so najbolj profitabilne? AI priporoča na kaj se osredotočiti.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {nicheData.summary ? (
              <div className="space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Skupno</div>
                    <div className={cn('font-mono font-bold text-lg', nicheData.summary.totalProfit >= 0 ? 'text-primary' : 'text-red-500')}>
                      {nicheData.summary.totalProfit >= 0 ? '+' : ''}{nicheData.summary.totalProfit}€
                    </div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">ROI</div>
                    <div className="font-mono font-bold text-primary">{nicheData.summary.overallRoi}%</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Prodani</div>
                    <div className="font-mono font-bold">{nicheData.summary.totalSold}</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">V skladišču</div>
                    <div className="font-mono font-bold text-amber-400">{nicheData.summary.totalHeld}</div>
                  </div>
                </div>

                {/* Best/Worst niche */}
                {nicheData.summary.bestNiche && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs">
                    <span className="text-primary font-bold">🏆 Najboljša: </span>
                    {nicheData.summary.bestNiche.category} ({nicheData.summary.bestNiche.avgRoi}% ROI)
                  </div>
                )}
                {nicheData.summary.worstNiche && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-2 text-xs">
                    <span className="text-red-500 font-bold">🔴 Najslabša: </span>
                    {nicheData.summary.worstNiche.category} ({nicheData.summary.worstNiche.avgRoi}% ROI)
                  </div>
                )}

                {/* Niche list */}
                <div className="space-y-1.5">
                  {nicheData.niches.map((n: any, i: number) => (
                    <div key={i} className={cn('flex items-center gap-2 p-2 rounded text-xs border',
                      n.score >= 70 ? 'bg-primary/5 border-primary/20' :
                      n.score >= 50 ? 'bg-amber-400/5 border-amber-400/20' :
                      'bg-red-500/5 border-red-500/20')}>
                      <Badge variant="outline" className="text-[9px] shrink-0">{n.category}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('font-mono font-bold', n.avgRoi > 0 ? 'text-primary' : 'text-red-500')}>
                            {n.avgRoi > 0 ? '+' : ''}{n.avgRoi}% ROI
                          </span>
                          <span className="text-muted-foreground">{n.soldCount} prodanih</span>
                          {n.avgDaysToSell != null && <span className="text-muted-foreground">~{n.avgDaysToSell}d prodaja</span>}
                          <span className="text-muted-foreground">{n.sellThroughRate}% sell-through</span>
                        </div>
                        <div className="text-[10px] italic mt-0.5">{n.recommendation}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cn('font-mono font-bold', n.totalProfit >= 0 ? 'text-primary' : 'text-red-500')}>
                          {n.totalProfit >= 0 ? '+' : ''}{n.totalProfit}€
                        </div>
                        <div className="text-[9px] text-muted-foreground">investirano: {n.totalInvested}€</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">Ni podatkov o tradeih.</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
