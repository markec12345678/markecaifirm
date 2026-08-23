'use client';

// v9.02: Extracted from statistics-view.tsx — AI Smart Restock Predictor (v6.24)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function SmartRestock() {
  const [restockData, setRestockData] = useState<any>(null);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockBudget, setRestockBudget] = useState('');

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Smart Restock Predictor
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.24</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI napove kaj, kje in kdaj kupovati za max dobiček z budget alokacijo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <Input type="number" placeholder="Budget (EUR, opcijsko)" value={restockBudget} onChange={(e) => setRestockBudget(e.target.value)} className="h-7 text-xs w-44" />
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={restockLoading}
            onClick={async () => {
              setRestockLoading(true); setRestockData(null);
              try {
                const budgetNum = restockBudget ? Number(restockBudget) : 0;
                const res = await fetch('/api/ai/smart-restock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budget: budgetNum || undefined }) });
                const data = await res.json();
                if (data.ok) { setRestockData(data); toast.success('✓ Restock napoved generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setRestockLoading(false); }
            }}>
            {restockLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Napovej restock
          </Button>
        </div>
        {restockLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira ROI kategorij in predvideva restock...</div>
        ) : restockData ? (
          <div className="space-y-2 text-xs">
            {restockData.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{restockData.insights}</div>}
            {restockData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Predlogov</div><div className="font-bold">{restockData.summary.totalPredictions ?? 0}</div></div>
                <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5"><div className="text-red-500 uppercase">Kritično</div><div className="font-bold text-red-500">{restockData.summary.criticalCount ?? 0}</div></div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5"><div className="text-amber-400 uppercase">Visoka</div><div className="font-bold text-amber-400">{restockData.summary.highCount ?? 0}</div></div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Povp. ROI</div><div className="font-bold text-primary">{restockData.summary.avgExpectedRoi ?? 0}%</div></div>
              </div>
            )}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {restockData.predictions?.map((p: any, i: number) => {
                const urgencyCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  critical: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  high: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  medium: { color: 'text-blue-400', bg: 'border-blue-400/20 bg-blue-400/5', icon: '🔵' },
                  low: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                };
                const cfg = urgencyCfg[p.urgency] || urgencyCfg.medium;
                return (
                  <div key={i} className={cn('border rounded p-1.5 space-y-1', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <span className="font-bold text-[11px] truncate">{p.item}</span>
                        <Badge variant="outline" className="text-[8px] shrink-0">{p.category}</Badge>
                      </div>
                      <Badge variant="outline" className={cn('text-[8px] shrink-0', cfg.color)}>{p.urgency}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div><span className="text-muted-foreground">Nakup:</span> <b className="font-mono">{p.expectedBuyPriceEur}€</b></div>
                      <div><span className="text-muted-foreground">Prodaja:</span> <b className="font-mono text-primary">{p.expectedSellPriceEur}€</b></div>
                      <div><span className="text-muted-foreground">ROI:</span> <b className={cn('font-mono', p.expectedRoiPct >= 30 ? 'text-primary' : 'text-amber-400')}>{p.expectedRoiPct}%</b></div>
                      <div><span className="text-muted-foreground">Čas:</span> <b className="font-mono">{p.expectedDaysToSell}d</b></div>
                    </div>
                    <div className="text-[9px] text-muted-foreground">📍 {p.source} · 🔍 {p.searchKeywords} · ×{p.quantity}{p.budgetAllocationEur > 0 && ` · ${p.budgetAllocationEur}€`}</div>
                    {p.reasoning && <div className="text-[9px] italic">{p.reasoning}</div>}
                  </div>
                );
              })}
            </div>
            {restockData.budgetAllocation?.allocation?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">💰 Budget alokacija:</div>
                <div className="space-y-0.5">
                  {restockData.budgetAllocation.allocation.map((a: any, i: number) => (
                    <div key={i} className="text-[10px] flex items-center justify-between">
                      <span><Badge variant="outline" className="text-[8px] mr-1">{a.category}</Badge> {a.reasoning}</span>
                      <span className="font-mono font-bold text-primary">{a.amountEur}€ ({a.pct}%)</span>
                    </div>
                  ))}
                  {restockData.budgetAllocation.reserveEur > 0 && (
                    <div className="text-[10px] text-amber-400 mt-1">💾 Rezerva: {restockData.budgetAllocation.reserveEur}€ ({restockData.budgetAllocation.reservePct}%)</div>
                  )}
                </div>
              </div>
            )}
            {restockData.seasonalAlerts?.length > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-amber-400 mb-1">🗓 Sezonska opozorila:</div>
                <div className="space-y-1">
                  {restockData.seasonalAlerts.map((s: any, i: number) => (
                    <div key={i} className="text-[10px]">
                      <div className="font-bold capitalize">{s.season} — {s.deadline}</div>
                      {s.itemsToBuy?.length > 0 && <div className="text-primary">🛒 Kupi: {s.itemsToBuy.join(' · ')}</div>}
                      {s.itemsToSell?.length > 0 && <div className="text-amber-400">💰 Prodaj: {s.itemsToSell.join(' · ')}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej restock" za AI napoved kaj in kje kupovati.</p>
        )}
      </CardContent>
    </Card>
  );
}
