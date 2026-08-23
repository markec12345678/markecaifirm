'use client';

// v9.01: Extracted from statistics-view.tsx — AI Budget Allocator (v6.6)

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wallet, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function BudgetAllocator() {
  // v6.6: Budget allocator
  const [budgetData, setBudgetData] = useState<any>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetInput, setBudgetInput] = useState('1000');

  return (
    <>
      {/* v6.6: AI Budget Allocator */}
      <Card className="bg-card/50 border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            AI Budget Allocator
            <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.6</Badge>
          </CardTitle>
          <CardDescription className="text-xs">AI predlaga razporeditev proračuna po kategorijah za maksimalni dobiček.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input type="number" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="Proračun (€)" className="text-xs font-mono h-7 w-32" />
            <Button size="sm" className="h-7 text-xs gap-1" disabled={budgetLoading || !budgetInput.trim()}
              onClick={async () => {
                setBudgetLoading(true); setBudgetData(null);
                try {
                  const res = await fetch('/api/ai/budget-allocator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ totalBudget: parseInt(budgetInput, 10) }) });
                  const data = await res.json();
                  if (data.ok) { setBudgetData(data); toast.success(`✓ Pričakovani dobiček: ${data.totalExpectedProfit}€`); }
                  else toast.error(data.error ?? 'Napaka');
                } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
                finally { setBudgetLoading(false); }
              }}>
              {budgetLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
              Razporedi
            </Button>
          </div>
          {budgetLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-2 animate-spin opacity-50" />AI analizira kategorije...</div>
          ) : budgetData ? (
            <div className="space-y-2 text-xs">
              {budgetData.strategy && <div className="bg-primary/5 border border-primary/20 rounded p-2 text-primary">{budgetData.strategy}</div>}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Pričakovan dobiček</div>
                  <div className="font-mono font-bold text-primary text-lg">{budgetData.totalExpectedProfit}€</div>
                </div>
                <div className="bg-background/30 rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Rezerva</div>
                  <div className="font-mono font-bold text-amber-400">{budgetData.reserveAmount}€</div>
                </div>
              </div>
              <div className="space-y-1">
                {budgetData.allocation?.map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-1.5 bg-background/30 rounded">
                    <Badge variant="outline" className="text-[9px] shrink-0">{a.category}</Badge>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-primary">{a.suggestedBudget}€</span>
                        <span className="text-[9px] text-muted-foreground">({a.percentage}%)</span>
                        <span className={cn('font-mono text-[10px]', a.expectedROI > 0 ? 'text-primary' : 'text-red-500')}>
                          ROI {a.expectedROI > 0 ? '+' : ''}{a.expectedROI}%
                        </span>
                        <span className="font-mono text-[10px] text-primary">→ +{a.expectedProfit}€</span>
                      </div>
                      <div className="text-[9px] text-muted-foreground italic">{a.reasoning}</div>
                    </div>
                    <div className="w-16 h-2 bg-background rounded overflow-hidden shrink-0">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, a.percentage)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-2">Vnesi proračun in klikni "Razporedi" za AI predlog.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
