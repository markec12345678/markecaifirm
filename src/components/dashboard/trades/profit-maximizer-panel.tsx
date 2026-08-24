'use client';

/**
 * v7.35: ProfitMaximizerPanel — optimal sell price recommendation.
 *
 * For held trades: "List at X€ for 70% sell probability in 14 days"
 * AI analyzes: category history, current market, item condition, seasonality.
 *
 * Helps avoid leaving money on the table (priced too low) or
 * inventory stagnation (priced too high).
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingUp, Target, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProfitMaximizerData {
  ok: boolean;
  analysis: {
    recommendedPriceEur: number;
    expectedProfitEur: number;
    expectedRoiPct: number;
    sellProbability7d: number;
    sellProbability14d: number;
    sellProbability30d: number;
    strategy: 'fast' | 'balanced' | 'patient';
    reasoning: string;
    alternativePrices: Array<{
      price: number;
      sellProbability: number;
      expectedProfit: number;
      timeframe: string;
    }>;
  };
}

export function ProfitMaximizerPanel({ tradeId }: { tradeId: string }) {
  const [data, setData] = useState<ProfitMaximizerData | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/profit-maximizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId }),
      });
      const json = await res.json();
      if (json.ok) {
        setData(json);
      } else {
        toast.error(json.error || 'Napaka pri analizi');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message || 'Napaka');
    } finally {
      setLoading(false);
    }
  }

  const strategyConfig = {
    fast: { label: 'HITRO', color: 'text-green-500 bg-green-500/10 border-green-500/30', icon: TrendingUp },
    balanced: { label: 'BALANSIRANO', color: 'text-primary bg-primary/10 border-primary/30', icon: Target },
    patient: { label: 'BOLNÍČNO', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', icon: DollarSign },
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> PROFIT MAXIMIZER
          </h4>
          {data?.analysis && (
            <Badge variant="outline" className={cn('text-[10px] border', strategyConfig[data.analysis.strategy].color)}>
              {strategyConfig[data.analysis.strategy].label}
            </Badge>
          )}
        </div>

        {!data && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              AI analiza: optimalna cena za prodajo z max profitom + verjetnost prodaje.
            </p>
            <Button onClick={analyze} disabled={loading} size="sm" className="w-full bg-gradient-to-r from-primary to-primary/80">
              {loading ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
                  AI analizira...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Najdi optimalno ceno
                </>
              )}
            </Button>
          </div>
        )}

        {data?.analysis && (
          <>
            {/* Recommended price — big */}
            <div className="text-center py-2">
              <div className="text-[10px] text-muted-foreground uppercase">Priporočena cena</div>
              <div className="text-3xl font-mono font-bold text-primary">
                {data.analysis.recommendedPriceEur}€
              </div>
              <div className={cn('text-sm font-mono font-bold', data.analysis.expectedProfitEur >= 0 ? 'text-green-500' : 'text-red-500')}>
                {data.analysis.expectedProfitEur >= 0 ? '+' : ''}{data.analysis.expectedProfitEur}€ dobiček ({data.analysis.expectedRoiPct}% ROI)
              </div>
            </div>

            {/* Sell probability */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">7 dni</div>
                <div className="font-mono font-bold text-amber-400">{data.analysis.sellProbability7d}%</div>
              </div>
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">14 dni</div>
                <div className="font-mono font-bold text-primary">{data.analysis.sellProbability14d}%</div>
              </div>
              <div className="bg-background/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">30 dni</div>
                <div className="font-mono font-bold text-green-500">{data.analysis.sellProbability30d}%</div>
              </div>
            </div>

            {/* Reasoning */}
            <p className="text-[11px] text-muted-foreground italic border-t border-border/30 pt-2">
              {data.analysis.reasoning}
            </p>

            {/* Alternative prices */}
            {data.analysis.alternativePrices.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase">Alternativne cene</div>
                {data.analysis.alternativePrices.map((alt, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-background/30 rounded">
                    <span className="font-mono font-bold">{alt.price}€</span>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground">{alt.sellProbability}% prodaja</div>
                      <div className={cn('text-[10px] font-mono', alt.expectedProfit >= 0 ? 'text-green-500' : 'text-red-500')}>
                        {alt.expectedProfit >= 0 ? '+' : ''}{alt.expectedProfit}€ • {alt.timeframe}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={analyze} variant="ghost" size="sm" className="w-full text-xs">
              ↻ Re-analiziraj
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
