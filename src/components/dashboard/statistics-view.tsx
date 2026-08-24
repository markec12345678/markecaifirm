'use client';

// v4.7: StatisticsView — globlja analitika z grafi P&L, conversion rate, AI accuracy

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, Target, Sparkles, Activity, BarChart3, PieChart, Percent, Award, AlertTriangle, CheckCircle2, Clock, Wallet, Check, X } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, BarChart, Bar, Cell, LineChart, Line, ReferenceLine } from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { NicheProfitability } from './statistics/niche-profitability';
import { SpeedToSell } from './statistics/speed-to-sell';
import { BudgetAllocator } from './statistics/budget-allocator';
import { ProfitForecast } from './statistics/profit-forecast';
import { PortfolioRebalance } from './statistics/portfolio-rebalance';
import { AiSourcing } from './statistics/ai-sourcing';
import { PricingABTest } from './statistics/pricing-ab-test';
import { CrossBorderArbitrage } from './statistics/cross-border-arbitrage';
import { DemandForecast } from './statistics/demand-forecast';
import { PortfolioCorrelation } from './statistics/portfolio-correlation';
import { CompetitorIntelligence } from './statistics/competitor-intelligence';
import { CashFlowOptimizer } from './statistics/cash-flow-optimizer';
import { InventoryInsurance } from './statistics/inventory-insurance';
import { PredictiveStockout } from './statistics/predictive-stockout';
import { ProfitMargin } from './statistics/profit-margin';
import { EmailCampaign } from './statistics/email-campaign';
import { CustomerLtv } from './statistics/customer-ltv';
import { InventoryAging } from './statistics/inventory-aging';
import { SmartRestock } from './statistics/smart-restock';
import { ProfitDashboard } from './statistics/profit-dashboard';
import { PredictiveProcurement } from './statistics/predictive-procurement';
import { FullAutomation } from './statistics/full-automation';
import { MasterDashboard } from './statistics/master-dashboard';
import { AutonomousTrading } from './statistics/autonomous-trading';
import { ProfitPlaybook } from './statistics/profit-playbook';

interface AdvancedStats {
  generatedAt: string;
  keyMetrics: {
    totalRealizedProfit: number;
    totalInvestedHeld: number;
    avgRoi: number | null;
    totalTrades: number;
    soldCount: number;
    heldCount: number;
    cancelledCount: number;
  };
  monthlyPnl: Array<{ month: string; label: string; profit: number; count: number; cumulative: number; invested: number }>;
  conversion: {
    totalListings: number;
    bookmarked: number;
    contacted: number;
    responded: number;
    closed: number;
    withTarget: number;
    targetsHit: number;
    tradesFromListings: number;
    bookmarkToContactPct: number | null;
    contactToResponsePct: number | null;
    responseToClosedPct: number | null;
    bookmarkToTradePct: number | null;
    targetHitPct: number | null;
  };
  aiAccuracy: {
    sampleSize: number;
    avgAbsErrorPct: number | null;
    within15Pct: number | null;
    within30Pct: number | null;
    prilikaAccuracyPct: number | null;
    prilikaSampleSize: number;
    topPredictions: Array<{ id: string; title: string; listingPrice: number | null; aiEstimate: number | null; actualPrice: number | null; diff: number | null; diffPct: number | null }>;
    worstPredictions: Array<{ id: string; title: string; listingPrice: number | null; aiEstimate: number | null; actualPrice: number | null; diff: number | null; diffPct: number | null }>;
  };
  monitorPerformance: Array<{
    id: string;
    name: string;
    source: string;
    isActive: boolean;
    totalListings: number;
    totalAlerts: number;
    totalRuns: number;
    recentRuns: number;
    successRate: number | null;
    successCount: number;
    errorCount: number;
    avgDuration: number | null;
    recentNewListings: number;
    recentAlertsSent: number;
  }>;
  sourceBreakdown: Array<{ source: string; listings: number; monitors: number }>;
  topCategories: Array<{
    name: string;
    count: number;
    profit: number;
    invested: number;
    sold: number;
    held: number;
    avgRoi: number;
    conversionRate: number;
  }>;
}

