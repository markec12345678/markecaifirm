'use client';

// v9.09: Extracted from inventory-view.tsx — AI Depreciation Tracker

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function DepreciationTracker() {
  const [depreciation, setDepreciation] = useState<any>(null);
  const [depreciationLoading, setDepreciationLoading] = useState(false);

  const runDepreciation = async () => {
    setDepreciationLoading(true); setDepreciation(null);
    try {
      const r = await fetch('/api/ai/inventory-depreciation-tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) { setDepreciation(d); toast.success('✓ Depreciation tracker generiran'); }
      else toast.error(d.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setDepreciationLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" /> AI Depreciation Tracker</span>
          <Button size="sm" variant="outline" onClick={runDepreciation} disabled={depreciationLoading} className="h-6 text-xs gap-1.5">
            {depreciationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingDown className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {depreciationLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI sledi depreciaciji inventarja...</div>
        ) : depreciation?.tracker ? (
          <div className="space-y-2 text-xs">
            {depreciation.tracker.items?.slice(0, 4).map((item: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium truncate flex-1">{item.title || item.name}</span>
                  <Badge variant="outline" className={cn('text-[9px]', (item.depreciationPct ?? 0) > 30 ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                    -{item.depreciationPct ?? item.lossPct ?? '?'}%
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {item.originalValue ?? item.buyPrice}€ → <b className="text-red-500">{item.currentValue ?? item.depreciatedValue ?? '?'}€</b>
                </div>
              </div>
            ))}
            {depreciation.tracker.insights && <div className="text-[9px] text-muted-foreground">💡 {depreciation.tracker.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI sledi depreciaciji vrednosti inventarja skozi čas.</p>
        )}
      </CardContent>
    </Card>
  );
}
