'use client';

// v8.68: Buy Opportunity Summary Card
// "Of 20 recent listings: 3 STRONG_BUY, 7 BUY, 8 CONSIDER, 2 AVOID.
//  Top opportunity: iPhone 13 Pro 256GB — 450€ (85/100, +28% expected ROI)"

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShoppingCart, RefreshCw, TrendingUp, Target, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuyOpportunity {
  listingId: string;
  title: string;
  price: number | null;
  category: string;
  score: number;
  verdict: 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'AVOID';
  expectedROI: number | null;
  expectedProfit: number | null;
  suggestedMaxBuyPrice: number | null;
  discountPercent: number | null;
  confidence: number;
  confidenceLabel: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}

interface BuyOpportunityData {
  ok: boolean;
  total: number;
  strongBuys: BuyOpportunity[];
  buys: BuyOpportunity[];
  considers: BuyOpportunity[];
  avoids: BuyOpportunity[];
  top5: BuyOpportunity[];
}

const verdictMeta = {
  STRONG_BUY: { label: 'Močna kupnina', icon: '🟢', color: 'text-emerald-500', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  BUY: { label: 'Kupi', icon: '✓', color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  CONSIDER: { label: 'Premisli', icon: '🟡', color: 'text-amber-600', bg: 'bg-amber-500/10 border-amber-500/30' },
  AVOID: { label: 'Izogibaj', icon: '✗', color: 'text-red-500', bg: 'bg-red-500/15 border-red-500/30' },
};

export function BuyOpportunitySummaryCard() {
  const { data, loading, error, refetch } = useFetch<BuyOpportunityData>('/api/analytics/buy-opportunity?limit=20', { interval: 120000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary" /> 🛒 Buy Opportunity</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="stats" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary" /> 🛒 Buy Opportunity</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  if (data.total === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary" /> 🛒 Buy Opportunity</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">Še ni oglasov za analizo.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Poženi monitorje za scraping in AI evalvacijo.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const counts = {
    STRONG_BUY: data.strongBuys.length,
    BUY: data.buys.length,
    CONSIDER: data.considers.length,
    AVOID: data.avoids.length,
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary" /> 🛒 Buy Opportunity</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Verdict distribution */}
        <div>
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Porazdelitev {data.total} oglasov</div>
          <div className="flex h-6 rounded-md overflow-hidden border border-border">
            {(['STRONG_BUY', 'BUY', 'CONSIDER', 'AVOID'] as const).map(v => {
              const count = counts[v];
              const pct = data.total > 0 ? (count / data.total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={v}
                  className={cn('flex items-center justify-center text-[9px] font-bold', verdictMeta[v].bg, verdictMeta[v].color)}
                  style={{ width: `${pct}%` }}
                  title={`${verdictMeta[v].label}: ${count} (${pct.toFixed(0)}%)`}
                >
                  {pct > 12 && count}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-1.5 text-[9px]">
            {(['STRONG_BUY', 'BUY', 'CONSIDER', 'AVOID'] as const).filter(v => counts[v] > 0).map(v => (
              <span key={v} className="flex items-center gap-0.5">
                <span className={cn('inline-block w-2 h-2 rounded-sm', verdictMeta[v].bg)} />
                <span className={verdictMeta[v].color}>{verdictMeta[v].label}</span>
                <span className="text-muted-foreground">{counts[v]}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Top 3 opportunities */}
        {data.top5.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> Top 3 priložnosti</div>
            <div className="space-y-1.5">
              {data.top5.slice(0, 3).map((opp, i) => {
                const meta = verdictMeta[opp.verdict];
                return (
                  <div key={opp.listingId} className={cn('rounded-md border p-2 flex items-center gap-2', meta.bg)}>
                    <span className="text-[10px] font-bold text-muted-foreground shrink-0">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" title={opp.title}>{opp.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {opp.price != null ? `${opp.price}€` : 'brez cene'}
                        {opp.expectedROI != null && <span className="text-emerald-600 ml-1.5">+{opp.expectedROI.toFixed(0)}% ROI</span>}
                        {opp.discountPercent != null && opp.discountPercent > 0 && <span className="text-primary ml-1.5">-{opp.discountPercent.toFixed(0)}% pod oceno</span>}
                      </div>
                    </div>
                    <div className={cn('text-xs font-bold shrink-0', meta.color)}>
                      {meta.icon} {opp.score}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats footer */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
          <span className="flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> {counts.STRONG_BUY + counts.BUY} za kupnino</span>
          <span className="flex items-center gap-0.5"><AlertCircle className="w-3 h-3 text-amber-500" /> {counts.CONSIDER} premislek</span>
          <span className="flex items-center gap-0.5"><XCircle className="w-3 h-3 text-red-500" /> {counts.AVOID} izogib</span>
        </div>
      </CardContent>
    </Card>
  );
}
