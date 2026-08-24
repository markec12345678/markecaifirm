'use client';

// v9.02: Extracted from statistics-view.tsx — AI Inventory Aging Alert System (v6.24)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InventoryAging() {
  const [agingData, setAgingData] = useState<Record<string, any> | null>(null);
  const [agingLoading, setAgingLoading] = useState(false);

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Inventory Aging Alert System
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.24</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI sledi staranju inventarja in opozarja na zastarele iteme z holding cost.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" className="gap-2 h-7 text-xs" disabled={agingLoading}
          onClick={async () => {
            setAgingLoading(true); setAgingData(null);
            try {
              const res = await fetch('/api/ai/inventory-aging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
              const data = await res.json();
              if (data.ok) { setAgingData(data); toast.success('✓ Aging analiza generirana'); }
              else toast.error(data.error ?? data.message ?? 'Napaka');
            } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
            finally { setAgingLoading(false); }
          }}>
          {agingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Analiziraj staranje
        </Button>
        {agingLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira staranje inventarja in holding cost...</div>
        ) : agingData ? (
          <div className="space-y-2 text-xs">
            {agingData.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{agingData.insights}</div>}
            {agingData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Itemov</div><div className="font-bold">{agingData.summary.totalItems ?? 0}</div></div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5"><div className="text-amber-400 uppercase">Holding cost</div><div className="font-bold text-amber-400">{agingData.summary.totalHoldingCostEur ?? 0}€</div></div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5"><div className="text-red-500 uppercase">Kritičnih</div><div className="font-bold text-red-500">{agingData.summary.criticalCount ?? 0}</div></div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5"><div className="text-red-500 uppercase">Možna izguba</div><div className="font-bold text-destructive">{agingData.summary.potentialLossEur ?? 0}€</div></div>
              </div>
            )}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {agingData.alerts?.map((a: Record<string, any>, i: number) => {
                const urgencyCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  critical: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  high: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  medium: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  low: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                };
                const cfg = urgencyCfg[a.urgency] || urgencyCfg.medium;
                return (
                  <div key={i} className={cn('border rounded p-1.5 space-y-1', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px] truncate">{a.title}</span>
                      </div>
                      <Badge variant="outline" className={cn('text-[8px] uppercase shrink-0', cfg.color)}>{a.agingStage}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div><span className="text-muted-foreground">Dan v skladišču:</span> <b>{a.daysHeld}d</b></div>
                      <div><span className="text-muted-foreground">Holding:</span> <b className="text-amber-400">{a.totalHoldingCostEur}€</b></div>
                      <div><span className="text-muted-foreground">Dobiček:</span> <b className={a.adjustedProfitEur >= 0 ? 'text-primary' : 'text-destructive'}>{a.adjustedProfitEur}€</b></div>
                      <div><span className="text-muted-foreground">Popust:</span> <b className="text-amber-400">−{a.suggestedDiscountPct}%</b></div>
                    </div>
                    <div className="flex items-center justify-between text-[9px]">
                      <Badge variant="outline" className="text-[8px]">→ {a.action.replace('_', ' ')}</Badge>
                      <span className="text-primary font-bold">💡 {a.suggestedPriceEur}€ · ⏱ {a.deadlineDays}d</span>
                    </div>
                    {a.reasoning && <div className="text-[9px] italic">{a.reasoning}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj staranje" za AI analizo zastarelega inventarja.</p>
        )}
      </CardContent>
    </Card>
  );
}
