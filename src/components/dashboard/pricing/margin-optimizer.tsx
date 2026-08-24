'use client';

// v9.09: Extracted from pricing-view.tsx — AI Margin Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Percent } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function MarginOptimizer() {
  const [margin, setMargin] = useState<any>(null);
  const [marginLoading, setMarginLoading] = useState(false);

  const runMargin = async () => {
    setMarginLoading(true); setMargin(null);
    try {
      const res = await fetch('/api/ai/margin-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setMargin(data); toast.success('✓ Optimizacija marže generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setMarginLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Percent className="w-4 h-4 text-amber-400" />
            AI Margin Optimizer
          </span>
          <Button size="sm" variant="outline" onClick={runMargin} disabled={marginLoading} className="h-6 text-xs gap-1.5">
            {marginLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Percent className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {marginLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI optimizira marže...
          </div>
        ) : margin?.items?.length > 0 ? (
          <div className="space-y-2 text-xs">
            {margin.items.slice(0, 4).map((item: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px] truncate flex-1">{item.title || item.name}</span>
                  <Badge variant="outline" className={cn('text-[9px] ml-1',
                    (item.currentMargin ?? item.margin ?? 0) >= 25 ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>
                    {item.currentMargin ?? item.margin ?? 0}%
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {item.buyPrice}€ → {item.suggestedSellPrice ?? item.optimalPrice ?? '?'}€
                  {item.recommendedAction && <span> · {item.recommendedAction}</span>}
                </div>
              </div>
            ))}
            {margin.summary?.summary && (
              <div className="text-[9px] text-muted-foreground">💡 {margin.summary.summary}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI optimizira marže (predlagane cene, akcije za povečanje dobička).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
