'use client';

// v9.04: SkladisceWidget — extracted from dashboard-view.tsx.

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, Bell, AlertTriangle, Target, TrendingUp, Play, RefreshCw, Clock, Zap, LayoutGrid, BarChart3, Bookmark, ShoppingCart, TrendingDown, ExternalLink, Check, Sparkles, ArrowUp, ArrowDown, Settings2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useHaptic } from '@/hooks/use-haptic';
import { WIDGET_IDS } from './types';
import type { Stats, ViewProps, WidgetId } from './types';
import { formatDuration, formatTimeAgo } from './utils';


export function SkladisceWidget({ onNavigate }: { onNavigate: (v: any) => void }) {
  const [data, setData] = useState<Record<string, any> | null>(null);
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

  const hasMonthlyData = data.monthlyPnl?.some((m: Record<string, any>) => m.count > 0);

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
                const maxAbs = Math.max(...data.monthlyPnl.map((x: Record<string, any>) => Math.abs(x.profit)), 1);
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


