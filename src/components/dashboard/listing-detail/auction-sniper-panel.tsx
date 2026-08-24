'use client';

/**
 * v6.95: AuctionSniperPanel — izvlečen iz ListingDetailModal (4070 vrst.) v samostojno komponento.
 *
 * Samostojen state (snipe, snipeLoading) — prej v ListingDetailModal.
 *
 * API: <AuctionSniperPanel listingId={listing.id} />
 */

import { useState } from 'react';
import { Crosshair, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SnipeResult {
  strategy: {
    mode: string;
    maxBid: number;
    action: string;
    reasoning: string;
    timing: { wait: number; bid: string; deadline: string };
    priceDropProbability: number;
    competitionLevel: 'high' | 'medium' | 'low' | string;
    estimatedDealScore: number;
    snipeTime?: string;
    signals?: string[];
    contingencies?: string[];
  };
  marketSignals?: string[];
}

export function AuctionSniperPanel({ listingId }: { listingId: string }) {
  const [snipe, setSnipe] = useState<SnipeResult | null>(null);
  const [snipeLoading, setSnipeLoading] = useState(false);

  const analyze = async () => {
    setSnipeLoading(true);
    setSnipe(null);
    try {
      const res = await fetch('/api/ai/auction-sniper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (data.ok) {
        setSnipe(data);
        toast.success('✓ Sniper strategija generirana');
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
    } finally {
      setSnipeLoading(false);
    }
  };

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Crosshair className="w-3.5 h-3.5 text-primary" />
          AI Auction Sniper
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v6.12</Badge>
        </h4>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
          disabled={snipeLoading}
          onClick={analyze}
        >
          {snipeLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />}
          Analiziraj timing
        </Button>
      </div>

      {snipeLoading ? (
        <div className="py-3 text-center text-[11px] text-muted-foreground">
          <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
          AI analizira tržne signale in časovne vzorce...
        </div>
      ) : snipe?.strategy ? (
        <div className="space-y-2 text-[11px]">
          {/* Mode badge */}
          <div className="bg-primary/5 border border-primary/20 rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-primary uppercase text-[10px]">
                🎯 {snipe.strategy.mode.replace('_', ' ')}
              </span>
              <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                Max bid: {snipe.strategy.maxBid}€
              </Badge>
            </div>
            <p className="text-[10px] font-medium">{snipe.strategy.action}</p>
            <p className="text-[10px] text-muted-foreground italic mt-1">{snipe.strategy.reasoning}</p>
          </div>

          {/* Timing */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-background/40 rounded p-1.5 border text-center">
              <div className="text-[9px] uppercase text-muted-foreground">⏳ Čakaj</div>
              <div className="font-mono font-bold">{snipe.strategy.timing.wait}d</div>
            </div>
            <div className="bg-background/40 rounded p-1.5 border text-center">
              <div className="text-[9px] uppercase text-muted-foreground">⏰ Bid</div>
              <div className="font-mono font-bold text-[10px]">{snipe.strategy.timing.bid || '—'}</div>
            </div>
            <div className="bg-background/40 rounded p-1.5 border text-center">
              <div className="text-[9px] uppercase text-muted-foreground">📅 Deadline</div>
              <div className="font-mono font-bold text-[10px]">{snipe.strategy.timing.deadline || '—'}</div>
            </div>
          </div>

          {/* Probability bars */}
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="bg-background/40 rounded p-1.5 border">
              <div className="text-muted-foreground text-[9px]">Padec cene</div>
              <div className="font-mono font-bold text-amber-400">{snipe.strategy.priceDropProbability}%</div>
              <div className="w-full h-1 bg-background rounded mt-0.5">
                <div className="h-full bg-amber-400 rounded" style={{ width: `${snipe.strategy.priceDropProbability}%` }} />
              </div>
            </div>
            <div className="bg-background/40 rounded p-1.5 border">
              <div className="text-muted-foreground text-[9px]">Konkurenca</div>
              <div className={cn('font-mono font-bold uppercase',
                snipe.strategy.competitionLevel === 'high' ? 'text-red-500' :
                snipe.strategy.competitionLevel === 'medium' ? 'text-amber-400' : 'text-primary')}>
                {snipe.strategy.competitionLevel}
              </div>
            </div>
            <div className="bg-background/40 rounded p-1.5 border">
              <div className="text-muted-foreground text-[9px]">Deal score</div>
              <div className="font-mono font-bold text-primary">{snipe.strategy.estimatedDealScore}/100</div>
            </div>
          </div>

          {/* Snipe time */}
          {snipe.strategy.snipeTime && (
            <div className="text-[10px] text-muted-foreground">
              🕒 <span className="font-semibold">Optimalen čas:</span> {snipe.strategy.snipeTime}
            </div>
          )}

          {/* Signals */}
          {(snipe.strategy.signals?.length ?? 0) > 0 && (
            <div className="bg-blue-400/5 border border-blue-400/20 rounded p-1.5">
              <div className="text-[10px] uppercase text-blue-400 mb-1">📊 Signali:</div>
              <ul className="space-y-0.5 ml-3">
                {snipe.strategy.signals?.map((s: string, i: number) => (
                  <li key={i} className="text-[10px] list-disc list-outside">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Contingencies */}
          {(snipe.strategy.contingencies?.length ?? 0) > 0 && (
            <div className="bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
              <div className="text-[10px] uppercase text-amber-400 mb-1">🔄 Če ne uspe:</div>
              <ul className="space-y-0.5 ml-3">
                {snipe.strategy.contingencies?.map((c: string, i: number) => (
                  <li key={i} className="text-[10px] list-disc list-outside">{c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Market signals */}
          {(snipe.marketSignals?.length ?? 0) > 0 && (
            <div className="text-[10px] text-muted-foreground border-t border-border pt-1.5">
              📈 Tržni signali: {snipe.marketSignals?.join(' · ')}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground text-center py-2">
          AI določi optimalen timing za kontakt — čakaj na cenovni padec, snipe-now ali aggressive bid.
        </p>
      )}
    </div>
  );
}
