'use client';

// v9.09: Extracted from pricing-view.tsx — AI Profit Forecast

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ProfitForecast() {
  const [forecast, setForecast] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const runForecast = async () => {
    setForecastLoading(true); setForecast(null);
    try {
      const res = await fetch('/api/ai/profit-forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: 1 }) });
      const data = await res.json();
      if (data.ok) { setForecast(data); toast.success('✓ Napoved dobička generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setForecastLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            AI Profit Forecast
          </span>
          <Button size="sm" variant="outline" onClick={runForecast} disabled={forecastLoading} className="h-6 text-xs gap-1.5">
            {forecastLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {forecastLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI napoveduje dobiček za naslednji mesec...
          </div>
        ) : forecast?.forecast ? (
          <div className="space-y-2 text-xs">
            <div className={cn('border rounded p-2',
              forecast.forecast.expectedProfit >= 0 ? 'bg-primary/10 border-primary/30' : 'bg-red-500/10 border-red-500/30')}>
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase text-[10px]">Pričakovan dobiček</span>
                <Badge variant="outline" className="text-[9px] font-mono font-bold text-primary border-primary/40">
                  {forecast.forecast.confidence}% confidence
                </Badge>
              </div>
              <div className="text-lg font-mono font-bold text-primary mt-1">
                {forecast.forecast.expectedProfit.toLocaleString('sl-SI')} €
              </div>
            </div>
            {forecast.forecast.scenarios && (
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <div className="bg-primary/5 rounded p-1.5 border text-center">
                  <div className="text-[9px] text-muted-foreground">Optimistično</div>
                  <div className="font-mono font-bold text-primary">{forecast.forecast.scenarios.optimistic?.profit ?? 0}€</div>
                  <div className="text-[9px] text-muted-foreground">{forecast.forecast.scenarios.optimistic?.probability ?? 25}%</div>
                </div>
                <div className="bg-card/30 rounded p-1.5 border text-center">
                  <div className="text-[9px] text-muted-foreground">Realno</div>
                  <div className="font-mono font-bold">{forecast.forecast.scenarios.realistic?.profit ?? 0}€</div>
                  <div className="text-[9px] text-muted-foreground">{forecast.forecast.scenarios.realistic?.probability ?? 50}%</div>
                </div>
                <div className="bg-red-500/5 rounded p-1.5 border text-center">
                  <div className="text-[9px] text-muted-foreground">Pessimistično</div>
                  <div className="font-mono font-bold text-amber-400">{forecast.forecast.scenarios.pessimistic?.profit ?? 0}€</div>
                  <div className="text-[9px] text-muted-foreground">{forecast.forecast.scenarios.pessimistic?.probability ?? 25}%</div>
                </div>
              </div>
            )}
            {forecast.forecast.factors?.length > 0 && (
              <div className="text-[9px] text-muted-foreground">📊 {forecast.forecast.factors.slice(0, 3).join(' · ')}</div>
            )}
            {forecast.forecast.recommendation && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                💡 {forecast.forecast.recommendation}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI napove dobiček za naslednji mesec (scenariji, faktorji, priporočila).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
