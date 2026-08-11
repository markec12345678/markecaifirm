'use client';

/**
 * v7.01: AIHubView — centralen pregled vseh 254 AI endpointov z iskalnikom.
 *
 * REŠI "194 orphan AI endpointov" problem:
 * - Prej: 76 % AI endpointov (194 od 254) ni imelo UI gumba
 * - Sedaj: vsi 254 endpointi so brskljivi in poganljivi iz AI Hub
 *
 * Funkcionalnost:
 * - Iskalnik (filter po imenu/opisu)
 * - Kategorije (brain, buyer, inventory, listing, pricing, risk, negotiation, reports, misc)
 * - Klik na endpoint → odpre AI Runner modal
 * - AI Runner: POST na endpoint, prikaže JSON rezultat v pretty-print formatu
 * - "Kopiraj JSON" gumb
 * - Statistike: skupaj endpointov, po kategorijah
 *
 * v8.15: Added 🧠 Brain category + Brain Synthesis Card.
 * - Brain category contains orchestrator endpoints above specialists.
 *   First entry: `brain/profit` (Profit Brain synthesizes 6 profit signals).
 * - Brain Synthesis Card fetches `/api/ai/brain/profit` on mount and shows
 *   the one-line summary, profit grade pills, top 3 actions, and 30d/90d
 *   projections. Emerald-tinted background distinguishes from specialists.
 *
 * v8.16: Extended Brain Synthesis Card with SECOND stacked section —
 * Inventory Brain (amber-tinted). Card renders BOTH brain layers
 * simultaneously:
 *   - 🧠 PROFIT BRAIN (emerald) — synthesizes 6 profit signals → €/mo projection
 *   - 📦 INVENTORY BRAIN (amber) — synthesizes 6 inventory signals → 30d/90d
 *     inventory projection (recommendedItemsToSell/Buy, projectedInventoryValue,
 *     projectedAgedPct, projectedTurnoverRate)
 *
 * v8.17: Extended Brain Synthesis Card with THIRD stacked section —
 * Market Brain (sky/blue-tinted). Card now renders ALL THREE brain layers
 * simultaneously:
 *   - 📈 MARKET BRAIN (sky/blue) — synthesizes 6 market signals → 30d/90d
 *     market phase projection (predictedPhase + predictedPriceChangePct +
 *     recommendedAction BUY/SELL/HOLD/LIQUIDATE)
 *
 * v8.18: Extended Brain Synthesis Card with FOURTH stacked section —
 * Sourcing Brain (purple/violet-tinted). Card now renders ALL FOUR brain
 * layers simultaneously:
 *   - 🎯 SOURCING BRAIN (purple/violet) — synthesizes 6 sourcing signals
 *     (roi, volume, margin, momentum, diversification, concentration) →
 *     per-source decision (recommendedSourceToScale + recommendedSourceToReduce
 *     + projectedTotalMonthlyProfit + recommendedNewSource)
 *
 * v8.19: Extended Brain Synthesis Card with FIFTH stacked section —
 * Risk Brain (red/rose-tinted). Card now renders ALL FIVE brain
 * layers simultaneously:
 *   - 🛡️ RISK BRAIN (red/rose) — synthesizes 6 risk signals
 *     (concentration, aging, liquidity, market, fraud, portfolio) →
 *     30d/90d risk projection (projectedRiskScore + projectedConcentrationPct
 *     + projectedAgedPct + recommendedRiskBudget)
 * All five sections fetch in parallel on mount (`Promise.all`). Each has its
 * own loading skeleton, error state, refresh button, and cache indicator.
 *
 * Lazy-loaded z next/dynamic (ssr: false) — ne bremeni prvotnega nalaganja.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Sparkles, Search, Copy, Check, RefreshCw, Zap, X, ChevronRight, Brain, AlertCircle, Package, TrendingUp, Target, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ===== Kategorije =====
const CATEGORIES = [
  { id: 'all', label: 'Vsi', icon: '📋', color: 'text-primary' },
  { id: 'brain', label: 'Možgani', icon: '🧠', color: 'text-emerald-500' },
  { id: 'buyer', label: 'Kupci', icon: '👥', color: 'text-blue-400' },
  { id: 'inventory', label: 'Skladišče', icon: '📦', color: 'text-amber-400' },
  { id: 'listing', label: 'Oglasi', icon: '📝', color: 'text-purple-400' },
  { id: 'pricing', label: 'Cene', icon: '💰', color: 'text-primary' },
  { id: 'risk', label: 'Tveganje', icon: '🛡️', color: 'text-red-500' },
  { id: 'negotiation', label: 'Pogajanje', icon: '🤝', color: 'text-cyan-400' },
  { id: 'reports', label: 'Poročila', icon: '📊', color: 'text-primary' },
  { id: 'misc', label: 'Ostalo', icon: '🔧', color: 'text-muted-foreground' },
] as const;

// ===== Kategorizacija endpointov (mirror of /api/ai-list categorize) =====
function categorize(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith('brain/') || n.split('/')[0] === 'brain') return 'brain';
  if (n.startsWith('buyer') || n.includes('customer')) return 'buyer';
  if (n.startsWith('inventory') || n.includes('stockout') || n.includes('shrinkage') || n.includes('liquidation') || n.includes('rebalancer') || n.includes('turnover') || n.includes('aging')) return 'inventory';
  if (n.startsWith('listing') || n.includes('description') || n.includes('title') || n.includes('seo') || n.includes('thumbnail') || n.includes('image') || n.includes('tag') || n.includes('content') || n.includes('ctr') || n.includes('conversion') || n.includes('engagement') || n.includes('virality') || n.includes('performance')) return 'listing';
  if (n.includes('price') || n.includes('pricing') || n.includes('margin') || n.includes('profit') || n.includes('bundle') || n.includes('cash') || n.includes('budget') || n.includes('seasonal') || n.includes('demand') || n.includes('depreciation') || n.includes('roi') || n.includes('cost')) return 'pricing';
  if (n.includes('risk') || n.includes('fraud') || n.includes('fake') || n.includes('insurance') || n.includes('hedge') || n.includes('parity') || n.includes('saturation') || n.includes('anomal')) return 'risk';
  if (n.includes('negotiation') || n.includes('negotiate') || n.includes('auction') || n.includes('sniper') || n.includes('bid') || n.includes('seller')) return 'negotiation';
  if (n.includes('report') || n.includes('summary') || n.includes('dashboard') || n.includes('forecast') || n.includes('benchmark') || n.includes('insights') || n.includes('trend') || n.includes('monthly') || n.includes('daily') || n.includes('playbook') || n.includes('automation') || n.includes('autonomous')) return 'reports';
  return 'misc';
}

// ===== Brain Synthesis Card (v8.15 + v8.16 + v8.17 + v8.18 + v8.19) =====
//
// Renders ALL FIVE Brain layers stacked inside one Card:
//   - 🧠 PROFIT BRAIN (v8.15, emerald) — synthesizes 6 profit signals
//   - 📦 INVENTORY BRAIN (v8.16, amber) — synthesizes 6 inventory signals
//   - 📈 MARKET BRAIN (v8.17, sky/blue) — synthesizes 6 market signals
//   - 🎯 SOURCING BRAIN (v8.18, purple/violet) — synthesizes 6 sourcing signals
//   - 🛡️ RISK BRAIN (v8.19, red/rose) — synthesizes 6 risk signals
//
// All five sections fetch in parallel on mount and have independent loading,
// error, refresh, and cache states.

interface BrainAction {
  rank: number;
  domain: string;
  signal: string;
  action: string;
  expectedUpliftEUR: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface BrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    monthlyProfit: number;
    profitGrowthRate: number;
    avgProfitPerTrade: number;
    tradesPerMonth: number;
    capitalDeployed: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: number;
    projection90d: number;
    profitGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

// v8.17: Market Brain result — projection30d/projection90d are STRUCTURED
// objects with `predictedPhase` + `predictedPriceChangePct` + `recommendedAction`
// (BUY/SELL/HOLD/LIQUIDATE). Different from both Profit (scalars) and
// Inventory (recommendedItemsToSell/Buy + projectedInventoryValue).
interface MarketBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    activeListingCount: number;
    newLastWeek: number;
    avgPriceChangePctWeek: number;
    avgPriceChangePctMonth: number;
    buyerInquiriesLastWeek: number;
    sellThroughRatePct: number;
    avgDaysOnMarket: number;
    priceSpreadPct: number;
    inferredCyclePhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
    inferredSentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      predictedPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
      predictedPriceChangePct: number;
      recommendedAction: 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';
    };
    projection90d: {
      predictedPhase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
      predictedPriceChangePct: number;
      recommendedAction: 'BUY' | 'SELL' | 'HOLD' | 'LIQUIDATE';
    };
    marketGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

// v8.16: Inventory Brain result — different `current` and `maximization`
// shape from Profit Brain (projections are STRUCTURED objects, not scalars).
interface InventoryBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    itemCount: number;
    totalInventoryValue: number;
    avgDaysToSell: number;
    agedItemsCount: number;
    agedItemsPct: number;
    avgProfitMarginPct: number;
    capitalDeployed: number;
    monthlySalesCount: number;
    monthlyRevenue: number;
    inventoryTurnoverRate: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      recommendedItemsToSell: number;
      recommendedItemsToBuy: number;
      projectedInventoryValue: number;
      projectedAgedPct: number;
    };
    projection90d: {
      projectedInventoryValue: number;
      projectedAgedPct: number;
      projectedTurnoverRate: number;
    };
    inventoryGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A+':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
    case 'A':
      return 'bg-green-500/15 text-green-600 border-green-500/30 dark:text-green-400';
    case 'B':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
    case 'C':
      return 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400';
    case 'D':
      return 'bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400';
    default:
      return 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-400';
  }
}

function confidenceColor(c: string): string {
  switch (c) {
    case 'HIGH':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'MEDIUM':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-zinc-500 dark:text-zinc-400';
  }
}

// --- Profit Brain section (v8.15, emerald) ---------------------------------

function ProfitBrainSection() {
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

function InventoryBrainSection() {
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

function MarketBrainSection() {
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
interface SourcingBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number;
    grade: string;
    upliftEURPerMonth: number;
    topLever: string;
  }>;
  current: {
    sourceCount: number;
    sources: Array<{
      name: string;
      monthlyVolume: number;
      avgProfitMarginPct: number;
      avgDaysToSell: number;
      capitalDeployedEUR: number;
      monthlyProfitEUR: number;
    }>;
    totalCapitalDeployed: number;
    totalMonthlyProfit: number;
    bestSource: string;
    worstSource: string;
    avgMarginPct: number;
    concentrationPct: number;
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      recommendedSourceToScale: string;
      recommendedSourceToReduce: string;
      projectedTotalMonthlyProfit: number;
      projectedConcentrationPct: number;
    };
    projection90d: {
      projectedTotalMonthlyProfit: number;
      projectedSourceCount: number;
      projectedConcentrationPct: number;
      recommendedNewSource?: string;
    };
    sourcingGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    bestOpportunity: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function SourcingBrainSection() {
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
interface RiskBrainResult {
  ok: true;
  signals: Array<{
    name: string;
    score: number; // 0-100 (HIGHER = LOWER risk)
    grade: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskReductionEUR: number;
    topLever: string;
  }>;
  current: {
    totalCapitalDeployed: number;
    inventoryValue: number;
    agedInventoryValue: number;
    agedPct: number;
    capitalConcentrationPct: number;
    monthlyRevenue: number;
    monthlyProfit: number;
    activeSources: number;
    fraudSuspicionsPct: number;
    avgDaysToSell: number;
    marketVolatilityPct: number;
    overallRiskScore: number; // 0-100 (lower = more risk)
  };
  maximization: {
    topActions: BrainAction[];
    projection30d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    projection90d: {
      projectedRiskScore: number;
      projectedConcentrationPct: number;
      projectedAgedPct: number;
      recommendedRiskBudget: number;
    };
    riskGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
    biggestRisk: string;
    oneLineSummary: string;
  };
  aiUsed: false;
  source: string;
  cachedAt?: number;
}

function riskLevelColor(level: string): string {
  switch (level) {
    case 'CRITICAL':
      return 'bg-rose-600/20 text-rose-700 border-rose-600/40 dark:text-rose-300';
    case 'HIGH':
      return 'bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400';
    case 'MEDIUM':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400';
    case 'LOW':
    default:
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400';
  }
}

function RiskBrainSection() {
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

// --- Outer card wrapper (v8.15 + v8.16 + v8.17 + v8.18 + v8.19) ----------------------------

function BrainSynthesisCard({ onBrainCategoryClick }: { onBrainCategoryClick: () => void }) {
  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pb-1 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Brain className="w-5 h-5 text-primary shrink-0" />
            <span className="text-sm sm:text-base font-bold tracking-tight">
              AI BRAIN SYNTHESIS
            </span>
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
              v8.15 + v8.16 + v8.17 + v8.18 + v8.19
            </Badge>
          </div>
          <button
            onClick={onBrainCategoryClick}
            className="text-[11px] text-primary hover:underline shrink-0 flex items-center gap-1"
          >
            🧠 Možgani kategorija →
          </button>
        </div>

        <ProfitBrainSection />
        <InventoryBrainSection />
        <MarketBrainSection />
        <SourcingBrainSection />
        <RiskBrainSection />
      </CardContent>
    </Card>
  );
}

// ===== AI Runner Modal =====
function AIRunnerModal({ endpoint, onClose }: { endpoint: AIEndpoint | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [bodyInput, setBodyInput] = useState('{}');

  useEffect(() => {
    if (endpoint) {
      setResult('');
      setCopied(false);
      setBodyInput(endpoint.bodyHint || '{}');
    }
  }, [endpoint]);

  const run = async () => {
    if (!endpoint) return;
    setLoading(true);
    setResult('');
    try {
      let body;
      try { body = JSON.parse(bodyInput); } catch { body = {}; }
      const res = await fetch(`/api/ai/${endpoint.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      if (data.ok) toast.success(`✓ ${endpoint.name} uspešen`);
      else toast.error(data.error ?? 'AI je vrnil napako');
    } catch (e: any) {
      setResult(`Error: ${e?.message ?? 'Napaka'}`);
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    toast.success('JSON kopiran');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!endpoint) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-primary" />
            AI Runner: <span className="font-mono text-primary">{endpoint.name}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {endpoint.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* Body input */}
          <div>
            <label className="text-xs uppercase text-muted-foreground mb-1 block">Request body (JSON)</label>
            <textarea
              value={bodyInput}
              onChange={(e) => setBodyInput(e.target.value)}
              className="w-full text-xs font-mono bg-card/30 border border-border rounded p-2 min-h-[60px] max-h-[120px]"
              placeholder='{}'
            />
          </div>

          {/* Run button */}
          <Button onClick={run} disabled={loading} className="w-full gap-2">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? 'AI analizira...' : 'Pošlji AI zahtevo'}
          </Button>

          {/* Result */}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs uppercase text-muted-foreground">Rezultat (JSON)</label>
                <button onClick={copyResult} className="text-xs text-primary hover:underline flex items-center gap-1">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Kopirano' : 'Kopiraj'}
                </button>
              </div>
              <pre className="text-[10px] font-mono bg-card/30 border border-border rounded p-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all">
                {result}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ===== Tip endpoint-a =====
