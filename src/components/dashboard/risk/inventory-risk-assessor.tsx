'use client';

// v9.09: Extracted from risk-view.tsx — AI Inventory Risk Assessor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InventoryRiskAssessor() {
  const [invRisk, setInvRisk] = useState<any>(null);
  const [invRiskLoading, setInvRiskLoading] = useState(false);

  const runInvRisk = async () => { setInvRiskLoading(true); setInvRisk(null); try { const r = await fetch('/api/ai/inventory-risk-assessor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setInvRisk(d); toast.success('✓ Inventory risk ocenjen'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setInvRiskLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-amber-400" /> AI Inventory Risk Assessor</span>
          <Button size="sm" variant="outline" onClick={runInvRisk} disabled={invRiskLoading} className="h-6 text-xs gap-1.5">
            {invRiskLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {invRiskLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI ocenjuje tveganja inventarja...</div>
        ) : invRisk?.assessor ? (
          <div className="space-y-2 text-xs">
            {invRisk.assessor.risks?.slice(0, 3).map((r: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium">{r.risk || r.type}</span>
                  <Badge variant="outline" className={cn('text-[9px]', (r.score ?? r.probability ?? 0) >= 70 ? 'text-red-500 border-red-500/30' : 'text-amber-400 border-amber-400/30')}>{r.score ?? r.probability ?? '?'}%</Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">{r.mitigation || r.action}</div>
              </div>
            ))}
            {invRisk.assessor.insights && <div className="text-[9px] text-muted-foreground">💡 {invRisk.assessor.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI oceni tveganja inventarja (poškodbe, zastaranje, krađa, likvidnost).</p>
        )}
      </CardContent>
    </Card>
  );
}
