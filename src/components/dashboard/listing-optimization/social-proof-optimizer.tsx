'use client';

// v9.09: Extracted from listing-optimization-view.tsx — AI Social Proof Optimizer

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';

interface SocialProofOptimizerProps {
  selectedTradeId: string;
}

export function SocialProofOptimizer({ selectedTradeId }: SocialProofOptimizerProps) {
  const [socialProof, setSocialProof] = useState<any>(null);
  const [socialProofLoading, setSocialProofLoading] = useState(false);

  const runSocialProof = async () => { if (!selectedTradeId) { toast.error('Izberi item'); return; } setSocialProofLoading(true); setSocialProof(null); try { const r = await fetch('/api/ai/listing-social-proof-optimizer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeId: selectedTradeId }) }); const d = await r.json(); if (d.ok) { setSocialProof(d); toast.success('✓ Social proof generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: any) { toast.error(e?.message ?? 'Napaka'); } finally { setSocialProofLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> AI Social Proof Optimizer</span>
          <Button size="sm" variant="outline" onClick={runSocialProof} disabled={socialProofLoading} className="h-6 text-xs gap-1.5">
            {socialProofLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {socialProofLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI dodaja social proof...</div>
        ) : socialProof?.optimizer ? (
          <div className="space-y-2 text-xs">
            {socialProof.optimizer.elements?.slice(0, 3).map((e: any, i: number) => (
              <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] font-medium text-primary">{e.type || e.element}</div>
                <div className="text-[9px] text-muted-foreground">{e.content || e.description}</div>
              </div>
            ))}
            {socialProof.optimizer.insights && <div className="text-[9px] text-muted-foreground">💡 {socialProof.optimizer.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI doda social proof elemente (review-i, rating-i, trust badges).</p>
        )}
      </CardContent>
    </Card>
  );
}
