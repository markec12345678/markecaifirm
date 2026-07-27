'use client';

// v4.7: StatisticsView — globlja analitika z grafi P&L, conversion rate, AI accuracy

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, Target, Sparkles, Activity, BarChart3, PieChart, Percent, Award, AlertTriangle, CheckCircle2, Clock, Wallet } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, BarChart, Bar, Cell, LineChart, Line, ReferenceLine } from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

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
  // v6.3: Niche profitability
  const [nicheData, setNicheData] = useState<any>(null);
  const [nicheLoading, setNicheLoading] = useState(false);
  // v6.4: Speed-to-Sell
  const [speedData, setSpeedData] = useState<any>(null);
  // v6.6: Budget allocator
  const [budgetData, setBudgetData] = useState<any>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetInput, setBudgetInput] = useState('1000');
  // v6.8: Profit forecast
  const [forecastData, setForecastData] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  // v6.9: Rebalance
  const [rebalanceData, setRebalanceData] = useState<any>(null);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  // v6.10: AI Sourcing
  const [sourcingData, setSourcingData] = useState<any>(null);
  const [sourcingLoading, setSourcingLoading] = useState(false);
  const [sourcingBudget, setSourcingBudget] = useState('');
  // v6.11: A/B Testing + Cross-Border
  const [abTestData, setAbTestData] = useState<any>(null);
  const [abTestLoading, setAbTestLoading] = useState(false);
  const [crossBorderData, setCrossBorderData] = useState<any>(null);
  const [crossBorderLoading, setCrossBorderLoading] = useState(false);
  const [crossBorderQuery, setCrossBorderQuery] = useState('');
  // v6.12: Demand Forecast + Portfolio Correlation
  const [demandData, setDemandData] = useState<any>(null);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandMonths, setDemandMonths] = useState('3');
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);
  // v6.13: Competitor Intel + Cash Flow
  const [competitorData, setCompetitorData] = useState<any>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorCategory, setCompetitorCategory] = useState('');
  const [cashflowData, setCashflowData] = useState<any>(null);
  const [cashflowLoading, setCashflowLoading] = useState(false);
  const [cashflowDays, setCashflowDays] = useState('30');
  // v6.14: Insurance Optimizer
  const [insuranceData, setInsuranceData] = useState<any>(null);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [insuranceStorage, setInsuranceStorage] = useState('home');
  // v6.15: Predictive Stockout + Margin Optimizer
  const [stockoutData, setStockoutData] = useState<any>(null);
  const [stockoutLoading, setStockoutLoading] = useState(false);
  const [stockoutDays, setStockoutDays] = useState('30');
  const [marginData, setMarginData] = useState<any>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  // v6.16: Email Campaign + Customer LTV
  const [campaignData, setCampaignData] = useState<any>(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignType, setCampaignType] = useState<'win_back' | 'new_buyers' | 'bundle_offer' | 'clearance' | 'seasonal' | 'newsletter'>('newsletter');
  const [campaignCopied, setCampaignCopied] = useState<string | null>(null);
  const [ltvData, setLtvData] = useState<any>(null);
  const [ltvLoading, setLtvLoading] = useState(false);
  // v6.24: Inventory Aging + Smart Restock
  const [agingData, setAgingData] = useState<any>(null);
  const [agingLoading, setAgingLoading] = useState(false);
  const [restockData, setRestockData] = useState<any>(null);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockBudget, setRestockBudget] = useState('');
  // v6.30 MILESTONE: Profit Dashboard + Procurement + Automation
  const [dashData, setDashData] = useState<any>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [procData, setProcData] = useState<any>(null);
  const [procLoading, setProcLoading] = useState(false);
  const [procBudget, setProcBudget] = useState('');
  const [procRisk, setProcRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [autoData, setAutoData] = useState<any>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoMode, setAutoMode] = useState<'advisory' | 'semi_auto' | 'full_auto'>('advisory');

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

  // v6.3: Load niche profitability
  const loadNiche = useCallback(async () => {
    setNicheLoading(true);
    try {
      const res = await fetch('/api/trades/niche-profitability');
      if (res.ok) setNicheData(await res.json());
    } catch { /* ignore */ }
    finally { setNicheLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadNiche(); }, [loadNiche]);
  useEffect(() => {
    fetch('/api/stats/speed-to-sell').then(r => r.ok ? r.json() : null).then(d => d && setSpeedData(d)).catch(() => {});
  }, []);

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
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
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

      {/* v6.3: Niche Profitability Tracker */}
      {nicheData && !nicheLoading && (
        <Card className="bg-card/50 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" />
              Profitabilnost niš (kategorij)
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.3</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Katere kategorije so najbolj profitabilne? AI priporoča na kaj se osredotočiti.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {nicheData.summary ? (
              <div className="space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Skupno</div>
                    <div className={cn('font-mono font-bold text-lg', nicheData.summary.totalProfit >= 0 ? 'text-primary' : 'text-red-500')}>
                      {nicheData.summary.totalProfit >= 0 ? '+' : ''}{nicheData.summary.totalProfit}€
                    </div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">ROI</div>
                    <div className="font-mono font-bold text-primary">{nicheData.summary.overallRoi}%</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Prodani</div>
                    <div className="font-mono font-bold">{nicheData.summary.totalSold}</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">V skladišču</div>
                    <div className="font-mono font-bold text-amber-400">{nicheData.summary.totalHeld}</div>
                  </div>
                </div>

                {/* Best/Worst niche */}
                {nicheData.summary.bestNiche && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs">
                    <span className="text-primary font-bold">🏆 Najboljša: </span>
                    {nicheData.summary.bestNiche.category} ({nicheData.summary.bestNiche.avgRoi}% ROI)
                  </div>
                )}
                {nicheData.summary.worstNiche && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-2 text-xs">
                    <span className="text-red-500 font-bold">🔴 Najslabša: </span>
                    {nicheData.summary.worstNiche.category} ({nicheData.summary.worstNiche.avgRoi}% ROI)
                  </div>
                )}

                {/* Niche list */}
                <div className="space-y-1.5">
                  {nicheData.niches.map((n: any, i: number) => (
                    <div key={i} className={cn('flex items-center gap-2 p-2 rounded text-xs border',
                      n.score >= 70 ? 'bg-primary/5 border-primary/20' :
                      n.score >= 50 ? 'bg-amber-400/5 border-amber-400/20' :
                      'bg-red-500/5 border-red-500/20')}>
                      <Badge variant="outline" className="text-[9px] shrink-0">{n.category}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('font-mono font-bold', n.avgRoi > 0 ? 'text-primary' : 'text-red-500')}>
                            {n.avgRoi > 0 ? '+' : ''}{n.avgRoi}% ROI
                          </span>
                          <span className="text-muted-foreground">{n.soldCount} prodanih</span>
                          {n.avgDaysToSell != null && <span className="text-muted-foreground">~{n.avgDaysToSell}d prodaja</span>}
                          <span className="text-muted-foreground">{n.sellThroughRate}% sell-through</span>
                        </div>
                        <div className="text-[10px] italic mt-0.5">{n.recommendation}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cn('font-mono font-bold', n.totalProfit >= 0 ? 'text-primary' : 'text-red-500')}>
                          {n.totalProfit >= 0 ? '+' : ''}{n.totalProfit}€
                        </div>
                        <div className="text-[9px] text-muted-foreground">investirano: {n.totalInvested}€</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">Ni podatkov o tradeih.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* v6.4: Speed-to-Sell Analytics */}
      {speedData?.overall && (
        <Card className="bg-card/50 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Hitrost prodaje (Speed-to-Sell)
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.4</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Povprečni čas prodaje po kategorijah in cenovnih rangih.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Overall stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Povp. dni</div>
                  <div className="font-mono font-bold text-primary text-lg">{speedData.overall.avgDays}</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Mediana</div>
                  <div className="font-mono font-bold">{speedData.overall.medianDays}d</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Min-Max</div>
                  <div className="font-mono text-[10px]">{speedData.overall.minDays}-{speedData.overall.maxDays}d</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">⚡ Hitre (&lt;7d)</div>
                  <div className="font-mono font-bold text-primary">{speedData.overall.fastFlips}</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">🔴 Počasne (&gt;30d)</div>
                  <div className="font-mono font-bold text-red-500">{speedData.overall.slowFlips}</div>
                </div>
              </div>

              {/* Fastest / Slowest */}
              {speedData.fastestCategory && speedData.slowestCategory && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs">
                    <span className="text-primary font-bold">⚡ Najhitrejša: </span>
                    {speedData.fastestCategory.category} ({speedData.fastestCategory.avgDays}d povp)
                  </div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-2 text-xs">
                    <span className="text-red-500 font-bold">🔴 Najpočasnejša: </span>
                    {speedData.slowestCategory.category} ({speedData.slowestCategory.avgDays}d povp)
                  </div>
                </div>
              )}

              {/* By category */}
              {speedData.byCategory?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Po kategorijah</div>
                  <div className="space-y-1">
                    {speedData.byCategory.map((c: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-1.5 bg-background/30 rounded text-[11px]">
                        <Badge variant="outline" className="text-[9px] shrink-0">{c.category}</Badge>
                        <span className="font-mono font-bold w-12">{c.avgDays}d</span>
                        <span className="text-muted-foreground">{c.count} prodaj</span>
                        <span className={cn('font-mono', c.avgMargin > 0 ? 'text-primary' : 'text-red-500')}>
                          {c.avgMargin > 0 ? '+' : ''}{c.avgMargin}% marža
                        </span>
                        <span className="text-[9px] text-muted-foreground shrink-0">{c.speedLabel}</span>
                        {c.fastFlips > 0 && <Badge variant="outline" className="text-[8px] text-primary border-primary/40">⚡{c.fastFlips}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By price range */}
              {speedData.byPriceRange?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Po cenovnem rangu</div>
                  <div className="grid grid-cols-5 gap-1">
                    {speedData.byPriceRange.map((r: any, i: number) => (
                      <div key={i} className="bg-background/30 rounded p-1.5 text-center text-[10px]">
                        <div className="text-muted-foreground">{r.label}</div>
                        {r.count > 0 ? (
                          <>
                            <div className="font-mono font-bold">{r.avgDays}d</div>
                            <div className={cn('text-[9px]', r.avgMargin! > 0 ? 'text-primary' : 'text-red-500')}>
                              {r.avgMargin! > 0 ? '+' : ''}{r.avgMargin}%
                            </div>
                            <div className="text-[8px] text-muted-foreground">{r.count} prodaj</div>
                          </>
                        ) : (
                          <div className="text-muted-foreground">—</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v6.6: AI Budget Allocator */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            AI Budget Allocator
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.6</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI predlaga razporeditev proračuna po kategorijah za maksimalni dobiček.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="Proračun (€)" className="text-xs font-mono h-7 w-32" />
            <Button size="sm" className="h-7 text-xs gap-1" disabled={budgetLoading || !budgetInput.trim()}
              onClick={async () => {
                setBudgetLoading(true); setBudgetData(null);
                try {
                  const res = await fetch('/api/ai/budget-allocator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ totalBudget: parseInt(budgetInput, 10) }) });
                  const data = await res.json();
                  if (data.ok) { setBudgetData(data); toast.success(`✓ Pričakovani dobiček: ${data.totalExpectedProfit}€`); }
                  else toast.error(data.error ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setBudgetLoading(false); }
              }}>
              {budgetLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
              Razporedi
            </Button>
          </div>
          {budgetLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira kategorije...</div>
          ) : budgetData ? (
            <div className="space-y-2 text-xs">
              {budgetData.strategy && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{budgetData.strategy}</div>}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Pričakovan dobiček</div>
                  <div className="font-mono font-bold text-primary text-lg">{budgetData.totalExpectedProfit}€</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Rezerva</div>
                  <div className="font-mono font-bold text-amber-400">{budgetData.reserveAmount}€</div>
                </div>
              </div>
              <div className="space-y-1">
                {budgetData.allocation?.map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-1.5 bg-background/30 rounded">
                    <Badge variant="outline" className="text-[9px] shrink-0">{a.category}</Badge>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-primary">{a.suggestedBudget}€</span>
                        <span className="text-[9px] text-muted-foreground">({a.percentage}%)</span>
                        <span className={cn('font-mono text-[10px]', a.expectedROI > 0 ? 'text-primary' : 'text-red-500')}>
                          ROI {a.expectedROI > 0 ? '+' : ''}{a.expectedROI}%
                        </span>
                        <span className="font-mono text-[10px] text-primary">→ +{a.expectedProfit}€</span>
                      </div>
                      <div className="text-[9px] text-muted-foreground italic">{a.reasoning}</div>
                    </div>
                    <div className="w-16 h-2 bg-background rounded overflow-hidden shrink-0">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, a.percentage)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Vnesi proračun in klikni "Razporedi" za AI predlog.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.8: AI Profit Forecast */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Napoved dobička
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.8</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove pričakovani dobiček za naslednji mesec glede na zgodovino.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={forecastLoading}
            onClick={async () => {
              setForecastLoading(true); setForecastData(null);
              try {
                const res = await fetch('/api/ai/profit-forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: 1 }) });
                const data = await res.json();
                if (data.ok) { setForecastData(data); toast.success(`✓ Pričakovan dobiček: ${data.forecast.expectedProfit}€`); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setForecastLoading(false); }
            }}>
            {forecastLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Napovej dobiček
          </Button>
          {forecastLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira zgodovino...</div>
          ) : forecastData ? (
            <div className="space-y-2 text-xs">
              <div className={cn('border rounded p-2 text-center',
                forecastData.forecast.expectedProfit > 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                <div className="text-[10px] text-muted-foreground uppercase">Pričakovan dobiček</div>
                <div className={cn('text-2xl font-bold font-mono', forecastData.forecast.expectedProfit > 0 ? 'text-primary' : 'text-red-500')}>
                  {forecastData.forecast.expectedProfit > 0 ? '+' : ''}{forecastData.forecast.expectedProfit}€
                </div>
                <Badge variant="outline" className={cn('text-[9px] mt-1',
                  forecastData.forecast.confidence >= 70 ? 'text-primary border-primary/40' :
                  forecastData.forecast.confidence >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  🎯 {forecastData.forecast.confidence}% zaupanje
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '🟢 Optimistično', data: forecastData.forecast.scenarios.optimistic },
                  { label: '🟡 Realno', data: forecastData.forecast.scenarios.realistic },
                  { label: '🔴 Pesimistično', data: forecastData.forecast.scenarios.pessimistic },
                ].map(s => (
                  <div key={s.label} className="bg-background/30 rounded p-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">{s.label}</div>
                    <div className="font-mono font-bold text-sm">{s.data.profit}€</div>
                    <div className="text-[8px] text-muted-foreground">{s.data.probability}%</div>
                  </div>
                ))}
              </div>
              {forecastData.forecast.factors?.length > 0 && (
                <div className="bg-background/30 rounded p-2">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Faktorji</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                    {forecastData.forecast.factors.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {forecastData.forecast.recommendation && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{forecastData.forecast.recommendation}</div>
              )}
              <div className="bg-background/30 rounded p-2 text-[10px] text-muted-foreground">
                📈 Zadnjih 6 mesecev: {forecastData.historicalData.monthlyProfits.map((m: any) => `${m.profit}€`).join(' → ')}
                <br />📊 Povprečno: {forecastData.historicalData.avgMonthlyProfit}€/mesec • Trend: {forecastData.historicalData.trendPct > 0 ? '+' : ''}{forecastData.historicalData.trendPct}%
                <br />💼 V skladišču: {forecastData.historicalData.heldCount} itemov, potencial: {forecastData.historicalData.heldPotential}€
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej dobiček" za AI napoved.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.9: AI Portfolio Rebalancing */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Rebalancing portfolia
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.9</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI predlaga kako prerazporediti investicije za maksimalni dobiček.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={rebalanceLoading}
            onClick={async () => {
              setRebalanceLoading(true); setRebalanceData(null);
              try {
                const res = await fetch('/api/ai/rebalance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setRebalanceData(data); toast.success('✓ Rebalancing predlog generiran'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setRebalanceLoading(false); }
            }}>
            {rebalanceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj portfolio
          </Button>
          {rebalanceLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira portfolio...</div>
          ) : rebalanceData ? (
            <div className="space-y-2 text-xs">
              {rebalanceData.strategy && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{rebalanceData.strategy}</div>}
              <div className="text-[10px] uppercase text-muted-foreground">Trenutna alokacija: {rebalanceData.totalInvested}€</div>
              <div className="space-y-1">
                {rebalanceData.actions?.map((a: any, i: number) => {
                  const actionCfg: Record<string, { icon: string; color: string; label: string }> = {
                    buy_more: { icon: '📈', color: 'text-primary', label: 'Povečaj' },
                    reduce: { icon: '📉', color: 'text-amber-400', label: 'Zmanjšaj' },
                    hold: { icon: '⏸️', color: 'text-muted-foreground', label: 'Obdrži' },
                    exit: { icon: '🚪', color: 'text-red-500', label: 'Izhod' },
                  };
                  const cfg = actionCfg[a.action] || actionCfg.hold;
                  return (
                    <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded border',
                      a.action === 'buy_more' ? 'bg-primary/5 border-primary/20' :
                      a.action === 'exit' ? 'bg-red-500/5 border-red-500/20' :
                      a.action === 'reduce' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/30 border-border')}>
                      <Badge variant="outline" className="text-[9px] shrink-0">{a.category}</Badge>
                      <span className={cn('font-bold text-[10px] shrink-0', cfg.color)}>{cfg.icon} {cfg.label}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] text-muted-foreground">{a.currentPct}% → </span>
                        <span className={cn('font-mono font-bold text-[10px]', cfg.color)}>{a.suggestedPct}%</span>
                        <span className="text-[9px] text-muted-foreground italic ml-1">{a.reason}</span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="w-12 h-1.5 bg-background rounded overflow-hidden shrink-0 relative">
                        <div className="absolute h-full bg-muted-foreground/30" style={{ width: `${a.currentPct}%` }} />
                        <div className={cn('absolute h-full', cfg.color.replace('text-', 'bg-'))} style={{ width: `${a.suggestedPct}%`, opacity: 0.5 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj portfolio" za AI predlog rebalancinga.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.10: AI Sourcing Recommendations */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Sourcing priporočila
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.10</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI predlaga kje, kdaj in kaj kupovati za maksimalni dobiček.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder="Budget (EUR, opcijsko)"
              value={sourcingBudget}
              onChange={(e) => setSourcingBudget(e.target.value)}
              className="h-7 text-xs w-44"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={sourcingLoading}
              onClick={async () => {
                setSourcingLoading(true); setSourcingData(null);
                try {
                  const budgetNum = sourcingBudget ? Number(sourcingBudget) : 0;
                  const res = await fetch('/api/ai/sourcing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ budget: budgetNum || undefined }),
                  });
                  const data = await res.json();
                  if (data.ok) { setSourcingData(data); toast.success('✓ Sourcing predlogi generirani'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setSourcingLoading(false); }
              }}>
              {sourcingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Analiziraj trge
            </Button>
          </div>
          {sourcingLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira vire, kategorije in časovna okna...</div>
          ) : sourcingData ? (
            <div className="space-y-2 text-xs">
              {sourcingData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{sourcingData.insights}</div>
              )}
              {sourcingData.stats && (
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Viri</div>
                    <div className="font-bold">{sourcingData.stats.bySource?.length ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorije</div>
                    <div className="font-bold">{sourcingData.stats.byCategory?.length ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Priložnosti (14d)</div>
                    <div className="font-bold">{sourcingData.stats.recentOpportunities?.reduce((s: number, r: any) => s + r.opportunities, 0) ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="space-y-1">
                {sourcingData.recommendations?.map((r: any, i: number) => {
                  const riskColor = r.risk <= 3 ? 'text-primary' : r.risk <= 6 ? 'text-amber-400' : 'text-red-500';
                  const riskBg = r.risk <= 3 ? 'bg-primary/5 border-primary/20' : r.risk <= 6 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20';
                  return (
                    <div key={i} className={cn('p-2 rounded border space-y-1', riskBg)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[9px] shrink-0">{r.source}</Badge>
                        <Badge variant="outline" className="text-[9px] shrink-0 text-muted-foreground">{r.category}</Badge>
                        <span className={cn('font-mono font-bold text-[10px]', riskColor)}>ROI {r.expectedROI}%</span>
                        <span className={cn('font-mono text-[9px]', riskColor)}>tveganje {r.risk}/10</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="font-semibold">⏰ {r.timing}</span>
                      </div>
                      <div className="text-[10px] font-medium">{r.action}</div>
                      {r.reason && <div className="text-[9px] text-muted-foreground italic">{r.reason}</div>}
                    </div>
                  );
                })}
                {sourcingData.recommendations?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni priporočil — potrebno več podatkov.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj trge" za AI predloge, kje iskati profitne inventarje.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.11: Smart Pricing A/B Testing */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Smart Pricing A/B Testing
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.11</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI za vsak item v skladišču predlaga 3 cenovne strategije (premium/fair/aggressive).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={abTestLoading}
            onClick={async () => {
              setAbTestLoading(true); setAbTestData(null);
              try {
                const res = await fetch('/api/ai/pricing-abtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setAbTestData(data); toast.success('✓ A/B testne variante generirane'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setAbTestLoading(false); }
            }}>
            {abTestLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generiraj A/B teste
          </Button>
          {abTestLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI pripravlja cenovne strategije...</div>
          ) : abTestData ? (
            <div className="space-y-2 text-xs">
              {abTestData.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{abTestData.summary}</div>
              )}
              {abTestData.summaryStats && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Itemov</div>
                    <div className="font-bold">{abTestData.summaryStats.totalItems ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. dobiček</div>
                    <div className="font-bold text-primary">{abTestData.summaryStats.avgRecommendedProfit ?? 0}€</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. čas</div>
                    <div className="font-bold">{abTestData.summaryStats.avgRecommendedTimeToSell ?? 0}d</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Premium/Fair/Aggr</div>
                    <div className="font-bold">{abTestData.summaryStats.recommendationBreakdown?.premium ?? 0}/{abTestData.summaryStats.recommendationBreakdown?.fair ?? 0}/{abTestData.summaryStats.recommendationBreakdown?.aggressive ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {abTestData.tests?.map((t: any, i: number) => {
                  const recColor = t.recommendation === 'premium' ? 'text-primary' : t.recommendation === 'aggressive' ? 'text-amber-400' : 'text-blue-400';
                  return (
                    <div key={i} className="border rounded p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[11px] truncate">{t.title}</div>
                          <div className="text-[9px] text-muted-foreground">Nabavna: {t.cost}€ · {t.daysHeld}d v skladišču</div>
                        </div>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0', recColor)}>→ {t.recommendation}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[9px]">
                        {t.variants?.map((v: any, j: number) => {
                          const isRec = v.name === t.recommendation;
                          const cfg: Record<string, string> = {
                            premium: 'text-primary border-primary/30',
                            fair: 'text-blue-400 border-blue-400/30',
                            aggressive: 'text-amber-400 border-amber-400/30',
                          };
                          return (
                            <div key={j} className={cn('rounded p-1 border', cfg[v.name], isRec && 'bg-primary/5 border-primary/40')}>
                              <div className="font-bold uppercase">{v.name}</div>
                              <div className="font-mono">{v.price}€</div>
                              <div className="text-muted-foreground">+{v.projectedProfit}€ · {v.timeToSellDays}d · {v.probabilityPct}%</div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[9px] text-muted-foreground italic">💡 {t.recommendationReasoning}</div>
                    </div>
                  );
                })}
                {abTestData.tests?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni itemov za A/B testiranje.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Generiraj A/B teste" za AI predlog cenovnih strategij.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.11: AI Cross-Border Arbitrage */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Cross-Border Arbitrage
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.11</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI primerja slovenske cene s tujimi trgi (DE, IT, HR, AT, PL, FR) in identificira arbitražo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              type="text"
              placeholder="Iskalni pojem (npr. iPhone, kolo...)"
              value={crossBorderQuery}
              onChange={(e) => setCrossBorderQuery(e.target.value)}
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={crossBorderLoading}
              onClick={async () => {
                setCrossBorderLoading(true); setCrossBorderData(null);
                try {
                  const res = await fetch('/api/ai/cross-border', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: crossBorderQuery || undefined }),
                  });
                  const data = await res.json();
                  if (data.ok) { setCrossBorderData(data); toast.success('✓ Cross-border priložnosti identificirane'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setCrossBorderLoading(false); }
              }}>
              {crossBorderLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Skeniraj trge
            </Button>
          </div>
          {crossBorderLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI primerja cene med 6 tujimi trgi...</div>
          ) : crossBorderData ? (
            <div className="space-y-2 text-xs">
              {crossBorderData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{crossBorderData.insights}</div>
              )}
              {crossBorderData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Priložnosti</div>
                    <div className="font-bold">{crossBorderData.summary.totalOpportunities ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Export</div>
                    <div className="font-bold text-primary">{crossBorderData.summary.exportOps ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Import</div>
                    <div className="font-bold text-blue-400">{crossBorderData.summary.importOps ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. ROI</div>
                    <div className="font-bold text-primary">{crossBorderData.summary.avgROI ?? 0}%</div>
                  </div>
                </div>
              )}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {crossBorderData.opportunities?.map((o: any, i: number) => {
                  const stratColor = o.arbitrage.strategy === 'export' ? 'text-primary' :
                                     o.arbitrage.strategy === 'import' ? 'text-blue-400' :
                                     o.arbitrage.strategy === 'wait' ? 'text-muted-foreground' : 'text-amber-400';
                  const stratBg = o.arbitrage.strategy === 'export' ? 'bg-primary/5 border-primary/20' :
                                  o.arbitrage.strategy === 'import' ? 'bg-blue-400/5 border-blue-400/20' :
                                  o.arbitrage.strategy === 'wait' ? 'bg-muted/5 border-border' : 'bg-amber-400/5 border-amber-400/20';
                  return (
                    <div key={i} className={cn('border rounded p-2 space-y-1.5', stratBg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[11px] truncate">{o.title}</div>
                          <div className="text-[9px] text-muted-foreground">SI cena: {o.slovenianPrice}€ · deal score: {o.dealScore}</div>
                        </div>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0 uppercase', stratColor)}>
                          {o.arbitrage.strategy === 'export' ? '📤' : o.arbitrage.strategy === 'import' ? '📥' : '⏸'} {o.arbitrage.strategy}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div><span className="text-muted-foreground">Kupi:</span> <span className="font-bold">{o.arbitrage.buyIn}</span></div>
                        <div><span className="text-muted-foreground">Prodaj:</span> <span className="font-bold">{o.arbitrage.sellIn}</span></div>
                        <div><span className="text-muted-foreground">ROI:</span> <span className={cn('font-bold', stratColor)}>{o.arbitrage.roiPct}%</span></div>
                        <div><span className="text-muted-foreground">Net:</span> <span className="font-mono font-bold">{o.arbitrage.netMargin}€</span></div>
                      </div>
                      {o.foreignPrices?.length > 0 && (
                        <div className="text-[9px] text-muted-foreground">
                          🌍 {o.foreignPrices.slice(0, 3).map((f: any) => `${f.country}: ${f.price}€`).join(' · ')}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-muted-foreground">Tveganje: <b className={o.risk <= 3 ? 'text-primary' : o.risk <= 6 ? 'text-amber-400' : 'text-red-500'}>{o.risk}/10</b> · Izvedljivost: <b>{o.feasibility}</b></span>
                      </div>
                      <div className="text-[10px] font-medium">→ {o.action}</div>
                      {o.reasoning && <div className="text-[9px] text-muted-foreground italic">{o.reasoning}</div>}
                    </div>
                  );
                })}
                {crossBorderData.opportunities?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni cross-border priložnosti.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Skeniraj trge" za AI primerjavo cen med Slovenijo in 6 tujimi trgi.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.12: AI Demand Forecast */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Napoved povpraševanja
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.12</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove povpraševanje po kategorijah za naslednje mesece (sezonstost + trendi).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-muted-foreground shrink-0">Mesecev naprej:</span>
            <Input
              type="number"
              min={1}
              max={6}
              value={demandMonths}
              onChange={(e) => setDemandMonths(e.target.value)}
              className="h-7 text-xs w-20"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={demandLoading}
              onClick={async () => {
                setDemandLoading(true); setDemandData(null);
                try {
                  const months = Math.max(1, Math.min(6, Number(demandMonths) || 3));
                  const res = await fetch('/api/ai/demand-forecast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ months }),
                  });
                  const data = await res.json();
                  if (data.ok) { setDemandData(data); toast.success('✓ Napoved povpraševanja generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setDemandLoading(false); }
              }}>
              {demandLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Napovej
            </Button>
          </div>
          {demandLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira sezonske vzorce in trende...</div>
          ) : demandData ? (
            <div className="space-y-2 text-xs">
              {demandData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{demandData.insights}</div>
              )}
              {demandData.summary && (
                <div className="grid grid-cols-5 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorij</div>
                    <div className="font-bold">{demandData.summary.totalCategories ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">📈 Raste</div>
                    <div className="font-bold text-primary">{demandData.summary.growingCats ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">📉 Pada</div>
                    <div className="font-bold text-destructive">{demandData.summary.decliningCats ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">🛒 Kupi</div>
                    <div className="font-bold text-primary">{demandData.summary.buyRecs ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">💰 Prodaj</div>
                    <div className="font-bold text-amber-400">{demandData.summary.sellRecs ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {demandData.forecasts?.map((f: any, i: number) => {
                  const trendIcon = f.trend === 'growing' ? '📈' : f.trend === 'declining' ? '📉' : '➡️';
                  const trendColor = f.trend === 'growing' ? 'text-primary' : f.trend === 'declining' ? 'text-destructive' : 'text-muted-foreground';
                  const recColor = f.recommendation === 'buy' ? 'text-primary' : f.recommendation === 'sell' ? 'text-amber-400' : 'text-blue-400';
                  return (
                    <div key={i} className="border rounded p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{trendIcon}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0">{f.category}</Badge>
                          <span className={cn('text-[9px] uppercase font-bold', trendColor)}>{f.trend}</span>
                          {f.seasonality === 'high' && <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30 shrink-0">sezonstost</Badge>}
                        </div>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0 uppercase', recColor)}>→ {f.recommendation}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[9px]">
                        <div className="bg-background/40 rounded p-1 border">
                          <div className="text-muted-foreground">Trenutno</div>
                          <div className="font-mono font-bold">{f.currentDemand}/200</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border">
                          <div className="text-muted-foreground">Napoved</div>
                          <div className={cn('font-mono font-bold', f.forecastDemand > f.currentDemand ? 'text-primary' : 'text-destructive')}>{f.forecastDemand}/200</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border">
                          <div className="text-muted-foreground">Prič. ROI</div>
                          <div className="font-mono font-bold text-primary">{f.expectedRoiPct}%</div>
                        </div>
                      </div>
                      {(f.peakMonths?.length > 0 || f.lowMonths?.length > 0) && (
                        <div className="text-[9px] text-muted-foreground">
                          {f.peakMonths?.length > 0 && <span>🔺 Vrh: {f.peakMonths.join(', ')}</span>}
                          {f.peakMonths?.length > 0 && f.lowMonths?.length > 0 && <span> · </span>}
                          {f.lowMonths?.length > 0 && <span>🔻 Nizko: {f.lowMonths.join(', ')}</span>}
                        </div>
                      )}
                      {f.opportunities?.length > 0 && (
                        <div className="text-[9px]">
                          <span className="text-muted-foreground">💡 Priložnosti: </span>
                          {f.opportunities.join(' · ')}
                        </div>
                      )}
                      {f.reasoning && <div className="text-[9px] text-muted-foreground italic">{f.reasoning}</div>}
                    </div>
                  );
                })}
                {demandData.forecasts?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni dovolj podatkov za napoved.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej" za AI napoved povpraševanja po kategorijah.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.12: AI Portfolio Correlation */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Portfolio korelacije
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.12</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI analizira korelacije med kategorijami in predlaga diverzifikacijo portfolia.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={correlationLoading}
            onClick={async () => {
              setCorrelationLoading(true); setCorrelationData(null);
              try {
                const res = await fetch('/api/ai/portfolio-correlation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setCorrelationData(data); toast.success('✓ Korelacijska analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setCorrelationLoading(false); }
            }}>
            {correlationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj korelacije
          </Button>
          {correlationLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI računa Pearsonove korelacije med kategorijami...</div>
          ) : correlationData ? (
            <div className="space-y-2 text-xs">
              {correlationData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{correlationData.insights}</div>
              )}
              {correlationData.summary && correlationData.diversification && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorij</div>
                    <div className="font-bold">{correlationData.summary.totalCategories ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">HHI indeks</div>
                    <div className="font-bold">{correlationData.summary.hhi ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Koncentracija</div>
                    <div className={cn('font-bold uppercase',
                      correlationData.diversification.concentrationRisk === 'high' ? 'text-red-500' :
                      correlationData.diversification.concentrationRisk === 'medium' ? 'text-amber-400' : 'text-primary')}>
                      {correlationData.diversification.concentrationRisk}
                    </div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Diverz. score</div>
                    <div className={cn('font-bold',
                      (correlationData.diversification.score ?? 0) >= 70 ? 'text-primary' :
                      (correlationData.diversification.score ?? 0) >= 40 ? 'text-amber-400' : 'text-destructive')}>
                      {correlationData.diversification.score ?? 0}/100
                    </div>
                  </div>
                </div>
              )}

              {/* Diverzifikacijska tveganja in predlogi */}
              {correlationData.diversification?.topRisks?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Tveganja:</div>
                  <ul className="space-y-0.5 ml-3">
                    {correlationData.diversification.topRisks.map((r: string, i: number) => (
                      <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {correlationData.diversification?.suggestions?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💡 Predlogi diverzifikacije:</div>
                  <ul className="space-y-0.5 ml-3">
                    {correlationData.diversification.suggestions.map((s: string, i: number) => (
                      <li key={i} className="text-[10px] list-disc list-outside">{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Clustri */}
              {correlationData.clusters?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">🔗 Clustri kategorij:</div>
                  <div className="space-y-1">
                    {correlationData.clusters.map((c: any, i: number) => (
                      <div key={i} className="bg-background/40 rounded p-1.5 border">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-[10px]">{c.name}</span>
                          <Badge variant="outline" className={cn('text-[9px]',
                            c.risk === 'high' ? 'text-red-500 border-red-500/30' :
                            c.risk === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-primary border-primary/30')}>
                            {c.risk} risk
                          </Badge>
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          {c.categories?.join(', ')} — {c.characteristic}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top korelacije */}
              {correlationData.correlations?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Top korelacije:</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {correlationData.correlations.map((c: any, i: number) => {
                      const cfg: Record<string, { color: string; bg: string; icon: string }> = {
                        strong_positive: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                        weak_positive: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                        strong_negative: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '🟢' },
                        weak_negative: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '🔵' },
                        neutral: { color: 'text-muted-foreground', bg: 'bg-background/40 border-border', icon: '⚪' },
                      };
                      const cfg2 = cfg[c.strength] || cfg.neutral;
                      return (
                        <div key={i} className={cn('rounded p-1.5 border flex items-center justify-between', cfg2.bg)}>
                          <div className="flex items-center gap-1.5">
                            <span>{cfg2.icon}</span>
                            <span className="text-[10px]">{c.catA} ↔ {c.catB}</span>
                          </div>
                          <span className={cn('font-mono font-bold text-[10px]', cfg2.color)}>
                            {c.correlation > 0 ? '+' : ''}{c.correlation}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Hedging opportunities */}
              {correlationData.hedgingOpportunities?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">🛡️ Hedging priložnosti:</div>
                  <div className="space-y-1">
                    {correlationData.hedgingOpportunities.map((h: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <span className="font-bold">{h.category}</span>
                        <span className="text-muted-foreground"> hedga </span>
                        <span className="font-bold">{h.hedgesAgainst}</span>
                        <span className="text-muted-foreground"> (korelacija: {h.expectedCorrelation > 0 ? '+' : ''}{h.expectedCorrelation})</span>
                        <div className="text-[9px] text-muted-foreground italic">{h.reasoning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj korelacije" za AI analizo sinhronega tveganja portfolia.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.13: AI Competitor Intelligence */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Competitor Intelligence
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.13</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI analizira konkurenčne prodajalce, njihove strategije in šibkosti.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              type="text"
              placeholder="Filter kategorije (opcijsko)"
              value={competitorCategory}
              onChange={(e) => setCompetitorCategory(e.target.value)}
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={competitorLoading}
              onClick={async () => {
                setCompetitorLoading(true); setCompetitorData(null);
                try {
                  const res = await fetch('/api/ai/competitor-intel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category: competitorCategory || undefined }),
                  });
                  const data = await res.json();
                  if (data.ok) { setCompetitorData(data); toast.success('✓ Konkurenčna analiza generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setCompetitorLoading(false); }
              }}>
              {competitorLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Analiziraj
            </Button>
          </div>
          {competitorLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira prodajalce in njihove strategije...</div>
          ) : competitorData ? (
            <div className="space-y-2 text-xs">
              {competitorData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{competitorData.insights}</div>
              )}
              {competitorData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Konkurentov</div>
                    <div className="font-bold">{competitorData.summary.totalCompetitors ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">🔴 High threat</div>
                    <div className="font-bold text-red-500">{competitorData.summary.threatBreakdown?.high ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">🌊 Blue ocean</div>
                    <div className="font-bold text-primary">{competitorData.summary.blueOceanCount ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Vseh prodajalcev</div>
                    <div className="font-bold">{competitorData.summary.totalSellersAnalyzed ?? 0}</div>
                  </div>
                </div>
              )}

              {/* Competitor list */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {competitorData.competitors?.map((c: any, i: number) => {
                  const threatCfg: Record<string, { color: string; bg: string; icon: string }> = {
                    high: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                    medium: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                    low: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                  };
                  const cfg = threatCfg[c.threat] || threatCfg.medium;
                  const strategyLabels: Record<string, string> = {
                    volume_player: 'Množični',
                    premium_niche: 'Premium niša',
                    discounter: 'Diskonter',
                    specialist: 'Specialist',
                    opportunity_hunter: 'Priložnostni',
                  };
                  return (
                    <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0 truncate max-w-[120px]">{c.sellerName}</Badge>
                          <Badge variant="outline" className="text-[9px] shrink-0">{strategyLabels[c.strategy] || c.strategy}</Badge>
                        </div>
                        <div className="text-[9px] text-muted-foreground shrink-0">
                          {c.listingCount} oglasov · {c.avgPrice}€
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div><span className="text-muted-foreground">Range:</span> <span className="font-mono">{c.minPrice}-{c.maxPrice}€</span></div>
                        <div><span className="text-muted-foreground">Aktiven:</span> <span className="font-mono">{c.daysActive}d</span></div>
                        <div><span className="text-muted-foreground">Pril.:</span> <span className="font-mono">{c.opportunityRate}%</span></div>
                        <div><span className="text-muted-foreground">Deal:</span> <span className="font-mono">{c.avgDealScore}/100</span></div>
                      </div>
                      {c.weaknesses?.length > 0 && (
                        <div className="text-[9px]">
                          <span className="text-red-500 font-semibold">Šibkosti:</span> {c.weaknesses.join(' · ')}
                        </div>
                      )}
                      {c.opportunities?.length > 0 && (
                        <div className="text-[9px]">
                          <span className="text-primary font-semibold">Priložnosti:</span> {c.opportunities.join(' · ')}
                        </div>
                      )}
                      {c.recommendedAction && (
                        <div className="text-[9px] text-primary font-medium">→ {c.recommendedAction}</div>
                      )}
                    </div>
                  );
                })}
                {competitorData.competitors?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni konkurentov z vsaj 2 listingoma.</p>
                )}
              </div>

              {/* Blue ocean opportunities */}
              {competitorData.blueOcean?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">🌊 Blue ocean kategorije:</div>
                  <div className="space-y-1">
                    {competitorData.blueOcean.map((b: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <span className="font-bold">{b.category}</span>
                        <span className="text-muted-foreground"> (ROI ~{b.potentialRoiPct}%) — {b.reasoning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Differentiation */}
              {competitorData.differentiation?.length > 0 && (
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                  <div className="text-[10px] uppercase text-amber-400 mb-1">💡 Predlogi diferenciacije:</div>
                  <ul className="space-y-0.5 ml-3">
                    {competitorData.differentiation.map((d: string, i: number) => (
                      <li key={i} className="text-[10px] list-disc list-outside">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj" za AI analizo konkurenčnih prodajalcev.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.13: AI Cash Flow Optimizer */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Cash Flow Optimizer
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.13</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI analizira denarni tok, identificira bottlenecke in optimizira reinvesticije.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-muted-foreground shrink-0">Dni naprej:</span>
            <Input
              type="number"
              min={7}
              max={90}
              value={cashflowDays}
              onChange={(e) => setCashflowDays(e.target.value)}
              className="h-7 text-xs w-20"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={cashflowLoading}
              onClick={async () => {
                setCashflowLoading(true); setCashflowData(null);
                try {
                  const days = Math.max(7, Math.min(90, Number(cashflowDays) || 30));
                  const res = await fetch('/api/ai/cashflow', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ forecastDays: days }),
                  });
                  const data = await res.json();
                  if (data.ok) { setCashflowData(data); toast.success('✓ Cash flow analiza generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setCashflowLoading(false); }
              }}>
              {cashflowLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Optimiziraj
            </Button>
          </div>
          {cashflowLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira denarne tokove in bottlenecke...</div>
          ) : cashflowData ? (
            <div className="space-y-2 text-xs">
              {/* Current cash */}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className={cn('rounded p-1.5 border',
                  cashflowData.currentCash >= 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                  <div className="text-muted-foreground uppercase">💸 Trenutni cash</div>
                  <div className={cn('font-mono font-bold text-[12px]',
                    cashflowData.currentCash >= 0 ? 'text-primary' : 'text-destructive')}>
                    {cashflowData.currentCash}€
                  </div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">📦 Vezan inventar</div>
                  <div className="font-mono font-bold">{cashflowData.totalInvestedHeld}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">💰 Realizirano</div>
                  <div className="font-mono font-bold text-primary">{cashflowData.totalRealized}€</div>
                </div>
              </div>

              {cashflowData.analysis?.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{cashflowData.analysis.summary}</div>
              )}

              {/* Strategy */}
              {cashflowData.analysis?.currentStrategy && cashflowData.analysis?.recommendedStrategy && (
                <div className="bg-background/40 rounded p-1.5 border flex items-center justify-between text-[10px]">
                  <span>Trenutna: <b className="text-amber-400">{cashflowData.analysis.currentStrategy.replace('_', ' ')}</b></span>
                  <span>→</span>
                  <span>Priporočena: <b className="text-primary">{cashflowData.analysis.recommendedStrategy.replace('_', ' ')}</b></span>
                </div>
              )}

              {/* Optimal allocation */}
              {cashflowData.analysis?.optimalAllocation && (
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Optimalna alokacija:</div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-muted-foreground">Reinvestiraj:</span>
                      <span className="font-mono font-bold text-primary"> {cashflowData.analysis.optimalAllocation.reinvestPct}%</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rezerva:</span>
                      <span className="font-mono font-bold text-amber-400"> {cashflowData.analysis.optimalAllocation.reservePct}%</span>
                    </div>
                  </div>
                  {cashflowData.analysis.optimalAllocation.reasoning && (
                    <div className="text-[9px] text-muted-foreground italic mt-1">{cashflowData.analysis.optimalAllocation.reasoning}</div>
                  )}
                </div>
              )}

              {/* Forecast summary */}
              {cashflowData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Prič. prodaje</div>
                    <div className="font-bold">{cashflowData.summary.expectedSales ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Prič. prihodek</div>
                    <div className="font-bold text-primary">{cashflowData.summary.expectedRevenue ?? 0}€</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Reinvesticija</div>
                    <div className="font-bold text-amber-400">{cashflowData.summary.expectedReinvestment ?? 0}€</div>
                  </div>
                  <div className={cn('rounded p-1.5 border',
                    (cashflowData.summary.endingCash ?? 0) >= 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                    <div className="text-muted-foreground uppercase">Končni cash</div>
                    <div className={cn('font-bold font-mono',
                      (cashflowData.summary.endingCash ?? 0) >= 0 ? 'text-primary' : 'text-destructive')}>
                      {cashflowData.summary.endingCash ?? 0}€
                    </div>
                  </div>
                </div>
              )}

              {/* Bottlenecks */}
              {cashflowData.analysis?.bottlenecks?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Bottlenecks:</div>
                  <div className="space-y-1">
                    {cashflowData.analysis.bottlenecks.map((b: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{b.type.replace('_', ' ')}</span>
                          <span className="font-mono text-red-500">−{b.impactEur}€</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground">{b.description}</div>
                        <div className="text-[9px] text-primary">→ {b.fix}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {cashflowData.analysis?.recommendations?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💡 Priporočila:</div>
                  <div className="space-y-1">
                    {cashflowData.analysis.recommendations.map((r: any, i: number) => {
                      const prColor = r.priority === 'high' ? 'text-red-500' : r.priority === 'medium' ? 'text-amber-400' : 'text-blue-400';
                      return (
                        <div key={i} className="text-[10px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{r.action}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className={cn('text-[9px]', prColor)}>{r.priority}</Badge>
                              <span className="font-mono text-primary">+{r.expectedImpactEur}€</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground">⏱ {r.timeframe}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Cash flow gaps */}
              {cashflowData.analysis?.cashFlowGaps?.length > 0 && (
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                  <div className="text-[10px] uppercase text-amber-400 mb-1">📉 Cash flow gap-i:</div>
                  <div className="space-y-1">
                    {cashflowData.analysis.cashFlowGaps.map((g: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{g.dateRange}</span>
                          <span className="font-mono text-red-500">−{g.expectedShortfallEur}€</span>
                        </div>
                        <div className="text-[9px] text-primary">→ {g.mitigation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Optimiziraj" za AI analizo denarnega toka in reinvesticijske strategije.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.14: AI Inventory Insurance Optimizer */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Inventory Insurance Optimizer
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.14</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI analizira tveganja inventarja in predlaga optimalno zavarovanje.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-muted-foreground shrink-0">Skladišče:</span>
            <select
              value={insuranceStorage}
              onChange={(e) => setInsuranceStorage(e.target.value)}
              className="h-7 text-xs bg-background border rounded px-2"
            >
              <option value="home">Dom</option>
              <option value="garage">Garaža</option>
              <option value="storage_unit">Skladišče</option>
              <option value="shop">Trgovina</option>
            </select>
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={insuranceLoading}
              onClick={async () => {
                setInsuranceLoading(true); setInsuranceData(null);
                try {
                  const res = await fetch('/api/ai/insurance-optimizer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storageType: insuranceStorage }),
                  });
                  const data = await res.json();
                  if (data.ok) { setInsuranceData(data); toast.success('✓ Zavarovalna analiza generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setInsuranceLoading(false); }
              }}>
              {insuranceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Analiziraj
            </Button>
          </div>
          {insuranceLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira tveganja kraje, poškodbe in amortizacije...</div>
          ) : insuranceData ? (
            <div className="space-y-2 text-xs">
              {insuranceData.analysis?.riskSummary && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{insuranceData.analysis.riskSummary}</div>
              )}

              {/* Risk analysis grid */}
              {insuranceData.riskAnalysis && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Skupna vrednost</div>
                    <div className="font-bold text-primary">{insuranceData.riskAnalysis.totalValue}€</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Koncentracija</div>
                    <div className={cn('font-bold uppercase',
                      insuranceData.riskAnalysis.concentrationRisk === 'high' ? 'text-red-500' :
                      insuranceData.riskAnalysis.concentrationRisk === 'medium' ? 'text-amber-400' : 'text-primary')}>
                      {insuranceData.riskAnalysis.concentrationRisk}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{insuranceData.riskAnalysis.concentrationPct}% top 3</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Theft risk</div>
                    <div className={cn('font-bold uppercase',
                      insuranceData.riskAnalysis.theftRiskLevel === 'high' ? 'text-red-500' :
                      insuranceData.riskAnalysis.theftRiskLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                      {insuranceData.riskAnalysis.theftRiskLevel}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{insuranceData.riskAnalysis.theftRisk}/10</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Amortizacija</div>
                    <div className={cn('font-bold uppercase',
                      insuranceData.riskAnalysis.depreciationRiskLevel === 'high' ? 'text-red-500' :
                      insuranceData.riskAnalysis.depreciationRiskLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                      {insuranceData.riskAnalysis.depreciationRiskLevel}
                    </div>
                    <div className="text-[9px] text-muted-foreground">−{insuranceData.riskAnalysis.totalDepreciationLoss}€/leto</div>
                  </div>
                </div>
              )}

              {/* Strategy + policy */}
              {insuranceData.analysis?.recommendedStrategy && insuranceData.analysis?.policy && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">
                    🛡️ Priporočena strategija: <b>{insuranceData.analysis.recommendedStrategy.replace('_', ' ')}</b>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-muted-foreground">Tip:</span> <b>{insuranceData.analysis.policy.type || '—'}</b></div>
                    <div><span className="text-muted-foreground">Pokritje:</span> <b className="font-mono">{insuranceData.analysis.policy.coverageEur}€</b></div>
                    <div><span className="text-muted-foreground">Premija/leto:</span> <b className="font-mono">{insuranceData.analysis.policy.estimatedAnnualPremiumEur}€</b></div>
                  </div>
                  {insuranceData.analysis.policy.providers?.length > 0 && (
                    <div className="text-[9px] text-muted-foreground mt-1">
                      🏛️ Ponudniki: {insuranceData.analysis.policy.providers.join(' · ')}
                    </div>
                  )}
                </div>
              )}

              {/* Self insurance reserve */}
              {insuranceData.analysis?.selfInsuranceReserve > 0 && (
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5 text-[10px]">
                  💰 Samo-zavarovanje rezerva: <b className="font-mono text-amber-400">{insuranceData.analysis.selfInsuranceReserve}€</b>
                  <span className="text-muted-foreground"> (za self-insured del portfolia)</span>
                </div>
              )}

              {/* High risk items */}
              {insuranceData.analysis?.highRiskItems?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Visoko tvegani itemi:</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {insuranceData.analysis.highRiskItems.map((h: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{h.title}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30">{h.risk}</Badge>
                            <span className="font-mono">{h.estimatedValue}€</span>
                          </div>
                        </div>
                        <div className="text-[9px] text-primary">→ {h.recommendation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {insuranceData.analysis?.recommendations?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💡 Priporočila:</div>
                  <div className="space-y-1">
                    {insuranceData.analysis.recommendations.map((r: any, i: number) => {
                      const prColor = r.priority === 'high' ? 'text-red-500' : r.priority === 'medium' ? 'text-amber-400' : 'text-blue-400';
                      return (
                        <div key={i} className="text-[10px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{r.action}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className={cn('text-[9px]', prColor)}>{r.priority}</Badge>
                              <span className="font-mono text-primary">+{r.savingsEur}€</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj" za AI analizo zavarovalnih tveganj in optimalne police.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.15: AI Predictive Stockout Alerts */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Predictive Stockout Alerts
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.15</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove primanjkljaj kategorij in predlaga restock timing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-muted-foreground shrink-0">Dni naprej:</span>
            <Input
              type="number"
              min={7}
              max={180}
              value={stockoutDays}
              onChange={(e) => setStockoutDays(e.target.value)}
              className="h-7 text-xs w-20"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={stockoutLoading}
              onClick={async () => {
                setStockoutLoading(true); setStockoutData(null);
                try {
                  const days = Math.max(7, Math.min(180, Number(stockoutDays) || 30));
                  const res = await fetch('/api/ai/predictive-stockout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ forecastDays: days }),
                  });
                  const data = await res.json();
                  if (data.ok) { setStockoutData(data); toast.success('✓ Stockout napoved generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setStockoutLoading(false); }
              }}>
              {stockoutLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Napovej
            </Button>
          </div>
          {stockoutLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira depletion rates in stock levels...</div>
          ) : stockoutData ? (
            <div className="space-y-2 text-xs">
              {stockoutData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{stockoutData.insights}</div>
              )}
              {stockoutData.summary && (
                <div className="grid grid-cols-5 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorij</div>
                    <div className="font-bold">{stockoutData.summary.totalCategories ?? 0}</div>
                  </div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5 border">
                    <div className="text-red-500 uppercase">🔴 Critical</div>
                    <div className="font-bold text-red-500">{stockoutData.summary.criticalCount ?? 0}</div>
                  </div>
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5 border">
                    <div className="text-amber-400 uppercase">🟡 High</div>
                    <div className="font-bold text-amber-400">{stockoutData.summary.highCount ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">⚪ Stagnant</div>
                    <div className="font-bold">{stockoutData.summary.stagnantCount ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Vrednost stocka</div>
                    <div className="font-bold text-primary">{stockoutData.summary.totalStockValue ?? 0}€</div>
                  </div>
                </div>
              )}

              {/* Restock alerts */}
              {stockoutData.restockAlerts?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="text-[10px] uppercase text-red-500 mb-1">🚨 Restock alerti:</div>
                  <div className="space-y-1">
                    {stockoutData.restockAlerts.map((a: any, i: number) => (
                      <div key={i} className={cn('text-[10px] rounded p-1',
                        a.alertLevel === 'critical' ? 'bg-red-500/10 text-red-500' :
                        a.alertLevel === 'high' ? 'bg-amber-400/10 text-amber-400' : 'text-muted-foreground')}>
                        <Badge variant="outline" className="text-[9px] mr-1">{a.category}</Badge>
                        <span className="font-bold uppercase">{a.alertLevel}</span>
                        <span> · {a.deadlineDays}d · {a.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Predictions table */}
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {stockoutData.predictions?.map((p: any, i: number) => {
                  const sevCfg: Record<string, { color: string; bg: string; icon: string }> = {
                    critical: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                    high: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                    medium: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '🔵' },
                    stagnant: { color: 'text-muted-foreground', bg: 'bg-muted/5 border-border', icon: '⚪' },
                    low: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '🟢' },
                  };
                  const cfg = sevCfg[p.severity] || sevCfg.low;
                  return (
                    <div key={i} className={cn('rounded p-1.5 border', cfg.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0">{p.category}</Badge>
                          <span className="text-[10px] text-muted-foreground shrink-0">{p.currentStock} itemov</span>
                        </div>
                        <div className="text-right shrink-0">
                          {p.daysToStockout !== null ? (
                            <>
                              <div className={cn('font-mono font-bold text-[10px]', cfg.color)}>{p.daysToStockout}d</div>
                              <div className="text-[8px] text-muted-foreground">do stockout</div>
                            </>
                          ) : (
                            <div className="text-[9px] text-muted-foreground">ni prodaj</div>
                          )}
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        Depletion: {p.depletionRate}/mesec · Vrednost: {p.currentValue}€ · Povp. starost: {p.avgAge}d
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recommendations */}
              {stockoutData.recommendations?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💡 Restock priporočila:</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {stockoutData.recommendations.map((r: any, i: number) => {
                      const actColor = r.action === 'restock_now' ? 'text-red-500' :
                                       r.action === 'start_sourcing' ? 'text-amber-400' :
                                       r.action === 'liquidate' ? 'text-destructive' : 'text-primary';
                      return (
                        <div key={i} className="text-[10px]">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold">{r.category}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className={cn('text-[9px] uppercase', actColor)}>{r.action.replace('_', ' ')}</Badge>
                              <span className="font-mono text-[9px]"> urgency {r.urgency}/10</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            🛒 {r.suggestedQuantity}x · 💰 {r.expectedRevenueEur}€ prihodkov · 📍 {r.sourcingHint}
                          </div>
                          {r.reasoning && <div className="text-[9px] italic">{r.reasoning}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej" za AI napoved primanjkljaja kategorij.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.15: AI Profit Margin Optimizer */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Profit Margin Optimizer
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.15</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI optimizira maržo preko pristojbin, shippinga in izbire platforme.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={marginLoading}
            onClick={async () => {
              setMarginLoading(true); setMarginData(null);
              try {
                const res = await fetch('/api/ai/margin-optimizer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setMarginData(data); toast.success('✓ Optimizacija marže generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setMarginLoading(false); }
            }}>
            {marginLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Optimiziraj marže
          </Button>
          {marginLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira pristojbine, shipping, davke in platforme...</div>
          ) : marginData ? (
            <div className="space-y-2 text-xs">
              {marginData.summary?.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{marginData.summary.summary}</div>
              )}
              {marginData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Itemov</div>
                    <div className="font-bold">{marginData.summary.totalItems ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Trenutna marža</div>
                    <div className="font-bold">{marginData.summary.totalCurrentMargin ?? 0}€</div>
                  </div>
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Optimirana</div>
                    <div className="font-bold text-primary">{marginData.summary.totalOptimizedMargin ?? 0}€</div>
                  </div>
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">+ Izboljšava</div>
                    <div className="font-bold text-primary">+{marginData.summary.totalImprovement ?? 0}€ ({marginData.summary.avgImprovementPct ?? 0}%)</div>
                  </div>
                </div>
              )}

              {/* Per-item optimizations */}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {marginData.items?.map((it: any, i: number) => (
                  <div key={i} className="border rounded p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[11px] truncate">{it.title}</div>
                        <div className="text-[9px] text-muted-foreground">{it.category}</div>
                      </div>
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/40 shrink-0">
                        +{it.improvementEur}€ ({it.improvementPct}%)
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[9px]">
                      <div className="bg-background/40 rounded p-1 border">
                        <div className="text-muted-foreground">Trenutno</div>
                        <div className="font-mono font-bold">{it.currentMargin}€ ({it.currentMarginPct}%)</div>
                      </div>
                      <div className="bg-primary/5 rounded p-1 border border-primary/20">
                        <div className="text-primary">Optimirano</div>
                        <div className="font-mono font-bold text-primary">{it.optimizedMarginEur}€ ({it.optimizedMarginPct}%)</div>
                      </div>
                      <div className="bg-background/40 rounded p-1 border">
                        <div className="text-muted-foreground">Cena</div>
                        <div className="font-mono font-bold">{it.optimizedPriceEur}€</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[9px]">
                      <Badge variant="outline" className="text-[9px]">📍 {it.optimizedPlatform}</Badge>
                      <Badge variant="outline" className="text-[9px]">📦 {it.optimizedShipping}</Badge>
                    </div>
                    {it.improvements?.length > 0 && (
                      <div className="space-y-0.5">
                        {it.improvements.map((imp: any, j: number) => (
                          <div key={j} className="text-[9px] flex items-center justify-between">
                            <span><span className="text-primary font-semibold">{imp.type.replace('_', ' ')}:</span> {imp.description}</span>
                            <span className="font-mono text-primary">+{imp.savingsEur}€</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {it.reasoning && <div className="text-[9px] text-muted-foreground italic">{it.reasoning}</div>}
                  </div>
                ))}
              </div>

              {/* General recommendations */}
              {marginData.recommendations?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💡 Splošna priporočila:</div>
                  <ul className="space-y-0.5 ml-3">
                    {marginData.recommendations.map((r: string, i: number) => (
                      <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Optimiziraj marže" za AI analizo pristojbin, shippinga in izbire platforme.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.16: AI Email Campaign Generator */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Email Campaign Generator
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.16</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI generira celovito email kampanjo za outreach kupcem (subject, body, CTA, segmenti).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-muted-foreground shrink-0">Tip:</span>
            <select
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value as any)}
              className="h-7 text-xs bg-background border rounded px-2"
            >
              <option value="newsletter">📬 Newsletter</option>
              <option value="win_back">🔄 Win-back</option>
              <option value="new_buyers">🆕 Novi kupci</option>
              <option value="bundle_offer">📦 Bundle ponudba</option>
              <option value="clearance">🔥 Clearance</option>
              <option value="seasonal">🎄 Sezonska</option>
            </select>
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={campaignLoading}
              onClick={async () => {
                setCampaignLoading(true); setCampaignData(null);
                try {
                  const res = await fetch('/api/ai/email-campaign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campaignType }),
                  });
                  const data = await res.json();
                  if (data.ok) { setCampaignData(data); toast.success('✓ Email kampanja generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setCampaignLoading(false); }
              }}>
              {campaignLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Generiraj
            </Button>
          </div>
          {campaignLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI generira celovito kampanjo v slovenščini...</div>
          ) : campaignData?.campaign ? (
            <div className="space-y-2 text-xs">
              {campaignData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{campaignData.insights}</div>
              )}

              {/* Subject + preview */}
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] uppercase text-muted-foreground">Subject:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(campaignData.campaign.subject);
                      setCampaignCopied('subject');
                      setTimeout(() => setCampaignCopied(null), 1500);
                      toast.success('Subject kopiran');
                    }}
                    className="text-[9px] text-primary hover:underline"
                  >
                    {campaignCopied === 'subject' ? '✓' : '📋'} Kopiraj
                  </button>
                </div>
                <div className="font-bold text-[12px]">{campaignData.campaign.subject}</div>
                {campaignData.campaign.previewText && (
                  <div className="text-[10px] text-muted-foreground mt-1 italic">{campaignData.campaign.previewText}</div>
                )}
              </div>

              {/* Subject variants */}
              {campaignData.campaign.subjectVariants?.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase text-muted-foreground mb-1">A/B subject varianti:</div>
                  <div className="space-y-0.5">
                    {campaignData.campaign.subjectVariants.map((s: string, i: number) => (
                      <div key={i} className="text-[10px] bg-background/40 rounded p-1 border">
                        <span className="text-muted-foreground">Var {String.fromCharCode(65 + i)}:</span> {s}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Body */}
              {campaignData.campaign.body && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] uppercase text-muted-foreground">Body:</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(campaignData.campaign.body);
                        setCampaignCopied('body');
                        setTimeout(() => setCampaignCopied(null), 1500);
                        toast.success('Body kopiran');
                      }}
                      className="text-[9px] text-primary hover:underline"
                    >
                      {campaignCopied === 'body' ? '✓' : '📋'} Kopiraj
                    </button>
                  </div>
                  <div className="bg-background/40 border rounded p-2 text-[11px] whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {campaignData.campaign.body}
                  </div>
                </div>
              )}

              {/* CTA */}
              {campaignData.campaign.cta && (
                <div className="bg-primary/10 border border-primary/30 rounded p-1.5 text-center">
                  <span className="text-[9px] uppercase text-primary font-bold">CTA: </span>
                  <span className="text-[11px] font-bold">{campaignData.campaign.cta}</span>
                </div>
              )}

              {/* Send strategy */}
              {campaignData.campaign.sendStrategy && (
                <div className="bg-background/40 border rounded p-2">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📅 Strategija pošiljanja:</div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-muted-foreground">Dan:</span> <b>{campaignData.campaign.sendStrategy.bestDay}</b></div>
                    <div><span className="text-muted-foreground">Ura:</span> <b>{campaignData.campaign.sendStrategy.bestTime}</b></div>
                    <div><span className="text-muted-foreground">Frekvenca:</span> <b>{campaignData.campaign.sendStrategy.frequency}</b></div>
                  </div>
                  {campaignData.campaign.sendStrategy.reasoning && (
                    <div className="text-[9px] text-muted-foreground italic mt-1">{campaignData.campaign.sendStrategy.reasoning}</div>
                  )}
                </div>
              )}

              {/* Segments */}
              {campaignData.campaign.segments?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">👥 Segmenti:</div>
                  <div className="space-y-1">
                    {campaignData.campaign.segments.map((s: any, i: number) => (
                      <div key={i} className="bg-background/40 border rounded p-1.5 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{s.name}</span>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[9px]">{s.estimatedReach} ljudi</Badge>
                          </div>
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">{s.criteria}</div>
                        <div className="text-[9px] mt-0.5">
                          📧 Open: <b>{s.expectedOpenRate}%</b> · 🖱 Click: <b>{s.expectedClickRate}%</b>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Follow-up */}
              {campaignData.campaign.followUp?.subject && (
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                  <div className="text-[10px] uppercase text-amber-400 mb-1">
                    🔄 Follow-up (po {campaignData.campaign.followUp.waitDays}d):
                  </div>
                  <div className="font-bold text-[11px]">{campaignData.campaign.followUp.subject}</div>
                  <div className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap">{campaignData.campaign.followUp.body}</div>
                </div>
              )}

              {/* Featured items */}
              {campaignData.campaign.featuredItems?.length > 0 && (
                <div className="bg-background/40 border rounded p-1.5">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📦 Featured itemi:</div>
                  <div className="flex flex-wrap gap-1">
                    {campaignData.campaign.featuredItems.map((f: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[9px]">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Generiraj" za AI email kampanjo v slovenščini.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.16: AI Customer LTV Predictor */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Customer Lifetime Value
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.16</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove LTV kupcev, segmentacijo in retention strategije.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={ltvLoading}
            onClick={async () => {
              setLtvLoading(true); setLtvData(null);
              try {
                const res = await fetch('/api/ai/customer-ltv', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setLtvData(data); toast.success('✓ LTV analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setLtvLoading(false); }
            }}>
            {ltvLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj kupce
          </Button>
          {ltvLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira nakupne vzorce in napoveduje LTV...</div>
          ) : ltvData ? (
            <div className="space-y-2 text-xs">
              {ltvData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{ltvData.insights}</div>
              )}
              {ltvData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Prihodek</div>
                    <div className="font-bold text-primary">{ltvData.summary.totalRevenue}€</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. LTV</div>
                    <div className="font-bold">{ltvData.summary.avgCustomerLtv}€</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Repeat</div>
                    <div className="font-bold text-primary">{ltvData.summary.repeatCustomersPct}%</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">VIP / At-risk</div>
                    <div className="font-bold">{ltvData.summary.vipCount ?? 0}/{ltvData.summary.atRiskCount ?? 0}</div>
                  </div>
                </div>
              )}

              {/* Customer list */}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {ltvData.customers?.map((c: any, i: number) => {
                  const segCfg: Record<string, { color: string; bg: string; icon: string }> = {
                    vip: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '⭐' },
                    loyal: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '💙' },
                    occasional: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                    one_time: { color: 'text-muted-foreground', bg: 'bg-background/40 border-border', icon: '⚪' },
                    at_risk: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                  };
                  const cfg = segCfg[c.segment] || segCfg.occasional;
                  return (
                    <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0 truncate max-w-[120px]">{c.name}</Badge>
                          <Badge variant="outline" className={cn('text-[9px] shrink-0 uppercase', cfg.color)}>{c.segment.replace('_', ' ')}</Badge>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold text-primary text-[11px]">{c.predictedLtv12mEur}€</div>
                          <div className="text-[8px] text-muted-foreground">LTV 12m</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div><span className="text-muted-foreground">Nakupi:</span> <b className="font-mono">{c.purchaseCount}</b></div>
                        <div><span className="text-muted-foreground">Skupaj:</span> <b className="font-mono">{c.totalSpent}€</b></div>
                        <div><span className="text-muted-foreground">Povp.:</span> <b className="font-mono">{c.avgOrderValue}€</b></div>
                        <div><span className="text-muted-foreground">Dobiček:</span> <b className="font-mono text-primary">{c.profit}€</b></div>
                      </div>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-muted-foreground">Churn risk: <b className={cn(c.churnRiskPct > 60 ? 'text-red-500' : c.churnRiskPct > 30 ? 'text-amber-400' : 'text-primary')}>{c.churnRiskPct}%</b></span>
                        <Badge variant="outline" className="text-[9px]">→ {c.retentionStrategy.replace('_', ' ')}</Badge>
                      </div>
                      {c.personalizedOffer && (
                        <div className="text-[9px] bg-background/40 rounded p-1 border">
                          🎯 <span className="font-medium">{c.personalizedOffer}</span>
                        </div>
                      )}
                      {c.crossSellCategories?.length > 0 && (
                        <div className="text-[9px] text-muted-foreground">
                          🔄 Cross-sell: {c.crossSellCategories.join(' · ')}
                        </div>
                      )}
                      {c.reasoning && <div className="text-[9px] italic">{c.reasoning}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj kupce" za AI napoved LTV in retention strategije.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.24: AI Inventory Aging Alert System */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Inventory Aging Alert System
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.24</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI sledi staranju inventarja in opozarja na zastarele iteme z holding cost.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={agingLoading}
            onClick={async () => {
              setAgingLoading(true); setAgingData(null);
              try {
                const res = await fetch('/api/ai/inventory-aging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setAgingData(data); toast.success('✓ Aging analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setAgingLoading(false); }
            }}>
            {agingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj staranje
          </Button>
          {agingLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira staranje inventarja in holding cost...</div>
          ) : agingData ? (
            <div className="space-y-2 text-xs">
              {agingData.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{agingData.insights}</div>}
              {agingData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Itemov</div><div className="font-bold">{agingData.summary.totalItems ?? 0}</div></div>
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5"><div className="text-amber-400 uppercase">Holding cost</div><div className="font-bold text-amber-400">{agingData.summary.totalHoldingCostEur ?? 0}€</div></div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5"><div className="text-red-500 uppercase">Kritičnih</div><div className="font-bold text-red-500">{agingData.summary.criticalCount ?? 0}</div></div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5"><div className="text-red-500 uppercase">Možna izguba</div><div className="font-bold text-destructive">{agingData.summary.potentialLossEur ?? 0}€</div></div>
                </div>
              )}
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {agingData.alerts?.map((a: any, i: number) => {
                  const urgencyCfg: Record<string, { color: string; bg: string; icon: string }> = {
                    critical: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                    high: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                    medium: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                    low: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                  };
                  const cfg = urgencyCfg[a.urgency] || urgencyCfg.medium;
                  return (
                    <div key={i} className={cn('border rounded p-1.5 space-y-1', cfg.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <span className="font-bold text-[11px] truncate">{a.title}</span>
                        </div>
                        <Badge variant="outline" className={cn('text-[8px] uppercase shrink-0', cfg.color)}>{a.agingStage}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div><span className="text-muted-foreground">Dan v skladišču:</span> <b>{a.daysHeld}d</b></div>
                        <div><span className="text-muted-foreground">Holding:</span> <b className="text-amber-400">{a.totalHoldingCostEur}€</b></div>
                        <div><span className="text-muted-foreground">Dobiček:</span> <b className={a.adjustedProfitEur >= 0 ? 'text-primary' : 'text-destructive'}>{a.adjustedProfitEur}€</b></div>
                        <div><span className="text-muted-foreground">Popust:</span> <b className="text-amber-400">−{a.suggestedDiscountPct}%</b></div>
                      </div>
                      <div className="flex items-center justify-between text-[9px]">
                        <Badge variant="outline" className="text-[8px]">→ {a.action.replace('_', ' ')}</Badge>
                        <span className="text-primary font-bold">💡 {a.suggestedPriceEur}€ · ⏱ {a.deadlineDays}d</span>
                      </div>
                      {a.reasoning && <div className="text-[9px] italic">{a.reasoning}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj staranje" za AI analizo zastarelega inventarja.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.24: AI Smart Restock Predictor */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Smart Restock Predictor
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.24</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove kaj, kje in kdaj kupovati za max dobiček z budget alokacijo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input type="number" placeholder="Budget (EUR, opcijsko)" value={restockBudget} onChange={(e) => setRestockBudget(e.target.value)} className="h-7 text-xs w-44" />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={restockLoading}
              onClick={async () => {
                setRestockLoading(true); setRestockData(null);
                try {
                  const budgetNum = restockBudget ? Number(restockBudget) : 0;
                  const res = await fetch('/api/ai/smart-restock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budget: budgetNum || undefined }) });
                  const data = await res.json();
                  if (data.ok) { setRestockData(data); toast.success('✓ Restock napoved generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setRestockLoading(false); }
              }}>
              {restockLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Napovej restock
            </Button>
          </div>
          {restockLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira ROI kategorij in predvideva restock...</div>
          ) : restockData ? (
            <div className="space-y-2 text-xs">
              {restockData.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{restockData.insights}</div>}
              {restockData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Predlogov</div><div className="font-bold">{restockData.summary.totalPredictions ?? 0}</div></div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5"><div className="text-red-500 uppercase">Kritično</div><div className="font-bold text-red-500">{restockData.summary.criticalCount ?? 0}</div></div>
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5"><div className="text-amber-400 uppercase">Visoka</div><div className="font-bold text-amber-400">{restockData.summary.highCount ?? 0}</div></div>
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Povp. ROI</div><div className="font-bold text-primary">{restockData.summary.avgExpectedRoi ?? 0}%</div></div>
                </div>
              )}
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {restockData.predictions?.map((p: any, i: number) => {
                  const urgencyCfg: Record<string, { color: string; bg: string; icon: string }> = {
                    critical: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                    high: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                    medium: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                    low: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                  };
                  const cfg = urgencyCfg[p.urgency] || urgencyCfg.medium;
                  return (
                    <div key={i} className={cn('border rounded p-1.5 space-y-1', cfg.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <span className="font-bold text-[11px] truncate">{p.item}</span>
                          <Badge variant="outline" className="text-[8px] shrink-0">{p.category}</Badge>
                        </div>
                        <Badge variant="outline" className={cn('text-[8px] shrink-0', cfg.color)}>{p.urgency}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div><span className="text-muted-foreground">Nakup:</span> <b className="font-mono">{p.expectedBuyPriceEur}€</b></div>
                        <div><span className="text-muted-foreground">Prodaja:</span> <b className="font-mono text-primary">{p.expectedSellPriceEur}€</b></div>
                        <div><span className="text-muted-foreground">ROI:</span> <b className={cn('font-mono', p.expectedRoiPct >= 30 ? 'text-primary' : 'text-amber-400')}>{p.expectedRoiPct}%</b></div>
                        <div><span className="text-muted-foreground">Čas:</span> <b className="font-mono">{p.expectedDaysToSell}d</b></div>
                      </div>
                      <div className="text-[9px] text-muted-foreground">📍 {p.source} · 🔍 {p.searchKeywords} · ×{p.quantity}{p.budgetAllocationEur > 0 && ` · ${p.budgetAllocationEur}€`}</div>
                      {p.reasoning && <div className="text-[9px] italic">{p.reasoning}</div>}
                    </div>
                  );
                })}
              </div>
              {restockData.budgetAllocation?.allocation?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💰 Budget alokacija:</div>
                  <div className="space-y-0.5">
                    {restockData.budgetAllocation.allocation.map((a: any, i: number) => (
                      <div key={i} className="text-[10px] flex items-center justify-between">
                        <span><Badge variant="outline" className="text-[8px] mr-1">{a.category}</Badge> {a.reasoning}</span>
                        <span className="font-mono font-bold text-primary">{a.amountEur}€ ({a.pct}%)</span>
                      </div>
                    ))}
                    {restockData.budgetAllocation.reserveEur > 0 && (
                      <div className="text-[10px] text-amber-400 mt-1">💾 Rezerva: {restockData.budgetAllocation.reserveEur}€ ({restockData.budgetAllocation.reservePct}%)</div>
                    )}
                  </div>
                </div>
              )}
              {restockData.seasonalAlerts?.length > 0 && (
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                  <div className="text-[10px] uppercase text-amber-400 mb-1">🗓 Sezonska opozorila:</div>
                  <div className="space-y-1">
                    {restockData.seasonalAlerts.map((s: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <div className="font-bold capitalize">{s.season} — {s.deadline}</div>
                        {s.itemsToBuy?.length > 0 && <div className="text-primary">🛒 Kupi: {s.itemsToBuy.join(' · ')}</div>}
                        {s.itemsToSell?.length > 0 && <div className="text-amber-400">💰 Prodaj: {s.itemsToSell.join(' · ')}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej restock" za AI napoved kaj in kje kupovati.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.30 MILESTONE: AI Profit Maximization Dashboard */}
      <Card className="bg-card/50 border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            🎯 AI Profit Maximization Dashboard
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.30 MILESTONE</Badge>
          </CardTitle>
          <CardDescription className="text-xs">Agregira VSE AI metrike v eno unified view z health score, opportunities, risks in projections.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={dashLoading}
            onClick={async () => {
              setDashLoading(true); setDashData(null);
              try {
                const res = await fetch('/api/ai/profit-dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setDashData(data); toast.success('✓ Profit dashboard generiran'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setDashLoading(false); }
            }}>
            {dashLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generiraj dashboard
          </Button>
          {dashLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI agregira vse metrike v unified dashboard...</div>
          ) : dashData?.dashboard ? (
            <div className="space-y-2 text-xs">
              {/* Health score */}
              <div className={cn('border rounded p-2 text-center',
                dashData.dashboard.portfolioHealthScore >= 70 ? 'bg-primary/10 border-primary/30' :
                dashData.dashboard.portfolioHealthScore >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
                <div className="text-[10px] uppercase text-muted-foreground">Portfolio Health Score</div>
                <div className="text-3xl font-bold">{dashData.dashboard.portfolioHealthScore}/100</div>
                <Badge variant="outline" className={cn('text-[9px] font-bold',
                  dashData.dashboard.portfolioHealthGrade.startsWith('A') ? 'text-primary border-primary/40' :
                  dashData.dashboard.portfolioHealthGrade.startsWith('B') ? 'text-blue-400 border-blue-400/40' :
                  'text-red-500 border-red-500/40')}>Grade: {dashData.dashboard.portfolioHealthGrade}</Badge>
              </div>
              {/* KPIs */}
              {dashData.dashboard.kpis && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Dobiček</div><div className="font-bold text-primary">{dashData.dashboard.kpis.realizedProfitEur ?? 0}€</div></div>
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Vezano</div><div className="font-bold">{dashData.dashboard.kpis.investedHeldEur ?? 0}€</div></div>
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">ROI</div><div className="font-bold text-primary">{dashData.dashboard.kpis.avgRoiPct ?? 0}%</div></div>
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Prodaja</div><div className="font-bold">{dashData.dashboard.kpis.avgDaysToSell ?? 0}d</div></div>
                </div>
              )}
              {/* Top opportunities */}
              {dashData.dashboard.topOpportunities?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">🚀 Top priložnosti:</div>
                  {dashData.dashboard.topOpportunities.slice(0, 3).map((o: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center justify-between">
                      <span><Badge variant="outline" className="text-[8px] mr-1">{o.category}</Badge> {o.action}</span>
                      <span className="font-mono text-primary">{o.expectedRoiPct}% ROI</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Top risks */}
              {dashData.dashboard.topRisks?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Top tveganja:</div>
                  {dashData.dashboard.topRisks.slice(0, 3).map((r: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center justify-between">
                      <span><Badge variant="outline" className="text-[8px] mr-1">{r.riskType}</Badge> {r.item}</span>
                      <span className="font-mono text-destructive">−{r.potentialLossEur}€</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Recommended actions */}
              {dashData.dashboard.recommendedActions?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Priporočene akcije:</div>
                  {dashData.dashboard.recommendedActions.slice(0, 4).map((a: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center justify-between bg-background/40 rounded p-1 border mb-0.5">
                      <span>{a.action}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="outline" className={cn('text-[8px]', a.priority === 'critical' ? 'text-red-500 border-red-500/30' : a.priority === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>{a.priority}</Badge>
                        {a.expectedImpactEur > 0 && <span className="font-mono text-primary">+{a.expectedImpactEur}€</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {dashData.dashboard.overallAssessment && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] italic">{dashData.dashboard.overallAssessment}</div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni za AI dashboard z vsemi metrikami in priporočili.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.30 MILESTONE: AI Predictive Procurement */}
      <Card className="bg-card/50 border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            🛒 AI Predictive Procurement
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.30 MILESTONE</Badge>
          </CardTitle>
          <CardDescription className="text-xs">Avtomatski nakupovalni načrt z monitor setup in automation config per item.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input type="number" placeholder="Budget (€)" value={procBudget} onChange={(e) => setProcBudget(e.target.value)} className="h-7 text-xs w-32" />
            <select value={procRisk} onChange={(e) => setProcRisk(e.target.value as any)} className="h-7 text-xs bg-background border rounded px-2">
              <option value="low">🛡️ Low risk</option>
              <option value="medium">⚖️ Medium</option>
              <option value="high">🔥 High risk</option>
            </select>
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={procLoading}
              onClick={async () => {
                setProcLoading(true); setProcData(null);
                try {
                  const res = await fetch('/api/ai/predictive-procurement', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ budget: procBudget ? Number(procBudget) : undefined, riskTolerance: procRisk }),
                  });
                  const data = await res.json();
                  if (data.ok) { setProcData(data); toast.success('✓ Procurement načrt generiran'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setProcLoading(false); }
              }}>
              {procLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Generiraj načrt
            </Button>
          </div>
          {procLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI ustvarja procurement načrt...</div>
          ) : procData?.procurement ? (
            <div className="space-y-2 text-xs">
              {procData.procurement.expectedOutcomes && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Investicija</div><div className="font-bold">{procData.procurement.expectedOutcomes.totalInvestmentEur ?? 0}€</div></div>
                  <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Prihodek</div><div className="font-bold">{procData.procurement.expectedOutcomes.expectedRevenueEur ?? 0}€</div></div>
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Dobiček</div><div className="font-bold text-primary">{procData.procurement.expectedOutcomes.expectedProfitEur ?? 0}€</div></div>
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">ROI</div><div className="font-bold text-primary">{procData.procurement.expectedOutcomes.expectedRoiPct ?? 0}%</div></div>
                </div>
              )}
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {procData.procurement.plan?.map((p: any, i: number) => (
                  <div key={i} className={cn('border rounded p-1.5 space-y-0.5',
                    p.riskLevel === 'high' ? 'bg-red-500/5 border-red-500/20' :
                    p.riskLevel === 'medium' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-primary/5 border-primary/20')}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-[10px] truncate">#{p.priority} {p.itemDescription}</span>
                      <Badge variant="outline" className="text-[8px] text-primary shrink-0">{p.expectedRoiPct}%</Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">📍 {p.source} · 💰 {p.maxBuyPriceEur}€→{p.expectedSellPriceEur}€ · ⏱ {p.expectedDaysToSell}d</div>
                    {p.automation?.monitorSetup && <div className="text-[9px] text-primary">🤖 {p.automation.monitorSetup}</div>}
                  </div>
                ))}
              </div>
              {procData.procurement.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] text-primary">{procData.procurement.insights}</div>}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni za AI procurement načrt z avtomatizacijo.</p>
          )}
        </CardContent>
      </Card>

      {/* v6.30 MILESTONE: AI Full Automation Orchestrator */}
      <Card className="bg-card/50 border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            🤖 AI Full Automation Orchestrator
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.30 MILESTONE</Badge>
          </CardTitle>
          <CardDescription className="text-xs">3 nivoji avtomatizacije: advisory → semi_auto → full_auto z buy+sell pipelines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <select value={autoMode} onChange={(e) => setAutoMode(e.target.value as any)} className="h-7 text-xs bg-background border rounded px-2 flex-1">
              <option value="advisory">📋 Advisory (samo priporočila)</option>
              <option value="semi_auto">⚙️ Semi-auto (monitoring + alerti)</option>
              <option value="full_auto">🤖 Full-auto (avtomatski nakup + prodaja)</option>
            </select>
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={autoLoading}
              onClick={async () => {
                setAutoLoading(true); setAutoData(null);
                try {
                  const res = await fetch('/api/ai/full-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: autoMode }) });
                  const data = await res.json();
                  if (data.ok) { setAutoData(data); toast.success('✓ Automation načrt generiran'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setAutoLoading(false); }
              }}>
              {autoLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Generiraj
            </Button>
          </div>
          {autoLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI ustvarja avtomacijski načrt...</div>
          ) : autoData?.automation ? (
            <div className="space-y-2 text-xs">
              <div className={cn('border rounded p-2 text-center',
                autoMode === 'full_auto' ? 'bg-primary/10 border-primary/30' : autoMode === 'semi_auto' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/40 border-border')}>
                <div className="text-[10px] uppercase text-muted-foreground">Avtomacijski nivo</div>
                <div className="font-bold text-sm capitalize">{autoData.automation.mode.replace('_', ' ')}</div>
              </div>
              {/* Buy pipeline */}
              {autoData.automation.buyPipeline?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-primary mb-1">🛒 Buy Pipeline:</div>
                  {autoData.automation.buyPipeline.slice(0, 5).map((s: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center gap-1 bg-background/40 rounded p-1 border mb-0.5">
                      <span className="font-mono font-bold shrink-0">{s.step}.</span>
                      <span className="flex-1 truncate">{s.name}</span>
                      {s.automated && <Badge variant="outline" className="text-[8px] text-primary border-primary/30 shrink-0">🤖 auto</Badge>}
                    </div>
                  ))}
                </div>
              )}
              {/* Sell pipeline */}
              {autoData.automation.sellPipeline?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-primary mb-1">💰 Sell Pipeline:</div>
                  {autoData.automation.sellPipeline.slice(0, 5).map((s: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center gap-1 bg-background/40 rounded p-1 border mb-0.5">
                      <span className="font-mono font-bold shrink-0">{s.step}.</span>
                      <span className="flex-1 truncate">{s.name}</span>
                      {s.automated && <Badge variant="outline" className="text-[8px] text-primary border-primary/30 shrink-0">🤖 auto</Badge>}
                    </div>
                  ))}
                </div>
              )}
              {/* Safeguards */}
              {autoData.automation.safeguards?.length > 0 && (
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                  <div className="text-[10px] uppercase text-amber-400 mb-1">🛡️ Zaščite:</div>
                  {autoData.automation.safeguards.slice(0, 4).map((s: any, i: number) => (
                    <div key={i} className="text-[10px]">• <b>{s.name}</b>: {s.rule}</div>
                  ))}
                </div>
              )}
              {/* Expected improvements */}
              {autoData.automation.expectedImprovements && (
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Čas prihranjen</div><div className="font-bold">{autoData.automation.expectedImprovements.timeSavedHoursPerWeek ?? 0}h/teden</div></div>
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Profit+</div><div className="font-bold text-primary">{autoData.automation.expectedImprovements.profitIncreasePct ?? 0}%</div></div>
                </div>
              )}
              {autoData.automation.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] text-primary">{autoData.automation.insights}</div>}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Izberi nivo avtomatizacije in klikni za AI načrt.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
