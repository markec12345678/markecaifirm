/**
 * 7 Domain Brain Sections — detailed drill-down cards.
 *
 * Extracted from the original monolithic `ai-hub-view.tsx` (8217 lines) as
 * part of v8.94.5-split. Each section fetches its respective /api/ai/brain/*
 * endpoint, displays signals + projections + grade pill, and provides a
 * refresh button.
 *
 * Sections:
 *   - ProfitBrainSection  (v8.15, emerald)   — 6 profit signals
 *   - InventoryBrainSection (v8.16, amber)   — 6 inventory signals
 *   - MarketBrainSection  (v8.17, sky/blue)  — 6 market signals
 *   - SourcingBrainSection (v8.18, violet)   — 6 sourcing signals
 *   - RiskBrainSection    (v8.19, red/rose)  — 6 risk signals
 *   - BuyerBrainSection   (v8.20, cyan/teal) — 6 buyer signals
 *   - PricingBrainSection (v8.21, lime)      — 6 pricing signals
 *
 * All seven sections fetch in parallel on mount (in BrainSynthesisCard via
 * parallel render). Each has its own loading skeleton, error state, refresh
 * button, and cache indicator.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  Brain,
  Coins,
  Package,
  RefreshCw,
  Shield,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  BrainResult,
  InventoryBrainResult,
  MarketBrainResult,
  SourcingBrainResult,
  RiskBrainResult,
  BuyerBrainResult,
  PricingBrainResult,
} from './types';
import { gradeColor, confidenceColor, riskLevelColor } from './utils';

export function ProfitBrainSection() {
  const [data, setData] = useState<BrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/profit', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BrainResult;
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
    <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Brain className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🧠 PROFIT BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
          v8.15
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-emerald-500/10" />
          <Skeleton className="h-3 w-3/4 bg-emerald-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-emerald-500/10" />
            <Skeleton className="h-6 bg-emerald-500/10" />
            <Skeleton className="h-6 bg-emerald-500/10" />
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
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.profitGrade))}>
              Profit: {data.maximization.profitGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
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
                <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0 w-3">
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

          <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-emerald-500/20">
            <span className="text-muted-foreground">
              Trenutno: <span className="font-bold text-foreground">{Math.round(data.current.monthlyProfit)}€/mo</span>
            </span>
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-emerald-600 dark:text-emerald-400">{Math.round(data.maximization.projection30d)}€/mo</span>
              {' · '}
              90d: <span className="font-bold text-emerald-600 dark:text-emerald-400">{Math.round(data.maximization.projection90d)}€/mo</span>
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

// --- Inventory Brain section (v8.16, amber) --------------------------------

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

// --- Market Brain section (v8.17, sky/blue) --------------------------------

export function MarketBrainSection() {
  const [data, setData] = useState<MarketBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/market', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MarketBrainResult;
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

  const phaseColor = (phase: string): string => {
    switch (phase) {
      case 'MARKUP':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'ACCUMULATION':
        return 'text-sky-600 dark:text-sky-400';
      case 'DISTRIBUTION':
        return 'text-amber-600 dark:text-amber-400';
      case 'MARKDOWN':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-foreground';
    }
  };

  const actionColor = (action: string): string => {
    switch (action) {
      case 'BUY':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'SELL':
        return 'text-amber-600 dark:text-amber-400';
      case 'HOLD':
        return 'text-sky-600 dark:text-sky-400';
      case 'LIQUIDATE':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-foreground';
    }
  };

  return (
    <div className="rounded-lg border border-sky-500/30 bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <TrendingUp className="w-4 h-4 text-sky-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          📈 MARKET BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-600 dark:text-sky-400 shrink-0">
          v8.17
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-sky-500/10" />
          <Skeleton className="h-3 w-3/4 bg-sky-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-sky-500/10" />
            <Skeleton className="h-6 bg-sky-500/10" />
            <Skeleton className="h-6 bg-sky-500/10" />
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
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.marketGrade))}>
              Market: {data.maximization.marketGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-600 dark:text-sky-400">
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
                <span className="font-bold text-sky-600 dark:text-sky-400 shrink-0 w-3">
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

          {/* Current market state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-sky-500/20">
            <span className="text-muted-foreground">
              Faza: <span className={cn('font-bold', phaseColor(data.current.inferredCyclePhase))}>{data.current.inferredCyclePhase}</span>
            </span>
            <span className="text-muted-foreground">
              Sentiment: <span className={cn('font-bold', phaseColor(data.current.inferredSentiment === 'BULLISH' ? 'MARKUP' : data.current.inferredSentiment === 'BEARISH' ? 'MARKDOWN' : 'DISTRIBUTION'))}>{data.current.inferredSentiment}</span>
            </span>
            <span className="text-muted-foreground">
              Oglasi: <span className="font-bold text-foreground">{data.current.activeListingCount}</span>
            </span>
            <span className="text-muted-foreground">
              Sell-through: <span className="font-bold text-foreground">{Math.round(data.current.sellThroughRatePct)}%</span>
            </span>
          </div>

          {/* 30d / 90d phase projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-sky-500/10">
            <span className="text-muted-foreground">
              30d: <span className={cn('font-bold', phaseColor(data.maximization.projection30d.predictedPhase))}>
                {data.maximization.projection30d.predictedPhase}
              </span>
              {' '}
              <span className="text-muted-foreground">
                ({data.maximization.projection30d.predictedPriceChangePct >= 0 ? '+' : ''}
                {data.maximization.projection30d.predictedPriceChangePct.toFixed(1)}%)
              </span>
              {' → '}
              <span className={cn('font-bold', actionColor(data.maximization.projection30d.recommendedAction))}>
                {data.maximization.projection30d.recommendedAction}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className={cn('font-bold', phaseColor(data.maximization.projection90d.predictedPhase))}>
                {data.maximization.projection90d.predictedPhase}
              </span>
              {' '}
              <span className="text-muted-foreground">
                ({data.maximization.projection90d.predictedPriceChangePct >= 0 ? '+' : ''}
                {data.maximization.projection90d.predictedPriceChangePct.toFixed(1)}%)
              </span>
              {' → '}
              <span className={cn('font-bold', actionColor(data.maximization.projection90d.recommendedAction))}>
                {data.maximization.projection90d.recommendedAction}
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

// --- Sourcing Brain section (v8.18, purple/violet) -------------------------

// v8.18: Sourcing Brain result — different `current` shape (per-source array)
// and different `maximization` shape (projection30d/projection90d are STRUCTURED
// objects with recommendedSourceToScale + recommendedSourceToReduce +
// projectedConcentrationPct + recommendedNewSource). Distinct from Profit
// (scalars), Inventory (recommendedItemsToSell/Buy + projectedInventoryValue),
// and Market (predictedPhase + predictedPriceChangePct + recommendedAction).
export function SourcingBrainSection() {
  const [data, setData] = useState<SourcingBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/sourcing', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SourcingBrainResult;
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
    <div className="rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Target className="w-4 h-4 text-purple-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🎯 SOURCING BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400 shrink-0">
          v8.18
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-purple-500/10" />
          <Skeleton className="h-3 w-3/4 bg-purple-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-purple-500/10" />
            <Skeleton className="h-6 bg-purple-500/10" />
            <Skeleton className="h-6 bg-purple-500/10" />
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
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.sourcingGrade))}>
              Sourcing: {data.maximization.sourcingGrade}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 dark:text-purple-400">
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
                <span className="font-bold text-purple-600 dark:text-purple-400 shrink-0 w-3">
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

          {/* Current sourcing state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-purple-500/20">
            <span className="text-muted-foreground">
              Virov: <span className="font-bold text-foreground">{data.current.sourceCount}</span>
            </span>
            <span className="text-muted-foreground">
              Najboljši: <span className="font-bold text-purple-600 dark:text-purple-400">{data.current.bestSource}</span>
            </span>
            <span className="text-muted-foreground">
              Najslabši: <span className="font-bold text-foreground">{data.current.worstSource}</span>
            </span>
            <span className="text-muted-foreground">
              Koncentracija: <span className="font-bold text-purple-600 dark:text-purple-400">{Math.round(data.current.concentrationPct)}%</span>
            </span>
          </div>

          {/* 30d / 90d sourcing projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-purple-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-purple-600 dark:text-purple-400">
                ↑ {data.maximization.projection30d.recommendedSourceToScale} · ↓ {data.maximization.projection30d.recommendedSourceToReduce}
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-purple-600 dark:text-purple-400">
                {Math.round(data.maximization.projection90d.projectedTotalMonthlyProfit)}€/mo
                {data.maximization.projection90d.recommendedNewSource ? ` · +${data.maximization.projection90d.recommendedNewSource}` : ''}
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

// --- Risk Brain section (v8.19, red/rose) ----------------------------------
//
// v8.19: Risk Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedRiskScore + projectedConcentrationPct +
// projectedAgedPct + recommendedRiskBudget. Each signal has a `riskLevel`
// (LOW/MEDIUM/HIGH/CRITICAL) inverse to score, and `riskReductionEUR` (EUR
// saved if mitigated). Distinct from all four prior Brains.
export function RiskBrainSection() {
  const [data, setData] = useState<RiskBrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBrain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/brain/risk', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RiskBrainResult;
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

  const biggestRiskSignal = data?.signals.find(
    (s) => s.name === data.maximization.biggestRisk,
  );

  return (
    <div className="rounded-lg border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Shield className="w-4 h-4 text-rose-500 shrink-0" />
        <span className="text-sm sm:text-base font-bold tracking-tight">
          🛡️ RISK BRAIN
        </span>
        <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-600 dark:text-rose-400 shrink-0">
          v8.19
        </Badge>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full bg-rose-500/10" />
          <Skeleton className="h-3 w-3/4 bg-rose-500/10" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-6 bg-rose-500/10" />
            <Skeleton className="h-6 bg-rose-500/10" />
            <Skeleton className="h-6 bg-rose-500/10" />
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
            <Badge variant="outline" className={cn('text-[10px]', gradeColor(data.maximization.riskGrade))}>
              Risk: {data.maximization.riskGrade}
            </Badge>
            {biggestRiskSignal && (
              <Badge variant="outline" className={cn('text-[10px]', riskLevelColor(biggestRiskSignal.riskLevel))}>
                Top: {data.maximization.biggestRisk.toUpperCase()}
              </Badge>
            )}
            {data.cachedAt && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-muted">
                cache {Math.round((Date.now() - data.cachedAt) / 1000)}s
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[9px] uppercase text-muted-foreground">Top 3 akcije za danes (mitigacija)</div>
            {data.maximization.topActions.map((a) => (
              <div key={a.rank} className="flex items-start gap-1.5 text-[11px]">
                <span className="font-bold text-rose-600 dark:text-rose-400 shrink-0 w-3">
                  {a.rank}.
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground"> · -{a.expectedUpliftEUR}€/mo tveganja</span>
                </span>
                <span className={cn('text-[9px] font-bold shrink-0', confidenceColor(a.confidence))}>
                  {a.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Current risk state */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-rose-500/20">
            <span className="text-muted-foreground">
              Tveganje: <span className="font-bold text-rose-600 dark:text-rose-400">{Math.round(data.current.overallRiskScore)}/100</span>
            </span>
            <span className="text-muted-foreground">
              Koncentracija: <span className="font-bold text-rose-600 dark:text-rose-400">{Math.round(data.current.capitalConcentrationPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Stari inventar: <span className="font-bold text-rose-600 dark:text-rose-400">{Math.round(data.current.agedPct)}%</span>
            </span>
            <span className="text-muted-foreground">
              Fraud: <span className="font-bold text-rose-600 dark:text-rose-400">{data.current.fraudSuspicionsPct.toFixed(1)}%</span>
            </span>
          </div>

          {/* 30d / 90d risk projection */}
          <div className="flex items-center justify-between gap-2 text-[10px] pt-1 border-t border-rose-500/10">
            <span className="text-muted-foreground">
              30d: <span className="font-bold text-rose-600 dark:text-rose-400">
                {Math.round(data.maximization.projection30d.projectedRiskScore)}/100 · budget {Math.round(data.maximization.projection30d.recommendedRiskBudget)}€
              </span>
            </span>
            <span className="text-muted-foreground">
              90d: <span className="font-bold text-rose-600 dark:text-rose-400">
                {Math.round(data.maximization.projection90d.projectedRiskScore)}/100 · budget {Math.round(data.maximization.projection90d.recommendedRiskBudget)}€
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

// --- Buyer Brain section (v8.20, cyan/teal) ---------------------------------
//
// v8.20: Buyer Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedActiveBuyers + projectedLTV + projectedChurnRatePct +
// recommendedOutreachCount. Each signal has score + grade + upliftEURPerMonth +
// topLever (same shape as Profit/Inventory/Market/Sourcing — NOT inverted like
// Risk). Distinct from all five prior Brains.
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

// --- Pricing Brain section (v8.21, green/lime) --------------------------------
//
// v8.21: Pricing Brain result — projection30d/projection90d are STRUCTURED
// objects with projectedMarginPct + projectedRevenue +
// recommendedPriceChangePct + listingsToReprice. Each signal has score +
// grade + upliftEURPerMonth + topLever (same shape as Profit/Inventory/
// Market/Sourcing/Buyer — NOT inverted like Risk). Distinct from all six
// prior Brains. Also exposes a `pricingPower` composite (0-100) on `current`
// that represents the ability to raise prices without losing volume.
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

// --- System Health Card (v8.32, gradient by status: emerald/amber/red) ---
//
// v8.32 NEW PHASE: Polish — "How healthy is the Brain system?"
//
// One card that aggregates the ENTIRE Brain system's health into a single
// view. Placed at the VERY TOP of BrainSynthesisCard (above Actual Profit
// and Master Brain banner) — health overview FIRST, then ground truth,
// then predictions.
//
// Shows:
//   - Big health score (87/100) with grade pill (A+/A/B/C/D/F) + status pill
//     (HEALTHY/DEGRADED/UNHEALTHY)
//   - 8 Brain endpoints grid (2 rows × 4 cols): each brain with icon + name +
//     status dot (green=responsive, red=error) + response time + grade pill
//   - Data freshness row: latest snapshot date + days ago + trades count +
//     accuracy 30d
//   - Auto-pilot status: enabled/mode + anomaly suspended + today's stats
//   - Draft queue summary: pending + executed + rejected + execution rate
//   - Risk profile: tolerance + max acceptable risk
//   - Adaptive weights: adjusted domains + total executed/rejected
//   - Auto-generated recommendations (5+ rules) — each as actionable pill
//
// Gradient background (status-aware):
//   - HEALTHY (≥80): emerald gradient
//   - DEGRADED (≥50): amber gradient
//   - UNHEALTHY (<50): red gradient
//
// Auto-refreshes every 60 seconds. Fetches /api/ai/brain/health (30s cache).

