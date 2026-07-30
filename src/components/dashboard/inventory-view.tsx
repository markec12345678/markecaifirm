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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Package, Clock, TrendingDown, AlertTriangle, Recycle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  category: string;
  buyDate: string;
  status: string;
}

export function InventoryView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  // AI results
  const [aging, setAging] = useState<any>(null);
  const [agingLoading, setAgingLoading] = useState(false);
  const [stockout, setStockout] = useState<any>(null);
  const [stockoutLoading, setStockoutLoading] = useState(false);
  const [shrinkage, setShrinkage] = useState<any>(null);
  const [shrinkageLoading, setShrinkageLoading] = useState(false);
  const [liquidation, setLiquidation] = useState<any>(null);
  const [liquidationLoading, setLiquidationLoading] = useState(false);
  const [rebalancer, setRebalancer] = useState<any>(null);
  const [rebalancerLoading, setRebalancerLoading] = useState(false);

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

  // ===== AI runners =====
  const runAging = async () => {
    setAgingLoading(true); setAging(null);
    try {
      const res = await fetch('/api/ai/inventory-aging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setAging(data); toast.success('✓ Aging analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setAgingLoading(false); }
  };

  const runStockout = async () => {
    setStockoutLoading(true); setStockout(null);
    try {
      const res = await fetch('/api/ai/inventory-stockout-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setStockout(data); toast.success('✓ Stockout napoved generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setStockoutLoading(false); }
  };

  const runShrinkage = async () => {
    setShrinkageLoading(true); setShrinkage(null);
    try {
      const res = await fetch('/api/ai/inventory-shrinkage-detector', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setShrinkage(data); toast.success('✓ Shrinkage analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setShrinkageLoading(false); }
  };

  const runLiquidation = async () => {
    setLiquidationLoading(true); setLiquidation(null);
    try {
      const res = await fetch('/api/ai/inventory-liquidation-strategist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setLiquidation(data); toast.success('✓ Likvidacijska strategija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setLiquidationLoading(false); }
  };

  const runRebalancer = async () => {
    setRebalancerLoading(true); setRebalancer(null);
    try {
      const res = await fetch('/api/ai/inventory-rebalancer-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setRebalancer(data); toast.success('✓ Rebalansiranje generirano'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setRebalancerLoading(false); }
  };

  const runAll = async () => {
    await Promise.all([runAging(), runStockout(), runShrinkage(), runLiquidation(), runRebalancer()]);
  };

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
          <Button onClick={runAll} disabled={trades.length === 0} size="sm" className="gap-2">
            <Sparkles className="w-4 h-4" /> Generiraj vse
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
        {/* 1. Inventory Aging */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                AI Inventory Aging
              </span>
              <Button size="sm" variant="outline" onClick={runAging} disabled={agingLoading} className="h-6 text-xs gap-1.5">
                {agingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agingLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI analizira staranje inventarja...
              </div>
            ) : aging?.alerts?.length > 0 ? (
              <div className="space-y-2 text-xs">
                {aging.insights && (
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-[10px]">
                    💡 {aging.insights}
                  </div>
                )}
                {aging.alerts.slice(0, 5).map((a: any, i: number) => (
                  <div key={i} className={cn('border rounded p-2',
                    a.urgency === 'critical' ? 'bg-red-500/5 border-red-500/20' :
                    a.urgency === 'high' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-card/30 border-border')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px] truncate flex-1">{a.title}</span>
                      <Badge variant="outline" className={cn('text-[9px] ml-1',
                        a.urgency === 'critical' ? 'text-red-500 border-red-500/30' :
                        a.urgency === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                        {a.agingStage || a.urgency}
                      </Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {a.daysHeld}d · {a.holdingCost}€ · → {a.action}
                    </div>
                  </div>
                ))}
                {aging.summary && (
                  <div className="text-[9px] text-muted-foreground border-t border-border pt-1">
                    📊 {aging.summary.totalItems ?? aging.alerts.length} itemov · {aging.summary.stalledCount ?? 0} stagnira
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI opozori na iteme, ki predolgo ležijo (stagnirajoči, drago za vzdrževanje).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 2. Stockout Predictor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-500" />
                AI Stockout Predictor
              </span>
              <Button size="sm" variant="outline" onClick={runStockout} disabled={stockoutLoading} className="h-6 text-xs gap-1.5">
                {stockoutLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stockoutLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI napoveduje zmanjkanje zaloge...
              </div>
            ) : stockout?.predictor ? (
              <div className="space-y-2 text-xs">
                {stockout.predictor.current && (
                  <div className={cn('border rounded p-2',
                    stockout.predictor.current.stockoutRiskLevel === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                    stockout.predictor.current.stockoutRiskLevel === 'high' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-card/30 border-border')}>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                        stockout.predictor.current.stockoutRiskLevel === 'critical' ? 'text-red-500 border-red-500/40' :
                        stockout.predictor.current.stockoutRiskLevel === 'high' ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                        {stockout.predictor.current.stockoutRiskLevel} risk
                      </Badge>
                      <span className="text-[9px] text-muted-foreground">
                        ~{stockout.predictor.current.avgDaysToSell}d za prodajo · {stockout.predictor.current.stockCoverageDays}d pokritje
                      </span>
                    </div>
                  </div>
                )}
                {stockout.predictor.predictions?.slice(0, 4).map((p: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px]">{p.category || `Kategorija ${i + 1}`}</span>
                      <Badge variant="outline" className={cn('text-[9px]',
                        p.urgency === 'immediate' ? 'text-red-500 border-red-500/30' :
                        p.urgency === '7d' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                        {p.urgency}
                      </Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {p.currentStock} na zalogi · {p.dailySellRate}/d · še {p.daysUntilStockout}d
                    </div>
                    {p.stockoutProbabilityPct > 50 && (
                      <div className="text-[9px] text-red-500 mt-0.5">
                        ⚠️ {p.stockoutProbabilityPct}% verjetnost stockout-a
                      </div>
                    )}
                  </div>
                ))}
                {stockout.predictor.insights && (
                  <div className="text-[9px] text-muted-foreground">💡 {stockout.predictor.insights}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI napove kdaj bo zmanjkalo zaloge (ARIMA/LSTM/Prophet modeli).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 3. Shrinkage Detector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                AI Shrinkage Detector
              </span>
              <Button size="sm" variant="outline" onClick={runShrinkage} disabled={shrinkageLoading} className="h-6 text-xs gap-1.5">
                {shrinkageLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shrinkageLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI detektira izgube (krađa, poškodbe, izguba)...
              </div>
            ) : shrinkage?.detector ? (
              <div className="space-y-2 text-xs">
                {shrinkage.detector.overview && (
                  <div className={cn('border rounded p-2',
                    shrinkage.detector.overview.shrinkageGrade === 'F' || shrinkage.detector.overview.shrinkageGrade === 'D' ? 'bg-red-500/10 border-red-500/30' :
                    shrinkage.detector.overview.shrinkageGrade === 'C' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-primary/10 border-primary/30')}>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[9px] uppercase font-bold">
                        Grade: {shrinkage.detector.overview.shrinkageGrade}
                      </Badge>
                      <span className="font-mono font-bold text-[10px]">
                        {shrinkage.detector.overview.shrinkagePct}% shrinkage
                      </span>
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-1">
                      {shrinkage.detector.overview.totalShrinkageValueEur}€ izguba · {shrinkage.detector.overview.revenueGapEur}€ gap
                    </div>
                  </div>
                )}
                {shrinkage.detector.shrinkageEvents?.slice(0, 3).map((e: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-[9px]">{e.eventType}</Badge>
                      <span className={cn('text-[9px] font-bold',
                        e.severity === 'critical' ? 'text-red-500' :
                        e.severity === 'high' ? 'text-amber-400' : 'text-muted-foreground')}>
                        {e.severity} · {e.lostValueEur}€
                      </span>
                    </div>
                    <div className="text-[10px] font-medium truncate">{e.itemTitle}</div>
                    {e.preventiveAction && <div className="text-[9px] text-primary mt-0.5">→ {e.preventiveAction}</div>}
                  </div>
                ))}
                {shrinkage.detector.insights && (
                  <div className="text-[9px] text-muted-foreground">💡 {shrinkage.detector.insights}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI detektira izgube (krađa, poškodbe, izguba v tranzitu, zastarevanje).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 4. Liquidation Strategist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-amber-400" />
                AI Liquidation Strategist
              </span>
              <Button size="sm" variant="outline" onClick={runLiquidation} disabled={liquidationLoading} className="h-6 text-xs gap-1.5">
                {liquidationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {liquidationLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI pripravlja strategijo likvidacije...
              </div>
            ) : liquidation?.strategist ? (
              <div className="space-y-2 text-xs">
                {liquidation.strategist.insights && (
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-[10px]">
                    💡 {liquidation.strategist.insights}
                  </div>
                )}
                {liquidation.strategist.items?.slice(0, 4).map((item: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px] truncate flex-1">{item.title}</span>
                      <Badge variant="outline" className="text-[9px] ml-1">{item.strategy || item.urgency}</Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {item.daysHeld}d · {item.suggestedAction || item.recommendation}
                    </div>
                  </div>
                ))}
                {liquidation.strategist.summary && (
                  <div className="text-[9px] text-muted-foreground border-t border-border pt-1">
                    📊 {liquidation.strategist.summary.itemsToLiquidate ?? 0} za likvidacijo · {liquidation.strategist.summary.potentialRecoveryEur ?? 0}€
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI predlaga likvidacijo (flash sale, bundle, donation, scrap) za stagnantne iteme.
              </p>
            )}
          </CardContent>
        </Card>

        {/* 5. Rebalancer v3 */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Recycle className="w-4 h-4 text-primary" />
                AI Portfolio Rebalancer v3
              </span>
              <Button size="sm" variant="outline" onClick={runRebalancer} disabled={rebalancerLoading} className="h-6 text-xs gap-1.5">
                {rebalancerLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Recycle className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rebalancerLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI rebalansira portfelj (Markowitz, Kelly, risk-parity)...
              </div>
            ) : rebalancer?.rebalancer ? (
              <div className="space-y-2 text-xs">
                {rebalancer.rebalancer.insights && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                    💡 {rebalancer.rebalancer.insights}
                  </div>
                )}
                {rebalancer.rebalancer.current && rebalancer.rebalancer.target && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-card/30 border rounded p-2">
                      <div className="text-[9px] uppercase text-muted-foreground mb-1">Trenutno stanje</div>
                      {rebalancer.rebalancer.current.categories?.slice(0, 3).map((c: any, i: number) => (
                        <div key={i} className="text-[10px] flex justify-between">
                          <span>{c.category || c.name}</span>
                          <span className="font-mono">{c.percentage ?? c.allocationPct}%</span>
                        </div>
                      ))}
                    </div>
                    <div className="bg-primary/5 border border-primary/20 rounded p-2">
                      <div className="text-[9px] uppercase text-primary mb-1">Priporočeno</div>
                      {rebalancer.rebalancer.target.categories?.slice(0, 3).map((c: any, i: number) => (
                        <div key={i} className="text-[10px] flex justify-between">
                          <span>{c.category || c.name}</span>
                          <span className="font-mono text-primary">{c.percentage ?? c.allocationPct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {rebalancer.rebalancer.actions?.slice(0, 3).map((a: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium">{a.action || a.description}</span>
                      {a.priority && <Badge variant="outline" className="text-[9px]">{a.priority}</Badge>}
                    </div>
                    {a.expectedImpactEur != null && (
                      <div className="text-[9px] text-primary mt-0.5">+{a.expectedImpactEur}€</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI rebalansira portfelj (Markowitz mean-variance, Kelly criterion, risk-parity) za optimalno alokacijo.
              </p>
            )}
          </CardContent>
        </Card>
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
