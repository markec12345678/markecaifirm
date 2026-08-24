'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Network } from 'lucide-react';
import { toast } from 'sonner';

interface MultiVendorBundleProps {
  bulkTradeIds: Set<string>;
}

export function MultiVendorBundle({ bulkTradeIds }: MultiVendorBundleProps) {
  // v6.16: Multi-Vendor Bundle
  const [multiVendorData, setMultiVendorData] = useState<Record<string, any> | null>(null);
  const [multiVendorLoading, setMultiVendorLoading] = useState(false);

  return (
    <>
      {/* v6.16: Multi-Vendor Bundle */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
        disabled={multiVendorLoading}
        onClick={async () => {
          setMultiVendorLoading(true); setMultiVendorData(null);
          try {
            const ids = Array.from(bulkTradeIds);
            const res = await fetch('/api/ai/multi-vendor-bundle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ maxItems: 8 }),
            });
            const data = await res.json();
            if (data.ok) { setMultiVendorData(data); toast.success('✓ Multi-vendor bundle-i generirani'); }
            else toast.error(data.error ?? data.message ?? 'Napaka');
          } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
          finally { setMultiVendorLoading(false); }
        }}
        title="AI kombinira inventar iz različnih virov v bundle"
      >
        {multiVendorLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />}
        Multi-vendor
      </Button>

      {/* v6.16: AI Multi-Vendor Bundle results */}
      {multiVendorData && (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">AI Multi-Vendor Bundle Deals</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.16</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setMultiVendorData(null)} className="h-6 text-xs">×</Button>
            </div>

            {multiVendorData.insights && (
              <div className="bg-primary/5 border border-primary/20 rounded p-2 text-xs text-primary">{multiVendorData.insights}</div>
            )}

            {multiVendorData.summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Bundle-i</div>
                  <div className="font-bold text-primary">{multiVendorData.summary.totalDeals ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Itemov</div>
                  <div className="font-bold">{multiVendorData.summary.bundledItems ?? 0}/{multiVendorData.summary.totalItems ?? 0}</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Dobiček</div>
                  <div className="font-bold text-primary">{multiVendorData.summary.totalBundleProfit ?? 0}€</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Povp. popust</div>
                  <div className="font-bold text-amber-400">{multiVendorData.summary.avgSavings ?? 0}%</div>
                </div>
                <div className="bg-background/40 rounded p-1.5 border">
                  <div className="text-muted-foreground uppercase">Virov</div>
                  <div className="font-bold">{multiVendorData.summary.sourcesAnalyzed ?? 0}</div>
                </div>
              </div>
            )}

            {/* Bundle deals */}
            {multiVendorData.deals?.length > 0 && (
              <div className="space-y-2">
                {multiVendorData.deals.map((d: Record<string, any>, i: number) => (
                  <div key={i} className="border border-primary/20 bg-primary/5 rounded p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs">{d.name}</span>
                        <Badge variant="outline" className="text-[9px] text-primary border-primary/40">{d.strategy.replace('_', ' ')}</Badge>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-primary text-xs">{d.bundlePrice}€</div>
                        <div className="text-[9px] text-muted-foreground line-through">{d.individualTotal}€</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {d.sources?.map((s: string, j: number) => (
                        <Badge key={j} variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">📍 {s}</Badge>
                      ))}
                      <Badge variant="outline" className="text-[9px]">{d.items?.length} itemov</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div><span className="text-muted-foreground">Nabavna:</span> <span className="font-mono">{d.totalCost}€</span></div>
                      <div><span className="text-muted-foreground">Dobiček:</span> <span className="font-mono font-bold text-primary">{d.expectedProfit}€</span></div>
                      <div><span className="text-muted-foreground">Čas:</span> <span className="font-mono">{d.expectedSellTimeDays}d</span></div>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      <span className="text-amber-400">−{d.savingsPct}%</span> popust · 🎯 {d.targetBuyer}
                    </div>
                    {d.reasoning && <div className="text-[10px] italic">{d.reasoning}</div>}
                    <div className="text-[10px]">
                      {d.items?.map((it: Record<string, any>, j: number) => (
                        <span key={j} className="inline-block bg-background/60 px-1.5 py-0.5 rounded mr-1 mb-1 text-[9px]">
                          {it.title} ({it.source})
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Unbundled items */}
            {multiVendorData.unbundledItems?.length > 0 && (
              <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
                <span className="font-semibold">Ne-bundlani itemi ({multiVendorData.unbundledItems.length}):</span>{' '}
                {multiVendorData.unbundledItems.slice(0, 5).map((it: Record<string, any>) => it.title).join(', ')}
                {multiVendorData.unbundledItems.length > 5 && '...'}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
