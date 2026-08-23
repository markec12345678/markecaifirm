'use client';

// v9.09: Extracted from inventory-view.tsx — AI Carrying Cost

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';

export function CarryingCost() {
  const [carryingCost, setCarryingCost] = useState<any>(null);
  const [carryingCostLoading, setCarryingCostLoading] = useState(false);

  const runCarryingCost = async () => {
    setCarryingCostLoading(true); setCarryingCost(null);
    try {
      const r = await fetch('/api/ai/inventory-carrying-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) { setCarryingCost(d); toast.success('✓ Carrying cost analiza generirana'); }
      else toast.error(d.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setCarryingCostLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Wallet className="w-4 h-4 text-amber-400" /> AI Carrying Cost</span>
          <Button size="sm" variant="outline" onClick={runCarryingCost} disabled={carryingCostLoading} className="h-6 text-xs gap-1.5">
            {carryingCostLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {carryingCostLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira stroške držanja inventarja...</div>
        ) : carryingCost?.analyzer ? (
          <div className="space-y-2 text-xs">
            <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-amber-400">Skupni stroški/mesec</span>
                <span className="font-mono font-bold text-amber-400">{carryingCost.analyzer.totalCarryingCost ?? carryingCost.analyzer.monthlyCost ?? '?'}€</span>
              </div>
            </div>
            {carryingCost.analyzer.breakdown?.slice(0, 3).map((b: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{b.category || b.type}</span>
                <span className="font-mono text-[10px]">{b.costEur ?? b.amount ?? '?'}€</span>
              </div>
            ))}
            {carryingCost.analyzer.insights && <div className="text-[9px] text-muted-foreground">💡 {carryingCost.analyzer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI analizira stroške držanja inventarja (shranjevanje, zavarovanje, kapital).</p>
        )}
      </CardContent>
    </Card>
  );
}
