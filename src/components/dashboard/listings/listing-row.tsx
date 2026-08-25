'use client';

// v9.00: ListingRow — extracted from listings-view.tsx.

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


export function ListingRow({ listing, onOpenDetail, onToggleBookmark, onToggleCompare, isCompareSelected, onToggleBulk, isBulkSelected, onQuickContact, buyScore }: { listing: Listing; onOpenDetail: () => void; onToggleBookmark: () => void; onToggleCompare: () => void; isCompareSelected: boolean; onToggleBulk: () => void; isBulkSelected: boolean; onQuickContact: () => void; buyScore?: { score: number; verdict: 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'AVOID'; expectedROI: number | null; expectedProfit: number | null; discountPercent: number | null; recommendation: string } | null; }) {
  const verdictColor =
    listing.aiVerdict === 'PRILIKA' ? 'border-primary/40 text-primary' :
    listing.aiVerdict === 'SUMNJIVO' ? 'border-amber-400/40 text-amber-400' :
    'border-muted text-muted-foreground';
  const verdictIcon =
    listing.aiVerdict === 'PRILIKA' ? <Target className="w-3 h-3" /> :
    listing.aiVerdict === 'SUMNJIVO' ? <AlertTriangle className="w-3 h-3" /> :
    null;

  // v5.0: Swipe gestures (mobile only — touch events)
  const { swipeState, touchHandlers } = useSwipe({
    onSwipeLeft: () => onToggleBookmark(), // swipe left = bookmark
    onSwipeRight: () => onOpenDetail(), // swipe right = open detail
  }, true);

  // Visual feedback during swipe
  const swipeOffset = swipeState.isSwiping ? swipeState.deltaX * 0.3 : 0;
  const swipeOpacity = swipeState.isSwiping ? 1 - Math.min(0.4, Math.abs(swipeState.deltaX) / 300) : 1;
  const swipeBgHint = swipeState.isSwiping
    ? (swipeState.direction === 'left'
        ? 'bg-amber-400/5'
        : swipeState.direction === 'right'
          ? 'bg-primary/5'
          : '')
    : '';

  return (
    <div
      {...touchHandlers}
      className="relative"
      style={{
        transform: swipeState.isSwiping ? `translateX(${swipeOffset}px)` : 'translateX(0)',
        opacity: swipeOpacity,
        transition: swipeState.isSwiping ? 'none' : 'transform 200ms, opacity 200ms',
      }}
    >
      {/* v5.0: Swipe hint background */}
      {swipeState.isSwiping && swipeState.direction === 'left' && (
        <div className="absolute inset-0 flex items-center justify-end pr-4 pointer-events-none">
          <Bookmark className={cn('w-6 h-6', listing.isBookmarked ? 'text-primary' : 'text-amber-400')} />
        </div>
      )}
      {swipeState.isSwiping && swipeState.direction === 'right' && (
        <div className="absolute inset-0 flex items-center justify-start pl-4 pointer-events-none">
          <ExternalLink className="w-6 h-6 text-primary" />
        </div>
      )}
    <Card className={cn(
      'bg-card/50 hover:bg-card hover:border-primary/30 transition-colors cursor-pointer relative',
      listing.isBookmarked && 'border-primary/50 ring-1 ring-primary/20',
      swipeBgHint,
    )} onClick={onOpenDetail}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {listing.imageUrl ? (
            <img
              src={listing.imageUrl}
              alt=""
              className="w-16 h-16 rounded object-cover bg-muted shrink-0"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {verdictIcon && <span className={verdictColor.split(' ')[1]}>{verdictIcon}</span>}
              {listing.aiVerdict && (
                <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider', verdictColor)}>
                  {listing.aiVerdict}
                </Badge>
              )}
              {listing.aiScore != null && <span className="text-[11px] text-primary">⭐ {listing.aiScore}</span>}
              {listing.aiRisk != null && <span className="text-[11px] text-amber-400">🛡 {listing.aiRisk}</span>}
              {/* v8.69: Buy Opportunity Score badge — data-driven "should I buy?" */}
              {buyScore && (
                <span
                  className={cn(
                    'text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border',
                    buyScore.verdict === 'STRONG_BUY'
                      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
                      : buyScore.verdict === 'BUY'
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : buyScore.verdict === 'CONSIDER'
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                          : 'bg-red-500/10 text-red-500 border-red-500/30'
                  )}
                  title={`🛒 Buy Score: ${buyScore.score}/100 (${buyScore.verdict})${buyScore.expectedROI != null ? `\nPričakovan ROI: +${buyScore.expectedROI.toFixed(0)}%` : ''}${buyScore.expectedProfit != null ? `\nPričakovan dobiček: +${buyScore.expectedProfit.toFixed(0)}€` : ''}${buyScore.discountPercent != null && buyScore.discountPercent > 0 ? `\n${buyScore.discountPercent.toFixed(0)}% pod AI oceno vrednosti` : ''}\n\n${buyScore.recommendation}`}
                >
                  🛒 {buyScore.score}
                </span>
              )}
              {listing.dealScore != null && (
                <span className={cn(
                  'text-[11px] font-mono font-bold px-1.5 py-0.5 rounded',
                  listing.dealScore >= 90 ? 'bg-primary/20 text-primary' :
                  listing.dealScore >= 70 ? 'bg-primary/10 text-primary/80' :
                  listing.dealScore >= 50 ? 'bg-amber-400/10 text-amber-400' :
                  'bg-red-500/10 text-red-500'
                )}>
                  🎯 {listing.dealScore}/100
                </span>
              )}
              {listing.targetPrice != null && (
                <span className={cn(
                  'text-[11px] font-mono px-1.5 py-0.5 rounded border',
                  listing.price != null && listing.price <= listing.targetPrice
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-amber-400/40 bg-amber-400/5 text-amber-400'
                )} title={`Ciljna cena: ${listing.targetPrice}€`}>
                  🎯 {listing.targetPrice}€
                </span>
              )}
              {listing.aiImageVerdict && listing.aiImageVerdict !== 'NO_IMAGE' && (
                <Badge variant="outline" className={cn(
                  'text-[10px]',
                  listing.aiImageVerdict === 'AUTHENTIC' && 'border-primary/40 text-primary',
                  listing.aiImageVerdict === 'SUSPICIOUS' && 'border-amber-400/40 text-amber-400',
                  listing.aiImageVerdict === 'STOCK_PHOTO' && 'border-amber-400/40 text-amber-400',
                )}>
                  📸 {listing.aiImageVerdict}
                </Badge>
              )}
            </div>
            <h3 className="font-bold text-sm truncate">{listing.title}</h3>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
              <span className="text-amber-400 font-mono">{listing.priceText}</span>
              {listing.aiEstimatedValue && listing.price && (
                <span className="text-primary">
                  (tržna ~{listing.aiEstimatedValue}€, {listing.aiEstimatedValue > listing.price ? `+${listing.aiEstimatedValue - listing.price}€` : `${listing.aiEstimatedValue - listing.price}€`})
                </span>
              )}
              {listing.location && <span>• {listing.location}</span>}
              <span>• {listing.monitor.name}</span>
              <span>• {formatTimeAgo(listing.firstSeenAt)}</span>
              {(() => {
                const days = Math.floor((Date.now() - new Date(listing.firstSeenAt).getTime()) / 86400000);
                if (days >= 7) return <span className="text-amber-400">• {days}d aktiven ⏳</span>;
                if (days >= 30) return <span className="text-primary">• {days}d aktiven 🟢</span>;
                return null;
              })()}
            </div>
            {listing.isBookmarked && (
              <span className="text-primary text-[10px]">⭐ shranjeno</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* v3.6: Bulk select checkbox */}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleBulk(); }}
              className={cn(
                'w-4 h-4 rounded border shrink-0 transition-colors',
                isBulkSelected ? 'bg-primary border-primary' : 'border-border hover:border-primary'
              )}
              title="Izberi za bulk akcijo"
            >
              {isBulkSelected && <Check className="w-3 h-3 text-primary-foreground mx-auto" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
              className={cn(
                'shrink-0 p-1.5 rounded hover:bg-primary/10 transition-colors',
                isCompareSelected ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-primary'
              )}
              title={isCompareSelected ? 'Odstrani iz primerjave' : 'Dodaj v primerjavo'}
            >
              <GitCompare className={cn('w-4 h-4', isCompareSelected && 'text-primary')} />
            </button>
            {/* v3.9: Quick contact toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); onQuickContact(); }}
              className={cn(
                'shrink-0 p-1.5 rounded hover:bg-primary/10 transition-colors text-[10px]',
                (listing.contactStatus && listing.contactStatus !== 'none')
                  ? 'text-amber-400 bg-amber-400/5'
                  : 'text-muted-foreground hover:text-amber-400'
              )}
              title={listing.contactStatus && listing.contactStatus !== 'none' ? 'Počisti kontakt status' : 'Označi kot kontaktirano'}
            >
              📞
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
              className={cn(
                'shrink-0 p-1.5 rounded hover:bg-primary/10 transition-colors',
                listing.isBookmarked ? 'text-primary' : 'text-muted-foreground hover:text-primary'
              )}
              title={listing.isBookmarked ? 'Odstrani iz shranjenih' : 'Shrani'}
            >
              <Bookmark className={cn('w-4 h-4', listing.isBookmarked && 'fill-current')} />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}


