'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, GitCompare } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CrossPortalArbitrage() {
  const [crossPortal, setCrossPortal] = useState<Record<string, any> | null>(null);
  const [crossPortalLoading, setCrossPortalLoading] = useState(false);
  const [crossPortalThreshold, setCrossPortalThreshold] = useState(20);

  const loadCrossPortal = useCallback(async (threshold: number = 20) => {
    setCrossPortalLoading(true);
    try {
      const res = await fetch(`/api/arbitrage/cross-portal?threshold=${threshold}&limit=50`);
      if (res.ok) setCrossPortal(await res.json());
    } catch { /* ignore */ }
    finally { setCrossPortalLoading(false); }
  }, []);

  useEffect(() => { loadCrossPortal(crossPortalThreshold); }, [loadCrossPortal, crossPortalThreshold]);

  return (
    <Card className="bg-card/50 lg:col-span-2 border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-primary" />
              Cross-Portal Arbitraža
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.2</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Isti izdelki na različnih portalih (Bolha ↔ Avtonet ↔ Vinted) z različnimi cenami.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Min razlika:</span>
            <select
              value={crossPortalThreshold}
              onChange={(e) => setCrossPortalThreshold(parseInt(e.target.value, 10))}
              className="bg-card border border-border rounded px-2 py-1 text-xs"
            >
              <option value={10}>10%</option>
              <option value={20}>20%</option>
              <option value={30}>30%</option>
              <option value={50}>50%</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => loadCrossPortal(crossPortalThreshold)}
              disabled={crossPortalLoading}
            >
              {crossPortalLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {crossPortalLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Analyzing cross-portal opportunities...
          </div>
        ) : !crossPortal || crossPortal.opportunities?.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {crossPortal?.stats?.totalListingsAnalyzed != null && (
              <p className="mb-2">Analiziranih {crossPortal.stats.totalListingsAnalyzed} oglasov iz {crossPortal.stats.groupsFound} grup.</p>
            )}
            <p>Ni cross-portal priložnosti s to minimalno razliko. Poskusi znižati threshold.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Priložnosti</div>
                <div className="font-mono font-bold text-primary">{crossPortal.stats.opportunitiesFound}</div>
              </div>
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Povp. razlika</div>
                <div className="font-mono font-bold">{crossPortal.stats.avgPriceDiffPct}%</div>
              </div>
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Skupni profit</div>
                <div className="font-mono font-bold text-primary">{crossPortal.stats.totalPotentialProfit}€</div>
              </div>
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Analizirano</div>
                <div className="font-mono">{crossPortal.stats.totalListingsAnalyzed}</div>
              </div>
            </div>

            {/* Source pairs */}
            {Object.keys(crossPortal.stats.bySourcePair).length > 0 && (
              <div className="bg-background/30 rounded p-2 text-[11px]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Par portalov</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(crossPortal.stats.bySourcePair).map(([pair, count]: [string, unknown]) => (
                    <Badge key={pair} variant="outline" className="text-[10px]">
                      {pair}: {String(count)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Opportunities list */}
            <div className="space-y-2">
              {crossPortal.opportunities.slice(0, 15).map((opp: Record<string, any>, i: number) => (
                <div key={i} className="p-2 bg-background/30 rounded border border-border">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-medium truncate flex-1" title={opp.title}>{opp.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {opp.sourceCount} portalov
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                        💰 +{opp.profit}€ ({opp.priceDiffPct}%)
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                    {opp.sources.map((s: Record<string, any>, j: number) => (
                      <a
                        key={j}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'flex items-center justify-between gap-1 p-1.5 rounded hover:bg-card/50 transition-colors',
                          s.price === opp.cheapestPrice && 'bg-primary/5 border border-primary/20'
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {s.imageUrl && (
                            <img
                              src={s.imageUrl}
                              alt=""
                              className="w-6 h-6 object-cover rounded shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="text-muted-foreground truncate">{s.source}</div>
                            <div className="text-[9px] text-muted-foreground truncate">{s.monitorName}</div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={cn('font-mono', s.price === opp.cheapestPrice ? 'text-primary font-bold' : 'text-amber-400')}>
                            {s.price}€
                          </div>
                          {s.dealScore != null && (
                            <div className="text-[9px] text-primary">🎯 {s.dealScore}</div>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              💡 Kupi najcenejši, prodaj drago. Pazi na stroške dostave in provizije.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
