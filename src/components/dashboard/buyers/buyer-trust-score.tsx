'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Trust Score

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BuyerTrustScoreProps {
  selectedBuyer: string;
}

export function BuyerTrustScore({ selectedBuyer }: BuyerTrustScoreProps) {
  const [trustScore, setTrustScore] = useState<any>(null);
  const [trustLoading, setTrustLoading] = useState(false);

  const runTrust = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setTrustLoading(true);
    setTrustScore(null);
    try {
      const res = await fetch('/api/ai/buyer-trust-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setTrustScore(data); toast.success('✓ Trust score generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: any) { toast.error(e?.message ?? 'Napaka'); }
    finally { setTrustLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            AI Trust Score
          </span>
          <Button size="sm" variant="outline" onClick={runTrust} disabled={trustLoading} className="h-6 text-xs gap-1.5">
            {trustLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trustLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI ocenjuje zanesljivost kupca...
          </div>
        ) : trustScore?.scoring ? (
          <div className="space-y-2 text-xs">
            <div className={cn('border rounded p-2',
              trustScore.scoring.tier === 'platinum' || trustScore.scoring.tier === 'gold' ? 'bg-primary/10 border-primary/30' :
              trustScore.scoring.tier === 'risk' || trustScore.scoring.tier === 'blocked' ? 'bg-red-500/10 border-red-500/30' : 'bg-card/30 border-border')}>
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                  trustScore.scoring.tier === 'platinum' ? 'text-primary border-primary/40' :
                  trustScore.scoring.tier === 'blocked' ? 'text-red-500 border-red-500/40' : 'text-muted-foreground')}>
                  {trustScore.scoring.tier}
                </Badge>
                <span className="font-mono font-bold">{trustScore.scoring.trustScore ?? '?'}/100</span>
              </div>
              {trustScore.scoring.reasoning && (
                <p className="text-[10px] text-muted-foreground mt-1">{trustScore.scoring.reasoning}</p>
              )}
            </div>
            {trustScore.scoring.recommendation && (
              <div className="bg-card/30 border rounded p-2 text-[10px]">
                💡 <b>Priporočilo:</b> {trustScore.scoring.recommendation}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI oceni zanesljivost (platinum → scammer, 6 tierjev).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