export function StatisticsView() {
  const [data, setData] = useState<AdvancedStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats/advanced');
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error('Ne morem naložiti statistik');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const km = data.keyMetrics;
  const conv = data.conversion;
  const ai = data.aiAccuracy;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Statistike
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Globoka analitika: P&L, konverzije, AI natančnost, uspešnost monitorjev.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} aria-label="Osveži statistike" className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" />
          Osveži
        </Button>
      </div>

      {/* Key metrics cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Realizirani dobiček</div>
            <div className={cn('text-2xl font-bold font-mono', km.totalRealizedProfit >= 0 ? 'text-primary' : 'text-red-500')}>
              {km.totalRealizedProfit >= 0 ? '+' : ''}{km.totalRealizedProfit.toFixed(0)}€
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{km.soldCount} prodaj</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">V investiciji</div>
            <div className="text-2xl font-bold font-mono text-amber-400">{km.totalInvestedHeld.toFixed(0)}€</div>
            <div className="text-[10px] text-muted-foreground mt-1">{km.heldCount} v skladišču</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Povprečni ROI</div>
            <div className={cn('text-2xl font-bold font-mono', (km.avgRoi ?? 0) >= 0 ? 'text-primary' : 'text-red-500')}>
              {km.avgRoi != null ? `${km.avgRoi >= 0 ? '+' : ''}${km.avgRoi}%` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{km.soldCount} prodaj</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Skupaj tradeov</div>
            <div className="text-2xl font-bold font-mono">{km.totalTrades}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {km.soldCount} prodani • {km.heldCount} v skladišču • {km.cancelledCount} preklicanih
            </div>
          </CardContent>
        </Card>
      </div>

      {/* P&L Chart */}
      <Card className="bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Dobiček in investicije (zadnjih 12 mesecev)
          </CardTitle>
          <CardDescription className="text-xs">
            Mesečni profit vs investicije, s kumulativo dobička.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.monthlyPnl.every(m => m.count === 0 && m.invested === 0) ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Ni podatkov o tradeih. Dodaj prve trade v Skladišče.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.monthlyPnl}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} />
                <YAxis tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={(v) => `${v}€`} />
                <RTooltip
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #404040', borderRadius: '4px', fontSize: 12 }}
                  labelStyle={{ color: '#10b981' }}
                  formatter={(value: any, name: string) => {
                    const labels: Record<string, string> = {
                      profit: 'Dobiček',
                      invested: 'Investicija',
                      cumulative: 'Kumulativa',
                    };
                    return [`${Number(value).toFixed(0)}€`, labels[name] ?? name];
                  }}
                />
                <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fill="url(#profitGrad)" />
                <Area type="monotone" dataKey="invested" stroke="#f59e0b" strokeWidth={1.5} fill="url(#investedGrad)" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Conversion Funnel */}
      <Card className="bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Konverzijski lijak
          </CardTitle>
          <CardDescription className="text-xs">
            Kako učinkovito pretvarjaš oglase v kontakte, odgovore in prodaje.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { label: 'Vsi oglasi', value: conv.totalListings, color: 'bg-muted-foreground', pct: 100 },
              { label: 'Shranjeni (bookmark)', value: conv.bookmarked, color: 'bg-amber-400', pct: conv.totalListings > 0 ? Math.round((conv.bookmarked / conv.totalListings) * 100) : 0 },
              { label: 'Kontaktirani', value: conv.contacted, color: 'bg-blue-400', pct: conv.bookmarked > 0 ? Math.round((conv.contacted / conv.bookmarked) * 100) : 0 },
              { label: 'Odgovorili', value: conv.responded, color: 'bg-purple-400', pct: conv.contacted > 0 ? Math.round((conv.responded / conv.contacted) * 100) : 0 },
              { label: 'Zaključeni (trade)', value: conv.tradesFromListings, color: 'bg-primary', pct: conv.responded > 0 ? Math.round((conv.tradesFromListings / conv.responded) * 100) : 0 },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-32 text-xs text-muted-foreground shrink-0">{step.label}</div>
                <div className="flex-1 h-7 bg-background rounded relative overflow-hidden">
                  <div
                    className={cn('h-full transition-all', step.color)}
                    style={{ width: `${Math.max(5, step.pct)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-[11px] font-mono">
                    {step.value}
                    <span className="ml-auto text-muted-foreground">({step.pct}%)</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Bookmark → Kontakt</div>
              <div className="font-mono font-bold text-primary">
                {conv.bookmarkToContactPct != null ? `${conv.bookmarkToContactPct}%` : '—'}
              </div>
            </div>
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Kontakt → Odgovor</div>
              <div className="font-mono font-bold text-primary">
                {conv.contactToResponsePct != null ? `${conv.contactToResponsePct}%` : '—'}
              </div>
            </div>
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Odgovor → Trade</div>
              <div className="font-mono font-bold text-primary">
                {conv.responseToClosedPct != null ? `${conv.responseToClosedPct}%` : '—'}
              </div>
            </div>
            <div className="bg-background/30 rounded p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Ciljna cena zadetka</div>
              <div className="font-mono font-bold text-primary">
                {conv.targetHitPct != null ? `${conv.targetHitPct}%` : '—'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Accuracy */}
      <Card className="bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI natančnost
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.7</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Kako natančno AI napoveduje tržno vrednost (primerjava AI ocene s produkcijsko ceno).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ai.sampleSize === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-50" />
              Ni dovolj podatkov. Za analizo AI natančnosti potrebuješ vsaj en prodan trade, ki izvira iz listinga z AI oceno.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Vzorec</div>
                  <div className="text-xl font-bold font-mono">{ai.sampleSize}</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Povp. napaka</div>
                  <div className={cn(
                    'text-xl font-bold font-mono',
                    (ai.avgAbsErrorPct ?? 0) <= 15 ? 'text-primary' :
                    (ai.avgAbsErrorPct ?? 0) <= 30 ? 'text-amber-400' : 'text-red-500'
                  )}>
                    ±{ai.avgAbsErrorPct}%
                  </div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Znotraj ±15%</div>
                  <div className="text-xl font-bold font-mono text-primary">{ai.within15Pct}%</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Znotraj ±30%</div>
                  <div className="text-xl font-bold font-mono">{ai.within30Pct}%</div>
                </div>
              </div>

              {/* Prilika accuracy */}
              {ai.prilikaSampleSize > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-3 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-primary">AI PRILIKA — realizacija</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Od {ai.prilikaSampleSize} oglasov, ki jih je AI ocenil kot "PRILIKA", je {ai.prilikaAccuracyPct}% vodilo v profitabilno prodajo.
                      </div>
                    </div>
                    <div className="text-3xl font-bold font-mono text-primary">{ai.prilikaAccuracyPct}%</div>
                  </div>
                </div>
              )}

              {/* Best predictions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                    <Award className="w-3 h-3 text-primary" /> TOP 5 najbolj točnih napovedi
                  </h4>
                  <div className="space-y-1">
                    {ai.topPredictions.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2 p-1.5 bg-background/30 rounded text-xs">
                        <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{p.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            AI: {p.aiEstimate}€ → dejansko: {p.actualPrice}€
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                          ±{Math.abs(p.diffPct ?? 0)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400" /> TOP 5 najmanj točnih napovedi
                  </h4>
                  <div className="space-y-1">
                    {ai.worstPredictions.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2 p-1.5 bg-background/30 rounded text-xs">
                        <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{p.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            AI: {p.aiEstimate}€ → dejansko: {p.actualPrice}€
                          </div>
                        </div>
                        <Badge variant="outline" className={cn(
                          'text-[10px]',
                          Math.abs(p.diffPct ?? 0) > 30 ? 'text-red-500 border-red-500/40' : 'text-amber-400 border-amber-400/40'
                        )}>
                          ±{Math.abs(p.diffPct ?? 0)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Source breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" />
              Oglasi po viru
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.sourceBreakdown.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">Ni podatkov</div>
            ) : (
              <div className="space-y-2">
                {data.sourceBreakdown.map(s => {
                  const total = data.sourceBreakdown.reduce((sum, x) => sum + x.listings, 0);
                  const pct = total > 0 ? Math.round((s.listings / total) * 100) : 0;
                  return (
                    <div key={s.source}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium uppercase">{s.source}</span>
                        <span className="text-muted-foreground">
                          {s.listings} oglasov • {s.monitors} monitorjev • {pct}%
                        </span>
                      </div>
                      <div className="h-2 bg-background rounded overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top categories */}
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Top kategorije po dobičku
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topCategories.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">Ni tradeov</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.topCategories.slice(0, 5)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={(v) => `${v}€`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#737373' }} width={80} />
                  <RTooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #404040', borderRadius: '4px', fontSize: 12 }}
                    formatter={(value: any) => [`${Number(value).toFixed(0)}€`, 'Dobiček']}
                  />
                  <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                    {data.topCategories.slice(0, 5).map((c, i) => (
                      <Cell key={i} fill={c.profit >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monitor performance table */}
      <Card className="bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Uspešnost monitorjev
          </CardTitle>
          <CardDescription className="text-xs">
            Zadnjih 30 poganjanjev — success rate, povprečni čas, št. novih oglasov in alertov.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.monitorPerformance.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">Ni monitorjev</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-2 font-medium text-muted-foreground">Monitor</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-center">Aktiven</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Listings</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Alerti</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Runs</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-center">Success</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Avg čas</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Novi (30d)</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Alerti (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monitorPerformance.map(m => (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-background/30">
                      <td className="py-2 px-2">
                        <div className="font-medium truncate max-w-[200px]">{m.name}</div>
                        <div className="text-[10px] text-muted-foreground">{m.source}</div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {m.isActive ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary mx-auto" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{m.totalListings}</td>
                      <td className="py-2 px-2 text-right font-mono">{m.totalAlerts}</td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">{m.totalRuns}</td>
                      <td className="py-2 px-2 text-center">
                        {m.successRate != null ? (
                          <Badge variant="outline" className={cn(
                            'text-[10px] font-mono',
                            m.successRate >= 80 ? 'text-primary border-primary/40' :
                            m.successRate >= 50 ? 'text-amber-400 border-amber-400/40' :
                            'text-red-500 border-red-500/40'
                          )}>
                            {m.successRate}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                        {m.avgDuration != null ? `${(m.avgDuration / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{m.recentNewListings}</td>
                      <td className="py-2 px-2 text-right font-mono">{m.recentAlertsSent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center pt-2">
        Generirano: {new Date(data.generatedAt).toLocaleString('sl-SI')}
      </p>

      <NicheProfitability />

      <SpeedToSell />

      <BudgetAllocator />

      <ProfitForecast />

      <PortfolioRebalance />

      <AiSourcing />

      <PricingABTest />

      <CrossBorderArbitrage />

      <DemandForecast />

      <PortfolioCorrelation />

      <CompetitorIntelligence />

      <CashFlowOptimizer />

      <InventoryInsurance />

      <PredictiveStockout />

      <ProfitMargin />

      <EmailCampaign />

      <CustomerLtv />

      <InventoryAging />

      <SmartRestock />

      <ProfitDashboard />

      <PredictiveProcurement />

      <FullAutomation />

      <MasterDashboard />

      <AutonomousTrading />

      <ProfitPlaybook />
    </div>
  );
}
