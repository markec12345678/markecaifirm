'use client';

// v9.02: Extracted from statistics-view.tsx — AI Autonomous Trading (v6.40 MILESTONE)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AutonomousTrading() {
  const [tradeData, setTradeData] = useState<any>(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeMode, setTradeMode] = useState<'paper' | 'live'>('paper');
  const [tradeBudget, setTradeBudget] = useState('1000');

  return (
    <Card className="bg-card/50 border-primary/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          🤖 AI Autonomous Trading
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.40 MILESTONE</Badge>
        </CardTitle>
        <CardDescription className="text-xs">Avtomatski nakup + prodaja z AI odločanjem. Paper (simulacija) ali Live (pravi denar).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value as any)} className="h-7 text-xs bg-background border rounded px-2 flex-1">
            <option value="paper">📋 Paper (simulacija)</option>
            <option value="live">💰 Live (pravi denar)</option>
          </select>
          <Input type="number" placeholder="Budget" value={tradeBudget} onChange={(e) => setTradeBudget(e.target.value)} className="h-7 text-xs w-24" />
          <Button size="sm" className="gap-2 h-7 text-xs" disabled={tradeLoading}
            onClick={async () => {
              setTradeLoading(true); setTradeData(null);
              try {
                const res = await fetch('/api/ai/autonomous-trading', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: tradeMode, maxBudget: Number(tradeBudget) || 1000 }) });
                const data = await res.json();
                if (data.ok) { setTradeData(data); toast.success('✓ Autonomous trading konfiguriran'); }
                else toast.error(data.error ?? 'Napaka');
              } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
              finally { setTradeLoading(false); }
            }}>
            {tradeLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Konfiguriraj
          </Button>
        </div>
        {tradeLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI konfigurira autonomous trading...</div>
        ) : tradeData?.autonomous ? (
          <div className="space-y-2 text-xs">
            <div className={cn('border rounded p-2 text-center', tradeMode === 'live' ? 'bg-primary/10 border-primary/30' : 'bg-amber-400/5 border-amber-400/20')}>
              <div className="text-[10px] uppercase text-muted-foreground">Autonomous Readiness</div>
              <div className="text-2xl font-bold">{tradeData.autonomous.summary.autonomousReadinessScore}/100</div>
              <Badge variant="outline" className={cn('text-[9px]', tradeData.autonomous.summary.recommendedMode === 'live' ? 'text-primary border-primary/40' : 'text-amber-400 border-amber-400/40')}>Priporočeno: {tradeData.autonomous.summary.recommendedMode}</Badge>
            </div>
            {/* Buy rules */}
            {tradeData.autonomous.buyRules?.length > 0 && (
              <div><div className="text-[10px] uppercase text-primary mb-1">🛒 Buy Rules:</div>
                {tradeData.autonomous.buyRules.slice(0, 4).map((r: any, i: number) => (
                  <div key={i} className="text-[10px] flex items-center gap-1 bg-background/40 rounded p-1 border mb-0.5">
                    {r.enabled ? <Check className="w-3 h-3 text-primary shrink-0" /> : <X className="w-3 h-3 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{r.rule}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Sell rules */}
            {tradeData.autonomous.sellRules?.length > 0 && (
              <div><div className="text-[10px] uppercase text-primary mb-1">💰 Sell Rules:</div>
                {tradeData.autonomous.sellRules.slice(0, 4).map((r: any, i: number) => (
                  <div key={i} className="text-[10px] flex items-center gap-1 bg-background/40 rounded p-1 border mb-0.5">
                    {r.enabled ? <Check className="w-3 h-3 text-primary shrink-0" /> : <X className="w-3 h-3 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{r.rule}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Safeguards */}
            {tradeData.autonomous.safeguards?.length > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] uppercase text-amber-400 mb-1">🛡️ Safeguards:</div>
                {tradeData.autonomous.safeguards.slice(0, 4).map((s: any, i: number) => (
                  <div key={i} className="text-[10px]">• <b>{s.name}</b>: {s.trigger} → {s.action}</div>
                ))}
              </div>
            )}
            {/* Projected */}
            {tradeData.autonomous.projected && (
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">Mesečni dobiček</div><div className="font-bold text-primary">{tradeData.autonomous.projected.expectedMonthlyProfitEur ?? 0}€</div></div>
                <div className="bg-primary/5 border border-primary/20 rounded p-1.5"><div className="text-primary uppercase">ROI</div><div className="font-bold text-primary">{tradeData.autonomous.projected.expectedMonthlyRoiPct ?? 0}%</div></div>
              </div>
            )}
            {tradeData.autonomous.insights && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px] text-primary">{tradeData.autonomous.insights}</div>}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">Izberi način in klikni za AI autonomous trading konfiguracijo.</p>
        )}
      </CardContent>
    </Card>
  );
}