interface AIEndpoint {
  name: string;
  description: string;
  bodyHint: string;
  category: string;
}

// ===== Glavna komponenta =====
export function AIHubView() {
  const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedEndpoint, setSelectedEndpoint] = useState<AIEndpoint | null>(null);

  // Generiraj seznam iz AI_ENDPOINTS.md ali direktno iz route.ts datotek
  useEffect(() => {
    // Statičen seznam generiran iz backend-a (254 endpointov)
    // V produkciji bi to lahko bil API klic na /api/ai/list, a za enostavnost
    // uporabljamo statičen seznam (generiran ob build-izgradnji)
    fetch('/api/ai-list')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.endpoints) {
          // Mirror server-side categorize — guarantees consistency even if
          // /api/ai-list returns a stale category field.
          const normalized: AIEndpoint[] = data.endpoints.map((e: AIEndpoint) => ({
            ...e,
            category: categorize(e.name),
          }));
          setEndpoints(normalized);
        } else {
          // Fallback: prazen seznam (API ne obstaja — uporabnik lahko še vedno išče)
          setEndpoints([]);
        }
      })
      .catch(() => setEndpoints([]))
      .finally(() => setLoading(false));
  }, []);

  // Filter
  const filtered = useMemo(() => {
    let result = endpoints;
    if (activeCategory !== 'all') {
      result = result.filter(e => e.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [endpoints, activeCategory, search]);

  // Statistike po kategorijah
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    endpoints.forEach(e => { stats[e.category] = (stats[e.category] ?? 0) + 1; });
    return stats;
  }, [endpoints]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam AI endpointe...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            AI Hub
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {endpoints.length} AI funkcij · {filtered.length} prikazanih
          </p>
        </div>
      </div>

      {/* v8.15: Brain Synthesis Card — top of AI Hub, above stats */}
      <BrainSynthesisCard onBrainCategoryClick={() => setActiveCategory('brain')} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {CATEGORIES.map(cat => (
          <Card key={cat.id} className={cn('cursor-pointer transition-all hover:border-primary/40',
            activeCategory === cat.id && 'border-primary bg-primary/5')}
            onClick={() => setActiveCategory(cat.id)}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                <span>{cat.icon}</span>
                {cat.label}
              </div>
              <div className={cn('text-xl font-bold font-mono', cat.color)}>
                {cat.id === 'all' ? endpoints.length : (categoryStats[cat.id] ?? 0)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Išči AI funkcijo (npr. 'fraud', 'buyer', 'profit', 'brain'...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Endpoints grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {endpoints.length === 0
                ? 'AI endpointi še niso naloženi. Za generiranje poženi: bun run dev in obišči /api/ai-list'
                : 'Ni rezultatov za ta iskalni niz.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.slice(0, 60).map(ep => {
            const cat = CATEGORIES.find(c => c.id === ep.category) ?? CATEGORIES[CATEGORIES.length - 1];
            return (
              <Card
                key={ep.name}
                className={cn(
                  'cursor-pointer hover:border-primary/40 hover:bg-card/50 transition-all group',
                  ep.category === 'brain' && 'border-emerald-500/30 hover:border-emerald-500/50',
                )}
                onClick={() => setSelectedEndpoint(ep)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs">{cat.icon}</span>
                        <span className="font-mono text-xs font-bold text-foreground truncate group-hover:text-primary">
                          {ep.name}
                        </span>
                        {ep.category === 'brain' && ep.name === 'brain/profit' && (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                            v8.15
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/inventory' && (
                          <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0">
                            v8.16
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/market' && (
                          <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-600 dark:text-sky-400 shrink-0">
                            v8.17
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/sourcing' && (
                          <Badge variant="outline" className="text-[9px] border-purple-500/40 text-purple-600 dark:text-purple-400 shrink-0">
                            v8.18
                          </Badge>
                        )}
                        {ep.category === 'brain' && ep.name === 'brain/risk' && (
                          <Badge variant="outline" className="text-[9px] border-rose-500/40 text-rose-600 dark:text-rose-400 shrink-0">
                            v8.19
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">
                        {ep.description || 'Brez opisa'}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Show more / count */}
      {filtered.length > 60 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          Prikažujem prvih 60 od {filtered.length} rezultatov. Zaostriti iskanje za manj rezultatov.
        </div>
      )}

      {/* AI Runner Modal */}
      <AIRunnerModal endpoint={selectedEndpoint} onClose={() => setSelectedEndpoint(null)} />

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            🤖 <b>AI Hub</b> omogoča brskanje in poganjanje vseh {endpoints.length} AI funkcij.
            Klikni na endpoint za podrobnosti in pošiljanje zahteve.
            Body je JSON (privzeto <code className="px-1 bg-card rounded">{`{}`}</code> — prazno).
            Rezultat je prikazan v pretty-print JSON formatu.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
