'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, Bell, AlertTriangle, Target, TrendingUp, Play, RefreshCw, Clock, Zap, LayoutGrid, BarChart3, Bookmark, ShoppingCart, TrendingDown, ExternalLink, Check, Sparkles, ArrowUp, ArrowDown, Settings2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// v8.45: Haptic feedback for mobile touch interactions
import { useHaptic } from '@/hooks/use-haptic';
import { AiInsightsWidget } from '@/components/dashboard/ai-insights-widget';
import { DealFlowWidget } from '@/components/dashboard/deal-flow-widget';
import { DealFunnelWidget } from '@/components/dashboard/deal-funnel-widget';
import { NicheScoreWidget } from '@/components/dashboard/niche-score-widget';
import { FlipStatusWidget } from '@/components/dashboard/flip-status-widget';
import { DealVelocityWidget } from '@/components/dashboard/deal-velocity-widget';
// v8.36: Trade Management Enhancement — Quick Add modal + Trade Stats card
import { TradeStatsCard } from '@/components/dashboard/trade-stats-card';
import { QuickAddTradeModal } from '@/components/dashboard/quick-add-trade-modal';
// v8.37: Deal Calculator + Profit Timeline Chart — Polish phase continues
import { DealCalculatorWidget } from '@/components/dashboard/deal-calculator-widget';
import { ProfitTimelineChart } from '@/components/dashboard/profit-timeline-chart';
// v8.39: Goal Tracker Dashboard Widget — visual progress bar + milestones + edit mode
import { GoalTrackerCard } from '@/components/dashboard/goal-tracker-card';
// v8.40: Trade Insights Deep Dive — day-of-week + source + category + hold + distribution
import { TradeInsightsCard } from '@/components/dashboard/trade-insights-card';
// v8.41: Weekly Summary Report — comprehensive weekly digest (profit, goal, top trades, Brain health, insights, recommendations) sent to Telegram + Email
import { WeeklySummaryCard } from '@/components/dashboard/weekly-summary-card';
// v8.43: Annual Summary + Tax Report PDF — yearly profit/loss breakdown + davčno poročilo PDF
import { AnnualSummaryCard } from '@/components/dashboard/annual-summary-card';
// v8.44: Smart Restock Recommendations — "KAJ naj kupim naslednje?" kombinira
// v8.40 Trade Insights z current inventory za actionable "buy next" priporočila.
import { RestockRecommendationsCard } from '@/components/dashboard/restock-recommendations-card';
import { ProfitForecastCard } from '@/components/dashboard/profit-forecast-card';
import { MonthOverMonthCard } from '@/components/dashboard/month-over-month-card';
import { TagPerformanceCard } from '@/components/dashboard/tag-performance-card';
import { OutcomeSummaryCard } from '@/components/dashboard/outcome-summary-card';
import { BuyOpportunitySummaryCard } from '@/components/dashboard/buy-opportunity-summary-card';
import { DecisionAccuracyCard } from '@/components/dashboard/decision-accuracy-card';

// v5.6: Dashboard widget IDs
const WIDGET_IDS = ['todaySummary', 'quickStats', 'activityFeed', 'aiInsights', 'skladisceWidget'] as const;
type WidgetId = typeof WIDGET_IDS[number];

interface Stats {
  totalMonitors: number;
  activeMonitors: number;
  totalListings: number;
  totalAlerts: number;
  unreadAlerts: number;
  prilikaAlerts: number;
  sumnjivoAlerts: number;
  bookmarkedListings: number;
  contactedListings: number;
  priceDropCount: number;
  newListings24h: number;
  newAlerts24h: number;
  today: {
    newListings: number;
    newAlerts: number;
    priceDrops: number;
    runs: number;
    successfulRuns: number;
  };
  recentRuns: Array<{
    id: string;
    status: string;
    listingsFound: number;
    newListings: number;
    alertsSent: number;
    durationMs: number | null;
    error: string | null;
    startedAt: string;
    monitor: { name: string };
  }>;
}

