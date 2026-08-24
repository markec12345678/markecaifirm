'use client';

// v9.09: Extracted from inventory-view.tsx — AI Inventory Health Monitor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function HealthMonitor() {
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const runHealth = async () => {
    setHealthLoading(true); setHealth(null);
    try {
      const r = await fetch('/api/ai/inventory-health-monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) { setHealth(d); toast.success('✓ Health monitor generiran'); }
      else toast.error(d.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setHealthLoading(false); }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> AI Inventory Health Monitor</span>
          <Button size="sm" variant="outline" onClick={runHealth} disabled={healthLoading} className="h-6 text-xs gap-1.5">
            {healthLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {healthLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI preverja zdravje inventarja...</div>
        ) : health ? (
          <div className="space-y-2 text-xs">
            {health.healthScore != null && (
              <div className={cn('border rounded p-2',
                health.healthScore >= 70 ? 'bg-primary/10 border-primary/30' :
                health.healthScore >= 40 ? 'bg-amber-400/10 border-amber-400/30' : 'bg-red-500/10 border-red-500/30')}>
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-[10px]">Health Score</span>
                  <span className="font-mono font-bold text-lg">{health.healthScore}/100</span>
                </div>
                {health.grade && <Badge variant="outline" className="text-[9px] mt-1">Grade: {health.grade}</Badge>}
              </div>
            )}
            {health.metrics?.slice(0, 4).map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{m.metric || m.name}</span>
                <span className={cn('font-mono text-[10px]', m.status === 'good' ? 'text-primary' : m.status === 'warning' ? 'text-amber-400' : 'text-red-500')}>
                  {m.value}{m.unit ?? ''}
                </span>
              </div>
            ))}
            {health.insights && <div className="text-[9px] text-muted-foreground">💡 {health.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI preverja zdravje inventarja (health score, metrike, grade A-F).</p>
        )}
      </CardContent>
    </Card>
  );
}
