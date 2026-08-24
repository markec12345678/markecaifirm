'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Virality Predictor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ViralityPredictorProps {
  selectedTradeId: string;
}

export function ViralityPredictor({ selectedTradeId }: ViralityPredictorProps) {
  const [virality, setVirality] = useState<Record<string, any> | null>(null);
  const [viralityLoading, setViralityLoading] = useState(false);

  const runVirality = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setViralityLoading(true); setVirality(null);
    try {
      const res = await fetch('/api/ai/listing-virality-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setVirality(data); toast.success('✓ Viralnost napovedana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setViralityLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Flame className="w-4 h-4 text-orange-400" /> AI Virality Predictor</span>
          <Button size="sm" variant="outline" onClick={runVirality} disabled={viralityLoading} className="h-6 text-xs gap-1.5">
            {viralityLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Flame className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {viralityLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje viralnost (8 heuristik)...</div>
        ) : virality?.predictor ? (
          <div className="space-y-2 text-xs">
            {virality?.predictor.viralityFactors?.slice(0, 4).map((f: Record<string, any>, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px] font-medium">{f.factor || f.name}</span>
                <div className="flex items-center gap-1">
                  <div className="w-16 h-1.5 bg-background rounded overflow-hidden">
                    <div className={cn('h-full rounded', (f.score ?? f.value) >= 70 ? 'bg-primary' : (f.score ?? f.value) >= 40 ? 'bg-amber-400' : 'bg-red-500')} style={{ width: `${f.score ?? f.value ?? 0}%` }} />
                  </div>
                  <span className="text-[9px] font-mono">{f.score ?? f.value ?? 0}</span>
                </div>
              </div>
            ))}
            {virality?.predictor.predictions?.slice(0, 2).map((p: Record<string, any>, i: number) => (
              <div key={i} className="bg-orange-400/5 border border-orange-400/20 rounded p-2 text-[10px]">
                <b className="text-orange-400">{p.platform || p.channel}</b>: {p.viralProbabilityPct ?? p.probability ?? 0}% viral
              </div>
            ))}
            {virality?.predictor.insights && <div className="text-[9px] text-muted-foreground">💡 {virality?.predictor.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI napove viralnost (8 heuristik: scarcity, emotional, controversy, utility, social proof...).</p>
        )}
      </CardContent>
    </Card>
  );
}
