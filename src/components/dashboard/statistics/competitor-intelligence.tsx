'use client';

// v9.02: Extracted from statistics-view.tsx — AI Competitor Intelligence (v6.13)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CompetitorIntelligence() {
  const [competitorData, setCompetitorData] = useState<any>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorCategory, setCompetitorCategory] = useState('');

  return (
    <Card className="bg-card/50 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Competitor Intelligence
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.13</Badge>
        </CardTitle>
        <CardDescription className="text-xs">AI analizira konkurenčne prodajalce, njihove strategije in šibkosti.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <Input
            type="text"
            placeholder="Filter kategorije (opcijsko)"
            value={competitorCategory}
            onChange={(e) => setCompetitorCategory(e.target.value)}
            className="h-7 text-xs flex-1"
          />
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={competitorLoading}
            onClick={async () => {
              setCompetitorLoading(true); setCompetitorData(null);
              try {
                const res = await fetch('/api/ai/competitor-intel', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ category: competitorCategory || undefined }),
                });
                const data = await res.json();
                if (data.ok) { setCompetitorData(data); toast.success('✓ Konkurenčna analiza generirana'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setCompetitorLoading(false); }
            }}>
            {competitorLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj
          </Button>
        </div>
        {competitorLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira prodajalce in njihove strategije...</div>
        ) : competitorData ? (
          <div className="space-y-2 text-xs">
            {competitorData.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{competitorData.insights}</div>
            )}
            {competitorData.summary && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Konkurentov</div>
                  <div className="font-bold">{competitorData.summary.totalCompetitors ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">🔴 High threat</div>
                  <div className="font-bold text-red-500">{competitorData.summary.threatBreakdown?.high ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">🌊 Blue ocean</div>
                  <div className="font-bold text-primary">{competitorData.summary.blueOceanCount ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Vseh prodajalcev</div>
                  <div className="font-bold">{competitorData.summary.totalSellersAnalyzed ?? 0}</div>
                </div>
              </div>
            )}

            {/* Competitor list */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {competitorData.competitors?.map((c: any, i: number) => {
                const threatCfg: Record<string, { color: string; bg: string; icon: string }> = {
                  high: { color: 'text-red-500', bg: 'border-red-500/20 bg-red-500/5', icon: '🔴' },
                  medium: { color: 'text-amber-400', bg: 'border-amber-400/20 bg-amber-400/5', icon: '🟡' },
                  low: { color: 'text-primary', bg: 'border-primary/20 bg-primary/5', icon: '🟢' },
                };
                const cfg = threatCfg[c.threat] || threatCfg.medium;
                const strategyLabels: Record<string, string> = {
                  volume_player: 'Množični',
                  premium_niche: 'Premium niša',
                  discounter: 'Diskonter',
                  specialist: 'Specialist',
                  opportunity_hunter: 'Priložnostni',
                };
                return (
                  <div key={i} className={cn('border rounded p-2 space-y-1.5', cfg.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span>{cfg.icon}</span>
                        <Badge variant="outline" className="text-[9px] shrink-0 truncate max-w-[120px]">{c.sellerName}</Badge>
                        <Badge variant="outline" className="text-[9px] shrink-0">{strategyLabels[c.strategy] || c.strategy}</Badge>
                      </div>
                      <div className="text-[9px] text-muted-foreground shrink-0">
                        {c.listingCount} oglasov · {c.avgPrice}€
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[9px]">
                      <div><span className="text-muted-foreground">Range:</span> <span className="font-mono">{c.minPrice}-{c.maxPrice}€</span></div>
                      <div><span className="text-muted-foreground">Aktiven:</span> <span className="font-mono">{c.daysActive}d</span></div>
                      <div><span className="text-muted-foreground">Pril.:</span> <span className="font-mono">{c.opportunityRate}%</span></div>
                      <div><span className="text-muted-foreground">Deal:</span> <span className="font-mono">{c.avgDealScore}/100</span></div>
                    </div>
                    {c.weaknesses?.length > 0 && (
                      <div className="text-[9px]">
                        <span className="text-red-500 font-semibold">Šibkosti:</span> {c.weaknesses.join(' · ')}
                      </div>
                    )}
                    {c.opportunities?.length > 0 && (
                      <div className="text-[9px]">
                        <span className="text-primary font-semibold">Priložnosti:</span> {c.opportunities.join(' · ')}
                      </div>
                    )}
                    {c.recommendedAction && (
                      <div className="text-[9px] text-primary font-medium">→ {c.recommendedAction}</div>
                    )}
                  </div>
                );
              })}
              {competitorData.competitors?.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-2">Ni konkurentov z vsaj 2 listingoma.</p>
              )}
            </div>

            {/* Blue ocean opportunities */}
            {competitorData.blueOcean?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">🌊 Blue ocean kategorije:</div>
                <div className="space-y-1">
                  {competitorData.blueOcean.map((b: any, i: number) => (
                    <div key={i} className="text-[10px]">
                      <span className="font-bold">{b.category}</span>
                      <span className="text-muted-foreground"> (ROI ~{b.potentialRoiPct}%) — {b.reasoning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Differentiation */}
            {competitorData.differentiation?.length > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-amber-400 mb-1">💡 Predlogi diferenciacije:</div>
                <ul className="space-y-0.5 ml-3">
                  {competitorData.differentiation.map((d: string, i: number) => (
                    <li key={i} className="text-[10px] list-disc list-outside">{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj" za AI analizo konkurenčnih prodajalcev.</p>
        )}
      </CardContent>
    </Card>
  );
}
