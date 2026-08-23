'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CompetitorSellers() {
  const [competitors, setCompetitors] = useState<any>(null);
  const [compLoading, setCompLoading] = useState(false);

  // v6.4: Load competitors
  const loadCompetitors = useCallback(async () => {
    setCompLoading(true);
    try {
      const res = await fetch('/api/sellers/competitors');
      if (res.ok) setCompetitors(await res.json());
    } catch { /* ignore */ }
    finally { setCompLoading(false); }
  }, []);

  return (
    <Card className="bg-card/50 lg:col-span-2 border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Konkurenčni prodajalci
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.4</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Spremljaj druge prodajalce v tvoji niši — kdo spušča cene, kdo je aktiven.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadCompetitors} disabled={compLoading} className="gap-2 h-7 text-xs">
            {compLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
            Skeniraj
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {compLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Analyzing competitors...
          </div>
        ) : !competitors || competitors.competitors?.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Ni konkurentov s 2+ oglasi. Skeniraj z gumbom zgoraj.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Skupno prodajalcev</div>
                <div className="font-mono font-bold">{competitors.totalSellers}</div>
              </div>
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Aktivni (7d)</div>
                <div className="font-mono font-bold text-primary">{competitors.activeCompetitors}</div>
              </div>
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Visoka grožnja</div>
                <div className="font-mono font-bold text-red-500">{competitors.highThreatCount}</div>
              </div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {competitors.competitors.slice(0, 15).map((c: any, i: number) => (
                <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded text-xs border',
                  c.threatLevel === 'high' ? 'bg-red-500/5 border-red-500/20' :
                  c.threatLevel === 'medium' ? 'bg-amber-400/5 border-amber-400/20' :
                  'bg-background/30 border-border')}>
                  <Badge variant="outline" className={cn('text-[9px] shrink-0',
                    c.threatLevel === 'high' ? 'text-red-500 border-red-500/40' :
                    c.threatLevel === 'medium' ? 'text-amber-400 border-amber-400/40' : 'text-muted-foreground')}>
                    {c.threatLevel === 'high' ? '🔴' : c.threatLevel === 'medium' ? '🟡' : '🟢'} {c.threatLevel}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.sellerName}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {c.listingCount} oglasov • povp {c.avgPrice}€ • {c.sources.join(', ')}
                      {c.priceDrops > 0 && <span className="text-amber-400"> • {c.priceDrops}× padec cene</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-[10px]">
                    {c.recentActivity === 'active' && <Badge variant="outline" className="text-[8px] text-primary border-primary/40">⚡ AKTIVEN</Badge>}
                    <div className="text-muted-foreground">{c.daysActive}d aktiven</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
