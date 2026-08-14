'use client';

// v8.36: Trade Stats Card — compact summary card for Dashboard showing
// key trade metrics at a glance:
//   - Total profit (90d, EUR)
//   - Win rate (% of sold trades that were profitable)
//   - Avg margin (% across sold trades)
//   - Trade count (sold + held breakdown)
//   - Best niche (from /api/analytics/niche-score)
//
// Color-coded: green if profit > 0, amber if 0, red if < 0.
// Includes "＋ Dodaj trade" button → opens QuickAddTradeModal.
//
// Data sources (fetched client-side on mount + onAdd):
//   - GET /api/ai/brain/actual-profit?days=90 — totalProfitEUR, avgMarginPct, tradeCount
//   - GET /api/analytics/niche-score — bestNiche, worstNiche
//   - GET /api/trades?status=sold — for win rate + soldCount
//   - GET /api/trades?status=held — for heldCount
//
// Compact card: single row on desktop (4 mini-stats), stacked on mobile.

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Plus, RefreshCw, Target, Award, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuickAddTradeModal } from '@/components/dashboard/quick-add-trade-modal';
import { toast } from 'sonner';

interface ActualProfit {
  ok: boolean;
  totalProfitEUR: number;
  avgMarginPct: number;
  tradeCount: number;
  bestTrade?: { title: string; profitEUR: number } | null;
  worstTrade?: { title: string; profitEUR: number } | null;
}

interface NicheScore {
  ok: boolean;
  bestNiche?: {
    category: string;
    roi: number;
    profit: number;
    count: number;
  } | null;
  worstNiche?: {
    category: string;
    roi: number;
    profit: number;
    count: number;
  } | null;
}

interface Trade {
  id: string;
  status: string;
  buyPrice: number;
  buyFees: number;
  sellPrice: number | null;
  sellFees: number;
}

