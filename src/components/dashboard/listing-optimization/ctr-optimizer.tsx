'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI CTR Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, MousePointerClick } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CtrOptimizerProps {
  selectedTradeId: string;
}

export function CtrOptimizer({ selectedTradeId }: CtrOptimizerProps) {
  const [ctrOpt, setCtrOpt] = useState<any>(null);
  const [ctrOptLoading, setCtrOptLoading] = useState(false);

  const runCtrOpt = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setCtrOptLoading(true); setCtrOpt(null);
    try {
      const res = await fetch('/api/ai/listing-ctr-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setCtrOpt(data); toast.success('✓ CTR optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setCtrOptLoading(false); }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><MousePointerClick className="w-4 h-4 text-primary" /> AI CTR Optimizer</span>
          <Button size="sm" variant="outline" onClick={runCtrOpt} disabled={ctrOptLoading} className="h-6 text-xs gap-1.5">
            {ctrOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <MousePointerClick className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ctrOptLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira click-through rate...</div>
        ) : ctrOpt?.optimizer ? (
          <div className="space-y-2 text-xs">
            {ctrOpt.optimizer.items?.slice(0, 3).map((item: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium truncate flex-1">{item.title || item.name}</span>
                  <Badge variant="outline" className={cn('text-[9px] ml-1',
                    (item.currentCtr ?? item.ctr ?? 0) >= 5 ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>
                    CTR: {item.currentCtr ?? item.ctr ?? 0}%
                  </Badge>
                </div>
                {item.suggestedTitle && <div className="text-[10px] text-primary">→ {item.suggestedTitle}</div>}
                {item.recommendation && <div className="text-[9px] text-muted-foreground mt-0.5">{item.recommendation}</div>}
              </div>
            ))}
            {ctrOpt.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {ctrOpt.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI optimizira click-through rate (naslovi, thumbnaili, časi objave, A/B testi).</p>
        )}
      </CardContent>
    </Card>
  );
}
