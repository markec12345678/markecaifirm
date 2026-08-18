/**
 * Pricing Brain Section (v8.21, lime) — 6 pricing signals.
 *
 * Extracted from the original `brain-sections.tsx` (1147 lines) as part of
 * v8.94.8-split-brain. Fetches `/api/ai/brain/pricing`, displays
 * `oneLineSummary` + pricing grade pill + top 3 pricing actions + margin /
 * competitor / sell-through / pricing-power + 30d/90d STRUCTURED projections
 * (projectedMarginPct + projectedRevenue + recommendedPriceChangePct +
 * listingsToReprice), and provides a refresh button.
 *
 * Projection shape: structured objects with margin + revenue + price-change
 * pct + listingsToReprice. Also surfaces `pricingPower` composite (0-100) on
 * `current`.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Coins, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PricingBrainResult } from '../types';
import { gradeColor, confidenceColor } from '../utils';

export function PricingBrainSection() {
  const [data, setData] = useState<PricingBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/pricing', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PricingBrainResult;
      if (!json?.ok) throw new Error(json?.source ? 'Brain ni vrnil rezultata' : 'Napaka');
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrain();
  }, [fetchBrain]);

  return (
    <div className="rounded-lg border border-lime-500/30 bg-gradient-to-br from-lime-500/10 via-green-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Coins className="w-4 h-4 text-lime-600 dark:text-lime-400 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          💶 PRICING BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-lime-500/40 text-lime-700 dark:text-lime-400 shrink-0">
          v8.21
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-lime-500/10" />
          <Skeleton className="h-3 w-3/4 bg-lime-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-lime-500/10" />
            <Skeleton className="h-6 bg-lime-500/10" />
            <Skeleton className="h-6 bg-lime-500/10" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <Button size="sm" variant="outline" onClick={fetchBrain} className="ml-auto h-6 px-2 text-[10px]">
            Ponovi
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-2.5">
          <p className="text-xs sm:text-sm font-medium leading-snug">
            {data.maximization.oneLineSummary}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.pricingGrade))}>
              Pricing: {data.maximization.pricingGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-lime-500/30 text-lime-700 dark:text-lime-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes (pricing)</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-lime-700 dark:text-lime-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · +{a.expectedUpliftEUR}€/mo</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current pricing state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-lime-500/20">
            <span className="text-muted-foreground">
              Margin: <span className="font-bold text-lime-700 dark:text-lime-400">{Math.round(data.current.avgProfitMarginPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Vs komp.: <span className="font-bold text-lime-700 dark:text-lime-400">{data.current.competitorPriceAvgPct > 100 ? '+' : ''}{Math.round(data.current.competitorPriceAvgPct - 100)}%</span>
            </span>
            <span className="text-muted-foreground">
              Sell-through: <span className="font-bold text-lime-700 dark:text-lime-400">{Math.round(data.current.sellThroughRatePct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Pricing power: <span className="font-bold text-lime-700 dark:text-lime-400">{Math.round(data.current.pricingPower)}/100</span>
            </span>
          </div>

          {/* 30d / 90d pricing projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-lime-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-lime-700 dark:text-lime-400">
                {Math.round(data.maximization.projection30d.projectedMarginPct)}% margin · {Math.round(data.maximization.projection30d.projectedRevenue)}€ · {data.maximization.projection30d.recommendedPriceChangePct >= 0 ? '+' : ''}{data.maximization.projection30d.recommendedPriceChangePct}% · {data.maximization.projection30d.listingsToReprice} repr.
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-lime-700 dark:text-lime-400">
                {Math.round(data.maximization.projection90d.projectedMarginPct)}% margin · {Math.round(data.maximization.projection90d.projectedRevenue)}€ · {data.maximization.projection90d.recommendedPriceChangePct >= 0 ? '+' : ''}{data.maximization.projection90d.recommendedPriceChangePct}% · {data.maximization.projection90d.listingsToReprice} repr.
              </span>
            </span>
          </div>

          <div className="flex justify-end">
            <button
              onClick={fetchBrain}
              className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Osveži
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