export function TradeStatsCard() {
  const [actual, setActual] = useState<ActualProfit | null>(null);
  const [niche, setNiche] = useState<NicheScore | null>(null);
  const [soldTrades, setSoldTrades] = useState<Trade[]>([]);
  const [heldCount, setHeldCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [actualRes, nicheRes, soldRes, heldRes] = await Promise.all([
        fetch('/api/ai/brain/actual-profit?days=90'),
        fetch('/api/analytics/niche-score'),
        fetch('/api/trades?status=sold'),
        fetch('/api/trades?status=held'),
      ]);

      const [actualData, nicheData, soldData, heldData] = await Promise.all([
        actualRes.ok ? actualRes.json() : null,
        nicheRes.ok ? nicheRes.json() : null,
        soldRes.ok ? soldRes.json() : [],
        heldRes.ok ? heldRes.json() : [],
      ]);

      setActual(actualData);
      setNiche(nicheData);
      setSoldTrades(Array.isArray(soldData) ? soldData : []);
      setHeldCount(Array.isArray(heldData) ? heldData.length : 0);
    } catch {
      // Silent fail — this is a stats card, not critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Compute win rate from sold trades (full history, not just 90d)
  const winRate = soldTrades.length > 0
    ? (soldTrades.filter(
        (t) =>
          (t.sellPrice ?? 0) - (t.sellFees ?? 0) - t.buyPrice - (t.buyFees ?? 0) >
          0,
      ).length /
        soldTrades.length) *
      100
    : 0;

  const totalProfit = actual?.totalProfitEUR ?? 0;
  const avgMargin = actual?.avgMarginPct ?? 0;
  const soldCount = actual?.tradeCount ?? soldTrades.length;
  const bestNiche = niche?.bestNiche;
  const worstNiche = niche?.worstNiche;

  // Color coding based on profit sign
  const profitColor =
    totalProfit > 0
      ? 'text-primary'
      : totalProfit < 0
        ? 'text-red-500'
        : 'text-muted-foreground';
  const profitBg =
    totalProfit > 0
      ? 'border-primary/30 bg-primary/5'
      : totalProfit < 0
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-border bg-card/50';

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-24 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // No trades yet — show empty state with seed/quick-add CTA
  if (soldCount === 0 && heldCount === 0) {
    return (
      <>
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Trade statistika
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Še ni trade-ov. Dodaj prvi trade ali naloži demo podatke v AI Hub.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setShowQuickAdd(true)}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="w-3.5 h-3.5" />
                Dodaj trade
              </Button>
            </div>
          </CardContent>
        </Card>
        <QuickAddTradeModal
          open={showQuickAdd}
          onOpenChange={setShowQuickAdd}
          onSaved={() => {
            toast.success('Trade dodan — osvežujem statistiko');
            load();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Card className={cn('border-2', profitBg)}>
        <CardContent className="p-4">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Trade statistika
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                90d
              </Badge>
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={load}
                title="Osveži"
              >
                <RefreshCw className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                onClick={() => setShowQuickAdd(true)}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs"
              >
                <Plus className="w-3 h-3" />
                Dodaj trade
              </Button>
            </div>
          </div>

          {/* Main profit display */}
          <div className="flex items-baseline gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Dobicek (90 dni)
              </div>
              <div className={cn('text-3xl font-bold font-mono', profitColor)}>
                {totalProfit >= 0 ? '+' : ''}
                {totalProfit.toFixed(0)}€
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Povprecna marza
              </div>
              <div
                className={cn(
                  'text-xl font-bold font-mono',
                  avgMargin > 0 ? 'text-primary' : avgMargin < 0 ? 'text-red-500' : 'text-muted-foreground',
                )}
              >
                {avgMargin > 0 ? '+' : ''}
                {avgMargin.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Mini stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground uppercase">
                <Target className="w-3 h-3" /> Win rate
              </div>
              <div
                className={cn(
                  'text-sm font-bold font-mono',
                  winRate >= 60 ? 'text-primary' : winRate >= 40 ? 'text-amber-400' : 'text-red-500',
                )}
              >
                {winRate.toFixed(0)}%
              </div>
            </div>
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground uppercase">
                <Package className="w-3 h-3" /> Trade-i
              </div>
              <div className="text-sm font-bold font-mono">
                <span className="text-primary">{soldCount}</span>
                <span className="text-muted-foreground mx-1">·</span>
                <span className="text-amber-400">{heldCount}</span>
              </div>
            </div>
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground uppercase">
                <Award className="w-3 h-3" /> Top nisa
              </div>
              <div className="text-sm font-bold font-mono truncate" title={bestNiche?.category}>
                {bestNiche?.category ?? '—'}
                {bestNiche && (
                  <span className="text-[10px] text-primary ml-1">
                    +{bestNiche.roi.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground uppercase">
                <TrendingDown className="w-3 h-3" /> Slaba nisa
              </div>
              <div className="text-sm font-bold font-mono truncate" title={worstNiche?.category}>
                {worstNiche?.category ?? '—'}
                {worstNiche && (
                  <span
                    className={cn(
                      'text-[10px] ml-1',
                      worstNiche.roi >= 0 ? 'text-amber-400' : 'text-red-500',
                    )}
                  >
                    {worstNiche.roi >= 0 ? '+' : ''}
                    {worstNiche.roi.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Best/worst trade (if 90d has any) */}
          {actual?.bestTrade && (
            <div className="mt-3 pt-3 border-t border-border text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-muted-foreground shrink-0">🏆 Best:</span>
                <span className="truncate font-medium">{actual.bestTrade.title}</span>
              </div>
              <span className="text-primary font-mono font-bold shrink-0">
                +{actual.bestTrade.profitEUR.toFixed(0)}€
              </span>
            </div>
          )}
          {actual?.worstTrade && actual.worstTrade.profitEUR < 0 && (
            <div className="text-xs flex items-center justify-between gap-2 mt-1">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-muted-foreground shrink-0">📉 Worst:</span>
                <span className="truncate font-medium">{actual.worstTrade.title}</span>
              </div>
              <span className="text-red-500 font-mono font-bold shrink-0">
                {actual.worstTrade.profitEUR.toFixed(0)}€
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      <QuickAddTradeModal
        open={showQuickAdd}
        onOpenChange={setShowQuickAdd}
        onSaved={() => {
          toast.success('Trade dodan — osvežujem statistiko');
          load();
        }}
      />
    </>
  );
}
