'use client';

// v8.40: Trade Insights Deep Dive — comprehensive Dashboard card with 6
// collapsible sections + 4 recharts charts. Prikazuje "KDaj in KJE prodati
// za maksimalen profit?" analizo iz Trade tabele.
//
// Sections (accordion):
//   1. Actionable Insights (always visible, top) — Slovenian recommendations
//   2. Day-of-Week BarChart — avg profit per weekday (best=green, worst=red)
//   3. Source Platform table — Bolha/Vinted/Avtonet/mobile.de (ROI color-coded)
//   4. Category BarChart — profit per category + trend indicator
//   5. Hold Period BarChart — 5 buckets (optimal highlighted)
//   6. Profit Distribution PieChart — 6 buckets (small wins vs big wins)
//
// Fetches from: GET /api/analytics/trade-insights?days=365 (auto-refresh 60s)
// Empty state: "Ni dovolj prodaj za analizo. Dodaj vsaj 5 sold trades."

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  RefreshCw,
  BarChart3,
  Calendar,
  Store,
  Package,
  Clock,
  PieChart as PieChartIcon,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Cell,
  PieChart,
  Pie,
} from 'recharts';

// ─── Types (mirror src/lib/trades/trade-insights.ts) ────────────────────────

interface DayOfWeekInsight {
  dayOfWeek: number;
  dayName: string;
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
  sellThroughRate: number;
}

interface SourcePlatformInsight {
  source: string;
  tradeCount: number;
  totalInvested: number;
  totalRevenue: number;
  totalProfit: number;
  avgROI: number;
  avgHoldDays: number;
  winRate: number;
  bestCategory: string;
}

interface CategoryInsight {
  category: string;
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
  avgROI: number;
  avgHoldDays: number;
  winRate: number;
  trend: 'GROWING' | 'STABLE' | 'DECLINING';
}

interface HoldPeriodInsight {
  bucket: string;
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
  avgROI: number;
  winRate: number;
}

interface ProfitDistributionInsight {
  bucket: string;
  tradeCount: number;
  percentage: number;
}

interface TradeInsights {
  ok: true;
  summary: {
    totalTrades: number;
    soldTrades: number;
    heldTrades: number;
    cancelledTrades: number;
    totalProfit: number;
    totalInvested: number;
    avgProfitPerTrade: number;
    avgROI: number;
    avgHoldDays: number;
    overallWinRate: number;
    profitableCount: number;
  };
  bestDayOfWeek: DayOfWeekInsight | null;
  worstDayOfWeek: DayOfWeekInsight | null;
  dayOfWeekAnalysis: DayOfWeekInsight[];
  sourcePlatformAnalysis: SourcePlatformInsight[];
  bestSource: SourcePlatformInsight | null;
  categoryAnalysis: CategoryInsight[];
  bestCategory: CategoryInsight | null;
  holdPeriodAnalysis: HoldPeriodInsight[];
  optimalHoldDays: string | null;
  profitDistribution: ProfitDistributionInsight[];
  actionableInsights: string[];
  source: string;
}

// Day short labels (Slovenian) — for X-axis
const DAY_SHORT = ['Ned', 'Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob'];

// Trend config
const TREND_META: Record<
  CategoryInsight['trend'],
  { icon: typeof TrendingUp; color: string; label: string }
> = {
  GROWING: { icon: TrendingUp, color: 'text-primary', label: '↗ Raste' },
  STABLE: { icon: Minus, color: 'text-amber-400', label: '→ Stabilno' },
  DECLINING: { icon: TrendingDown, color: 'text-red-500', label: '↘ Pada' },
};

// Profit distribution bucket colors (loss=red, small=amber, big=green)
const DIST_COLORS: Record<string, string> = {
  '<-50€': '#dc2626',
  '-50-0€': '#f87171',
  '0-50€': '#fbbf24',
  '50-100€': '#84cc16',
  '100-200€': '#10b981',
  '200+€': '#059669',
};

/** ROI color: >20% green, 10-20% amber, <10% red (and negative = red). */
function roiColor(roi: number): string {
  if (roi < 0) return 'text-red-500';
  if (roi >= 20) return 'text-primary';
  if (roi >= 10) return 'text-amber-400';
  return 'text-red-500';
}

