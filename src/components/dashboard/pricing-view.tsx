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
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, DollarSign, TrendingUp, Percent, Swords, Calendar, Sparkles, BarChart3, BookOpen, Target, MapPin, Brain } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Trade {
  id: string;
  title: string;
  buyPrice: number;
  sellPrice: number | null;
  category: string;
  status: string;
}

export function PricingView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  // AI results
  const [smartPricing, setSmartPricing] = useState<any>(null);
  const [smartPricingLoading, setSmartPricingLoading] = useState(false);
  const [forecast, setForecast] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [margin, setMargin] = useState<any>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [priceWar, setPriceWar] = useState<any>(null);
  const [priceWarLoading, setPriceWarLoading] = useState(false);
  const [seasonal, setSeasonal] = useState<any>(null);
  const [seasonalLoading, setSeasonalLoading] = useState(false);
  // v7.14: 5 novih pricing AI funkcij
  const [profitDash, setProfitDash] = useState<any>(null);
  const [profitDashLoading, setProfitDashLoading] = useState(false);
  const [playbook, setPlaybook] = useState<any>(null);
  const [playbookLoading, setPlaybookLoading] = useState(false);
  const [reservePrice, setReservePrice] = useState<any>(null);
  const [reservePriceLoading, setReservePriceLoading] = useState(false);
  const [psychology, setPsychology] = useState<any>(null);
  const [psychologyLoading, setPsychologyLoading] = useState(false);
  const [geoPrice, setGeoPrice] = useState<any>(null);
  const [geoPriceLoading, setGeoPriceLoading] = useState(false);

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

  // ===== AI runners =====
  const runSmartPricing = async () => {
    setSmartPricingLoading(true); setSmartPricing(null);
    try {
      const res = await fetch('/api/ai/smart-pricing-engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setSmartPricing(data); toast.success('✓ Smart pricing generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setSmartPricingLoading(false); }
  };

  const runForecast = async () => {
    setForecastLoading(true); setForecast(null);
    try {
      const res = await fetch('/api/ai/profit-forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: 1 }) });
      const data = await res.json();
      if (data.ok) { setForecast(data); toast.success('✓ Napoved dobička generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setForecastLoading(false); }
  };

  const runMargin = async () => {
    setMarginLoading(true); setMargin(null);
    try {
      const res = await fetch('/api/ai/margin-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setMargin(data); toast.success('✓ Optimizacija marže generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setMarginLoading(false); }
  };

  const runPriceWar = async () => {
    setPriceWarLoading(true); setPriceWar(null);
    try {
      const res = await fetch('/api/ai/price-war-strategist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setPriceWar(data); toast.success('✓ Price war strategija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setPriceWarLoading(false); }
  };

  const runSeasonal = async () => {
    setSeasonalLoading(true); setSeasonal(null);
    try {
      const res = await fetch('/api/ai/seasonal-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setSeasonal(data); toast.success('✓ Sezonsko določanje cen generirano'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setSeasonalLoading(false); }
  };

  // v7.14: 6-10. Pet novih pricing AI funkcij
  const runProfitDash = async () => { setProfitDashLoading(true); setProfitDash(null); try { const r = await fetch('/api/ai/profit-dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setProfitDash(d); toast.success('✓ Profit dashboard generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setProfitDashLoading(false); } };
  const runPlaybook = async () => { setPlaybookLoading(true); setPlaybook(null); try { const r = await fetch('/api/ai/profit-playbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setPlaybook(d); toast.success('✓ Profit playbook generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setPlaybookLoading(false); } };
  const runReservePrice = async () => { setReservePriceLoading(true); setReservePrice(null); try { const r = await fetch('/api/ai/reserve-price-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setReservePrice(d); toast.success('✓ Reserve price generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setReservePriceLoading(false); } };
  const runPsychology = async () => { setPsychologyLoading(true); setPsychology(null); try { const r = await fetch('/api/ai/pricing-psychology-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setPsychology(d); toast.success('✓ Pricing psychology generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setPsychologyLoading(false); } };
  const runGeoPrice = async () => { setGeoPriceLoading(true); setGeoPrice(null); try { const r = await fetch('/api/ai/geo-price-map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setGeoPrice(d); toast.success('✓ Geo price map generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setGeoPriceLoading(false); } };

  const runAll = async () => {
    await Promise.all([runSmartPricing(), runForecast(), runMargin(), runPriceWar(), runSeasonal(), runProfitDash(), runPlaybook(), runReservePrice(), runPsychology(), runGeoPrice()]);
  };

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
          <Button onClick={runAll} disabled={trades.length === 0} size="sm" className="gap-2">
            <Sparkles className="w-4 h-4" /> Generiraj vse
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />
                AI Smart Pricing Engine
              </span>
              <Button size="sm" variant="outline" onClick={runSmartPricing} disabled={smartPricingLoading} className="h-6 text-xs gap-1.5">
                {smartPricingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {smartPricingLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI določa optimalne cene (10 faktorjev)...
              </div>
            ) : smartPricing?.pricing ? (
              <div className="space-y-2 text-xs">
                {smartPricing.pricing.adjustmentsSummary && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase text-primary">Adjustments</span>
                      <span className="font-mono text-primary">{smartPricing.pricing.adjustmentsSummary.totalItems ?? smartPricing.pricing.items?.length ?? 0} itemov</span>
                    </div>
                  </div>
                )}
                {smartPricing.pricing.items?.slice(0, 4).map((item: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px] truncate flex-1">{item.title || item.name}</span>
                      <Badge variant="outline" className={cn('text-[9px] ml-1',
                        item.adjustment?.includes('increase') ? 'text-primary border-primary/30' :
                        item.adjustment?.includes('decrease') ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                        {item.adjustment || item.strategy || '—'}
                      </Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {item.currentPrice ?? item.buyPrice}€ → <b className="text-primary">{item.recommendedPrice ?? item.suggestedPrice}€</b>
                      {item.reason && <span className="ml-1">· {item.reason}</span>}
                    </div>
                  </div>
                ))}
                {smartPricing.pricing.insights && (
                  <div className="text-[9px] text-muted-foreground">💡 {smartPricing.pricing.insights}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI določa optimalne cene (10 faktorjev: days_held, deal_score, sezonost, konkurenca...).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 2. Profit Forecast */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                AI Profit Forecast
              </span>
              <Button size="sm" variant="outline" onClick={runForecast} disabled={forecastLoading} className="h-6 text-xs gap-1.5">
                {forecastLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {forecastLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI napoveduje dobiček za naslednji mesec...
              </div>
            ) : forecast?.forecast ? (
              <div className="space-y-2 text-xs">
                <div className={cn('border rounded p-2',
                  forecast.forecast.expectedProfit >= 0 ? 'bg-primary/10 border-primary/30' : 'bg-red-500/10 border-red-500/30')}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase text-[10px]">Pričakovan dobiček</span>
                    <Badge variant="outline" className="text-[9px] font-mono font-bold text-primary border-primary/40">
                      {forecast.forecast.confidence}% confidence
                    </Badge>
                  </div>
                  <div className="text-lg font-mono font-bold text-primary mt-1">
                    {forecast.forecast.expectedProfit.toLocaleString('sl-SI')} €
                  </div>
                </div>
                {forecast.forecast.scenarios && (
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <div className="bg-primary/5 rounded p-1.5 border text-center">
                      <div className="text-[9px] text-muted-foreground">Optimistično</div>
                      <div className="font-mono font-bold text-primary">{forecast.forecast.scenarios.optimistic?.profit ?? 0}€</div>
                      <div className="text-[9px] text-muted-foreground">{forecast.forecast.scenarios.optimistic?.probability ?? 25}%</div>
                    </div>
                    <div className="bg-card/30 rounded p-1.5 border text-center">
                      <div className="text-[9px] text-muted-foreground">Realno</div>
                      <div className="font-mono font-bold">{forecast.forecast.scenarios.realistic?.profit ?? 0}€</div>
                      <div className="text-[9px] text-muted-foreground">{forecast.forecast.scenarios.realistic?.probability ?? 50}%</div>
                    </div>
                    <div className="bg-red-500/5 rounded p-1.5 border text-center">
                      <div className="text-[9px] text-muted-foreground">Pessimistično</div>
                      <div className="font-mono font-bold text-amber-400">{forecast.forecast.scenarios.pessimistic?.profit ?? 0}€</div>
                      <div className="text-[9px] text-muted-foreground">{forecast.forecast.scenarios.pessimistic?.probability ?? 25}%</div>
                    </div>
                  </div>
                )}
                {forecast.forecast.factors?.length > 0 && (
                  <div className="text-[9px] text-muted-foreground">📊 {forecast.forecast.factors.slice(0, 3).join(' · ')}</div>
                )}
                {forecast.forecast.recommendation && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                    💡 {forecast.forecast.recommendation}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI napove dobiček za naslednji mesec (scenariji, faktorji, priporočila).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 3. Margin Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-amber-400" />
                AI Margin Optimizer
              </span>
              <Button size="sm" variant="outline" onClick={runMargin} disabled={marginLoading} className="h-6 text-xs gap-1.5">
                {marginLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Percent className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {marginLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI optimizira marže...
              </div>
            ) : margin?.items?.length > 0 ? (
              <div className="space-y-2 text-xs">
                {margin.items.slice(0, 4).map((item: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px] truncate flex-1">{item.title || item.name}</span>
                      <Badge variant="outline" className={cn('text-[9px] ml-1',
                        (item.currentMargin ?? item.margin ?? 0) >= 25 ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>
                        {item.currentMargin ?? item.margin ?? 0}%
                      </Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {item.buyPrice}€ → {item.suggestedSellPrice ?? item.optimalPrice ?? '?'}€
                      {item.recommendedAction && <span> · {item.recommendedAction}</span>}
                    </div>
                  </div>
                ))}
                {margin.summary?.summary && (
                  <div className="text-[9px] text-muted-foreground">💡 {margin.summary.summary}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI optimizira marže (predlagane cene, akcije za povečanje dobička).
              </p>
            )}
          </CardContent>
        </Card>

        {/* 4. Price War Strategist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Swords className="w-4 h-4 text-red-500" />
                AI Price War Strategist
              </span>
              <Button size="sm" variant="outline" onClick={runPriceWar} disabled={priceWarLoading} className="h-6 text-xs gap-1.5">
                {priceWarLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Swords className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {priceWarLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI analizira cenovne vojne...
              </div>
            ) : priceWar?.strategist ? (
              <div className="space-y-2 text-xs">
                {priceWar.strategist.wars?.slice(0, 3).map((w: any, i: number) => (
                  <div key={i} className={cn('border rounded p-2',
                    w.threatLevel === 'high' ? 'bg-red-500/5 border-red-500/20' : 'bg-card/30 border-border')}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px]">{w.category || w.name}</span>
                      <Badge variant="outline" className={cn('text-[9px]',
                        w.threatLevel === 'high' ? 'text-red-500 border-red-500/30' :
                        w.threatLevel === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-primary border-primary/30')}>
                        {w.threatLevel || w.severity}
                      </Badge>
                    </div>
                    {w.strategy && <div className="text-[9px] text-muted-foreground">→ {w.strategy}</div>}
                    {w.priceDrops != null && <div className="text-[9px] text-amber-400">{w.priceDrops} padcev cen</div>}
                  </div>
                ))}
                {priceWar.strategist.strategies?.slice(0, 2).map((s: any, i: number) => (
                  <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                    <div className="text-[10px] font-medium text-primary">{s.strategy || s.name}</div>
                    <div className="text-[9px] text-muted-foreground">{s.description || s.action}</div>
                  </div>
                ))}
                {priceWar.strategist.insights && (
                  <div className="text-[9px] text-muted-foreground">💡 {priceWar.strategist.insights}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI zazna cenovne vojne in predlaga obrambne/ofenzivne strategije.
              </p>
            )}
          </CardContent>
        </Card>

        {/* 5. Seasonal Pricing */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                AI Seasonal Pricing
              </span>
              <Button size="sm" variant="outline" onClick={runSeasonal} disabled={seasonalLoading} className="h-6 text-xs gap-1.5">
                {seasonalLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
                Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {seasonalLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
                AI analizira sezonske vzorce cen...
              </div>
            ) : seasonal?.pricing ? (
              <div className="space-y-2 text-xs">
                {seasonal.pricing.seasonalFactors?.slice(0, 4).map((f: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-[10px]">{f.season || f.month || f.factor}</span>
                      <Badge variant="outline" className={cn('text-[9px]',
                        (f.priceMultiplier ?? f.adjustment ?? 1) >= 1 ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>
                        {f.priceMultiplier ?? f.adjustment ?? 1}×
                      </Badge>
                    </div>
                    {f.recommendation && <div className="text-[9px] text-muted-foreground">{f.recommendation}</div>}
                  </div>
                ))}
                {seasonal.pricing.items?.slice(0, 3).map((item: any, i: number) => (
                  <div key={i} className="bg-card/30 border rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium truncate flex-1">{item.title || item.name}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {item.currentPrice ?? item.buyPrice}€ → <b className="text-primary">{item.seasonalPrice ?? item.recommendedPrice ?? '?'}€</b>
                      </span>
                    </div>
                  </div>
                ))}
                {seasonal.pricing.insights && (
                  <div className="text-[9px] text-muted-foreground">💡 {seasonal.pricing.insights}</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                AI analizira sezonske vzorce cen (12-mesečni patterni, 4 letni časi: Zima/Pomlad/Poletje/Jesen).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* v7.14: 5 novih pricing AI panelov */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 6. Profit Dashboard */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> AI Profit Dashboard</span>
              <Button size="sm" variant="outline" onClick={runProfitDash} disabled={profitDashLoading} className="h-6 text-xs gap-1.5">
                {profitDashLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profitDashLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI gradi profit dashboard...</div>
            ) : profitDash?.dashboard ? (
              <div className="space-y-2 text-xs">
                {profitDash.dashboard.summary && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">💡 {profitDash.dashboard.summary}</div>
                )}
                {profitDash.dashboard.metrics?.slice(0, 4).map((m: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px]">{m.label || m.name}</span>
                    <span className="font-mono text-primary text-[10px]">{m.value}{m.unit ?? '€'}</span>
                  </div>
                ))}
                {profitDash.dashboard.insights && <div className="text-[9px] text-muted-foreground">💡 {profitDash.dashboard.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI zgradi celovit profit dashboard z metrikami.</p>
            )}
          </CardContent>
        </Card>

        {/* 7. Profit Playbook */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /> AI Profit Playbook</span>
              <Button size="sm" variant="outline" onClick={runPlaybook} disabled={playbookLoading} className="h-6 text-xs gap-1.5">
                {playbookLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {playbookLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI pripravlja profit playbook...</div>
            ) : playbook?.playbook ? (
              <div className="space-y-2 text-xs">
                {playbook.playbook.strategies?.slice(0, 3).map((s: any, i: number) => (
                  <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                    <div className="text-[10px] font-medium text-primary">{s.strategy || s.name}</div>
                    <div className="text-[9px] text-muted-foreground">{s.description || s.action}</div>
                  </div>
                ))}
                {playbook.playbook.insights && <div className="text-[9px] text-muted-foreground">💡 {playbook.playbook.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI pripravi strategije za maksimiranje dobička (v6.40 MILESTONE).</p>
            )}
          </CardContent>
        </Card>

        {/* 8. Reserve Price Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" /> AI Reserve Price Optimizer</span>
              <Button size="sm" variant="outline" onClick={runReservePrice} disabled={reservePriceLoading} className="h-6 text-xs gap-1.5">
                {reservePriceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reservePriceLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira reserve price...</div>
            ) : reservePrice?.optimizer ? (
              <div className="space-y-2 text-xs">
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase text-amber-400">Priporočen reserve price</span>
                    <span className="font-mono font-bold text-amber-400">{reservePrice.optimizer.reservePrice ?? reservePrice.optimizer.suggestedPrice ?? '?'}€</span>
                  </div>
                </div>
                {reservePrice.optimizer.reasoning && <div className="text-[9px] text-muted-foreground">{reservePrice.optimizer.reasoning}</div>}
                {reservePrice.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {reservePrice.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI optimizira reserve price za dražbe (minimalna sprejemljiva cena).</p>
            )}
          </CardContent>
        </Card>

        {/* 9. Pricing Psychology Optimizer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" /> AI Pricing Psychology</span>
              <Button size="sm" variant="outline" onClick={runPsychology} disabled={psychologyLoading} className="h-6 text-xs gap-1.5">
                {psychologyLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {psychologyLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira psihologijo cen...</div>
            ) : psychology?.optimizer ? (
              <div className="space-y-2 text-xs">
                {psychology.optimizer.tactics?.slice(0, 3).map((t: any, i: number) => (
                  <div key={i} className="bg-purple-500/5 border border-purple-500/20 rounded p-2">
                    <div className="text-[10px] font-medium text-purple-400">{t.tactic || t.name}</div>
                    <div className="text-[9px] text-muted-foreground">{t.description || t.effect}</div>
                  </div>
                ))}
                {psychology.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {psychology.optimizer.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI optimizira cene s psihološkimi taktikami (charm pricing, anchoring...).</p>
            )}
          </CardContent>
        </Card>

        {/* 10. Geo Price Map */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-cyan-400" /> AI Geo Price Map</span>
              <Button size="sm" variant="outline" onClick={runGeoPrice} disabled={geoPriceLoading} className="h-6 text-xs gap-1.5">
                {geoPriceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />} Generiraj
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {geoPriceLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI gradi geo price map...</div>
            ) : geoPrice?.map ? (
              <div className="space-y-2 text-xs">
                {geoPrice.map.regions?.slice(0, 4).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                    <span className="text-[10px] font-medium">{r.region || r.location || r.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">{r.listingCount ?? r.count} oglasov</span>
                      <span className="font-mono text-primary text-[10px]">{r.avgPrice ?? r.averagePrice ?? '?'}€</span>
                    </div>
                  </div>
                ))}
                {geoPrice.map.insights && <div className="text-[9px] text-muted-foreground">💡 {geoPrice.map.insights}</div>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">AI gradi zemljevid cen po regijah (kje je najdražje/najceneje prodati).</p>
            )}
          </CardContent>
        </Card>
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
