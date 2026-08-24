'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Thumbnail Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';

interface ThumbnailOptimizerProps {
  selectedTradeId: string;
}

export function ThumbnailOptimizer({ selectedTradeId }: ThumbnailOptimizerProps) {
  const [thumbnailOpt, setThumbnailOpt] = useState<any>(null);
  const [thumbnailOptLoading, setThumbnailOptLoading] = useState(false);

  const runThumbnailOpt = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setThumbnailOptLoading(true); setThumbnailOpt(null); try { const r = await fetch('/api/ai/listing-thumbnail-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setThumbnailOpt(d); toast.success('✓ Thumbnail optimizacija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setThumbnailOptLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><ImagePlus className="w-4 h-4 text-purple-400" /> AI Thumbnail Optimizer</span>
          <Button size="sm" variant="outline" onClick={runThumbnailOpt} disabled={thumbnailOptLoading} className="h-6 text-xs gap-1.5">
            {thumbnailOptLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {thumbnailOptLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI optimizira thumbnail...</div>
        ) : thumbnailOpt?.optimizer ? (
          <div className="space-y-2 text-xs">
            {thumbnailOpt.optimizer.recommendations?.slice(0, 3).map((r: any, i: number) => (
              <div key={i} className="bg-purple-500/5 border border-purple-500/20 rounded p-2">
                <div className="text-[10px] font-medium text-purple-400">{r.action || r.type}</div>
                <div className="text-[9px] text-muted-foreground">{r.description || r.detail}</div>
              </div>
            ))}
            {thumbnailOpt.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {thumbnailOpt.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI optimizira thumbnail sliko za večji CTR.</p>
        )}
      </CardContent>
    </Card>
  );
}
