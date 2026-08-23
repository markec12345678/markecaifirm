'use client';

// v8.97: Inventory Brain section extracted from ai-hub-view.tsx (v8.16, amber).
// Self-contained — fetches /api/ai/brain/inventory on mount, renders top 3 actions
// + 30d/90d inventory projection (recommendedItemsToSell/Buy + value + turnover).

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InventoryBrainResult } from './types';
import { gradeColor, confidenceColor } from './utils';

export function InventoryBrainSection() {
  const [data, setData] = useState<InventoryBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/inventory', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as InventoryBrainResult;
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
    <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Package className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          📦 INVENTORY BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0">
          v8.16
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-amber-500/10" />
          <Skeleton className="h-3 w-3/4 bg-amber-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-amber-500/10" />
            <Skeleton className="h-6 bg-amber-500/10" />
            <Skeleton className="h-6 bg-amber-500/10" />
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
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.inventoryGrade))}>
              Inventory: {data.maximization.inventoryGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400">
              Top: {data.maximization.bestOpportunity.toUpperCase()}
            </Badge>
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-amber-600 dark:text-amber-400 shrink-0 w-3">
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

          {/* 30d projection (structured, inventory-specific) */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-amber-500/20">
            <span className="text-muted-foreground">
              Sedaj: <span className="font-bold text-foreground">{data.current.itemCount} itemov</span>
            </span>
            <span className="text-muted-foreground">
              Vrednost: <span className="font-bold text-foreground">{Math.round(data.current.totalInventoryValue)}€</span>
            </span>
            <span className="text-muted-foreground">
              Staranje: <span className="font-bold text-amber-600 dark:text-amber-400">{Math.round(data.current.agedItemsPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Turnover: <span className="font-bold text-amber-600 dark:text-amber-400">{data.current.inventoryTurnoverRate.toFixed(2)}/mo</span>
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-amber-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-amber-600 dark:text-amber-400">
                prodaj {data.maximization.projection30d.recommendedItemsToSell} · kupi {data.maximization.projection30d.recommendedItemsToBuy}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-amber-600 dark:text-amber-400">
                {Math.round(data.maximization.projection90d.projectedInventoryValue)}€ · turnover {data.maximization.projection90d.projectedTurnoverRate.toFixed(2)}/mo
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
