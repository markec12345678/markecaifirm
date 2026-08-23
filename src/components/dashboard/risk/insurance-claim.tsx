'use client';

// v9.09: Extracted from risk-view.tsx — AI Insurance Claim

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function InsuranceClaim() {
  const [claim, setClaim] = useState<any>(null);
  const [claimLoading, setClaimLoading] = useState(false);

  const runClaim = async () => { setClaimLoading(true); setClaim(null); try { const r = await fetch('/api/ai/insurance-claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setClaim(d); toast.success('✓ Claim analiza generirana'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setClaimLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" /> AI Insurance Claim</span>
          <Button size="sm" variant="outline" onClick={runClaim} disabled={claimLoading} className="h-6 text-xs gap-1.5">
            {claimLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {claimLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI analizira zavarovalne zahtevke...</div>
        ) : claim ? (
          <div className="space-y-2 text-xs">
            {claim.claims?.slice(0, 3).map((c: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium">{c.type || c.category}</span>
                  <Badge variant="outline" className={cn('text-[9px]', c.approved ? 'text-primary border-primary/30' : 'text-amber-400 border-amber-400/30')}>{c.status || (c.approved ? 'Odobren' : 'Čaka')}</Badge>
                </div>
                <div className="text-[9px] text-muted-foreground">{c.amount ?? '?'}€ — {c.reason || c.description}</div>
              </div>
            ))}
            {claim.insights && <div className="text-[9px] text-muted-foreground">💡 {claim.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI analizira zavarovalne zahtevke (odobritev, znesek, utemeljitev).</p>
        )}
      </CardContent>
    </Card>
  );
}
