'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function TaxLossHarvesting() {
  // v6.15: Tax Loss Harvesting
  const [taxHarvestData, setTaxHarvestData] = useState<Record<string, any> | null>(null);
  const [taxHarvestLoading, setTaxHarvestLoading] = useState(false);
  const [taxHarvestYear, setTaxHarvestYear] = useState(String(new Date().getFullYear()));

  return (
    <>
      {/* v6.15: Tax Loss Harvesting */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
        disabled={taxHarvestLoading}
        onClick={async () => {
          setTaxHarvestLoading(true); setTaxHarvestData(null);
          try {
            const res = await fetch('/api/ai/tax-loss-harvesting', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year: Number(taxHarvestYear) }),
            });
            const data = await res.json();
            if (data.ok) { setTaxHarvestData(data); toast.success('✓ Davčna optimizacija generirana'); }
            else toast.error(data.error ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setTaxHarvestLoading(false); }
        }}
        title="AI identificira izgube za davčno optimizacijo (loss harvesting)"
      >
        {taxHarvestLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}
        Tax harvesting
      </Button>

      {/* v6.15: AI Tax Loss Harvesting results */}
      {taxHarvestData && (
        <Card className="bg-card/50 border-amber-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold">AI Tax Loss Harvesting</span>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/40">v6.15</Badge>
                <Badge variant="outline" className="text-[9px]">leto {taxHarvestData.harvesting?.year}</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTaxHarvestData(null)} className="h-6 text-xs">×</Button>
            </div>

            {taxHarvestData.harvesting && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Dobički</div>
                  <div className="font-bold text-primary">{taxHarvestData.harvesting.realizedGains}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Izgube</div>
                  <div className="font-bold text-destructive">−{taxHarvestData.harvesting.realizedLosses}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Neto</div>
                  <div className={cn('font-bold', taxHarvestData.harvesting.netGain >= 0 ? 'text-primary' : 'text-destructive')}>
                    {taxHarvestData.harvesting.netGain}€
                  </div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Davek (40%)</div>
                  <div className="font-bold text-destructive">{taxHarvestData.harvesting.taxDue}€</div>
                </div>
                <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                  <div className="text-amber-400 uppercase">Po carryforward</div>
                  <div className="font-bold text-amber-400">{taxHarvestData.harvesting.taxDueAfterCarryforward}€</div>
                  <div className="text-[9px] text-primary">−{taxHarvestData.harvesting.taxSavedByCarryforward}€</div>
                </div>
              </div>
            )}

            {taxHarvestData.taxStrategy && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2 text-xs text-amber-400">
                📋 {taxHarvestData.taxStrategy}
              </div>
            )}

            {/* Year-end plan */}
            {taxHarvestData.yearEndPlan && taxHarvestData.yearEndPlan.shouldHarvest && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">
                  🎯 Year-end harvesting načrt:
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
                  <div><span className="text-muted-foreground">Cilj izgube:</span> <b className="font-mono">{taxHarvestData.yearEndPlan.targetLossEur}€</b></div>
                  <div><span className="text-muted-foreground">Prihranek davka:</span> <b className="font-mono text-primary">{taxHarvestData.yearEndPlan.taxSavingsEur}€</b></div>
                  <div><span className="text-muted-foreground">Rok:</span> <b>{taxHarvestData.yearEndPlan.deadline}</b></div>
                </div>
                {taxHarvestData.yearEndPlan.steps?.length > 0 && (
                  <ol className="space-y-0.5 ml-3">
                    {taxHarvestData.yearEndPlan.steps.map((s: string, i: number) => (
                      <li key={i} className="text-[10px] list-decimal list-outside">{s}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {/* Carryforward analysis */}
            {taxHarvestData.carryforwardAnalysis && (
              <div className="bg-background/40 border rounded p-2">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Loss carryforward analiza:</div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Na voljo:</span> <b className="font-mono">{taxHarvestData.carryforwardAnalysis.availableLossesEur}€</b></div>
                  <div><span className="text-muted-foreground">Letos uporabljeno:</span> <b className="font-mono text-primary">{taxHarvestData.carryforwardAnalysis.utilizedThisYearEur}€</b></div>
                  <div><span className="text-muted-foreground">Za prihodnje:</span> <b className="font-mono">{taxHarvestData.carryforwardAnalysis.remainingForFutureEur}€</b></div>
                </div>
                {taxHarvestData.carryforwardAnalysis.optimalUsage && (
                  <div className="text-[9px] text-muted-foreground italic mt-1">{taxHarvestData.carryforwardAnalysis.optimalUsage}</div>
                )}
              </div>
            )}

            {/* Harvesting candidates */}
            {taxHarvestData.recommendations?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🌱 Kandidati za harvesting ({taxHarvestData.recommendations.length}):</div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {taxHarvestData.recommendations.map((r: Record<string, any>, i: number) => {
                    const actCfg: Record<string, { color: string; bg: string; icon: string }> = {
                      harvest_now: { color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', icon: '🔴' },
                      wait_year_end: { color: 'text-amber-400', bg: 'bg-amber-400/5 border-amber-400/20', icon: '🟡' },
                      wait_3yr_holding: { color: 'text-blue-400', bg: 'bg-blue-400/5 border-blue-400/20', icon: '🔵' },
                      hold: { color: 'text-muted-foreground', bg: 'bg-background/40 border-border', icon: '⚪' },
                      bundle_with_gain: { color: 'text-primary', bg: 'bg-primary/5 border-primary/20', icon: '🟢' },
                    };
                    const cfg = actCfg[r.action] || actCfg.hold;
                    return (
                      <div key={i} className={cn('border rounded p-1.5 space-y-1', cfg.bg)}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span>{cfg.icon}</span>
                            <span className="font-bold text-[11px] truncate">{r.title}</span>
                          </div>
                          <Badge variant="outline" className={cn('text-[9px] uppercase shrink-0', cfg.color)}>
                            {r.action.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-[9px]">
                          <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{r.cost}€</span></div>
                          <div><span className="text-muted-foreground">Est. prodaja:</span> <span className="font-mono">{r.estimatedValue}€</span></div>
                          <div><span className="text-muted-foreground">Izguba:</span> <span className="font-mono text-destructive">−{r.projectedLoss}€</span></div>
                          <div><span className="text-muted-foreground">Davek:</span> <span className="font-mono text-primary">+{r.taxBenefitEur}€</span></div>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          ⏱ {r.daysHeld}d ({r.daysHeldYears} let) · Rok: {r.deadline || '—'}
                        </div>
                        {r.reasoning && <div className="text-[9px] italic">{r.reasoning}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Warnings */}
            {taxHarvestData.warnings?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Davčna opozorila:</div>
                <ul className="space-y-0.5 ml-3">
                  {taxHarvestData.warnings.map((w: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
