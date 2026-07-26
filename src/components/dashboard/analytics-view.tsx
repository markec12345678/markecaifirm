'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, BarChart3, TrendingUp, TrendingDown, Target, AlertTriangle, AlertCircle, Activity, ThumbsUp, ThumbsDown, Archive, Bell, Wallet, GitCompare, ExternalLink, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

interface AnalyticsData {
  alertsPerDay: Array<{ date: string; total: number; PRILIKA: number; SUMNJIVO: number; NEZANIMIVO: number }>;
  listingsPerDay: Array<{ date: string; count: number }>;
  verdictDistribution: { PRILIKA: number; SUMNJIVO: number; NEZANIMIVO: number };
  monitorPerformance: Array<{
    id: string;
    name: string;
    source: string;
    isActive: boolean;
    totalListings: number;
    totalAlerts: number;
    recentAlerts: number;
    prilika: number;
    successRate: number;
    avgDurationMs: number;
    userInterested: number;
    userScam: number;
    userArchived: number;
    precision: number | null;
    conversionRate: number;
  }>;
  accuracy: {
    interested: number;
    archived: number;
    scam: number;
    ignored: number;
    total: number;
    precision: number | null;
  };
  // v1.7: Trade stats
  trades: {
    totalTrades: number;
    heldCount: number;
    soldCount: number;
    realizedProfit: number;
    byMonth: Array<{ month: string; profit: number; count: number }>;
    byCategory: Array<{ category: string; count: number; profit: number }>;
  };
  // v2.0: Price drops
  priceDrops: {
    total: number;
    recent: Array<{
      id: string;
      title: string;
      currentPrice: number | null;
      previousPrice: number | null;
      priceText: string;
      url: string;
      monitorName: string;
      droppedAt: string | null;
    }>;
  };
  // v2.0: Threshold suggestion
  thresholdSuggestion: {
    action: string;
    current: number;
    suggested: number;
    reason: string;
    impact: string;
  } | null;
  // v2.0: Top sellers
  topSellers: Array<{ name: string; listingCount: number }>;
  generatedAt: string;
}

