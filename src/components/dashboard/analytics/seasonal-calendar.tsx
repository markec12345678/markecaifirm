'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SeasonalCalendar() {
  const [seasonal, setSeasonal] = useState<Record<string, any> | null>(null);
  const [seasonalLoading, setSeasonalLoading] = useState(false);

  // v6.5: Load seasonal calendar
  const loadSeasonal = useCallback(async () => {
    setSeasonalLoading(true);
    try {
      const res = await fetch('/api/ai/seasonal-calendar');
      if (res.ok) setSeasonal(await res.json());
    } catch { /* ignore */ }
    finally { setSeasonalLoading(false); }
  }, []);

  return (
    <Card className="bg-card/50 lg:col-span-2 border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Sezonski koledar cen
              <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.5</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Sezonski vzorci cen — kdaj kupovati, kdaj prodajati.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadSeasonal} disabled={seasonalLoading} className="gap-2 h-7 text-xs">
            {seasonalLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
            Analiziraj
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {seasonalLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin opacity-50" />
            Analyzing seasonal patterns...
          </div>
        ) : !seasonal || seasonal.calendar?.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {seasonal?.message || 'Klikni "Analiziraj" za sezonsko analizo.'}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Insights */}
            {seasonal.insights?.length > 0 && (
              <div className="space-y-1">
                {seasonal.insights.map((insight: string, i: number) => (
                  <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2 text-xs text-primary">
                    {insight}
                  </div>
                ))}
              </div>
            )}

            {/* Best buy/sell */}
            {seasonal.bestBuyMonth && seasonal.bestSellMonth && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs">
                  <div className="text-primary font-bold">💰 Najboljši za nakup</div>
                  <div>{seasonal.bestBuyMonth.monthName} — {seasonal.bestBuyMonth.avgPrice}€ ({seasonal.bestBuyMonth.diffPct}%)</div>
                </div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs">
                  <div className="text-amber-400 font-bold">💸 Najboljši za prodajo</div>
                  <div>{seasonal.bestSellMonth.monthName} — {seasonal.bestSellMonth.avgPrice}€ (+{seasonal.bestSellMonth.diffPct}%)</div>
                </div>
              </div>
            )}

            {/* Monthly calendar */}
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1">
              {seasonal.calendar.map((m: Record<string, any>, i: number) => {
                const currentMonth = new Date().getMonth();
                const isCurrent = m.monthNum === currentMonth;
                const isNext = m.monthNum === (currentMonth + 1) % 12;
                return (
                  <div key={i} className={cn(
                    'rounded p-1.5 text-center text-[10px] border',
                    isCurrent ? 'border-primary bg-primary/10' :
                    isNext ? 'border-amber-400/40 bg-amber-400/5' :
                    m.diffPct < -10 ? 'border-primary/20 bg-primary/5' :
                    m.diffPct > 10 ? 'border-amber-400/20 bg-amber-400/5' :
                    'border-border bg-background/30'
                  )}>
                    <div className="font-bold">{m.monthName.slice(0, 3)}</div>
                    <div className="font-mono font-bold">{m.avgPrice}€</div>
                    <div className={cn('text-[8px]', m.diffPct < 0 ? 'text-primary' : m.diffPct > 0 ? 'text-amber-400' : 'text-muted-foreground')}>
                      {m.diffPct > 0 ? '+' : ''}{m.diffPct}%
                    </div>
                    <div className="text-[7px] text-muted-foreground">{m.trend.split(' ')[0]}</div>
                    {isCurrent && <div className="text-[7px] text-primary font-bold">SEDAJ</div>}
                    {isNext && <div className="text-[7px] text-amber-400 font-bold">NASLEDNJI</div>}
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-muted-foreground text-center">
              📊 Analiziranih {seasonal.dataPoints} oglasov v {seasonal.monthsAnalyzed} mesecih • Letno povprečje: {seasonal.overallAvgPrice}€
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
