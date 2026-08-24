'use client';

// v9.02: Extracted from statistics-view.tsx — AI Profit Maximization Playbook (v6.40 MILESTONE)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function ProfitPlaybook() {
  const [playbookData, setPlaybookData] = useState<Record<string, any> | null>(null);
  const [playbookLoading, setPlaybookLoading] = useState(false);

  return (
    <Card className="bg-card/50 border-primary/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          📖 AI Profit Maximization Playbook
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.40 MILESTONE</Badge>
        </CardTitle>
        <CardDescription className="text-xs">8-fazni workflow ki kombinira vseh 160+ AI funkcij od sourcing do reinvestment.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" className="gap-2 h-7 text-xs" disabled={playbookLoading}
          onClick={async () => {
            setPlaybookLoading(true); setPlaybookData(null);
            try {
              const res = await fetch('/api/ai/profit-playbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
              const data = await res.json();
              if (data.ok) { setPlaybookData(data); toast.success('✓ Profit playbook generiran'); }
              else toast.error(data.error ?? 'Napaka');
            } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
            finally { setPlaybookLoading(false); }
          }}>
          {playbookLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Generiraj playbook
        </Button>
        {playbookLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI ustvarja 8-fazni profit maximization playbook...</div>
        ) : playbookData?.playbook ? (
          <div className="space-y-2 text-xs">
            {/* Phases */}
            {playbookData.playbook.phases?.length > 0 && (
              <div className="space-y-1">
                {playbookData.playbook.phases.map((p: Record<string, any>, i: number) => (
                  <div key={i} className="bg-background/40 border rounded p-1.5 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[10px]">{p.phase}. {p.name}</span>
                      <Badge variant="outline" className={cn('text-[8px]', p.automationLevel === 'full' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>{p.automationLevel}</Badge>
                    </div>
                    <div className="text-[9px] text-muted-foreground">{p.description}</div>
                    <div className="text-[9px] text-primary">🤖 {p.aiModules?.slice(0, 3).join(' · ')}</div>
                    {p.actions?.length > 0 && <div className="text-[9px]">→ {p.actions[0]?.action} <span className="text-primary">(+{p.actions[0]?.expectedImpactEur}€)</span></div>}
                  </div>
                ))}
              </div>
            )}
            {/* Expected outcome */}
            {playbookData.playbook.expectedOutcome && (
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border"><div className="text-muted-foreground uppercase">Trenutno/mesec</div><div className="font-bold">{playbookData.playbook.expectedOutcome.currentMonthlyProfitEur ?? 0}€</div></div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Projicirano</div><div className="font-bold text-primary">{playbookData.playbook.expectedOutcome.projectedMonthlyProfitEur ?? 0}€</div></div>
              </div>
            )}
            {/* Summary */}
            {playbookData.playbook.summary && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] uppercase text-primary mb-1">Playbook score: {playbookData.playbook.summary.playbookScore}/100</div>
                <div className="text-[10px]"><b>🚀 Quick win:</b> {playbookData.playbook.summary.quickestWin}</div>
                <div className="text-[10px]"><b>🎯 Biggest opportunity:</b> {playbookData.playbook.summary.biggestOpportunity}</div>
                <div className="text-[10px]"><b>📅 90d profit:</b> <span className="font-mono font-bold text-primary">{playbookData.playbook.summary.expected90dProfitEur}€</span></div>
              </div>
            )}
            {playbookData.playbook.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] text-primary">{playbookData.playbook.insights}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Klikni za AI 8-fazni profit maximization playbook.</p>
        )}
      </CardContent>
    </Card>
  );
}
