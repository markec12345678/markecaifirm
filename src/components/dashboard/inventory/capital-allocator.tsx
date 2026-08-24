'use client';

// v9.09: Extracted from inventory-view.tsx — AI Capital Allocator

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

export function CapitalAllocator() {
  const [capitalAlloc, setCapitalAlloc] = useState<any>(null);
  const [capitalAllocLoading, setCapitalAllocLoading] = useState(false);

  const runCapitalAlloc = async () => {
    setCapitalAllocLoading(true); setCapitalAlloc(null);
    try {
      const r = await fetch('/api/ai/inventory-capital-allocator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) { setCapitalAlloc(d); toast.success('✓ Capital allocator generiran'); }
      else toast.error(d.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setCapitalAllocLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" /> AI Capital Allocator</span>
          <Button size="sm" variant="outline" onClick={runCapitalAlloc} disabled={capitalAllocLoading} className="h-6 text-xs gap-1.5">
            {capitalAllocLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {capitalAllocLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI alokira kapital po kategorijah...</div>
        ) : capitalAlloc?.allocator ? (
          <div className="space-y-2 text-xs">
            {capitalAlloc.allocator.allocations?.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-card/30 border rounded p-1.5">
                <span className="text-[10px] font-medium">{a.category || a.name}</span>
                <span className="font-mono text-primary">{a.allocationEur ?? a.amount ?? '?'}€</span>
              </div>
            ))}
            {capitalAlloc.allocator.insights && <div className="text-[9px] text-muted-foreground">💡 {capitalAlloc.allocator.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI alokira kapital po kategorijah za maksimalni ROI.</p>
        )}
      </CardContent>
    </Card>
  );
}
