'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Tag Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Tag } from 'lucide-react';
import { toast } from 'sonner';

interface TagOptimizerProps {
  selectedTradeId: string;
}

export function TagOptimizer({ selectedTradeId }: TagOptimizerProps) {
  const [tagOpt, setTagOpt] = useState<Record<string, any> | null>(null);
  const [tagOptLoading, setTagOptLoading] = useState(false);

  const runTagOpt = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setTagOptLoading(true); setTagOpt(null); try { const r = await fetch('/api/ai/listing-tag-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setTagOpt(d); toast.success('✓ Tag optimizacija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setTagOptLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Tag className="w-4 h-4 text-blue-400" /> AI Tag Optimizer</span>
          <Button size="sm" variant="outline" onClick={runTagOpt} disabled={tagOptLoading} className="h-6 text-xs gap-1.5">
            {tagOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tagOptLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira oznake...</div>
        ) : tagOpt?.optimizer ? (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-1">
              {tagOpt?.optimizer.suggestedTags?.slice(0, 8).map((t: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">{t}</Badge>
              ))}
            </div>
            {tagOpt?.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {tagOpt?.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI optimizira oznake/Tag-e za boljšo vidljivost.</p>
        )}
      </CardContent>
    </Card>
  );
}
