'use client';

// v9.01: Extracted from statistics-view.tsx — AI Cross-Border Arbitrage (v6.11)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CrossBorderArbitrage() {
  // v6.11: Cross-Border
  const [crossBorderData, setCrossBorderData] = useState<Record<string, any> | null>(null);
  const [crossBorderLoading, setCrossBorderLoading] = useState(false);
  const [crossBorderQuery, setCrossBorderQuery] = useState('');

  return (
    <>
      {/* v6.11: AI Cross-Border Arbitrage */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Cross-Border Arbitrage
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.11</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI primerja slovenske cene s tujimi trgi (DE, IT, HR, AT, PL, FR) in identificira arbitražo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              type="text"
              placeholder="Iskalni pojem (npr. iPhone, kolo...)"
              value={crossBorderQuery}
              onChange={(e) => setCrossBorderQuery(e.target.value)}
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={crossBorderLoading}
              onClick={async () => {
                setCrossBorderLoading(true); setCrossBorderData(null);
                try {
                  const res = await fetch('/api/ai/cross-border', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: crossBorderQuery || undefined }),
                  });
                  const data = await res.json();
                  if (data.ok) { setCrossBorderData(data); toast.success('✓ Cross-border priložnosti identificirane'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
                finally { setCrossBorderLoading(false); }
              }}>
              {crossBorderLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Skeniraj trge
            </Button>
          </div>
          {crossBorderLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI primerja cene med 6 tujimi trgi...</div>
          ) : crossBorderData ? (
            <div className="space-y-2 text-xs">
              {crossBorderData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{crossBorderData.insights}</div>
              )}
              {crossBorderData.summary && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Priložnosti</div>
                    <div className="font-bold">{crossBorderData.summary.totalOpportunities ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Export</div>
                    <div className="font-bold text-primary">{crossBorderData.summary.exportOps ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Import</div>
                    <div className="font-bold text-blue-400">{crossBorderData.summary.importOps ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. ROI</div>
                    <div className="font-bold text-primary">{crossBorderData.summary.avgROI ?? 0}%</div>
                  </div>
                </div>
              )}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {crossBorderData.opportunities?.map((o: Record<string, any>, i: number) => {
                  const stratColor = o.arbitrage.strategy === 'export' ? 'text-primary' :
                                     o.arbitrage.strategy === 'import' ? 'text-blue-400' :
                                     o.arbitrage.strategy === 'wait' ? 'text-muted-foreground' : 'text-amber-400';
                  const stratBg = o.arbitrage.strategy === 'export' ? 'bg-primary/5 border-primary/20' :
                                  o.arbitrage.strategy === 'import' ? 'bg-blue-400/5 border-blue-400/20' :
                                  o.arbitrage.strategy === 'wait' ? 'bg-muted/5 border-border' : 'bg-amber-400/5 border-amber-400/20';
                  return (
                    <div key={i} className={cn('border rounded p-2 space-y-1.5', stratBg)}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[11px] truncate">{o.title}</div>
                          <div className="text-[9px] text-muted-foreground">SI cena: {o.slovenianPrice}€ · deal score: {o.dealScore}</div>
                        </div>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0 uppercase', stratColor)}>
                          {o.arbitrage.strategy === 'export' ? '📤' : o.arbitrage.strategy === 'import' ? '📥' : '⏸'} {o.arbitrage.strategy}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[9px]">
                        <div><span className="text-muted-foreground">Kupi:</span> <span className="font-bold">{o.arbitrage.buyIn}</span></div>
                        <div><span className="text-muted-foreground">Prodaj:</span> <span className="font-bold">{o.arbitrage.sellIn}</span></div>
                        <div><span className="text-muted-foreground">ROI:</span> <span className={cn('font-bold', stratColor)}>{o.arbitrage.roiPct}%</span></div>
                        <div><span className="text-muted-foreground">Net:</span> <span className="font-mono font-bold">{o.arbitrage.netMargin}€</span></div>
                      </div>
                      {o.foreignPrices?.length > 0 && (
                        <div className="text-[9px] text-muted-foreground">
                          🌍 {o.foreignPrices.slice(0, 3).map((f: Record<string, any>) => `${f.country}: ${f.price}€`).join(' · ')}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-muted-foreground">Tveganje: <b className={o.risk <= 3 ? 'text-primary' : o.risk <= 6 ? 'text-amber-400' : 'text-red-500'}>{o.risk}/10</b> · Izvedljivost: <b>{o.feasibility}</b></span>
                      </div>
                      <div className="text-[10px] font-medium">→ {o.action}</div>
                      {o.reasoning && <div className="text-[9px] text-muted-foreground italic">{o.reasoning}</div>}
                    </div>
                  );
                })}
                {crossBorderData.opportunities?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni cross-border priložnosti.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Skeniraj trge" za AI primerjavo cen med Slovenijo in 6 tujimi trgi.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
