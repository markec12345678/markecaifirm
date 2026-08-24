'use client';

// v9.09: Extracted from risk-view.tsx — AI Risk Parity

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Scale } from 'lucide-react';
import { toast } from 'sonner';

export function RiskParity() {
  const [parity, setParity] = useState<Record<string, any> | null>(null);
  const [parityLoading, setParityLoading] = useState(false);

  const runParity = async () => {
    setParityLoading(true); setParity(null);
    try {
      const res = await fetch('/api/ai/risk-parity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setParity(data); toast.success('✓ Risk parity analiza generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setParityLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Scale className="w-4 h-4 text-amber-400" /> AI Risk Parity</span>
          <Button size="sm" variant="outline" onClick={runParity} disabled={parityLoading} className="h-6 text-xs gap-1.5">
            {parityLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Scale className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {parityLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI računa risk parity alokacijo...</div>
        ) : parity ? (
          <div className="space-y-2 text-xs">
            {parity?.currentAllocation?.slice(0, 3).map((a: Record<string, any>, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{a.category}</span>
                <span className="font-mono text-[10px] text-amber-400">{a.percentage ?? a.allocation ?? 0}%</span>
              </div>
            ))}
            {parity?.recommendedAllocation?.slice(0, 3).map((a: Record<string, any>, i: number) => (
              <div key={i} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded p-1.5">
                <span className="text-[10px]">{a.category}</span>
                <span className="font-mono text-[10px] text-primary">{a.percentage ?? a.allocation ?? 0}%</span>
              </div>
            ))}
            {parity?.insights && <div className="text-[9px] text-muted-foreground">💡 {parity?.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI alokacija z enakim riskom (risk-parity: vsaka kategorija enak prispevek k skupnemu tveganju).</p>
        )}
      </CardContent>
    </Card>
  );
}
