'use client';

// v9.02: Extracted from statistics-view.tsx — AI Profit Margin Optimizer (v6.15)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ProfitMargin() {
  const [marginData, setMarginData] = useState<any>(null);
  const [marginLoading, setMarginLoading] = useState(false);

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Profit Margin Optimizer
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.15</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI optimizira maržo preko pristojbin, shippinga in izbire platforme.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" className="gap-2 h-7 text-xs" disabled={marginLoading}
          onClick={async () => {
            setMarginLoading(true); setMarginData(null);
            try {
              const res = await fetch('/api/ai/margin-optimizer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              });
              const data = await res.json();
              if (data.ok) { setMarginData(data); toast.success('✓ Optimizacija marže generirana'); }
              else toast.error(data.error ?? data.message ?? 'Napaka');
            } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
            finally { setMarginLoading(false); }
          }}>
          {marginLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Optimiziraj marže
        </Button>
        {marginLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira pristojbine, shipping, davke in platforme...</div>
        ) : marginData ? (
          <div className="space-y-2 text-xs">
            {marginData.summary?.summary && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{marginData.summary.summary}</div>
            )}
            {marginData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{marginData.summary.totalItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Trenutna marža</div>
                  <div className="font-bold">{marginData.summary.totalCurrentMargin ?? 0}€</div>
                </div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Optimirana</div>
                  <div className="font-bold text-primary">{marginData.summary.totalOptimizedMargin ?? 0}€</div>
                </div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">+ Izboljšava</div>
                  <div className="font-bold text-primary">+{marginData.summary.totalImprovement ?? 0}€ ({marginData.summary.avgImprovementPct ?? 0}%)</div>
                </div>
              </div>
            )}

            {/* Per-item optimizations */}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {marginData.items?.map((it: any, i: number) => (
                <div key={i} className="border rounded p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[11px] truncate">{it.title}</div>
                      <div className="text-[9px] text-muted-foreground">{it.category}</div>
                    </div>
                    <Badge variant="outline" className="text-[9px] text-primary border-primary/40 shrink-0">
                      +{it.improvementEur}€ ({it.improvementPct}%)
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[9px]">
                    <div className="bg-background/40 rounded p-1 border">
                      <div className="text-muted-foreground">Trenutno</div>
                      <div className="font-mono font-bold">{it.currentMargin}€ ({it.currentMarginPct}%)</div>
                    </div>
                    <div className="bg-primary/5 rounded p-1 border border-primary/20">
                      <div className="text-primary">Optimirano</div>
                      <div className="font-mono font-bold text-primary">{it.optimizedMarginEur}€ ({it.optimizedMarginPct}%)</div>
                    </div>
                    <div className="bg-background/40 rounded p-1 border">
                      <div className="text-muted-foreground">Cena</div>
                      <div className="font-mono font-bold">{it.optimizedPriceEur}€</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[9px]">
                    <Badge variant="outline" className="text-[9px]">📍 {it.optimizedPlatform}</Badge>
                    <Badge variant="outline" className="text-[9px]">📦 {it.optimizedShipping}</Badge>
                  </div>
                  {it.improvements?.length > 0 && (
                    <div className="space-y-0.5">
                      {it.improvements.map((imp: any, j: number) => (
                        <div key={j} className="text-[9px] flex items-center justify-between">
                          <span><span className="text-primary font-semibold">{imp.type.replace('_', ' ')}:</span> {imp.description}</span>
                          <span className="font-mono text-primary">+{imp.savingsEur}€</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {it.reasoning && <div className="text-[9px] text-muted-foreground italic">{it.reasoning}</div>}
                </div>
              ))}
            </div>

            {/* General recommendations */}
            {marginData.recommendations?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">💡 Splošna priporočila:</div>
                <ul className="space-y-0.5 ml-3">
                  {marginData.recommendations.map((r: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Optimiziraj marže" za AI analizo pristojbin, shippinga in izbire platforme.</p>
        )}
      </CardContent>
    </Card>
  );
}
