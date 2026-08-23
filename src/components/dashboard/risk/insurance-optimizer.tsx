'use client';

// v9.09: Extracted from risk-view.tsx — AI Insurance Optimizer v2

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Umbrella } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InsuranceOptimizer() {
  const [insurance, setInsurance] = useState<any>(null);
  const [insuranceLoading, setInsuranceLoading] = useState(false);

  const runInsurance = async () => {
    setInsuranceLoading(true); setInsurance(null);
    try {
      const res = await fetch('/api/ai/insurance-optimizer-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setInsurance(data); toast.success('✓ Zavarovalna optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setInsuranceLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Umbrella className="w-4 h-4 text-blue-400" /> AI Insurance Optimizer v2</span>
          <Button size="sm" variant="outline" onClick={runInsurance} disabled={insuranceLoading} className="h-6 text-xs gap-1.5">
            {insuranceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Umbrella className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {insuranceLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira 4D risk matrix (7 kategorij)...</div>
        ) : insurance?.optimizer ? (
          <div className="space-y-2 text-xs">
            {insurance.optimizer.riskMatrix?.slice(0, 3).map((r: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium">{r.category}</span>
                  <Badge variant="outline" className={cn('text-[9px]',
                    (r.theftRisk ?? r.riskScore ?? 0) >= 70 ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>
                    Risk: {r.theftRisk ?? r.riskScore ?? 0}
                  </Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  Krađa: {r.theftRisk ?? '?'} · Poškodba: {r.damageRisk ?? '?'} · Depreciacija: {r.depreciationRisk ?? '?'}
                </div>
              </div>
            ))}
            {insurance.optimizer.policies?.slice(0, 2).map((p: any, i: number) => (
              <div key={i} className="bg-blue-400/5 border border-blue-400/20 rounded p-2 text-[10px]">
                <b className="text-blue-400">{p.type || p.name}</b> — {p.coverage ?? p.description} · {p.premiumEur ?? p.cost ?? '?'}€/leto
              </div>
            ))}
            {insurance.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {insurance.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI 4D risk matrix (7 kategorij: elektronika, telefoni, avto, nepremičnine...) + police.</p>
        )}
      </CardContent>
    </Card>
  );
}
