'use client';

// v9.02: Extracted from statistics-view.tsx — AI Inventory Insurance Optimizer (v6.14)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InventoryInsurance() {
  const [insuranceData, setInsuranceData] = useState<Record<string, any> | null>(null);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [insuranceStorage, setInsuranceStorage] = useState('home');

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Inventory Insurance Optimizer
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.14</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI analizira tveganja inventarja in predlaga optimalno zavarovanje.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-muted-foreground shrink-0">Skladišče:</span>
          <select
            value={insuranceStorage}
            onChange={(e) => setInsuranceStorage(e.target.value)}
            className="h-7 text-xs bg-background border rounded px-2"
          >
            <option value="home">Dom</option>
            <option value="garage">Garaža</option>
            <option value="storage_unit">Skladišče</option>
            <option value="shop">Trgovina</option>
          </select>
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={insuranceLoading}
            onClick={async () => {
              setInsuranceLoading(true); setInsuranceData(null);
              try {
                const res = await fetch('/api/ai/insurance-optimizer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ storageType: insuranceStorage }),
                });
                const data = await res.json();
                if (data.ok) { setInsuranceData(data); toast.success('✓ Zavarovalna analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
              finally { setInsuranceLoading(false); }
            }}>
            {insuranceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj
          </Button>
        </div>
        {insuranceLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira tveganja kraje, poškodbe in amortizacije...</div>
        ) : insuranceData ? (
          <div className="space-y-2 text-xs">
            {insuranceData.analysis?.riskSummary && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{insuranceData.analysis.riskSummary}</div>
            )}

            {/* Risk analysis grid */}
            {insuranceData.riskAnalysis && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Skupna vrednost</div>
                  <div className="font-bold text-primary">{insuranceData.riskAnalysis.totalValue}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Koncentracija</div>
                  <div className={cn('font-bold uppercase',
                    insuranceData.riskAnalysis.concentrationRisk === 'high' ? 'text-red-500' :
                    insuranceData.riskAnalysis.concentrationRisk === 'medium' ? 'text-amber-400' : 'text-primary')}>
                    {insuranceData.riskAnalysis.concentrationRisk}
                  </div>
                  <div className="text-[9px] text-muted-foreground">{insuranceData.riskAnalysis.concentrationPct}% top 3</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Theft risk</div>
                  <div className={cn('font-bold uppercase',
                    insuranceData.riskAnalysis.theftRiskLevel === 'high' ? 'text-red-500' :
                    insuranceData.riskAnalysis.theftRiskLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                    {insuranceData.riskAnalysis.theftRiskLevel}
                  </div>
                  <div className="text-[9px] text-muted-foreground">{insuranceData.riskAnalysis.theftRisk}/10</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Amortizacija</div>
                  <div className={cn('font-bold uppercase',
                    insuranceData.riskAnalysis.depreciationRiskLevel === 'high' ? 'text-red-500' :
                    insuranceData.riskAnalysis.depreciationRiskLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                    {insuranceData.riskAnalysis.depreciationRiskLevel}
                  </div>
                  <div className="text-[9px] text-muted-foreground">−{insuranceData.riskAnalysis.totalDepreciationLoss}€/leto</div>
                </div>
              </div>
            )}

            {/* Strategy + policy */}
            {insuranceData.analysis?.recommendedStrategy && insuranceData.analysis?.policy && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">
                  🛡️ Priporočena strategija: <b>{insuranceData.analysis.recommendedStrategy.replace('_', ' ')}</b>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Tip:</span> <b>{insuranceData.analysis.policy.type || '—'}</b></div>
                  <div><span className="text-muted-foreground">Pokritje:</span> <b className="font-mono">{insuranceData.analysis.policy.coverageEur}€</b></div>
                  <div><span className="text-muted-foreground">Premija/leto:</span> <b className="font-mono">{insuranceData.analysis.policy.estimatedAnnualPremiumEur}€</b></div>
                </div>
                {insuranceData.analysis.policy.providers?.length > 0 && (
                  <div className="text-[9px] text-muted-foreground mt-1">
                    🏛️ Ponudniki: {insuranceData.analysis.policy.providers.join(' · ')}
                  </div>
                )}
              </div>
            )}

            {/* Self insurance reserve */}
            {insuranceData.analysis?.selfInsuranceReserve > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5 text-[10px]">
                💰 Samo-zavarovanje rezerva: <b className="font-mono text-amber-400">{insuranceData.analysis.selfInsuranceReserve}€</b>
                <span className="text-muted-foreground"> (za self-insured del portfolia)</span>
              </div>
            )}

            {/* High risk items */}
            {insuranceData.analysis?.highRiskItems?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Visoko tvegani itemi:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {insuranceData.analysis.highRiskItems.map((h: Record<string, any>, i: number) => (
                    <div key={i} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{h.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30">{h.risk}</Badge>
                          <span className="font-mono">{h.estimatedValue}€</span>
                        </div>
                      </div>
                      <div className="text-[9px] text-primary">→ {h.recommendation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {insuranceData.analysis?.recommendations?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">💡 Priporočila:</div>
                <div className="space-y-1">
                  {insuranceData.analysis.recommendations.map((r: Record<string, any>, i: number) => {
                    const prColor = r.priority === 'high' ? 'text-red-500' : r.priority === 'medium' ? 'text-amber-400' : 'text-blue-400';
                    return (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{r.action}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className={cn('text-[9px]', prColor)}>{r.priority}</Badge>
                            <span className="font-mono text-primary">+{r.savingsEur}€</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj" za AI analizo zavarovalnih tveganj in optimalne police.</p>
        )}
      </CardContent>
    </Card>
  );
}
