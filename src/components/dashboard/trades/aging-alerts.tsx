'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AgingAlerts() {
  const [agingData, setAgingData] = useState<Record<string, any> | null>(null);
  const [agingLoading, setAgingLoading] = useState(false);

  return (
    <>
      {/* v6.7: Aging alerts */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-red-500/40 text-red-500 hover:bg-red-500/10"
        disabled={agingLoading}
        onClick={async () => {
          setAgingLoading(true);
          try {
            const res = await fetch('/api/trades/aging-alerts');
            const data = await res.json();
            if (data.ok) { setAgingData(data); toast.success(`✓ ${data.summary.critical} kritičnih, ${data.summary.high} visokih`); }
            else toast.error(data.error ?? 'Napaka');
          } catch { toast.error('Napaka'); }
          finally { setAgingLoading(false); }
        }}
        title="AI aging alerts — kateri itemi izgubljajo vrednost?"
      >
        {agingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        Aging alerti
      </Button>

      {/* v6.7: Aging Alerts */}
      {agingData && !agingLoading && (
        <Card className="bg-red-500/5 border-red-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-red-500 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Aging Alerti — {agingData.summary.critical}🚨 {agingData.summary.high}🔴 {agingData.summary.medium}🟡
                <Badge variant="outline" className="text-[10px] text-red-500 border-red-500/40">v6.7</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setAgingData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs mb-2">
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Skupna izguba</div><div className="font-mono font-bold text-red-500">{agingData.summary.totalValueLoss}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Holding cost</div><div className="font-mono font-bold text-amber-400">{agingData.summary.totalHoldingCost}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Investirano</div><div className="font-mono font-bold">{agingData.summary.totalInvested}€</div></div>
              <div className="bg-background/30 rounded p-1.5 text-center"><div className="text-[9px] text-muted-foreground uppercase">Itemi</div><div className="font-mono font-bold">{agingData.summary.totalItems}</div></div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {agingData.alerts.filter((a: Record<string, any>) => a.urgency !== 'low').map((a: Record<string, any>, i: number) => (
                <div key={i} className={cn('flex items-center gap-2 p-1.5 rounded text-xs border',
                  a.urgency === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                  a.urgency === 'high' ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-400/5 border-amber-400/20')}>
                  <span className={cn('font-bold shrink-0 text-[10px]', a.color)}>{a.urgencyLabel}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="text-[9px] text-muted-foreground">
                      {a.daysHeld}d • {a.buyPrice}€ → ~{a.estimatedCurrentValue}€ ({a.valueLossPct}% izguba) • holding: {a.totalHoldingCost}€
                    </div>
                    <div className="text-[9px] text-muted-foreground italic">{a.recommendation}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
