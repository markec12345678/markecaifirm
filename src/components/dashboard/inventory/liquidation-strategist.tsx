'use client';

// v9.09: Extracted from inventory-view.tsx — AI Liquidation Strategist

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

export function LiquidationStrategist() {
  const [liquidation, setLiquidation] = useState<any>(null);
  const [liquidationLoading, setLiquidationLoading] = useState(false);

  const runLiquidation = async () => {
    setLiquidationLoading(true); setLiquidation(null);
    try {
      const res = await fetch('/api/ai/inventory-liquidation-strategist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setLiquidation(data); toast.success('✓ Likvidacijska strategija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setLiquidationLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-400" />
            AI Liquidation Strategist
          </span>
          <Button size="sm" variant="outline" onClick={runLiquidation} disabled={liquidationLoading} className="h-6 text-xs gap-1.5">
            {liquidationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {liquidationLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI pripravlja strategijo likvidacije...
          </div>
        ) : liquidation?.strategist ? (
          <div className="space-y-2 text-xs">
            {liquidation.strategist.insights && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-[10px]">
                💡 {liquidation.strategist.insights}
              </div>
            )}
            {liquidation.strategist.items?.slice(0, 4).map((item: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px] truncate flex-1">{item.title}</span>
                  <Badge variant="outline" className="text-[9px] ml-1">{item.strategy || item.urgency}</Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {item.daysHeld}d · {item.suggestedAction || item.recommendation}
                </div>
              </div>
            ))}
            {liquidation.strategist.summary && (
              <div className="text-[9px] text-muted-foreground border-t border-border pt-1">
                📊 {liquidation.strategist.summary.itemsToLiquidate ?? 0} za likvidacijo · {liquidation.strategist.summary.potentialRecoveryEur ?? 0}€
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI predlaga likvidacijo (flash sale, bundle, donation, scrap) za stagnantne iteme.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
