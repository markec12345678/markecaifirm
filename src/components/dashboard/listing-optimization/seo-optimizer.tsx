'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI SEO Optimizer v2

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';

interface SeoOptimizerProps {
  selectedTradeId: string;
}

export function SeoOptimizer({ selectedTradeId }: SeoOptimizerProps) {
  const [seoOpt, setSeoOpt] = useState<Record<string, any> | null>(null);
  const [seoOptLoading, setSeoOptLoading] = useState(false);

  const runSeoOpt = async () => {
    if (!selectedTradeId) { toast.error('Izberi item'); return; }
    setSeoOptLoading(true); setSeoOpt(null);
    try {
      const res = await fetch('/api/ai/listing-seo-optimizer-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) });
      const data = await res.json();
      if (data.ok) { setSeoOpt(data); toast.success('✓ SEO optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setSeoOptLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Search className="w-4 h-4 text-cyan-400" /> AI SEO Optimizer v2</span>
          <Button size="sm" variant="outline" onClick={runSeoOpt} disabled={seoOptLoading} className="h-6 text-xs gap-1.5">
            {seoOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {seoOptLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira SEO...</div>
        ) : seoOpt?.optimizer ? (
          <div className="space-y-2 text-xs">
            {seoOpt?.optimizer.keywordResearch?.slice(0, 4).map((k: Record<string, any>, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px] font-medium">{k.keyword || k.term}</span>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[9px]">{k.searchVolume ?? k.volume}</Badge>
                  <span className="text-[9px] text-primary">{k.cpc ?? ''}€</span>
                </div>
              </div>
            ))}
            {seoOpt?.optimizer.optimizationPlan?.slice(0, 2).map((o: Record<string, any>, i: number) => (
              <div key={i} className="bg-cyan-400/5 border border-cyan-400/20 rounded p-2 text-[10px]">
                <b className="text-cyan-400">{o.action || o.title}</b> — {o.description || o.impact}
              </div>
            ))}
            {seoOpt?.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {seoOpt?.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI keyword research (CPC, volume) + competitor analysis + optimization plan.</p>
        )}
      </CardContent>
    </Card>
  );
}
