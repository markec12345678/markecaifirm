'use client';

// v9.02: Extracted from statistics-view.tsx — AI Full Automation Orchestrator (v6.30 MILESTONE)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function FullAutomation() {
  const [autoData, setAutoData] = useState<any>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoMode, setAutoMode] = useState<'advisory' | 'semi_auto' | 'full_auto'>('advisory');

  return (
    <Card className="bg-card/50 border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          🤖 AI Full Automation Orchestrator
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.30 MILESTONE</Badge>
        </CardTitle>
        <CardDescription className="text-xs">3 nivoji avtomatizacije: advisory → semi_auto → full_auto z buy+sell pipelines.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <select value={autoMode} onChange={(e) => setAutoMode(e.target.value as any)} className="h-7 text-xs bg-background border rounded px-2 flex-1">
            <option value="advisory">📋 Advisory (samo priporočila)</option>
            <option value="semi_auto">⚙️ Semi-auto (monitoring + alerti)</option>
            <option value="full_auto">🤖 Full-auto (avtomatski nakup + prodaja)</option>
          </select>
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={autoLoading}
            onClick={async () => {
              setAutoLoading(true); setAutoData(null);
              try {
                const res = await fetch('/api/ai/full-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: autoMode }) });
                const data = await res.json();
                if (data.ok) { setAutoData(data); toast.success('✓ Automation načrt generiran'); }
                else toast.error(data.error ?? data.message ?? 'Napaka');
              } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
              finally { setAutoLoading(false); }
            }}>
            {autoLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Generiraj
          </Button>
        </div>
        {autoLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI ustvarja avtomacijski načrt...</div>
        ) : autoData?.automation ? (
          <div className="space-y-2 text-xs">
            <div className={cn('border rounded p-2 text-center',
              autoMode === 'full_auto' ? 'bg-primary/10 border-primary/30' : autoMode === 'semi_auto' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/40 border-border')}>
              <div className="text-[10px] uppercase text-muted-foreground">Avtomacijski nivo</div>
              <div className="font-bold text-sm capitalize">{autoData.automation.mode.replace('_', ' ')}</div>
            </div>
            {/* Buy pipeline */}
            {autoData.automation.buyPipeline?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-primary mb-1">🛒 Buy Pipeline:</div>
                {autoData.automation.buyPipeline.slice(0, 5).map((s: any, i: number) => (
                  <div key={i} className="text-[10px] flex items-center gap-1 bg-background/40 rounded p-1 border mb-0.5">
                    <span className="font-mono font-bold shrink-0">{s.step}.</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    {s.automated && <Badge variant="outline" className="text-[8px] text-primary border-primary/30 shrink-0">🤖 auto</Badge>}
                  </div>
                ))}
              </div>
            )}
            {/* Sell pipeline */}
            {autoData.automation.sellPipeline?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-primary mb-1">💰 Sell Pipeline:</div>
                {autoData.automation.sellPipeline.slice(0, 5).map((s: any, i: number) => (
                  <div key={i} className="text-[10px] flex items-center gap-1 bg-background/40 rounded p-1 border mb-0.5">
                    <span className="font-mono font-bold shrink-0">{s.step}.</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    {s.automated && <Badge variant="outline" className="text-[8px] text-primary border-primary/30 shrink-0">🤖 auto</Badge>}
                  </div>
                ))}
              </div>
            )}
            {/* Safeguards */}
            {autoData.automation.safeguards?.length > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-amber-400 mb-1">🛡️ Zaščite:</div>
                {autoData.automation.safeguards.slice(0, 4).map((s: any, i: number) => (
                  <div key={i} className="text-[10px]">• <b>{s.name}</b>: {s.rule}</div>
                ))}
              </div>
            )}
            {/* Expected improvements */}
            {autoData.automation.expectedImprovements && (
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Čas prihranjen</div><div className="font-bold">{autoData.automation.expectedImprovements.timeSavedHoursPerWeek ?? 0}h/teden</div></div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Profit+</div><div className="font-bold text-primary">{autoData.automation.expectedImprovements.profitIncreasePct ?? 0}%</div></div>
              </div>
            )}
            {autoData.automation.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] text-primary">{autoData.automation.insights}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Izberi nivo avtomatizacije in klikni za AI načrt.</p>
        )}
      </CardContent>
    </Card>
  );
}
