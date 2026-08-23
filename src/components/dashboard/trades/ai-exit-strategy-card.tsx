'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Target } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIExitStrategyCardProps {
  data: any;
  onClear: () => void;
}

export function AIExitStrategyCard({ data, onClear }: AIExitStrategyCardProps) {
  if (!data) return null;

  return (
    <>
      {/* v6.9: AI Exit Strategy results */}
      <Card className="bg-amber-400/5 border-amber-400/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Target className="w-4 h-4" />
              AI Izhodna strategija
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.9</Badge>
            </h3>
            <Button size="sm" variant="ghost" onClick={onClear} className="h-6 text-xs">×</Button>
          </div>
          <div className="space-y-2 text-xs">
            <div className={cn('border rounded p-2',
              data.strategy.recommendation === 'sell_now' ? 'bg-red-500/5 border-red-500/20' :
              data.strategy.recommendation === 'sell_soon' ? 'bg-amber-400/5 border-amber-400/20' :
              data.strategy.recommendation === 'hold' ? 'bg-primary/5 border-primary/20' :
              'bg-blue-400/5 border-blue-400/20')}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm">
                  {data.strategy.recommendation === 'sell_now' ? '🔴 PRODAJ TAKOJ' :
                   data.strategy.recommendation === 'sell_soon' ? '🟡 PRODAJ KMALU' :
                   data.strategy.recommendation === 'hold' ? '🟢 OBDRŽI' : '📦 PAKETNA PRODAJA'}
                </span>
                <Badge variant="outline" className={cn('text-[9px]',
                  data.strategy.confidence >= 70 ? 'text-primary border-primary/40' : 'text-muted-foreground')}>
                  🎯 {data.strategy.confidence}%
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div><span className="text-muted-foreground">Cena:</span> <span className="font-mono font-bold text-primary">{data.strategy.suggestedPrice}€</span></div>
                <div><span className="text-muted-foreground">Timing:</span> <span className="font-bold">{data.strategy.timing}</span></div>
                <div><span className="text-muted-foreground">Strategija:</span> <span className="font-bold">{data.strategy.pricingStrategy}</span></div>
              </div>
              <p className="text-[10px] italic mt-1">{data.strategy.reasoning}</p>
            </div>
            {data.strategy.alternatives?.length > 0 && (
              <div className="bg-background/30 rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">💡 Alternative prodajne poti</div>
                <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                  {data.strategy.alternatives.map((alt: string, i: number) => <li key={i}>{alt}</li>)}
                </ul>
              </div>
            )}
            <div className="bg-background/30 rounded p-2 text-[10px] text-muted-foreground">
              📊 Tržno povprečje: {data.trade.marketAvg}€ • Konkurenca: {data.trade.marketCount} oglasov
              • {data.trade.daysHeld}d v skladišču • Kategorija ROI: {data.trade.avgCatROI}%
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
