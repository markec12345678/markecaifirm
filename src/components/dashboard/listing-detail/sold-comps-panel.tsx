'use client';

/**
 * v7.37: SoldCompsPanel — "za koliko so se podobni item-i PRODALI?"
 *
 * THE #1 feature of Keepa ($19/mo). Without sold comps, you're guessing.
 * With comps: "iPhone 13 sold 5x for avg 320€ — this listing at 250€ = real 70€ margin"
 *
 * Fetches from /api/analytics/sold-comps with listing title + asking price.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Target, DollarSign, Sparkles, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SoldCompsData {
  ok: boolean;
  fairMarketValue: number;
  confidence: number;
  marginEur: number;
  marginPct: number;
  isRealDeal: boolean;
  marketStats: {
    avgSoldPriceEur: number;
    minSoldPriceEur: number;
    maxSoldPriceEur: number;
    sampleSize: number;
    avgDaysToSell: number;
  };
  comps: Array<{ title: string; soldPriceEur: number; daysAgo: number; similarity: number; platform: string }>;
  recommendation: string;
  riskFactors: string[];
}

export function SoldCompsPanel({ listingId, title, askingPrice }: {
  listingId: string;
  title: string;
  askingPrice: number | null;
}) {
  const [data, setData] = useState<SoldCompsData | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchComps() {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics/sold-comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, askingPrice }),
      });
      const json = await res.json();
      if (json.ok) setData(json);
      else toast.error(json.error || 'Napaka');
    } catch (e: unknown) {
      toast.error((e as Error)?.message || 'Napaka');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className={cn('border', data?.isRealDeal ? 'border-green-500/30' : 'border-primary/20')}>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" /> SOLD COMPS
          </h4>
          {data && (
            <Badge variant="outline" className={cn('text-[10px]', data.isRealDeal ? 'border-green-500/40 text-green-500' : 'border-red-500/40 text-red-500')}>
              {data.isRealDeal ? '✓ REAL DEAL' : '✗ NE'}
            </Badge>
          )}
        </div>

        {!data && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              AI primerja z zgodovino prodanih itemov. Pove če je deal resničen.
            </p>
            <Button onClick={fetchComps} disabled={loading} size="sm" className="w-full bg-gradient-to-r from-primary to-primary/80">
              {loading ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
                  Iskanje comps...
                </>
              ) : (
                <>
                  <Target className="w-3.5 h-3.5 mr-1.5" />
                  Najdi prodane comps
                </>
              )}
            </Button>
          </div>
        )}

        {data && (
          <>
            {/* Fair market value — big */}
            <div className="text-center py-2">
              <div className="text-[10px] text-muted-foreground uppercase">Tržna vrednost</div>
              <div className="text-2xl font-mono font-bold text-primary">{data.fairMarketValue}€</div>
              {askingPrice && (
                <div className={cn('text-sm font-mono font-bold', data.marginEur >= 0 ? 'text-green-500' : 'text-red-500')}>
                  {data.marginEur >= 0 ? '+' : ''}{data.marginEur}€ margin ({data.marginPct}%)
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">Confidence: {data.confidence}%</div>
            </div>

            {/* Market stats */}
            <div className="grid grid-cols-4 gap-1 text-xs">
              <div className="bg-background/30 rounded p-1 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Min</div>
                <div className="font-mono font-bold text-green-500">{data.marketStats.minSoldPriceEur}€</div>
              </div>
              <div className="bg-background/30 rounded p-1 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Ø</div>
                <div className="font-mono font-bold">{data.marketStats.avgSoldPriceEur}€</div>
              </div>
              <div className="bg-background/30 rounded p-1 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Max</div>
                <div className="font-mono font-bold text-red-500">{data.marketStats.maxSoldPriceEur}€</div>
              </div>
              <div className="bg-background/30 rounded p-1 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Prod. čas</div>
                <div className="font-mono font-bold">{data.marketStats.avgDaysToSell}d</div>
              </div>
            </div>

            {/* Comps list */}
            {data.comps.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase">Prodani podobni itemi ({data.comps.length})</div>
                {data.comps.slice(0, 5).map((comp, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-background/30 rounded">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{comp.title}</div>
                      <div className="text-[10px] text-muted-foreground">{comp.daysAgo}d nazaj • {comp.platform} • match {comp.similarity}%</div>
                    </div>
                    <div className="font-mono font-bold shrink-0 ml-2">{comp.soldPriceEur}€</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recommendation */}
            <div className={cn('p-2 rounded text-xs flex items-start gap-1.5', data.isRealDeal ? 'bg-green-500/10' : 'bg-red-500/10')}>
              {data.isRealDeal ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />}
              <span className="text-muted-foreground">{data.recommendation}</span>
            </div>

            {/* Risk factors */}
            {data.riskFactors.length > 0 && (
              <div className="space-y-0.5">
                {data.riskFactors.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{r}</span>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={fetchComps} variant="ghost" size="sm" className="w-full text-xs">↻ Osveži</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
