'use client';

/**
 * v7.04: PricingView — nov pogled za AI analizo cen in dobička.
 *
 * Backend ima 30+ pricing/profit AI endpointov, a frontend jih ni imel
 * v dedicated UI (samo razpršeni gumbi v statistics-view in trades-view).
 *
 * Integrira 5 najboljših:
 * 1. Smart Pricing Engine — /api/ai/smart-pricing-engine (dinamično določanje cen)
 * 2. Profit Forecast — /api/ai/profit-forecast (napoved dobička)
 * 3. Margin Optimizer — /api/ai/margin-optimizer (optimizacija marže)
 * 4. Price War Strategist — /api/ai/price-war-strategist (cenovne vojne)
 * 5. Seasonal Pricing — /api/ai/seasonal-pricing (sezonsko določanje cen)
 *
 * v9.09: 10 AI sekcij ekstraktiranih v ./pricing/ module (vsaka z lastnim state-om + fetch-om).
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './pricing/types';
import { SmartPricingEngine } from './pricing/smart-pricing-engine';
import { ProfitForecast } from './pricing/profit-forecast';
import { MarginOptimizer } from './pricing/margin-optimizer';
import { PriceWarStrategist } from './pricing/price-war-strategist';
import { SeasonalPricing } from './pricing/seasonal-pricing';
import { ProfitDashboard } from './pricing/profit-dashboard';
import { ProfitPlaybook } from './pricing/profit-playbook';
import { ReservePriceOptimizer } from './pricing/reserve-price-optimizer';
import { PricingPsychology } from './pricing/pricing-psychology';
import { GeoPriceMap } from './pricing/geo-price-map';

export function PricingView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setTrades(data.trades || data || []);
    } catch {
      toast.error('Ne morem naložiti tradeov');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Stats
  const heldTrades = trades.filter(t => t.status === 'held');
  const soldTrades = trades.filter(t => t.status === 'sold' && t.sellPrice);
  const totalInvested = heldTrades.reduce((s, t) => s + t.buyPrice, 0);
  const totalRevenue = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0), 0);
  const totalProfit = soldTrades.reduce((s, t) => s + (t.sellPrice ?? 0) - t.buyPrice, 0);
  const avgMargin = soldTrades.length > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-3 text-sm terminal-glow">Nalagam tradeove...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" />
            Cene & Dobiček AI
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI analiza cen, marž, dobička in sezonskih vzorcev.
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
            <div className="text-xs text-muted-foreground uppercase">Vezano v inventarju</div>
            <div className="text-2xl font-bold font-mono">{totalInvested.toLocaleString('sl-SI')} €</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Realizirani dobiček</div>
            <div className={cn('text-2xl font-bold font-mono', totalProfit >= 0 ? 'text-primary' : 'text-destructive')}>
              {totalProfit >= 0 ? '+' : ''}{totalProfit.toLocaleString('sl-SI')} €
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Povprečna marža</div>
            <div className={cn('text-2xl font-bold font-mono', avgMargin >= 20 ? 'text-primary' : 'text-amber-400')}>
              {avgMargin}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Skupna prodaja</div>
            <div className="text-2xl font-bold font-mono">{totalRevenue.toLocaleString('sl-SI')} €</div>
          </CardContent>
        </Card>
      </div>

      {/* AI Panels */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 1. Smart Pricing Engine */}
        <SmartPricingEngine />

        {/* 2. Profit Forecast */}
        <ProfitForecast />

        {/* 3. Margin Optimizer */}
        <MarginOptimizer />

        {/* 4. Price War Strategist */}
        <PriceWarStrategist />

        {/* 5. Seasonal Pricing */}
        <SeasonalPricing />
      </div>

      {/* v7.14: 5 novih pricing AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Profit Dashboard */}
        <ProfitDashboard />

        {/* 7. Profit Playbook */}
        <ProfitPlaybook />

        {/* 8. Reserve Price Optimizer */}
        <ReservePriceOptimizer />

        {/* 9. Pricing Psychology Optimizer */}
        <PricingPsychology />

        {/* 10. Geo Price Map */}
        <GeoPriceMap />
      </div>

      {/* Footer */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <p>
            💰 <b>Cene & Dobiček AI</b> integrira 5 AI funkcij za optimizacijo cen.
            Backend ima še 25+ pricing/profit AI endpointov (profit-dashboard, profit-playbook,
            reserve-price-optimizer, pricing-psychology, geo-price-map...) — vse najdeš v AI Hub.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
