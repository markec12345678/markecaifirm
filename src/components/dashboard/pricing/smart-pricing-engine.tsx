'use client';

// v9.09: Extracted from pricing-view.tsx — AI Smart Pricing Engine

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function SmartPricingEngine() {
  const [smartPricing, setSmartPricing] = useState<any>(null);
  const [smartPricingLoading, setSmartPricingLoading] = useState(false);

  const runSmartPricing = async () => {
    setSmartPricingLoading(true); setSmartPricing(null);
    try {
      const res = await fetch('/api/ai/smart-pricing-engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setSmartPricing(data); toast.success('✓ Smart pricing generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setSmartPricingLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            AI Smart Pricing Engine
          </span>
          <Button size="sm" variant="outline" onClick={runSmartPricing} disabled={smartPricingLoading} className="h-6 text-xs gap-1.5">
            {smartPricingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {smartPricingLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI določa optimalne cene (10 faktorjev)...
          </div>
        ) : smartPricing?.pricing ? (
          <div className="space-y-2 text-xs">
            {smartPricing.pricing.adjustmentsSummary && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase text-primary">Adjustments</span>
                  <span className="font-mono text-primary">{smartPricing.pricing.adjustmentsSummary.totalItems ?? smartPricing.pricing.items?.length ?? 0} itemov</span>
                </div>
              </div>
            )}
            {smartPricing.pricing.items?.slice(0, 4).map((item: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px] truncate flex-1">{item.title || item.name}</span>
                  <Badge variant="outline" className={cn('text-[9px] ml-1',
                    item.adjustment?.includes('increase') ? 'text-primary border-primary/30' :
                    item.adjustment?.includes('decrease') ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                    {item.adjustment || item.strategy || '—'}
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {item.currentPrice ?? item.buyPrice}€ → <b className="text-primary">{item.recommendedPrice ?? item.suggestedPrice}€</b>
                  {item.reason && <span className="ml-1">· {item.reason}</span>}
                </div>
              </div>
            ))}
            {smartPricing.pricing.insights && (
              <div className="text-[9px] text-muted-foreground">💡 {smartPricing.pricing.insights}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI določa optimalne cene (10 faktorjev: days_held, deal_score, sezonost, konkurenca...).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
