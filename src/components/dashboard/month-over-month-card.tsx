'use client';

// v8.61: Month-over-Month Comparison Card
// "This month: 351€ vs Last month: 667€, -47%"
// + 6-month history BarChart + Category performance timeline

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, Calendar, BarChart3, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line, CartesianGrid } from 'recharts';
import { cn } from '@/lib/utils';

interface MonthData {
  label: string; tradeCount: number; profit: number; revenue: number; cost: number; avgROI: number; winRate: number;
}
interface CategoryMonthData {
  category: string; months: Array<{ month: string; profit: number; tradeCount: number }>; totalProfit: number; avgMonthlyProfit: number; trend: string;
}
interface MoMData {
  ok: boolean;
  currentMonth: MonthData;
  lastMonth: MonthData;
  momChange: number;
  momChangePct: number;
  momDirection: string;
  monthlyHistory: MonthData[];
  categories: CategoryMonthData[];
  bestCategory: string | null;
  avgMonthlyProfit: number;
  bestMonth: { label: string; profit: number } | null;
  worstMonth: { label: string; profit: number } | null;
}

const trendColor = { UP: 'text-emerald-500', DOWN: 'text-red-500', FLAT: 'text-muted-foreground' };
const trendIcon = { UP: <TrendingUp className="w-4 h-4" />, DOWN: <TrendingDown className="w-4 h-4" />, FLAT: <Minus className="w-4 h-4" /> };
const trendBadge = { GROWING: '↗️ Raste', STABLE: '→ Stabilno', DECLINING: '↘️ Pada', NEW: '🆕 Novo', DEAD: '💀 Mrtvo' };
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

export function MonthOverMonthCard() {
  const { data, loading, error, refetch } = useFetch<MoMData>('/api/analytics/month-over-month', { interval: 120000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> 📅 Mesec po mesec</CardTitle></CardHeader>
        <CardContent><CardSkeleton variant="chart" /></CardContent>
      </Card>
    );
  }
  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> 📅 Mesec po mesec</CardTitle></CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  const chartData = data.monthlyHistory.map(m => ({ name: m.label, profit: Math.round(m.profit), trades: m.tradeCount }));

  // Category timeline data for LineChart
  const catTimeline = data.monthlyHistory.map(m => {
    const entry: any = { name: m.label };
    for (const cat of data.categories.slice(0, 5)) {
      const monthData = cat.months.find(mm => mm.month === m.label);
      entry[cat.category] = monthData ? Math.round(monthData.profit) : 0;
    }
    return entry;
  });

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> 📅 Mesec po mesec</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* MoM comparison */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground">Trenutni mesec</div>
            <div className={cn('text-xl font-bold', data.currentMonth.profit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
              {data.currentMonth.profit >= 0 ? '+' : ''}{data.currentMonth.profit.toFixed(0)}€
            </div>
            <div className="text-[10px] text-muted-foreground">{data.currentMonth.tradeCount} prodaj · {data.currentMonth.winRate.toFixed(0)}% win</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground">Prejšnji mesec</div>
            <div className={cn('text-xl font-bold', data.lastMonth.profit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
              {data.lastMonth.profit >= 0 ? '+' : ''}{data.lastMonth.profit.toFixed(0)}€
            </div>
            <div className="text-[10px] text-muted-foreground">{data.lastMonth.tradeCount} prodaj · {data.lastMonth.winRate.toFixed(0)}% win</div>
          </div>
        </div>

        {/* MoM change badge */}
        <div className={cn('flex items-center gap-2 text-xs p-2 rounded-lg',
          data.momDirection === 'UP' ? 'bg-emerald-500/10' : data.momDirection === 'DOWN' ? 'bg-red-500/10' : 'bg-muted')}>
          <span className={trendColor[data.momDirection as keyof typeof trendColor]}>{trendIcon[data.momDirection as keyof typeof trendIcon]}</span>
          <span className="text-muted-foreground">
            {data.momDirection === 'UP' ? '↗️' : data.momDirection === 'DOWN' ? '↘️' : '→'} {' '}
            {data.momChange >= 0 ? '+' : ''}{data.momChange.toFixed(0)}€ ({data.momChangePct >= 0 ? '+' : ''}{data.momChangePct.toFixed(0)}%) vs prejšnji mesec
          </span>
        </div>

        {/* 6-month BarChart */}
        <div>
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Zadnjih 6 mesecev</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                formatter={(v: any) => [`${v}€`, 'Profit']}
              />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category timeline (top 5 categories) */}
        {data.categories.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Profit po kategorijah (top 5)</div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={catTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '9px' }} />
                {data.categories.slice(0, 5).map((cat, i) => (
                  <Line key={cat.category} type="monotone" dataKey={cat.category} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Category summary table */}
        {data.categories.length > 0 && (
          <div className="space-y-1">
            {data.categories.slice(0, 5).map((cat, i) => (
              <div key={cat.category} className="flex items-center justify-between text-xs py-1 border-b border-border/30">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="font-medium">{cat.category}</span>
                </span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{cat.totalProfit.toFixed(0)}€ total</span>
                  <span>{cat.avgMonthlyProfit.toFixed(0)}€/mo</span>
                  <span className={cn('text-[10px]', cat.trend === 'GROWING' ? 'text-emerald-500' : cat.trend === 'DECLINING' ? 'text-red-500' : '')}>
                    {trendBadge[cat.trend as keyof typeof trendBadge] || cat.trend}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary stats */}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
          <span>📊 Avg: {data.avgMonthlyProfit.toFixed(0)}€/mo</span>
          {data.bestMonth && <span className="text-emerald-500">🏆 Best: {data.bestMonth.label} ({data.bestMonth.profit.toFixed(0)}€)</span>}
          {data.worstMonth && <span className="text-red-500">📉 Worst: {data.worstMonth.label} ({data.worstMonth.profit.toFixed(0)}€)</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// Need Cell import
import { Cell } from 'recharts';
