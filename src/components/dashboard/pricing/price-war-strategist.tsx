'use client';

// v9.09: Extracted from pricing-view.tsx — AI Price War Strategist

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Swords } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function PriceWarStrategist() {
  const [priceWar, setPriceWar] = useState<Record<string, any> | null>(null);
  const [priceWarLoading, setPriceWarLoading] = useState(false);

  const runPriceWar = async () => {
    setPriceWarLoading(true); setPriceWar(null);
    try {
      const res = await fetch('/api/ai/price-war-strategist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setPriceWar(data); toast.success('✓ Price war strategija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setPriceWarLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-red-500" />
            AI Price War Strategist
          </span>
          <Button size="sm" variant="outline" onClick={runPriceWar} disabled={priceWarLoading} className="h-6 text-xs gap-1.5">
            {priceWarLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Swords className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {priceWarLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira cenovne vojne...
          </div>
        ) : priceWar?.strategist ? (
          <div className="space-y-2 text-xs">
            {priceWar?.strategist.wars?.slice(0, 3).map((w: Record<string, any>, i: number) => (
              <div key={i} className={cn('border rounded p-2',
                w.threatLevel === 'high' ? 'bg-red-500/5 border-red-500/20' : 'bg-card/30 border-border')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px]">{w.category || w.name}</span>
                  <Badge variant="outline" className={cn('text-[9px]',
                    w.threatLevel === 'high' ? 'text-red-500 border-red-500/30' :
                    w.threatLevel === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-primary border-primary/30')}>
                    {w.threatLevel || w.severity}
                  </Badge>
                </div>
                {w.strategy && <div className="text-[9px] text-muted-foreground">→ {w.strategy}</div>}
                {w.priceDrops != null && <div className="text-[9px] text-amber-400">{w.priceDrops} padcev cen</div>}
              </div>
            ))}
            {priceWar?.strategist.strategies?.slice(0, 2).map((s: Record<string, any>, i: number) => (
              <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] font-medium text-primary">{s.strategy || s.name}</div>
                <div className="text-[9px] text-muted-foreground">{s.description || s.action}</div>
              </div>
            ))}
            {priceWar?.strategist.insights && (
              <div className="text-[9px] text-muted-foreground">💡 {priceWar?.strategist.insights}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI zazna cenovne vojne in predlaga obrambne/ofenzivne strategije.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
