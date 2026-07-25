'use client';

// v4.6: Watchlist — oglasi, ki jih uporabnik spremlja
// Prikaz bookmarkov + listingov s targetPrice, z live preview cen in距ljen do cilja

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ExternalLink, Eye, Target, Bookmark, TrendingDown, TrendingUp, MapPin, Clock, Sparkles, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface WatchlistItem {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  imageUrl: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiEstimatedValue: number | null;
  dealScore: number | null;
  dealScoreReason: string | null;
  isBookmarked: boolean;
  bookmarkedAt: string | null;
  targetPrice: number | null;
  targetPriceSetAt: string | null;
  targetPriceAlertSent: boolean;
  distanceToTarget: number | null;
  distancePct: number | null;
  targetHit: boolean;
  lowestEver: number | null;
  highestEver: number | null;
  priceHistoryCount: number;
  contactStatus: string;
  monitor: { name: string; source: string };
}

interface WatchlistStats {
  total: number;
  withTarget: number;
  bookmarked: number;
  targetsHit: number;
  targetsAbove: number;
  priceDropPending: number;
  totalPotentialSavings: number;
  totalValue: number;
}

type View = 'dashboard' | 'monitors' | 'alerts' | 'listings' | 'watchlist' | 'analytics' | 'trades' | 'health' | 'notifications' | 'settings';

export function WatchlistView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [data, setData] = useState<{ watchlist: WatchlistItem[]; stats: WatchlistStats } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'recent' | 'target' | 'price' | 'score'>('recent');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/listings/watchlist?sort=${sort}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error('Ne morem naložiti watchlista');
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => { load(); }, [load]);

  const removeBookmark = async (id: string) => {
    try {
      await fetch('/api/listings/bookmark', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isBookmarked: false }),
      });
      toast.success('Odstranjeno iz watchlista');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const clearTarget = async (id: string) => {
    try {
      await fetch(`/api/listings/${id}/target`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPrice: null }),
      });
      toast.success('Ciljna cena odstranjena');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 bg-card animate-pulse rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const stats = data?.stats;
  const items = data?.watchlist ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Watchlist
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Oglasi, ki jih spremljaš — z shranjenimi zaznamki ali nastavljeno ciljno ceno.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="text-xs bg-card border border-border rounded px-2 py-1.5"
          >
            <option value="recent">Najnovejši</option>
            <option value="target">Najbližji cilju</option>
            <option value="price">Cena (najnižja)</option>
            <option value="score">AI ocena (najvišja)</option>
          </select>
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            Osveži
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Skupaj</div>
              <div className="text-2xl font-bold font-mono">{stats.total}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {stats.bookmarked} shranjenih • {stats.withTarget} s ciljem
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Cilj dosežen</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.targetsHit}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {stats.targetsAbove} še čaka
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Vrednost</div>
              <div className="text-2xl font-bold font-mono text-amber-400">{stats.totalValue.toFixed(0)}€</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                skupna vrednost watchlista
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Potencialni prihranek</div>
              <div className="text-2xl font-bold font-mono text-primary">{stats.totalPotentialSavings.toFixed(0)}€</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                če vsi dosežejo cilj
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Items list */}
      {items.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <Eye className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm mb-4">
              Watchlist je prazen. Dodaj oglase z:
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button size="sm" variant="outline" onClick={() => onNavigate('listings')} className="gap-2">
                <Bookmark className="w-3.5 h-3.5" />
                Shrani oglas
              </Button>
              <Button size="sm" variant="outline" onClick={() => onNavigate('listings')} className="gap-2">
                <Target className="w-3.5 h-3.5" />
                Nastavi ciljno ceno
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <WatchlistItemCard
              key={item.id}
              item={item}
              onRemoveBookmark={removeBookmark}
              onClearTarget={clearTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistItemCard({
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
}
