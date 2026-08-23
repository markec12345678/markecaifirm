'use client';

// v9.00: CompareModal — extracted from listings-view.tsx.

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useSwipe } from '@/lib/use-swipe';
import { NegotiationHistory } from '@/components/dashboard/negotiation-history';
import { PriceForecastChart } from '@/components/dashboard/price-forecast-chart';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Download, ExternalLink, ChevronLeft, ChevronRight, Filter, ImageIcon, AlertTriangle, Target, MapPin, Clock, Bookmark, Sparkles, ShoppingCart, BarChart3, TrendingDown, TrendingUp, Copy, Check, GitCompare, Trash2, EyeOff, Zap, User, Wallet, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SentimentPanel } from '@/components/dashboard/listing-detail/sentiment-panel';
import { AuctionSniperPanel } from '@/components/dashboard/listing-detail/auction-sniper-panel';
import { FraudDetectionPanel } from '@/components/dashboard/listing-detail/fraud-detection-panel';
import { ImageAnalysisPanel } from '@/components/dashboard/listing-detail/image-analysis-panel';
import { NegotiationPanel } from '@/components/dashboard/listing-detail/negotiation-panel';
import { PriceHistoryPanel } from '@/components/dashboard/listing-detail/price-history-panel';
import { SellerIntelligencePanel } from '@/components/dashboard/listing-detail/seller-intelligence-panel';
import { MakeOfferPanel } from '@/components/dashboard/listing-detail/make-offer-panel';
import { SoldCompsPanel } from '@/components/dashboard/listing-detail/sold-comps-panel';
import { QuickBuyButton } from '@/components/dashboard/listing-detail/quick-buy-button';
import { ListingActionsBar } from '@/components/dashboard/listing-detail/listing-actions-bar';
import type { Listing, ListingsResponse, Monitor, BuyScore } from './types';
import { formatTimeAgo } from './utils';
import { CompareRow } from './compare-row';


export function CompareModal({ data, onClose }: { data: any; onClose: () => void }) {
  if (!data || !data.listings || data.listings.length === 0) return null;
  const listings = data.listings;

  // Find best price (lowest)
  const prices = listings.map((l: any) => l.price).filter((p: any) => p != null);
  const bestPrice = prices.length > 0 ? Math.min(...prices) : null;
  // Find best AI score (highest)
  const scores = listings.map((l: any) => l.aiScore).filter((s: any) => s != null);
  const bestScore = scores.length > 0 ? Math.max(...scores) : null;

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-primary" />
            Primerjava {listings.length} oglasov
          </DialogTitle>
          <DialogDescription>Side-by-side primerjava — izberi najboljšo ponzudbo.</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-2 text-muted-foreground uppercase tracking-wider w-32">Lastnost</th>
                {listings.map((l: any, i: number) => (
                  <th key={i} className="text-left p-2 align-top min-w-[180px]">
                    {l.imageUrl && (
                      <img src={l.imageUrl} alt="" className="w-full h-24 object-cover rounded mb-2" loading="lazy" />
                    )}
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline line-clamp-2">
                      {l.title}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Cena" values={listings.map((l: any) => l.priceText ?? '—')} best={listings.map((l: any) => l.price === bestPrice && l.price != null)} />
              <CompareRow label="AI verdikt" values={listings.map((l: any) => l.aiVerdict ?? '—')} />
              <CompareRow label="AI prilika" values={listings.map((l: any) => l.aiScore != null ? `${l.aiScore}/10` : '—')} best={listings.map((l: any) => l.aiScore === bestScore && l.aiScore != null)} />
              <CompareRow label="AI tveganje" values={listings.map((l: any) => l.aiRisk != null ? `${l.aiRisk}/10` : '—')} />
              <CompareRow label="AI tržna vrednost" values={listings.map((l: any) => l.aiEstimatedValue ? `${l.aiEstimatedValue} €` : '—')} />
              <CompareRow label="Lokacija" values={listings.map((l: any) => l.location || '—')} />
              <CompareRow label="Monitor" values={listings.map((l: any) => l.monitor?.name ?? '—')} />
              <CompareRow label="Prvič videno" values={listings.map((l: any) => new Date(l.firstSeenAt).toLocaleDateString('sl-SI'))} />
              <CompareRow label="Starost (dni)" values={listings.map((l: any) => String(Math.floor((Date.now() - new Date(l.firstSeenAt).getTime()) / 86400000)))} />
              <CompareRow label="Padec cene" values={listings.map((l: any) => l.priceDroppedAt ? `📉 ${new Date(l.priceDroppedAt).toLocaleDateString('sl-SI')}` : '—')} />
              <CompareRow label="AI razlog" values={listings.map((l: any) => (l.aiReason || '—').slice(0, 100))} />
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

