'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ListingPerformanceTracker() {
  // v6.24: Listing Performance Tracker
  const [perfData, setPerfData] = useState<Record<string, any> | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);

  return (
    <>
      {/* v6.24: Listing Performance Tracker */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-teal-400/40 text-teal-400 hover:bg-teal-400/10"
        disabled={perfLoading}
        onClick={async () => {
          setPerfLoading(true); setPerfData(null);
          try {
            const res = await fetch('/api/ai/listing-performance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            const data = await res.json();
            if (data.ok) { setPerfData(data); toast.success('✓ Analiza uspešnosti generirana'); }
            else toast.error(data.error ?? data.message ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setPerfLoading(false); }
        }}
        title="AI analizira uspešnost prodaj in priporoči optimizacije"
      >
        {perfLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
        Uspešnost
      </Button>

      {/* v6.24: AI Listing Performance Tracker results */}
      {perfData && (
        <Card className="bg-card/50 border-teal-400/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-bold">AI Listing Performance Tracker</span>
                <Badge variant="outline" className="text-[10px] text-teal-400 border-teal-400/40">v6.24</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPerfData(null)} className="h-6 text-xs">×</Button>
            </div>

            {perfData.insights && (
              <div className="bg-teal-400/5 border border-teal-400/20 rounded p-2 text-xs text-teal-400">{perfData.insights}</div>
            )}

            {/* Summary */}
            {perfData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Skupni dobiček</div><div className="font-bold text-primary">{perfData.summary.totalProfitEur ?? 0}€</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Povp. ROI</div><div className="font-bold text-primary">{perfData.summary.avgRoiPct ?? 0}%</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Povp. dni prodaje</div><div className="font-bold">{perfData.summary.avgDaysToSell ?? 0}d</div></div>
                <div className="bg-teal-400/5 border border-teal-400/20 rounded p-1.5"><div className="text-teal-400 uppercase">Strategija</div><div className="font-bold text-teal-400">{(perfData.summary.recommendedStrategy ?? 'double_down').replace('_', ' ')}</div></div>
              </div>
            )}

            {/* Category performance */}
            {perfData.categoryPerformance?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📊 Uspešnost po kategorijah:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {perfData.categoryPerformance.map((c: Record<string, any>, i: number) => {
                    const recCfg: Record<string, { color: string; icon: string }> = {
                      double_down: { color: 'text-primary', icon: '📈' },
                      pivot: { color: 'text-amber-400', icon: '🔄' },
                      scale_up: { color: 'text-primary', icon: '⬆️' },
                      diversify: { color: 'text-blue-400', icon: '➕' },
                      exit: { color: 'text-red-500', icon: '❌' },
                    };
                    const cfg = recCfg[c.recommendation] || recCfg.double_down;
                    return (
                      <div key={i} className="bg-background/40 border rounded p-1.5 text-[10px] flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{cfg.icon}</span>
                          <Badge variant="outline" className="text-[8px] shrink-0">{c.category}</Badge>
                          <span className="text-muted-foreground">{c.avgDaysToSell}d · {c.successRatePct}% uspeh</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-primary">{c.totalProfitEur}€</span>
                          <Badge variant="outline" className={cn('text-[8px]', cfg.color)}>{c.recommendation.replace('_', ' ')}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top performers */}
            {perfData.topPerformersAnalysis?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-primary mb-1">🏆 Top uspešne prodaje:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {perfData.topPerformersAnalysis.map((t: Record<string, any>, i: number) => (
                    <div key={i} className="bg-primary/5 border border-primary/20 rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate flex-1">{t.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[8px] text-primary border-primary/30">{t.roiPct}% ROI</Badge>
                          <span className="font-mono font-bold text-primary">{t.profitEur}€</span>
                        </div>
                      </div>
                      {t.successFactors?.length > 0 && <div className="text-[9px] text-muted-foreground mt-0.5">✓ {t.successFactors.join(' · ')}</div>}
                      {t.replicate && <div className="text-[9px] text-primary italic mt-0.5">🔄 {t.replicate}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Worst performers */}
            {perfData.worstPerformersAnalysis?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Neuspešne prodaje:</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {perfData.worstPerformersAnalysis.map((t: Record<string, any>, i: number) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate flex-1">{t.title}</span>
                        <span className="font-mono font-bold text-destructive">{t.profitEur}€</span>
                      </div>
                      {t.failureReasons?.length > 0 && <div className="text-[9px] text-red-500 mt-0.5">❌ {t.failureReasons.join(' · ')}</div>}
                      {t.lesson && <div className="text-[9px] text-amber-400 italic mt-0.5">💡 {t.lesson}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Held items forecast */}
            {perfData.heldItemsForecast?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">🔮 Napoved za held iteme:</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {perfData.heldItemsForecast.map((h: Record<string, any>, i: number) => (
                    <div key={i} className="bg-background/40 border rounded p-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold truncate flex-1">{h.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline" className="text-[8px]">{h.confidencePct}%</Badge>
                          <span className="font-mono font-bold text-primary">{h.predictedProfitEur}€</span>
                        </div>
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        📅 {h.predictedDaysToSell}d · 💰 {h.recommendedPriceEur}€ · 📍 {h.recommendedPlatform}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {perfData.recommendations?.length > 0 && (
              <div className="bg-teal-400/5 border border-teal-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-teal-400 mb-1">💡 Priporočila:</div>
                <ul className="space-y-0.5 ml-3">
                  {perfData.recommendations.map((r: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{r}</li>
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
