'use client';

/**
 * v7.34: PriceHistoryPanel — Keepa-style price chart + buy recommendation.
 *
 * Shows:
 * - Line chart of price over time
 * - Historical low / high / average
 * - Drop velocity (EUR/day)
 * - AI recommendation: BUY NOW / WAIT / STABLE
 * - Predicted bottom price
 *
 * Fetches from /api/listings/:id/price-history (enhanced with analytics).
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, TrendingUp, Minus, Target, Zap, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts';

interface PriceHistoryEntry {
  price: number | null;
  priceText: string;
  seenAt: string;
}

interface Analytics {
  totalDropPct: number | null;
  dropVelocityEurPerDay: number | null;
  daysSinceFirstSeen: number;
  isAtHistoricalLow: boolean;
  historicalLow: number | null;
  historicalHigh: number | null;
  avgPrice: number | null;
  predictedBottom: number | null;
  recommendation: string;
  urgency: 'buy_now' | 'wait' | 'stable' | 'no_data';
}

interface PriceHistoryData {
  listing: { title: string; price: number | null; priceText: string };
  history: PriceHistoryEntry[];
  analytics: Analytics;
}

export function PriceHistoryPanel({ listingId, onClose }: { listingId: string; onClose?: () => void }) {
  const [data, setData] = useState<PriceHistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/listings/${listingId}/price-history`);
        if (!cancelled && res.ok) setData(await res.json());
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [listingId]);

  if (loading) {
    return <div className="text-xs text-muted-foreground p-3">Nalagam zgodovino cene...</div>;
  }

  if (!data || data.history.length === 0) {
    return <div className="text-xs text-muted-foreground p-3">Ni zgodovine cene za ta oglas.</div>;
  }

  const { analytics: a } = data;
  const chartData = data.history
    .filter(h => h.price != null)
    .map(h => ({
      date: new Date(h.seenAt).toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' }),
      price: h.price,
      ts: new Date(h.seenAt).getTime(),
    }))
    .sort((x, y) => x.ts - y.ts);

  if (chartData.length < 2) {
    return (
      <div className="text-xs text-muted-foreground p-3">
        Samo ena meritev cene ({data.history[0]?.priceText}). Potrebujemo vsaj 2 za graf.
      </div>
    );
  }

  const urgencyConfig = {
    buy_now: { icon: Zap, color: 'text-primary', bg: 'bg-primary/10 border-primary/30', label: 'KUPI ZDAJ' },
    wait: { icon: TrendingDown, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', label: 'POČAKAJ' },
    stable: { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted/30 border-border', label: 'STABILNO' },
    no_data: { icon: AlertTriangle, color: 'text-muted-foreground', bg: 'bg-muted/30 border-border', label: 'NI PODATKOV' },
  };
  const uc = urgencyConfig[a.urgency];
  const UrgencyIcon = uc.icon;

  return (
    <Card className={cn('border', uc.bg)}>
      <CardContent className="p-3 space-y-3">
        {/* Urgency badge + recommendation */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('border font-bold text-xs px-2 py-0.5', uc.bg, uc.color)}>
            <UrgencyIcon className="w-3 h-3 mr-1" />
            {uc.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {data.listing.priceText}
          </span>
        </div>
        <p className="text-xs leading-relaxed">{a.recommendation}</p>

        {/* Price chart */}
        <div className="h-40 -ml-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '11px' }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                formatter={(v: number) => [`${v}€`, 'Cena']}
              />
              <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: 'hsl(var(--primary))' }} />
              {/* Historical low reference line */}
              {a.historicalLow != null && (
                <ReferenceLine y={a.historicalLow} stroke="#22c55e" strokeDasharray="4 4" label={{ value: `min ${a.historicalLow}€`, fontSize: 9, fill: '#22c55e', position: 'insideBottomRight' }} />
              )}
              {/* Predicted bottom reference line */}
              {a.predictedBottom != null && a.predictedBottom !== a.historicalLow && (
                <ReferenceLine y={a.predictedBottom} stroke="#f59e0b" strokeDasharray="2 2" label={{ value: `pred. ${a.predictedBottom}€`, fontSize: 9, fill: '#f59e0b', position: 'insideBottomLeft' }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Min</div>
            <div className="font-mono font-bold text-green-500">{a.historicalLow}€</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Max</div>
            <div className="font-mono font-bold text-red-500">{a.historicalHigh}€</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Ø</div>
            <div className="font-mono font-bold">{a.avgPrice}€</div>
          </div>
          <div className="bg-background/30 rounded p-1.5 text-center">
            <div className="text-[9px] text-muted-foreground uppercase">Pad/dan</div>
            <div className={cn('font-mono font-bold', (a.dropVelocityEurPerDay ?? 0) < 0 ? 'text-green-500' : (a.dropVelocityEurPerDay ?? 0) > 0 ? 'text-red-500' : '')}>
              {(a.dropVelocityEurPerDay ?? 0) > 0 ? '+' : ''}{a.dropVelocityEurPerDay}€
            </div>
          </div>
        </div>

        {/* Total drop since first seen */}
        {a.totalDropPct != null && a.totalDropPct !== 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Target className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">Od prve meritve ({a.daysSinceFirstSeen}d nazaj):</span>
            <span className={cn('font-mono font-bold', a.totalDropPct < 0 ? 'text-green-500' : 'text-red-500')}>
              {a.totalDropPct > 0 ? '+' : ''}{a.totalDropPct}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
