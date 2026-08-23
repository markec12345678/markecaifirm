'use client';

// v9.00: CompareRow — extracted from listings-view.tsx.

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


export function CompareRow({ label, values, best }: { label: string; values: string[]; best?: boolean[] }) {
  return (
    <tr className="border-b border-border/50">
      <td className="p-2 text-muted-foreground font-medium uppercase tracking-wider text-[10px]">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={cn('p-2 font-mono', best?.[i] && 'text-primary font-bold')}>
          {v}
        </td>
      ))}
    </tr>
  );
}
