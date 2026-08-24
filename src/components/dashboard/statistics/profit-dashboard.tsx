'use client';

// v9.02: Extracted from statistics-view.tsx — AI Profit Maximization Dashboard (v6.30 MILESTONE)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ProfitDashboard() {
  const [dashData, setDashData] = useState<Record<string, any> | null>(null);
  const [dashLoading, setDashLoading] = useState(false);

  return (
    <Card className="bg-card/50 border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          🎯 AI Profit Maximization Dashboard
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.30 MILESTONE</Badge>
        </CardTitle>
        <CardDescription className="text-xs">Agregira VSE AI metrike v eno unified view z health score, opportunities, risks in projections.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" className="gap-2 h-7 text-xs" disabled={dashLoading}
          onClick={async () => {
            setDashLoading(true); setDashData(null);
            try {
              const res = await fetch('/api/ai/profit-dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
              const data = await res.json();
              if (data.ok) { setDashData(data); toast.success('✓ Profit dashboard generiran'); }
              else toast.error(data.error ?? data.message ?? 'Napaka');
            } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
            finally { setDashLoading(false); }
          }}>
          {dashLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Generiraj dashboard
        </Button>
        {dashLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI agregira vse metrike v unified dashboard...</div>
        ) : dashData?.dashboard ? (
          <div className="space-y-2 text-xs">
            {/* Health score */}
            <div className={cn('border rounded p-2 text-center',
              dashData.dashboard.portfolioHealthScore >= 70 ? 'bg-primary/10 border-primary/30' :
              dashData.dashboard.portfolioHealthScore >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
              <div className="text-[10px] uppercase text-muted-foreground">Portfolio Health Score</div>
              <div className="text-3xl font-bold">{dashData.dashboard.portfolioHealthScore}/100</div>
              <Badge variant="outline" className={cn('text-[9px] font-bold',
                dashData.dashboard.portfolioHealthGrade.startsWith('A') ? 'text-primary border-primary/40' :
                dashData.dashboard.portfolioHealthGrade.startsWith('B') ? 'text-blue-400 border-blue-400/40' :
                'text-red-500 border-red-500/40')}>Grade: {dashData.dashboard.portfolioHealthGrade}</Badge>
            </div>
            {/* KPIs */}
            {dashData.dashboard.kpis && (
              <div className="grid grid-cols-4 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Dobiček</div><div className="font-bold text-primary">{dashData.dashboard.kpis.realizedProfitEur ?? 0}€</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Vezano</div><div className="font-bold">{dashData.dashboard.kpis.investedHeldEur ?? 0}€</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">ROI</div><div className="font-bold text-primary">{dashData.dashboard.kpis.avgRoiPct ?? 0}%</div></div>
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Prodaja</div><div className="font-bold">{dashData.dashboard.kpis.avgDaysToSell ?? 0}d</div></div>
              </div>
            )}
            {/* Top opportunities */}
            {dashData.dashboard.topOpportunities?.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">🚀 Top priložnosti:</div>
                {dashData.dashboard.topOpportunities.slice(0, 3).map((o: Record<string, any>, i: number) => (
                  <div key={i} className="text-[10px] flex items-center justify-between">
                    <span><Badge variant="outline" className="text-[8px] mr-1">{o.category}</Badge> {o.action}</span>
                    <span className="font-mono text-primary">{o.expectedRoiPct}% ROI</span>
                  </div>
                ))}
              </div>
            )}
            {/* Top risks */}
            {dashData.dashboard.topRisks?.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                <div className="text-[10px] uppercase text-red-500 mb-1">⚠️ Top tveganja:</div>
                {dashData.dashboard.topRisks.slice(0, 3).map((r: Record<string, any>, i: number) => (
                  <div key={i} className="text-[10px] flex items-center justify-between">
                    <span><Badge variant="outline" className="text-[8px] mr-1">{r.riskType}</Badge> {r.item}</span>
                    <span className="font-mono text-destructive">−{r.potentialLossEur}€</span>
                  </div>
                ))}
              </div>
            )}
            {/* Recommended actions */}
            {dashData.dashboard.recommendedActions?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Priporočene akcije:</div>
                {dashData.dashboard.recommendedActions.slice(0, 4).map((a: Record<string, any>, i: number) => (
                  <div key={i} className="text-[10px] flex items-center justify-between bg-background/40 rounded p-1 border mb-0.5">
                    <span>{a.action}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className={cn('text-[8px]', a.priority === 'critical' ? 'text-red-500 border-red-500/30' : a.priority === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>{a.priority}</Badge>
                      {a.expectedImpactEur > 0 && <span className="font-mono text-primary">+{a.expectedImpactEur}€</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {dashData.dashboard.overallAssessment && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] italic">{dashData.dashboard.overallAssessment}</div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni za AI dashboard z vsemi metrikami in priporočili.</p>
        )}
      </CardContent>
    </Card>
  );
}
