'use client';

// v9.09: Extracted from inventory-view.tsx — AI Stockout Predictor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function StockoutPredictor() {
  const [stockout, setStockout] = useState<any>(null);
  const [stockoutLoading, setStockoutLoading] = useState(false);

  const runStockout = async () => {
    setStockoutLoading(true); setStockout(null);
    try {
      const res = await fetch('/api/ai/inventory-stockout-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setStockout(data); toast.success('✓ Stockout napoved generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setStockoutLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-500" />
            AI Stockout Predictor
          </span>
          <Button size="sm" variant="outline" onClick={runStockout} disabled={stockoutLoading} className="h-6 text-xs gap-1.5">
            {stockoutLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stockoutLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI napoveduje zmanjkanje zaloge...
          </div>
        ) : stockout?.predictor ? (
          <div className="space-y-2 text-xs">
            {stockout.predictor.current && (
              <div className={cn('border rounded p-2',
                stockout.predictor.current.stockoutRiskLevel === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                stockout.predictor.current.stockoutRiskLevel === 'high' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-card/30 border-border')}>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                    stockout.predictor.current.stockoutRiskLevel === 'critical' ? 'text-red-500 border-red-500/40' :
                    stockout.predictor.current.stockoutRiskLevel === 'high' ? 'text-amber-400 border-amber-400/40' : 'text-primary border-primary/40')}>
                    {stockout.predictor.current.stockoutRiskLevel} risk
                  </Badge>
                  <span className="text-[9px] text-muted-foreground">
                    ~{stockout.predictor.current.avgDaysToSell}d za prodajo · {stockout.predictor.current.stockCoverageDays}d pokritje
                  </span>
                </div>
              </div>
            )}
            {stockout.predictor.predictions?.slice(0, 4).map((p: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px]">{p.category || `Kategorija ${i + 1}`}</span>
                  <Badge variant="outline" className={cn('text-[9px]',
                    p.urgency === 'immediate' ? 'text-red-500 border-red-500/30' :
                    p.urgency === '7d' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                    {p.urgency}
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {p.currentStock} na zalogi · {p.dailySellRate}/d · še {p.daysUntilStockout}d
                </div>
                {p.stockoutProbabilityPct > 50 && (
                  <div className="text-[9px] text-red-500 mt-0.5">
                    ⚠️ {p.stockoutProbabilityPct}% verjetnost stockout-a
                  </div>
                )}
              </div>
            ))}
            {stockout.predictor.insights && (
              <div className="text-[9px] text-muted-foreground">💡 {stockout.predictor.insights}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI napove kdaj bo zmanjkalo zaloge (ARIMA/LSTM/Prophet modeli).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