interface ViewProps {
  onNavigate: (v: 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'trades' | 'analytics' | 'health' | 'notifications' | 'settings') => void;
}

export function DashboardView({ onNavigate }: ViewProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  // v4.5: AI Summary
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryHours, setSummaryHours] = useState(24);
  // v5.6: Dashboard customization
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>([...WIDGET_IDS]);
  const [customizeMode, setCustomizeMode] = useState(false);
  // v8.39: Goal tracker state moved into <GoalTrackerCard /> component (self-fetches).
  // v8.36: Quick Add Trade modal (floating button)
  const [showQuickAddTrade, setShowQuickAddTrade] = useState(false);
  // v8.45: Haptic feedback instance for mobile touch interactions
  const haptic = useHaptic();

  // Load dashboard layout from settings
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.dashboardLayout) {
          try {
            const layout = JSON.parse(data.dashboardLayout);
            if (Array.isArray(layout) && layout.length > 0) {
              const merged = [...layout.filter((w: string) => WIDGET_IDS.includes(w as WidgetId)) as WidgetId[]];
              for (const w of WIDGET_IDS) {
                if (!merged.includes(w)) merged.push(w);
              }
              setWidgetOrder(merged);
            }
          } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, []);

  const saveLayout = useCallback(async (newOrder: WidgetId[]) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboardLayout: JSON.stringify(newOrder) }),
      });
    } catch { /* ignore */ }
  }, []);

  const moveWidget = (id: WidgetId, direction: 'up' | 'down') => {
    setWidgetOrder(prev => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      saveLayout(next);
      return next;
    });
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      setStats(data);
    } catch (e) {
      toast.error('Ne morem naložiti statistik');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const runAll = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/cron/run-all', { method: 'POST' });
      if (!res.ok) throw new Error('napaka');
      const data = await res.json();
      toast.success(`Pognan ${data.ran} monitorjev. Preveri alerte.`);
      await load();
    } catch (e) {
      toast.error('Napaka pri poganjanju');
    } finally {
      setRunning(false);
    }
  };

  // v4.5: Generate AI summary
  const generateSummary = async () => {
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryData(null);
    try {
      const res = await fetch('/api/digest/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: summaryHours, limit: 20 }),
      });
      const data = await res.json();
      if (data.ok) {
        setSummaryData(data);
        toast.success(`Povzetek generiran (${data.stats.opportunitiesFound} priložnosti)`);
      } else {
        toast.error(data.error ?? 'Napaka pri generiranju povzetka');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setSummaryLoading(false);
    }
  };

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-card/50">
            <CardContent className="p-6">
              <div className="h-16 animate-pulse bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick action bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Pregled sistema
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Stanje monitorjev, zadnje aktivnosti in alerti.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stats.unreadAlerts > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const res = await fetch('/api/alerts?archived=0&limit=100');
                  const alerts = await res.json();
                  const unread = alerts.filter((a: any) => !a.isRead);
                  if (unread.length === 0) return;
                  await Promise.all(unread.map((a: any) =>
                    fetch('/api/alerts', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: a.id, isRead: true }),
                    })
                  ));
                  toast.success(`${unread.length} alertov označenih kot prebrani`);
                  await load();
                } catch { toast.error('Napaka'); }
              }}
              className="gap-2"
            >
              <Check className="w-3.5 h-3.5" /> Preberi vse ({stats.unreadAlerts})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Osveži
          </Button>
          <Button size="sm" onClick={runAll} disabled={running} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 min-h-[44px] sm:min-h-0">
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Poženi vse monitorje
          </Button>
          {/* v4.5: AI Summary button */}
          <Button
            size="sm"
            variant="outline"
            onClick={generateSummary}
            disabled={summaryLoading}
            className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
            title="AI POVzetek zadnjih priložnosti"
          >
            {summaryLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI POVzetek
          </Button>
          {/* v5.6: Customize dashboard layout */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCustomizeMode(!customizeMode)}
            className={cn('gap-2', customizeMode && 'border-primary text-primary')}
            title="Preuredi vrstni red widgetov"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {customizeMode ? 'Končaj' : 'Uredi'}
          </Button>
          {/* v8.36: Floating Quick Add Trade button */}
          <Button
            size="sm"
            onClick={() => { haptic.medium(); setShowQuickAddTrade(true); }}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 min-h-[44px] sm:min-h-0"
            title="Hitri dodaj trade"
          >
            <Plus className="w-3.5 h-3.5" />
            Dodaj trade
          </Button>
        </div>
      </div>

      {/* v4.0: Danes summary card */}
      {stats.today && (
        <Card className="bg-card/50 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Danes
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {new Date().toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Novi oglasi</div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-primary">{stats.today.newListings}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Novi alerti</div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-amber-400">{stats.today.newAlerts}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Padci cen</div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-primary">{stats.today.priceDrops}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Izvedbe</div>
                <div className="text-2xl sm:text-3xl font-bold font-mono">{stats.today.runs}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase">Uspeh</div>
                <div className={cn(
                  'text-2xl sm:text-3xl font-bold font-mono',
                  stats.today.runs > 0 && (stats.today.successfulRuns / stats.today.runs) >= 0.9 ? 'text-primary' :
                  stats.today.runs > 0 && (stats.today.successfulRuns / stats.today.runs) >= 0.7 ? 'text-amber-400' : 'text-destructive'
                )}>
                  {stats.today.runs > 0 ? Math.round((stats.today.successfulRuns / stats.today.runs) * 100) : 0}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v3.7: Quick filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { haptic.light(); onNavigate('alerts'); }}
          className="px-3 py-2.5 sm:py-1 rounded-full min-h-[40px] sm:min-h-0 border border-primary/30 bg-primary/5 text-primary text-xs hover:bg-primary/10 transition-colors"
        >
          🎯 Priložnosti ({stats.prilikaAlerts})
        </button>
        <button
          onClick={() => { haptic.light(); onNavigate('listings'); }}
          className="px-3 py-2.5 sm:py-1 rounded-full min-h-[40px] sm:min-h-0 border border-amber-400/30 bg-amber-400/5 text-amber-400 text-xs hover:bg-amber-400/10 transition-colors"
        >
          ⚠️ Sumljivi ({stats.sumnjivoAlerts})
        </button>
        <button
          onClick={() => { haptic.light(); onNavigate('listings'); }}
          className="px-3 py-2.5 sm:py-1 rounded-full min-h-[40px] sm:min-h-0 border border-border bg-card/50 text-muted-foreground text-xs hover:border-primary/30 hover:text-primary transition-colors"
        >
          📉 Padci cen ({stats.priceDropCount || 0})
        </button>
        <button
          onClick={() => { haptic.light(); onNavigate('listings'); }}
          className="px-3 py-2.5 sm:py-1 rounded-full min-h-[40px] sm:min-h-0 border border-border bg-card/50 text-muted-foreground text-xs hover:border-primary/30 hover:text-primary transition-colors"
        >
          📞 Kontaktirani ({stats.contactedListings || 0})
        </button>
        <button
          onClick={() => { haptic.light(); onNavigate('listings'); }}
          className="px-3 py-2.5 sm:py-1 rounded-full min-h-[40px] sm:min-h-0 border border-border bg-card/50 text-muted-foreground text-xs hover:border-primary/30 hover:text-primary transition-colors"
        >
          ⭐ Priljubljeni ({stats.bookmarkedListings})
        </button>
        <button
          onClick={() => { haptic.light(); onNavigate('trades'); }}
          className="px-3 py-2.5 sm:py-1 rounded-full min-h-[40px] sm:min-h-0 border border-primary/30 bg-primary/5 text-primary text-xs hover:bg-primary/10 transition-colors"
        >
          🛒 Skladišče
        </button>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Aktivni monitorji"
          value={stats.activeMonitors}
          total={stats.totalMonitors}
          color="primary"
          onClick={() => onNavigate('monitors')}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Oglasov v bazi"
          value={stats.totalListings}
          subtext={`${stats.newListings24h} novih v 24h`}
          color="primary"
        />
        <StatCard
          icon={<Bell className="w-4 h-4" />}
          label="Nebrani alerti"
          value={stats.unreadAlerts}
          total={stats.totalAlerts}
          subtext={`${stats.newAlerts24h} novih v 24h`}
          color="amber"
          onClick={() => onNavigate('alerts')}
        />
        <StatCard
          icon={<Target className="w-4 h-4" />}
          label="Priložnosti"
          value={stats.prilikaAlerts}
          subtext={`${stats.sumnjivoAlerts} sumljivih`}
          color="primary"
          onClick={() => onNavigate('alerts')}
        />
        <StatCard
          icon={<Bookmark className="w-4 h-4" />}
          label="Priljubljeni"
          value={stats.bookmarkedListings}
          subtext="shranjeni"
          color="amber"
          onClick={() => onNavigate('listings')}
        />
      </div>

      {/* v3.1: Quick action stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('listings')}
        >
          <CardContent className="p-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs font-bold text-primary">{stats.priceDropCount || 0}</p>
              <p className="text-[10px] text-muted-foreground">Padci cen</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('listings')}
        >
          <CardContent className="p-3 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-amber-400" />
            <div>
              <p className="text-xs font-bold text-amber-400">{stats.contactedListings || 0}</p>
              <p className="text-[10px] text-muted-foreground">Kontaktirani</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('trades')}
        >
          <CardContent className="p-3 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" />
            <div>
              <p className="text-xs font-bold text-primary">Skladišče</p>
              <p className="text-[10px] text-muted-foreground">Profit tracker</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick links row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('listings')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <LayoutGrid className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-bold">Pregled vseh oglasov</p>
              <p className="text-[11px] text-muted-foreground">Validiraj AI — vidi tudi NEZANIMIVO</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
          onClick={() => onNavigate('analytics')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-bold">Analitika sistema</p>
              <p className="text-[11px] text-muted-foreground">Trendi, performansa monitorjev, natančnost AI</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent runs */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Zadnje izvedbe
          </CardTitle>
          <CardDescription>Zadnjih 10 poganjanj monitorjev.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentRuns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Zap className="w-6 h-6 mx-auto mb-2 opacity-50" />
              Še ni bilo izvedb. Dodaj monitor in ga poženi.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {stats.recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 sm:py-2 min-h-[48px] sm:min-h-0 rounded bg-background/50 border border-border hover:border-primary/30 transition-colors text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <StatusDot status={run.status} />
                    <span className="font-medium truncate">{run.monitor.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span>{run.newListings}/{run.listingsFound} novih</span>
                    {run.alertsSent > 0 && (
                      <Badge className="bg-primary/20 text-primary border-primary/40 text-[10px]">
                        +{run.alertsSent} alertov
                      </Badge>
                    )}
                    <span className="font-mono">{formatDuration(run.durationMs)}</span>
                    <span>{formatTimeAgo(run.startedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* v5.6: Customize mode info */}
      {customizeMode && (
        <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs text-primary text-center">
          🔧 Customize mode — uporabi ↑↓ gumbe za preureditev widgetov. Spremembe se samodejno shranijo.
        </div>
      )}

      {/* v8.39: Goal Tracker Dashboard Card — replaces v6.7 inline card.
          Self-fetches from /api/trades/goal-tracker every 60s. Handles both
          states: disabled (input prompt) and enabled (progress + milestones). */}
      <GoalTrackerCard />

      {/* v2.7: Activity feed */}
      <WidgetWrapper id="activityFeed" order={widgetOrder} customizeMode={customizeMode} onMove={moveWidget}>
        <ActivityFeed />
      </WidgetWrapper>

      {/* v5.3: AI Insights widget */}
      <WidgetWrapper id="aiInsights" order={widgetOrder} customizeMode={customizeMode} onMove={moveWidget}>
        <AiInsightsWidget />
        <DealFlowWidget onNavigate={onNavigate} />
        <DealFunnelWidget />
        <NicheScoreWidget onNavigate={onNavigate} />
        <FlipStatusWidget onNavigate={onNavigate} />
        <DealVelocityWidget />
      </WidgetWrapper>

      {/* v8.36: Trade Stats card — profit + win rate + best niche + Quick Add */}
      <TradeStatsCard />

      {/* v8.37: Deal Calculator + Profit Timeline — hitra ROI kalkulacija + profit trend */}
      <DealCalculatorWidget />
      <ProfitTimelineChart />

      {/* v8.40: Trade Insights Deep Dive — "KDaj in KJE prodati za maksimalen profit?"
          6 analytics: day-of-week, source platform, category, hold period, profit
          distribution, actionable insights. Self-fetches from
          /api/analytics/trade-insights every 60s. */}
      <TradeInsightsCard />

      {/* v8.41: Weekly Summary Report — comprehensive weekly digest (profit, MoM,
          goal progress, top 3 trades, worst trade, Brain health, top 3 insights
          from v8.40, recommendations for next week). Sent to Telegram + Email +
          Notification Center. Self-fetches from /api/ai/brain/weekly-summary
          every 60s. "Pošlji zdaj" button sends manually. */}
      <WeeklySummaryCard />

      {/* v8.43: Annual Summary + Tax Report PDF — yearly profit/loss breakdown for
          tax/FURS/accountant. Self-fetches from /api/trades/annual-summary?year=YYYY
          every 60s. Year selector (currentYear-1 to currentYear+1). Big profit
          number + tax estimate (22% Slovenian flat tax) + net after tax + quarterly
          BarChart + best/worst month + win rate + avg ROI + top trade + "Prenesi PDF"
          button (opens /api/trades/tax-report-pdf?year=YYYY) + "Celoten pregled"
          (navigate to Statistics view). */}
      <AnnualSummaryCard onNavigate={onNavigate} />

      {/* v8.44: Smart Restock Recommendations — "KAJ naj kupim naslednje za
          maksimalen profit?" Kombinira v8.40 Trade Insights (historical
          performance per category) z current held inventory za actionable
          "buy next" priporočila. Top 5 RESTOCK cards z projected profit/ROI/
          hold time/suggested buy price range/best source/confidence. Category
          status table (RESTOCK/MAINTAIN/REDUCE/AVOID). Inventory gaps +
          overstock warnings. Self-fetches from /api/ai/restock-smart every 60s. */}
      <RestockRecommendationsCard />
      <ProfitForecastCard />
      <MonthOverMonthCard />
      <TagPerformanceCard />
      <OutcomeSummaryCard />
      <BuyOpportunitySummaryCard />
      <DecisionAccuracyCard />

      {/* v4.5: Skladišče dashboard widget */}
      <WidgetWrapper id="skladisceWidget" order={widgetOrder} customizeMode={customizeMode} onMove={moveWidget}>
        <SkladisceWidget onNavigate={onNavigate} />
      </WidgetWrapper>

      {/* Quick start hint */}
      {stats.totalMonitors === 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-bold text-sm mb-1">Začenjamo</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Začni tako, da dodaš prvi monitor (npr. iskanje na Bolhi ali Nepremičninah),
                  nato v <span className="text-primary">Nastavitve</span> vnesi AI provider
                  (Ollama na localhostu ali API ključ za OpenAI/Anthropic).
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onNavigate('monitors')} className="gap-2">
                    Dodaj monitor
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onNavigate('settings')} className="gap-2">
                    Konfiguriraj AI
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v4.5: AI Summary Modal */}
      {summaryOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !summaryLoading && setSummaryOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary terminal-glow uppercase flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                AI POVzetek
              </h2>
              <button
                onClick={() => !summaryLoading && setSummaryOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xl disabled:opacity-50"
                disabled={summaryLoading}
              >×</button>
            </div>

            {/* Hours selector */}
            <div className="flex items-center gap-2 mb-4 text-xs">
              <span className="text-muted-foreground">Obdobje:</span>
              {[
                { v: 6, l: '6h' },
                { v: 24, l: '24h' },
                { v: 72, l: '3 dni' },
                { v: 168, l: '7 dni' },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setSummaryHours(opt.v)}
                  className={cn(
                    'px-2 py-0.5 rounded border text-xs transition-colors',
                    summaryHours === opt.v
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.l}
                </button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs gap-1"
                onClick={generateSummary}
                disabled={summaryLoading}
              >
                {summaryLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Osveži
              </Button>
            </div>

            {summaryLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <RefreshCw className="w-5 h-5 mx-auto mb-3 animate-spin opacity-50" />
                AI analizira oglase in generira povzetek...
              </div>
            ) : summaryData ? (
              <div className="space-y-4">
                {/* Stats bar */}
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Najdeno</div>
                    <div className="font-mono font-bold text-primary">{summaryData.stats.opportunitiesFound}</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Novi</div>
                    <div className="font-mono">{summaryData.stats.totalNewListings}</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Alertov</div>
                    <div className="font-mono">{summaryData.stats.totalAlerts}</div>
                  </div>
                  <div className="bg-background/30 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Shranjeni</div>
                    <div className="font-mono">{summaryData.stats.totalBookmarked}</div>
                  </div>
                </div>

                {/* Summary text */}
                <div className="bg-background/30 rounded p-3 text-sm whitespace-pre-wrap leading-relaxed">
                  {summaryData.summary}
                </div>

                {/* Top pick */}
                {summaryData.topPick && (
                  <div className="bg-primary/5 border border-primary/20 rounded p-3">
                    <div className="text-[10px] uppercase tracking-wider text-primary mb-1">🏆 TOP izbor</div>
                    <div className="text-sm font-medium">{summaryData.topPick}</div>
                  </div>
                )}

                {/* Recommendation */}
                {summaryData.recommendation && (
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded p-3">
                    <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">💡 Priporočilo</div>
                    <div className="text-sm">{summaryData.recommendation}</div>
                  </div>
                )}

                {/* Listings list */}
                {summaryData.listings && summaryData.listings.length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                      Oglasi v povzetku ({summaryData.listings.length})
                    </h4>
                    <div className="space-y-1">
                      {summaryData.listings.map((l: any) => (
                        <a
                          key={l.id}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-2 bg-background/30 rounded hover:bg-background/50 transition-colors text-xs"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{l.title}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {l.priceText} • {l.monitor?.name}
                            </div>
                          </div>
                          {l.dealScore != null && (
                            <Badge variant="outline" className="text-[10px] text-primary border-primary/40 shrink-0">
                              🎯 {l.dealScore}
                            </Badge>
                          )}
                          <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground text-center pt-2">
                  Generirano: {new Date(summaryData.generatedAt).toLocaleString('sl-SI')}
                </p>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Klikni "Osveži" za generiranje povzetka.
              </div>
            )}
          </div>
        </div>
      )}

      {/* v8.36: Quick Add Trade modal — floating button trigger */}
      <QuickAddTradeModal
        open={showQuickAddTrade}
        onOpenChange={setShowQuickAddTrade}
        onSaved={() => {
          toast.success('Trade dodan');
          // Reload stats after add (cheap refetch)
          load();
        }}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  total,
  subtext,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total?: number;
  subtext?: string;
  color: 'primary' | 'amber';
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        'bg-card/50 hover:bg-card transition-colors',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={cn(color === 'primary' ? 'text-primary' : 'text-amber-400')}>
            {icon}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'text-2xl sm:text-3xl font-bold',
            color === 'primary' ? 'text-primary terminal-glow' : 'text-amber-400 amber-glow'
          )}>
            {value}
          </span>
          {total != null && (
            <span className="text-sm text-muted-foreground">/ {total}</span>
          )}
        </div>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ok' ? 'bg-primary' :
    status === 'error' ? 'bg-destructive' :
    'bg-muted-foreground';
  return <span className={cn('w-2 h-2 rounded-full shrink-0', color)} />;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `pred ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `pred ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `pred ${h}h`;
  return d.toLocaleDateString('sl-SI');
}

// v2.7: Activity feed component
function ActivityFeed() {
  const [feed, setFeed] = useState<Array<{
    type: string;
    timestamp: string;
    title: string;
    subtitle: string;
    url?: string;
    badge?: string;
    badgeColor?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/activity');
        if (res.ok) {
          const data = await res.json();
          setFeed(data.feed || []);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const typeIcons: Record<string, React.ReactNode> = {
    alert: <Bell className="w-3.5 h-3.5" />,
    trade_buy: <ShoppingCart className="w-3.5 h-3.5" />,
    trade_sell: <TrendingUp className="w-3.5 h-3.5" />,
    price_drop: <TrendingDown className="w-3.5 h-3.5" />,
  };

  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Aktivnost (zadnjih 7 dni)
        </CardTitle>
        <CardDescription>Zadnji alerti, kupljene/prodane oglase, padci cen.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
          </div>
        ) : feed.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            <Activity className="w-6 h-6 mx-auto mb-2 opacity-50" />
            Ni recentne aktivnosti.
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {feed.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded hover:bg-card/50 transition-colors">
                <span className="text-muted-foreground mt-0.5 shrink-0">
                  {typeIcons[item.type] || <Activity className="w-3.5 h-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{item.title}</span>
                    {item.badge && (
                      <Badge variant="outline" className={cn('text-[9px] shrink-0', item.badgeColor)}>
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {item.subtitle} • {new Date(item.timestamp).toLocaleString('sl-SI', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary/50 hover:text-primary shrink-0">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// v4.5: Skladišče dashboard widget — mini overview of trades + P&L
function SkladisceWidget({ onNavigate }: { onNavigate: (v: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trades/dashboard');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardContent className="p-4">
          <div className="h-24 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalTrades === 0) {
    return null; // Don't show widget if no trades yet
  }

  const hasMonthlyData = data.monthlyPnl?.some((m: any) => m.count > 0);

  return (
    <Card className="bg-card/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Skladišče
          </h3>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={() => onNavigate('trades')}
          >
            Vsi <ExternalLink className="w-3 h-3" />
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div className="bg-background/30 rounded p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Skupni dobiček</div>
            <div className={cn('text-lg font-bold font-mono', data.totalRealizedProfit >= 0 ? 'text-primary' : 'text-red-500')}>
              {data.totalRealizedProfit >= 0 ? '+' : ''}{data.totalRealizedProfit.toFixed(0)}€
            </div>
          </div>
          <div className="bg-background/30 rounded p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">V skladišču</div>
            <div className="text-lg font-bold font-mono text-amber-400">{data.heldCount}</div>
          </div>
          <div className="bg-background/30 rounded p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">Prodani</div>
            <div className="text-lg font-bold font-mono">{data.soldCount}</div>
          </div>
          <div className="bg-background/30 rounded p-2 text-center">
            <div className="text-[10px] text-muted-foreground uppercase">V investiciji</div>
            <div className="text-lg font-bold font-mono">{data.totalInvested.toFixed(0)}€</div>
          </div>
        </div>

        {/* This month vs last month */}
        <div className="flex items-center justify-between text-xs bg-background/30 rounded p-2 mb-3">
          <span className="text-muted-foreground">Mesec {new Date().toLocaleDateString('sl-SI', { month: 'long' })}:</span>
          <span className={cn('font-mono font-bold', data.thisMonthProfit >= 0 ? 'text-primary' : 'text-red-500')}>
            {data.thisMonthProfit >= 0 ? '+' : ''}{data.thisMonthProfit.toFixed(2)}€
          </span>
          {data.trend !== 0 && (
            <span className={cn('flex items-center gap-0.5 text-[10px]', data.trend > 0 ? 'text-primary' : 'text-red-500')}>
              {data.trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(data.trend).toFixed(0)}€ vs prejšnji mesec
            </span>
          )}
        </div>

        {/* Mini bar chart: monthly P&L */}
        {hasMonthlyData && (
          <div className="mb-3">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Dobiček po mesecih (zadnjih 12)
            </h4>
            <div className="flex items-end gap-1 h-20">
              {data.monthlyPnl.map((m: any, i: number) => {
                const maxAbs = Math.max(...data.monthlyPnl.map((x: any) => Math.abs(x.profit)), 1);
                const heightPct = Math.abs(m.profit) / maxAbs * 100;
                const isPositive = m.profit >= 0;
                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center gap-0.5 group relative"
                    title={`${m.label}: ${m.profit >= 0 ? '+' : ''}${m.profit.toFixed(2)}€ (${m.count} prodaj)`}
                  >
                    <div className="text-[8px] text-muted-foreground h-2">
                      {m.count > 0 ? m.count : ''}
                    </div>
                    <div className="w-full flex-1 flex flex-col justify-end relative">
                      {m.profit === 0 ? (
                        <div className="w-full h-px bg-border" />
                      ) : (
                        <div
                          className={cn('w-full rounded-sm transition-all', isPositive ? 'bg-primary/70' : 'bg-red-500/70')}
                          style={{ height: `${heightPct}%` }}
                        />
                      )}
                    </div>
                    <div className="text-[8px] text-muted-foreground">{m.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top 3 best trades */}
        {data.topTrades && data.topTrades.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Top 3 najbolj dobičkonosne prodaje
            </h4>
            <div className="space-y-1">
              {data.topTrades.slice(0, 3).map((t: any, i: number) => (
                <div key={t.id} className="flex items-center gap-2 p-1.5 bg-background/30 rounded text-xs">
                  <span className="text-[10px] font-mono text-muted-foreground">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{t.title}</div>
                    {t.category && <div className="text-[10px] text-muted-foreground">{t.category}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('font-mono font-bold', t.profit >= 0 ? 'text-primary' : 'text-red-500')}>
                      {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(0)}€
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t.roi >= 0 ? '+' : ''}{t.roi.toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// v5.6: WidgetWrapper — zavije widget z up/down gumbi v customize mode
function WidgetWrapper({ id, order, customizeMode, onMove, children }: {
  id: WidgetId;
  order: WidgetId[];
  customizeMode: boolean;
  onMove: (id: WidgetId, dir: 'up' | 'down') => void;
  children: React.ReactNode;
}) {
  const idx = order.indexOf(id);
  const isFirst = idx === 0;
  const isLast = idx === order.length - 1;

  if (!customizeMode) return <>{children}</>;

  return (
    <div className="relative border-2 border-dashed border-primary/30 rounded-lg p-1">
      <div className="absolute -top-3 left-2 flex items-center gap-1 bg-background px-2 z-10">
        <span className="text-[9px] text-primary font-mono uppercase">{id}</span>
        <button
          onClick={() => onMove(id, 'up')}
          disabled={isFirst}
          className="text-primary hover:bg-primary/10 p-0.5 rounded disabled:opacity-30"
        >
          <ArrowUp className="w-3 h-3" />
        </button>
        <button
          onClick={() => onMove(id, 'down')}
          disabled={isLast}
          className="text-primary hover:bg-primary/10 p-0.5 rounded disabled:opacity-30"
        >
          <ArrowDown className="w-3 h-3" />
        </button>
      </div>
      <div className="pt-2">{children}</div>
    </div>
  );
}
