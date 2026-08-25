'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer CLV Predictor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface BuyerClvProps {
  selectedBuyer: string;
}

export function BuyerClv({ selectedBuyer }: BuyerClvProps) {
  const [clv, setClv] = useState<Record<string, any> | null>(null);
  const [clvLoading, setClvLoading] = useState(false);

  const runClv = async () => { if (!selectedBuyer) { toast.error('Izberi kupca'); return; } setClvLoading(true); setClv(null); try { const r = await fetch('/api/ai/buyer-clv-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: selectedBuyer }) }); const d = await r.json(); if (d.ok) { setClv(d); toast.success('✓ CLV napoved generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setClvLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> AI CLV Predictor</span>
          <Button size="sm" variant="outline" onClick={runClv} disabled={clvLoading} className="h-6 text-xs gap-1.5">
            {clvLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {clvLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje Customer Lifetime Value...</div>
        ) : clv?.predictor ? (
          <div className="space-y-2 text-xs">
            <div className="bg-primary/10 border border-primary/30 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-primary font-bold">Pričakovan CLV</span>
                <span className="font-mono font-bold text-primary text-lg">{clv?.predictor.clv ?? clv?.predictor?.lifetimeValue ?? '?'}€</span>
              </div>
            </div>
            {clv?.predictor.tier && <div className="text-[10px]"><Badge variant="outline" className="text-[9px]">{clv?.predictor.tier}</Badge></div>}
            {clv?.predictor.insights && <div className="text-[9px] text-muted-foreground">💡 {clv?.predictor.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI napove Customer Lifetime Value (napoved dolgoročne vrednosti kupca).</p>
        )}
      </CardContent>
    </Card>
  );
}
