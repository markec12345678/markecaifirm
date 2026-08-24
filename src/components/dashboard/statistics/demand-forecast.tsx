'use client';

// v9.01: Extracted from statistics-view.tsx — AI Demand Forecast (v6.12)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function DemandForecast() {
  // v6.12: Demand Forecast
  const [demandData, setDemandData] = useState<any>(null);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandMonths, setDemandMonths] = useState('3');

  return (
    <>
      {/* v6.12: AI Demand Forecast */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Napoved povpraševanja
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.12</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI napove povpraševanje po kategorijah za naslednje mesece (sezonstost + trendi).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-[10px] text-muted-foreground shrink-0">Mesecev naprej:</span>
            <Input
              type="number"
              min={1}
              max={6}
              value={demandMonths}
              onChange={(e) => setDemandMonths(e.target.value)}
              className="h-7 text-xs w-20"
            />
            <Button size="sm" className="gap-2 h-7 text-xs" disabled={demandLoading}
              onClick={async () => {
                setDemandLoading(true); setDemandData(null);
                try {
                  const months = Math.max(1, Math.min(6, Number(demandMonths) || 3));
                  const res = await fetch('/api/ai/demand-forecast-v6', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ months }),
                  });
                  const data = await res.json();
                  if (data.ok) { setDemandData(data); toast.success('✓ Napoved povpraševanja generirana'); }
                  else toast.error(data.error ?? data.message ?? 'Napaka');
                } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
                finally { setDemandLoading(false); }
              }}>
              {demandLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Napovej
            </Button>
          </div>
          {demandLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira sezonske vzorce in trende...</div>
          ) : demandData ? (
            <div className="space-y-2 text-xs">
              {demandData.insights && (
                <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{demandData.insights}</div>
              )}
              {demandData.summary && (
                <div className="grid grid-cols-5 gap-2 text-[10px]">
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">Kategorij</div>
                    <div className="font-bold">{demandData.summary.totalCategories ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">📈 Raste</div>
                    <div className="font-bold text-primary">{demandData.summary.growingCats ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">📉 Pada</div>
                    <div className="font-bold text-destructive">{demandData.summary.decliningCats ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">🛒 Kupi</div>
                    <div className="font-bold text-primary">{demandData.summary.buyRecs ?? 0}</div>
                  </div>
                  <div className="bg-background/40 rounded p-1.5 border">
                    <div className="text-muted-foreground uppercase">💰 Prodaj</div>
                    <div className="font-bold text-amber-400">{demandData.summary.sellRecs ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {demandData.forecasts?.map((f: any, i: number) => {
                  const trendIcon = f.trend === 'growing' ? '📈' : f.trend === 'declining' ? '📉' : '➡️';
                  const trendColor = f.trend === 'growing' ? 'text-primary' : f.trend === 'declining' ? 'text-destructive' : 'text-muted-foreground';
                  const recColor = f.recommendation === 'buy' ? 'text-primary' : f.recommendation === 'sell' ? 'text-amber-400' : 'text-blue-400';
                  return (
                    <div key={i} className="border rounded p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span>{trendIcon}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0">{f.category}</Badge>
                          <span className={cn('text-[9px] uppercase font-bold', trendColor)}>{f.trend}</span>
                          {f.seasonality === 'high' && <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30 shrink-0">sezonstost</Badge>}
                        </div>
                        <Badge variant="outline" className={cn('text-[9px] shrink-0 uppercase', recColor)}>→ {f.recommendation}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[9px]">
                        <div className="bg-background/40 rounded p-1 border">
                          <div className="text-muted-foreground">Trenutno</div>
                          <div className="font-mono font-bold">{f.currentDemand}/200</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border">
                          <div className="text-muted-foreground">Napoved</div>
                          <div className={cn('font-mono font-bold', f.forecastDemand > f.currentDemand ? 'text-primary' : 'text-destructive')}>{f.forecastDemand}/200</div>
                        </div>
                        <div className="bg-background/40 rounded p-1 border">
                          <div className="text-muted-foreground">Prič. ROI</div>
                          <div className="font-mono font-bold text-primary">{f.expectedRoiPct}%</div>
                        </div>
                      </div>
                      {(f.peakMonths?.length > 0 || f.lowMonths?.length > 0) && (
                        <div className="text-[9px] text-muted-foreground">
                          {f.peakMonths?.length > 0 && <span>🔺 Vrh: {f.peakMonths.join(', ')}</span>}
                          {f.peakMonths?.length > 0 && f.lowMonths?.length > 0 && <span> · </span>}
                          {f.lowMonths?.length > 0 && <span>🔻 Nizko: {f.lowMonths.join(', ')}</span>}
                        </div>
                      )}
                      {f.opportunities?.length > 0 && (
                        <div className="text-[9px]">
                          <span className="text-muted-foreground">💡 Priložnosti: </span>
                          {f.opportunities.join(' · ')}
                        </div>
                      )}
                      {f.reasoning && <div className="text-[9px] text-muted-foreground italic">{f.reasoning}</div>}
                    </div>
                  );
                })}
                {demandData.forecasts?.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2">Ni dovolj podatkov za napoved.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Napovej" za AI napoved povpraševanja po kategorijah.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
