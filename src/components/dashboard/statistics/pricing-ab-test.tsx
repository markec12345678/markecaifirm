'use client';

// v9.01: Extracted from statistics-view.tsx — Smart Pricing A/B Testing (v6.11)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function PricingABTest() {
  // v6.11: A/B Testing
  const [abTestData, setAbTestData] = useState<any>(null);
  const [abTestLoading, setAbTestLoading] = useState(false);

  return (
    <>
      {/* v6.11: Smart Pricing A/B Testing */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Smart Pricing A/B Testing
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.11</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI za vsak item v skladišču predlaga 3 cenovne strategije (premium/fair/aggressive).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={abTestLoading}
            onClick={async () => {
              setAbTestLoading(true); setAbTestData(null);
              try {
                const res = await fetch('/api/ai/pricing-abtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setAbTestData(data); toast.success('✓ A/B testne variante generirane'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setAbTestLoading(false); }
            }}>
            {abTestLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generiraj A/B teste
          </Button>
          {abTestLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI pripravlja cenovne strategije...</div>
          ) : abTestData ? (
            <div className="space-y-2 text-xs">
              {abTestData.summary && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{abTestData.summary}</div>
              )}
              {abTestData.summaryStats && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Itemov</div>
                    <div className="font-bold">{abTestData.summaryStats.totalItems ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. dobiček</div>
                    <div className="font-bold text-primary">{abTestData.summaryStats.avgRecommendedProfit ?? 0}€</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Povp. čas</div>
                    <div className="font-bold">{abTestData.summaryStats.avgRecommendedTimeToSell ?? 0}d</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Premium/Fair/Aggr</div>
                    <div className="font-bold">{abTestData.summaryStats.recommendationBreakdown?.premium ?? 0}/{abTestData.summaryStats.recommendationBreakdown?.fair ?? 0}/{abTestData.summaryStats.recommendationBreakdown?.aggressive ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {abTestData.tests?.map((t: any, i: number) => {
                  const recColor = t.recommendation === 'premium' ? 'text-primary' : t.recommendation === 'aggressive' ? 'text-amber-400' : 'text-blue-400';
                  return (
                    <div key={i} className="border rounded p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[11px] truncate">{t.title}</div>
                          <div className="text-[9px] text-muted-foreground">Nabavna: {t.cost}€ · {t.daysHeld}d v skladišču</div>
                        </div>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0', recColor)}>→ {t.recommendation}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[9px]">
                        {t.variants?.map((v: any, j: number) => {
                          const isRec = v.name === t.recommendation;
                          const cfg: Record<string, string> = {
                            premium: 'text-primary border-primary/30',
                            fair: 'text-blue-400 border-blue-400/30',
                            aggressive: 'text-amber-400 border-amber-400/30',
                          };
                          return (
                            <div key={j} className={cn('rounded p-1 border', cfg[v.name], isRec && 'bg-primary/5 border-primary/40')}>
                              <div className="font-bold uppercase">{v.name}</div>
                              <div className="font-mono">{v.price}€</div>
                              <div className="text-muted-foreground">+{v.projectedProfit}€ · {v.timeToSellDays}d · {v.probabilityPct}%</div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[9px] text-muted-foreground italic">💡 {t.recommendationReasoning}</div>
                    </div>
                  );
                })}
                {abTestData.tests?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni itemov za A/B testiranje.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Generiraj A/B teste" za AI predlog cenovnih strategij.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
