'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';

export function RestockRecommendations() {
  const [restockData, setRestockData] = useState<Record<string, any> | null>(null);
  const [restockLoading, setRestockLoading] = useState(false);

  return (
    <>
      {/* v6.7: Restock recommendations */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-green-400/40 text-green-400 hover:bg-green-400/10"
        disabled={restockLoading}
        onClick={async () => {
          setRestockLoading(true);
          try {
            const res = await fetch('/api/ai/restock');
            const data = await res.json();
            if (data.ok) { setRestockData(data); toast.success(`✓ ${data.recommendations.length} priporočil, ${data.totalOpportunities} priložnosti`); }
            else toast.error(data.error ?? 'Napaka');
          } catch { toast.error('Napaka'); }
          finally { setRestockLoading(false); }
        }}
        title="AI restock — kaj ponovno kupiti za preprodajo?"
      >
        {restockLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
        AI Restock
      </Button>

      {/* v6.7: Restock Recommendations */}
      {restockData && !restockLoading && (
        <Card className="bg-green-400/5 border-green-400/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-green-400 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                AI Restock — {restockData.recommendations.length} priporočil, {restockData.totalOpportunities} priložnosti
                <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/40">v6.7</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setRestockData(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {restockData.recommendations.map((r: Record<string, any>, i: number) => (
                <div key={i} className="p-2 bg-background/30 rounded border border-green-400/20">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[9px] text-green-400 border-green-400/40">{r.category}</Badge>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-primary font-mono font-bold">{r.avgRoi > 0 ? '+' : ''}{r.avgRoi}% ROI</span>
                      <span className="text-muted-foreground">{r.soldCount} prodaj</span>
                      <span className="text-muted-foreground">~{r.avgDaysToSell}d</span>
                      <span className="text-primary font-mono">+{r.avgProfit}€ skupno</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-1">{r.reason}</p>
                  <div className="space-y-0.5">
                    {r.opportunities.map((o: Record<string, any>, j: number) => (
                      <a key={j} href={o.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 p-1 hover:bg-card/50 rounded text-[10px]">
                        <span className="truncate flex-1">{o.title}</span>
                        <span className="font-mono text-amber-400 shrink-0">{o.priceText}</span>
                        {o.dealScore != null && <Badge variant="outline" className="text-[8px] text-primary border-primary/40 shrink-0">🎯{o.dealScore}</Badge>}
                        <span className="font-mono text-green-400 shrink-0">+{o.potentialProfit}€</span>
                      </a>
                    ))}
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
