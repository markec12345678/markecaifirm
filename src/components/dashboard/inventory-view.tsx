'use client';

/**
 * v7.02: InventoryView — nov pogled za upravljanje skladišča z AI.
 *
 * Backend ima 28+ inventory AI endpointov, a frontend do zdaj ni imel
 * dedicated UI zanje (samo razpršeni gumbi v trades-view in statistics-view).
 *
 * Integrira 5 najboljših:
 * 1. Inventory Aging — /api/ai/inventory-aging (alerti za staranje)
 * 2. Stockout Predictor — /api/ai/inventory-stockout-predictor (napoved zmanjkanja)
 * 3. Shrinkage Detector — /api/ai/inventory-shrinkage-detector (detekcija izgub)
 * 4. Liquidation Strategist — /api/ai/inventory-liquidation-strategist (likvidacija)
 * 5. Rebalancer v3 — /api/ai/inventory-rebalancer-v3 (rebalansiranje portfelja)
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Package } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './inventory/types';
import { InventoryAging } from './inventory/inventory-aging';
import { StockoutPredictor } from './inventory/stockout-predictor';
import { ShrinkageDetector } from './inventory/shrinkage-detector';
import { LiquidationStrategist } from './inventory/liquidation-strategist';
import { PortfolioRebalancer } from './inventory/portfolio-rebalancer';
import { CapitalAllocator } from './inventory/capital-allocator';
import { CarryingCost } from './inventory/carrying-cost';
import { DepreciationTracker } from './inventory/depreciation-tracker';
import { GrowthPlanner } from './inventory/growth-planner';
import { HealthMonitor } from './inventory/health-monitor';

export function InventoryView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades?status=held');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setTrades(data.trades || data || []);
    } catch {
      toast.error('Ne morem naložiti skladišča');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Stats
  const totalValue = trades.reduce((s, t) => s + t.buyPrice, 0);
  const categories = Array.from(new Set(trades.map(t => t.category).filter(Boolean)));
  const stalledItems = trades.filter(t => {
    const days = Math.round((Date.now() - new Date(t.buyDate).getTime()) / (24 * 60 * 60 * 1000));
    return days > 30;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam skladišče...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            Skladišče AI
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI analiza inventarja — staranje, stockout, shrinkage, likvidacija, rebalansiranje.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Osveži
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Itemov v skladišču</div>
            <div className="text-2xl font-bold font-mono text-primary">{trades.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Vezana vrednost</div>
            <div className="text-2xl font-bold font-mono">{totalValue.toLocaleString('sl-SI')} €</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Kategorij</div>
            <div className="text-2xl font-bold font-mono">{categories.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Stagnirajoči (&gt;30d)</div>
            <div className={cn('text-2xl font-bold font-mono', stalledItems.length > 0 ? 'text-amber-400' : 'text-primary')}>
              {stalledItems.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Panels */}
      <div className="grid md:grid-cols-2 gap-4">
        <InventoryAging />
        <StockoutPredictor />
        <ShrinkageDetector />
        <LiquidationStrategist />
        <PortfolioRebalancer />
      </div>

      {/* v7.13: 5 novih inventory AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        <CapitalAllocator />
        <CarryingCost />
        <DepreciationTracker />
        <GrowthPlanner />
        <HealthMonitor />
      </div>

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            📦 <b>Skladišče AI</b> integrira 5 AI funkcij za upravljanje inventarja.
            Backend ima še 23+ inventory AI endpointov (capital allocator, carrying cost, damage prevention,
            depreciation tracker, growth planner, health monitor, lifecycle optimizer...) — vse najdeš v AI Hub.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
