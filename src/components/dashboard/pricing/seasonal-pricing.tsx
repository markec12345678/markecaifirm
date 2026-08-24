'use client';

// v9.09: Extracted from pricing-view.tsx — AI Seasonal Pricing

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function SeasonalPricing() {
  const [seasonal, setSeasonal] = useState<any>(null);
  const [seasonalLoading, setSeasonalLoading] = useState(false);

  const runSeasonal = async () => {
    setSeasonalLoading(true); setSeasonal(null);
    try {
      const res = await fetch('/api/ai/seasonal-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setSeasonal(data); toast.success('✓ Sezonsko določanje cen generirano'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setSeasonalLoading(false); }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            AI Seasonal Pricing
          </span>
          <Button size="sm" variant="outline" onClick={runSeasonal} disabled={seasonalLoading} className="h-6 text-xs gap-1.5">
            {seasonalLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {seasonalLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira sezonske vzorce cen...
          </div>
        ) : seasonal?.pricing ? (
          <div className="space-y-2 text-xs">
            {seasonal.pricing.seasonalFactors?.slice(0, 4).map((f: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px]">{f.season || f.month || f.factor}</span>
                  <Badge variant="outline" className={cn('text-[9px]',
                    (f.priceMultiplier ?? f.adjustment ?? 1) >= 1 ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>
                    {f.priceMultiplier ?? f.adjustment ?? 1}×
                  </Badge>
                </div>
                {f.recommendation && <div className="text-[9px] text-muted-foreground">{f.recommendation}</div>}
              </div>
            ))}
            {seasonal.pricing.items?.slice(0, 3).map((item: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium truncate flex-1">{item.title || item.name}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {item.currentPrice ?? item.buyPrice}€ → <b className="text-primary">{item.seasonalPrice ?? item.recommendedPrice ?? '?'}€</b>
                  </span>
                </div>
              </div>
            ))}
            {seasonal.pricing.insights && (
              <div className="text-[9px] text-muted-foreground">💡 {seasonal.pricing.insights}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI analizira sezonske vzorce cen (12-mesečni patterni, 4 letni časi: Zima/Pomlad/Poletje/Jesen).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
