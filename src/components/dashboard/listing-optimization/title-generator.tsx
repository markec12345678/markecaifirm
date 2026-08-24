'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Title Generator v2

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Type } from 'lucide-react';
import { toast } from 'sonner';

interface TitleGeneratorProps {
  selectedTradeId: string;
}

export function TitleGenerator({ selectedTradeId }: TitleGeneratorProps) {
  const [titleGen, setTitleGen] = useState<any>(null);
  const [titleGenLoading, setTitleGenLoading] = useState(false);

  const runTitleGen = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setTitleGenLoading(true); setTitleGen(null); try { const r = await fetch('/api/ai/listing-title-generator-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setTitleGen(d); toast.success('✓ Naslovi generirani'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setTitleGenLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Type className="w-4 h-4 text-primary" /> AI Title Generator v2</span>
          <Button size="sm" variant="outline" onClick={runTitleGen} disabled={titleGenLoading} className="h-6 text-xs gap-1.5">
            {titleGenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Type className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {titleGenLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI generira naslove...</div>
        ) : titleGen?.generator ? (
          <div className="space-y-2 text-xs">
            {titleGen.generator.titles?.slice(0, 4).map((t: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium">{t.title || t.text}</span>
                  {t.score != null && <Badge variant="outline" className="text-[9px] text-primary border-primary/30">{t.score}/100</Badge>}
                </div>
                {t.reason && <div className="text-[9px] text-muted-foreground">{t.reason}</div>}
              </div>
            ))}
            {titleGen.generator.insights && <div className="text-[9px] text-muted-foreground">💡 {titleGen.generator.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI generira optimizirane naslove z A/B test scoring.</p>
        )}
      </CardContent>
    </Card>
  );
}
