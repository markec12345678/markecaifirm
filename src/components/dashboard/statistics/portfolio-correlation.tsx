'use client';

// v9.01: Extracted from statistics-view.tsx — AI Portfolio Correlation (v6.12)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function PortfolioCorrelation() {
  // v6.12: Portfolio Correlation
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);

  return (
    <>
      {/* v6.12: AI Portfolio Correlation */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Portfolio korelacije
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.12</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI analizira korelacije med kategorijami in predlaga diverzifikacijo portfolia.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={correlationLoading}
            onClick={async () => {
              setCorrelationLoading(true); setCorrelationData(null);
              try {
                const res = await fetch('/api/ai/portfolio-correlation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.ok) { setCorrelationData(data); toast.success('✓ Korelacijska analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
              finally { setCorrelationLoading(false); }
            }}>
            {correlationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj korelacije
          </Button>
          {correlationLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI računa Pearsonove korelacije med kategorijami...</div>
          ) : correlationData ? (
            <div className="space-y-2 text-xs">
              {correlationData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{correlationData.insights}</div>
              )}
              {correlationData.summary && correlationData.diversification && (
                <div className="grid grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorij</div>
                    <div className="font-bold">{correlationData.summary.totalCategories ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">HHI indeks</div>
                    <div className="font-bold">{correlationData.summary.hhi ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Koncentracija</div>
                    <div className={cn('font-bold uppercase',
                      correlationData.diversification.concentrationRisk === 'high' ? 'text-red-500' :
                      correlationData.diversification.concentrationRisk === 'medium' ? 'text-amber-400' : 'text-primary')}>
                      {correlationData.diversification.concentrationRisk}
                    </div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Diverz. score</div>
                    <div className={cn('font-bold',
                      (correlationData.diversification.score ?? 0) >= 70 ? 'text-primary' :
                      (correlationData.diversification.score ?? 0) >= 40 ? 'text-amber-400' : 'text-destructive')}>
                      {correlationData.diversification.score ?? 0}/100
                    </div>
                  </div>
                </div>
              )}

              {/* Diverzifikacijska tveganja in predlogi */}
              {correlationData.diversification?.topRisks?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                  <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Tveganja:</div>
                  <ul className="space-y-0.5 ml-3">
                    {correlationData.diversification.topRisks.map((r: string, i: number) => (
                      <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {correlationData.diversification?.suggestions?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">💡 Predlogi diverzifikacije:</div>
                  <ul className="space-y-0.5 ml-3">
                    {correlationData.diversification.suggestions.map((s: string, i: number) => (
                      <li key={i} className="text-[10px] list-disc list-outside">{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Clustri */}
              {correlationData.clusters?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">🔗 Clustri kategorij:</div>
                  <div className="space-y-1">
                    {correlationData.clusters.map((c: any, i: number) => (
                      <div key={i} className="bg-background/40 rounded p-1.5 border">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-[10px]">{c.name}</span>
                          <Badge variant="outline" className={cn('text-[9px]',
                            c.risk === 'high' ? 'text-red-500 border-red-500/30' :
                            c.risk === 'medium' ? 'text-amber-400 border-amber-400/30' : 'text-primary border-primary/30')}>
                            {c.risk} risk
                          </Badge>
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          {c.categories?.join(', ')} — {c.characteristic}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top korelacije */}
              {correlationData.correlations?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Top korelacije:</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {correlationData.correlations.map((c: any, i: number) => {
                      const cfg: Record<string, { color: string; bg: string; icon: string }> = {
                        strong_positive: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                        weak_positive: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                        strong_negative: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '🟢' },
                        weak_negative: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '🔵' },
                        neutral: { color: 'text-muted-foreground', bg: 'bg-background/40 border-border', icon: '⚪' },
                      };
                      const cfg2 = cfg[c.strength] || cfg.neutral;
                      return (
                        <div key={i} className={cn('rounded p-1.5 border flex items-center justify-between', cfg2.bg)}>
                          <div className="flex items-center gap-1.5">
                            <span>{cfg2.icon}</span>
                            <span className="text-[10px]">{c.catA} ↔ {c.catB}</span>
                          </div>
                          <span className={cn('font-mono font-bold text-[10px]', cfg2.color)}>
                            {c.correlation > 0 ? '+' : ''}{c.correlation}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Hedging opportunities */}
              {correlationData.hedgingOpportunities?.length > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[10px] uppercase text-primary mb-1">🛡️ Hedging priložnosti:</div>
                  <div className="space-y-1">
                    {correlationData.hedgingOpportunities.map((h: any, i: number) => (
                      <div key={i} className="text-[10px]">
                        <span className="font-bold">{h.category}</span>
                        <span className="text-muted-foreground"> hedga </span>
                        <span className="font-bold">{h.hedgesAgainst}</span>
                        <span className="text-muted-foreground"> (korelacija: {h.expectedCorrelation > 0 ? '+' : ''}{h.expectedCorrelation})</span>
                        <div className="text-[9px] text-muted-foreground italic">{h.reasoning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj korelacije" za AI analizo sinhronega tveganja portfolia.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
