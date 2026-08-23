'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Conversion Predictor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BuyerConversionProps {
  selectedBuyer: string;
}

export function BuyerConversion({ selectedBuyer }: BuyerConversionProps) {
  const [conversion, setConversion] = useState<any>(null);
  const [conversionLoading, setConversionLoading] = useState(false);

  const runConversion = async () => { if (!selectedBuyer) { toast.error('Izberi kupca'); return; } setConversionLoading(true); setConversion(null); try { const r = await fetch('/api/ai/buyer-conversion-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: selectedBuyer }) }); const d = await r.json(); if (d.ok) { setConversion(d); toast.success('✓ Conversion napoved generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setConversionLoading(false); } };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-blue-400" /> AI Conversion Predictor</span>
          <Button size="sm" variant="outline" onClick={runConversion} disabled={conversionLoading} className="h-6 text-xs gap-1.5">
            {conversionLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {conversionLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje verjetnost konverzije...</div>
        ) : conversion?.predictor ? (
          <div className="space-y-2 text-xs">
            <div className={cn('border rounded p-2',
              (conversion.predictor.conversionProbability ?? conversion.predictor.probability ?? 0) >= 70 ? 'bg-primary/10 border-primary/30' :
              (conversion.predictor.conversionProbability ?? conversion.predictor.probability ?? 0) >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase text-[10px]">Verjetnost konverzije</span>
                <Badge variant="outline" className="text-[9px] font-mono font-bold text-primary border-primary/40">
                  {conversion.predictor.conversionProbability ?? conversion.predictor.probability ?? '?'}%
                </Badge>
              </div>
              {conversion.predictor.reasoning && <p className="text-[10px] text-muted-foreground mt-1">{conversion.predictor.reasoning}</p>}
            </div>
            {conversion.predictor.factors?.slice(0, 3).map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-card/30 border rounded p-1.5">
                <span className={cn('font-bold w-3', f.impact === 'positive' ? 'text-primary' : f.impact === 'negative' ? 'text-red-500' : 'text-muted-foreground')}>
                  {f.impact === 'positive' ? '+' : f.impact === 'negative' ? '−' : '○'}
                </span>
                <span className="text-[10px] font-medium">{f.factor || f.name}</span>
                <span className="text-[9px] text-muted-foreground ml-auto">({f.weight ?? f.score}/10)</span>
              </div>
            ))}
            {conversion.predictor.insights && <div className="text-[9px] text-muted-foreground">💡 {conversion.predictor.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI napove verjetnost konverzije (ali bo kupec kupil znova) z analizo faktorjev.</p>
        )}
      </CardContent>
    </Card>
  );
}
