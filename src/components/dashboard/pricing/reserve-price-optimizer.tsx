'use client';

// v9.09: Extracted from pricing-view.tsx — AI Reserve Price Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Target } from 'lucide-react';
import { toast } from 'sonner';

export function ReservePriceOptimizer() {
  const [reservePrice, setReservePrice] = useState<any>(null);
  const [reservePriceLoading, setReservePriceLoading] = useState(false);

  const runReservePrice = async () => { setReservePriceLoading(true); setReservePrice(null); try { const r = await fetch('/api/ai/reserve-price-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setReservePrice(d); toast.success('✓ Reserve price generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setReservePriceLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" /> AI Reserve Price Optimizer</span>
          <Button size="sm" variant="outline" onClick={runReservePrice} disabled={reservePriceLoading} className="h-6 text-xs gap-1.5">
            {reservePriceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reservePriceLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira reserve price...</div>
        ) : reservePrice?.optimizer ? (
          <div className="space-y-2 text-xs">
            <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-amber-400">Priporočen reserve price</span>
                <span className="font-mono font-bold text-amber-400">{reservePrice.optimizer.reservePrice ?? reservePrice.optimizer.suggestedPrice ?? '?'}€</span>
              </div>
            </div>
            {reservePrice.optimizer.reasoning && <div className="text-[9px] text-muted-foreground">{reservePrice.optimizer.reasoning}</div>}
            {reservePrice.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {reservePrice.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI optimizira reserve price za dražbe (minimalna sprejemljiva cena).</p>
        )}
      </CardContent>
    </Card>
  );
}