const PIE_COLORS = ['#4ade80', '#fbbf24', '#6b7280'];

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [arbitrage, setArbitrage] = useState<any>(null);
  // v5.2: Cross-portal arbitrage
  const [crossPortal, setCrossPortal] = useState<any>(null);
  const [crossPortalLoading, setCrossPortalLoading] = useState(false);
  const [crossPortalThreshold, setCrossPortalThreshold] = useState(20);
  // v6.0: AI Trend Predictions
  const [trendPreds, setTrendPreds] = useState<any>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  // v6.4: Competitor tracking
  const [competitors, setCompetitors] = useState<any>(null);
  const [compLoading, setCompLoading] = useState(false);

  const loadCrossPortal = useCallback(async (threshold: number = 20) => {
    setCrossPortalLoading(true);
    try {
      const res = await fetch(`/api/arbitrage/cross-portal?threshold=${threshold}&limit=50`);
      if (res.ok) setCrossPortal(await res.json());
    } catch { /* ignore */ }
    finally { setCrossPortalLoading(false); }
  }, []);

  // v6.0: Load AI trend predictions
  const loadTrendPredictions = useCallback(async () => {
    setTrendLoading(true);
    try {
      const res = await fetch('/api/ai/trend-predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30 }),
      });
      if (res.ok) setTrendPreds(await res.json());
    } catch { /* ignore */ }
    finally { setTrendLoading(false); }
  }, []);

  // v6.4: Load competitors
  const loadCompetitors = useCallback(async () => {
    setCompLoading(true);
    try {
      const res = await fetch('/api/sellers/competitors');
      if (res.ok) setCompetitors(await res.json());
    } catch { /* ignore */ }
    finally { setCompLoading(false); }
  }, []);

  const load = useCallback(async () => {
    try {
      const [res, arbRes] = await Promise.all([
        fetch('/api/analytics'),
        fetch('/api/arbitrage'),
      ]);
      if (res.ok) setData(await res.json());
      if (arbRes.ok) setArbitrage(await arbRes.json());
    } catch {
      toast.error('Ne morem naložiti analitike');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCrossPortal(crossPortalThreshold); }, [loadCrossPortal, crossPortalThreshold]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const hasData = data.alertsPerDay.length > 0 || data.monitorPerformance.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Analitika
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Trendi, performansa monitorjev, natančnost AI (zadnjih 14 dni).
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Osveži
        </Button>
      </div>

      {!hasData ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Še ni dovolj podatkov za analitiko.</p>
            <p className="text-xs text-muted-foreground mt-1">Poženi vsaj nekaj monitorjev, da zbereš podatke.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* AI Accuracy summary */}
          <Card className="bg-card/50 border-primary/30">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Natančnost AI
              </CardTitle>
              <CardDescription>
                Kako dobro AI identificira prave priložnosti (glede na tvoje povratne informacije).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <AccuracyCard
                  icon={<ThumbsUp className="w-4 h-4" />}
                  label="Zanima me"
                  value={data.accuracy.interested}
                  color="primary"
                />
                <AccuracyCard
                  icon={<Archive className="w-4 h-4" />}
                  label="Arhivirano"
                  value={data.accuracy.archived}
                  color="muted"
                />
                <AccuracyCard
                  icon={<ThumbsDown className="w-4 h-4" />}
                  label="Prevara"
                  value={data.accuracy.scam}
                  color="amber"
                />
                <AccuracyCard
                  icon={<Activity className="w-4 h-4" />}
                  label="Brez akcije"
                  value={data.accuracy.ignored}
                  color="muted"
                />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Skupno povratnih informacij:</span>
                <span className="font-bold text-primary">{data.accuracy.total}</span>
                {data.accuracy.precision != null && (
                  <>
                    <span className="text-muted-foreground ml-4">Precision (interested / (interested + scam)):</span>
                    <Badge variant="outline" className={cn(
                      'text-sm',
                      data.accuracy.precision >= 0.7 ? 'border-primary/40 text-primary' :
                      data.accuracy.precision >= 0.4 ? 'border-amber-400/40 text-amber-400' :
                      'border-destructive/40 text-destructive'
                    )}>
                      {(data.accuracy.precision * 100).toFixed(1)}%
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {data.accuracy.precision >= 0.7 ? '(odlično — AI dobro ločuje priložnosti)' :
                       data.accuracy.precision >= 0.4 ? '(srednje — premakni threshold višje)' :
                       '(slabo — dvigaj minOpportunityScore ali dodaj excludeKeywords)'}
                    </span>
                  </>
                )}
                {data.accuracy.precision == null && (
                  <span className="text-xs text-muted-foreground">
                    Za izračun precision označi vsaj nekaj alertov kot "Zanima me" ali "Prevara".
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Alerts per day */}
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  Alerti na dan (zadnjih 14 dni)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.alertsPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                      labelStyle={{ color: '#d4d4d4' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="PRILIKA" stroke="#4ade80" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="SUMNJIVO" stroke="#fbbf24" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="NEZANIMIVO" stroke="#6b7280" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Verdict distribution pie */}
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Distribucija verdiktov (skupno)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'PRILIKA', value: data.verdictDistribution.PRILIKA, color: '#4ade80' },
                        { name: 'SUMNJIVO', value: data.verdictDistribution.SUMNJIVO, color: '#fbbf24' },
                        { name: 'NEZANIMIVO', value: data.verdictDistribution.NEZANIMIVO, color: '#6b7280' },
                      ].filter(d => d.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(d: any) => `${d.name}: ${d.value}`}
                      labelLine={false}
                    >
                      {PIE_COLORS.map((color, i) => (
                        <Cell key={i} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Listings per day bar chart */}
            <Card className="bg-card/50 lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Novi oglasi na dan (zadnjih 14 dni)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.listingsPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                      labelStyle={{ color: '#d4d4d4' }}
                    />
                    <Bar dataKey="count" fill="#4ade80" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* v1.7: Profit chart from trades */}
            {data.trades && data.trades.totalTrades > 0 && (
              <>
                <Card className="bg-card/50 lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      Profit po mesecih (Skladišče)
                      <Badge variant="outline" className="text-[10px] text-primary border-primary/40 ml-2">
                        Skupno: {data.trades.realizedProfit >= 0 ? '+' : ''}{data.trades.realizedProfit.toFixed(2)} €
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Realiziran profit iz prodanih tradev. {data.trades.soldCount} prodanih, {data.trades.heldCount} v skladišču.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.trades.byMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                        <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                          labelStyle={{ color: '#d4d4d4' }}
                          formatter={(value: any) => [`${Number(value).toFixed(2)} €`, 'Profit']}
                        />
                        <Bar dataKey="profit" fill="#4ade80" radius={[3, 3, 0, 0]}>
                          {data.trades.byMonth.map((entry, i) => (
                            <Cell key={i} fill={entry.profit >= 0 ? '#4ade80' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Profit by category */}
                {data.trades.byCategory.length > 0 && (
                  <Card className="bg-card/50">
                    <CardHeader>
                      <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary" />
                        Profit po kategorijah
                      </CardTitle>
                      <CardDescription>Kje dejansko zaslužiš?</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {data.trades.byCategory
                          .sort((a, b) => b.profit - a.profit)
                          .map(cat => (
                            <div key={cat.category} className="flex items-center justify-between p-2 bg-background/30 rounded text-xs">
                              <div>
                                <div className="font-medium">{cat.category}</div>
                                <div className="text-[10px] text-muted-foreground">{cat.count} tradev</div>
                              </div>
                              <div className={cn('font-bold font-mono', cat.profit >= 0 ? 'text-primary' : 'text-destructive')}>
                                {cat.profit >= 0 ? '+' : ''}{cat.profit.toFixed(2)} €
                              </div>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>

          {/* v2.1: Threshold suggestion banner */}
          {data.thresholdSuggestion && (
            <Card className="border-amber-400/40 bg-amber-400/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-1">
                      Predlog za threshold tuning
                    </h3>
                    <p className="text-xs text-muted-foreground mb-2">{data.thresholdSuggestion.reason}</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">Trenutno: <b className="text-foreground">{data.thresholdSuggestion.current}</b></span>
                      <span className="text-amber-400">→</span>
                      <span className="text-primary">Predlagano: <b>{data.thresholdSuggestion.suggested}</b></span>
                      <span className="text-muted-foreground ml-2">({data.thresholdSuggestion.impact})</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* v2.1: Recent price drops */}
          {data.priceDrops && data.priceDrops.recent.length > 0 && (
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-primary" />
                  Zadnji padci cen ({data.priceDrops.total} skupno)
                </CardTitle>
                <CardDescription>Oglasi kjer je prodajalec znižal ceno — boljša pogajalska pozicija.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {data.priceDrops.recent.map((drop, i) => {
                    const diff = drop.previousPrice != null && drop.currentPrice != null
                      ? drop.previousPrice - drop.currentPrice
                      : null;
                    const pct = diff != null && drop.previousPrice != null && drop.previousPrice > 0
                      ? Math.round((diff / drop.previousPrice) * 100)
                      : null;
                    return (
                      <a
                        key={drop.id || i}
                        href={drop.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 p-2 bg-background/30 border border-border rounded hover:border-primary/30 transition-colors text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{drop.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {drop.priceText} • {drop.monitorName}
                            {drop.droppedAt && ` • ${new Date(drop.droppedAt).toLocaleDateString('sl-SI')}`}
                          </div>
                        </div>
                        {diff != null && pct != null && (
                          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
                            📉 -{diff}€ ({pct}%)
                          </Badge>
                        )}
                      </a>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* v2.1: Top sellers */}
          {data.topSellers && data.topSellers.length > 0 && (
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Top prodajalci (seller tracking)
                </CardTitle>
                <CardDescription>Prodajalci z največ aktivnimi oglasi — aktivni prodajalci so bolj verodostojni.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {data.topSellers.map((seller, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 p-2 bg-background/30 rounded text-xs">
                      <span className="font-medium">{seller.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {seller.listingCount} oglasov
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* v3.0: Arbitrage opportunities */}
          {arbitrage && arbitrage.opportunities && arbitrage.opportunities.length > 0 && (
            <Card className="bg-card/50 lg:col-span-2 border-primary/30">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <GitCompare className="w-4 h-4 text-primary" />
                  Arbitražne priložnosti ({arbitrage.total})
                </CardTitle>
                <CardDescription>
                  Ista artikla na različnih portalih z različnimi cenami — kupi poceni, prodaj drago.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {arbitrage.opportunities.slice(0, 10).map((opp: any, i: number) => (
                    <div key={i} className="p-2 bg-background/30 rounded border border-border">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium truncate flex-1">{opp.title}</span>
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary shrink-0">
                          💰 +{opp.potentialProfit}€ ({opp.profitPct}%)
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        {opp.listings.map((l: any, j: number) => (
                          <a key={j} href={l.url} target="_blank" rel="noopener noreferrer" className={cn(
                            'flex items-center justify-between gap-1 p-1.5 rounded hover:bg-card/50 transition-colors',
                            l.price === opp.cheapestPrice && 'bg-primary/5 border border-primary/20'
                          )}>
                            <span className="text-muted-foreground truncate">{l.source}</span>
                            <span className={cn('font-mono', l.price === opp.cheapestPrice ? 'text-primary font-bold' : 'text-amber-400')}>
                              {l.price}€ <ExternalLink className="w-2.5 h-2.5 inline" />
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* v5.2: Cross-Portal Arbitrage — isti izdelki na različnih portalih */}
          <Card className="bg-card/50 lg:col-span-2 border-primary/30">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                    <GitCompare className="w-4 h-4 text-primary" />
                    Cross-Portal Arbitraža
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.2</Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Isti izdelki na različnih portalih (Bolha ↔ Avtonet ↔ Vinted) z različnimi cenami.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Min razlika:</span>
                  <select
                    value={crossPortalThreshold}
                    onChange={(e) => setCrossPortalThreshold(parseInt(e.target.value, 10))}
                    className="bg-card border border-border rounded px-2 py-1 text-xs"
                  >
                    <option value={10}>10%</option>
                    <option value={20}>20%</option>
                    <option value={30}>30%</option>
                    <option value={50}>50%</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => loadCrossPortal(crossPortalThreshold)}
                    disabled={crossPortalLoading}
                  >
                    {crossPortalLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {crossPortalLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
                  Analyzing cross-portal opportunities...
                </div>
              ) : !crossPortal || crossPortal.opportunities?.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {crossPortal?.stats?.totalListingsAnalyzed != null && (
                    <p className="mb-2">Analiziranih {crossPortal.stats.totalListingsAnalyzed} oglasov iz {crossPortal.stats.groupsFound} grup.</p>
                  )}
                  <p>Ni cross-portal priložnosti s to minimalno razliko. Poskusi znižati threshold.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Stats bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Priložnosti</div>
                      <div className="font-mono font-bold text-primary">{crossPortal.stats.opportunitiesFound}</div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Povp. razlika</div>
                      <div className="font-mono font-bold">{crossPortal.stats.avgPriceDiffPct}%</div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Skupni profit</div>
                      <div className="font-mono font-bold text-primary">{crossPortal.stats.totalPotentialProfit}€</div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Analizirano</div>
                      <div className="font-mono">{crossPortal.stats.totalListingsAnalyzed}</div>
                    </div>
                  </div>

                  {/* Source pairs */}
                  {Object.keys(crossPortal.stats.bySourcePair).length > 0 && (
                    <div className="bg-background/30 rounded p-2 text-[11px]">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Par portalov</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {Object.entries(crossPortal.stats.bySourcePair).map(([pair, count]: any) => (
                          <Badge key={pair} variant="outline" className="text-[10px]">
                            {pair}: {count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Opportunities list */}
                  <div className="space-y-2">
                    {crossPortal.opportunities.slice(0, 15).map((opp: any, i: number) => (
                      <div key={i} className="p-2 bg-background/30 rounded border border-border">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-xs font-medium truncate flex-1" title={opp.title}>{opp.title}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {opp.sourceCount} portalov
                            </Badge>
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                              💰 +{opp.profit}€ ({opp.priceDiffPct}%)
                            </Badge>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                          {opp.sources.map((s: any, j: number) => (
                            <a
                              key={j}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                'flex items-center justify-between gap-1 p-1.5 rounded hover:bg-card/50 transition-colors',
                                s.price === opp.cheapestPrice && 'bg-primary/5 border border-primary/20'
                              )}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {s.imageUrl && (
                                  <img
                                    src={s.imageUrl}
                                    alt=""
                                    className="w-6 h-6 object-cover rounded shrink-0"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                )}
                                <div className="min-w-0">
                                  <div className="text-muted-foreground truncate">{s.source}</div>
                                  <div className="text-[9px] text-muted-foreground truncate">{s.monitorName}</div>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className={cn('font-mono', s.price === opp.cheapestPrice ? 'text-primary font-bold' : 'text-amber-400')}>
                                  {s.price}€
                                </div>
                                {s.dealScore != null && (
                                  <div className="text-[9px] text-primary">🎯 {s.dealScore}</div>
                                )}
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] text-muted-foreground text-center pt-1">
                    💡 Kupi najcenejši, prodaj drago. Pazi na stroške dostave in provizije.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* v6.0: AI Trend Predictions */}
          <Card className="bg-card/50 lg:col-span-2 border-primary/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    AI Tržne napovedi
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.0</Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    AI napove tržne trende po kategorijah (naslednjih 30 dni).
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={loadTrendPredictions} disabled={trendLoading} className="gap-2 h-7 text-xs">
                  {trendLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Napovej trende
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {trendLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
                  AI analizira tržne trende...
                </div>
              ) : !trendPreds || trendPreds.predictions?.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {trendPreds?.message || 'Klikni "Napovej trende" za AI analizo tržnih trendov.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {trendPreds.predictions.map((p: any, i: number) => {
                    const trendCfg: Record<string, { icon: string; color: string; label: string }> = {
                      rising: { icon: '📈', color: 'text-red-500', label: 'Raste' },
                      stable: { icon: '➡️', color: 'text-amber-400', label: 'Stabilno' },
                      declining: { icon: '📉', color: 'text-primary', label: 'Pada' },
                    };
                    const cfg = trendCfg[p.trend] || trendCfg.stable;
                    const recCfg: Record<string, string> = {
                      'kupi zdaj': 'text-primary',
                      'čakaj': 'text-amber-400',
                      'prodaj': 'text-red-500',
                    };
                    return (
                      <div key={i} className="flex items-start gap-2 p-2 bg-background/30 rounded text-xs">
                        <Badge variant="outline" className="text-[9px] shrink-0">{p.category}</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn('font-bold', cfg.color)}>{cfg.icon} {cfg.label}</span>
                            <span className={cn('font-mono', p.predictedPriceChange < 0 ? 'text-primary' : p.predictedPriceChange > 0 ? 'text-red-500' : 'text-muted-foreground')}>
                              {p.predictedPriceChange > 0 ? '+' : ''}{p.predictedPriceChange}%
                            </span>
                            <Badge variant="outline" className={cn('text-[9px]', p.confidence >= 70 ? 'text-primary border-primary/40' : 'text-muted-foreground')}>
                              🎯 {p.confidence}%
                            </Badge>
                            <span className="text-[9px] text-muted-foreground">{p.dataPoints} oglasov</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5 italic">{p.reasoning}</p>
                          {p.recommendation && (
                            <p className={cn('text-[10px] mt-0.5 font-bold', recCfg[p.recommendation.toLowerCase()] || 'text-muted-foreground')}>
                              → {p.recommendation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* v6.4: Competitor Seller Tracking */}
          <Card className="bg-card/50 lg:col-span-2 border-primary/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    Konkurenčni prodajalci
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.4</Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Spremljaj druge prodajalce v tvoji niši — kdo spušča cene, kdo je aktiven.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={loadCompetitors} disabled={compLoading} className="gap-2 h-7 text-xs">
                  {compLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                  Skeniraj
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {compLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
                  Analyzing competitors...
                </div>
              ) : !competitors || competitors.competitors?.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  Ni konkurentov s 2+ oglasi. Skeniraj z gumbom zgoraj.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Skupno prodajalcev</div>
                      <div className="font-mono font-bold">{competitors.totalSellers}</div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Aktivni (7d)</div>
                      <div className="font-mono font-bold text-primary">{competitors.activeCompetitors}</div>
                    </div>
                    <div className="bg-background/30 rounded p-2 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Visoka grožnja</div>
                      <div className="font-mono font-bold text-red-500">{competitors.highThreatCount}</div>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {competitors.competitors.slice(0, 15).map((c: any, i: number) => (
                      <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded text-xs border',
                        c.threatLevel === 'high' ? 'bg-red-500/5 border-red-500/20' :
                        c.threatLevel === 'medium' ? 'bg-amber-400/5 border-amber-400/20' :
                        'bg-background/30 border-border')}>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0',
                          c.threatLevel === 'high' ? 'text-red-500 border-red-500/40' :
                          c.threatLevel === 'medium' ? 'text-amber-400 border-amber-400/40' : 'text-muted-foreground')}>
                          {c.threatLevel === 'high' ? '🔴' : c.threatLevel === 'medium' ? '🟡' : '🟢'} {c.threatLevel}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.sellerName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {c.listingCount} oglasov • povp {c.avgPrice}€ • {c.sources.join(', ')}
                            {c.priceDrops > 0 && <span className="text-amber-400"> • {c.priceDrops}× padec cene</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0 text-[10px]">
                          {c.recentActivity === 'active' && <Badge variant="outline" className="text-[8px] text-primary border-primary/40">⚡ AKTIVEN</Badge>}
                          <div className="text-muted-foreground">{c.daysActive}d aktiven</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Monitor performance table */}
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Performansa monitorjev (zadnjih 30 dni)
              </CardTitle>
              <CardDescription>Identificiraj monitorje, ki so neučinkoviti ali proizvajajo slabe alerte.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border text-left">
                      <th className="py-2 pr-2 font-medium uppercase tracking-wider">Monitor</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Oglasi</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Alerti</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">🎯 Prilik</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Uspeh</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Avg čas</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">👍 Zanima</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">🚫 Prevara</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Precision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monitorPerformance.map(m => (
                      <tr key={m.id} className="border-b border-border/50 hover:bg-background/30">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-1.5 h-1.5 rounded-full', m.isActive ? 'bg-primary' : 'bg-muted-foreground')} />
                            <span className="font-medium truncate max-w-[180px]">{m.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{m.totalListings}</td>
                        <td className="py-2 px-2 text-right font-mono">{m.totalAlerts}</td>
                        <td className="py-2 px-2 text-right font-mono text-primary">{m.prilika}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          <span className={m.successRate >= 0.9 ? 'text-primary' : m.successRate >= 0.7 ? 'text-amber-400' : 'text-destructive'}>
                            {(m.successRate * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                          {m.avgDurationMs > 0 ? `${(m.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-primary">{m.userInterested}</td>
                        <td className="py-2 px-2 text-right font-mono text-amber-400">{m.userScam}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          {m.precision != null ? (
                            <span className={m.precision >= 0.7 ? 'text-primary' : m.precision >= 0.4 ? 'text-amber-400' : 'text-destructive'}>
                              {(m.precision * 100).toFixed(0)}%
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function AccuracyCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'primary' | 'amber' | 'muted' }) {
  return (
    <div className="bg-background/30 rounded p-3 border border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className={cn(color === 'primary' ? 'text-primary' : color === 'amber' ? 'text-amber-400' : 'text-muted-foreground')}>
          {icon}
        </span>
      </div>
      <div className={cn('text-2xl font-bold font-mono', color === 'primary' ? 'text-primary' : color === 'amber' ? 'text-amber-400' : 'text-foreground')}>
        {value}
      </div>
    </div>
  );
}
