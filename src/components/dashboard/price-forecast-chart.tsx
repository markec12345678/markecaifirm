'use client';

// v5.5: PriceForecastChart — vizualizacija cene z AI napovedmi za naslednje mesece

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ReferenceLine
} from 'recharts';

export function PriceForecastChart({ listingId, currentPrice }: { listingId: string; currentPrice: number }) {
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState(3);

  const load = async () => {
    setLoading(true);
    setForecast(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/price-forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months }),
      });
      const data = await res.json();
      if (data.ok) {
        setForecast(data);
        toast.success(`AI napoved generirana (${data.forecast.confidence}% zaupanje)`);
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
    } finally {
      setLoading(false);
    }
  };

  const trendConfig: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
    declining: { icon: TrendingDown, color: 'text-primary', label: '📉 Pada' },
    stable: { icon: Minus, color: 'text-amber-400', label: '➡️ Stabilna' },
    rising: { icon: TrendingUp, color: 'text-red-500', label: '📈 Raste' },
  };

  const formatPrice = (v: number) => `${v}€`;
  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('sl-SI', { month: 'short', year: '2-digit' });
  };

  return (
    <div className="bg-card/30 border border-border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          AI napoved cene (3-6 mesecev)
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.5</Badge>
        </h4>
        <div className="flex items-center gap-1">
          <select
            value={months}
            onChange={(e) => setMonths(parseInt(e.target.value, 10))}
            className="bg-card border border-border rounded px-1.5 py-0.5 text-[10px]"
          >
            <option value={3}>3 mes</option>
            <option value={6}>6 mes</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={load}
            disabled={loading}
          >
            {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Napovej
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          <RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />
          AI analizira trende in sezonskost...
        </div>
      ) : forecast ? (
        <div className="space-y-2">
          {/* Trend + confidence */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {(() => {
              const cfg = trendConfig[forecast.forecast.trend] || trendConfig.stable;
              const Icon = cfg.icon;
              return (
                <Badge variant="outline" className={cn('text-[10px] gap-0.5', cfg.color)}>
                  <Icon className="w-3 h-3" />
                  {cfg.label}
                </Badge>
              );
            })()}
            <Badge variant="outline" className={cn(
              'text-[10px]',
              forecast.forecast.confidence >= 70 ? 'text-primary border-primary/40' :
              forecast.forecast.confidence >= 40 ? 'text-amber-400 border-amber-400/40' :
              'text-red-500 border-red-500/40'
            )}>
              🎯 {forecast.forecast.confidence}% zaupanje
            </Badge>
            {forecast.forecast.expectedPrice3m != null && (
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">
                3m: {forecast.forecast.expectedPrice3m}€
              </Badge>
            )}
            {forecast.forecast.expectedPrice6m != null && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                6m: {forecast.forecast.expectedPrice6m}€
              </Badge>
            )}
          </div>

          {/* Chart */}
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={forecast.forecast.allPoints}>
              <defs>
                <linearGradient id="historyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="projectedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 9, fill: '#737373' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#737373' }}
                tickFormatter={formatPrice}
                width={45}
              />
              <RTooltip
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #404040', borderRadius: '4px', fontSize: 11 }}
                formatter={(value: any, name: string) => {
                  const labels: Record<string, string> = { history: 'Zgodovina', projected: 'Napoved' };
                  return [`${value}€`, labels[name] || name];
                }}
                labelFormatter={(label: any) => formatDate(String(label))}
              />
              {/* History area */}
              <Area
                type="monotone"
                dataKey="price"
                data={forecast.forecast.history}
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#historyGrad)"
                name="history"
                connectNulls
              />
              {/* Projected line */}
              <Line
                type="monotone"
                dataKey="price"
                data={forecast.forecast.projected}
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ fill: '#f59e0b', r: 3 }}
                name="projected"
                connectNulls
              />
              {/* Current price reference */}
              <ReferenceLine
                y={currentPrice}
                stroke="#737373"
                strokeDasharray="3 3"
                label={{ value: `Trenutno: ${currentPrice}€`, position: 'right', fill: '#737373', fontSize: 9 }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* AI Analysis */}
          {forecast.forecast.aiAnalysis && (
            <div className="bg-background/30 rounded p-2 text-xs">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">📊 AI analiza</div>
              <p>{forecast.forecast.aiAnalysis}</p>
            </div>
          )}

          {/* Seasonality */}
          {forecast.forecast.seasonality && forecast.forecast.seasonality !== 'null' && (
            <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2 text-[11px]">
              <span className="text-blue-400 font-bold">📅 Sezonskost:</span> {forecast.forecast.seasonality}
            </div>
          )}

          {/* Projected prices table */}
          {forecast.forecast.projected.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer hover:text-foreground text-muted-foreground">
                📋 Projekcija po mesecih ({forecast.forecast.projected.length})
              </summary>
              <div className="mt-1 space-y-0.5">
                {forecast.forecast.projected.map((p: any, i: number) => {
                  const pct = currentPrice > 0 ? Math.round(((p.price - currentPrice) / currentPrice) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2 p-1 bg-background/30 rounded text-[11px]">
                      <span className="text-muted-foreground w-16">{formatDate(p.date)}</span>
                      <span className={cn('font-mono font-bold', p.price <= currentPrice ? 'text-primary' : 'text-amber-400')}>
                        {p.price}€
                      </span>
                      <span className={cn(
                        'text-[10px] w-12 text-right',
                        pct < 0 ? 'text-primary' : pct > 0 ? 'text-red-500' : 'text-muted-foreground'
                      )}>
                        {pct > 0 ? '+' : ''}{pct}%
                      </span>
                      <div className="flex-1 h-1 bg-background rounded overflow-hidden">
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${p.confidence ?? 50}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground w-8 text-right">{p.confidence ?? 50}%</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          <p className="text-[9px] text-muted-foreground text-center">
            ⚠️ Napoved je samo AI predpostavka. Dejanski rezultat je odvisen od trga in prodajalca.
          </p>
        </div>
      ) : (
        <div className="py-4 text-center text-xs text-muted-foreground">
          <TrendingUp className="w-5 h-5 mx-auto mb-2 opacity-30" />
          Klikni "Napovej" za AI napoved cene za naslednje mesece.
        </div>
      )}
    </div>
  );
}
