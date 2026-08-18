/**
 * Buyer Brain Section (v8.20, cyan/teal) — 6 buyer signals.
 *
 * Extracted from the original `brain-sections.tsx` (1147 lines) as part of
 * v8.94.8-split-brain. Fetches `/api/ai/brain/buyer`, displays
 * `oneLineSummary` + buyer grade pill + top 3 cultivation actions + buyer
 * count / churn / growth / LTV + 30d/90d STRUCTURED projections
 * (projectedActiveBuyers + projectedLTV + projectedChurnRatePct +
 * recommendedOutreachCount), and provides a refresh button.
 *
 * Projection shape: structured objects with buyer-count + LTV + outreach.
 * Each signal has standard score + grade + uplift (NOT inverted like Risk).
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, RefreshCw, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BuyerBrainResult } from '../types';
import { gradeColor, confidenceColor } from '../utils';

export function BuyerBrainSection() {
  const [data, setData] = useState<BuyerBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/buyer', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BuyerBrainResult;
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
    <div className="rounded-lg border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-teal-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Users className="w-4 h-4 text-cyan-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          👥 BUYER BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-600 dark:text-cyan-400 shrink-0">
          v8.20
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-cyan-500/10" />
          <Skeleton className="h-3 w-3/4 bg-cyan-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-cyan-500/10" />
            <Skeleton className="h-6 bg-cyan-500/10" />
            <Skeleton className="h-6 bg-cyan-500/10" />
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
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.buyerGrade))}>
              Buyer: {data.maximization.buyerGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes (kultivacija)</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-cyan-600 dark:text-cyan-400 shrink-0 w-3">
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

          {/* Current buyer state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-cyan-500/20">
            <span className="text-muted-foreground">
              Kupcev: <span className="font-bold text-cyan-600 dark:text-cyan-400">{data.current.totalBuyers}</span>
            </span>
            <span className="text-muted-foreground">
              Aktivnih: <span className="font-bold text-cyan-600 dark:text-cyan-400">{data.current.activeBuyersLast30d}</span>
            </span>
            <span className="text-muted-foreground">
              Churn: <span className="font-bold text-cyan-600 dark:text-cyan-400">{Math.round(data.current.churnRatePct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Rast: <span className="font-bold text-cyan-600 dark:text-cyan-400">{data.current.netGrowthPct >= 0 ? '+' : ''}{Math.round(data.current.netGrowthPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              LTV: <span className="font-bold text-cyan-600 dark:text-cyan-400">{Math.round(data.current.avgBuyerLifetimeValue)}€</span>
            </span>
          </div>

          {/* 30d / 90d buyer projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-cyan-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-cyan-600 dark:text-cyan-400">
                {Math.round(data.maximization.projection30d.projectedActiveBuyers)} aktivnih · LTV {Math.round(data.maximization.projection30d.projectedLTV)}€ · kontaktiraj {data.maximization.projection30d.recommendedOutreachCount}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-cyan-600 dark:text-cyan-400">
                {Math.round(data.maximization.projection90d.projectedActiveBuyers)} aktivnih · LTV {Math.round(data.maximization.projection90d.projectedLTV)}€ · kontaktiraj {data.maximization.projection90d.recommendedOutreachCount}
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
