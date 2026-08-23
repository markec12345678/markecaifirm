'use client';

// v9.09: Extracted from pricing-view.tsx — AI Profit Dashboard

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

export function ProfitDashboard() {
  const [profitDash, setProfitDash] = useState<any>(null);
  const [profitDashLoading, setProfitDashLoading] = useState(false);

  const runProfitDash = async () => { setProfitDashLoading(true); setProfitDash(null); try { const r = await fetch('/api/ai/profit-dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setProfitDash(d); toast.success('✓ Profit dashboard generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setProfitDashLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> AI Profit Dashboard</span>
          <Button size="sm" variant="outline" onClick={runProfitDash} disabled={profitDashLoading} className="h-6 text-xs gap-1.5">
            {profitDashLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {profitDashLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI gradi profit dashboard...</div>
        ) : profitDash?.dashboard ? (
          <div className="space-y-2 text-xs">
            {profitDash.dashboard.summary && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">💡 {profitDash.dashboard.summary}</div>
            )}
            {profitDash.dashboard.metrics?.slice(0, 4).map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{m.label || m.name}</span>
                <span className="font-mono text-primary text-[10px]">{m.value}{m.unit ?? '€'}</span>
              </div>
            ))}
            {profitDash.dashboard.insights && <div className="text-[9px] text-muted-foreground">💡 {profitDash.dashboard.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI zgradi celovit profit dashboard z metrikami.</p>
        )}
      </CardContent>
    </Card>
  );
}
