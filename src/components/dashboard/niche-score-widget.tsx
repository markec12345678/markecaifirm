'use client';

/**
 * v7.34: NicheScoreWidget — katere kategorije so najbolj donosne?
 *
 * Jungle Scout-style opportunity score per category:
 * - ROI per category
 * - Number of deals (volume)
 * - Competition density (how many listings in that category)
 * - Opportunity score 1-10 (high ROI + high volume + low competition = 10)
 *
 * Helps decide: "V katero kategorijo naj investiram?"
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, TrendingUp, Package, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NicheData {
  ok: boolean;
  totalCategories: number;
  niches: Array<{
    category: string;
    score: number;
    roi: number;
    profit: number;        // v8.35: API vrača 'profit' ne 'totalProfit'
    count: number;          // v8.35: API vrača 'count' ne 'dealsCount'
    avgHoldDays: number;
    avgProfit: number;
    totalInvested: number;
    recommendation: string;
  }>;
  bestNiche: { category: string; roi: number; recommendation: string; score?: number; profit?: number; count?: number } | null;
  worstNiche: { category: string; roi: number; recommendation: string; score?: number; profit?: number; count?: number } | null;
}

export function NicheScoreWidget({ onNavigate }: { onNavigate?: (v: 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'trades' | 'analytics' | 'health' | 'notifications' | 'settings') => void }) {
  const [data, setData] = useState<NicheData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/analytics/niche-score');
        if (!cancelled && res.ok) setData(await res.json());
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-4 text-xs text-muted-foreground">Nalagam nišo analizo...</CardContent>
      </Card>
    );
  }

  if (!data || data.niches.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" /> NIŠA ANALIZA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Ni dovolj prodaj za analizo. Dodaj sold trade-e z izpolnjeno kategorijo.</p>
        </CardContent>
      </Card>
    );
  }

  const top5 = data.niches.slice(0, 5);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" /> NIŠA ANALIZA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.bestNiche && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-2">
            <div className="text-[10px] uppercase text-amber-400 font-bold">🏆 Najboljša niša</div>
            <div className="text-sm font-bold">{data.bestNiche.category}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">ROI: {data.bestNiche.roi >= 0 ? '+' : ''}{data.bestNiche.roi.toFixed(0)}%</div>
          </div>
        )}

        {/* Niche list */}
        <div className="space-y-1.5">
          {top5.map((n, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {/* Rank */}
              <span className={cn(
                'w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] shrink-0',
                i === 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-muted text-muted-foreground'
              )}>
                {i + 1}
              </span>
              {/* Category + score */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{n.category}</span>
                  <Badge variant="outline" className={cn(
                    'text-[9px] px-1 py-0 shrink-0',
                    n.score >= 8 ? 'border-green-500/40 text-green-500' :
                    n.score >= 5 ? 'border-amber-500/40 text-amber-400' :
                    'border-red-500/40 text-red-500'
                  )}>
                    {n.score}/10
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span className={cn('font-mono', n.roi >= 0 ? 'text-green-500' : 'text-red-500')}>
                    {n.roi >= 0 ? '+' : ''}{n.roi}% ROI
                  </span>
                  <span>•</span>
                  <span>{n.count} prodaj</span>
                  <span>•</span>
                  <span>{n.profit >= 0 ? '+' : ''}{n.profit}€</span>
                </div>
              </div>
              {/* Avg hold days indicator (v8.35: replaces competition — API doesn't return it) */}
              <div className="shrink-0 text-right">
                <div className="text-[9px] text-muted-foreground uppercase">⏱ Hold</div>
                <div className="text-[10px] font-bold font-mono">{n.avgHoldDays}d</div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary (v8.35: API doesn't return 'summary' — derive from bestNiche) */}
        <p className="text-[11px] text-muted-foreground italic border-t border-border/30 pt-2 mt-2">
          {data.bestNiche
            ? `Top niša: ${data.bestNiche.category} (ROI ${data.bestNiche.roi >= 0 ? '+' : ''}${data.bestNiche.roi.toFixed(0)}%). ${data.bestNiche.recommendation}`
            : `${data.totalCategories} kategorij analiziranih. Dodaj več prodaj za boljšo analizo.`}
        </p>
      </CardContent>
    </Card>
  );
}
