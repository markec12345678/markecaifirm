'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Matchmaker

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Crosshair } from 'lucide-react';
import { toast } from 'sonner';

export function BuyerMatchmaker() {
  const [matchmaker, setMatchmaker] = useState<any>(null);
  const [matchmakerLoading, setMatchmakerLoading] = useState(false);

  const runMatchmaker = async () => { setMatchmakerLoading(true); setMatchmaker(null); try { const r = await fetch('/api/ai/buyer-matchmaker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setMatchmaker(d); toast.success('✓ Matchmaker generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setMatchmakerLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Crosshair className="w-4 h-4 text-primary" /> AI Buyer Matchmaker</span>
          <Button size="sm" variant="outline" onClick={runMatchmaker} disabled={matchmakerLoading} className="h-6 text-xs gap-1.5">
            {matchmakerLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {matchmakerLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI išče match-e med kupci in inventarjem...</div>
        ) : matchmaker?.matches?.length > 0 ? (
          <div className="space-y-2 text-xs">
            {matchmaker.matches.slice(0, 4).map((m: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[10px] truncate flex-1">{m.buyerName || m.name || `Match ${i+1}`}</span>
                  <Badge variant="outline" className="text-[9px] text-primary border-primary/30">{m.matchScore ?? m.score ?? '?'}%</Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">{m.reason || m.rationale || m.description}</div>
              </div>
            ))}
            {matchmaker.insights && <div className="text-[9px] text-muted-foreground">💡 {matchmaker.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI poišče match-e med kupci in held inventarjem (channel-specific outreach).</p>
        )}
      </CardContent>
    </Card>
  );
}
