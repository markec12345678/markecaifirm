'use client';

// v9.09: Extracted from inventory-view.tsx — AI Inventory Aging

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InventoryAging() {
  const [aging, setAging] = useState<Record<string, any> | null>(null);
  const [agingLoading, setAgingLoading] = useState(false);

  const runAging = async () => {
    setAgingLoading(true); setAging(null);
    try {
      const res = await fetch('/api/ai/inventory-aging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setAging(data); toast.success('✓ Aging analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setAgingLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            AI Inventory Aging
          </span>
          <Button size="sm" variant="outline" onClick={runAging} disabled={agingLoading} className="h-6 text-xs gap-1.5">
            {agingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {agingLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI analizira staranje inventarja...
          </div>
        ) : aging?.alerts?.length > 0 ? (
          <div className="space-y-2 text-xs">
            {aging?.insights && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-[10px]">
                💡 {aging?.insights}
              </div>
            )}
            {aging?.alerts.slice(0, 5).map((a: Record<string, any>, i: number) => (
              <div key={i} className={cn('border rounded p-2',
                a.urgency === 'critical' ? 'bg-red-500/5 border-red-500/20' :
                a.urgency === 'high' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-card/30 border-border')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px] truncate flex-1">{a.title}</span>
                  <Badge variant="outline" className={cn('text-[9px] ml-1',
                    a.urgency === 'critical' ? 'text-red-500 border-red-500/30' :
                    a.urgency === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>
                    {a.agingStage || a.urgency}
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {a.daysHeld}d · {a.holdingCost}€ · → {a.action}
                </div>
              </div>
            ))}
            {aging?.summary && (
              <div className="text-[9px] text-muted-foreground border-t border-border pt-1">
                📊 {aging?.summary.totalItems ?? aging?.alerts?.length} itemov · {aging?.summary.stalledCount ?? 0} stagnira
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI opozori na iteme, ki predolgo ležijo (stagnirajoči, drago za vzdrževanje).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
