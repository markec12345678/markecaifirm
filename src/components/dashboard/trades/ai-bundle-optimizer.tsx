'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AIBundleOptimizerProps {
  bulkTradeIds: Set<string>;
}

export function AIBundleOptimizer({ bulkTradeIds }: AIBundleOptimizerProps) {
  const [bundleData, setBundleData] = useState<Record<string, any> | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  return (
    <>
      {/* v6.10: Bundle Optimizer */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
        disabled={bundleLoading}
        onClick={async () => {
          setBundleLoading(true); setBundleData(null);
          try {
            const ids = Array.from(bulkTradeIds);
            const res = await fetch('/api/ai/bundle-optimizer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(ids.length > 0 ? { tradeIds: ids } : {}),
            });
            const data = await res.json();
            if (data.ok) { setBundleData(data); toast.success('✓ Bundle predlogi generirani'); }
            else toast.error(data.error ?? data.message ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setBundleLoading(false); }
        }}
        title="AI kombinira inventar v bundle za maksimalni profit"
      >
        {bundleLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Boxes className="w-3.5 h-3.5" />}
        Bundle optimizer
      </Button>

      {/* v6.10: AI Bundle Optimizer results */}
      {bundleData && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">AI Bundle optimizer</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.10</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setBundleData(null)} className="h-6 text-xs">×</Button>
            </div>
            {bundleData.strategy && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs text-primary">{bundleData.strategy}</div>
            )}
            {bundleData.summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Bundle-i</div>
                  <div className="font-bold text-primary">{bundleData.summary.bundleItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Posamično</div>
                  <div className="font-bold">{bundleData.summary.individualItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Bundle dobiček</div>
                  <div className="font-bold text-primary">{bundleData.summary.totalBundleProfit ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Posamični dobiček</div>
                  <div className="font-bold">{bundleData.summary.totalIndividualProfit ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. popust</div>
                  <div className="font-bold text-amber-400">{bundleData.summary.avgBundleSavings ?? 0}%</div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {bundleData.bundles?.map((b: Record<string, any>, i: number) => (
                <div key={i} className="border border-primary/20 bg-primary/5 rounded p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs">{b.name}</span>
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/40">{b.strategy}</Badge>
                      <Badge variant="outline" className="text-[9px]">{b.items?.length ?? 0} itemov</Badge>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-primary text-xs">{b.bundlePrice}€</div>
                      <div className="text-[9px] text-muted-foreground line-through">{b.individualTotal}€</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{b.bundleCost}€</span></div>
                    <div><span className="text-muted-foreground">Dobiček:</span> <span className="font-mono font-bold text-primary">{b.expectedProfit}€</span></div>
                    <div><span className="text-muted-foreground">Čas:</span> <span className="font-mono">{b.expectedSellTimeDays}d</span></div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    <span className="text-amber-400">−{b.savingsPct}%</span> popust · {b.reasoning}
                  </div>
                  <div className="text-[10px]">
                    {b.items?.map((it: Record<string, any>, j: number) => (
                      <span key={j} className="inline-block bg-background/60 px-1.5 py-0.5 rounded mr-1 mb-1 text-[9px]">{it.title}</span>
                    ))}
                  </div>
                </div>
              ))}
              {bundleData.bundles?.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-2">AI ni našel ugodnih bundle kombinacij.</p>
              )}
            </div>
            {bundleData.individualSale?.length > 0 && (
              <div className="text-[10px] text-muted-foreground">
                <span className="font-semibold">Za posamično prodajo:</span>{' '}
                {bundleData.individualSale.map((it: Record<string, any>) => it.title).join(', ')}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
