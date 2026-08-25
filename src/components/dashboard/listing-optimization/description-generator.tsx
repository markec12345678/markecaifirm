'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Description Generator v3

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface DescriptionGeneratorProps {
  selectedTradeId: string;
}

export function DescriptionGenerator({ selectedTradeId }: DescriptionGeneratorProps) {
  const [descGen, setDescGen] = useState<Record<string, any> | null>(null);
  const [descGenLoading, setDescGenLoading] = useState(false);

  const runDescGen = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setDescGenLoading(true); setDescGen(null);
    try {
      const res = await fetch('/api/ai/listing-description-generator-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setDescGen(data); toast.success('✓ Opisi generirani'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setDescGenLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-pink-400" /> AI Description Generator v3</span>
          <Button size="sm" variant="outline" onClick={runDescGen} disabled={descGenLoading} className="h-6 text-xs gap-1.5">
            {descGenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {descGenLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI generira opise (10 stilov)...</div>
        ) : descGen?.generator ? (
          <div className="space-y-2 text-xs">
            {descGen?.generator.descriptions?.slice(0, 3).map((d: Record<string, any>, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px] text-pink-400 border-pink-400/30">{d.style || d.strategy}</Badge>
                  <span className="text-[9px] font-mono text-primary">{d.overallScore ?? d.score}/100</span>
                </div>
                <div className="text-[10px] line-clamp-2">{d.description?.slice(0, 120)}...</div>
              </div>
            ))}
            {descGen?.generator.insights && <div className="text-[9px] text-muted-foreground">💡 {descGen?.generator.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI generira opise z 10 stilovi (BENEFIT/STORY/TECHNICAL/SCANNABLE) in A/B testi.</p>
        )}
      </CardContent>
    </Card>
  );
}
