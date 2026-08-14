'use client';

// v8.37: Profit Timeline Chart — recharts line+bar chart za profit trend.
//
// Prikazuje weekly/monthly profit aggregation iz Trade tabele na Dashboard-u.
// Uporabnik vidi trend (raste/pada/stabilen) in lahko hitro odgovori na
// "kako poslujevem zadnjih N tednov/mesecev?".
//
// Two series:
//   - Bar  (profit)       — weekly/monthly net profit (zelena pozitivna, rdeča negativna)
//   - Line (cumulative)   — running total cumulative profit
//
// Controls:
//   - Granularity toggle: Weekly | Monthly
//   - Days selector: 30d | 90d | 12m
//
// Trend indicator:
//   - ↗️ GROWING   — second half avg > first half avg × 1.1
//   - → STABLE    — within ±10%
//   - ↘️ DECLINING — second half avg < first half avg × 0.9
//   - ❓ INSUFFICIENT_DATA — <4 points
//
// Empty state: "Ni dovolj prodaj za graf. Dodaj sold trades."
//
// Fetches from: GET /api/analytics/profit-timeline?granularity={g}&days={d}

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, Minus, LineChart as LineChartIcon, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ReferenceLine, Cell,
} from 'recharts';

interface TimelinePoint {
  date: string;
  label: string;
  profit: number;
  revenue: number;
  cost: number;
  tradeCount: number;
  cumulativeProfit: number;
}

interface ProfitTimelineResult {
  ok: true;
  points: TimelinePoint[];
  granularity: 'weekly' | 'monthly';
  days: number;
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  totalTrades: number;
  bestWeek: TimelinePoint | null;
  worstWeek: TimelinePoint | null;
  avgWeeklyProfit: number;
  trend: 'GROWING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';
  source: string;
}

const GRANULARITY_OPTS: Array<{ v: 'weekly' | 'monthly'; l: string }> = [
  { v: 'weekly', l: 'Tedensko' },
  { v: 'monthly', l: 'Mesečno' },
];

const DAYS_OPTS: Array<{ v: number; l: string }> = [
  { v: 30, l: '30d' },
  { v: 90, l: '90d' },
  { v: 365, l: '12m' },
];

const TREND_CONFIG: Record<
  ProfitTimelineResult['trend'],
  { icon: typeof TrendingUp; color: string; label: string }
> = {
  GROWING: { icon: TrendingUp, color: 'text-primary border-primary/40', label: '↗️ RASTE' },
  STABLE: { icon: Minus, color: 'text-amber-400 border-amber-400/40', label: '→ STABILEN' },
  DECLINING: { icon: TrendingDown, color: 'text-red-500 border-red-500/40', label: '↘️ PADA' },
  INSUFFICIENT_DATA: { icon: HelpCircle, color: 'text-muted-foreground border-border', label: '❓ PREMAJHNO' },
};

