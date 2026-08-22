'use client';

// v8.97: Profit Heatmap Widget — vizualizacija dobička po dnevu/uri.
//
// Prikaže heatmap kdaj je najbolje objaviti oglase in kdaj se največ proda.
// Prikazuje 7 dni × 24 ur = 168 celic z barvnim kodiranjem.
//
// Prikazuje v Dashboard-u pod AI Usage Widget.

import { useFetch } from '@/hooks/use-fetch';
import { CardError } from '@/components/dashboard/card-error';
import { CardSkeleton } from '@/components/dashboard/card-skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flame, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';

interface HeatmapData {
  ok: boolean;
  cells: Array<{
    day: number;
    hour: number;
    count: number;
    profitEur: number;
    avgProfitEur: number;
  }>;
  bestDay: string;
  bestHour: number;
  bestProfitEur: number;
  totalProfitEur: number;
  totalSales: number;
}

const DAYS_SL = ['Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob', 'Ned'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function ProfitHeatmapWidget() {
  const { data, loading, error, refetch } = useFetch<HeatmapData>(
    '/api/analytics/profit-heatmap',
    { interval: 300000 }
  );

  // Build 7×24 grid — always called (before early returns)
  const grid = useMemo(() => {
    const g: Array<Array<{ count: number; profitEur: number; avgProfitEur: number }>> = [];
    for (let d = 0; d < 7; d++) {
      g[d] = [];
      for (let h = 0; h < 24; h++) {
        const cell = data?.cells.find(c => c.day === d && c.hour === h);
        g[d][h] = cell ?? { count: 0, profitEur: 0, avgProfitEur: 0 };
      }
    }
    return g;
  }, [data]);

  if (loading) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" /> Profit Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent><CardSkeleton variant="chart" /></CardContent>
      </Card>
    );
  }

  if (error || !data || !data.ok) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" /> Profit Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent><CardError error={error} onRetry={refetch} /></CardContent>
      </Card>
    );
  }

  const maxProfit = Math.max(1, ...grid.flat().map(c => c.profitEur));

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-orange-500/5 to-transparent"
      role="region"
      aria-label={`Profit heatmap — najboljši dan: ${data.bestDay}, najboljša ura: ${data.bestHour}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" aria-hidden="true" />
            Profit Heatmap
            <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-600 dark:text-orange-400">
              {data.totalSales} prodaj
            </Badge>
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refetch} aria-label="Osveži heatmap">
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Summary stats */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">🏆 Najboljši:</span>
            <span className="font-bold text-orange-600 dark:text-orange-400">
              {data.bestDay} {data.bestHour}:00
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">💰 Skupno:</span>
            <span className="font-bold text-emerald-500">{data.totalProfitEur}€</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">⭐ Najboljša prodaja:</span>
            <span className="font-bold">{data.bestProfitEur}€</span>
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[500px]">
            {/* Hour labels (top) */}
            <div className="flex gap-px mb-1">
              <div className="w-8 shrink-0" />
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-[8px] text-muted-foreground/60 tabular-nums">
                  {h < 10 ? `0${h}` : h}
                </div>
              ))}
            </div>

            {/* Rows */}
            {DAYS_SL.map((day, d) => (
              <div key={d} className="flex gap-px mb-px">
                <div className="w-8 shrink-0 flex items-center text-[9px] text-muted-foreground font-medium">
                  {day}
                </div>
                {HOURS.map(h => {
                  const cell = grid[d][h];
                  const intensity = cell.profitEur > 0
                    ? Math.min(1, cell.profitEur / maxProfit)
                    : 0;
                  const bg = getHeatColor(intensity);
                  return (
                    <div
                      key={h}
                      className={cn(
                        "flex-1 h-6 rounded-sm transition-all hover:scale-125 hover:z-10 relative group cursor-default",
                        bg
                      )}
                      title={`${day} ${h}:00 — ${cell.count} prodaj, ${cell.profitEur}€ dobička`}
                      role="gridcell"
                      aria-label={`${day} ${h} ura: ${cell.count} prodaj, ${cell.profitEur} evrov dobička`}
                    >
                      {cell.count > 0 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white/90 tabular-nums">
                          {cell.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-[9px] text-muted-foreground">
          <span>Manj donosno</span>
          <div className="flex gap-px">
            <div className="w-4 h-3 bg-muted/30 rounded-sm" />
            <div className="w-4 h-3 bg-emerald-500/20 rounded-sm" />
            <div className="w-4 h-3 bg-emerald-500/40 rounded-sm" />
            <div className="w-4 h-3 bg-emerald-500/60 rounded-sm" />
            <div className="w-4 h-3 bg-emerald-500/80 rounded-sm" />
            <div className="w-4 h-3 bg-emerald-500 rounded-sm" />
          </div>
          <span>Bolj donosno</span>
        </div>
      </CardContent>
    </Card>
  );
}

function getHeatColor(intensity: number): string {
  if (intensity === 0) return 'bg-muted/30';
  if (intensity < 0.2) return 'bg-emerald-500/20';
  if (intensity < 0.4) return 'bg-emerald-500/40';
  if (intensity < 0.6) return 'bg-emerald-500/60';
  if (intensity < 0.8) return 'bg-emerald-500/80';
  return 'bg-emerald-500';
}
