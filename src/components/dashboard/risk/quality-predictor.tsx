'use client';

// v9.09: Extracted from risk-view.tsx — AI Quality Predictor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';

export function QualityPredictor() {
  const [qualityPred, setQualityPred] = useState<any>(null);
  const [qualityPredLoading, setQualityPredLoading] = useState(false);

  const runQualityPred = async () => { setQualityPredLoading(true); setQualityPred(null); try { const r = await fetch('/api/ai/quality-predictor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setQualityPred(d); toast.success('✓ Quality napoved generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setQualityPredLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-primary" /> AI Quality Predictor</span>
          <Button size="sm" variant="outline" onClick={runQualityPred} disabled={qualityPredLoading} className="h-6 text-xs gap-1.5">
            {qualityPredLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {qualityPredLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI napoveduje kakovost...</div>
        ) : qualityPred?.prediction ? (
          <div className="space-y-2 text-xs">
            <div className="bg-primary/10 border border-primary/30 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-primary font-bold">Quality Score</span>
                <span className="font-mono font-bold text-primary text-lg">{qualityPred.prediction.score ?? qualityPred.prediction.qualityScore ?? '?'}/100</span>
              </div>
            </div>
            {qualityPred.prediction.factors?.slice(0, 3).map((f: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{f.factor || f.name}</span>
                <span className="font-mono text-[10px] text-primary">{f.score ?? f.value}/10</span>
              </div>
            ))}
            {qualityPred.prediction.insights && <div className="text-[9px] text-muted-foreground">💡 {qualityPred.prediction.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI napove kakovost item-a pred nakupom (score 0-100, faktorji).</p>
        )}
      </CardContent>
    </Card>
  );
}
