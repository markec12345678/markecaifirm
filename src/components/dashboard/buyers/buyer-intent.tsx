'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Intent

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Target } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function BuyerIntent() {
  const [intent, setIntent] = useState<Record<string, any> | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);

  const runIntent = async () => { setIntentLoading(true); setIntent(null); try { const r = await fetch('/api/ai/buyer-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setIntent(d); toast.success('✓ Intent analiza generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setIntentLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" /> AI Buyer Intent</span>
          <Button size="sm" variant="outline" onClick={runIntent} disabled={intentLoading} className="h-6 text-xs gap-1.5">
            {intentLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {intentLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira nakupne namene kupcev...</div>
        ) : intent?.intent ? (
          <div className="space-y-2 text-xs">
            {intent?.intent.buyers?.slice(0, 4).map((b: Record<string, any>, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px] font-medium truncate flex-1">{b.name || b.buyerName}</span>
                <Badge variant="outline" className={cn('text-[9px]', (b.intentScore ?? b.score ?? 0) >= 70 ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                  {b.intentScore ?? b.score ?? '?'}%
                </Badge>
              </div>
            ))}
            {intent?.intent?.insights && <div className="text-[9px] text-muted-foreground">💡 {intent?.intent.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI analizira nakupne namene kupcev (kdo bo verjetno kupil znova).</p>
        )}
      </CardContent>
    </Card>
  );
}
