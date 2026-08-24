'use client';

// v9.02: Extracted from statistics-view.tsx — AI Predictive Procurement (v6.30 MILESTONE)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function PredictiveProcurement() {
  const [procData, setProcData] = useState<Record<string, any> | null>(null);
  const [procLoading, setProcLoading] = useState(false);
  const [procBudget, setProcBudget] = useState('');
  const [procRisk, setProcRisk] = useState<'low' | 'medium' | 'high'>('medium');

  return (
    <Card className="bg-card/50 border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          🛒 AI Predictive Procurement
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.30 MILESTONE</Badge>
        </CardTitle>
        <CardDescription className="text-xs">Avtomatski nakupovalni načrt z monitor setup in automation config per item.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <Input type="number" placeholder="Budget (€)" value={procBudget} onChange={(e) => setProcBudget(e.target.value)} className="h-7 text-xs w-32" />
          <select value={procRisk} onChange={(e) => setProcRisk(e.target.value as any)} className="h-7 text-xs bg-background border rounded px-2">
            <option value="low">🛡️ Low risk</option>
            <option value="medium">⚖️ Medium</option>
            <option value="high">🔥 High risk</option>
          </select>
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={procLoading}
            onClick={async () => {
              setProcLoading(true); setProcData(null);
              try {
                const res = await fetch('/api/ai/predictive-procurement', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ budget: procBudget ? Number(procBudget) : undefined, riskTolerance: procRisk }),
                });
                const data = await res.json();
                if (data.ok) { setProcData(data); toast.success('✓ Procurement načrt generiran'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
              finally { setProcLoading(false); }
            }}>
            {procLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generiraj načrt
          </Button>
        </div>
        {procLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI ustvarja procurement načrt...</div>
        ) : procData?.procurement ? (
          <div className="space-y-2 text-xs">
            {procData.procurement.expectedOutcomes && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Investicija</div><div className="font-bold">{procData.procurement.expectedOutcomes.totalInvestmentEur ?? 0}€</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Prihodek</div><div className="font-bold">{procData.procurement.expectedOutcomes.expectedRevenueEur ?? 0}€</div></div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Dobiček</div><div className="font-bold text-primary">{procData.procurement.expectedOutcomes.expectedProfitEur ?? 0}€</div></div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">ROI</div><div className="font-bold text-primary">{procData.procurement.expectedOutcomes.expectedRoiPct ?? 0}%</div></div>
              </div>
            )}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {procData.procurement.plan?.map((p: Record<string, any>, i: number) => (
                <div key={i} className={cn('border rounded p-1.5 space-y-0.5',
                  p.riskLevel === 'high' ? 'bg-red-500/5 border-red-500/20' :
                  p.riskLevel === 'medium' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-primary/5 border-primary/20')}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-[10px] truncate">#{p.priority} {p.itemDescription}</span>
                    <Badge variant="outline" className="text-[8px] text-primary shrink-0">{p.expectedRoiPct}%</Badge>
                  </div>
                  <div className="text-[9px] text-muted-foreground">📍 {p.source} · 💰 {p.maxBuyPriceEur}€→{p.expectedSellPriceEur}€ · ⏱ {p.expectedDaysToSell}d</div>
                  {p.automation?.monitorSetup && <div className="text-[9px] text-primary">🤖 {p.automation.monitorSetup}</div>}
                </div>
              ))}
            </div>
            {procData.procurement.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] text-primary">{procData.procurement.insights}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni za AI procurement načrt z avtomatizacijo.</p>
        )}
      </CardContent>
    </Card>
  );
}
