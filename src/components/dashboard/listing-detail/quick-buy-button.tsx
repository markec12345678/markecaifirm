'use client';

/**
 * v7.38: QuickBuyButton — 1-click "Kupil" from listing.
 *
 * Creates a held Trade with all data auto-filled from the listing.
 * Shows potential profit + ROI based on AI estimated value.
 * After purchase, shows trade ID + link to Skladišče.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface QuickBuyResult {
  ok: boolean;
  trade: {
    id: string;
    title: string;
    buyPrice: number;
    estValue: number | null;
    potentialProfit: number | null;
    potentialRoiPct: number | null;
  };
}

export function QuickBuyButton({ listingId, buyPrice, estValue }: {
  listingId: string;
  buyPrice: number | null;
  estValue: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [bought, setBought] = useState(false);
  const [result, setResult] = useState<QuickBuyResult | null>(null);

  async function handleBuy() {
    if (!buyPrice || buyPrice <= 0) {
      toast.error('Oglas nima cene — vnesi ročno v Skladišču');
      return;
    }

    const confirm = window.confirm(
      `Kupim za ${buyPrice}€?${estValue ? `\n\nAI ocena vrednosti: ${estValue}€\nPotential profit: +${estValue - buyPrice}€ (${Math.round(((estValue - buyPrice) / buyPrice) * 100)}% ROI)` : ''}`
    );
    if (!confirm) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyPrice }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult(data);
        setBought(true);
        const profit = data.trade.potentialProfit;
        const roi = data.trade.potentialRoiPct;
        toast.success(
          `✓ Kupljeno: ${data.trade.title} za ${data.trade.buyPrice}€${profit != null ? ` • potential +${profit}€ (${roi}%)` : ''}`,
          { duration: 6000 }
        );
      } else if (data.existingTradeId) {
        toast.error('Ta oglas je že kupljen');
        setBought(true);
      } else {
        toast.error(data.error || 'Napaka');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Napaka');
    } finally {
      setLoading(false);
    }
  }

  if (bought && result) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center space-y-1">
        <div className="flex items-center justify-center gap-1.5 text-green-500 font-bold text-sm">
          <Check className="w-4 h-4" />
          KUPLJENO
        </div>
        <div className="text-xs text-muted-foreground">
          {result.trade.buyPrice}€{result.trade.estValue ? ` → est. ${result.trade.estValue}€` : ''}
        </div>
        {result.trade.potentialProfit != null && (
          <div className="text-sm font-mono font-bold text-green-500">
            +{result.trade.potentialProfit}€ ({result.trade.potentialRoiPct}% ROI)
          </div>
        )}
        <a href="/trades" className="text-xs text-primary hover:underline block mt-1">
          → Odpri v Skladišču
        </a>
      </div>
    );
  }

  return (
    <Button
      onClick={handleBuy}
      disabled={loading || !buyPrice}
      size="sm"
      className={cn('w-full bg-green-600 hover:bg-green-700 text-white font-bold')}
    >
      {loading ? (
        <>
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          Kupujem...
        </>
      ) : (
        <>
          <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
          Kupil za {buyPrice ?? '?'}€
        </>
      )}
    </Button>
  );
}
