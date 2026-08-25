'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Lifecycle Predictor

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface BuyerLifecycleProps {
  selectedBuyer: string;
}

export function BuyerLifecycle({ selectedBuyer }: BuyerLifecycleProps) {
  const [lifecycle, setLifecycle] = useState<Record<string, any> | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  const runLifecycle = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setLifecycleLoading(true);
    setLifecycle(null);
    try {
      const res = await fetch('/api/ai/buyer-lifecycle-predictor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setLifecycle(data); toast.success('✓ Lifecycle napoved generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setLifecycleLoading(false); }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            AI Lifecycle Predictor
          </span>
          <Button size="sm" variant="outline" onClick={runLifecycle} disabled={lifecycleLoading} className="h-6 text-xs gap-1.5">
            {lifecycleLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lifecycleLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI napoveduje 9 faz življenjskega cikla...
          </div>
        ) : lifecycle?.predictor ? (
          <div className="space-y-2 text-xs">
            {lifecycle?.predictor.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-[10px]">
                💡 {lifecycle?.predictor.insights}
              </div>
            )}
            {lifecycle?.predictor.lifecycleStages?.slice(0, 5).map((s: Record<string, any>, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-card/30 border rounded p-2">
                <Badge variant="outline" className="text-[9px]">{s.stage || s.name}</Badge>
                <span className="text-[10px] flex-1">{s.action || s.recommendation || s.description || ''}</span>
                {s.probability != null && (
                  <span className="font-mono text-[10px] text-primary">{s.probability}%</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI napove 9 faz (prospect → first_time → loyal → advocate → churned → reactivated).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
