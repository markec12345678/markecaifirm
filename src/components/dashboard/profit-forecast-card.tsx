'use client';

// v8.53: Profit Forecast Card — "pri trenutni hitrosti boš imel X€ do konca meseca"
// + Profit Distribution Pie Chart (kategorija → % profita)

import { useState, useEffect } from 'react';
import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Target, Calendar, PieChart as PieChartIcon, RefreshCw } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { cn } from '@/lib/utils';

interface ForecastData {
  ok: boolean;
  currentMonthProfit: number;
  currentMonthTrades: number;
  dailyAvgProfit: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedMonthEnd: number;
  monthlyGoal: number;
  goalLikely: boolean;
  goalDeficit: number;
  trend: string;
  trendReason: string;
  distribution: Array<{ category: string; profit: number; tradeCount: number; percentage: number }>;
  heldPotentialProfit: number;
  heldItemCount: number;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export function ProfitForecastCard() {
  const { data, loading, error, refetch } = useFetch<ForecastData>('/api/analytics/profit-forecast', { interval: 60000 });

  if (loading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            📈 NAPoved DOBIČKA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardSkeleton variant="stats" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            📈 NAPoved DOBIČKA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardError error={error} onRetry={refetch} />
        </CardContent>
      </Card>
    );
  }

  const trendColor = data.trend === 'AHEAD' ? 'text-emerald-500' : data.trend === 'BEHIND' ? 'text-red-500' : 'text-amber-400';
  const trendIcon = data.trend === 'AHEAD' ? <TrendingUp className="w-4 h-4" /> : data.trend === 'BEHIND' ? <TrendingDown className="w-4 h-4" /> : <Target className="w-4 h-4" />;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            📈 NAPoved DOBIČKA
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Main forecast */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-primary/5 rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground">Trenutno (mesec)</div>
            <div className={cn('text-xl font-bold', data.currentMonthProfit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
              {data.currentMonthProfit >= 0 ? '+' : ''}{data.currentMonthProfit.toFixed(0)}€
            </div>
            <div className="text-[10px] text-muted-foreground">{data.currentMonthTrades} prodaj · {data.daysElapsed} dni</div>
          </div>
          <div className="bg-primary/5 rounded-lg p-2.5">
            <div className="text-[10px] uppercase text-muted-foreground">Napoved konec meseca</div>
            <div className={cn('text-xl font-bold', data.projectedMonthEnd >= (data.monthlyGoal || 0) ? 'text-emerald-500' : 'text-amber-400')}>
              {data.projectedMonthEnd.toFixed(0)}€
            </div>
            <div className="text-[10px] text-muted-foreground">{data.dailyAvgProfit.toFixed(1)}€/dan · {data.daysRemaining} dni do konca</div>
          </div>
        </div>

        {/* Goal progress */}
        {data.monthlyGoal > 0 && (
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Cilj: {data.monthlyGoal}€</span>
                <span className={cn('font-bold', data.goalLikely ? 'text-emerald-500' : 'text-red-500')}>
                  {data.goalLikely ? '✓ Cilj dosegljiv' : `${data.goalDeficit > 0 ? '-' : '+'}${Math.abs(data.goalDeficit).toFixed(0)}€`}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full mt-0.5 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', data.goalLikely ? 'bg-emerald-500' : 'bg-amber-500')}
                  style={{ width: `${Math.min(100, (data.projectedMonthEnd / data.monthlyGoal) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Trend */}
        <div className={cn('flex items-center gap-2 text-xs p-2 rounded-lg', data.trend === 'AHEAD' ? 'bg-emerald-500/10' : data.trend === 'BEHIND' ? 'bg-red-500/10' : 'bg-amber-500/10')}>
          <span className={trendColor}>{trendIcon}</span>
          <span className="text-muted-foreground">{data.trendReason}</span>
        </div>

        {/* Held potential */}
        {data.heldItemCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <PieChartIcon className="w-3.5 h-3.5" />
            <span>{data.heldItemCount} held itemov · potencial {data.heldPotentialProfit.toFixed(0)}€ (20% margin)</span>
          </div>
        )}

        {/* Distribution Pie Chart */}
        {data.distribution.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Razdelitev dobička po kategorijah</div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data.distribution}
                  dataKey="profit"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={60}
                  innerRadius={30}
                  label={(entry: any) => `${entry.percentage}%`}
                >
                  {data.distribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any, props: any) => [`${value.toFixed(0)}€ (${props.payload.percentage}%)`, name]}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '10px' }}
                  formatter={(value: string) => value.charAt(0).toUpperCase() + value.slice(1)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