/** Format EUR with sign. */
function fmtEUR(n: number, sign = false): string {
  const s = n.toFixed(0);
  if (sign && n > 0) return `+${s}€`;
  return `${s}€`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TradeInsightsCard() {
  const [data, setData] = useState<TradeInsights | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analytics/trade-insights?days=365');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TradeInsights;
      if (!json.ok) throw new Error('Napaka v odgovoru');
      setData(json);
    } catch (e: any) {
      // Silent fail — Dashboard stats card is non-critical (toast would be too noisy on auto-refresh)
      console.warn('[TradeInsightsCard] load failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // v8.40: auto-refresh every 60s
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // ─── Loading state ───────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="h-32 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (!data || data.summary.soldTrades < 5) {
    return (
      <Card className="border-2 border-border/60 bg-card/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Trade Insights
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                v8.40
              </Badge>
            </h3>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={load}
              disabled={loading}
              title="Osveži"
            >
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            </Button>
          </div>
          <div className="py-8 text-center text-xs text-muted-foreground">
            <BarChart3 className="w-5 h-5 mx-auto mb-2 opacity-30" />
            Ni dovolj prodaj za analizo. Dodaj vsaj 5 sold trades
            {data ? ` (trenutno: ${data.summary.soldTrades}).` : '.'}
          </div>
        </CardContent>
      </Card>
    );
  }

  const summary = data.summary;

  // Reorder day-of-week analysis so Monday is first (more natural for chart)
  const dayOfWeekOrdered = [
    ...data.dayOfWeekAnalysis.slice(1), // Mon(1) - Sat(6)
    data.dayOfWeekAnalysis[0], // Sun(0) at end
  ];
  const dayChartData = dayOfWeekOrdered.map((d) => ({
    name: DAY_SHORT[d.dayOfWeek],
    avgProfit: d.avgProfit,
    tradeCount: d.tradeCount,
    isBest: data.bestDayOfWeek?.dayOfWeek === d.dayOfWeek,
    isWorst: data.worstDayOfWeek?.dayOfWeek === d.dayOfWeek,
  }));

  const sourceChartData = data.sourcePlatformAnalysis.map((s) => ({
    name: s.source,
    roi: s.avgROI,
    profit: s.totalProfit,
    tradeCount: s.tradeCount,
  }));

  const categoryChartData = data.categoryAnalysis.map((c) => ({
    name: c.category,
    avgROI: c.avgROI,
    avgProfit: c.avgProfit,
    tradeCount: c.tradeCount,
    trend: c.trend,
  }));

  const holdChartData = data.holdPeriodAnalysis.map((h) => ({
    name: h.bucket,
    avgProfit: h.avgProfit,
    tradeCount: h.tradeCount,
    winRate: h.winRate,
    isOptimal: data.optimalHoldDays === h.bucket,
  }));

  const distChartData = data.profitDistribution
    .filter((d) => d.tradeCount > 0)
    .map((d) => ({
      name: d.bucket,
      value: d.tradeCount,
      pct: d.percentage,
      fill: DIST_COLORS[d.bucket] ?? '#737373',
    }));

  // Tooltip formatters
  const fmtProfitTooltip = (value: number, _name: string, props: any) => {
    const cnt = props?.payload?.tradeCount ?? 0;
    return [`${value.toFixed(0)}€`, `Avg profit (${cnt} prodaj)`];
  };
  const fmtROITooltip = (value: number, _name: string, props: any) => {
    const cnt = props?.payload?.tradeCount ?? 0;
    return [`${value.toFixed(1)}%`, `ROI (${cnt} prodaj)`];
  };

  return (
    <Card className="border-2 border-border/60 bg-card/50">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Trade Insights
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
              v8.40
            </Badge>
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {summary.soldTrades} prodaj · {summary.totalTrades} trade-ov
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              onClick={load}
              disabled={loading}
              title="Osveži"
            >
              {loading ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
            </Button>
          </div>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-center">
          <div className="bg-background/30 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">Skupaj profit</div>
            <div
              className={cn(
                'text-sm font-bold font-mono',
                summary.totalProfit > 0
                  ? 'text-primary'
                  : summary.totalProfit < 0
                    ? 'text-red-500'
                    : 'text-muted-foreground',
              )}
            >
              {summary.totalProfit >= 0 ? '+' : ''}
              {summary.totalProfit.toFixed(0)}€
            </div>
          </div>
          <div className="bg-background/30 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">Avg ROI</div>
            <div className={cn('text-sm font-bold font-mono', roiColor(summary.avgROI))}>
              {summary.avgROI.toFixed(0)}%
            </div>
          </div>
          <div className="bg-background/30 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">Win rate</div>
            <div
              className={cn(
                'text-sm font-bold font-mono',
                summary.overallWinRate >= 70
                  ? 'text-primary'
                  : summary.overallWinRate >= 50
                    ? 'text-amber-400'
                    : 'text-red-500',
              )}
            >
              {summary.overallWinRate.toFixed(0)}%
            </div>
          </div>
          <div className="bg-background/30 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">Avg hold</div>
            <div className="text-sm font-bold font-mono text-primary">
              {summary.avgHoldDays.toFixed(0)}d
            </div>
          </div>
        </div>

        {/* ─── Actionable Insights (always visible) ─────────────────────────── */}
        {data.actionableInsights.length > 0 && (
          <div className="mb-3 bg-primary/5 border border-primary/20 rounded p-3">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">
              <Lightbulb className="w-3.5 h-3.5" />
              Priporočila
            </div>
            <ul className="space-y-1">
              {data.actionableInsights.map((insight, i) => (
                <li
                  key={i}
                  className="text-[11px] leading-relaxed text-foreground/90 flex items-start gap-1.5"
                >
                  <span className="shrink-0 mt-0.5 opacity-50">›</span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ─── Collapsible sections (accordion) ─────────────────────────────── */}
        <Accordion type="multiple" defaultValue={['day-of-week']}>
          {/* Section 2: Day-of-Week */}
          <AccordionItem value="day-of-week">
            <AccordionTrigger className="text-xs font-semibold hover:no-underline py-3">
              <span className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                Najboljši dan za prodajo
                {data.bestDayOfWeek && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-primary border-primary/40 ml-1"
                  >
                    🏆 {data.bestDayOfWeek.dayName}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={dayChartData}
                  margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: '#737373' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#737373' }}
                    tickFormatter={(v: number) => `${v}€`}
                    width={40}
                  />
                  <RTooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #404040',
                      borderRadius: '4px',
                      fontSize: 11,
                    }}
                    formatter={fmtProfitTooltip}
                  />
                  <Bar dataKey="avgProfit" name="avgProfit" radius={[2, 2, 0, 0]} maxBarSize={36}>
                    {dayChartData.map((d, i) => (
                      <Cell
                        key={`day-${i}`}
                        fill={
                          d.isBest
                            ? '#10b981'
                            : d.isWorst
                              ? '#ef4444'
                              : '#3f3f46'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {data.bestDayOfWeek && data.worstDayOfWeek && (
                <div className="grid grid-cols-2 gap-2 text-[10px] mt-2">
                  <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
                    <span className="text-muted-foreground">🏆 Best: </span>
                    <span className="font-medium">{data.bestDayOfWeek.dayName}</span>
                    <span className="text-primary font-mono font-bold ml-1">
                      {fmtEUR(data.bestDayOfWeek.avgProfit, true)}/trade
                    </span>
                  </div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
                    <span className="text-muted-foreground">📉 Worst: </span>
                    <span className="font-medium">{data.worstDayOfWeek.dayName}</span>
                    <span className="text-red-500 font-mono font-bold ml-1">
                      {fmtEUR(data.worstDayOfWeek.avgProfit, true)}/trade
                    </span>
                  </div>
                </div>
              )}
              <p className="text-[9px] text-muted-foreground text-center mt-1">
                Zeleno = najboljši dan · Rdeče = najslabši · Sell-through (kupil-ta-dan in
                prodal) prikazan v tooltipu
              </p>
            </AccordionContent>
          </AccordionItem>

          {/* Section 3: Source Platform */}
          <AccordionItem value="source-platform">
            <AccordionTrigger className="text-xs font-semibold hover:no-underline py-3">
              <span className="flex items-center gap-2">
                <Store className="w-3.5 h-3.5 text-primary" />
                Vir nakupa (ROI per platforma)
                {data.bestSource && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-primary border-primary/40 ml-1"
                  >
                    🏪 {data.bestSource.source}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-1.5 px-1">Vir</th>
                      <th className="py-1.5 px-1 text-right">#</th>
                      <th className="py-1.5 px-1 text-right">Invest.</th>
                      <th className="py-1.5 px-1 text-right">Profit</th>
                      <th className="py-1.5 px-1 text-right">ROI</th>
                      <th className="py-1.5 px-1 text-right">Win</th>
                      <th className="py-1.5 px-1 text-right">Hold</th>
                      <th className="py-1.5 px-1">Best cat.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourcePlatformAnalysis.map((s) => (
                      <tr
                        key={s.source}
                        className="border-b border-border/30 hover:bg-background/30"
                      >
                        <td className="py-1.5 px-1 font-medium truncate max-w-[80px]">
                          {data.bestSource?.source === s.source && '🏪 '}
                          {s.source}
                        </td>
                        <td className="py-1.5 px-1 text-right font-mono">{s.tradeCount}</td>
                        <td className="py-1.5 px-1 text-right font-mono text-muted-foreground">
                          {s.totalInvested.toFixed(0)}€
                        </td>
                        <td
                          className={cn(
                            'py-1.5 px-1 text-right font-mono font-bold',
                            s.totalProfit >= 0 ? 'text-primary' : 'text-red-500',
                          )}
                        >
                          {s.totalProfit >= 0 ? '+' : ''}
                          {s.totalProfit.toFixed(0)}€
                        </td>
                        <td
                          className={cn(
                            'py-1.5 px-1 text-right font-mono font-bold',
                            roiColor(s.avgROI),
                          )}
                        >
                          {s.avgROI.toFixed(0)}%
                        </td>
                        <td className="py-1.5 px-1 text-right font-mono">
                          {s.winRate.toFixed(0)}%
                        </td>
                        <td className="py-1.5 px-1 text-right font-mono text-muted-foreground">
                          {s.avgHoldDays.toFixed(0)}d
                        </td>
                        <td className="py-1.5 px-1 truncate max-w-[80px] text-muted-foreground">
                          {s.bestCategory}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    data={sourceChartData}
                    margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9, fill: '#737373' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: '#737373' }}
                      tickFormatter={(v: number) => `${v}%`}
                      width={36}
                    />
                    <RTooltip
                      contentStyle={{
                        backgroundColor: '#1a1a1a',
                        border: '1px solid #404040',
                        borderRadius: '4px',
                        fontSize: 11,
                      }}
                      formatter={fmtROITooltip}
                    />
                    <Bar dataKey="roi" name="roi" radius={[2, 2, 0, 0]} maxBarSize={48}>
                      {sourceChartData.map((d, i) => (
                        <Cell
                          key={`src-${i}`}
                          fill={
                            d.roi >= 20 ? '#10b981' : d.roi >= 10 ? '#f59e0b' : '#ef4444'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Section 4: Category */}
          <AccordionItem value="category">
            <AccordionTrigger className="text-xs font-semibold hover:no-underline py-3">
              <span className="flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-primary" />
                Kategorije (ROI per kategorija)
                {data.bestCategory && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-primary border-primary/40 ml-1"
                  >
                    📦 {data.bestCategory.category}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart
                  data={categoryChartData}
                  layout="vertical"
                  margin={{ top: 5, right: 10, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: '#737373' }}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 10, fill: '#d4d4d8' }}
                    width={75}
                    tickLine={false}
                  />
                  <RTooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #404040',
                      borderRadius: '4px',
                      fontSize: 11,
                    }}
                    formatter={(value: number, _name: string, props: any) => {
                      const c = props?.payload;
                      return [
                        `${value.toFixed(1)}% ROI · ${c?.tradeCount ?? 0} trade-ov`,
                        c?.name ?? '',
                      ];
                    }}
                  />
                  <Bar dataKey="avgROI" name="avgROI" radius={[0, 2, 2, 0]} maxBarSize={28}>
                    {categoryChartData.map((c, i) => (
                      <Cell
                        key={`cat-${i}`}
                        fill={
                          c.avgROI >= 20
                            ? '#10b981'
                            : c.avgROI >= 10
                              ? '#f59e0b'
                              : c.avgROI >= 0
                                ? '#fbbf24'
                                : '#ef4444'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {data.categoryAnalysis.map((c) => {
                  const meta = TREND_META[c.trend];
                  const TrendIcon = meta.icon;
                  return (
                    <Badge
                      key={c.category}
                      variant="outline"
                      className="text-[10px] gap-1 py-0.5"
                    >
                      <span className="font-medium">{c.category}</span>
                      <span className={cn('font-mono font-bold', roiColor(c.avgROI))}>
                        {c.avgROI.toFixed(0)}%
                      </span>
                      <span className={cn('flex items-center gap-0.5', meta.color)}>
                        <TrendIcon className="w-2.5 h-2.5" />
                      </span>
                    </Badge>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Section 5: Hold Period */}
          <AccordionItem value="hold-period">
            <AccordionTrigger className="text-xs font-semibold hover:no-underline py-3">
              <span className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-primary" />
                Optimalni hold (dni)
                {data.optimalHoldDays && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-primary border-primary/40 ml-1"
                  >
                    ⏱ {data.optimalHoldDays}
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart
                  data={holdChartData}
                  margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: '#737373' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#737373' }}
                    tickFormatter={(v: number) => `${v}€`}
                    width={40}
                  />
                  <RTooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #404040',
                      borderRadius: '4px',
                      fontSize: 11,
                    }}
                    formatter={(value: number, _name: string, props: any) => {
                      const h = props?.payload;
                      return [
                        `${value.toFixed(0)}€ avg · ${h?.tradeCount ?? 0} trade-ov · ${
                          h?.winRate ?? 0
                        }% win`,
                        'Hold bucket',
                      ];
                    }}
                  />
                  <Bar dataKey="avgProfit" name="avgProfit" radius={[2, 2, 0, 0]} maxBarSize={48}>
                    {holdChartData.map((h, i) => (
                      <Cell
                        key={`hold-${i}`}
                        fill={
                          h.isOptimal
                            ? '#10b981'
                            : h.avgProfit > 0
                              ? '#3f3f46'
                              : '#ef4444'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[9px] text-muted-foreground text-center mt-1">
                Zeleno = optimalni hold (najvišji avg profit)
              </p>
            </AccordionContent>
          </AccordionItem>

          {/* Section 6: Profit Distribution */}
          <AccordionItem value="profit-dist">
            <AccordionTrigger className="text-xs font-semibold hover:no-underline py-3">
              <span className="flex items-center gap-2">
                <PieChartIcon className="w-3.5 h-3.5 text-primary" />
                Porazdelitev profitov
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {distChartData.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-muted-foreground">
                  Ni podatkov za prikaz porazdelitve.
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  <ResponsiveContainer width="100%" height={150} minHeight={150}>
                    <PieChart>
                      <Pie
                        data={distChartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={60}
                        innerRadius={20}
                        paddingAngle={2}
                      >
                        {distChartData.map((d, i) => (
                          <Cell key={`dist-${i}`} fill={d.fill} />
                        ))}
                      </Pie>
                      <RTooltip
                        contentStyle={{
                          backgroundColor: '#1a1a1a',
                          border: '1px solid #404040',
                          borderRadius: '4px',
                          fontSize: 11,
                        }}
                        formatter={(value: number, _name: string, props: any) => [
                          `${value} trade-ov (${props?.payload?.pct?.toFixed(0) ?? 0}%)`,
                          props?.payload?.name ?? '',
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 w-full grid grid-cols-2 gap-1">
                    {data.profitDistribution.map((d) => (
                      <div
                        key={d.bucket}
                        className="flex items-center gap-1.5 text-[10px] bg-background/30 rounded px-1.5 py-1"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: DIST_COLORS[d.bucket] ?? '#737373' }}
                        />
                        <span className="flex-1 truncate">{d.bucket}</span>
                        <span className="font-mono font-bold">
                          {d.tradeCount}
                          <span className="text-muted-foreground ml-0.5">
                            ({d.percentage.toFixed(0)}%)
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[9px] text-muted-foreground text-center mt-2">
                Prikaže, ali večino prihodka prinesejo mnogi majhni wini ali nekaj
                velikih.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <p className="text-[9px] text-muted-foreground text-center mt-2">
          Vir: <span className="font-mono">{data.source}</span> · {summary.soldTrades} sold
          trades (zadnjih 365 dni) · auto-refresh 60s
        </p>
      </CardContent>
    </Card>
  );
}
