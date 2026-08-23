'use client';

// v9.09: Extracted from inventory-view.tsx — AI Portfolio Rebalancer v3

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Recycle } from 'lucide-react';
import { toast } from 'sonner';

export function PortfolioRebalancer() {
  const [rebalancer, setRebalancer] = useState<any>(null);
  const [rebalancerLoading, setRebalancerLoading] = useState(false);

  const runRebalancer = async () => {
    setRebalancerLoading(true); setRebalancer(null);
    try {
      const res = await fetch('/api/ai/inventory-rebalancer-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.ok) { setRebalancer(data); toast.success('✓ Rebalansiranje generirano'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setRebalancerLoading(false); }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Recycle className="w-4 h-4 text-primary" />
            AI Portfolio Rebalancer v3
          </span>
          <Button size="sm" variant="outline" onClick={runRebalancer} disabled={rebalancerLoading} className="h-6 text-xs gap-1.5">
            {rebalancerLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Recycle className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rebalancerLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI rebalansira portfelj (Markowitz, Kelly, risk-parity)...
          </div>
        ) : rebalancer?.rebalancer ? (
          <div className="space-y-2 text-xs">
            {rebalancer.rebalancer.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                💡 {rebalancer.rebalancer.insights}
              </div>
            )}
            {rebalancer.rebalancer.current && rebalancer.rebalancer.target && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-card/30 border rounded p-2">
                  <div className="text-[9px] uppercase text-muted-foreground mb-1">Trenutno stanje</div>
                  {rebalancer.rebalancer.current.categories?.slice(0, 3).map((c: any, i: number) => (
                    <div key={i} className="text-[10px] flex justify-between">
                      <span>{c.category || c.name}</span>
                      <span className="font-mono">{c.percentage ?? c.allocationPct}%</span>
                    </div>
                  ))}
                </div>
                <div className="bg-primary/5 border border-primary/20 rounded p-2">
                  <div className="text-[9px] uppercase text-primary mb-1">Priporočeno</div>
                  {rebalancer.rebalancer.target.categories?.slice(0, 3).map((c: any, i: number) => (
                    <div key={i} className="text-[10px] flex justify-between">
                      <span>{c.category || c.name}</span>
                      <span className="font-mono text-primary">{c.percentage ?? c.allocationPct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {rebalancer.rebalancer.actions?.slice(0, 3).map((a: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium">{a.action || a.description}</span>
                  {a.priority && <Badge variant="outline" className="text-[9px]">{a.priority}</Badge>}
                </div>
                {a.expectedImpactEur != null && (
                  <div className="text-[9px] text-primary mt-0.5">+{a.expectedImpactEur}€</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI rebalansira portfelj (Markowitz mean-variance, Kelly criterion, risk-parity) za optimalno alokacijo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
