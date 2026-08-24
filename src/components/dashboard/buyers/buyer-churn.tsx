'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Churn Prevention

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BuyerChurnProps {
  selectedBuyer: string;
}

export function BuyerChurn({ selectedBuyer }: BuyerChurnProps) {
  const [churn, setChurn] = useState<any>(null);
  const [churnLoading, setChurnLoading] = useState(false);

  const runChurn = async () => { if (!selectedBuyer) { toast.error('Izberi kupca'); return; } setChurnLoading(true); setChurn(null); try { const r = await fetch('/api/ai/buyer-churn-prevention-strategist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: selectedBuyer }) }); const d = await r.json(); if (d.ok) { setChurn(d); toast.success('✓ Churn strategija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setChurnLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Heart className="w-4 h-4 text-red-500" /> AI Churn Prevention</span>
          <Button size="sm" variant="outline" onClick={runChurn} disabled={churnLoading} className="h-6 text-xs gap-1.5">
            {churnLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {churnLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI pripravlja strategijo proti izgubi kupca...</div>
        ) : churn?.strategist ? (
          <div className="space-y-2 text-xs">
            {churn.strategist.churnRisk != null && (
              <div className={cn('border rounded p-2', churn.strategist.churnRisk >= 70 ? 'bg-red-500/10 border-red-500/30' : churn.strategist.churnRisk >= 40 ? 'bg-amber-400/10 border-amber-400/30' : 'bg-primary/10 border-primary/30')}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold">Tveganje izgube</span>
                  <span className="font-mono font-bold">{churn.strategist.churnRisk}%</span>
                </div>
              </div>
            )}
            {churn.strategist.strategies?.slice(0, 3).map((s: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="text-[10px] font-medium">{s.strategy || s.action || s.name}</div>
                <div className="text-[9px] text-muted-foreground">{s.description || s.detail}</div>
              </div>
            ))}
            {churn.strategist.insights && <div className="text-[9px] text-muted-foreground">💡 {churn.strategist.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI predlaga strategijo za preprečitev izgube kupca (churn prevention).</p>
        )}
      </CardContent>
    </Card>
  );
}
