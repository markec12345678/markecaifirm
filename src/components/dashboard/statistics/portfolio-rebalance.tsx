'use client';

// v9.01: Extracted from statistics-view.tsx — AI Portfolio Rebalancing (v6.9)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function PortfolioRebalance() {
  // v6.9: Rebalance
  const [rebalanceData, setRebalanceData] = useState<any>(null);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);

  return (
    <>
      {/* v6.9: AI Portfolio Rebalancing */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Rebalancing portfolia
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.9</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI predlaga kako prerazporediti investicije za maksimalni dobiček.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={rebalanceLoading}
            onClick={async () => {
              setRebalanceLoading(true); setRebalanceData(null);
              try {
                const res = await fetch('/api/ai/rebalance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                const data = await res.json();
                if (data.ok) { setRebalanceData(data); toast.success('✓ Rebalancing predlog generiran'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
              finally { setRebalanceLoading(false); }
            }}>
            {rebalanceLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Analiziraj portfolio
          </Button>
          {rebalanceLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira portfolio...</div>
          ) : rebalanceData ? (
            <div className="space-y-2 text-xs">
              {rebalanceData.strategy && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{rebalanceData.strategy}</div>}
              <div className="text-[10px] uppercase text-muted-foreground">Trenutna alokacija: {rebalanceData.totalInvested}€</div>
              <div className="space-y-1">
                {rebalanceData.actions?.map((a: any, i: number) => {
                  const actionCfg: Record<string, { icon: string; color: string; label: string }> = {
                    buy_more: { icon: '📈', color: 'text-primary', label: 'Povečaj' },
                    reduce: { icon: '📉', color: 'text-amber-400', label: 'Zmanjšaj' },
                    hold: { icon: '⏸️', color: 'text-muted-foreground', label: 'Obdrži' },
                    exit: { icon: '🚪', color: 'text-red-500', label: 'Izhod' },
                  };
                  const cfg = actionCfg[a.action] || actionCfg.hold;
                  return (
                    <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded border',
                      a.action === 'buy_more' ? 'bg-primary/5 border-primary/20' :
                      a.action === 'exit' ? 'bg-red-500/5 border-red-500/20' :
                      a.action === 'reduce' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/30 border-border')}>
                      <Badge variant="outline" className="text-[9px] shrink-0">{a.category}</Badge>
                      <span className={cn('font-bold text-[10px] shrink-0', cfg.color)}>{cfg.icon} {cfg.label}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] text-muted-foreground">{a.currentPct}% → </span>
                        <span className={cn('font-mono font-bold text-[10px]', cfg.color)}>{a.suggestedPct}%</span>
                        <span className="text-[9px] text-muted-foreground italic ml-1">{a.reason}</span>
                      </div>
                      {/* Mini progress bar */}
                      <div className="w-12 h-1.5 bg-background rounded overflow-hidden shrink-0 relative">
                        <div className="absolute h-full bg-muted-foreground/30" style={{ width: `${a.currentPct}%` }} />
                        <div className={cn('absolute h-full', cfg.color.replace('text-', 'bg-'))} style={{ width: `${a.suggestedPct}%`, opacity: 0.5 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Klikni "Analiziraj portfolio" za AI predlog rebalancinga.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
