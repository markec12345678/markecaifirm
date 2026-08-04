'use client';

/**
 * v7.35: MakeOfferPanel — 1-click offer generator.
 *
 * Features:
 * - AI generates optimal offer price (15-25% below asking)
 * - AI writes persuasive message in Slovenian
 * - 1-click copy to clipboard
 * - "Open on platform" button (direct link to listing)
 * - Tracks offer sent in NegotiationMessage table
 *
 * Saves 2-4 hours/week of manual message writing.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Send, Copy, ExternalLink, Sparkles, TrendingDown, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MakeOfferData {
  ok: boolean;
  offer: {
    suggestedPriceEur: number;
    askingPriceEur: number | null;
    discountPct: number;
    reasoning: string;
    message: string;
    strategy: 'aggressive' | 'balanced' | 'safe';
  };
}

export function MakeOfferPanel({ listingId, listingUrl, listingTitle, askingPrice }: {
  listingId: string;
  listingUrl: string;
  listingTitle: string;
  askingPrice: number | null;
}) {
  const [data, setData] = useState<MakeOfferData | null>(null);
  const [loading, setLoading] = useState(false);
  const [editedMessage, setEditedMessage] = useState('');
  const [editedPrice, setEditedPrice] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generateOffer() {
    setLoading(true);
    setSent(false);
    try {
      const res = await fetch('/api/ai/make-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const json = await res.json();
      if (json.ok) {
        setData(json);
        setEditedMessage(json.offer.message);
        setEditedPrice(json.offer.suggestedPriceEur);
      } else {
        toast.error(json.error || 'Napaka pri generiranju ponudbe');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Napaka');
    } finally {
      setLoading(false);
    }
  }

  async function copyMessage() {
    if (!editedMessage) return;
    try {
      await navigator.clipboard.writeText(editedMessage);
      setCopied(true);
      toast.success('Sporočilo kopirano v odložišče');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Ne morem kopirati — kopiraj ročno');
    }
  }

  async function markAsSent() {
    if (!data) return;
    try {
      // Save to NegotiationMessage table
      await fetch(`/api/listings/${listingId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactStatus: 'contacted',
          sellerResponse: `Offer sent: ${editedPrice}€ (asking ${askingPrice}€)`,
        }),
      });
      setSent(true);
      toast.success('✓ Ponudba označena kot poslana');
    } catch {
      toast.error('Napaka pri shranjevanju');
    }
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5" /> 1-KLIK PONUDBA
          </h4>
          {data?.offer && (
            <Badge variant="outline" className="text-[10px]">
              {data.offer.strategy === 'aggressive' ? '🎯 Agresivno' : data.offer.strategy === 'safe' ? '🛡️ Varno' : '⚖️ Balansirano'}
            </Badge>
          )}
        </div>

        {!data && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              AI generira optimalno ponudbo + sporočilo prodajalcu. Prihrani 2-5 min na oglas.
            </p>
            <Button
              onClick={generateOffer}
              disabled={loading}
              size="sm"
              className="w-full bg-gradient-to-r from-primary to-primary/80"
            >
              {loading ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
                  AI pripravlja ponudbo...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Generiraj ponudbo
                </>
              )}
            </Button>
          </div>
        )}

        {data?.offer && (
          <>
            {/* Price suggestion */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Zahtevana</div>
                <div className="font-mono font-bold">{askingPrice ?? '?'}€</div>
              </div>
              <div className="bg-primary/10 rounded p-2 text-center border border-primary/20">
                <div className="text-[9px] text-muted-foreground uppercase">Predlagana</div>
                <input
                  type="number"
                  value={editedPrice ?? ''}
                  onChange={(e) => setEditedPrice(Number(e.target.value))}
                  className="font-mono font-bold text-center bg-transparent w-full text-primary outline-none"
                />
              </div>
              <div className="bg-background/30 rounded p-2 text-center">
                <div className="text-[9px] text-muted-foreground uppercase">Popust</div>
                <div className="font-mono font-bold text-green-500">
                  <TrendingDown className="w-3 h-3 inline mr-0.5" />
                  {data.offer.discountPct}%
                </div>
              </div>
            </div>

            {/* AI reasoning */}
            <p className="text-[11px] text-muted-foreground italic">
              {data.offer.reasoning}
            </p>

            {/* Editable message */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase">Sporočilo prodajalcu</label>
              <Textarea
                value={editedMessage}
                onChange={(e) => setEditedMessage(e.target.value)}
                rows={6}
                className="text-xs"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={copyMessage} variant="outline" size="sm" className="flex-1">
                {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {copied ? 'Kopirano' : 'Kopiraj'}
              </Button>
              {listingUrl && (
                <a href={listingUrl} target="_blank" rel="noreferrer" className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    Odpri oglas
                  </Button>
                </a>
              )}
            </div>

            <Button
              onClick={markAsSent}
              disabled={sent}
              size="sm"
              className={cn('w-full', sent ? 'bg-green-500/20 text-green-500' : 'bg-primary')}
            >
              {sent ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  Ponudba poslana ✓
                </>
              ) : (
                'Označi kot poslano'
              )}
            </Button>

            <Button onClick={generateOffer} variant="ghost" size="sm" className="w-full text-xs">
              ↻ Regeneriraj
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
