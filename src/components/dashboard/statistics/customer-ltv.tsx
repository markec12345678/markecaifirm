'use client';

// v9.02: Extracted from statistics-view.tsx — AI Customer Lifetime Value (v6.16)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CustomerLtv() {
  const [ltvData, setLtvData] = useState<any>(null);
  const [ltvLoading, setLtvLoading] = useState(false);

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Customer Lifetime Value
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.16</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI napove LTV kupcev, segmentacijo in retention strategije.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" className="gap-2 h-7 text-xs" disabled={ltvLoading}
          onClick={async () => {
            setLtvLoading(true); setLtvData(null);
            try {
              const res = await fetch('/api/ai/customer-ltv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              });
              const data = await res.json();
              if (data.ok) { setLtvData(data); toast.success('✓ LTV analiza generirana'); }
              else toast.error(data.error ?? data.message ?? 'Napaka');
            } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
            finally { setLtvLoading(false); }
          }}>
          {ltvLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Analiziraj kupce
        </Button>
        {ltvLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira nakupne vzorce in napoveduje LTV...</div>
        ) : ltvData ? (
          <div className="space-y-2 text-xs">
            {ltvData.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{ltvData.insights}</div>
            )}
            {ltvData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Prihodek</div>
                  <div className="font-bold text-primary">{ltvData.summary.totalRevenue}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. LTV</div>
                  <div className="font-bold">{ltvData.summary.avgCustomerLtv}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Repeat</div>
                  <div className="font-bold text-primary">{ltvData.summary.repeatCustomersPct}%</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">VIP / At-risk</div>
                  <div className="font-bold">{ltvData.summary.vipCount ?? 0}/{ltvData.summary.atRiskCount ?? 0}</div>
                </div>
              </div>
            )}

            {/* Customer list */}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {ltvData.customers?.map((c: any, i: number) => {
                const segCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  vip: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '⭐' },
                  loyal: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '💙' },
                  occasional: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                  one_time: { color: 'text-muted-foreground', bg: 'bg-background/40 border-border', icon: '⚪' },
                  at_risk: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                };
                const cfg = segCfg[c.segment] || segCfg.occasional;
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0 truncate max-w-[120px]">{c.name}</Badge>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0 uppercase', cfg.color)}>{c.segment.replace('_', ' ')}</Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-primary text-[11px]">{c.predictedLtv12mEur}€</div>
                        <div className="text-[8px] text-muted-foreground">LTV 12m</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div><span className="text-muted-foreground">Nakupi:</span> <b className="font-mono">{c.purchaseCount}</b></div>
                      <div><span className="text-muted-foreground">Skupaj:</span> <b className="font-mono">{c.totalSpent}€</b></div>
                      <div><span className="text-muted-foreground">Povp.:</span> <b className="font-mono">{c.avgOrderValue}€</b></div>
                      <div><span className="text-muted-foreground">Dobiček:</span> <b className="font-mono text-primary">{c.profit}€</b></div>
                    </div>
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground">Churn risk: <b className={cn(c.churnRiskPct > 60 ? 'text-red-500' : c.churnRiskPct > 30 ? 'text-amber-400' : 'text-primary')}>{c.churnRiskPct}%</b></span>
                      <Badge variant="outline" className="text-[9px]">→ {c.retentionStrategy.replace('_', ' ')}</Badge>
                    </div>
                    {c.personalizedOffer && (
                      <div className="text-[9px] bg-background/40 rounded p-1 border">
                        🎯 <span className="font-medium">{c.personalizedOffer}</span>
                      </div>
                    )}
                    {c.crossSellCategories?.length > 0 && (
                      <div className="text-[9px] text-muted-foreground">
                        🔄 Cross-sell: {c.crossSellCategories.join(' · ')}
                      </div>
                    )}
                    {c.reasoning && <div className="text-[9px] italic">{c.reasoning}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj kupce" za AI napoved LTV in retention strategije.</p>
        )}
      </CardContent>
    </Card>
  );
}
