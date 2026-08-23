'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Listing Refresh

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, RefreshCw as RefreshIcon } from 'lucide-react';
import { toast } from 'sonner';

interface ListingRefreshProps {
  selectedTradeId: string;
}

export function ListingRefresh({ selectedTradeId }: ListingRefreshProps) {
  const [refresh, setRefresh] = useState<any>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);

  const runRefresh = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setRefreshLoading(true); setRefresh(null); try { const r = await fetch('/api/ai/listing-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setRefresh(d); toast.success('✓ Refresh strategija generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setRefreshLoading(false); } };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><RefreshIcon className="w-4 h-4 text-amber-400" /> AI Listing Refresh</span>
          <Button size="sm" variant="outline" onClick={runRefresh} disabled={refreshLoading} className="h-6 text-xs gap-1.5">
            {refreshLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshIcon className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {refreshLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI pripravlja refresh strategijo...</div>
        ) : refresh ? (
          <div className="space-y-2 text-xs">
            {refresh.strategy && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded p-2">
                <div className="text-[10px] font-medium text-amber-400">Strategija: {refresh.strategy}</div>
              </div>
            )}
            {refresh.actions?.slice(0, 3).map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px]">{a.action || a.description}</span>
                {a.impact && <Badge variant="outline" className="text-[9px] text-primary border-primary/30">{a.impact}</Badge>}
              </div>
            ))}
            {refresh.insights && <div className="text-[9px] text-muted-foreground">💡 {refresh.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI pripravi strategijo za osvežitev oglasa (nov naslov, slika, cena) za boljši ranking.</p>
        )}
      </CardContent>
    </Card>
  );
}
