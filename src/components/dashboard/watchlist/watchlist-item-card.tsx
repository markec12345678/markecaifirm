'use client';

// v9.09: WatchlistItemCard — extracted from watchlist-view.tsx.

import { useEffect, useState, useCallback, memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ExternalLink, Eye, Target, Bookmark, TrendingDown, TrendingUp, MapPin, Clock, Sparkles, ShoppingCart, Trash2, Zap, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WatchlistItem, View } from './types';

export const WatchlistItemCard = memo(function WatchlistItemCard({
  item,
  onRemoveBookmark,
  onClearTarget,
}: {
  item: WatchlistItem;
  onRemoveBookmark: (id: string) => void;
  onClearTarget: (id: string) => void;
}) {
  const targetHit = item.targetHit;
  const distanceToTarget = item.distanceToTarget;
  const distancePct = item.distancePct;
  const hasTarget = item.targetPrice != null;
  const hasBookmarked = item.isBookmarked;

  // Price trend (lowest/highest)
  const priceRange = item.lowestEver != null && item.highestEver != null && item.lowestEver !== item.highestEver;

  return (
    <Card className={cn(
      'bg-card/50 hover:bg-card transition-colors',
      targetHit && 'border-primary/40 bg-primary/5'
    )}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.title}
              className="w-16 h-16 object-cover rounded bg-background shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-16 h-16 bg-background rounded shrink-0 flex items-center justify-center">
              <Eye className="w-5 h-5 text-muted-foreground opacity-30" />
            </div>
          )}

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sm hover:text-primary truncate flex-1"
                title={item.title}
              >
                {item.title}
              </a>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary p-1"
                  title="Odpri oglas"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 flex-wrap">
              <span className="font-mono text-amber-400 font-bold">{item.priceText}</span>
              <span>•</span>
              <span>{item.monitor?.name}</span>
              {item.location && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-0.5">
                    <MapPin className="w-3 h-3" />
                    {item.location}
                  </span>
                </>
              )}
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {hasBookmarked && (
                <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-400 gap-0.5">
                  <Bookmark className="w-2.5 h-2.5" />
                  Shranjeno
                </Badge>
              )}
              {hasTarget && (
                <Badge variant="outline" className={cn(
                  'text-[10px] gap-0.5',
                  targetHit
                    ? 'border-primary/40 text-primary'
                    : 'border-amber-400/40 text-amber-400'
                )}>
                  <Target className="w-2.5 h-2.5" />
                  {targetHit ? 'Cilj dosežen' : `Cilj ${item.targetPrice}€`}
                </Badge>
              )}
              {item.aiVerdict && (
                <Badge variant="outline" className={cn(
                  'text-[10px]',
                  item.aiVerdict === 'PRILIKA' && 'border-primary/40 text-primary',
                  item.aiVerdict === 'SUMNJIVO' && 'border-amber-400/40 text-amber-400',
                  item.aiVerdict === 'NEZANIMIVO' && 'border-muted text-muted-foreground',
                )}>{item.aiVerdict}</Badge>
              )}
              {item.dealScore != null && (
                <Badge variant="outline" className={cn(
                  'text-[10px] font-mono',
                  item.dealScore >= 70 ? 'border-primary/40 text-primary' :
                  item.dealScore >= 50 ? 'border-amber-400/40 text-amber-400' :
                  'border-red-500/40 text-red-500'
                )}>
                  🎯 {item.dealScore}
                </Badge>
              )}
              {item.aiScore != null && (
                <span className="text-[10px] text-primary">⭐ {item.aiScore}</span>
              )}
              {item.aiEstimatedValue != null && item.price != null && item.aiEstimatedValue > item.price && (
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/70">
                  AI ~{item.aiEstimatedValue}€
                </Badge>
              )}
              {item.priceHistoryCount > 1 && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  📈 {item.priceHistoryCount}× cena
                </Badge>
              )}
            </div>

            {/* Target progress bar */}
            {hasTarget && item.price != null && (
              <div className="mb-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Cena: {item.price}€</span>
                  <span>Cilj: {item.targetPrice}€</span>
                </div>
                <div className="h-1.5 bg-background rounded overflow-hidden relative">
                  {/* Target marker */}
                  <div
                    className="absolute top-0 bottom-0 border-r-2 border-primary"
                    style={{
                      left: `${Math.min(100, Math.max(0, ((item.targetPrice! - (item.lowestEver ?? 0)) / Math.max(1, (item.highestEver ?? item.price) - (item.lowestEver ?? 0))) * 100))}%`
                    }}
                  />
                  {/* Current price marker */}
                  <div
                    className={cn(
                      'absolute top-[-2px] bottom-[-2px] w-1 rounded-full',
                      targetHit ? 'bg-primary' : 'bg-amber-400'
                    )}
                    style={{
                      left: `${Math.min(100, Math.max(0, ((item.price - (item.lowestEver ?? 0)) / Math.max(1, (item.highestEver ?? item.price) - (item.lowestEver ?? 0))) * 100))}%`
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] mt-1">
                  <span className="text-muted-foreground">
                    Min: {item.lowestEver ?? '?'}€
                  </span>
                  {distanceToTarget != null && (
                    <span className={cn(
                      'font-mono font-bold',
                      targetHit ? 'text-primary' : 'text-amber-400'
                    )}>
                      {targetHit
                        ? `✓ ${Math.abs(distanceToTarget)}€ pod ciljem`
                        : `še ${distanceToTarget}€ (${distancePct}%) nad ciljem`
                      }
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    Max: {item.highestEver ?? '?'}€
                  </span>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 mt-2">
              {hasBookmarked && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-red-500 gap-1"
                  onClick={() => onRemoveBookmark(item.id)}
                >
                  <Bookmark className="w-3 h-3" />
                  Odstrani shranjeno
                </Button>
              )}
              {hasTarget && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-red-500 gap-1"
                  onClick={() => onClearTarget(item.id)}
                >
                  <Target className="w-3 h-3" />
                  Počisti cilj
                </Button>
              )}
              {priceRange && item.price != null && (
                <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
                  {item.lowestEver! < item.price ? (
                    <TrendingDown className="w-3 h-3 text-red-500" />
                  ) : (
                    <TrendingUp className="w-3 h-3 text-primary" />
                  )}
                  Najnižja: {item.lowestEver}€
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
})


