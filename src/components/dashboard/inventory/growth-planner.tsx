'use client';

// v9.09: Extracted from inventory-view.tsx — AI Growth Planner

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

export function GrowthPlanner() {
  const [growth, setGrowth] = useState<any>(null);
  const [growthLoading, setGrowthLoading] = useState(false);

  const runGrowth = async () => {
    setGrowthLoading(true); setGrowth(null);
    try {
      const r = await fetch('/api/ai/inventory-growth-planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) { setGrowth(d); toast.success('✓ Growth planner generiran'); }
      else toast.error(d.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setGrowthLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> AI Growth Planner</span>
          <Button size="sm" variant="outline" onClick={runGrowth} disabled={growthLoading} className="h-6 text-xs gap-1.5">
            {growthLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {growthLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI načrtuje rast inventarja...</div>
        ) : growth?.planner ? (
          <div className="space-y-2 text-xs">
            {growth.planner.recommendations?.slice(0, 3).map((r: any, i: number) => (
              <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] font-medium text-primary">{r.action || r.strategy}</div>
                <div className="text-[9px] text-muted-foreground">{r.description || r.detail}</div>
              </div>
            ))}
            {growth.planner.projections?.slice(0, 2).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{p.month || p.period}</span>
                <span className="font-mono text-primary">{p.projectedValue ?? p.revenue ?? '?'}€</span>
              </div>
            ))}
            {growth.planner.insights && <div className="text-[9px] text-muted-foreground">💡 {growth.planner.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI načrtuje rast inventarja (progekcije, priporočila za širitev).</p>
        )}
      </CardContent>
    </Card>
  );
}