export function ProfitTimelineChart() {
  const [granularity, setGranularity] = useState<'weekly' | 'monthly'>('weekly');
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<ProfitTimelineResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/analytics/profit-timeline?granularity=${granularity}&days=${days}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ProfitTimelineResult;
      if (json.ok) {
        setData(json);
      } else {
        throw new Error('Napaka v odgovoru');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri nalaganju timeline');
    } finally {
      setLoading(false);
    }
  }, [granularity, days]);

  useEffect(() => {
    load();
  }, [load]);

  const trendCfg = data ? TREND_CONFIG[data.trend] : TREND_CONFIG.INSUFFICIENT_DATA;
  const TrendIcon = trendCfg.icon;

  return (
    <Card className="border-2 border-border/60 bg-card/50">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <LineChartIcon className="w-4 h-4" />
            Profit Timeline
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
              v8.37
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
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {/* Granularity toggle */}
          <div className="flex items-center gap-0.5 bg-background/30 rounded border border-border">
            {GRANULARITY_OPTS.map((opt) => (
              <button
                key={opt.v}
                onClick={() => setGranularity(opt.v)}
                className={cn(
                  'px-2 py-1 text-[11px] rounded transition-colors',
                  granularity === opt.v
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
          {/* Days selector */}
          <div className="flex items-center gap-0.5 bg-background/30 rounded border border-border">
            {DAYS_OPTS.map((opt) => (
              <button
                key={opt.v}
                onClick={() => setDays(opt.v)}
                className={cn(
                  'px-2 py-1 text-[11px] rounded transition-colors',
                  days === opt.v
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
          {/* Trend badge */}
          {data && (
            <Badge variant="outline" className={cn('text-[10px] font-bold', trendCfg.color)}>
              <TrendIcon className="w-3 h-3 mr-0.5" />
              {trendCfg.label}
            </Badge>
          )}
        </div>

        {/* Chart body */}
        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
            Nalagam profit timeline...
          </div>
        ) : data && data.points.length > 0 ? (
          <div className="space-y-3">
            {/* Chart */}
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={data.points} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="profitBarPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="profitBarNeg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#737373' }}
                  interval="preserveStartEnd"
                  angle={-15}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#737373' }}
                  tickFormatter={(v: number) => `${v}€`}
                  width={45}
                />
                <RTooltip
                  contentStyle={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #404040',
                    borderRadius: '4px',
                    fontSize: 11,
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'profit') return [`${value.toFixed(2)}€`, 'Profit'];
                    if (name === 'cumulativeProfit') return [`${value.toFixed(2)}€`, 'Kumulativ'];
                    return [value, name];
                  }}
                  labelFormatter={(label: string, payload: any[]) => {
                    const point = payload?.[0]?.payload as TimelinePoint | undefined;
                    if (!point) return label;
                    return `${label} · ${point.tradeCount} ${point.tradeCount === 1 ? 'prodaja' : 'prodaj'}`;
                  }}
                />
                <ReferenceLine y={0} stroke="#525252" strokeWidth={1} />
                {/* Weekly profit — bar */}
                <Bar
                  dataKey="profit"
                  name="profit"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={36}
                >
                  {data.points.map((p, i) => (
                    <Cell key={`bar-${i}`} fill={p.profit >= 0 ? 'url(#profitBarPos)' : 'url(#profitBarNeg)'} />
                  ))}
                </Bar>
                {/* Cumulative profit — line */}
                <Line
                  type="monotone"
                  dataKey="cumulativeProfit"
                  name="cumulativeProfit"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ fill: '#f59e0b', r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Skupaj profit</div>
                <div
                  className={cn(
                    'text-sm font-bold font-mono',
                    data.totalProfit > 0 ? 'text-primary' : data.totalProfit < 0 ? 'text-red-500' : 'text-muted-foreground',
                  )}
                >
                  {data.totalProfit >= 0 ? '+' : ''}
                  {data.totalProfit.toFixed(0)}€
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Prodaj</div>
                <div className="text-sm font-bold font-mono text-primary">
                  {data.totalTrades}
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">
                  Avg / {granularity === 'weekly' ? 'teden' : 'mesec'}
                </div>
                <div
                  className={cn(
                    'text-sm font-bold font-mono',
                    data.avgWeeklyProfit >= 0 ? 'text-primary' : 'text-red-500',
                  )}
                >
                  {data.avgWeeklyProfit >= 0 ? '+' : ''}
                  {data.avgWeeklyProfit.toFixed(0)}€
                </div>
              </div>
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] text-muted-foreground uppercase">Prihodki</div>
                <div className="text-sm font-bold font-mono">
                  {data.totalRevenue.toFixed(0)}€
                </div>
              </div>
            </div>

            {/* Best/worst period */}
            {data.bestWeek && data.worstWeek && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-primary/5 border border-primary/20 rounded p-2 flex items-center justify-between gap-1">
                  <span className="text-muted-foreground shrink-0">🏆 Best:</span>
                  <span className="truncate font-medium">{data.bestWeek.label}</span>
                  <span className="text-primary font-mono font-bold shrink-0">
                    +{data.bestWeek.profit.toFixed(0)}€
                  </span>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2 flex items-center justify-between gap-1">
                  <span className="text-muted-foreground shrink-0">📉 Worst:</span>
                  <span className="truncate font-medium">{data.worstWeek.label}</span>
                  <span
                    className={cn(
                      'font-mono font-bold shrink-0',
                      data.worstWeek.profit >= 0 ? 'text-amber-400' : 'text-red-500',
                    )}
                  >
                    {data.worstWeek.profit >= 0 ? '+' : ''}
                    {data.worstWeek.profit.toFixed(0)}€
                  </span>
                </div>
              </div>
            )}

            <p className="text-[9px] text-muted-foreground text-center">
              Prikazanih {data.points.length} {granularity === 'weekly' ? 'tednov' : 'mesecev'} ·
              {' '}{data.days} dni nazaj
            </p>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <LineChartIcon className="w-5 h-5 mx-auto mb-2 opacity-30" />
            Ni dovolj prodaj za graf. Dodaj sold trades (z datumom prodaje) v
            Skladišču ali preko CSV uvoza.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
