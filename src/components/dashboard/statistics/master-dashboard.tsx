'use client';

// v9.02: Extracted from statistics-view.tsx — AI Master Dashboard (v6.40 MILESTONE)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function MasterDashboard() {
  const [masterData, setMasterData] = useState<any>(null);
  const [masterLoading, setMasterLoading] = useState(false);

  return (
    <Card className="bg-card/50 border-primary/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          🎯 AI Master Dashboard
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.40 MILESTONE</Badge>
        </CardTitle>
        <CardDescription className="text-xs">Unified view vseh 160+ AI funkcij z 8 sekcijami: executive, financial, inventory, market, risk, automation, AI, actions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" className="gap-2 h-7 text-xs" disabled={masterLoading}
          onClick={async () => {
            setMasterLoading(true); setMasterData(null);
            try {
              const res = await fetch('/api/ai/master-dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
              const data = await res.json();
              if (data.ok) { setMasterData(data); toast.success('✓ Master dashboard generiran'); }
              else toast.error(data.error ?? 'Napaka');
            } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
            finally { setMasterLoading(false); }
          }}>
          {masterLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Generiraj master dashboard
        </Button>
        {masterLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI agregira vseh 160+ funkcij v unified dashboard...</div>
        ) : masterData?.master ? (
          <div className="space-y-2 text-xs">
            {/* Executive */}
            <div className={cn('border rounded p-2 text-center',
              masterData.master.executive.healthScore >= 70 ? 'bg-primary/10 border-primary/30' :
              masterData.master.executive.healthScore >= 40 ? 'bg-amber-400/5 border-amber-400/20' : 'bg-red-500/5 border-red-500/20')}>
              <div className="text-[10px] uppercase text-muted-foreground">Portfolio Health</div>
              <div className="text-3xl font-bold">{masterData.master.executive.healthScore}/100</div>
              <Badge variant="outline" className={cn('text-[9px] font-bold', masterData.master.executive.healthGrade.startsWith('A') ? 'text-primary border-primary/40' : masterData.master.executive.healthGrade.startsWith('B') ? 'text-blue-400 border-blue-400/40' : 'text-red-500 border-red-500/40')}>Grade: {masterData.master.executive.healthGrade}</Badge>
              <div className="text-[10px] mt-1">{masterData.master.executive.oneLineSummary}</div>
            </div>
            {/* 8-section grid */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">💰 Dobiček</div><div className="font-bold text-primary">{masterData.master.financial?.realizedProfitEur ?? 0}€</div><div className="text-[8px] text-muted-foreground">ROI {masterData.master.financial?.avgRoiPct ?? 0}%</div></div>
              <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">📦 Inventar</div><div className="font-bold">{masterData.master.inventory?.totalItems ?? 0} itemov</div><div className="text-[8px] text-muted-foreground">{masterData.master.inventory?.stalledItems ?? 0} stalled</div></div>
              <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">🚀 Priložnosti</div><div className="font-bold text-primary">{masterData.master.market?.activeOpportunities ?? 0}</div><div className="text-[8px] text-muted-foreground">{masterData.master.market?.competitionLevel} konkurenca</div></div>
              <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">⚠️ Tveganja</div><div className="font-bold text-amber-400">{masterData.master.risk?.riskScore ?? 0}/100</div><div className="text-[8px] text-muted-foreground">{masterData.master.risk?.highRiskItems ?? 0} high risk</div></div>
              <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">🤖 Avtomatizacija</div><div className="font-bold">{masterData.master.automation?.activeMonitors ?? 0} monitorjev</div><div className="text-[8px] text-muted-foreground">{masterData.master.automation?.automationLevel}</div></div>
              <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">🧠 AI accuracy</div><div className="font-bold text-primary">{masterData.master.ai?.overallAiAccuracyPct ?? 0}%</div><div className="text-[8px] text-muted-foreground">{masterData.master.ai?.aiLearningTrend}</div></div>
            </div>
            {/* Actions */}
            {masterData.master.actions?.length > 0 && (
              <div><div className="text-[10px] uppercase text-muted-foreground mb-1">📋 Top akcije:</div>
                {masterData.master.actions.slice(0, 4).map((a: any, i: number) => (
                  <div key={i} className="text-[10px] flex items-center justify-between bg-background/40 rounded p-1 border mb-0.5">
                    <span>{a.action}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className={cn('text-[8px]', a.priority === 'critical' ? 'text-red-500 border-red-500/30' : a.priority === 'high' ? 'text-amber-400 border-amber-400/30' : 'text-muted-foreground')}>{a.priority}</Badge>
                      {a.impactEur > 0 && <span className="font-mono text-primary">+{a.impactEur}€</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {masterData.master.masterSummary && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] italic">{masterData.master.masterSummary}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni za AI master dashboard z vsemi 160+ metrikami.</p>
        )}
      </CardContent>
    </Card>
  );
}
