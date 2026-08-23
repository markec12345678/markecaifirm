'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingDown, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AutoRepriceProps {
  onApplied?: () => void;
}

export function AutoReprice({ onApplied }: AutoRepriceProps) {
  const [repriceData, setRepriceData] = useState<any>(null);
  const [repriceLoading, setRepriceLoading] = useState(false);

  return (
    <>
      {/* v6.3: Auto-reprice button */}
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          setRepriceLoading(true); setRepriceData(null);
          try {
            const res = await fetch('/api/trades/auto-reprice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            const data = await res.json();
            if (data.ok) { setRepriceData(data); toast.success(`✓ ${data.needsReprice} od ${data.totalHeld} potrebuje reprice`); }
            else toast.error(data.error ?? 'Napaka');
          } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
          finally { setRepriceLoading(false); }
        }}
        disabled={repriceLoading}
        className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
        title="AI predlagaj cene za neprodane tradee"
      >
        {repriceLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingDown className="w-3.5 h-3.5" />}
        Auto-reprice
      </Button>

      {/* v6.3: Auto-reprice results */}
      {repriceData && !repriceLoading && (
        <Card className="bg-amber-400/5 border-amber-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" />
                AI Auto-Reprice — {repriceData.needsReprice} od {repriceData.totalHeld} potrebuje popust
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.3</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setRepriceData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {repriceData.repricing.filter((r: any) => r.needsReprice).map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-background/30 rounded text-xs border border-amber-400/20">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.currentPrice}€ → <span className="text-amber-400 font-bold">{r.suggestedPrice}€</span>
                      {' '}({r.dropPct > 0 ? '-' : '+'}{Math.abs(r.dropPct)}%)
                      {' • '}{r.daysHeld}d v skladišču
                      {r.marketAvg && ` • tržno povp: ${r.marketAvg}€`}
                    </div>
                    <div className="text-[10px] italic text-muted-foreground mt-0.5">{r.reason}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 shrink-0"
                    onClick={async () => {
                      try {
                        await fetch('/api/trades', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: r.tradeId, sellPrice: r.suggestedPrice }),
                        });
                        toast.success(`Cena posodobljena: ${r.suggestedPrice}€`);
                        onApplied?.();
                      } catch { toast.error('Napaka'); }
                    }}
                  >
                    <Check className="w-3 h-3" /> Uporabi
                  </Button>
                </div>
              ))}
              {repriceData.repricing.filter((r: any) => r.needsReprice).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">✅ Vsi tradei imajo ustrezno ceno — reprice ni potreben.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
