'use client';

// v9.09: Extracted from risk-view.tsx — AI Risk Hedging

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Shield } from 'lucide-react';
import { toast } from 'sonner';

export function RiskHedging() {
  const [hedging, setHedging] = useState<Record<string, any> | null>(null);
  const [hedgingLoading, setHedgingLoading] = useState(false);

  const runHedging = async () => {
    setHedgingLoading(true); setHedging(null);
    try {
      const res = await fetch('/api/ai/risk-hedging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setHedging(data); toast.success('✓ Hedge strategije generirane'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setHedgingLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-red-500" /> AI Risk Hedging</span>
          <Button size="sm" variant="outline" onClick={runHedging} disabled={hedgingLoading} className="h-6 text-xs gap-1.5">
            {hedgingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hedgingLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira 8 hedge strategij...</div>
        ) : hedging?.hedging ? (
          <div className="space-y-2 text-xs">
            {hedging?.hedging.hedges?.slice(0, 4).map((h: Record<string, any>, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30">{h.type || h.strategy}</Badge>
                  <span className="text-[9px] text-muted-foreground">{h.coveragePct ?? h.coverage ?? 0}% pokritost</span>
                </div>
                <div className="text-[10px] font-medium">{h.action || h.description}</div>
              </div>
            ))}
            {hedging?.hedging.recommendations?.slice(0, 2).map((r: Record<string, any>, i: number) => (
              <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">💡 {r.recommendation || r.action}</div>
            ))}
            {hedging?.hedging?.insights && <div className="text-[9px] text-muted-foreground">💡 {hedging?.hedging.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI predlaga 8 hedge strategij (diversifikacija, counterweight, likvidnost, sezonsko...).</p>
        )}
      </CardContent>
    </Card>
  );
}
