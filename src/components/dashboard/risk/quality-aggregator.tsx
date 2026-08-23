'use client';

// v9.09: Extracted from risk-view.tsx — AI Quality Aggregator

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

export function QualityAggregator() {
  const [qualityAgg, setQualityAgg] = useState<any>(null);
  const [qualityAggLoading, setQualityAggLoading] = useState(false);

  const runQualityAgg = async () => { setQualityAggLoading(true); setQualityAgg(null); try { const r = await fetch('/api/ai/quality-aggregator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setQualityAgg(d); toast.success('✓ Quality aggregator generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setQualityAggLoading(false); } };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" /> AI Quality Aggregator</span>
          <Button size="sm" variant="outline" onClick={runQualityAgg} disabled={qualityAggLoading} className="h-6 text-xs gap-1.5">
            {qualityAggLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {qualityAggLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI agregira kakovost...</div>
        ) : qualityAgg?.aggregator ? (
          <div className="space-y-2 text-xs">
            <div className="bg-blue-400/5 border border-blue-400/20 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-blue-400">Skupna kakovost</span>
                <span className="font-mono font-bold text-blue-400">{qualityAgg.aggregator.overallScore ?? qualityAgg.aggregator.aggregateScore ?? '?'}/100</span>
              </div>
            </div>
            {qualityAgg.aggregator.categories?.slice(0, 4).map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px] font-medium">{c.category || c.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground">{c.itemCount ?? c.count} itemov</span>
                  <span className="font-mono text-primary text-[10px]">{c.avgScore ?? c.score ?? '?'}/100</span>
                </div>
              </div>
            ))}
            {qualityAgg.aggregator.insights && <div className="text-[9px] text-muted-foreground">💡 {qualityAgg.aggregator.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI agregira kakovost vsega inventarja (po kategorijah, skupni score).</p>
        )}
      </CardContent>
    </Card>
  );
}
