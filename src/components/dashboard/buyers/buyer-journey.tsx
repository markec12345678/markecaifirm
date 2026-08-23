'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Journey Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Map } from 'lucide-react';
import { toast } from 'sonner';

interface BuyerJourneyProps {
  selectedBuyer: string;
}

export function BuyerJourney({ selectedBuyer }: BuyerJourneyProps) {
  const [journey, setJourney] = useState<any>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  const runJourney = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setJourneyLoading(true);
    setJourney(null);
    try {
      const res = await fetch('/api/ai/buyer-journey-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setJourney(data); toast.success('✓ Journey optimizacija generirana'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setJourneyLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Map className="w-4 h-4 text-purple-400" />
            AI Journey Optimizer
          </span>
          <Button size="sm" variant="outline" onClick={runJourney} disabled={journeyLoading} className="h-6 text-xs gap-1.5">
            {journeyLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Map className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {journeyLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI optimizira 8-stopnjsko pot kupca...
          </div>
        ) : journey?.optimizer ? (
          <div className="space-y-2 text-xs">
            {journey.optimizer.insights && (
              <div className="bg-purple-500/5 border border-purple-500/20 rounded p-2 text-[10px]">
                💡 {journey.optimizer.insights}
              </div>
            )}
            {journey.optimizer.optimizations?.slice(0, 3).map((o: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="font-medium text-[10px]">{o.stage || o.touchpoint || `Optimizacija ${i + 1}`}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{o.action || o.recommendation || o.description}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI optimizira 8-stopnjsko pot (awareness → advocacy).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
