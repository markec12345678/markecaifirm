'use client';

// v9.01: Extracted from statistics-view.tsx — AI Sourcing Recommendations (v6.10)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AiSourcing() {
  // v6.10: AI Sourcing
  const [sourcingData, setSourcingData] = useState<any>(null);
  const [sourcingLoading, setSourcingLoading] = useState(false);
  const [sourcingBudget, setSourcingBudget] = useState('');

  return (
    <>
      {/* v6.10: AI Sourcing Recommendations */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Sourcing priporočila
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.10</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI predlaga kje, kdaj in kaj kupovati za maksimalni dobiček.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder="Budget (EUR, opcijsko)"
              value={sourcingBudget}
              onChange={(e) => setSourcingBudget(e.target.value)}
              className="h-7 text-xs w-44"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={sourcingLoading}
              onClick={async () => {
                setSourcingLoading(true); setSourcingData(null);
                try {
                  const budgetNum = sourcingBudget ? Number(sourcingBudget) : 0;
                  const res = await fetch('/api/ai/sourcing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ budget: budgetNum || undefined }),
                  });
                  const data = await res.json();
                  if (data.ok) { setSourcingData(data); toast.success('✓ Sourcing predlogi generirani'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
                finally { setSourcingLoading(false); }
              }}>
              {sourcingLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Analiziraj trge
            </Button>
          </div>
          {sourcingLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira vire, kategorije in časovna okna...</div>
          ) : sourcingData ? (
            <div className="space-y-2 text-xs">
              {sourcingData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{sourcingData.insights}</div>
              )}
              {sourcingData.stats && (
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Viri</div>
                    <div className="font-bold">{sourcingData.stats.bySource?.length ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorije</div>
                    <div className="font-bold">{sourcingData.stats.byCategory?.length ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Priložnosti (14d)</div>
                    <div className="font-bold">{sourcingData.stats.recentOpportunities?.reduce((s: number, r: any) => s + r.opportunities, 0) ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="space-y-1">
                {sourcingData.recommendations?.map((r: any, i: number) => {
                  const riskColor = r.risk <= 3 ? 'text-primary' : r.risk <= 6 ? 'text-amber-400' : 'text-red-500';
                  const riskBg = r.risk <= 3 ? 'bg-primary/5 border-primary/20' : r.risk <= 6 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20';
                  return (
                    <div key={i} className={cn('p-2 rounded border space-y-1', riskBg)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[9px] shrink-0">{r.source}</Badge>
                        <Badge variant="outline" className="text-[9px] shrink-0 text-muted-foreground">{r.category}</Badge>
                        <span className={cn('font-mono font-bold text-[10px]', riskColor)}>ROI {r.expectedROI}%</span>
                        <span className={cn('font-mono text-[9px]', riskColor)}>tveganje {r.risk}/10</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="font-semibold">⏰ {r.timing}</span>
                      </div>
                      <div className="text-[10px] font-medium">{r.action}</div>
                      {r.reason && <div className="text-[9px] text-muted-foreground italic">{r.reason}</div>}
                    </div>
                  );
                })}
                {sourcingData.recommendations?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni priporočil — potrebno več podatkov.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj trge" za AI predloge, kje iskati profitne inventarje.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
