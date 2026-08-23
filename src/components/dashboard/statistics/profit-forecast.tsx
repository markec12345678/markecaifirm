'use client';

// v9.01: Extracted from statistics-view.tsx — AI Profit Forecast (v6.8)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ProfitForecast() {
  // v6.8: Profit forecast
  const [forecastData, setForecastData] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  return (
    <>
      {/* v6.8: AI Profit Forecast */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Napoved dobička
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.8</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove pričakovani dobiček za naslednji mesec glede na zgodovino.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={forecastLoading}
            onClick={async () => {
              setForecastLoading(true); setForecastData(null);
              try {
                const res = await fetch('/api/ai/profit-forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: 1 }) });
                const data = await res.json();
                if (data.ok) { setForecastData(data); toast.success(`✓ Pričakovan dobiček: ${data.forecast.expectedProfit}€`); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setForecastLoading(false); }
            }}>
            {forecastLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Napovej dobiček
          </Button>
          {forecastLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira zgodovino...</div>
          ) : forecastData ? (
            <div className="space-y-2 text-xs">
              <div className={cn('border rounded p-2 text-center',
                forecastData.forecast.expectedProfit > 0 ? 'bg-primary/5 border-primary/20' : 'bg-red-500/5 border-red-500/20')}>
                <div className="text-[10px] text-muted-foreground uppercase">Pričakovan dobiček</div>
                <div className={cn('text-2xl font-bold font-mono', forecastData.forecast.expectedProfit > 0 ? 'text-primary' : 'text-red-500')}>
                  {forecastData.forecast.expectedProfit > 0 ? '+' : ''}{forecastData.forecast.expectedProfit}€
                </div>
                <Badge variant="outline" className={cn('text-[9px] mt-1',
                  forecastData.forecast.confidence >= 70 ? 'text-primary border-primary/40' :
                  forecastData.forecast.confidence >= 40 ? 'text-amber-400 border-amber-400/40' : 'text-red-500 border-red-500/40')}>
                  🎯 {forecastData.forecast.confidence}% zaupanje
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '🟢 Optimistično', data: forecastData.forecast.scenarios.optimistic },
                  { label: '🟡 Realno', data: forecastData.forecast.scenarios.realistic },
                  { label: '🔴 Pesimistično', data: forecastData.forecast.scenarios.pessimistic },
                ].map(s => (
                  <div key={s.label} className="bg-background/30 rounded p-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">{s.label}</div>
                    <div className="font-mono font-bold text-sm">{s.data.profit}€</div>
                    <div className="text-[8px] text-muted-foreground">{s.data.probability}%</div>
                  </div>
                ))}
              </div>
              {forecastData.forecast.factors?.length > 0 && (
                <div className="bg-background/30 rounded p-2">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Faktorji</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                    {forecastData.forecast.factors.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {forecastData.forecast.recommendation && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{forecastData.forecast.recommendation}</div>
              )}
              <div className="bg-background/30 rounded p-2 text-[10px] text-muted-foreground">
                📈 Zadnjih 6 mesecev: {forecastData.historicalData.monthlyProfits.map((m: any) => `${m.profit}€`).join(' → ')}
                <br />📊 Povprečno: {forecastData.historicalData.avgMonthlyProfit}€/mesec • Trend: {forecastData.historicalData.trendPct > 0 ? '+' : ''}{forecastData.historicalData.trendPct}%
                <br />💼 V skladišču: {forecastData.historicalData.heldCount} itemov, potencial: {forecastData.historicalData.heldPotential}€
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej dobiček" za AI napoved.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
