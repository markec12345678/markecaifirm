'use client';

// v9.09: Extracted from alerts-view.tsx — AI Prioritized Alerts (button + card)

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AiPrioritizedAlerts() {
  const [prioritized, setPrioritized] = useState<any>(null);
  const [prioLoading, setPrioLoading] = useState(false);

  const runPrioritize = async () => {
    setPrioLoading(true); setPrioritized(null);
    try {
      const res = await fetch('/api/ai/prioritize-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 20 }) });
      const data = await res.json();
      if (data.ok) { setPrioritized(data); toast.success(`✓ ${data.highPriority} visokoprioritetnih, ${data.mediumPriority} srednjih`); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setPrioLoading(false); }
  };

  return (
    <>
      {/* v6.6: AI Prioritize */}
      <Button
        size="sm"
        variant="outline"
        className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
        disabled={prioLoading}
        onClick={runPrioritize}
      >
        {prioLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        AI Prioriteta
      </Button>

      {/* v6.6: AI Prioritized alerts */}
      {prioritized && !prioLoading && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Prioriteta alertov — {prioritized.highPriority}🟢 {prioritized.mediumPriority}🟡 {prioritized.lowPriority}⚪
                <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.6</Badge>
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setPrioritized(null)} className="h-6 text-xs">×</Button>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {prioritized.prioritized.map((p: any, i: number) => (
                <div key={i} className={cn('flex items-center gap-2 p-2 rounded text-xs border',
                  p.profitScore >= 75 ? 'bg-primary/5 border-primary/20' :
                  p.profitScore >= 55 ? 'bg-amber-400/5 border-amber-400/20' :
                  'bg-background/30 border-border')}>
                  <div className={cn('font-mono font-bold text-lg w-10 text-center shrink-0',
                    p.profitScore >= 75 ? 'text-primary' :
                    p.profitScore >= 55 ? 'text-amber-400' : 'text-muted-foreground')}>
                    {p.profitScore}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary truncate block">
                      {p.title}
                    </a>
                    <div className="text-[10px] text-muted-foreground">
                      {p.priceText} • {p.reasons || 'brez razloga'}
                      {p.aiReason && <span className="italic ml-1">— {p.aiReason}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-[10px]">
                    {p.suggestedAction && <Badge variant="outline" className={cn('text-[9px]',
                      p.suggestedAction === 'kupi' ? 'text-primary border-primary/40' :
                      p.suggestedAction === 'preskoci' ? 'text-red-500 border-red-500/40' : 'text-muted-foreground')}>
                      {p.suggestedAction}
                    </Badge>}
                    {p.aiPriority && <div className="text-[8px] text-muted-foreground mt-0.5">P{p.aiPriority}/5</div>}
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
