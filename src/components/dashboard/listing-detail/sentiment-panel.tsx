'use client';

/**
 * v6.95: SentimentPanel — izvlečen iz ListingDetailModal (4070 vrst.) v samostojno komponento.
 *
 * Samostojen state (sentiment, sentimentLoading, sentimentMessage) — prej je bil v ListingDetailModal
 * (70+ useState). Sedaj ListingDetailModal hrani samo listing podatke, ne pa AI analize.
 *
 * API: <SentimentPanel listingId={listing.id} />
 */

import { useState } from 'react';
import { Smile, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SentimentResult {
  sentiment: {
    overall: 'desperate' | 'suspicious' | 'motivated' | 'reluctant' | string;
    toneProfile: string;
    motivation: string;
    urgencyPct: number;
    leveragePct: number;
    deceptionRiskPct: number;
    recommendedApproach: 'aggressive' | 'walk_away' | 'patient' | string;
    openingTactic?: string;
    redFlags?: string[];
    greenFlags?: string[];
  };
  heuristics?: {
    detectedUrgency?: Array<{ label: string; [k: string]: any }>;
  };
}

export function SentimentPanel({ listingId }: { listingId: string }) {
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentMessage, setSentimentMessage] = useState('');

  const analyze = async () => {
    setSentimentLoading(true);
    setSentiment(null);
    try {
      const res = await fetch('/api/ai/sentiment-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, sellerMessage: sentimentMessage || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        setSentiment(data);
        toast.success('✓ Sentiment analiza generirana');
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka');
    } finally {
      setSentimentLoading(false);
    }
  };

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Smile className="w-3.5 h-3.5 text-purple-400" />
          AI Sentiment Analysis
          <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/40">v6.20</Badge>
        </h4>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] gap-1.5 border-purple-400/40 text-purple-400 hover:bg-purple-400/10"
          disabled={sentimentLoading}
          onClick={analyze}
        >
          {sentimentLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Smile className="w-3 h-3" />}
          Analiziraj
        </Button>
      </div>
      <Input
        type="text"
        placeholder="Sporočilo prodajalca (opcijsko) — prilepi za analizo"
        value={sentimentMessage}
        onChange={(e) => setSentimentMessage(e.target.value)}
        className="h-7 text-[11px] mb-2"
      />
      {sentimentLoading ? (
        <div className="py-3 text-center text-[11px] text-muted-foreground">
          <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
          AI analizira ton, motivacijo in morebitne rdeče zastave...
        </div>
      ) : sentiment?.sentiment ? (
        <div className="space-y-2 text-[11px]">
          <div className={cn('border rounded p-2',
            sentiment.sentiment.overall === 'desperate' ? 'bg-primary/10 border-primary/30' :
            sentiment.sentiment.overall === 'suspicious' ? 'bg-red-500/5 border-red-500/20' :
            sentiment.sentiment.overall === 'motivated' ? 'bg-primary/5 border-primary/20' :
            sentiment.sentiment.overall === 'reluctant' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-background/40 border-border')}>
            <div className="flex items-center justify-between mb-1">
              <Badge variant="outline" className={cn('text-[9px] uppercase font-bold',
                sentiment.sentiment.overall === 'desperate' ? 'text-primary border-primary/40' :
                sentiment.sentiment.overall === 'suspicious' ? 'text-red-500 border-red-500/40' :
                sentiment.sentiment.overall === 'motivated' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                {sentiment.sentiment.overall}
              </Badge>
              <span className="text-[9px] text-muted-foreground">ton: {sentiment.sentiment.toneProfile}</span>
            </div>
            <p className="text-[10px]">{sentiment.sentiment.motivation}</p>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <div className="bg-background/40 rounded p-1 border text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Urgency</div>
              <div className={cn('font-mono font-bold', sentiment.sentiment.urgencyPct >= 70 ? 'text-primary' : sentiment.sentiment.urgencyPct >= 40 ? 'text-amber-400' : 'text-muted-foreground')}>{sentiment.sentiment.urgencyPct}%</div>
            </div>
            <div className="bg-background/40 rounded p-1 border text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Leverage</div>
              <div className={cn('font-mono font-bold', sentiment.sentiment.leveragePct >= 60 ? 'text-primary' : 'text-amber-400')}>{sentiment.sentiment.leveragePct}%</div>
            </div>
            <div className="bg-background/40 rounded p-1 border text-center">
              <div className="text-[9px] uppercase text-muted-foreground">Deception</div>
              <div className={cn('font-mono font-bold', sentiment.sentiment.deceptionRiskPct >= 60 ? 'text-red-500' : sentiment.sentiment.deceptionRiskPct >= 30 ? 'text-amber-400' : 'text-primary')}>{sentiment.sentiment.deceptionRiskPct}%</div>
            </div>
          </div>
          <div className={cn('rounded p-1.5 text-[10px] text-center font-bold uppercase',
            sentiment.sentiment.recommendedApproach === 'aggressive' ? 'bg-primary/10 text-primary' :
            sentiment.sentiment.recommendedApproach === 'walk_away' ? 'bg-red-500/10 text-red-500' :
            sentiment.sentiment.recommendedApproach === 'patient' ? 'bg-blue-400/10 text-blue-400' : 'bg-amber-400/10 text-amber-400')}>
            → Pristop: {sentiment.sentiment.recommendedApproach.replace('_', ' ')}
          </div>
          {sentiment.sentiment.openingTactic && (
            <div className="bg-primary/5 border border-primary/20 rounded p-1.5 text-[10px]">
              💬 <b>Prvi kontakt:</b> {sentiment.sentiment.openingTactic}
            </div>
          )}
          {sentiment.sentiment.redFlags?.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded p-1.5">
              <div className="text-[10px] uppercase text-red-500 mb-1">🚩 Red flags:</div>
              <ul className="space-y-0.5 ml-3">
                {sentiment.sentiment.redFlags.map((r: string, i: number) => <li key={i} className="text-[10px] list-disc list-outside">{r}</li>)}
              </ul>
            </div>
          )}
          {sentiment.sentiment.greenFlags?.length > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded p-1.5">
              <div className="text-[10px] uppercase text-primary mb-1">✓ Green flags:</div>
              <ul className="space-y-0.5 ml-3">
                {sentiment.sentiment.greenFlags.map((g: string, i: number) => <li key={i} className="text-[10px] list-disc list-outside">{g}</li>)}
              </ul>
            </div>
          )}
          {sentiment.heuristics?.detectedUrgency?.length > 0 && (
            <div className="text-[9px] text-muted-foreground">
              📊 Hevristika: {sentiment.heuristics.detectedUrgency.map((u: any) => u.label).join(' · ')}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground text-center py-2">
          AI analizira ton in motivacijo prodajalca (desperate / motivated / suspicious).
        </p>
      )}
    </div>
  );
}
