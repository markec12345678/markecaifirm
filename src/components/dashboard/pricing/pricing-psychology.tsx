'use client';

// v9.09: Extracted from pricing-view.tsx — AI Pricing Psychology

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Brain } from 'lucide-react';
import { toast } from 'sonner';

export function PricingPsychology() {
  const [psychology, setPsychology] = useState<Record<string, any> | null>(null);
  const [psychologyLoading, setPsychologyLoading] = useState(false);

  const runPsychology = async () => { setPsychologyLoading(true); setPsychology(null); try { const r = await fetch('/api/ai/pricing-psychology-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setPsychology(d); toast.success('✓ Pricing psychology generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setPsychologyLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Brain className="w-4 h-4 text-purple-400" /> AI Pricing Psychology</span>
          <Button size="sm" variant="outline" onClick={runPsychology} disabled={psychologyLoading} className="h-6 text-xs gap-1.5">
            {psychologyLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {psychologyLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira psihologijo cen...</div>
        ) : psychology?.optimizer ? (
          <div className="space-y-2 text-xs">
            {psychology?.optimizer.tactics?.slice(0, 3).map((t: Record<string, any>, i: number) => (
              <div key={i} className="bg-purple-500/5 border border-purple-500/20 rounded p-2">
                <div className="text-[10px] font-medium text-purple-400">{t.tactic || t.name}</div>
                <div className="text-[9px] text-muted-foreground">{t.description || t.effect}</div>
              </div>
            ))}
            {psychology?.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {psychology?.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI optimizira cene s psihološkimi taktikami (charm pricing, anchoring...).</p>
        )}
      </CardContent>
    </Card>
  );
}
